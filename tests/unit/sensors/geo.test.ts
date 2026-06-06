import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import type { SensorActionContext, SensorActionResult, SensorConfig, SensorSnapshot, SensorSpec, SensorStateField, SensorViewFragment } from "../../../src/index.ts";
import { loadDaseinApi, requireExportedFunction } from "../../fixtures/helpers/core-fixtures.ts";

type GeoConfig = SensorConfig & {
  precision: "city" | "district" | "street" | "exact";
  tags: Record<string, GeoTag>;
  exactAddress: boolean;
  exactCoordinates: boolean;
};

type GeoTag = { lat: number; lon: number; radius_m: number; label?: string };
type GeoTagListPayload = {
  exactCoordinates: boolean;
  tags: Array<{
    name: string;
    radius_m: number;
    label: string | null;
    coordinates: { visible: true; lat: number; lon: number } | { visible: false; redacted: true };
  }>;
};
type GeoState = {
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  permission: "authorized" | "denied" | "restricted" | "not_determined" | "unknown";
  timestamp: number | null;
  placemark: {
    city?: string;
    district?: string;
    street?: string;
    name?: string;
    formattedAddress?: string;
    country?: string;
    administrativeArea?: string;
    subAdministrativeArea?: string;
    postalCode?: string;
  } | null;
  nearestTag: string | null;
  helperBackoffUntil: number | null;
};

type HelperMapping = { status: "enabled" | "error"; error?: { kind: string }; state?: GeoState };

const expectedGeoFile = new URL("../../../src/sensors/geo.ts", import.meta.url);
const expectedPrecisions = ["city", "district", "street", "exact"] as const;

const loadGeoSpec = async (): Promise<SensorSpec<GeoState, GeoConfig>> => {
  const moduleValue = (await import(expectedGeoFile.href)) as { default?: unknown };
  assert.equal(typeof moduleValue.default, "object", "src/sensors/geo.ts must default-export one SensorSpec");
  assert.notEqual(moduleValue.default, null, "src/sensors/geo.ts default export must not be null");
  return moduleValue.default as SensorSpec<GeoState, GeoConfig>;
};

const geoField = (stateKey: string, value: unknown, valueType: SensorStateField["value_type"]): SensorStateField => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: "geo",
  state_key: stateKey,
  value,
  value_type: valueType,
  collected_at: 1_700_000_000_000,
  stale_after_ms: 1_800_000,
  status: "enabled",
  source: { sensor_id: "geo", source_kind: "builtin" },
});

const geoSnapshot = (): SensorSnapshot => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: "geo",
  fields: {
    "geo.lat": geoField("geo.lat", 31.2304, "number"),
    "geo.lon": geoField("geo.lon", 121.4737, "number"),
    "geo.accuracy_m": geoField("geo.accuracy_m", 80, "number"),
    "geo.permission": geoField("geo.permission", "authorized", "enum"),
    "geo.placemark": geoField("geo.placemark", { city: "Shanghai", district: "Jing'an", street: "Nanjing W Rd", formattedAddress: "123 Nanjing W Rd, Shanghai" }, "object"),
    "geo.nearestTag": geoField("geo.nearestTag", "home", "string"),
  },
  collected_at: 1_700_000_000_000,
  stale_after_ms: 1_800_000,
  status: "enabled",
  source: { sensor_id: "geo", source_kind: "builtin" },
});

const fragmentsToText = (value: SensorViewFragment | readonly SensorViewFragment[] | null | undefined): string => JSON.stringify(value ?? null);

const makeActionContext = (config: GeoConfig): SensorActionContext<GeoConfig> & { counts: { refreshNow: number; scheduleRefresh: number } } => {
  const counts = { refreshNow: 0, scheduleRefresh: 0 };
  return {
    sensorKey: "geo",
    config,
    snapshot: geoSnapshot(),
    refreshNow: async () => {
      counts.refreshNow += 1;
      return { ok: false, snapshot: null, error: { kind: "unknown", message: "tag list must not refresh" } };
    },
    scheduleRefresh: () => {
      counts.scheduleRefresh += 1;
    },
    counts,
  };
};

function assertGeoTagListPayload(value: unknown): asserts value is GeoTagListPayload {
  assert.equal(typeof value, "object", "GeoTagListPayload must be an object");
  assert.notEqual(value, null, "GeoTagListPayload must not be null");
  const record = value as { exactCoordinates?: unknown; tags?: unknown };
  assert.equal(typeof record.exactCoordinates, "boolean", "GeoTagListPayload.exactCoordinates must be boolean");
  assert.ok(Array.isArray(record.tags), "GeoTagListPayload.tags must be an array");
}

