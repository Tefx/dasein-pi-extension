import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { baseConfig, clockSnapshot, loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("renderer deterministically orders renderOrder sensors, remaining sensors, and external keys with core-owned final strings", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "Testing Gate Matrix row: Renderer output contract");
  const rendered = renderDaseinContext({
    config: {
      ...baseConfig,
      core: { ...baseConfig.core, renderOrder: ["external:weather", "clock"] },
      external: { weather: { ui: true, agent: true } },
    },
    sensorSnapshots: [clockSnapshot()],
    externalStates: [{ key: "weather", agent: "dry", ui: "dry", source: "fixture", updatedAt: 1000, expiresAt: 61000 }],
    now: 1000,
  }) as { agent: string | null; status: string | null; omittedKeys: string[]; truncated: boolean };

  assert.deepEqual(rendered, {
    agent: "[ambient_ctx: weather=dry; local=14:32]",
    status: "weather dry; time Fri 14:32 +08",
    omittedKeys: [],
    truncated: false,
  });
});

test("status bar formatter stays silent for normal quiet state and shows only useful bounded details", async () => {
  const api = await loadDaseinApi();
  const formatDaseinStatusBar = requireExportedFunction(api, "formatDaseinStatusBar", "status bar detail level formatting contract") as (input: {
    statusDetail: "quiet" | "summary" | "diagnostic";
    rendered: { agent: string | null; status: string | null; omittedKeys: string[]; truncated: boolean };
    errorCount: number;
    maxWidth?: number;
  }) => string | undefined;

  const normalClockOnly = {
    agent: "[ambient_ctx: local=14:32]",
    status: "time Fri 14:32 +08; utc_offset_minutes 480",
    omittedKeys: [],
    truncated: false,
  };
  assert.equal(formatDaseinStatusBar({ statusDetail: "quiet", rendered: normalClockOnly, errorCount: 0 }), undefined);
  assert.equal(formatDaseinStatusBar({ statusDetail: "summary", rendered: normalClockOnly, errorCount: 0 }), undefined);
  assert.equal(formatDaseinStatusBar({ statusDetail: "quiet", rendered: { ...normalClockOnly, status: "placemark loc visible" }, errorCount: 0 }), undefined);
  assert.equal(formatDaseinStatusBar({ statusDetail: "summary", rendered: { ...normalClockOnly, status: "placemark loc visible" }, errorCount: 0 }), undefined);
  assert.equal(formatDaseinStatusBar({ statusDetail: "summary", rendered: { ...normalClockOnly, status: "loc Singapore" }, errorCount: 0 }), "loc Singapore");

  const rendered = {
    agent: "[ambient_ctx: idle=7h; weather=heavy rain later in the afternoon]",
    status: "time Fri 14:32 +08; user_idle 7h; weather heavy rain later in the afternoon; utc_offset_minutes 480",
    omittedKeys: ["geo.lat"],
    truncated: true,
  };

  const summary = formatDaseinStatusBar({ statusDetail: "summary", rendered, errorCount: 0, maxWidth: 42 });
  assert.equal(typeof summary, "string");
  assert.equal(visibleWidth(summary ?? "") <= 42, true);
  assert.match(summary ?? "", /^! agent truncated · idle 7h/u);
  assert.doesNotMatch(summary ?? "", /Dasein|Ready|time|utc_offset|\(agent hidden\)|ambient_ctx|geo\.lat/u);
  assert.match(summary ?? "", /…/u);

  const diagnostic = formatDaseinStatusBar({ statusDetail: "diagnostic", rendered, errorCount: 1, maxWidth: 120 });
  assert.match(diagnostic ?? "", /^! degraded 1/u);
  assert.match(diagnostic ?? "", /omitted 1/u);
  assert.match(diagnostic ?? "", /agent truncated/u);
});

