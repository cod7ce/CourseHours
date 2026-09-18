//! 仓储层 / 事务层集成测试：内存 SQLite，覆盖 05 文档 P2–P4 的验收标准与 02 文档边界用例。

use rusqlite::{params, Connection};

use crate::commands::recharge::{recharge_inner, RechargeInput};
use crate::commands::rollcall::{confirm_rollcall_inner, manual_adjust_inner, undo_entry_inner, undo_rollcall_inner, AdjustInput};
use crate::commands::scheduling::generate_inner;
use crate::commands::classes::{set_class_schedule_inner, RuleInput};
use crate::core::hours::Mark;
use crate::core::recharge::OwedMode;
use crate::db::{new_id, now_ms, open_memory};
use crate::repo;
use crate::settings;

fn conn() -> Connection {
    open_memory().unwrap()
}

fn add_student(c: &Connection, name: &str) -> String {
    let id = new_id();
    c.execute(
        "INSERT INTO student(id, name, status, enrolled_on, created_at, updated_at) VALUES (?1, ?2, 'active', '2026-03-01', ?3, ?3)",
        params![id, name, now_ms()],
    )
    .unwrap();
    id
}

fn add_class(c: &Connection, name: &str) -> String {
    let id = new_id();
    c.execute(
        "INSERT INTO klass(id, name, color, capacity, duration_min, status, created_at, updated_at) VALUES (?1, ?2, '#B75E36', 10, 90, 'active', ?3, ?3)",
        params![id, name, now_ms()],
    )
    .unwrap();
    id
}

fn enroll(c: &Connection, sid: &str, cid: &str) {
    c.execute(
        "INSERT INTO enrollment(id, student_id, class_id, joined_on, created_at) VALUES (?1, ?2, ?3, '2026-03-01', ?4)",
        params![new_id(), sid, cid, now_ms()],
    )
    .unwrap();
}

fn add_session(c: &Connection, cid: &str, date: &str, start: &str) -> String {
    let id = new_id();
    c.execute(
        "INSERT INTO session(id, class_id, date, start_time, end_time, kind, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, '15:30', 'regular', 'planned', ?5, ?5)",
        params![id, cid, date, start, now_ms()],
    )
    .unwrap();
    id
}

fn add_rule(c: &Connection, cid: &str, weekdays: &str, start: &str) -> String {
    let id = new_id();
    c.execute(
        "INSERT INTO recurrence_rule(id, class_id, weekdays, start_time, end_time, room, active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, '15:30', 'A', 1, ?5, ?5)",
        params![id, cid, weekdays, start, now_ms()],
    )
    .unwrap();
    id
}

fn top_up(c: &mut Connection, sid: &str, sessions: i64, cents: i64, mode: OwedMode) {
    recharge_inner(
        c,
        RechargeInput { student_id: sid.into(), sessions, amount_cents: cents, purchased_on: None, method: Some("wechat".into()), mode: Some(mode), note: None },
    )
    .unwrap();
}

fn marks(pairs: &[(&str, &str)]) -> Vec<Mark> {
    pairs.iter().map(|(s, st)| Mark { student_id: s.to_string(), status: st.to_string() }).collect()
}

fn ledger_count(c: &Connection, sid: &str) -> i64 {
    c.query_row("SELECT COUNT(*) FROM ledger_entry WHERE student_id = ?1", params![sid], |r| r.get(0)).unwrap()
}

fn assert_balance_invariant(c: &Connection) {
    let mut st = c
        .prepare(
            "SELECT s.id, COALESCE((SELECT SUM(delta) FROM ledger_entry WHERE student_id = s.id), 0),
                    (SELECT balance_after FROM ledger_entry WHERE student_id = s.id ORDER BY created_at DESC LIMIT 1)
             FROM student s",
        )
        .unwrap();
    for r in st.query_map([], |r| Ok((r.get::<_, f64>(1)?, r.get::<_, Option<f64>>(2)?))).unwrap() {
        let (sum, last) = r.unwrap();
        if let Some(last) = last {
            assert!((sum - last).abs() < 1e-9, "SUM(delta)={} != balance_after={}", sum, last);
        }
    }
}

