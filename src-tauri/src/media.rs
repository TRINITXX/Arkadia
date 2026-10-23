//! Video files mentioned in conversations, served in byte ranges so a long
//! recording plays and seeks without ever being read whole. The desktop's
//! `arkmedia` protocol and the phone companion's `/video` route share it.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, Prefix};

use tauri::http::{header, Method, Request, Response, StatusCode};
use tauri::{Runtime, UriSchemeContext, UriSchemeResponder, Url};

use crate::artifact_view::ipc_allowed;

/// The desktop's custom scheme, reached as `http://arkmedia.localhost/?path=…`.
pub const PROTOCOL: &str = "arkmedia";

/// Most bytes one response carries: the player asks for the next range itself.
const MAX_CHUNK: u64 = 4 * 1024 * 1024;

/// Bytes of a video, ready to send.
#[derive(Debug, PartialEq)]
pub(crate) struct Chunk {
    /// 200 for the whole file, 206 for a part of it.
    pub status: u16,
    pub mime: &'static str,
    /// First byte, last byte (inclusive) and file size.
    pub start: u64,
    pub end: u64,
    pub total: u64,
    /// Empty for a HEAD request.
    pub body: Vec<u8>,
}

impl Chunk {
    pub fn content_range(&self) -> Option<String> {
        (self.status == 206).then(|| format!("bytes {}-{}/{}", self.start, self.end, self.total))
    }
}

#[derive(Debug, PartialEq)]
pub(crate) enum MediaError {
    /// Not a local video file: the caller answers 404.
    NotFound,
    /// The range starts past the end: 416, with the real size.
    Unsatisfiable { total: u64 },
}

/// The MIME type of a video path; `None` for anything else. The extensions
/// mirror `VIDEO_EXT` in `src/lib/imagePaths.ts`.
pub(crate) fn video_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "mpg" | "mpeg" => "video/mpeg",
        "ogv" => "video/ogg",
        "3gp" => "video/3gpp",
        _ => return None,
    })
}

#[derive(Debug, PartialEq)]
enum Ask {
    Whole,
    Part(u64, u64),
    Unsatisfiable,
}

/// Reads an HTTP `Range` value against a file of `total` bytes. Only the first
/// range of a list counts; a malformed value asks for the whole file, as the
/// RFC wants.
fn parse_range(value: &str, total: u64) -> Ask {
    let Some(spec) = value.trim().strip_prefix("bytes=") else {
        return Ask::Whole;
    };
    let first = spec.split(',').next().unwrap_or_default().trim();
    let Some((from, to)) = first.split_once('-') else {
        return Ask::Whole;
    };
    let (from, to) = (from.trim(), to.trim());
    if from.is_empty() {
        // `-n`: the last n bytes.
        return match to.parse::<u64>() {
            Ok(0) => Ask::Unsatisfiable,
            Ok(_) if total == 0 => Ask::Unsatisfiable,
            Ok(n) => Ask::Part(total.saturating_sub(n), total - 1),
            Err(_) => Ask::Whole,
        };
    }
    let Ok(start) = from.parse::<u64>() else {
        return Ask::Whole;
    };
    let end = if to.is_empty() {
        u64::MAX
    } else {
        match to.parse::<u64>() {
            Ok(end) if end >= start => end,
            _ => return Ask::Whole,
        }
    };
    if start >= total {
        return Ask::Unsatisfiable;
    }
    Ask::Part(start, end.min(total - 1))
}

/// Whether `path` is absolute on a drive letter (`C:\…`). Anything else may
/// make the PC sign in to another machine: `\\server\share`, but also the
/// mixed-slash spellings Windows reads the same way (`/\server\share`), or
/// reach a device (`\\.\pipe\…`).
pub(crate) fn is_on_local_disk(path: &Path) -> bool {
    matches!(
        path.components().next(),
        Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_))
    ) && path.is_absolute()
}

/// The bytes of the video at `path` that `range` (an HTTP `Range` value) asks
/// for, at most `MAX_CHUNK` of them. `head` sizes the answer without reading.
pub(crate) fn read_video(path: &str, range: Option<&str>, head: bool) -> Result<Chunk, MediaError> {
    let p = Path::new(path);
    if !is_on_local_disk(p) {
        return Err(MediaError::NotFound);
    }
    let mime = video_mime(p).ok_or(MediaError::NotFound)?;
    let meta = fs::metadata(p).map_err(|_| MediaError::NotFound)?;
    if !meta.is_file() {
        return Err(MediaError::NotFound);
    }
    let total = meta.len();
    if head {
        let end = total.saturating_sub(1);
        return Ok(Chunk {
            status: 200,
            mime,
            start: 0,
            end,
            total,
            body: Vec::new(),
        });
    }
    let (status, start, end) = match range.map_or(Ask::Whole, |r| parse_range(r, total)) {
        Ask::Unsatisfiable => return Err(MediaError::Unsatisfiable { total }),
        Ask::Part(start, end) => (206, start, end.min(start + MAX_CHUNK - 1)),
        Ask::Whole if total == 0 => (200, 0, 0),
        Ask::Whole if total <= MAX_CHUNK => (200, 0, total - 1),
        // Players always ask for a range; anything else gets the first part.
        Ask::Whole => (206, 0, MAX_CHUNK - 1),
    };
    let len = if total == 0 { 0 } else { end - start + 1 };
    let mut body = Vec::with_capacity(len as usize);
    let mut file = File::open(p).map_err(|_| MediaError::NotFound)?;
    file.seek(SeekFrom::Start(start))
        .map_err(|_| MediaError::NotFound)?;
    file.take(len)
        .read_to_end(&mut body)
        .map_err(|_| MediaError::NotFound)?;
    Ok(Chunk {
        status,
        mime,
        start,
        end,
        total,
        body,
    })
}

