//! Who may reach the phone companion server.
//!
//! The server listens on 127.0.0.1 only. `tailscale serve` terminates HTTPS on
//! the tailnet and proxies to it, overwriting `X-Forwarded-For` with the real
//! peer's Tailscale IP (verified: a value forged by the client is dropped). That
//! header therefore names the device, but only when the Tailscale daemon itself
//! opened the connection (`peer`): another local program could forge it. Only
//! the machines listed in `%LOCALAPPDATA%/Arkadia/remote.json` get through.

use std::collections::HashSet;
use std::net::IpAddr;
use std::path::PathBuf;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Deserialize;

/// Device IPs rarely change: re-read `tailscale status` this often.
const REFRESH_EVERY: Duration = Duration::from_secs(60);

const TAILSCALE_EXE: &str = r"C:\Program Files\Tailscale\tailscale.exe";

/// Origins a debug build accepts on a direct (non-Tailscale) connection: the
/// Vite dev server, for testing the phone page from this PC.
const DEV_ORIGINS: &[&str] = &["http://localhost:1420", "http://127.0.0.1:1420"];

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RemoteConfig {
    /// Tailscale machine names, as `tailscale status` prints them.
    #[serde(default)]
    allowed_devices: Vec<String>,
}

/// What the server knows about the tailnet: its own HTTPS name and the IPs of
/// the allowed devices.
#[derive(Default, Clone, Debug, PartialEq)]
pub struct Tailnet {
    /// e.g. `pc1.tailc880c9.ts.net` (lowercase, no trailing dot).
    pub self_dns: Option<String>,
    pub allowed_ips: HashSet<IpAddr>,
}

/// Parses `tailscale status --json`, keeping the IPs of the peers whose machine
/// name (first label of `DNSName`; `HostName` is "localhost" on an iPhone) is
/// in `allowed`.
pub fn parse_status(json: &str, allowed: &[String]) -> Option<Tailnet> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let dns = |node: &serde_json::Value| -> Option<String> {
        let name = node.get("DNSName")?.as_str()?.trim_end_matches('.');
        (!name.is_empty()).then(|| name.to_ascii_lowercase())
    };
    let wanted: HashSet<String> = allowed.iter().map(|a| a.to_ascii_lowercase()).collect();
    let mut allowed_ips = HashSet::new();
    if let Some(peers) = v.get("Peer").and_then(|p| p.as_object()) {
        for peer in peers.values() {
            let Some(name) = dns(peer) else { continue };
            let machine = name.split('.').next().unwrap_or_default();
            if !wanted.contains(machine) {
                continue;
            }
            let ips = peer.get("TailscaleIPs").and_then(|i| i.as_array());
            for ip in ips.into_iter().flatten() {
                if let Some(ip) = ip.as_str().and_then(|s| s.parse().ok()) {
                    allowed_ips.insert(ip);
                }
            }
        }
    }
    Some(Tailnet {
        self_dns: v.get("Self").and_then(dns),
        allowed_ips,
    })
}

/// The parts of a request the access decision reads.
pub struct RequestInfo<'a> {
    pub host: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub forwarded_for: Option<&'a str>,
    /// The connection comes from the Tailscale daemon (see `peer`).
    pub via_tailscale: bool,
    /// A WebSocket or a POST: only the page served here may send it.
    pub check_origin: bool,
}

/// Lets a request through, with the device's Tailscale IP, or says why not.
///
/// Through Tailscale: the daemon must have opened the connection, the device
/// must be allowed and the Host must be this machine's tailnet name (no DNS
/// rebinding). With `check_origin` (a WebSocket, a POST), the request must also
/// come from the page served here: a web page elsewhere cannot send it. A
/// direct local connection is refused, except from the Vite dev server in a
/// debug build.
pub fn decide(
    req: &RequestInfo,
    net: &Tailnet,
    dev: bool,
    port: u16,
) -> Result<Option<IpAddr>, &'static str> {
    let host = req.host.unwrap_or_default().to_ascii_lowercase();
    if let Some(forwarded) = req.forwarded_for {
        let ip: IpAddr = forwarded
            .split(',')
            .next()
            .and_then(|s| s.trim().parse().ok())
            .ok_or("unreadable X-Forwarded-For")?;
        if !req.via_tailscale {
            return Err("forwarded header from another program");
        }
        if !net.allowed_ips.contains(&ip) {
            return Err("device not allowed");
        }
        let self_dns = net.self_dns.as_deref().ok_or("tailnet name unknown")?;
        if host.trim_end_matches(":443") != self_dns {
            return Err("unexpected Host");
        }
        if req.check_origin && req.origin != Some(format!("https://{self_dns}").as_str()) {
            return Err("unexpected Origin");
        }
        return Ok(Some(ip));
    }
    if !dev {
        return Err("direct access refused");
    }
    if host != format!("127.0.0.1:{port}") && host != format!("localhost:{port}") {
        return Err("unexpected Host");
    }
    if req.check_origin && !req.origin.is_some_and(|o| DEV_ORIGINS.contains(&o)) {
        return Err("unexpected Origin");
    }
    Ok(None)
}

/// The tailnet view, refreshed in the background.
#[derive(Default)]
pub struct Access {
    tailnet: Mutex<Tailnet>,
}

impl Access {
    pub fn tailnet(&self) -> Tailnet {
        self.tailnet.lock().clone()
    }

