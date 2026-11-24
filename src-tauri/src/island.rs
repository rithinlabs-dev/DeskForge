//! The floating island: a small, always-on-top pill that grows into a panel with music controls (Spotify or any
//! player), a Pomodoro timer and a few quick tools.
//!
//! This module only owns the window and the few things a web page cannot do: placing and resizing it, hiding it while a
//! fullscreen app runs, listing monitors, and pressing the volume keys. The page itself is `island.html`; what is
//! playing comes from `nowplaying.rs`.
//!
//! The window is transparent and has no frame. It is only as big as the page asks (collapsed pill or open panel), so it
//! covers as little of the desktop as possible. WHERE it sits is the user's choice: any of eight anchor points on any
//! monitor, plus an offset from that edge, all remembered in the `island:config` setting.

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::sysstate;
use parking_lot::Mutex;
use serde_json::{json, Value};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "island";
const CONFIG_KEY: &str = "island:config";
const ACTIVE_KEY: &str = "island:active";
const BOOTING_KEY: &str = "island:booting";

const MIN_SIZE: (f64, f64) = (100.0, 30.0);
const MAX_SIZE: (f64, f64) = (1200.0, 900.0);
/// The size the window starts at, before the page asks for its own.
const START_SIZE: (f64, f64) = (320.0, 56.0);
/// Offsets (logical pixels) are kept within this range.
const MAX_OFFSET: f64 = 2000.0;

#[derive(Default)]
pub struct IslandManager {
    /// True while the island is hidden because a fullscreen app is running.
    hidden: Mutex<bool>,
}

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

fn config(state: &AppState) -> Option<Value> {
    state.db.setting_get(CONFIG_KEY).ok().flatten()
}

fn config_flag(state: &AppState, key: &str, default: bool) -> bool {
    config(state)
        .and_then(|c| c.get(key).and_then(|v| v.as_bool()))
        .unwrap_or(default)
}

/// Only the island's own page may use the commands that act on its window.
pub fn require_island(window: &WebviewWindow) -> Result<()> {
    if window.label() == LABEL {
        Ok(())
    } else {
        Err(AppError::Invalid("only the island can do this".into()))
    }
}

pub fn running(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some()
}

// ---- where the island sits (pure, unit-tested) --------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Vertical {
    Top,
    Middle,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Horizontal {
    Left,
    Center,
    Right,
}

/// One of eight points on the monitor's edge: the window is pinned to it and grows away from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Anchor {
    pub v: Vertical,
    pub h: Horizontal,
}

impl Anchor {
    pub const DEFAULT: Anchor = Anchor {
        v: Vertical::Top,
        h: Horizontal::Center,
    };

    pub fn parse(text: &str) -> Option<Self> {
        use Horizontal::*;
        use Vertical::*;
        let (v, h) = match text {
            "top-left" => (Top, Left),
            "top-center" => (Top, Center),
            "top-right" => (Top, Right),
            "middle-left" => (Middle, Left),
            "middle-right" => (Middle, Right),
            "bottom-left" => (Bottom, Left),
            "bottom-center" => (Bottom, Center),
            "bottom-right" => (Bottom, Right),
            _ => return None,
        };
        Some(Anchor { v, h })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub anchor: Anchor,
    /// Distance in logical pixels from the anchored edge(s); for a centred axis it nudges right/down.
    pub x: f64,
    pub y: f64,
    /// 0 = the primary monitor, 1.. = the others, left to right.
    pub monitor: usize,
}

impl Default for Placement {
    fn default() -> Self {
        Placement {
            anchor: Anchor::DEFAULT,
            x: 0.0,
            y: 8.0,
            monitor: 0,
        }
    }
}

fn clean_offset(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-MAX_OFFSET, MAX_OFFSET)
    } else {
        fallback
    }
}

/// Builds a placement from the values the page sends. Anything unusable falls back to the default.
pub fn placement_from_args(anchor: &str, x: f64, y: f64, monitor: u32) -> Placement {
    let d = Placement::default();
    Placement {
        anchor: Anchor::parse(anchor).unwrap_or(d.anchor),
        x: clean_offset(x, d.x),
        y: clean_offset(y, d.y),
        monitor: (monitor as usize).min(16),
    }
}

