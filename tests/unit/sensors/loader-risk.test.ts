import assert from "node:assert/strict";
import test from "node:test";

import type { SensorManifest } from "../../../src/index.ts";
import { builtinClockManifest, loadDaseinApi, noBackgroundWork, noRemoteBehavior, requireExportedFunction, riskyWeatherManifest } from "../../fixtures/helpers/core-fixtures.ts";

type InspectInput = {
  spec: { key: string; defaults: Record<string, unknown>; manifest: SensorManifest };
  provenance: { kind: "builtin" } | { kind: "user_added_local_file"; filePath: string };
  effectiveConfig: Record<string, unknown>;
};
type InspectMetadata = {
  manifestDigest: string;
  acknowledgedManifestDigest: string | null;
  acknowledgementRequired: boolean;
  acknowledgementSatisfied: boolean;
  defaultEnabled: boolean;
  effectiveEnabled: boolean;
  forcedDisabledReason?: string;
};
type LoadSensorRegistry = (input: {
  extensionRoot: string;
  installMode?: "directory" | "single-file";
  modules?: Array<{ filePath: string; defaultExport?: unknown }>;
}) => Promise<{ ok: boolean; entries: Array<{ spec: { key: string }; provenance: unknown }>; loadErrors: Array<{ file: string; kind: string; message: string }>; attemptedFiles: string[] }>;

const outputField = (stateKey: string) => ({
  state_key: stateKey,
  value_type: "string" as const,
  description: stateKey,
  agentVisibleByDefault: false,
  uiVisibleByDefault: true,
});

const safeLocalManifest: SensorManifest = {
  description: "safe local fixture",
  declaredInputClasses: ["time"],
  outputFields: [outputField("safe.summary")],
  permissions: [{ kind: "none", required: false, reason: "local deterministic input" }],
  remote: noRemoteBehavior,
  backgroundWork: noBackgroundWork,
};

const remoteOnlyManifest: SensorManifest = {
  description: "remote-only fixture",
  declaredInputClasses: ["network"],
  outputFields: [outputField("remote.summary")],
  permissions: [{ kind: "network", required: true, reason: "calls remote.example" }],
  remote: {
    capable: true,
    contactsNetworkByDefault: false,
    destinations: ["https://remote.example"],
    payloadClasses: ["query"],
    transmissionCadence: "manual",
    disableControl: "sensor.enabled",
    description: "manual remote lookup",
  },
  backgroundWork: noBackgroundWork,
};

const recurringOnlyManifest: SensorManifest = {
  description: "recurring-only fixture",
  declaredInputClasses: ["time"],
  outputFields: [outputField("recurring.summary")],
  permissions: [{ kind: "none", required: false, reason: "local recurring work only" }],
  remote: noRemoteBehavior,
  backgroundWork: {
    capable: true,
    kinds: ["recurring_interval"],
    defaultIntervalMs: 60000,
    intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
    description: "local recurring summary",
  },
};

const inspectCase = async (input: InspectInput): Promise<InspectMetadata> => {
  const api = await loadDaseinApi();
  const inspectSensorMetadata = requireExportedFunction(api, "inspectSensorMetadata", "docs/TECHNICAL_DESIGN.md#core-contracts SensorInspectabilityMetadata") as (input: InspectInput) => InspectMetadata;
  return inspectSensorMetadata(input);
};

