//! 跨命令复用的查询与写入。所有余额都从流水推导。

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::core::hours::HoursRule;
use crate::core::packages::{owed_unit_price, PackageState};
use crate::db::{new_id, now_ms};
use crate::error::{AppError, AppResult};
use crate::models::{Klass, LedgerEntry, LedgerView, Package, Session, Student};

pub fn balance(conn: &Connection, student_id: &str) -> AppResult<f64> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(delta), 0) FROM ledger_entry WHERE student_id = ?1",
        params![student_id],
        |r| r.get(0),
    )?)
}

pub fn balances(conn: &Connection) -> AppResult<HashMap<String, f64>> {
    let mut st = conn.prepare("SELECT student_id, SUM(delta) FROM ledger_entry GROUP BY student_id")?;
    let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
    let mut m = HashMap::new();
    for r in rows {
        let (k, v) = r?;
        m.insert(k, v);
    }
    Ok(m)
}

pub fn student(conn: &Connection, id: &str) -> AppResult<Student> {
    conn.query_row("SELECT * FROM student WHERE id = ?1", params![id], Student::from_row)
        .optional()?
        .ok_or_else(|| AppError::rule("学生不存在"))
}

pub fn klass(conn: &Connection, id: &str) -> AppResult<Klass> {
    conn.query_row("SELECT * FROM klass WHERE id = ?1", params![id], Klass::from_row)
        .optional()?
        .ok_or_else(|| AppError::rule("班级不存在"))
}

pub fn session(conn: &Connection, id: &str) -> AppResult<Session> {
    conn.query_row("SELECT * FROM session WHERE id = ?1", params![id], Session::from_row)
        .optional()?
        .ok_or_else(|| AppError::rule("课次不存在"))
}

pub fn ledger_entry(conn: &Connection, id: &str) -> AppResult<LedgerEntry> {
    conn.query_row("SELECT * FROM ledger_entry WHERE id = ?1", params![id], LedgerEntry::from_row)
        .optional()?
        .ok_or_else(|| AppError::rule("流水不存在"))
}

