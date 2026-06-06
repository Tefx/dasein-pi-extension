import assert from "node:assert/strict";
import test from "node:test";

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
  }) as { agent: string | null; status: string | null; widgetLines: string[] | null; omittedKeys: string[]; truncated: boolean };

  assert.deepEqual(rendered, {
    agent: "[ambient_ctx: weather=dry; time=Fri_14:32+08]",
    status: "weather dry; time Fri 14:32 +08",
    widgetLines: ["weather dry", "time Fri 14:32 +08"],
    omittedKeys: [],
    truncated: false,
  });
});

test("unconfigured external keys stay UI-visible but hidden from the agent string", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "Testing Gate Matrix row: Renderer output contract");
  const rendered = renderDaseinContext({
    config: baseConfig,
    sensorSnapshots: [clockSnapshot()],
    externalStates: [{ key: "weather", agent: "secret-agent-value", ui: "human weather", source: "fixture", updatedAt: 1000, expiresAt: 61000 }],
    now: 1000,
  }) as { agent: string | null; status: string | null; widgetLines: string[] | null; omittedKeys: string[]; truncated: boolean };

  assert.equal(rendered.agent, "[ambient_ctx: time=Fri_14:32+08]");
  assert.doesNotMatch(rendered.agent ?? "", /weather|secret-agent-value/u);
  assert.match(rendered.status ?? "", /weather human weather \(agent hidden\)/u);
  assert.deepEqual(rendered.widgetLines?.includes("weather human weather (agent hidden)"), true);
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
  }) as { agent: string | null; omittedKeys: string[] };

  assert.equal(rendered.agent, "[ambient_ctx: loc=Shanghai]");
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

test("adversarial render hooks cannot smuggle I/O intents, refresh/action requests, config mutation, durable-state access, discovery, helper/native import, or final string ownership", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", "Testing Gate Matrix row: Renderer output contract");
  const rendered = renderDaseinContext({
    config: baseConfig,
    sensorSnapshots: [clockSnapshot()],
    now: 1000,
    hooks: {
      clock: {
        renderAgent: () => ({
          sensor_id: "clock",
          state_key: "clock.local_time",
          value: "HOOK_OWNED_FINAL_PROMPT",
          value_type: "string",
          label: "bad",
          finalString: "[ambient_ctx: hook-owned]",
          requestRefresh: true,
          requestAction: "refresh",
          configMutation: { "sensors.clock.agent": false },
          durableStateRead: true,
          discovery: "src/sensors/*.ts",
          nativeHelperImport: "macos-location-helper",
          io: ["fs", "network", "subprocess"],
        }),
        renderUI: () => [{ sensor_id: "clock", state_key: "clock.local_time", value: "ui", value_type: "string", helperImport: true }],
      },
    },
  }) as { agent: string | null; status: string | null; omittedKeys: string[]; hookViolations: string[]; performedIo: boolean; mutatedConfig: boolean; refreshedSensors: boolean };

  assert.deepEqual(rendered.hookViolations.sort(), ["configMutation", "discovery", "durableStateRead", "finalString", "helperImport", "io", "requestAction", "requestRefresh"].sort());
  assert.equal(rendered.performedIo, false);
  assert.equal(rendered.mutatedConfig, false);
  assert.equal(rendered.refreshedSensors, false);
  assert.doesNotMatch(rendered.agent ?? "", /HOOK_OWNED_FINAL_PROMPT|hook-owned|bad/u);
  assert.match(rendered.agent ?? "", /^\[ambient_ctx:/u);
});
