//! Hand-rasterized cell-sized glyphs for code points whose font shapes don't
//! reach the full cell rectangle (and therefore look "gappy" between rows or
//! columns when stacked at line-height > 1). Same trick WezTerm uses in
//! `wezterm/src/customglyph.rs` (MIT) — the only inspiration source allowed
//! for terminal-engine code per the project memory.
//!
//! Two ranges are covered:
//!   - Block Elements `U+2580..=U+259F` (half blocks, eighth blocks, quadrants,
//!     shades) — fill rectangles with full alpha (or graded alpha for shades).
//!   - Box Drawing `U+2500..=U+257F` (lines, corners, T-pieces in light,
//!     heavy, double weights, plus half-stubs).
//!
//! Mixed-weight variants (┍ ┎ ...), curved corners (`╭ ╮ ╯ ╰`), dashed
//! variants and double-line corners are intentionally left to swash V1.5.

/// Returns a `cell_w * cell_h` byte buffer (R8 coverage) for `ch`, or `None`
/// if the character isn't one of the custom-rasterized glyphs.
pub fn rasterize(ch: char, cell_w: u32, cell_h: u32) -> Option<Vec<u8>> {
    let cp = ch as u32;
    if (0x2580..=0x259F).contains(&cp) {
        return rasterize_block(ch, cell_w, cell_h);
    }
    if (0x2500..=0x257F).contains(&cp) {
        return rasterize_box(ch, cell_w, cell_h);
    }
    if cp == 0x23F5 {
        return Some(rasterize_right_triangle(cell_w, cell_h));
    }
    // Claude Code spinner dingbats: cycle through ✻ / ✷ / ✶ depending on the
    // animation phase. Cascadia / Maple Mono NF either lack the glyph or ship
    // an empty slot, so we draw them ourselves to match WezTerm's output.
    match cp {
        0x273B => return Some(rasterize_n_pointed_star(cell_w, cell_h, 8)),
        0x2737 => return Some(rasterize_n_pointed_star(cell_w, cell_h, 8)),
        0x2736 => return Some(rasterize_n_pointed_star(cell_w, cell_h, 6)),
        _ => {}
    }
    // Geometric Squares — Claude Code uses these for todo-list checkboxes
    // (■ in_progress, □/☐/⬜ pending). Falling back to the system font often
    // renders a full block █, so we draw them ourselves at WezTerm proportions.
    match cp {
        // Filled squares (medium / large / small).
        0x25A0 | 0x25FC => return Some(rasterize_filled_square(cell_w, cell_h, 0.70)),
        0x25FE => return Some(rasterize_filled_square(cell_w, cell_h, 0.55)),
        0x2B1B => return Some(rasterize_filled_square(cell_w, cell_h, 0.85)),
        // Hollow (outline) squares — same sizes as their filled counterparts.
        0x25A1 | 0x25FB | 0x2610 => {
            return Some(rasterize_hollow_square(cell_w, cell_h, 0.70))
        }
        0x25FD => return Some(rasterize_hollow_square(cell_w, cell_h, 0.55)),
        0x2B1C => return Some(rasterize_hollow_square(cell_w, cell_h, 0.85)),
        // Concentric: outline + small filled center (▣).
        0x25A3 => return Some(rasterize_concentric_square(cell_w, cell_h, 0.70, 0.35)),
        _ => {}
    }
    None
}

/// `⏵` BLACK MEDIUM RIGHT-POINTING TRIANGLE (U+23F5). Used by Claude Code as
/// the bypass-permissions mode prefix; absent from most monospace fonts
/// (incl. Cascadia Code, Maple Mono NF, Symbols Nerd Font) so we draw it
/// ourselves. Filled isosceles triangle with ~20% horizontal padding and
/// ~10% vertical padding.
fn rasterize_right_triangle(cell_w: u32, cell_h: u32) -> Vec<u8> {
    let mut buf = vec![0u8; (cell_w * cell_h) as usize];
    let x0 = (cell_w * 2) / 10;
    let x1 = (cell_w * 8 + 9) / 10;
    let y_top0 = (cell_h * 1) / 10;
    let y_bot0 = (cell_h * 9 + 9) / 10;
    let y_center = cell_h / 2;
    let dx = (x1.saturating_sub(x0)).max(1) as f32;
    let half_top = (y_center.saturating_sub(y_top0)) as f32;
    let half_bot = (y_bot0.saturating_sub(y_center)) as f32;
    for x in x0..x1 {
        let t = (x - x0) as f32 / dx;
        let above = (half_top * (1.0 - t)).round() as u32;
        let below = (half_bot * (1.0 - t)).round() as u32;
        let top = y_center.saturating_sub(above);
        let bot = (y_center + below).min(cell_h.saturating_sub(1));
        for y in top..=bot {
            let idx = (y * cell_w + x) as usize;
            if idx < buf.len() {
                buf[idx] = 0xFF;
            }
        }
    }
    buf
}

