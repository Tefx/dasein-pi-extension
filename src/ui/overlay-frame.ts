import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const ANSI_RESET = "\x1b[0m";
const ANSI_FG_RESET = "\x1b[39m";
const SURFACE_BG = "\x1b[48;5;235m";
const BORDER_FG = "\x1b[38;5;116m";
const SHADOW_FG = "\x1b[38;5;232m";

export interface DaseinOverlayFrameInput {
  readonly title: string;
  readonly lines: readonly string[];
  readonly width: number;
  readonly maxWidth?: number;
}

const safeLine = (value: string): string => value.normalize("NFC").replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "").replace(/[\u0000-\u001F\u007F]/gu, " ").trimEnd();

const truncateLine = (value: string, width: number, pad = false): string => truncateToWidth(value, Math.max(0, width), "", pad);

const wrapLine = (value: string, width: number): string[] => {
  const safe = safeLine(value);
  if (safe.length === 0) return [""];
  const wrapped = wrapTextWithAnsi(safe, Math.max(1, width));
  return (wrapped.length > 0 ? wrapped : [""]).map((line) => truncateLine(line, width));
};

const surface = (value: string): string => `${SURFACE_BG}${value}${ANSI_RESET}`;
const border = (value: string): string => `${BORDER_FG}${value}${ANSI_FG_RESET}`;
const shadow = (value: string): string => `${SHADOW_FG}${value}${ANSI_RESET}`;

const frameRow = (line: string, contentWidth: number, withShadow: boolean): string => {
  const row = `${border("│")} ${truncateLine(line, contentWidth, true)} ${border("│")}`;
  return `${surface(row)}${withShadow ? shadow("█") : ""}`;
};

const borderRow = (left: string, middle: string, right: string, withShadow: boolean): string => {
  const row = border(`${left}${middle}${right}`);
  return `${surface(row)}${withShadow ? shadow("█") : ""}`;
};

export const renderDaseinOverlayFrame = (input: DaseinOverlayFrameInput): string[] => {
  const renderWidth = Number.isFinite(input.width) ? Math.max(1, Math.floor(input.width)) : 80;
  const maxWidth = Math.max(24, Math.floor(input.maxWidth ?? 100));
  const withShadow = renderWidth >= 8;
  const boxWidth = Math.min(renderWidth - (withShadow ? 1 : 0), maxWidth);
  if (boxWidth < 4) return [truncateLine(input.title, renderWidth)];

  const contentWidth = boxWidth - 4;
  const topTitle = truncateLine(`─ ${input.title} `, boxWidth - 2);
  const topMiddle = `${topTitle}${"─".repeat(Math.max(0, boxWidth - 2 - visibleWidth(topTitle)))}`;
  const bodyLines = input.lines.flatMap((line) => wrapLine(line, contentWidth));
  const rows = [
    borderRow("╭", topMiddle, "╮", withShadow),
    ...bodyLines.map((line) => frameRow(line, contentWidth, withShadow)),
    borderRow("╰", "─".repeat(Math.max(0, boxWidth - 2)), "╯", withShadow),
  ];
  return withShadow ? [...rows, shadow("█".repeat(boxWidth))] : rows;
};
