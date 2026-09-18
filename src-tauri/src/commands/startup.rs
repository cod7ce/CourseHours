use chrono::{Datelike, Local, Timelike};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::db::{today, Db};
use crate::settings;

use super::lock;

/// 启动时：自动排课（每周一次，始终提前 lead_weeks 周）
pub fn run_startup_tasks(db: &Db) {
    let (auto, lead, last) = {
        let conn = lock(db);
        let s = settings::load(&conn).scheduling;
        (s.auto_generate, s.lead_weeks, s.last_generated_at)
    };
    if !auto {
        return;
    }
    let need = match last {
        None => true,
        Some(ms) => {
            let last_date = crate::db::ms_to_date(ms);
            let (mon, _) = crate::core::scheduling::week_bounds(today());
            last_date < mon
        }
    };
    if need {
        let mut conn = lock(db);
        let from = today();
        let _ = super::scheduling::generate_inner(&mut conn, from, lead.max(1));
    }
}

/// 后台定时器：每分钟检查一次自动备份与每日推送
pub fn spawn_scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_backup_day: Option<i64> = None;
        let mut last_digest_day: Option<i64> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
            let db = app.state::<Db>();
            let (backup, alerts) = {
                let conn = lock(&db);
                let s = settings::load(&conn);
                (s.backup, s.alerts)
            };
            let now = Local::now();
            let hhmm = format!("{:02}:{:02}", now.hour(), now.minute());
            let day = now.ordinal() as i64 + now.year() as i64 * 1000;
            if backup.auto && hhmm >= backup.at && last_backup_day != Some(day) {
                // 今天还没自动备份且到了时间
                let already = super::data::list_backup_files(&db)
                    .map(|f| f.iter().any(|b| b.name.starts_with(&now.format("%Y-%m-%d").to_string())))
                    .unwrap_or(false);
                if !already {
                    let _ = super::data::do_backup(&db);
                }
                last_backup_day = Some(day);
            }
            if alerts.daily_digest && hhmm >= alerts.daily_digest_at && last_digest_day != Some(day) {
                last_digest_day = Some(day);
                if alerts.channels.iter().any(|c| c == "desktop") {
                    let body = {
                        let conn = lock(&db);
                        digest_text(&conn)
                    };
                    let _ = app.notification().builder().title("今日课程").body(body).show();
                }
            }
        }
    });
}

fn digest_text(conn: &rusqlite::Connection) -> String {
    let t = crate::db::today_str();
    let mut st = match conn.prepare(
        "SELECT s.start_time, k.name FROM session s JOIN klass k ON k.id = s.class_id WHERE s.date = ?1 AND s.status != 'cancelled' ORDER BY s.start_time",
    ) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let rows: Vec<(String, String)> = st
        .query_map([t], |r| Ok((r.get(0)?, r.get(1)?)))
        .map(|it| it.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();
    let (alerts, count) = super::today::alerts(conn, 1).unwrap_or((vec![], 0));
    let owed = alerts.iter().filter(|a| a.balance < 0.0).count();
    let mut s = if rows.is_empty() {
        "今天没有排课。".to_string()
    } else {
        format!("今天 {} 节课，第一节 {} {}。", rows.len(), rows[0].0, rows[0].1)
    };
    if count > 0 {
        s.push_str(&format!("{} 人余额不足", count));
        if owed > 0 {
            s.push_str(&format!("，{} 人已欠课时", owed));
        }
        s.push('。');
    }
    s
}
