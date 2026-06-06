import assert from "node:assert/strict";
import test from "node:test";

import { expectedAmbientSystemPromptBlock, fakeStore, loadDaseinApi, renderedContext, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("injector appends ambient context to system prompt without creating user/custom messages", async () => {
  const api = await loadDaseinApi();
  const injectAmbientSystemPrompt = requireExportedFunction(api, "injectAmbientSystemPrompt", "Testing Gate Matrix row: Request-path no I/O");
  const result = injectAmbientSystemPrompt({ stateStore: fakeStore(renderedContext), systemPrompt: "BASE SYSTEM" }) as {
    changed: boolean;
    systemPrompt: string;
    content: string;
    messages?: unknown[];
    appended?: unknown;
  };

  assert.equal(result.changed, true);
  assert.equal(result.content, expectedAmbientSystemPromptBlock());
  assert.equal(result.systemPrompt, `BASE SYSTEM\n\n${expectedAmbientSystemPromptBlock()}`);
  assert.equal(result.messages, undefined);
  assert.equal(result.appended, undefined);
  assert.doesNotMatch(result.systemPrompt, /^\[ambient_ctx:/u);
  assert.match(result.systemPrompt, /<DaseinAmbientContext>\nLocal ambient context for relevance only\./u);
});

test("injector formats renderer ambient envelope as bounded system prompt context", async () => {
  const api = await loadDaseinApi();
  const formatAmbientSystemPromptBlock = requireExportedFunction(api, "formatAmbientSystemPromptBlock", "Testing Gate Matrix row: Request-path no I/O");
  const content = formatAmbientSystemPromptBlock("[ambient_ctx: time=Fri_14:32+08]") as string;

  assert.match(content, /^<DaseinAmbientContext>\n/u);
  assert.match(content, /time=Fri_14:32\+08/u);
  assert.doesNotMatch(content, /\[ambient_ctx:/u);
  assert.match(content, /<\/DaseinAmbientContext>$/u);
});

test("injector returns no change when rendered agent is null and never consults config", async () => {
  const api = await loadDaseinApi();
  const injectAmbientSystemPrompt = requireExportedFunction(api, "injectAmbientSystemPrompt", "Testing Gate Matrix row: Request-path no I/O");
  let configConsulted = false;
  const store = fakeStore({ ...renderedContext, agent: null });
  const result = injectAmbientSystemPrompt({
    stateStore: store,
    systemPrompt: "BASE SYSTEM",
    readConfig: () => {
      configConsulted = true;
    },
  }) as { changed: boolean; systemPrompt: string; messages?: unknown[] };

  assert.equal(result.changed, false);
  assert.equal(result.systemPrompt, "BASE SYSTEM");
  assert.equal(result.messages, undefined);
  assert.equal(configConsulted, false);
});

test("fake store proof denies fs/network/subprocess/dynamic import/refresh/action/config/durable/native work on request path", async () => {
  const api = await loadDaseinApi();
  const proveInjectorNoIo = requireExportedFunction(api, "proveInjectorNoIo", "Testing Gate Matrix row: Request-path no I/O");
  const proof = proveInjectorNoIo({ stateStore: fakeStore(), systemPrompt: "BASE SYSTEM" }) as Record<string, boolean>;

  for (const key of ["fs", "child_process", "http", "https", "net", "tls", "dns", "fetch", "XMLHttpRequest", "WebSocket", "dynamicImport", "sensorRefresh", "sensorAction", "sensorCleanup", "sensorDiscovery", "configRead", "configMutation", "durableStateRead", "durableStateWrite", "nativeHelperImport"]) {
    assert.equal(proof[key], false, key);
  }
});
