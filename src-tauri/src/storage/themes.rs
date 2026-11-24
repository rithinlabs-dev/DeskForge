use super::{now_ms, Db, MAX_JSON_BYTES};
use crate::error::{AppError, Result};
use rusqlite::{params, Row};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub id: i64,
    pub name: String,
    /// Design-token payload. Its schema is owned by the frontend (M2/M4).
    pub data: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

fn from_row(r: &Row) -> rusqlite::Result<Theme> {
    let raw: String = r.get(2)?;
    let data = serde_json::from_str(&raw).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
    })?;
    Ok(Theme {
        id: r.get(0)?,
        name: r.get(1)?,
        data,
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
    })
}

const COLS: &str = "id, name, data, created_at, updated_at";

impl Db {
    pub fn themes_list(&self) -> Result<Vec<Theme>> {
        self.with(|c| {
            let mut st = c.prepare(&format!(
                "SELECT {COLS} FROM themes ORDER BY name COLLATE NOCASE"
            ))?;
            let rows = st.query_map([], from_row)?;
            let list = rows.collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(list)
        })
    }

    /// Insert when `id` is None, otherwise update that theme.
    pub fn theme_save(&self, id: Option<i64>, name: &str, data: &Value) -> Result<Theme> {
        let name = name.trim();
        if name.is_empty() || name.len() > 64 {
            return Err(AppError::Invalid(
                "theme name must be 1-64 characters".into(),
            ));
        }
        if !data.is_object() {
            return Err(AppError::Invalid("theme data must be a JSON object".into()));
        }
        let raw = serde_json::to_string(data).map_err(|e| AppError::Invalid(e.to_string()))?;
        if raw.len() > MAX_JSON_BYTES {
            return Err(AppError::Invalid("theme data too large".into()));
        }

        self.with(|c| {
            let now = now_ms();
            let id = match id {
                Some(id) => {
                    let n = c.execute(
                        "UPDATE themes SET name = ?1, data = ?2, updated_at = ?3 WHERE id = ?4",
                        params![name, raw, now, id],
                    )?;
                    if n == 0 {
                        return Err(AppError::NotFound(format!("theme {id}")));
                    }
                    id
                }
                None => {
                    c.execute(
                        "INSERT INTO themes (name, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
                        params![name, raw, now],
                    )?;
                    c.last_insert_rowid()
                }
            };
            let theme = c.query_row(
                &format!("SELECT {COLS} FROM themes WHERE id = ?1"),
                params![id],
                from_row,
            )?;
            Ok(theme)
        })
    }

    pub fn theme_delete(&self, id: i64) -> Result<()> {
        self.with(|c| {
            let n = c.execute("DELETE FROM themes WHERE id = ?1", params![id])?;
            if n == 0 {
                return Err(AppError::NotFound(format!("theme {id}")));
            }
            Ok(())
        })
    }
}
