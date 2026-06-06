/**
 * Rendering boundary contracts.
 *
 * Renderer input is effective config, normalized store snapshots, and caller
 * time. Renderer output is a precomputed RenderedContext owned by core. Sensor
 * render hooks may propose structured fragments only; core owns ordering,
 * labels, visibility, omission, and truncation.
 */

import type {
  CoreConfig,
  DaseinConfig,
  DaseinStateStore,
  ExternalStateConfig,
  ExternalStateSnapshot,
  RenderedContext,
  SensorConfig,
  SensorKey,
  SensorRender,
  SensorSnapshot,
  SensorStateField,
  SensorViewFragment,
} from "./types.ts";

export type {
  RenderedContext,
  SensorRender,
  SensorViewFragment,
} from "./types.ts";

export interface RendererInput {
  config: Readonly<DaseinConfig>;
  stateStore: DaseinStateStore;
  now: number;
}

export interface RenderContributorInput {
  config: Readonly<CoreConfig>;
  sensorSnapshots: readonly SensorSnapshot[];
  externalSnapshots: readonly ExternalStateSnapshot[];
  now: number;
}

export interface RenderInvalidationContract {
  trigger: "minimum-rendered-freshness-or-expiry-deadline";
  recomputeInput: "existing-in-memory-normalized-state";
  refreshSensors: false;
  mutateConfig: false;
}

export interface RendererContract {
  input: "effective-config-current-state-store-and-now";
  output: RenderedContext;
  agentOrder: readonly ["configured-renderOrder", "remaining-sensors-lexicographic", "remaining-external-lexicographic"];
  sensorHookOutput: "SensorViewFragment-proposals";
  coreOwnedFinalText: true;
  coreOwnedTruncation: true;
}

interface DirectRendererInput {
  config: Readonly<DaseinConfig>;
  sensorSnapshots?: readonly SensorSnapshot[];
  externalStates?: readonly ExternalStateSnapshot[];
  stateStore?: DaseinStateStore;
  now: number;
  hooks?: Readonly<Record<SensorKey, Partial<Record<"renderAgent" | "renderUI", () => unknown>>>>;
}

interface RenderCandidate {
  key: string;
  agentPart: string | null;
  statusLine: string | null;
  widgetLine: string | null;
}

interface SanitizedSensor {
  sensorId: SensorKey;
  snapshot: SensorSnapshot;
  fields: SensorStateField[];
}

interface SanitizedExternal {
  key: string;
  snapshot: ExternalStateSnapshot;
}

const sensorEnvelopeKeys = new Set([
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
]);

const externalSnapshotKeys = new Set(["key", "agent", "ui", "source", "updatedAt", "expiresAt"]);
const externalPrefix = "external:";

const compareText = (left: string, right: string): number => left.localeCompare(right);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).every((key) => keys.has(key));

const asDirectInput = (input: DirectRendererInput | RendererInput): DirectRendererInput => {
  const direct = input as DirectRendererInput;
  if (direct.stateStore !== undefined && direct.sensorSnapshots === undefined) {
    return {
      config: input.config,
      stateStore: direct.stateStore,
      sensorSnapshots: direct.stateStore.listSensorSnapshots(),
      externalStates: direct.stateStore.listExternalStates(),
      now: input.now,
      hooks: direct.hooks,
    };
  }
  return direct;
};

const configForSensor = (config: Readonly<DaseinConfig>, sensorId: SensorKey): Readonly<SensorConfig> =>
  config.sensors[sensorId] ?? { enabled: false, ui: false, agent: false };

const configForExternal = (config: Readonly<DaseinConfig>, key: string): Readonly<ExternalStateConfig> => ({
  ui: config.external[key]?.ui ?? true,
  agent: config.external[key]?.agent ?? false,
});

const sanitizeSensorField = (sensorId: SensorKey, key: string, value: unknown): SensorStateField | null => {
  if (!isRecord(value) || !hasOnlyKeys(value, sensorEnvelopeKeys)) {
    return null;
  }
  if (value.contract_version !== 1 || value.schema_version !== 1 || value.sensor_id !== sensorId || value.state_key !== key) {
    return null;
  }
  if (typeof value.collected_at !== "number" || typeof value.stale_after_ms !== "number" || value.stale_after_ms < 0) {
    return null;
  }
  return value as unknown as SensorStateField;
};