// ---------- P3 点名与账本 ----------

#[test]
fn recharge_24_then_three_rollcalls_leaves_21() {
    let mut c = conn();
    let cid = add_class(&c, "Movers B");
    let sid = add_student(&c, "陈亦航");
    enroll(&c, &sid, &cid);
    top_up(&mut c, &sid, 24, 360000, OwedMode::Offset);
    assert_eq!(repo::balance(&c, &sid).unwrap(), 24.0);
    for d in ["2026-09-01", "2026-09-03", "2026-09-08"] {
        let s = add_session(&c, &cid, d, "14:00");
        confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap();
    }
    assert_eq!(repo::balance(&c, &sid).unwrap(), 21.0);
    assert_balance_invariant(&c);
    // 每条 consume 都指向课包，结转 150 元
    let (cnt, amt): (i64, i64) = c
        .query_row(
            "SELECT COUNT(*), SUM(amount_cents) FROM ledger_entry WHERE student_id = ?1 AND type = 'consume' AND package_id IS NOT NULL",
            params![sid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(cnt, 3);
    assert_eq!(amt, 45000);
}

#[test]
fn zero_balance_rollcall_goes_negative_with_null_package() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "周子谦");
    enroll(&c, &sid, &cid);
    let s = add_session(&c, &cid, "2026-09-17", "09:30");
    let r = confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap();
    assert_eq!(r.negative_count, 1);
    assert_eq!(repo::balance(&c, &sid).unwrap(), -1.0);
    let pkg: Option<String> = c
        .query_row("SELECT package_id FROM ledger_entry WHERE student_id = ?1 AND type = 'consume'", params![sid], |r| r.get(0))
        .unwrap();
    assert!(pkg.is_none());
    let status: String = c.query_row("SELECT status FROM session WHERE id = ?1", params![s], |r| r.get(0)).unwrap();
    assert_eq!(status, "taken");
}

#[test]
fn leave_writes_zero_delta_entry() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "徐牧野");
    enroll(&c, &sid, &cid);
    let s = add_session(&c, &cid, "2026-09-17", "09:30");
    confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "leave")])).unwrap();
    assert_eq!(ledger_count(&c, &sid), 1);
    let (delta, reason): (f64, String) = c
        .query_row("SELECT delta, reason FROM ledger_entry WHERE student_id = ?1", params![sid], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!(delta, 0.0);
    assert!(reason.contains("请假"));
}

#[test]
fn double_rollcall_rejected() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "x");
    enroll(&c, &sid, &cid);
    let s = add_session(&c, &cid, "2026-09-17", "09:30");
    confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap();
    let err = confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap_err();
    assert!(err.to_string().contains("已经点过名"));
    assert_eq!(ledger_count(&c, &sid), 1);
}

#[test]
fn rollcall_is_atomic_when_allow_negative_off() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let rich = add_student(&c, "富");
    let poor = add_student(&c, "穷");
    enroll(&c, &rich, &cid);
    enroll(&c, &poor, &cid);
    top_up(&mut c, &rich, 10, 100000, OwedMode::Offset);
    let mut all = settings::load(&c);
    all.hours_rule.allow_negative = false;
    settings::save(&c, &all).unwrap();
    let s = add_session(&c, &cid, "2026-09-17", "09:30");
    let err = confirm_rollcall_inner(&mut c, &s, &marks(&[(&rich, "present"), (&poor, "present")])).unwrap_err();
    assert!(err.to_string().contains("穷"));
    // 整个事务回滚：富的余额不变，课次仍是 planned
    assert_eq!(repo::balance(&c, &rich).unwrap(), 10.0);
    let status: String = c.query_row("SELECT status FROM session WHERE id = ?1", params![s], |r| r.get(0)).unwrap();
    assert_eq!(status, "planned");
    let att: i64 = c.query_row("SELECT COUNT(*) FROM attendance WHERE session_id = ?1", params![s], |r| r.get(0)).unwrap();
    assert_eq!(att, 0);
}

