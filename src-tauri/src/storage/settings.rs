use super::{now_ms, Db, MAX_JSON_BYTES};
use crate::error::{AppError, Result};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

fn check_key(key: &str) -> Result<()> {
    let ok = !key.is_empty()
        && key.len() <= 64
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':'));
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(
            "setting key must be 1-64 characters: letters, digits, . _ - :".into(),
        ))
    }
}

impl Db {
    pub fn setting_get(&self, key: &str) -> Result<Option<Value>> {
        check_key(key)?;
        self.with(|c| {
            let raw: Option<String> = c
                .query_row(
                    "SELECT value FROM settings WHERE key = ?1",
                    params![key],
                    |r| r.get(0),
                )
                .optional()?;
            raw.map(|s| {
                serde_json::from_str::<Value>(&s).map_err(|e| AppError::Invalid(e.to_string()))
            })
            .transpose()
        })
    }

    pub fn setting_set(&self, key: &str, value: &Value) -> Result<()> {
        check_key(key)?;
        let raw = serde_json::to_string(value).map_err(|e| AppError::Invalid(e.to_string()))?;
        if raw.len() > MAX_JSON_BYTES {
            return Err(AppError::Invalid("setting value too large".into()));
        }
        self.with(|c| {
            c.execute(
                "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![key, raw, now_ms()],
            )?;
            Ok(())
        })
    }
}
