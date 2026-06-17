import assert from "node:assert/strict";
import test from "node:test";

import type { SensorConfig, SensorSnapshot, SensorSpec, SensorStateField } from "../../../src/index.ts";

type LapseConfig = SensorConfig & { persist: boolean; agentFields: Array<"user_idle" | "agent_idle"> };
type LapseState = {
  userIdleMs: number | null;
  agentIdleMs: number | null;
  previousHumanInputAt: number | null;
  previousAgentEndAt: number | null;
};
const expectedLapseFile = new URL("../../../src/sensors/lapse.ts", import.meta.url);

const loadLapseSpec = async (): Promise<SensorSpec<LapseState, LapseConfig>> => {
  const moduleValue = (await import(expectedLapseFile.href)) as { default?: unknown };
  assert.equal(typeof moduleValue.default, "object", "src/sensors/lapse.ts must default-export one SensorSpec");
  assert.notEqual(moduleValue.default, null, "src/sensors/lapse.ts default export must not be null");
  return moduleValue.default as SensorSpec<LapseState, LapseConfig>;
};

const field = (stateKey: string, value: unknown, valueType: SensorStateField["value_type"]): SensorStateField => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: "lapse",
  state_key: stateKey,
  value,
  value_type: valueType,
  collected_at: 18_000,
  stale_after_ms: 120_000,
  status: "enabled",
  source: { sensor_id: "lapse", source_kind: "builtin" },
});

const previousLapseSnapshot = (): SensorSnapshot => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: "lapse",
  fields: {
    "lapse.previous_human_input_at": field("lapse.previous_human_input_at", 10_000, "number"),
    "lapse.previous_agent_end_at": field("lapse.previous_agent_end_at", 18_000, "number"),
  },
  collected_at: 18_000,
  stale_after_ms: 120_000,
  status: "enabled",
  source: { sensor_id: "lapse", source_kind: "builtin" },
});

test("lapse SensorSpec defaults, manifest, and agentFields enum match continuity contract", async () => {
  const lapse = await loadLapseSpec();

  assert.equal(lapse.key, "lapse");
  assert.deepEqual(lapse.defaults, {
    enabled: true,
    ui: true,
    agent: true,
    intervalMs: 60000,
    timeoutMs: 2000,
    staleAfterMs: 120000,
    initialRefresh: true,
    persist: true,
    agentFields: ["user_idle"],
  });
  assert.deepEqual(lapse.fields?.persist, { label: "Persist lapse continuity", type: "boolean" });
  assert.deepEqual(lapse.fields?.agentFields?.item?.values, ["user_idle", "agent_idle"]);
  assert.doesNotMatch(JSON.stringify(lapse.fields), /previous_run/u, "previous_run is derived UI-only and must not be an agent field");
  assert.deepEqual(lapse.manifest.declaredInputClasses, ["pi_lifecycle", "derived"]);
  assert.deepEqual(lapse.manifest.backgroundWork, {
    capable: true,
    kinds: ["initial_refresh", "recurring_interval", "pi_lifecycle_observe"],
    defaultIntervalMs: 60000,
    intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
    description: "local lapse refresh and Pi lifecycle observation",
  });
  assert.equal("renderAgent" in lapse, false, "lapse SensorSpec publishes typed state only; core owns agent rendering");
  assert.equal("renderUI" in lapse, false, "lapse SensorSpec publishes typed state only; core owns UI rendering");
});

const testSensorContext = <TConfig>(config: TConfig, now: () => number) => ({
  config,
  signal: new AbortController().signal,
  reason: "test",
  manual: false,
  now,
});

test("lapse refresh recomputes durations from previous timestamps without erasing continuity", async () => {
  const lapse = await loadLapseSpec();
  if (typeof lapse.refresh !== "function") assert.fail("lapse must implement SensorSpec.refresh");

  const refreshed = await lapse.refresh(
    testSensorContext(lapse.defaults, () => 70_000),
    previousLapseSnapshot(),
  );
  const text = JSON.stringify(refreshed);

  assert.match(text, /userIdleMs/u);
  assert.match(text, /60000/u, "refresh user_idle is now - previous_human_input_at");
  assert.match(text, /agentIdleMs/u);
  assert.match(text, /52000/u, "refresh agent_idle is now - previous_agent_end_at");
  assert.match(text, /previousHumanInputAt/u);
  assert.match(text, /previousAgentEndAt/u);
});

test("lapse observe samples input, suppresses duplicate before_agent_start for the same turn, and updates latest timestamps only", async () => {
  const lapse = await loadLapseSpec();
  if (typeof lapse.observe !== "function") assert.fail("lapse must implement SensorSpec.observe");

  const inputResult = await lapse.observe(
    { kind: "input", observedAt: 20_000, turnId: "turn-1" },
    testSensorContext(lapse.defaults, () => 20_000),
    previousLapseSnapshot(),
  );
  const beforeAgentResult = await lapse.observe(
    { kind: "before_agent_start", observedAt: 20_001, turnId: "turn-1" },
    testSensorContext(lapse.defaults, () => 20_001),
    previousLapseSnapshot(),
  );
  const agentEndResult = await lapse.observe(
    { kind: "agent_end", observedAt: 25_000, turnId: "turn-1" },
    testSensorContext(lapse.defaults, () => 25_000),
    previousLapseSnapshot(),
  );

  const inputText = JSON.stringify(inputResult);
  assert.match(inputText, /userIdleMs|lapse\.user_idle/u, "input observation computes user_idle from previous human input");
  assert.match(inputText, /10000/u, "input observation user_idle is 20s - 10s");
  assert.match(inputText, /agentIdleMs|lapse\.agent_idle/u, "input observation computes agent_idle from previous agent end");
  assert.match(inputText, /2000/u, "input observation agent_idle is 20s - 18s");
  assert.doesNotMatch(inputText, /previous_run|history|cache|runs/u, "lapse must not store previous_run/history/cache fields");
  assert.equal(beforeAgentResult, null, "before_agent_start for an already observed input turn is ignored");
  assert.match(JSON.stringify(agentEndResult), /25000|previousAgentEndAt|previous_agent_end_at/u, "agent_end updates only latest previous_agent_end_at");
});

test("lapse persistence controller seam is not a public export; product reset uses /dasein lapse reset", async () => {
  const moduleValue = (await import(expectedLapseFile.href)) as Record<string, unknown>;

  assert.equal(moduleValue.createLapsePersistenceController, undefined);
  assert.equal("createLapsePersistenceController" in moduleValue, false);
});
