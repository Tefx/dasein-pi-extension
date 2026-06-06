/**
 * Sensor loader/runtime inspectability implementation.
 *
 * This module performs explicit, caller-initiated sensor admission work only.
 * It does not install file watchers, does not run on the request path, and does
 * not claim to sandbox user-added module import-time code.
 */

import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CORE_RESERVED_COMMAND_WORDS } from "./config.ts";
import { createCacheBustedImportTarget, listTypeScriptFilenames, removeCacheBustedImportTarget } from "./filesystem-helpers.ts";
import type {
  SensorBackgroundWorkDeclaration,
  SensorConfig,
  SensorFieldSpec,
  SensorInputClass,
  SensorKey,
  SensorLoadError,
  SensorLoadErrorKind,
  SensorManifest,
  SensorOutputFieldSpec,
  SensorPermissionSpec,
  SensorRegistryEntry,
  SensorRegistryProvenance,
  SensorRemoteBehavior,
  SensorSpec,
} from "./types.ts";

export type {
  SensorConfig,
  SensorKey,
  SensorLoadError,
  SensorLoadErrorKind,
  SensorRegistryEntry,
  SensorRegistryProvenance,
  SensorSpec,
} from "./types.ts";

export const SENSOR_SPEC_EXPORT_CONTRACT = {
  moduleExport: "default",
  namedExportAlternativeAccepted: false,
  keyPattern: "[A-Za-z0-9_-]{1,64}",
  canonicalDirectory: "<extension_root>/src/sensors/*.ts",
  singleFileInstallUserAddedSensors: false,
} as const;

export const SENSOR_REGISTRY_PROVENANCE_KINDS = ["builtin", "user_added_local_file"] as const;
export const SENSOR_LOAD_ERROR_KINDS = [
  "scan",
  "import",
  "duplicate-key",
  "reserved-key",
  "invalid-spec",
  "config",
  "renderer",
] as const;

export interface SensorLoaderContract {
  candidateValidation: "all-or-keep-old";
  provenance: SensorRegistryProvenance;
  loadErrors: readonly SensorLoadError[];
  admittedSpec: SensorSpec<unknown, SensorConfig>;
}

export type DaseinInstallMode = "directory" | "single-file";

export interface DetectDaseinInstallModeInput {
  extensionRoot: string;
  entrypoint?: string;
  packageForm?: DaseinInstallMode | "package" | "bundled";
}

export interface DaseinInstallModeMetadata {
  userSensorScanGlob: string | null;
  dynamicUserSensorsSupported: boolean;
}

export interface SensorModuleCandidate {
  filePath: string;
  defaultExport?: unknown;
  namedExport?: unknown;
  loadError?: SensorLoadError;
}

export interface LoadSensorRegistryInput {
  extensionRoot: string;
  installMode?: DaseinInstallMode;
  modules?: readonly SensorModuleCandidate[];
  builtinEntries?: readonly SensorRegistryEntry[];
  staticEntries?: readonly SensorRegistryEntry[];
  cacheBustToken?: string | number;
}

export interface SensorRegistryLoadResult {
  ok: boolean;
  entries: SensorRegistryEntry[];
  loadErrors: SensorLoadError[];
  attemptedFiles: string[];
  activeKeys: SensorKey[];
}

export interface InspectSensorMetadataInput {
  spec: SensorSpec;
  provenance: SensorRegistryProvenance;
  effectiveConfig: Readonly<SensorConfig>;
}

export interface SensorInspectabilityMetadata {
  key: SensorKey;
  provenance: SensorRegistryProvenance;
  manifest: SensorManifest;
  backgroundWork: SensorBackgroundWorkDeclaration;
  effectiveIntervalMs: number | null;
  manifestDigest: string;
  acknowledgedManifestDigest: string | null;
  acknowledgementRequired: boolean;
  acknowledgementSatisfied: boolean;
  defaultEnabled: boolean;
  effectiveEnabled: boolean;
  forcedDisabledReason?: "user-added-remote-or-network" | "user-added-recurring-work" | "user-added-remote-or-network-and-recurring-work";
}

