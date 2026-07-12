//! Isolated reproduction of the popup focus steal.
//!
//! Boots a minimal Tauri app (main window hidden immediately), waits for the
//! boot-time WebView2 focus churn to settle, then creates a popup window with
//! exactly the notification options and samples `GetForegroundWindow` around
//! the creation. Run with `-- noact` to additionally stamp `WS_EX_NOACTIVATE`
//! on the popup right after build (the candidate fix); without it, this shows
//! the current (stealing) behavior.
//!
//! NOTE: tauri-build only embeds its Windows manifest for BINS, so this
//! example must be linked with examples/probe.manifest by hand or it dies at
//! load with STATUS_ENTRYPOINT_NOT_FOUND (comctl32 v5 lacks TaskDialogIndirect):
//!
//!   cargo rustc --example popup_probe -- \
//!     -C link-arg=/MANIFEST:EMBED \
//!     -C "link-arg=/MANIFESTINPUT:<abs path to examples/probe.manifest>"
//!   ../target/debug/examples/popup_probe.exe [noact]

#[cfg(windows)]
fn main() {
    use std::time::{Duration, Instant};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    fn fg_line() -> String {
        unsafe {
            let hwnd = GetForegroundWindow();
            let mut title = [0u16; 128];
            let n = GetWindowTextW(hwnd, &mut title);
            let mut class = [0u16; 128];
            let c = GetClassNameW(hwnd, &mut class);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            format!(
                "hwnd={:?} pid={} class={} title={}",
                hwnd,
                pid,
                String::from_utf16_lossy(&class[..c.max(0) as usize]),
                String::from_utf16_lossy(&title[..n.max(0) as usize]),
            )
        }
    }

    let noact = std::env::args().any(|a| a == "noact");
    let my_pid = std::process::id();
    println!(
        "probe pid={my_pid} mode={}",
        if noact { "NOACTIVATE" } else { "current" }
    );

    tauri::Builder::default()
        .setup(move |app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                // Let the boot-time webview init settle before measuring.
                std::thread::sleep(Duration::from_secs(3));
                println!("fg before create: {}", fg_line());

                let start = Instant::now();
                let win = WebviewWindowBuilder::new(
                    &handle,
                    "popup-probe",
                    WebviewUrl::App("index.html?window=notif&pane=probe".into()),
                )
                .title("Arkadia")
                .inner_size(360.0, 76.0)
                .min_inner_size(240.0, 52.0)
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build()
                .expect("popup build failed");

                if noact {
                    use windows::Win32::UI::WindowsAndMessaging::{
                        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
                    };
                    if let Ok(hwnd) = win.hwnd() {
                        unsafe {
                            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE.0 as isize);
                        }
                        println!("WS_EX_NOACTIVATE stamped");
                    }
                }

                let _ = win.show();
                println!("popup created+shown in {}ms", start.elapsed().as_millis());

                // Sample the foreground for 5s: any flip to our pid = steal.
                let mut last = String::new();
                let mut stolen = false;
                while start.elapsed() < Duration::from_secs(5) {
                    let line = fg_line();
                    if line != last {
                        println!("{:5}ms  {line}", start.elapsed().as_millis());
                        if line.contains(&format!("pid={my_pid}")) {
                            stolen = true;
                        }
                        last = line;
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                println!("RESULT: focus_stolen={stolen}");
                std::process::exit(if stolen { 2 } else { 0 });
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}

#[cfg(not(windows))]
fn main() {}
