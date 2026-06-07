import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { baseConfig, loadDaseinApi, requireExportedFunction, withTempDaseinHome } from "../fixtures/helpers/core-fixtures.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const examplesSensorDir = resolve(repoRoot, "examples", "sensors");
const examplesConfigPath = resolve(repoRoot, "examples", "config", "focus.config.json");

test("focus example sensor is loadable as a user-local sensor and example config validates", async () => {
  const api = await loadDaseinApi();
  const loadSensorRegistry = requireExportedFunction(api, "loadSensorRegistry", "examples/sensors/focus.ts user-local sensor example");
  const createConfigManager = requireExportedFunction(api, "createConfigManager", "examples/config/focus.config.json validation");

  const registry = await loadSensorRegistry({
    extensionRoot: resolve(repoRoot, ".example-empty-extension-root"),
    userSensorDirectory: examplesSensorDir,
    cacheBustToken: "example-focus",
  }) as {
    ok: boolean;
    entries: Array<{
      spec: {
        key: string;
        defaults: Record<string, unknown>;
        validateConfig?: (config: Record<string, unknown>) => Array<{ kind: string; path: string; message: string }>;
        actions?: Record<string, unknown>;
      };
    }>;
    loadErrors: unknown[];
  };

  assert.equal(registry.ok, true);
  assert.deepEqual(registry.loadErrors, []);
  assert.deepEqual(registry.entries.map((entry) => entry.spec.key), ["focus"]);
  assert.equal(typeof registry.entries[0]?.spec.actions?.set, "function");

  const focusSpec = registry.entries[0]?.spec;
  const validateFocusConfig = focusSpec?.validateConfig;
  if (focusSpec === undefined || typeof validateFocusConfig !== "function") throw new Error("focus example must expose validateConfig");
  assert.deepEqual(validateFocusConfig({ ...focusSpec.defaults, label: "reviewing docs" }), []);
  for (const label of [123, true, {}]) {
    const nonStringLabelErrors = validateFocusConfig({ ...focusSpec.defaults, label });
    assert.equal(nonStringLabelErrors[0]?.kind, "invalid-value");
    assert.equal(nonStringLabelErrors[0]?.path, "sensors.focus.label");
    assert.match(nonStringLabelErrors[0]?.message ?? "", /must be a string/);
  }

  const exampleConfig = JSON.parse(readFileSync(examplesConfigPath, "utf8")) as { version: 1; sensors: { focus: { label: string } } };
  assert.equal(exampleConfig.version, 1);
  assert.equal(exampleConfig.sensors.focus.label, "debugging");

  await withTempDaseinHome(async ({ configPath }) => {
    const manager = createConfigManager({
      configPath,
      defaults: {
        ...baseConfig,
        sensors: {
          ...baseConfig.sensors,
          focus: registry.entries[0]?.spec.defaults,
        },
      },
      diskConfig: exampleConfig,
      discoveredSensorKeys: ["clock", "geo", "lapse", "focus"],
      sensorSpecs: registry.entries.map((entry) => entry.spec),
    }) as { getStatusErrors(): unknown[]; getEffectiveConfig(): { sensors: { focus: { label: string; enabled: boolean; ui: boolean; agent: boolean } } } };

    assert.deepEqual(manager.getStatusErrors(), []);
    assert.deepEqual(manager.getEffectiveConfig().sensors.focus, {
      enabled: true,
      ui: true,
      agent: true,
      timeoutMs: 2000,
      staleAfterMs: 120000,
      initialRefresh: true,
      label: "debugging",
    });
  });
});
