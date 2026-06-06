import assert from "node:assert/strict";
import test from "node:test";

import { assertSingleLine, expectedStatusData, loadDaseinApi, lowerSha256, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("/dasein status returns Pi version support, mechanism evidence statuses, config/state paths, and launch/disk flags", async () => {
  const api = await loadDaseinApi();
  const buildStatusCommandResult = requireExportedFunction(api, "buildStatusCommandResult", "Testing Gate Matrix row: Status and sensors command payloads");
  const result = buildStatusCommandResult({ piVersion: "0.78.1", configPath: "/tmp/config.json", statePath: "/tmp/state.json" }) as { ok: boolean; command: string; message: string; data: ReturnType<typeof expectedStatusData> };

  assert.equal(result.ok, true);
  assert.equal(result.command, "status");
  assert.match(result.message, /^dasein status: (ok|degraded)$/u);
  assertSingleLine(result.message, "status message");
  assert.equal(result.data.piVersion, "0.78.1");
  assert.equal(result.data.minimumPiVersion, "0.78.1");
  assert.equal(result.data.configPath, "/tmp/config.json");
  assert.equal(result.data.statePath, "/tmp/state.json");
  assert.equal(result.data.effectiveConfigVersion, 1);
  assert.deepEqual(result.data.effectiveLapseControls, { enabled: false, persist: false, agent: false, agentFields: [] });
  assert.equal(result.data.launchArgsApplied, false);
  assert.equal(result.data.diskConfigLoaded, false);
  assert.ok(result.data.piMechanisms.length > 0);
  for (const mechanism of result.data.piMechanisms) {
    assert.ok(mechanism.evidenceStatuses.length > 0);
    assert.ok(mechanism.evidenceStatuses.every((status) => ["SOURCE_VERIFIED", "API_VERIFIED", "LIVE_SMOKE_PENDING", "LIVE_SMOKE_VERIFIED"].includes(status)));
  }
});

test("/dasein status uses LIVE_SMOKE_VERIFIED for PROVEN release-ledger Pi mechanism evidence", async () => {
  const api = await loadDaseinApi();
  const buildStatusCommandResult = requireExportedFunction(api, "buildStatusCommandResult", "Testing Gate Matrix row: Status and sensors command payloads");
  const result = buildStatusCommandResult({ piVersion: "0.78.1" }) as { data: ReturnType<typeof expectedStatusData> };

  assert.ok(result.data.piMechanisms.length > 0);
  for (const mechanism of result.data.piMechanisms) {
    assert.equal(mechanism.evidenceStatuses.includes("LIVE_SMOKE_PENDING"), false, `${mechanism.mechanism} must not underclaim proven live-smoke evidence`);
    assert.equal(mechanism.evidenceStatuses.includes("LIVE_SMOKE_VERIFIED"), true, `${mechanism.mechanism} must carry live-smoke verification`);
    assert.match(mechanism.observedBehavior, /PROVEN/u);
  }
});

test("/dasein status classifies unavailable and below-minimum Pi versions without claiming support", async () => {
  const api = await loadDaseinApi();
  const classifyPiSupport = requireExportedFunction(api, "classifyPiSupport", "Testing Gate Matrix row: Status and sensors command payloads");

  assert.deepEqual(classifyPiSupport(null), { piVersion: null, minimumPiVersion: "0.78.1", classification: "unavailable" });
  assert.deepEqual(classifyPiSupport("0.78.0"), { piVersion: "0.78.0", minimumPiVersion: "0.78.1", classification: "below-minimum" });
  assert.deepEqual(classifyPiSupport("0.78.1"), { piVersion: "0.78.1", minimumPiVersion: "0.78.1", classification: "supported-version-feature-probes-still-required" });
});

test("/dasein status exposes active/disabled sensors, hidden contributors, permissions, metadata, load/status errors, and durable lapse health", async () => {
  const api = await loadDaseinApi();
  const buildStatusCommandResult = requireExportedFunction(api, "buildStatusCommandResult", "Testing Gate Matrix row: Status and sensors command payloads");
  const expected = expectedStatusData("/tmp/config.json", "/tmp/state.json");
  const result = buildStatusCommandResult({ fixture: expected }) as { data: typeof expected };

  assert.deepEqual(result.data.activeSensors, ["clock", "lapse"]);
  assert.deepEqual(result.data.disabledSensors, ["geo", "weather"]);
  assert.match(JSON.stringify(result.data.hiddenContributors), /disabled|agent-hidden|weather/u);
  assert.deepEqual(result.data.effectiveLapseControls, { enabled: true, persist: true, agent: true, agentFields: ["user_idle"] });
  assert.match(JSON.stringify(result.data.permissions), /not_determined|missing|disabled/u);
  assert.deepEqual(result.data.rendered, { omittedKeys: ["geo"], truncated: false });
  assert.deepEqual(result.data.loadErrors, []);
  assert.deepEqual(result.data.statusErrors, []);
  assert.deepEqual(result.data.durableState, { statePath: "/tmp/state.json", stateFileLoaded: false, lapse: null });
});

test("/dasein status includes risky sensor metadata and acknowledgement/effective enablement fields", async () => {
  const api = await loadDaseinApi();
  const buildStatusCommandResult = requireExportedFunction(api, "buildStatusCommandResult", "Testing Gate Matrix row: Status and sensors command payloads");
  const result = buildStatusCommandResult({ fixture: expectedStatusData() }) as { data: ReturnType<typeof expectedStatusData> };
  const weather = result.data.sensorMetadata.find((entry) => entry.key === "weather");

  assert.ok(weather);
  assert.equal(weather.manifestDigest, lowerSha256);
  assert.equal(weather.acknowledgedManifestDigest, null);
  assert.equal(weather.acknowledgementRequired, true);
  assert.equal(weather.acknowledgementSatisfied, false);
  assert.equal(weather.defaultEnabled, true);
  assert.equal(weather.effectiveEnabled, false);
  assert.equal(weather.forcedDisabledReason, "user-added-remote-or-network-and-recurring-work");
  assert.equal(weather.effectiveIntervalMs, 300000);
  assert.deepEqual(weather.provenance, { kind: "user_added_local_file", filePath: "/extension/src/sensors/weather.ts" });
  assert.deepEqual(weather.manifest.remote.destinations, ["https://weather.example"]);
  assert.deepEqual(weather.manifest.remote.payloadClasses, ["approximate-location"]);
  assert.equal(weather.manifest.remote.disableControl, "sensor.enabled");
});
