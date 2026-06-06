import assert from "node:assert/strict";
import test from "node:test";

import {
  baseConfig,
  builtinClockManifest,
  builtinProvenance,
  loadDaseinApi,
  lowerSha256,
  requireExportedFunction,
  riskyRemoteBackgroundWork,
  riskyWeatherManifest,
  userLocalProvenance,
} from "../fixtures/helpers/core-fixtures.ts";
import { buildSettingsListVisibilityModel } from "../../src/ui/settings-import-contract.ts";
import type { SensorInspectabilityMetadata, SensorSpec } from "../../src/index.ts";
import type { SettingsListControlItem, SettingsListVisibilityItem } from "../../src/ui/settings-import-contract.ts";

const weatherDigest = "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

const clockMetadata: SensorInspectabilityMetadata = {
  key: "clock",
  provenance: builtinProvenance,
  manifest: builtinClockManifest,
  backgroundWork: builtinClockManifest.backgroundWork,
  effectiveIntervalMs: 60000,
  manifestDigest: lowerSha256,
  acknowledgedManifestDigest: null,
  acknowledgementRequired: false,
  acknowledgementSatisfied: true,
  defaultEnabled: true,
  effectiveEnabled: true,
};

const weatherMetadata: SensorInspectabilityMetadata = {
  key: "weather",
  provenance: userLocalProvenance,
  manifest: riskyWeatherManifest,
  backgroundWork: riskyRemoteBackgroundWork,
  effectiveIntervalMs: 300000,
  manifestDigest: weatherDigest,
  acknowledgedManifestDigest: null,
  acknowledgementRequired: true,
  acknowledgementSatisfied: false,
  defaultEnabled: true,
  effectiveEnabled: false,
  forcedDisabledReason: "user-added-remote-or-network-and-recurring-work",
};

const weatherSpec: SensorSpec = {
  key: "weather",
  defaults: {
    enabled: true,
    ui: true,
    agent: false,
    intervalMs: 300000,
    unit: "celsius",
    nickname: "outside",
    precision: 2,
    notify: false,
    tags: { home: true },
  },
  manifest: riskyWeatherManifest,
  fields: {
    notify: { label: "Notify", type: "boolean" },
    nickname: { label: "Nickname", type: "string" },
    precision: { label: "Precision", type: "number" },
    unit: { label: "Unit", type: "enum", values: ["celsius", "fahrenheit"] },
    tags: { label: "Tags", type: "object" },
    samples: { label: "Samples", type: "array" },
  },
};

const controls = (items: readonly SettingsListVisibilityItem[]): readonly SettingsListControlItem[] =>
  items.filter((item): item is SettingsListControlItem => item.kind === "control");

const ids = (items: readonly SettingsListVisibilityItem[]): readonly string[] => items.map((item) => item.id);

const controlById = (items: readonly SettingsListVisibilityItem[], id: string): SettingsListControlItem => {
  const found = controls(items).find((item) => item.id === id);
  assert.ok(found, `missing SettingsList control ${id}`);
  return found;
};

test("SettingsList visibility model exposes inspectability metadata before risky enable controls", () => {
  const config = {
    ...baseConfig,
    sensors: {
      ...baseConfig.sensors,
      weather: {
        enabled: true,
        ui: true,
        agent: false,
        intervalMs: 300000,
        acknowledgedManifestDigest: null,
        unit: "celsius",
        nickname: "outside",
        precision: 2,
        notify: false,
        tags: { home: true },
      },
    },
  };

  const items = buildSettingsListVisibilityModel({
    config,
    sensorMetadata: [weatherMetadata],
    sensorSpecs: [weatherSpec],
    externalStates: [],
    now: () => 1000,
  }) as readonly SettingsListVisibilityItem[];
  const itemIds = ids(items);

  for (const metadataId of [
    "sensor.weather.metadata.remote.destinations",
    "sensor.weather.metadata.remote.payloadClasses",
    "sensor.weather.metadata.remote.transmissionCadence",
    "sensor.weather.metadata.remote.disableControl",
    "sensor.weather.metadata.backgroundWork",
    "sensor.weather.metadata.effectiveIntervalMs",
    "sensor.weather.metadata.manifestDigest",
  ]) {
    assert.ok(itemIds.includes(metadataId), `missing SettingsList metadata ${metadataId}`);
    assert.ok(
      itemIds.indexOf(metadataId) < itemIds.indexOf("sensors.weather.enabled"),
      `${metadataId} must appear before the risky enable control`,
    );
  }

  assert.equal(weatherMetadata.effectiveEnabled, false);
  assert.deepEqual(controlById(items, "sensors.weather.enabled").mutationForValue(true), {
    assignments: {
      "sensors.weather.enabled": true,
      "sensors.weather.acknowledgedManifestDigest": weatherDigest,
    },
  });
});

