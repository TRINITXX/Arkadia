//! Foreground-theft probe for the notification popup.
//!
//! Drops a fake notify signal for the given pane id while another app owns the
//! foreground, then samples `GetForegroundWindow` for a few seconds. Also logs
//! `GetLastInputInfo` so a mechanical focus steal can be told apart from a
//! human click, and lists the Arkadia process windows before/after so the
//! stolen-to window can be identified (main vs popup).
//!
//! Usage: cargo run --example fg_trace -- <paneId>

#[cfg(windows)]
fn main() {
    use std::io::Write;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect,
        GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE,
    };

    fn describe(hwnd: HWND) -> String {
        unsafe {
            let mut title = [0u16; 256];
            let n = GetWindowTextW(hwnd, &mut title);
            let mut class = [0u16; 256];
            let c = GetClassNameW(hwnd, &mut class);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let mut rect = RECT::default();
            let _ = GetWindowRect(hwnd, &mut rect);
            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            format!(
                "hwnd={:?} pid={} ex={:#x} rect={}x{} class={} title={}",
                hwnd,
                pid,
                ex,
                rect.right - rect.left,
                rect.bottom - rect.top,
                String::from_utf16_lossy(&class[..c.max(0) as usize]),
                String::from_utf16_lossy(&title[..n.max(0) as usize]),
            )
        }
    }

    // Visible top-level windows of the given pid.
    fn pid_windows(target: u32) -> Vec<isize> {
        unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> windows::core::BOOL {
            let out = &mut *(lp.0 as *mut (u32, Vec<isize>));
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid == out.0 && IsWindowVisible(hwnd).as_bool() {
                out.1.push(hwnd.0 as isize);
            }
            true.into()
        }
        let mut state = (target, Vec::new());
        unsafe {
            let _ = EnumWindows(Some(cb), LPARAM(&mut state as *mut _ as isize));
        }
        state.1
    }

    fn ms_since_last_input() -> u32 {
        unsafe {
            let mut lii = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            let _ = GetLastInputInfo(&mut lii);
            GetTickCount().wrapping_sub(lii.dwTime)
        }
    }

    let pane = std::env::args().nth(1).expect("usage: fg_trace <paneId>");

    // Find arkadia.exe pid via its windows: sample the foreground later; for the
    // before/after dump we take the pid from any window titled Arkadia.
    let fg0 = unsafe { GetForegroundWindow() };
    println!("start fg: {}", describe(fg0));
    let mut ark_pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(fg0, Some(&mut ark_pid));
    }
    // The foreground may not be Arkadia; locate Arkadia's pid via tasklist-free
    // scan: enumerate all windows and keep the pid whose window title is
    // exactly "Arkadia" with class "Tauri Window".
    unsafe extern "system" fn find_ark(hwnd: HWND, lp: LPARAM) -> windows::core::BOOL {
        unsafe {
            let mut class = [0u16; 64];
            let c = GetClassNameW(hwnd, &mut class);
            if String::from_utf16_lossy(&class[..c.max(0) as usize]) == "Tauri Window" {
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                *(lp.0 as *mut u32) = pid;
            }
            true.into()
        }
    }
    unsafe {
        let _ = EnumWindows(Some(find_ark), LPARAM(&mut ark_pid as *mut _ as isize));
    }
    println!("arkadia pid guess: {ark_pid}");
    let before = pid_windows(ark_pid);
    println!("arkadia windows BEFORE:");
    for h in &before {
        println!("  {}", describe(HWND(*h as *mut core::ffi::c_void)));
    }

    // Close any existing toast window (narrow "Tauri Window" of this pid): the
    // popup only recreates its webview on the create path, which is what we
    // measure. The queue keeps its item, so re-signaling the same pane
    // recreates it. The class check matters: this pid also owns tiny internal
    // helper windows (single-instance, tao event target) that must NOT get a
    // WM_CLOSE.
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};
        for &h in &before {
            let hwnd = HWND(h as *mut core::ffi::c_void);
            let mut class = [0u16; 64];
            let c = GetClassNameW(hwnd, &mut class);
            let is_tauri = String::from_utf16_lossy(&class[..c.max(0) as usize]) == "Tauri Window";
            let mut rect = RECT::default();
            let _ = GetWindowRect(hwnd, &mut rect);
            if is_tauri && rect.right - rect.left < 1000 && rect.bottom - rect.top < 400 {
                println!("closing existing toast {}", describe(hwnd));
                let _ = PostMessageW(
                    Some(hwnd),
                    WM_CLOSE,
                    windows::Win32::Foundation::WPARAM(0),
                    windows::Win32::Foundation::LPARAM(0),
                );
            }
        }
    }
    std::thread::sleep(Duration::from_millis(600));

    // Abort if Arkadia currently owns the foreground — the popup wouldn't show.
    unsafe {
        let mut fg_pid = 0u32;
        GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut fg_pid));
        if fg_pid == ark_pid {
            println!("ABORT: Arkadia is foreground; the popup would be suppressed.");
            return;
        }
    }

    let sig_dir = dirs::data_local_dir()
        .unwrap()
        .join("Arkadia")
        .join("notify");
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let sig = format!(r#"{{"cwd":"C:\\FAKE","kind":"done","ts":{ts},"paneId":"{pane}"}}"#);

    let start = Instant::now();
    let mut dropped = false;
    let mut last = String::new();
    while start.elapsed() < Duration::from_secs(8) {
        if !dropped && start.elapsed() >= Duration::from_millis(1000) {
            std::fs::write(sig_dir.join("fgtrace.json"), &sig).unwrap();
            println!(
                "{:5}ms  --- signal dropped ---",
                start.elapsed().as_millis()
            );
            dropped = true;
        }
        let line = format!(
            "{} | last_input={}ms ago",
            describe(unsafe { GetForegroundWindow() }),
            ms_since_last_input()
        );
        // Only print on foreground change; last_input is informational.
        let fg_part = line.split(" | ").next().unwrap_or("").to_string();
        if fg_part != last {
            println!("{:5}ms  {line}", start.elapsed().as_millis());
            last = fg_part;
        }
        std::io::stdout().flush().ok();
        std::thread::sleep(Duration::from_millis(25));
    }

    println!("arkadia windows AFTER:");
    for h in pid_windows(ark_pid) {
        let is_new = !before.contains(&h);
        println!(
            "  {}{}",
            describe(HWND(h as *mut core::ffi::c_void)),
            if is_new { "   <-- NEW (popup)" } else { "" }
        );
    }
}

#[cfg(not(windows))]
fn main() {}
