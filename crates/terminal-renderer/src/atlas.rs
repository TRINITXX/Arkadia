//! Glyph atlas for the terminal renderer.
//!
//! Inspired by WezTerm's `wezterm-gui` atlas (MIT). Each slot in the atlas is
//! `cell_width * cell_w × cell_h` device pixels — the glyph is blitted at
//! `(placement.left, ascent − placement.top)` inside the slot.
//!
//! The format is `Rgba8Unorm`. Mono glyphs (Cascadia, Noto Sans Mono CJK) are
//! stored with `R=G=B=A=alpha` (the fragment shader does `mix(bg, fg, alpha)`).
//! Color glyphs (Noto Color Emoji COLRv1) store premultiplied RGBA (the shader
//! composites them over `bg` directly, ignoring `fg`).
//!
//! Multi-font fallback: the `fonts` chain is consulted in order — primary
//! (latin + box drawing; user-swappable) → Noto Sans Mono CJK SC (CJK) →
//! Symbols Nerd Font Mono (Powerline + dev icons; PUA U+E000–U+F8FF) →
//! Twemoji (color emoji). The first font that has a glyph wins.
//!
//! Slot dimensions track the renderer's cell size; whenever `set_cell_size`
//! changes, the atlas is cleared and re-warmed at the new size.

use std::collections::HashMap;

use swash::scale::image::Content;
use swash::scale::{Render, ScaleContext, Source, StrikeWith};
use swash::zeno::Format;
use swash::FontRef;

const ATLAS_SIZE: u32 = 1024;
const ATLAS_PADDING: u32 = 1;
const FONT_DATA_PRIMARY: &[u8] = include_bytes!("../assets/CascadiaCode.ttf");
const FONT_DATA_CJK: &[u8] = include_bytes!("../assets/NotoSansMonoCJKsc-Regular.otf");
// Symbols Nerd Font Mono — covers Powerline (U+E0A0–E0D7), dev icons,
// FontAwesome, Material Design Icons, Octicons across the PUA range
// U+E000–U+F8FF. Used as fallback so glyphs render even when the user's
// primary font is not a Nerd Font variant.
const FONT_DATA_NERD: &[u8] = include_bytes!("../assets/SymbolsNerdFontMono-Regular.ttf");
// Twemoji-Mozilla (COLRv0). swash 0.2 only supports COLRv0; the Noto Color
// Emoji COLRv1 build leaves Source::ColorOutline empty and emojis disappear.
const FONT_DATA_EMOJI: &[u8] = include_bytes!("../assets/TwemojiMozilla.ttf");

/// Index in `Atlas::fonts` of the color emoji font. Glyphs from this font are
/// rendered through swash's color-bitmap / color-outline path and flagged as
/// color in the atlas.
const FONT_INDEX_EMOJI: usize = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct GlyphKey {
    pub codepoint: u32,
    /// Size quantized to integer pixels (V1 only supports integer sizes).
    pub size_px: u16,
}

