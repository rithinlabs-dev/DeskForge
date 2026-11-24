//! Performance manager. One dedicated thread emits system snapshots while at least one
//! window "needs" them (the main window when visible, or a desktop widget that reads
//! system stats). With no active source it blocks on a condvar: zero wakeups.

use crate::services::SystemMonitor;
use parking_lot::{Condvar, Mutex};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const MIN_INTERVAL_MS: u64 = 500;
pub const MAX_INTERVAL_MS: u64 = 60_000;

struct State {
    active: HashSet<String>,
    interval: Duration,
}

pub struct PerfManager {
    state: Mutex<State>,
    cv: Condvar,
}

impl PerfManager {
    pub fn new() -> Self {
        let mut active = HashSet::new();
        active.insert("main".to_string());
        Self {
            state: Mutex::new(State {
                active,
                interval: Duration::from_millis(1000),
            }),
            cv: Condvar::new(),
        }
    }

    /// `source` is a window label. Polling runs while any source is active.
    pub fn set_source(&self, source: &str, active: bool) {
        {
            let mut st = self.state.lock();
            if active {
                st.active.insert(source.to_string());
            } else {
                st.active.remove(source);
            }
        }
        self.cv.notify_all();
    }

    pub fn set_interval_ms(&self, ms: u64) {
        let ms = ms.clamp(MIN_INTERVAL_MS, MAX_INTERVAL_MS);
        self.state.lock().interval = Duration::from_millis(ms);
        self.cv.notify_all();
    }

    pub fn spawn(self: Arc<Self>, app: AppHandle, monitor: Arc<dyn SystemMonitor>) {
        std::thread::Builder::new()
            .name("perf-emitter".into())
            .spawn(move || loop {
                let mut st = self.state.lock();
                while st.active.is_empty() {
                    self.cv.wait(&mut st);
                }
                let interval = st.interval;
                let res = self.cv.wait_for(&mut st, interval);
                // Woken early by a settings change: re-evaluate before emitting.
                if !res.timed_out() || st.active.is_empty() {
                    continue;
                }
                drop(st);
                let _ = app.emit("system://snapshot", monitor.snapshot());
            })
            .expect("failed to spawn perf thread");
    }
}
