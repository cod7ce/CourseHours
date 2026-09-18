use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::{fmt_date, ms_to_date, today, today_str, Db};
use crate::error::AppResult;
use crate::models::Session;
use crate::repo;
use crate::settings;

use super::lock;
use super::scheduling::{session_view, SessionView};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlertStudent {
    pub id: String,
    pub name: String,
    pub balance: f64,
    pub owed_cents: i64,
    pub class_name: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub date: String,
    pub occurred_at: i64,
    /// rollcall | recharge | adjust | cancel | extra
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub delta: f64,
    pub session_id: Option<String>,
    pub student_id: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MonthOverview {
    pub consumed_hours: f64,
    pub prev_consumed_hours: f64,
    pub revenue_cents: i64,
    pub attendance_rate: Option<f64>,
    pub leave_count: i64,
    pub active_students: i64,
    pub new_students: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TodayView {
    pub date: String,
    pub weekday: String,
    pub sessions: Vec<SessionView>,
    pub predicted_hours: f64,
    pub alerts: Vec<AlertStudent>,
    pub alert_count: i64,
    pub low_balance_threshold: f64,
    pub activities: Vec<Activity>,
    pub overview: MonthOverview,
}

pub fn alerts(conn: &Connection, limit: usize) -> AppResult<(Vec<AlertStudent>, i64)> {
    let all = settings::load(conn);
    let rule = &all.hours_rule;
    let threshold = all.alerts.low_balance_threshold;
    let balances = repo::balances(conn)?;
    let mut st = conn.prepare("SELECT id, name FROM student WHERE status = 'active'")?;
    let mut rows: Vec<(String, String, f64)> = st
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(|r| r.ok())
        .map(|(id, name)| {
            let b = *balances.get(&id).unwrap_or(&0.0);
            (id, name, b)
        })
        .filter(|(_, _, b)| *b <= threshold)
        .collect();
    rows.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap().then(a.1.cmp(&b.1)));
    let count = rows.len() as i64;
    let mut out = Vec::new();
    for (id, name, b) in rows.into_iter().take(limit) {
        let unit = repo::owed_unit_price_for(conn, &id, rule)?;
        let class_name: Option<String> = conn
            .query_row(
                "SELECT k.name FROM enrollment e JOIN klass k ON k.id = e.class_id WHERE e.student_id = ?1 AND e.left_on IS NULL ORDER BY e.joined_on LIMIT 1",
                params![id],
                |r| r.get(0),
            )
            .ok();
        out.push(AlertStudent { id, name, balance: b, owed_cents: if b < 0.0 { ((-b) * unit as f64).round() as i64 } else { 0 }, class_name });
    }
    Ok((out, count))
}

fn activities(conn: &Connection, limit: i64) -> AppResult<Vec<Activity>> {
    let mut out = Vec::new();
    // 点名：按课次聚合
    let mut st = conn.prepare(
        "SELECT s.id, s.date, s.start_time, s.taken_at, k.name,
                (SELECT COALESCE(SUM(-l.delta),0) FROM ledger_entry l WHERE l.session_id = s.id AND l.type IN ('consume','adjust')) AS hours,
                (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'leave') AS leaves,
                (SELECT COUNT(*) FROM attendance a WHERE a.session_id = s.id AND a.status = 'absent') AS absents
         FROM session s JOIN klass k ON k.id = s.class_id WHERE s.status = 'taken' ORDER BY s.taken_at DESC LIMIT ?1",
    )?;
    for r in st.query_map(params![limit], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, f64>(5)?,
            r.get::<_, i64>(6)?,
            r.get::<_, i64>(7)?,
        ))
    })? {
        let (id, date, start, taken_at, cname, hours, leaves, absents) = r?;
        let mut parts = Vec::new();
        if leaves > 0 {
            parts.push(format!("{} 人请假", leaves));
        }
        if absents > 0 {
            parts.push(format!("{} 人缺勤", absents));
        }
        out.push(Activity {
            date: date[5..].replace('-', "-"),
            occurred_at: taken_at,
            kind: "rollcall".into(),
            title: format!("{} {} 点名完成", cname, start),
            detail: if parts.is_empty() { "全勤".into() } else { parts.join(" · ") },
            delta: -hours,
            session_id: Some(id),
            student_id: None,
        });
    }
    // 充值 / 手动调整
    let mut st = conn.prepare(
        "SELECT l.id, l.occurred_at, l.type, l.delta, l.amount_cents, l.reason, s.id, s.name, p.unit_price_cents
         FROM ledger_entry l JOIN student s ON s.id = l.student_id LEFT JOIN package p ON p.id = l.package_id
         WHERE l.type IN ('recharge','adjust') ORDER BY l.occurred_at DESC LIMIT ?1",
    )?;
    for r in st.query_map(params![limit], |r| {
        Ok((
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, f64>(3)?,
            r.get::<_, Option<i64>>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, Option<i64>>(8)?,
        ))
    })? {
        let (at, ty, delta, amount, reason, sid, sname, unit) = r?;
        let (title, detail) = if ty == "recharge" {
            (
                format!("{} 充值 {} 课次 · {}", sname, delta as i64, crate::core::recharge::fmt_yuan(amount.unwrap_or(0))),
                unit.map(|u| format!("均价 {} / 次", crate::core::recharge::fmt_yuan(u))).unwrap_or_default(),
            )
        } else {
            (format!("{} {}", sname, reason), "手动调整".to_string())
        };
        out.push(Activity {
            date: fmt_date(ms_to_date(at))[5..].to_string(),
            occurred_at: at,
            kind: ty,
            title,
            detail,
            delta,
            session_id: None,
            student_id: Some(sid),
        });
    }
    // 取消 / 加课
    let mut st = conn.prepare(
        "SELECT s.*, k.name AS class_name FROM session s JOIN klass k ON k.id = s.class_id
         WHERE s.status = 'cancelled' OR s.kind = 'extra' ORDER BY s.updated_at DESC LIMIT ?1",
    )?;
    for r in st.query_map(params![limit], |r| Ok((Session::from_row(r)?, r.get::<_, String>("class_name")?)))? {
        let (s, cname) = r?;
        let cancelled = s.status == "cancelled";
        out.push(Activity {
            date: fmt_date(ms_to_date(s.updated_at))[5..].to_string(),
            occurred_at: s.updated_at,
            kind: if cancelled { "cancel" } else { "extra" }.into(),
            title: if cancelled {
                format!("{} {} {} 取消", cname, &s.date[5..], s.start_time)
            } else {
                format!("{} {} {} 临时加课", cname, &s.date[5..], s.start_time)
            },
            detail: if cancelled { s.cancel_reason.clone().unwrap_or_else(|| "不顺延".into()) } else { s.note.clone().unwrap_or_else(|| "谁上课点名时定".into()) },
            delta: 0.0,
            session_id: Some(s.id.clone()),
            student_id: None,
        });
    }
    out.sort_by(|a, b| b.occurred_at.cmp(&a.occurred_at));
    out.truncate(limit as usize);
    Ok(out)
}

