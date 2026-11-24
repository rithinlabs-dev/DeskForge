//! Imported animated-wallpaper videos. Files are validated (extension AND file signature), size-limited and
//! copied into %APPDATA%\dev.deskforge.app\media\ so the original can be moved or deleted.

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::storage::now_ms;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const LIB_KEY: &str = "wallpaper:library";
pub const MAX_VIDEO_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub name: String,
    pub file: String, // plain file name inside the media folder
    pub kind: String, // "mp4" | "webm"
    pub size: u64,
    pub added_ms: i64,
    pub source: String, // "import" | "blender"
}

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

pub fn media_dir(app: &AppHandle) -> Result<PathBuf> {
    let dir = app.path().app_data_dir().map_err(platform)?.join("media");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn check_id(id: &str) -> Result<()> {
    if !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        Ok(())
    } else {
        Err(AppError::Invalid("invalid media id".into()))
    }
}

/// Decide what a file is from its extension AND its first bytes. Never trust the extension alone.
pub fn detect_kind(ext: &str, head: &[u8]) -> Result<&'static str> {
    match ext {
        "mp4" | "m4v" if head.len() >= 8 && &head[4..8] == b"ftyp" => Ok("mp4"),
        "webm" if head.len() >= 4 && head[..4] == [0x1A, 0x45, 0xDF, 0xA3] => Ok("webm"),
        "mp4" | "m4v" | "webm" => Err(AppError::Invalid(
            "that file doesn’t look like a valid video of its type".into(),
        )),
        _ => Err(AppError::Invalid(
            "only .mp4 and .webm videos are supported".into(),
        )),
    }
}

fn sniff(path: &Path) -> Result<&'static str> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let mut head = [0u8; 12];
    let n = std::fs::File::open(path)?.read(&mut head)?;
    detect_kind(&ext, &head[..n])
}

fn load_lib(state: &AppState) -> Vec<MediaItem> {
    state
        .db
        .setting_get(LIB_KEY)
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

fn save_lib(state: &AppState, lib: &[MediaItem]) -> Result<()> {
    let v = serde_json::to_value(lib).map_err(|e| AppError::Invalid(e.to_string()))?;
    state.db.setting_set(LIB_KEY, &v)
}

pub fn list(app: &AppHandle, state: &AppState) -> Result<Vec<MediaItem>> {
    let dir = media_dir(app)?;
    Ok(load_lib(state)
        .into_iter()
        .filter(|m| dir.join(&m.file).is_file())
        .collect())
}

pub fn find(app: &AppHandle, state: &AppState, id: &str) -> Result<(MediaItem, PathBuf)> {
    check_id(id)?;
    let item = load_lib(state)
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    if Path::new(&item.file).file_name().and_then(|n| n.to_str()) != Some(item.file.as_str()) {
        return Err(AppError::Invalid("invalid stored file name".into()));
    }
    let path = media_dir(app)?.join(&item.file);
    if !path.is_file() {
        return Err(AppError::NotFound(
            "the video file is missing from DeskForge's media folder".into(),
        ));
    }
    Ok((item, path))
}

/// Validate and add a video to the library (copying it, or moving it for Blender renders).
pub fn add_file(
    app: &AppHandle,
    state: &AppState,
    src: &Path,
    display: &str,
    source: &str,
    move_src: bool,
) -> Result<MediaItem> {
    let kind = sniff(src)?;
    let size = std::fs::metadata(src)?.len();
    if size == 0 || size > MAX_VIDEO_BYTES {
        return Err(AppError::Invalid(
            "the video is empty or larger than 2 GB".into(),
        ));
    }
    let id = format!("m-{:x}", now_ms());
    let file = format!("{id}.{kind}");
    let dest = media_dir(app)?.join(&file);
    if move_src {
        if std::fs::rename(src, &dest).is_err() {
            std::fs::copy(src, &dest)?;
            let _ = std::fs::remove_file(src);
        }
    } else {
        std::fs::copy(src, &dest)?;
    }
    let name: String = display
        .chars()
        .filter(|c| !c.is_control())
        .take(64)
        .collect();
    let item = MediaItem {
        id,
        name: if name.trim().is_empty() {
            "Untitled".into()
        } else {
            name.trim().to_string()
        },
        file,
        kind: kind.to_string(),
        size,
        added_ms: now_ms(),
        source: source.to_string(),
    };
    let mut lib = load_lib(state);
    lib.push(item.clone());
    save_lib(state, &lib)?;
    Ok(item)
}

/// Native file picker; the webview never sees or chooses a path.
pub fn import_video(app: &AppHandle, state: &AppState) -> Result<Option<MediaItem>> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Video", &["mp4", "m4v", "webm"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(platform)?;
    let name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        .to_string();
    add_file(app, state, &path, &name, "import", false).map(Some)
}

pub fn remove(app: &AppHandle, state: &AppState, id: &str) -> Result<()> {
    check_id(id)?;
    let mut lib = load_lib(state);
    let pos = lib
        .iter()
        .position(|m| m.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    let item = lib.remove(pos);
    save_lib(state, &lib)?;
    let _ = std::fs::remove_file(media_dir(app)?.join(&item.file));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_mp4_and_webm() {
        let mp4 = [
            0, 0, 0, 0x18, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm',
        ];
        assert_eq!(detect_kind("mp4", &mp4).unwrap(), "mp4");
        assert_eq!(
            detect_kind("webm", &[0x1A, 0x45, 0xDF, 0xA3, 0, 0]).unwrap(),
            "webm"
        );
    }

    #[test]
    fn rejects_mismatches_and_other_types() {
        assert!(detect_kind("mp4", &[0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0]).is_err());
        assert!(detect_kind("webm", b"\0\0\0\x18ftypisom").is_err());
        assert!(detect_kind("exe", b"MZ").is_err());
        assert!(detect_kind("mp4", &[]).is_err());
    }

    #[test]
    fn ids_are_restricted() {
        assert!(check_id("m-1a2b").is_ok());
        assert!(check_id("../x").is_err());
        assert!(check_id("").is_err());
    }
}
