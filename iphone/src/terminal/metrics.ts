import type { TextStyle } from "react-native";

/** Same size as the web page on a phone. */
export const FONT_SIZE = 12;
export const LINE_HEIGHT = Math.round(FONT_SIZE * 1.25);
/** Side padding of the grid, each side. */
export const PAD_X = 8;
/** Menlo ships with iOS; its cells are 0.602 em wide (measured at mount). */
export const FONT_FAMILY = "Menlo";

export const ROW_STYLE: TextStyle = {
  fontFamily: FONT_FAMILY,
  fontSize: FONT_SIZE,
  lineHeight: LINE_HEIGHT,
  height: LINE_HEIGHT,
};
