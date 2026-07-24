import { DEFAULT_BACKGROUND_ID, type BackgroundId } from "@/types";

/**
 * A selectable app-background preset. `css` is a full CSS `background`
 * shorthand — a radial "halo" layered over a dark linear gradient — applied to
 * the root chrome container. `glass` engages the frosted-glass treatment on the
 * chrome surfaces (see `[data-glass="on"]` in app.css); the plain "noir" preset
 * keeps the current opaque look.
 */
export interface Background {
  id: BackgroundId;
  name: string;
  css: string;
  glass: boolean;
}

const BG_NOIR: Background = {
  id: "noir",
  name: "Noir",
  css: "#0a0a0a",
  glass: false,
};

const BG_MIDNIGHT: Background = {
  id: "midnight",
  name: "Bleu nuit",
  css: "radial-gradient(130% 90% at 85% 0%, rgba(90,130,220,0.22), transparent 60%), linear-gradient(180deg, #1c2740 0%, #0d1220 100%)",
  glass: true,
};

const BG_SLATE: Background = {
  id: "slate",
  name: "Ardoise",
  css: "radial-gradient(130% 90% at 85% 0%, rgba(120,150,190,0.18), transparent 60%), linear-gradient(180deg, #263243 0%, #12161f 100%)",
  glass: true,
};

const BG_GRAPHITE: Background = {
  id: "graphite",
  name: "Graphite",
  css: "radial-gradient(130% 90% at 85% 0%, rgba(140,160,190,0.12), transparent 60%), linear-gradient(180deg, #232a35 0%, #101216 100%)",
  glass: true,
};

const BG_OCEAN: Background = {
  id: "ocean",
  name: "Océan",
  css: "radial-gradient(130% 90% at 85% 0%, rgba(60,170,190,0.20), transparent 60%), linear-gradient(180deg, #123642 0%, #08171c 100%)",
  glass: true,
};

const BG_VIOLET: Background = {
  id: "violet",
  name: "Violet nuit",
  css: "radial-gradient(130% 90% at 85% 0%, rgba(150,110,220,0.20), transparent 60%), linear-gradient(180deg, #2a2140 0%, #140f22 100%)",
  glass: true,
};

const BG_FOREST: Background = {
  id: "forest",
  name: "Forêt",
  css: "radial-gradient(130% 90% at 85% 0%, rgba(80,180,120,0.16), transparent 60%), linear-gradient(180deg, #1b3327 0%, #0c1712 100%)",
  glass: true,
};

const BG_BORDEAUX: Background = {
  id: "bordeaux",
  name: "Bordeaux",
  css: "radial-gradient(130% 90% at 85% 0%, rgba(210,90,120,0.16), transparent 60%), linear-gradient(180deg, #331d26 0%, #1a0f14 100%)",
  glass: true,
};

/** All presets, in display order. "Noir" (the current look) is always first. */
export const BACKGROUNDS: Background[] = [
  BG_NOIR,
  BG_MIDNIGHT,
  BG_SLATE,
  BG_GRAPHITE,
  BG_OCEAN,
  BG_VIOLET,
  BG_FOREST,
  BG_BORDEAUX,
];

const BACKGROUND_BY_ID: Record<BackgroundId, Background> = {
  noir: BG_NOIR,
  midnight: BG_MIDNIGHT,
  slate: BG_SLATE,
  graphite: BG_GRAPHITE,
  ocean: BG_OCEAN,
  violet: BG_VIOLET,
  forest: BG_FOREST,
  bordeaux: BG_BORDEAUX,
};

/**
 * Tolerant resolver for a persisted background id: unknown / absent values fall
 * back to the default ("noir"), matching how `normalizePaletteId` behaves.
 */
export function resolveBackgroundId(raw: unknown): BackgroundId {
  if (typeof raw === "string" && raw in BACKGROUND_BY_ID) {
    return raw as BackgroundId;
  }
  return DEFAULT_BACKGROUND_ID;
}

/** Returns the preset for an id (already-narrowed; never fails). */
export function resolveBackground(id: BackgroundId): Background {
  return BACKGROUND_BY_ID[id] ?? BG_NOIR;
}
