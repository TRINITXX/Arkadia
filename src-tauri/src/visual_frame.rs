//! The frame of a chat visual (`show_visual`, `chat-server/visual.ts`).
//!
//! A visual is Claude's own HTML page, scripts allowed, shown in a sandboxed
//! frame (`allow-scripts` only: an opaque origin, no popups, no navigation of
//! the app). Its document can't be a `srcdoc`: that inherits the app's CSP
//! (`script-src 'self'`), which blocks every script of the visual. So the frame
//! loads this protocol's shell, served with the visuals' own CSP (no fetch,
//! no frame, scripts from three CDNs only), and the page posts the visual in
//! (`src/lib/chat/chatVisual.ts`). The app's CSP lets only this origin be
//! framed (`frame-src` in `tauri.conf.json`). See REVIEW.md, « Visuels du chat ».

use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext};

pub const PROTOCOL: &str = "arkvisual";

/// The shell, shared with the page (`visual-frame.html?raw`): one CSP for both.
const SHELL: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/lib/chat/visual-frame.html"
));

/// The CSP the shell's `<meta>` states, sent as a header too: in force before
/// a byte of the document is read.
fn shell_csp() -> &'static str {
    let at = SHELL
        .find("Content-Security-Policy")
        .expect("the shell states its CSP");
    let rest = &SHELL[at..];
    let start = rest.find("content=\"").expect("CSP content") + "content=\"".len();
    let end = rest[start..].find('"').expect("CSP end");
    &rest[start..start + end]
}

/// Serves the shell, nothing else: a static answer, so the main thread is fine.
pub fn serve<R: Runtime>(_ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() != Method::GET {
        return Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .body(Vec::new())
            .unwrap_or_default();
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header("Content-Security-Policy", shell_csp())
        // No DNS lookups ahead of links: a name looked up can carry data out.
        .header("X-DNS-Prefetch-Control", "off")
        .header(header::CACHE_CONTROL, "no-store")
        .body(SHELL.as_bytes().to_vec())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shell_states_a_closed_csp() {
        let csp = shell_csp();
        assert!(csp.starts_with("default-src 'none'"), "{csp}");
        // No fetch, no frame, no worker: the network and the app stay out of reach.
        for directive in [
            "connect-src 'none'",
            "frame-src 'none'",
            "worker-src 'none'",
            "form-action 'none'",
            // The wall against a frame of the page's own (a fresh realm, WebRTC
            // and all): every HTML string goes through the shell's policy.
            "require-trusted-types-for 'script'",
            "trusted-types default",
        ] {
            assert!(csp.contains(directive), "{directive} missing from {csp}");
        }
        assert!(!csp.contains("ipc"), "{csp}");
    }

    #[test]
    fn the_app_frames_only_the_shell() {
        let conf: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tauri.conf.json"
        )))
        .unwrap();
        let csp = conf["app"]["security"]["csp"].as_str().unwrap();
        let frame = csp
            .split(';')
            .map(str::trim)
            .find(|d| d.starts_with("frame-src"))
            .expect("the app's CSP names what it may frame");
        assert_eq!(frame, "frame-src http://arkvisual.localhost");
    }
}
