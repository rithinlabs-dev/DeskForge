//! Animated wallpaper: one fullscreen window (label `wallpaper`) on the primary monitor that plays a video.
//! Mode "behind-icons" attaches it to the desktop's WorkerW layer (experimental); mode "windowed" is the safe
//! fallback (always-on-bottom, click-through, covers the icons). A background thread pauses playback while a
//! fullscreen app runs or (optionally) on battery.

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::{desktop_layer, media, sysstate};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "wallpaper";
const CONFIG_KEY: &str = "wallpaper:config";
const ACTIVE_KEY: &str = "wallpaper:active";
const BOOTING_KEY: &str = "wallpaper:booting";

#[derive(Default)]
struct Inner {
    stop: Option<Arc<AtomicBool>>,
    mode: String,
    active: Option<String>,
}

#[derive(Default)]
pub struct AnimManager {
    inner: Mutex<Inner>,
}

impl AnimManager {
    fn set(&self, stop: Arc<AtomicBool>, mode: String, active: String) {
        let mut i = self.inner.lock();
        i.stop = Some(stop);
        i.mode = mode;
        i.active = Some(active);
    }
    pub fn clear(&self) {
        let mut i = self.inner.lock();
        if let Some(s) = i.stop.take() {
            s.store(true, Ordering::Relaxed);
        }
        i.mode.clear();
        i.active = None;
    }
    pub fn mode(&self) -> String {
        self.inner.lock().mode.clone()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Config {
    mode: String,
    pause_on_fullscreen: bool,
    pause_on_battery: bool,
    autostart: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            mode: "auto".into(),
            pause_on_fullscreen: true,
            pause_on_battery: false,
            autostart: false,
        }
    }
}
fn load_config(state: &AppState) -> Config {
    state
        .db
        .setting_get(CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartInfo {
    pub mode: String,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub mode: String,
    pub active_id: Option<String>,
}

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

#[cfg(windows)]
fn hwnd_of(win: &WebviewWindow) -> Option<isize> {
    win.hwnd().ok().map(|h| h.0 as isize)
}
#[cfg(not(windows))]
fn hwnd_of(_win: &WebviewWindow) -> Option<isize> {
    None
}

fn active_id_setting(state: &AppState) -> Option<String> {
    match state.db.setting_get(ACTIVE_KEY).ok().flatten() {
        Some(Value::Object(o)) => o.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()),
        _ => None,
    }
}

pub fn start(app: &AppHandle, state: &AppState, id: &str) -> Result<StartInfo> {
    let (item, path) = media::find(app, state, id)?;
    state.db.setting_set(
        ACTIVE_KEY,
        &json!({ "id": item.id, "path": path.to_string_lossy() }),
    )?;

    // Already running: the wallpaper page just switches video when the active setting changes.
    if app.get_webview_window(LABEL).is_some() {
        let _ = app.emit("settings://changed", ACTIVE_KEY);
        let mode = state.anim.mode();
        return Ok(StartInfo {
            message: format!("Switched video (mode: {mode})."),
            mode,
        });
    }

    let cfg = load_config(state);
    let monitor = app
        .primary_monitor()
        .map_err(platform)?
        .ok_or_else(|| AppError::Platform("no primary monitor was found".into()))?;
    let (mx, my) = (monitor.position().x, monitor.position().y);
    let (mw, mh) = (monitor.size().width, monitor.size().height);

    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("wallpaper.html".into()))
        .title("DeskForge wallpaper")
        .inner_size(800.0, 600.0)
        .decorations(false)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(platform)?;
    let _ = win.set_size(PhysicalSize::new(mw, mh));
    let _ = win.set_position(PhysicalPosition::new(mx, my));

    let mut mode = String::new();
    let mut message = String::new();
    if cfg.mode != "windowed" {
        let attempt = match hwnd_of(&win) {
            Some(h) => desktop_layer::attach(h, mx, my, mw as i32, mh as i32),
            None => Err("the window handle is unavailable".to_string()),
        };
        match attempt {
            Ok(diag) => {
                let _ = win.show();
                mode = "behind-icons".into();
                message = format!("Running behind the desktop icons ({diag}).");
            }
            Err(e) if cfg.mode == "behind-icons" => {
                let _ = win.close();
                let _ = state.db.setting_set(ACTIVE_KEY, &Value::Null);
                return Err(AppError::Platform(format!(
                    "Couldn’t attach behind the desktop icons: {e}"
                )));
            }
            Err(e) => {
                message =
                    format!("Couldn’t attach behind the icons ({e}), so windowed mode is used.")
            }
        }
    }
    if mode.is_empty() {
        let _ = win.set_always_on_bottom(true);
        let _ = win.set_ignore_cursor_events(true);
        win.show().map_err(platform)?;
        if let Some(h) = hwnd_of(&win) {
            desktop_layer::lower(h);
        }
        mode = "windowed".into();
        message.push_str(" Windowed mode covers your desktop icons; use Stop to get them back.");
    }

    let stop = Arc::new(AtomicBool::new(false));
    state.anim.set(stop.clone(), mode.clone(), item.id.clone());
    spawn_watcher(app.clone(), stop);
    let _ = app.emit(
        "wallpaper://state",
        json!({ "running": true, "mode": mode }),
    );
    Ok(StartInfo {
        mode,
        message: message.trim().to_string(),
    })
}