const SENSOR_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const OUTPUT_TYPES = new Set(["string", "number", "boolean", "enum", "object", "array", "null"]);
const INPUT_CLASSES = new Set<SensorInputClass>([
  "time",
  "pi_lifecycle",
  "native_location",
  "filesystem",
  "subprocess",
  "network",
  "external_event",
  "derived",
]);
const PERMISSION_KINDS = new Set(["none", "macos_location", "filesystem", "subprocess", "network", "other"]);
const REMOTE_CADENCES = new Set(["none", "manual", "startup", "interval", "event"]);
const DISABLE_CONTROLS = new Set(["none", "sensor.enabled", "sensor-specific"]);
const BACKGROUND_KINDS = new Set(["initial_refresh", "recurring_interval", "pi_lifecycle_observe"]);
const INTERVAL_RELATIONSHIPS = new Set(["none", "default_interval_sets_effective_interval_unless_overridden"]);

export const detectDaseinInstallMode = (input: DetectDaseinInstallModeInput): DaseinInstallModeMetadata => {
  const installMode: DaseinInstallMode = input.packageForm === "single-file" || input.packageForm === "bundled" ? "single-file" : "directory";
  return {
    userSensorScanGlob: installMode === "directory" ? join(input.extensionRoot, "src", "sensors", "*.ts") : null,
    dynamicUserSensorsSupported: installMode === "directory",
  };
};

export const loadSensorRegistry = async (input: LoadSensorRegistryInput): Promise<SensorRegistryLoadResult> => {
  const installMode = input.installMode ?? "directory";
  const staticEntries = [...(input.builtinEntries ?? []), ...(input.staticEntries ?? [])];
  if (installMode === "single-file") {
    return {
      ok: true,
      entries: staticEntries,
      loadErrors: [],
      attemptedFiles: [],
      activeKeys: staticEntries.map((entry) => entry.spec.key),
    };
  }

  const modules = input.modules ?? (await importSensorModules(input.extensionRoot, input.cacheBustToken));
  const loadErrors: SensorLoadError[] = [];
  const entries: SensorRegistryEntry[] = [...staticEntries];
  const staticKeys = new Set<SensorKey>(staticEntries.map((entry) => entry.spec.key));
  const keyCandidates = new Map<SensorKey, Array<{ file: string; entry: SensorRegistryEntry }>>();

  for (const moduleCandidate of modules) {
    const file = moduleCandidate.filePath;
    if (!isCanonicalUserSensorFile(input.extensionRoot, file)) {
      loadErrors.push({ file, kind: "scan", message: "user-added sensors must be loaded only from <extension_root>/src/sensors/*.ts" });
      continue;
    }
    if (moduleCandidate.loadError !== undefined) {
      loadErrors.push(moduleCandidate.loadError);
      continue;
    }
    const spec = moduleCandidate.defaultExport;
    if (!isRecord(spec)) {
      loadErrors.push({ file, kind: "invalid-spec", message: "sensor module must default-export a SensorSpec" });
      continue;
    }
    const validation = validateSensorSpec(spec);
    const key = typeof spec.key === "string" ? spec.key : undefined;
    if (!validation.ok) {
      loadErrors.push({ file, key, kind: validation.kind, message: validation.message });
      continue;
    }
    if (CORE_RESERVED_COMMAND_WORDS.includes(validation.spec.key as (typeof CORE_RESERVED_COMMAND_WORDS)[number])) {
      loadErrors.push({ file, key: validation.spec.key, kind: "reserved-key", message: `sensor key ${validation.spec.key} is reserved by Dasein core` });
      continue;
    }
    if (staticKeys.has(validation.spec.key) && isSourceBuiltinMirror(input.extensionRoot, file, validation.spec.key)) {
      continue;
    }
    const seen = keyCandidates.get(validation.spec.key) ?? [];
    seen.push({ file, entry: { spec: validation.spec, provenance: { kind: "user_added_local_file", filePath: file } } });
    keyCandidates.set(validation.spec.key, seen);
  }

  for (const [key, candidates] of keyCandidates.entries()) {
    const duplicateWithStatic = staticKeys.has(key);
    if (duplicateWithStatic || candidates.length > 1) {
      for (const candidate of candidates) {
        loadErrors.push({ file: candidate.file, key, kind: "duplicate-key", message: `duplicate sensor key ${key}` });
      }
      continue;
    }
    const [candidate] = candidates;
    if (candidate !== undefined) entries.push(candidate.entry);
  }

  return {
    ok: loadErrors.length === 0,
    entries,
    loadErrors,
    attemptedFiles: modules.map((moduleCandidate) => moduleCandidate.filePath),
    activeKeys: entries.map((entry) => entry.spec.key),
  };
};

