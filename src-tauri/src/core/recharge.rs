use serde::{Deserialize, Serialize};

use super::packages::unit_price;

/// R3 两种欠课时处理方式
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OwedMode {
    /// 方式 A：从本次充值中抵扣
    Offset,
    /// 方式 B：欠款另行补缴
    Cash,
}

/// 「将写入的流水」的描述
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedEntry {
    /// recharge | adjust
    pub entry_type: String,
    pub delta: f64,
    pub balance_after: f64,
    pub amount_cents: i64,
    pub reason: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RechargePlan {
    pub unit_price_cents: i64,
    /// package.offset_sessions
    pub offset_sessions: i64,
    pub entries: Vec<PlannedEntry>,
    /// 本次实收（分）
    pub received_cents: i64,
    pub balance_after: f64,
}

pub fn fmt_yuan(cents: i64) -> String {
    let neg = cents < 0;
    let abs = cents.abs();
    let yuan = abs / 100;
    let fen = abs % 100;
    let mut s = String::new();
    let digits = yuan.to_string();
    let n = digits.len();
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (n - i) % 3 == 0 {
            s.push(',');
        }
        s.push(ch);
    }
    let body = if fen == 0 { s } else { format!("{}.{:02}", s, fen) };
    if neg {
        format!("−¥{}", body)
    } else {
        format!("¥{}", body)
    }
}

/// R3：给定当前余额和表单，算出要写的课包和流水。不写库。
pub fn plan_recharge(
    balance: f64,
    sessions: i64,
    amount_cents: i64,
    mode: OwedMode,
    owed_unit_price_cents: i64,
) -> Result<RechargePlan, String> {
    if sessions <= 0 {
        return Err("课次必须大于 0".into());
    }
    if amount_cents <= 0 {
        return Err("金额必须大于 0".into());
    }
    let unit = unit_price(amount_cents, sessions);
    let owed = if balance < 0.0 { -balance } else { 0.0 };
    let recharge_reason = format!("课包 {} 课次 · {}", sessions, fmt_yuan(amount_cents));

    if owed <= 0.0 {
        // 余额为正/零：两种方式等价，不抵扣
        return Ok(RechargePlan {
            unit_price_cents: unit,
            offset_sessions: 0,
            entries: vec![PlannedEntry {
                entry_type: "recharge".into(),
                delta: sessions as f64,
                balance_after: balance + sessions as f64,
                amount_cents,
                reason: recharge_reason,
            }],
            received_cents: amount_cents,
            balance_after: balance + sessions as f64,
        });
    }

    match mode {
        OwedMode::Offset => {
            // 不写额外的抵扣分录：-2 + 10 = 8 已含抵扣
            let offset = owed.min(sessions as f64).ceil() as i64;
            let after = balance + sessions as f64;
            Ok(RechargePlan {
                unit_price_cents: unit,
                offset_sessions: offset,
                entries: vec![PlannedEntry {
                    entry_type: "recharge".into(),
                    delta: sessions as f64,
                    balance_after: after,
                    amount_cents,
                    reason: recharge_reason,
                }],
                received_cents: amount_cents,
                balance_after: after,
            })
        }
        OwedMode::Cash => {
            let owed_cents = (owed * owed_unit_price_cents as f64).round() as i64;
            let after_adjust = balance + owed; // = 0
            let after = after_adjust + sessions as f64;
            Ok(RechargePlan {
                unit_price_cents: unit,
                offset_sessions: 0,
                entries: vec![
                    PlannedEntry {
                        entry_type: "adjust".into(),
                        delta: owed,
                        balance_after: after_adjust,
                        amount_cents: owed_cents,
                        reason: format!("结清此前欠 {} 课时", trim_num(owed)),
                    },
                    PlannedEntry {
                        entry_type: "recharge".into(),
                        delta: sessions as f64,
                        balance_after: after,
                        amount_cents,
                        reason: recharge_reason,
                    },
                ],
                received_cents: amount_cents + owed_cents,
                balance_after: after,
            })
        }
    }
}

pub fn trim_num(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{}", v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offset_mode_minus_two_plus_ten() {
        let p = plan_recharge(-2.0, 10, 100000, OwedMode::Offset, 15000).unwrap();
        assert_eq!(p.balance_after, 8.0);
        assert_eq!(p.offset_sessions, 2);
        assert_eq!(p.received_cents, 100000);
        assert_eq!(p.entries.len(), 1);
        assert_eq!(p.entries[0].entry_type, "recharge");
        assert_eq!(p.entries[0].delta, 10.0);
        assert_eq!(p.entries[0].balance_after, 8.0);
        assert_eq!(p.unit_price_cents, 10000);
    }

    #[test]
    fn cash_mode_minus_two_plus_ten() {
        let p = plan_recharge(-2.0, 10, 100000, OwedMode::Cash, 15000).unwrap();
        assert_eq!(p.balance_after, 10.0);
        assert_eq!(p.offset_sessions, 0);
        assert_eq!(p.received_cents, 130000);
        assert_eq!(p.entries.len(), 2);
        assert_eq!(p.entries[0].entry_type, "adjust");
        assert_eq!(p.entries[0].delta, 2.0);
        assert_eq!(p.entries[0].balance_after, 0.0);
        assert_eq!(p.entries[0].amount_cents, 30000);
        assert_eq!(p.entries[0].reason, "结清此前欠 2 课时");
        assert_eq!(p.entries[1].balance_after, 10.0);
    }

    #[test]
    fn owed_five_recharge_three_still_owes_two() {
        let p = plan_recharge(-5.0, 3, 45000, OwedMode::Offset, 15000).unwrap();
        assert_eq!(p.balance_after, -2.0);
        assert_eq!(p.offset_sessions, 3);
    }

    #[test]
    fn positive_balance_has_no_offset_in_either_mode() {
        let a = plan_recharge(4.0, 10, 100000, OwedMode::Offset, 15000).unwrap();
        let b = plan_recharge(4.0, 10, 100000, OwedMode::Cash, 15000).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.offset_sessions, 0);
        assert_eq!(a.balance_after, 14.0);
        assert_eq!(a.entries.len(), 1);
    }

    #[test]
    fn zero_sessions_or_amount_rejected() {
        assert!(plan_recharge(0.0, 0, 1000, OwedMode::Offset, 0).is_err());
        assert!(plan_recharge(0.0, 10, 0, OwedMode::Offset, 0).is_err());
    }

    #[test]
    fn unit_price_rounding_seven_sessions() {
        let p = plan_recharge(0.0, 7, 100000, OwedMode::Offset, 0).unwrap();
        assert_eq!(p.unit_price_cents, 14286);
    }

    #[test]
    fn yuan_format() {
        assert_eq!(fmt_yuan(100000), "¥1,000");
        assert_eq!(fmt_yuan(360000), "¥3,600");
        assert_eq!(fmt_yuan(-30000), "−¥300");
        assert_eq!(fmt_yuan(1428650), "¥14,286.50");
    }
}
