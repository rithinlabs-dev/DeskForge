//! "Frosted wallpaper" glass: DeskForge blurs a copy of the desktop wallpaper behind the widget itself.
//!
//! Native glass (see glass.rs) depends on what Windows accepts and shows. This does not: the widget window is
//! transparent, DeskForge knows where the window is and what the wallpaper is, so the page can draw the matching
//! blurred slice of that wallpaper behind the widget. It works on every Windows version and never lags while a widget
//! is dragged. Limits: it shows the static wallpaper (not windows or icons behind the widget), and it assumes the
//! Windows "Fill" picture position on the monitor the widget is on.
//!
//! Two commands feed the page, and only a desktop widget window may call them:
//!   * the wallpaper: copied into DeskForge's own media folder, so the page loads it through the asset protocol
//!     instead of shipping megabytes through IPC;
//!   * the window and monitor geometry in physical pixels.

use crate::desktop;
use crate::error::{AppError, Result};
use crate::media;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, WebviewWindow};

const MAX_WALLPAPER_BYTES: u64 = 48 * 1024 * 1024;
static COPY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackdropWallpaper {
    /// Absolute path of DeskForge's copy (inside the media folder the asset protocol serves).
    pub path: String,
    /// Changes whenever the wallpaper changes; the page reloads only when it differs.
    pub key: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Geometry {
    pub win_x: i32,
    pub win_y: i32,
    pub win_w: u32,
    pub win_h: u32,
    pub mon_x: i32,
    pub mon_y: i32,
    pub mon_w: u32,
    pub mon_h: u32,
    /// Physical pixels per CSS pixel.
    pub scale: f64,
}

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

/// Only a desktop widget window (label `dw-<id>`) may use these commands.
pub fn require_widget_window(window: &WebviewWindow) -> Result<()> {
    if window.label().starts_with(desktop::PREFIX) {
        Ok(())
    } else {
        Err(AppError::Invalid(
            "only a desktop widget window can use this".into(),
        ))
    }
}

/// The picture type by file signature. Windows keeps some wallpapers in files with no extension
/// (for example `TranscodedWallpaper`), so the name cannot be trusted.
pub fn sniff_ext(head: &[u8]) -> Option<&'static str> {
    if head.len() >= 8 && head[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        Some("png")
    } else if head.len() >= 3 && head[..3] == [0xFF, 0xD8, 0xFF] {
        Some("jpg")
    } else if head.len() >= 2 && &head[..2] == b"BM" {
        Some("bmp")
    } else if head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// A small stable hash, so a different wallpaper path never reuses an old copy.
fn fnv(text: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn copy_key(path_text: &str, modified_ms: u128, len: u64) -> String {
    format!("{:x}-{:x}-{:x}", fnv(path_text), modified_ms, len)
}

#[cfg(windows)]
pub fn current_wallpaper_path() -> Option<PathBuf> {
    use std::ffi::{c_void, OsString};
    use std::os::windows::ffi::OsStringExt;

    #[link(name = "user32")]
    extern "system" {
        fn SystemParametersInfoW(action: u32, param: u32, pv: *mut c_void, win_ini: u32) -> i32;
    }
    const SPI_GETDESKWALLPAPER: u32 = 0x0073;
    let mut buffer = [0u16; 520];
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buffer.len() as u32,
            buffer.as_mut_ptr() as *mut c_void,
            0,
        )
    };
    if ok == 0 {
        return None;
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    if len == 0 {
        return None;
    }
    Some(PathBuf::from(OsString::from_wide(&buffer[..len])))
}

#[cfg(not(windows))]
pub fn current_wallpaper_path() -> Option<PathBuf> {
    None
}

fn backdrop_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = media::media_dir(app)?.join("backdrop");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Copies the current wallpaper into DeskForge's folder (only when it changed) and returns where it is.
pub fn wallpaper(app: &AppHandle) -> Result<BackdropWallpaper> {
    let source: PathBuf = current_wallpaper_path().ok_or_else(|| {
        AppError::NotFound(
            "Windows isn’t showing a picture wallpaper (a solid colour or slideshow?)".into(),
        )
    })?;
    let meta = std::fs::metadata(&source)
        .map_err(|_| AppError::NotFound("the wallpaper file couldn’t be read".into()))?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_WALLPAPER_BYTES {
        return Err(AppError::Invalid(
            "the wallpaper file is empty or larger than 48 MB".into(),
        ));
    }
    let mut head = [0u8; 12];
    let read = std::fs::File::open(&source)?.read(&mut head)?;
    let ext = sniff_ext(&head[..read]).ok_or_else(|| {
        AppError::Invalid("the wallpaper isn’t a PNG, JPEG, BMP or WebP picture".into())
    })?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let key = copy_key(&source.to_string_lossy(), modified_ms, meta.len());
    let name = format!("wallpaper-{key}.{ext}");

    let _guard = COPY_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = backdrop_dir(app)?;
    let destination = dir.join(&name);
    if !destination.is_file() {
        let partial = dir.join(format!("{name}.part"));
        std::fs::copy(&source, &partial)?;
        std::fs::rename(&partial, &destination)?;
        remove_old_copies(&dir, &name);
    }
    Ok(BackdropWallpaper {
        path: destination.to_string_lossy().into_owned(),
        key,
    })
}

fn remove_old_copies(dir: &Path, keep: &str) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            if file.starts_with("wallpaper-") && file != keep {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

/// Where the widget window sits on its monitor, in physical pixels.
pub fn geometry(window: &WebviewWindow) -> Result<Geometry> {
    let position = window.inner_position().map_err(platform)?;
    let size = window.inner_size().map_err(platform)?;
    let monitor = window
        .current_monitor()
        .map_err(platform)?
        .ok_or_else(|| AppError::NotFound("the widget isn’t on a monitor".into()))?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    Ok(Geometry {
        win_x: position.x,
        win_y: position.y,
        win_w: size.width,
        win_h: size.height,
        mon_x: monitor_position.x,
        mon_y: monitor_position.y,
        mon_w: monitor_size.width,
        mon_h: monitor_size.height,
        scale: window.scale_factor().map_err(platform)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_wallpaper_formats_by_signature_not_by_name() {
        assert_eq!(
            sniff_ext(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
            Some("png")
        );
        assert_eq!(sniff_ext(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"));
        assert_eq!(sniff_ext(b"BM\x36\x00"), Some("bmp"));
        assert_eq!(sniff_ext(b"RIFF\0\0\0\0WEBP"), Some("webp"));
        assert_eq!(sniff_ext(b"MZ\x90\x00"), None);
        assert_eq!(sniff_ext(b"GIF89a"), None);
        assert_eq!(sniff_ext(&[]), None);
    }

    #[test]
    fn the_copy_key_changes_when_the_wallpaper_changes() {
        let a = copy_key("C:\\w\\a.jpg", 1000, 50);
        assert_eq!(a, copy_key("C:\\w\\a.jpg", 1000, 50));
        assert_ne!(a, copy_key("C:\\w\\b.jpg", 1000, 50));
        assert_ne!(a, copy_key("C:\\w\\a.jpg", 1001, 50));
        assert_ne!(a, copy_key("C:\\w\\a.jpg", 1000, 51));
    }

    #[test]
    fn old_copies_are_removed_but_the_current_one_is_kept() {
        let dir = std::env::temp_dir().join(format!("deskforge-backdrop-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["wallpaper-old.jpg", "wallpaper-new.jpg", "other.txt"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        remove_old_copies(&dir, "wallpaper-new.jpg");
        assert!(!dir.join("wallpaper-old.jpg").exists());
        assert!(dir.join("wallpaper-new.jpg").exists());
        assert!(dir.join("other.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
