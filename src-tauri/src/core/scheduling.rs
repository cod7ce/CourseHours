use chrono::{Datelike, Duration, NaiveDate};

/// '2,4' → [2, 4]（ISO：1=周一 … 7=周日）
pub fn parse_weekdays(s: &str) -> Vec<u32> {
    let mut v: Vec<u32> = s
        .split(',')
        .filter_map(|x| x.trim().parse::<u32>().ok())
        .filter(|x| (1..=7).contains(x))
        .collect();
    v.sort_unstable();
    v.dedup();
    v
}

pub fn weekday_label(d: u32) -> &'static str {
    match d {
        1 => "周一",
        2 => "周二",
        3 => "周三",
        4 => "周四",
        5 => "周五",
        6 => "周六",
        7 => "周日",
        _ => "?",
    }
}

/// R5：把规则的星期几展开成 [from, to] 内的日期（含两端）
pub fn expand_dates(weekdays: &[u32], from: NaiveDate, to: NaiveDate) -> Vec<NaiveDate> {
    let mut out = Vec::new();
    let mut d = from;
    while d <= to {
        if weekdays.contains(&d.weekday().number_from_monday()) {
            out.push(d);
        }
        d += Duration::days(1);
    }
    out
}

/// 生成区间：from + weeks*7 - 1
pub fn range_end(from: NaiveDate, weeks: i64) -> NaiveDate {
    from + Duration::days(weeks * 7 - 1)
}

/// 所在周的周一与周日
pub fn week_bounds(d: NaiveDate) -> (NaiveDate, NaiveDate) {
    let offset = d.weekday().number_from_monday() as i64 - 1;
    let monday = d - Duration::days(offset);
    (monday, monday + Duration::days(6))
}

/// 'HH:MM' → 分钟数
pub fn minutes(t: &str) -> i64 {
    let mut it = t.split(':');
    let h: i64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let m: i64 = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    h * 60 + m
}

#[allow(dead_code)]
pub fn add_minutes(t: &str, add: i64) -> String {
    let total = (minutes(t) + add).rem_euclid(24 * 60);
    format!("{:02}:{:02}", total / 60, total % 60)
}

/// 两个时段是否重叠（半开区间）
pub fn overlaps(a_start: &str, a_end: &str, b_start: &str, b_end: &str) -> bool {
    minutes(a_start) < minutes(b_end) && minutes(b_start) < minutes(a_end)
}

/// 法定节假日静态表（仅用于生成前提示，不自动跳过）
pub const HOLIDAYS: &[(&str, &str, &str)] = &[
    ("2026-01-01", "2026-01-03", "元旦"),
    ("2026-02-15", "2026-02-23", "春节"),
    ("2026-04-04", "2026-04-06", "清明节"),
    ("2026-05-01", "2026-05-05", "劳动节"),
    ("2026-06-19", "2026-06-21", "端午节"),
    ("2026-09-25", "2026-09-27", "中秋节"),
    ("2026-10-01", "2026-10-07", "国庆节"),
    ("2027-01-01", "2027-01-03", "元旦"),
    ("2027-02-05", "2027-02-11", "春节"),
    ("2027-04-03", "2027-04-05", "清明节"),
    ("2027-05-01", "2027-05-05", "劳动节"),
    ("2027-06-09", "2027-06-11", "端午节"),
    ("2027-09-15", "2027-09-17", "中秋节"),
    ("2027-10-01", "2027-10-07", "国庆节"),
];

/// 区间内的节假日：(名称, 起, 止)
pub fn holidays_in(from: NaiveDate, to: NaiveDate) -> Vec<(String, NaiveDate, NaiveDate)> {
    HOLIDAYS
        .iter()
        .filter_map(|(s, e, name)| {
            let s = NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
            let e = NaiveDate::parse_from_str(e, "%Y-%m-%d").ok()?;
            if s <= to && e >= from {
                Some((name.to_string(), s, e))
            } else {
                None
            }
        })
        .collect()
}

pub fn is_holiday(d: NaiveDate) -> Option<&'static str> {
    HOLIDAYS.iter().find_map(|(s, e, name)| {
        let s = NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()?;
        let e = NaiveDate::parse_from_str(e, "%Y-%m-%d").ok()?;
        if d >= s && d <= e {
            Some(*name)
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn parses_weekdays() {
        assert_eq!(parse_weekdays("4,2"), vec![2, 4]);
        assert_eq!(parse_weekdays("2, 2, 9"), vec![2]);
    }

    #[test]
    fn expands_two_weeks_tue_thu() {
        // 2026-09-21 是周一
        let from = d("2026-09-21");
        let to = range_end(from, 2);
        assert_eq!(to, d("2026-10-04"));
        let dates = expand_dates(&[2, 4], from, to);
        assert_eq!(dates.len(), 4);
        assert_eq!(dates[0], d("2026-09-22"));
        assert_eq!(dates[3], d("2026-10-01"));
    }

    #[test]
    fn expands_single_saturday() {
        let dates = expand_dates(&[6], d("2026-09-21"), range_end(d("2026-09-21"), 2));
        assert_eq!(dates, vec![d("2026-09-26"), d("2026-10-03")]);
    }

    #[test]
    fn week_bounds_of_thursday() {
        assert_eq!(week_bounds(d("2026-09-17")), (d("2026-09-14"), d("2026-09-20")));
        assert_eq!(week_bounds(d("2026-09-20")), (d("2026-09-14"), d("2026-09-20")));
    }

    #[test]
    fn overlap_detection() {
        assert!(overlaps("14:00", "15:30", "15:00", "16:30"));
        assert!(!overlaps("14:00", "15:30", "15:30", "17:00"));
        assert!(overlaps("09:00", "12:00", "10:00", "11:00"));
    }

    #[test]
    fn holidays_in_range() {
        let h = holidays_in(d("2026-09-21"), d("2026-10-04"));
        let names: Vec<_> = h.iter().map(|x| x.0.clone()).collect();
        assert_eq!(names, vec!["中秋节", "国庆节"]);
        assert_eq!(is_holiday(d("2026-10-01")), Some("国庆节"));
        assert_eq!(is_holiday(d("2026-09-21")), None);
    }

    #[test]
    fn add_minutes_wraps() {
        assert_eq!(add_minutes("14:00", 90), "15:30");
        assert_eq!(add_minutes("23:30", 60), "00:30");
    }
}
