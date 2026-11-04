//! Opens a link in the Chrome profile paired with a Claude account.
//!
//! Each Claude account has its own Chrome profile (the Claude extension of a
//! profile is signed in to one account), and all of them are signed in to the
//! same Google account: Chrome cannot tell them apart by owner. The pairing
//! lives in `~/.claude/chrome-profiles.json` (email -> profile display name),
//! the one table Claude Code's Chrome hook (`chrome-profile-open.ps1`) reads
//! too. The display name resolves to a profile folder through Chrome's own
//! `Local State`.

use std::path::PathBuf;
use std::process::Command;

use serde_json::Value;
use tauri::Url;

fn pairing_file() -> Option<PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("chrome-profiles.json"))
}

fn local_state_file() -> Option<PathBuf> {
    Some(
        dirs::data_local_dir()?
            .join("Google")
            .join("Chrome")
            .join("User Data")
            .join("Local State"),
    )
}

/// A leading BOM is dropped: PowerShell 5.1 writes one, and the hook reading
/// the same file ignores it.
fn read_json(path: PathBuf) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()
}

// Names and emails compare ignoring case, as the PowerShell hook reading the
// same table does.
fn same(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// The profile display name paired with `email`.
fn profile_name(pairing: &Value, email: &str) -> Option<String> {
    pairing
        .as_object()?
        .iter()
        .find(|(key, _)| same(key, email))?
        .1
        .as_str()
        .map(str::to_string)
}

/// `name` without the " (2)", " (3)"… Chrome may append to a display name.
fn unsuffixed(name: &str) -> &str {
    match name.rfind(" (") {
        Some(i) if name.ends_with(')') => {
            let digits = &name[i + 2..name.len() - 1];
            if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) {
                &name[..i]
            } else {
                name
            }
        }
        _ => name,
    }
}

/// The profile folder ("Profile 4") whose display name is `name`, an exact
/// name winning over a numbered one.
fn profile_dir(local_state: &Value, name: &str) -> Option<String> {
    let cache = local_state.get("profile")?.get("info_cache")?.as_object()?;
    let display = |info: &Value| info.get("name").and_then(Value::as_str).map(str::to_string);
    cache
        .iter()
        .find(|(_, info)| display(info).is_some_and(|n| same(&n, name)))
        .or_else(|| {
            cache
                .iter()
                .find(|(_, info)| display(info).is_some_and(|n| same(unsuffixed(&n), name)))
        })
        .map(|(dir, _)| dir.clone())
}

