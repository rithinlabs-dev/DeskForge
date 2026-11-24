//! M6: desktop widgets. Every pinned widget gets its own frameless, transparent window
//! kept below all other windows (like Rainmeter's "On desktop"). Window labels are
//! `dw-<widget id>`; capabilities/desktop-widget.json grants those windows a small subset
//! of commands.

use crate::error::{AppError, Result};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

pub const PREFIX: &str = "dw-";
const LAYOUT_KEY: &str = "desktop:widgets";

/// The only size limits left are technical: both hover controls must fit, and WebView2/GPU surfaces top out here.
pub const MIN_DIM: u32 = 68;
pub const MAX_DIM: u32 = 16384;

/// Size is logical px (from the widget manifest); position is physical px (from the OS).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Placement {
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    pub w: u32,
    pub h: u32,
}
type Layout = HashMap<String, Placement>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutElementInfo {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub font_size: f64,
    pub color: String,
    pub align: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutEditorSession {
    pub widget_id: String,
    pub elements: Vec<LayoutElementInfo>,
    pub selected_id: String,
    pub return_to_main: bool,
}

/// Which desktop windows are locked (not in drag mode). Unknown labels count as locked.
#[derive(Default)]
pub struct DesktopManager {
    locked: Mutex<HashMap<String, bool>>,
    glass: Mutex<HashMap<String, AppliedGlass>>,
    layout_editor: Mutex<Option<LayoutEditorSession>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppliedGlass {
    pub enabled: bool,
    pub tint_opacity: u32,
    pub tint: String,
    pub kind: String,
    pub effect: String,
    pub error: Option<String>,
}

impl DesktopManager {
    pub fn is_locked(&self, label: &str) -> bool {
        *self.locked.lock().get(label).unwrap_or(&true)
    }
    fn set(&self, label: &str, locked: bool) {
        self.locked.lock().insert(label.to_string(), locked);
    }
    pub fn forget(&self, label: &str) -> Option<LayoutEditorSession> {
        self.locked.lock().remove(label);
        if let Some(id) = label.strip_prefix(PREFIX) {
            self.glass.lock().remove(id);
            let mut editor = self.layout_editor.lock();
            if editor
                .as_ref()
                .is_some_and(|session| session.widget_id == id)
            {
                return editor.take();
            }
        }
        None
    }
    pub fn layout_editor(&self) -> Option<LayoutEditorSession> {
        self.layout_editor.lock().clone()
    }
    pub fn set_layout_editor(
        &self,
        session: Option<LayoutEditorSession>,
    ) -> Option<LayoutEditorSession> {
        std::mem::replace(&mut *self.layout_editor.lock(), session)
    }
    pub fn update_layout_editor(
        &self,
        widget_id: &str,
        elements: Vec<LayoutElementInfo>,
    ) -> Option<LayoutEditorSession> {
        let mut current = self.layout_editor.lock();
        let session = current.as_mut()?;
        if session.widget_id != widget_id {
            return None;
        }
        session.elements = elements;
        if !session
            .elements
            .iter()
            .any(|element| element.id == session.selected_id)
        {
            session.selected_id = session
                .elements
                .first()
                .map(|element| element.id.clone())
                .unwrap_or_default();
        }
        Some(session.clone())
    }
    pub fn select_layout_element(
        &self,
        widget_id: &str,
        selected_id: &str,
    ) -> Option<LayoutEditorSession> {
        let mut current = self.layout_editor.lock();
        let session = current.as_mut()?;
        if session.widget_id != widget_id
            || !session
                .elements
                .iter()
                .any(|element| element.id == selected_id)
        {
            return None;
        }
        session.selected_id = selected_id.to_string();
        Some(session.clone())
    }
    pub fn glass(&self, id: &str) -> Option<AppliedGlass> {
        self.glass.lock().get(id).cloned()
    }
    pub fn remember_glass(&self, id: &str, glass: AppliedGlass) {
        self.glass.lock().insert(id.to_string(), glass);
    }
}

pub fn is_widget_id(id: &str) -> bool {
    let b = id.as_bytes();
    (2..=32).contains(&b.len())
        && b[0].is_ascii_lowercase()
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

pub fn store_key(id: &str) -> String {
    format!("widget:{id}:storage")
}

/// A desktop widget window may only touch its own widget's data. The main window may touch any.
pub fn check_widget_scope(window: &WebviewWindow, id: &str) -> Result<()> {
    if !is_widget_id(id) {
        return Err(AppError::Invalid("invalid widget id".into()));
    }
    if let Some(own) = window.label().strip_prefix(PREFIX) {
        if own != id {
            return Err(AppError::Invalid(
                "a desktop widget can only access its own data".into(),
            ));
        }
    }
    Ok(())
}

fn load_layout(state: &AppState) -> Result<Layout> {
    Ok(match state.db.setting_get(LAYOUT_KEY)? {
        Some(v) => serde_json::from_value(v).unwrap_or_default(),
        None => Layout::new(),
    })
}

fn save_layout(state: &AppState, layout: &Layout) -> Result<()> {
    let v = serde_json::to_value(layout).map_err(|e| AppError::Invalid(e.to_string()))?;
    state.db.setting_set(LAYOUT_KEY, &v)
}

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

fn open_window(app: &AppHandle, id: &str, p: &Placement, locked: bool, cascade: i32) -> Result<()> {
    let label = format!("{PREFIX}{id}");
    if app.get_webview_window(&label).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("desktop.html".into()))
        .title(format!("DeskForge widget: {id}"))
        .inner_size(p.w as f64, p.h as f64)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .always_on_bottom(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(platform)?;

    let pos = match (p.x, p.y) {
        (Some(x), Some(y)) => PhysicalPosition::new(x, y),
        _ => {
            let off = 80 + cascade * 32;
            PhysicalPosition::new(off, off)
        }
    };
    let _ = win.set_position(pos);
    win.show().map_err(platform)?;
    app.state::<AppState>().desktop.set(&label, locked);
    crate::animated::lower_if_windowed(app);
    Ok(())
}

/// Reopen every pinned widget (locked) at startup.
pub fn restore(app: &AppHandle, state: &AppState) -> Result<()> {
    let layout = load_layout(state)?;
    for (i, (id, p)) in layout.iter().enumerate() {
        if !is_widget_id(id) {
            continue;
        }
        if let Err(e) = open_window(app, id, p, true, i as i32) {
            eprintln!("desktop widget {id}: {e}");
        }
    }
    Ok(())
}

pub fn pin(app: &AppHandle, state: &AppState, id: &str, width: u32, height: u32) -> Result<()> {
    if !is_widget_id(id) {
        return Err(AppError::Invalid("invalid widget id".into()));
    }
    let (w, h) = (
        width.clamp(MIN_DIM, MAX_DIM),
        height.clamp(MIN_DIM, MAX_DIM),
    );
    let mut layout = load_layout(state)?;
    let cascade = layout.len() as i32;
    let placement = {
        let e = layout.entry(id.to_string()).or_insert(Placement {
            x: None,
            y: None,
            w,
            h,
        });
        e.clone() // an existing entry keeps the size the user chose
    };
    save_layout(state, &layout)?;
    // A widget that was never positioned starts in drag mode so it can be placed.
    open_window(app, id, &placement, placement.x.is_some(), cascade)
}

pub fn unpin(app: &AppHandle, state: &AppState, id: &str) -> Result<()> {
    if !is_widget_id(id) {
        return Err(AppError::Invalid("invalid widget id".into()));
    }
    let mut layout = load_layout(state)?;
    layout.remove(id);
    save_layout(state, &layout)?;
    if let Some(w) = app.get_webview_window(&format!("{PREFIX}{id}")) {
        let _ = w.close();
    }
    Ok(())
}

pub fn list(state: &AppState) -> Result<Vec<String>> {
    let mut ids: Vec<String> = load_layout(state)?.into_keys().collect();
    ids.sort();
    Ok(ids)
}

/// Save where this window ended up (position and size). Called when the user releases the move/resize control.
pub fn commit_bounds(state: &AppState, win: &WebviewWindow) -> Result<()> {
    let label = win.label().to_string();
    let Some(id) = label.strip_prefix(PREFIX) else {
        return Err(AppError::Invalid("not a desktop widget window".into()));
    };
    let pos = win.outer_position().map_err(platform)?;
    let size = win.inner_size().map_err(platform)?;
    let scale = win.scale_factor().map_err(platform)?;
    let mut layout = load_layout(state)?;
    if let Some(p) = layout.get_mut(id) {
        p.x = Some(pos.x);
        p.y = Some(pos.y);
        p.w = ((size.width as f64 / scale).round() as u32).clamp(MIN_DIM, MAX_DIM);
        p.h = ((size.height as f64 / scale).round() as u32).clamp(MIN_DIM, MAX_DIM);
        save_layout(state, &layout)?;
    }
    Ok(())
}

#[derive(Clone, Serialize)]
struct LockedEvent {
    label: String,
    locked: bool,
}

/// Lock = leave drag mode and remember where the window ended up.
pub fn set_locked(
    app: &AppHandle,
    state: &AppState,
    win: &WebviewWindow,
    locked: bool,
) -> Result<()> {
    let label = win.label().to_string();
    let Some(id) = label.strip_prefix(PREFIX) else {
        return Err(AppError::Invalid("not a desktop widget window".into()));
    };
    if locked {
        let pos = win.outer_position().map_err(platform)?;
        let size = win.inner_size().map_err(platform)?;
        let scale = win.scale_factor().map_err(platform)?;
        let mut layout = load_layout(state)?;
        if let Some(p) = layout.get_mut(id) {
            p.x = Some(pos.x);
            p.y = Some(pos.y);
            p.w = ((size.width as f64 / scale).round() as u32).clamp(MIN_DIM, MAX_DIM);
            p.h = ((size.height as f64 / scale).round() as u32).clamp(MIN_DIM, MAX_DIM);
            save_layout(state, &layout)?;
        }
    }
    state.desktop.set(&label, locked);
    let _ = app.emit("desktop://locked", LockedEvent { label, locked });
    Ok(())
}

pub fn set_all_locked(app: &AppHandle, state: &AppState, locked: bool) -> Result<()> {
    for (label, win) in app.webview_windows() {
        if label.starts_with(PREFIX) {
            set_locked(app, state, &win, locked)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_ids() {
        assert!(is_widget_id("clock"));
        assert!(is_widget_id("system-monitor"));
        assert!(!is_widget_id("a"));
        assert!(!is_widget_id("Clock"));
        assert!(!is_widget_id("../x"));
        assert!(!is_widget_id("1abc"));
        assert!(!is_widget_id(&"a".repeat(33)));
    }

    #[test]
    fn unknown_windows_count_as_locked() {
        let m = DesktopManager::default();
        assert!(m.is_locked("dw-nope"));
        m.set("dw-clock", false);
        assert!(!m.is_locked("dw-clock"));
        m.forget("dw-clock");
        assert!(m.is_locked("dw-clock"));
    }

    #[test]
    fn forgetting_the_active_widget_clears_its_layout_editor_session() {
        let m = DesktopManager::default();
        m.set_layout_editor(Some(LayoutEditorSession {
            widget_id: "clock".into(),
            elements: Vec::new(),
            selected_id: String::new(),
            return_to_main: true,
        }));

        let cleared = m.forget("dw-clock").unwrap();
        assert_eq!(cleared.widget_id, "clock");
        assert!(cleared.return_to_main);
        assert!(m.layout_editor().is_none());
    }

    #[test]
    fn glass_cache_is_removed_when_a_widget_window_is_forgotten() {
        let m = DesktopManager::default();
        m.remember_glass(
            "clock",
            AppliedGlass {
                enabled: true,
                tint_opacity: 35,
                tint: "#25282d".into(),
                kind: "acrylic".into(),
                effect: "acrylic".into(),
                error: None,
            },
        );
        m.remember_glass(
            "weather",
            AppliedGlass {
                enabled: true,
                tint_opacity: 30,
                tint: "#f1f3f5".into(),
                kind: "blur".into(),
                effect: "blur".into(),
                error: None,
            },
        );
        assert_eq!(m.glass("clock").unwrap().effect, "acrylic");
        m.forget("dw-clock");
        assert!(m.glass("clock").is_none());
        assert_eq!(m.glass("weather").unwrap().effect, "blur");
    }
}
