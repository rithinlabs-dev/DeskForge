use crate::desktop;
use crate::error::{AppError, Result};
use crate::menu;
use crate::services::{AppEntry, SystemSnapshot};
use crate::state::AppState;
use crate::storage::Theme;
use crate::{animated, backdrop, blender, fx, glass, images, island, media, nowplaying};
use serde::Serialize;
use serde_json::{Map, Number, Value};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

// ---- system / performance -------------------------------------------------

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> SystemSnapshot {
    state.monitor.snapshot()
}

/// Each window reports for itself, so polling runs while ANY window needs it.
#[tauri::command]
pub fn set_polling_visible(window: WebviewWindow, state: State<'_, AppState>, visible: bool) {
    state.perf.set_source(window.label(), visible);
}

#[tauri::command]
pub fn set_poll_interval(state: State<'_, AppState>, ms: u64) {
    state.perf.set_interval_ms(ms);
}

// ---- wallpaper ------------------------------------------------------------

#[tauri::command]
pub fn set_wallpaper(state: State<'_, AppState>, path: String) -> Result<()> {
    state.wallpaper.set(Path::new(&path))
}

// ---- launcher -------------------------------------------------------------

#[tauri::command]
pub fn launcher_list(state: State<'_, AppState>) -> Result<Vec<AppEntry>> {
    state.launcher.list()
}

#[tauri::command]
pub fn launcher_register(
    state: State<'_, AppState>,
    name: String,
    path: String,
) -> Result<AppEntry> {
    state.launcher.register(&name, &path)
}

#[tauri::command]
pub fn launcher_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    state.launcher.remove(&id)
}

#[tauri::command]
pub fn launcher_launch(state: State<'_, AppState>, id: String) -> Result<()> {
    state.launcher.launch(&id)
}

// ---- storage (M3) ---------------------------------------------------------

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>, key: String) -> Result<Option<Value>> {
    state.db.setting_get(&key)
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    key: String,
    value: Value,
) -> Result<()> {
    state.db.setting_set(&key, &value)?;
    // Lets other windows (desktop widgets) react, e.g. to a theme change.
    let _ = app.emit("settings://changed", &key);
    Ok(())
}

fn valid_layout_element_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    (1..=48).contains(&bytes.len())
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
}

