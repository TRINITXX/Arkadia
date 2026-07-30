//! The newest photos of the iCloud camera roll, for the input rail's picker.
//!
//! Only the formats Claude actually accepts as images are listed — JPEG, PNG,
//! GIF and WebP. The roll is mostly HEIC, DNG and video, none of which the model
//! can read and none of which a webview can decode into a thumbnail, so they are
//! filtered out rather than shown as dead tiles.
//!
//! Listing is cheap despite the folder holding thousands of files: on Windows a
//! directory entry already carries its last-write time, so `metadata()` here
//! reads what `read_dir` cached instead of issuing a syscall per file.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

/// Camera roll, relative to the home directory.
const ROLL: [&str; 3] = ["Pictures", "iCloud Photos", "Photos"];
/// Extensions Claude can read (see the Vision docs); matched case-insensitively.
const EXTS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
/// How many the picker shows. The grid is 5×2 and there is no paging.
const LIMIT: usize = 10;

/// One tile in the picker.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct PhotoEntry {
    /// Absolute path — what gets typed into the prompt.
    pub path: String,
    /// File name, for the tooltip.
    pub name: String,
    /// Last write, ms since the epoch — the list's sort key.
    pub mtime: u64,
}

#[tauri::command(async)]
pub fn list_recent_photos() -> Result<Vec<PhotoEntry>, String> {
    let dir = dirs::home_dir()
        .map(|h| ROLL.iter().fold(h, |p, seg| p.join(seg)))
        .ok_or("no home directory")?;
    if !dir.is_dir() {
        return Err(format!("no photo folder at {}", dir.display()));
    }
    Ok(scan(&dir, LIMIT))
}

/// Command body (unit-testable without a home directory).
fn scan(dir: &Path, limit: usize) -> Vec<PhotoEntry> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<(u64, PathBuf)> = entries
        .flatten()
        .filter(|e| is_readable_image(&e.path()))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let mtime = meta
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some((mtime, e.path()))
        })
        .collect();
    // Newest first; ties broken by path so the order never flickers between two
    // photos written in the same millisecond.
    found.sort_unstable_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    found.truncate(limit);
    found
        .into_iter()
        .map(|(mtime, path)| PhotoEntry {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
            mtime,
        })
        .collect()
}

fn is_readable_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| EXTS.contains(&e.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::time::{Duration, SystemTime};

    /// Writes `name` and stamps it `age_secs` in the past, so the fixture's
    /// ordering doesn't depend on how fast the test runs.
    fn touch(dir: &Path, name: &str, age_secs: u64) {
        let f = File::create(dir.join(name)).unwrap();
        f.set_modified(SystemTime::now() - Duration::from_secs(age_secs))
            .unwrap();
    }

    #[test]
    fn lists_newest_first() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "old.png", 300);
        touch(tmp.path(), "new.png", 10);
        touch(tmp.path(), "mid.jpg", 100);

        let names: Vec<_> = scan(tmp.path(), 10).into_iter().map(|p| p.name).collect();
        assert_eq!(names, ["new.png", "mid.jpg", "old.png"]);
    }

    #[test]
    fn keeps_only_formats_claude_reads() {
        let tmp = tempfile::tempdir().unwrap();
        for name in ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp"] {
            touch(tmp.path(), name, 10);
        }
        for name in ["f.HEIC", "g.dng", "h.mov", "i.mp4", "desktop.ini", "noext"] {
            touch(tmp.path(), name, 10);
        }
        let mut names: Vec<_> = scan(tmp.path(), 50).into_iter().map(|p| p.name).collect();
        names.sort();
        assert_eq!(names, ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp"]);
    }

    #[test]
    fn truncates_to_the_limit() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..25 {
            touch(tmp.path(), &format!("img{i:02}.png"), 1000 - i);
        }
        let got = scan(tmp.path(), LIMIT);
        assert_eq!(got.len(), LIMIT);
        // Highest index == smallest age == newest.
        assert_eq!(got[0].name, "img24.png");
    }

    #[test]
    fn missing_folder_yields_nothing() {
        assert!(scan(Path::new("C:\\definitely\\missing\\roll"), 10).is_empty());
    }
}
