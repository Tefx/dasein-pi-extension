import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { RenderedContext, StatusDetailLevel } from "../core/types.ts";

export const DASEIN_STATUS_BAR_DEFAULT_MAX_WIDTH = 48;
const STATUS_IDLE_MINUTES = 5;

const statusBarHiddenLabels = new Set([
  "accuracy_m",
  "address",
  "agent_idle",
  "epoch_ms",
  "formattedAddress",
  "iso",
  "lat",
  "lon",
  "manifest",
  "manifest_digest",
  "nearestTag",
  "permission",
  "previous_agent_end_at",
  "previous_human_input_at",
  "previous_run_ms",
  "time",
  "utc_offset_minutes",
]);

export interface StatusBarFormatInput {
  readonly statusDetail: StatusDetailLevel;
  readonly rendered: Pick<RenderedContext, "agent" | "status" | "omittedKeys" | "truncated">;
  readonly errorCount: number;
  readonly maxWidth?: number;
}

const isUsefulIdleValue = (value: string): boolean => {
  const match = /^(\d+)([smhd])$/u.exec(value.trim());
  if (match === null) return true;
  const amount = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2];
  if (unit === "s") return false;
  if (unit === "m") return amount >= STATUS_IDLE_MINUTES;
  return amount > 0;
};

const normalizeStatusPart = (rawPart: string): string | null => {
  if (/\s+\(agent hidden\)\s*$/u.test(rawPart)) return null;
  const part = rawPart.replace(/\s+/gu, " ").trim();
  if (part.length === 0) return null;
  const [label = "", ...rest] = part.split(" ");
  if (statusBarHiddenLabels.has(label)) return null;
  const value = rest.join(" ").trim();
  if ((label === "user_idle" || label === "agent_idle") && !isUsefulIdleValue(value)) return null;
  if (label === "user_idle") return `idle ${value}`;
  if (label === "loc") return value.length === 0 ? null : `loc ${value}`;
  if (label === "placemark") return null;
  return part;
};

const normalizedStatusParts = (value: string | null): string[] => {
  if (value === null) return [];
  return value
    .split(/\s*;\s*/u)
    .map(normalizeStatusPart)
    .filter((part): part is string => part !== null);
};

const fitStatus = (value: string, maxWidth: number): string => {
  const safeMax = Number.isInteger(maxWidth) && maxWidth >= 16 ? maxWidth : DASEIN_STATUS_BAR_DEFAULT_MAX_WIDTH;
  if (visibleWidth(value) <= safeMax) return value;
  return truncateToWidth(value, safeMax, "…");
};

const diagnosticParts = (input: StatusBarFormatInput): string[] => [
  ...(input.errorCount > 0 ? [`! degraded ${input.errorCount}`] : []),
  ...(input.rendered.truncated ? ["! agent truncated"] : []),
  ...(input.rendered.omittedKeys.length > 0 && input.statusDetail === "diagnostic" ? [`omitted ${input.rendered.omittedKeys.length}`] : []),
];

export const formatDaseinStatusBar = (input: StatusBarFormatInput): string | undefined => {
  const maxWidth = input.maxWidth ?? DASEIN_STATUS_BAR_DEFAULT_MAX_WIDTH;
  const details = normalizedStatusParts(input.rendered.status);
  const diagnostics = diagnosticParts(input);

  if (input.statusDetail === "quiet") {
    return diagnostics.length === 0 ? undefined : fitStatus(diagnostics.join(" · "), maxWidth);
  }

  if (input.statusDetail === "summary") {
    const parts = diagnostics.length > 0 ? [...diagnostics, ...details] : details;
    return parts.length === 0 ? undefined : fitStatus(parts.join(" · "), maxWidth);
  }

  const parts = [...diagnostics, ...details];
  return parts.length === 0 ? undefined : fitStatus(parts.join(" · "), maxWidth);
};