test("renderer suppresses null lapse values instead of showing idle null", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "Testing Gate Matrix row: Renderer output contract");
  const field = {
    ...clockSnapshot().fields["clock.local_time"]!,
    sensor_id: "lapse",
    state_key: "lapse.user_idle",
    value: null,
    value_type: "null",
  };
  const rendered = renderDaseinContext({
    config: baseConfig,
    sensorSnapshots: [{
      contract_version: 1,
      schema_version: 1,
      sensor_id: "lapse",
      fields: { "lapse.user_idle": field },
      collected_at: 1000,
      stale_after_ms: 120000,
      status: "enabled",
      source: { sensor_id: "lapse", source_kind: "builtin" },
    }],
    now: 1000,
  }) as { agent: string | null; status: string | null; omittedKeys: string[]; truncated: boolean };

  assert.equal(rendered.agent, null);
  assert.equal(rendered.status, null);
  assert.deepEqual(rendered.omittedKeys, ["lapse.user_idle"]);
});

test("default render order is clock, lapse, geo and renderer appends remaining sensors lexicographically", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "docs/TECHNICAL_DESIGN.md#rendering-contract default render order");
  assert.deepEqual(api.DEFAULT_CORE_RENDER_ORDER, ["clock", "lapse", "geo"]);
  const field = (sensorId: string, stateKey: string, value: unknown, valueType: string) => ({
    contract_version: 1,
    schema_version: 1,
    sensor_id: sensorId,
    state_key: stateKey,
    value,
    value_type: valueType,
    collected_at: 1000,
    stale_after_ms: 120000,
    status: "enabled",
    source: { sensor_id: sensorId, source_kind: sensorId === "alpha" ? "local_sensor" : "builtin" },
  });
  const snapshot = (sensorId: string, stateKey: string, value: unknown, valueType: string) => ({
    contract_version: 1,
    schema_version: 1,
    sensor_id: sensorId,
    fields: { [stateKey]: field(sensorId, stateKey, value, valueType) },
    collected_at: 1000,
    stale_after_ms: 120000,
    status: "enabled",
    source: { sensor_id: sensorId, source_kind: sensorId === "alpha" ? "local_sensor" : "builtin" },
  });

  const rendered = renderDaseinContext({
    config: {
      ...baseConfig,
      core: { ...baseConfig.core, renderOrder: ["clock", "lapse", "geo"] },
      sensors: {
        ...baseConfig.sensors,
        geo: { ...baseConfig.sensors.geo, enabled: true, agent: true },
        alpha: { enabled: true, ui: true, agent: true },
      },
    },
    sensorSnapshots: [
      snapshot("geo", "geo.city", "Shanghai", "string"),
      snapshot("alpha", "alpha.value", "alpha-after-builtins", "string"),
      snapshot("lapse", "lapse.user_idle", 25_200_000, "number"),
      clockSnapshot(),
    ],
    now: 1000,
  }) as { agent: string | null };

  assert.equal(rendered.agent, "[ambient_ctx: local=14:32; idle=7h; loc=Shanghai; value=alpha-after-builtins]");
});

test("unconfigured external keys stay UI-visible but hidden from the agent string", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "Testing Gate Matrix row: Renderer output contract");
  const rendered = renderDaseinContext({
    config: baseConfig,
    sensorSnapshots: [clockSnapshot()],
    externalStates: [{ key: "weather", agent: "secret-agent-value", ui: "human weather", source: "fixture", updatedAt: 1000, expiresAt: 61000 }],
    now: 1000,
  }) as { agent: string | null; status: string | null; omittedKeys: string[]; truncated: boolean };

  assert.equal(rendered.agent, "[ambient_ctx: local=14:32]");
  assert.doesNotMatch(rendered.agent ?? "", /weather|secret-agent-value/u);
  assert.match(rendered.status ?? "", /weather human weather \(agent hidden\)/u);
  assert.deepEqual(rendered.omittedKeys.includes("external:weather"), true);
  assert.equal(rendered.truncated, false);
});