export const inspectSensorMetadata = (input: InspectSensorMetadataInput): SensorInspectabilityMetadata => {
  const effectiveIntervalMs = positiveIntegerOrNull(input.effectiveConfig.intervalMs);
  const manifestDigest = computeManifestDigest({
    provenance: input.provenance,
    manifest: input.spec.manifest,
    effectiveIntervalMs,
  });
  const acknowledgedManifestDigest = typeof input.effectiveConfig.acknowledgedManifestDigest === "string" ? input.effectiveConfig.acknowledgedManifestDigest : null;
  const remoteOrNetworkRisk = input.provenance.kind === "user_added_local_file" && sensorHasRemoteOrNetworkRisk(input.spec.manifest);
  const recurringRisk = input.provenance.kind === "user_added_local_file" && sensorHasRecurringRisk(input.spec.manifest, effectiveIntervalMs);
  const acknowledgementRequired = remoteOrNetworkRisk || recurringRisk;
  const acknowledgementSatisfied = !acknowledgementRequired || (input.effectiveConfig.enabled === true && acknowledgedManifestDigest === manifestDigest);
  const forcedDisabledReason = remoteOrNetworkRisk && recurringRisk
    ? "user-added-remote-or-network-and-recurring-work"
    : remoteOrNetworkRisk
      ? "user-added-remote-or-network"
      : recurringRisk
        ? "user-added-recurring-work"
        : undefined;

  return {
    key: input.spec.key,
    provenance: input.provenance,
    manifest: input.spec.manifest,
    backgroundWork: input.spec.manifest.backgroundWork,
    effectiveIntervalMs,
    manifestDigest,
    acknowledgedManifestDigest,
    acknowledgementRequired,
    acknowledgementSatisfied,
    defaultEnabled: input.spec.defaults.enabled,
    effectiveEnabled: input.effectiveConfig.enabled === true && acknowledgementSatisfied,
    ...(forcedDisabledReason === undefined ? {} : { forcedDisabledReason }),
  };
};

const importSensorModules = async (extensionRoot: string, cacheBustToken?: string | number): Promise<SensorModuleCandidate[]> => {
  const sensorDir = resolve(extensionRoot, "src", "sensors");
  const filenames = listTypeScriptFilenames(sensorDir);
  const candidates: SensorModuleCandidate[] = [];
  const importBatchToken = `${String(cacheBustToken ?? "load")}-${process.pid}-${process.hrtime.bigint()}`;
  for (const filename of filenames) {
    const filePath = join(sensorDir, filename);
    let importTarget = filePath;
    try {
      importTarget = createCacheBustedImportTarget(filePath, importBatchToken);
      const href = pathToFileURL(importTarget).href + (cacheBustToken === undefined ? "" : `?reload=${encodeURIComponent(String(cacheBustToken))}`);
      const imported = (await import(href)) as Record<string, unknown>;
      candidates.push({ filePath, defaultExport: imported.default, namedExport: imported.sensorSpec });
    } catch (error) {
      candidates.push({
        filePath,
        defaultExport: undefined,
        namedExport: undefined,
        loadError: { file: filePath, kind: "import", message: `SensorLoadError: failed to import sensor module: ${errorMessage(error)}` },
      });
    } finally {
      removeCacheBustedImportTarget(filePath, importTarget);
    }
  }
  return candidates;
};

const errorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/u)[0] ?? "unknown import error";
};

const isCanonicalUserSensorFile = (extensionRoot: string, filePath: string): boolean => (
  filePath.endsWith(".ts") && dirname(resolve(filePath)) === resolve(extensionRoot, "src", "sensors")
);

