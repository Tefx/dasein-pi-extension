import assert from "node:assert/strict";
import test from "node:test";

import { baseConfig, loadDaseinApi, lowerSha256, requireExportedFunction, riskyWeatherManifest, withTempDaseinHome } from "../fixtures/helpers/core-fixtures.ts";
import type { SensorSpec } from "../../src/index.ts";

type ConfigHarness = {
  getEffectiveConfig(): unknown;
  getRuntimeOverriddenPaths(): string[];
  getStatusErrors(): unknown[];
  parseLaunchAssignments(input: string): { ok: boolean; assignments?: Array<{ inputPath: string; canonicalPath: string; value: unknown }>; errors?: unknown[] };
  setRuntime(path: string, value: unknown): Promise<{ ok: boolean; updatedPaths?: string[]; deletedPaths?: string[]; errors?: unknown[] }>;
  applyRuntime(assignments: Record<string, unknown>): Promise<{ ok: boolean; updatedPaths?: string[]; deletedPaths?: string[]; errors?: unknown[] }>;
  applyRuntimeProposal(proposal: { backend?: "ConfigManager"; assignments?: Record<string, unknown>; deletePaths?: string[] }): Promise<{ ok: boolean; updatedPaths?: string[]; deletedPaths?: string[]; errors?: unknown[] }>;
  reloadDisk(): Promise<{ ok: boolean; launchReappliedPaths?: string[]; runtimeOverriddenPaths?: string[] }>;
};

const loadBuiltinSpecs = async (): Promise<SensorSpec[]> => {
  const [clock, geo, lapse] = await Promise.all([
    import("../../src/sensors/clock.ts"),
    import("../../src/sensors/geo.ts"),
    import("../../src/sensors/lapse.ts"),
  ]);
  return [clock.default, geo.default, lapse.default] as SensorSpec[];
};

test("config manager composes defaults < disk < launch < runtime with canonical path persistence", async () => {
  const api = await loadDaseinApi();
  const createConfigManager = requireExportedFunction(api, "createConfigManager", "Testing Gate Matrix row: Config precedence and key/path validation");

  await withTempDaseinHome(async ({ configPath }) => {
    const manager = createConfigManager({
      configPath,
      defaults: baseConfig,
      diskConfig: {
        version: 1,
        sensors: { clock: { precision: "hour" }, geo: { agent: false } },
        external: { weather: { ui: true, agent: false } },
      },
      launch: "geo.agent=on,clock.precision=minute,external.weather.agent=true",
      discoveredSensorKeys: ["clock", "geo", "lapse"],
    }) as ConfigHarness;

    assert.deepEqual(manager.getRuntimeOverriddenPaths(), []);
    assert.deepEqual(manager.getStatusErrors(), []);
    assert.deepEqual(manager.getEffectiveConfig(), {
      ...baseConfig,
      sensors: {
        ...baseConfig.sensors,
        clock: { ...baseConfig.sensors.clock, precision: "minute" },
        geo: { ...baseConfig.sensors.geo, agent: true },
      },
      external: { weather: { ui: true, agent: true } },
    });

    const mutation = await manager.setRuntime("clock.precision", "date");
    assert.deepEqual(mutation, { ok: true, updatedPaths: ["sensors.clock.precision"], deletedPaths: [] });
    assert.deepEqual(manager.getRuntimeOverriddenPaths(), ["sensors.clock.precision"]);
    assert.equal((manager.getEffectiveConfig() as typeof baseConfig).sensors.clock.precision, "date");
  });
});

test("config validation enforces documented scalar boundaries and key grammar", async () => {
  const api = await loadDaseinApi();
  const validateConfigAssignment = requireExportedFunction(api, "validateConfigAssignment", "Testing Gate Matrix row: Config precedence and key/path validation");

  const cases = [
    ["core.maxAgentChars", 40, true],
    ["core.maxAgentChars", 240, true],
    ["core.maxAgentChars", 2000, true],
    ["core.maxAgentChars", 39, false],
    ["core.maxAgentChars", 2001, false],
    ["core.maxAgentChars", 40.5, false],
    ["core.injectedLabel", "abc.DEF-12:ok", true],
    ["core.injectedLabel", "", false],
    ["core.injectedLabel", "has space", false],
    ["core.injectedLabel", "bad/control\u0000", false],
    ["core.injectedLabel", "toolong_123456789012345678901234567890", false],
    ["core.injectedLabel", "bad/slash", false],
    ["sensors.clock.precision", "hour", true],
    ["sensors.clock.precision", "bogus", false],
    ["sensors.geo.precision", "street", true],
    ["sensors.geo.precision", "bogus", false],
    ["sensors.geo.exactCoordinates", false, true],
    ["sensors.geo.exactAddress", false, true],
    ["sensors.geo.exactCoordinates", "false", false],
    ["sensors.lapse.agentFields", ["user_idle", "agent_idle"], true],
    ["sensors.lapse.agentFields", ["user_idle", "previous_run"], false],
    ["sensors.weather.alert.agent", true, false],
    ["external.weather.agent", true, true],
    ["external.weather.alert.agent", true, false],
    ["sensors.weather.acknowledgedManifestDigest", lowerSha256, true],
    ["sensors.weather.acknowledgedManifestDigest", lowerSha256.toUpperCase(), false],
  ] as const;

  for (const [path, value, ok] of cases) {
    assert.equal(validateConfigAssignment(path, value, { config: baseConfig, discoveredSensorKeys: ["clock", "geo", "lapse", "weather"] }), ok, `${path}=${String(value)}`);
  }
});

