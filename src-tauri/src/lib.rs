mod commands;
mod core;
mod db;
mod error;
mod models;
mod repo;
mod settings;
#[cfg(debug_assertions)]
mod seed;
#[cfg(test)]
mod tests;

use std::sync::Mutex;

use tauri::Manager;

pub use db::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let path = data_dir.join("data.db");
            let conn = db::open(&path).map_err(|e| std::io::Error::other(e.to_string()))?;
            #[cfg(debug_assertions)]
            let conn = {
                let mut c = conn;
                seed::seed_if_requested(&mut c);
                c
            };
            let db = Db { conn: Mutex::new(conn), path, data_dir };
            // 启动时的自动排课 / 自动备份
            commands::startup::run_startup_tasks(&db);
            app.manage(db);
            commands::startup::spawn_scheduler(app.handle().clone());
            #[cfg(debug_assertions)]
            seed::spawn_dev_bridge(app.handle().clone());
            Ok(())
        })
        .invoke_handler(commands::handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