// ─── Block Elements (U+2580..=U+259F) ─────────────────────────────────────

fn rasterize_block(ch: char, cell_w: u32, cell_h: u32) -> Option<Vec<u8>> {
    let cp = ch as u32;
    let mut buf = vec![0u8; (cell_w * cell_h) as usize];
    let w = cell_w;
    let h = cell_h;

    let half_w = w / 2;
    let half_h = h / 2;
    let eighth_h = |n: u32| (h * n) / 8;
    let eighth_w = |n: u32| (w * n) / 8;

    match cp {
        0x2580 => fill(&mut buf, w, 0, 0, w, half_h, 0xFF),
        0x2584 => fill(&mut buf, w, 0, half_h, w, h, 0xFF),
        0x258C => fill(&mut buf, w, 0, 0, half_w, h, 0xFF),
        0x2590 => fill(&mut buf, w, half_w, 0, w, h, 0xFF),

        0x2581 => fill(&mut buf, w, 0, eighth_h(7), w, h, 0xFF),
        0x2582 => fill(&mut buf, w, 0, eighth_h(6), w, h, 0xFF),
        0x2583 => fill(&mut buf, w, 0, eighth_h(5), w, h, 0xFF),
        0x2585 => fill(&mut buf, w, 0, eighth_h(3), w, h, 0xFF),
        0x2586 => fill(&mut buf, w, 0, eighth_h(2), w, h, 0xFF),
        0x2587 => fill(&mut buf, w, 0, eighth_h(1), w, h, 0xFF),

        0x2588 => fill(&mut buf, w, 0, 0, w, h, 0xFF),

        0x2589 => fill(&mut buf, w, 0, 0, eighth_w(7), h, 0xFF),
        0x258A => fill(&mut buf, w, 0, 0, eighth_w(6), h, 0xFF),
        0x258B => fill(&mut buf, w, 0, 0, eighth_w(5), h, 0xFF),
        0x258D => fill(&mut buf, w, 0, 0, eighth_w(3), h, 0xFF),
        0x258E => fill(&mut buf, w, 0, 0, eighth_w(2), h, 0xFF),
        0x258F => fill(&mut buf, w, 0, 0, eighth_w(1), h, 0xFF),

        0x2591 => fill(&mut buf, w, 0, 0, w, h, 0x40),
        0x2592 => fill(&mut buf, w, 0, 0, w, h, 0x80),
        0x2593 => fill(&mut buf, w, 0, 0, w, h, 0xC0),

        0x2594 => fill(&mut buf, w, 0, 0, w, eighth_h(1), 0xFF),
        0x2595 => fill(&mut buf, w, eighth_w(7), 0, w, h, 0xFF),

        0x2596 => fill(&mut buf, w, 0, half_h, half_w, h, 0xFF),
        0x2597 => fill(&mut buf, w, half_w, half_h, w, h, 0xFF),
        0x2598 => fill(&mut buf, w, 0, 0, half_w, half_h, 0xFF),
        0x2599 => {
            fill(&mut buf, w, 0, 0, half_w, half_h, 0xFF);
            fill(&mut buf, w, 0, half_h, w, h, 0xFF);
        }
        0x259A => {
            fill(&mut buf, w, 0, 0, half_w, half_h, 0xFF);
            fill(&mut buf, w, half_w, half_h, w, h, 0xFF);
        }
        0x259B => {
            fill(&mut buf, w, 0, 0, w, half_h, 0xFF);
            fill(&mut buf, w, 0, half_h, half_w, h, 0xFF);
        }
        0x259C => {
            fill(&mut buf, w, 0, 0, w, half_h, 0xFF);
            fill(&mut buf, w, half_w, half_h, w, h, 0xFF);
        }
        0x259D => fill(&mut buf, w, half_w, 0, w, half_h, 0xFF),
        0x259E => {
            fill(&mut buf, w, half_w, 0, w, half_h, 0xFF);
            fill(&mut buf, w, 0, half_h, half_w, h, 0xFF);
        }
        0x259F => {
            fill(&mut buf, w, half_w, 0, w, half_h, 0xFF);
            fill(&mut buf, w, 0, half_h, w, h, 0xFF);
        }
        _ => return None,
    }

    Some(buf)
}

