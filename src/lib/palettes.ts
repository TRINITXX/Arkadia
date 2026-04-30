import type {
  CellColor,
  CustomPalette,
  PaletteId,
  TerminalPalette,
} from "@/types";

export const PALETTE_WEZ: TerminalPalette = {
  id: "wez",
  name: "Wez (default)",
  bg: "#0a0a0a",
  fg: "#fafafa",
  ansi: [
    "#0a0a0a", // 0  black
    "#e5534b", // 1  red
    "#84c452", // 2  green
    "#eeae4c", // 3  yellow
    "#4f9dff", // 4  blue
    "#c671ff", // 5  magenta
    "#4ed1c7", // 6  cyan
    "#d0d0d0", // 7  white
    "#555555", // 8  bright black
    "#ff6b68", // 9  bright red
    "#a6e26f", // 10 bright green
    "#ffc766", // 11 bright yellow
    "#71b1ff", // 12 bright blue
    "#d696ff", // 13 bright magenta
    "#6ce5db", // 14 bright cyan
    "#fafafa", // 15 bright white
  ],
};

export const PALETTE_WEZTERM: TerminalPalette = {
  id: "wezterm",
  name: "WezTerm",
  bg: "#181a1d",
  fg: "#fafafa",
  ansi: [
    "#000000", // 0  black
    "#cc5555", // 1  red
    "#55cc55", // 2  green
    "#cdcd00", // 3  yellow
    "#5555cc", // 4  blue
    "#cc55cc", // 5  magenta
    "#7acaca", // 6  cyan
    "#cccccc", // 7  white
    "#555555", // 8  bright black
    "#ff5555", // 9  bright red
    "#55ff55", // 10 bright green
    "#ffff55", // 11 bright yellow
    "#5555ff", // 12 bright blue
    "#ff55ff", // 13 bright magenta
    "#55ffff", // 14 bright cyan
    "#ffffff", // 15 bright white
  ],
};

export const PALETTE_DRACULA: TerminalPalette = {
  id: "dracula",
  name: "Dracula",
  bg: "#282a36",
  fg: "#f8f8f2",
  ansi: [
    "#21222c",
    "#ff5555",
    "#50fa7b",
    "#f1fa8c",
    "#bd93f9",
    "#ff79c6",
    "#8be9fd",
    "#f8f8f2",
    "#6272a4",
    "#ff6e6e",
    "#69ff94",
    "#ffffa5",
    "#d6acff",
    "#ff92df",
    "#a4ffff",
    "#ffffff",
  ],
};

export const PALETTE_SOLARIZED_DARK: TerminalPalette = {
  id: "solarized-dark",
  name: "Solarized Dark",
  bg: "#002b36",
  fg: "#839496",
  ansi: [
    "#073642",
    "#dc322f",
    "#859900",
    "#b58900",
    "#268bd2",
    "#d33682",
    "#2aa198",
    "#eee8d5",
    "#586e75",
    "#cb4b16",
    "#859900",
    "#657b83",
    "#839496",
    "#6c71c4",
    "#93a1a1",
    "#fdf6e3",
  ],
};

export const PALETTE_TOKYO_NIGHT: TerminalPalette = {
  id: "tokyo-night",
  name: "Tokyo Night",
  bg: "#1a1b26",
  fg: "#c0caf5",
  ansi: [
    "#15161e",
    "#f7768e",
    "#9ece6a",
    "#e0af68",
    "#7aa2f7",
    "#bb9af7",
    "#7dcfff",
    "#a9b1d6",
    "#414868",
    "#f7768e",
    "#9ece6a",
    "#e0af68",
    "#7aa2f7",
    "#bb9af7",
    "#7dcfff",
    "#c0caf5",
  ],
};

/**
 * Seed values for the custom palette. The user can override every entry from
 * the Settings dialog; until they do, these defaults match the Wez preset.
 */
export const DEFAULT_CUSTOM_PALETTE: CustomPalette = {
  bg: PALETTE_WEZ.bg,
  fg: PALETTE_WEZ.fg,
  ansi: [...PALETTE_WEZ.ansi],
};

export const PALETTES: TerminalPalette[] = [
  PALETTE_WEZ,
  PALETTE_WEZTERM,
  PALETTE_DRACULA,
  PALETTE_SOLARIZED_DARK,
  PALETTE_TOKYO_NIGHT,
];

const PALETTE_BY_ID: Record<Exclude<PaletteId, "custom">, TerminalPalette> = {
  wez: PALETTE_WEZ,
  wezterm: PALETTE_WEZTERM,
  dracula: PALETTE_DRACULA,
  "solarized-dark": PALETTE_SOLARIZED_DARK,
  "tokyo-night": PALETTE_TOKYO_NIGHT,
};

/**
 * Materializes the user's custom palette into a regular `TerminalPalette`.
 */
export function customAsPalette(custom: CustomPalette): TerminalPalette {
  return {
    id: "custom",
    name: "Custom",
    bg: custom.bg,
    fg: custom.fg,
    ansi: custom.ansi,
  };
}

/**
 * Returns the palette currently in effect. When `id === "custom"` the
 * `customPalette` value is used; otherwise the matching preset is returned.
 */
export function resolveActivePalette(
  id: PaletteId,
  customPalette: CustomPalette,
): TerminalPalette {
  if (id === "custom") return customAsPalette(customPalette);
  return PALETTE_BY_ID[id] ?? PALETTE_WEZ;
}

/** Backwards-compatible getter — always falls back on Wez for `custom`. */
export function getPalette(id: PaletteId): TerminalPalette {
  if (id === "custom") return PALETTE_WEZ;
  return PALETTE_BY_ID[id] ?? PALETTE_WEZ;
}

/** Resolves a CellColor to a hex string using the active palette. */
export function resolveColor(
  color: CellColor,
  palette: TerminalPalette,
  role: "fg" | "bg",
): string {
  if (color.kind === "default") {
    return role === "fg" ? palette.fg : palette.bg;
  }
  if (color.kind === "ansi") {
    return palette.ansi[color.idx] ?? (role === "fg" ? palette.fg : palette.bg);
  }
  return color.value;
}
