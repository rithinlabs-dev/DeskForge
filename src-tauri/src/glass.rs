//! Native frosted glass behind a pinned desktop widget (Phase 5.3, extended by the Glass Effect Wizard).
//!
//! CSS cannot blur what is behind a transparent window, so Windows has to do it. There are two families of calls:
//!   * `SetWindowCompositionAttribute` (undocumented, widely used): "acrylic" and plain "blur". Windows 10 1803+ and 11.
//!   * `DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE)` (documented): the Windows 11 acrylic "backdrop" and "mica".
//!     Needs Windows 11 22H2 (build 22621) or later. Windows picks the tint; DeskForge cannot.
//! Every function is looked up at run time, so on a Windows build without it the call fails cleanly instead of crashing.
//!
//! "Accepted by Windows" does NOT prove the effect is visible, which is why the wizard in the Look panel shows each
//! method on the real widget and lets the user choose. `sheen` means "no native effect": the widget then draws its own
//! translucent CSS surface, which works on every machine.

use crate::desktop;
use crate::error::{AppError, Result};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fmt::Display;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, WebviewWindow};

/// What the user asked for. `Auto` tries every native method in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GlassKind {
    Auto,
    Acrylic,
    Blur,
    Backdrop,
    Mica,
    Sheen,
    Wallpaper,
}

impl GlassKind {
    fn name(self) -> &'static str {
        match self {
            GlassKind::Auto => "auto",
            GlassKind::Acrylic => "acrylic",
            GlassKind::Blur => "blur",
            GlassKind::Backdrop => "backdrop",
            GlassKind::Mica => "mica",
            GlassKind::Sheen => "sheen",
            GlassKind::Wallpaper => "wallpaper",
        }
    }
}

/// One concrete native technique.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Method {
    Acrylic,
    Blur,
    Backdrop,
    Mica,
}

impl Method {
    fn name(self) -> &'static str {
        match self {
            Method::Acrylic => "acrylic",
            Method::Blur => "blur",
            Method::Backdrop => "backdrop",
            Method::Mica => "mica",
        }
    }
}

/// Windows 10 1803: first build with acrylic through the accent API.
pub const MIN_ACRYLIC_BUILD: u32 = 17134;
/// Windows 11 22H2: first build with the documented system backdrop attribute.
pub const MIN_BACKDROP_BUILD: u32 = 22621;

/// The methods tried for a request, in order. Acrylic still falls back to plain blur, as it always did.
fn ladder(kind: GlassKind) -> &'static [Method] {
    match kind {
        GlassKind::Auto => &[
            Method::Acrylic,
            Method::Blur,
            Method::Backdrop,
            Method::Mica,
        ],
        GlassKind::Acrylic => &[Method::Acrylic, Method::Blur],
        GlassKind::Blur => &[Method::Blur],
        GlassKind::Backdrop => &[Method::Backdrop],
        GlassKind::Mica => &[Method::Mica],
        GlassKind::Sheen | GlassKind::Wallpaper => &[],
    }
}

#[cfg(windows)]
mod imp {
    use std::ffi::c_void;

    #[repr(C)]
    struct AccentPolicy {
        state: i32,
        flags: i32,
        gradient: u32, // ABGR
        animation: i32,
    }
    #[repr(C)]
    struct CompositionData {
        attrib: i32,
        data: *mut c_void,
        size: usize,
    }
    #[repr(C)]
    struct Margins {
        left: i32,
        right: i32,
        top: i32,
        bottom: i32,
    }
    #[repr(C)]
    struct OsVersionInfoW {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        csd: [u16; 128],
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryW(name: *const u16) -> isize;
        fn GetProcAddress(module: isize, name: *const u8) -> *const c_void;
        fn FreeLibrary(module: isize) -> i32;
    }
    type SetWca = unsafe extern "system" fn(isize, *mut CompositionData) -> i32;
    type RtlGetVersion = unsafe extern "system" fn(*mut OsVersionInfoW) -> i32;
    type DwmSetAttr = unsafe extern "system" fn(isize, u32, *const c_void, u32) -> i32;
    type DwmExtend = unsafe extern "system" fn(isize, *const Margins) -> i32;

