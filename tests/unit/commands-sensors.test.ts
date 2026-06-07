import assert from "node:assert/strict";
import test from "node:test";

import { assertSingleLine, expectedSensorsData, loadDaseinApi, lowerSha256, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("/dasein sensors lists loaded records and split load errors with deterministic command text", async () => {
  const api = await loadDaseinApi();
  const buildSensorsCommandResult = requireExportedFunction(api, "buildSensorsCommandResult", "Testing Gate Matrix row: Status and sensors command payloads");
  const result = buildSensorsCommandResult({ fixture: expectedSensorsData() }) as { ok: boolean; command: string; message: string; data: ReturnType<typeof expectedSensorsData> };

  assert.equal(result.ok, true);
  assert.equal(result.command, "sensors");
  assert.match(result.message, /^dasein sensors:/u);
  assertSingleLine(result.message, "sensors message");
  assert.deepEqual(result.data.sensors.map((sensor) => [sensor.key, sensor.loaded, sensor.enabled, sensor.status]), [
    ["clock", true, true, "enabled"],
    ["weather", true, false, "disabled"],
  ]);
  assert.equal(result.data.sensors.some((sensor) => sensor.loaded === false), false, "load-failed files are reported in data.loadErrors, not data.sensors");
  assert.match(JSON.stringify(result.data.loadErrors), /bad_sensor_file\.ts.*invalid-spec/u);
});

test("/dasein sensors exposes provenance, manifest inspectability, permissions, remote/background behavior, and effective intervals", async () => {
  const api = await loadDaseinApi();
  const buildSensorsCommandResult = requireExportedFunction(api, "buildSensorsCommandResult", "Testing Gate Matrix row: Status and sensors command payloads");
  const result = buildSensorsCommandResult({ fixture: expectedSensorsData() }) as { data: ReturnType<typeof expectedSensorsData>; message: string };
  const weather = result.data.sensors.find((entry) => entry.key === "weather");

  assert.ok(weather);
  assert.deepEqual(weather.provenance, { kind: "user_added_local_file", filePath: "/extension/src/sensors/weather.ts" });
  assert.deepEqual(weather.manifest?.declaredInputClasses, ["network"]);
  assert.deepEqual(weather.manifest?.outputFields.map((field) => field.state_key), ["weather.summary"]);
  assert.deepEqual(weather.manifest?.permissions, [{ kind: "network", required: true, reason: "calls weather.example" }]);
  assert.deepEqual(weather.manifest?.remote.destinations, ["https://weather.example"]);
  assert.deepEqual(weather.manifest?.remote.payloadClasses, ["approximate-location"]);
  assert.equal(weather.manifest?.remote.transmissionCadence, "interval");
  assert.equal(weather.manifest?.remote.disableControl, "sensor.enabled");
  assert.deepEqual(weather.backgroundWork?.kinds, ["recurring_interval"]);
  assert.equal(weather.effectiveIntervalMs, 300000);
  assert.match(result.message, /trusted executable code|not sandboxed/u);
});

test("/dasein sensors exposes acknowledgement and forced-disable metadata before enablement", async () => {
  const api = await loadDaseinApi();
  const buildSensorsCommandResult = requireExportedFunction(api, "buildSensorsCommandResult", "Testing Gate Matrix row: Status and sensors command payloads");
  const result = buildSensorsCommandResult({ fixture: expectedSensorsData() }) as { data: ReturnType<typeof expectedSensorsData> };
  const weather = result.data.sensors.find((entry) => entry.key === "weather");

  assert.ok(weather);
  assert.equal(weather.manifestDigest, lowerSha256);
  assert.equal(weather.acknowledgedManifestDigest, null);
  assert.equal(weather.acknowledgementRequired, true);
  assert.equal(weather.acknowledgementSatisfied, false);
  assert.equal(weather.forcedDisabledReason, "user-added-remote-or-network-and-recurring-work");
  assert.equal(weather.enabled, false);
});