test("render invalidation scheduler creates exactly one timer at min stale/expires deadline and none without deadlines", async () => {
  const api = await loadDaseinApi();
  const createRenderInvalidationScheduler = requireExportedFunction(api, "createRenderInvalidationScheduler", "Testing Gate Matrix row: Renderer output contract");
  const scheduler = createRenderInvalidationScheduler() as {
    afterRender(renderInput: unknown): { scheduledTimerCount: number; nextDeadline: number | null };
    fire(deadline: number): { recomputed: boolean; refreshedSensors: boolean; performedIo: boolean; mutatedConfig: boolean; rendered: unknown };
  };

  assert.deepEqual(scheduler.afterRender({ sensorSnapshots: [clockSnapshot()], externalStates: [{ key: "weather", agent: null, ui: "dry", source: null, updatedAt: 1000, expiresAt: 2000 }], now: 1000 }), {
    scheduledTimerCount: 1,
    nextDeadline: 2000,
  });
  const fired = scheduler.fire(2000);
  assert.equal(fired.recomputed, true);
  assert.equal(fired.refreshedSensors, false);
  assert.equal(fired.performedIo, false);
  assert.equal(fired.mutatedConfig, false);
  assert.match(JSON.stringify(fired.rendered), /expired|stale|omittedKeys/u);

  assert.deepEqual(scheduler.afterRender({ sensorSnapshots: [], externalStates: [], now: 3000 }), {
    scheduledTimerCount: 0,
    nextDeadline: null,
  });
});

test("geo field-level city precision suppresses lower-precision and exact raw geo fields", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "SENSORS-GATE-BLOCKER-001 field-level geo privacy regression");
  const formatDaseinStatusBar = requireExportedFunction(api, "formatDaseinStatusBar", "status bar summary geo privacy regression") as (input: {
    statusDetail: "quiet" | "summary" | "diagnostic";
    rendered: { agent: string | null; status: string | null; omittedKeys: string[]; truncated: boolean };
    errorCount: number;
  }) => string | undefined;
  const field = (stateKey: string, value: unknown, valueType: string) => ({
    contract_version: 1,
    schema_version: 1,
    sensor_id: "geo",
    state_key: stateKey,
    value,
    value_type: valueType,
    collected_at: 1000,
    stale_after_ms: 1800000,
    status: "enabled",
    source: { sensor_id: "geo", source_kind: "builtin" },
  });
  const geoSnapshot = {
    contract_version: 1,
    schema_version: 1,
    sensor_id: "geo",
    fields: {
      "geo.city": field("geo.city", "Shanghai", "string"),
      "geo.district": field("geo.district", "Jing'an", "string"),
      "geo.street": field("geo.street", "Nanjing W Rd", "string"),
      "geo.formattedAddress": field("geo.formattedAddress", "123 Nanjing W Rd, Shanghai", "string"),
      "geo.lat": field("geo.lat", 31.2304, "number"),
      "geo.lon": field("geo.lon", 121.4737, "number"),
    },
    collected_at: 1000,
    stale_after_ms: 1800000,
    status: "enabled",
    source: { sensor_id: "geo", source_kind: "builtin" },
  };

  const rendered = renderDaseinContext({
    config: { ...baseConfig, sensors: { ...baseConfig.sensors, geo: { ...baseConfig.sensors.geo, enabled: true, agent: true, precision: "city", exactCoordinates: false, exactAddress: false } } },
    sensorSnapshots: [geoSnapshot],
    now: 1000,
  }) as { agent: string | null; status: string | null; omittedKeys: string[]; truncated: boolean };

  assert.equal(rendered.agent, "[ambient_ctx: loc=Shanghai]");
  assert.equal(formatDaseinStatusBar({ statusDetail: "summary", rendered, errorCount: 0 }), "loc Shanghai");
  assert.doesNotMatch(rendered.agent ?? "", /geo\.city|geo\.district|geo\.street|formattedAddress|Jing'an|Nanjing|123|31\.2304|121\.4737/u);
  assert.deepEqual(["geo.district", "geo.formattedAddress", "geo.lat", "geo.lon", "geo.street"].every((key) => rendered.omittedKeys.includes(key)), true);
});

