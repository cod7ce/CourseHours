use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::hours::{plan_rollcall, status_label, HoursRule, Mark, StudentBalance};
use crate::core::packages::{consume_amount_cents, owed_unit_price, pick_package};
use crate::core::recharge::trim_num;
use crate::db::{ms_to_date, new_id, now_ms, Db};
use crate::error::{AppError, AppResult};
use crate::models::{Attendance, Klass, LedgerEntry, Session, Student};
use crate::repo::{self, NewEntry};
use crate::settings;

use super::lock;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RollcallStudent {
    #[serde(flatten)]
    pub student: Student,
    pub balance: f64,
    pub owed_cents: i64,
    /// 已点名时的状态
    pub attendance_status: Option<String>,
    pub attendance_hours: Option<f64>,
    /// 是否临时加入（不在班级名册里）
    pub extra: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RollcallView {
    pub session: Session,
    pub klass: Klass,
    pub ordinal: i64,
    pub enrolled: i64,
    pub students: Vec<RollcallStudent>,
    pub rule: HoursRule,
    pub rule_sentence: String,
    pub owed_alert_threshold: f64,
    pub low_balance_threshold: f64,
    pub undoable: bool,
    pub undo_window_days: i64,
    pub hours_deducted: f64,
}

pub fn rule_sentence(r: &HoursRule) -> String {
    let part = |label: &str, v: f64| if v > 0.0 { format!("{}扣 {} 课时", label, trim_num(v)) } else { format!("{}不扣", label) };
    let mut s = format!(
        "扣课时规则：{}、{}、{}、{}。",
        part("出勤", r.present),
        part("迟到", r.late),
        part("请假", r.leave),
        part("缺勤", r.absent)
    );
    s.push_str(if r.allow_negative { "余额不足照常点名，不足的部分记为欠课时。" } else { "余额不足的学生无法点名，需先充值。" });
    s.push_str(if r.auto_offset_on_recharge { "充值时默认抵扣欠课时。" } else { "充值不自动抵扣欠课时。" });
    s
}

#[tauri::command]
pub fn get_rollcall(db: State<Db>, session_id: String) -> AppResult<RollcallView> {
    let conn = lock(&db);
    let s = repo::session(&conn, &session_id)?;
    let k = repo::klass(&conn, &s.class_id)?;
    let all = settings::load(&conn);
    let rule = all.hours_rule.clone();
    let ordinal = repo::session_ordinal(&conn, &s)?;
    let balances = repo::balances(&conn)?;
    let mut students = Vec::new();
    let mut hours_deducted = 0.0;

    if s.status == "taken" {
        // 只读：按点名记录展示
        let mut st = conn.prepare(
            "SELECT a.status AS a_status, a.hours AS a_hours, st.* FROM attendance a JOIN student st ON st.id = a.student_id
             WHERE a.session_id = ?1 ORDER BY st.name",
        )?;
        let rows: Vec<(String, f64, Student)> = st
            .query_map(params![session_id], |r| Ok((r.get("a_status")?, r.get("a_hours")?, Student::from_row(r)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        let roster: Vec<String> = repo::enrolled_students(&conn, &s.class_id, &s.date)?.into_iter().map(|x| x.id).collect();
        for (status, hours, stu) in rows {
            hours_deducted += hours;
            let bal = *balances.get(&stu.id).unwrap_or(&0.0);
            let unit = repo::owed_unit_price_for(&conn, &stu.id, &rule)?;
            students.push(RollcallStudent {
                extra: !roster.contains(&stu.id),
                balance: bal,
                owed_cents: if bal < 0.0 { ((-bal) * unit as f64).round() as i64 } else { 0 },
                attendance_status: Some(status),
                attendance_hours: Some(hours),
                student: stu,
            });
        }
    } else {
        for stu in repo::enrolled_students(&conn, &s.class_id, &s.date)? {
            let bal = *balances.get(&stu.id).unwrap_or(&0.0);
            let unit = repo::owed_unit_price_for(&conn, &stu.id, &rule)?;
            students.push(RollcallStudent {
                extra: false,
                balance: bal,
                owed_cents: if bal < 0.0 { ((-bal) * unit as f64).round() as i64 } else { 0 },
                attendance_status: None,
                attendance_hours: None,
                student: stu,
            });
        }
    }
    let undoable = s.status == "taken"
        && s.taken_at.map(|t| now_ms() - t <= repo::undo_window_ms(&rule)).unwrap_or(false);
    Ok(RollcallView {
        enrolled: repo::enrolled_count(&conn, &s.class_id)?,
        session: s,
        klass: k,
        ordinal,
        students,
        rule_sentence: rule_sentence(&rule),
        owed_alert_threshold: all.alerts.owed_alert_threshold,
        low_balance_threshold: all.alerts.low_balance_threshold,
        undoable,
        undo_window_days: rule.undo_window_days,
        hours_deducted,
        rule,
    })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RollcallResult {
    pub total_hours: f64,
    pub negative_count: i64,
    pub owed_total: f64,
}

/// R1 点名事务：全部成功或全部回滚
#[tauri::command]
pub fn confirm_rollcall(db: State<Db>, session_id: String, marks: Vec<Mark>) -> AppResult<RollcallResult> {
    let mut conn = lock(&db);
    confirm_rollcall_inner(&mut conn, &session_id, &marks)
}

pub fn confirm_rollcall_inner(conn: &mut Connection, session_id: &str, marks: &[Mark]) -> AppResult<RollcallResult> {
    let session_id = session_id.to_string();
    let rule = settings::hours_rule(conn);
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let s = repo::session(&tx, &session_id)?;
    if s.status != "planned" {
        return Err(AppError::rule(match s.status.as_str() {
            "taken" => "这节课已经点过名了",
            _ => "这节课已取消，不能点名",
        }));
    }
    if marks.is_empty() {
        return Err(AppError::rule("名单为空"));
    }
    let k = repo::klass(&tx, &s.class_id)?;
    // 名单 = 在班学生 + 临时加人（marks 里出现的任何在读学生）
    let mut snapshot = Vec::new();
    for m in marks {
        if snapshot.iter().any(|x: &StudentBalance| x.id == m.student_id) {
            return Err(AppError::rule("同一学生重复出现在名单中"));
        }
        let stu = repo::student(&tx, &m.student_id)?;
        snapshot.push(StudentBalance { id: stu.id.clone(), name: stu.name.clone(), balance: repo::balance(&tx, &stu.id)? });
    }
    let plan = plan_rollcall(&rule, &snapshot, marks).map_err(AppError::Rule)?;
    if !plan.insufficient.is_empty() {
        return Err(AppError::rule(format!("余额不足，需先充值：{}", plan.insufficient.join("、"))));
    }
    let now = now_ms();
    tx.execute(
        "UPDATE session SET status = 'taken', taken_at = ?2, updated_at = ?2 WHERE id = ?1",
        params![session_id, now],
    )?;
    let mut negative_count = 0;
    let mut owed_total = 0.0;
    for line in &plan.lines {
        tx.execute(
            "INSERT INTO attendance(id, session_id, student_id, status, hours, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
            params![new_id(), session_id, line.student_id, line.status, line.hours, now],
        )?;
        let pkgs = repo::package_states(&tx, &line.student_id)?;
        let picked = pick_package(&pkgs, line.hours);
        let unit = match picked {
            Some(p) => p.unit_price_cents,
            None => owed_unit_price(&pkgs, &rule.owed_price_mode),
        };
        let amount = consume_amount_cents(line.hours, unit);
        let mut reason = format!("{} {} · {}", k.name, s.start_time, status_label(&line.status));
        if line.hours > 0.0 && picked.is_none() {
            reason.push_str(" · 课包用尽，转为欠课时");
        } else if line.hours == 0.0 {
            reason.push_str(" · 按规则不扣");
        }
        repo::insert_ledger(
            &tx,
            NewEntry {
                student_id: &line.student_id,
                occurred_at: now,
                entry_type: "consume",
                delta: -line.hours,
                balance_after: line.balance_after,
                session_id: Some(&session_id),
                package_id: picked.map(|p| p.id.as_str()),
                amount_cents: Some(amount),
                reason: &reason,
                reverses_id: None,
            },
        )?;
        if line.balance_after < 0.0 {
            negative_count += 1;
            owed_total += -line.balance_after;
        }
    }
    tx.commit()?;
    Ok(RollcallResult { total_hours: plan.total_hours, negative_count, owed_total })
}

fn reverse_consume(conn: &Connection, orig: &LedgerEntry, now: i64) -> AppResult<()> {
    let bal = repo::balance(conn, &orig.student_id)?;
    let reason = format!("撤销 {} 点名", ms_to_date(orig.occurred_at).format("%-m-%-d"));
    repo::insert_ledger(
        conn,
        NewEntry {
            student_id: &orig.student_id,
            occurred_at: now,
            entry_type: "adjust",
            delta: -orig.delta,
            balance_after: bal - orig.delta,
            session_id: orig.session_id.as_deref(),
            package_id: orig.package_id.as_deref(),
            amount_cents: orig.amount_cents.map(|a| -a),
            reason: &reason,
            reverses_id: Some(&orig.id),
        },
    )?;
    if let Some(sid) = &orig.session_id {
        conn.execute("DELETE FROM attendance WHERE session_id = ?1 AND student_id = ?2", params![sid, orig.student_id])?;
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM attendance WHERE session_id = ?1", params![sid], |r| r.get(0))?;
        if left == 0 {
            conn.execute(
                "UPDATE session SET status = 'planned', taken_at = NULL, updated_at = ?2 WHERE id = ?1 AND status = 'taken'",
                params![sid, now],
            )?;
        }
    }
    Ok(())
}

fn check_window(rule: &HoursRule, occurred_at: i64) -> AppResult<()> {
    if now_ms() - occurred_at > repo::undo_window_ms(rule) {
        return Err(AppError::rule(format!("超过 {} 天的记录不能撤销，请用手动调整", rule.undo_window_days)));
    }
    Ok(())
}

/// 撤销整节课的点名
#[tauri::command]
pub fn undo_rollcall(db: State<Db>, session_id: String) -> AppResult<()> {
    let mut conn = lock(&db);
    undo_rollcall_inner(&mut conn, &session_id)
}

pub fn undo_rollcall_inner(conn: &mut Connection, session_id: &str) -> AppResult<()> {
    let session_id = session_id.to_string();
    let rule = settings::hours_rule(conn);
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let s = repo::session(&tx, &session_id)?;
    if s.status != "taken" {
        return Err(AppError::rule("这节课还没有点名"));
    }
    check_window(&rule, s.taken_at.unwrap_or(0))?;
    let mut st = tx.prepare(
        "SELECT * FROM ledger_entry l WHERE l.session_id = ?1 AND l.type = 'consume'
           AND NOT EXISTS (SELECT 1 FROM ledger_entry r WHERE r.reverses_id = l.id)",
    )?;
    let entries = st.query_map(params![session_id], LedgerEntry::from_row)?.collect::<Result<Vec<_>, _>>()?;
    drop(st);
    let now = now_ms();
    for e in &entries {
        reverse_consume(&tx, e, now)?;
    }
    // 兜底：即使没有分录，也把状态退回
    tx.execute("DELETE FROM attendance WHERE session_id = ?1", params![session_id])?;
    tx.execute(
        "UPDATE session SET status = 'planned', taken_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![session_id, now],
    )?;
    tx.commit()?;
    Ok(())
}

/// 撤销单条 consume / recharge 分录
#[tauri::command]
pub fn undo_entry(db: State<Db>, entry_id: String) -> AppResult<()> {
    let mut conn = lock(&db);
    undo_entry_inner(&mut conn, &entry_id)
}

pub fn undo_entry_inner(conn: &mut Connection, entry_id: &str) -> AppResult<()> {
    let entry_id = entry_id.to_string();
    let rule = settings::hours_rule(conn);
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let orig = repo::ledger_entry(&tx, &entry_id)?;
    if repo::is_reversed(&tx, &entry_id)? {
        return Err(AppError::rule("这条记录已经撤销过了"));
    }
    check_window(&rule, orig.occurred_at)?;
    let now = now_ms();
    match orig.entry_type.as_str() {
        "consume" => reverse_consume(&tx, &orig, now)?,
        "recharge" => {
            let bal = repo::balance(&tx, &orig.student_id)?;
            let reason = format!("撤销 {} 充值", ms_to_date(orig.occurred_at).format("%-m-%-d"));
            repo::insert_ledger(
                &tx,
                NewEntry {
                    student_id: &orig.student_id,
                    occurred_at: now,
                    entry_type: "adjust",
                    delta: -orig.delta,
                    balance_after: bal - orig.delta,
                    session_id: None,
                    package_id: orig.package_id.as_deref(),
                    amount_cents: orig.amount_cents.map(|a| -a),
                    reason: &reason,
                    reverses_id: Some(&orig.id),
                },
            )?;
        }
        _ => return Err(AppError::rule("只能撤销消费或充值记录；调整记录请再写一条调整")),
    }
    tx.commit()?;
    Ok(())
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdjustInput {
    pub student_id: String,
    pub delta: f64,
    pub reason: String,
    pub amount_cents: Option<i64>,
    pub occurred_on: Option<String>,
}

/// 手动调整：无时限，reverses_id = NULL
#[tauri::command]
pub fn manual_adjust(db: State<Db>, input: AdjustInput) -> AppResult<()> {
    let mut conn = lock(&db);
    manual_adjust_inner(&mut conn, input)
}

pub fn manual_adjust_inner(conn: &mut Connection, input: AdjustInput) -> AppResult<()> {
    if input.delta == 0.0 {
        return Err(AppError::rule("调整量不能为 0"));
    }
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return Err(AppError::rule("请填写调整原因"));
    }
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    repo::student(&tx, &input.student_id)?;
    let bal = repo::balance(&tx, &input.student_id)?;
    let occurred_at = match input.occurred_on {
        Some(d) if !d.is_empty() => crate::db::date_start_ms(crate::db::parse_date(&d)?) + 12 * 3600 * 1000,
        _ => now_ms(),
    };
    repo::insert_ledger(
        &tx,
        NewEntry {
            student_id: &input.student_id,
            occurred_at,
            entry_type: "adjust",
            delta: input.delta,
            balance_after: bal + input.delta,
            session_id: None,
            package_id: None,
            amount_cents: input.amount_cents,
            reason: &reason,
            reverses_id: None,
        },
    )?;
    tx.commit()?;
    Ok(())
}

#[allow(dead_code)]
fn _unused(_a: Attendance) {}
