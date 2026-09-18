use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::recharge::fmt_yuan;
use crate::db::{date_end_ms, date_start_ms, month_bounds, ms_to_date, now_ms, today_str, Db};
use crate::error::AppResult;
use crate::models::LedgerView;
use crate::repo;
use crate::settings;

use super::lock;

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct LedgerFilter {
    /// YYYY-MM；空 = 全部
    pub month: Option<String>,
    /// all | consume | recharge | noshow | adjust
    pub kind: Option<String>,
    pub class_id: Option<String>,
    pub query: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LedgerSummary {
    pub recharge_hours: f64,
    pub recharge_cents: i64,
    pub recharge_count: i64,
    pub consumed_hours: f64,
    pub consume_cents: i64,
    pub adjust_hours: f64,
    pub adjust_count: i64,
    pub reversal_count: i64,
    pub unconsumed_hours: f64,
    pub owed_hours: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LedgerPage {
    pub rows: Vec<LedgerView>,
    pub total: i64,
    pub summary: LedgerSummary,
}

fn build_where(f: &LedgerFilter) -> AppResult<(String, Vec<Box<dyn rusqlite::ToSql>>)> {
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(m) = f.month.as_deref().filter(|x| !x.is_empty()) {
        let (a, b) = month_bounds(m)?;
        clauses.push("l.occurred_at >= ? AND l.occurred_at < ?".into());
        args.push(Box::new(date_start_ms(a)));
        args.push(Box::new(date_end_ms(b)));
    }
    match f.kind.as_deref().unwrap_or("all") {
        "consume" => clauses.push("l.type = 'consume' AND l.delta != 0".into()),
        "recharge" => clauses.push("l.type = 'recharge'".into()),
        "noshow" => clauses.push("l.type = 'consume' AND l.delta = 0".into()),
        "adjust" => clauses.push("l.type = 'adjust'".into()),
        _ => {}
    }
    if let Some(c) = f.class_id.as_deref().filter(|x| !x.is_empty()) {
        clauses.push(
            "(se.class_id = ? OR (l.session_id IS NULL AND EXISTS (SELECT 1 FROM enrollment e WHERE e.student_id = l.student_id AND e.class_id = ? AND e.left_on IS NULL)))".into(),
        );
        args.push(Box::new(c.to_string()));
        args.push(Box::new(c.to_string()));
    }
    if let Some(q) = f.query.as_deref().map(|x| x.trim()).filter(|x| !x.is_empty()) {
        clauses.push("(s.name LIKE ? OR s.en_name LIKE ?)".into());
        args.push(Box::new(format!("%{}%", q)));
        args.push(Box::new(format!("%{}%", q)));
    }
    let w = if clauses.is_empty() { String::new() } else { format!(" WHERE {}", clauses.join(" AND ")) };
    Ok((w, args))
}

pub fn summary(conn: &Connection, month: Option<&str>) -> AppResult<LedgerSummary> {
    let (lo, hi) = match month.filter(|x| !x.is_empty()) {
        Some(m) => {
            let (a, b) = month_bounds(m)?;
            (date_start_ms(a), date_end_ms(b))
        }
        None => (0, i64::MAX),
    };
    let row = conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN type='recharge' THEN delta END), 0),
            COALESCE(SUM(CASE WHEN type='recharge' THEN amount_cents END), 0),
            COALESCE(SUM(type='recharge'), 0),
            COALESCE(SUM(CASE WHEN type='consume' THEN -delta END), 0),
            COALESCE(SUM(CASE WHEN type='consume' THEN amount_cents END), 0),
            COALESCE(SUM(CASE WHEN type='adjust' THEN delta END), 0),
            COALESCE(SUM(type='adjust'), 0),
            COALESCE(SUM(type='adjust' AND reverses_id IS NOT NULL), 0)
         FROM ledger_entry WHERE occurred_at >= ?1 AND occurred_at < ?2",
        [lo, hi],
        |r| {
            Ok((
                r.get::<_, f64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, f64>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, i64>(7)?,
            ))
        },
    )?;
    // 期末结存：截至区间末的余额
    let (unconsumed, owed): (f64, f64) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN b > 0 THEN b END), 0), COALESCE(SUM(CASE WHEN b < 0 THEN -b END), 0)
         FROM (SELECT SUM(delta) AS b FROM ledger_entry WHERE occurred_at < ?1 GROUP BY student_id)",
        [hi],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(LedgerSummary {
        recharge_hours: row.0,
        recharge_cents: row.1,
        recharge_count: row.2,
        consumed_hours: row.3,
        consume_cents: row.4,
        adjust_hours: row.5,
        adjust_count: row.6,
        reversal_count: row.7,
        unconsumed_hours: unconsumed,
        owed_hours: owed,
    })
}