#[test]
fn undo_rollcall_reverses_and_reopens_session() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "x");
    enroll(&c, &sid, &cid);
    let s = add_session(&c, &cid, "2026-09-17", "09:30");
    confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap();
    assert_eq!(repo::balance(&c, &sid).unwrap(), -1.0);
    undo_rollcall_inner(&mut c, &s).unwrap();
    assert_eq!(repo::balance(&c, &sid).unwrap(), 0.0);
    assert_eq!(ledger_count(&c, &sid), 2);
    let orig_id: String = c.query_row("SELECT id FROM ledger_entry WHERE type = 'consume'", [], |r| r.get(0)).unwrap();
    assert!(repo::is_reversed(&c, &orig_id).unwrap());
    let status: String = c.query_row("SELECT status FROM session WHERE id = ?1", params![s], |r| r.get(0)).unwrap();
    assert_eq!(status, "planned");
    let att: i64 = c.query_row("SELECT COUNT(*) FROM attendance WHERE session_id = ?1", params![s], |r| r.get(0)).unwrap();
    assert_eq!(att, 0);
    // 可以重新点名
    confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "leave")])).unwrap();
    assert_eq!(repo::balance(&c, &sid).unwrap(), 0.0);
    assert_balance_invariant(&c);
}

#[test]
fn undo_entry_twice_rejected_and_income_reversed() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "x");
    enroll(&c, &sid, &cid);
    top_up(&mut c, &sid, 10, 150000, OwedMode::Offset);
    let s = add_session(&c, &cid, "2026-09-17", "09:30");
    confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap();
    let orig_id: String = c.query_row("SELECT id FROM ledger_entry WHERE type = 'consume'", [], |r| r.get(0)).unwrap();
    undo_entry_inner(&mut c, &orig_id).unwrap();
    assert!(undo_entry_inner(&mut c, &orig_id).is_err());
    let income: i64 = c
        .query_row("SELECT SUM(amount_cents) FROM ledger_entry WHERE session_id = ?1", params![s], |r| r.get(0))
        .unwrap();
    assert_eq!(income, 0);
    assert_eq!(repo::balance(&c, &sid).unwrap(), 10.0);
}

#[test]
fn undo_outside_window_rejected() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "x");
    enroll(&c, &sid, &cid);
    let s = add_session(&c, &cid, "2026-09-01", "09:30");
    confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap();
    // 把分录和课次的时间推到 8 天前
    let old = now_ms() - 8 * 24 * 3600 * 1000;
    c.execute("UPDATE ledger_entry SET occurred_at = ?1", params![old]).unwrap();
    c.execute("UPDATE session SET taken_at = ?1", params![old]).unwrap();
    let id: String = c.query_row("SELECT id FROM ledger_entry", [], |r| r.get(0)).unwrap();
    assert!(undo_entry_inner(&mut c, &id).is_err());
    assert!(undo_rollcall_inner(&mut c, &s).is_err());
    // 手动调整无时限
    manual_adjust_inner(&mut c, AdjustInput { student_id: sid.clone(), delta: 1.0, reason: "补回".into(), amount_cents: None, occurred_on: None }).unwrap();
    assert_eq!(repo::balance(&c, &sid).unwrap(), 0.0);
}

#[test]
fn manual_adjust_zero_rejected() {
    let mut c = conn();
    let sid = add_student(&c, "x");
    assert!(manual_adjust_inner(&mut c, AdjustInput { student_id: sid, delta: 0.0, reason: "无".into(), amount_cents: None, occurred_on: None }).is_err());
}

