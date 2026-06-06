import assert from "node:assert/strict";
import test from "node:test";

import { baseConfig, loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("successful reload reapplies launch overlays except runtime overridden paths", async () => {
  const api = await loadDaseinApi();
  const reloadDaseinRuntime = requireExportedFunction(api, "reloadDaseinRuntime", "Testing Gate Matrix row: Sensor export, install modes, provenance, and reload all-or-keep-old");
  const result = await reloadDaseinRuntime({
    previousConfig: baseConfig,
    diskConfig: { version: 1, sensors: { clock: { precision: "hour" } } },
    launchAssignments: [{ canonicalPath: "sensors.geo.agent", value: true }, { canonicalPath: "sensors.clock.precision", value: "minute" }],
    runtimeOverriddenPaths: ["sensors.clock.precision"],
    candidateSensorsOk: true,
  }) as { ok: boolean; data: { launchReappliedPaths: string[]; runtimeOverriddenPaths: string[]; reload: { ok: boolean } }; message: string };

  assert.equal(result.ok, true);
  assert.equal(result.data.reload.ok, true);
  assert.deepEqual(result.data.launchReappliedPaths, ["sensors.geo.agent"]);
  assert.deepEqual(result.data.runtimeOverriddenPaths, ["sensors.clock.precision"]);
  assert.equal(result.message, "dasein reload: ok (3 sensors)");
});

test("reload result preserves ConfigManager launchReappliedPaths metadata", async () => {
  const api = await loadDaseinApi();
  const reloadDaseinRuntime = requireExportedFunction(api, "reloadDaseinRuntime", "docs/TECHNICAL_DESIGN.md#sensor-loading-and-reload/manual-reload launchReappliedPaths binding");
  const result = await reloadDaseinRuntime({
    previousConfig: baseConfig,
    diskConfig: { version: 1 },
    launchAssignments: [{ canonicalPath: "sensors.clock.precision", value: "hour" }],
    launchReappliedPaths: ["sensors.geo.agent"],
    runtimeOverriddenPaths: ["sensors.clock.precision"],
    candidateSensorsOk: true,
  }) as { data: { launchReappliedPaths: string[]; reload: { ok: boolean; launchReappliedPaths: string[]; config: { updatedPaths: string[] } } } };

  assert.equal(result.data.reload.ok, true);
  assert.deepEqual(result.data.launchReappliedPaths, ["sensors.geo.agent"]);
  assert.deepEqual(result.data.reload.launchReappliedPaths, ["sensors.geo.agent"]);
  assert.deepEqual(result.data.reload.config.updatedPaths, ["sensors.geo.agent"]);
});

test("failed reload keeps old config, registry, runtime overrides, rendered context, and exposes keep-old fields", async () => {
  const api = await loadDaseinApi();
  const reloadDaseinRuntime = requireExportedFunction(api, "reloadDaseinRuntime", "Testing Gate Matrix row: Sensor export, install modes, provenance, and reload all-or-keep-old");
  const oldRendered = { agent: "[ambient_ctx: time=old]", status: "old", widgetLines: null, omittedKeys: [], truncated: false };
  const result = await reloadDaseinRuntime({ previousConfig: baseConfig, previousRendered: oldRendered, diskConfig: { version: 2 }, candidateSensorsOk: false, runtimeOverriddenPaths: ["sensors.clock.precision"] }) as {
    ok: boolean;
    message: string;
    data: { reload: { ok: boolean; keptPreviousState: boolean }; launchReappliedPaths: string[]; runtimeOverriddenPaths: string[]; rendered: unknown };
    errors: unknown[];
  };

  assert.equal(result.ok, false);
  assert.equal(result.message, "dasein reload: failed; kept previous state");
  assert.equal(result.data.reload.ok, false);
  assert.equal(result.data.reload.keptPreviousState, true);
  assert.deepEqual(result.data.runtimeOverriddenPaths, ["sensors.clock.precision"]);
  assert.deepEqual(result.data.rendered, oldRendered);
  assert.match(JSON.stringify(result.errors), /invalid-schema|invalid-spec|SensorLoadError/u);
});

test("sensor reload failure returns actual SensorLoadError records instead of a synthetic ok result", async () => {
  const api = await loadDaseinApi();
  const reloadDaseinRuntime = requireExportedFunction(api, "reloadDaseinRuntime", "Testing Gate Matrix row: Sensor export, install modes, provenance, and reload all-or-keep-old");
  const oldRendered = { agent: "[ambient_ctx: dynamic=v2]", status: "dynamic v2", widgetLines: null, omittedKeys: [], truncated: false };
  const sensorError = { file: "/extension/src/sensors/dynamic.ts", kind: "import", message: "SensorLoadError: failed to import sensor module: syntax" };
  const result = await reloadDaseinRuntime({
    previousConfig: baseConfig,
    previousRendered: oldRendered,
    diskConfig: { version: 1 },
    candidateSensorsOk: false,
    candidateSensorErrors: [sensorError],
    attemptedFiles: [sensorError.file],
    activeKeys: ["clock", "geo", "lapse"],
  }) as {
    ok: boolean;
    data: { reload: { ok: boolean; failureScope: string; activeKeys: string[]; sensors: { ok: boolean; errors: unknown[] } }; rendered: unknown };
    errors: unknown[];
  };

  assert.equal(result.ok, false);
  assert.equal(result.data.reload.ok, false);
  assert.equal(result.data.reload.failureScope, "sensors");
  assert.deepEqual(result.data.reload.activeKeys, ["clock", "geo", "lapse"]);
  assert.deepEqual(result.data.reload.sensors.errors, [sensorError]);
  assert.deepEqual(result.errors, [sensorError]);
  assert.deepEqual(result.data.rendered, oldRendered);
});