fn layout_number(value: Option<&Value>, fallback: f64, min: f64, max: f64, integer: bool) -> Value {
    let value = value
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
        .clamp(min, max);
    let value = if integer { value.round() } else { value };
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn sanitize_widget_layout(value: Value) -> Result<Value> {
    let Some(elements) = value.as_object() else {
        return Err(AppError::Invalid(
            "widget layout must be a JSON object".into(),
        ));
    };
    if elements.len() > 80 {
        return Err(AppError::Invalid(
            "widget layout contains too many elements".into(),
        ));
    }

    let mut sanitized = Map::new();
    for (id, value) in elements {
        if !valid_layout_element_id(id) {
            continue;
        }
        let fields = value.as_object();
        let mut item = Map::new();
        item.insert(
            "x".into(),
            layout_number(
                fields.and_then(|fields| fields.get("x")),
                0.0,
                -100.0,
                100.0,
                false,
            ),
        );
        item.insert(
            "y".into(),
            layout_number(
                fields.and_then(|fields| fields.get("y")),
                0.0,
                -100.0,
                100.0,
                false,
            ),
        );
        item.insert(
            "order".into(),
            layout_number(
                fields.and_then(|fields| fields.get("order")),
                0.0,
                0.0,
                100.0,
                true,
            ),
        );
        item.insert(
            "scale".into(),
            layout_number(
                fields.and_then(|fields| fields.get("scale")),
                1.0,
                0.25,
                3.0,
                false,
            ),
        );
        item.insert(
            "opacity".into(),
            layout_number(
                fields.and_then(|fields| fields.get("opacity")),
                100.0,
                0.0,
                100.0,
                true,
            ),
        );
        if fields
            .and_then(|fields| fields.get("fontSize"))
            .and_then(Value::as_f64)
            .is_some_and(f64::is_finite)
        {
            item.insert(
                "fontSize".into(),
                layout_number(
                    fields.and_then(|fields| fields.get("fontSize")),
                    16.0,
                    8.0,
                    96.0,
                    true,
                ),
            );
        }
        if let Some(color) = fields
            .and_then(|fields| fields.get("color"))
            .and_then(Value::as_str)
            .filter(|color| {
                color.len() == 7
                    && color.starts_with('#')
                    && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
            })
        {
            item.insert("color".into(), Value::String(color.to_ascii_lowercase()));
        }
        if let Some(align) = fields
            .and_then(|fields| fields.get("align"))
            .and_then(Value::as_str)
            .filter(|align| matches!(*align, "left" | "center" | "right"))
        {
            item.insert("align".into(), Value::String(align.into()));
        }
        sanitized.insert(id.clone(), Value::Object(item));
    }
    Ok(Value::Object(sanitized))
}

fn valid_hex_color(color: &str) -> bool {
    color.len() == 7
        && color.starts_with('#')
        && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn finite_clamp(value: f64, fallback: f64, min: f64, max: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

fn sanitize_layout_elements(
    elements: Vec<desktop::LayoutElementInfo>,
) -> Result<Vec<desktop::LayoutElementInfo>> {
    if elements.len() > 80 {
        return Err(AppError::Invalid(
            "widget reported too many editable elements".into(),
        ));
    }
    let mut ids = std::collections::HashSet::new();
    Ok(elements
        .into_iter()
        .filter_map(|mut element| {
            if !valid_layout_element_id(&element.id)
                || !ids.insert(element.id.clone())
                || !matches!(element.kind.as_str(), "text" | "visual" | "interactive")
            {
                return None;
            }
            element.label = element.label.trim().chars().take(48).collect::<String>();
            if element.label.is_empty() {
                element.label = element.id.clone();
            }
            element.x = finite_clamp(element.x, 0.0, -10000.0, 10000.0);
            element.y = finite_clamp(element.y, 0.0, -10000.0, 10000.0);
            element.width = finite_clamp(element.width, 0.0, 0.0, 10000.0);
            element.height = finite_clamp(element.height, 0.0, 0.0, 10000.0);
            element.font_size = finite_clamp(element.font_size, 16.0, 1.0, 256.0);
            if !valid_hex_color(&element.color) {
                element.color = "#ffffff".into();
            } else {
                element.color.make_ascii_lowercase();
            }
            if !matches!(element.align.as_str(), "left" | "center" | "right") {
                element.align = "left".into();
            }
            Some(element)
        })
        .collect())
}

/// A desktop widget can update only its own entry in the shared layout setting.
#[tauri::command]
pub fn widget_layout_set(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    layout: Value,
) -> Result<()> {
    let label = window.label().to_string();
    let id = label
        .strip_prefix(desktop::PREFIX)
        .ok_or_else(|| AppError::Invalid("not a desktop widget window".into()))?;
    desktop::check_widget_scope(&window, id)?;
    save_widget_layout(&app, &state, id, layout)
}

/// Menu mode may edit only widgets currently pinned to the desktop.
#[tauri::command]
pub fn menu_widget_layout_set(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
    layout: Value,
) -> Result<()> {
    if window.label() != menu::LABEL {
        return Err(AppError::Invalid(
            "only menu mode can edit another widget".into(),
        ));
    }
    if !desktop::list(&state)?.iter().any(|pinned| pinned == &id) {
        return Err(AppError::NotFound(
            "that widget is not pinned to the desktop".into(),
        ));
    }
    save_widget_layout(&app, &state, &id, layout)
}

fn save_widget_layout(app: &AppHandle, state: &AppState, id: &str, layout: Value) -> Result<()> {
    if !desktop::is_widget_id(id) {
        return Err(AppError::Invalid("invalid widget id".into()));
    }
    let layout = sanitize_widget_layout(layout)?;
    let mut layouts = state
        .db
        .setting_get("widgets:layout")?
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    layouts.insert(id.to_owned(), layout);
    state
        .db
        .setting_set("widgets:layout", &Value::Object(layouts))?;
    let _ = app.emit("settings://changed", "widgets:layout");
    Ok(())
}

#[tauri::command]
pub fn themes_list(state: State<'_, AppState>) -> Result<Vec<Theme>> {
    state.db.themes_list()
}

#[tauri::command]
pub fn theme_save(
    state: State<'_, AppState>,
    id: Option<i64>,
    name: String,
    data: Value,
) -> Result<Theme> {
    state.db.theme_save(id, &name, &data)
}

#[tauri::command]
pub fn theme_delete(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.db.theme_delete(id)
}

// ---- theme files (M4) -----------------------------------------------------
// File dialogs live in Rust: the webview never sees or chooses a filesystem path,
// and no fs/dialog plugin permissions are granted to it.

const MAX_PACKAGE_BYTES: u64 = 64 * 1024;

#[tauri::command]
pub async fn theme_export_file(
    app: tauri::AppHandle,
    suggested_name: String,
    json: String,
) -> Result<bool> {
    if json.len() as u64 > MAX_PACKAGE_BYTES {
        return Err(AppError::Invalid("theme file is too large".into()));
    }
    let safe: String = suggested_name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(64)
        .collect();
    let file_name = if safe.is_empty() {
        "theme.dftheme".to_string()
    } else {
        safe
    };

    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("DeskForge theme", &["dftheme", "json"])
        .set_file_name(file_name.as_str())
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = picked
        .into_path()
        .map_err(|e| AppError::Platform(e.to_string()))?;
    std::fs::write(path, json)?;
    Ok(true)
}

#[tauri::command]
pub async fn theme_import_file(app: tauri::AppHandle) -> Result<Option<String>> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("DeskForge theme", &["dftheme", "json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| AppError::Platform(e.to_string()))?;
    if std::fs::metadata(&path)?.len() > MAX_PACKAGE_BYTES {
        return Err(AppError::Invalid(
            "that file is too large to be a theme".into(),
        ));
    }
    Ok(Some(std::fs::read_to_string(path)?))
}

// ---- desktop widgets (M6) -------------------------------------------------

/// Widget data. A desktop widget window can only reach its own widget's data.
#[tauri::command]
pub fn widget_store_load(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<Value> {
    desktop::check_widget_scope(&window, &id)?;
    Ok(state
        .db
        .setting_get(&desktop::store_key(&id))?
        .unwrap_or_else(|| Value::Object(Default::default())))
}

#[tauri::command]
pub fn widget_store_save(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
    data: Value,
) -> Result<()> {
    desktop::check_widget_scope(&window, &id)?;
    if !data.is_object() {
        return Err(AppError::Invalid(
            "widget data must be a JSON object".into(),
        ));
    }
    state.db.setting_set(&desktop::store_key(&id), &data)
}

#[tauri::command]
pub fn desktop_list(state: State<'_, AppState>) -> Result<Vec<String>> {
    desktop::list(&state)
}

// async: creating a window from a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn desktop_pin(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    width: u32,
    height: u32,
) -> Result<()> {
    desktop::pin(&app, &state, &id, width, height)
}

#[tauri::command]
pub fn desktop_unpin(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    desktop::unpin(&app, &state, &id)
}

/// Called by a desktop widget window itself ("Lock here").
#[tauri::command]
pub fn desktop_set_locked(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    locked: bool,
) -> Result<()> {
    desktop::set_locked(&app, &state, &window, locked)
}

fn set_widget_editing_layer(window: &WebviewWindow, editing: bool) -> Result<()> {
    window
        .set_always_on_top(false)
        .map_err(|error| AppError::Platform(error.to_string()))?;
    window
        .set_always_on_bottom(!editing)
        .map_err(|error| AppError::Platform(error.to_string()))?;
    if editing {
        window
            .set_focus()
            .map_err(|error| AppError::Platform(error.to_string()))?;
    }
    Ok(())
}

fn emit_layout_editor_state(app: &AppHandle, session: Option<desktop::LayoutEditorSession>) {
    if let Err(error) = app.emit("desktop://layout-editor", session) {
        eprintln!("couldn't report widget layout editor state: {error}");
    }
}

/// Open menu mode and start editing only the calling desktop widget.
#[tauri::command]
pub async fn widget_layout_editor_start(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    elements: Vec<desktop::LayoutElementInfo>,
) -> Result<()> {
    let id = window
        .label()
        .strip_prefix(desktop::PREFIX)
        .ok_or_else(|| AppError::Invalid("not a desktop widget window".into()))?
        .to_string();
    desktop::check_widget_scope(&window, &id)?;
    let elements = sanitize_layout_elements(elements)?;
    if state
        .desktop
        .layout_editor()
        .is_some_and(|session| session.widget_id != id)
    {
        return Err(AppError::Invalid(
            "finish editing the current widget before opening another".into(),
        ));
    }

    let return_to_main = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::NotFound("the main window is unavailable".into()))?
        .is_visible()
        .map_err(|error| AppError::Platform(error.to_string()))?;
    set_widget_editing_layer(&window, true)?;
    let session = desktop::LayoutEditorSession {
        widget_id: id,
        selected_id: elements
            .first()
            .map(|element| element.id.clone())
            .unwrap_or_default(),
        elements,
        return_to_main,
    };
    state.desktop.set_layout_editor(Some(session.clone()));
    if let Err(error) = menu::open(&app) {
        state.desktop.set_layout_editor(None);
        let _ = set_widget_editing_layer(&window, false);
        return Err(error);
    }
    emit_layout_editor_state(&app, Some(session));
    Ok(())
}

/// Refresh the active widget's element bounds for the menu-mode inspector.
#[tauri::command]
pub fn widget_layout_editor_update(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    elements: Vec<desktop::LayoutElementInfo>,
) -> Result<()> {
    let id = window
        .label()
        .strip_prefix(desktop::PREFIX)
        .ok_or_else(|| AppError::Invalid("not a desktop widget window".into()))?;
    desktop::check_widget_scope(&window, id)?;
    if let Some(session) = state
        .desktop
        .update_layout_editor(id, sanitize_layout_elements(elements)?)
    {
        emit_layout_editor_state(&app, Some(session));
    }
    Ok(())
}

/// Keep the property inspector selection in sync with the desktop element handles.
#[tauri::command]
pub fn desktop_layout_editor_select(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    selected_id: String,
) -> Result<()> {
    let active = state
        .desktop
        .layout_editor()
        .ok_or_else(|| AppError::NotFound("no widget layout editor is open".into()))?;
    let caller = window.label();
    if caller != menu::LABEL {
        let id = caller
            .strip_prefix(desktop::PREFIX)
            .ok_or_else(|| AppError::Invalid("not allowed to select a widget element".into()))?;
        desktop::check_widget_scope(&window, id)?;
        if id != active.widget_id {
            return Err(AppError::Invalid(
                "a widget can only select its own layout elements".into(),
            ));
        }
    }
    let session = state
        .desktop
        .select_layout_element(&active.widget_id, &selected_id)
        .ok_or_else(|| AppError::Invalid("unknown widget layout element".into()))?;
    emit_layout_editor_state(&app, Some(session));
    Ok(())
}

/// Read the active editor session from menu mode.
#[tauri::command]
pub fn desktop_layout_editor_state(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<Option<desktop::LayoutEditorSession>> {
    if window.label() != menu::LABEL {
        return Err(AppError::Invalid(
            "only menu mode can read the layout editor session".into(),
        ));
    }
    Ok(state.desktop.layout_editor())
}

/// Stop the editor from menu mode or from the widget being edited.
#[tauri::command]
pub fn desktop_layout_editor_stop(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    restore_view: bool,
) -> Result<()> {
    let caller = window.label();
    let active = state.desktop.layout_editor();
    if caller != menu::LABEL {
        let id = caller
            .strip_prefix(desktop::PREFIX)
            .ok_or_else(|| AppError::Invalid("not allowed to stop layout editing".into()))?;
        desktop::check_widget_scope(&window, id)?;
        if active
            .as_ref()
            .is_some_and(|session| session.widget_id != id)
        {
            return Err(AppError::Invalid(
                "a widget can only stop its own layout editor".into(),
            ));
        }
    }
    let Some(session) = active else {
        return Ok(());
    };
    if let Some(widget) =
        app.get_webview_window(&format!("{}{}", desktop::PREFIX, session.widget_id))
    {
        set_widget_editing_layer(&widget, false)?;
    }
    state.desktop.set_layout_editor(None);
    emit_layout_editor_state(&app, None);
    if restore_view && session.return_to_main {
        menu::show_app(&app)?;
    }
    Ok(())
}

/// Called by the main window ("Edit desktop layout" / "Lock desktop").
#[tauri::command]
pub fn desktop_set_all_locked(
    app: AppHandle,
    state: State<'_, AppState>,
    locked: bool,
) -> Result<()> {
    desktop::set_all_locked(&app, &state, locked)
}

#[tauri::command]
pub fn desktop_state(window: WebviewWindow, state: State<'_, AppState>) -> bool {
    state.desktop.is_locked(window.label())
}

// ---- menu mode ------------------------------------------------------------

// async: creating a window from a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn menu_open(app: AppHandle) -> Result<()> {
    menu::open(&app)
}

#[tauri::command]
pub fn menu_show_app(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    if let Some(session) = state.desktop.layout_editor() {
        if let Some(widget) =
            app.get_webview_window(&format!("{}{}", desktop::PREFIX, session.widget_id))
        {
            set_widget_editing_layer(&widget, false)?;
        }
        state.desktop.set_layout_editor(None);
        emit_layout_editor_state(&app, None);
    }
    menu::show_app(&app)
}

/// Called by a desktop widget window when the user releases its move or resize control.
#[tauri::command]
pub fn desktop_commit_bounds(window: WebviewWindow, state: State<'_, AppState>) -> Result<()> {
    desktop::commit_bounds(&state, &window)
}

// ---- animated wallpaper, media library, Blender (Phase 2) --------------------

#[tauri::command]
pub fn media_list(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<media::MediaItem>> {
    media::list(&app, &state)
}

#[tauri::command]
pub async fn media_import_video(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<media::MediaItem>> {
    media::import_video(&app, &state)
}

#[tauri::command]
pub fn media_remove(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    animated::stop_if_active(&app, &state, &id)?;
    media::remove(&app, &state, &id)
}

// async: creating a window from a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn wallpaper_start(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<animated::StartInfo> {
    animated::start(&app, &state, &id)
}

#[tauri::command]
pub fn wallpaper_stop(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    animated::stop(&app, &state)
}

#[tauri::command]
pub fn wallpaper_status(app: AppHandle, state: State<'_, AppState>) -> animated::Status {
    animated::status(&app, &state)
}

#[tauri::command]
pub fn blender_detect(state: State<'_, AppState>) -> Option<String> {
    blender::detect(&state)
}

#[tauri::command]
pub async fn blender_set_path(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>> {
    blender::set_path(&app, &state)
}

#[tauri::command]
pub async fn blender_render_start(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: blender::RenderOpts,
) -> Result<Option<String>> {
    blender::render_start(&app, &state, opts)
}

#[tauri::command]
pub fn blender_cancel(state: State<'_, AppState>) -> Result<()> {
    blender::cancel(&state)
}

// ---- cursor effects (Phase 3) -------------------------------------------------

// async: creating a window from a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn fx_start(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    fx::start(&app, &state)
}

#[tauri::command]
pub fn fx_stop(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    fx::stop(&app, &state)
}

#[tauri::command]
pub fn fx_status(app: AppHandle) -> bool {
    fx::running(&app)
}

/// Called by the effects overlay only (checked again inside).
#[tauri::command]
pub fn fx_cursor(window: WebviewWindow, state: State<'_, AppState>) -> Result<fx::CursorSample> {
    fx::cursor(&state, &window)
}

/// Every cursor position change since the last call, timestamped by the sampler. Overlay window only.
#[tauri::command]
pub fn fx_cursor_batch(window: WebviewWindow, state: State<'_, AppState>) -> Result<fx::CursorBatch> {
    fx::cursor_batch(&state, &window)
}

/// Shows the floating island (the pill at the top of the screen).
// async: creating a window from a synchronous command can deadlock on Windows (same reason as fx_start).
#[tauri::command]
pub async fn island_start(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    island::start(&app, &state)
}

#[tauri::command]
pub fn island_stop(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    island::stop(&app, &state)
}

#[tauri::command]
pub fn island_status(app: AppHandle) -> bool {
    island::running(&app)
}

/// The island page asks for the size it needs and where it should sit; the window follows. Island window only.
#[tauri::command]
pub fn island_resize(
    app: AppHandle,
    window: WebviewWindow,
    width: f64,
    height: f64,
    anchor: String,
    offset_x: f64,
    offset_y: f64,
    monitor: u32,
) -> Result<()> {
    let placement = island::placement_from_args(&anchor, offset_x, offset_y, monitor);
    island::resize(&app, &window, width, height, &placement)
}

/// Names of the connected monitors for the island's position picker (the main display first).
#[tauri::command]
pub fn island_monitors(app: AppHandle) -> Result<Vec<String>> {
    island::monitor_names(&app)
}

/// Hides the island while a fullscreen app runs. Returns whether it is hidden now. Island window only.
#[tauri::command]
pub fn island_tick(window: WebviewWindow, state: State<'_, AppState>) -> Result<bool> {
    island::tick(&state, &window)
}

/// Presses the system volume key: "up", "down" or "mute". Island window only.
#[tauri::command]
pub fn island_volume(window: WebviewWindow, action: String) -> Result<()> {
    island::volume(&window, &action)
}

/// What the media player (Spotify or any other) is playing right now.
#[tauri::command]
pub fn nowplaying_state(state: State<'_, AppState>) -> nowplaying::NowPlaying {
    state.nowplaying.state()
}

/// "play_pause", "next" or "previous". Island window only.
#[tauri::command]
pub fn nowplaying_control(window: WebviewWindow, state: State<'_, AppState>, action: String) -> Result<()> {
    island::require_island(&window)?;
    let control = nowplaying::Control::parse(&action)
        .ok_or_else(|| crate::error::AppError::Invalid("unknown media control".into()))?;
    state.nowplaying.control(control)
}

/// Adds a PNG made by the app (a picture with its background removed) to the image library.
/// `png` is the base64 of the PNG file, without the `data:` prefix.
#[tauri::command]
pub fn image_save_png(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    png: String,
) -> Result<images::ImageItem> {
    images::save_png(&app, &state, &name, &png)
}

/// Puts back the wallpaper that was in place before DeskForge first replaced it with a composition.
#[tauri::command]
pub fn compose_restore_wallpaper(app: AppHandle, state: State<'_, AppState>) -> Result<String> {
    images::restore_previous_wallpaper(&app, &state)
}

/// The current Windows wallpaper (a copy in DeskForge’s folder) for the frosted-wallpaper glass. Widget windows only.
#[tauri::command]
pub fn backdrop_wallpaper(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<backdrop::BackdropWallpaper> {
    backdrop::require_widget_window(&window)?;
    backdrop::wallpaper(&app)
}

/// Where this widget window sits on its monitor, in physical pixels. Widget windows only.
#[tauri::command]
pub fn backdrop_geometry(window: WebviewWindow) -> Result<backdrop::Geometry> {
    backdrop::require_widget_window(&window)?;
    backdrop::geometry(&window)
}

/// What this Windows build supports, for the glass wizard. Touches no window.
#[tauri::command]
pub fn desktop_glass_diagnostics() -> glass::Diagnostics {
    glass::diagnostics()
}

/// Native frosted glass behind a pinned widget. A desktop widget window can only change its own.
#[tauri::command]
pub fn desktop_set_glass(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    enabled: bool,
    tint_opacity: u32,
    tint: String,
    kind: glass::GlassKind,
) -> Result<String> {
    let result = glass::apply(&app, &window, &id, enabled, tint_opacity, &tint, kind);
    let event = match &result {
        Ok(effect) => GlassEffectEvent {
            id,
            effect: effect.clone(),
            error: None,
        },
        Err(error) => GlassEffectEvent {
            id,
            effect: "unavailable".into(),
            error: Some(error.to_string()),
        },
    };
    if let Err(error) = app.emit("desktop://glass", event) {
        eprintln!("couldn't report desktop glass status: {error}");
    }
    result
}

#[tauri::command]
pub fn desktop_glass_status(
    window: WebviewWindow,
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<GlassEffectEvent>> {
    desktop::check_widget_scope(&window, &id)?;
    Ok(state.desktop.glass(&id).map(|applied| GlassEffectEvent {
        id,
        effect: applied.effect,
        error: applied.error,
    }))
}

#[derive(Clone, Serialize)]
pub struct GlassEffectEvent {
    pub id: String,
    pub effect: String,
    pub error: Option<String>,
}

// ---- image library and compositions (Phase 5.1 / 5.2) --------------------------
// Heavy work (file reads, base64, writing a wallpaper) is async so it never blocks the UI thread.

#[tauri::command]
pub fn image_list(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<images::ImageItem>> {
    images::list(&app, &state)
}

#[tauri::command]
pub async fn image_import(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<images::ImageItem>> {
    images::import(&app, &state)
}

#[tauri::command]
pub fn image_remove(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    images::remove(&app, &state, &id)
}

#[tauri::command]
pub async fn image_data(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<String> {
    images::data_url(&app, &state, &id)
}

#[tauri::command]
pub async fn compose_set_wallpaper(
    app: AppHandle,
    state: State<'_, AppState>,
    png: String,
) -> Result<String> {
    images::set_wallpaper_from_png(&app, &state, &png)
}

#[cfg(test)]
mod layout_tests {
    use super::*;

    #[test]
    fn widget_layout_is_clamped_and_keeps_only_supported_fields() {
        let value = serde_json::json!({
            "title": {
                "x": 180,
                "y": -160,
                "order": 500,
                "scale": 8,
                "opacity": -2,
                "fontSize": 200,
                "color": "#A1B2C3",
                "align": "center",
                "unexpected": "ignored"
            },
            "invalid id": { "x": 5 }
        });

        assert_eq!(
            sanitize_widget_layout(value).unwrap(),
            serde_json::json!({
                "title": {
                    "x": 100.0,
                    "y": -100.0,
                    "order": 100.0,
                    "scale": 3.0,
                    "opacity": 0.0,
                    "fontSize": 96.0,
                    "color": "#a1b2c3",
                    "align": "center"
                }
            })
        );
    }

    #[test]
    fn widget_layout_rejects_non_objects_and_unsafe_colors() {
        assert!(sanitize_widget_layout(Value::Null).is_err());
        assert_eq!(
            sanitize_widget_layout(serde_json::json!({
                "item": { "color": "url(javascript:alert(1))", "align": "middle" }
            }))
            .unwrap(),
            serde_json::json!({
                "item": { "x": 0.0, "y": 0.0, "order": 0.0, "scale": 1.0, "opacity": 100.0 }
            })
        );
    }
}
