//! The newest files of the two folders the input rail's picker offers: the
//! iCloud camera roll, and the downloads folder.
//!
//! The roll is filtered to stills and gets thumbnails; downloads are listed
//! whole, because what lands there is arbitrary — an installer, a CSV, a log, an
//! extracted folder — and a preview would mean nothing for most of it.
//!
//! HEIC is listed among the stills. The Claude API itself only takes JPEG, PNG,
//! GIF and WebP, but Claude Code is an agent: handed a `.HEIC` path it converts
//! the file with ImageMagick before reading it. Filtering the roll's native
//! format out would hide most of what the user actually wants to send. Neither
//! can a webview decode HEIC, so its thumbnails go through that same
//! ImageMagick, while everything else goes through the `image` crate.
//!
//! Listing stays cheap despite the roll holding thousands of files: on Windows a
//! directory entry already carries its last-write time, so `metadata()` here
//! reads what `read_dir` cached instead of issuing a syscall per file.

use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

use image::codecs::jpeg::JpegEncoder;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

/// Camera roll, relative to the home directory.
const ROLL: [&str; 3] = ["Pictures", "iCloud Photos", "Photos"];
/// Where downloads land on this machine, preferred over the OS default below.
const DOWNLOADS: &str = r"D:\Downloads";
/// Still-image extensions, matched case-insensitively.
const EXTS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif"];
/// Of those, the ones the `image` crate can't decode — delegated to ImageMagick.
const EXTERNAL: [&str; 2] = ["heic", "heif"];
/// How many entries each tab shows. There is no paging.
const LIMIT: usize = 10;

/// Which folder the picker is listing.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Source {
    Photos,
    Downloads,
}

impl Source {
    fn parse(key: &str) -> Result<Self, String> {
        match key {
            "photos" => Ok(Self::Photos),
            "downloads" => Ok(Self::Downloads),
            other => Err(format!("unknown source `{other}`")),
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::Photos => "photos",
            Self::Downloads => "downloads",
        }
    }

    fn root(self) -> Option<PathBuf> {
        match self {
            Self::Photos => dirs::home_dir().map(|h| ROLL.iter().fold(h, |p, seg| p.join(seg))),
            // The user's downloads live off the system drive; fall back to the
            // OS folder so this still resolves to something sane elsewhere.
            Self::Downloads => {
                let configured = PathBuf::from(DOWNLOADS);
                if configured.is_dir() {
                    Some(configured)
                } else {
                    dirs::download_dir()
                }
            }
        }
    }

    /// Whether an entry belongs in this tab. Downloads take everything —
    /// including folders, since an extracted archive is a perfectly good thing
    /// to hand to Claude.
    fn accepts(self, path: &Path) -> bool {
        match self {
            Self::Photos => is_still_image(path),
            Self::Downloads => true,
        }
    }
}

/// One row or tile in the picker.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct FileEntry {
    /// Absolute path — what gets typed into the prompt.
    pub path: String,
    /// File name, shown in the list and in the tile's tooltip.
    pub name: String,
    /// Last write, ms since the epoch — the list's sort key.
    pub mtime: u64,
    /// Bytes; 0 for a directory, whose size would need a full walk to know.
    pub size: u64,
    pub is_dir: bool,
}

#[tauri::command(async)]
pub fn list_recent_files(app: AppHandle, source: String) -> Result<Vec<FileEntry>, String> {
    let source = Source::parse(&source)?;
    let dir = source.root().ok_or("no such folder on this machine")?;
    if !dir.is_dir() {
        return Err(format!("no folder at {}", dir.display()));
    }
    // First listing arms the watcher, so the tab never has to be told to refresh
    // once something new lands in the folder.
    ensure_watcher(&app, source, dir.clone());
    Ok(scan(&dir, LIMIT, source))
}

/// Command body (unit-testable without the real folders).
fn scan(dir: &Path, limit: usize, source: Source) -> Vec<FileEntry> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut found: Vec<(u64, PathBuf, u64, bool)> = entries
        .flatten()
        .filter(|e| source.accepts(&e.path()))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let mtime = meta
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            let is_dir = meta.is_dir();
            if !is_dir && !meta.is_file() {
                return None;
            }
            Some((mtime, e.path(), if is_dir { 0 } else { meta.len() }, is_dir))
        })
        .collect();
    // Newest first; ties broken by path so the order never flickers between two
    // entries written in the same millisecond.
    found.sort_unstable_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    found.truncate(limit);
    found
        .into_iter()
        .map(|(mtime, path, size, is_dir)| FileEntry {
            name: path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
            mtime,
            size,
            is_dir,
        })
        .collect()
}

