use rusqlite::Row;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Student {
    pub id: String,
    pub name: String,
    pub en_name: Option<String>,
    pub status: String,
    pub enrolled_on: String,
    pub guardian_name: Option<String>,
    pub phone: Option<String>,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Student {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Student {
            id: r.get("id")?,
            name: r.get("name")?,
            en_name: r.get("en_name")?,
            status: r.get("status")?,
            enrolled_on: r.get("enrolled_on")?,
            guardian_name: r.get("guardian_name")?,
            phone: r.get("phone")?,
            note: r.get("note")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Klass {
    pub id: String,
    pub name: String,
    pub color: String,
    pub room: Option<String>,
    pub capacity: i64,
    pub duration_min: i64,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Klass {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Klass {
            id: r.get("id")?,
            name: r.get("name")?,
            color: r.get("color")?,
            room: r.get("room")?,
            capacity: r.get("capacity")?,
            duration_min: r.get("duration_min")?,
            status: r.get("status")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    }
}

#[allow(dead_code)]
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Enrollment {
    pub id: String,
    pub student_id: String,
    pub class_id: String,
    pub joined_on: String,
    pub left_on: Option<String>,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecurrenceRule {
    pub id: String,
    pub class_id: String,
    pub weekdays: String,
    pub start_time: String,
    pub end_time: String,
    pub room: Option<String>,
    pub active: bool,
    pub generated_through: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl RecurrenceRule {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(RecurrenceRule {
            id: r.get("id")?,
            class_id: r.get("class_id")?,
            weekdays: r.get("weekdays")?,
            start_time: r.get("start_time")?,
            end_time: r.get("end_time")?,
            room: r.get("room")?,
            active: r.get::<_, i64>("active")? != 0,
            generated_through: r.get("generated_through")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub class_id: String,
    pub rule_id: Option<String>,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub room: Option<String>,
    pub kind: String,
    pub status: String,
    pub cancel_reason: Option<String>,
    pub taken_at: Option<i64>,
    pub note: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl Session {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Session {
            id: r.get("id")?,
            class_id: r.get("class_id")?,
            rule_id: r.get("rule_id")?,
            date: r.get("date")?,
            start_time: r.get("start_time")?,
            end_time: r.get("end_time")?,
            room: r.get("room")?,
            kind: r.get("kind")?,
            status: r.get("status")?,
            cancel_reason: r.get("cancel_reason")?,
            taken_at: r.get("taken_at")?,
            note: r.get("note")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Attendance {
    pub id: String,
    pub session_id: String,
    pub student_id: String,
    pub status: String,
    pub hours: f64,
    pub note: Option<String>,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub id: String,
    pub student_id: String,
    pub sessions: i64,
    pub amount_cents: i64,
    pub unit_price_cents: i64,
    pub purchased_on: String,
    pub method: Option<String>,
    pub offset_sessions: i64,
    pub note: Option<String>,
    pub created_at: i64,
}

impl Package {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Package {
            id: r.get("id")?,
            student_id: r.get("student_id")?,
            sessions: r.get("sessions")?,
            amount_cents: r.get("amount_cents")?,
            unit_price_cents: r.get("unit_price_cents")?,
            purchased_on: r.get("purchased_on")?,
            method: r.get("method")?,
            offset_sessions: r.get("offset_sessions")?,
            note: r.get("note")?,
            created_at: r.get("created_at")?,
        })
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub id: String,
    pub student_id: String,
    pub occurred_at: i64,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub delta: f64,
    pub balance_after: f64,
    pub session_id: Option<String>,
    pub package_id: Option<String>,
    pub amount_cents: Option<i64>,
    pub reason: String,
    pub reverses_id: Option<String>,
    pub created_at: i64,
}

impl LedgerEntry {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(LedgerEntry {
            id: r.get("id")?,
            student_id: r.get("student_id")?,
            occurred_at: r.get("occurred_at")?,
            entry_type: r.get("type")?,
            delta: r.get("delta")?,
            balance_after: r.get("balance_after")?,
            session_id: r.get("session_id")?,
            package_id: r.get("package_id")?,
            amount_cents: r.get("amount_cents")?,
            reason: r.get("reason")?,
            reverses_id: r.get("reverses_id")?,
            created_at: r.get("created_at")?,
        })
    }
}

/// 流水行的展示视图（JOIN 后）
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LedgerView {
    #[serde(flatten)]
    pub entry: LedgerEntry,
    pub student_name: String,
    pub class_id: Option<String>,
    pub class_name: Option<String>,
    pub class_color: Option<String>,
    pub session_date: Option<String>,
    pub session_start: Option<String>,
    pub attendance_status: Option<String>,
    pub package_sessions: Option<i64>,
    pub package_offset: Option<i64>,
    pub package_unit_price: Option<i64>,
    /// 已被冲正
    pub reversed: bool,
    /// 撤销时限内、且未被冲正的 consume / recharge
    pub undoable: bool,
}
