//! Arkadia terminal renderer (WebGPU, WASM).
//!
//! Inspiration is taken **exclusively from WezTerm** (`wezterm-gui` crate, MIT):
//! `renderstate.rs`, `quad.rs`, `customglyph.rs`, `shaders/*.wgsl`. No code
//! from cmux-windows is consulted.

mod atlas;
mod customglyph;
mod payload;
mod pipeline;

use serde_wasm_bindgen::from_value;
use wasm_bindgen::prelude::*;
use web_sys::HtmlCanvasElement;

use atlas::Atlas;
use payload::{CellColor, RenderPayload, TerminalPalette};
use pipeline::{
    CellInstance, Pipeline, Uniforms, FLAG_BOLD, FLAG_COLOR_GLYPH, FLAG_ITALIC, FLAG_STRIKE,
    FLAG_UL_CURLY, FLAG_UL_DASHED, FLAG_UL_DOTTED, FLAG_UL_DOUBLE, FLAG_UNDERLINE,
};

const DEFAULT_FONT_SIZE_PX: u16 = 14;
const ATLAS_SIZE_F: f32 = 1024.0;

#[wasm_bindgen(start)]
pub fn _start() {
    console_error_panic_hook::set_once();
}

const DEFAULT_CLEAR: wgpu::Color = wgpu::Color {
    r: 0.039,
    g: 0.039,
    b: 0.039,
    a: 1.0,
};

#[wasm_bindgen]
pub struct Renderer {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    clear: wgpu::Color,
    atlas: Atlas,
    pipeline: Pipeline,
    font_size_px: u16,
    cell_size_px: [f32; 2],
    palette_bg: [f32; 4],
    palette_fg: [f32; 4],
    palette_ansi: [[f32; 4]; 16],
    instances: Vec<CellInstance>,
    selection: Option<Selection>,
    selection_color: [f32; 4],
    last_payload: Option<RenderPayload>,
    focused: bool,
}

#[derive(Clone, Copy)]
struct Selection {
    start_col: u32,
    start_row: u32,
    end_col: u32,
    end_row: u32,
}

impl Selection {
    fn normalized(&self) -> (u32, u32, u32, u32) {
        let after = (self.start_row, self.start_col) > (self.end_row, self.end_col);
        if after {
            (self.end_col, self.end_row, self.start_col, self.start_row)
        } else {
            (self.start_col, self.start_row, self.end_col, self.end_row)
        }
    }
    fn contains(&self, col: u32, row: u32) -> bool {
        let (sc, sr, ec, er) = self.normalized();
        if row < sr || row > er {
            return false;
        }
        if sr == er {
            return col >= sc && col <= ec;
        }
        if row == sr {
            return col >= sc;
        }
        if row == er {
            return col <= ec;
        }
        true
    }
}