test("SettingsList visibility model exposes core, common sensor, simple sensor, and live external controls only", () => {
  const config = {
    ...baseConfig,
    sensors: {
      ...baseConfig.sensors,
      weather: {
        enabled: false,
        ui: true,
        agent: false,
        intervalMs: 300000,
        unit: "celsius",
        nickname: "outside",
        precision: 2,
        notify: false,
        tags: { home: true },
      },
    },
    external: {
      weather: { ui: true, agent: false },
      "bad.key": { ui: true, agent: true },
    },
  };

  const items = buildSettingsListVisibilityModel({
    config,
    sensorMetadata: [clockMetadata, weatherMetadata],
    sensorSpecs: [weatherSpec],
    externalStates: [
      { key: "calendar", ui: "meeting", agent: null, source: "test", updatedAt: 1000, expiresAt: 61000 },
      { key: "expired", ui: "old", agent: null, source: "test", updatedAt: 1000, expiresAt: 1000 },
      { key: "bad.live", ui: "invalid", agent: null, source: "test", updatedAt: 1000, expiresAt: 61000 },
    ],
    now: () => 2000,
  }) as readonly SettingsListVisibilityItem[];
  const itemIds = ids(items);

  for (const expectedControl of [
    "core.agentInjectionEnabled",
    "core.statusEnabled",
    "core.widgetEnabled",
    "sensors.clock.intervalMs",
    "sensors.weather.enabled",
    "sensors.weather.ui",
    "sensors.weather.agent",
    "sensors.weather.intervalMs",
    "sensors.weather.notify",
    "sensors.weather.nickname",
    "sensors.weather.precision",
    "sensors.weather.unit",
    "external.calendar.ui",
    "external.calendar.agent",
    "external.weather.ui",
    "external.weather.agent",
  ]) {
    assert.ok(itemIds.includes(expectedControl), `missing SettingsList control ${expectedControl}`);
  }

  for (const omittedControl of [
    "sensors.weather.tags",
    "sensors.weather.samples",
    "sensors.geo.tags",
    "sensors.lapse.agentFields",
    "external.bad.key.ui",
    "external.expired.ui",
    "external.bad.live.ui",
  ]) {
    assert.equal(itemIds.includes(omittedControl), false, `SettingsList must omit ${omittedControl}`);
  }

  assert.deepEqual(controlById(items, "external.calendar.agent").mutationForValue(true), {
    assignments: { "external.calendar.agent": true },
  });
});

const builtinGeoManifest = {
  description: "builtin geo",
  declaredInputClasses: ["native_location", "subprocess"],
  outputFields: [
    {
      state_key: "geo.permission",
      value_type: "string",
      description: "CoreLocation permission",
      agentVisibleByDefault: false,
      uiVisibleByDefault: true,
    },
  ],
  permissions: [{ kind: "macos_location", required: true, reason: "CoreLocation helper" }],
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
    description: "local geo refresh",
  },
} satisfies SensorSpec["manifest"];

const geoMetadata: SensorInspectabilityMetadata = {
  key: "geo",
  provenance: builtinProvenance,
  manifest: builtinGeoManifest,
  backgroundWork: builtinGeoManifest.backgroundWork,
  effectiveIntervalMs: 60000,
  manifestDigest: lowerSha256,
  acknowledgedManifestDigest: null,
  acknowledgementRequired: false,
  acknowledgementSatisfied: true,
  defaultEnabled: false,
  effectiveEnabled: false,
};

const geoSpec: SensorSpec = {
  key: "geo",
  defaults: baseConfig.sensors.geo,
  manifest: builtinGeoManifest,
  fields: {
    precision: { label: "Location precision", type: "enum", values: ["city", "district", "street", "exact"] },
    tags: { label: "Location tags", type: "object", actionManaged: true },
    exactAddress: { label: "Include exact address", type: "boolean" },
    exactCoordinates: { label: "Include exact coordinates", type: "boolean" },
  },
};