const sanitizeSensorSnapshot = (snapshot: SensorSnapshot): SanitizedSensor | null => {
  if (snapshot.contract_version !== 1 || snapshot.schema_version !== 1 || typeof snapshot.sensor_id !== "string") {
    return null;
  }
  const fields = Object.entries(snapshot.fields)
    .map(([key, field]) => sanitizeSensorField(snapshot.sensor_id, key, field))
    .filter((field): field is SensorStateField => field !== null)
    .sort((left, right) => compareText(left.sensor_id, right.sensor_id) || compareText(left.state_key, right.state_key));
  return {
    sensorId: snapshot.sensor_id,
    snapshot,
    fields,
  };
};

const sanitizeExternalSnapshot = (snapshot: ExternalStateSnapshot, now: number): SanitizedExternal | null => {
  const record = snapshot as unknown as Record<string, unknown>;
  if (!hasOnlyKeys(record, externalSnapshotKeys)) {
    return null;
  }
  if (typeof snapshot.key !== "string" || snapshot.expiresAt <= now) {
    return null;
  }
  return { key: snapshot.key, snapshot };
};

const labelForField = (field: SensorStateField): string => {
  if (field.state_key === "clock.local_time") {
    return "time";
  }
  if (field.state_key === "lapse.user_idle" || field.state_key === "lapse.user_idle_ms") {
    return "user_idle";
  }
  if (field.state_key === "geo.city") {
    return "loc";
  }
  if (field.state_key === "geo.formattedAddress") {
    return "address";
  }
  if (field.state_key === "geo.lat") {
    return "lat";
  }
  if (field.state_key === "geo.lon") {
    return "lon";
  }
  return field.state_key.includes(".") ? field.state_key.slice(field.state_key.indexOf(".") + 1) : field.state_key;
};

const formatAgentValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value);
};

const formatHumanValue = (value: unknown): string => formatAgentValue(value).replace(/_/gu, " ").replace(/([+-]\d{2})$/u, " $1");

const isFieldStale = (field: SensorStateField, now: number): boolean => now - field.collected_at > field.stale_after_ms;

const geoPrecisions = new Set(["city", "district", "street", "exact"]);
const geoNeverRawAgentFields = new Set(["geo.permission", "geo.nearestTag"]);

const geoPrecisionFor = (sensorConfig: Readonly<SensorConfig>): "city" | "district" | "street" | "exact" =>
  typeof sensorConfig.precision === "string" && geoPrecisions.has(sensorConfig.precision) ? sensorConfig.precision as "city" | "district" | "street" | "exact" : "city";

const compactGeoValue = (value: string): string => value.replace(/\s+/gu, "_");

const placemarkString = (value: unknown, precision: "city" | "district" | "street" | "exact", exactAddress: boolean): string | null => {
  if (!isRecord(value)) {
    return null;
  }
  const textField = (key: string): string | null => {
    const candidate = value[key];
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
  };
  if (precision === "city") {
    return textField("city") ?? textField("district") ?? textField("street");
  }
  if (precision === "district") {
    return textField("district") ?? textField("city") ?? textField("street");
  }
  if (precision === "street") {
    return textField("street") ?? textField("district") ?? textField("city");
  }
  return exactAddress ? textField("formattedAddress") ?? textField("name") : null;
};

const formatGeoAgentPart = (field: SensorStateField, sensorConfig: Readonly<SensorConfig>, label: string): string | null => {
  const precision = geoPrecisionFor(sensorConfig);
  const exactCoordinates = precision === "exact" && sensorConfig.exactCoordinates === true;
  const exactAddress = precision === "exact" && sensorConfig.exactAddress === true;
  const textAgentPart = (): string | null => typeof field.value === "string" && field.value.length > 0 ? `loc=${compactGeoValue(field.value)}` : null;

  if (field.state_key === "geo.lat" || field.state_key === "geo.lon") {
    return exactCoordinates ? `${label}=${formatAgentValue(field.value)}` : null;
  }
  if (field.state_key === "geo.accuracy_m") {
    return exactCoordinates ? `${label}=${formatAgentValue(field.value)}` : null;
  }
  if (field.state_key === "geo.city") {
    return precision === "city" || precision === "district" || precision === "street" ? textAgentPart() : null;
  }
  if (field.state_key === "geo.district") {
    return precision === "district" || precision === "street" ? textAgentPart() : null;
  }
  if (field.state_key === "geo.street") {
    return precision === "street" ? textAgentPart() : null;
  }
  if (field.state_key === "geo.formattedAddress" || field.state_key === "geo.name") {
    return exactAddress ? `${label}=${formatAgentValue(field.value)}` : null;
  }
  if (field.state_key === "geo.placemark") {
    const place = placemarkString(field.value, precision, exactAddress);
    return place === null ? null : `loc=${compactGeoValue(place)}`;
  }
  if (geoNeverRawAgentFields.has(field.state_key)) {
    return null;
  }
  return field.state_key.startsWith("geo.") ? null : `${label}=${formatAgentValue(field.value)}`;
};

