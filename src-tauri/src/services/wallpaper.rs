use super::WallpaperService;
use crate::error::{AppError, Result};
use std::path::Path;

pub struct SystemWallpaper;

const ALLOWED_EXT: [&str; 4] = ["png", "jpg", "jpeg", "bmp"];

impl WallpaperService for SystemWallpaper {
    fn set(&self, path: &Path) -> Result<()> {
        let ext_ok = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| ALLOWED_EXT.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !ext_ok {
            return Err(AppError::Invalid(
                "wallpaper must be png, jpg or bmp".into(),
            ));
        }
        let canon = path
            .canonicalize()
            .map_err(|_| AppError::NotFound(path.display().to_string()))?;
        if !canon.is_file() {
            return Err(AppError::Invalid("wallpaper path is not a file".into()));
        }
        apply(&canon)
    }
}

#[cfg(windows)]
fn apply(path: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
    };

    // canonicalize() yields a \\?\ prefixed path, which the wallpaper API dislikes.
    let s = path.to_string_lossy();
    let clean = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
    let mut wide: Vec<u16> = std::ffi::OsStr::new(&clean)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            Some(wide.as_mut_ptr() as *mut _),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
    }
    .map_err(|e| AppError::Platform(e.to_string()))
}

#[cfg(not(windows))]
fn apply(_path: &Path) -> Result<()> {
    Err(AppError::Platform(
        "wallpaper changes are only implemented on Windows".into(),
    ))
}
