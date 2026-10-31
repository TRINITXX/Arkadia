//! Can a chat visual's frame reach Tauri's IPC? (REVIEW.md, « Visuels du chat »)
//!
//! Boots a hidden Tauri window whose page is served with the app's own CSP
//! (read from `tauri.conf.json`), and frames one probe page two ways: as a
//! sandboxed `srcdoc` (what the CSP inheritance blocks) and through the
//! visuals' `arkvisual` shell (`visual_frame.rs`), sandboxed `allow-scripts`
//! as the chat does. Inside, the probe tries every road to a command:
//! `__TAURI_INTERNALS__.invoke`, `window.ipc.postMessage` (a forged key),
//! `chrome.webview.postMessage`, a fetch to `ipc.localhost`, the parent's
//! DOM, top navigation and `window.open`. `probe_hit` prints `HIT` when a
//! road reaches it; the main frame's own invoke is the control.
//!
//! Wry adds every init script to subframes on Windows (`for_main_frame_only`
//! is ignored there), so the frame may well hold Tauri's internals: this
//! checks what it can do with them, in this Tauri and this WebView2.
//!
//! NOTE: tauri-build only embeds its Windows manifest for BINS (see
//! `popup_probe.rs`):
//!
//!   cargo rustc --example frame_ipc_probe -- \
//!     -C link-arg=/MANIFEST:EMBED \
//!     -C "link-arg=/MANIFESTINPUT:<abs path to examples/probe.manifest>"
//!   ../target/debug/examples/frame_ipc_probe.exe [prepared.html]
//!
//! `prepared.html`: the probe page through the chat's `visualDocument`
//! (bootstrap, CSP, guard), as the chat posts it into the shell.

#[cfg(windows)]
#[tauri::command]
fn probe_hit(via: String) {
    println!("HIT via={via}");
}

#[cfg(windows)]
#[tauri::command]
fn probe_report(text: String, app: tauri::AppHandle) {
    println!("REPORT {text}");
    app.exit(0);
}

#[cfg(windows)]
fn main() {
    use std::time::Duration;
    use tauri::http::{header, Response};
    use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

    const MAIN_HTML: &str = r#"<!doctype html><html><head><meta charset="utf-8"></head>
<body><p>frame ipc probe</p><script src="/main.js"></script></body></html>"#;

    // The page framed both ways (`frame_ipc_probe.html`). Its label names how.
    const PROBE_PAGE: &str = include_str!("frame_ipc_probe.html");

    const MAIN_JS: &str = r#"
const results = {};
window.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.probe) results[d.probe] = d.out;
  if (d && d.arkadiaVisual === 1 && d.kind === "shell") {
    e.source.postMessage({ arkadiaVisualDocument: 1, html: SHELL_DOC }, "*");
  }
});
const PAGE = __PAGE__;
// As the chat posts it (`visualDocument`, bootstrap and all), when given.
const SHELL_DOC = __SHELL_DOC__ || PAGE.split("__LABEL__").join("shell");
const a = document.createElement("iframe");
a.setAttribute("sandbox", "allow-scripts");
a.srcdoc = PAGE.split("__LABEL__").join("srcdoc");
document.body.appendChild(a);
const b = document.createElement("iframe");
b.setAttribute("sandbox", "allow-scripts");
b.src = "http://arkvisual.localhost/";
document.body.appendChild(b);
window.__TAURI_INTERNALS__.invoke("probe_hit", { via: "main-frame-control" });
setTimeout(() => {
  window.__TAURI_INTERNALS__.invoke("probe_report", { text: JSON.stringify(results) });
}, 7000);
"#;

    let mut ctx = tauri::generate_context!();
    // Its own identity and no window of the app's config: never the data,
    // the WebView2 folder or the frontend of a running Arkadia.
    ctx.config_mut().identifier = "com.trinitx.arkadia.frameprobe".into();
    ctx.config_mut().app.windows.clear();
    let app_csp = ctx
        .config()
        .app
        .security
        .csp
        .as_ref()
        .map(|c| c.to_string())
        .expect("the app states a CSP");
    println!("app CSP: {app_csp}");
    // The page as the chat prepares it (`visualDocument`): a file given as the
    // first argument, its label already `shell`.
    let shell_doc = std::env::args()
        .nth(1)
        .map(|path| std::fs::read_to_string(path).expect("prepared page"));
    println!("shell page: {}", if shell_doc.is_some() { "prepared by the chat" } else { "bare" });
    println!(
        "webview args: {}",
        std::env::var("PROBE_ARGS").unwrap_or_else(|_| "wry defaults".into())
    );
    let main_js = MAIN_JS
        .replace("__PAGE__", &serde_json::to_string(PROBE_PAGE).unwrap())
        .replace("__SHELL_DOC__", &serde_json::to_string(&shell_doc).unwrap());

    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(25));
        println!("TIMEOUT");
        std::process::exit(3);
    });

    tauri::Builder::default()
        .register_uri_scheme_protocol("arkprobe", move |_ctx, request| {
            let path = request.uri().path().to_string();
            let (body, mime) = match path.as_str() {
                "/" => (MAIN_HTML.to_string(), "text/html"),
                "/main.js" => (main_js.clone(), "text/javascript"),
                other => {
                    println!("REQUEST {other}");
                    (String::new(), "text/plain")
                }
            };
            Response::builder()
                .header(header::CONTENT_TYPE, mime)
                .header("Content-Security-Policy", app_csp.as_str())
                .body(body.into_bytes())
                .unwrap()
        })
        .register_uri_scheme_protocol(arkadia_lib::visual_frame::PROTOCOL, arkadia_lib::visual_frame::serve)
        .invoke_handler(tauri::generate_handler![probe_hit, probe_report])
        .setup(|app| {
            WebviewWindowBuilder::new(
                app,
                "probe",
                WebviewUrl::CustomProtocol(Url::parse("http://arkprobe.localhost/").unwrap()),
            )
            .data_directory(std::env::temp_dir().join("arkadia-frame-probe"))
            // `PROBE_ARGS`: WebView2 arguments to try (wry's defaults otherwise).
            // `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` changed
            // nothing in WebView2 156 (31/10/2026): Trusted Types do the work.
            .additional_browser_args(&std::env::var("PROBE_ARGS").unwrap_or_else(|_| {
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection".into()
            }))
            .visible(false)
            .focused(false)
            .build()?;
            Ok(())
        })
        .run(ctx)
        .expect("tauri run failed");
}

#[cfg(not(windows))]
fn main() {}
