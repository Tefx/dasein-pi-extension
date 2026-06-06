import type {
  ConfigValidationError,
  SensorAction,
  SensorConfig,
  SensorFieldSpec,
  SensorManifest,
  SensorNormalizeContext,
  SensorObservationEvent,
  SensorSnapshot,
  SensorSpec,
  SensorStateField,
  SensorValueType,
} from "../core/types.ts";

export type LapseAgentField = "user_idle" | "agent_idle";

export interface LapseConfig extends SensorConfig {
  persist: boolean;
  agentFields: LapseAgentField[];
}

export interface LapseState {
  userIdleMs: number | null;
  agentIdleMs: number | null;
  previousHumanInputAt: number | null;
  previousAgentEndAt: number | null;
}

export interface LapsePersistedState {
  previous_human_input_at: number | null;
  previous_agent_end_at: number | null;
}

const LAPSE_AGENT_FIELDS: readonly LapseAgentField[] = ["user_idle", "agent_idle"];
const DEFAULT_STALE_AFTER_MS = 120000;

let lastObservedHumanTurnId: string | null = null;

export const lapseFields: Record<string, SensorFieldSpec> = {
  persist: { label: "Persist lapse continuity", type: "boolean" },
  agentFields: {
    label: "Agent-visible lapse fields",
    type: "array",
    item: {
      label: "Lapse field",
      type: "enum",
      values: LAPSE_AGENT_FIELDS,
    },
  },
};

const lapseOutputFields = [
  {
    state_key: "lapse.user_idle",
    value_type: "number",
    description: "milliseconds since previous human input",
    agentVisibleByDefault: true,
    uiVisibleByDefault: true,
  },
  {
    state_key: "lapse.agent_idle",
    value_type: "number",
    description: "milliseconds since previous agent completion",
    agentVisibleByDefault: false,
    uiVisibleByDefault: true,
  },
  {
    state_key: "lapse.previous_human_input_at",
    value_type: "number",
    description: "latest human input timestamp",
    agentVisibleByDefault: false,
    uiVisibleByDefault: true,
  },
  {
    state_key: "lapse.previous_agent_end_at",
    value_type: "number",
    description: "latest agent completion timestamp",
    agentVisibleByDefault: false,
    uiVisibleByDefault: true,
  },
] as const;

const lapseManifest: SensorManifest = {
  description: "local lapse continuity",
  declaredInputClasses: ["pi_lifecycle", "derived"],
  outputFields: lapseOutputFields,
  permissions: [{ kind: "none", required: false, reason: "Pi lifecycle timestamps only" }],
  remote: {
    capable: false,
    contactsNetworkByDefault: false,
    destinations: [],
    payloadClasses: [],
    transmissionCadence: "none",
    disableControl: "none",
    description: "none",
  },
  backgroundWork: {
    capable: true,
    kinds: ["initial_refresh", "recurring_interval", "pi_lifecycle_observe"],
    defaultIntervalMs: 60000,
    intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
    description: "local lapse refresh and Pi lifecycle observation",
  },
};

const defaults: LapseConfig = {
  enabled: true,
  ui: true,
  agent: true,
  intervalMs: 60000,
  timeoutMs: 2000,
  staleAfterMs: DEFAULT_STALE_AFTER_MS,
  initialRefresh: true,
  persist: true,
  agentFields: ["user_idle"],
};

const makeField = <TValue>(
  stateKey: string,
  value: TValue,
  valueType: SensorValueType,
  context: SensorNormalizeContext,
): SensorStateField<TValue> => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: context.sensorKey,
  state_key: stateKey,
  value,
  value_type: valueType,
  collected_at: context.collectedAt,
  stale_after_ms: context.staleAfterMs,
  status: context.status,
  source: context.source,
  ...(context.error === undefined ? {} : { error: context.error }),
});

const valueTypeForNullableNumber = (value: number | null): SensorValueType => value === null ? "null" : "number";

