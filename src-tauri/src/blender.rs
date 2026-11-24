//! OPTIONAL Blender integration. DeskForge does not embed Blender and Blender is never needed to PLAY a wallpaper.
//! If Blender is installed, a .blend file is rendered headlessly (`blender -b`, no Blender window) into an MP4 which
//! then joins the wallpaper library. The Python that Blender runs is generated here from validated numbers and
//! fixed enum values only: no user text ever reaches it. The .blend is opened with --disable-autoexec.

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::{media, storage::now_ms};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

const PATH_KEY: &str = "blender:path";

#[derive(Default)]
pub struct BlenderManager {
    child: Arc<Mutex<Option<Child>>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderOpts {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub quality: String, // LOW | MEDIUM | HIGH
    pub engine: String,  // default | cycles
    pub samples: Option<u32>,
}

impl RenderOpts {
    pub fn validated(&self) -> Result<Self> {
        let bad = |m: &str| Err(AppError::Invalid(m.into()));
        if !(64..=7680).contains(&self.width) || !(64..=4320).contains(&self.height) {
            return bad("resolution must be between 64x64 and 7680x4320");
        }
        if !(1..=120).contains(&self.fps) {
            return bad("fps must be between 1 and 120");
        }
        if !["LOW", "MEDIUM", "HIGH"].contains(&self.quality.as_str()) {
            return bad("quality must be LOW, MEDIUM or HIGH");
        }
        if !["default", "cycles"].contains(&self.engine.as_str()) {
            return bad("engine must be default or cycles");
        }
        if matches!(self.samples, Some(s) if !(1..=4096).contains(&s)) {
            return bad("samples must be between 1 and 4096");
        }
        Ok(self.clone())
    }
}

pub fn render_script(o: &RenderOpts) -> String {
    let mut s = String::from("import bpy\nsc = bpy.context.scene\nr = sc.render\n");
    s += &format!(
        "r.resolution_x = {}\nr.resolution_y = {}\nr.resolution_percentage = 100\nr.fps = {}\n",
        o.width, o.height, o.fps
    );
    s += "r.image_settings.file_format = 'FFMPEG'\nr.ffmpeg.format = 'MPEG4'\nr.ffmpeg.codec = 'H264'\n";
    s += &format!(
        "r.ffmpeg.constant_rate_factor = '{}'\nr.ffmpeg.audio_codec = 'NONE'\n",
        o.quality
    );
    if o.engine == "cycles" {
        s += "r.engine = 'CYCLES'\n";
    }
    if let Some(n) = o.samples {
        s += &format!("try:\n    sc.cycles.samples = {n}\nexcept Exception:\n    pass\n");
        s += &format!("try:\n    sc.eevee.taa_render_samples = {n}\nexcept Exception:\n    pass\n");
    }
    s += "print('DF_FRAMES', sc.frame_end - sc.frame_start + 1, flush=True)\n";
    s
}

pub fn blender_args(blend: &Path, script: &Path, out_prefix: &Path) -> Vec<String> {
    vec![
        "-b".into(),
        "--disable-autoexec".into(),
        blend.to_string_lossy().into_owned(),
        "--python".into(),
        script.to_string_lossy().into_owned(),
        "-o".into(),
        out_prefix.to_string_lossy().into_owned(),
        "-x".into(),
        "1".into(),
        "-a".into(),
    ]
}

fn platform<E: std::fmt::Display>(e: E) -> AppError {
    AppError::Platform(e.to_string())
}

pub fn detect(state: &AppState) -> Option<String> {
    if let Some(Value::String(p)) = state.db.setting_get(PATH_KEY).ok().flatten() {
        if Path::new(&p).is_file() {
            return Some(p);
        }
    }
    let base = PathBuf::from(std::env::var_os("ProgramFiles")?).join("Blender Foundation");
    let mut found: Vec<PathBuf> = std::fs::read_dir(&base)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path().join("blender.exe"))
        .filter(|p| p.is_file())
        .collect();
    found.sort();
    found.pop().map(|p| p.to_string_lossy().into_owned())
}

pub fn set_path(app: &AppHandle, state: &AppState) -> Result<Option<String>> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Blender", &["exe"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(platform)?;
    let is_blender = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("blender.exe"))
        .unwrap_or(false);
    if !is_blender || !path.is_file() {
        return Err(AppError::Invalid("please choose blender.exe".into()));
    }
    let s = path.to_string_lossy().into_owned();
    state.db.setting_set(PATH_KEY, &Value::String(s.clone()))?;
    Ok(Some(s))
}

