import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
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

test("sensor runtime passes refresh reason and manual intent into SensorContext", async () => {
  const api = await loadDaseinApi();
  const createSensorRuntime = requireExportedFunction(api, "createSensorRuntime", "Testing Gate Matrix row: Sensor runtime typed state, observe hook, stale, refresh, and cleanup");
  const seenContexts: Array<{ reason: string; manual: boolean }> = [];
  const runtime = createSensorRuntime({
    sensorKey: "probe",
    config: { enabled: true, ui: true, agent: true, intervalMs: null, staleAfterMs: 1000 },
    refresh: (context: { reason: string; manual: boolean }) => {
      seenContexts.push({ reason: context.reason, manual: context.manual });
      return { value: "ok" };
    },
  }) as { refreshNow(options: { reason: string; bypassBackoff?: boolean }): Promise<{ ok: boolean }> };

  await runtime.refreshNow({ reason: "interval" });
  await runtime.refreshNow({ reason: "geo_manual_refresh", bypassBackoff: true });

  assert.deepEqual(seenContexts, [
    { reason: "interval", manual: false },
    { reason: "geo_manual_refresh", manual: true },
  ]);
});

test("sensor runtime timeoutMs aborts slow refreshes and commits a timeout error envelope only", async () => {
  const api = await loadDaseinApi();
  const createSensorRuntime = requireExportedFunction(api, "createSensorRuntime", "Testing Gate Matrix row: Sensor runtime typed state, observe hook, stale, refresh, and cleanup");
  let sawAbort = false;
  const runtime = createSensorRuntime({
    sensorKey: "slow",
    config: { enabled: true, ui: true, agent: true, timeoutMs: 5, intervalMs: null, staleAfterMs: 1000 },
    refresh: ({ signal }: { signal: AbortSignal }) => new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        sawAbort = true;
      }, { once: true });
      setTimeout(() => resolve({ value: "late-success" }), 30);
    }),
  }) as {
    refreshNow(options: { reason: string }): Promise<{ ok: boolean; snapshot: { status: string; error?: { kind: string }; fields: Record<string, { status: string; error?: { kind: string }; value: unknown }>; refresh?: { timedOut: boolean } } | null; error?: { kind: string } }>;
    commitAttemptCount(): number;
    getSnapshot(): { status: string; error?: { kind: string }; fields: Record<string, { status: string; error?: { kind: string }; value: unknown }>; refresh?: { timedOut: boolean } } | null;
    stopRecurringRefreshes(): void;
  };

  const result = await runtime.refreshNow({ reason: "manual" });

  assert.equal(result.ok, false);
  assert.equal(result.error?.kind, "timeout");
  assert.equal(sawAbort, true);
  assert.equal(result.snapshot?.status, "error");
  assert.equal(result.snapshot?.error?.kind, "timeout");
  assert.equal(result.snapshot?.refresh?.timedOut, true);
  assert.deepEqual(Object.values(result.snapshot?.fields ?? {}).map((field) => [field.status, field.error?.kind, field.value]), [["error", "timeout", null]]);
  assert.equal(runtime.commitAttemptCount(), 1);

  await wait(40);
  assert.equal(runtime.getSnapshot()?.error?.kind, "timeout", "late slow refresh resolution must not overwrite the timeout envelope");
  assert.equal(runtime.commitAttemptCount(), 1);
  runtime.stopRecurringRefreshes();
});

test("sensor runtime intervalMs schedules recurring real refreshes and cleanup stops the scheduler", async () => {
  const api = await loadDaseinApi();
  const createSensorRuntime = requireExportedFunction(api, "createSensorRuntime", "Testing Gate Matrix row: Sensor runtime typed state, observe hook, stale, refresh, and cleanup");
  let refreshCount = 0;
  const committedValues: unknown[] = [];
  const runtime = createSensorRuntime({
    sensorKey: "pulse",
    config: { enabled: true, ui: true, agent: true, timeoutMs: 50, intervalMs: 5, staleAfterMs: 50 },
    refresh: () => ({ value: `tick-${++refreshCount}` }),
    onCommit: (snapshot: { fields: Record<string, { value: unknown }> }) => {
      committedValues.push(snapshot.fields["pulse.value"]?.value);
    },
  }) as {
    commitAttemptCount(): number;
    stopRecurringRefreshes(): void;
  };

  await wait(24);
  runtime.stopRecurringRefreshes();
  const attemptsAfterStop = runtime.commitAttemptCount();
  const valuesAfterStop = [...committedValues];

  assert.equal(attemptsAfterStop >= 2, true, `expected at least two recurring commits, saw ${attemptsAfterStop}`);
  assert.deepEqual(valuesAfterStop.slice(0, 2), ["tick-1", "tick-2"]);

  await wait(20);
  assert.equal(runtime.commitAttemptCount(), attemptsAfterStop);
  assert.deepEqual(committedValues, valuesAfterStop);
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