/// Reads the saved placement from the `island:config` setting (`position.anchor/x/y/monitor`).
pub fn placement_from_config(config: Option<&Value>) -> Placement {
    let d = Placement::default();
    let Some(position) = config.and_then(|c| c.get("position")) else {
        return d;
    };
    Placement {
        anchor: position
            .get("anchor")
            .and_then(|v| v.as_str())
            .and_then(Anchor::parse)
            .unwrap_or(d.anchor),
        x: clean_offset(position.get("x").and_then(|v| v.as_f64()).unwrap_or(d.x), d.x),
        y: clean_offset(position.get("y").and_then(|v| v.as_f64()).unwrap_or(d.y), d.y),
        monitor: position
            .get("monitor")
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
            .min(16) as usize,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// Top-left corner (physical pixels) of a window of `win` size for this placement on this monitor. The window is kept
/// entirely on the monitor, so an offset that is too big just pushes it against the edge.
pub fn origin(mon: Rect, win: (u32, u32), scale: f64, p: &Placement) -> (i32, i32) {
    let ox = (p.x * scale).round() as i32;
    let oy = (p.y * scale).round() as i32;
    let (mw, mh) = (mon.w as i32, mon.h as i32);
    let (ww, wh) = (win.0 as i32, win.1 as i32);
    let x = match p.anchor.h {
        Horizontal::Left => mon.x + ox,
        Horizontal::Center => mon.x + (mw - ww) / 2 + ox,
        Horizontal::Right => mon.x + mw - ww - ox,
    };
    let y = match p.anchor.v {
        Vertical::Top => mon.y + oy,
        Vertical::Middle => mon.y + (mh - wh) / 2 + oy,
        Vertical::Bottom => mon.y + mh - wh - oy,
    };
    let max_x = mon.x + (mw - ww).max(0);
    let max_y = mon.y + (mh - wh).max(0);
    (x.clamp(mon.x, max_x), y.clamp(mon.y, max_y))
}

/// Keeps a requested size inside sensible limits (logical pixels).
pub fn clamp_size(width: f64, height: f64) -> (f64, f64) {
    let clean = |v: f64, fallback: f64| if v.is_finite() { v } else { fallback };
    (
        clean(width, START_SIZE.0).clamp(MIN_SIZE.0, MAX_SIZE.0),
        clean(height, START_SIZE.1).clamp(MIN_SIZE.1, MAX_SIZE.1),
    )
}

// ---- monitors ----------------------------------------------------------------------------------------------------

/// The primary monitor first, then the others from left to right.
fn ordered_monitors(app: &AppHandle) -> Result<Vec<Monitor>> {
    let primary = app.primary_monitor().map_err(platform)?;
    let mut others: Vec<Monitor> = app
        .available_monitors()
        .map_err(platform)?
        .into_iter()
        .filter(|m| primary.as_ref().map_or(true, |p| m.position() != p.position()))
        .collect();
    others.sort_by_key(|m| (m.position().x, m.position().y));
    let mut all = Vec::new();
    if let Some(p) = primary {
        all.push(p);
    }
    all.extend(others);
    if all.is_empty() {
        return Err(AppError::Platform("no monitor was found".into()));
    }
    Ok(all)
}

/// Names for the monitor picker: "Main display (1920×1080)", "Display 2 (2560×1440)", ...
pub fn monitor_names(app: &AppHandle) -> Result<Vec<String>> {
    Ok(ordered_monitors(app)?
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let label = if i == 0 { "Main display".to_string() } else { format!("Display {}", i + 1) };
            format!("{label} ({}×{})", m.size().width, m.size().height)
        })
        .collect())
}

/// Resizes the window to `width` x `height` (logical pixels) and pins it to its anchor on the chosen monitor.
fn place(app: &AppHandle, win: &WebviewWindow, width: f64, height: f64, placement: &Placement) -> Result<()> {
    let (width, height) = clamp_size(width, height);
    let monitors = ordered_monitors(app)?;
    let monitor = monitors.get(placement.monitor).unwrap_or(&monitors[0]);
    let scale = monitor.scale_factor();
    let w = (width * scale).round() as u32;
    let h = (height * scale).round() as u32;
    let (x, y) = origin(
        Rect {
            x: monitor.position().x,
            y: monitor.position().y,
            w: monitor.size().width,
            h: monitor.size().height,
        },
        (w, h),
        scale,
        placement,
    );
    win.set_size(PhysicalSize::new(w, h)).map_err(platform)?;
    win.set_position(PhysicalPosition::new(x, y)).map_err(platform)?;
    Ok(())
}

// ---- the window --------------------------------------------------------------------------------------------------

