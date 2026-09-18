use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::{date_end_ms, date_start_ms, fmt_date, month_bounds, today, today_str, Db};
use crate::error::AppResult;
use crate::repo;
use crate::settings;

use super::lock;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MonthPoint {
    pub month: String,
    pub label: String,
    pub consumed_hours: f64,
    pub is_current: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassReportRow {
    pub class_id: String,
    pub class_name: String,
    pub class_color: String,
    pub enrolled: i64,
    pub capacity: i64,
    pub sessions: i64,
    pub consumed_hours: f64,
    pub attendance_rate: Option<f64>,
    pub avg_price_cents: i64,
    pub revenue_cents: i64,
    pub unconsumed_hours: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub month: String,
    pub month_label: String,
    pub sessions_taken: i64,
    pub sessions_planned_total: i64,
    pub consumed_hours: f64,
    pub prev_consumed_hours: f64,
    pub consume_revenue_cents: i64,
    pub recharge_cents: i64,
    pub recharge_count: i64,
    pub recharge_sessions: f64,
    pub attendance_rate: Option<f64>,
    pub attended_count: i64,
    pub leave_count: i64,
    pub absent_count: i64,
    pub series: Vec<MonthPoint>,
    pub classes: Vec<ClassReportRow>,
    pub total_capacity: i64,
    pub total_enrolled: i64,
    pub unconsumed_hours: f64,
    pub unconsumed_value_cents: i64,
    pub unconsumed_students: i64,
    pub owed_hours: f64,
    pub owed_cents: i64,
    pub owed_students: i64,
    pub is_current_month: bool,
    pub today: String,
}

fn month_consumed(conn: &Connection, month: &str) -> AppResult<f64> {
    let (a, b) = month_bounds(month)?;
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(-delta), 0) FROM ledger_entry WHERE type IN ('consume','adjust') AND session_id IS NOT NULL AND occurred_at >= ?1 AND occurred_at < ?2",
        params![date_start_ms(a), date_end_ms(b)],
        |r| r.get(0),
    )?)
}

fn shift_month(d: NaiveDate, delta: i32) -> NaiveDate {
    let total = d.year() * 12 + d.month0() as i32 + delta;
    NaiveDate::from_ymd_opt(total.div_euclid(12), (total.rem_euclid(12) + 1) as u32, 1).unwrap()
}

