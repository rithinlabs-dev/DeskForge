//! Putting a window BEHIND the desktop icons (the "WorkerW" technique), plus z-order helpers.
//! The Win32 functions are declared by hand rather than through the `windows` crate so they cannot break on a
//! crate-version signature change. EXPERIMENTAL: Windows 11 24H2 changed the desktop window layout, so two
//! strategies are tried and the result is reported as a diagnostic string. See docs/WALLPAPER.md.

#[cfg(windows)]
mod imp {
    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class: *const u16, name: *const u16) -> isize;
        fn FindWindowExW(parent: isize, after: isize, class: *const u16, name: *const u16)
            -> isize;
        fn SendMessageTimeoutW(
            hwnd: isize,
            msg: u32,
            wparam: usize,
            lparam: isize,
            flags: u32,
            timeout: u32,
            result: *mut usize,
        ) -> isize;
        fn EnumWindows(
            func: Option<unsafe extern "system" fn(isize, isize) -> i32>,
            lparam: isize,
        ) -> i32;
        fn SetParent(child: isize, parent: isize) -> isize;
        fn GetParent(hwnd: isize) -> isize;
        fn SetWindowPos(
            hwnd: isize,
            after: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
        fn GetSystemMetrics(index: i32) -> i32;
        fn IsWindow(hwnd: isize) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// Finds the top-level window that hosts the icons (SHELLDLL_DefView) and returns the WorkerW after it.
    unsafe extern "system" fn enum_proc(hwnd: isize, lparam: isize) -> i32 {
        let out = &mut *(lparam as *mut isize);
        let defview = FindWindowExW(hwnd, 0, wide("SHELLDLL_DefView").as_ptr(), std::ptr::null());
        if defview != 0 {
            let worker = FindWindowExW(0, hwnd, wide("WorkerW").as_ptr(), std::ptr::null());
            if worker != 0 {
                *out = worker;
            }
        }
        1 // keep enumerating
    }

    pub fn attach(child: isize, x: i32, y: i32, w: i32, h: i32) -> Result<String, String> {
        unsafe {
            if IsWindow(child) == 0 {
                return Err("the wallpaper window handle is not valid".into());
            }
            let progman = FindWindowW(wide("Progman").as_ptr(), std::ptr::null());
            if progman == 0 {
                return Err("Progman (the desktop host window) was not found".into());
            }
            // Ask Explorer to create the WorkerW layer that sits behind the icons.
            let mut res: usize = 0;
            let _ = SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, 0, 1000, &mut res);

            let mut target: isize = 0;
            EnumWindows(Some(enum_proc), &mut target as *mut isize as isize);
            let mut strategy = "classic WorkerW sibling";
            if target == 0 {
                // Windows 11 24H2 layout: the WorkerW is a child of Progman.
                target = FindWindowExW(progman, 0, wide("WorkerW").as_ptr(), std::ptr::null());
                strategy = "WorkerW child of Progman";
            }
            if target == 0 {
                return Err("no WorkerW window was found (this Windows build may use a different desktop layout)".into());
            }

            SetParent(child, target);
            if GetParent(child) != target {
                return Err(format!(
                    "SetParent did not take effect (target {target:#x})"
                ));
            }
            // Child coordinates are relative to the parent, which starts at the virtual screen's top-left.
            let vx = GetSystemMetrics(76);
            let vy = GetSystemMetrics(77);
            SetWindowPos(child, 0, x - vx, y - vy, w, h, 0x0050); // SWP_NOACTIVATE | SWP_SHOWWINDOW
            Ok(format!("{strategy}, parent {target:#x}"))
        }
    }

    /// Send a window to the very bottom of the z-order without moving, resizing or activating it.
    pub fn lower(hwnd: isize) {
        unsafe {
            SetWindowPos(hwnd, 1, 0, 0, 0, 0, 0x0013); // HWND_BOTTOM, NOSIZE | NOMOVE | NOACTIVATE
        }
    }
}

#[cfg(windows)]
pub use imp::{attach, lower};

#[cfg(not(windows))]
pub fn attach(_child: isize, _x: i32, _y: i32, _w: i32, _h: i32) -> Result<String, String> {
    Err("only supported on Windows".into())
}
#[cfg(not(windows))]
pub fn lower(_hwnd: isize) {}
