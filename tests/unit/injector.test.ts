import assert from "node:assert/strict";
import test from "node:test";

import { expectedAmbientMessage, expectedSilentAmbientContent, fakeStore, loadDaseinApi, renderedContext, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("injector appends hidden CustomMessage display:false customType:dasein with timestamp from pre-rendered context", async () => {
  const api = await loadDaseinApi();
  const injectAmbientContextMessage = requireExportedFunction(api, "injectAmbientContextMessage", "Testing Gate Matrix row: Request-path no I/O");
  const messages = [{ role: "user", content: "hello" }];
  const result = injectAmbientContextMessage({ stateStore: fakeStore(renderedContext), messages, timestamp: 1_700_000_000_000 }) as {
    changed: boolean;
    messages: unknown[];
    appended: unknown;
  };

  assert.equal(result.changed, true);
  assert.deepEqual(result.messages, [...messages, expectedAmbientMessage()]);
  assert.deepEqual(result.appended, expectedAmbientMessage());
});

test("injector converts hidden custom ambient message to quiet LLM user context without UI display fields", async () => {
  const api = await loadDaseinApi();
  const convertAmbientContextMessageToLlm = requireExportedFunction(api, "convertAmbientContextMessageToLlm", "Testing Gate Matrix row: Request-path no I/O");
  const converted = convertAmbientContextMessageToLlm(expectedAmbientMessage(expectedSilentAmbientContent("[ambient_ctx: time=Fri_14:32+08]"))) as { role: string; content: string };

  assert.equal(converted.role, "user");
  assert.match(converted.content, /^Silent local context for relevance only\./u);
  assert.match(converted.content, /time=Fri_14:32\+08/u);
  assert.doesNotMatch(converted.content, /^\[ambient_ctx:/u);
});

test("injector returns no change when rendered agent is null and never consults config", async () => {
  const api = await loadDaseinApi();
  const injectAmbientContextMessage = requireExportedFunction(api, "injectAmbientContextMessage", "Testing Gate Matrix row: Request-path no I/O");
  let configConsulted = false;
  const store = fakeStore({ ...renderedContext, agent: null });
  const result = injectAmbientContextMessage({
    stateStore: store,
    messages: [],
    timestamp: 1,
    readConfig: () => {
      configConsulted = true;
    },
  }) as { changed: boolean; messages: unknown[] };

  assert.equal(result.changed, false);
  assert.deepEqual(result.messages, []);
  assert.equal(configConsulted, false);
});

test("fake store proof denies fs/network/subprocess/dynamic import/refresh/action/config/durable/native work on request path", async () => {
  const api = await loadDaseinApi();
  const proveInjectorNoIo = requireExportedFunction(api, "proveInjectorNoIo", "Testing Gate Matrix row: Request-path no I/O");
  const proof = proveInjectorNoIo({ stateStore: fakeStore(), messages: [], timestamp: 1 }) as Record<string, boolean>;

  for (const key of ["fs", "child_process", "http", "https", "net", "tls", "dns", "fetch", "XMLHttpRequest", "WebSocket", "dynamicImport", "sensorRefresh", "sensorAction", "sensorCleanup", "sensorDiscovery", "configRead", "configMutation", "durableStateRead", "durableStateWrite", "nativeHelperImport"]) {
    assert.equal(proof[key], false, key);
  }
});
