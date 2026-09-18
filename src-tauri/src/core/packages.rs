/// 一个课包在某一时刻的消耗状态
#[derive(Clone, Debug, PartialEq)]
pub struct PackageState {
    pub id: String,
    pub sessions: i64,
    pub unit_price_cents: i64,
    /// SUM(-delta) FROM ledger_entry WHERE package_id = ? AND type = 'consume'
    pub used: f64,
}

impl PackageState {
    pub fn remaining(&self) -> f64 {
        self.sessions as f64 - self.used
    }
}

/// R1 FIFO：先买先扣。`packages` 必须已按 purchased_on ASC, created_at ASC 排好。
/// 扣 0 课时（请假/缺勤）不指向任何包。
pub fn pick_package(packages: &[PackageState], need_hours: f64) -> Option<&PackageState> {
    if need_hours <= 0.0 {
        return None;
    }
    packages.iter().find(|p| p.remaining() >= need_hours)
}

/// 欠课时的折算单价（分）。
/// - package：最后一个用尽的包的单价
/// - latest：最近一次充值的单价
/// 没有任何课包时返回 0。
pub fn owed_unit_price(packages: &[PackageState], mode: &str) -> i64 {
    if packages.is_empty() {
        return 0;
    }
    match mode {
        "latest" => packages.last().map(|p| p.unit_price_cents).unwrap_or(0),
        _ => packages
            .iter()
            .filter(|p| p.remaining() <= 0.0)
            .last()
            .or_else(|| packages.last())
            .map(|p| p.unit_price_cents)
            .unwrap_or(0),
    }
}

/// 一次扣课时结转的收入（分）
pub fn consume_amount_cents(hours: f64, unit_price_cents: i64) -> i64 {
    (hours * unit_price_cents as f64).round() as i64
}

/// R3：单价 = ROUND(amount / sessions)
pub fn unit_price(amount_cents: i64, sessions: i64) -> i64 {
    if sessions <= 0 {
        return 0;
    }
    (amount_cents as f64 / sessions as f64).round() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pkg(id: &str, sessions: i64, unit: i64, used: f64) -> PackageState {
        PackageState { id: id.into(), sessions, unit_price_cents: unit, used }
    }

    #[test]
    fn fifo_picks_first_with_room() {
        let pk = vec![pkg("p1", 10, 10000, 10.0), pkg("p2", 12, 16000, 3.0)];
        assert_eq!(pick_package(&pk, 1.0).unwrap().id, "p2");
    }

    #[test]
    fn fifo_prefers_older_package() {
        let pk = vec![pkg("p1", 10, 10000, 4.0), pkg("p2", 12, 16000, 0.0)];
        assert_eq!(pick_package(&pk, 1.0).unwrap().id, "p1");
    }

    #[test]
    fn all_exhausted_means_owed() {
        let pk = vec![pkg("p1", 10, 10000, 10.0)];
        assert!(pick_package(&pk, 1.0).is_none());
    }

    #[test]
    fn zero_hours_points_to_no_package() {
        let pk = vec![pkg("p1", 10, 10000, 0.0)];
        assert!(pick_package(&pk, 0.0).is_none());
    }

    #[test]
    fn owed_price_package_mode_uses_last_exhausted() {
        let pk = vec![pkg("p1", 10, 10000, 10.0), pkg("p2", 10, 15000, 10.0)];
        assert_eq!(owed_unit_price(&pk, "package"), 15000);
    }

    #[test]
    fn owed_price_latest_mode_uses_latest_purchase() {
        let pk = vec![pkg("p1", 10, 10000, 10.0), pkg("p2", 10, 15000, 0.0)];
        assert_eq!(owed_unit_price(&pk, "latest"), 15000);
        assert_eq!(owed_unit_price(&pk, "package"), 10000);
    }

    #[test]
    fn owed_price_without_packages_is_zero() {
        assert_eq!(owed_unit_price(&[], "package"), 0);
    }

    #[test]
    fn unit_price_rounds() {
        assert_eq!(unit_price(100000, 7), 14286);
        assert_eq!(unit_price(100000, 10), 10000);
        assert_eq!(unit_price(100000, 0), 0);
    }

    #[test]
    fn consume_amount_half_hour() {
        assert_eq!(consume_amount_cents(0.5, 15000), 7500);
    }
}