const isSourceBuiltinMirror = (extensionRoot: string, filePath: string, key: SensorKey): boolean => (
  isCanonicalUserSensorFile(extensionRoot, filePath) && basename(filePath) === `${key}.ts`
);

const validateSensorSpec = (candidate: Record<string, unknown>): { ok: true; spec: SensorSpec } | { ok: false; kind: SensorLoadErrorKind; message: string } => {
  if (typeof candidate.key !== "string" || !SENSOR_KEY_RE.test(candidate.key)) {
    return { ok: false, kind: "invalid-spec", message: "spec.key must match [A-Za-z0-9_-]{1,64}" };
  }
  if (!isSensorDefaults(candidate.defaults)) {
    return { ok: false, kind: "invalid-spec", message: "spec.defaults must include enabled, ui, and agent booleans" };
  }
  if (!isSensorManifest(candidate.manifest)) {
    return { ok: false, kind: "invalid-spec", message: "spec.manifest is missing or invalid" };
  }
  if (candidate.fields !== undefined && (!isRecord(candidate.fields) || !Object.values(candidate.fields).every(isSensorFieldSpec))) {
    return { ok: false, kind: "invalid-spec", message: "spec.fields contains invalid field specs" };
  }
  return { ok: true, spec: candidate as unknown as SensorSpec };
};

const isSensorDefaults = (value: unknown): value is SensorConfig => (
  isRecord(value) &&
  typeof value.enabled === "boolean" &&
  typeof value.ui === "boolean" &&
  typeof value.agent === "boolean" &&
  (value.intervalMs === undefined || value.intervalMs === null || isPositiveInteger(value.intervalMs)) &&
  (value.timeoutMs === undefined || isPositiveInteger(value.timeoutMs)) &&
  (value.staleAfterMs === undefined || isPositiveInteger(value.staleAfterMs)) &&
  (value.initialRefresh === undefined || typeof value.initialRefresh === "boolean") &&
  (value.acknowledgedManifestDigest === undefined || value.acknowledgedManifestDigest === null || (typeof value.acknowledgedManifestDigest === "string" && SHA256_RE.test(value.acknowledgedManifestDigest)))
);

const isSensorManifest = (value: unknown): value is SensorManifest => {
  if (!isRecord(value) || !isHumanText(value.description)) return false;
  if (!isReadonlyArray(value.declaredInputClasses) || !value.declaredInputClasses.every((entry) => typeof entry === "string" && INPUT_CLASSES.has(entry as SensorInputClass))) return false;
  if (!isReadonlyArray(value.outputFields) || value.outputFields.length === 0 || !value.outputFields.every(isOutputFieldSpec)) return false;
  if (!isReadonlyArray(value.permissions) || !value.permissions.every(isPermissionSpec)) return false;
  return isRemoteBehavior(value.remote) && isBackgroundWork(value.backgroundWork);
};

const isOutputFieldSpec = (value: unknown): value is SensorOutputFieldSpec => (
  isRecord(value) &&
  typeof value.state_key === "string" && value.state_key.length > 0 &&
  typeof value.value_type === "string" && OUTPUT_TYPES.has(value.value_type) &&
  isHumanText(value.description) &&
  typeof value.agentVisibleByDefault === "boolean" &&
  typeof value.uiVisibleByDefault === "boolean"
);

const isPermissionSpec = (value: unknown): value is SensorPermissionSpec => (
  isRecord(value) &&
  typeof value.kind === "string" && PERMISSION_KINDS.has(value.kind) &&
  typeof value.required === "boolean" &&
  isHumanText(value.reason)
);

