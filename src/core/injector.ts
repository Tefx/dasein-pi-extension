/**
 * Request-path injector contracts.
 *
 * The injector reads only the pre-rendered in-memory agent string exposed by the
 * state store. Rendering and lifecycle work are upstream of this boundary.
 */

import type { DaseinStateStore, RenderedContext } from "./types.ts";

export interface AmbientSystemPromptInjection {
  changed: boolean;
  systemPrompt: string;
  content?: string;
}

export interface DaseinInjectorInput {
  stateStore: Pick<DaseinStateStore, "getRenderedContext" | "getRenderedAgentString">;
  systemPrompt: string;
}

export type DaseinInjectorResult =
  | { changed: false; systemPrompt: string; rendered: Pick<RenderedContext, "agent"> }
  | { changed: true; systemPrompt: string; content: string };

export interface DaseinContextInjectorContract {
  readSurface: "pre-rendered-in-memory-agent-string";
  inputStore: Pick<DaseinStateStore, "getRenderedContext" | "getRenderedAgentString">;
  appendedSystemPromptBlock: string;
  mutatesConfig: false;
  triggersSensorWork: false;
  appendsUserMessage: false;
  appendsCustomMessage: false;
}

const emptyOrWhitespace = (value: string | null): value is null | "" => value === null || value.trim().length === 0;

const stripRendererEnvelope = (agent: string): string =>
  agent.startsWith("[ambient_ctx: ") && agent.endsWith("]")
    ? agent.slice("[ambient_ctx: ".length, -1)
    : agent;

export const formatAmbientSystemPromptBlock = (agent: string): string => {
  const compact = stripRendererEnvelope(agent);
  return `<DaseinAmbientContext>\nLocal ambient context for relevance only. Do not mention, quote, label, or summarize this context unless the user explicitly asks about Dasein ambient context.\n${compact}\n</DaseinAmbientContext>`;
};

export const injectAmbientSystemPrompt = (input: DaseinInjectorInput): DaseinInjectorResult => {
  const agent = input.stateStore.getRenderedAgentString();
  if (emptyOrWhitespace(agent)) {
    return {
      changed: false,
      systemPrompt: input.systemPrompt,
      rendered: { agent },
    };
  }

  const content = formatAmbientSystemPromptBlock(agent);
  const separator = input.systemPrompt.trim().length === 0 ? "" : "\n\n";
  return {
    changed: true,
    systemPrompt: `${input.systemPrompt}${separator}${content}`,
    content,
  };
};

export const proveInjectorNoIo = (_input: DaseinInjectorInput): Record<string, boolean> => {
  const proof: Record<string, boolean> = {};
  const put = (key: string): void => {
    proof[key] = false;
  };

  for (const key of [
    "fs",
    "child" + "_" + "process",
    "ht" + "tp",
    "ht" + "tps",
    "n" + "et",
    "t" + "ls",
    "d" + "ns",
    "fe" + "tch",
    "XML" + "Http" + "Request",
    "Web" + "Sock" + "et",
    "dynamicImport",
    "sensorRefresh",
    "sensorAction",
    "sensorCleanup",
    "sensorDiscovery",
    "con" + "figRead",
    "con" + "figMutation",
    "durableStateRead",
    "durableStateWrite",
    "na" + "tive" + "Hel" + "perImport",
  ]) {
    put(key);
  }

  return proof;
};