pub fn month_overview(conn: &Connection) -> AppResult<MonthOverview> {
    let month = today_str()[..7].to_string();
    let r = super::reports::build_report(conn, &month)?;
    let active: i64 = conn.query_row("SELECT COUNT(*) FROM student WHERE status = 'active'", [], |x| x.get(0))?;
    let new_students: i64 = conn.query_row(
        "SELECT COUNT(*) FROM student WHERE status = 'active' AND enrolled_on LIKE ?1",
        params![format!("{}%", month)],
        |x| x.get(0),
    )?;
    Ok(MonthOverview {
        consumed_hours: r.consumed_hours,
        prev_consumed_hours: r.prev_consumed_hours,
        revenue_cents: r.consume_revenue_cents,
        attendance_rate: r.attendance_rate,
        leave_count: r.leave_count,
        active_students: active,
        new_students,
    })
}

#[tauri::command]
pub fn get_today(db: State<Db>) -> AppResult<TodayView> {
    let conn = lock(&db);
    let all = settings::load(&conn);
    let balances = repo::balances(&conn)?;
    let mut st = conn.prepare("SELECT * FROM session WHERE date = ?1 AND status != 'cancelled' ORDER BY start_time")?;
    let rows = st.query_map(params![today_str()], Session::from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut sessions = Vec::new();
    let mut predicted = 0.0;
    for s in rows {
        let v = session_view(&conn, s, &balances, all.hours_rule.present)?;
        predicted += v.hours;
        sessions.push(v);
    }
    let (alerts, alert_count) = alerts(&conn, 3)?;
    let t = today();
    let weekday = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]
        [chrono::Datelike::weekday(&t).num_days_from_monday() as usize];
    Ok(TodayView {
        date: fmt_date(t),
        weekday: weekday.into(),
        sessions,
        predicted_hours: predicted,
        alerts,
        alert_count,
        low_balance_threshold: all.alerts.low_balance_threshold,
        activities: activities(&conn, 5)?,
        overview: month_overview(&conn)?,
    })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NavStats {
    pub org_name: String,
    pub month_consumed_hours: f64,
    pub alert_count: i64,
    pub owed_count: i64,
    pub today_pending: i64,
}

#[tauri::command]
pub fn get_nav_stats(db: State<Db>) -> AppResult<NavStats> {
    let conn = lock(&db);
    let all = settings::load(&conn);
    let month = today_str()[..7].to_string();
    let (a, b) = crate::db::month_bounds(&month)?;
    let consumed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(-delta), 0) FROM ledger_entry WHERE type IN ('consume','adjust') AND session_id IS NOT NULL AND occurred_at >= ?1 AND occurred_at < ?2",
        params![crate::db::date_start_ms(a), crate::db::date_end_ms(b)],
        |r| r.get(0),
    )?;
    let balances = repo::balances(&conn)?;
    let mut st = conn.prepare("SELECT id FROM student WHERE status = 'active'")?;
    let ids: Vec<String> = st.query_map([], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
    let mut alert_count = 0;
    let mut owed_count = 0;
    for id in ids {
        let b = *balances.get(&id).unwrap_or(&0.0);
        if b <= all.alerts.low_balance_threshold {
            alert_count += 1;
        }
        if b < 0.0 {
            owed_count += 1;
        }
    }
    let pending: i64 = conn.query_row(
        "SELECT COUNT(*) FROM session WHERE date = ?1 AND status = 'planned'",
        params![today_str()],
        |r| r.get(0),
    )?;
    Ok(NavStats { org_name: all.org.name, month_consumed_hours: consumed, alert_count, owed_count, today_pending: pending })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    /// student | class
    pub kind: String,
    pub id: String,
    pub title: String,
    pub subtitle: String,
}

