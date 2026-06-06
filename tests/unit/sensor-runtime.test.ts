import assert from "node:assert/strict";
import test from "node:test";

import { clockField, clockSnapshot, loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("sensor runtime commits only typed envelope fields and rejects raw refresh state", async () => {
  const api = await loadDaseinApi();
  const normalizeSensorRefreshResult = requireExportedFunction(api, "normalizeSensorRefreshResult", "Testing Gate Matrix row: Sensor runtime typed state, observe hook, stale, refresh, and cleanup");
  const snapshot = normalizeSensorRefreshResult({
    sensorKey: "clock",
    value: { local: "Fri_14:32+08", forbiddenRaw: "must not persist" },
    outputFields: [{ state_key: "clock.local_time", value_type: "string", description: "time", agentVisibleByDefault: true, uiVisibleByDefault: true }],
    collectedAt: 1000,
    staleAfterMs: 120000,
    source: { sensor_id: "clock", source_kind: "builtin" },
  }) as ReturnType<typeof clockSnapshot>;

  assert.deepEqual(Object.keys(snapshot).sort(), ["collected_at", "contract_version", "fields", "schema_version", "sensor_id", "source", "stale_after_ms", "status"].sort());
  assert.deepEqual(snapshot.fields["clock.local_time"], clockField());
  assert.equal(JSON.stringify(snapshot).includes("forbiddenRaw"), false);
});

test("runtime allows one active refresh, prevents obsolete commits, and derives stale without store mutation", async () => {
  const api = await loadDaseinApi();
  const createSensorRuntime = requireExportedFunction(api, "createSensorRuntime", "Testing Gate Matrix row: Sensor runtime typed state, observe hook, stale, refresh, and cleanup");
  const runtime = createSensorRuntime({ sensorKey: "clock", staleAfterMs: 1000 }) as {
    refreshNow(options: { reason: string; durationMs?: number; generation?: number }): Promise<{ ok: boolean; snapshot?: unknown; error?: unknown }>;
    activeRefreshCount(): number;
    commitAttemptCount(): number;
    read(now: number): { status: string; mutatedStore: boolean };
  };

  const first = runtime.refreshNow({ reason: "manual", durationMs: 10, generation: 1 });
  assert.equal(runtime.activeRefreshCount(), 1);
  const second = runtime.refreshNow({ reason: "manual", durationMs: 1, generation: 2 });
  await Promise.all([first, second]);
  assert.equal(runtime.activeRefreshCount(), 0);
  assert.equal(runtime.commitAttemptCount(), 1);
  assert.deepEqual(runtime.read(5000), { status: "stale", mutatedStore: false });
});

test("lapse observe handles input/before_agent_start/agent_end without request-path disk I/O", async () => {
  const api = await loadDaseinApi();
  const observeLapseLifecycle = requireExportedFunction(api, "observeLapseLifecycle", "Testing Gate Matrix row: Sensor runtime typed state, observe hook, stale, refresh, and cleanup");
  const result = await observeLapseLifecycle([
    { kind: "input", observedAt: 1000, turnId: "a" },
    { kind: "before_agent_start", observedAt: 1001, turnId: "a" },
    { kind: "agent_end", observedAt: 2000, turnId: "a" },
  ]) as { snapshot: unknown; durableWriteEnqueuedAfterRequest: boolean; requestPathIo: boolean };

  assert.match(JSON.stringify(result.snapshot), /lapse\.user_idle|previous_human_input_at/u);
  assert.equal(result.requestPathIo, false);
  assert.equal(result.durableWriteEnqueuedAfterRequest, true);
});
