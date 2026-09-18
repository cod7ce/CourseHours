use tauri::State;

use crate::db::Db;
use crate::error::AppResult;
use crate::settings::{self, AllSettings};

use super::lock;

#[tauri::command]
pub fn get_settings(db: State<Db>) -> AppResult<AllSettings> {
    let conn = lock(&db);
    Ok(settings::load(&conn))
}

#[tauri::command]
pub fn save_settings(db: State<Db>, settings_value: AllSettings) -> AppResult<AllSettings> {
    let conn = lock(&db);
    let mut s = settings_value;
    // 校验范围
    for v in [s.hours_rule.present, s.hours_rule.late, s.hours_rule.leave, s.hours_rule.absent] {
        if !(0.0..=4.0).contains(&v) {
            return Err(crate::error::AppError::rule("扣课时数须在 0–4 之间"));
        }
    }
    if s.hours_rule.undo_window_days < 0 {
        s.hours_rule.undo_window_days = 0;
    }
    if s.scheduling.lead_weeks < 1 {
        s.scheduling.lead_weeks = 1;
    }
    if s.backup.keep < 1 {
        s.backup.keep = 1;
    }
    if s.defaults.class_capacity < 1 {
        s.defaults.class_capacity = 1;
    }
    settings::save(&conn, &s)?;
    Ok(settings::load(&conn))
}