#[test]
fn fifo_switches_package_when_first_is_used_up() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "x");
    enroll(&c, &sid, &cid);
    c.execute(
        "INSERT INTO package(id, student_id, sessions, amount_cents, unit_price_cents, purchased_on, offset_sessions, created_at) VALUES ('p1', ?1, 1, 10000, 10000, '2026-01-01', 0, 1)",
        params![sid],
    )
    .unwrap();
    c.execute(
        "INSERT INTO ledger_entry(id, student_id, occurred_at, type, delta, balance_after, package_id, amount_cents, reason, created_at) VALUES ('r1', ?1, 1, 'recharge', 1, 1, 'p1', 10000, 'a', 1)",
        params![sid],
    )
    .unwrap();
    c.execute(
        "INSERT INTO package(id, student_id, sessions, amount_cents, unit_price_cents, purchased_on, offset_sessions, created_at) VALUES ('p2', ?1, 5, 100000, 20000, '2026-02-01', 0, 2)",
        params![sid],
    )
    .unwrap();
    c.execute(
        "INSERT INTO ledger_entry(id, student_id, occurred_at, type, delta, balance_after, package_id, amount_cents, reason, created_at) VALUES ('r2', ?1, 2, 'recharge', 5, 6, 'p2', 100000, 'b', 2)",
        params![sid],
    )
    .unwrap();
    let s1 = add_session(&c, &cid, "2026-09-01", "09:30");
    let s2 = add_session(&c, &cid, "2026-09-02", "09:30");
    confirm_rollcall_inner(&mut c, &s1, &marks(&[(&sid, "present")])).unwrap();
    confirm_rollcall_inner(&mut c, &s2, &marks(&[(&sid, "present")])).unwrap();
    let rows: Vec<(String, i64)> = c
        .prepare("SELECT package_id, amount_cents FROM ledger_entry WHERE type = 'consume' ORDER BY created_at")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(|x| x.unwrap())
        .collect();
    assert_eq!(rows[0], ("p1".into(), 10000));
    assert_eq!(rows[1], ("p2".into(), 20000));
}

// ---------- P4 充值与抵扣 ----------

#[test]
fn recharge_offset_mode_from_minus_two() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "林小满");
    enroll(&c, &sid, &cid);
    for d in ["2026-09-01", "2026-09-03"] {
        let s = add_session(&c, &cid, d, "14:00");
        confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap();
    }
    assert_eq!(repo::balance(&c, &sid).unwrap(), -2.0);
    let r = recharge_inner(
        &mut c,
        RechargeInput { student_id: sid.clone(), sessions: 10, amount_cents: 100000, purchased_on: None, method: None, mode: Some(OwedMode::Offset), note: None },
    )
    .unwrap();
    assert_eq!(repo::balance(&c, &sid).unwrap(), 8.0);
    assert_eq!(r.package.offset_sessions, 2);
    assert_eq!(r.plan.received_cents, 100000);
    let recharge_rows: i64 = c.query_row("SELECT COUNT(*) FROM ledger_entry WHERE student_id = ?1 AND type != 'consume'", params![sid], |r| r.get(0)).unwrap();
    assert_eq!(recharge_rows, 1);
    assert_balance_invariant(&c);
}

#[test]
fn recharge_cash_mode_from_minus_two() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "林小满");
    enroll(&c, &sid, &cid);
    // 先有一个 150/次 的包并用光，这样欠课时按 150 折算
    top_up(&mut c, &sid, 1, 15000, OwedMode::Offset);
    for d in ["2026-09-01", "2026-09-03", "2026-09-08"] {
        let s = add_session(&c, &cid, d, "14:00");
        confirm_rollcall_inner(&mut c, &s, &marks(&[(&sid, "present")])).unwrap();
    }
    assert_eq!(repo::balance(&c, &sid).unwrap(), -2.0);
    let r = recharge_inner(
        &mut c,
        RechargeInput { student_id: sid.clone(), sessions: 10, amount_cents: 100000, purchased_on: None, method: None, mode: Some(OwedMode::Cash), note: None },
    )
    .unwrap();
    assert_eq!(repo::balance(&c, &sid).unwrap(), 10.0);
    assert_eq!(r.package.offset_sessions, 0);
    assert_eq!(r.plan.received_cents, 130000);
    let adj: (f64, i64) = c
        .query_row("SELECT delta, amount_cents FROM ledger_entry WHERE student_id = ?1 AND type = 'adjust'", params![sid], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!(adj, (2.0, 30000));
    assert_balance_invariant(&c);
}