/// The file a protocol URL names in its `path` query parameter.
fn path_of(uri: &str) -> Option<String> {
    let url = Url::parse(uri).ok()?;
    let path = url.query_pairs().find(|(k, _)| k == "path")?.1.into_owned();
    Some(path)
}

/// The response to one `arkmedia` request.
fn respond(allowed: bool, uri: &str, range: Option<&str>, head: bool) -> Response<Vec<u8>> {
    let base = || {
        // The posters are drawn on a canvas, which a cross-origin video
        // would taint: the app's page sits at another origin than this one.
        Response::builder().header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
    };
    let not_found = || {
        base()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .unwrap()
    };
    // A remote page (the artifact panel) must not read the PC's files.
    if !allowed {
        return base()
            .status(StatusCode::FORBIDDEN)
            .body(Vec::new())
            .unwrap();
    }
    let Some(path) = path_of(uri) else {
        return not_found();
    };
    match read_video(&path, range, head) {
        Ok(chunk) => {
            let mut res = base()
                .status(chunk.status)
                .header(header::CONTENT_TYPE, chunk.mime)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
            if let Some(range) = chunk.content_range() {
                res = res.header(header::CONTENT_RANGE, range);
            }
            res.body(chunk.body).unwrap()
        }
        Err(MediaError::Unsatisfiable { total }) => base()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{total}"))
            .body(Vec::new())
            .unwrap(),
        Err(MediaError::NotFound) => not_found(),
    }
}

/// The `arkmedia` protocol handler: the file is read off the main thread,
/// which every protocol request is called on.
pub fn serve_protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let allowed = ipc_allowed(ctx.webview_label());
    let uri = request.uri().to_string();
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let head = request.method() == Method::HEAD;
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(respond(allowed, &uri, range.as_deref(), head));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn video_file(bytes: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!("arkadia-media-{}.mp4", uuid::Uuid::new_v4()));
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn reads_the_ranges_players_ask_for() {
        assert_eq!(parse_range("bytes=0-", 10), Ask::Part(0, 9));
        assert_eq!(parse_range("bytes=2-4", 10), Ask::Part(2, 4));
        assert_eq!(parse_range("bytes=8-99", 10), Ask::Part(8, 9));
        assert_eq!(parse_range("bytes=-3", 10), Ask::Part(7, 9));
        assert_eq!(parse_range("bytes=0-1, 5-6", 10), Ask::Part(0, 1));
        assert_eq!(parse_range("bytes=10-", 10), Ask::Unsatisfiable);
        assert_eq!(parse_range("bytes=-0", 10), Ask::Unsatisfiable);
        assert_eq!(parse_range("bytes=5-2", 10), Ask::Whole);
        assert_eq!(parse_range("items=0-1", 10), Ask::Whole);
    }

    #[test]
    fn serves_a_part_of_the_file_with_its_size() {
        let path = video_file(b"0123456789");
        let chunk = read_video(path.to_str().unwrap(), Some("bytes=2-4"), false).unwrap();
        assert_eq!(chunk.status, 206);
        assert_eq!(chunk.body, b"234");
        assert_eq!(chunk.content_range().as_deref(), Some("bytes 2-4/10"));
        assert_eq!(chunk.mime, "video/mp4");

        let whole = read_video(path.to_str().unwrap(), None, false).unwrap();
        assert_eq!((whole.status, whole.body.len()), (200, 10));
        assert_eq!(whole.content_range(), None);

        let head = read_video(path.to_str().unwrap(), Some("bytes=0-"), true).unwrap();
        assert_eq!((head.status, head.total, head.body.len()), (200, 10, 0));

        assert_eq!(
            read_video(path.to_str().unwrap(), Some("bytes=10-"), false),
            Err(MediaError::Unsatisfiable { total: 10 })
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn caps_a_part_at_one_chunk() {
        let path = video_file(&vec![7u8; (MAX_CHUNK + 10) as usize]);
        let chunk = read_video(path.to_str().unwrap(), Some("bytes=0-"), false).unwrap();
        assert_eq!(chunk.body.len() as u64, MAX_CHUNK);
        assert_eq!(chunk.end, MAX_CHUNK - 1);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn refuses_anything_but_a_local_video() {
        let missing = Err(MediaError::NotFound);
        assert_eq!(
            read_video("C:\\definitely\\missing.mp4", None, false),
            missing
        );
        assert_eq!(read_video("C:\\x\\notes.txt", None, false), missing);
        assert_eq!(
            read_video("\\\\server\\share\\clip.mp4", None, false),
            missing
        );
        assert_eq!(read_video("relative\\clip.mp4", None, false), missing);
        // Windows reads these as network shares or devices too.
        for path in [
            "/\\server\\share\\clip.mp4",
            "\\/server\\share\\clip.mp4",
            "/\\.\\pipe\\x.mp4",
            "C:clip.mp4",
        ] {
            assert_eq!(read_video(path, None, false), missing, "{path}");
        }
    }

    #[test]
    fn only_arkadias_own_windows_get_the_file() {
        let path = video_file(b"0123456789");
        let uri = Url::parse_with_params(
            "http://arkmedia.localhost/",
            [("path", path.to_str().unwrap())],
        )
        .unwrap()
        .to_string();
        assert_eq!(
            respond(true, &uri, Some("bytes=0-1"), false).status(),
            StatusCode::PARTIAL_CONTENT
        );
        assert_eq!(
            respond(false, &uri, Some("bytes=0-1"), false).status(),
            StatusCode::FORBIDDEN
        );
        fs::remove_file(path).unwrap();
    }
}