// ─── Box Drawing (U+2500..=U+257F) ─────────────────────────────────────────
//
// Coordinate convention: cx, cy = pixel center of the cell. Lines are
// thickness `light` (≈ 1 px) or `heavy` (≈ 2 px). Corners and T-pieces
// extend half a thickness past the center so the strokes meet cleanly.

fn rasterize_box(ch: char, cell_w: u32, cell_h: u32) -> Option<Vec<u8>> {
    let cp = ch as u32;
    let mut buf = vec![0u8; (cell_w * cell_h) as usize];
    let w = cell_w;
    let h = cell_h;
    let cx = w / 2;
    let cy = h / 2;
    let light = (h / 14).max(1);
    let heavy = (h / 7).max(2);
    // Double-line geometry: two parallel light lines with a gap between them.
    let dbl = light;
    let dbl_gap = (light + 1).max(2);

    match cp {
        // Single weight horizontal / vertical
        0x2500 => h_line(&mut buf, w, h, 0, w, cy, light),
        0x2501 => h_line(&mut buf, w, h, 0, w, cy, heavy),
        0x2502 => v_line(&mut buf, w, h, cx, 0, h, light),
        0x2503 => v_line(&mut buf, w, h, cx, 0, h, heavy),

        // Light corners
        0x250C => {
            v_line(&mut buf, w, h, cx, cy, h, light);
            h_line(&mut buf, w, h, cx, w, cy, light);
        }
        0x2510 => {
            v_line(&mut buf, w, h, cx, cy, h, light);
            h_line(&mut buf, w, h, 0, cx + (light + 1) / 2, cy, light);
        }
        0x2514 => {
            v_line(&mut buf, w, h, cx, 0, cy + (light + 1) / 2, light);
            h_line(&mut buf, w, h, cx, w, cy, light);
        }
        0x2518 => {
            v_line(&mut buf, w, h, cx, 0, cy + (light + 1) / 2, light);
            h_line(&mut buf, w, h, 0, cx + (light + 1) / 2, cy, light);
        }
        // Heavy corners
        0x250F => {
            v_line(&mut buf, w, h, cx, cy, h, heavy);
            h_line(&mut buf, w, h, cx, w, cy, heavy);
        }
        0x2513 => {
            v_line(&mut buf, w, h, cx, cy, h, heavy);
            h_line(&mut buf, w, h, 0, cx + (heavy + 1) / 2, cy, heavy);
        }
        0x2517 => {
            v_line(&mut buf, w, h, cx, 0, cy + (heavy + 1) / 2, heavy);
            h_line(&mut buf, w, h, cx, w, cy, heavy);
        }
        0x251B => {
            v_line(&mut buf, w, h, cx, 0, cy + (heavy + 1) / 2, heavy);
            h_line(&mut buf, w, h, 0, cx + (heavy + 1) / 2, cy, heavy);
        }

        // Light T-pieces / cross
        0x251C => {
            v_line(&mut buf, w, h, cx, 0, h, light);
            h_line(&mut buf, w, h, cx, w, cy, light);
        }
        0x2524 => {
            v_line(&mut buf, w, h, cx, 0, h, light);
            h_line(&mut buf, w, h, 0, cx + (light + 1) / 2, cy, light);
        }
        0x252C => {
            h_line(&mut buf, w, h, 0, w, cy, light);
            v_line(&mut buf, w, h, cx, cy, h, light);
        }
        0x2534 => {
            h_line(&mut buf, w, h, 0, w, cy, light);
            v_line(&mut buf, w, h, cx, 0, cy + (light + 1) / 2, light);
        }
        0x253C => {
            h_line(&mut buf, w, h, 0, w, cy, light);
            v_line(&mut buf, w, h, cx, 0, h, light);
        }

        // Heavy T-pieces / cross
        0x2523 => {
            v_line(&mut buf, w, h, cx, 0, h, heavy);
            h_line(&mut buf, w, h, cx, w, cy, heavy);
        }
        0x252B => {
            v_line(&mut buf, w, h, cx, 0, h, heavy);
            h_line(&mut buf, w, h, 0, cx + (heavy + 1) / 2, cy, heavy);
        }
        0x2533 => {
            h_line(&mut buf, w, h, 0, w, cy, heavy);
            v_line(&mut buf, w, h, cx, cy, h, heavy);
        }
        0x253B => {
            h_line(&mut buf, w, h, 0, w, cy, heavy);
            v_line(&mut buf, w, h, cx, 0, cy + (heavy + 1) / 2, heavy);
        }
        0x254B => {
            h_line(&mut buf, w, h, 0, w, cy, heavy);
            v_line(&mut buf, w, h, cx, 0, h, heavy);
        }

        // Half-stubs (single weight)
        0x2574 => h_line(&mut buf, w, h, 0, cx + (light + 1) / 2, cy, light),
        0x2575 => v_line(&mut buf, w, h, cx, 0, cy + (light + 1) / 2, light),
        0x2576 => h_line(&mut buf, w, h, cx, w, cy, light),
        0x2577 => v_line(&mut buf, w, h, cx, cy, h, light),
        0x2578 => h_line(&mut buf, w, h, 0, cx + (heavy + 1) / 2, cy, heavy),
        0x2579 => v_line(&mut buf, w, h, cx, 0, cy + (heavy + 1) / 2, heavy),
        0x257A => h_line(&mut buf, w, h, cx, w, cy, heavy),
        0x257B => v_line(&mut buf, w, h, cx, cy, h, heavy),

        // Double horizontal / vertical (2 parallel light lines)
        0x2550 => {
            let off = dbl_gap / 2 + dbl / 2;
            h_line(&mut buf, w, h, 0, w, cy.saturating_sub(off), dbl);
            h_line(&mut buf, w, h, 0, w, cy + off, dbl);
        }
        0x2551 => {
            let off = dbl_gap / 2 + dbl / 2;
            v_line(&mut buf, w, h, cx.saturating_sub(off), 0, h, dbl);
            v_line(&mut buf, w, h, cx + off, 0, h, dbl);
        }

        // Double corners ╔ ╗ ╚ ╝
        0x2554 => {
            let off = dbl_gap / 2 + dbl / 2;
            h_line(&mut buf, w, h, cx.saturating_sub(off), w, cy.saturating_sub(off), dbl);
            h_line(&mut buf, w, h, cx + off, w, cy + off, dbl);
            v_line(&mut buf, w, h, cx.saturating_sub(off), cy.saturating_sub(off), h, dbl);
            v_line(&mut buf, w, h, cx + off, cy + off, h, dbl);
        }
        0x2557 => {
            let off = dbl_gap / 2 + dbl / 2;
            h_line(&mut buf, w, h, 0, cx + off + 1, cy.saturating_sub(off), dbl);
            h_line(&mut buf, w, h, 0, cx.saturating_sub(off) + 1, cy + off, dbl);
            v_line(&mut buf, w, h, cx + off, cy.saturating_sub(off), h, dbl);
            v_line(&mut buf, w, h, cx.saturating_sub(off), cy + off, h, dbl);
        }
        0x255A => {
            let off = dbl_gap / 2 + dbl / 2;
            h_line(&mut buf, w, h, cx.saturating_sub(off), w, cy + off, dbl);
            h_line(&mut buf, w, h, cx + off, w, cy.saturating_sub(off), dbl);
            v_line(&mut buf, w, h, cx.saturating_sub(off), 0, cy + off + 1, dbl);
            v_line(&mut buf, w, h, cx + off, 0, cy.saturating_sub(off) + 1, dbl);
        }
        0x255D => {
            let off = dbl_gap / 2 + dbl / 2;
            h_line(&mut buf, w, h, 0, cx + off + 1, cy + off, dbl);
            h_line(
                &mut buf,
                w,
                h,
                0,
                cx.saturating_sub(off) + 1,
                cy.saturating_sub(off),
                dbl,
            );
            v_line(&mut buf, w, h, cx + off, 0, cy + off + 1, dbl);
            v_line(
                &mut buf,
                w,
                h,
                cx.saturating_sub(off),
                0,
                cy.saturating_sub(off) + 1,
                dbl,
            );
        }

        // Curved corners ╭ ╮ ╯ ╰. Radius scales with cell height.
        0x256D => {
            let r = (light * 2).max(2);
            h_line(&mut buf, w, h, cx + r, w, cy, light);
            v_line(&mut buf, w, h, cx, cy + r, h, light);
            arc(&mut buf, w, h, cx + r, cy + r, r, light, -1, -1);
        }
        0x256E => {
            let r = (light * 2).max(2);
            let lim = cx.saturating_sub(r);
            h_line(&mut buf, w, h, 0, lim + 1, cy, light);
            v_line(&mut buf, w, h, cx, cy + r, h, light);
            arc(&mut buf, w, h, lim, cy + r, r, light, 1, -1);
        }
        0x256F => {
            let r = (light * 2).max(2);
            let lim_x = cx.saturating_sub(r);
            let lim_y = cy.saturating_sub(r);
            h_line(&mut buf, w, h, 0, lim_x + 1, cy, light);
            v_line(&mut buf, w, h, cx, 0, lim_y + 1, light);
            arc(&mut buf, w, h, lim_x, lim_y, r, light, 1, 1);
        }
        0x2570 => {
            let r = (light * 2).max(2);
            let lim_y = cy.saturating_sub(r);
            h_line(&mut buf, w, h, cx + r, w, cy, light);
            v_line(&mut buf, w, h, cx, 0, lim_y + 1, light);
            arc(&mut buf, w, h, cx + r, lim_y, r, light, -1, 1);
        }

        _ => return None,
    }

    Some(buf)
}

