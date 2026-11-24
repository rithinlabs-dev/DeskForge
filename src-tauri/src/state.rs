use crate::animated::AnimManager;
use crate::blender::BlenderManager;
use crate::desktop::DesktopManager;
use crate::fx::FxManager;
use crate::island::IslandManager;
use crate::nowplaying::NowPlayingManager;
use crate::perf::PerfManager;
use crate::services::{AppLauncher, SystemMonitor, WallpaperService};
use crate::storage::Db;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Db>,
    pub monitor: Arc<dyn SystemMonitor>,
    pub launcher: Arc<dyn AppLauncher>,
    pub wallpaper: Arc<dyn WallpaperService>,
    pub perf: Arc<PerfManager>,
    pub desktop: DesktopManager,
    pub anim: AnimManager,
    pub blender: BlenderManager,
    pub fx: FxManager,
    pub island: IslandManager,
    pub nowplaying: NowPlayingManager,
}
