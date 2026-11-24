use crate::state::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        app.state::<AppState>().perf.set_source("main", true);
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show DeskForge", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu_mode = MenuItem::with_id(app, "menu", "Menu mode", true, None::<&str>)?;
    let stop_wp = MenuItem::with_id(
        app,
        "stop_wallpaper",
        "Stop animated wallpaper",
        true,
        None::<&str>,
    )?;
    let stop_fx = MenuItem::with_id(app, "stop_fx", "Stop cursor effects", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &menu_mode, &stop_wp, &stop_fx, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "menu" => {
                // Window creation must not happen inside this handler on Windows.
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::menu::open(&handle);
                });
            }
            "stop_wallpaper" => {
                let state = app.state::<AppState>();
                let _ = crate::animated::stop(app, &state);
            }
            "stop_fx" => {
                let state = app.state::<AppState>();
                let _ = crate::fx::stop(app, &state);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
