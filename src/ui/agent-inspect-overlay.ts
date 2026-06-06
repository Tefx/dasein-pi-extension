import type { AgentInspectCommandData } from "../commands/dasein-command.ts";
import { formatAgentInspectCommandLines } from "../commands/dasein-command.ts";
import { daseinScrollableOverlayHint } from "./overlay-hints.ts";
import { renderDaseinOverlayFrame } from "./overlay-frame.ts";
import { matchesKey } from "./settings-import-contract.ts";

export interface AgentInspectOverlayComponentInput {
  readonly data: AgentInspectCommandData;
  readonly requestRender?: () => void;
  readonly done: (value: undefined) => void;
  readonly maxBodyLines?: number;
}

const DEFAULT_MAX_BODY_LINES = 18;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isCloseKey = (data: string): boolean =>
  matchesKey(data, "escape")
  || matchesKey(data, "esc")
  || matchesKey(data, "enter")
  || matchesKey(data, "return")
  || matchesKey(data, "ctrl+c")
  || data === "q"
  || data === "Q";

const isPageUpKey = (data: string): boolean => matchesKey(data, "pageUp") || matchesKey(data, "pageup");
const isPageDownKey = (data: string): boolean => matchesKey(data, "pageDown") || matchesKey(data, "pagedown");

export const createAgentInspectOverlayComponent = (input: AgentInspectOverlayComponentInput) => {
  const bodyLines = formatAgentInspectCommandLines(input.data);
  const maxBodyLines = Math.max(4, Math.floor(input.maxBodyLines ?? DEFAULT_MAX_BODY_LINES));
  let scrollOffset = 0;

  const maxOffset = (): number => Math.max(0, bodyLines.length - maxBodyLines);
  const setScrollOffset = (nextOffset: number): void => {
    const next = clamp(nextOffset, 0, maxOffset());
    if (next === scrollOffset) return;
    scrollOffset = next;
    input.requestRender?.();
  };
  const pageSize = (): number => Math.max(1, maxBodyLines - 2);

  return {
    render(width: number): string[] {
      const end = Math.min(bodyLines.length, scrollOffset + maxBodyLines);
      const visible = bodyLines.slice(scrollOffset, end);
      const scrollInfo = daseinScrollableOverlayHint({
        scrollable: bodyLines.length > maxBodyLines,
        start: scrollOffset + 1,
        end,
        total: bodyLines.length,
      });
      return renderDaseinOverlayFrame({
        title: "Dasein agent inspect",
        width,
        maxWidth: 110,
        lines: [
          "Exact systemPromptBlock appended to Pi's chained system prompt. renderedAgent remains only in structured result data.",
          scrollInfo,
          "",
          ...visible,
        ],
      });
    },
    invalidate(): void {
      input.requestRender?.();
    },
    handleInput(data: string): void {
      if (isCloseKey(data)) {
        input.done(undefined);
        return;
      }
      if (matchesKey(data, "up")) {
        setScrollOffset(scrollOffset - 1);
        return;
      }
      if (matchesKey(data, "down")) {
        setScrollOffset(scrollOffset + 1);
        return;
      }
      if (isPageUpKey(data)) {
        setScrollOffset(scrollOffset - pageSize());
        return;
      }
      if (isPageDownKey(data)) {
        setScrollOffset(scrollOffset + pageSize());
        return;
      }
      if (matchesKey(data, "home")) {
        setScrollOffset(0);
        return;
      }
      if (matchesKey(data, "end")) {
        setScrollOffset(maxOffset());
      }
    },
  };
};