// ─── Helpers ───────────────────────────────────────────────────────────────

fn fill(buf: &mut [u8], stride: u32, x0: u32, y0: u32, x1: u32, y1: u32, alpha: u8) {
    let x1 = x1.min(stride);
    for y in y0..y1 {
        let row_off = (y * stride) as usize;
        for x in x0..x1 {
            buf[row_off + x as usize] = alpha;
        }
    }
}

/// Draws a horizontal line `thick` pixels tall, centered on `y_center`,
/// from `x0..x1`. Clamped to the buffer extent.
fn h_line(buf: &mut [u8], w: u32, h: u32, x0: u32, x1: u32, y_center: u32, thick: u32) {
    let half_below = thick / 2;
    let half_above = thick - half_below;
    let y0 = y_center.saturating_sub(half_below);
    let y1 = (y_center + half_above).min(h);
    fill(buf, w, x0, y0, x1, y1, 0xFF);
}

/// Draws a vertical line `thick` pixels wide, centered on `x_center`,
/// from `y0..y1`.
fn v_line(buf: &mut [u8], w: u32, h: u32, x_center: u32, y0: u32, y1: u32, thick: u32) {
    let half_right = thick / 2;
    let half_left = thick - half_right;
    let x0 = x_center.saturating_sub(half_left);
    let x1 = (x_center + half_right).min(w);
    fill(buf, w, x0, y0, x1, y1.min(h), 0xFF);
}