impl GlyphKey {
    pub fn new(ch: char, size_px: u16) -> Self {
        Self {
            codepoint: ch as u32,
            size_px,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct GlyphEntry {
    /// UV (top-left, bottom-right) in [0, 1] of the slot in the atlas texture.
    /// The shader samples this rect using the cell's local UV.
    pub uv_min: [f32; 2],
    pub uv_max: [f32; 2],
    /// True iff this glyph stores premultiplied RGBA (color emoji). Mono glyphs
    /// have `R=G=B=A=alpha` and use `mix(bg, fg, alpha)` in the shader.
    pub is_color: bool,
}

pub struct Atlas {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    sampler: wgpu::Sampler,
    /// Cell dimensions in device pixels — the size of each atlas slot.
    cell_w: u32,
    cell_h: u32,
    /// Pixel distance from the top of the cell to the baseline. Drives where
    /// glyphs are placed vertically inside their slot.
    ascent: f32,
    cursor_x: u32,
    cursor_y: u32,
    slots: HashMap<GlyphKey, GlyphEntry>,
    /// Fallback chain: [primary (Cascadia by default, user-swappable),
    /// CJK (Noto Sans Mono CJK SC), Nerd (Symbols Nerd Font Mono),
    /// emoji (Twemoji)]. First font with a glyph for `ch` wins.
    fonts: Vec<FontRef<'static>>,
    scale_context: ScaleContext,
}

impl Atlas {
    pub fn new(device: &wgpu::Device, cell_w: u32, cell_h: u32, ascent: f32) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("arkadia-glyph-atlas"),
            size: wgpu::Extent3d {
                width: ATLAS_SIZE,
                height: ATLAS_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("arkadia-glyph-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });

        let primary = FontRef::from_index(FONT_DATA_PRIMARY, 0)
            .expect("CascadiaCode.ttf must be valid");
        let cjk = FontRef::from_index(FONT_DATA_CJK, 0)
            .expect("NotoSansMonoCJKsc-Regular.otf must be valid");
        let nerd = FontRef::from_index(FONT_DATA_NERD, 0)
            .expect("SymbolsNerdFontMono-Regular.ttf must be valid");
        let emoji = FontRef::from_index(FONT_DATA_EMOJI, 0)
            .expect("TwemojiMozilla.ttf must be valid");
        let fonts = vec![primary, cjk, nerd, emoji];

        Self {
            texture,
            view,
            sampler,
            cell_w: cell_w.max(1),
            cell_h: cell_h.max(1),
            ascent,
            cursor_x: ATLAS_PADDING,
            cursor_y: ATLAS_PADDING,
            slots: HashMap::new(),
            fonts,
            scale_context: ScaleContext::new(),
        }
    }

    pub fn view(&self) -> &wgpu::TextureView {
        &self.view
    }

    pub fn sampler(&self) -> &wgpu::Sampler {
        &self.sampler
    }

    pub fn cell_w(&self) -> u32 {
        self.cell_w
    }

    pub fn cell_h(&self) -> u32 {
        self.cell_h
    }

    pub fn font(&self) -> FontRef<'static> {
        // Primary (Cascadia) drives the metrics — line height, ascent, etc.
        self.fonts[0]
    }

    /// Walks the fallback chain and returns the first font that has a glyph
    /// for `ch`, plus the glyph id. None means we'll render a missing-glyph
    /// blank cell.
    fn pick_font(&self, ch: char) -> Option<(usize, u16)> {
        for (idx, font) in self.fonts.iter().enumerate() {
            let gid = font.charmap().map(ch);
            if gid != 0 {
                return Some((idx, gid));
            }
        }
        None
    }

    /// Swaps the primary font (slot 0 in the fallback chain). The CJK and
    /// emoji fallbacks are kept as-is. Atlas is cleared so the caller must
    /// `warmup` afterwards. Returns false if `bytes` is not a valid font, in
    /// which case the previous font is preserved.
    ///
    /// `bytes` is leaked (`Box::leak`) so the resulting `FontRef` can carry
    /// the `'static` lifetime swash requires. Each call costs one font's
    /// worth of memory (~1-3 MiB), which is acceptable since users change
    /// fonts rarely.
    pub fn replace_primary_font(&mut self, bytes: Vec<u8>) -> bool {
        let leaked: &'static [u8] = Box::leak(bytes.into_boxed_slice());
        match FontRef::from_index(leaked, 0) {
            Some(font) => {
                self.fonts[0] = font;
                self.clear();
                true
            }
            None => false,
        }
    }

    /// Updates cell metrics. Returns `true` if the atlas was cleared (so the
    /// caller can re-warm at the new size).
    pub fn set_cell_size(&mut self, cell_w: u32, cell_h: u32, ascent: f32) -> bool {
        let cw = cell_w.max(1);
        let ch = cell_h.max(1);
        if cw == self.cell_w && ch == self.cell_h && (ascent - self.ascent).abs() < 0.01 {
            return false;
        }
        self.cell_w = cw;
        self.cell_h = ch;
        self.ascent = ascent;
        self.clear();
        true
    }

    /// Drops every cached glyph and resets the bump cursor. The texture
    /// contents are not zeroed — old pixels remain until overwritten by the
    /// next `ensure_glyph`, but no `GlyphEntry` references them anymore.
    pub fn clear(&mut self) {
        self.slots.clear();
        self.cursor_x = ATLAS_PADDING;
        self.cursor_y = ATLAS_PADDING;
    }

    /// Rasterizes `ch` at `size_px` and uploads it to an RGBA slot sized
    /// `cell_width * cell_w × cell_h`. Mono glyphs (Cascadia, Noto CJK) are
    /// expanded to `R=G=B=A=alpha`; color glyphs (Noto Color Emoji COLRv1)
    /// store premultiplied RGBA as returned by swash.
    pub fn ensure_glyph(
        &mut self,
        queue: &wgpu::Queue,
        ch: char,
        size_px: u16,
        cell_width: u8,
    ) -> Option<GlyphEntry> {
        let key = GlyphKey::new(ch, size_px);
        if let Some(entry) = self.slots.get(&key) {
            return Some(*entry);
        }

        let (font_idx, glyph_id) = self.pick_font(ch)?;
        let font = self.fonts[font_idx];

        // `hint(false)` matches WezTerm's "Light" load target — slightly
        // softer outlines but visibly thinner stems on Maple Mono NF / Cascadia
        // at 14 px, closer to the FreeType output the user compares against.
        let mut scaler = self
            .scale_context
            .builder(font)
            .size(size_px as f32)
            .hint(false)
            .build();

        // Color emoji font: try color paths first, fall through to a mono
        // outline. Other fonts skip color sources entirely.
        let image = if font_idx == FONT_INDEX_EMOJI {
            Render::new(&[
                Source::ColorOutline(0),
                Source::ColorBitmap(StrikeWith::BestFit),
                Source::Outline,
            ])
            .render(&mut scaler, glyph_id)?
        } else {
            Render::new(&[Source::Outline, Source::Bitmap(StrikeWith::BestFit)])
                .format(Format::Alpha)
                .render(&mut scaler, glyph_id)?
        };

        let is_color = matches!(image.content, Content::Color);
        let n_cells = cell_width.max(1) as u32;
        let slot_w = self.cell_w * n_cells;
        let slot = self.allocate_slot(ch, size_px, n_cells)?;

        let mut staging = vec![0u8; (slot_w * self.cell_h * 4) as usize];
        let gw = image.placement.width as i32;
        let gh = image.placement.height as i32;
        if gw > 0 && gh > 0 {
            let glyph_x_origin = image.placement.left;
            let glyph_y_origin = (self.ascent - image.placement.top as f32).round() as i32;
            if is_color {
                blit_rgba(
                    &image.data,
                    gw,
                    gh,
                    &mut staging,
                    slot_w,
                    self.cell_h,
                    glyph_x_origin,
                    glyph_y_origin,
                );
            } else {
                blit_alpha_as_rgba(
                    &image.data,
                    gw,
                    gh,
                    &mut staging,
                    slot_w,
                    self.cell_h,
                    glyph_x_origin,
                    glyph_y_origin,
                );
            }
        }

        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: slot.x,
                    y: slot.y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &staging,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(slot_w * 4),
                rows_per_image: Some(self.cell_h),
            },
            wgpu::Extent3d {
                width: slot_w,
                height: self.cell_h,
                depth_or_array_layers: 1,
            },
        );

        let entry = self.entry_for_slot(&slot, n_cells, is_color);
        self.slots.insert(key, entry);
        Some(entry)
    }

    /// Allocates a slot of `n_cells * cell_w × cell_h` (with padding) and
    /// advances the bump cursor. Wide chars use `n_cells = 2`.
    fn allocate_slot(&mut self, ch: char, size_px: u16, n_cells: u32) -> Option<Slot> {
        let slot_w = self.cell_w * n_cells;
        let needed_w = slot_w + ATLAS_PADDING;
        let needed_h = self.cell_h + ATLAS_PADDING;
        if self.cursor_x + needed_w > ATLAS_SIZE {
            self.cursor_x = ATLAS_PADDING;
            self.cursor_y += needed_h;
        }
        if self.cursor_y + needed_h > ATLAS_SIZE {
            log::warn!(
                "atlas full, can't rasterize {ch:?} at {size_px}px (cell {}×{}, n_cells {})",
                self.cell_w,
                self.cell_h,
                n_cells,
            );
            return None;
        }
        let slot = Slot {
            x: self.cursor_x,
            y: self.cursor_y,
        };
        self.cursor_x += needed_w;
        Some(slot)
    }

    fn entry_for_slot(&self, slot: &Slot, n_cells: u32, is_color: bool) -> GlyphEntry {
        let slot_w = self.cell_w * n_cells;
        GlyphEntry {
            uv_min: [
                slot.x as f32 / ATLAS_SIZE as f32,
                slot.y as f32 / ATLAS_SIZE as f32,
            ],
            uv_max: [
                (slot.x + slot_w) as f32 / ATLAS_SIZE as f32,
                (slot.y + self.cell_h) as f32 / ATLAS_SIZE as f32,
            ],
            is_color,
        }
    }

    /// Inserts a pre-rasterized buffer for a single-cell custom glyph (block
    /// elements / box drawing). `pixels` is `cell_w * cell_h` R8 coverage; we
    /// expand to RGBA (alpha replicated to all four channels) for the unified
    /// atlas. Wide custom glyphs are out of scope.
    pub fn insert_custom(
        &mut self,
        queue: &wgpu::Queue,
        ch: char,
        size_px: u16,
        pixels: &[u8],
    ) -> Option<GlyphEntry> {
        let key = GlyphKey::new(ch, size_px);
        if let Some(entry) = self.slots.get(&key) {
            return Some(*entry);
        }
        debug_assert_eq!(pixels.len(), (self.cell_w * self.cell_h) as usize);
        let slot = self.allocate_slot(ch, size_px, 1)?;
        let mut staging = vec![0u8; (self.cell_w * self.cell_h * 4) as usize];
        for (i, &alpha) in pixels.iter().enumerate() {
            let dst = i * 4;
            staging[dst] = alpha;
            staging[dst + 1] = alpha;
            staging[dst + 2] = alpha;
            staging[dst + 3] = alpha;
        }
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: slot.x,
                    y: slot.y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &staging,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(self.cell_w * 4),
                rows_per_image: Some(self.cell_h),
            },
            wgpu::Extent3d {
                width: self.cell_w,
                height: self.cell_h,
                depth_or_array_layers: 1,
            },
        );
        let entry = self.entry_for_slot(&slot, 1, false);
        self.slots.insert(key, entry);
        Some(entry)
    }

    /// Rasterizes ASCII (32–126), Latin-1 supplement (160–255), box-drawing
    /// (U+2500–U+257F), block elements (U+2580–U+259F) and Powerline +
    /// extra symbols (U+E0A0–U+E0D7) for `size_px` upfront, so the first
    /// frame doesn't stall. Block elements go through `crate::customglyph`
    /// rather than swash.
    pub fn warmup(&mut self, queue: &wgpu::Queue, size_px: u16) {
        for code in 32u32..=126 {
            self.preload_one(queue, code, size_px);
        }
        for code in 160u32..=255 {
            self.preload_one(queue, code, size_px);
        }
        for code in 0x2500u32..=0x257F {
            self.preload_one(queue, code, size_px);
        }
        for code in 0x2580u32..=0x259F {
            self.preload_one(queue, code, size_px);
        }
        for code in 0xE0A0u32..=0xE0D7 {
            self.preload_one(queue, code, size_px);
        }
    }

    fn preload_one(&mut self, queue: &wgpu::Queue, code: u32, size_px: u16) {
        let Some(ch) = char::from_u32(code) else {
            return;
        };
        if let Some(pixels) =
            crate::customglyph::rasterize(ch, self.cell_w, self.cell_h)
        {
            self.insert_custom(queue, ch, size_px, &pixels);
        } else {
            self.ensure_glyph(queue, ch, size_px, 1);
        }
    }

    pub fn slots_len(&self) -> usize {
        self.slots.len()
    }
}

