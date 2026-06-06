/**
 * External event bridge contracts.
 *
 * External event snapshots are broker inputs, not sensor envelopes. A sensor may
 * explicitly consume an external event and republish normalized sensor state,
 * but raw external snapshots remain separate.
 */

import type {
  ExternalStateClearEvent,
  ExternalStateKey,
  ExternalStateSetEvent,
  ExternalStateSnapshot,
} from "./types.ts";

export type {
  ExternalStateClearEvent,
  ExternalStateKey,
  ExternalStateSetEvent,
  ExternalStateSnapshot,
} from "./types.ts";

export const EXTERNAL_STATE_EVENT_TOPICS = {
  set: "dasein:state:set",
  clear: "dasein:state:clear",
} as const;

export const EXTERNAL_STATE_KEY_PATTERN = "[A-Za-z0-9_-]{1,64}" as const;
export const EXTERNAL_STATE_DEFAULT_TTL_MS = 60000 as const;
export const EXTERNAL_STATE_TTL_MS_CONSTRAINT = { integer: true, minimum: 1000, maximum: 86400000 } as const;
export const EXTERNAL_STATE_TEXT_MAX_CHARS = 120 as const;
export const EXTERNAL_STATE_SET_EVENT_KEYS = ["key", "agent", "ui", "ttlMs", "source"] as const;
export const EXTERNAL_STATE_CLEAR_EVENT_KEYS = ["key"] as const;

export interface ExternalEventBridgeContract {
  setTopic: typeof EXTERNAL_STATE_EVENT_TOPICS.set;
  clearTopic: typeof EXTERNAL_STATE_EVENT_TOPICS.clear;
  rawEventShape: ExternalStateSetEvent | ExternalStateClearEvent;
  storedShape: ExternalStateSnapshot;
  defaultVisibility: { ui: true; agent: false };
  unknownFieldsAccepted: false;
}
