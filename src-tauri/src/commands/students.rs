use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::recharge::fmt_yuan;
use crate::db::{fmt_date, new_id, now_ms, today, today_str, Db};
use crate::error::{AppError, AppResult};
use crate::models::{LedgerView, Package, Student};
use crate::repo;
use crate::settings;

use super::lock;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassRef {
    pub id: String,
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StudentRow {
    #[serde(flatten)]
    pub student: Student,
    pub balance: f64,
    pub classes: Vec<ClassRef>,
    pub month_attended: i64,
    pub month_total: i64,
    pub last_session_date: Option<String>,
    /// 欠课时折算应补缴（分）
    pub owed_cents: i64,
    pub owed_unit_price_cents: i64,
    pub is_new_this_month: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StudentListStats {
    pub active_count: i64,
    pub owed_count: i64,
    pub low_count: i64,
    pub new_count: i64,
    pub paused_count: i64,
    pub low_balance_threshold: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StudentList {
    pub rows: Vec<StudentRow>,
    pub stats: StudentListStats,
}

fn classes_of(conn: &Connection, student_id: &str) -> AppResult<Vec<ClassRef>> {
    let mut st = conn.prepare(
        "SELECT k.id, k.name, k.color FROM enrollment e JOIN klass k ON k.id = e.class_id
         WHERE e.student_id = ?1 AND e.left_on IS NULL ORDER BY e.joined_on",
    )?;
    let rows = st.query_map(params![student_id], |r| {
        Ok(ClassRef { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn month_attendance(conn: &Connection, student_id: &str, month_prefix: &str) -> AppResult<(i64, i64)> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN a.status IN ('present','late') THEN 1 ELSE 0 END), 0), COUNT(*)
         FROM attendance a JOIN session s ON s.id = a.session_id
         WHERE a.student_id = ?1 AND s.date LIKE ?2",
        params![student_id, format!("{}%", month_prefix)],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

pub fn build_row(conn: &Connection, s: Student, balance: f64, rule: &crate::core::hours::HoursRule) -> AppResult<StudentRow> {
    let month = today_str()[..7].to_string();
    let (att, tot) = month_attendance(conn, &s.id, &month)?;
    let last: Option<String> = conn
        .query_row(
            "SELECT MAX(se.date) FROM attendance a JOIN session se ON se.id = a.session_id
             WHERE a.student_id = ?1 AND a.status IN ('present','late')",
            params![s.id],
            |r| r.get(0),
        )
        .unwrap_or(None);
    let unit = repo::owed_unit_price_for(conn, &s.id, rule)?;
    let owed_cents = if balance < 0.0 && !s.is_free() { ((-balance) * unit as f64).round() as i64 } else { 0 };
    let is_new = s.enrolled_on.starts_with(&month);
    Ok(StudentRow {
        classes: classes_of(conn, &s.id)?,
        balance,
        month_attended: att,
        month_total: tot,
        last_session_date: last,
        owed_cents,
        owed_unit_price_cents: unit,
        is_new_this_month: is_new,
        student: s,
    })
}

/// filter: all | owed | low | new | paused | left
#[tauri::command]
pub fn list_students(db: State<Db>, filter: Option<String>, query: Option<String>) -> AppResult<StudentList> {
    let conn = lock(&db);
    let all = settings::load(&conn);
    let rule = &all.hours_rule;
    let threshold = all.alerts.low_balance_threshold;
    let balances = repo::balances(&conn)?;
    let mut st = conn.prepare("SELECT * FROM student ORDER BY name")?;
    let students = st.query_map([], Student::from_row)?.collect::<Result<Vec<_>, _>>()?;

    let mut rows = Vec::new();
    let mut stats = StudentListStats {
        active_count: 0,
        owed_count: 0,
        low_count: 0,
        new_count: 0,
        paused_count: 0,
        low_balance_threshold: threshold,
    };
    let q = query.unwrap_or_default().trim().to_lowercase();
    let filter = filter.unwrap_or_else(|| "all".into());
    for s in students {
        let bal = *balances.get(&s.id).unwrap_or(&0.0);
        let row = build_row(&conn, s, bal, rule)?;
        match row.student.status.as_str() {
            "active" => {
                stats.active_count += 1;
                if row.student.is_free() {
                    // 免费学员不进欠费 / 余额不足统计
                } else if bal < 0.0 {
                    stats.owed_count += 1;
                } else if bal <= threshold {
                    stats.low_count += 1;
                }
                if row.is_new_this_month {
                    stats.new_count += 1;
                }
            }
            "paused" => stats.paused_count += 1,
            _ => {}
        }
        let keep = match filter.as_str() {
            "owed" => row.student.status == "active" && !row.student.is_free() && bal < 0.0,
            "low" => row.student.status == "active" && !row.student.is_free() && bal >= 0.0 && bal <= threshold,
            "new" => row.student.status == "active" && row.is_new_this_month,
            "paused" => row.student.status == "paused",
            "left" => row.student.status == "left",
            _ => row.student.status == "active",
        };
        if !keep {
            continue;
        }
        if !q.is_empty() {
            let hay = format!(
                "{} {} {}",
                row.student.name.to_lowercase(),
                row.student.en_name.clone().unwrap_or_default().to_lowercase(),
                row.student.phone.clone().unwrap_or_default()
            );
            if !hay.contains(&q) {
                continue;
            }
        }
        rows.push(row);
    }
    rows.sort_by(|a, b| a.balance.partial_cmp(&b.balance).unwrap().then(a.student.name.cmp(&b.student.name)));
    Ok(StudentList { rows, stats })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackageView {
    #[serde(flatten)]
    pub package: Package,
    pub used: f64,
    pub remaining: f64,
    pub reversed: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StudentDetail {
    #[serde(flatten)]
    pub row: StudentRow,
    pub total_consumed: f64,
    pub total_recharged: f64,
    pub total_paid_cents: i64,
    pub packages: Vec<PackageView>,
    pub ledger: Vec<LedgerView>,
    pub ledger_total: i64,
    pub owed_text: String,
    pub undo_window_days: i64,
}

fn package_views(conn: &Connection, student_id: &str) -> AppResult<Vec<PackageView>> {
    let pks = repo::packages(conn, student_id)?;
    let mut out = Vec::new();
    for p in pks {
        let used: f64 = conn.query_row(
            "SELECT COALESCE(SUM(-delta), 0) FROM ledger_entry WHERE package_id = ?1 AND type = 'consume'",
            params![p.id],
            |r| r.get(0),
        )?;
        let reversed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM ledger_entry r JOIN ledger_entry rev ON rev.reverses_id = r.id
             WHERE r.package_id = ?1 AND r.type = 'recharge'",
            params![p.id],
            |r| r.get(0),
        )?;
        out.push(PackageView { remaining: p.sessions as f64 - used, used, reversed: reversed > 0, package: p });
    }
    Ok(out)
}

pub fn ledger_page(conn: &Connection, student_id: &str, page: i64, page_size: i64) -> AppResult<(Vec<LedgerView>, i64)> {
    let rule = settings::hours_rule(conn);
    let win = repo::undo_window_ms(&rule);
    let now = now_ms();
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM ledger_entry WHERE student_id = ?1", params![student_id], |r| r.get(0))?;
    let sql = format!("{} WHERE l.student_id = ?1 ORDER BY l.occurred_at DESC, l.created_at DESC LIMIT ?2 OFFSET ?3", repo::LEDGER_VIEW_SQL);
    let mut st = conn.prepare(&sql)?;
    let rows = st
        .query_map(params![student_id, page_size, page * page_size], |r| repo::ledger_view_from_row(r, win, now))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok((rows, total))
}

#[tauri::command]
pub fn get_student(db: State<Db>, id: String, page: Option<i64>, page_size: Option<i64>) -> AppResult<StudentDetail> {
    let conn = lock(&db);
    let rule = settings::hours_rule(&conn);
    let s = repo::student(&conn, &id)?;
    let bal = repo::balance(&conn, &id)?;
    let row = build_row(&conn, s, bal, &rule)?;
    let total_consumed: f64 = conn.query_row(
        "SELECT COALESCE(SUM(-delta), 0) FROM ledger_entry WHERE student_id = ?1 AND type = 'consume'",
        params![id],
        |r| r.get(0),
    )?;
    let (total_recharged, total_paid): (f64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(delta), 0), COALESCE(SUM(amount_cents), 0) FROM ledger_entry WHERE student_id = ?1 AND type = 'recharge'",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let packages = package_views(&conn, &id)?;
    let (ledger, ledger_total) = ledger_page(&conn, &id, page.unwrap_or(0), page_size.unwrap_or(50))?;
    let owed_text = if bal < 0.0 {
        format!("已欠 {} 课时 · 应补 {}", crate::core::recharge::trim_num(-bal), fmt_yuan(row.owed_cents))
    } else {
        String::new()
    };
    Ok(StudentDetail {
        row,
        total_consumed,
        total_recharged,
        total_paid_cents: total_paid,
        packages,
        ledger,
        ledger_total,
        owed_text,
        undo_window_days: rule.undo_window_days,
    })
}

#[tauri::command]
pub fn list_student_ledger(db: State<Db>, id: String, page: i64, page_size: i64) -> AppResult<Vec<LedgerView>> {
    let conn = lock(&db);
    Ok(ledger_page(&conn, &id, page, page_size)?.0)
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StudentInput {
    pub name: String,
    pub en_name: Option<String>,
    pub status: Option<String>,
    pub enrolled_on: Option<String>,
    pub guardian_name: Option<String>,
    pub phone: Option<String>,
    pub note: Option<String>,
    /// 新建时可直接加入的班级
    pub class_ids: Option<Vec<String>>,
    /// paid | free
    pub billing: Option<String>,
}

fn billing_of(v: Option<&str>) -> &'static str {
    if v == Some("free") { "free" } else { "paid" }
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|x| x.trim().to_string()).filter(|x| !x.is_empty())
}

#[tauri::command]
pub fn create_student(db: State<Db>, input: StudentInput) -> AppResult<Student> {
    let mut conn = lock(&db);
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::rule("姓名不能为空"));
    }
    let id = new_id();
    let now = now_ms();
    let enrolled_on = clean(input.enrolled_on).unwrap_or_else(today_str);
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO student(id, name, en_name, status, enrolled_on, guardian_name, phone, note, billing, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, name, clean(input.en_name), enrolled_on, clean(input.guardian_name), clean(input.phone), clean(input.note), billing_of(input.billing.as_deref()), now],
    )?;
    for cid in input.class_ids.unwrap_or_default() {
        tx.execute(
            "INSERT INTO enrollment(id, student_id, class_id, joined_on, left_on, created_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
            params![new_id(), id, cid, enrolled_on, now],
        )?;
    }
    tx.commit()?;
    repo::student(&conn, &id)
}

#[tauri::command]
pub fn update_student(db: State<Db>, id: String, input: StudentInput) -> AppResult<Student> {
    let conn = lock(&db);
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::rule("姓名不能为空"));
    }
    let cur = repo::student(&conn, &id)?;
    let status = input.status.unwrap_or(cur.status);
    if !["active", "paused", "left"].contains(&status.as_str()) {
        return Err(AppError::rule("无效的学生状态"));
    }
    conn.execute(
        "UPDATE student SET name = ?2, en_name = ?3, status = ?4, enrolled_on = ?5, guardian_name = ?6, phone = ?7, note = ?8, updated_at = ?9, billing = ?10 WHERE id = ?1",
        params![
            id,
            name,
            clean(input.en_name),
            status,
            clean(input.enrolled_on).unwrap_or(cur.enrolled_on),
            clean(input.guardian_name),
            clean(input.phone),
            clean(input.note),
            now_ms(),
            billing_of(input.billing.as_deref().or(Some(cur.billing.as_str())))
        ],
    )?;
    if status == "left" {
        // 退班：结束所有在班关系
        conn.execute(
            "UPDATE enrollment SET left_on = ?2 WHERE student_id = ?1 AND left_on IS NULL",
            params![id, fmt_date(today())],
        )?;
    }
    repo::student(&conn, &id)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PickStudent {
    pub id: String,
    pub name: String,
    pub en_name: Option<String>,
    pub balance: f64,
    pub class_names: String,
}

/// 「临时加人」/「加入班级」候选：不在指定班级的在读学生
#[tauri::command]
pub fn list_students_for_pick(db: State<Db>, exclude_class_id: Option<String>) -> AppResult<Vec<PickStudent>> {
    let conn = lock(&db);
    let balances = repo::balances(&conn)?;
    let mut st = conn.prepare(
        "SELECT s.id, s.name, s.en_name,
                (SELECT GROUP_CONCAT(k.name, ' / ') FROM enrollment e JOIN klass k ON k.id = e.class_id WHERE e.student_id = s.id AND e.left_on IS NULL) AS cls
         FROM student s
         WHERE s.status = 'active'
           AND NOT EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id = s.id AND e.left_on IS NULL AND e.class_id = ?1)
         ORDER BY s.name",
    )?;
    let rows = st
        .query_map(params![exclude_class_id.unwrap_or_default()], |r| {
            let id: String = r.get(0)?;
            Ok(PickStudent {
                balance: *balances.get(&id).unwrap_or(&0.0),
                id,
                name: r.get(1)?,
                en_name: r.get(2)?,
                class_names: r.get::<_, Option<String>>(3)?.unwrap_or_default(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
