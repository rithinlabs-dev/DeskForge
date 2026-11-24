//! M3: SQLite storage. One connection behind a mutex (the workload is tiny and
//! WAL mode keeps writes cheap). Schema changes go in MIGRATIONS, append-only:
//! the number of applied entries is tracked in PRAGMA user_version.

mod settings;
mod themes;

pub use themes::Theme;

use crate::error::Result;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_JSON_BYTES: usize = 256 * 1024;

const MIGRATIONS: &[&str] = &[
    // v1
    r#"
    CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE themes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL,
        data       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE launcher_entries (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE
    );
    "#,
];

pub struct Db {
    conn: Mutex<Connection>,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        Self::init(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;",
        )?;
        migrate(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Run a closure with the connection locked.
    pub fn with<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        f(&self.conn.lock())
    }
}

fn migrate(conn: &Connection) -> Result<()> {
    let applied: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(applied as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn db() -> Db {
        Db::open_in_memory().unwrap()
    }

    #[test]
    fn migrations_set_version() {
        let d = db();
        let v: i64 = d
            .with(|c| Ok(c.query_row("PRAGMA user_version", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
    }

    #[test]
    fn settings_roundtrip_and_overwrite() {
        let d = db();
        assert!(d.setting_get("accent").unwrap().is_none());
        d.setting_set("accent", &json!("#ff8800")).unwrap();
        d.setting_set("accent", &json!({ "h": 30 })).unwrap();
        assert_eq!(d.setting_get("accent").unwrap(), Some(json!({ "h": 30 })));
    }

    #[test]
    fn settings_reject_bad_keys() {
        let d = db();
        assert!(d.setting_set("", &json!(1)).is_err());
        assert!(d.setting_set("has space", &json!(1)).is_err());
        assert!(d.setting_get("a/b").is_err());
    }

    #[test]
    fn themes_crud() {
        let d = db();
        let t = d
            .theme_save(None, "Midnight", &json!({ "bg": "#000" }))
            .unwrap();
        assert_eq!(t.name, "Midnight");
        let t2 = d
            .theme_save(Some(t.id), "Midnight v2", &json!({ "bg": "#111" }))
            .unwrap();
        assert_eq!(t2.id, t.id);
        assert_eq!(d.themes_list().unwrap().len(), 1);
        assert!(d.theme_save(Some(9999), "x", &json!({})).is_err());
        assert!(d.theme_save(None, "bad", &json!([1, 2])).is_err());
        d.theme_delete(t.id).unwrap();
        assert!(d.theme_delete(t.id).is_err());
        assert!(d.themes_list().unwrap().is_empty());
    }
}
