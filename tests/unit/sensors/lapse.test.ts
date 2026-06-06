import assert from "node:assert/strict";
import test from "node:test";

import type { SensorConfig, SensorObservationEvent, SensorSnapshot, SensorSpec, SensorStateField } from "../../../src/index.ts";
import { loadDaseinApi, requireExportedFunction } from "../../fixtures/helpers/core-fixtures.ts";

type LapseConfig = SensorConfig & { persist: boolean; agentFields: Array<"user_idle" | "agent_idle"> };
type LapseState = {
  userIdleMs: number | null;
  agentIdleMs: number | null;
  previousHumanInputAt: number | null;
  previousAgentEndAt: number | null;
};
type LapsePersistedState = {
  previous_human_input_at: number | null;
  previous_agent_end_at: number | null;
};
type LapsePersistenceController = {
  load(input: { persist: boolean; state: unknown }): LapsePersistedState | null;
  observe(input: { persist: boolean; event: SensorObservationEvent; previous: LapsePersistedState | null }): { inMemory: LapsePersistedState; durableWriteEnqueuedAfterRequest: boolean; requestPathIo: false };
  reset(input: { config: LapseConfig; persisted: LapsePersistedState | null }): { config: LapseConfig; persisted: LapsePersistedState; memory: LapsePersistedState; deletedHistoryKeys: string[] };
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
});

test("lapse observe samples input, suppresses duplicate before_agent_start for the same turn, and updates latest timestamps only", async () => {
  const lapse = await loadLapseSpec();
  if (typeof lapse.observe !== "function") assert.fail("lapse must implement SensorSpec.observe");

  const inputResult = await lapse.observe(
    { kind: "input", observedAt: 20_000, turnId: "turn-1" },
    { config: lapse.defaults, signal: new AbortController().signal, now: () => 20_000 },
    previousLapseSnapshot(),
  );
  const beforeAgentResult = await lapse.observe(
    { kind: "before_agent_start", observedAt: 20_001, turnId: "turn-1" },
    { config: lapse.defaults, signal: new AbortController().signal, now: () => 20_001 },
    previousLapseSnapshot(),
  );
  const agentEndResult = await lapse.observe(
    { kind: "agent_end", observedAt: 25_000, turnId: "turn-1" },
    { config: lapse.defaults, signal: new AbortController().signal, now: () => 25_000 },
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

test("lapse persistence gates startup load and observation durable writes independently from collection and agent visibility", async () => {
  const api = await loadDaseinApi();
  const createLapsePersistenceController = requireExportedFunction(api, "createLapsePersistenceController", "docs/PRD.md#9-5-builtin-sensors lapse persistence gate") as () => LapsePersistenceController;
  const persistence = createLapsePersistenceController();
  const state: LapsePersistedState = { previous_human_input_at: 10_000, previous_agent_end_at: 18_000 };

  assert.equal(persistence.load({ persist: false, state }), null, "persist=false ignores startup durable timestamps");
  assert.deepEqual(persistence.load({ persist: true, state }), state, "persist=true imports only latest two timestamps");

  assert.deepEqual(persistence.observe({ persist: false, previous: state, event: { kind: "input", observedAt: 20_000, turnId: "a" } }), {
    inMemory: { previous_human_input_at: 20_000, previous_agent_end_at: 18_000 },
    durableWriteEnqueuedAfterRequest: false,
    requestPathIo: false,
  });
  assert.deepEqual(persistence.observe({ persist: true, previous: state, event: { kind: "agent_end", observedAt: 25_000, turnId: "a" } }), {
    inMemory: { previous_human_input_at: 10_000, previous_agent_end_at: 25_000 },
    durableWriteEnqueuedAfterRequest: true,
    requestPathIo: false,
  });
});

test("/dasein lapse reset clears memory and persisted timestamps without changing enabled/persist/agent config", async () => {
  const api = await loadDaseinApi();
  const createLapsePersistenceController = requireExportedFunction(api, "createLapsePersistenceController", "docs/TECHNICAL_DESIGN.md#builtin-sensors lapse reset action") as () => LapsePersistenceController;
  const persistence = createLapsePersistenceController();
  const config: LapseConfig = { enabled: true, ui: true, agent: false, intervalMs: 60000, timeoutMs: 2000, staleAfterMs: 120000, initialRefresh: true, persist: false, agentFields: ["user_idle"] };

  assert.deepEqual(persistence.reset({ config, persisted: { previous_human_input_at: 10_000, previous_agent_end_at: 18_000 } }), {
    config,
    persisted: { previous_human_input_at: null, previous_agent_end_at: null },
    memory: { previous_human_input_at: null, previous_agent_end_at: null },
    deletedHistoryKeys: [],
  });
});