#[wasm_bindgen]
impl Renderer {
    pub async fn new(canvas: HtmlCanvasElement) -> Result<Renderer, JsValue> {
        let width = (canvas.client_width().max(1)) as u32;
        let height = (canvas.client_height().max(1)) as u32;
        canvas.set_width(width);
        canvas.set_height(height);

        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = wgpu::Backends::BROWSER_WEBGPU;
        let instance = wgpu::Instance::new(desc);

        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| JsValue::from_str(&format!("create_surface: {e}")))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("request_adapter: {e}")))?;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("arkadia-device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_webgl2_defaults()
                    .using_resolution(adapter.limits()),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .map_err(|e| JsValue::from_str(&format!("request_device: {e}")))?;

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or_else(|| caps.formats[0]);

        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width,
            height,
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
        };
        surface.configure(&device, &config);

        // Reasonable defaults for font_size 14 at DPR 1 (~8x18 cell). The JS
        // side immediately calls set_cell_size with the real DPR-scaled size,
        // which will rebuild the atlas if it differs.
        let default_cell_w = 8u32;
        let default_cell_h = 18u32;
        let default_ascent = ascent_for(DEFAULT_FONT_SIZE_PX);

        let mut atlas = Atlas::new(&device, default_cell_w, default_cell_h, default_ascent);
        atlas.warmup(&queue, DEFAULT_FONT_SIZE_PX);
        web_sys::console::log_1(
            &format!(
                "[arkadia] atlas warmed up: {} glyphs at {}px (cell {}×{})",
                atlas.slots_len(),
                DEFAULT_FONT_SIZE_PX,
                default_cell_w,
                default_cell_h,
            )
            .into(),
        );

        let pipeline = Pipeline::new(&device, format, &atlas);

        Ok(Renderer {
            surface,
            device,
            queue,
            config,
            clear: DEFAULT_CLEAR,
            atlas,
            pipeline,
            font_size_px: DEFAULT_FONT_SIZE_PX,
            cell_size_px: [default_cell_w as f32, default_cell_h as f32],
            palette_bg: [0.039, 0.039, 0.039, 1.0],
            palette_fg: [0.98, 0.98, 0.98, 1.0],
            palette_ansi: default_ansi_palette(),
            instances: Vec::with_capacity(4096),
            selection: None,
            selection_color: [0.30, 0.40, 0.55, 1.0],
            last_payload: None,
            focused: true,
        })
    }

    pub fn set_focused(&mut self, focused: bool) {
        if self.focused == focused {
            return;
        }
        self.focused = focused;
        self.rebuild_with_last_payload();
    }

    /// Stores the rasterization size. The atlas is *not* rebuilt here — call
    /// `set_cell_size` afterward (the JS side always pairs them) so we don't
    /// pay for two warmup passes.
    pub fn set_font_size(&mut self, size_px: u16) {
        self.font_size_px = size_px.max(1);
    }

    /// Swaps the primary font with one provided as raw bytes (TTF/OTF). The
    /// atlas is cleared, the new ascent is computed, and the atlas is re-warmed
    /// at the current font size. Returns false if `bytes` is not a valid font.
    pub fn set_primary_font(&mut self, bytes: Vec<u8>) -> bool {
        if !self.atlas.replace_primary_font(bytes) {
            return false;
        }
        let cw = self.atlas.cell_w();
        let ch = self.atlas.cell_h();
        let ascent = ascent_for_font(&self.atlas, self.font_size_px);
        self.atlas.set_cell_size(cw, ch, ascent);
        self.atlas.warmup(&self.queue, self.font_size_px);
        self.rebuild_with_last_payload();
        true
    }

    /// Resizes the swap chain. Pass canvas pixel size (after DPR scaling).
    pub fn resize(&mut self, width: u32, height: u32) {
        self.config.width = width.max(1);
        self.config.height = height.max(1);
        self.surface.configure(&self.device, &self.config);
        self.write_uniforms();
    }

    /// Sets the per-cell pixel size used by the vertex shader to lay out the
    /// grid. If the cell size or implied ascent changed, the atlas is cleared
    /// and re-warmed at the current font_size_px.
    pub fn set_cell_size(&mut self, w: f32, h: f32) {
        let cell_w = w.max(1.0).round() as u32;
        let cell_h = h.max(1.0).round() as u32;
        let ascent = ascent_for_font(&self.atlas, self.font_size_px);
        if self.atlas.set_cell_size(cell_w, cell_h, ascent) {
            self.atlas.warmup(&self.queue, self.font_size_px);
            self.pipeline.rebuild_bind_group(&self.device, &self.atlas);
        }
        self.cell_size_px = [w, h];
        self.write_uniforms();
    }

    pub fn set_clear(&mut self, r: f64, g: f64, b: f64, a: f64) {
        self.clear = wgpu::Color { r, g, b, a };
    }

    /// JS palette format: `{ bg: [r,g,b,a], fg: [r,g,b,a], ansi: [[r,g,b,a]; 16] }`
    pub fn set_palette(&mut self, palette: JsValue) -> Result<(), JsValue> {
        let p: TerminalPalette = from_value(palette)
            .map_err(|e| JsValue::from_str(&format!("palette parse: {e}")))?;
        self.palette_bg = p.bg;
        self.palette_fg = p.fg;
        self.palette_ansi = p.ansi;
        self.clear = wgpu::Color {
            r: p.bg[0] as f64,
            g: p.bg[1] as f64,
            b: p.bg[2] as f64,
            a: p.bg[3] as f64,
        };
        Ok(())
    }

    /// Receives a `RenderPayload` JSON object (Tauri event shape).
    pub fn draw(&mut self, payload: JsValue) -> Result<(), JsValue> {
        let payload: RenderPayload = from_value(payload)
            .map_err(|e| JsValue::from_str(&format!("payload parse: {e}")))?;
        self.build_instances(&payload);
        self.last_payload = Some(payload);
        self.render()
    }

    pub fn set_selection(
        &mut self,
        start_col: u32,
        start_row: u32,
        end_col: u32,
        end_row: u32,
    ) {
        self.selection = Some(Selection {
            start_col,
            start_row,
            end_col,
            end_row,
        });
        self.rebuild_with_last_payload();
    }

    pub fn clear_selection(&mut self) {
        if self.selection.is_none() {
            return;
        }
        self.selection = None;
        self.rebuild_with_last_payload();
    }

    pub fn has_selection(&self) -> bool {
        self.selection.is_some()
    }

    pub fn selection_text(&self) -> String {
        let (Some(sel), Some(payload)) = (self.selection, self.last_payload.as_ref()) else {
            return String::new();
        };
        let (_sc, sr, _ec, er) = sel.normalized();
        let mut out = String::new();
        for (row_idx, runs) in payload.lines.iter().enumerate() {
            let row = row_idx as u32;
            if row < sr || row > er {
                continue;
            }
            let mut col: u32 = 0;
            let mut row_text = String::new();
            for run in runs {
                let cell_width = run.cell_width.max(1) as u32;
                for ch in run.text.chars() {
                    if sel.contains(col, row) {
                        row_text.push(ch);
                    }
                    col += cell_width;
                }
            }
            let trimmed = row_text.trim_end();
            out.push_str(trimmed);
            if row < er {
                out.push('\n');
            }
        }
        out
    }

    fn rebuild_with_last_payload(&mut self) {
        let Some(payload) = self.last_payload.take() else {
            return;
        };
        self.build_instances(&payload);
        self.last_payload = Some(payload);
        let _ = self.render();
    }

    fn build_instances(&mut self, payload: &RenderPayload) {
        self.instances.clear();
        for (row_idx, runs) in payload.lines.iter().enumerate() {
            let mut col: u32 = 0;
            for run in runs {
                let mut fg = resolve_color(
                    &run.fg,
                    true,
                    &self.palette_bg,
                    &self.palette_fg,
                    &self.palette_ansi,
                );
                let mut bg = resolve_color(
                    &run.bg,
                    false,
                    &self.palette_bg,
                    &self.palette_fg,
                    &self.palette_ansi,
                );
                if run.inverse {
                    std::mem::swap(&mut fg, &mut bg);
                }
                let cell_width = run.cell_width.max(1);
                let cell_step = cell_width as u32;
                for ch in run.text.chars() {
                    if ch == '\u{0}' {
                        col += cell_step;
                        continue;
                    }
                    // Custom-rasterized block elements only apply to single-cell
                    // glyphs; wide chars (CJK / emoji) bypass and go through swash
                    // at full 2-cell width.
                    let entry = if cell_width == 1 {
                        if let Some(pixels) = customglyph::rasterize(
                            ch,
                            self.atlas.cell_w(),
                            self.atlas.cell_h(),
                        ) {
                            self.atlas
                                .insert_custom(&self.queue, ch, self.font_size_px, &pixels)
                        } else {
                            self.atlas
                                .ensure_glyph(&self.queue, ch, self.font_size_px, 1)
                        }
                    } else {
                        self.atlas
                            .ensure_glyph(&self.queue, ch, self.font_size_px, cell_width)
                    };
                    let entry = entry.unwrap_or(atlas::GlyphEntry {
                        uv_min: [0.0, 0.0],
                        uv_max: [0.0, 0.0],
                        is_color: false,
                    });
                    let is_cursor = self.focused
                        && payload.cursor_visible
                        && row_idx as u32 == payload.cursor_row as u32
                        && col == payload.cursor_col as u32;
                    let in_selection = self
                        .selection
                        .map(|s| s.contains(col, row_idx as u32))
                        .unwrap_or(false);
                    let (final_fg, final_bg) = if in_selection {
                        (fg, self.selection_color)
                    } else if is_cursor {
                        (bg, fg)
                    } else {
                        (fg, bg)
                    };
                    let mut flags: u32 = 0;
                    match run.underline_style {
                        0 => {}
                        2 => flags |= FLAG_UNDERLINE | FLAG_UL_DOUBLE,
                        3 => flags |= FLAG_UNDERLINE | FLAG_UL_CURLY,
                        4 => flags |= FLAG_UNDERLINE | FLAG_UL_DOTTED,
                        5 => flags |= FLAG_UNDERLINE | FLAG_UL_DASHED,
                        _ => flags |= FLAG_UNDERLINE,
                    }
                    if run.bold {
                        flags |= FLAG_BOLD;
                    }
                    if run.italic {
                        flags |= FLAG_ITALIC;
                    }
                    if run.strikethrough {
                        flags |= FLAG_STRIKE;
                    }
                    if entry.is_color {
                        flags |= FLAG_COLOR_GLYPH;
                    }
                    self.instances.push(CellInstance {
                        grid_pos: [col as f32, row_idx as f32],
                        atlas_uv_min: entry.uv_min,
                        atlas_uv_max: entry.uv_max,
                        fg: final_fg,
                        bg: final_bg,
                        flags,
                        width: cell_step,
                    });
                    col += cell_step;
                }
            }
        }
    }

    fn write_uniforms(&self) {
        let uniforms = Uniforms {
            cell_size: self.cell_size_px,
            viewport: [self.config.width as f32, self.config.height as f32],
            atlas_size: [ATLAS_SIZE_F, ATLAS_SIZE_F],
            _pad: [0.0, 0.0],
        };
        self.pipeline.update_uniforms(&self.queue, &uniforms);
    }

    pub fn render(&mut self) -> Result<(), JsValue> {
        if !self.instances.is_empty() {
            self.pipeline
                .write_instances(&self.device, &self.queue, &self.instances);
        }
        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t)
            | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            wgpu::CurrentSurfaceTexture::Timeout
            | wgpu::CurrentSurfaceTexture::Occluded
            | wgpu::CurrentSurfaceTexture::Lost
            | wgpu::CurrentSurfaceTexture::Validation => {
                return Ok(());
            }
        };
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("arkadia-encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("cell-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(self.clear),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            self.pipeline.draw(&mut pass, self.instances.len() as u32);
        }
        self.queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }
}