#[test]
fn recharge_validation() {
    let mut c = conn();
    let sid = add_student(&c, "x");
    assert!(recharge_inner(&mut c, RechargeInput { student_id: sid.clone(), sessions: 0, amount_cents: 100, purchased_on: None, method: None, mode: None, note: None }).is_err());
    assert!(recharge_inner(&mut c, RechargeInput { student_id: sid, sessions: 5, amount_cents: 0, purchased_on: None, method: None, mode: None, note: None }).is_err());
}

#[test]
fn reversed_recharge_package_not_used_for_fifo() {
    let mut c = conn();
    let cid = add_class(&c, "A");
    let sid = add_student(&c, "x");
    enroll(&c, &sid, &cid);
    top_up(&mut c, &sid, 10, 100000, OwedMode::Offset);
    let rid: String = c.query_row("SELECT id FROM ledger_entry WHERE type = 'recharge'", [], |r| r.get(0)).unwrap();
    undo_entry_inner(&mut c, &rid).unwrap();
    assert_eq!(repo::balance(&c, &sid).unwrap(), 0.0);
    assert!(repo::package_states(&c, &sid).unwrap().is_empty());
}

// ---------- P2 排课 ----------

#[test]
fn generate_is_idempotent_and_updates_generated_through() {
    let mut c = conn();
    let a = add_class(&c, "A");
    let b = add_class(&c, "B");
    add_rule(&c, &a, "2,4", "09:30");
    add_rule(&c, &b, "6", "10:00");
    let from = chrono::NaiveDate::from_ymd_opt(2026, 9, 21).unwrap(); // 周一
    let n = generate_inner(&mut c, from, 2).unwrap();
    assert_eq!(n, 6);
    let again = generate_inner(&mut c, from, 2).unwrap();
    assert_eq!(again, 0);
    let total: i64 = c.query_row("SELECT COUNT(*) FROM session", [], |r| r.get(0)).unwrap();
    assert_eq!(total, 6);
    let gt: String = c.query_row("SELECT generated_through FROM recurrence_rule LIMIT 1", [], |r| r.get(0)).unwrap();
    assert_eq!(gt, "2026-10-04");
}

#[test]
fn changing_rule_does_not_touch_generated_sessions() {
    let mut c = conn();
    let a = add_class(&c, "A");
    let rid = add_rule(&c, &a, "2", "09:30");
    let from = chrono::NaiveDate::from_ymd_opt(2026, 9, 21).unwrap();
    generate_inner(&mut c, from, 1).unwrap();
    c.execute("UPDATE recurrence_rule SET start_time = '10:00' WHERE id = ?1", params![rid]).unwrap();
    let from2 = chrono::NaiveDate::from_ymd_opt(2026, 9, 28).unwrap();
    generate_inner(&mut c, from2, 1).unwrap();
    let times: Vec<String> = c
        .prepare("SELECT start_time FROM session ORDER BY date")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|x| x.unwrap())
        .collect();
    assert_eq!(times, vec!["09:30", "10:00"]);
}

#[test]
fn inactive_rule_generates_nothing() {
    let mut c = conn();
    let a = add_class(&c, "A");
    let rid = add_rule(&c, &a, "2", "09:30");
    c.execute("UPDATE recurrence_rule SET active = 0 WHERE id = ?1", params![rid]).unwrap();
    let n = generate_inner(&mut c, chrono::NaiveDate::from_ymd_opt(2026, 9, 21).unwrap(), 2).unwrap();
    assert_eq!(n, 0);
}

// ---------- 班级上课时间（逐天时段） ----------

fn slot(d: u32, s: &str, e: &str) -> RuleInput {
    RuleInput { weekdays: vec![d], start_time: s.into(), end_time: e.into(), room: Some("A".into()) }
}

