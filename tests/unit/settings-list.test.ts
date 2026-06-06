import assert from "node:assert/strict";
import test from "node:test";

import {
  baseConfig,
  builtinClockManifest,
  builtinProvenance,
  lowerSha256,
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
