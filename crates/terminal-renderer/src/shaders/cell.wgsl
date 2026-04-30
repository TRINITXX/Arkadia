// Arkadia terminal cell shader.
// Inspiration: WezTerm's `wezterm-gui/src/shaders/cell-{vert,frag}.wgsl` (MIT).
//
// Each instance is one terminal cell. Atlas slots are now cell-sized — the
// fragment shader maps the cell's local UV to the slot rect and samples.
// Half-texel inset prevents linear-filter bleed against the (alpha=0) padding.
//
// flags layout:
//   bit 0 = underline (any), bit 1 = bold (synthetic, double sample),
//   bit 2 = italic (synthetic, UV skew), bit 3 = strikethrough,
//   bit 4 = underline-double, 5 = underline-curly, 6 = dotted, 7 = dashed.

const FLAG_UNDERLINE: u32 = 1u;
const FLAG_BOLD: u32 = 2u;
const FLAG_ITALIC: u32 = 4u;
const FLAG_STRIKE: u32 = 8u;
const FLAG_UL_DOUBLE: u32 = 16u;
const FLAG_UL_CURLY: u32 = 32u;
const FLAG_UL_DOTTED: u32 = 64u;
const FLAG_UL_DASHED: u32 = 128u;
const FLAG_COLOR_GLYPH: u32 = 256u;

struct Uniforms {
    cell_size: vec2<f32>,
    viewport: vec2<f32>,
    atlas_size: vec2<f32>,
    _pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var atlas_tex: texture_2d<f32>;
@group(0) @binding(2) var atlas_sampler: sampler;

struct CellInstance {
    @location(0) grid_pos: vec2<f32>,
    @location(1) atlas_uv_min: vec2<f32>,
    @location(2) atlas_uv_max: vec2<f32>,
    @location(3) fg: vec4<f32>,
    @location(4) bg: vec4<f32>,
    @location(5) flags: u32,
    @location(6) width: u32,
};

struct VertexOut {
    @builtin(position) position: vec4<f32>,
    @location(0) cell_uv: vec2<f32>,
    @location(1) atlas_uv_min: vec2<f32>,
    @location(2) atlas_uv_max: vec2<f32>,
    @location(3) fg: vec4<f32>,
    @location(4) bg: vec4<f32>,
    @location(5) @interpolate(flat) flags: u32,
    @location(6) @interpolate(flat) width: u32,
};

const CORNERS = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0),
    vec2<f32>(1.0, 0.0),
    vec2<f32>(1.0, 1.0),
);

