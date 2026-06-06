import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AmbientContextMessage,
  DaseinConfig,
  DaseinStateStore,
  ExternalStateSetEvent,
  RenderedContext,
  SensorManifest,
  SensorRegistryProvenance,
  SensorSnapshot,
  SensorStateField,
} from "../../../src/index.ts";
import type { StatusCommandData, SensorsCommandData } from "../../../src/index.ts";

export type DaseinModuleApi = Record<string, unknown>;
export type UnknownFunction = (...args: unknown[]) => unknown;

export const loadDaseinApi = async (): Promise<DaseinModuleApi> => (await import("../../../src/index.ts")) as DaseinModuleApi;

export const requireExportedFunction = <T extends UnknownFunction>(
  api: DaseinModuleApi,
  exportName: string,
  designRow: string,
): T => {
  assert.equal(
    typeof api[exportName],
    "function",
    `${exportName} must be exported and implement ${designRow}`,
  );
  return api[exportName] as T;
};

export const assertSingleLine = (value: string, label: string): void => {
  assert.doesNotMatch(value, /[\r\n\u2028\u2029]/u, `${label} must be a single-line deterministic string`);
};

export const withTempDaseinHome = async <T>(run: (paths: { root: string; configPath: string; statePath: string }) => Promise<T> | T): Promise<T> => {
  const root = mkdtempSync(join(tmpdir(), "dasein-core-red-"));
  try {
    return await run({
      root,
      configPath: join(root, ".pi", "dasein", "config.json"),
      statePath: join(root, ".pi", "dasein", "state.json"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

export const lowerSha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export const noRemoteBehavior = {
  capable: false,
  contactsNetworkByDefault: false,
  destinations: [],
  payloadClasses: [],
  transmissionCadence: "none",
  disableControl: "none",
  description: "none",
} as const;

export const noBackgroundWork = {
  capable: false,
  kinds: [],
  defaultIntervalMs: null,
  intervalRelationship: "none",
  description: "none",
} as const;

export const builtinBackgroundWork = {
  capable: true,
  kinds: ["initial_refresh", "recurring_interval"],
  defaultIntervalMs: 60000,
  intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
  description: "local clock cadence",
} as const;

export const riskyRemoteBackgroundWork = {
  capable: true,
  kinds: ["recurring_interval"],
  defaultIntervalMs: 300000,
  intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
  description: "polls a remote weather API",
} as const;

export const builtinClockManifest: SensorManifest = {
  description: "local clock",
  declaredInputClasses: ["time"],
  outputFields: [
    {
      state_key: "clock.local_time",
      value_type: "string",
      description: "formatted local time",
      agentVisibleByDefault: true,
      uiVisibleByDefault: true,
    },
  ],
  permissions: [{ kind: "none", required: false, reason: "local time only" }],
  remote: noRemoteBehavior,
  backgroundWork: builtinBackgroundWork,
};

export const riskyWeatherManifest: SensorManifest = {
  description: "user weather",
  declaredInputClasses: ["network"],
  outputFields: [
    {
      state_key: "weather.summary",
      value_type: "string",
      description: "weather summary",
      agentVisibleByDefault: false,
      uiVisibleByDefault: true,
    },
  ],
  permissions: [{ kind: "network", required: true, reason: "calls weather.example" }],
  remote: {
    capable: true,
    contactsNetworkByDefault: true,
    destinations: ["https://weather.example"],
    payloadClasses: ["approximate-location"],
    transmissionCadence: "interval",
    disableControl: "sensor.enabled",
    description: "remote weather polling",
  },
  backgroundWork: riskyRemoteBackgroundWork,
};

export const builtinProvenance: SensorRegistryProvenance = { kind: "builtin" };
export const userLocalProvenance: SensorRegistryProvenance = {
  kind: "user_added_local_file",
  filePath: "/extension/src/sensors/weather.ts",
};

export const baseConfig: DaseinConfig = {
  version: 1,
  core: {
    agentInjectionEnabled: true,
    statusEnabled: true,
    widgetEnabled: false,
    maxAgentChars: 240,
    injectedLabel: "ambient_ctx",
    renderOrder: ["clock", "lapse", "geo"],
  },
  sensors: {
    clock: {
      enabled: true,
      ui: true,
      agent: true,
      intervalMs: 60000,
      timeoutMs: 2000,
      staleAfterMs: 120000,
      initialRefresh: true,
      precision: "minute",
    },
    geo: {
      enabled: false,
      ui: true,
      agent: false,
      intervalMs: 60000,
      timeoutMs: 3000,
      staleAfterMs: 1800000,
      initialRefresh: true,
      precision: "city",
      tags: {},
      exactAddress: false,
      exactCoordinates: false,
    },
    lapse: {
      enabled: true,
      ui: true,
      agent: true,
      intervalMs: 60000,
      timeoutMs: 2000,
      staleAfterMs: 120000,
      initialRefresh: true,
      persist: true,
      agentFields: ["user_idle"],
    },
  },
  external: {},
};

export const clockField = (overrides: Partial<SensorStateField> = {}): SensorStateField => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: "clock",
  state_key: "clock.local_time",
  value: "Fri_14:32+08",
  value_type: "string",
  collected_at: 1_000,
  stale_after_ms: 120_000,
  status: "enabled",
  source: { sensor_id: "clock", source_kind: "builtin" },
  ...overrides,
});

export const clockSnapshot = (overrides: Partial<SensorSnapshot> = {}): SensorSnapshot => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: "clock",
  fields: { "clock.local_time": clockField() },
  collected_at: 1_000,
  stale_after_ms: 120_000,
  status: "enabled",
  source: { sensor_id: "clock", source_kind: "builtin" },
  ...overrides,
});

export const externalWeather: ExternalStateSetEvent = {
  key: "weather",
  ui: "dry and bright",
  agent: "dry",
  ttlMs: 60_000,
  source: "fixture",
};

export const renderedContext: RenderedContext = {
  agent: "[ambient_ctx: time=Fri_14:32+08]",
  status: "time Fri 14:32 +08",
  widgetLines: ["time Fri 14:32 +08"],
  omittedKeys: [],
  truncated: false,
};

export const fakeStore = (rendered: RenderedContext = renderedContext): DaseinStateStore => ({
  getSensorSnapshot: () => clockSnapshot(),
  setSensorSnapshot: () => undefined,
  clearSensorSnapshot: () => undefined,
  listSensorSnapshots: () => [clockSnapshot()],
  getExternalState: () => null,
  setExternalState: () => undefined,
  clearExternalState: () => undefined,
  listExternalStates: () => [],
  getRenderedContext: () => rendered,
  setRenderedContext: () => undefined,
  getRenderedAgentString: () => rendered.agent,
  setRenderedAgentString: () => undefined,
  getRenderedStatusString: () => rendered.status,
  setRenderedStatusString: () => undefined,
  getRenderedWidgetLines: () => rendered.widgetLines,
  setRenderedWidgetLines: () => undefined,
});

export const expectedAmbientMessage = (content = renderedContext.agent ?? "[ambient_ctx: none]"): AmbientContextMessage => ({
  role: "custom",
  customType: "dasein",
  content,
  display: false,
  timestamp: 1_700_000_000_000,
});

export const expectedStatusData = (configPath = "~/.pi/dasein/config.json", statePath = "~/.pi/dasein/state.json"): StatusCommandData => ({
  piVersion: null,
  minimumPiVersion: "0.78.1",
  piMechanisms: [
    {
      mechanism: "pi.registerCommand",
      evidenceStatuses: ["SOURCE_VERIFIED", "LIVE_SMOKE_VERIFIED"],
      observedBehavior: "live Pi smoke ledger pi.registerCommand./dasein=PROVEN",
      verificationDate: "2026-06-06",
    },
  ],
  configPath,
  statePath,
  effectiveConfigVersion: 1,
  activeSensors: ["clock", "lapse"],
  disabledSensors: ["geo", "weather"],
  hiddenContributors: [
    {
      key: "weather",
      kind: "sensor",
      enabled: false,
      uiVisible: true,
      agentVisible: false,
      hiddenReason: "disabled",
    },
  ],
  effectiveLapseControls: { enabled: true, persist: true, agent: true, agentFields: ["user_idle"] },
  rendered: { omittedKeys: ["geo"], truncated: false },
  permissions: [
    {
      key: "geo",
      permission: "not_determined",
      freshness: "missing",
      health: "disabled",
      checkedAt: null,
    },
  ],
  sensorMetadata: [
    {
      key: "clock",
      provenance: builtinProvenance,
      manifest: builtinClockManifest,
      backgroundWork: builtinBackgroundWork,
      effectiveIntervalMs: 60000,
      manifestDigest: lowerSha256,
      acknowledgedManifestDigest: null,
      acknowledgementRequired: false,
      acknowledgementSatisfied: true,
      defaultEnabled: true,
      effectiveEnabled: true,
    },
    {
      key: "weather",
      provenance: userLocalProvenance,
      manifest: riskyWeatherManifest,
      backgroundWork: riskyRemoteBackgroundWork,
      effectiveIntervalMs: 300000,
      manifestDigest: lowerSha256,
      acknowledgedManifestDigest: null,
      acknowledgementRequired: true,
      acknowledgementSatisfied: false,
      defaultEnabled: true,
      effectiveEnabled: false,
      forcedDisabledReason: "user-added-remote-or-network-and-recurring-work",
    },
  ],
  loadErrors: [],
  statusErrors: [],
  launchArgsApplied: false,
  diskConfigLoaded: false,
  durableState: {
    statePath,
    stateFileLoaded: false,
    lapse: null,
  },
});

export const expectedSensorsData = (): SensorsCommandData => ({
  sensors: [
    {
      key: "clock",
      loaded: true,
      enabled: true,
      status: "enabled",
      collectedAt: 1_000,
      stale: false,
      actions: [],
      provenance: builtinProvenance,
      manifest: builtinClockManifest,
      backgroundWork: builtinBackgroundWork,
      effectiveIntervalMs: 60000,
      manifestDigest: lowerSha256,
      acknowledgedManifestDigest: null,
      acknowledgementRequired: false,
      acknowledgementSatisfied: true,
    },
    {
      key: "weather",
      loaded: true,
      enabled: false,
      status: "disabled",
      collectedAt: null,
      stale: false,
      actions: ["refresh"],
      provenance: userLocalProvenance,
      manifest: riskyWeatherManifest,
      backgroundWork: riskyRemoteBackgroundWork,
      effectiveIntervalMs: 300000,
      manifestDigest: lowerSha256,
      acknowledgedManifestDigest: null,
      acknowledgementRequired: true,
      acknowledgementSatisfied: false,
      forcedDisabledReason: "user-added-remote-or-network-and-recurring-work",
    },
    {
      key: "bad_sensor_file.ts",
      loaded: false,
      enabled: false,
      status: "error",
      collectedAt: null,
      stale: false,
      actions: [],
      effectiveIntervalMs: null,
      loadError: {
        file: "/extension/src/sensors/bad_sensor_file.ts",
        kind: "invalid-spec",
        message: "missing manifest",
      },
    },
  ],
  loadErrors: [
    {
      file: "/extension/src/sensors/bad_sensor_file.ts",
      kind: "invalid-spec",
      message: "missing manifest",
    },
  ],
});