test("geo placemark envelope at city precision never renders raw sensitive geo fields into the agent string", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "SENSORS-GATE-BLOCKER-001 renderer-level geo privacy regression");
  const field = (stateKey: string, value: unknown, valueType: string) => ({
    contract_version: 1,
    schema_version: 1,
    sensor_id: "geo",
    state_key: stateKey,
    value,
    value_type: valueType,
    collected_at: 1000,
    stale_after_ms: 1800000,
    status: "enabled",
    source: { sensor_id: "geo", source_kind: "builtin" },
  });
  const geoSnapshot = {
    contract_version: 1,
    schema_version: 1,
    sensor_id: "geo",
    fields: {
      "geo.lat": field("geo.lat", 31.2304, "number"),
      "geo.lon": field("geo.lon", 121.4737, "number"),
      "geo.accuracy_m": field("geo.accuracy_m", 80, "number"),
      "geo.permission": field("geo.permission", "authorized", "enum"),
      "geo.nearestTag": field("geo.nearestTag", "home", "string"),
      "geo.placemark": field("geo.placemark", { city: "Shanghai", district: "Jing'an", street: "Nanjing W Rd", formattedAddress: "123 Nanjing W Rd, Shanghai" }, "object"),
    },
    collected_at: 1000,
    stale_after_ms: 1800000,
    status: "enabled",
    source: { sensor_id: "geo", source_kind: "builtin" },
  };

  const rendered = renderDaseinContext({
    config: { ...baseConfig, sensors: { ...baseConfig.sensors, geo: { ...baseConfig.sensors.geo, enabled: true, agent: true, precision: "city", exactCoordinates: false, exactAddress: false } } },
    sensorSnapshots: [geoSnapshot],
    now: 1000,
  }) as { agent: string | null; omittedKeys: string[] };

  assert.equal(rendered.agent, "[ambient_ctx: loc=Shanghai]");
  assert.doesNotMatch(rendered.agent ?? "", /placemark|formattedAddress|district|street|accuracy_m|permission|nearestTag|31\.2304|121\.4737|80|authorized|home|Jing'an|Nanjing|123/u);
  assert.deepEqual(["geo.accuracy_m", "geo.lat", "geo.lon", "geo.nearestTag", "geo.permission"].every((key) => rendered.omittedKeys.includes(key)), true);
});

test("geo exact placemark and coordinate gates permit only gated exact agent output", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "SENSORS-GATE-BLOCKER-001 exact geo privacy gates");
  const field = (stateKey: string, value: unknown, valueType: string) => ({
    contract_version: 1,
    schema_version: 1,
    sensor_id: "geo",
    state_key: stateKey,
    value,
    value_type: valueType,
    collected_at: 1000,
    stale_after_ms: 1800000,
    status: "enabled",
    source: { sensor_id: "geo", source_kind: "builtin" },
  });
  const geoSnapshot = {
    contract_version: 1,
    schema_version: 1,
    sensor_id: "geo",
    fields: {
      "geo.lat": field("geo.lat", 31.2304, "number"),
      "geo.lon": field("geo.lon", 121.4737, "number"),
      "geo.accuracy_m": field("geo.accuracy_m", 80, "number"),
      "geo.permission": field("geo.permission", "authorized", "enum"),
      "geo.nearestTag": field("geo.nearestTag", "home", "string"),
      "geo.placemark": field("geo.placemark", { city: "Shanghai", district: "Jing'an", street: "Nanjing W Rd", formattedAddress: "123 Nanjing W Rd, Shanghai" }, "object"),
    },
    collected_at: 1000,
    stale_after_ms: 1800000,
    status: "enabled",
    source: { sensor_id: "geo", source_kind: "builtin" },
  };

  const rendered = renderDaseinContext({
    config: { ...baseConfig, sensors: { ...baseConfig.sensors, geo: { ...baseConfig.sensors.geo, enabled: true, agent: true, precision: "exact", exactCoordinates: true, exactAddress: true } } },
    sensorSnapshots: [geoSnapshot],
    now: 1000,
  }) as { agent: string | null; omittedKeys: string[] };

  assert.match(rendered.agent ?? "", /lat=31\.2304/u);
  assert.match(rendered.agent ?? "", /lon=121\.4737/u);
  assert.match(rendered.agent ?? "", /accuracy_m=80/u);
  assert.match(rendered.agent ?? "", /loc=123_Nanjing_W_Rd,_Shanghai/u);
  assert.doesNotMatch(rendered.agent ?? "", /placemark=|formattedAddress|permission=|nearestTag=|authorized|home/u);
  assert.deepEqual(["geo.nearestTag", "geo.permission"].every((key) => rendered.omittedKeys.includes(key)), true);
});

