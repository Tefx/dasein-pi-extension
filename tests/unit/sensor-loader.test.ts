import assert from "node:assert/strict";
import test from "node:test";

import { builtinClockManifest, loadDaseinApi, riskyWeatherManifest, lowerSha256, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("sensor loader validates default export SensorSpec, manifest metadata, duplicates, reserved keys, and provenance", async () => {
  const api = await loadDaseinApi();
  const loadSensorRegistry = requireExportedFunction(api, "loadSensorRegistry", "Testing Gate Matrix row: Sensor export, install modes, provenance, and reload all-or-keep-old");
  const result = await loadSensorRegistry({
    extensionRoot: "/extension",
    installMode: "directory",
    modules: [
      { filePath: "/extension/src/sensors/clock.ts", defaultExport: { key: "clock", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest } },
      { filePath: "/extension/src/sensors/status.ts", defaultExport: { key: "status", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest } },
      { filePath: "/extension/src/sensors/named.ts", namedExport: { key: "named", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest } },
    ],
  }) as { entries: unknown[]; loadErrors: Array<{ file: string; kind: string; key?: string; message: string }> };

  assert.match(JSON.stringify(result.entries), /user_added_local_file|clock/u);
  assert.deepEqual(result.loadErrors.map((error) => [error.file, error.kind, error.key]), [
    ["/extension/src/sensors/status.ts", "reserved-key", "status"],
    ["/extension/src/sensors/named.ts", "invalid-spec", undefined],
  ]);
});

test("risky user-added sensor manifest digest and acknowledgement force-disabled policy are loader/runtime metadata", async () => {
  const api = await loadDaseinApi();
  const inspectSensorMetadata = requireExportedFunction(api, "inspectSensorMetadata", "Testing Gate Matrix row: Sensor export, install modes, provenance, and reload all-or-keep-old");
  const metadata = inspectSensorMetadata({
    spec: { key: "weather", defaults: { enabled: true, ui: true, agent: false, intervalMs: 300000 }, manifest: riskyWeatherManifest },
    provenance: { kind: "user_added_local_file", filePath: "/extension/src/sensors/weather.ts" },
    effectiveConfig: { enabled: true, ui: true, agent: false, intervalMs: 300000, acknowledgedManifestDigest: null },
  }) as { manifestDigest: string; acknowledgementRequired: boolean; acknowledgementSatisfied: boolean; effectiveEnabled: boolean; forcedDisabledReason: string };

  assert.equal(metadata.manifestDigest, lowerSha256);
  assert.equal(metadata.acknowledgementRequired, true);
  assert.equal(metadata.acknowledgementSatisfied, false);
  assert.equal(metadata.effectiveEnabled, false);
  assert.equal(metadata.forcedDisabledReason, "user-added-remote-or-network-and-recurring-work");
});
