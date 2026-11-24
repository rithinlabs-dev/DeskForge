//! Service interfaces. The UI and widget bridge depend on these traits only,
//! so OS-specific code stays behind them (and can be swapped for macOS/Linux later).

pub mod launcher;
pub mod monitor;
pub mod wallpaper;

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub timestamp_ms: u64,
    pub cpu_percent: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    /// Bytes received / sent since the previous snapshot.
    pub net_rx_bytes: u64,
    pub net_tx_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    pub id: String,
    pub name: String,
    pub path: String,
}

pub trait SystemMonitor: Send + Sync {
    fn snapshot(&self) -> SystemSnapshot;
}

pub trait AppLauncher: Send + Sync {
    fn list(&self) -> Result<Vec<AppEntry>>;
    fn register(&self, name: &str, path: &str) -> Result<AppEntry>;
    fn remove(&self, id: &str) -> Result<()>;
    /// Launches a registered entry by id. Arbitrary paths are never accepted.
    fn launch(&self, id: &str) -> Result<()>;
}

pub trait WallpaperService: Send + Sync {
    fn set(&self, path: &Path) -> Result<()>;
}