/// chrome.exe, from the App Paths entry its installer registers.
#[cfg(windows)]
fn chrome_exe() -> Option<PathBuf> {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};

    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        let mut buf = vec![0u16; 1024];
        let mut size = (buf.len() * 2) as u32;
        let found = unsafe {
            RegGetValueW(
                root,
                w!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"),
                None,
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if found.is_ok() {
            let len = (size as usize / 2).saturating_sub(1);
            let path = PathBuf::from(String::from_utf16_lossy(&buf[..len]));
            if path.exists() {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn chrome_exe() -> Option<PathBuf> {
    None
}

/// Opens `url` in the Chrome profile of `email`; false when there is no
/// pairing, profile or Chrome to use.
fn open_in_profile(url: &str, email: &str) -> bool {
    let Some(name) = pairing_file()
        .and_then(read_json)
        .and_then(|pairing| profile_name(&pairing, email))
    else {
        return false;
    };
    let Some(dir) = local_state_file()
        .and_then(read_json)
        .and_then(|state| profile_dir(&state, &name))
    else {
        return false;
    };
    let Some(chrome) = chrome_exe() else {
        return false;
    };
    Command::new(chrome).args(launch_args(&dir, url)).spawn().is_ok()
}

/// Chrome only reads flags when its first process starts: a closed Chrome
/// opened from here must carry the flag `chrome-profile-open.ps1` passes too,
/// or the "Claude started debugging this browser" bar shows for the whole
/// session.
fn launch_args(dir: &str, url: &str) -> [String; 3] {
    [
        format!("--profile-directory={dir}"),
        "--silent-debugger-extension-api".to_owned(),
        url.to_owned(),
    ]
}

/// The profile display name paired with Claude account `account` (an id):
/// the table's, else the profile named after the account's email.
pub(crate) fn profile_name_for_account(account: &str) -> Option<String> {
    let email = crate::accounts::account_email(account)?;
    if let Some(name) = pairing_file()
        .and_then(read_json)
        .and_then(|pairing| profile_name(&pairing, &email))
    {
        return Some(name);
    }
    let state = local_state_file().and_then(read_json)?;
    profile_dir(&state, &email).map(|_| email)
}

/// The profile folder ("Profile 3") paired with Claude account `account`.
pub(crate) fn profile_dir_for_account(account: &str) -> Option<String> {
    let name = profile_name_for_account(account)?;
    profile_dir(&read_json(local_state_file()?)?, &name)
}

/// Opens a new window in profile folder `dir` (the Chrome panel), on a blank
/// page titled `title`: the window is found by it.
pub(crate) fn launch_window(dir: &str, title: &str) -> bool {
    let Some(chrome) = chrome_exe() else {
        return false;
    };
    let [profile, silent, page] = launch_args(dir, &blank_page(title));
    Command::new(chrome)
        .args([profile, silent, "--new-window".to_owned(), page])
        .spawn()
        .is_ok()
}

fn blank_page(title: &str) -> String {
    format!("data:text/html,<title>{title}</title>")
}

#[derive(serde::Serialize)]
pub struct ChromeProfile {
    /// Folder ("Profile 3"), stable.
    dir: String,
    /// Display name, as Chrome shows it: what the pairing table holds.
    name: String,
}

/// Chrome's profiles, for the pairing in the settings.
#[tauri::command]
pub async fn chrome_profiles_list() -> Vec<ChromeProfile> {
    let Some(state) = local_state_file().and_then(read_json) else {
        return Vec::new();
    };
    let Some(cache) = state
        .get("profile")
        .and_then(|p| p.get("info_cache"))
        .and_then(Value::as_object)
    else {
        return Vec::new();
    };
    let mut out: Vec<ChromeProfile> = cache
        .iter()
        .filter_map(|(dir, info)| {
            let name = info.get("name")?.as_str()?;
            Some(ChromeProfile {
                dir: dir.clone(),
                name: unsuffixed(name).to_owned(),
            })
        })
        .collect();
    out.sort_by_key(|p| p.name.to_lowercase());
    out
}

/// The pairing table: account email -> profile display name.
#[tauri::command]
pub async fn chrome_pairing_get() -> std::collections::BTreeMap<String, String> {
    pairing_file()
        .and_then(read_json)
        .and_then(|v| v.as_object().cloned())
        .map(|map| {
            map.into_iter()
                .filter(|(key, _)| !key.starts_with('_'))
                .filter_map(|(key, value)| Some((key, value.as_str()?.to_owned())))
                .collect()
        })
        .unwrap_or_default()
}

/// Pairs `email` with profile `name` (None: unpaired). Keeps the table's
/// comment and the other accounts as they are.
#[tauri::command]
pub async fn chrome_pairing_set(email: String, name: Option<String>) -> Result<(), String> {
    let path = pairing_file().ok_or("no home folder")?;
    let mut table = read_json(path.clone())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    table.retain(|key, _| !same(key, &email));
    if let Some(name) = name.filter(|n| !n.trim().is_empty()) {
        table.insert(email, Value::String(name));
    }
    let text = serde_json::to_string_pretty(&Value::Object(table)).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// The panel's "open in browser": the artifact opens in the Chrome profile of
/// the account it belongs to, else in the default browser.
#[tauri::command]
pub fn artifact_open_in_browser(url: String, account: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
    if !crate::artifact_view::is_artifact_url(&parsed) {
        return Err(format!("not a claude.ai artifact: {url}"));
    }
    // What was validated is what opens.
    let url = parsed.as_str();
    let opened = crate::accounts::account_email(&account)
        .is_some_and(|email| open_in_profile(url, &email));
    if !opened {
        open::that_detached(url).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pairs_an_account_with_its_profile_name_ignoring_case() {
        let pairing = json!({ "_comment": "x", "a@x.fr": "Minifashion" });
        assert_eq!(profile_name(&pairing, "A@X.fr").as_deref(), Some("Minifashion"));
        assert_eq!(profile_name(&pairing, "b@x.fr"), None);
    }

    #[test]
    fn finds_the_profile_folder_even_with_a_numbered_name() {
        let state = json!({ "profile": { "info_cache": {
            "Default": { "name": "Alexis (2)" },
            "Profile 3": { "name": "Minifashion (2)" },
            "Profile 4": { "name": "alexis@vtc-planner.fr (3)" },
            "Profile 9": { "name": "Alexis" },
        }}});
        assert_eq!(profile_dir(&state, "Minifashion").as_deref(), Some("Profile 3"));
        assert_eq!(profile_dir(&state, "alexis@vtc-planner.fr").as_deref(), Some("Profile 4"));
        // The exact name wins over a numbered one met first.
        assert_eq!(profile_dir(&state, "Alexis").as_deref(), Some("Profile 9"));
        assert_eq!(profile_dir(&state, "Nobody"), None);
        assert_eq!(unsuffixed("Nom ()"), "Nom ()");
    }

    #[test]
    fn launches_chrome_with_the_debugging_bar_hidden() {
        let args = launch_args("Profile 3", "https://claude.ai/artifact/x");
        assert!(args.contains(&"--silent-debugger-extension-api".to_owned()));
        assert_eq!(args[0], "--profile-directory=Profile 3");
        // The link comes last, after every flag.
        assert_eq!(args.last().map(String::as_str), Some("https://claude.ai/artifact/x"));
    }

    #[test]
    fn reads_a_table_saved_with_a_bom() {
        let path = std::env::temp_dir().join(format!("arkadia-bom-{}.json", std::process::id()));
        std::fs::write(&path, "\u{feff}{\"a@x.fr\": \"Alexis\"}").unwrap();
        let pairing = read_json(path.clone()).expect("BOM is skipped");
        assert_eq!(profile_name(&pairing, "a@x.fr").as_deref(), Some("Alexis"));
        let _ = std::fs::remove_file(path);
    }
}