fn is_still_image(path: &Path) -> bool {
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
    if !is_still_image(&src) {
        return Err("not a still image".into());
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
    let cached = dir.join(format!("{}.jpg", cache_key(&path, stamp, meta.len())));
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
    if needs_external_decoder(src) {
        return magick_thumbnail(src);
    }
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

fn needs_external_decoder(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| EXTERNAL.contains(&e.as_str()))
}

/// Shells out to ImageMagick for the formats the `image` crate can't read, and
/// takes the JPEG back on stdout so no temp file is involved. `-auto-orient`
/// applies the EXIF rotation phone cameras rely on.
fn magick_thumbnail(src: &Path) -> Result<Vec<u8>, String> {
    let bounds = format!("{THUMB_EDGE}x{THUMB_EDGE}");
    let quality = THUMB_QUALITY.to_string();
    let mut cmd = Command::new("magick");
    cmd.arg(src).args([
        "-auto-orient",
        "-thumbnail",
        &bounds,
        "-quality",
        &quality,
        "jpg:-",
    ]);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: never flash a console over the app.
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("ImageMagick not available: {e}"))?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr);
        return Err(format!("ImageMagick failed: {}", why.trim()));
    }
    if out.stdout.is_empty() {
        return Err("ImageMagick produced no image".into());
    }
    Ok(out.stdout)
}

// ─── Watching the folders ───────────────────────────────────────────────────

/// Emitted when a watched folder gains, loses or changes a listed entry. The
/// payload is the source's key, so a tab only refreshes on its own news.
pub const FILES_CHANGED: &str = "recent-files-changed";
/// iCloud writes a temp file and renames it, and a browser writes a `.part`
/// before the real name, so one arrival lands as a burst of events; hold off
/// until it settles rather than refreshing several times.
const DEBOUNCE: Duration = Duration::from_millis(700);
/// Ceiling on that hold-off, so a long sync still refreshes as it goes.
const MAX_COALESCE: Duration = Duration::from_secs(3);

fn watched() -> &'static Mutex<HashSet<PathBuf>> {
    static WATCHED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    WATCHED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Watches one folder for the process's lifetime. Idempotent per folder: only
/// the first call for a given directory spawns anything, and there is no
/// shutdown path because the folders are fixed and the thread is meant to
/// outlive every picker.
fn ensure_watcher(app: &AppHandle, source: Source, dir: PathBuf) {
    {
        let Ok(mut seen) = watched().lock() else { return };
        if !seen.insert(dir.clone()) {
            return;
        }
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let give_up = |dir: &PathBuf| {
            if let Ok(mut seen) = watched().lock() {
                seen.remove(dir);
            }
        };
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[picker] watcher unavailable: {e}");
                return give_up(&dir);
            }
        };
        // Non-recursive: both folders are browsed flat, and their sub-folders
        // would only add noise (an extracted archive being written, iCloud's
        // own bookkeeping).
        if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("[picker] cannot watch {}: {e}", dir.display());
            return give_up(&dir);
        }
        while let Ok(first) = rx.recv() {
            if !touches_a_listed_entry(&first, source) {
                continue;
            }
            // Swallow the rest of the burst before telling the frontend.
            let deadline = Instant::now() + MAX_COALESCE;
            while Instant::now() < deadline && rx.recv_timeout(DEBOUNCE).is_ok() {}
            let _ = app.emit(FILES_CHANGED, source.key());
        }
        give_up(&dir);
    });
}

