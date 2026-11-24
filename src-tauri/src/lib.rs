mod animated;
mod b64;
mod backdrop;
mod blender;
mod commands;
mod desktop;
mod desktop_layer;
mod error;
mod fx;
mod glass;
mod images;
mod island;
mod media;
mod menu;
mod nowplaying;
mod perf;
mod services;
mod state;
mod storage;
mod sysstate;
mod tray;

use desktop::DesktopManager;
use perf::PerfManager;
use services::{launcher::DbLauncher, monitor::SysinfoMonitor, wallpaper::SystemWallpaper};
use state::AppState;
use std::sync::Arc;
use storage::Db;
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            // %APPDATA%\dev.deskforge.app\deskforge.db
            let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let db = Arc::new(Db::open(&dir.join("deskforge.db")).map_err(|e| e.to_string())?);

            let monitor: Arc<dyn services::SystemMonitor> = Arc::new(SysinfoMonitor::new());
            let perf = Arc::new(PerfManager::new());
            perf.clone().spawn(app.handle().clone(), monitor.clone());

            app.manage(AppState {
                launcher: Arc::new(DbLauncher::new(db.clone())),
                db,
                monitor,
                wallpaper: Arc::new(SystemWallpaper),
                perf,
                desktop: DesktopManager::default(),
                anim: Default::default(),
                blender: Default::default(),
                fx: Default::default(),
                island: Default::default(),
                nowplaying: Default::default(),
            });

            tray::setup(app.handle())?;

            // Autostart launches with --minimized: main window stays in the tray.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
                app.state::<AppState>().perf.set_source("main", false);
            }

            // Bring back pinned desktop widgets (they run even while the main window is hidden).
            let state = app.state::<AppState>();
            if let Err(e) = desktop::restore(app.handle(), &state) {
                eprintln!("couldn't restore desktop widgets: {e}");
            }
            animated::restore(app.handle(), &state);
            fx::restore(app.handle(), &state);
            island::restore(app.handle(), &state);
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
                window.state::<AppState>().perf.set_source("main", false);
            }
            WindowEvent::Destroyed if window.label().starts_with(desktop::PREFIX) => {
                let state = window.state::<AppState>();
                state.perf.set_source(window.label(), false);
                if let Some(session) = state.desktop.forget(window.label()) {
                    if let Err(error) = window.app_handle().emit(
                        "desktop://layout-editor",
                        Option::<desktop::LayoutEditorSession>::None,
                    ) {
                        eprintln!("couldn't clear widget layout editor state: {error}");
                    }
                    if session.return_to_main {
                        if let Err(error) = menu::show_app(window.app_handle()) {
                            eprintln!(
                                "couldn't restore the main window after widget close: {error}"
                            );
                        }
                    }
                }
            }
            WindowEvent::Destroyed if window.label() == animated::LABEL => {
                window.state::<AppState>().anim.clear();
            }
            WindowEvent::Destroyed if window.label() == menu::LABEL => {
                window
                    .state::<AppState>()
                    .perf
                    .set_source(menu::LABEL, false);
            }
            WindowEvent::Destroyed if window.label() == island::LABEL => {
                let state = window.state::<AppState>();
                state.nowplaying.stop();
                state.perf.set_source(island::LABEL, false);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::set_polling_visible,
            commands::set_poll_interval,
            commands::set_wallpaper,
            commands::launcher_list,
            commands::launcher_register,
            commands::launcher_remove,
            commands::launcher_launch,
            commands::settings_get,
            commands::settings_set,
            commands::themes_list,
            commands::theme_save,
            commands::theme_delete,
            commands::theme_export_file,
            commands::theme_import_file,
            commands::widget_store_load,
            commands::widget_store_save,
            commands::widget_layout_set,
            commands::menu_widget_layout_set,
            commands::widget_layout_editor_start,
            commands::widget_layout_editor_update,
            commands::desktop_layout_editor_state,
            commands::desktop_layout_editor_select,
            commands::desktop_layout_editor_stop,
            commands::desktop_list,
            commands::desktop_pin,
            commands::desktop_unpin,
            commands::desktop_set_locked,
            commands::desktop_set_all_locked,
            commands::desktop_state,
            commands::menu_open,
            commands::menu_show_app,
            commands::desktop_commit_bounds,
            commands::media_list,
            commands::media_import_video,
            commands::media_remove,
            commands::wallpaper_start,
            commands::wallpaper_stop,
            commands::wallpaper_status,
            commands::blender_detect,
            commands::blender_set_path,
            commands::blender_render_start,
            commands::blender_cancel,
            commands::fx_start,
            commands::fx_stop,
            commands::fx_status,
            commands::fx_cursor,
            commands::fx_cursor_batch,
            commands::compose_restore_wallpaper,
            commands::image_save_png,
            commands::island_start,
            commands::island_stop,
            commands::island_status,
            commands::island_resize,
            commands::island_monitors,
            commands::island_tick,
            commands::island_volume,
            commands::nowplaying_state,
            commands::nowplaying_control,
            commands::desktop_set_glass,
            commands::desktop_glass_status,
            commands::desktop_glass_diagnostics,
            commands::backdrop_wallpaper,
            commands::backdrop_geometry,
            commands::image_list,
            commands::image_import,
            commands::image_remove,
            commands::image_data,
            commands::compose_set_wallpaper,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DeskForge");
}