test("risky user-added sensor acknowledgement fields are explicit for safe, remote/network, recurring/background, and both-risk sensors", async () => {
  const cases: Array<{
    key: string;
    manifest: SensorManifest;
    effectiveConfig: Record<string, unknown>;
    expected: Omit<InspectMetadata, "manifestDigest" | "acknowledgedManifestDigest"> & { forcedDisabledReason?: string };
  }> = [
    {
      key: "safe",
      manifest: safeLocalManifest,
      effectiveConfig: { enabled: true, ui: true, agent: false, intervalMs: null },
      expected: {
        acknowledgementRequired: false,
        acknowledgementSatisfied: true,
        defaultEnabled: true,
        effectiveEnabled: true,
      },
    },
    {
      key: "remote",
      manifest: remoteOnlyManifest,
      effectiveConfig: { enabled: true, ui: true, agent: false, intervalMs: null, acknowledgedManifestDigest: null },
      expected: {
        acknowledgementRequired: true,
        acknowledgementSatisfied: false,
        defaultEnabled: true,
        effectiveEnabled: false,
        forcedDisabledReason: "user-added-remote-or-network",
      },
    },
    {
      key: "recurring",
      manifest: recurringOnlyManifest,
      effectiveConfig: { enabled: true, ui: true, agent: false, intervalMs: 60000, acknowledgedManifestDigest: null },
      expected: {
        acknowledgementRequired: true,
        acknowledgementSatisfied: false,
        defaultEnabled: true,
        effectiveEnabled: false,
        forcedDisabledReason: "user-added-recurring-work",
      },
    },
    {
      key: "both",
      manifest: riskyWeatherManifest,
      effectiveConfig: { enabled: true, ui: true, agent: false, intervalMs: 300000, acknowledgedManifestDigest: null },
      expected: {
        acknowledgementRequired: true,
        acknowledgementSatisfied: false,
        defaultEnabled: true,
        effectiveEnabled: false,
        forcedDisabledReason: "user-added-remote-or-network-and-recurring-work",
      },
    },
  ];

  for (const entry of cases) {
    const metadata = await inspectCase({
      spec: { key: entry.key, defaults: { enabled: true, ui: true, agent: false, intervalMs: entry.effectiveConfig.intervalMs }, manifest: entry.manifest },
      provenance: { kind: "user_added_local_file", filePath: `/extension/src/sensors/${entry.key}.ts` },
      effectiveConfig: entry.effectiveConfig,
    });
    assert.match(metadata.manifestDigest, /^[a-f0-9]{64}$/u, `${entry.key} manifestDigest must be lower-case SHA-256`);
    assert.equal(metadata.acknowledgedManifestDigest, null, `${entry.key} starts unacknowledged`);
    assert.equal(metadata.acknowledgementRequired, entry.expected.acknowledgementRequired, `${entry.key} acknowledgementRequired`);
    assert.equal(metadata.acknowledgementSatisfied, entry.expected.acknowledgementSatisfied, `${entry.key} acknowledgementSatisfied`);
    assert.equal(metadata.defaultEnabled, entry.expected.defaultEnabled, `${entry.key} defaultEnabled`);
    assert.equal(metadata.effectiveEnabled, entry.expected.effectiveEnabled, `${entry.key} effectiveEnabled`);
    assert.equal(metadata.forcedDisabledReason, entry.expected.forcedDisabledReason, `${entry.key} forcedDisabledReason`);
  }
});

test("matching acknowledgedManifestDigest is required in the same effective config before risky sensors become effectiveEnabled", async () => {
  const unacknowledged = await inspectCase({
    spec: { key: "remote", defaults: { enabled: true, ui: true, agent: false, intervalMs: null }, manifest: remoteOnlyManifest },
    provenance: { kind: "user_added_local_file", filePath: "/extension/src/sensors/remote.ts" },
    effectiveConfig: { enabled: true, ui: true, agent: false, intervalMs: null, acknowledgedManifestDigest: null },
  });
  const acknowledged = await inspectCase({
    spec: { key: "remote", defaults: { enabled: true, ui: true, agent: false, intervalMs: null }, manifest: remoteOnlyManifest },
    provenance: { kind: "user_added_local_file", filePath: "/extension/src/sensors/remote.ts" },
    effectiveConfig: { enabled: true, ui: true, agent: false, intervalMs: null, acknowledgedManifestDigest: unacknowledged.manifestDigest },
  });

  assert.equal(unacknowledged.acknowledgementRequired, true);
  assert.equal(unacknowledged.acknowledgementSatisfied, false);
  assert.equal(unacknowledged.effectiveEnabled, false);
  assert.equal(acknowledged.acknowledgedManifestDigest, unacknowledged.manifestDigest);
  assert.equal(acknowledged.acknowledgementRequired, true);
  assert.equal(acknowledged.acknowledgementSatisfied, true);
  assert.equal(acknowledged.effectiveEnabled, true);
});

test("loader rejects user-added sensor candidates outside <extension_root>/src/sensors/*.ts including ~/.pi/dasein/sensors", async () => {
  const api = await loadDaseinApi();
  const loadSensorRegistry = requireExportedFunction(api, "loadSensorRegistry", "docs/PRD.md#9-7-sensor-loading-and-reload canonical scan root") as LoadSensorRegistry;
  const safeSpec = { key: "safe", defaults: { enabled: true, ui: true, agent: false, intervalMs: null }, manifest: builtinClockManifest };
  const result = await loadSensorRegistry({
    extensionRoot: "/extension",
    installMode: "directory",
    modules: [
      { filePath: "/extension/src/sensors/safe.ts", defaultExport: safeSpec },
      { filePath: "/extension/sensors/legacy.ts", defaultExport: { ...safeSpec, key: "legacy" } },
      { filePath: "/Users/example/.pi/dasein/sensors/home.ts", defaultExport: { ...safeSpec, key: "home" } },
    ],
  });

  assert.deepEqual(result.entries.map((entry) => entry.spec.key), ["safe"], "only <extension_root>/src/sensors/*.ts is admitted");
  assert.deepEqual(result.loadErrors.map((error) => [error.file, error.kind]), [
    ["/extension/sensors/legacy.ts", "scan"],
    ["/Users/example/.pi/dasein/sensors/home.ts", "scan"],
  ], "legacy extension sensors path and ~/.pi/dasein/sensors are rejected as non-canonical");
});
