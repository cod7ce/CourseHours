use std::path::PathBuf;

use chrono::Local;
use rusqlite::params;
use serde::Serialize;
use tauri::State;

use crate::db::{self, Db};
use crate::error::{AppError, AppResult};
use crate::settings;

use super::lock;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DataInfo {
    pub db_path: String,
    pub db_size_bytes: u64,
    pub backup_dir: String,
    pub students: i64,
    pub classes: i64,
    pub sessions: i64,
    pub ledger_entries: i64,
    pub last_backup_at: Option<i64>,
    pub backup_count: i64,
    pub backup_total_bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub created_at: i64,
}

fn backup_dir(db: &Db) -> PathBuf {
    db.data_dir.join("backups")
}

pub fn list_backup_files(db: &Db) -> AppResult<Vec<BackupFile>> {
    let dir = backup_dir(db);
    let mut out = Vec::new();
    if dir.exists() {
        for e in std::fs::read_dir(&dir)? {
            let e = e?;
            let p = e.path();
            if p.extension().map(|x| x == "db").unwrap_or(false) {
                let meta = e.metadata()?;
                let created = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
                out.push(BackupFile { path: p.to_string_lossy().to_string(), name: e.file_name().to_string_lossy().to_string(), size_bytes: meta.len(), created_at: created });
            }
        }
    }
    out.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(out)
}