pub fn build_report(conn: &Connection, month: &str) -> AppResult<Report> {
    let (a, b) = month_bounds(month)?;
    let lo = date_start_ms(a);
    let hi = date_end_ms(b);
    let like = format!("{}%", month);
    let rule = settings::hours_rule(conn);
    let balances = repo::balances(conn)?;

    let sessions_taken: i64 = conn.query_row("SELECT COUNT(*) FROM session WHERE date LIKE ?1 AND status = 'taken'", params![like], |r| r.get(0))?;
    let sessions_planned_total: i64 = conn.query_row("SELECT COUNT(*) FROM session WHERE date LIKE ?1 AND status != 'cancelled'", params![like], |r| r.get(0))?;
    let consumed_hours = month_consumed(conn, month)?;
    let prev_month = fmt_date(shift_month(a, -1))[..7].to_string();
    let prev_consumed_hours = month_consumed(conn, &prev_month)?;
    let consume_revenue_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM ledger_entry WHERE type IN ('consume','adjust') AND session_id IS NOT NULL AND occurred_at >= ?1 AND occurred_at < ?2",
        params![lo, hi],
        |r| r.get(0),
    )?;
    let (recharge_cents, recharge_count, recharge_sessions): (i64, i64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0), COUNT(*), COALESCE(SUM(delta), 0) FROM ledger_entry WHERE type = 'recharge' AND occurred_at >= ?1 AND occurred_at < ?2",
        params![lo, hi],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let (attended, leave, absent, att_total): (i64, i64, i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(a.status IN ('present','late')), 0), COALESCE(SUM(a.status = 'leave'), 0), COALESCE(SUM(a.status = 'absent'), 0), COUNT(*)
         FROM attendance a JOIN session s ON s.id = a.session_id WHERE s.date LIKE ?1",
        params![like],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let attendance_rate = if att_total > 0 { Some(attended as f64 / att_total as f64) } else { None };

    let mut series = Vec::new();
    for i in (0..6).rev() {
        let m = shift_month(a, -i);
        let ms = fmt_date(m)[..7].to_string();
        series.push(MonthPoint { label: format!("{} 月", m.month()), consumed_hours: month_consumed(conn, &ms)?, is_current: i == 0, month: ms });
    }

    let mut st = conn.prepare("SELECT * FROM klass WHERE status = 'active' ORDER BY created_at")?;
    let klasses = st.query_map([], crate::models::Klass::from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut classes = Vec::new();
    let mut total_capacity = 0;
    let mut total_enrolled = 0;
    for k in klasses {
        let enrolled = repo::enrolled_count(conn, &k.id)?;
        total_capacity += k.capacity;
        total_enrolled += enrolled;
        let sessions: i64 = conn.query_row(
            "SELECT COUNT(*) FROM session WHERE class_id = ?1 AND date LIKE ?2 AND status != 'cancelled'",
            params![k.id, like],
            |r| r.get(0),
        )?;
        let (hours, cents): (f64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(-l.delta), 0), COALESCE(SUM(l.amount_cents), 0)
             FROM ledger_entry l JOIN session s ON s.id = l.session_id
             WHERE s.class_id = ?1 AND l.type IN ('consume','adjust') AND l.occurred_at >= ?2 AND l.occurred_at < ?3",
            params![k.id, lo, hi],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let (ca, ct): (i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(a.status IN ('present','late')), 0), COUNT(*)
             FROM attendance a JOIN session s ON s.id = a.session_id WHERE s.class_id = ?1 AND s.date LIKE ?2",
            params![k.id, like],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let mut st2 = conn.prepare("SELECT student_id FROM enrollment WHERE class_id = ?1 AND left_on IS NULL")?;
        let ids: Vec<String> = st2.query_map(params![k.id], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
        let unconsumed: f64 = ids.iter().map(|id| balances.get(id).copied().unwrap_or(0.0)).filter(|b| *b > 0.0).sum();
        classes.push(ClassReportRow {
            class_id: k.id.clone(),
            class_name: k.name.clone(),
            class_color: k.color.clone(),
            enrolled,
            capacity: k.capacity,
            sessions,
            consumed_hours: hours,
            attendance_rate: if ct > 0 { Some(ca as f64 / ct as f64) } else { None },
            avg_price_cents: if hours > 0.0 { (cents as f64 / hours).round() as i64 } else { 0 },
            revenue_cents: cents,
            unconsumed_hours: unconsumed,
        });
    }

    // 未消耗 / 欠课时：全体学生（含无班级的）
    let mut unconsumed_hours = 0.0;
    let mut unconsumed_value = 0i64;
    let mut unconsumed_students = 0;
    let mut owed_hours = 0.0;
    let mut owed_cents = 0i64;
    let mut owed_students = 0;
    let free_ids: std::collections::HashSet<String> = {
        let mut st = conn.prepare("SELECT id FROM student WHERE billing = 'free'")?;
        let v: Vec<String> = st.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
        v.into_iter().collect()
    };
    for (sid, b) in &balances {
        if free_ids.contains(sid) {
            continue;
        }
        if *b > 0.0 {
            unconsumed_hours += b;
            unconsumed_students += 1;
            let pk = repo::package_states(conn, sid)?;
            let unit = pk.last().map(|p| p.unit_price_cents).unwrap_or(0);
            unconsumed_value += (b * unit as f64).round() as i64;
        } else if *b < 0.0 {
            owed_hours += -b;
            owed_students += 1;
            let unit = repo::owed_unit_price_for(conn, sid, &rule)?;
            owed_cents += ((-b) * unit as f64).round() as i64;
        }
    }

    Ok(Report {
        month: month.to_string(),
        month_label: format!("{} 年 {} 月", a.year(), a.month()),
        sessions_taken,
        sessions_planned_total,
        consumed_hours,
        prev_consumed_hours,
        consume_revenue_cents,
        recharge_cents,
        recharge_count,
        recharge_sessions,
        attendance_rate,
        attended_count: attended,
        leave_count: leave,
        absent_count: absent,
        series,
        classes,
        total_capacity,
        total_enrolled,
        unconsumed_hours,
        unconsumed_value_cents: unconsumed_value,
        unconsumed_students,
        owed_hours,
        owed_cents,
        owed_students,
        is_current_month: today_str().starts_with(month),
        today: fmt_date(today()),
    })
}

#[tauri::command]
pub fn get_report(db: State<Db>, month: Option<String>) -> AppResult<Report> {
    let conn = lock(&db);
    let m = month.filter(|x| x.len() == 7).unwrap_or_else(|| today_str()[..7].to_string());
    build_report(&conn, &m)
}

#[tauri::command]
pub fn export_report_csv(db: State<Db>, month: Option<String>) -> AppResult<String> {
    let conn = lock(&db);
    let m = month.filter(|x| x.len() == 7).unwrap_or_else(|| today_str()[..7].to_string());
    let r = build_report(&conn, &m)?;
    let mut out = String::from("\u{FEFF}班级,在班人数,班级上限,本月课次,课消课时,出勤率,加权均价(元),课消收入(元),未消耗课时\n");
    let mut tot_sessions = 0;
    let mut tot_hours = 0.0;
    let mut tot_rev = 0;
    let mut tot_unc = 0.0;
    for c in &r.classes {
        tot_sessions += c.sessions;
        tot_hours += c.consumed_hours;
        tot_rev += c.revenue_cents;
        tot_unc += c.unconsumed_hours;
        out.push_str(&format!(
            "{},{},{},{},{},{},{:.2},{:.2},{}\n",
            c.class_name,
            c.enrolled,
            c.capacity,
            c.sessions,
            c.consumed_hours,
            c.attendance_rate.map(|x| format!("{:.0}%", x * 100.0)).unwrap_or_default(),
            c.avg_price_cents as f64 / 100.0,
            c.revenue_cents as f64 / 100.0,
            c.unconsumed_hours
        ));
    }
    let avg = if tot_hours > 0.0 { tot_rev as f64 / tot_hours / 100.0 } else { 0.0 };
    out.push_str(&format!(
        "合计,{},{},{},{},{},{:.2},{:.2},{}\n",
        r.total_enrolled,
        r.total_capacity,
        tot_sessions,
        tot_hours,
        r.attendance_rate.map(|x| format!("{:.0}%", x * 100.0)).unwrap_or_default(),
        avg,
        tot_rev as f64 / 100.0,
        tot_unc
    ));
    out.push_str(&format!("\n欠课时（应收）,{},折算金额(元),{:.2}\n", r.owed_hours, r.owed_cents as f64 / 100.0));
    Ok(out)
}
