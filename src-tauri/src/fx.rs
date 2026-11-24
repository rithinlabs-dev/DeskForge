//! Phase 3: cursor effects. One transparent, click-through, always-on-top window (label `fx`) covering the primary
//! monitor. A click-through webview receives no mouse events, so this module reports the global cursor position
//! (GetCursorPos) to the overlay page. The overlay only asks while an effect is enabled, and pauses itself while a
//! fullscreen app runs (checked at most every 2 seconds).
//!
//! Smooth trails: asking for the position once per drawn frame makes the trail depend on IPC timing, which jitters. So
//! while the overlay exists a small sampler thread reads the cursor about 250 times a second and timestamps every
//! change; the page collects whatever is new with `cursor_batch` and places each point at its true age. The older
//! single-position `cursor` call stays for compatibility.

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::sysstate;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "fx";
const CONFIG_KEY: &str = "fx:config";
const ACTIVE_KEY: &str = "fx:active";
const BOOTING_KEY: &str = "fx:booting";

const SAMPLE_INTERVAL: Duration = Duration::from_millis(4);
/// About two seconds of samples: far more than the page can ever fall behind by.
const MAX_BUFFERED: usize = 512;

/// A cursor position with the moment it was read (milliseconds on DeskForge's own clock).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RawSample {
    pub t: f64,
    pub x: i32,
    pub y: i32,
}

#[derive(Default)]
struct Sampler {
    /// Bumped to start or stop: a sampler thread runs only while this still equals the value it was started with.
    epoch: AtomicU64,
    buffer: Mutex<Vec<RawSample>>,
}

#[derive(Default)]
pub struct FxManager {
    suspended_cache: Mutex<Option<(Instant, bool)>>,
    sampler: Arc<Sampler>,
}

impl FxManager {
    fn suspended(&self, state: &AppState) -> bool {
        let mut cache = self.suspended_cache.lock();
        if let Some((at, value)) = *cache {
            if at.elapsed() < Duration::from_secs(2) {
                return value;
            }
        }
        let value = pause_on_fullscreen(state) && sysstate::fullscreen_app_running();
        *cache = Some((Instant::now(), value));
        value
    }

    fn start_sampler(&self) {
        let sampler = Arc::clone(&self.sampler);
        let epoch = sampler.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let spawned = std::thread::Builder::new()
            .name("deskforge-cursor".into())
            .spawn(move || sample_loop(sampler, epoch));
        if let Err(e) = spawned {
            eprintln!("cursor effects: couldn’t start the cursor sampler: {e}");
        }
    }

    fn stop_sampler(&self) {
        self.sampler.epoch.fetch_add(1, Ordering::SeqCst);
        self.sampler.buffer.lock().clear();
    }
}

fn now_ms() -> f64 {
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
}

/// Appends a sample and drops the oldest ones so the buffer never exceeds `cap`.
fn push_capped(buffer: &mut Vec<RawSample>, sample: RawSample, cap: usize) {
    if buffer.len() >= cap {
        let excess = buffer.len() + 1 - cap;
        buffer.drain(..excess);
    }
    buffer.push(sample);
}

fn sample_loop(sampler: Arc<Sampler>, epoch: u64) {
    timer_resolution(true);
    let mut last: Option<(i32, i32)> = None;
    while sampler.epoch.load(Ordering::SeqCst) == epoch {
        if let Some(position) = cursor_pos() {
            if last != Some(position) {
                last = Some(position);
                let sample = RawSample {
                    t: now_ms(),
                    x: position.0,
                    y: position.1,
                };
                push_capped(&mut sampler.buffer.lock(), sample, MAX_BUFFERED);
            }
        }
        std::thread::sleep(SAMPLE_INTERVAL);
    }
    timer_resolution(false);
}

