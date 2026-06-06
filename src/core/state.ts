/**
 * State store boundary contracts and in-memory/durable store implementation.
 *
 * Request-path state is memory-only. Durable support is intentionally bounded to
 * lapse timestamps in an explicit state.json path supplied by lifecycle code.
 */

import { readStateTextIfExists, writeStateAtomically } from "./state-io.ts";
import type { StateIoFailPoint } from "./state-io.ts";

import type {
  DaseinDurableStateFile,
  DaseinStateStore,
  ExternalStateSnapshot,
  LapsePersistedState,
  RenderedContext,
  SensorSnapshot,
  SensorStateField,
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

type JsonObject = Record<string, unknown>;
type FailPoint = StateIoFailPoint;

type DurableWriteResult =
  | { ok: true; fsynced: boolean; renamed: true }
  | { ok: false; error: { kind: "durable_state"; message: string } };

const clone = <T>(value: T): T => structuredClone(value);

const isRecord = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

const isSensorStateField = (value: unknown): value is SensorStateField => {
  if (!isRecord(value)) return false;
  return value.contract_version === 1
    && value.schema_version === 1
    && typeof value.sensor_id === "string"
    && typeof value.state_key === "string"
    && typeof value.collected_at === "number"
    && typeof value.stale_after_ms === "number"
    && typeof value.status === "string"
    && isRecord(value.source);
};

const canonicalField = (field: SensorStateField): SensorStateField => {
  const next: JsonObject = {};
  for (const key of SENSOR_STATE_ENVELOPE_KEYS) {
    if (key in field) next[key] = clone((field as unknown as JsonObject)[key]);
  }
  return next as unknown as SensorStateField;
};

const canonicalSnapshot = (snapshot: SensorSnapshot): SensorSnapshot => {
  if (!isRecord(snapshot) || snapshot.contract_version !== 1 || snapshot.schema_version !== 1) throw new Error("invalid sensor snapshot envelope");
  const fields: Record<string, SensorStateField> = {};
  for (const [key, field] of Object.entries(snapshot.fields ?? {})) {
    if (!isSensorStateField(field)) throw new Error("invalid sensor state field envelope");
    if (key !== field.state_key) throw new Error("sensor snapshot field key must match state_key");
    if (field.sensor_id !== snapshot.sensor_id) throw new Error("sensor snapshot field sensor_id mismatch");
    fields[key] = canonicalField(field);
  }
  const next: JsonObject = {};
  for (const key of SENSOR_SNAPSHOT_ENVELOPE_KEYS) {
    if (key === "fields") next.fields = fields;
    else if (key in snapshot) next[key] = clone((snapshot as unknown as JsonObject)[key]);
  }
  return next as unknown as SensorSnapshot;
};

const canonicalExternal = (snapshot: ExternalStateSnapshot): ExternalStateSnapshot => ({
  key: snapshot.key,
  agent: snapshot.agent,
  ui: snapshot.ui,
  source: snapshot.source,
  updatedAt: snapshot.updatedAt,
  expiresAt: snapshot.expiresAt,
});

const canonicalRendered = (value: RenderedContext): RenderedContext => ({
  agent: value.agent,
  status: value.status,
  widgetLines: value.widgetLines ? [...value.widgetLines] : null,
  omittedKeys: [...value.omittedKeys],
  truncated: value.truncated,
});

export const createStateStore = (initialRendered?: Partial<RenderedContext>): DaseinStateStore => {
  const sensors = new Map<string, SensorSnapshot>();
  const external = new Map<string, ExternalStateSnapshot>();
  let rendered: RenderedContext = canonicalRendered({
    agent: null,
    status: null,
    widgetLines: null,
    omittedKeys: [],
    truncated: false,
    ...initialRendered,
  });
  return {
    getSensorSnapshot(sensorId) {
      const snapshot = sensors.get(sensorId);
      return snapshot ? clone(snapshot) : null;
    },
    setSensorSnapshot(snapshot) {
      const canonical = canonicalSnapshot(snapshot);
      sensors.set(canonical.sensor_id, canonical);
    },
    clearSensorSnapshot(sensorId) {
      sensors.delete(sensorId);
    },
    listSensorSnapshots() {
      return [...sensors.values()].map((snapshot) => clone(snapshot));
    },
    getExternalState(key) {
      const snapshot = external.get(key);
      return snapshot ? clone(snapshot) : null;
    },
    setExternalState(snapshot) {
      external.set(snapshot.key, canonicalExternal(snapshot));
    },
    clearExternalState(key) {
      external.delete(key);
    },
    listExternalStates() {
      return [...external.values()].map((snapshot) => clone(snapshot));
    },
    getRenderedContext() {
      return canonicalRendered(rendered);
    },
    setRenderedContext(value) {
      rendered = canonicalRendered(value);
    },
    getRenderedAgentString() {
      return rendered.agent;
    },
    setRenderedAgentString(value) {
      rendered = { ...rendered, agent: value };
    },
    getRenderedStatusString() {
      return rendered.status;
    },
    setRenderedStatusString(value) {
      rendered = { ...rendered, status: value };
    },
    getRenderedWidgetLines() {
      return rendered.widgetLines ? [...rendered.widgetLines] : null;
    },
    setRenderedWidgetLines(value) {
      rendered = { ...rendered, widgetLines: value ? [...value] : null };
    },
  };
};

const canonicalLapse = (value: unknown): LapsePersistedState | null => {
  if (!isRecord(value)) return null;
  const human = value.previous_human_input_at;
  const agent = value.previous_agent_end_at;
  if (human !== null && typeof human !== "number") return null;
  if (agent !== null && typeof agent !== "number") return null;
  return { previous_human_input_at: human, previous_agent_end_at: agent };
};

export const createDurableStateStore = ({ statePath, lapsePersistEnabled, fsyncAvailable = true }: { statePath: string; lapsePersistEnabled: boolean; fsyncAvailable?: boolean }): {
  load(): Promise<{ ok: boolean; lapse: LapsePersistedState | null; error?: { kind: "durable_state"; message: string } }>;
  writeLapse(lapse: unknown, options?: { failAt?: FailPoint }): Promise<DurableWriteResult>;
} => ({
  async load() {
    if (!lapsePersistEnabled) return { ok: true, lapse: null };
    const text = await readStateTextIfExists(statePath);
    if (text === null) return { ok: true, lapse: null };
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!isRecord(parsed) || parsed.version !== 1) throw new Error("state.json version must be 1");
      const lapse = canonicalLapse(parsed.lapse);
      if (!lapse) throw new Error("state.json lapse state is malformed");
      return { ok: true, lapse };
    } catch (caught) {
      return { ok: false, lapse: null, error: { kind: "durable_state", message: caught instanceof Error ? caught.message : "malformed state.json" } };
    }
  },
  async writeLapse(lapse, options) {
    const canonical = canonicalLapse(lapse);
    if (!canonical) return { ok: false, error: { kind: "durable_state", message: "write-failed: invalid lapse state" } };
    const result = await writeStateAtomically({ path: statePath, value: { version: 1, lapse: canonical }, failAt: options?.failAt, fsyncAvailable });
    if (!result.ok) return { ok: false, error: { kind: "durable_state", message: "write-failed: state.json persistence failed" } };
    return { ok: true, fsynced: result.fsynced, renamed: true };
  },
});
