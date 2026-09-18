use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("数据库错误：{0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0}")]
    Rule(String),
    #[error("文件错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("数据格式错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl AppError {
    pub fn rule(msg: impl Into<String>) -> Self {
        AppError::Rule(msg.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
