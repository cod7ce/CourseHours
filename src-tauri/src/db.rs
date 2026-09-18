use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{Local, NaiveDate};
use rusqlite::{params, Connection};

use crate::error::AppResult;

pub struct Db {
    pub conn: Mutex<Connection>,
    pub path: PathBuf,
    pub data_dir: PathBuf,
}

const MIGRATIONS: &[(&str, &str)] = &[("001_init", include_str!("../migrations/001_init.sql"))];

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;")?;
    migrate(&conn)?;
    crate::settings::seed_defaults(&conn)?;
    Ok(conn)
}

#[allow(dead_code)]
pub fn open_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    migrate(&conn)?;
    crate::settings::seed_defaults(&conn)?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);",
    )?;
    for (name, sql) in MIGRATIONS {
        let done: i64 = conn.query_row("SELECT COUNT(*) FROM _migrations WHERE name = ?1", params![name], |r| r.get(0))?;
        if done == 0 {
            conn.execute_batch(&format!("BEGIN; {} COMMIT;", sql))?;
            conn.execute("INSERT INTO _migrations(name, applied_at) VALUES (?1, ?2)", params![name, now_ms()])?;
        }
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn today() -> NaiveDate {
    Local::now().date_naive()
}

pub fn today_str() -> String {
    today().format("%Y-%m-%d").to_string()
}

pub fn parse_date(s: &str) -> AppResult<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| crate::error::AppError::rule(format!("日期格式错误：{}", s)))
}

pub fn fmt_date(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// 'YYYY-MM' → (首日, 末日)
pub fn month_bounds(month: &str) -> AppResult<(NaiveDate, NaiveDate)> {
    let first = parse_date(&format!("{}-01", month))?;
    let next = if first.format("%m").to_string() == "12" {
        NaiveDate::from_ymd_opt(first.format("%Y").to_string().parse::<i32>().unwrap() + 1, 1, 1).unwrap()
    } else {
        NaiveDate::from_ymd_opt(
            first.format("%Y").to_string().parse::<i32>().unwrap(),
            first.format("%m").to_string().parse::<u32>().unwrap() + 1,
            1,
        )
        .unwrap()
    };
    Ok((first, next - chrono::Duration::days(1)))
}

/// 本地日期 00:00 的 unix 毫秒
pub fn date_start_ms(d: NaiveDate) -> i64 {
    use chrono::TimeZone;
    let dt = d.and_hms_opt(0, 0, 0).unwrap();
    Local.from_local_datetime(&dt).single().map(|x| x.timestamp_millis()).unwrap_or(0)
}

/// 本地日期次日 00:00 的 unix 毫秒（区间右开）
pub fn date_end_ms(d: NaiveDate) -> i64 {
    date_start_ms(d + chrono::Duration::days(1))
}

pub fn ms_to_date(ms: i64) -> NaiveDate {
    use chrono::TimeZone;
    Local.timestamp_millis_opt(ms).single().map(|x| x.date_naive()).unwrap_or_else(today)
}
