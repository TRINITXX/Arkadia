//! A link to this exe that the rebuild script never moves. `Rebuild
//! Arkadia.bat` sets the running exe aside for the whole build (minutes), so
//! a helper Arkadia starts by that path meanwhile fails: the dictation hook
//! (`voice`) and the panes' `BROWSER` (`artifact_inbox`) name this link
//! instead (15/11/2026). Their modes (`--voice-capture`, a URL to forward)
//! stay the same from one build to the next.

use std::path::{Path, PathBuf};

use parking_lot::Mutex;

/// This exe for helpers to start: its link in `%LOCALAPPDATA%\Arkadia\bin`,
/// one per instance (the Lab's apart), else the exe itself. Release builds
/// only: a `tauri dev` copy is no Lab and must not replace the daily link.
pub fn helper_exe() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    if cfg!(debug_assertions) {
        return Some(exe);
    }
    let name = if crate::lab::LAB {
        "arkadia-lab.exe"
    } else {
        "arkadia.exe"
    };
    let dir = dirs::data_local_dir().map(|d| d.join("Arkadia").join("bin"));
    match dir {
        Some(dir) if std::fs::create_dir_all(&dir).is_ok() => {
            // The dictation and a pane's start may refresh it at once.
            static REFRESH: Mutex<()> = Mutex::new(());
            let _one = REFRESH.lock();
            Some(stable_exe(&exe, &dir.join(name)))
        }
        _ => Some(exe),
    }
}

/// `link` as a hard link (else a copy) of `exe`: refreshed when the exe
/// changed, kept as it is while the exe is missing (mid-build). A helper
/// under way keeps the image it started.
fn stable_exe(exe: &Path, link: &Path) -> PathBuf {
    let same = |a: &std::fs::Metadata, b: &std::fs::Metadata| {
        a.len() == b.len() && a.modified().ok() == b.modified().ok()
    };
    match (std::fs::metadata(exe), std::fs::metadata(link)) {
        (Ok(src), Ok(dst)) if same(&src, &dst) => return link.to_path_buf(),
        (Err(_), Ok(_)) => return link.to_path_buf(),
        (Err(_), Err(_)) => return exe.to_path_buf(),
        _ => {}
    }
    // Made under another name, then put in place: a reader never sees half.
    let fresh = link.with_extension("new.exe");
    let _ = std::fs::remove_file(&fresh);
    let made = std::fs::hard_link(exe, &fresh).or_else(|_| std::fs::copy(exe, &fresh).map(drop));
    if made.is_err() || std::fs::rename(&fresh, link).is_err() {
        let _ = std::fs::remove_file(&fresh);
    }
    if link.exists() {
        link.to_path_buf()
    } else {
        exe.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("arkadia-exe-link-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_link_outlives_a_rebuild() {
        let dir = dir();
        let exe = dir.join("arkadia.exe");
        let link = dir.join("bin-arkadia.exe");
        std::fs::write(&exe, "build 1").unwrap();
        assert_eq!(stable_exe(&exe, &link), link);
        // The rebuild script sets the exe aside: the link stays.
        std::fs::rename(&exe, dir.join("old.exe")).unwrap();
        assert_eq!(stable_exe(&exe, &link), link);
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "build 1");
        // The new build lands: the link follows it.
        std::fs::write(&exe, "build 2, longer").unwrap();
        assert_eq!(stable_exe(&exe, &link), link);
        assert_eq!(std::fs::read_to_string(&link).unwrap(), "build 2, longer");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_exe_and_no_link_names_the_exe() {
        let dir = dir();
        let exe = dir.join("arkadia.exe");
        assert_eq!(stable_exe(&exe, &dir.join("bin-arkadia.exe")), exe);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
