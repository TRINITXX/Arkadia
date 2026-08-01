const UNITS = ["o", "Ko", "Mo", "Go", "To"] as const;

/**
 * A file size for a one-line list row: short enough not to crowd the name, but
 * precise enough to tell a 40 KB CSV from a 5 GB ISO.
 *
 * One decimal below 10 of a unit, none above — "5,1 Go" reads better than
 * "5,06 Go", and "266 Mo" better than "266,4 Mo".
 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} o`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value < 10 ? value.toFixed(1).replace(".", ",") : Math.round(value);
  return `${rounded} ${UNITS[unit]}`;
}