test("geo exact coordinates and exact address render only when agent, precision, and exact privacy gates are all true", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "Testing Gate Matrix row: Renderer output contract");
  const geoSnapshot = {
    contract_version: 1,
    schema_version: 1,
    sensor_id: "geo",
    fields: {
      "geo.lat": { contract_version: 1, schema_version: 1, sensor_id: "geo", state_key: "geo.lat", value: 31.2304, value_type: "number", collected_at: 1000, stale_after_ms: 1800000, status: "enabled", source: { sensor_id: "geo", source_kind: "builtin" } },
      "geo.lon": { contract_version: 1, schema_version: 1, sensor_id: "geo", state_key: "geo.lon", value: 121.4737, value_type: "number", collected_at: 1000, stale_after_ms: 1800000, status: "enabled", source: { sensor_id: "geo", source_kind: "builtin" } },
      "geo.formattedAddress": { contract_version: 1, schema_version: 1, sensor_id: "geo", state_key: "geo.formattedAddress", value: "Exact Street 1", value_type: "string", collected_at: 1000, stale_after_ms: 1800000, status: "enabled", source: { sensor_id: "geo", source_kind: "builtin" } },
    },
    collected_at: 1000,
    stale_after_ms: 1800000,
    status: "enabled",
    source: { sensor_id: "geo", source_kind: "builtin" },
  };

  const gatedOff = renderDaseinContext({
    config: { ...baseConfig, sensors: { ...baseConfig.sensors, geo: { ...baseConfig.sensors.geo, enabled: true, agent: true, precision: "exact", exactCoordinates: false, exactAddress: false } } },
    sensorSnapshots: [geoSnapshot],
    now: 1000,
  }) as { agent: string | null };
  assert.doesNotMatch(gatedOff.agent ?? "", /31\.2304|121\.4737|Exact Street/u);

  const gatedOn = renderDaseinContext({
    config: { ...baseConfig, sensors: { ...baseConfig.sensors, geo: { ...baseConfig.sensors.geo, enabled: true, agent: true, precision: "exact", exactCoordinates: true, exactAddress: true } } },
    sensorSnapshots: [geoSnapshot],
    now: 1000,
  }) as { agent: string | null };
  assert.match(gatedOn.agent ?? "", /31\.2304|121\.4737|Exact Street/u);
});

test("request-path rendering is forbidden; injector reads only pre-rendered context", async () => {
  const api = await loadDaseinApi();
  const assertNoRequestPathRendering = requireExportedFunction(api, "assertNoRequestPathRendering", "Testing Gate Matrix row: Renderer output contract");
  assert.deepEqual(assertNoRequestPathRendering({ path: "context-hook" }), {
    rendererCalled: false,
    schedulerCalled: false,
    ioCalled: false,
  });
});

test("renderer has no sensor render hook ingress and drops non-envelope fields before core-owned strings", async () => {
  const source = `${readFileSync(new URL("../../src/core/types.ts", import.meta.url), "utf8")}\n${readFileSync(new URL("../../src/core/renderer.ts", import.meta.url), "utf8")}`;
  assert.doesNotMatch(source, /renderAgent|renderUI|SensorViewFragment|sensorHookOutput|renderHooks/u);

  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "Testing Gate Matrix row: Renderer output contract");
  const snapshot = clockSnapshot({
    fields: {
      "clock.local_time": {
        ...clockSnapshot().fields["clock.local_time"],
        finalString: "[ambient_ctx: sensor-owned]",
        helperImport: true,
      } as unknown as ReturnType<typeof clockSnapshot>["fields"]["clock.local_time"],
    },
  });

  const rendered = renderDaseinContext({ config: baseConfig, sensorSnapshots: [snapshot], now: 1000 }) as { agent: string | null; status: string | null; omittedKeys: string[] };

  assert.equal(rendered.agent, null, "non-envelope sensor fields are dropped rather than rendered");
  assert.doesNotMatch(JSON.stringify(rendered), /sensor-owned|helperImport/u);
});
