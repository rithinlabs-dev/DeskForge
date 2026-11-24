//! Phase 5.1/5.2: the desktop image library and "use this composition as the Windows wallpaper".
//! Images are checked by extension AND file signature, size-limited and copied into the app's media folder.
//! The composition itself is drawn in the app (a canvas); only the finished PNG comes back here.

use crate::b64;
use crate::backdrop;
use crate::error::{AppError, Result};
use crate::media;
use crate::state::AppState;
use crate::storage::now_ms;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

const LIB_KEY: &str = "images:library";
pub const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_PNG_BASE64_CHARS: usize = 90 * 1024 * 1024; // about 65 MB of PNG
const PNG_SIGNATURE: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageItem {
    pub id: String,
    pub name: String,
    pub file: String,
    pub kind: String, // png | jpg | webp | gif
    pub size: u64,
    pub added_ms: i64,
}

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

fn dir(app: &AppHandle) -> Result<PathBuf> {
    let d = media::media_dir(app)?.join("images");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

pub fn detect_kind(ext: &str, head: &[u8]) -> Result<&'static str> {
    let png = head.len() >= 8 && head[..8] == PNG_SIGNATURE;
    let jpg = head.len() >= 3 && head[..3] == [0xFF, 0xD8, 0xFF];
    let webp = head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WEBP";
    let gif = head.len() >= 4 && &head[..4] == b"GIF8";
    match ext {
        "png" if png => Ok("png"),
        "jpg" | "jpeg" if jpg => Ok("jpg"),
        "webp" if webp => Ok("webp"),
        "gif" if gif => Ok("gif"),
        "png" | "jpg" | "jpeg" | "webp" | "gif" => Err(AppError::Invalid(
            "that file doesn’t look like a valid image of its type".into(),
        )),
        _ => Err(AppError::Invalid(
            "only PNG, JPEG, WebP and GIF images are supported".into(),
        )),
    }
}

fn load_lib(state: &AppState) -> Vec<ImageItem> {
    state
        .db
        .setting_get(LIB_KEY)
        .ok()
        .flatten()
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}
fn save_lib(state: &AppState, lib: &[ImageItem]) -> Result<()> {
    let v = serde_json::to_value(lib).map_err(|e| AppError::Invalid(e.to_string()))?;
    state.db.setting_set(LIB_KEY, &v)
}

pub fn list(app: &AppHandle, state: &AppState) -> Result<Vec<ImageItem>> {
    let d = dir(app)?;
    Ok(load_lib(state)
        .into_iter()
        .filter(|i| d.join(&i.file).is_file())
        .collect())
}

fn find(app: &AppHandle, state: &AppState, id: &str) -> Result<(ImageItem, PathBuf)> {
    media::check_id(id)?;
    let item = load_lib(state)
        .into_iter()
        .find(|i| i.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    if Path::new(&item.file).file_name().and_then(|n| n.to_str()) != Some(item.file.as_str()) {
        return Err(AppError::Invalid("invalid stored file name".into()));
    }
    let path = dir(app)?.join(&item.file);
    if !path.is_file() {
        return Err(AppError::NotFound(
            "the image file is missing from DeskForge’s folder".into(),
        ));
    }
    Ok((item, path))
}

pub fn import(app: &AppHandle, state: &AppState) -> Result<Option<ImageItem>> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "gif"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let src = picked.into_path().map_err(platform)?;
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    let mut head = [0u8; 12];
    let n = std::fs::File::open(&src)?.read(&mut head)?;
    let kind = detect_kind(&ext, &head[..n])?;
    let size = std::fs::metadata(&src)?.len();
    if size == 0 || size > MAX_IMAGE_BYTES {
        return Err(AppError::Invalid(
            "the image is empty or larger than 25 MB".into(),
        ));
    }
    let id = format!("i-{:x}", now_ms());
    let file = format!("{id}.{kind}");
    std::fs::copy(&src, dir(app)?.join(&file))?;
    let name: String = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Image")
        .chars()
        .filter(|c| !c.is_control())
        .take(48)
        .collect();
    let item = ImageItem {
        id,
        name: if name.trim().is_empty() {
            "Image".into()
        } else {
            name
        },
        file,
        kind: kind.to_string(),
        size,
        added_ms: now_ms(),
    };
    let mut lib = load_lib(state);
    lib.push(item.clone());
    save_lib(state, &lib)?;
    Ok(Some(item))
}

/// A display name for the library: no control characters, trimmed, at most 48 characters, never empty.
pub fn clean_name(raw: &str) -> String {
    let name: String = raw.chars().filter(|c| !c.is_control()).take(48).collect();
    let name = name.trim().to_string();
    if name.is_empty() {
        "Image".into()
    } else {
        name
    }
}