test("geo SensorSpec defaults, exactCoordinates/exactAddress privacy defaults, manifest, and precision enum match builtin contract", async () => {
  const geo = await loadGeoSpec();

  assert.equal(geo.key, "geo");
  assert.deepEqual(geo.defaults, {
    enabled: false,
    ui: true,
    agent: false,
    intervalMs: 60000,
    timeoutMs: 3000,
    staleAfterMs: 1800000,
    initialRefresh: true,
    precision: "city",
    tags: {},
    exactAddress: false,
    exactCoordinates: false,
  });
  assert.deepEqual(geo.fields?.precision?.values, expectedPrecisions);
  assert.deepEqual(geo.fields?.exactCoordinates, { label: "Include exact coordinates", type: "boolean" });
  assert.deepEqual(geo.fields?.exactAddress, { label: "Include exact address", type: "boolean" });
  assert.deepEqual(geo.manifest.declaredInputClasses, ["native_location", "subprocess"]);
  assert.deepEqual(geo.manifest.permissions, [
    { kind: "macos_location", required: true, reason: "CoreLocation user-approved location" },
    { kind: "subprocess", required: true, reason: "supervised Swift helper" },
  ]);
});

test("geo exactCoordinates and exactAddress positive/negative gates prevent accidental agent disclosure", async () => {
  const geo = await loadGeoSpec();
  if (typeof geo.renderAgent !== "function") assert.fail("geo must provide renderAgent privacy gates");
  const baseConfig: GeoConfig = { ...geo.defaults, tags: { home: { lat: 31.2304, lon: 121.4737, radius_m: 120, label: "home" } } };
  const snapshot = geoSnapshot();

  const negativeConfigs: GeoConfig[] = [
    { ...baseConfig, agent: false, precision: "exact", exactCoordinates: true, exactAddress: true },
    { ...baseConfig, agent: true, precision: "city", exactCoordinates: true, exactAddress: true },
    { ...baseConfig, agent: true, precision: "exact", exactCoordinates: false, exactAddress: true },
    { ...baseConfig, agent: true, precision: "exact", exactCoordinates: true, exactAddress: false },
  ];

  for (const config of negativeConfigs) {
    const rendered = fragmentsToText(geo.renderAgent(snapshot, config));
    if (!(config.agent && config.precision === "exact" && config.exactCoordinates)) {
      assert.doesNotMatch(rendered, /31\.2304|121\.4737/u, `exactCoordinates gate failed for ${JSON.stringify(config)}`);
    }
    if (!(config.agent && config.precision === "exact" && config.exactAddress)) {
      assert.doesNotMatch(rendered, /123 Nanjing W Rd/u, `exactAddress gate failed for ${JSON.stringify(config)}`);
    }
  }

  const positive = fragmentsToText(geo.renderAgent(snapshot, { ...baseConfig, agent: true, precision: "exact", exactCoordinates: true, exactAddress: true }));
  assert.match(positive, /31\.2304/u, "exactCoordinates positive gate includes latitude");
  assert.match(positive, /121\.4737/u, "exactCoordinates positive gate includes longitude");
  assert.match(positive, /123 Nanjing W Rd/u, "exactAddress positive gate includes exact helper address");
});

test("geo tag config validates canonical shape and radius_m integer bounds 1..100000", async () => {
  const geo = await loadGeoSpec();
  if (typeof geo.validateConfig !== "function") assert.fail("geo must validate canonical tag config");

  const validMin: GeoConfig = { ...geo.defaults, tags: { a: { lat: 1, lon: 2, radius_m: 1 } } };
  const validMax: GeoConfig = { ...geo.defaults, tags: { z: { lat: 1, lon: 2, radius_m: 100000, label: "z" } } };
  assert.deepEqual(geo.validateConfig(validMin), []);
  assert.deepEqual(geo.validateConfig(validMax), []);

  const invalidConfigs: Array<[string, GeoConfig]> = [
    ["radius zero", { ...geo.defaults, tags: { bad: { lat: 1, lon: 2, radius_m: 0 } } }],
    ["radius above max", { ...geo.defaults, tags: { bad: { lat: 1, lon: 2, radius_m: 100001 } } }],
    ["radius fractional", { ...geo.defaults, tags: { bad: { lat: 1, lon: 2, radius_m: 1.5 } } }],
    ["legacy latitude key", { ...geo.defaults, tags: { bad: { latitude: 1, lon: 2, radius_m: 10 } as unknown as GeoTag } }],
    ["legacy radius key", { ...geo.defaults, tags: { bad: { lat: 1, lon: 2, radius: 10 } as unknown as GeoTag } }],
  ];

  for (const [label, config] of invalidConfigs) {
    assert.notDeepEqual(geo.validateConfig(config), [], `invalid geo tag config must be rejected: ${label}`);
  }
});

