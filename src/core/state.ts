/**
 * State store boundary contracts.
 *
 * Sensor storage accepts normalized typed-state snapshots. External state stays
 * separate from sensor envelopes. Rendered context is precomputed in memory for
 * the request-path injector.
 */

import type {
  DaseinDurableStateFile,
  DaseinStateStore,
  ExternalStateSnapshot,
  LapsePersistedState,
  RenderedContext,
  SensorSnapshot,
} from "./types.ts";

export type {
  DaseinDurableStateFile,
  DaseinStateStore,
  ExternalStateSnapshot,
  LapsePersistedState,
  RenderedContext,
  SensorSnapshot,
} from "./types.ts";

export const SENSOR_STATE_ENVELOPE_KEYS = [
  "contract_version",
  "schema_version",
  "sensor_id",
  "state_key",
  "value",
  "value_type",
  "collected_at",
  "stale_after_ms",
  "status",
  "source",
  "error",
] as const;

export const SENSOR_SNAPSHOT_ENVELOPE_KEYS = [
  "contract_version",
  "schema_version",
  "sensor_id",
  "fields",
  "collected_at",
  "stale_after_ms",
  "status",
  "source",
  "error",
  "refresh",
] as const;

export const EXTERNAL_STATE_SNAPSHOT_KEYS = [
  "key",
  "agent",
  "ui",
  "source",
  "updatedAt",
  "expiresAt",
] as const;

export const RENDERED_CONTEXT_KEYS = [
  "agent",
  "status",
  "widgetLines",
  "omittedKeys",
  "truncated",
] as const;

export interface StateStoreContract {
  sensorSnapshotInput: "SensorSnapshot";
  externalSnapshotInput: "ExternalStateSnapshot";
  renderedContextInput: "RenderedContext";
  injectorReadSurface: "getRenderedContext-or-getRenderedAgentString";
}