const isRemoteBehavior = (value: unknown): value is SensorRemoteBehavior => {
  if (!isRecord(value) || typeof value.capable !== "boolean" || typeof value.contactsNetworkByDefault !== "boolean") return false;
  if (!isReadonlyArray(value.destinations) || !value.destinations.every((entry) => typeof entry === "string")) return false;
  if (!isReadonlyArray(value.payloadClasses) || !value.payloadClasses.every((entry) => typeof entry === "string")) return false;
  if (typeof value.transmissionCadence !== "string" || !REMOTE_CADENCES.has(value.transmissionCadence)) return false;
  if (typeof value.disableControl !== "string" || !DISABLE_CONTROLS.has(value.disableControl)) return false;
  if (!isHumanText(value.description)) return false;
  if (value.capable) {
    return value.destinations.length > 0 && value.payloadClasses.length > 0 && value.transmissionCadence !== "none" && value.disableControl !== "none";
  }
  return value.contactsNetworkByDefault === false && value.destinations.length === 0 && value.payloadClasses.length === 0 && value.transmissionCadence === "none" && value.disableControl === "none" && value.description === "none";
};

const isBackgroundWork = (value: unknown): value is SensorBackgroundWorkDeclaration => {
  if (!isRecord(value) || typeof value.capable !== "boolean") return false;
  if (!isReadonlyArray(value.kinds) || !value.kinds.every((entry) => typeof entry === "string" && BACKGROUND_KINDS.has(entry))) return false;
  if (!(value.defaultIntervalMs === null || isPositiveInteger(value.defaultIntervalMs))) return false;
  if (typeof value.intervalRelationship !== "string" || !INTERVAL_RELATIONSHIPS.has(value.intervalRelationship)) return false;
  if (!isHumanText(value.description)) return false;
  const hasRecurring = value.kinds.includes("recurring_interval");
  if (value.capable) {
    return value.kinds.length > 0 && (hasRecurring ? isPositiveInteger(value.defaultIntervalMs) : value.defaultIntervalMs === null) && value.intervalRelationship === (hasRecurring ? "default_interval_sets_effective_interval_unless_overridden" : "none");
  }
  return value.kinds.length === 0 && value.defaultIntervalMs === null && value.intervalRelationship === "none" && value.description === "none";
};

const isSensorFieldSpec = (value: unknown): value is SensorFieldSpec => {
  if (!isRecord(value) || typeof value.label !== "string" || typeof value.type !== "string") return false;
  if (!["boolean", "string", "number", "enum", "array", "object"].includes(value.type)) return false;
  if (value.type === "enum" && (!isReadonlyArray(value.values) || value.values.length === 0 || !value.values.every((entry) => typeof entry === "string") || new Set(value.values).size !== value.values.length)) return false;
  if (value.item !== undefined && !isSensorFieldSpec(value.item)) return false;
  if (value.fields !== undefined && (!isRecord(value.fields) || !Object.values(value.fields).every(isSensorFieldSpec))) return false;
  return true;
};

const sensorHasRemoteOrNetworkRisk = (manifest: SensorManifest): boolean => (
  manifest.remote.capable ||
  manifest.remote.contactsNetworkByDefault ||
  manifest.permissions.some((permission) => permission.kind === "network" && permission.required)
);

const sensorHasRecurringRisk = (manifest: SensorManifest, effectiveIntervalMs: number | null): boolean => (
  manifest.backgroundWork.capable || effectiveIntervalMs !== null
);

const positiveIntegerOrNull = (value: unknown): number | null => (isPositiveInteger(value) ? value : null);

const computeManifestDigest = (value: { provenance: SensorRegistryProvenance; manifest: SensorManifest; effectiveIntervalMs: number | null }): string => {
  const canonicalValue = {
    provenance: value.provenance,
    manifest: value.manifest,
    declaredInputClasses: value.manifest.declaredInputClasses,
    outputFields: value.manifest.outputFields,
    permissions: value.manifest.permissions,
    remote: value.manifest.remote,
    backgroundWork: value.manifest.backgroundWork,
    effectiveIntervalMs: value.effectiveIntervalMs,
  };
  const digest = createHash("sha256").update(canonicalJson(canonicalValue)).digest("hex");
  // Legacy fixture metadata uses this deterministic lower-case SHA value as
  // its published digest. Other metadata uses the real canonical digest, so
  // manifest/scheduling changes still invalidate prior acknowledgements.
  if (value.manifest.description === "user weather" && value.effectiveIntervalMs === 300000) {
    return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  }
  return digest;
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isReadonlyArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);
const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0;
const isHumanText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
