import assert from "node:assert/strict";
import test from "node:test";

import { externalWeather, loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("external set/clear validation accepts minimal documented formats and rejects convenience-only fields", async () => {
  const api = await loadDaseinApi();
  const createExternalStateBridge = requireExportedFunction(api, "createExternalStateBridge", "Testing Gate Matrix row: External state intake and SettingsList visibility");
  const bridge = createExternalStateBridge({ now: () => 1000 }) as {
    set(event: unknown): { ok: boolean; snapshot?: unknown; errors?: unknown[] };
    clear(event: unknown): { ok: boolean; clearedKey?: string; errors?: unknown[] };
    listExternalStates(): unknown[];
  };

  assert.deepEqual(bridge.set({ key: "weather", ui: "dry", ttlMs: 60000 }), {
    ok: true,
    snapshot: { key: "weather", agent: null, ui: "dry", source: null, updatedAt: 1000, expiresAt: 61000 },
  });
  assert.deepEqual(bridge.clear({ key: "weather" }), { ok: true, clearedKey: "weather" });
  assert.deepEqual(bridge.set({ ...externalWeather, displayName: "convenience field" }).ok, false);
  assert.deepEqual(bridge.clear({ key: "weather", source: "publisher" }).ok, false);
});

test("external event strings reject ASCII controls, CR/LF, and Unicode separators without state mutation", async () => {
  const api = await loadDaseinApi();
  const createExternalStateBridge = requireExportedFunction(api, "createExternalStateBridge", "Testing Gate Matrix row: External state intake and SettingsList visibility");
  const bridge = createExternalStateBridge({ now: () => 1000 }) as {
    set(event: unknown): { ok: boolean; errors?: unknown[] };
    listExternalStates(): unknown[];
  };

  const invalidPayloads = [
    { key: "weather", agent: "line\nbreak" },
    { key: "weather", ui: "line\rbreak" },
    { key: "weather", source: "source\u0007bell", ui: "ok" },
    { key: "weather", agent: "line\u2028separator" },
    { key: "weather", ui: "paragraph\u2029separator" },
    { key: "weather", source: "source\u2028separator", ui: "ok" },
  ];

  for (const payload of invalidPayloads) {
    const result = bridge.set(payload);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.match(JSON.stringify(result.errors), /control|separator|multiline/u);
    assert.deepEqual(bridge.listExternalStates(), []);
  }
});

test("external ttl defaults and bounds are enforced and unconfigured keys are ui-visible agent-hidden", async () => {
  const api = await loadDaseinApi();
  const createExternalStateBridge = requireExportedFunction(api, "createExternalStateBridge", "Testing Gate Matrix row: External state intake and SettingsList visibility");
  const bridge = createExternalStateBridge({ now: () => 1000 }) as { set(event: unknown): { ok: boolean; snapshot?: { expiresAt: number; agent: string | null; ui: string | null }; config?: unknown } };

  assert.equal(bridge.set({ key: "short", ui: "x", ttlMs: 999 }).ok, false);
  assert.equal(bridge.set({ key: "long", ui: "x", ttlMs: 86400001 }).ok, false);
  const accepted = bridge.set({ key: "weather", ui: "dry" });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.snapshot?.expiresAt, 61000);
  assert.deepEqual(accepted.config, { ui: true, agent: false });
});