#[derive(Clone, Serialize)]
struct Progress {
    frame: u32,
    total: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Done {
    ok: bool,
    error: Option<String>,
    item: Option<media::MediaItem>,
}

fn parse_frame(line: &str) -> Option<u32> {
    let rest = line.strip_prefix("Fra:")?;
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

pub fn render_start(app: &AppHandle, state: &AppState, opts: RenderOpts) -> Result<Option<String>> {
    let opts = opts.validated()?;
    let exe = detect(state).ok_or_else(|| {
        AppError::Invalid("Blender was not found. Set its location first.".into())
    })?;
    if state.blender.child.lock().is_some() {
        return Err(AppError::Invalid(
            "a Blender render is already running".into(),
        ));
    }
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Blender file", &["blend"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let blend = picked.into_path().map_err(platform)?.canonicalize()?;
    let is_blend = blend
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("blend"))
        .unwrap_or(false);
    if !is_blend || !blend.is_file() {
        return Err(AppError::Invalid("please choose a .blend file".into()));
    }
    let name = blend
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Blender render")
        .to_string();

    let job = media::media_dir(app)?
        .join("renders")
        .join(format!("job-{}", now_ms()));
    std::fs::create_dir_all(&job)?;
    let script = job.join("df_render.py");
    std::fs::write(&script, render_script(&opts))?;

    let mut cmd = Command::new(&exe);
    cmd.args(blender_args(&blend, &script, &job.join("render_")))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000 | 0x0000_4000); // no console window, below-normal priority
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Platform(format!("couldn’t start Blender: {e}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    state.blender.cancelled.store(false, Ordering::Relaxed);
    *state.blender.child.lock() = Some(child);

    let tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    if let Some(err) = stderr {
        let tail = tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(|l| l.ok()) {
                let mut t = tail.lock();
                t.push(line);
                if t.len() > 12 {
                    t.remove(0);
                }
            }
        });
    }

    let app2 = app.clone();
    let job_name = name.clone();
    let child_slot = state.blender.child.clone();
    let cancelled = state.blender.cancelled.clone();
    std::thread::spawn(move || {
        let mut total = 0u32;
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(|l| l.ok()) {
                if let Some(n) = line.strip_prefix("DF_FRAMES ") {
                    total = n.trim().parse().unwrap_or(0);
                } else if let Some(frame) = parse_frame(&line) {
                    let _ = app2.emit("blender://progress", Progress { frame, total });
                }
            }
        }
        let child = child_slot.lock().take();
        let status = child.and_then(|mut c| c.wait().ok());

        let done = if cancelled.load(Ordering::Relaxed) {
            Done {
                ok: false,
                error: Some("Render cancelled.".into()),
                item: None,
            }
        } else if status.map(|s| s.success()).unwrap_or(false) {
            let video = std::fs::read_dir(&job).ok().and_then(|d| {
                d.filter_map(|e| e.ok())
                    .map(|e| e.path())
                    .find(|p| p.extension().map(|x| x == "mp4").unwrap_or(false))
            });
            match video {
                Some(v) => match media::add_file(
                    &app2,
                    &app2.state::<AppState>(),
                    &v,
                    &job_name,
                    "blender",
                    true,
                ) {
                    Ok(item) => Done {
                        ok: true,
                        error: None,
                        item: Some(item),
                    },
                    Err(e) => Done {
                        ok: false,
                        error: Some(format!("Rendered, but the video couldn’t be added: {e}")),
                        item: None,
                    },
                },
                None => Done {
                    ok: false,
                    error: Some("Blender finished but produced no MP4 file.".into()),
                    item: None,
                },
            }
        } else {
            let t = tail.lock().join(" | ");
            Done {
                ok: false,
                error: Some(format!("Blender failed. {t}")),
                item: None,
            }
        };
        let _ = std::fs::remove_dir_all(&job);
        let _ = app2.emit("blender://done", done);
    });
    Ok(Some(name))
}

pub fn cancel(state: &AppState) -> Result<()> {
    state.blender.cancelled.store(true, Ordering::Relaxed);
    if let Some(c) = state.blender.child.lock().as_mut() {
        let _ = c.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> RenderOpts {
        RenderOpts {
            width: 1920,
            height: 1080,
            fps: 30,
            quality: "MEDIUM".into(),
            engine: "default".into(),
            samples: Some(64),
        }
    }

    #[test]
    fn script_uses_only_validated_values() {
        let s = render_script(&opts().validated().unwrap());
        assert!(s.contains("r.resolution_x = 1920"));
        assert!(s.contains("constant_rate_factor = 'MEDIUM'"));
        assert!(s.contains("sc.cycles.samples = 64"));
        assert!(!s.contains("import os") && !s.contains("subprocess"));
    }

    #[test]
    fn rejects_bad_options() {
        let mut o = opts();
        o.quality = "'; import os; os.system('x')".into();
        assert!(o.validated().is_err());
        assert!(RenderOpts { width: 0, ..opts() }.validated().is_err());
        assert!(RenderOpts { fps: 500, ..opts() }.validated().is_err());
        assert!(RenderOpts {
            samples: Some(0),
            ..opts()
        }
        .validated()
        .is_err());
        assert!(RenderOpts {
            engine: "x".into(),
            ..opts()
        }
        .validated()
        .is_err());
    }

    #[test]
    fn args_disable_autoexec_and_put_output_before_render() {
        let a = blender_args(Path::new("a.blend"), Path::new("s.py"), Path::new("out_"));
        let pos = |s: &str| a.iter().position(|x| x == s).unwrap();
        assert!(pos("--disable-autoexec") < pos("a.blend"));
        assert!(pos("-o") < pos("-a"));
        assert_eq!(a.last().unwrap(), "-a");
    }

    #[test]
    fn parses_blender_progress_lines() {
        assert_eq!(parse_frame("Fra:12 Mem:34.00M | Time:00:01.2"), Some(12));
        assert_eq!(parse_frame("Saved: render_0001.png"), None);
    }
}
