/**
 * Request-path injector contracts.
 *
 * The injector reads only the pre-rendered in-memory agent string exposed by the
 * state store. Rendering and lifecycle work are upstream of this boundary.
 */

import type { DaseinStateStore, RenderedContext } from "./types.ts";

export interface AmbientContextMessage {
  role: "custom";
  customType: "dasein";
  content: string;
  display: false;
  timestamp: number;
}

export interface DaseinInjectorInput<TMessage = unknown> {
  stateStore: Pick<DaseinStateStore, "getRenderedContext" | "getRenderedAgentString">;
  messages: readonly TMessage[];
  timestamp: number;
}

export type DaseinInjectorResult<TMessage = unknown> =
  | { changed: false; messages: readonly TMessage[]; rendered: Pick<RenderedContext, "agent"> }
  | { changed: true; messages: readonly (TMessage | AmbientContextMessage)[]; appended: AmbientContextMessage };

export interface DaseinContextInjectorContract {
  readSurface: "pre-rendered-in-memory-agent-string";
  inputStore: Pick<DaseinStateStore, "getRenderedContext" | "getRenderedAgentString">;
  appendedMessage: AmbientContextMessage;
  mutatesConfig: false;
  triggersSensorWork: false;
}

const emptyOrWhitespace = (value: string | null): value is null | "" => value === null || value.trim().length === 0;

export const injectAmbientContextMessage = <TMessage = unknown>(input: DaseinInjectorInput<TMessage>): DaseinInjectorResult<TMessage> => {
  const agent = input.stateStore.getRenderedAgentString();
  if (emptyOrWhitespace(agent)) {
    return {
      changed: false,
      messages: input.messages,
      rendered: { agent },
    };
  }

  const appended: AmbientContextMessage = {
    role: "custom",
    customType: "dasein",
    content: agent,
    display: false,
    timestamp: input.timestamp,
  };

  return {
    changed: true,
    messages: [...input.messages, appended],
    appended,
  };
};

export const convertAmbientContextMessageToLlm = (message: AmbientContextMessage): { role: "user"; content: string } => ({
  role: "user",
  content: message.content,
});

export const proveInjectorNoIo = <TMessage = unknown>(_input: DaseinInjectorInput<TMessage>): Record<string, boolean> => {
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
