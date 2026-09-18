pub mod classes;
pub mod data;
pub mod ledger;
pub mod recharge;
pub mod reports;
pub mod rollcall;
pub mod scheduling;
pub mod settings;
pub mod startup;
pub mod students;
pub mod today;
pub mod updater;

use crate::db::Db;
use std::sync::MutexGuard;

pub fn lock(db: &Db) -> MutexGuard<'_, rusqlite::Connection> {
    db.conn.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn handler() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        settings::get_settings,
        settings::save_settings,
        students::list_students,
        students::get_student,
        students::create_student,
        students::update_student,
        students::list_student_ledger,
        students::list_students_for_pick,
        classes::list_classes,
        classes::get_class,
        classes::create_class,
        classes::update_class,
        classes::end_class,
        classes::enroll_student,
        classes::unenroll_student,
        classes::set_class_schedule,
        scheduling::list_rules,
        scheduling::save_rule,
        scheduling::set_rule_active,
        scheduling::preview_generate,
        scheduling::generate_sessions,
        scheduling::list_sessions,
        scheduling::cancel_session,
        scheduling::delete_session,
        scheduling::add_extra_session,
        scheduling::update_session,
        scheduling::recent_adjustments,
        rollcall::get_rollcall,
        rollcall::confirm_rollcall,
        rollcall::undo_rollcall,
        rollcall::undo_entry,
        rollcall::manual_adjust,
        recharge::preview_recharge,
        recharge::recharge,
        ledger::list_ledger,
        ledger::export_ledger_csv,
        reports::get_report,
        reports::export_report_csv,
        today::get_today,
        today::get_nav_stats,
        today::global_search,
        data::get_data_info,
        data::backup_now,
        data::list_backups,
        data::restore_backup,
        data::clear_all_data,
        data::save_text_file,
        data::export_database,
        data::check_invariants,
        updater::get_app_version,
        updater::check_update,
        updater::install_update,
    ]
}
