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
