import assert from "node:assert/strict";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

const ambientA = "<DaseinAmbientContext>ambient=A clock=10:00</DaseinAmbientContext>";
const ambientB = "<DaseinAmbientContext>ambient=B clock=10:01</DaseinAmbientContext>";
const marker = "<DaseinAmbientContext>";

type InjectionResult =
  | { changed: true; payload: Record<string, unknown>; providerShape: string; cacheMode: string; content: string }
  | { changed: false; payload: unknown; reason: string };

const prefixBeforeAmbient = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  const markerIndex = serialized.indexOf(marker);
  assert.notEqual(markerIndex, -1, "rewritten payload must contain ambient marker");
  return serialized.slice(0, markerIndex);
};

const withoutAmbient = (value: unknown): string => JSON.stringify(value).replace(/<DaseinAmbientContext>.*?<\/DaseinAmbientContext>/gu, "<AMBIENT>");

const lastUserContent = (payload: Record<string, unknown>, key: "input" | "messages"): Array<Record<string, unknown>> => {
  const items = payload[key] as Array<Record<string, unknown>>;
  const user = [...items].reverse().find((item) => item.role === "user");
  assert.ok(user, "expected user message");
  assert.ok(Array.isArray(user.content), "expected user content array");
  return user.content as Array<Record<string, unknown>>;
};

test("OpenAI Responses payload injection appends ambient input_text after the real user prompt", async () => {
  const api = await loadDaseinApi();
  const injectAmbientProviderPayload = requireExportedFunction(api, "injectAmbientProviderPayload", "OpenAI provider-payload prefix preservation");
  const payload = {
    model: "gpt-test",
    input: [
      { role: "system", content: "stable system" },
      { role: "user", content: [{ type: "input_text", text: "real prompt" }] },
    ],
    stream: true,
    prompt_cache_key: "stable-session",
  };

  const resultA = injectAmbientProviderPayload({ payload, content: ambientA }) as InjectionResult;
  const resultB = injectAmbientProviderPayload({ payload, content: ambientB }) as InjectionResult;

  assert.equal(resultA.changed, true);
  assert.equal(resultB.changed, true);
  if (!resultA.changed || !resultB.changed) return;
  assert.equal(resultA.providerShape, "openai-responses");
  assert.equal(resultA.cacheMode, "prefix-preserving");
  assert.equal(JSON.stringify(payload).includes(marker), false, "original payload must not be mutated");
  assert.equal(withoutAmbient(resultA.payload), withoutAmbient(resultB.payload));
  assert.equal(prefixBeforeAmbient(resultA.payload), prefixBeforeAmbient(resultB.payload));
  assert.deepEqual(lastUserContent(resultA.payload, "input").map((part) => part.type), ["input_text", "input_text"]);
  assert.equal(lastUserContent(resultA.payload, "input").at(-1)?.text, ambientA);
});

test("OpenAI-compatible Chat Completions payload injection appends ambient text after the real user prompt", async () => {
  const api = await loadDaseinApi();
  const injectAmbientProviderPayload = requireExportedFunction(api, "injectAmbientProviderPayload", "OpenAI-compatible provider-payload prefix preservation");
  const payload = {
    model: "chat-test",
    messages: [
      { role: "system", content: "stable system" },
      { role: "user", content: [{ type: "text", text: "real prompt" }] },
    ],
    stream: true,
    prompt_cache_key: "stable-session",
  };

  const resultA = injectAmbientProviderPayload({ payload, content: ambientA }) as InjectionResult;
  const resultB = injectAmbientProviderPayload({ payload, content: ambientB }) as InjectionResult;

  assert.equal(resultA.changed, true);
  assert.equal(resultB.changed, true);
  if (!resultA.changed || !resultB.changed) return;
  assert.equal(resultA.providerShape, "openai-completions");
  assert.equal(resultA.cacheMode, "prefix-preserving");
  assert.equal(JSON.stringify(payload).includes(marker), false, "original payload must not be mutated");
  assert.equal(withoutAmbient(resultA.payload), withoutAmbient(resultB.payload));
  assert.equal(prefixBeforeAmbient(resultA.payload), prefixBeforeAmbient(resultB.payload));
  assert.deepEqual(lastUserContent(resultA.payload, "messages").map((part) => part.type), ["text", "text"]);
  assert.equal(lastUserContent(resultA.payload, "messages").at(-1)?.text, ambientA);
});

test("OpenAI-compatible string user content is converted to text parts before appending ambient context", async () => {
  const api = await loadDaseinApi();
  const injectAmbientProviderPayload = requireExportedFunction(api, "injectAmbientProviderPayload", "OpenAI-compatible string content conversion");
  const result = injectAmbientProviderPayload({
    payload: { messages: [{ role: "user", content: "real prompt" }] },
    content: ambientA,
  }) as InjectionResult;

  assert.equal(result.changed, true);
  if (!result.changed) return;
  assert.deepEqual(lastUserContent(result.payload, "messages"), [
    { type: "text", text: "real prompt" },
    { type: "text", text: ambientA },
  ]);
});

test("unsupported provider payloads are left unchanged and never claim cache safety", async () => {
  const api = await loadDaseinApi();
  const injectAmbientProviderPayload = requireExportedFunction(api, "injectAmbientProviderPayload", "unsupported payload fallback");
  const payload = { contents: [{ role: "user", parts: [{ text: "real prompt" }] }] };
  const result = injectAmbientProviderPayload({ payload, content: ambientA }) as InjectionResult;

  assert.equal(result.changed, false);
  if (result.changed) return;
  assert.equal(result.payload, payload);
  assert.equal(result.reason, "unsupported-payload-shape");
  assert.equal("providerShape" in result, false);
});
