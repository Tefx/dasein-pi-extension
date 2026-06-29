import generatedCapabilities from "../generated/model-capabilities.json" with { type: "json" };

import type { AgentInjectionTransport } from "./types.ts";

export type AutoResolvedAgentInjectionTransport = Extract<AgentInjectionTransport, "providerPayload" | "systemPrompt">;

export interface DaseinModelDescriptor {
  readonly provider: string | null;
  readonly id: string | null;
  readonly api: string | null;
  readonly cost?: unknown;
  readonly compat?: unknown;
}

export type AutoTransportResolutionReason =
  | "generated-cache-capability"
  | "local-model-cache-signal"
  | "missing-model"
  | "unknown-model";

export interface AutoTransportResolution {
  readonly transport: AutoResolvedAgentInjectionTransport;
  readonly reason: AutoTransportResolutionReason;
  readonly provider: string | null;
  readonly model: string | null;
  readonly matchedSource: string | null;
  readonly matchedSignals: readonly string[];
}

interface GeneratedCapabilityEntry {
  readonly source: string;
  readonly provider: string;
  readonly model: string;
  readonly cacheRead: boolean;
  readonly cacheWrite: boolean;
  readonly signals: readonly string[];
}

interface GeneratedModelCapabilities {
  readonly schemaVersion: 1;
  readonly runtimeNetworkAccess: false;
  readonly cachePreferred: readonly GeneratedCapabilityEntry[];
}

type JsonRecord = Record<string, unknown>;

const capabilities = generatedCapabilities as GeneratedModelCapabilities;
const separator = "\u0000";
const cachePreferredByProviderModel = new Map<string, GeneratedCapabilityEntry>();

const normalize = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
};

const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);

const keyFor = (provider: string, model: string): string => `${provider}${separator}${model}`;

for (const entry of capabilities.cachePreferred) {
  const provider = normalize(entry.provider);
  const model = normalize(entry.model);
  if (provider !== null && model !== null) {
    cachePreferredByProviderModel.set(keyFor(provider, model), entry);
  }
}

const positiveNumber = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }
  return false;
};

const localCacheSignals = (model: DaseinModelDescriptor | null): string[] => {
  if (model === null) return [];
  const signals: string[] = [];
  if (isRecord(model.cost)) {
    for (const [key, value] of Object.entries(model.cost)) {
      const lower = key.toLowerCase();
      const cacheKey = lower.includes("cache") || lower === "cacheread" || lower === "cachewrite";
      if (cacheKey && positiveNumber(value)) signals.push(`model.cost.${key}`);
    }
  }
  if (isRecord(model.compat) && typeof model.compat.cacheControlFormat === "string" && model.compat.cacheControlFormat.length > 0) {
    signals.push("model.compat.cacheControlFormat");
  }
  return signals.sort();
};

const candidateModelsFor = (provider: string, model: string): string[] => {
  const candidates = new Set<string>([model]);
  if (!model.startsWith(`${provider}/`)) candidates.add(`${provider}/${model}`);
  const slash = model.indexOf("/");
  if (slash > 0 && slash < model.length - 1) candidates.add(model.slice(slash + 1));
  return [...candidates];
};

const lookupGeneratedCapability = (provider: string, model: string): GeneratedCapabilityEntry | null => {
  for (const candidate of candidateModelsFor(provider, model)) {
    const entry = cachePreferredByProviderModel.get(keyFor(provider, candidate));
    if (entry !== undefined) return entry;
  }
  return null;
};

export const coerceDaseinModelDescriptor = (value: unknown): DaseinModelDescriptor | null => {
  if (!isRecord(value)) return null;
  const provider = normalize(value.provider);
  const id = normalize(value.id) ?? normalize(value.model) ?? normalize(value.name);
  const api = normalize(value.api);
  if (provider === null && id === null && api === null) return null;
  return {
    provider,
    id,
    api,
    ...(value.cost === undefined ? {} : { cost: value.cost }),
    ...(value.compat === undefined ? {} : { compat: value.compat }),
  };
};

export const modelDescriptorFromModelSelectEvent = (event: unknown): DaseinModelDescriptor | null => {
  if (!isRecord(event)) return null;
  for (const key of ["model", "selectedModel", "currentModel", "selection"] as const) {
    const descriptor = coerceDaseinModelDescriptor(event[key]);
    if (descriptor !== null) return descriptor;
  }
  return coerceDaseinModelDescriptor(event);
};

export const resolveAutoAgentInjectionTransport = (model: DaseinModelDescriptor | null): AutoTransportResolution => {
  if (model === null || (model.provider === null && model.id === null)) {
    return {
      transport: "systemPrompt",
      reason: "missing-model",
      provider: model?.provider ?? null,
      model: model?.id ?? null,
      matchedSource: null,
      matchedSignals: [],
    };
  }

  const signals = localCacheSignals(model);
  if (signals.length > 0) {
    return {
      transport: "providerPayload",
      reason: "local-model-cache-signal",
      provider: model.provider,
      model: model.id,
      matchedSource: "model-metadata",
      matchedSignals: signals,
    };
  }

  if (model.provider !== null && model.id !== null) {
    const generated = lookupGeneratedCapability(model.provider, model.id);
    if (generated !== null) {
      return {
        transport: "providerPayload",
        reason: "generated-cache-capability",
        provider: model.provider,
        model: model.id,
        matchedSource: generated.source,
        matchedSignals: generated.signals,
      };
    }
  }

  return {
    transport: "systemPrompt",
    reason: "unknown-model",
    provider: model.provider,
    model: model.id,
    matchedSource: null,
    matchedSignals: [],
  };
};

export const modelCapabilityCacheSummary = Object.freeze({
  schemaVersion: capabilities.schemaVersion,
  runtimeNetworkAccess: capabilities.runtimeNetworkAccess,
  cachePreferredCount: capabilities.cachePreferred.length,
});
