//! Which local program opened a loopback connection. Only the Tailscale
//! daemon (it runs `tailscale serve`) may vouch for a device through
//! `X-Forwarded-For`: any other local program could forge that header.

use std::net::SocketAddr;

/// True when the client end of the loopback connection `peer` → `server_port`
/// belongs to the Tailscale daemon.
#[cfg(windows)]
pub fn is_tailscale_daemon(peer: SocketAddr, server_port: u16) -> bool {
    owner_pid(peer, server_port)
        .and_then(exe_name)
        .is_some_and(|exe| is_daemon_exe(&exe))
}

#[cfg(not(windows))]
pub fn is_tailscale_daemon(_peer: SocketAddr, _server_port: u16) -> bool {
    false
}

pub fn is_daemon_exe(exe: &str) -> bool {
    exe.eq_ignore_ascii_case("tailscaled.exe")
}

/// The process owning the client socket `peer` connected to `server_port`.
#[cfg(windows)]
fn owner_pid(peer: SocketAddr, server_port: u16) -> Option<u32> {
    use std::net::Ipv4Addr;
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_CONNECTIONS,
    };
    const AF_INET: u32 = 2;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

    let SocketAddr::V4(peer) = peer else {
        return None;
    };
    let mut size = 0u32;
    // The table can grow between the sizing call and the read: retry a little.
    for _ in 0..4 {
        // u32 words keep the rows aligned.
        let mut buf = vec![0u32; (size as usize).div_ceil(4)];
        let ptr = (!buf.is_empty()).then(|| buf.as_mut_ptr().cast());
        // SAFETY: `buf` holds `size` bytes, as the API was told.
        let rc = unsafe {
            GetExtendedTcpTable(
                ptr,
                &mut size,
                false,
                AF_INET,
                TCP_TABLE_OWNER_PID_CONNECTIONS,
                0,
            )
        };
        if rc == ERROR_INSUFFICIENT_BUFFER {
            continue;
        }
        if rc != 0 || buf.is_empty() {
            return None;
        }
        let table = buf.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>();
        // SAFETY: on success the buffer starts with a table of `dwNumEntries` rows.
        let rows = unsafe {
            std::slice::from_raw_parts((*table).table.as_ptr(), (*table).dwNumEntries as usize)
        };
        // Ports sit in network byte order in the low 16 bits; addresses too.
        let port = |p: u32| u16::from_be(p as u16);
        return rows
            .iter()
            .find(|r| {
                port(r.dwLocalPort) == peer.port()
                    && port(r.dwRemotePort) == server_port
                    && Ipv4Addr::from(r.dwLocalAddr.to_ne_bytes()) == *peer.ip()
            })
            .map(|r| r.dwOwningPid);
    }
    None
}

/// A process's executable name, from a process snapshot: the daemon runs as
/// SYSTEM, which a normal user cannot open to ask for its path.
#[cfg(windows)]
fn exe_name(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    // SAFETY: plain Win32 calls on a snapshot handle closed before returning.
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut name = None;
        let mut more = Process32FirstW(snapshot, &mut entry).is_ok();
        while more {
            if entry.th32ProcessID == pid {
                let exe = &entry.szExeFile;
                let len = exe.iter().position(|&c| c == 0).unwrap_or(exe.len());
                name = Some(String::from_utf16_lossy(&exe[..len]));
                break;
            }
            more = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_only_the_daemon() {
        assert!(is_daemon_exe("tailscaled.exe"));
        assert!(is_daemon_exe("TailscaleD.EXE"));
        assert!(!is_daemon_exe("tailscale-ipn.exe"));
        assert!(!is_daemon_exe("node.exe"));
    }

    #[cfg(windows)]
    #[test]
    fn finds_the_program_behind_a_loopback_connection() {
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        let _client = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        let (_conn, peer) = server.accept().unwrap();
        assert_eq!(owner_pid(peer, port), Some(std::process::id()));
        assert!(exe_name(std::process::id()).is_some_and(|exe| exe.ends_with(".exe")));
        assert!(!is_tailscale_daemon(peer, port));
    }
}