pub fn stop(app: &AppHandle, state: &AppState) -> Result<()> {
    state.anim.clear();
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    state.db.setting_set(ACTIVE_KEY, &Value::Null)?;
    let _ = app.emit("wallpaper://state", json!({ "running": false }));
    Ok(())
}

/// Used before deleting a video: never delete the file that is currently playing.
pub fn stop_if_active(app: &AppHandle, state: &AppState, id: &str) -> Result<()> {
    if active_id_setting(state).as_deref() == Some(id) {
        stop(app, state)?;
    }
    Ok(())
}

pub fn status(app: &AppHandle, state: &AppState) -> Status {
    let running = app.get_webview_window(LABEL).is_some();
    Status {
        running,
        mode: if running {
            state.anim.mode()
        } else {
            String::new()
        },
        active_id: if running {
            active_id_setting(state)
        } else {
            None
        },
    }
}

/// Windowed mode only: keep the wallpaper window lowest after a desktop widget (also bottom-most) is created.
pub fn lower_if_windowed(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.anim.mode() == "windowed" {
        if let Some(h) = app.get_webview_window(LABEL).as_ref().and_then(hwnd_of) {
            desktop_layer::lower(h);
        }
    }
}

/// Autostart, with a guard: if the previous start never finished, skip it once instead of looping a bad state.
pub fn restore(app: &AppHandle, state: &AppState) {
    if !load_config(state).autostart {
        return;
    }
    if state.db.setting_get(BOOTING_KEY).ok().flatten() == Some(Value::Bool(true)) {
        let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(false));
        eprintln!(
            "animated wallpaper: the last start did not finish, so autostart was skipped once"
        );
        return;
    }
    let Some(id) = active_id_setting(state) else {
        return;
    };
    let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(true));
    match start(app, state, &id) {
        Ok(info) => eprintln!("animated wallpaper: {}", info.message),
        Err(e) => eprintln!("animated wallpaper: couldn't restore: {e}"),
    }
    let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(false));
}

#[derive(Clone, Serialize)]
struct SuspendEvent {
    suspended: bool,
    reason: &'static str,
}

fn evaluate(cfg: &Config) -> SuspendEvent {
    if cfg.pause_on_fullscreen && sysstate::fullscreen_app_running() {
        return SuspendEvent {
            suspended: true,
            reason: "a fullscreen app is running",
        };
    }
    if cfg.pause_on_battery && sysstate::on_battery() {
        return SuspendEvent {
            suspended: true,
            reason: "running on battery",
        };
    }
    SuspendEvent {
        suspended: false,
        reason: "",
    }
}

/// One thread, alive only while a wallpaper runs, waking every 3 seconds.
fn spawn_watcher(app: AppHandle, stop: Arc<AtomicBool>) {
    let _ = std::thread::Builder::new()
        .name("wallpaper-suspend".into())
        .spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                let cfg = load_config(&app.state::<AppState>());
                let _ = app.emit("wallpaper://suspend", evaluate(&cfg));
                std::thread::sleep(Duration::from_secs(3));
            }
        });
}