fn query_rows(conn: &Connection, f: &LedgerFilter, limit: Option<(i64, i64)>) -> AppResult<(Vec<LedgerView>, i64)> {
    let (w, args) = build_where(f)?;
    let count_sql = format!(
        "SELECT COUNT(*) FROM ledger_entry l JOIN student s ON s.id = l.student_id LEFT JOIN session se ON se.id = l.session_id{}",
        w
    );
    let total: i64 = conn.query_row(&count_sql, params_from_iter(args.iter().map(|a| a.as_ref())), |r| r.get(0))?;
    let mut sql = format!("{}{} ORDER BY l.occurred_at DESC, l.created_at DESC", repo::LEDGER_VIEW_SQL, w);
    if let Some((ps, off)) = limit {
        sql.push_str(&format!(" LIMIT {} OFFSET {}", ps, off));
    }
    let rule = settings::hours_rule(conn);
    let win = repo::undo_window_ms(&rule);
    let now = now_ms();
    let mut st = conn.prepare(&sql)?;
    let rows = st
        .query_map(params_from_iter(args.iter().map(|a| a.as_ref())), |r| repo::ledger_view_from_row(r, win, now))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok((rows, total))
}

#[tauri::command]
pub fn list_ledger(db: State<Db>, filter: LedgerFilter) -> AppResult<LedgerPage> {
    let conn = lock(&db);
    let ps = filter.page_size.unwrap_or(10).clamp(1, 500);
    let page = filter.page.unwrap_or(0).max(0);
    let (rows, total) = query_rows(&conn, &filter, Some((ps, page * ps)))?;
    let summary = summary(&conn, filter.month.as_deref())?;
    Ok(LedgerPage { rows, total, summary })
}

pub fn type_label(v: &LedgerView) -> &'static str {
    match v.entry.entry_type.as_str() {
        "recharge" => "充值",
        "adjust" => "调整",
        _ => match v.attendance_status.as_deref() {
            Some("leave") => "请假",
            Some("absent") => "缺勤",
            _ => "消费",
        },
    }
}

fn csv_cell(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

#[tauri::command]
pub fn export_ledger_csv(db: State<Db>, filter: LedgerFilter) -> AppResult<String> {
    let conn = lock(&db);
    let (rows, _) = query_rows(&conn, &filter, None)?;
    let mut out = String::from("\u{FEFF}时间,学生,班级,类型,说明,变动,余额,金额,状态\n");
    for v in rows {
        let t = chrono::DateTime::from_timestamp_millis(v.entry.occurred_at)
            .map(|d| d.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default();
        let cells = [
            t,
            v.student_name.clone(),
            v.class_name.clone().unwrap_or_default(),
            type_label(&v).to_string(),
            v.entry.reason.clone(),
            format!("{}", v.entry.delta),
            format!("{}", v.entry.balance_after),
            v.entry.amount_cents.map(|c| format!("{:.2}", c as f64 / 100.0)).unwrap_or_default(),
            if v.reversed { "已冲正".into() } else { String::new() },
        ];
        out.push_str(&cells.iter().map(|c| csv_cell(c)).collect::<Vec<_>>().join(","));
        out.push('\n');
    }
    Ok(out)
}

#[allow(dead_code)]
pub fn describe_entry(v: &LedgerView) -> String {
    format!("{} {} {}", ms_to_date(v.entry.occurred_at), v.entry.reason, fmt_yuan(v.entry.amount_cents.unwrap_or(0)))
}

#[allow(dead_code)]
fn _t() -> String {
    today_str()
}
