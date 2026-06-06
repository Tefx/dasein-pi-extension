import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { baseConfig, loadDaseinApi, requireExportedFunction, withTempDaseinHome } from "../fixtures/helpers/core-fixtures.ts";

type AtomicWriter = (args: { path: string; value: unknown; failAt?: "write" | "fsync" | "rename"; fsyncAvailable?: boolean }) => Promise<{ ok: boolean; tempPath: string; fsynced: boolean; renamed: boolean }>;

test("config writes use same-directory temp file, fsync when available, and atomic rename", async () => {
  const api = await loadDaseinApi();
  const writeConfigAtomically = requireExportedFunction(api, "writeConfigAtomically", "Testing Gate Matrix row: Config atomicity, mutation queue, and durable state") as AtomicWriter;

  await withTempDaseinHome(async ({ configPath }) => {
    const result = await writeConfigAtomically({ path: configPath, value: { version: 1, sensors: { clock: { precision: "hour" } } }, fsyncAvailable: true });
    assert.deepEqual(result, { ok: true, tempPath: `${configPath}.tmp`, fsynced: true, renamed: true });
    assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")) as unknown, { version: 1, sensors: { clock: { precision: "hour" } } });
    assert.equal(existsSync(result.tempPath), false, "temp file must not remain after rename");
  });
});

test("failed config persistence preserves disk and active effective config", async () => {
  const api = await loadDaseinApi();
  const createConfigManager = requireExportedFunction(api, "createConfigManager", "Testing Gate Matrix row: Config atomicity, mutation queue, and durable state");

  await withTempDaseinHome(async ({ configPath }) => {
    const manager = createConfigManager({ defaults: baseConfig, configPath }) as {
      getEffectiveConfig(): unknown;
      setRuntime(path: string, value: unknown, options?: { failPersistenceAt?: "write" | "fsync" | "rename" }): Promise<{ ok: boolean; errors?: unknown[] }>;
    };
    const before = manager.getEffectiveConfig();
    const failed = await manager.setRuntime("clock.precision", "hour", { failPersistenceAt: "rename" });

    assert.equal(failed.ok, false);
    assert.match(JSON.stringify(failed.errors), /persist-failed/u);
    assert.deepEqual(manager.getEffectiveConfig(), before);
    assert.equal(existsSync(configPath), false, "failed first write must not create config.json");
  });
});