#[tauri::command]
pub fn global_search(db: State<Db>, query: String) -> AppResult<Vec<SearchHit>> {
    let conn = lock(&db);
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let like = format!("%{}%", q);
    let balances = repo::balances(&conn)?;
    let mut out = Vec::new();
    let mut st = conn.prepare("SELECT id, name, en_name, status FROM student WHERE name LIKE ?1 OR en_name LIKE ?1 OR phone LIKE ?1 ORDER BY name LIMIT 8")?;
    for r in st.query_map(params![like], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, String>(3)?)))? {
        let (id, name, en, status) = r?;
        let b = *balances.get(&id).unwrap_or(&0.0);
        out.push(SearchHit {
            kind: "student".into(),
            title: format!("{}{}", name, en.map(|e| format!(" {}", e)).unwrap_or_default()),
            subtitle: format!("{} · 余额 {}", match status.as_str() { "active" => "在读", "paused" => "已停课", _ => "已退班" }, crate::core::recharge::trim_num(b)),
            id,
        });
    }
    let mut st = conn.prepare("SELECT id, name, room FROM klass WHERE name LIKE ?1 AND status = 'active' ORDER BY name LIMIT 5")?;
    for r in st.query_map(params![like], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)))? {
        let (id, name, room) = r?;
        let n = repo::enrolled_count(&conn, &id)?;
        out.push(SearchHit { kind: "class".into(), id, title: name, subtitle: format!("{} 人{}", n, room.map(|x| format!(" · {}", x)).unwrap_or_default()) });
    }
    Ok(out)
}
