import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

const writeJson = (path: string, value: unknown): void => writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");

const runUpdater = (args: string[]): void => {
  execFileSync(process.execPath, ["scripts/update-model-capabilities.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
};

test("model capability updater distills cache signals from offline fixtures without runtime network dependency", () => {
  const root = mkdtempSync(join(tmpdir(), "dasein-model-capabilities-"));
  try {
    const modelsDev = join(root, "models-dev.json");
    const openrouter = join(root, "openrouter.json");
    const litellm = join(root, "litellm.json");
    const output = join(root, "model-capabilities.json");

    writeJson(modelsDev, {
      provider_a: {
        models: {
          "cache-model": { id: "cache-model", cost: { input: 1, output: 2, cache_read: 0.1 } },
          "no-cache-model": { id: "no-cache-model", cost: { input: 1, output: 2 } },
        },
      },
    });
    writeJson(openrouter, {
      data: [
        { id: "open/cache-write", pricing: { prompt: "0.1", completion: "0.2", input_cache_write: "0.05" } },
        { id: "open/no-cache", pricing: { prompt: "0.1", completion: "0.2" } },
      ],
    });
    writeJson(litellm, {
      "claude-cache": { litellm_provider: "anthropic", cache_creation_input_token_cost: 0.01, cache_read_input_token_cost: 0.001 },
      "plain-model": { litellm_provider: "plain", input_cost_per_token: 0.01 },
    });

    runUpdater(["--models-dev", modelsDev, "--openrouter", openrouter, "--litellm", litellm, "--output", output]);
    const document = JSON.parse(readFileSync(output, "utf8")) as {
      schemaVersion: number;
      runtimeNetworkAccess: boolean;
      autoTransportPolicy: { cachePreferredTransport: string; fallbackTransport: string };
      sources: Array<{ id: string; modelCount: number; cachePreferredCount: number }>;
      cachePreferred: Array<{ source: string; provider: string; model: string; cacheRead: boolean; cacheWrite: boolean; signals: string[] }>;
    };

    assert.equal(document.schemaVersion, 1);
    assert.equal(document.runtimeNetworkAccess, false);
    assert.deepEqual(document.autoTransportPolicy, {
      cachePreferredTransport: "providerPayload",
      fallbackTransport: "systemPrompt",
      cacheSignalFields: [
        "models.dev cost.cache_read/cache_write",
        "OpenRouter pricing.input_cache_read/input_cache_write",
        "LiteLLM cache_read/cache_creation/input_cost_per_token_cache_hit fields",
      ],
    });
    assert.deepEqual(document.sources.map((source) => [source.id, source.modelCount, source.cachePreferredCount]), [
      ["models.dev", 2, 1],
      ["openrouter", 2, 1],
      ["litellm", 2, 1],
    ]);
    assert.deepEqual(document.cachePreferred.map((entry) => `${entry.source}:${entry.provider}/${entry.model}`), [
      "litellm:anthropic/claude-cache",
      "models.dev:provider_a/cache-model",
      "openrouter:openrouter/open/cache-write",
    ]);
    assert.equal(document.cachePreferred.every((entry) => entry.cacheRead || entry.cacheWrite), true);
    assert.equal(JSON.stringify(document).includes("no-cache"), false);
    assert.equal(JSON.stringify(document).includes("plain-model"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("checked-in generated model capability cache is deterministic and request-path safe", () => {
  const document = JSON.parse(readFileSync("src/generated/model-capabilities.json", "utf8")) as {
    schemaVersion: number;
    runtimeNetworkAccess: boolean;
    cachePreferred: Array<{ source: string; provider: string; model: string }>;
  };
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.runtimeNetworkAccess, false);
  assert.equal(document.cachePreferred.length > 0, true, "generated cache should contain cache-preferred models");

  const sorted = [...document.cachePreferred].sort((left, right) =>
    left.source.localeCompare(right.source) || left.provider.localeCompare(right.provider) || left.model.localeCompare(right.model),
  );
  assert.deepEqual(document.cachePreferred, sorted, "generated cache entries must stay sorted for small diffs");
});