/// N-pointed star centered in the cell. `branches` must be even (we draw
/// `branches / 2` segments through the center, each contributing two opposite
/// points). The first segment is horizontal so 8 → ✻ (HV + diagonals),
/// 6 → ✶ (H + 2 diagonals at ±60°). Anti-aliased by perpendicular distance.
fn rasterize_n_pointed_star(cell_w: u32, cell_h: u32, branches: u32) -> Vec<u8> {
    let mut buf = vec![0u8; (cell_w * cell_h) as usize];
    let cx = cell_w as f32 / 2.0;
    let cy = cell_h as f32 / 2.0;
    let radius = (cell_w.min(cell_h) as f32) * 0.42;
    let half_thick = (cell_h as f32 / 18.0).max(0.7);
    let segments = (branches.max(2) / 2) as usize;

    for yi in 0..cell_h {
        for xi in 0..cell_w {
            let px = xi as f32 + 0.5 - cx;
            let py = yi as f32 + 0.5 - cy;
            let pr = (px * px + py * py).sqrt();
            if pr > radius + half_thick {
                continue;
            }
            // Distance to the nearest segment through the center.
            let mut min_perp = f32::INFINITY;
            for k in 0..segments {
                let theta = std::f32::consts::PI * (k as f32) / (segments as f32);
                let (sin_t, cos_t) = (theta.sin(), theta.cos());
                // perp distance from (px,py) to the line dir=(cos,sin).
                let perp = (px * sin_t - py * cos_t).abs();
                if perp < min_perp {
                    min_perp = perp;
                }
            }
            if min_perp > half_thick {
                continue;
            }
            // Soft cutoff at the radius so the tips fade smoothly.
            let radial_atten = if pr <= radius {
                1.0
            } else {
                (1.0 - (pr - radius) / half_thick).clamp(0.0, 1.0)
            };
            let alpha_f = (1.0 - min_perp / half_thick).clamp(0.0, 1.0) * radial_atten;
            let alpha = (alpha_f * 255.0).round() as u8;
            let idx = (yi * cell_w + xi) as usize;
            if buf[idx] < alpha {
                buf[idx] = alpha;
            }
        }
    }
    buf
}

