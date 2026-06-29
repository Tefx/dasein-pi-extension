import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("auto transport resolver uses generated cache capability table before falling back to systemPrompt", async () => {
  const api = await loadDaseinApi();
  const resolveAutoAgentInjectionTransport = requireExportedFunction(api, "resolveAutoAgentInjectionTransport", "offline model capability auto transport resolver") as (model: unknown) => {
    transport: "providerPayload" | "systemPrompt";
    reason: string;
    provider: string | null;
    model: string | null;
    matchedSource: string | null;
    matchedSignals: string[];
  };
  const generated = JSON.parse(readFileSync("src/generated/model-capabilities.json", "utf8")) as {
    cachePreferred: Array<{ provider: string; model: string; source: string; signals: string[] }>;
  };
  const first = generated.cachePreferred[0];
  assert.ok(first, "generated capability cache must contain at least one cache-preferred model");

  const matched = resolveAutoAgentInjectionTransport({ provider: first.provider, id: first.model });
  assert.equal(matched.transport, "providerPayload");
  assert.equal(matched.reason, "generated-cache-capability");
  assert.equal(typeof matched.matchedSource, "string");
  assert.equal((matched.matchedSource ?? "").length > 0, true);
  assert.equal(matched.matchedSignals.length > 0, true);

  const unknown = resolveAutoAgentInjectionTransport({ provider: "unknown-provider", id: "unknown-model" });
  assert.deepEqual(unknown, {
    transport: "systemPrompt",
    reason: "unknown-model",
    provider: "unknown-provider",
    model: "unknown-model",
    matchedSource: null,
    matchedSignals: [],
  });
});

test("auto transport resolver accepts local model metadata cache signals without network access", async () => {
  const api = await loadDaseinApi();
  const resolveAutoAgentInjectionTransport = requireExportedFunction(api, "resolveAutoAgentInjectionTransport", "local model metadata auto transport resolver") as (model: unknown) => {
    transport: "providerPayload" | "systemPrompt";
    reason: string;
    matchedSource: string | null;
    matchedSignals: string[];
  };
  const modelDescriptorFromModelSelectEvent = requireExportedFunction(api, "modelDescriptorFromModelSelectEvent", "model_select event coercion") as (event: unknown) => unknown;
  const modelCapabilityCacheSummary = api.modelCapabilityCacheSummary as { runtimeNetworkAccess: boolean; cachePreferredCount: number };

  assert.equal(modelCapabilityCacheSummary.runtimeNetworkAccess, false);
  assert.equal(modelCapabilityCacheSummary.cachePreferredCount > 0, true);

  const viaCost = resolveAutoAgentInjectionTransport({ provider: "custom", id: "local-cache", cost: { cacheRead: 0.1, cacheWrite: 0 } });
  assert.equal(viaCost.transport, "providerPayload");
  assert.equal(viaCost.reason, "local-model-cache-signal");
  assert.equal(viaCost.matchedSource, "model-metadata");
  assert.deepEqual(viaCost.matchedSignals, ["model.cost.cacheRead"]);

  const viaCompat = resolveAutoAgentInjectionTransport({ provider: "custom", id: "compat-cache", compat: { cacheControlFormat: "anthropic" } });
  assert.equal(viaCompat.transport, "providerPayload");
  assert.deepEqual(viaCompat.matchedSignals, ["model.compat.cacheControlFormat"]);

  const rawEventDescriptor = modelDescriptorFromModelSelectEvent({ provider: "custom", model: "raw-event-id", cost: { cacheWrite: "0.2" } });
  const viaRawEvent = resolveAutoAgentInjectionTransport(rawEventDescriptor);
  assert.equal(viaRawEvent.transport, "providerPayload");
  assert.deepEqual(viaRawEvent.matchedSignals, ["model.cost.cacheWrite"]);

  const nestedEventDescriptor = modelDescriptorFromModelSelectEvent({ selectedModel: { provider: "custom", name: "named-model", compat: { cacheControlFormat: "openai" } } });
  const viaNestedEvent = resolveAutoAgentInjectionTransport(nestedEventDescriptor);
  assert.equal(viaNestedEvent.transport, "providerPayload");
  assert.deepEqual(viaNestedEvent.matchedSignals, ["model.compat.cacheControlFormat"]);

  const missing = resolveAutoAgentInjectionTransport(null);
  assert.equal(missing.transport, "systemPrompt");
  assert.equal(missing.reason, "missing-model");
});