fn touches_a_listed_entry(event: &notify::Result<Event>, source: Source) -> bool {
    let Ok(event) = event else { return false };
    matches!(
        event.kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    ) && event.paths.iter().any(|p| source.accepts(p))
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

        let names: Vec<_> = scan(tmp.path(), 10, Source::Photos)
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(names, ["new.png", "mid.jpg", "old.png"]);
    }

    #[test]
    fn photos_list_stills_including_heic_and_drop_the_rest() {
        let tmp = tempfile::tempdir().unwrap();
        for name in [
            "a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.HEIC", "g.heif",
        ] {
            touch(tmp.path(), name, 10);
        }
        // Raw and video: Claude Code has no path to read these, so they'd only
        // ever be dead tiles.
        for name in ["h.dng", "i.mov", "j.mp4", "desktop.ini", "noext"] {
            touch(tmp.path(), name, 10);
        }
        let mut names: Vec<_> = scan(tmp.path(), 50, Source::Photos)
            .into_iter()
            .map(|p| p.name)
            .collect();
        names.sort();
        assert_eq!(
            names,
            ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.HEIC", "g.heif"]
        );
    }

    #[test]
    fn downloads_take_everything_folders_included() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "setup.exe", 30);
        touch(tmp.path(), "notes.md", 20);
        touch(tmp.path(), "noext", 10);
        fs::create_dir(tmp.path().join("extracted")).unwrap();

        let got = scan(tmp.path(), 50, Source::Downloads);
        let mut names: Vec<_> = got.iter().map(|e| e.name.clone()).collect();
        names.sort();
        assert_eq!(names, ["extracted", "noext", "notes.md", "setup.exe"]);
        assert!(got.iter().find(|e| e.name == "extracted").unwrap().is_dir);
        assert!(!got.iter().find(|e| e.name == "setup.exe").unwrap().is_dir);
    }

    #[test]
    fn reports_size_for_files_and_zero_for_folders() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("payload.bin"), vec![0u8; 4096]).unwrap();
        fs::create_dir(tmp.path().join("dir")).unwrap();

        let got = scan(tmp.path(), 10, Source::Downloads);
        assert_eq!(got.iter().find(|e| e.name == "payload.bin").unwrap().size, 4096);
        // A directory's real size would need a full walk; the UI shows none.
        assert_eq!(got.iter().find(|e| e.name == "dir").unwrap().size, 0);
    }

    #[test]
    fn truncates_to_the_limit() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..25 {
            touch(tmp.path(), &format!("img{i:02}.png"), 1000 - i);
        }
        let got = scan(tmp.path(), LIMIT, Source::Photos);
        assert_eq!(got.len(), LIMIT);
        // Highest index == smallest age == newest.
        assert_eq!(got[0].name, "img24.png");
    }

    #[test]
    fn missing_folder_yields_nothing() {
        let missing = Path::new("C:\\definitely\\missing\\roll");
        assert!(scan(missing, 10, Source::Photos).is_empty());
        assert!(scan(missing, 10, Source::Downloads).is_empty());
    }

    #[test]
    fn source_keys_round_trip_and_reject_junk() {
        assert_eq!(Source::parse("photos").unwrap(), Source::Photos);
        assert_eq!(Source::parse("downloads").unwrap(), Source::Downloads);
        assert_eq!(Source::parse(Source::Photos.key()).unwrap(), Source::Photos);
        assert!(Source::parse("bookmarks").is_err());
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
    fn only_heic_takes_the_external_decoder() {
        assert!(needs_external_decoder(Path::new("a.HEIC")));
        assert!(needs_external_decoder(Path::new("a.heif")));
        assert!(!needs_external_decoder(Path::new("a.png")));
        assert!(!needs_external_decoder(Path::new("a.jpg")));
    }

    #[test]
    fn thumbnail_refuses_what_the_roll_never_lists() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("clip.mov");
        File::create(&src).unwrap();
        assert!(encode_thumbnail(&src).is_err());
    }

    #[test]
    fn each_watcher_only_wakes_for_its_own_folder() {
        let ev = |path: &str| {
            Ok(Event {
                kind: EventKind::Create(notify::event::CreateKind::File),
                paths: vec![PathBuf::from(path)],
                attrs: Default::default(),
            })
        };
        assert!(touches_a_listed_entry(&ev("C:\\roll\\IMG_1.HEIC"), Source::Photos));
        assert!(touches_a_listed_entry(&ev("C:\\roll\\IMG_2.PNG"), Source::Photos));
        // iCloud's own churn: partial downloads and sidecars must not refresh.
        assert!(!touches_a_listed_entry(&ev("C:\\roll\\IMG_3.icloud"), Source::Photos));
        assert!(!touches_a_listed_entry(&ev("C:\\roll\\clip.mov"), Source::Photos));
        // Downloads accept anything, including the browser's partial writes —
        // that is what the debounce is for.
        assert!(touches_a_listed_entry(&ev("D:\\dl\\setup.exe"), Source::Downloads));
        assert!(touches_a_listed_entry(&ev("D:\\dl\\x.crdownload"), Source::Downloads));
    }
}