test("SettingsList user sensor simple field mutationForValue proposals apply through ConfigManager", async () => {
  const api = await loadDaseinApi();
  const createConfigManager = requireExportedFunction(api, "createConfigManager", "W12 SettingsList mutationForValue ConfigManager proof");
  const config = {
    ...baseConfig,
    sensors: {
      ...baseConfig.sensors,
      weather: {
        enabled: false,
        ui: true,
        agent: false,
        intervalMs: 300000,
        unit: "celsius",
        nickname: "outside",
        precision: 2,
        notify: false,
        tags: { home: true },
      },
    },
  };
  const items = buildSettingsListVisibilityModel({
    config,
    sensorMetadata: [weatherMetadata],
    sensorSpecs: [weatherSpec],
    externalStates: [],
    now: () => 2000,
  }) as readonly SettingsListVisibilityItem[];
  const manager = createConfigManager({ defaults: config, discoveredSensorKeys: ["clock", "geo", "lapse", "weather"], sensorSpecs: [weatherSpec] }) as {
    applyRuntimeProposal(proposal: ReturnType<SettingsListControlItem["mutationForValue"]>): Promise<{ ok: boolean; errors?: unknown[] }>;
    getEffectiveConfig(): typeof config;
  };

  for (const [id, value] of [
    ["sensors.weather.unit", "fahrenheit"],
    ["sensors.weather.nickname", "patio"],
    ["sensors.weather.precision", 3],
    ["sensors.weather.notify", true],
  ] as const) {
    const control = controlById(items, id);
    assert.equal(control.mutationBackend, "ConfigManager");
    const result = await manager.applyRuntimeProposal(control.mutationForValue(value));
    assert.equal(result.ok, true, `${id}=${String(value)} should apply through ConfigManager; errors=${JSON.stringify(result.errors)}`);
  }

  const effective = manager.getEffectiveConfig();
  assert.equal(effective.sensors.weather.unit, "fahrenheit");
  assert.equal(effective.sensors.weather.nickname, "patio");
  assert.equal(effective.sensors.weather.precision, 3);
  assert.equal(effective.sensors.weather.notify, true);
});

test("[expected-red] SettingsList exposes complete common sensor controls and recurring interval controls", () => {
  const items = buildSettingsListVisibilityModel({
    config: baseConfig,
    sensorMetadata: [clockMetadata, geoMetadata],
    sensorSpecs: [geoSpec],
    externalStates: [],
    now: () => 2000,
  }) as readonly SettingsListVisibilityItem[];
  const itemIds = ids(items);

  for (const sensorKey of ["clock", "geo"] as const) {
    for (const commonField of ["enabled", "ui", "agent", "intervalMs", "timeoutMs", "staleAfterMs", "initialRefresh"] as const) {
      assert.ok(
        itemIds.includes(`sensors.${sensorKey}.${commonField}`),
        `missing SettingsList common control sensors.${sensorKey}.${commonField}`,
      );
    }
    assert.ok(itemIds.includes(`sensor.${sensorKey}.metadata.effectiveIntervalMs`));
    assert.equal(controlById(items, `sensors.${sensorKey}.intervalMs`).valueType, "number");
  }
});

test("[expected-red] SettingsList control mutations route through ConfigManager rather than direct patches", () => {
  const items = buildSettingsListVisibilityModel({
    config: baseConfig,
    sensorMetadata: [clockMetadata],
    sensorSpecs: [],
    externalStates: [],
    now: () => 2000,
  }) as readonly SettingsListVisibilityItem[];
  const intervalControl = controlById(items, "sensors.clock.intervalMs") as SettingsListControlItem & {
    readonly mutationBackend?: string;
  };

  assert.equal(intervalControl.mutationBackend, "ConfigManager");
  assert.deepEqual(intervalControl.mutationForValue(120000), {
    backend: "ConfigManager",
    assignments: { "sensors.clock.intervalMs": 120000 },
  });
});

test("[expected-red] SettingsList omits malformed external state while preserving valid ui/agent defaults", () => {
  const items = buildSettingsListVisibilityModel({
    config: baseConfig,
    sensorMetadata: [],
    sensorSpecs: [],
    externalStates: [
      { key: "alerts", ui: "storm watch", agent: null, source: "fixture", updatedAt: 1000, expiresAt: 61000 },
      { key: "malformed", ui: "line one\nline two", agent: null, source: "fixture", updatedAt: 1000, expiresAt: 61000 },
      { key: "bad.key", ui: "bad", agent: null, source: "fixture", updatedAt: 1000, expiresAt: 61000 },
      { key: "expired", ui: "old", agent: null, source: "fixture", updatedAt: 1000, expiresAt: 1000 },
    ],
    now: () => 2000,
  }) as readonly SettingsListVisibilityItem[];
  const itemIds = ids(items);

  assert.equal(controlById(items, "external.alerts.ui").value, true);
  assert.equal(controlById(items, "external.alerts.agent").value, false);
  assert.equal(itemIds.includes("external.malformed.ui"), false);
  assert.equal(itemIds.includes("external.bad.key.ui"), false);
  assert.equal(itemIds.includes("external.expired.ui"), false);
});

test("SettingsList exposes geo exact privacy controls but omits geo tags as a flat control", () => {
  const items = buildSettingsListVisibilityModel({
    config: baseConfig,
    sensorMetadata: [geoMetadata],
    sensorSpecs: [geoSpec],
    externalStates: [],
    now: () => 2000,
  }) as readonly SettingsListVisibilityItem[];
  const itemIds = ids(items);

  assert.ok(itemIds.includes("sensors.geo.exactCoordinates"));
  assert.ok(itemIds.includes("sensors.geo.exactAddress"));
  assert.equal(itemIds.includes("sensors.geo.tags"), false);
});
