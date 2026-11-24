use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("platform error: {0}")]
    Platform(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, AppError>;

// Tauri commands need errors that serialize; send the message string.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