test("ConfigManager consumes SensorSpec validation for builtin clock/geo/lapse enum fields", async () => {
  const api = await loadDaseinApi();
  const createConfigManager = requireExportedFunction(api, "createConfigManager", "W6 ConfigManager SensorSpec.validateConfig consumption");
  const sensorSpecs = await loadBuiltinSpecs();
  const manager = createConfigManager({ defaults: baseConfig, discoveredSensorKeys: ["clock", "geo", "lapse"], sensorSpecs }) as ConfigHarness;

  const invalidClock = await manager.applyRuntime({ "sensors.clock.precision": "bogus" });
  assert.equal(invalidClock.ok, false, "applyRuntime({'sensors.clock.precision':'bogus'}) must fail");
  assert.match(JSON.stringify(invalidClock.errors), /clock\.precision|exact, minute, hour, period, date/u);
  assert.equal((manager.getEffectiveConfig() as typeof baseConfig).sensors.clock.precision, "minute");

  const invalidGeo = await manager.applyRuntime({ "sensors.geo.precision": "block" });
  assert.equal(invalidGeo.ok, false, "geo precision enum must fail through ConfigManager");
  assert.match(JSON.stringify(invalidGeo.errors), /geo\.precision|city, district, street, exact/u);

  const invalidLapse = await manager.applyRuntime({ "sensors.lapse.agentFields": ["user_idle", "previous_run"] });
  assert.equal(invalidLapse.ok, false, "lapse agentFields enum array must fail through ConfigManager");
  assert.match(JSON.stringify(invalidLapse.errors), /agentFields|user_idle|agent_idle/u);
});

test("SettingsList simple user sensor controls apply through ConfigManager validation", async () => {
  const api = await loadDaseinApi();
  const createConfigManager = requireExportedFunction(api, "createConfigManager", "W12 user sensor simple SettingsList mutation acceptance");
  const weatherSpec: SensorSpec = {
    key: "weather",
    defaults: {
      enabled: false,
      ui: true,
      agent: false,
      intervalMs: 300000,
      unit: "celsius",
      nickname: "outside",
      precision: 2,
      notify: false,
    },
    manifest: riskyWeatherManifest,
    fields: {
      notify: { label: "Notify", type: "boolean" },
      nickname: { label: "Nickname", type: "string" },
      precision: { label: "Precision", type: "number" },
      unit: { label: "Unit", type: "enum", values: ["celsius", "fahrenheit"] },
    },
  };
  const defaults = {
    ...baseConfig,
    core: { ...baseConfig.core, renderOrder: [...baseConfig.core.renderOrder, "weather"] },
    sensors: { ...baseConfig.sensors, weather: weatherSpec.defaults },
  };
  const manager = createConfigManager({ defaults, discoveredSensorKeys: ["clock", "geo", "lapse", "weather"], sensorSpecs: [...(await loadBuiltinSpecs()), weatherSpec] }) as ConfigHarness;

  for (const proposal of [
    { backend: "ConfigManager" as const, assignments: { "sensors.weather.unit": "fahrenheit" } },
    { backend: "ConfigManager" as const, assignments: { "sensors.weather.nickname": "patio" } },
    { backend: "ConfigManager" as const, assignments: { "sensors.weather.precision": 3 } },
    { backend: "ConfigManager" as const, assignments: { "sensors.weather.notify": true } },
  ]) {
    const result = await manager.applyRuntimeProposal(proposal);
    assert.equal(result.ok, true, `${JSON.stringify(proposal.assignments)} should apply through ConfigManager`);
  }

  const effective = manager.getEffectiveConfig() as typeof defaults;
  assert.equal(effective.sensors.weather.unit, "fahrenheit");
  assert.equal(effective.sensors.weather.nickname, "patio");
  assert.equal(effective.sensors.weather.precision, 3);
  assert.equal(effective.sensors.weather.notify, true);

  const invalidEnum = await manager.applyRuntime({ "sensors.weather.unit": "kelvin" });
  assert.equal(invalidEnum.ok, false, "user sensor enum controls must reject values outside loaded SensorFieldSpec.values");
});

test("malformed disk and launch overlays are all-or-nothing and never mutate config", async () => {
  const api = await loadDaseinApi();
  const createConfigManager = requireExportedFunction(api, "createConfigManager", "Testing Gate Matrix row: Config precedence and key/path validation");
  const manager = createConfigManager({ defaults: baseConfig, diskConfig: { sensors: { clock: { precision: "hour" } } }, launch: "geo.agent=on,geo.agent=off" }) as ConfigHarness;

  assert.deepEqual(manager.getEffectiveConfig(), baseConfig);
  assert.match(JSON.stringify(manager.getStatusErrors()), /version|duplicate-path|launch/u);
});
