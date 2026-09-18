use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::recharge::{plan_recharge, OwedMode, RechargePlan};
use crate::db::{new_id, now_ms, parse_date, today_str, Db};
use crate::error::{AppError, AppResult};
use crate::models::Package;
use crate::repo::{self, NewEntry};
use crate::settings;

use super::lock;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RechargeInput {
    pub student_id: String,
    pub sessions: i64,
    pub amount_cents: i64,
    pub purchased_on: Option<String>,
    pub method: Option<String>,
    pub mode: Option<OwedMode>,
    pub note: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RechargePreview {
    pub balance: f64,
    pub owed_hours: f64,
    pub owed_unit_price_cents: i64,
    pub owed_cents: i64,
    pub auto_offset: bool,
    pub plan: RechargePlan,
}

fn resolve_mode(input_mode: Option<OwedMode>, rule: &crate::core::hours::HoursRule) -> OwedMode {
    input_mode.unwrap_or(if rule.auto_offset_on_recharge { OwedMode::Offset } else { OwedMode::Cash })
}

#[tauri::command]
pub fn preview_recharge(db: State<Db>, input: RechargeInput) -> AppResult<RechargePreview> {
    let conn = lock(&db);
    let rule = settings::hours_rule(&conn);
    let bal = repo::balance(&conn, &input.student_id)?;
    let unit = repo::owed_unit_price_for(&conn, &input.student_id, &rule)?;
    let owed = if bal < 0.0 { -bal } else { 0.0 };
    let mode = resolve_mode(input.mode, &rule);
    let plan = plan_recharge(bal, input.sessions.max(1), input.amount_cents.max(1), mode, unit).map_err(AppError::Rule)?;
    Ok(RechargePreview {
        balance: bal,
        owed_hours: owed,
        owed_unit_price_cents: unit,
        owed_cents: (owed * unit as f64).round() as i64,
        auto_offset: rule.auto_offset_on_recharge,
        plan,
    })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RechargeResult {
    pub package: Package,
    pub plan: RechargePlan,
}

/// R3 充值事务
#[tauri::command]
pub fn recharge(db: State<Db>, input: RechargeInput) -> AppResult<RechargeResult> {
    let mut conn = lock(&db);
    recharge_inner(&mut conn, input)
}

pub fn recharge_inner(conn: &mut rusqlite::Connection, input: RechargeInput) -> AppResult<RechargeResult> {
    let rule = settings::hours_rule(conn);
    let purchased_on = input.purchased_on.clone().filter(|x| !x.is_empty()).unwrap_or_else(today_str);
    parse_date(&purchased_on)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    repo::student(&tx, &input.student_id)?;
    let bal = repo::balance(&tx, &input.student_id)?;
    let unit_owed = repo::owed_unit_price_for(&tx, &input.student_id, &rule)?;
    let mode = resolve_mode(input.mode, &rule);
    let plan = plan_recharge(bal, input.sessions, input.amount_cents, mode, unit_owed).map_err(AppError::Rule)?;
    let now = now_ms();
    // 业务发生时刻：补登历史充值时按购买日期归集（当天则用当前时刻）
    let occurred_at = if purchased_on == today_str() { now } else { crate::db::date_start_ms(parse_date(&purchased_on)?) + 12 * 3600 * 1000 };
    let pkg_id = new_id();
    tx.execute(
        "INSERT INTO package(id, student_id, sessions, amount_cents, unit_price_cents, purchased_on, method, offset_sessions, note, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            pkg_id,
            input.student_id,
            input.sessions,
            input.amount_cents,
            plan.unit_price_cents,
            purchased_on,
            input.method.clone().filter(|x| !x.trim().is_empty()),
            plan.offset_sessions,
            input.note.clone().filter(|x| !x.trim().is_empty()),
            now
        ],
    )?;
    for e in &plan.entries {
        repo::insert_ledger(
            &tx,
            NewEntry {
                student_id: &input.student_id,
                occurred_at,
                entry_type: &e.entry_type,
                delta: e.delta,
                balance_after: e.balance_after,
                session_id: None,
                package_id: if e.entry_type == "recharge" { Some(&pkg_id) } else { None },
                amount_cents: Some(e.amount_cents),
                reason: &e.reason,
                reverses_id: None,
            },
        )?;
    }
    tx.commit()?;
    let pkg = conn.query_row("SELECT * FROM package WHERE id = ?1", [&pkg_id], Package::from_row)?;
    Ok(RechargeResult { package: pkg, plan })
}