    /// Loads `lib` and finds `symbol` (NUL-terminated). The caller frees the module when done.
    unsafe fn resolve(lib: &str, symbol: &[u8]) -> Option<(isize, *const c_void)> {
        let name: Vec<u16> = lib.encode_utf16().chain(std::iter::once(0)).collect();
        let module = LoadLibraryW(name.as_ptr());
        if module == 0 {
            return None;
        }
        let proc = GetProcAddress(module, symbol.as_ptr());
        if proc.is_null() {
            FreeLibrary(module);
            return None;
        }
        Some((module, proc))
    }

    /// The real Windows build number (not the compatibility-shimmed one). 0 if it cannot be read.
    pub fn windows_build() -> u32 {
        unsafe {
            let Some((module, proc)) = resolve("ntdll.dll", b"RtlGetVersion\0") else {
                return 0;
            };
            let get: RtlGetVersion = std::mem::transmute(proc);
            let mut info = OsVersionInfoW {
                size: std::mem::size_of::<OsVersionInfoW>() as u32,
                major: 0,
                minor: 0,
                build: 0,
                platform: 0,
                csd: [0; 128],
            };
            let status = get(&mut info);
            FreeLibrary(module);
            if status == 0 {
                info.build
            } else {
                0
            }
        }
    }

    pub fn has_accent_api() -> bool {
        unsafe {
            match resolve("user32.dll", b"SetWindowCompositionAttribute\0") {
                Some((module, _)) => {
                    FreeLibrary(module);
                    true
                }
                None => false,
            }
        }
    }

    /// `state`: 0 off, 3 blur-behind, 4 acrylic. `gradient` is the tint as ABGR.
    pub fn accent(hwnd: isize, state: i32, gradient: u32) -> Result<(), String> {
        unsafe {
            let Some((module, proc)) = resolve("user32.dll", b"SetWindowCompositionAttribute\0")
            else {
                return Err("this Windows version doesn’t support native blur".into());
            };
            let set: SetWca = std::mem::transmute(proc);
            // Windows expects flag 2 together with the blur and acrylic states; with 0 the effect and tint can be ignored.
            let mut policy = AccentPolicy {
                state,
                flags: if state == 0 { 0 } else { 2 },
                gradient,
                animation: 0,
            };
            let mut data = CompositionData {
                attrib: 19, // WCA_ACCENT_POLICY
                data: &mut policy as *mut AccentPolicy as *mut c_void,
                size: std::mem::size_of::<AccentPolicy>(),
            };
            let accepted = set(hwnd, &mut data) != 0;
            FreeLibrary(module);
            if !accepted {
                return Err("Windows rejected the blur request".into());
            }
            Ok(())
        }
    }

    unsafe fn dwm_set(hwnd: isize, attribute: u32, value: i32) -> Result<i32, String> {
        let (module, proc) = resolve("dwmapi.dll", b"DwmSetWindowAttribute\0")
            .ok_or_else(|| "dwmapi.dll is unavailable".to_string())?;
        let set: DwmSetAttr = std::mem::transmute(proc);
        let hr = set(hwnd, attribute, &value as *const i32 as *const c_void, 4);
        FreeLibrary(module);
        Ok(hr)
    }

    unsafe fn dwm_extend(hwnd: isize, margin: i32) -> Result<i32, String> {
        let (module, proc) = resolve("dwmapi.dll", b"DwmExtendFrameIntoClientArea\0")
            .ok_or_else(|| "dwmapi.dll is unavailable".to_string())?;
        let extend: DwmExtend = std::mem::transmute(proc);
        let margins = Margins {
            left: margin,
            right: margin,
            top: margin,
            bottom: margin,
        };
        let hr = extend(hwnd, &margins);
        FreeLibrary(module);
        Ok(hr)
    }

