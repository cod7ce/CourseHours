use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::core::hours::HoursRule;
use crate::db::now_ms;
use crate::error::AppResult;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlertsSetting {
    pub low_balance_threshold: f64,
    pub owed_alert_threshold: f64,
    pub daily_digest: bool,
    pub daily_digest_at: String,
    pub schedule_lead_days: i64,
    pub channels: Vec<String>,
}
impl Default for AlertsSetting {
    fn default() -> Self {
        Self {
            low_balance_threshold: 3.0,
            owed_alert_threshold: 3.0,
            daily_digest: true,
            daily_digest_at: "10:00".into(),
            schedule_lead_days: 7,
            channels: vec!["desktop".into(), "badge".into()],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackagePreset {
    pub sessions: i64,
    pub amount_cents: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DefaultsSetting {
    pub class_capacity: i64,
    pub duration_min: i64,
    pub default_room: String,
    pub rooms: Vec<String>,
    pub payment_methods: Vec<String>,
    pub package_presets: Vec<PackagePreset>,
}
impl Default for DefaultsSetting {
    fn default() -> Self {
        Self {
            class_capacity: 10,
            duration_min: 90,
            default_room: "长桌大厅".into(),
            rooms: vec!["长桌大厅".into()],
            payment_methods: vec!["wechat".into(), "alipay".into(), "cash".into(), "transfer".into()],
            package_presets: vec![
                PackagePreset { sessions: 24, amount_cents: 360000 },
                PackagePreset { sessions: 12, amount_cents: 192000 },
                PackagePreset { sessions: 10, amount_cents: 170000 },
            ],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OrgSetting {
    pub name: String,
    pub owner: String,
    pub phone: String,
    pub address: String,
    pub logo_path: Option<String>,
    pub receipt_title: String,
    pub receipt_footer: String,
}
impl Default for OrgSetting {
    fn default() -> Self {
        Self {
            name: "晓夏老师英语班".into(),
            owner: String::new(),
            phone: String::new(),
            address: String::new(),
            logo_path: None,
            receipt_title: String::new(),
            receipt_footer: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupSetting {
    pub auto: bool,
    pub at: String,
    pub keep: i64,
}
impl Default for BackupSetting {
    fn default() -> Self {
        Self { auto: true, at: "22:00".into(), keep: 30 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SchedulingSetting {
    pub auto_generate: bool,
    pub lead_weeks: i64,
    pub last_generated_at: Option<i64>,
}
impl Default for SchedulingSetting {
    fn default() -> Self {
        Self { auto_generate: true, lead_weeks: 1, last_generated_at: None }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AllSettings {
    pub hours_rule: HoursRule,
    pub alerts: AlertsSetting,
    pub defaults: DefaultsSetting,
    pub org: OrgSetting,
    pub backup: BackupSetting,
    pub scheduling: SchedulingSetting,
}

fn read_key<T: for<'de> Deserialize<'de> + Default>(conn: &Connection, key: &str) -> T {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM setting WHERE key = ?1", params![key], |r| r.get(0))
        .ok();
    raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn write_key<T: Serialize>(conn: &Connection, key: &str, value: &T) -> AppResult<()> {
    let json = serde_json::to_string(value)?;
    conn.execute(
        "INSERT INTO setting(key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, json, now_ms()],
    )?;
    Ok(())
}

pub fn load(conn: &Connection) -> AllSettings {
    AllSettings {
        hours_rule: read_key(conn, "hours_rule"),
        alerts: read_key(conn, "alerts"),
        defaults: read_key(conn, "defaults"),
        org: read_key(conn, "org"),
        backup: read_key(conn, "backup"),
        scheduling: read_key(conn, "scheduling"),
    }
}

pub fn save(conn: &Connection, s: &AllSettings) -> AppResult<()> {
    write_key(conn, "hours_rule", &s.hours_rule)?;
    write_key(conn, "alerts", &s.alerts)?;
    write_key(conn, "defaults", &s.defaults)?;
    write_key(conn, "org", &s.org)?;
    write_key(conn, "backup", &s.backup)?;
    write_key(conn, "scheduling", &s.scheduling)?;
    Ok(())
}

/// 首次启动写入默认值（已有的 key 不覆盖）
pub fn seed_defaults(conn: &Connection) -> AppResult<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM setting", [], |r| r.get(0))?;
    if count == 0 {
        save(conn, &AllSettings::default())?;
    }
    Ok(())
}

pub fn hours_rule(conn: &Connection) -> HoursRule {
    read_key(conn, "hours_rule")
}
