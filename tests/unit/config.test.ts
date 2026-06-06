import assert from "node:assert/strict";
import test from "node:test";

import { baseConfig, loadDaseinApi, lowerSha256, requireExportedFunction, withTempDaseinHome } from "../fixtures/helpers/core-fixtures.ts";

type ConfigHarness = {
  getEffectiveConfig(): unknown;
  getRuntimeOverriddenPaths(): string[];
  getStatusErrors(): unknown[];
  parseLaunchAssignments(input: string): { ok: boolean; assignments?: Array<{ inputPath: string; canonicalPath: string; value: unknown }>; errors?: unknown[] };
  setRuntime(path: string, value: unknown): Promise<{ ok: boolean; updatedPaths?: string[]; deletedPaths?: string[]; errors?: unknown[] }>;
  reloadDisk(): Promise<{ ok: boolean; launchReappliedPaths?: string[]; runtimeOverriddenPaths?: string[] }>;
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
    ["sensors.geo.exactCoordinates", false, true],
    ["sensors.geo.exactAddress", false, true],
    ["sensors.geo.exactCoordinates", "false", false],
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

test("malformed disk and launch overlays are all-or-nothing and never mutate config", async () => {
  const api = await loadDaseinApi();
  const createConfigManager = requireExportedFunction(api, "createConfigManager", "Testing Gate Matrix row: Config precedence and key/path validation");
  const manager = createConfigManager({ defaults: baseConfig, diskConfig: { sensors: { clock: { precision: "hour" } } }, launch: "geo.agent=on,geo.agent=off" }) as ConfigHarness;

  assert.deepEqual(manager.getEffectiveConfig(), baseConfig);
  assert.match(JSON.stringify(manager.getStatusErrors()), /version|duplicate-path|launch/u);
});