#[derive(Clone, Copy)]
struct Slot {
    x: u32,
    y: u32,
}

/// Blits an 8-bit alpha source (one byte per pixel) into an RGBA destination,
/// replicating alpha across all four channels.
#[allow(clippy::too_many_arguments)]
fn blit_alpha_as_rgba(
    src: &[u8],
    src_w: i32,
    src_h: i32,
    dst: &mut [u8],
    dst_w: u32,
    dst_h: u32,
    dst_x_origin: i32,
    dst_y_origin: i32,
) {
    for row in 0..src_h {
        let dst_y = dst_y_origin + row;
        if dst_y < 0 || dst_y >= dst_h as i32 {
            continue;
        }
        for col in 0..src_w {
            let dst_x = dst_x_origin + col;
            if dst_x < 0 || dst_x >= dst_w as i32 {
                continue;
            }
            let s = (row * src_w + col) as usize;
            let d = ((dst_y as u32 * dst_w + dst_x as u32) * 4) as usize;
            let a = src[s];
            dst[d] = a;
            dst[d + 1] = a;
            dst[d + 2] = a;
            dst[d + 3] = a;
        }
    }
}

/// Blits a premultiplied RGBA source (4 bytes per pixel) into an RGBA dest.
#[allow(clippy::too_many_arguments)]
fn blit_rgba(
    src: &[u8],
    src_w: i32,
    src_h: i32,
    dst: &mut [u8],
    dst_w: u32,
    dst_h: u32,
    dst_x_origin: i32,
    dst_y_origin: i32,
) {
    for row in 0..src_h {
        let dst_y = dst_y_origin + row;
        if dst_y < 0 || dst_y >= dst_h as i32 {
            continue;
        }
        for col in 0..src_w {
            let dst_x = dst_x_origin + col;
            if dst_x < 0 || dst_x >= dst_w as i32 {
                continue;
            }
            let s = ((row * src_w + col) * 4) as usize;
            let d = ((dst_y as u32 * dst_w + dst_x as u32) * 4) as usize;
            dst[d] = src[s];
            dst[d + 1] = src[s + 1];
            dst[d + 2] = src[s + 2];
            dst[d + 3] = src[s + 3];
        }
    }
}
