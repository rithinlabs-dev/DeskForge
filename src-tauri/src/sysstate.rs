//! Cheap system-state checks used to pause the animated wallpaper (fullscreen app, battery).
//! Declared by hand for the same reason as desktop_layer.rs.

#[cfg(windows)]
pub fn fullscreen_app_running() -> bool {
    #[link(name = "shell32")]
    extern "system" {
        fn SHQueryUserNotificationState(state: *mut i32) -> i32;
    }
    let mut state: i32 = 0;
    let hr = unsafe { SHQueryUserNotificationState(&mut state) };
    // 2 = busy (fullscreen app), 3 = Direct3D fullscreen game, 4 = presentation mode
    hr >= 0 && matches!(state, 2 | 3 | 4)
}

#[cfg(windows)]
pub fn on_battery() -> bool {
    #[repr(C)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        system_status_flag: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetSystemPowerStatus(status: *mut SystemPowerStatus) -> i32;
    }
    let mut s = SystemPowerStatus {
        ac_line_status: 255,
        battery_flag: 0,
        battery_life_percent: 0,
        system_status_flag: 0,
        battery_life_time: 0,
        battery_full_life_time: 0,
    };
    let ok = unsafe { GetSystemPowerStatus(&mut s) };
    ok != 0 && s.ac_line_status == 0 // 0 = running on battery; 255 = unknown
}

#[cfg(not(windows))]
pub fn fullscreen_app_running() -> bool {
    false
}
#[cfg(not(windows))]
pub fn on_battery() -> bool {
    false
}