#[test]
fn schedule_groups_same_time_and_keeps_matching_rules() {
    let mut c = conn();
    let a = add_class(&c, "A");
    // 周二/周四 09:30 + 周六 10:00
    let r = set_class_schedule_inner(&mut c, &a, vec![slot(2, "09:30", "11:00"), slot(4, "09:30", "11:00"), slot(6, "10:00", "11:30")], false).unwrap();
    assert_eq!(r.created_rules, 2);
    let rules: Vec<(String, String)> = c.prepare("SELECT weekdays, start_time FROM recurrence_rule WHERE class_id = ?1 AND active = 1 ORDER BY start_time").unwrap()
        .query_map(params![a], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|x| x.unwrap()).collect();
    assert_eq!(rules, vec![("2,4".to_string(), "09:30".to_string()), ("6".to_string(), "10:00".to_string())]);
    // 再次保存：周六改成 10:30，周二/四不变 → 只停用+新建一条
    let r = set_class_schedule_inner(&mut c, &a, vec![slot(2, "09:30", "11:00"), slot(4, "09:30", "11:00"), slot(6, "10:30", "12:00")], false).unwrap();
    assert_eq!((r.created_rules, r.deactivated_rules), (1, 1));
    let active: i64 = c.query_row("SELECT COUNT(*) FROM recurrence_rule WHERE class_id = ?1 AND active = 1", params![a], |r| r.get(0)).unwrap();
    assert_eq!(active, 2);
}

#[test]
fn schedule_apply_to_future_regenerates_unstarted_sessions() {
    let mut c = conn();
    let a = add_class(&c, "A");
    set_class_schedule_inner(&mut c, &a, vec![slot(2, "09:30", "11:00")], false).unwrap();
    let from = crate::db::today() + chrono::Duration::days(1);
    generate_inner(&mut c, from, 3).unwrap();
    let before: i64 = c.query_row("SELECT COUNT(*) FROM session WHERE class_id = ?1", params![a], |r| r.get(0)).unwrap();
    assert!(before >= 2);
    // 一节已点名的课要保留
    let sid: String = c.query_row("SELECT id FROM session WHERE class_id = ?1 ORDER BY date LIMIT 1", params![a], |r| r.get(0)).unwrap();
    let stu = add_student(&c, "x");
    enroll(&c, &stu, &a);
    confirm_rollcall_inner(&mut c, &sid, &marks(&[(&stu, "present")])).unwrap();
    let r = set_class_schedule_inner(&mut c, &a, vec![slot(3, "14:00", "15:30")], true).unwrap();
    assert_eq!(r.removed_sessions, before - 1);
    assert!(r.created_sessions >= 2);
    let kept: i64 = c.query_row("SELECT COUNT(*) FROM session WHERE id = ?1", params![sid], |r| r.get(0)).unwrap();
    assert_eq!(kept, 1);
    let wed: i64 = c.query_row("SELECT COUNT(*) FROM session WHERE class_id = ?1 AND start_time = '14:00'", params![a], |r| r.get(0)).unwrap();
    assert_eq!(wed, r.created_sessions);
}

#[test]
fn rule_added_later_backfills_already_generated_weeks() {
    let mut c = conn();
    let a = add_class(&c, "A");
    add_rule(&c, &a, "2", "09:30");
    let from = crate::db::today();
    let n1 = generate_inner(&mut c, from, 2).unwrap();
    assert!(n1 >= 1);
    // 之后新建一个班并设了时段：再生成同样的 2 周，只补它的课，A 班不重复
    let b = add_class(&c, "B");
    add_rule(&c, &b, "4", "14:00");
    let n2 = generate_inner(&mut c, from, 2).unwrap();
    let b_count: i64 = c.query_row("SELECT COUNT(*) FROM session WHERE class_id = ?1", params![b], |r| r.get(0)).unwrap();
    assert_eq!(n2, b_count);
    assert!(b_count >= 1);
    let a_count: i64 = c.query_row("SELECT COUNT(*) FROM session WHERE class_id = ?1", params![a], |r| r.get(0)).unwrap();
    assert_eq!(a_count, n1);
    // 第三次什么都不生成
    assert_eq!(generate_inner(&mut c, from, 2).unwrap(), 0);
}
