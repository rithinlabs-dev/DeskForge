//! "Menu mode": the full window collapses into a small docked menu (window label `menu`).
//! The menu window is hidden, not destroyed, so it keeps its position while the app runs.

use crate::error::{AppError, Result};
use crate::state::AppState;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "menu";
const W: f64 = 300.0;
const H: f64 = 580.0;

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

/// Show the menu (creating it on first use, docked to the right edge) and tuck the main window away.
pub fn open(app: &AppHandle) -> Result<()> {
    let win = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => {
            let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("menu.html".into()))
                .title("DeskForge menu")
                .inner_size(W, H)
                .decorations(false)
                .shadow(true)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .skip_taskbar(true)
                .visible(false)
                .build()
                .map_err(platform)?;
            if let Ok(Some(m)) = app.primary_monitor() {
                let s = m.scale_factor();
                let x = m.position().x + m.size().width as i32 - ((W + 16.0) * s) as i32;
                let y = m.position().y + (48.0 * s) as i32;
                let _ = w.set_position(PhysicalPosition::new(x, y));
            }
            w
        }
    };
    win.show().map_err(platform)?;
    let _ = win.set_focus();

    let state = app.state::<AppState>();
    state.perf.set_source(LABEL, true);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
    state.perf.set_source("main", false);
    Ok(())
}

/// Hide the menu and bring the full window back.
pub fn show_app(app: &AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
    app.state::<AppState>().perf.set_source(LABEL, false);
    crate::tray::show_main(app);
    Ok(())
}