pub fn start(app: &AppHandle, state: &AppState) -> Result<()> {
    if running(app) {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("island.html".into()))
        .title("DeskForge island")
        .inner_size(START_SIZE.0, START_SIZE.1)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .always_on_top(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(platform)?;
    let placement = placement_from_config(config(state).as_ref());
    place(app, &win, START_SIZE.0, START_SIZE.1, &placement)?;
    win.show().map_err(platform)?;

    *state.island.hidden.lock() = false;
    state.nowplaying.start(app);
    state.db.setting_set(ACTIVE_KEY, &Value::Bool(true))?;
    let _ = app.emit("island://state", json!({ "running": true }));
    Ok(())
}

pub fn stop(app: &AppHandle, state: &AppState) -> Result<()> {
    state.nowplaying.stop();
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.close();
    }
    state.db.setting_set(ACTIVE_KEY, &Value::Bool(false))?;
    let _ = app.emit("island://state", json!({ "running": false }));
    Ok(())
}

/// The page asks for the size it needs and where it should sit; the window follows. Island window only.
pub fn resize(
    app: &AppHandle,
    window: &WebviewWindow,
    width: f64,
    height: f64,
    placement: &Placement,
) -> Result<()> {
    require_island(window)?;
    place(app, window, width, height, placement)
}

/// Called every couple of seconds by the page: hides the island while a fullscreen app runs (if the user wants that)
/// and shows it again afterwards. Returns whether it is hidden now.
pub fn tick(state: &AppState, window: &WebviewWindow) -> Result<bool> {
    require_island(window)?;
    let want_hidden =
        config_flag(state, "pauseOnFullscreen", true) && sysstate::fullscreen_app_running();
    let mut hidden = state.island.hidden.lock();
    if want_hidden != *hidden {
        if want_hidden {
            window.hide().map_err(platform)?;
        } else {
            window.show().map_err(platform)?;
        }
        *hidden = want_hidden;
    }
    Ok(*hidden)
}

/// Windows virtual-key codes for the media volume keys.
pub fn volume_key(action: &str) -> Option<u8> {
    match action {
        "mute" => Some(0xAD),
        "down" => Some(0xAE),
        "up" => Some(0xAF),
        _ => None,
    }
}

#[cfg(windows)]
fn press_key(vk: u8) {
    #[link(name = "user32")]
    extern "system" {
        fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
    }
    const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    unsafe {
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0);
        keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
    }
}
#[cfg(not(windows))]
fn press_key(_vk: u8) {}

/// Presses the system volume key ("up", "down" or "mute"), exactly as a keyboard's media keys do.
pub fn volume(window: &WebviewWindow, action: &str) -> Result<()> {
    require_island(window)?;
    let key = volume_key(action)
        .ok_or_else(|| AppError::Invalid("volume action must be up, down or mute".into()))?;
    press_key(key);
    Ok(())
}

/// Autostart (opt-in), with the same guard as the other overlays: an unfinished start is skipped once.
pub fn restore(app: &AppHandle, state: &AppState) {
    if !config_flag(state, "autostart", false)
        || state.db.setting_get(ACTIVE_KEY).ok().flatten() != Some(Value::Bool(true))
    {
        return;
    }
    if state.db.setting_get(BOOTING_KEY).ok().flatten() == Some(Value::Bool(true)) {
        let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(false));
        eprintln!("island: the last start did not finish, so autostart was skipped once");
        return;
    }
    let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(true));
    if let Err(e) = start(app, state) {
        eprintln!("island: couldn’t restore: {e}");
    }
    let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(false));
}

#[cfg(test)]
mod tests {
    use super::*;

    const HD: Rect = Rect { x: 0, y: 0, w: 1920, h: 1080 };

    fn at(anchor: &str, x: f64, y: f64) -> Placement {
        placement_from_args(anchor, x, y, 0)
    }

    #[test]
    fn sizes_stay_within_limits() {
        assert_eq!(clamp_size(300.0, 56.0), (300.0, 56.0));
        assert_eq!(clamp_size(10.0, 5.0), MIN_SIZE);
        assert_eq!(clamp_size(50000.0, 50000.0), MAX_SIZE);
        assert_eq!(clamp_size(f64::NAN, f64::INFINITY), START_SIZE);
    }

    #[test]
    fn all_eight_anchors_parse_and_nothing_else_does() {
        for name in [
            "top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left",
            "bottom-center", "bottom-right",
        ] {
            assert!(Anchor::parse(name).is_some(), "{name}");
        }
        assert_eq!(Anchor::parse("middle-center"), None);
        assert_eq!(Anchor::parse("nowhere"), None);
        assert_eq!(Anchor::parse(""), None);
    }

