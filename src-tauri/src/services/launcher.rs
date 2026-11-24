use super::{AppEntry, AppLauncher};
use crate::error::{AppError, Result};
use crate::storage::Db;
use rusqlite::params;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;

/// SQLite-backed registry (table launcher_entries).
pub struct DbLauncher {
    db: Arc<Db>,
}

impl DbLauncher {
    pub fn new(db: Arc<Db>) -> Self {
        Self { db }
    }
}

fn parse_id(id: &str) -> Result<i64> {
    id.strip_prefix("app-")
        .and_then(|n| n.parse().ok())
        .ok_or_else(|| AppError::NotFound(id.to_string()))
}

impl AppLauncher for DbLauncher {
    fn list(&self) -> Result<Vec<AppEntry>> {
        self.db.with(|c| {
            let mut st = c.prepare("SELECT id, name, path FROM launcher_entries ORDER BY id")?;
            let rows = st.query_map([], |r| {
                let id: i64 = r.get(0)?;
                Ok(AppEntry {
                    id: format!("app-{id}"),
                    name: r.get(1)?,
                    path: r.get(2)?,
                })
            })?;
            let list = rows.collect::<std::result::Result<Vec<_>, _>>()?;
            Ok(list)
        })
    }

    fn register(&self, name: &str, path: &str) -> Result<AppEntry> {
        let name = name.trim();
        if name.is_empty() || name.len() > 64 {
            return Err(AppError::Invalid("name must be 1-64 characters".into()));
        }
        let canon = Path::new(path)
            .canonicalize()
            .map_err(|_| AppError::NotFound(path.to_string()))?;
        let is_exe = canon.is_file()
            && canon
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("exe"))
                .unwrap_or(false);
        if !is_exe {
            return Err(AppError::Invalid(
                "only .exe files can be registered".into(),
            ));
        }
        let path_str = canon.to_string_lossy().into_owned();

        self.db.with(|c| {
            let exists: bool = c.query_row(
                "SELECT EXISTS(SELECT 1 FROM launcher_entries WHERE path = ?1)",
                params![path_str],
                |r| r.get(0),
            )?;
            if exists {
                return Err(AppError::Invalid("that app is already registered".into()));
            }
            c.execute(
                "INSERT INTO launcher_entries (name, path) VALUES (?1, ?2)",
                params![name, path_str],
            )?;
            Ok(AppEntry {
                id: format!("app-{}", c.last_insert_rowid()),
                name: name.to_string(),
                path: path_str.clone(),
            })
        })
    }

    fn remove(&self, id: &str) -> Result<()> {
        let rowid = parse_id(id)?;
        self.db.with(|c| {
            let n = c.execute("DELETE FROM launcher_entries WHERE id = ?1", params![rowid])?;
            if n == 0 {
                return Err(AppError::NotFound(id.to_string()));
            }
            Ok(())
        })
    }

    fn launch(&self, id: &str) -> Result<()> {
        let rowid = parse_id(id)?;
        let path: String = self.db.with(|c| {
            c.query_row(
                "SELECT path FROM launcher_entries WHERE id = ?1",
                params![rowid],
                |r| r.get(0),
            )
            .map_err(|_| AppError::NotFound(id.to_string()))
        })?;
        Command::new(path).spawn()?;
        Ok(())
    }
}
