#!/usr/bin/env node
/**
 * Generate Dasein's offline model cache capability table.
 *
 * This script intentionally runs outside the agent request path. Runtime code
 * must consume the generated JSON only; it must not fetch these online sources.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URLS = {
  modelsDev: "https://models.dev/api.json",
  openRouter: "https://openrouter.ai/api/v1/models",
  liteLlm: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
};

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const DEFAULT_OUTPUT = resolve(REPO_ROOT, "src", "generated", "model-capabilities.json");

const CACHE_READ_NAMES = ["cache_read", "cache read", "cache-hit", "cache_hit", "cache hit", "input_cache_read", "cache_read_input", "input_cost_per_token_cache_hit"];
const CACHE_WRITE_NAMES = ["cache_write", "cache write", "cache_creation", "cache creation", "input_cache_write", "cache_write_input"];

const usage = () => `Usage: node scripts/update-model-capabilities.mjs [options]\n\nOptions:\n  --output <path>       Output JSON path (default: src/generated/model-capabilities.json)\n  --models-dev <path>   Use local models.dev JSON fixture instead of fetching\n  --openrouter <path>   Use local OpenRouter JSON fixture instead of fetching\n  --litellm <path>      Use local LiteLLM JSON fixture instead of fetching\n  --print               Print generated JSON to stdout instead of writing\n  --help                Show this help\n`;

const parseArgs = (argv) => {
  const options = { output: DEFAULT_OUTPUT, print: false, fixtures: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--print") {
      options.print = true;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`${arg} requires a value`);
    if (arg === "--output") options.output = resolve(next);
    else if (arg === "--models-dev") options.fixtures.modelsDev = resolve(next);
    else if (arg === "--openrouter") options.fixtures.openRouter = resolve(next);
    else if (arg === "--litellm") options.fixtures.liteLlm = resolve(next);
    else throw new Error(`unknown option: ${arg}`);
    index += 1;
  }
  return options;
};

const asObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const asFiniteNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
const isPositive = (value) => {
  const number = asFiniteNumber(value);
  return number !== null && number > 0;
};
const includesAny = (value, names) => names.some((name) => value.includes(name));
const normalizeId = (value) => String(value ?? "").trim().toLowerCase();

const readJson = async (source, fixturePath) => {
  if (fixturePath !== undefined) {
    return JSON.parse(await readFile(fixturePath, "utf8"));
  }
  const response = await fetch(source, {
    headers: {
      "accept": "application/json",
      "user-agent": "dasein-pi-extension model-capabilities updater",
    },
  });
  if (!response.ok) throw new Error(`fetch failed for ${source}: ${response.status} ${response.statusText}`);
  return response.json();
};

const cacheSignalsFromCost = (cost, readSignalPrefix = "cost", writeSignalPrefix = "cost") => {
  const record = asObject(cost);
  if (record === null) return { cacheRead: false, cacheWrite: false, signals: [] };
  const signals = [];
  let cacheRead = false;
  let cacheWrite = false;
  for (const [rawKey, value] of Object.entries(record)) {
    const key = rawKey.toLowerCase();
    if (includesAny(key, CACHE_READ_NAMES) && isPositive(value)) {
      cacheRead = true;
      signals.push(`${readSignalPrefix}.${rawKey}`);
    }
    if (includesAny(key, CACHE_WRITE_NAMES) && isPositive(value)) {
      cacheWrite = true;
      signals.push(`${writeSignalPrefix}.${rawKey}`);
    }
  }
  return { cacheRead, cacheWrite, signals };
};

const addEntry = (entries, entry) => {
  if (!entry.cacheRead && !entry.cacheWrite) return;
  if (entry.model.length === 0) return;
  entries.push({
    source: entry.source,
    provider: entry.provider,
    model: entry.model,
    cacheRead: entry.cacheRead,
    cacheWrite: entry.cacheWrite,
    signals: [...new Set(entry.signals)].sort(),
  });
};

const extractModelsDev = (payload) => {
  const root = asObject(payload) ?? {};
  const entries = [];
  let modelCount = 0;
  for (const [providerId, providerPayload] of Object.entries(root)) {
    const provider = asObject(providerPayload);
    const models = asObject(provider?.models);
    if (models === null) continue;
    for (const [modelId, modelPayload] of Object.entries(models)) {
      modelCount += 1;
      const model = asObject(modelPayload);
      const signals = cacheSignalsFromCost(model?.cost, "cost", "cost");
      addEntry(entries, {
        source: "models.dev",
        provider: normalizeId(providerId),
        model: normalizeId(model?.id ?? modelId),
        ...signals,
      });
    }
  }
  return { id: "models.dev", url: SOURCE_URLS.modelsDev, modelCount, entries };
};

const extractOpenRouter = (payload) => {
  const root = asObject(payload) ?? {};
  const data = Array.isArray(root.data) ? root.data : [];
  const entries = [];
  for (const item of data) {
    const model = asObject(item);
    if (model === null) continue;
    const signals = cacheSignalsFromCost(model.pricing, "pricing", "pricing");
    addEntry(entries, {
      source: "openrouter",
      provider: "openrouter",
      model: normalizeId(model.id),
      ...signals,
    });
  }
  return { id: "openrouter", url: SOURCE_URLS.openRouter, modelCount: data.length, entries };
};

const extractLiteLlm = (payload) => {
  const root = asObject(payload) ?? {};
  const entries = [];
  let modelCount = 0;
  for (const [modelId, modelPayload] of Object.entries(root)) {
    const model = asObject(modelPayload);
    if (model === null) continue;
    modelCount += 1;
    const signals = cacheSignalsFromCost(model, "model", "model");
    const provider = normalizeId(model.litellm_provider ?? model.provider ?? model.mode ?? "litellm");
    addEntry(entries, {
      source: "litellm",
      provider,
      model: normalizeId(modelId),
      ...signals,
    });
  }
  return { id: "litellm", url: SOURCE_URLS.liteLlm, modelCount, entries };
};

const sortEntries = (entries) => entries.sort((left, right) =>
  left.source.localeCompare(right.source) ||
  left.provider.localeCompare(right.provider) ||
  left.model.localeCompare(right.model),
);

const buildDocument = (sources) => {
  const cachePreferred = sortEntries(sources.flatMap((source) => source.entries));
  return {
    schemaVersion: 1,
    generatedBy: "scripts/update-model-capabilities.mjs",
    runtimeNetworkAccess: false,
    autoTransportPolicy: {
      cachePreferredTransport: "providerPayload",
      fallbackTransport: "systemPrompt",
      cacheSignalFields: [
        "models.dev cost.cache_read/cache_write",
        "OpenRouter pricing.input_cache_read/input_cache_write",
        "LiteLLM cache_read/cache_creation/input_cost_per_token_cache_hit fields",
      ],
    },
    sources: sources.map((source) => ({
      id: source.id,
      url: source.url,
      modelCount: source.modelCount,
      cachePreferredCount: source.entries.length,
    })),
    cachePreferred,
  };
};

export const generateModelCapabilities = async (options = {}) => {
  const fixtures = options.fixtures ?? {};
  const [modelsDevPayload, openRouterPayload, liteLlmPayload] = await Promise.all([
    readJson(SOURCE_URLS.modelsDev, fixtures.modelsDev),
    readJson(SOURCE_URLS.openRouter, fixtures.openRouter),
    readJson(SOURCE_URLS.liteLlm, fixtures.liteLlm),
  ]);
  return buildDocument([
    extractModelsDev(modelsDevPayload),
    extractOpenRouter(openRouterPayload),
    extractLiteLlm(liteLlmPayload),
  ]);
};

export const writeModelCapabilities = async (document, outputPath) => {
  const text = `${JSON.stringify(document, null, 2)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, text, "utf8");
  return text;
};

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const document = await generateModelCapabilities(options);
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (options.print) process.stdout.write(text);
    else {
      await writeModelCapabilities(document, options.output);
      console.log(`wrote ${options.output}: ${document.cachePreferred.length} cache-preferred model entries`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
