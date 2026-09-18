use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::scheduling::{expand_dates, holidays_in, is_holiday, overlaps, parse_weekdays, range_end, week_bounds};
use crate::db::{fmt_date, new_id, now_ms, parse_date, today, today_str, Db};
use crate::error::{AppError, AppResult};
use crate::models::{RecurrenceRule, Session};
use crate::repo;
use crate::settings;

use super::classes::{insert_rule, rule_summary, RuleInput, RuleSummary};
use super::lock;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuleRow {
    #[serde(flatten)]
    pub rule: RuleSummary,
    pub class_id: String,
    pub class_name: String,
    pub class_color: String,
    pub per_week: i64,
}

fn rule_rows(conn: &Connection, only_active: bool) -> AppResult<Vec<RuleRow>> {
    let sql = if only_active {
        "SELECT r.*, k.name AS class_name, k.color AS class_color FROM recurrence_rule r JOIN klass k ON k.id = r.class_id
         WHERE r.active = 1 AND k.status = 'active' ORDER BY k.created_at, r.created_at"
    } else {
        "SELECT r.*, k.name AS class_name, k.color AS class_color FROM recurrence_rule r JOIN klass k ON k.id = r.class_id
         WHERE k.status = 'active' ORDER BY r.active DESC, k.created_at, r.created_at"
    };
    let mut st = conn.prepare(sql)?;
    let rows = st
        .query_map([], |r| {
            let rule = RecurrenceRule::from_row(r)?;
            Ok((rule, r.get::<_, String>("class_name")?, r.get::<_, String>("class_color")?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(rule, class_name, class_color)| {
            let s = rule_summary(&rule);
            RuleRow { per_week: s.weekdays.len() as i64, rule: s, class_id: rule.class_id.clone(), class_name, class_color }
        })
        .collect())
}

#[tauri::command]
pub fn list_rules(db: State<Db>) -> AppResult<Vec<RuleRow>> {
    let conn = lock(&db);
    rule_rows(&conn, false)
}

/// 新建或编辑规则。编辑不改已生成的课次。
#[tauri::command]
pub fn save_rule(db: State<Db>, id: Option<String>, class_id: String, input: RuleInput) -> AppResult<String> {
    let conn = lock(&db);
    match id {
        None => insert_rule(&conn, &class_id, &input),
        Some(id) => {
            let wd: Vec<u32> = input.weekdays.iter().copied().filter(|d| (1..=7).contains(d)).collect();
            if wd.is_empty() {
                return Err(AppError::rule("至少选择一个上课日"));
            }
            super::classes::validate_time(&input.start_time)?;
            super::classes::validate_time(&input.end_time)?;
            let mut sorted = wd;
            sorted.sort_unstable();
            sorted.dedup();
            conn.execute(
                "UPDATE recurrence_rule SET weekdays = ?2, start_time = ?3, end_time = ?4, room = ?5, updated_at = ?6 WHERE id = ?1",
                params![
                    id,
                    sorted.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(","),
                    input.start_time,
                    input.end_time,
                    input.room.filter(|x| !x.trim().is_empty()),
                    now_ms()
                ],
            )?;
            Ok(id)
        }
    }
}

#[tauri::command]
pub fn set_rule_active(db: State<Db>, id: String, active: bool) -> AppResult<()> {
    let conn = lock(&db);
    conn.execute("UPDATE recurrence_rule SET active = ?2, updated_at = ?3 WHERE id = ?1", params![id, active as i64, now_ms()])?;
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRule {
    pub rule_id: String,
    pub class_id: String,
    pub class_name: String,
    pub class_color: String,
    pub count: i64,
    pub dates: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub date: String,
    pub room: String,
    pub a: String,
    pub b: String,
    pub time_a: String,
    pub time_b: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Holiday {
    pub name: String,
    pub from: String,
    pub to: String,
    /// 落在假期里的将生成课次数
    pub affected: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GeneratePreview {
    pub from: String,
    pub to: String,
    pub weeks: i64,
    pub total: i64,
    pub rules: Vec<PreviewRule>,
    pub conflicts: Vec<Conflict>,
    pub holidays: Vec<Holiday>,
    pub scheduled_through: Option<String>,
    pub last_generated_at: Option<i64>,
    pub auto_generate: bool,
    pub lead_weeks: i64,
}

/// 生成起点统一取今天：每条规则各自补齐今天到「今天 + N 周」之间还没有的课次。
/// 已存在的课次（含已取消的）由 UNIQUE(class_id, date, start_time) 跳过，所以已排过的周不会重复，
/// 后加的班级 / 时段会在同一区间内补上。
fn default_from(_conn: &Connection) -> AppResult<chrono::NaiveDate> {
    Ok(today())
}

struct Planned {
    rule_id: String,
    class_id: String,
    class_name: String,
    class_color: String,
    date: String,
    start: String,
    end: String,
    room: Option<String>,
}

fn dry_run(conn: &Connection, from: chrono::NaiveDate, weeks: i64) -> AppResult<(chrono::NaiveDate, Vec<Planned>)> {
    let to = range_end(from, weeks);
    Ok((to, dry_run_range(conn, from, to, None)?))
}

fn dry_run_range(conn: &Connection, from: chrono::NaiveDate, to: chrono::NaiveDate, only_class: Option<&str>) -> AppResult<Vec<Planned>> {
    let rules = rule_rows(conn, true)?;
    let mut out = Vec::new();
    for r in rules {
        if let Some(c) = only_class {
            if r.class_id != c {
                continue;
            }
        }
        for d in expand_dates(&r.rule.weekdays, from, to) {
            let ds = fmt_date(d);
            let exists: i64 = conn.query_row(
                "SELECT COUNT(*) FROM session WHERE class_id = ?1 AND date = ?2 AND start_time = ?3",
                params![r.class_id, ds, r.rule.start_time],
                |x| x.get(0),
            )?;
            if exists > 0 {
                continue;
            }
            out.push(Planned {
                rule_id: r.rule.id.clone(),
                class_id: r.class_id.clone(),
                class_name: r.class_name.clone(),
                class_color: r.class_color.clone(),
                date: ds,
                start: r.rule.start_time.clone(),
                end: r.rule.end_time.clone(),
                room: r.rule.room.clone(),
            });
        }
    }
    Ok(out)
}

fn build_preview(conn: &Connection, from: chrono::NaiveDate, weeks: i64) -> AppResult<GeneratePreview> {
    let (to, planned) = dry_run(conn, from, weeks)?;
    let mut rules: Vec<PreviewRule> = Vec::new();
    for p in &planned {
        if let Some(r) = rules.iter_mut().find(|r| r.rule_id == p.rule_id) {
            r.count += 1;
            r.dates.push(p.date.clone());
        } else {
            rules.push(PreviewRule {
                rule_id: p.rule_id.clone(),
                class_id: p.class_id.clone(),
                class_name: p.class_name.clone(),
                class_color: p.class_color.clone(),
                count: 1,
                dates: vec![p.date.clone()],
            });
        }
    }
    // 冲突：同教室、同日、时段重叠（含已存在课次）
    let mut conflicts = Vec::new();
    for (i, a) in planned.iter().enumerate() {
        let Some(room_a) = &a.room else { continue };
        for b in planned.iter().skip(i + 1) {
            if b.room.as_deref() == Some(room_a) && b.date == a.date && overlaps(&a.start, &a.end, &b.start, &b.end) {
                conflicts.push(Conflict {
                    date: a.date.clone(),
                    room: room_a.clone(),
                    a: a.class_name.clone(),
                    b: b.class_name.clone(),
                    time_a: format!("{} – {}", a.start, a.end),
                    time_b: format!("{} – {}", b.start, b.end),
                });
            }
        }
        let mut st = conn.prepare(
            "SELECT s.start_time, s.end_time, k.name FROM session s JOIN klass k ON k.id = s.class_id
             WHERE s.date = ?1 AND s.room = ?2 AND s.status != 'cancelled'",
        )?;
        let existing: Vec<(String, String, String)> = st
            .query_map(params![a.date, room_a], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (s, e, name) in existing {
            if overlaps(&a.start, &a.end, &s, &e) {
                conflicts.push(Conflict {
                    date: a.date.clone(),
                    room: room_a.clone(),
                    a: a.class_name.clone(),
                    b: format!("{}（已有）", name),
                    time_a: format!("{} – {}", a.start, a.end),
                    time_b: format!("{} – {}", s, e),
                });
            }
        }
    }
    let holidays = holidays_in(from, to)
        .into_iter()
        .map(|(name, s, e)| Holiday {
            affected: planned.iter().filter(|p| parse_date(&p.date).map(|d| d >= s && d <= e).unwrap_or(false)).count() as i64,
            name,
            from: fmt_date(s),
            to: fmt_date(e),
        })
        .collect();
    let scheduled_through: Option<String> = conn
        .query_row("SELECT MAX(date) FROM session WHERE status != 'cancelled'", [], |r| r.get(0))
        .unwrap_or(None);
    let sch = settings::load(conn).scheduling;
    Ok(GeneratePreview {
        from: fmt_date(from),
        to: fmt_date(to),
        weeks,
        total: planned.len() as i64,
        rules,
        conflicts,
        holidays,
        scheduled_through,
        last_generated_at: sch.last_generated_at,
        auto_generate: sch.auto_generate,
        lead_weeks: sch.lead_weeks,
    })
}

#[tauri::command]
pub fn preview_generate(db: State<Db>, weeks: i64, from: Option<String>) -> AppResult<GeneratePreview> {
    let conn = lock(&db);
    let from = match from {
        Some(f) if !f.is_empty() => parse_date(&f)?,
        _ => default_from(&conn)?,
    };
    build_preview(&conn, from, weeks.clamp(1, 12))
}

/// R5 批量生成，幂等
pub fn generate_inner(conn: &mut Connection, from: chrono::NaiveDate, weeks: i64) -> AppResult<i64> {
    generate_range_inner(conn, from, range_end(from, weeks), None)
}

/// 在 [from, to] 内生成；only_class 限定只生成某个班（班级改上课时间后补排用）
pub fn generate_range_inner(conn: &mut Connection, from: chrono::NaiveDate, to: chrono::NaiveDate, only_class: Option<&str>) -> AppResult<i64> {
    let planned = dry_run_range(conn, from, to, only_class)?;
    let now = now_ms();
    let tx = conn.transaction()?;
    let mut created = 0;
    for p in &planned {
        let n = tx.execute(
            "INSERT OR IGNORE INTO session(id, class_id, rule_id, date, start_time, end_time, room, kind, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'regular', 'planned', ?8, ?8)",
            params![new_id(), p.class_id, p.rule_id, p.date, p.start, p.end, p.room, now],
        )?;
        created += n as i64;
    }
    match only_class {
        Some(c) => tx.execute(
            "UPDATE recurrence_rule SET generated_through = ?1, updated_at = ?2 WHERE active = 1 AND class_id = ?3 AND (generated_through IS NULL OR generated_through < ?1)",
            params![fmt_date(to), now, c],
        )?,
        None => tx.execute(
            "UPDATE recurrence_rule SET generated_through = ?1, updated_at = ?2 WHERE active = 1 AND (generated_through IS NULL OR generated_through < ?1)",
            params![fmt_date(to), now],
        )?,
    };
    let mut sch = settings::load(&tx).scheduling;
    sch.last_generated_at = Some(now);
    settings::write_key(&tx, "scheduling", &sch)?;
    tx.commit()?;
    Ok(created)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GenerateResult {
    pub created: i64,
    pub from: String,
    pub to: String,
}

#[tauri::command]
pub fn generate_sessions(db: State<Db>, weeks: i64, from: Option<String>) -> AppResult<GenerateResult> {
    let mut conn = lock(&db);
    let from = match from {
        Some(f) if !f.is_empty() => parse_date(&f)?,
        _ => default_from(&conn)?,
    };
    let weeks = weeks.clamp(1, 12);
    let created = generate_inner(&mut conn, from, weeks)?;
    Ok(GenerateResult { created, from: fmt_date(from), to: fmt_date(range_end(from, weeks)) })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NegativeStudent {
    pub id: String,
    pub name: String,
    pub after: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    #[serde(flatten)]
    pub session: Session,
    pub class_name: String,
    pub class_color: String,
    pub enrolled: i64,
    pub ordinal: i64,
    /// planned：预计扣；taken：已扣
    pub hours: f64,
    pub present_count: i64,
    pub attendance_total: i64,
    pub leave_count: i64,
    pub absent_count: i64,
    /// 待点名时扣后为负的学生
    pub negative_names: Vec<String>,
    /// 同上，附扣后余额
    pub negative_students: Vec<NegativeStudent>,
    pub holiday: Option<String>,
}

pub fn session_view(conn: &Connection, s: Session, balances: &std::collections::HashMap<String, f64>, present_cost: f64) -> AppResult<SessionView> {
    let k = repo::klass(conn, &s.class_id)?;
    let ordinal = repo::session_ordinal(conn, &s)?;
    let brief = super::classes::session_brief(conn, s.clone())?;
    let mut hours = brief.hours_deducted;
    let mut negative_names = Vec::new();
    let mut negative_students = Vec::new();
    let enrolled: i64;
    if s.status == "planned" {
        let students = repo::enrolled_students(conn, &s.class_id, &s.date)?;
        enrolled = students.len() as i64;
        hours = present_cost * students.iter().filter(|x| !x.is_free()).count() as f64;
        for st in students.iter().filter(|x| !x.is_free()) {
            let b = *balances.get(&st.id).unwrap_or(&0.0);
            if b - present_cost < 0.0 {
                negative_names.push(st.name.clone());
                negative_students.push(NegativeStudent { id: st.id.clone(), name: st.name.clone(), after: b - present_cost });
            }
        }
    } else {
        enrolled = if brief.attendance_total > 0 { brief.attendance_total } else { repo::enrolled_students(conn, &s.class_id, &s.date)?.len() as i64 };
    }
    let holiday = parse_date(&s.date).ok().and_then(is_holiday).map(|x| x.to_string());
    Ok(SessionView {
        session: s,
        class_name: k.name,
        class_color: k.color,
        enrolled,
        ordinal,
        hours,
        present_count: brief.present_count,
        attendance_total: brief.attendance_total,
        leave_count: brief.leave_count,
        absent_count: brief.absent_count,
        negative_names,
        negative_students,
        holiday,
    })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WeekView {
    pub from: String,
    pub to: String,
    pub today: String,
    pub sessions: Vec<SessionView>,
    pub classes: Vec<super::classes::ClassCard>,
}

/// 某周的课表。date 为该周内任意一天，默认今天
#[tauri::command]
pub fn list_sessions(db: State<Db>, date: Option<String>) -> AppResult<WeekView> {
    let conn = lock(&db);
    let anchor = match date {
        Some(d) if !d.is_empty() => parse_date(&d)?,
        _ => today(),
    };
    let (mon, sun) = week_bounds(anchor);
    let balances = repo::balances(&conn)?;
    let rule = settings::hours_rule(&conn);
    let mut st = conn.prepare("SELECT * FROM session WHERE date BETWEEN ?1 AND ?2 ORDER BY date, start_time")?;
    let rows = st.query_map(params![fmt_date(mon), fmt_date(sun)], Session::from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut sessions = Vec::new();
    for s in rows {
        sessions.push(session_view(&conn, s, &balances, rule.present)?);
    }
    drop(st);
    let classes = {
        let mut st = conn.prepare("SELECT * FROM klass WHERE status = 'active' ORDER BY created_at")?;
        let ks = st.query_map([], crate::models::Klass::from_row)?.collect::<Result<Vec<_>, _>>()?;
        let mut out = Vec::new();
        for k in ks {
            let enrolled = repo::enrolled_count(&conn, &k.id)?;
            out.push(super::classes::ClassCard {
                rules: super::classes::class_rules(&conn, &k.id)?,
                enrolled,
                initials: vec![],
                taken_count: 0,
                generated_through: None,
                month_sessions: 0,
                month_consumed: 0.0,
                month_revenue_cents: 0,
                owed_count: 0,
                zero_count: 0,
                next_session_id: None,
                klass: k,
            });
        }
        out
    };
    Ok(WeekView { from: fmt_date(mon), to: fmt_date(sun), today: today_str(), sessions, classes })
}

#[tauri::command]
pub fn cancel_session(db: State<Db>, id: String, reason: Option<String>) -> AppResult<()> {
    let conn = lock(&db);
    let s = repo::session(&conn, &id)?;
    if s.status == "taken" {
        return Err(AppError::rule("已点名的课次不能取消，请先撤销点名"));
    }
    if s.status == "cancelled" {
        return Err(AppError::rule("课次已取消"));
    }
    conn.execute(
        "UPDATE session SET status = 'cancelled', cancel_reason = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, reason.filter(|x| !x.trim().is_empty()), now_ms()],
    )?;
    Ok(())
}

/// 删除一节还没点名、没有任何流水的课次（误加 / 多排的）。已点名的先撤销点名。
#[tauri::command]
pub fn delete_session(db: State<Db>, id: String) -> AppResult<()> {
    let conn = lock(&db);
    let s = repo::session(&conn, &id)?;
    if s.status == "taken" {
        return Err(AppError::rule("这节课已点名，不能删除；如需作废请先撤销点名"));
    }
    let refs: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM attendance WHERE session_id = ?1) + (SELECT COUNT(*) FROM ledger_entry WHERE session_id = ?1)",
        params![id],
        |r| r.get(0),
    )?;
    if refs > 0 {
        return Err(AppError::rule("这节课有点名或流水记录，不能删除"));
    }
    conn.execute("DELETE FROM session WHERE id = ?1", params![id])?;
    Ok(())
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExtraSessionInput {
    pub class_id: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub room: Option<String>,
    pub note: Option<String>,
}

#[tauri::command]
pub fn add_extra_session(db: State<Db>, input: ExtraSessionInput) -> AppResult<Session> {
    let conn = lock(&db);
    parse_date(&input.date)?;
    super::classes::validate_time(&input.start_time)?;
    super::classes::validate_time(&input.end_time)?;
    let id = new_id();
    let now = now_ms();
    let n = conn.execute(
        "INSERT OR IGNORE INTO session(id, class_id, rule_id, date, start_time, end_time, room, kind, status, note, created_at, updated_at)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, 'extra', 'planned', ?7, ?8, ?8)",
        params![id, input.class_id, input.date, input.start_time, input.end_time, input.room.filter(|x| !x.trim().is_empty()), input.note.filter(|x| !x.trim().is_empty()), now],
    )?;
    if n == 0 {
        return Err(AppError::rule("该班级在这个时间已有课次"));
    }
    repo::session(&conn, &id)
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionPatch {
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub room: Option<String>,
    pub note: Option<String>,
}

/// 改单次课的时间（不动规则）
#[tauri::command]
pub fn update_session(db: State<Db>, id: String, patch: SessionPatch) -> AppResult<Session> {
    let conn = lock(&db);
    let s = repo::session(&conn, &id)?;
    if s.status != "planned" {
        return Err(AppError::rule("只有待点名的课次可以改时间"));
    }
    parse_date(&patch.date)?;
    super::classes::validate_time(&patch.start_time)?;
    super::classes::validate_time(&patch.end_time)?;
    let r = conn.execute(
        "UPDATE session SET date = ?2, start_time = ?3, end_time = ?4, room = ?5, note = ?6, updated_at = ?7 WHERE id = ?1",
        params![id, patch.date, patch.start_time, patch.end_time, patch.room.filter(|x| !x.trim().is_empty()), patch.note.filter(|x| !x.trim().is_empty()), now_ms()],
    );
    match r {
        Ok(_) => repo::session(&conn, &id),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == rusqlite::ErrorCode::ConstraintViolation => {
            Err(AppError::rule("该班级在这个时间已有课次"))
        }
        Err(e) => Err(e.into()),
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Adjustment {
    #[serde(flatten)]
    pub session: Session,
    pub class_name: String,
    pub class_color: String,
    /// cancel | extra
    pub kind_label: String,
}

#[tauri::command]
pub fn recent_adjustments(db: State<Db>) -> AppResult<Vec<Adjustment>> {
    let conn = lock(&db);
    let mut st = conn.prepare(
        "SELECT s.*, k.name AS class_name, k.color AS class_color FROM session s JOIN klass k ON k.id = s.class_id
         WHERE s.status = 'cancelled' OR s.kind = 'extra' ORDER BY s.updated_at DESC LIMIT 6",
    )?;
    let rows = st
        .query_map([], |r| {
            let s = Session::from_row(r)?;
            let kind_label = if s.status == "cancelled" { "cancel" } else { "extra" }.to_string();
            Ok(Adjustment { session: s, class_name: r.get("class_name")?, class_color: r.get("class_color")?, kind_label })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[allow(dead_code)]
pub fn weekdays_of(rule: &RecurrenceRule) -> Vec<u32> {
    parse_weekdays(&rule.weekdays)
}