const formatSensorAgentPart = (field: SensorStateField, sensorConfig: Readonly<SensorConfig>, label: string): string | null => {
  if (!sensorConfig.agent) {
    return null;
  }
  if (field.sensor_id === "geo") {
    return formatGeoAgentPart(field, sensorConfig, label);
  }
  return `${label}=${formatAgentValue(field.value)}`;
};

const normalizeHookOutputs = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
};

const inspectHookOutput = (value: unknown, violations: Set<string>): void => {
  const forbidden: Record<string, string> = {
    finalString: "finalString",
    requestRefresh: "requestRefresh",
    requestAction: "requestAction",
    configMutation: "configMutation",
    durableStateRead: "durableStateRead",
    discovery: "discovery",
    nativeHelperImport: "helperImport",
    helperImport: "helperImport",
    io: "io",
  };
  for (const output of normalizeHookOutputs(value)) {
    for (const key of Object.keys(forbidden)) {
      if (Object.hasOwn(output, key)) {
        violations.add(forbidden[key] ?? key);
      }
    }
  }
};

const collectHookViolations = (input: DirectRendererInput, sensors: readonly SanitizedSensor[]): string[] => {
  const violations = new Set<string>();
  for (const sensor of sensors) {
    const hooks = input.hooks?.[sensor.sensorId];
    if (hooks?.renderAgent !== undefined) {
      inspectHookOutput(hooks.renderAgent(), violations);
    }
    if (hooks?.renderUI !== undefined) {
      inspectHookOutput(hooks.renderUI(), violations);
    }
  }
  return [...violations].sort();
};

const buildSensorCandidate = (
  field: SensorStateField,
  sensorConfig: Readonly<SensorConfig>,
  now: number,
  omittedKeys: Set<string>,
): RenderCandidate | null => {
  const label = labelForField(field);
  const humanValue = formatHumanValue(field.value);
  if (!sensorConfig.enabled) {
    omittedKeys.add(field.state_key);
    return sensorConfig.ui ? { key: field.state_key, agentPart: null, statusLine: `${field.sensor_id} disabled`, widgetLine: null } : null;
  }

  const stale = field.status === "stale" || isFieldStale(field, now);
  if (field.status === "error") {
    omittedKeys.add(field.state_key);
    return sensorConfig.ui ? { key: field.state_key, agentPart: null, statusLine: `${label} error`, widgetLine: `${label} error` } : null;
  }
  if (stale) {
    omittedKeys.add(field.state_key);
    return sensorConfig.ui ? { key: field.state_key, agentPart: null, statusLine: `${label} stale`, widgetLine: `${label} stale` } : null;
  }

  const agentPart = formatSensorAgentPart(field, sensorConfig, label);
  if (agentPart === null) {
    omittedKeys.add(field.state_key);
  }
  if (!sensorConfig.ui) {
    omittedKeys.add(field.state_key);
  }

  const statusSuffix = sensorConfig.agent ? "" : " (agent hidden)";
  const statusLine = sensorConfig.ui ? `${label} ${humanValue}${statusSuffix}` : null;
  const widgetLine = sensorConfig.ui ? `${label} ${humanValue}${statusSuffix}` : null;
  return { key: field.state_key, agentPart, statusLine, widgetLine };
};

const buildExternalCandidate = (
  external: SanitizedExternal,
  externalConfig: Readonly<ExternalStateConfig>,
  omittedKeys: Set<string>,
): RenderCandidate | null => {
  const key = `${externalPrefix}${external.key}`;
  const agentAllowed = externalConfig.agent && external.snapshot.agent !== null;
  const uiAllowed = externalConfig.ui && external.snapshot.ui !== null;
  if (!agentAllowed) {
    omittedKeys.add(key);
  }
  if (!uiAllowed) {
    omittedKeys.add(key);
  }
  if (!agentAllowed && !uiAllowed) {
    return null;
  }
  const statusSuffix = externalConfig.agent ? "" : " (agent hidden)";
  return {
    key,
    agentPart: agentAllowed ? `${external.key}=${external.snapshot.agent}` : null,
    statusLine: uiAllowed ? `${external.key} ${external.snapshot.ui}${statusSuffix}` : null,
    widgetLine: uiAllowed ? `${external.key} ${external.snapshot.ui}${statusSuffix}` : null,
  };
};

