//! Now playing for the floating island: Spotify (or any other player) through the Windows media session API (SMTC).
//!
//! No login, no API key, no Premium needed. Windows already knows what every media player is playing and lets other
//! programs press its buttons, which is the same thing the volume flyout and the lock screen use. That also means it
//! works for Spotify, Apple Music, VLC, and browser tabs playing audio or video.
//!
//! A worker thread owns every Windows call (they block, and need COM set up on that thread): it reads the current
//! session about once a second, keeps the latest reading for `state()`, and emits `nowplaying://state` only when
//! something visible changed. Button presses arrive over a channel so they run on the same thread.

use crate::error::{AppError, Result};
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const POLL: Duration = Duration::from_millis(1000);
/// Windows ticks (100 ns) between 1601-01-01 and 1970-01-01.
const FILETIME_UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    /// Is there a media session at all?
    pub available: bool,
    /// "Spotify", "Chrome", ...
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// "playing", "paused", "stopped" or "none".
    pub status: String,
    pub position_ms: i64,
    pub duration_ms: i64,
    /// Album art as a data: URL, when the player provides it.
    pub art: Option<String>,
    pub can_play_pause: bool,
    pub can_next: bool,
    pub can_previous: bool,
    /// Unix milliseconds when `position_ms` was true, so the page can keep counting between updates.
    pub updated_ms: f64,
}

impl NowPlaying {
    pub fn none(now_ms: f64) -> Self {
        Self {
            available: false,
            app: String::new(),
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            status: "none".into(),
            position_ms: 0,
            duration_ms: 0,
            art: None,
            can_play_pause: false,
            can_next: false,
            can_previous: false,
            updated_ms: now_ms,
        }
    }
}

impl Default for NowPlaying {
    fn default() -> Self {
        Self::none(0.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Control {
    PlayPause,
    Next,
    Previous,
}

impl Control {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "play_pause" => Some(Control::PlayPause),
            "next" => Some(Control::Next),
            "previous" => Some(Control::Previous),
            _ => None,
        }
    }
}

pub fn unix_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

// ---- pure helpers (unit-tested) ---------------------------------------------------------------------------------

fn unix_ms_to_filetime(ms: f64) -> i64 {
    (ms * 10_000.0) as i64 + FILETIME_UNIX_EPOCH_TICKS
}

/// Players report the position when it last changed, not continuously, so add the time that has passed since then.
fn extrapolate_position(
    position_ms: i64,
    last_updated_ticks: i64,
    now_unix_ms: f64,
    playing: bool,
    duration_ms: i64,
) -> i64 {
    let mut position = position_ms.max(0);
    if playing && last_updated_ticks > 0 {
        let elapsed = (unix_ms_to_filetime(now_unix_ms) - last_updated_ticks) / 10_000;
        if (0..=6 * 3600 * 1000).contains(&elapsed) {
            position += elapsed;
        }
    }
    if duration_ms > 0 {
        position.min(duration_ms)
    } else {
        position
    }
}

/// Which media session to show when several exist: Spotify playing, anything playing, Spotify idle, anything else.
fn rank(app_id: &str, playing: bool) -> u8 {
    let spotify = app_id.to_lowercase().contains("spotify");
    match (spotify, playing) {
        (true, true) => 4,
        (false, true) => 3,
        (true, false) => 2,
        (false, false) => 1,
    }
}

/// A short readable name for the player, from the identifier Windows gives (like `Spotify.exe` or `chrome.exe`).
fn friendly_app(app_id: &str) -> String {
    let lower = app_id.to_lowercase();
    for (needle, name) in [
        ("spotify", "Spotify"),
        ("msedge", "Edge"),
        ("chrome", "Chrome"),
        ("firefox", "Firefox"),
        ("vlc", "VLC"),
        ("applemusic", "Apple Music"),
        ("itunes", "iTunes"),
        ("zunemusic", "Media Player"),
        ("zunevideo", "Movies & TV"),
    ] {
        if lower.contains(needle) {
            return name.into();
        }
    }
    let base = app_id
        .split(['!', '_'])
        .next()
        .unwrap_or(app_id)
        .trim_end_matches(".exe");
    let mut chars = base.chars();
    let name: String = match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    };
    name.chars().take(24).collect()
}

