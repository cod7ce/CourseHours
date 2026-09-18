use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::scheduling::{parse_weekdays, weekday_label};
use crate::db::{fmt_date, new_id, now_ms, today, today_str, Db};
use crate::error::{AppError, AppResult};
use crate::models::{Klass, RecurrenceRule, Session, Student};
use crate::repo;
use crate::settings;

use super::lock;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuleSummary {
    pub id: String,
    pub weekdays: Vec<u32>,
    pub weekdays_text: String,
    pub start_time: String,
    pub end_time: String,
    pub room: Option<String>,
    pub active: bool,
    pub generated_through: Option<String>,
}

pub fn rule_summary(r: &RecurrenceRule) -> RuleSummary {
    let wd = parse_weekdays(&r.weekdays);
    RuleSummary {
        id: r.id.clone(),
        weekdays_text: wd.iter().map(|d| weekday_label(*d)).collect::<Vec<_>>().join(" / "),
        weekdays: wd,
        start_time: r.start_time.clone(),
        end_time: r.end_time.clone(),
        room: r.room.clone(),
        active: r.active,
        generated_through: r.generated_through.clone(),
    }
}

pub fn class_rules(conn: &Connection, class_id: &str) -> AppResult<Vec<RuleSummary>> {
    let mut st = conn.prepare("SELECT * FROM recurrence_rule WHERE class_id = ?1 ORDER BY active DESC, created_at")?;
    let rows = st.query_map(params![class_id], RecurrenceRule::from_row)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows.iter().map(rule_summary).collect())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassCard {
    #[serde(flatten)]
    pub klass: Klass,
    pub rules: Vec<RuleSummary>,
    pub enrolled: i64,
    pub initials: Vec<String>,
    pub taken_count: i64,
    pub generated_through: Option<String>,
    pub month_sessions: i64,
    pub month_consumed: f64,
    pub month_revenue_cents: i64,
    pub owed_count: i64,
    pub zero_count: i64,
    pub next_session_id: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassListStats {
    pub class_count: i64,
    pub enrolled: i64,
    pub capacity: i64,
    pub month_sessions: i64,
    pub month_consumed: f64,
    pub month_revenue_cents: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassList {
    pub cards: Vec<ClassCard>,
    pub stats: ClassListStats,
}

fn month_class_stats(conn: &Connection, class_id: &str, month: &str) -> AppResult<(i64, f64, i64)> {
    let like = format!("{}%", month);
    let sessions: i64 = conn.query_row(
        "SELECT COUNT(*) FROM session WHERE class_id = ?1 AND date LIKE ?2 AND status != 'cancelled'",
        params![class_id, like],
        |r| r.get(0),
    )?;
    let (hours, cents): (f64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(-l.delta), 0), COALESCE(SUM(l.amount_cents), 0)
         FROM ledger_entry l JOIN session s ON s.id = l.session_id
         WHERE s.class_id = ?1 AND s.date LIKE ?2 AND l.type IN ('consume', 'adjust')",
        params![class_id, like],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((sessions, hours, cents))
}

fn build_card(conn: &Connection, k: Klass, balances: &std::collections::HashMap<String, f64>) -> AppResult<ClassCard> {
    let month = today_str()[..7].to_string();
    let rules = class_rules(conn, &k.id)?;
    let enrolled = repo::enrolled_count(conn, &k.id)?;
    let mut st = conn.prepare(
        "SELECT s.id, s.name FROM enrollment e JOIN student s ON s.id = e.student_id
         WHERE e.class_id = ?1 AND e.left_on IS NULL ORDER BY e.joined_on, s.name",
    )?;
    let roster: Vec<(String, String)> = st
        .query_map(params![k.id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let initials: Vec<String> = roster.iter().take(5).map(|(_, n)| n.chars().next().unwrap_or(' ').to_string()).collect();
    let mut owed_count = 0;
    let mut zero_count = 0;
    for (sid, _) in &roster {
        let b = *balances.get(sid).unwrap_or(&0.0);
        if b < 0.0 {
            owed_count += 1;
        } else if b == 0.0 {
            zero_count += 1;
        }
    }
    let taken_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM session WHERE class_id = ?1 AND status = 'taken'",
        params![k.id],
        |r| r.get(0),
    )?;
    let generated_through: Option<String> = conn
        .query_row("SELECT MAX(date) FROM session WHERE class_id = ?1", params![k.id], |r| r.get(0))
        .unwrap_or(None);
    let (ms, mc, mr) = month_class_stats(conn, &k.id, &month)?;
    let next_session_id: Option<String> = conn
        .query_row(
            "SELECT id FROM session WHERE class_id = ?1 AND status = 'planned' AND date >= ?2 ORDER BY date, start_time LIMIT 1",
            params![k.id, today_str()],
            |r| r.get(0),
        )
        .optional()?;
    Ok(ClassCard {
        klass: k,
        rules,
        enrolled,
        initials,
        taken_count,
        generated_through,
        month_sessions: ms,
        month_consumed: mc,
        month_revenue_cents: mr,
        owed_count,
        zero_count,
        next_session_id,
    })
}

#[tauri::command]
pub fn list_classes(db: State<Db>, include_ended: Option<bool>) -> AppResult<ClassList> {
    let conn = lock(&db);
    let balances = repo::balances(&conn)?;
    let sql = if include_ended.unwrap_or(false) {
        "SELECT * FROM klass ORDER BY status = 'active' DESC, created_at"
    } else {
        "SELECT * FROM klass WHERE status = 'active' ORDER BY created_at"
    };
    let mut st = conn.prepare(sql)?;
    let klasses = st.query_map([], Klass::from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut cards = Vec::new();
    let mut stats = ClassListStats { class_count: 0, enrolled: 0, capacity: 0, month_sessions: 0, month_consumed: 0.0, month_revenue_cents: 0 };
    for k in klasses {
        let c = build_card(&conn, k, &balances)?;
        if c.klass.status == "active" {
            stats.class_count += 1;
            stats.enrolled += c.enrolled;
            stats.capacity += c.klass.capacity;
            stats.month_sessions += c.month_sessions;
            stats.month_consumed += c.month_consumed;
            stats.month_revenue_cents += c.month_revenue_cents;
        }
        cards.push(c);
    }
    Ok(ClassList { cards, stats })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RosterRow {
    pub enrollment_id: String,
    #[serde(flatten)]
    pub student: Student,
    pub joined_on: String,
    pub balance: f64,
    pub month_attended: i64,
    pub month_total: i64,
    pub total_attended: i64,
    pub is_new_this_month: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionBrief {
    #[serde(flatten)]
    pub session: Session,
    pub present_count: i64,
    pub attendance_total: i64,
    pub leave_count: i64,
    pub absent_count: i64,
    pub hours_deducted: f64,
    pub is_today: bool,
}

pub fn session_brief(conn: &Connection, s: Session) -> AppResult<SessionBrief> {
    let (present, total, leave, absent): (i64, i64, i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(status IN ('present','late')), 0), COUNT(*), COALESCE(SUM(status = 'leave'), 0), COALESCE(SUM(status = 'absent'), 0)
         FROM attendance WHERE session_id = ?1",
        params![s.id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let hours: f64 = conn.query_row(
        "SELECT COALESCE(SUM(-delta), 0) FROM ledger_entry WHERE session_id = ?1 AND type IN ('consume','adjust')",
        params![s.id],
        |r| r.get(0),
    )?;
    let is_today = s.date == today_str();
    Ok(SessionBrief { session: s, present_count: present, attendance_total: total, leave_count: leave, absent_count: absent, hours_deducted: hours, is_today })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassDetail {
    #[serde(flatten)]
    pub card: ClassCard,
    pub roster: Vec<RosterRow>,
    pub recent_sessions: Vec<SessionBrief>,
    pub upcoming_sessions: Vec<SessionBrief>,
    pub unconsumed_hours: f64,
    pub present_cost: f64,
}

#[tauri::command]
pub fn get_class(db: State<Db>, id: String) -> AppResult<ClassDetail> {
    let conn = lock(&db);
    let balances = repo::balances(&conn)?;
    let k = repo::klass(&conn, &id)?;
    let card = build_card(&conn, k, &balances)?;
    let month = today_str()[..7].to_string();
    let mut st = conn.prepare(
        "SELECT e.id AS eid, e.joined_on AS joined_on, s.* FROM enrollment e JOIN student s ON s.id = e.student_id
         WHERE e.class_id = ?1 AND e.left_on IS NULL ORDER BY e.joined_on, s.name",
    )?;
    let raw: Vec<(String, String, Student)> = st
        .query_map(params![id], |r| Ok((r.get("eid")?, r.get("joined_on")?, Student::from_row(r)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut roster = Vec::new();
    let mut unconsumed = 0.0;
    for (eid, joined_on, s) in raw {
        let bal = *balances.get(&s.id).unwrap_or(&0.0);
        if bal > 0.0 {
            unconsumed += bal;
        }
        let (att, tot): (i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(a.status IN ('present','late')), 0), COUNT(*)
             FROM attendance a JOIN session se ON se.id = a.session_id
             WHERE a.student_id = ?1 AND se.class_id = ?2 AND se.date LIKE ?3",
            params![s.id, id, format!("{}%", month)],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let total_attended: i64 = conn.query_row(
            "SELECT COUNT(*) FROM attendance a JOIN session se ON se.id = a.session_id
             WHERE a.student_id = ?1 AND se.class_id = ?2 AND a.status IN ('present','late')",
            params![s.id, id],
            |r| r.get(0),
        )?;
        let is_new = joined_on.starts_with(&month);
        roster.push(RosterRow { enrollment_id: eid, joined_on, balance: bal, month_attended: att, month_total: tot, total_attended, is_new_this_month: is_new, student: s });
    }
    let mut st = conn.prepare(
        "SELECT * FROM session WHERE class_id = ?1 AND date <= ?2 ORDER BY date DESC, start_time DESC LIMIT 8",
    )?;
    let recent = st.query_map(params![id, today_str()], Session::from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut recent_sessions = Vec::new();
    for s in recent {
        recent_sessions.push(session_brief(&conn, s)?);
    }
    let mut st = conn.prepare(
        "SELECT * FROM session WHERE class_id = ?1 AND date > ?2 ORDER BY date, start_time LIMIT 4",
    )?;
    let upcoming = st.query_map(params![id, today_str()], Session::from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut upcoming_sessions = Vec::new();
    for s in upcoming {
        upcoming_sessions.push(session_brief(&conn, s)?);
    }
    let rule = settings::hours_rule(&conn);
    Ok(ClassDetail { card, roster, recent_sessions, upcoming_sessions, unconsumed_hours: unconsumed, present_cost: rule.present })
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClassInput {
    pub name: String,
    pub color: String,
    pub room: Option<String>,
    pub capacity: Option<i64>,
    pub duration_min: Option<i64>,
    /// 新建时可顺带创建一条循环规则
    pub rule: Option<RuleInput>,
    /// 新建时按「每天一个时段」给的多条规则
    pub rules: Option<Vec<RuleInput>>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuleInput {
    pub weekdays: Vec<u32>,
    pub start_time: String,
    pub end_time: String,
    pub room: Option<String>,
}

pub fn validate_time(t: &str) -> AppResult<()> {
    let ok = t.len() == 5 && t.as_bytes()[2] == b':' && t[..2].parse::<u32>().map(|h| h < 24).unwrap_or(false) && t[3..].parse::<u32>().map(|m| m < 60).unwrap_or(false);
    if ok {
        Ok(())
    } else {
        Err(AppError::rule(format!("时间格式错误：{}", t)))
    }
}

pub fn insert_rule(conn: &Connection, class_id: &str, r: &RuleInput) -> AppResult<String> {
    let wd: Vec<u32> = r.weekdays.iter().copied().filter(|d| (1..=7).contains(d)).collect();
    if wd.is_empty() {
        return Err(AppError::rule("至少选择一个上课日"));
    }
    validate_time(&r.start_time)?;
    validate_time(&r.end_time)?;
    if crate::core::scheduling::minutes(&r.end_time) <= crate::core::scheduling::minutes(&r.start_time) {
        return Err(AppError::rule("结束时间必须晚于开始时间"));
    }
    let id = new_id();
    let now = now_ms();
    let mut sorted = wd.clone();
    sorted.sort_unstable();
    sorted.dedup();
    let wd_text = sorted.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(",");
    conn.execute(
        "INSERT INTO recurrence_rule(id, class_id, weekdays, start_time, end_time, room, active, generated_through, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, NULL, ?7, ?7)",
        params![id, class_id, wd_text, r.start_time, r.end_time, r.room.clone().filter(|x| !x.trim().is_empty()), now],
    )?;
    Ok(id)
}

#[tauri::command]
pub fn create_class(db: State<Db>, input: ClassInput) -> AppResult<Klass> {
    let mut conn = lock(&db);
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::rule("班级名称不能为空"));
    }
    let defaults = settings::load(&conn).defaults;
    let id = new_id();
    let now = now_ms();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO klass(id, name, color, room, capacity, duration_min, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)",
        params![
            id,
            name,
            input.color,
            input.room.clone().filter(|x| !x.trim().is_empty()).or(Some(defaults.default_room.clone())),
            input.capacity.unwrap_or(defaults.class_capacity),
            input.duration_min.unwrap_or(defaults.duration_min),
            now
        ],
    )?;
    if let Some(r) = &input.rule {
        insert_rule(&tx, &id, r)?;
    }
    for r in group_slots(input.rules.clone().unwrap_or_default()) {
        insert_rule(&tx, &id, &r)?;
    }
    tx.commit()?;
    repo::klass(&conn, &id)
}

/// 「周五 17:00–18:30、周六 10:00–11:30」这样的逐天时段 → 按 (start,end,room) 合并成规则
pub fn group_slots(slots: Vec<RuleInput>) -> Vec<RuleInput> {
    let mut out: Vec<RuleInput> = Vec::new();
    for s in slots {
        let room = s.room.clone().map(|x| x.trim().to_string()).filter(|x| !x.is_empty());
        if let Some(g) = out.iter_mut().find(|g| g.start_time == s.start_time && g.end_time == s.end_time && g.room == room) {
            for d in &s.weekdays {
                if !g.weekdays.contains(d) {
                    g.weekdays.push(*d);
                }
            }
            g.weekdays.sort_unstable();
        } else {
            let mut wd = s.weekdays.clone();
            wd.sort_unstable();
            wd.dedup();
            out.push(RuleInput { weekdays: wd, start_time: s.start_time, end_time: s.end_time, room });
        }
    }
    out
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleResult {
    pub created_rules: i64,
    pub deactivated_rules: i64,
    pub removed_sessions: i64,
    pub created_sessions: i64,
}

/// 整体替换一个班的上课时间。与现有规则完全相同的保留（含 generated_through），其余停用、新建。
/// apply_to_future = true 时，把被停用规则在今天之后、未点名且无流水的课次删掉，并按新规则补生成到原来的排课终点。
#[tauri::command]
pub fn set_class_schedule(db: State<Db>, class_id: String, slots: Vec<RuleInput>, apply_to_future: bool) -> AppResult<ScheduleResult> {
    let mut conn = lock(&db);
    set_class_schedule_inner(&mut conn, &class_id, slots, apply_to_future)
}

pub fn set_class_schedule_inner(conn: &mut Connection, class_id: &str, slots: Vec<RuleInput>, apply_to_future: bool) -> AppResult<ScheduleResult> {
    repo::klass(conn, class_id)?;
    let desired = group_slots(slots);
    for r in &desired {
        validate_time(&r.start_time)?;
        validate_time(&r.end_time)?;
        if crate::core::scheduling::minutes(&r.end_time) <= crate::core::scheduling::minutes(&r.start_time) {
            return Err(AppError::rule("结束时间必须晚于开始时间"));
        }
        if r.weekdays.is_empty() {
            return Err(AppError::rule("每个时段至少选择一天"));
        }
    }
    let now = now_ms();
    let today_s = today_str();
    let tx = conn.transaction()?;
    let existing: Vec<RecurrenceRule> = {
        let mut st = tx.prepare("SELECT * FROM recurrence_rule WHERE class_id = ?1 AND active = 1")?;
        let v = st.query_map(params![class_id], RecurrenceRule::from_row)?.collect::<Result<Vec<_>, _>>()?;
        v
    };
    let key = |wd: &[u32], s: &str, e: &str, room: &Option<String>| format!("{}|{}|{}|{}", wd.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(","), s, e, room.clone().unwrap_or_default());
    let mut matched: Vec<String> = Vec::new();
    let mut created_rules = 0;
    for d in &desired {
        let k = key(&d.weekdays, &d.start_time, &d.end_time, &d.room);
        if let Some(ex) = existing.iter().find(|r| key(&parse_weekdays(&r.weekdays), &r.start_time, &r.end_time, &r.room) == k) {
            matched.push(ex.id.clone());
        } else {
            insert_rule(&tx, class_id, d)?;
            created_rules += 1;
        }
    }
    let mut deactivated = 0;
    let mut removed_sessions = 0;
    let mut regen_through: Option<String> = None;
    for r in existing.iter().filter(|r| !matched.contains(&r.id)) {
        tx.execute("UPDATE recurrence_rule SET active = 0, updated_at = ?2 WHERE id = ?1", params![r.id, now])?;
        deactivated += 1;
        if apply_to_future {
            removed_sessions += tx.execute(
                "DELETE FROM session WHERE rule_id = ?1 AND status = 'planned' AND date > ?2
                   AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = session.id)
                   AND NOT EXISTS (SELECT 1 FROM ledger_entry l WHERE l.session_id = session.id)",
                params![r.id, today_s],
            )? as i64;
            if let Some(g) = &r.generated_through {
                if regen_through.as_ref().map(|x| g > x).unwrap_or(true) {
                    regen_through = Some(g.clone());
                }
            }
        }
    }
    tx.commit()?;
    let mut created_sessions = 0;
    if apply_to_future && created_rules > 0 {
        // 补生成到原来的排课终点（至少到已排的最远日期）
        let through = {
            let max_any: Option<String> = conn
                .query_row("SELECT MAX(generated_through) FROM recurrence_rule WHERE active = 1", [], |r| r.get(0))
                .unwrap_or(None);
            [regen_through, max_any].into_iter().flatten().max()
        };
        if let Some(t) = through {
            let from = today() + chrono::Duration::days(1);
            let to = crate::db::parse_date(&t)?;
            if to >= from {
                created_sessions = super::scheduling::generate_range_inner(conn, from, to, Some(class_id))?;
            }
        }
    }
    Ok(ScheduleResult { created_rules, deactivated_rules: deactivated, removed_sessions, created_sessions })
}

#[tauri::command]
pub fn update_class(db: State<Db>, id: String, input: ClassInput) -> AppResult<Klass> {
    let conn = lock(&db);
    let cur = repo::klass(&conn, &id)?;
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::rule("班级名称不能为空"));
    }
    conn.execute(
        "UPDATE klass SET name = ?2, color = ?3, room = ?4, capacity = ?5, duration_min = ?6, updated_at = ?7 WHERE id = ?1",
        params![
            id,
            name,
            input.color,
            input.room.clone().filter(|x| !x.trim().is_empty()),
            input.capacity.unwrap_or(cur.capacity),
            input.duration_min.unwrap_or(cur.duration_min),
            now_ms()
        ],
    )?;
    repo::klass(&conn, &id)
}

/// 结束班级：停用规则、删除未来未点名的课次、结束在班关系
#[tauri::command]
pub fn end_class(db: State<Db>, id: String) -> AppResult<()> {
    let mut conn = lock(&db);
    let now = now_ms();
    let tx = conn.transaction()?;
    tx.execute("UPDATE klass SET status = 'ended', updated_at = ?2 WHERE id = ?1", params![id, now])?;
    tx.execute("UPDATE recurrence_rule SET active = 0, updated_at = ?2 WHERE class_id = ?1", params![id, now])?;
    tx.execute(
        "DELETE FROM session WHERE class_id = ?1 AND status = 'planned' AND date > ?2
           AND NOT EXISTS (SELECT 1 FROM ledger_entry l WHERE l.session_id = session.id)
           AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = session.id)",
        params![id, today_str()],
    )?;
    tx.execute("UPDATE enrollment SET left_on = ?2 WHERE class_id = ?1 AND left_on IS NULL", params![id, fmt_date(today())])?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn enroll_student(db: State<Db>, class_id: String, student_id: String, joined_on: Option<String>) -> AppResult<()> {
    let conn = lock(&db);
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM enrollment WHERE class_id = ?1 AND student_id = ?2 AND left_on IS NULL",
        params![class_id, student_id],
        |r| r.get(0),
    )?;
    if exists > 0 {
        return Err(AppError::rule("该学生已在班中"));
    }
    conn.execute(
        "INSERT INTO enrollment(id, student_id, class_id, joined_on, left_on, created_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5)",
        params![new_id(), student_id, class_id, joined_on.filter(|x| !x.is_empty()).unwrap_or_else(today_str), now_ms()],
    )?;
    Ok(())
}

/// 移出班级：只写 left_on，不删行
#[tauri::command]
pub fn unenroll_student(db: State<Db>, enrollment_id: String) -> AppResult<()> {
    let conn = lock(&db);
    conn.execute(
        "UPDATE enrollment SET left_on = ?2 WHERE id = ?1 AND left_on IS NULL",
        params![enrollment_id, fmt_date(today())],
    )?;
    Ok(())
}