test("geo tag list returns GeoTagListPayload, sorts names, avoids refresh/helper/state reads, and redacts coordinates unless exactCoordinates gates are all true", async () => {
  const geo = await loadGeoSpec();
  const tagAction = geo.actions?.tag;
  if (typeof tagAction !== "function") assert.fail("geo.actions.tag must handle tag list/add/remove subcommands");
  const tags = {
    work: { lat: 31.2001, lon: 121.4001, radius_m: 200, label: "office" },
    home: { lat: 31.2304, lon: 121.4737, radius_m: 120 },
  } satisfies Record<string, GeoTag>;

  const negativeConfig: GeoConfig = { ...geo.defaults, agent: true, precision: "exact", exactCoordinates: false, tags };
  const negativeContext = makeActionContext(negativeConfig);
  const negativeResult = await tagAction(["list"], negativeContext) as SensorActionResult;
  assert.equal(negativeResult.ok, true);
  const negativePayload: unknown = negativeResult.ok ? negativeResult.data : undefined;
  assertGeoTagListPayload(negativePayload);
  assert.equal(negativeContext.counts.refreshNow, 0, "tag list must not call refreshNow");
  assert.equal(negativeContext.counts.scheduleRefresh, 0, "tag list must not schedule refresh");
  assert.deepEqual(negativePayload.tags.map((tag) => tag.name), ["home", "work"]);
  assert.deepEqual(negativePayload.tags.map((tag) => tag.coordinates), [
    { visible: false, redacted: true },
    { visible: false, redacted: true },
  ]);
  assert.doesNotMatch(JSON.stringify(negativeResult), /31\.2304|121\.4737|31\.2001|121\.4001/u, "redacted GeoTagListPayload must not include lat/lon numbers");

  const positiveContext = makeActionContext({ ...geo.defaults, agent: true, precision: "exact", exactCoordinates: true, tags });
  const positiveResult = await tagAction(["list"], positiveContext) as SensorActionResult;
  assert.equal(positiveResult.ok, true);
  const positivePayload: unknown = positiveResult.ok ? positiveResult.data : undefined;
  assertGeoTagListPayload(positivePayload);
  assert.deepEqual(positivePayload.tags[0]?.coordinates, { visible: true, lat: 31.2304, lon: 121.4737 });
  assert.equal(positivePayload.exactCoordinates, true);
});

test("geo native helper runtime is configured from extension root instead of process cwd", async () => {
  const source = readFileSync(expectedGeoFile, "utf8");
  assert.doesNotMatch(source, /process\.cwd\s*\(/u, "geo helper path must not depend on the launch cwd");
  const moduleValue = (await import(`${expectedGeoFile.href}?configured-root=${Date.now()}`)) as {
    configureGeoNativeHelper?: (input: { extensionRoot: string; installMode?: "directory" }) => void;
    getGeoNativeHelperRuntimePolicy?: () => { helperPathForDirectoryInstall: string; spawnCommand: readonly [string, string, string] };
  };
  assert.equal(typeof moduleValue.configureGeoNativeHelper, "function");
  assert.equal(typeof moduleValue.getGeoNativeHelperRuntimePolicy, "function");

  const previousCwd = process.cwd();
  try {
    process.chdir(tmpdir());
    moduleValue.configureGeoNativeHelper?.({ extensionRoot: "/real-extension-root", installMode: "directory" });
    const policy = moduleValue.getGeoNativeHelperRuntimePolicy?.();
    assert.equal(policy?.helperPathForDirectoryInstall, "/real-extension-root/src/native/macos-location-helper.swift");
    assert.deepEqual(policy?.spawnCommand, ["swift", "/real-extension-root/src/native/macos-location-helper.swift", "--once"]);
  } finally {
    process.chdir(previousCwd);
  }
});

test("geo native helper stdout/error mapping preserves permission, timeout, parse, unavailable, and helper-unavailable SensorError kinds", async () => {
  const api = await loadDaseinApi();
  const mapMacOSLocationHelperOutput = requireExportedFunction(api, "mapMacOSLocationHelperOutput", "docs/TECHNICAL_DESIGN.md#builtin-sensors Geo native helper contract") as (input: unknown) => HelperMapping;

  assert.deepEqual(mapMacOSLocationHelperOutput({ ok: true, lat: 31.2304, lon: 121.4737, accuracy_m: 80, permission: "authorized", timestamp: 1 }), {
    status: "enabled",
    state: {
      lat: 31.2304,
      lon: 121.4737,
      accuracy_m: 80,
      permission: "authorized",
      timestamp: 1,
      placemark: null,
      nearestTag: null,
      helperBackoffUntil: null,
    },
  });
  assert.equal(mapMacOSLocationHelperOutput({ ok: false, error: "permission_denied", message: "denied", permission: "denied" }).error?.kind, "permission");
  assert.equal(mapMacOSLocationHelperOutput({ ok: false, error: "permission_restricted", message: "restricted", permission: "restricted" }).error?.kind, "permission");
  assert.equal(mapMacOSLocationHelperOutput({ ok: false, error: "timeout", message: "timeout" }).error?.kind, "timeout");
  assert.equal(mapMacOSLocationHelperOutput({ ok: false, error: "unavailable", message: "unavailable" }).error?.kind, "unavailable");
  assert.equal(mapMacOSLocationHelperOutput("not-json").error?.kind, "parse");
  assert.equal(mapMacOSLocationHelperOutput({ packagedHelperPath: null, installMode: "single-file" }).error?.kind, "helper-unavailable");
});