    /// `kind`: 2 = Mica, 3 = acrylic (transient window). Windows 11 22H2+ only.
    pub fn backdrop(hwnd: isize, kind: i32, dark: bool, build: u32) -> Result<(), String> {
        if build < super::MIN_BACKDROP_BUILD {
            return Err(format!(
                "needs Windows 11 22H2 (build {}) or later; this PC is build {build}",
                super::MIN_BACKDROP_BUILD
            ));
        }
        unsafe {
            let _ = dwm_set(hwnd, 20, dark as i32); // DWMWA_USE_IMMERSIVE_DARK_MODE
            let _ = dwm_extend(hwnd, -1); // let the backdrop show through the whole client area
            let hr = dwm_set(hwnd, 38, kind)?; // DWMWA_SYSTEMBACKDROP_TYPE
            if hr < 0 {
                return Err(format!(
                    "Windows refused the backdrop (HRESULT {:#010x})",
                    hr as u32
                ));
            }
        }
        Ok(())
    }

    /// Best effort: switch the DWM backdrop off (no-op before Windows 11 22H2).
    pub fn backdrop_off(hwnd: isize, build: u32) {
        if build < super::MIN_BACKDROP_BUILD {
            return;
        }
        unsafe {
            let _ = dwm_set(hwnd, 38, 1); // DWMSBT_NONE
            let _ = dwm_extend(hwnd, 0);
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn windows_build() -> u32 {
        0
    }
    pub fn has_accent_api() -> bool {
        false
    }
    pub fn accent(_hwnd: isize, _state: i32, _gradient: u32) -> Result<(), String> {
        Err("native blur is only available on Windows".into())
    }
    pub fn backdrop(_hwnd: isize, _kind: i32, _dark: bool, _build: u32) -> Result<(), String> {
        Err("native blur is only available on Windows".into())
    }
    pub fn backdrop_off(_hwnd: isize, _build: u32) {}
}

fn build() -> u32 {
    static BUILD: OnceLock<u32> = OnceLock::new();
    *BUILD.get_or_init(imp::windows_build)
}

#[cfg(windows)]
fn hwnd_of(win: &WebviewWindow) -> Option<isize> {
    win.hwnd().ok().map(|h| h.0 as isize)
}
#[cfg(not(windows))]
fn hwnd_of(_win: &WebviewWindow) -> Option<isize> {
    None
}

fn parse_tint(s: &str) -> Option<(u8, u8, u8)> {
    let h = s.strip_prefix('#')?;
    if h.len() != 6 || !h.is_ascii() {
        return None;
    }
    Some((
        u8::from_str_radix(&h[0..2], 16).ok()?,
        u8::from_str_radix(&h[2..4], 16).ok()?,
        u8::from_str_radix(&h[4..6], 16).ok()?,
    ))
}

fn tint_color(tint: &str, opacity: u32) -> Option<u32> {
    if opacity > 100 {
        return None;
    }
    let (r, g, b) = parse_tint(tint)?;
    let alpha = (opacity * 255 + 50) / 100;
    Some((alpha << 24) | ((b as u32) << 16) | ((g as u32) << 8) | r as u32)
}

/// The Windows 11 backdrops pick light or dark from this flag, so follow the tint the user chose.
fn is_dark(tint: &str) -> bool {
    parse_tint(tint)
        .map(|(r, g, b)| 0.2126 * f64::from(r) + 0.7152 * f64::from(g) + 0.0722 * f64::from(b) < 128.0)
        .unwrap_or(true)
}

/// Switches the other technique off first so two effects never stack, then applies this one.
fn apply_method(
    hwnd: isize,
    method: Method,
    gradient: u32,
    dark: bool,
) -> std::result::Result<(), String> {
    let build = build();
    match method {
        Method::Acrylic | Method::Blur => {
            imp::backdrop_off(hwnd, build);
            imp::accent(hwnd, if method == Method::Acrylic { 4 } else { 3 }, gradient)
        }
        Method::Backdrop | Method::Mica => {
            let _ = imp::accent(hwnd, 0, 0);
            imp::backdrop(hwnd, if method == Method::Mica { 2 } else { 3 }, dark, build)
        }
    }
}

/// Removes every native effect.
fn clear(hwnd: isize) -> std::result::Result<(), String> {
    imp::backdrop_off(hwnd, build());
    imp::accent(hwnd, 0, 0)
}

fn apply_effect<E: Display>(
    kind: GlassKind,
    mut setter: impl FnMut(Method) -> std::result::Result<(), E>,
) -> std::result::Result<String, String> {
    let mut failures = Vec::new();
    for method in ladder(kind) {
        match setter(*method) {
            Ok(()) => return Ok(method.name().to_string()),
            Err(error) => failures.push(format!("{}: {error}", method.name())),
        }
    }
    if failures.is_empty() {
        Err("no glass effect was attempted".into())
    } else {
        Err(failures.join("; "))
    }
}

/// A widget window may only change its own glass; the main window may change any pinned widget's.
/// Returns which effect Windows accepted ("acrylic", "blur", "backdrop", "mica") or "off" (no native effect,
/// including the `sheen` choice), so the UI can say what it did.
pub fn apply(
    app: &AppHandle,
    caller: &WebviewWindow,
    id: &str,
    enabled: bool,
    tint_opacity: u32,
    tint: &str,
    kind: GlassKind,
) -> Result<String> {
    desktop::check_widget_scope(caller, id)?;
    let win = app
        .get_webview_window(&format!("{}{}", desktop::PREFIX, id))
        .ok_or_else(|| AppError::NotFound("that widget isn’t pinned to the desktop".into()))?;
    let hwnd = hwnd_of(&win)
        .ok_or_else(|| AppError::Platform("the window handle is unavailable".into()))?;
    let app_state = app.state::<AppState>();
    let manager = &app_state.desktop;
    let no_native_effect = matches!(kind, GlassKind::Sheen | GlassKind::Wallpaper);
    if !enabled || no_native_effect {
        if let Some(applied) = manager.glass(id).filter(|g| !g.enabled) {
            if applied.error.is_none() && applied.effect == "off" {
                return Ok("off".into());
            }
        }
        if let Err(message) = clear(hwnd) {
            // "Sheen" means no native effect is wanted, so nothing to clear is not a failure.
            if enabled {
                eprintln!("glass: couldn’t clear native effects: {message}");
            } else {
                manager.remember_glass(
                    id,
                    desktop::AppliedGlass {
                        enabled: false,
                        tint_opacity: 0,
                        tint: String::new(),
                        kind: String::new(),
                        effect: "unavailable".into(),
                        error: Some(message.clone()),
                    },
                );
                return Err(AppError::Platform(message));
            }
        }
        manager.remember_glass(
            id,
            desktop::AppliedGlass {
                enabled: false,
                tint_opacity: 0,
                tint: String::new(),
                kind: String::new(),
                effect: "off".into(),
                error: None,
            },
        );
        return Ok("off".into());
    }
    let gradient = tint_color(tint, tint_opacity).ok_or_else(|| {
        AppError::Invalid(
            "glass tint must be a six-digit hex color and tint opacity must be 0-100".into(),
        )
    })?;
    let kind_name = kind.name();
    if let Some(applied) = manager.glass(id) {
        if applied.enabled
            && applied.tint_opacity == tint_opacity
            && applied.tint == tint
            && applied.kind == kind_name
        {
            if let Some(error) = applied.error {
                return Err(AppError::Platform(error));
            }
            return Ok(applied.effect);
        }
    }
    let dark = is_dark(tint);
    let effect = match apply_effect(kind, |method| apply_method(hwnd, method, gradient, dark)) {
        Ok(effect) => effect,
        Err(error) => {
            manager.remember_glass(
                id,
                desktop::AppliedGlass {
                    enabled: true,
                    tint_opacity,
                    tint: tint.to_string(),
                    kind: kind_name.to_string(),
                    effect: "unavailable".into(),
                    error: Some(error.clone()),
                },
            );
            return Err(AppError::Platform(error));
        }
    };
    manager.remember_glass(
        id,
        desktop::AppliedGlass {
            enabled: true,
            tint_opacity,
            tint: tint.to_string(),
            kind: kind_name.to_string(),
            effect: effect.clone(),
            error: None,
        },
    );
    Ok(effect)
}

// ---- diagnostics (the wizard's first step) --------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MethodSupport {
    pub kind: &'static str,
    pub label: &'static str,
    /// Whether this Windows build should support it. The wizard still lets the user test it by eye.
    pub supported: bool,
    /// Whether the tint colour and opacity sliders change this method.
    pub tint_control: bool,
    pub note: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub build: u32,
    pub windows: String,
    pub native_blur_api: bool,
    pub methods: Vec<MethodSupport>,
}

fn windows_name(build: u32) -> String {
    if build >= 22000 {
        format!("Windows 11 (build {build})")
    } else if build >= 10240 {
        format!("Windows 10 (build {build})")
    } else if build == 0 {
        "unknown Windows version".into()
    } else {
        format!("Windows build {build}")
    }
}

fn support_table(build: u32, accent_api: bool) -> Vec<MethodSupport> {
    vec![
        MethodSupport {
            kind: "acrylic",
            label: "Acrylic (frosted)",
            supported: accent_api && build >= MIN_ACRYLIC_BUILD,
            tint_control: true,
            note: "Tint colour and opacity work. Dragging a glass widget can feel slow.",
        },
        MethodSupport {
            kind: "blur",
            label: "Plain blur",
            supported: accent_api,
            tint_control: true,
            note: "Clear blur behind the widget; works on most Windows 10 and 11 builds.",
        },
        MethodSupport {
            kind: "backdrop",
            label: "Windows 11 backdrop",
            supported: build >= MIN_BACKDROP_BUILD,
            tint_control: false,
            note: "Windows 11 22H2 or later. Smooth while dragging, but Windows chooses the tint.",
        },
        MethodSupport {
            kind: "mica",
            label: "Mica",
            supported: build >= MIN_BACKDROP_BUILD,
            tint_control: false,
            note: "Windows 11 22H2 or later. Uses your wallpaper’s colours; may look flat when the widget isn’t focused.",
        },
        MethodSupport {
            kind: "wallpaper",
            label: "Frosted wallpaper",
            supported: true,
            tint_control: true,
            note: "DeskForge blurs your wallpaper behind the widget itself. Works on every Windows version; shows the static wallpaper only.",
        },
        MethodSupport {
            kind: "sheen",
            label: "Translucent sheen",
            supported: true,
            tint_control: true,
            note: "No native effect: the widget draws its own translucent surface. Works everywhere.",
        },
    ]
}

/// Side-effect free: reads the Windows build and which APIs exist, without touching any window.
pub fn diagnostics() -> Diagnostics {
    let build = build();
    let accent_api = imp::has_accent_api();
    Diagnostics {
        build,
        windows: windows_name(build),
        native_blur_api: accent_api,
        methods: support_table(build, accent_api),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_only_six_digit_hex() {
        assert_eq!(parse_tint("#0a120d"), Some((10, 18, 13)));
        assert_eq!(parse_tint("#FFFFFF"), Some((255, 255, 255)));
        assert_eq!(parse_tint("0a120d"), None);
        assert_eq!(parse_tint("#12"), None);
        assert_eq!(parse_tint("#gggggg"), None);
        assert_eq!(parse_tint("#ééé"), None);
    }

    #[test]
    fn tint_opacity_maps_hex_to_windows_abgr_and_validates_range() {
        assert_eq!(tint_color("#18243A", 0), Some(0x003A2418));
        assert_eq!(tint_color("#18243A", 35), Some(0x593A2418));
        assert_eq!(tint_color("#18243A", 70), Some(0xB33A2418));
        assert_eq!(tint_color("#18243A", 100), Some(0xFF3A2418));
        assert_eq!(tint_color("#18243A", 101), None);
        assert_eq!(tint_color("bad", 35), None);
    }

    #[test]
    fn acrylic_falls_back_to_blur_only_when_rejected() {
        let mut tried = Vec::new();
        let effect = apply_effect(GlassKind::Acrylic, |method| {
            tried.push(method);
            if method == Method::Acrylic {
                Err("acrylic rejected")
            } else {
                Ok(())
            }
        });
        assert_eq!(effect.unwrap(), "blur");
        assert_eq!(tried, vec![Method::Acrylic, Method::Blur]);
    }

    #[test]
    fn reports_each_method_that_is_accepted() {
        for (kind, accepted) in [
            (GlassKind::Acrylic, Method::Acrylic),
            (GlassKind::Blur, Method::Blur),
            (GlassKind::Backdrop, Method::Backdrop),
            (GlassKind::Mica, Method::Mica),
        ] {
            let effect = apply_effect(kind, |method| {
                if method == accepted {
                    Ok(())
                } else {
                    Err("rejected")
                }
            });
            assert_eq!(effect.unwrap(), accepted.name());
        }
    }

    #[test]
    fn auto_walks_the_whole_ladder_and_stops_at_the_first_success() {
        let mut tried = Vec::new();
        let effect = apply_effect(GlassKind::Auto, |method| {
            tried.push(method);
            if method == Method::Backdrop {
                Ok(())
            } else {
                Err("rejected")
            }
        });
        assert_eq!(effect.unwrap(), "backdrop");
        assert_eq!(tried, vec![Method::Acrylic, Method::Blur, Method::Backdrop]);
    }

    #[test]
    fn reports_failure_when_every_method_is_rejected() {
        let result = apply_effect(GlassKind::Auto, |_| Err("rejected"));
        assert_eq!(
            result,
            Err("acrylic: rejected; blur: rejected; backdrop: rejected; mica: rejected".into())
        );
        let result = apply_effect(GlassKind::Acrylic, |_| Err("rejected"));
        assert_eq!(result, Err("acrylic: rejected; blur: rejected".into()));
    }

    #[test]
    fn sheen_and_wallpaper_attempt_no_native_method() {
        for kind in [GlassKind::Sheen, GlassKind::Wallpaper] {
            let mut calls = 0;
            let result = apply_effect(kind, |_| {
                calls += 1;
                Ok::<(), &str>(())
            });
            assert_eq!(calls, 0);
            assert!(result.is_err());
        }
    }

    #[test]
    fn dark_mode_follows_the_tint() {
        assert!(is_dark("#18243a"));
        assert!(!is_dark("#f1f3f5"));
        assert!(is_dark("not a colour"));
    }

    #[test]
    fn names_the_windows_generation() {
        assert_eq!(windows_name(22631), "Windows 11 (build 22631)");
        assert_eq!(windows_name(19045), "Windows 10 (build 19045)");
        assert_eq!(windows_name(0), "unknown Windows version");
    }

    #[test]
    fn support_table_follows_the_windows_build() {
        fn find(table: &[MethodSupport], kind: &str) -> bool {
            table.iter().find(|m| m.kind == kind).unwrap().supported
        }
        let win11 = support_table(22631, true);
        assert!(["acrylic", "blur", "backdrop", "mica", "wallpaper", "sheen"]
            .iter()
            .all(|k| find(&win11, k)));
        let win10 = support_table(19045, true);
        assert!(find(&win10, "acrylic") && find(&win10, "blur") && find(&win10, "sheen"));
        assert!(!find(&win10, "backdrop") && !find(&win10, "mica"));
        let old = support_table(10240, true);
        assert!(!find(&old, "acrylic") && find(&old, "blur"));
        let none = support_table(19045, false);
        assert!(!find(&none, "acrylic") && !find(&none, "blur") && find(&none, "sheen"));
    }

    #[test]
    fn the_translucent_sheen_is_always_available_and_native_only_methods_ignore_tint() {
        let table = support_table(0, false);
        assert!(table.iter().find(|m| m.kind == "sheen").unwrap().supported);
        assert!(!table.iter().find(|m| m.kind == "mica").unwrap().tint_control);
        assert!(!table.iter().find(|m| m.kind == "backdrop").unwrap().tint_control);
    }
}