/// Adds a PNG made by the app (for example a picture with its background removed) to the library.
/// `png_base64` is the base64 of the PNG file, with no `data:` prefix. Checked by signature and size.
pub fn save_png(
    app: &AppHandle,
    state: &AppState,
    name: &str,
    png_base64: &str,
) -> Result<ImageItem> {
    if png_base64.len() > MAX_PNG_BASE64_CHARS {
        return Err(AppError::Invalid(
            "the processed image is larger than 25 MB".into(),
        ));
    }
    let bytes = b64::decode(png_base64)
        .ok_or_else(|| AppError::Invalid("the image data was not valid".into()))?;
    if bytes.len() < 8 || bytes[..8] != PNG_SIGNATURE {
        return Err(AppError::Invalid("the image was not a PNG".into()));
    }
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(AppError::Invalid(
            "the processed image is larger than 25 MB".into(),
        ));
    }
    let folder = dir(app)?;
    let mut id = format!("i-{:x}", now_ms());
    let mut counter = 0u32;
    while folder.join(format!("{id}.png")).exists() {
        counter += 1;
        id = format!("i-{:x}-{counter}", now_ms());
    }
    let file = format!("{id}.png");
    std::fs::write(folder.join(&file), &bytes)?;
    let item = ImageItem {
        id,
        name: clean_name(name),
        file,
        kind: "png".into(),
        size: bytes.len() as u64,
        added_ms: now_ms(),
    };
    let mut lib = load_lib(state);
    lib.push(item.clone());
    save_lib(state, &lib)?;
    Ok(item)
}

pub fn remove(app: &AppHandle, state: &AppState, id: &str) -> Result<()> {
    media::check_id(id)?;
    let mut lib = load_lib(state);
    let pos = lib
        .iter()
        .position(|i| i.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    let item = lib.remove(pos);
    save_lib(state, &lib)?;
    let _ = std::fs::remove_file(dir(app)?.join(&item.file));
    Ok(())
}

/// The image as a data: URL. A data URL never taints a canvas, so the composition can be exported afterwards.
pub fn data_url(app: &AppHandle, state: &AppState, id: &str) -> Result<String> {
    let (item, path) = find(app, state, id)?;
    let mime = match item.kind.as_str() {
        "png" => "image/png",
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/gif",
    };
    Ok(format!(
        "data:{mime};base64,{}",
        b64::encode(&std::fs::read(path)?)
    ))
}

/// Save the finished composition (a PNG, base64) and make it the Windows wallpaper. Only the two newest are kept.
pub fn set_wallpaper_from_png(
    app: &AppHandle,
    state: &AppState,
    png_base64: &str,
) -> Result<String> {
    if png_base64.len() > MAX_PNG_BASE64_CHARS {
        return Err(AppError::Invalid(
            "the composition is too large to save as a wallpaper".into(),
        ));
    }
    let bytes = b64::decode(png_base64)
        .ok_or_else(|| AppError::Invalid("the image data was not valid".into()))?;
    if bytes.len() < 8 || bytes[..8] != PNG_SIGNATURE {
        return Err(AppError::Invalid(
            "the composition was not a PNG image".into(),
        ));
    }
    let d = media::media_dir(app)?.join("wallpapers");
    std::fs::create_dir_all(&d)?;
    let path = d.join(format!("composition-{:x}.png", now_ms()));
    std::fs::write(&path, &bytes)?;

    if let Ok(rd) = std::fs::read_dir(&d) {
        let mut files: Vec<(std::time::SystemTime, PathBuf)> = rd
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("composition-"))
            .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
            .collect();
        files.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, old) in files.into_iter().skip(2) {
            let _ = std::fs::remove_file(old);
        }
    }
    // Keep a copy of the wallpaper being replaced so it can be restored. Never blocks setting the new one.
    if let Err(e) = remember_previous_wallpaper(app, state) {
        eprintln!("wallpaper: couldn’t keep a copy of the previous wallpaper: {e}");
    }
    state.wallpaper.set(&path)?;
    Ok(path.to_string_lossy().into_owned())
}

const PREVIOUS_KEY: &str = "wallpaper:previous";
const MAX_PREVIOUS_BYTES: u64 = 48 * 1024 * 1024;