/// Should the page hear about `next`? Position drifting along with playback is not news; seeking is.
fn needs_emit(prev: &NowPlaying, next: &NowPlaying) -> bool {
    if prev.available != next.available
        || prev.app != next.app
        || prev.title != next.title
        || prev.artist != next.artist
        || prev.album != next.album
        || prev.status != next.status
        || prev.duration_ms != next.duration_ms
        || prev.art != next.art
        || prev.can_play_pause != next.can_play_pause
        || prev.can_next != next.can_next
        || prev.can_previous != next.can_previous
    {
        return true;
    }
    let expected = if prev.status == "playing" {
        prev.position_ms + (next.updated_ms - prev.updated_ms) as i64
    } else {
        prev.position_ms
    };
    (next.position_ms - expected).abs() > 2000
}

// ---- the Windows side ---------------------------------------------------------------------------------------------

#[cfg(windows)]
mod imp {
    use super::{extrapolate_position, friendly_app, rank, Control, NowPlaying};
    use crate::{b64, backdrop};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Props,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    /// Windows runtime calls need COM initialised on the thread that makes them.
    pub struct Com(bool);
    impl Com {
        pub fn init() -> Self {
            Self(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
        }
    }
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }

    fn status_name(status: Status) -> &'static str {
        if status == Status::Playing {
            "playing"
        } else if status == Status::Paused {
            "paused"
        } else {
            "stopped"
        }
    }

    fn pick(manager: &Manager) -> windows::core::Result<Option<Session>> {
        let sessions = manager.GetSessions()?;
        let mut best: Option<(u8, Session)> = None;
        for i in 0..sessions.Size()? {
            let session = sessions.GetAt(i)?;
            let id = session
                .SourceAppUserModelId()
                .map(|h| h.to_string())
                .unwrap_or_default();
            let playing = session
                .GetPlaybackInfo()
                .and_then(|info| info.PlaybackStatus())
                .map(|status| status == Status::Playing)
                .unwrap_or(false);
            let score = rank(&id, playing);
            if best.as_ref().map_or(true, |(top, _)| score > *top) {
                best = Some((score, session));
            }
        }
        Ok(best.map(|(_, session)| session))
    }

    /// The album art as a data: URL, or None if the player gave none (or something that isn't a picture).
    fn read_art(props: &Props) -> windows::core::Result<Option<String>> {
        let stream = props.Thumbnail()?.OpenReadAsync()?.get()?;
        let size = stream.Size()?;
        if size == 0 || size > 3_000_000 {
            return Ok(None);
        }
        let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
        reader.LoadAsync(size as u32)?.get()?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes)?;
        let mime = match backdrop::sniff_ext(&bytes) {
            Some("png") => "image/png",
            Some("jpg") => "image/jpeg",
            Some("bmp") => "image/bmp",
            Some("webp") => "image/webp",
            _ => return Ok(None),
        };
        Ok(Some(format!("data:{mime};base64,{}", b64::encode(&bytes))))
    }

    #[derive(Default)]
    pub struct Reader {
        manager: Option<Manager>,
        art_key: String,
        art: Option<String>,
        art_tries: u8,
    }

    impl Reader {
        pub fn new() -> Self {
            Self::default()
        }

        fn manager(&mut self) -> windows::core::Result<Manager> {
            if let Some(manager) = &self.manager {
                return Ok(manager.clone());
            }
            let manager = Manager::RequestAsync()?.get()?;
            self.manager = Some(manager.clone());
            Ok(manager)
        }

        pub fn read(&mut self, now_ms: f64) -> NowPlaying {
            match self.try_read(now_ms) {
                Ok(reading) => reading,
                Err(_) => {
                    self.manager = None; // ask Windows for a fresh manager next time
                    NowPlaying::none(now_ms)
                }
            }
        }

        fn try_read(&mut self, now_ms: f64) -> windows::core::Result<NowPlaying> {
            let manager = self.manager()?;
            let Some(session) = pick(&manager)? else {
                return Ok(NowPlaying::none(now_ms));
            };
            let app_id = session
                .SourceAppUserModelId()
                .map(|h| h.to_string())
                .unwrap_or_default();
            let props = session.TryGetMediaPropertiesAsync()?.get()?;
            let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
            let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
            let album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();

            let info = session.GetPlaybackInfo()?;
            let status = status_name(info.PlaybackStatus()?);
            let (can_play_pause, can_next, can_previous) = match info.Controls() {
                Ok(c) => (
                    c.IsPlayPauseToggleEnabled().unwrap_or(true),
                    c.IsNextEnabled().unwrap_or(false),
                    c.IsPreviousEnabled().unwrap_or(false),
                ),
                Err(_) => (true, false, false),
            };

            let (position_ms, duration_ms) = match session.GetTimelineProperties() {
                Ok(t) => {
                    let start = t.StartTime().map(|x| x.Duration).unwrap_or(0);
                    let end = t.EndTime().map(|x| x.Duration).unwrap_or(0);
                    let position = t.Position().map(|x| x.Duration).unwrap_or(0);
                    let last = t.LastUpdatedTime().map(|x| x.UniversalTime).unwrap_or(0);
                    let duration = ((end - start) / 10_000).max(0);
                    let position = extrapolate_position(
                        ((position - start) / 10_000).max(0),
                        last,
                        now_ms,
                        status == "playing",
                        duration,
                    );
                    (position, duration)
                }
                Err(_) => (0, 0),
            };

            // Players often publish the picture a moment after the track changes, so look a few times per track.
            let key = format!("{app_id}\u{1}{title}\u{1}{artist}\u{1}{album}");
            if key != self.art_key {
                self.art_key = key;
                self.art = None;
                self.art_tries = 0;
            }
            if self.art.is_none() && self.art_tries < 6 {
                self.art_tries += 1;
                self.art = read_art(&props).ok().flatten();
            }

            Ok(NowPlaying {
                available: true,
                app: friendly_app(&app_id),
                title,
                artist,
                album,
                status: status.into(),
                position_ms,
                duration_ms,
                art: self.art.clone(),
                can_play_pause,
                can_next,
                can_previous,
                updated_ms: now_ms,
            })
        }

        pub fn control(&mut self, control: Control) -> Result<(), String> {
            let mut run = || -> windows::core::Result<()> {
                let manager = self.manager()?;
                let Some(session) = pick(&manager)? else {
                    return Ok(());
                };
                match control {
                    Control::PlayPause => session.TryTogglePlayPauseAsync()?.get()?,
                    Control::Next => session.TrySkipNextAsync()?.get()?,
                    Control::Previous => session.TrySkipPreviousAsync()?.get()?,
                };
                Ok(())
            };
            run().map_err(|e| e.to_string())
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{Control, NowPlaying};

    pub struct Com;
    impl Com {
        pub fn init() -> Self {
            Com
        }
    }

    pub struct Reader;
    impl Reader {
        pub fn new() -> Self {
            Reader
        }
        pub fn read(&mut self, now_ms: f64) -> NowPlaying {
            NowPlaying::none(now_ms)
        }
        pub fn control(&mut self, _control: Control) -> Result<(), String> {
            Err("media controls are only available on Windows".into())
        }
    }
}

// ---- the worker thread and its manager ----------------------------------------------------------------------------

#[derive(Default)]
struct Shared {
    /// Bumped to start or stop: a worker runs only while this still equals the value it was started with.
    epoch: AtomicU64,
    state: Mutex<NowPlaying>,
    commands: Mutex<Option<mpsc::Sender<Control>>>,
}

#[derive(Default)]
pub struct NowPlayingManager {
    shared: Arc<Shared>,
}

impl NowPlayingManager {
    pub fn start(&self, app: &AppHandle) {
        let shared = Arc::clone(&self.shared);
        let epoch = shared.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        let (sender, receiver) = mpsc::channel();
        *shared.commands.lock() = Some(sender);
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("deskforge-nowplaying".into())
            .spawn(move || worker(app, shared, epoch, receiver));
        if let Err(e) = spawned {
            eprintln!("now playing: couldn’t start the media reader: {e}");
        }
    }

    pub fn stop(&self) {
        self.shared.epoch.fetch_add(1, Ordering::SeqCst);
        *self.shared.commands.lock() = None; // the worker sees the channel close and exits
        *self.shared.state.lock() = NowPlaying::default();
    }

    pub fn state(&self) -> NowPlaying {
        self.shared.state.lock().clone()
    }

    pub fn control(&self, control: Control) -> Result<()> {
        match &*self.shared.commands.lock() {
            Some(sender) => sender
                .send(control)
                .map_err(|_| AppError::Platform("the media reader isn’t running".into())),
            None => Err(AppError::NotFound("the island isn’t running".into())),
        }
    }
}

fn worker(app: AppHandle, shared: Arc<Shared>, epoch: u64, receiver: mpsc::Receiver<Control>) {
    let _com = imp::Com::init();
    let mut reader = imp::Reader::new();
    let mut emitted: Option<NowPlaying> = None;
    while shared.epoch.load(Ordering::SeqCst) == epoch {
        let next = reader.read(unix_ms());
        *shared.state.lock() = next.clone();
        if emitted
            .as_ref()
            .map_or(true, |previous| needs_emit(previous, &next))
        {
            let _ = app.emit("nowplaying://state", &next);
            emitted = Some(next);
        }
        match receiver.recv_timeout(POLL) {
            Ok(control) => {
                if let Err(e) = reader.control(control) {
                    eprintln!("now playing: {e}");
                }
                // give the player a moment to update before the next reading
                std::thread::sleep(Duration::from_millis(300));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn playing(position_ms: i64, updated_ms: f64) -> NowPlaying {
        NowPlaying {
            available: true,
            app: "Spotify".into(),
            title: "Song".into(),
            artist: "Artist".into(),
            album: "Album".into(),
            status: "playing".into(),
            position_ms,
            duration_ms: 200_000,
            art: None,
            can_play_pause: true,
            can_next: true,
            can_previous: true,
            updated_ms,
        }
    }

    #[test]
    fn spotify_wins_over_other_players_when_both_play() {
        assert!(rank("Spotify.exe", true) > rank("chrome.exe", true));
        assert!(rank("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", false) > rank("chrome.exe", false));
        assert!(rank("chrome.exe", true) > rank("Spotify.exe", false));
        assert!(rank("chrome.exe", false) >= 1);
    }

    #[test]
    fn players_get_readable_names() {
        assert_eq!(friendly_app("Spotify.exe"), "Spotify");
        assert_eq!(friendly_app("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Spotify");
        assert_eq!(friendly_app("chrome.exe"), "Chrome");
        assert_eq!(friendly_app("MSEdge"), "Edge");
        assert_eq!(friendly_app("foobar2000.exe"), "Foobar2000");
        assert_eq!(friendly_app(""), "");
        assert!(friendly_app("a-very-long-unknown-player-name-indeed.exe").chars().count() <= 24);
    }

    #[test]
    fn the_position_keeps_counting_while_playing() {
        let now = 1_700_000_000_000.0;
        let five_seconds_ago = unix_ms_to_filetime(now - 5000.0);
        assert_eq!(extrapolate_position(10_000, five_seconds_ago, now, true, 200_000), 15_000);
        assert_eq!(extrapolate_position(10_000, five_seconds_ago, now, false, 200_000), 10_000);
    }

    #[test]
    fn the_position_is_clamped_and_ignores_nonsense() {
        let now = 1_700_000_000_000.0;
        let long_ago = unix_ms_to_filetime(now - 60_000.0);
        assert_eq!(extrapolate_position(190_000, long_ago, now, true, 200_000), 200_000);
        let future = unix_ms_to_filetime(now + 60_000.0);
        assert_eq!(extrapolate_position(10_000, future, now, true, 200_000), 10_000);
        assert_eq!(extrapolate_position(10_000, 0, now, true, 200_000), 10_000);
        assert_eq!(extrapolate_position(-5, 0, now, false, 0), 0);
    }

    #[test]
    fn playback_drift_is_not_news_but_seeking_is() {
        let before = playing(10_000, 1_000.0);
        assert!(!needs_emit(&before, &playing(11_000, 2_000.0))); // one second later, one second further
        assert!(needs_emit(&before, &playing(60_000, 2_000.0))); // jumped ahead
        assert!(needs_emit(&before, &playing(5_000, 2_000.0))); // jumped back
    }

    #[test]
    fn anything_visible_changing_is_news() {
        let before = playing(10_000, 1_000.0);
        let mut next = playing(11_000, 2_000.0);
        next.title = "Another song".into();
        assert!(needs_emit(&before, &next));
        let mut paused = playing(11_000, 2_000.0);
        paused.status = "paused".into();
        assert!(needs_emit(&before, &paused));
        let mut art = playing(11_000, 2_000.0);
        art.art = Some("data:image/png;base64,AAAA".into());
        assert!(needs_emit(&before, &art));
        assert!(needs_emit(&before, &NowPlaying::none(2_000.0)));
    }

    #[test]
    fn a_paused_track_does_not_drift() {
        let mut paused = playing(10_000, 1_000.0);
        paused.status = "paused".into();
        let mut later = paused.clone();
        later.updated_ms = 9_000.0;
        assert!(!needs_emit(&paused, &later));
    }

    #[test]
    fn controls_parse_from_their_names() {
        assert_eq!(Control::parse("play_pause"), Some(Control::PlayPause));
        assert_eq!(Control::parse("next"), Some(Control::Next));
        assert_eq!(Control::parse("previous"), Some(Control::Previous));
        assert_eq!(Control::parse("explode"), None);
    }

    #[test]
    fn controls_fail_cleanly_when_the_island_is_not_running() {
        let manager = NowPlayingManager::default();
        assert!(manager.control(Control::Next).is_err());
        assert_eq!(manager.state().status, "none");
    }
}
