use serde::{Deserialize, Serialize};

/// setting['hours_rule']
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HoursRule {
    pub present: f64,
    pub late: f64,
    pub leave: f64,
    pub absent: f64,
    pub allow_negative: bool,
    pub auto_offset_on_recharge: bool,
    /// package | latest
    pub owed_price_mode: String,
    pub undo_window_days: i64,
}

impl Default for HoursRule {
    fn default() -> Self {
        HoursRule {
            present: 1.0,
            late: 1.0,
            leave: 0.0,
            absent: 0.0,
            allow_negative: true,
            auto_offset_on_recharge: true,
            owed_price_mode: "package".into(),
            undo_window_days: 7,
        }
    }
}

pub const STATUSES: [&str; 4] = ["present", "late", "leave", "absent"];

impl HoursRule {
    /// 某个点名状态扣多少课时（规则快照在调用时取）
    pub fn cost(&self, status: &str) -> f64 {
        match status {
            "present" => self.present,
            "late" => self.late,
            "leave" => self.leave,
            "absent" => self.absent,
            _ => 0.0,
        }
    }
}

pub fn status_label(status: &str) -> &'static str {
    match status {
        "present" => "出勤",
        "late" => "迟到",
        "leave" => "请假",
        "absent" => "缺勤",
        _ => "未知",
    }
}

pub fn is_valid_status(status: &str) -> bool {
    STATUSES.contains(&status)
}

/// 点名前的学生快照
#[derive(Clone, Debug)]
pub struct StudentBalance {
    pub id: String,
    pub name: String,
    pub balance: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mark {
    pub student_id: String,
    pub status: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RollcallLine {
    pub student_id: String,
    pub status: String,
    pub hours: f64,
    pub balance_before: f64,
    pub balance_after: f64,
}

#[derive(Clone, Debug, Default)]
pub struct RollcallPlan {
    pub lines: Vec<RollcallLine>,
    pub total_hours: f64,
    /// allow_negative = false 时余额不够的学生姓名
    pub insufficient: Vec<String>,
}

/// R1：按规则算每个人扣多少、扣后余额。不写库。
pub fn plan_rollcall(rule: &HoursRule, students: &[StudentBalance], marks: &[Mark]) -> Result<RollcallPlan, String> {
    let mut plan = RollcallPlan::default();
    for m in marks {
        if !is_valid_status(&m.status) {
            return Err(format!("无效的点名状态：{}", m.status));
        }
        let s = students
            .iter()
            .find(|s| s.id == m.student_id)
            .ok_or_else(|| format!("学生不在本次名单中：{}", m.student_id))?;
        let hours = rule.cost(&m.status);
        let after = s.balance - hours;
        if !rule.allow_negative && hours > 0.0 && after < 0.0 {
            plan.insufficient.push(s.name.clone());
        }
        plan.total_hours += hours;
        plan.lines.push(RollcallLine {
            student_id: s.id.clone(),
            status: m.status.clone(),
            hours,
            balance_before: s.balance,
            balance_after: after,
        });
    }
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn students() -> Vec<StudentBalance> {
        vec![
            StudentBalance { id: "a".into(), name: "A".into(), balance: 2.0 },
            StudentBalance { id: "b".into(), name: "B".into(), balance: 0.0 },
            StudentBalance { id: "c".into(), name: "C".into(), balance: -2.0 },
        ]
    }
    fn mark(id: &str, st: &str) -> Mark {
        Mark { student_id: id.into(), status: st.into() }
    }

    #[test]
    fn default_rule_costs() {
        let r = HoursRule::default();
        assert_eq!(r.cost("present"), 1.0);
        assert_eq!(r.cost("late"), 1.0);
        assert_eq!(r.cost("leave"), 0.0);
        assert_eq!(r.cost("absent"), 0.0);
    }

    #[test]
    fn balance_two_present_becomes_one() {
        let p = plan_rollcall(&HoursRule::default(), &students(), &[mark("a", "present")]).unwrap();
        assert_eq!(p.lines[0].balance_after, 1.0);
        assert_eq!(p.total_hours, 1.0);
    }

    #[test]
    fn balance_zero_present_becomes_negative_one() {
        let p = plan_rollcall(&HoursRule::default(), &students(), &[mark("b", "present")]).unwrap();
        assert_eq!(p.lines[0].balance_after, -1.0);
        assert!(p.insufficient.is_empty());
    }

    #[test]
    fn negative_balance_leave_writes_zero_delta_line() {
        let p = plan_rollcall(&HoursRule::default(), &students(), &[mark("c", "leave")]).unwrap();
        assert_eq!(p.lines.len(), 1);
        assert_eq!(p.lines[0].hours, 0.0);
        assert_eq!(p.lines[0].balance_after, -2.0);
    }

    #[test]
    fn disallow_negative_reports_insufficient_students() {
        let rule = HoursRule { allow_negative: false, ..Default::default() };
        let p = plan_rollcall(&rule, &students(), &[mark("a", "present"), mark("b", "present"), mark("c", "leave")]).unwrap();
        assert_eq!(p.insufficient, vec!["B".to_string()]);
    }

    #[test]
    fn unknown_student_rejected() {
        assert!(plan_rollcall(&HoursRule::default(), &students(), &[mark("zzz", "present")]).is_err());
    }

    #[test]
    fn invalid_status_rejected() {
        assert!(plan_rollcall(&HoursRule::default(), &students(), &[mark("a", "sleep")]).is_err());
    }

    #[test]
    fn custom_rule_snapshot() {
        let rule = HoursRule { late: 0.5, leave: 1.0, ..Default::default() };
        let p = plan_rollcall(&rule, &students(), &[mark("a", "late"), mark("b", "leave")]).unwrap();
        assert_eq!(p.lines[0].hours, 0.5);
        assert_eq!(p.lines[1].hours, 1.0);
        assert_eq!(p.total_hours, 1.5);
    }
}
