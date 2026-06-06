import assert from "node:assert/strict";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("shutdown aborts refreshes before bounded concurrent cleanup and aggregates errors", async () => {
  const api = await loadDaseinApi();
  const createDaseinLifecycle = requireExportedFunction(api, "createDaseinLifecycle", "Testing Gate Matrix row: Sensor runtime typed state, observe hook, stale, refresh, and cleanup");
  const lifecycle = createDaseinLifecycle({ cleanupTimeoutMs: 1000 }) as {
    shutdown(): Promise<{ abortedRefreshesFirst: boolean; cleanupTimeoutMs: number; cleanupRanConcurrently: boolean; errors: unknown[] }>;
  };

  const result = await lifecycle.shutdown();
  assert.equal(result.abortedRefreshesFirst, true);
  assert.equal(result.cleanupTimeoutMs, 1000);
  assert.equal(result.cleanupRanConcurrently, true);
  assert.ok(Array.isArray(result.errors));
});

test("shutdown escalates supervised helper abort, terminate, then kill before cleanup", async () => {
  const api = await loadDaseinApi();
  const createDaseinLifecycle = requireExportedFunction(api, "createDaseinLifecycle", "docs/TECHNICAL_DESIGN.md#builtin-sensors cleanup guarantees");
  const calls: string[] = [];
  const lifecycle = createDaseinLifecycle({
    cleanupTimeoutMs: 1000,
    helperKillGraceMs: 0,
    helpers: [{
      abort: () => calls.push("helper.abort"),
      terminate: () => calls.push("helper.terminate"),
      kill: () => calls.push("helper.kill"),
    }],
    cleanupHandlers: [() => calls.push("cleanup")],
  }) as {
    shutdown(): Promise<{ abortedRefreshesFirst: boolean; cleanupTimeoutMs: number; cleanupRanConcurrently: boolean; errors: unknown[] }>;
  };

  const result = await lifecycle.shutdown();

  assert.equal(result.abortedRefreshesFirst, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(calls, ["helper.abort", "helper.terminate", "helper.kill", "cleanup"]);
});
