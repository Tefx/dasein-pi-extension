/**
 * Request-path injector contracts.
 *
 * The injector reads only the pre-rendered in-memory agent string exposed by the
 * state store. Configuration decisions, rendering, refresh, and lifecycle work
 * are upstream of this boundary.
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