@vertex
fn vs_main(
    @builtin(vertex_index) vidx: u32,
    instance: CellInstance,
) -> VertexOut {
    let corner = CORNERS[vidx];
    let cell_origin_px = instance.grid_pos * u.cell_size;
    // Wide chars (CJK / emoji) extend across two cells; the quad scales with
    // `width` so the glyph is rendered at its full natural width.
    let quad_size = vec2<f32>(u.cell_size.x * f32(instance.width), u.cell_size.y);
    let pixel = cell_origin_px + corner * quad_size;

    let clip_x = (pixel.x / u.viewport.x) * 2.0 - 1.0;
    let clip_y = 1.0 - (pixel.y / u.viewport.y) * 2.0;

    var out: VertexOut;
    out.position = vec4<f32>(clip_x, clip_y, 0.0, 1.0);
    out.cell_uv = corner;
    out.atlas_uv_min = instance.atlas_uv_min;
    out.atlas_uv_max = instance.atlas_uv_max;
    out.fg = instance.fg;
    out.bg = instance.bg;
    out.flags = instance.flags;
    out.width = instance.width;
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let inset = vec2<f32>(0.5) / u.atlas_size;
    let uv_min_safe = in.atlas_uv_min + inset;
    let uv_max_safe = in.atlas_uv_max - inset;

    // Italic: shear the cell-local UV ~10° to the right at the top.
    // tan(10°) ≈ 0.176; we use 0.18 for a slightly more pronounced slant.
    let italic_on = select(0.0, 1.0, (in.flags & FLAG_ITALIC) != 0u);
    let local_uv = vec2<f32>(
        in.cell_uv.x - 0.18 * italic_on * (1.0 - in.cell_uv.y),
        in.cell_uv.y,
    );

    let atlas_uv = clamp(
        mix(uv_min_safe, uv_max_safe, local_uv),
        uv_min_safe,
        uv_max_safe,
    );

    let sample = textureSample(atlas_tex, atlas_sampler, atlas_uv);
    // For mono glyphs the atlas stores R=G=B=A=alpha; for color glyphs the
    // RGB carries the premultiplied color and A is the natural alpha.
    var coverage = sample.a;

    // Synthetic bold: always sample with a 1-pixel horizontally-shifted UV
    // (textureSample must be in uniform control flow), then mix the result
    // with the base coverage according to the bold flag. Bold is mono-only;
    // for color glyphs the boldness mix is masked out via FLAG_COLOR_GLYPH.
    let bold_uv = clamp(
        atlas_uv - vec2<f32>(1.0 / u.atlas_size.x, 0.0),
        uv_min_safe,
        uv_max_safe,
    );
    let bold_cov = textureSample(atlas_tex, atlas_sampler, bold_uv).a;
    let is_color = (in.flags & FLAG_COLOR_GLYPH) != 0u;
    let bold_on = select(0.0, 1.0, ((in.flags & FLAG_BOLD) != 0u) && !is_color);
    coverage = mix(coverage, max(coverage, bold_cov), bold_on);

    // Mono path : `mix(bg, fg, alpha)`.
    // Color path : premultiplied "over" composition `src + bg*(1-src.a)`.
    let mono_rgb = mix(in.bg.rgb, in.fg.rgb, coverage);
    let color_rgb = sample.rgb + in.bg.rgb * (1.0 - sample.a);
    let color_factor = select(0.0, 1.0, is_color);
    var rgb = mix(mono_rgb, color_rgb, color_factor);

    // For wide cells, `cell_uv` runs 0..1 across a 2-cell-wide quad, so we
    // scale `pos_in_cell.x` accordingly. Underline / strike / curly patterns
    // therefore continue cleanly across the full grapheme width.
    let cell_size_w = vec2<f32>(u.cell_size.x * f32(in.width), u.cell_size.y);
    let pos_in_cell = in.cell_uv * cell_size_w;

    // Strikethrough: 1-px line at the cell's mid-y, painted in fg.
    let strike_on = select(0.0, 1.0, (in.flags & FLAG_STRIKE) != 0u);
    let strike_y_min = u.cell_size.y * 0.5 - 0.5;
    let in_strike = step(strike_y_min, pos_in_cell.y)
        * (1.0 - step(strike_y_min + 1.0, pos_in_cell.y));
    rgb = mix(rgb, in.fg.rgb, in_strike * strike_on);

    // Underline: choice of single / double / curly / dotted / dashed.
    // All five coverages are computed unconditionally (no derivative-using
    // sampling, just step/mix math) and selected via flag bits afterward.
    let underline_on = select(0.0, 1.0, (in.flags & FLAG_UNDERLINE) != 0u);
    let single_y = u.cell_size.y - 2.0;
    let single_in = step(single_y, pos_in_cell.y)
        * (1.0 - step(single_y + 1.0, pos_in_cell.y));

    // Double: two 1-px lines, separated by 1px.
    let double_y1 = u.cell_size.y - 4.0;
    let double_y2 = u.cell_size.y - 2.0;
    let double_in1 = step(double_y1, pos_in_cell.y)
        * (1.0 - step(double_y1 + 1.0, pos_in_cell.y));
    let double_in2 = step(double_y2, pos_in_cell.y)
        * (1.0 - step(double_y2 + 1.0, pos_in_cell.y));
    let double_in = max(double_in1, double_in2);

    // Curly: sin wave centered slightly above bottom.
    let curly_center = u.cell_size.y - 2.5;
    let curly_amp = 1.5;
    let curly_period = 4.0;
    let curly_y = curly_center + sin(pos_in_cell.x * 6.2832 / curly_period) * curly_amp;
    let curly_dist = abs(pos_in_cell.y - curly_y);
    let curly_in = 1.0 - step(0.7, curly_dist);

    // Dotted: 1-px dots, period 2 px.
    let dotted_in_x = 1.0 - step(1.0, pos_in_cell.x - floor(pos_in_cell.x / 2.0) * 2.0);
    let dotted_in = single_in * dotted_in_x;

    // Dashed: 3-px dashes, period 5 px.
    let dashed_x_mod = pos_in_cell.x - floor(pos_in_cell.x / 5.0) * 5.0;
    let dashed_in_x = 1.0 - step(3.0, dashed_x_mod);
    let dashed_in = single_in * dashed_in_x;

    let is_double = select(0.0, 1.0, (in.flags & FLAG_UL_DOUBLE) != 0u);
    let is_curly = select(0.0, 1.0, (in.flags & FLAG_UL_CURLY) != 0u);
    let is_dotted = select(0.0, 1.0, (in.flags & FLAG_UL_DOTTED) != 0u);
    let is_dashed = select(0.0, 1.0, (in.flags & FLAG_UL_DASHED) != 0u);
    let is_single = (1.0 - is_double) * (1.0 - is_curly) * (1.0 - is_dotted) * (1.0 - is_dashed);

    let in_underline = single_in * is_single
        + double_in * is_double
        + curly_in * is_curly
        + dotted_in * is_dotted
        + dashed_in * is_dashed;
    rgb = mix(rgb, in.fg.rgb, in_underline * underline_on);

    return vec4<f32>(rgb, 1.0);
}