/// Filled square centered in the cell. `fill_ratio` is the side length as a
/// fraction of `min(cell_w, cell_h)` — e.g. 0.70 for medium, 0.85 for large,
/// 0.55 for small. Gives a clean, crisp solid square at any cell size.
fn rasterize_filled_square(cell_w: u32, cell_h: u32, fill_ratio: f32) -> Vec<u8> {
    let mut buf = vec![0u8; (cell_w * cell_h) as usize];
    let side = (cell_h.min(cell_w) as f32 * fill_ratio).round() as u32;
    if side == 0 {
        return buf;
    }
    let x0 = cell_w.saturating_sub(side) / 2;
    let y0 = cell_h.saturating_sub(side) / 2;
    let x1 = (x0 + side).min(cell_w);
    let y1 = (y0 + side).min(cell_h);
    fill(&mut buf, cell_w, x0, y0, x1, y1, 0xFF);
    buf
}

/// Outline square centered in the cell. Stroke thickness scales with cell
/// height (1 px at h=14, 2 px above) so the box reads cleanly across DPRs.
fn rasterize_hollow_square(cell_w: u32, cell_h: u32, fill_ratio: f32) -> Vec<u8> {
    let mut buf = vec![0u8; (cell_w * cell_h) as usize];
    let side = (cell_h.min(cell_w) as f32 * fill_ratio).round() as u32;
    if side < 2 {
        return buf;
    }
    let stroke = ((cell_h as f32) / 14.0).max(1.0).round() as u32;
    let x0 = cell_w.saturating_sub(side) / 2;
    let y0 = cell_h.saturating_sub(side) / 2;
    let x1 = (x0 + side).min(cell_w);
    let y1 = (y0 + side).min(cell_h);
    // Top + bottom edges
    fill(&mut buf, cell_w, x0, y0, x1, (y0 + stroke).min(y1), 0xFF);
    fill(&mut buf, cell_w, x0, y1.saturating_sub(stroke), x1, y1, 0xFF);
    // Left + right edges
    fill(&mut buf, cell_w, x0, y0, (x0 + stroke).min(x1), y1, 0xFF);
    fill(&mut buf, cell_w, x1.saturating_sub(stroke), y0, x1, y1, 0xFF);
    buf
}

/// Outline square + smaller filled square at the center (▣).
fn rasterize_concentric_square(
    cell_w: u32,
    cell_h: u32,
    outer: f32,
    inner: f32,
) -> Vec<u8> {
    let mut buf = rasterize_hollow_square(cell_w, cell_h, outer);
    let inner_side = (cell_h.min(cell_w) as f32 * inner).round() as u32;
    if inner_side == 0 {
        return buf;
    }
    let x0 = cell_w.saturating_sub(inner_side) / 2;
    let y0 = cell_h.saturating_sub(inner_side) / 2;
    let x1 = (x0 + inner_side).min(cell_w);
    let y1 = (y0 + inner_side).min(cell_h);
    fill(&mut buf, cell_w, x0, y0, x1, y1, 0xFF);
    buf
}

/// Quarter-circle arc, `thick`-px stroke, in the quadrant indicated by
/// `(qx, qy)` relative to `(cx, cy)`. `qx`/`qy` ∈ {-1, +1}: -1 keeps only
/// pixels with dx <= 0 (resp. dy <= 0), +1 keeps dx >= 0.
fn arc(buf: &mut [u8], w: u32, h: u32, cx: u32, cy: u32, radius: u32, thick: u32, qx: i32, qy: i32) {
    let half = (thick + 1) / 2;
    let r_inner = radius.saturating_sub(half) as i32;
    let r_outer = (radius + thick / 2) as i32;
    let r_inner_sq = r_inner * r_inner;
    let r_outer_sq = r_outer * r_outer;
    for y in 0..h {
        for x in 0..w {
            let dx = x as i32 - cx as i32;
            let dy = y as i32 - cy as i32;
            if qx > 0 && dx < 0 {
                continue;
            }
            if qx < 0 && dx > 0 {
                continue;
            }
            if qy > 0 && dy < 0 {
                continue;
            }
            if qy < 0 && dy > 0 {
                continue;
            }
            let d_sq = dx * dx + dy * dy;
            if d_sq >= r_inner_sq && d_sq <= r_outer_sq {
                buf[(y * w + x) as usize] = 0xFF;
            }
        }
    }
}
