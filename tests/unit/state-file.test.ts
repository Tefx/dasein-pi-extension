import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction, withTempDaseinHome } from "../fixtures/helpers/core-fixtures.ts";

test("state.json schema is exactly version plus bounded lapse state and drops unknown top-level keys", async () => {
  const api = await loadDaseinApi();
  const createDurableStateStore = requireExportedFunction(api, "createDurableStateStore", "Testing Gate Matrix row: Config atomicity, mutation queue, and durable state");

  await withTempDaseinHome(async ({ statePath }) => {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ version: 1, lapse: { previous_human_input_at: 10, previous_agent_end_at: 20 }, external: { weather: "forbidden" } }));
    const store = createDurableStateStore({ statePath, lapsePersistEnabled: true }) as {
      load(): Promise<{ ok: boolean; lapse: unknown }>;
      writeLapse(lapse: unknown): Promise<{ ok: boolean; fsynced: boolean; renamed: boolean }>;
    };

    assert.deepEqual(await store.load(), { ok: true, lapse: { previous_human_input_at: 10, previous_agent_end_at: 20 } });
    const write = await store.writeLapse({ previous_human_input_at: 30, previous_agent_end_at: null });
    assert.deepEqual(write, { ok: true, fsynced: true, renamed: true });
    assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")) as unknown, { version: 1, lapse: { previous_human_input_at: 30, previous_agent_end_at: null } });
  });
});

test("failed durable-state write leaves prior state.json unchanged and surfaces durable error", async () => {
  const api = await loadDaseinApi();
  const createDurableStateStore = requireExportedFunction(api, "createDurableStateStore", "Testing Gate Matrix row: Config atomicity, mutation queue, and durable state");

  await withTempDaseinHome(async ({ statePath }) => {
    mkdirSync(dirname(statePath), { recursive: true });
    const oldText = JSON.stringify({ version: 1, lapse: { previous_human_input_at: 10, previous_agent_end_at: null } });
    writeFileSync(statePath, oldText);
    const store = createDurableStateStore({ statePath, lapsePersistEnabled: true }) as {
      writeLapse(lapse: unknown, options?: { failAt?: "write" | "fsync" | "rename" }): Promise<{ ok: boolean; error?: unknown }>;
    };

    const result = await store.writeLapse({ previous_human_input_at: 99, previous_agent_end_at: 100 }, { failAt: "rename" });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.error), /durable_state|write-failed/u);
    assert.equal(readFileSync(statePath, "utf8"), oldText);
    assert.equal(existsSync(`${statePath}.tmp`), false);
  });
});