/// Windows sleeps in ~15 ms steps unless a program asks for finer timing; the sampler asks only while it runs.
#[cfg(windows)]
fn timer_resolution(fine: bool) {
    #[link(name = "winmm")]
    extern "system" {
        fn timeBeginPeriod(milliseconds: u32) -> u32;
        fn timeEndPeriod(milliseconds: u32) -> u32;
    }
    unsafe {
        if fine {
            let _ = timeBeginPeriod(1);
        } else {
            let _ = timeEndPeriod(1);
        }
    }
}
#[cfg(not(windows))]
fn timer_resolution(_fine: bool) {}

fn config(state: &AppState) -> Option<Value> {
    state.db.setting_get(CONFIG_KEY).ok().flatten()
}
fn pause_on_fullscreen(state: &AppState) -> bool {
    config(state)
        .and_then(|c| c.get("pauseOnFullscreen").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}
fn autostart(state: &AppState) -> bool {
    config(state)
        .and_then(|c| c.get("autostart").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

#[cfg(windows)]
fn cursor_pos() -> Option<(i32, i32)> {
    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(p: *mut Point) -> i32;
    }
    let mut p = Point { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut p) } != 0 {
        Some((p.x, p.y))
    } else {
        None
    }
}
#[cfg(not(windows))]
fn cursor_pos() -> Option<(i32, i32)> {
    None
}

#[derive(Serialize)]
pub struct CursorSample {
    /// Cursor position in physical pixels, relative to the overlay window's top-left corner.
    pub x: i32,
    pub y: i32,
    pub suspended: bool,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct TimedSample {
    /// Physical pixels, relative to the overlay window's top-left corner.
    pub x: i32,
    pub y: i32,
    /// When it was read, in milliseconds on DeskForge's clock (the same clock as `CursorBatch::now`).
    pub t: f64,
}

#[derive(Serialize)]
pub struct CursorBatch {
    /// Every position change since the last call, oldest first.
    pub samples: Vec<TimedSample>,
    /// DeskForge's clock when this reply was made, so the page can map `t` onto its own clock.
    pub now: f64,
    /// The position right now, in the same units as `samples`.
    pub x: i32,
    pub y: i32,
    pub suspended: bool,
}

fn only_overlay(win: &WebviewWindow) -> Result<()> {
    if win.label() != LABEL {
        return Err(AppError::Invalid(
            "only the effects overlay can read the cursor position".into(),
        ));
    }
    Ok(())
}

/// Only the overlay window may ask: the global cursor position is not something other windows should read.
pub fn cursor(state: &AppState, win: &WebviewWindow) -> Result<CursorSample> {
    only_overlay(win)?;
    let (cx, cy) = cursor_pos()
        .ok_or_else(|| AppError::Platform("couldn’t read the cursor position".into()))?;
    let origin = win.outer_position().map_err(platform)?;
    Ok(CursorSample {
        x: cx - origin.x,
        y: cy - origin.y,
        suspended: state.fx.suspended(state),
    })
}

fn relative(samples: Vec<RawSample>, origin: (i32, i32)) -> Vec<TimedSample> {
    samples
        .into_iter()
        .map(|s| TimedSample {
            x: s.x - origin.0,
            y: s.y - origin.1,
            t: s.t,
        })
        .collect()
}

/// Everything the sampler collected since the last call (and the position right now). Overlay window only.
pub fn cursor_batch(state: &AppState, win: &WebviewWindow) -> Result<CursorBatch> {
    only_overlay(win)?;
    let origin = win.outer_position().map_err(platform)?;
    let taken = std::mem::take(&mut *state.fx.sampler.buffer.lock());
    let now = now_ms();
    let (cx, cy) = cursor_pos()
        .ok_or_else(|| AppError::Platform("couldn’t read the cursor position".into()))?;
    Ok(CursorBatch {
        samples: relative(taken, (origin.x, origin.y)),
        now,
        x: cx - origin.x,
        y: cy - origin.y,
        suspended: state.fx.suspended(state),
    })
}

pub fn running(app: &AppHandle) -> bool {
    app.get_webview_window(LABEL).is_some()
}

pub fn start(app: &AppHandle, state: &AppState) -> Result<()> {
    if running(app) {
        return Ok(());
    }
    let monitor = app
        .primary_monitor()
        .map_err(platform)?
        .ok_or_else(|| AppError::Platform("no primary monitor was found".into()))?;
    let (mx, my) = (monitor.position().x, monitor.position().y);
    let (mw, mh) = (monitor.size().width, monitor.size().height);

    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("fx.html".into()))
        .title("DeskForge effects")
        .inner_size(800.0, 600.0)
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
    // One pixel short of the monitor so Windows never mistakes the overlay for a fullscreen app.
    let _ = win.set_size(PhysicalSize::new(mw, mh.saturating_sub(1)));
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    let _ = win.set_ignore_cursor_events(true);
    win.show().map_err(platform)?;

    state.fx.start_sampler();
    state.db.setting_set(ACTIVE_KEY, &Value::Bool(true))?;
    let _ = app.emit("fx://state", json!({ "running": true }));
    Ok(())
}

pub fn stop(app: &AppHandle, state: &AppState) -> Result<()> {
    state.fx.stop_sampler();
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    state.db.setting_set(ACTIVE_KEY, &Value::Bool(false))?;
    let _ = app.emit("fx://state", json!({ "running": false }));
    Ok(())
}

/// Autostart (opt-in), with the same guard as the animated wallpaper: an unfinished start is skipped once.
pub fn restore(app: &AppHandle, state: &AppState) {
    if !autostart(state)
        || state.db.setting_get(ACTIVE_KEY).ok().flatten() != Some(Value::Bool(true))
    {
        return;
    }
    if state.db.setting_get(BOOTING_KEY).ok().flatten() == Some(Value::Bool(true)) {
        let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(false));
        eprintln!("cursor effects: the last start did not finish, so autostart was skipped once");
        return;
    }
    let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(true));
    if let Err(e) = start(app, state) {
        eprintln!("cursor effects: couldn’t restore: {e}");
    }
    let _ = state.db.setting_set(BOOTING_KEY, &Value::Bool(false));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(t: f64) -> RawSample {
        RawSample {
            t,
            x: t as i32,
            y: 0,
        }
    }

    #[test]
    fn the_buffer_keeps_the_newest_samples_in_order() {
        let mut buffer = Vec::new();
        for i in 0..10 {
            push_capped(&mut buffer, sample(f64::from(i)), 4);
        }
        let times: Vec<f64> = buffer.iter().map(|s| s.t).collect();
        assert_eq!(times, vec![6.0, 7.0, 8.0, 9.0]);
    }

    #[test]
    fn a_buffer_below_the_cap_is_untouched() {
        let mut buffer = Vec::new();
        push_capped(&mut buffer, sample(1.0), 4);
        push_capped(&mut buffer, sample(2.0), 4);
        assert_eq!(buffer.len(), 2);
    }

    #[test]
    fn samples_become_overlay_relative_and_keep_their_time() {
        let out = relative(
            vec![
                RawSample {
                    t: 5.0,
                    x: 1500,
                    y: 300,
                },
                RawSample {
                    t: 9.0,
                    x: 1510,
                    y: 305,
                },
            ],
            (1000, 100),
        );
        assert_eq!(
            out,
            vec![
                TimedSample {
                    x: 500,
                    y: 200,
                    t: 5.0
                },
                TimedSample {
                    x: 510,
                    y: 205,
                    t: 9.0
                },
            ]
        );
    }

    #[test]
    fn the_clock_never_runs_backwards() {
        let a = now_ms();
        let b = now_ms();
        assert!(b >= a);
    }

    #[test]
    fn starting_and_stopping_the_sampler_changes_its_epoch() {
        let manager = FxManager::default();
        let before = manager.sampler.epoch.load(Ordering::SeqCst);
        manager.stop_sampler();
        assert_eq!(manager.sampler.epoch.load(Ordering::SeqCst), before + 1);
        manager.stop_sampler();
        assert_eq!(manager.sampler.epoch.load(Ordering::SeqCst), before + 2);
    }
}
