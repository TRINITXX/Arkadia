//! The artifact panel's region capture. The page on screen is grabbed and
//! shown frozen in its place while a region is traced over it (the page is a
//! separate window, which would take the mouse); the region then goes to the
//! clipboard, where Claude Code's Alt+V reads it, as after Windows' own
//! snipping tool.

use std::sync::Mutex;

use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};
use tauri::image::Image;
use tauri::ipc::Response;
use tauri::{AppHandle, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::artifact_view::{self, ArtifactView};

/// The last grab, until its region is copied or the capture is cancelled.
#[derive(Default)]
pub struct ArtifactSnip(Mutex<Option<Grab>>);

struct Grab {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

/// Grabs the artifact on screen and returns it as PNG, to be shown frozen.
#[tauri::command]
pub async fn artifact_snip_grab(
    app: AppHandle,
    view: State<'_, ArtifactView>,
    snip: State<'_, ArtifactSnip>,
) -> Result<Response, String> {
    let window = artifact_view::active_window(&app, &view).ok_or("no artifact on screen")?;
    if !window.is_visible().map_err(|e| e.to_string())? {
        return Err("the artifact is hidden".into());
    }
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let rgba = grab_screen(origin.x, origin.y, size.width, size.height)?;
    // Shown for a few seconds only: speed over size.
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::Adaptive)
        .write_image(&rgba, size.width, size.height, ExtendedColorType::Rgba8)
        .map_err(|e| format!("encode: {e}"))?;
    *snip.0.lock().map_err(|e| e.to_string())? = Some(Grab {
        width: size.width,
        height: size.height,
        rgba,
    });
    Ok(Response::new(png))
}

/// Puts a region of the last grab, in its physical pixels, on the clipboard.
#[tauri::command]
pub async fn artifact_snip_copy(
    app: AppHandle,
    snip: State<'_, ArtifactSnip>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let grab = snip
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .take()
        .ok_or("nothing grabbed")?;
    let (width, height, rgba) = crop(&grab, x, y, width, height).ok_or("empty region")?;
    app.clipboard()
        .write_image(&Image::new_owned(rgba, width, height))
        .map_err(|e| e.to_string())
}

/// Drops the last grab: the capture was cancelled.
#[tauri::command]
pub async fn artifact_snip_cancel(snip: State<'_, ArtifactSnip>) -> Result<(), String> {
    snip.0.lock().map_err(|e| e.to_string())?.take();
    Ok(())
}

/// The part of `grab` inside the region, cut at its edges; none if nothing is left.
fn crop(grab: &Grab, x: u32, y: u32, width: u32, height: u32) -> Option<(u32, u32, Vec<u8>)> {
    let x = x.min(grab.width);
    let y = y.min(grab.height);
    let width = width.min(grab.width - x);
    let height = height.min(grab.height - y);
    if width == 0 || height == 0 {
        return None;
    }
    let stride = grab.width as usize * 4;
    let row_len = width as usize * 4;
    let mut rgba = Vec::with_capacity(row_len * height as usize);
    for row in y..y + height {
        let start = row as usize * stride + x as usize * 4;
        rgba.extend_from_slice(&grab.rgba[start..start + row_len]);
    }
    Some((width, height, rgba))
}

/// The screen's pixels in a rectangle of physical pixels, as RGBA: what is on
/// screen, like the snipping tool, so the page is caught as it is drawn.
#[cfg(windows)]
fn grab_screen(x: i32, y: i32, width: u32, height: u32) -> Result<Vec<u8>, String> {
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
        DIB_RGB_COLORS, SRCCOPY,
    };

    if width == 0 || height == 0 {
        return Err("empty artifact".into());
    }
    let (w, h) = (width as i32, height as i32);
    let mut pixels = vec![0u8; width as usize * height as usize * 4];
    let lines = unsafe {
        let screen = GetDC(None);
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, w, h);
        let previous = SelectObject(memory, bitmap.into());
        let copied = BitBlt(memory, 0, 0, w, h, Some(screen), x, y, SRCCOPY);
        SelectObject(memory, previous);
        // Top-down rows (negative height), 4 bytes a pixel.
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let lines = if copied.is_ok() {
            GetDIBits(
                memory,
                bitmap,
                0,
                height,
                Some(pixels.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            )
        } else {
            0
        };
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        lines
    };
    if lines != h {
        return Err("screen grab failed".into());
    }
    // BGRA to RGBA; the screen has no transparency.
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
        px[3] = 255;
    }
    Ok(pixels)
}

#[cfg(not(windows))]
fn grab_screen(_x: i32, _y: i32, _width: u32, _height: u32) -> Result<Vec<u8>, String> {
    Err("region capture is Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 3×2 grab whose pixel (col, row) is `[col, row, 0, 255]`.
    fn grab() -> Grab {
        let mut rgba = Vec::new();
        for row in 0..2u8 {
            for col in 0..3u8 {
                rgba.extend_from_slice(&[col, row, 0, 255]);
            }
        }
        Grab {
            width: 3,
            height: 2,
            rgba,
        }
    }

    #[test]
    fn crops_the_region_and_cuts_it_at_the_edges() {
        let (w, h, rgba) = crop(&grab(), 1, 0, 5, 1).unwrap();
        assert_eq!((w, h), (2, 1));
        assert_eq!(rgba, vec![1, 0, 0, 255, 2, 0, 0, 255]);
        let (_, _, rgba) = crop(&grab(), 2, 1, 1, 1).unwrap();
        assert_eq!(rgba, vec![2, 1, 0, 255]);
        assert!(crop(&grab(), 3, 0, 2, 2).is_none());
        assert!(crop(&grab(), 0, 0, 0, 2).is_none());
    }
}