    /// Re-reads the allowlist and `tailscale status` every `REFRESH_EVERY`.
    pub fn spawn_refresh(self: &std::sync::Arc<Self>) {
        let access = self.clone();
        std::thread::spawn(move || loop {
            let fresh = load_tailnet();
            let mut cur = access.tailnet.lock();
            if *cur != fresh {
                crate::popup::log_line(&format!(
                    "[remote] tailnet: name={:?} allowed={:?}",
                    fresh.self_dns, fresh.allowed_ips
                ));
                *cur = fresh;
            }
            drop(cur);
            std::thread::sleep(REFRESH_EVERY);
        });
    }
}

fn config_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Arkadia")
        .join("remote.json")
}

fn load_tailnet() -> Tailnet {
    let config: RemoteConfig = std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let exe = if std::path::Path::new(TAILSCALE_EXE).exists() {
        TAILSCALE_EXE
    } else {
        "tailscale"
    };
    let mut cmd = std::process::Command::new(exe);
    cmd.args(["status", "--json"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: never flash a console over the app.
        cmd.creation_flags(0x0800_0000);
    }
    cmd.output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| parse_status(&String::from_utf8_lossy(&o.stdout), &config.allowed_devices))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const STATUS: &str = r#"{
        "Self": {"DNSName": "pc1.tail.ts.net.", "TailscaleIPs": ["100.88.83.28"]},
        "Peer": {
            "a": {"DNSName": "iphone-15-pro-max.tail.ts.net.", "HostName": "localhost",
                  "TailscaleIPs": ["100.69.88.112", "fd7a:115c:a1e0::133a:5872"]},
            "b": {"DNSName": "vps1.tail.ts.net.", "HostName": "vps1",
                  "TailscaleIPs": ["100.112.61.4"]}
        }
    }"#;

    fn net() -> Tailnet {
        parse_status(STATUS, &["iPhone-15-Pro-Max".to_string()]).unwrap()
    }

    fn via_tailscale<'a>(
        ip: &'a str,
        origin: Option<&'a str>,
        check_origin: bool,
    ) -> RequestInfo<'a> {
        RequestInfo {
            host: Some("pc1.tail.ts.net"),
            origin,
            forwarded_for: Some(ip),
            via_tailscale: true,
            check_origin,
        }
    }

    #[test]
    fn keeps_only_the_listed_devices_by_dns_name() {
        let net = net();
        assert_eq!(net.self_dns.as_deref(), Some("pc1.tail.ts.net"));
        assert!(net
            .allowed_ips
            .contains(&"100.69.88.112".parse::<IpAddr>().unwrap()));
        assert!(net
            .allowed_ips
            .contains(&"fd7a:115c:a1e0::133a:5872".parse::<IpAddr>().unwrap()));
        assert!(!net
            .allowed_ips
            .contains(&"100.112.61.4".parse::<IpAddr>().unwrap()));
    }

    #[test]
    fn lets_an_allowed_device_open_the_socket_from_the_served_page() {
        let req = via_tailscale("100.69.88.112", Some("https://pc1.tail.ts.net"), true);
        assert_eq!(
            decide(&req, &net(), false, 47600),
            Ok(Some("100.69.88.112".parse().unwrap()))
        );
    }

    #[test]
    fn refuses_a_forwarded_header_forged_by_another_local_program() {
        let mut req = via_tailscale("100.69.88.112", Some("https://pc1.tail.ts.net"), true);
        req.via_tailscale = false;
        assert_eq!(
            decide(&req, &net(), false, 47600),
            Err("forwarded header from another program")
        );
    }

    #[test]
    fn refuses_a_device_outside_the_list() {
        let req = via_tailscale("100.112.61.4", Some("https://pc1.tail.ts.net"), true);
        assert_eq!(
            decide(&req, &net(), false, 47600),
            Err("device not allowed")
        );
    }

    #[test]
    fn refuses_a_socket_opened_by_another_site() {
        let req = via_tailscale("100.69.88.112", Some("https://evil.example"), true);
        assert_eq!(decide(&req, &net(), false, 47600), Err("unexpected Origin"));
    }

    #[test]
    fn refuses_a_rebound_host_name() {
        let mut req = via_tailscale("100.69.88.112", Some("https://pc1.tail.ts.net"), true);
        req.host = Some("evil.example");
        assert_eq!(decide(&req, &net(), false, 47600), Err("unexpected Host"));
    }

    #[test]
    fn refuses_direct_local_access_in_release() {
        let req = RequestInfo {
            host: Some("127.0.0.1:47600"),
            origin: Some("http://localhost:1420"),
            forwarded_for: None,
            via_tailscale: false,
            check_origin: true,
        };
        assert_eq!(
            decide(&req, &net(), false, 47600),
            Err("direct access refused")
        );
    }

    #[test]
    fn lets_the_dev_server_in_a_debug_build_only() {
        let dev_page = RequestInfo {
            host: Some("127.0.0.1:47601"),
            origin: Some("http://localhost:1420"),
            forwarded_for: None,
            via_tailscale: false,
            check_origin: true,
        };
        assert_eq!(decide(&dev_page, &net(), true, 47601), Ok(None));
        let other_site = RequestInfo {
            origin: Some("http://evil.example"),
            ..dev_page
        };
        assert_eq!(
            decide(&other_site, &net(), true, 47601),
            Err("unexpected Origin")
        );
    }
}
