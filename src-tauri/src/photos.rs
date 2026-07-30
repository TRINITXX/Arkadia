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
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use image::codecs::jpeg::JpegEncoder;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

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

// ─── Thumbnails ─────────────────────────────────────────────────────────────
//
// The roll is full-resolution phone captures: a 1290×2796 screenshot is ~14 MB
// of RGBA once decoded, so handing ten of them to the webview to paint 90px
// tiles costs ~144 MB of bitmaps and megabytes of IPC. Instead the decode
// happens once here, and what crosses the boundary is a ~15 KB JPEG.

/// Longest edge of a generated thumbnail — 2× the tile so it stays crisp on a
/// HiDPI display without paying for the full image.
const THUMB_EDGE: u32 = 256;
/// JPEG quality. At this size the difference above 80 is invisible.
const THUMB_QUALITY: u8 = 80;

/// Serves a downscaled JPEG for one photo, generating it on first use.
///
/// Cached on disk under the app data dir and keyed by path + mtime + size, so
/// the cost is paid once ever rather than once per app start; editing a photo
/// in place changes its mtime and therefore its key.
#[tauri::command(async)]
pub fn photo_thumbnail(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let src = PathBuf::from(&path);
    if !is_readable_image(&src) {
        return Err("not a readable image".into());
    }
    let meta = fs::metadata(&src).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let stamp = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?
        .join("thumbs");
    let cached = dir.join(format!(
        "{}.jpg",
        cache_key(&path, stamp, meta.len())
    ));
    if let Ok(bytes) = fs::read(&cached) {
        return Ok(tauri::ipc::Response::new(bytes));
    }

    let bytes = encode_thumbnail(&src)?;
    // Best-effort: a thumbnail that can't be cached is still worth returning.
    if fs::create_dir_all(&dir).is_ok() {
        let _ = fs::write(&cached, &bytes);
    }
    Ok(tauri::ipc::Response::new(bytes))
}

fn cache_key(path: &str, mtime: u128, len: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    hasher.update(mtime.to_le_bytes());
    hasher.update(len.to_le_bytes());
    // Half the digest is plenty to keep a few thousand thumbnails distinct.
    hex(&hasher.finalize()[..16])
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn encode_thumbnail(src: &Path) -> Result<Vec<u8>, String> {
    let img = image::open(src).map_err(|e| format!("decode: {e}"))?;
    // `thumbnail` pre-samples before filtering, so the cost tracks the output
    // size rather than the source's 3.6 megapixels.
    let small = img.thumbnail(THUMB_EDGE, THUMB_EDGE);
    let mut out = Vec::new();
    small
        .to_rgb8()
        .write_with_encoder(JpegEncoder::new_with_quality(
            &mut Cursor::new(&mut out),
            THUMB_QUALITY,
        ))
        .map_err(|e| format!("encode: {e}"))?;
    Ok(out)
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

    #[test]
    fn thumbnail_shrinks_to_the_long_edge_and_keeps_the_aspect_ratio() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("shot.png");
        // Same shape as the camera roll's phone screenshots (tall portrait).
        image::RgbImage::new(1290, 2796).save(&src).unwrap();

        let jpeg = encode_thumbnail(&src).unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
        assert_eq!(out.height(), THUMB_EDGE);
        assert_eq!(out.width(), 1290 * THUMB_EDGE / 2796);
        // The point of the exercise: orders of magnitude off the original.
        assert!(
            jpeg.len() < 40 * 1024,
            "thumbnail is {} bytes, expected well under 40 KB",
            jpeg.len()
        );
    }

    #[test]
    fn cache_key_tracks_every_input() {
        let base = cache_key("C:\\roll\\a.png", 100, 42);
        assert_eq!(base, cache_key("C:\\roll\\a.png", 100, 42));
        assert_ne!(base, cache_key("C:\\roll\\b.png", 100, 42));
        assert_ne!(base, cache_key("C:\\roll\\a.png", 101, 42));
        assert_ne!(base, cache_key("C:\\roll\\a.png", 100, 43));
    }

    #[test]
    fn thumbnail_refuses_what_the_picker_never_lists() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("clip.mov");
        File::create(&src).unwrap();
        assert!(encode_thumbnail(&src).is_err());
    }
}