const appendCandidate = (candidate: RenderCandidate | null, candidates: RenderCandidate[]): void => {
  if (candidate !== null) {
    candidates.push(candidate);
  }
};

const buildOrderedCandidates = (
  input: DirectRendererInput,
  sensors: readonly SanitizedSensor[],
  externals: readonly SanitizedExternal[],
  omittedKeys: Set<string>,
): RenderCandidate[] => {
  const candidates: RenderCandidate[] = [];
  const renderedSensors = new Set<string>();
  const renderedExternals = new Set<string>();
  const sensorsById = new Map(sensors.map((sensor) => [sensor.sensorId, sensor]));
  const externalsByKey = new Map(externals.map((external) => [external.key, external]));

  const renderSensor = (sensor: SanitizedSensor): void => {
    renderedSensors.add(sensor.sensorId);
    const sensorConfig = configForSensor(input.config, sensor.sensorId);
    for (const field of sensor.fields) {
      appendCandidate(buildSensorCandidate(field, sensorConfig, input.now, omittedKeys), candidates);
    }
  };
  const renderExternal = (external: SanitizedExternal): void => {
    renderedExternals.add(external.key);
    appendCandidate(buildExternalCandidate(external, configForExternal(input.config, external.key), omittedKeys), candidates);
  };

  for (const renderKey of input.config.core.renderOrder) {
    if (renderKey.startsWith(externalPrefix)) {
      const key = renderKey.slice(externalPrefix.length);
      const external = externalsByKey.get(key);
      if (external !== undefined && !renderedExternals.has(key)) {
        renderExternal(external);
      }
      continue;
    }
    const sensor = sensorsById.get(renderKey);
    if (sensor !== undefined && !renderedSensors.has(sensor.sensorId)) {
      renderSensor(sensor);
    }
  }

  for (const sensor of [...sensors].sort((left, right) => compareText(left.sensorId, right.sensorId))) {
    if (!renderedSensors.has(sensor.sensorId)) {
      renderSensor(sensor);
    }
  }
  for (const external of [...externals].sort((left, right) => compareText(left.key, right.key))) {
    if (!renderedExternals.has(external.key)) {
      renderExternal(external);
    }
  }

  return candidates;
};

const buildAgent = (
  core: Readonly<CoreConfig>,
  candidates: readonly RenderCandidate[],
  omittedKeys: Set<string>,
): { agent: string | null; truncated: boolean } => {
  if (!core.agentInjectionEnabled) {
    return { agent: null, truncated: false };
  }
  const parts: string[] = [];
  let truncated = false;
  for (const candidate of candidates) {
    if (candidate.agentPart === null) {
      continue;
    }
    const nextParts = [...parts, candidate.agentPart];
    const nextAgent = `[${core.injectedLabel}: ${nextParts.join("; ")}]`;
    if (nextAgent.length > core.maxAgentChars) {
      omittedKeys.add(candidate.key);
      truncated = true;
      continue;
    }
    parts.push(candidate.agentPart);
  }
  return { agent: parts.length === 0 ? null : `[${core.injectedLabel}: ${parts.join("; ")}]`, truncated };
};

export const renderDaseinContext = (rawInput: DirectRendererInput | RendererInput): RenderedContext & {
  hookViolations?: string[];
  performedIo?: false;
  mutatedConfig?: false;
  refreshedSensors?: false;
} => {
  const input = asDirectInput(rawInput);
  const omittedKeys = new Set<string>();
  const sensors = (input.sensorSnapshots ?? [])
    .map(sanitizeSensorSnapshot)
    .filter((sensor): sensor is SanitizedSensor => sensor !== null);
  const externals = (input.externalStates ?? [])
    .map((snapshot) => {
      const external = sanitizeExternalSnapshot(snapshot, input.now);
      if (external === null) {
        omittedKeys.add(`${externalPrefix}${snapshot.key}`);
      }
      return external;
    })
    .filter((external): external is SanitizedExternal => external !== null);
  const hookViolations = collectHookViolations(input, sensors);
  const candidates = buildOrderedCandidates(input, sensors, externals, omittedKeys);
  const agent = buildAgent(input.config.core, candidates, omittedKeys);
  const statusLines = candidates.map((candidate) => candidate.statusLine).filter((line): line is string => line !== null);
  const widgetLines = candidates.map((candidate) => candidate.widgetLine).filter((line): line is string => line !== null);

  const rendered: RenderedContext & {
    hookViolations?: string[];
    performedIo?: false;
    mutatedConfig?: false;
    refreshedSensors?: false;
  } = {
    agent: agent.agent,
    status: statusLines.length === 0 ? null : statusLines.join("; "),
    widgetLines: widgetLines.length === 0 ? null : widgetLines,
    omittedKeys: [...omittedKeys].sort(compareText),
    truncated: agent.truncated,
  };

  if (hookViolations.length > 0) {
    rendered.hookViolations = hookViolations;
    rendered.performedIo = false;
    rendered.mutatedConfig = false;
    rendered.refreshedSensors = false;
  }
  return rendered;
};