fn ascent_for(_size_px: u16) -> f32 {
    // Rough placeholder used at construction before the real font is consulted.
    // The actual ascent is fetched from `Atlas::font()` in `set_cell_size`.
    11.0
}

fn ascent_for_font(atlas: &Atlas, size_px: u16) -> f32 {
    atlas.font().metrics(&[]).scale(size_px as f32).ascent
}

fn resolve_color(
    c: &CellColor,
    is_fg: bool,
    bg: &[f32; 4],
    fg: &[f32; 4],
    ansi: &[[f32; 4]; 16],
) -> [f32; 4] {
    match c {
        CellColor::Default => {
            if is_fg {
                *fg
            } else {
                *bg
            }
        }
        CellColor::Ansi { idx } => *ansi
            .get(*idx as usize)
            .unwrap_or(if is_fg { fg } else { bg }),
        CellColor::Rgb { value } => parse_hex_rgb(value).unwrap_or(if is_fg { *fg } else { *bg }),
    }
}

fn parse_hex_rgb(s: &str) -> Option<[f32; 4]> {
    let s = s.strip_prefix('#')?;
    if s.len() < 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()? as f32 / 255.0;
    let g = u8::from_str_radix(&s[2..4], 16).ok()? as f32 / 255.0;
    let b = u8::from_str_radix(&s[4..6], 16).ok()? as f32 / 255.0;
    Some([r, g, b, 1.0])
}

fn default_ansi_palette() -> [[f32; 4]; 16] {
    let raw: [[u8; 3]; 16] = [
        [0x0a, 0x0a, 0x0a],
        [0xe5, 0x53, 0x4b],
        [0x84, 0xc4, 0x52],
        [0xee, 0xae, 0x4c],
        [0x4f, 0x9d, 0xff],
        [0xc6, 0x71, 0xff],
        [0x4e, 0xd1, 0xc7],
        [0xd0, 0xd0, 0xd0],
        [0x55, 0x55, 0x55],
        [0xff, 0x6b, 0x68],
        [0xa6, 0xe2, 0x6f],
        [0xff, 0xc7, 0x66],
        [0x71, 0xb1, 0xff],
        [0xd6, 0x96, 0xff],
        [0x6c, 0xe5, 0xdb],
        [0xfa, 0xfa, 0xfa],
    ];
    let mut out = [[0.0; 4]; 16];
    for (i, c) in raw.iter().enumerate() {
        out[i] = [
            c[0] as f32 / 255.0,
            c[1] as f32 / 255.0,
            c[2] as f32 / 255.0,
            1.0,
        ];
    }
    out
}
