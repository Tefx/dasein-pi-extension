import type {
  ConfigValidationError,
  SensorConfig,
  SensorFieldSpec,
  SensorManifest,
  SensorNormalizeContext,
  SensorSnapshot,
  SensorSpec,
  SensorStateField,
  SensorValueType,
  SensorViewFragment,
} from "../core/types.ts";

export type ClockPrecision = "exact" | "minute" | "hour" | "period" | "date";

export interface ClockConfig extends SensorConfig {
  precision: ClockPrecision;
}

export interface ClockState {
  epochMs: number;
  iso: string;
  local: string;
  utcOffsetMinutes: number;
}

const CLOCK_PRECISIONS: readonly ClockPrecision[] = ["exact", "minute", "hour", "period", "date"];
const DEFAULT_STALE_AFTER_MS = 120000;

export const clockFields: Record<string, SensorFieldSpec> = {
  precision: {
    label: "Time precision",
    type: "enum",
    values: CLOCK_PRECISIONS,
  },
};

const clockOutputFields = [
  {
    state_key: "clock.epoch_ms",
    value_type: "number",
    description: "epoch milliseconds at collection",
    agentVisibleByDefault: false,
    uiVisibleByDefault: true,
  },
  {
    state_key: "clock.iso",
    value_type: "string",
    description: "ISO timestamp at collection",
    agentVisibleByDefault: false,
    uiVisibleByDefault: true,
  },
  {
    state_key: "clock.local_time",
    value_type: "string",
    description: "formatted local time",
    agentVisibleByDefault: true,
    uiVisibleByDefault: true,
  },
  {
    state_key: "clock.utc_offset_minutes",
    value_type: "number",
    description: "local UTC offset in minutes",
    agentVisibleByDefault: false,
    uiVisibleByDefault: true,
  },
] as const;

const clockManifest: SensorManifest = {
  description: "local clock",
  declaredInputClasses: ["time"],
  outputFields: clockOutputFields,
  permissions: [{ kind: "none", required: false, reason: "local time only" }],
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
    kinds: ["initial_refresh", "recurring_interval"],
    defaultIntervalMs: 60000,
    intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
    description: "local clock refresh",
  },
};

const defaults: ClockConfig = {
  enabled: true,
  ui: true,
  agent: true,
  intervalMs: 60000,
  timeoutMs: 2000,
  staleAfterMs: DEFAULT_STALE_AFTER_MS,
  initialRefresh: true,
  precision: "minute",
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

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatOffset = (offsetMinutes: number): string => {
  if (offsetMinutes === 0) return "+00";
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return minutes === 0 ? `${sign}${pad2(hours)}` : `${sign}${pad2(hours)}:${pad2(minutes)}`;
};

const formatLocalClockState = (date: Date): ClockState => {
  const epochMs = date.getTime();
  const utcOffsetMinutes = -date.getTimezoneOffset();
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  return {
    epochMs,
    iso: date.toISOString(),
    local: `${weekday}_${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${formatOffset(utcOffsetMinutes)}`,
    utcOffsetMinutes,
  };
};

const fieldValue = (snapshot: SensorSnapshot, key: string): unknown => snapshot.fields[key]?.value;

const localFromSnapshot = (snapshot: SensorSnapshot): string => {
  const local = fieldValue(snapshot, "clock.local_time");
  if (typeof local === "string" && local.length > 0) return local;
  const iso = fieldValue(snapshot, "clock.iso");
  if (typeof iso === "string") {
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) return formatLocalClockState(date).local;
  }
  return "time_unavailable";
};

const hourFromLocal = (local: string): number | null => {
  const match = /(?:^|_)(\d{2})(?::\d{2})?(?::\d{2})?/u.exec(local);
  if (match?.[1] === undefined) return null;
  const hour = Number.parseInt(match[1], 10);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
};

const periodForHour = (hour: number | null): string => {
  if (hour === null) return "day";
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
};

const dateFromSnapshot = (snapshot: SensorSnapshot, local: string): string => {
  const iso = fieldValue(snapshot, "clock.iso");
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/u.test(iso)) return iso.slice(0, 10);
  return local.replace(/_\d{2}(?::\d{2}){0,2}.*$/u, "");
};

const applyPrecision = (snapshot: SensorSnapshot, precision: ClockPrecision): string => {
  const local = localFromSnapshot(snapshot);
  switch (precision) {
    case "exact":
      return local;
    case "minute":
      return local.replace(/(\d{2}:\d{2}):\d{2}/u, "$1");
    case "hour":
      return local.replace(/(\d{2})(?::\d{2}){1,2}/u, "$1");
    case "period":
      return `${local.replace(/_\d{2}(?::\d{2}){0,2}.*$/u, "")}_${periodForHour(hourFromLocal(local))}`;
    case "date":
      return dateFromSnapshot(snapshot, local);
  }
};

const asClockPrecision = (value: unknown): ClockPrecision => CLOCK_PRECISIONS.includes(value as ClockPrecision) ? value as ClockPrecision : defaults.precision;

const clockConfigError = (path: string, message: string): ConfigValidationError => ({
  kind: "invalid-value",
  path,
  message,
});

const normalizeState = (value: ClockState, context: SensorNormalizeContext): Record<string, SensorStateField> => ({
  "clock.epoch_ms": makeField("clock.epoch_ms", value.epochMs, "number", context),
  "clock.iso": makeField("clock.iso", value.iso, "string", context),
  "clock.local_time": makeField("clock.local_time", value.local, "string", context),
  "clock.utc_offset_minutes": makeField("clock.utc_offset_minutes", value.utcOffsetMinutes, "number", context),
});

const renderAgent = (snapshot: SensorSnapshot, config: Readonly<ClockConfig>): SensorViewFragment | null => {
  if (!config.enabled || !config.agent || snapshot.status !== "enabled") return null;
  const value = applyPrecision(snapshot, asClockPrecision(config.precision));
  return {
    sensor_id: "clock",
    state_key: "clock.local_time",
    value,
    value_type: "string",
    label: "time",
    status: snapshot.status,
    source: snapshot.source,
  };
};

const renderUI = (snapshot: SensorSnapshot, config: Readonly<ClockConfig>): SensorViewFragment | null => {
  if (!config.enabled || !config.ui) return null;
  const value = applyPrecision(snapshot, asClockPrecision(config.precision)).replace(/_/gu, " ").replace(/([+-]\d{2}(?::\d{2})?)$/u, " $1");
  return {
    sensor_id: "clock",
    state_key: "clock.local_time",
    value,
    value_type: "string",
    label: "time",
    status: snapshot.status,
    source: snapshot.source,
  };
};

const clock: SensorSpec<ClockState, ClockConfig> = {
  key: "clock",
  defaults,
  manifest: clockManifest,
  fields: clockFields,
  validateConfig: (config) => CLOCK_PRECISIONS.includes(config.precision)
    ? []
    : [clockConfigError("sensors.clock.precision", "clock.precision must be one of exact, minute, hour, period, date")],
  refresh: (context) => formatLocalClockState(new Date(context.now())),
  normalizeState,
  renderAgent,
  renderUI,
};

export default clock;