const readNumberField = (snapshot: SensorSnapshot | null, key: string): number | null => {
  const value = snapshot?.fields[key]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const persistedFromSnapshot = (snapshot: SensorSnapshot | null): LapsePersistedState => ({
  previous_human_input_at: readNumberField(snapshot, "lapse.previous_human_input_at"),
  previous_agent_end_at: readNumberField(snapshot, "lapse.previous_agent_end_at"),
});

const observedAt = (event: SensorObservationEvent, defaultObservedAt: number): number => Number.isFinite(event.observedAt) ? event.observedAt : defaultObservedAt;

const sampleHumanInput = (at: number, previous: LapsePersistedState): LapseState => ({
  userIdleMs: previous.previous_human_input_at === null ? null : Math.max(0, at - previous.previous_human_input_at),
  agentIdleMs: previous.previous_agent_end_at === null ? null : Math.max(0, at - previous.previous_agent_end_at),
  previousHumanInputAt: at,
  previousAgentEndAt: previous.previous_agent_end_at,
});

const sampleAgentEnd = (at: number, previous: LapsePersistedState): LapseState => ({
  userIdleMs: null,
  agentIdleMs: null,
  previousHumanInputAt: previous.previous_human_input_at,
  previousAgentEndAt: at,
});

const normalizeState = (value: LapseState, context: SensorNormalizeContext): Record<string, SensorStateField> => ({
  "lapse.user_idle": makeField("lapse.user_idle", value.userIdleMs, valueTypeForNullableNumber(value.userIdleMs), context),
  "lapse.agent_idle": makeField("lapse.agent_idle", value.agentIdleMs, valueTypeForNullableNumber(value.agentIdleMs), context),
  "lapse.previous_human_input_at": makeField(
    "lapse.previous_human_input_at",
    value.previousHumanInputAt,
    valueTypeForNullableNumber(value.previousHumanInputAt),
    context,
  ),
  "lapse.previous_agent_end_at": makeField(
    "lapse.previous_agent_end_at",
    value.previousAgentEndAt,
    valueTypeForNullableNumber(value.previousAgentEndAt),
    context,
  ),
});

const lapseConfigError = (path: string, message: string): ConfigValidationError => ({
  kind: "invalid-value",
  path,
  message,
});

const validateAgentFields = (agentFields: LapseConfig["agentFields"]): boolean =>
  Array.isArray(agentFields) && agentFields.every((field) => LAPSE_AGENT_FIELDS.includes(field));

const resetAction: SensorAction<LapseConfig> = () => ({
  ok: true,
  message: "lapse reset requested",
  data: { reset: true },
});

const lapse: SensorSpec<LapseState, LapseConfig> = {
  key: "lapse",
  defaults,
  manifest: lapseManifest,
  fields: lapseFields,
  validateConfig: (config) => {
    const errors: ConfigValidationError[] = [];
    if (typeof config.persist !== "boolean") errors.push(lapseConfigError("sensors.lapse.persist", "lapse.persist must be a boolean"));
    if (!validateAgentFields(config.agentFields)) errors.push(lapseConfigError("sensors.lapse.agentFields", "lapse.agentFields may contain only user_idle and agent_idle"));
    return errors;
  },
  refresh: () => ({
    userIdleMs: null,
    agentIdleMs: null,
    previousHumanInputAt: null,
    previousAgentEndAt: null,
  }),
  observe: (event, context, previous) => {
    if (!context.config.enabled) return null;
    const at = observedAt(event, context.now());
    const persisted = persistedFromSnapshot(previous);
    if (event.kind === "agent_end") {
      return sampleAgentEnd(at, persisted);
    }
    if (lastObservedHumanTurnId === event.turnId) return null;
    lastObservedHumanTurnId = event.turnId;
    return sampleHumanInput(at, persisted);
  },
  normalizeState,
  actions: { reset: resetAction },
};

export default lapse;