pub fn is_reversed(conn: &Connection, entry_id: &str) -> AppResult<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM ledger_entry WHERE reverses_id = ?1",
        params![entry_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 学生的课包及消耗状态，按 FIFO 顺序。被撤销的充值对应的课包不参与。
pub fn package_states(conn: &Connection, student_id: &str) -> AppResult<Vec<PackageState>> {
    let mut st = conn.prepare(
        "SELECT p.id, p.sessions, p.unit_price_cents,
                COALESCE((SELECT SUM(-l.delta) FROM ledger_entry l WHERE l.package_id = p.id AND l.type = 'consume'), 0) AS used
         FROM package p
         WHERE p.student_id = ?1
           AND NOT EXISTS (
             SELECT 1 FROM ledger_entry r JOIN ledger_entry rev ON rev.reverses_id = r.id
             WHERE r.package_id = p.id AND r.type = 'recharge')
         ORDER BY p.purchased_on ASC, p.created_at ASC",
    )?;
    let rows = st.query_map(params![student_id], |r| {
        Ok(PackageState {
            id: r.get(0)?,
            sessions: r.get(1)?,
            unit_price_cents: r.get(2)?,
            used: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn packages(conn: &Connection, student_id: &str) -> AppResult<Vec<Package>> {
    let mut st = conn.prepare("SELECT * FROM package WHERE student_id = ?1 ORDER BY purchased_on DESC, created_at DESC")?;
    let rows = st.query_map(params![student_id], Package::from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 欠课时折算单价（分）
pub fn owed_unit_price_for(conn: &Connection, student_id: &str, rule: &HoursRule) -> AppResult<i64> {
    let pk = package_states(conn, student_id)?;
    Ok(owed_unit_price(&pk, &rule.owed_price_mode))
}

/// 某天在班的学生（left_on 为空或晚于该日期）
pub fn enrolled_students(conn: &Connection, class_id: &str, on_date: &str) -> AppResult<Vec<Student>> {
    let mut st = conn.prepare(
        "SELECT s.* FROM enrollment e JOIN student s ON s.id = e.student_id
         WHERE e.class_id = ?1 AND e.joined_on <= ?2 AND (e.left_on IS NULL OR e.left_on >= ?2)
         ORDER BY e.joined_on ASC, s.name ASC",
    )?;
    let rows = st.query_map(params![class_id, on_date], Student::from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn enrolled_count(conn: &Connection, class_id: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM enrollment WHERE class_id = ?1 AND left_on IS NULL",
        params![class_id],
        |r| r.get(0),
    )?)
}

/// 「第 N 次」：该班到这节课为止（按日期+时间）未取消的课次序号
pub fn session_ordinal(conn: &Connection, s: &Session) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM session WHERE class_id = ?1 AND status != 'cancelled'
           AND (date < ?2 OR (date = ?2 AND start_time <= ?3))",
        params![s.class_id, s.date, s.start_time],
        |r| r.get(0),
    )?)
}

pub struct NewEntry<'a> {
    pub student_id: &'a str,
    pub occurred_at: i64,
    pub entry_type: &'a str,
    pub delta: f64,
    pub balance_after: f64,
    pub session_id: Option<&'a str>,
    pub package_id: Option<&'a str>,
    pub amount_cents: Option<i64>,
    pub reason: &'a str,
    pub reverses_id: Option<&'a str>,
}

/// 账本只 INSERT
pub fn insert_ledger(conn: &Connection, e: NewEntry) -> AppResult<String> {
    let id = new_id();
    // created_at 严格递增，保证同一毫秒内写入的多条分录有确定顺序
    let max_created: i64 = conn
        .query_row("SELECT COALESCE(MAX(created_at), 0) FROM ledger_entry", [], |r| r.get(0))
        .unwrap_or(0);
    let created_at = now_ms().max(max_created + 1);
    conn.execute(
        "INSERT INTO ledger_entry(id, student_id, occurred_at, type, delta, balance_after, session_id, package_id, amount_cents, reason, reverses_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            id,
            e.student_id,
            e.occurred_at,
            e.entry_type,
            e.delta,
            e.balance_after,
            e.session_id,
            e.package_id,
            e.amount_cents,
            e.reason,
            e.reverses_id,
            created_at
        ],
    )?;
    Ok(id)
}

/// 流水视图的 SELECT 主体；调用方拼 WHERE / ORDER / LIMIT
pub const LEDGER_VIEW_SQL: &str = "
    SELECT l.*, s.name AS student_name,
           COALESCE(k.id, ek.id) AS class_id, COALESCE(k.name, ek.name) AS class_name, COALESCE(k.color, ek.color) AS class_color,
           se.date AS session_date, se.start_time AS session_start,
           a.status AS attendance_status,
           p.sessions AS package_sessions, p.offset_sessions AS package_offset, p.unit_price_cents AS package_unit_price,
           EXISTS(SELECT 1 FROM ledger_entry rv WHERE rv.reverses_id = l.id) AS reversed
    FROM ledger_entry l
    JOIN student s ON s.id = l.student_id
    LEFT JOIN session se ON se.id = l.session_id
    LEFT JOIN klass k ON k.id = se.class_id
    LEFT JOIN attendance a ON a.session_id = l.session_id AND a.student_id = l.student_id
    LEFT JOIN package p ON p.id = l.package_id
    LEFT JOIN klass ek ON ek.id = (SELECT e.class_id FROM enrollment e WHERE e.student_id = l.student_id AND e.left_on IS NULL ORDER BY e.joined_on LIMIT 1)
";

pub fn ledger_view_from_row(r: &rusqlite::Row, undo_window_ms: i64, now: i64) -> rusqlite::Result<LedgerView> {
    let entry = LedgerEntry::from_row(r)?;
    let reversed: bool = r.get::<_, i64>("reversed")? != 0;
    let undoable = !reversed
        && (entry.entry_type == "consume" || entry.entry_type == "recharge")
        && now - entry.occurred_at <= undo_window_ms;
    Ok(LedgerView {
        entry,
        student_name: r.get("student_name")?,
        class_id: r.get("class_id")?,
        class_name: r.get("class_name")?,
        class_color: r.get("class_color")?,
        session_date: r.get("session_date")?,
        session_start: r.get("session_start")?,
        attendance_status: r.get("attendance_status")?,
        package_sessions: r.get("package_sessions")?,
        package_offset: r.get("package_offset")?,
        package_unit_price: r.get("package_unit_price")?,
        reversed,
        undoable,
    })
}

pub fn undo_window_ms(rule: &HoursRule) -> i64 {
    rule.undo_window_days * 24 * 3600 * 1000
}