fn wallpapers_dir(app: &AppHandle) -> Result<PathBuf> {
    let d = media::media_dir(app)?.join("wallpapers");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

/// True when `path` is inside `dir` (compared without regard to case or slash direction, as Windows does).
fn is_inside(path: &Path, dir: &Path) -> bool {
    let p = path.to_string_lossy().replace('/', "\\").to_lowercase();
    let mut d = dir.to_string_lossy().replace('/', "\\").to_lowercase();
    if !d.ends_with('\\') {
        d.push('\\');
    }
    p.starts_with(&d)
}

/// Copies the wallpaper that is about to be replaced into DeskForge's folder. If the current wallpaper is already one
/// of DeskForge's own files, the copy made the first time is kept, so "restore" always goes back to the original.
fn remember_previous_wallpaper(app: &AppHandle, state: &AppState) -> Result<()> {
    let Some(current) = backdrop::current_wallpaper_path() else {
        return Ok(());
    };
    let dir = wallpapers_dir(app)?;
    if is_inside(&current, &dir) {
        return Ok(());
    }
    let meta = std::fs::metadata(&current)?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_PREVIOUS_BYTES {
        return Ok(());
    }
    let mut head = [0u8; 12];
    let n = std::fs::File::open(&current)?.read(&mut head)?;
    let Some(ext) = backdrop::sniff_ext(&head[..n]) else {
        return Ok(());
    };
    let name = format!("previous.{ext}");
    let partial = dir.join(format!("{name}.part"));
    std::fs::copy(&current, &partial)?;
    for entry in std::fs::read_dir(&dir)?.flatten() {
        let file = entry.file_name().to_string_lossy().into_owned();
        if file.starts_with("previous.") && file != name && !file.ends_with(".part") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    std::fs::rename(&partial, dir.join(&name))?;
    state
        .db
        .setting_set(PREVIOUS_KEY, &serde_json::Value::String(name))?;
    Ok(())
}

/// Puts back the wallpaper that was in place before DeskForge first replaced it. Returns the file that was restored.
pub fn restore_previous_wallpaper(app: &AppHandle, state: &AppState) -> Result<String> {
    let name = state
        .db
        .setting_get(PREVIOUS_KEY)?
        .and_then(|v| v.as_str().map(str::to_string))
        .ok_or_else(|| {
            AppError::NotFound(
                "DeskForge hasn’t replaced your wallpaper yet, so there’s nothing to restore".into(),
            )
        })?;
    if Path::new(&name).file_name().and_then(|n| n.to_str()) != Some(name.as_str()) {
        return Err(AppError::Invalid("invalid stored file name".into()));
    }
    let path = wallpapers_dir(app)?.join(&name);
    if !path.is_file() {
        return Err(AppError::NotFound(
            "the saved copy of your earlier wallpaper is missing".into(),
        ));
    }
    state.wallpaper.set(&path)?;
    Ok(name)
}

#[cfg(test)]
mod previous_wallpaper_tests {
    use super::*;

    #[test]
    fn finds_files_inside_the_folder_ignoring_case_and_slashes() {
        let dir = Path::new("C:\\Users\\a\\appdata\\roaming\\deskforge\\media\\wallpapers");
        assert!(is_inside(
            Path::new("C:\\Users\\A\\AppData\\Roaming\\DeskForge\\media\\wallpapers\\previous.jpg"),
            dir
        ));
        assert!(is_inside(
            Path::new("c:/users/a/appdata/roaming/deskforge/media/wallpapers/composition-1.png"),
            dir
        ));
    }

    #[test]
    fn does_not_mistake_siblings_or_parents_for_the_folder() {
        let dir = Path::new("C:\\media\\wallpapers");
        assert!(!is_inside(Path::new("C:\\media\\wallpapers2\\x.jpg"), dir));
        assert!(!is_inside(Path::new("C:\\media\\x.jpg"), dir));
        assert!(!is_inside(Path::new("C:\\media\\wallpapers"), dir));
        assert!(!is_inside(Path::new("D:\\media\\wallpapers\\x.jpg"), dir));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_names_are_cleaned() {
        assert_eq!(clean_name("Holiday photo"), "Holiday photo");
        assert_eq!(clean_name("  padded  "), "padded");
        assert_eq!(clean_name("a\u{0}b\nc"), "abc");
        assert_eq!(clean_name(""), "Image");
        assert_eq!(clean_name(" \t "), "Image");
        assert_eq!(clean_name(&"x".repeat(100)).chars().count(), 48);
    }

    #[test]
    fn recognises_each_format_by_signature() {
        assert_eq!(detect_kind("png", &PNG_SIGNATURE).unwrap(), "png");
        assert_eq!(
            detect_kind("jpeg", &[0xFF, 0xD8, 0xFF, 0xE0]).unwrap(),
            "jpg"
        );
        assert_eq!(detect_kind("webp", b"RIFF\0\0\0\0WEBP").unwrap(), "webp");
        assert_eq!(detect_kind("gif", b"GIF89a").unwrap(), "gif");
    }

    #[test]
    fn rejects_mismatched_and_other_files() {
        assert!(detect_kind("png", &[0xFF, 0xD8, 0xFF, 0xE0]).is_err());
        assert!(detect_kind("jpg", &PNG_SIGNATURE).is_err());
        assert!(detect_kind("exe", b"MZ").is_err());
        assert!(detect_kind("svg", b"<svg").is_err());
        assert!(detect_kind("png", &[]).is_err());
    }
}