    #[test]
    fn the_default_is_top_centre_eight_pixels_down() {
        // a 400 px wide window on a 1920 px monitor
        assert_eq!(origin(HD, (400, 100), 1.0, &Placement::default()), (760, 8));
        // the same on a 200% display: sizes and offsets are physical pixels
        let big = Rect { x: 0, y: 0, w: 3840, h: 2160 };
        assert_eq!(origin(big, (800, 200), 2.0, &Placement::default()), (1520, 16));
    }

    #[test]
    fn each_corner_is_measured_from_its_own_edges() {
        let win = (400, 100);
        assert_eq!(origin(HD, win, 1.0, &at("top-left", 10.0, 20.0)), (10, 20));
        assert_eq!(origin(HD, win, 1.0, &at("top-right", 10.0, 20.0)), (1510, 20));
        assert_eq!(origin(HD, win, 1.0, &at("bottom-left", 10.0, 20.0)), (10, 960));
        assert_eq!(origin(HD, win, 1.0, &at("bottom-right", 10.0, 20.0)), (1510, 960));
        assert_eq!(origin(HD, win, 1.0, &at("bottom-center", 0.0, 20.0)), (760, 960));
        assert_eq!(origin(HD, win, 1.0, &at("middle-left", 12.0, 0.0)), (12, 490));
        assert_eq!(origin(HD, win, 1.0, &at("middle-right", 12.0, 0.0)), (1508, 490));
    }

    #[test]
    fn a_centred_axis_is_nudged_by_the_offset() {
        assert_eq!(origin(HD, (400, 100), 1.0, &at("top-center", 100.0, 8.0)), (860, 8));
        assert_eq!(origin(HD, (400, 100), 1.0, &at("top-center", -100.0, 8.0)), (660, 8));
    }

    #[test]
    fn the_window_never_leaves_its_monitor() {
        let win = (400, 100);
        assert_eq!(origin(HD, win, 1.0, &at("top-left", -500.0, -500.0)), (0, 0));
        assert_eq!(origin(HD, win, 1.0, &at("top-left", 2000.0, 2000.0)), (1520, 980));
        // a window bigger than the monitor sits at its corner instead of panicking
        assert_eq!(origin(HD, (3000, 2000), 1.0, &at("bottom-right", 0.0, 0.0)), (0, 0));
    }

    #[test]
    fn other_monitors_are_offset_by_their_position() {
        let right = Rect { x: 1920, y: 0, w: 2560, h: 1440 };
        assert_eq!(origin(right, (400, 100), 1.0, &Placement::default()), (1920 + 1080, 8));
        let above = Rect { x: 0, y: -1080, w: 1920, h: 1080 };
        assert_eq!(origin(above, (400, 100), 1.0, &Placement::default()), (760, -1072));
    }

    #[test]
    fn bad_placement_values_fall_back_to_the_default() {
        let p = placement_from_args("sideways", f64::NAN, f64::INFINITY, 99);
        assert_eq!(p.anchor, Anchor::DEFAULT);
        assert_eq!((p.x, p.y), (0.0, 8.0));
        assert_eq!(p.monitor, 16);
        assert_eq!(placement_from_args("top-left", 99999.0, -99999.0, 0).x, MAX_OFFSET);
        assert_eq!(placement_from_args("top-left", 99999.0, -99999.0, 0).y, -MAX_OFFSET);
    }

    #[test]
    fn the_saved_position_is_read_from_the_settings_record() {
        let saved = json!({
            "autostart": true,
            "position": { "anchor": "bottom-right", "x": 24, "y": 40.5, "monitor": 1, "locked": false }
        });
        let p = placement_from_config(Some(&saved));
        assert_eq!(p.anchor, Anchor::parse("bottom-right").unwrap());
        assert_eq!((p.x, p.y, p.monitor), (24.0, 40.5, 1));
        assert_eq!(placement_from_config(None), Placement::default());
        assert_eq!(placement_from_config(Some(&json!({ "autostart": true }))), Placement::default());
        assert_eq!(
            placement_from_config(Some(&json!({ "position": { "anchor": 5, "x": "a" } }))),
            Placement::default()
        );
    }

    #[test]
    fn volume_actions_map_to_the_media_keys() {
        assert_eq!(volume_key("up"), Some(0xAF));
        assert_eq!(volume_key("down"), Some(0xAE));
        assert_eq!(volume_key("mute"), Some(0xAD));
        assert_eq!(volume_key("louder"), None);
    }
}