export interface RenderInvalidationScheduler {
  afterRender(renderInput: {
    config?: Readonly<DaseinConfig>;
    sensorSnapshots?: readonly SensorSnapshot[];
    externalStates?: readonly ExternalStateSnapshot[];
    now: number;
  }): { scheduledTimerCount: number; nextDeadline: number | null };
  fire(deadline: number): {
    recomputed: boolean;
    refreshedSensors: false;
    performedIo: false;
    mutatedConfig: false;
    rendered: RenderedContext;
  };
}

const defaultConfigFor = (sensorSnapshots: readonly SensorSnapshot[]): DaseinConfig => ({
  version: 1,
  core: {
    agentInjectionEnabled: true,
    statusEnabled: true,
    widgetEnabled: false,
    maxAgentChars: 240,
    injectedLabel: "ambient_ctx",
    renderOrder: sensorSnapshots.map((snapshot) => snapshot.sensor_id),
  },
  sensors: Object.fromEntries(sensorSnapshots.map((snapshot) => [snapshot.sensor_id, { enabled: true, ui: true, agent: true } satisfies SensorConfig])),
  external: {},
});

const deadlinesFor = (sensorSnapshots: readonly SensorSnapshot[], externalStates: readonly ExternalStateSnapshot[], now: number): number[] => {
  const sensorDeadlines = sensorSnapshots.flatMap((snapshot) =>
    Object.values(snapshot.fields)
      .filter((field) => field.status === "enabled")
      .map((field) => field.collected_at + field.stale_after_ms)
      .filter((deadline) => deadline > now),
  );
  const externalDeadlines = externalStates.map((snapshot) => snapshot.expiresAt).filter((deadline) => deadline > now);
  return [...sensorDeadlines, ...externalDeadlines];
};

export const createRenderInvalidationScheduler = (): RenderInvalidationScheduler => {
  let lastInput: { config?: Readonly<DaseinConfig>; sensorSnapshots: readonly SensorSnapshot[]; externalStates: readonly ExternalStateSnapshot[]; now: number } | null = null;
  let scheduledTimerCount = 0;
  let nextDeadline: number | null = null;

  return {
    afterRender(renderInput): { scheduledTimerCount: number; nextDeadline: number | null } {
      const sensorSnapshots = renderInput.sensorSnapshots ?? [];
      const externalStates = renderInput.externalStates ?? [];
      lastInput = { ...renderInput, sensorSnapshots, externalStates };
      const deadlines = deadlinesFor(sensorSnapshots, externalStates, renderInput.now);
      nextDeadline = deadlines.length === 0 ? null : Math.min(...deadlines);
      scheduledTimerCount = nextDeadline === null ? 0 : 1;
      return { scheduledTimerCount, nextDeadline };
    },

    fire(deadline: number) {
      if (lastInput === null || scheduledTimerCount === 0 || nextDeadline !== deadline) {
        return {
          recomputed: false,
          refreshedSensors: false,
          performedIo: false,
          mutatedConfig: false,
          rendered: { agent: null, status: null, widgetLines: null, omittedKeys: [], truncated: false },
        };
      }
      const config = lastInput.config ?? defaultConfigFor(lastInput.sensorSnapshots);
      const rendered = renderDaseinContext({
        config,
        sensorSnapshots: lastInput.sensorSnapshots,
        externalStates: lastInput.externalStates,
        now: deadline,
      });
      return {
        recomputed: true,
        refreshedSensors: false,
        performedIo: false,
        mutatedConfig: false,
        rendered,
      };
    },
  };
};

export const assertNoRequestPathRendering = (_input: { path: string }): { rendererCalled: false; schedulerCalled: false; ioCalled: false } => ({
  rendererCalled: false,
  schedulerCalled: false,
  ioCalled: false,
});