#[tauri::command]
pub fn get_data_info(db: State<Db>) -> AppResult<DataInfo> {
    let conn = lock(&db);
    let count = |t: &str| -> AppResult<i64> { Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {}", t), [], |r| r.get(0))?) };
    let backups = list_backup_files(&db)?;
    Ok(DataInfo {
        db_path: db.path.to_string_lossy().to_string(),
        db_size_bytes: std::fs::metadata(&db.path).map(|m| m.len()).unwrap_or(0),
        backup_dir: backup_dir(&db).to_string_lossy().to_string(),
        students: count("student")?,
        classes: count("klass")?,
        sessions: count("session")?,
        ledger_entries: count("ledger_entry")?,
        last_backup_at: backups.first().map(|b| b.created_at),
        backup_count: backups.len() as i64,
        backup_total_bytes: backups.iter().map(|b| b.size_bytes).sum(),
    })
}

/// VACUUM INTO 一致性快照，并按 keep 清理最旧的
pub fn do_backup(db: &Db) -> AppResult<BackupFile> {
    let dir = backup_dir(db);
    std::fs::create_dir_all(&dir)?;
    let name = format!("{}.db", Local::now().format("%Y-%m-%d-%H%M"));
    let target = dir.join(&name);
    if target.exists() {
        std::fs::remove_file(&target)?;
    }
    let keep = {
        let conn = lock(db);
        conn.execute("VACUUM INTO ?1", params![target.to_string_lossy().to_string()])?;
        settings::load(&conn).backup.keep.max(1) as usize
    };
    let files = list_backup_files(db)?;
    for f in files.iter().skip(keep) {
        let _ = std::fs::remove_file(&f.path);
    }
    let meta = std::fs::metadata(&target)?;
    Ok(BackupFile { path: target.to_string_lossy().to_string(), name, size_bytes: meta.len(), created_at: db::now_ms() })
}

#[tauri::command]
pub fn backup_now(db: State<Db>) -> AppResult<BackupFile> {
    do_backup(&db)
}

#[tauri::command]
pub fn list_backups(db: State<Db>) -> AppResult<Vec<BackupFile>> {
    list_backup_files(&db)
}

/// 从备份恢复：先把当前库备份一份，再用备份文件的内容覆盖当前连接
#[tauri::command]
pub fn restore_backup(db: State<Db>, path: String) -> AppResult<()> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(AppError::rule("备份文件不存在"));
    }
    // 校验是合法的 SQLite 库
    {
        let test = rusqlite::Connection::open_with_flags(&src, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let n: i64 = test.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'ledger_entry'", [], |r| r.get(0))?;
        if n == 0 {
            return Err(AppError::rule("这不是本应用的备份文件"));
        }
    }
    do_backup(&db)?;
    let mut conn = lock(&db);
    // 用 backup API 把备份内容拷进当前连接
    let src_conn = rusqlite::Connection::open_with_flags(&src, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    {
        let backup = rusqlite::backup::Backup::new(&src_conn, &mut conn)?;
        backup.run_to_completion(100, std::time::Duration::from_millis(5), None)?;
    }
    db::migrate(&conn)?;
    settings::seed_defaults(&conn)?;
    Ok(())
}

/// 清空全部业务数据（保留设置）。先自动备份。
#[tauri::command]
pub fn clear_all_data(db: State<Db>) -> AppResult<()> {
    do_backup(&db)?;
    let conn = lock(&db);
    conn.execute_batch(
        "BEGIN;
         DELETE FROM ledger_entry; DELETE FROM attendance; DELETE FROM package; DELETE FROM session;
         DELETE FROM recurrence_rule; DELETE FROM enrollment; DELETE FROM student; DELETE FROM klass;
         COMMIT;",
    )?;
    Ok(())
}

#[tauri::command]
pub fn save_text_file(path: String, content: String) -> AppResult<()> {
    std::fs::write(path, content)?;
    Ok(())
}

/// 导出整个数据库到用户选的位置
#[tauri::command]
pub fn export_database(db: State<Db>, path: String) -> AppResult<()> {
    let conn = lock(&db);
    if std::path::Path::new(&path).exists() {
        std::fs::remove_file(&path)?;
    }
    conn.execute("VACUUM INTO ?1", params![path])?;
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct InvariantReport {
    pub ok: bool,
    pub problems: Vec<String>,
    pub students_checked: i64,
}

/// 01 文档的不变量全表校验
#[tauri::command]
pub fn check_invariants(db: State<Db>) -> AppResult<InvariantReport> {
    let conn = lock(&db);
    let mut problems = Vec::new();
    // 1. SUM(delta) == 最后一条 balance_after
    let mut st = conn.prepare(
        "SELECT s.id, s.name, COALESCE((SELECT SUM(delta) FROM ledger_entry WHERE student_id = s.id), 0),
                (SELECT balance_after FROM ledger_entry WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1)
         FROM student s",
    )?;
    let mut n = 0;
    for r in st.query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, f64>(2)?, r.get::<_, Option<f64>>(3)?)))? {
        let (name, sum, last) = r?;
        n += 1;
        if let Some(last) = last {
            if (sum - last).abs() > 1e-6 {
                problems.push(format!("{}：SUM(delta)={} 与最后一条 balance_after={} 不一致", name, sum, last));
            }
        }
    }
    let checks: [(&str, &str); 6] = [
        ("consume 分录缺 session_id", "SELECT COUNT(*) FROM ledger_entry WHERE type='consume' AND session_id IS NULL"),
        ("recharge 分录缺 package_id 或 delta != sessions", "SELECT COUNT(*) FROM ledger_entry l LEFT JOIN package p ON p.id = l.package_id WHERE l.type='recharge' AND (p.id IS NULL OR l.delta != p.sessions)"),
        ("package.unit_price 不等于 ROUND(amount/sessions)", "SELECT COUNT(*) FROM package WHERE unit_price_cents != CAST(ROUND(amount_cents * 1.0 / sessions) AS INTEGER)"),
        ("已取消课次仍有点名记录", "SELECT COUNT(*) FROM attendance a JOIN session s ON s.id = a.session_id WHERE s.status='cancelled'"),
        ("已取消课次仍有 consume 分录", "SELECT COUNT(*) FROM ledger_entry l JOIN session s ON s.id = l.session_id WHERE s.status='cancelled' AND l.type='consume'"),
        ("adjust 的 reverses_id 指向不存在的分录", "SELECT COUNT(*) FROM ledger_entry l WHERE l.reverses_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ledger_entry o WHERE o.id = l.reverses_id)"),
    ];
    for (label, sql) in checks {
        let c: i64 = conn.query_row(sql, [], |r| r.get(0))?;
        if c > 0 {
            problems.push(format!("{}：{} 条", label, c));
        }
    }
    Ok(InvariantReport { ok: problems.is_empty(), problems, students_checked: n })
}
