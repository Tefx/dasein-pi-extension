/**
 * External event bridge contracts.
 *
 * External event snapshots are broker inputs, not sensor envelopes. A sensor may
 * explicitly consume an external event and republish normalized sensor state,
 * but raw external snapshots remain separate.
 */

import type {
  ExternalStateClearEvent,
  ExternalStateConfig,
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

export interface ExternalStateValidationError {
  field: string;
  message: string;
}

export type ExternalStateSetResult =
  | { ok: true; snapshot: ExternalStateSnapshot; config?: ExternalStateConfig }
  | { ok: false; errors: readonly ExternalStateValidationError[] };

export type ExternalStateClearResult =
  | { ok: true; clearedKey: ExternalStateKey }
  | { ok: false; errors: readonly ExternalStateValidationError[] };

export interface ExternalStateBridgeOptions {
  now: () => number;
  external?: Readonly<Record<ExternalStateKey, Partial<ExternalStateConfig> | undefined>>;
}

export interface ExternalStateBridge {
  set(event: unknown): ExternalStateSetResult;
  clear(event: unknown): ExternalStateClearResult;
  getExternalState(key: ExternalStateKey): ExternalStateSnapshot | null;
  listExternalStates(): ExternalStateSnapshot[];
}

const keyPattern = /^[A-Za-z0-9_-]{1,64}$/u;
const asciiControlOrLineSeparator = /[\u0000-\u001F\u007F\u2028\u2029]/u;

const ownKeys = (value: Record<string, unknown>): string[] => Object.keys(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unexpectedKeys = (value: Record<string, unknown>, allowed: readonly string[]): string[] => {
  const allowedSet = new Set<string>(allowed);
  return ownKeys(value).filter((key) => !allowedSet.has(key));
};

const validateKey = (value: unknown): value is ExternalStateKey => typeof value === "string" && keyPattern.test(value);

const validateSingleLineText = (field: string, value: unknown, errors: ExternalStateValidationError[]): value is string => {
  if (typeof value !== "string") {
    errors.push({ field, message: `${field} must be a string` });
    return false;
  }
  if (value.length > EXTERNAL_STATE_TEXT_MAX_CHARS) {
    errors.push({ field, message: `${field} is overlong; maximum length is ${EXTERNAL_STATE_TEXT_MAX_CHARS}` });
    return false;
  }
  if (asciiControlOrLineSeparator.test(value)) {
    errors.push({ field, message: `${field} must be single-line with no multiline, control, or separator characters` });
    return false;
  }
  return true;
};

const validateTtl = (value: unknown, errors: ExternalStateValidationError[]): number | null => {
  if (value === undefined) {
    return EXTERNAL_STATE_DEFAULT_TTL_MS;
  }
  if (!Number.isInteger(value)) {
    errors.push({ field: "ttlMs", message: "ttlMs must be an integer" });
    return null;
  }
  const ttl = value as number;
  if (ttl < EXTERNAL_STATE_TTL_MS_CONSTRAINT.minimum || ttl > EXTERNAL_STATE_TTL_MS_CONSTRAINT.maximum) {
    errors.push({ field: "ttlMs", message: "ttlMs must be between 1000 and 86400000" });
    return null;
  }
  return ttl;
};

const visibilityFor = (
  external: Readonly<Record<ExternalStateKey, Partial<ExternalStateConfig> | undefined>> | undefined,
  key: ExternalStateKey,
): ExternalStateConfig => ({
  ui: external?.[key]?.ui ?? true,
  agent: external?.[key]?.agent ?? false,
});

const cloneSnapshot = (snapshot: ExternalStateSnapshot): ExternalStateSnapshot => ({
  key: snapshot.key,
  agent: snapshot.agent,
  ui: snapshot.ui,
  source: snapshot.source,
  updatedAt: snapshot.updatedAt,
  expiresAt: snapshot.expiresAt,
});

export const createExternalStateBridge = (options: ExternalStateBridgeOptions): ExternalStateBridge => {
  const snapshots = new Map<ExternalStateKey, ExternalStateSnapshot>();

  const liveSnapshot = (snapshot: ExternalStateSnapshot): ExternalStateSnapshot | null => {
    if (snapshot.expiresAt <= options.now()) {
      snapshots.delete(snapshot.key);
      return null;
    }
    return cloneSnapshot(snapshot);
  };

  return {
    set(event: unknown): ExternalStateSetResult {
      const errors: ExternalStateValidationError[] = [];
      if (!isRecord(event)) {
        return { ok: false, errors: [{ field: "event", message: "set event must be an object" }] };
      }

      for (const field of unexpectedKeys(event, EXTERNAL_STATE_SET_EVENT_KEYS)) {
        errors.push({ field, message: `unknown field ${field} is not accepted` });
      }
      if (!validateKey(event.key)) {
        errors.push({ field: "key", message: "key must match [A-Za-z0-9_-]{1,64} and must not contain dots" });
      }
      if (event.agent === undefined && event.ui === undefined) {
        errors.push({ field: "agent/ui", message: "at least one of agent or ui must be present" });
      }

      let agent: string | null = null;
      let ui: string | null = null;
      let source: string | null = null;
      if (event.agent !== undefined && validateSingleLineText("agent", event.agent, errors)) {
        agent = event.agent;
      }
      if (event.ui !== undefined && validateSingleLineText("ui", event.ui, errors)) {
        ui = event.ui;
      }
      if (event.source !== undefined && validateSingleLineText("source", event.source, errors)) {
        source = event.source;
      }
      const ttl = validateTtl(event.ttlMs, errors);

      if (errors.length > 0 || ttl === null || !validateKey(event.key)) {
        return { ok: false, errors };
      }

      const updatedAt = options.now();
      const snapshot: ExternalStateSnapshot = {
        key: event.key,
        agent,
        ui,
        source,
        updatedAt,
        expiresAt: updatedAt + ttl,
      };
      snapshots.set(event.key, snapshot);
      if (event.ttlMs === undefined) {
        return { ok: true, snapshot: cloneSnapshot(snapshot), config: visibilityFor(options.external, event.key) };
      }
      return { ok: true, snapshot: cloneSnapshot(snapshot) };
    },

    clear(event: unknown): ExternalStateClearResult {
      const errors: ExternalStateValidationError[] = [];
      if (!isRecord(event)) {
        return { ok: false, errors: [{ field: "event", message: "clear event must be an object" }] };
      }
      for (const field of unexpectedKeys(event, EXTERNAL_STATE_CLEAR_EVENT_KEYS)) {
        errors.push({ field, message: `unknown field ${field} is not accepted` });
      }
      if (!validateKey(event.key)) {
        errors.push({ field: "key", message: "key must match [A-Za-z0-9_-]{1,64} and must not contain dots" });
      }
      if (errors.length > 0 || !validateKey(event.key)) {
        return { ok: false, errors };
      }
      snapshots.delete(event.key);
      return { ok: true, clearedKey: event.key };
    },

    getExternalState(key: ExternalStateKey): ExternalStateSnapshot | null {
      const snapshot = snapshots.get(key);
      return snapshot === undefined ? null : liveSnapshot(snapshot);
    },

    listExternalStates(): ExternalStateSnapshot[] {
      return [...snapshots.values()]
        .map((snapshot) => liveSnapshot(snapshot))
        .filter((snapshot): snapshot is ExternalStateSnapshot => snapshot !== null)
        .sort((left, right) => left.key.localeCompare(right.key));
    },
  };
};
