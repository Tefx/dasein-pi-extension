const joinHints = (parts: readonly string[]): string => parts.join(" • ");

export const DASEIN_SETTINGS_OVERLAY_HINT = joinHints([
  "↑↓ navigate",
  "enter cycle",
  "/ search",
  "esc close",
]);

export const daseinScrollableOverlayHint = (input: {
  readonly scrollable: boolean;
  readonly start?: number;
  readonly end?: number;
  readonly total?: number;
}): string => {
  if (!input.scrollable) {
    return "Esc/q/Enter close";
  }
  const range = typeof input.start === "number" && typeof input.end === "number" && typeof input.total === "number"
    ? `${input.start}-${input.end}/${input.total}`
    : "";
  return joinHints([
    "↑↓ scroll",
    "PgUp/PgDn page",
    "Home/End jump",
    "Esc/q close",
    range,
  ].filter((part) => part.length > 0));
};
