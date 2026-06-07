import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      { filePath: "/extension/src/sensors/inspect.ts", defaultExport: { key: "inspect", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest } },
      { filePath: "/extension/src/sensors/named.ts", namedExport: { key: "named", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest } },
    ],
  }) as { entries: unknown[]; loadErrors: Array<{ file: string; kind: string; key?: string; message: string }> };

  assert.match(JSON.stringify(result.entries), /user_added_local_file|clock/u);
  assert.deepEqual(result.loadErrors.map((error) => [error.file, error.kind, error.key]), [
    ["/extension/src/sensors/status.ts", "reserved-key", "status"],
    ["/extension/src/sensors/inspect.ts", "reserved-key", "inspect"],
    ["/extension/src/sensors/named.ts", "invalid-spec", undefined],
  ]);
});

test("startup loader surfaces duplicate-key errors without activating failed duplicate candidates", async () => {
  const api = await loadDaseinApi();
  const loadSensorRegistry = requireExportedFunction(api, "loadSensorRegistry", "docs/TECHNICAL_DESIGN.md#sensor-loading-and-reload/startup-scan duplicate-key safe admission");
  const builtinEntry = {
    spec: { key: "clock", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest },
    provenance: { kind: "builtin" },
  };
  const result = await loadSensorRegistry({
    extensionRoot: "/extension",
    installMode: "directory",
    builtinEntries: [builtinEntry],
    modules: [
      { filePath: "/extension/src/sensors/clock.ts", defaultExport: { key: "clock", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest } },
      { filePath: "/extension/src/sensors/clock-copy.ts", defaultExport: { key: "clock", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest } },
      { filePath: "/extension/src/sensors/dup-a.ts", defaultExport: { key: "dup", defaults: { enabled: true, ui: true, agent: true }, manifest: builtinClockManifest } },
      { filePath: "/extension/src/sensors/dup-b.ts", defaultExport: { key: "dup", defaults: { enabled: false, ui: true, agent: false }, manifest: builtinClockManifest } },
      { filePath: "/extension/src/sensors/weather.ts", defaultExport: { key: "weather", defaults: { enabled: false, ui: true, agent: false, intervalMs: null }, manifest: riskyWeatherManifest } },
    ],
  }) as { ok: boolean; entries: Array<{ spec: { key: string }; provenance: unknown }>; activeKeys: string[]; loadErrors: Array<{ file: string; kind: string; key?: string }> };

  assert.equal(result.ok, false);
  assert.deepEqual(result.entries.map((entry) => entry.spec.key).sort(), ["clock", "weather"]);
  assert.deepEqual(result.activeKeys.sort(), ["clock", "weather"]);
  assert.deepEqual(
    result.loadErrors.map((error) => [error.file, error.kind, error.key]).sort(),
    [
      ["/extension/src/sensors/clock-copy.ts", "duplicate-key", "clock"],
      ["/extension/src/sensors/dup-a.ts", "duplicate-key", "dup"],
      ["/extension/src/sensors/dup-b.ts", "duplicate-key", "dup"],
    ],
  );
});

test("dynamic filesystem imports cache-bust changed local sensor modules and surface import errors", async () => {
  const api = await loadDaseinApi();
  const loadSensorRegistry = requireExportedFunction(api, "loadSensorRegistry", "Testing Gate Matrix row: Sensor export, install modes, provenance, and reload all-or-keep-old");
  const extensionRoot = mkdtempSync(join(tmpdir(), "dasein-sensor-loader-"));
  const sensorDir = join(extensionRoot, "src", "sensors");
  const sensorPath = join(sensorDir, "dynamic.ts");
  mkdirSync(sensorDir, { recursive: true });

  const writeSensor = (description: string): void => writeFileSync(sensorPath, `
const spec = {
  key: "dynamic",
  defaults: { enabled: true, ui: true, agent: true },
  manifest: {
    description: ${JSON.stringify(description)},
    declaredInputClasses: ["derived"],
    outputFields: [{ state_key: "dynamic.value", value_type: "string", description: "dynamic value", agentVisibleByDefault: true, uiVisibleByDefault: true }],
    permissions: [{ kind: "none", required: false, reason: "none" }],
    remote: { capable: false, contactsNetworkByDefault: false, destinations: [], payloadClasses: [], transmissionCadence: "none", disableControl: "none", description: "none" },
    backgroundWork: { capable: false, kinds: [], defaultIntervalMs: null, intervalRelationship: "none", description: "none" },
  },
};
export default spec;
`);

  try {
    writeSensor("manifest v1");
    const first = await loadSensorRegistry({ extensionRoot, cacheBustToken: "v1" }) as { ok: boolean; entries: Array<{ spec: { manifest: { description: string } } }>; loadErrors: unknown[] };
    assert.equal(first.ok, true);
    assert.equal(first.entries.at(0)?.spec.manifest.description, "manifest v1");

    writeSensor("manifest v2");
    const second = await loadSensorRegistry({ extensionRoot, cacheBustToken: "v2" }) as { ok: boolean; entries: Array<{ spec: { manifest: { description: string } } }>; loadErrors: unknown[] };
    assert.equal(second.ok, true);
    assert.equal(second.entries.at(0)?.spec.manifest.description, "manifest v2");
    assert.equal(readdirSync(sensorDir).some((name) => name.startsWith(".dasein-reload-")), false, "cache-bust import copies must be cleaned up after load");

    writeFileSync(sensorPath, "export default { key: ");
    const invalid = await loadSensorRegistry({ extensionRoot, cacheBustToken: "invalid" }) as { ok: boolean; loadErrors: Array<{ kind: string; file: string; message: string }> };
    assert.equal(invalid.ok, false);
    assert.equal(invalid.loadErrors[0]?.kind, "import");
    assert.equal(invalid.loadErrors[0]?.file, sensorPath);
    assert.match(invalid.loadErrors[0]?.message ?? "", /SensorLoadError: failed to import sensor module/u);
  } finally {
    rmSync(extensionRoot, { recursive: true, force: true });
  }
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
