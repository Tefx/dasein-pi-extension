/**
 * Dasein config contracts plus the minimal config manager implementation.
 *
 * The manager is intentionally global-path only: callers must pass an explicit
 * ~/.pi/dasein/config.json path (or an in-memory diskConfig test fixture). It
 * never discovers project-local files, never walks cwd, and persists only the
 * canonical partial config patch document rather than the full effective config.
 */

import { readTextFileIfExists, readTextFileIfExistsSync, writeConfigAtomically } from "./config-io.ts";
import type { ConfigIoFailPoint } from "./config-io.ts";

import type {
  ConfigManager,
  ConfigMutationProposal,
  ConfigMutationResult,
  ConfigReloadResult,
  ConfigSources,
  ConfigValidationError,
  ConfigValidationErrorKind,
  CoreConfig,
  DaseinConfig,
  DaseinConfigOverlay,
  DiskDaseinConfig,
  ExternalStateConfig,
  ExternalStateKey,
  RenderOrderKey,
  SensorConfig,
  SensorKey,
} from "./types.ts";

export type {
  ConfigManager,
  ConfigMutationProposal,
  ConfigMutationResult,
  ConfigReloadResult,
  ConfigSources,
  ConfigValidationError,
  ConfigValidationErrorKind,
  CoreConfig,
  DaseinConfig,
  DaseinConfigOverlay,
  DiskDaseinConfig,
  ExternalStateConfig,
  ExternalStateKey,
  RenderOrderKey,
  SensorConfig,
  SensorKey,
} from "./types.ts";

export const DASEIN_CONFIG_VERSION = 1 as const;
export const DASEIN_GLOBAL_CONFIG_ROOT = "~/.pi/dasein/" as const;
export const DASEIN_CONFIG_PRECEDENCE = ["defaults", "disk", "launch", "runtime"] as const;
export const SENSOR_AND_EXTERNAL_KEY_PATTERN = "[A-Za-z0-9_-]{1,64}" as const;
export const CORE_RESERVED_COMMAND_WORDS = ["status", "reload", "sensors", "set", "apply", "help"] as const;

export const CORE_MAX_AGENT_CHARS_CONSTRAINT = {
  path: "core.maxAgentChars",
  integer: true,
  minimum: 40,
  maximum: 2000,
  defaultValue: 240,
  accepts: [40, 240, 2000],
  rejects: [39, 2001, 40.5],
} as const;

export const CORE_INJECTED_LABEL_CONSTRAINT = {
  path: "core.injectedLabel",
  pattern: "[A-Za-z0-9_.:-]{1,32}",
  defaultValue: "ambient_ctx",
  accepts: ["ambient_ctx", "ctx.v1", "agent:ctx-01"],
  rejects: ["", "abcdefghijklmnopqrstuvwxyzABCDEFG", "bad label"],
} as const;

export interface ConfigMutationQueueContract {
  serialization: "single-process-async-fifo";
  enqueuedOperations: readonly ["setRuntime", "applyRuntime", "applyRuntimeProposal", "reloadDisk"];
  activeConfigCommit: "after-validation-and-persistence-success";
  failedMutationBehavior: "structured-error-and-queue-continues";
}

export interface ConfigValidationContract {
  version: typeof DASEIN_CONFIG_VERSION;
  precedence: typeof DASEIN_CONFIG_PRECEDENCE;
  keyPattern: typeof SENSOR_AND_EXTERNAL_KEY_PATTERN;
  maxAgentChars: typeof CORE_MAX_AGENT_CHARS_CONSTRAINT;
  injectedLabel: typeof CORE_INJECTED_LABEL_CONSTRAINT;
  reservedCommandWords: typeof CORE_RESERVED_COMMAND_WORDS;
}

type JsonObject = Record<string, unknown>;
type FailPoint = ConfigIoFailPoint;
type Assignment = { inputPath: string; canonicalPath: string; value: unknown };
type ValidationContext = { config: DaseinConfig; discoveredSensorKeys?: readonly string[] };
type LightweightMutationResult =
  | { ok: true; updatedPaths: string[]; deletedPaths: string[] }
  | { ok: false; errors: ConfigValidationError[] };
type LightweightReloadResult =
  | { ok: true; launchReappliedPaths: string[]; runtimeOverriddenPaths: string[] }
  | { ok: false; errors: ConfigValidationError[] };

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const INJECTED_LABEL_RE = /^[A-Za-z0-9_.:-]{1,32}$/u;
const LOWER_SHA256_RE = /^[a-f0-9]{64}$/u;
const CORE_FIELDS = new Set([
  "agentInjectionEnabled",
  "statusEnabled",
  "widgetEnabled",
  "maxAgentChars",
  "injectedLabel",
  "renderOrder",
]);
const BASE_SENSOR_FIELDS = new Set([
  "enabled",
  "ui",
  "agent",
  "intervalMs",
  "timeoutMs",
  "staleAfterMs",
  "initialRefresh",
  "acknowledgedManifestDigest",
]);
const BUILTIN_SENSOR_FIELDS: Record<string, Set<string>> = {
  clock: new Set(["precision"]),
  geo: new Set(["precision", "tags", "exactAddress", "exactCoordinates"]),
  lapse: new Set(["persist", "agentFields"]),
};

const clone = <T>(value: T): T => structuredClone(value);

const isRecord = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

const error = (kind: ConfigValidationErrorKind, path: string, message: string): ConfigValidationError => ({ kind, path, message });

const discoveredSet = (context: ValidationContext): Set<string> => new Set(context.discoveredSensorKeys ?? Object.keys(context.config.sensors));

const isKnownSensor = (sensorKey: string, context: ValidationContext): boolean => discoveredSet(context).has(sensorKey);

const ensurePartial = (value: unknown): DiskDaseinConfig | null => {
  if (!isRecord(value) || value.version !== 1) return null;
  return clone(value) as unknown as DiskDaseinConfig;
};

const validateDiskPartial = (disk: DiskDaseinConfig, context: ValidationContext): ConfigValidationError[] => {
  const errors: ConfigValidationError[] = [];
  for (const topLevelKey of Object.keys(disk)) {
    if (!["version", "core", "sensors", "external"].includes(topLevelKey)) errors.push(error("invalid-schema", topLevelKey, "unknown top-level disk config key"));
  }
  if (disk.core !== undefined) {
    if (!isRecord(disk.core)) errors.push(error("invalid-schema", "core", "core disk config must be an object"));
    else {
      for (const [field, value] of Object.entries(disk.core)) {
        const canonicalPath = `core.${field}`;
        const normalized = normalizePath(canonicalPath, context);
        if (!normalized.ok) errors.push(normalized.error);
        else {
          const valueError = validateValue(normalized.canonicalPath, value, context);
          if (valueError) errors.push(valueError);
        }
      }
    }
  }
  if (disk.sensors !== undefined) {
    if (!isRecord(disk.sensors)) errors.push(error("invalid-schema", "sensors", "sensors disk config must be an object"));
    else {
      for (const [sensorKey, patch] of Object.entries(disk.sensors)) {
        if (!isRecord(patch)) {
          errors.push(error("invalid-schema", `sensors.${sensorKey}`, "sensor disk config must be an object"));
          continue;
        }
        for (const [field, value] of Object.entries(patch)) {
          const canonicalPath = `sensors.${sensorKey}.${field}`;
          const normalized = normalizePath(canonicalPath, context);
          if (!normalized.ok) errors.push(normalized.error);
          else {
            const valueError = validateValue(normalized.canonicalPath, value, context);
            if (valueError) errors.push(valueError);
          }
        }
      }
    }
  }
  if (disk.external !== undefined) {
    if (!isRecord(disk.external)) errors.push(error("invalid-schema", "external", "external disk config must be an object"));
    else {
      for (const [externalKey, patch] of Object.entries(disk.external)) {
        if (!isRecord(patch)) {
          errors.push(error("invalid-schema", `external.${externalKey}`, "external disk config must be an object"));
          continue;
        }
        for (const [field, value] of Object.entries(patch)) {
          const canonicalPath = `external.${externalKey}.${field}`;
          const normalized = normalizePath(canonicalPath, context);
          if (!normalized.ok) errors.push(normalized.error);
          else {
            const valueError = validateValue(normalized.canonicalPath, value, context);
            if (valueError) errors.push(valueError);
          }
        }
      }
    }
  }
  return errors;
};

const mergeOverlay = (base: DaseinConfig, overlay: DaseinConfigOverlay | null, skipPaths: ReadonlySet<string> = new Set()): DaseinConfig => {
  const next = clone(base);
  if (!overlay) return next;
  for (const [key, value] of Object.entries(overlay.core ?? {})) {
    const canonicalPath = `core.${key}`;
    if (!skipPaths.has(canonicalPath)) (next.core as unknown as JsonObject)[key] = clone(value);
  }
  for (const [sensorKey, patch] of Object.entries(overlay.sensors ?? {})) {
    next.sensors[sensorKey] = { ...(next.sensors[sensorKey] ?? { enabled: true, ui: true, agent: true }), ...clone(patch) } as SensorConfig;
  }
  for (const skipPath of skipPaths) {
    const parts = skipPath.split(".");
    if (parts[0] === "sensors" && parts.length >= 3) deleteNested(next as unknown as JsonObject, parts);
    if (parts[0] === "external" && parts.length === 3) deleteNested(next as unknown as JsonObject, parts);
  }
  for (const [externalKey, patch] of Object.entries(overlay.external ?? {})) {
    next.external[externalKey] = { ...(next.external[externalKey] ?? { ui: true, agent: false }), ...clone(patch) } as ExternalStateConfig;
  }
  return next;
};

const composeEffective = (
  defaults: DaseinConfig,
  disk: DiskDaseinConfig | null,
  launch: DaseinConfigOverlay | null,
  runtime: DaseinConfigOverlay | null,
  runtimeOverriddenPaths: readonly string[] = [],
): DaseinConfig => {
  const afterDisk = mergeOverlay(defaults, disk);
  const afterLaunch = mergeOverlay(afterDisk, launch, new Set(runtimeOverriddenPaths));
  return mergeOverlay(afterLaunch, runtime);
};

const overlayFromAssignments = (assignments: readonly Assignment[]): DaseinConfigOverlay => {
  const overlay: DaseinConfigOverlay = {};
  for (const assignment of assignments) setPathInOverlay(overlay, assignment.canonicalPath, assignment.value);
  return overlay;
};

const setPathInOverlay = (overlay: DaseinConfigOverlay, canonicalPath: string, value: unknown): void => {
  const [scope, second, ...rest] = canonicalPath.split(".");
  if (scope === "core" && second) {
    overlay.core ??= {};
    (overlay.core as JsonObject)[second] = clone(value);
    return;
  }
  if (scope === "sensors" && second && rest.length > 0) {
    overlay.sensors ??= {};
    overlay.sensors[second] ??= {};
    setNested(overlay.sensors[second] as JsonObject, rest, value);
    return;
  }
  if (scope === "external" && second && rest.length === 1) {
    overlay.external ??= {};
    overlay.external[second] ??= {};
    (overlay.external[second] as JsonObject)[rest[0] ?? ""] = clone(value);
  }
};

const setNested = (target: JsonObject, path: readonly string[], value: unknown): void => {
  let cursor = target;
  for (const [index, part] of path.entries()) {
    if (index === path.length - 1) {
      cursor[part] = clone(value);
      return;
    }
    if (!isRecord(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as JsonObject;
  }
};

const deleteNested = (target: JsonObject, path: readonly string[]): void => {
  let cursor: JsonObject = target;
  for (const [index, part] of path.entries()) {
    if (index === path.length - 1) {
      delete cursor[part];
      return;
    }
    const next = cursor[part];
    if (!isRecord(next)) return;
    cursor = next;
  }
};

const patchDisk = (disk: DiskDaseinConfig | null, assignments: readonly Assignment[], deletePaths: readonly string[]): DiskDaseinConfig => {
  const next: DiskDaseinConfig = disk ? clone(disk) : { version: 1 };
  for (const assignment of assignments) setNested(next as unknown as JsonObject, assignment.canonicalPath.split("."), assignment.value);
  for (const path of deletePaths) deleteNested(next as unknown as JsonObject, path.split("."));
  next.version = 1;
  return next;
};

const pathValue = (config: DaseinConfig, canonicalPath: string): unknown => {
  let cursor: unknown = config;
  for (const part of canonicalPath.split(".")) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
};

const normalizePath = (path: string, context: ValidationContext): { ok: true; canonicalPath: string } | { ok: false; error: ConfigValidationError } => {
  const parts = path.split(".");
  if (parts.includes("")) return { ok: false, error: error("invalid-path", path, "empty path segment") };
  if (parts[0] === "core") {
    if (parts.length !== 2 || !CORE_FIELDS.has(parts[1] ?? "")) return { ok: false, error: error("invalid-path", path, "unknown core config path") };
    return { ok: true, canonicalPath: path };
  }
  if (parts[0] === "external") {
    const [, key, field] = parts;
    if (parts.length !== 3 || !key || !KEY_RE.test(key) || (field !== "ui" && field !== "agent")) {
      return { ok: false, error: error("invalid-path", path, "invalid external config path") };
    }
    return { ok: true, canonicalPath: path };
  }
  if (parts[0] === "sensors") {
    const [, sensorKey, ...fieldPath] = parts;
    if (!sensorKey || !KEY_RE.test(sensorKey) || fieldPath.length === 0) return { ok: false, error: error("invalid-path", path, "invalid sensor config path") };
    if (!isKnownSensor(sensorKey, context)) return { ok: false, error: error("unknown-sensor", path, `unknown sensor ${sensorKey}`) };
    return { ok: true, canonicalPath: path };
  }
  const [maybeSensor, ...fieldPath] = parts;
  if (maybeSensor && KEY_RE.test(maybeSensor) && fieldPath.length > 0 && isKnownSensor(maybeSensor, context)) {
    return { ok: true, canonicalPath: `sensors.${maybeSensor}.${fieldPath.join(".")}` };
  }
  return { ok: false, error: error("invalid-path", path, "unknown config path") };
};

const validateValue = (canonicalPath: string, value: unknown, context: ValidationContext): ConfigValidationError | null => {
  const parts = canonicalPath.split(".");
  if (parts[0] === "core") return validateCoreValue(canonicalPath, parts[1] ?? "", value, context);
  if (parts[0] === "external") return typeof value === "boolean" ? null : error("invalid-value", canonicalPath, "external visibility must be boolean");
  if (parts[0] === "sensors") return validateSensorValue(canonicalPath, parts[1] ?? "", parts.slice(2), value);
  return error("invalid-path", canonicalPath, "unknown config path");
};

const validateCoreValue = (canonicalPath: string, field: string, value: unknown, context: ValidationContext): ConfigValidationError | null => {
  if (field === "maxAgentChars") {
    return Number.isInteger(value) && typeof value === "number" && value >= 40 && value <= 2000
      ? null
      : error("invalid-value", canonicalPath, "core.maxAgentChars must be an integer from 40 to 2000");
  }
  if (field === "injectedLabel") {
    return typeof value === "string" && INJECTED_LABEL_RE.test(value)
      ? null
      : error("invalid-value", canonicalPath, "core.injectedLabel must match [A-Za-z0-9_.:-]{1,32}");
  }
  if (field === "renderOrder") {
    if (!Array.isArray(value)) return error("invalid-value", canonicalPath, "core.renderOrder must be an array");
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== "string" || seen.has(item)) return error("invalid-value", canonicalPath, "renderOrder keys must be unique strings");
      seen.add(item);
      if (item.startsWith("external:")) {
        const externalKey = item.slice("external:".length);
        if (!KEY_RE.test(externalKey)) return error("invalid-value", canonicalPath, "invalid external render key");
      } else if (!KEY_RE.test(item) || !isKnownSensor(item, context)) {
        return error("unknown-sensor", canonicalPath, `unknown render sensor ${item}`);
      }
    }
    return null;
  }
  return typeof value === "boolean" ? null : error("invalid-value", canonicalPath, `${field} must be boolean`);
};

const validateSensorValue = (canonicalPath: string, sensorKey: string, fieldPath: readonly string[], value: unknown): ConfigValidationError | null => {
  const field = fieldPath[0] ?? "";
  if (fieldPath.length === 0) return error("invalid-path", canonicalPath, "missing sensor field");
  if (BASE_SENSOR_FIELDS.has(field)) return validateBaseSensorValue(canonicalPath, field, value);
  if (!isAllowedSensorSpecificField(sensorKey, fieldPath)) return error("invalid-path", canonicalPath, "unknown sensor field");
  if (sensorKey === "geo" && (field === "exactCoordinates" || field === "exactAddress")) {
    return typeof value === "boolean" ? null : error("invalid-value", canonicalPath, `${field} must be boolean`);
  }
  if (sensorKey === "geo" && field === "tags") {
    return isRecord(value) ? null : error("invalid-value", canonicalPath, "geo.tags must be an object");
  }
  if (sensorKey === "lapse" && field === "persist") return typeof value === "boolean" ? null : error("invalid-value", canonicalPath, "lapse.persist must be boolean");
  if (sensorKey === "lapse" && field === "agentFields") return Array.isArray(value) ? null : error("invalid-value", canonicalPath, "lapse.agentFields must be an array");
  if (field === "precision") return typeof value === "string" ? null : error("invalid-value", canonicalPath, "precision must be a string");
  return null;
};

const validateBaseSensorValue = (canonicalPath: string, field: string, value: unknown): ConfigValidationError | null => {
  if (field === "enabled" || field === "ui" || field === "agent" || field === "initialRefresh") return typeof value === "boolean" ? null : error("invalid-value", canonicalPath, `${field} must be boolean`);
  if (field === "intervalMs") return value === null || (Number.isInteger(value) && typeof value === "number" && value > 0) ? null : error("invalid-value", canonicalPath, "intervalMs must be null or a positive integer");
  if (field === "timeoutMs" || field === "staleAfterMs") return Number.isInteger(value) && typeof value === "number" && value > 0 ? null : error("invalid-value", canonicalPath, `${field} must be a positive integer`);
  if (field === "acknowledgedManifestDigest") return value === null || (typeof value === "string" && LOWER_SHA256_RE.test(value)) ? null : error("invalid-value", canonicalPath, "acknowledgedManifestDigest must be null or lower-case SHA-256 hex");
  return null;
};

const isAllowedSensorSpecificField = (sensorKey: string, fieldPath: readonly string[]): boolean => {
  const [field, second] = fieldPath;
  const builtin = BUILTIN_SENSOR_FIELDS[sensorKey];
  if (builtin?.has(field ?? "")) return true;
  if (sensorKey === "geo" && field === "tags" && second && KEY_RE.test(second)) return true;
  return false;
};

const pathKind = (canonicalPath: string, context: ValidationContext): "boolean" | "number" | "string" | "other" => {
  const parts = canonicalPath.split(".");
  const current = pathValue(context.config, canonicalPath);
  if (typeof current === "boolean") return "boolean";
  if (typeof current === "number") return "number";
  if (typeof current === "string") return "string";
  if (parts[0] === "external") return "boolean";
  if (parts[0] === "core" && ["agentInjectionEnabled", "statusEnabled", "widgetEnabled"].includes(parts[1] ?? "")) return "boolean";
  if (parts[0] === "core" && parts[1] === "maxAgentChars") return "number";
  if (parts[0] === "sensors") {
    const field = parts[2] ?? "";
    if (["enabled", "ui", "agent", "initialRefresh", "persist", "exactCoordinates", "exactAddress"].includes(field)) return "boolean";
    if (["intervalMs", "timeoutMs", "staleAfterMs"].includes(field)) return "number";
  }
  return "other";
};

const coerceValueForPath = (canonicalPath: string, raw: string, context: ValidationContext): unknown => {
  const expected = pathKind(canonicalPath, context);
  const lower = raw.toLowerCase();
  if (expected === "boolean") {
    if (["on", "true", "enabled"].includes(lower)) return true;
    if (["off", "false", "disabled"].includes(lower)) return false;
  }
  if (expected === "number" && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(raw)) return Number(raw);
  return raw;
};

const splitAssignments = (input: string): string[] | null => {
  const result: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const char of input) {
    if (escaped) {
      if (char !== "\\" && char !== "\"" && char !== ",") return null;
      current += char;
      escaped = false;
      continue;
    }
    if (quoted && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quoted || escaped) return null;
  result.push(current.trim());
  return result.filter((item) => item.length > 0);
};

const parseLaunch = (input: string, context: ValidationContext): { ok: true; assignments: Assignment[] } | { ok: false; errors: ConfigValidationError[] } => {
  const tokens = splitAssignments(input);
  if (!tokens) return { ok: false, errors: [error("invalid-schema", "launch", "invalid launch quoting or escape")] };
  const assignments: Assignment[] = [];
  const seen = new Set<string>();
  const errors: ConfigValidationError[] = [];
  for (const token of tokens) {
    const eq = token.indexOf("=");
    if (eq <= 0) {
      errors.push(error("invalid-schema", "launch", "missing assignment equals"));
      continue;
    }
    const inputPath = token.slice(0, eq).trim();
    const rawValue = token.slice(eq + 1).trim();
    const normalized = normalizePath(inputPath, context);
    if (!normalized.ok) {
      errors.push(normalized.error);
      continue;
    }
    if (seen.has(normalized.canonicalPath)) {
      errors.push(error("mutation-conflict", normalized.canonicalPath, "duplicate-path in launch assignments"));
      continue;
    }
    seen.add(normalized.canonicalPath);
    const value = coerceValueForPath(normalized.canonicalPath, rawValue, context);
    const valueError = validateValue(normalized.canonicalPath, value, context);
    if (valueError) errors.push(valueError);
    assignments.push({ inputPath, canonicalPath: normalized.canonicalPath, value });
  }
  return errors.length === 0 ? { ok: true, assignments } : { ok: false, errors };
};

export const validateConfigAssignment = (path: string, value: unknown, context: ValidationContext): boolean => {
  const normalized = normalizePath(path, context);
  if (!normalized.ok) return false;
  return validateValue(normalized.canonicalPath, value, context) === null;
};

export const createConfigMutationQueue = (): { enqueue(label: string, work: () => Promise<unknown> | unknown): Promise<unknown>; events(): string[] } => {
  const observed: string[] = [];
  let tail = Promise.resolve();
  return {
    enqueue(label, work) {
      const run = tail.then(async () => {
        const value = await work();
        observed.push(label);
        return value;
      });
      tail = run.then(() => undefined, () => undefined);
      return run;
    },
    events() {
      return [...observed];
    },
  };
};

export { writeConfigAtomically } from "./config-io.ts";

const parseDiskText = (configPath: string, text: string, context: ValidationContext): { disk: DiskDaseinConfig | null; errors: ConfigValidationError[] } => {
  try {
    const parsed = JSON.parse(text) as unknown;
    const disk = ensurePartial(parsed);
    if (!disk) return { disk: null, errors: [error("invalid-schema", configPath, "disk config version must be 1")] };
    const validationErrors = validateDiskPartial(disk, context);
    return validationErrors.length === 0 ? { disk, errors: [] } : { disk: null, errors: validationErrors };
  } catch (caught) {
    return { disk: null, errors: [error("invalid-schema", configPath, caught instanceof Error ? caught.message : "malformed disk config")] };
  }
};

const readDiskFromPathSync = (configPath: string | undefined, context: ValidationContext): { disk: DiskDaseinConfig | null; errors: ConfigValidationError[] } => {
  const text = readTextFileIfExistsSync(configPath);
  return text === null ? { disk: null, errors: [] } : parseDiskText(configPath ?? "diskConfig", text, context);
};

const readDiskFromPath = async (configPath: string | undefined, context: ValidationContext): Promise<{ disk: DiskDaseinConfig | null; errors: ConfigValidationError[] }> => {
  const text = await readTextFileIfExists(configPath);
  return text === null ? { disk: null, errors: [] } : parseDiskText(configPath ?? "diskConfig", text, context);
};

export const createConfigManager = (options: {
  configPath?: string;
  defaults: DaseinConfig;
  diskConfig?: unknown;
  launch?: string | DaseinConfigOverlay | null;
  discoveredSensorKeys?: readonly string[];
}): {
  getEffectiveConfig(): DaseinConfig;
  getRuntimeOverriddenPaths(): string[];
  getStatusErrors(): ConfigValidationError[];
  parseLaunchAssignments(input: string): { ok: boolean; assignments?: Assignment[]; errors?: ConfigValidationError[] };
  setRuntime(path: string, value: unknown, runtimeOptions?: { failPersistenceAt?: FailPoint }): Promise<LightweightMutationResult>;
  applyRuntime(assignments: Record<string, unknown>, runtimeOptions?: { failPersistenceAt?: FailPoint }): Promise<LightweightMutationResult>;
  applyRuntimeProposal(proposal: ConfigMutationProposal, runtimeOptions?: { failPersistenceAt?: FailPoint }): Promise<LightweightMutationResult>;
  reloadDisk(): Promise<LightweightReloadResult>;
} => {
  const defaults = clone(options.defaults);
  const discoveredSensorKeys = options.discoveredSensorKeys ?? Object.keys(defaults.sensors);
  let statusErrors: ConfigValidationError[] = [];
  let disk: DiskDaseinConfig | null = null;
  if (options.diskConfig === undefined) {
    const loaded = readDiskFromPathSync(options.configPath, { config: defaults, discoveredSensorKeys });
    disk = loaded.disk;
    statusErrors = [...statusErrors, ...loaded.errors];
  } else {
    disk = ensurePartial(options.diskConfig);
    if (disk === null) statusErrors.push(error("invalid-schema", options.configPath ?? "diskConfig", "disk config version must be 1"));
    if (disk) {
      const diskErrors = validateDiskPartial(disk, { config: defaults, discoveredSensorKeys });
      if (diskErrors.length > 0) {
        statusErrors = [...statusErrors, ...diskErrors];
        disk = null;
      }
    }
  }
  let runtime: DaseinConfigOverlay | null = null;
  const runtimeOverriddenPaths: string[] = [];
  let effective = composeEffective(defaults, disk, null, runtime, runtimeOverriddenPaths);
  const launchParsed = typeof options.launch === "string" ? parseLaunch(options.launch, { config: effective, discoveredSensorKeys }) : null;
  let launch = typeof options.launch === "string" ? null : options.launch ?? null;
  let launchAssignments: Assignment[] = [];
  if (launchParsed) {
    if (launchParsed.ok) {
      launchAssignments = launchParsed.assignments;
      launch = overlayFromAssignments(launchParsed.assignments);
    } else {
      statusErrors = [...statusErrors, ...launchParsed.errors.map((item) => ({ ...item, message: `launch: ${item.message}` }))];
    }
  }
  effective = composeEffective(defaults, disk, launch, runtime, runtimeOverriddenPaths);
  const queue = createConfigMutationQueue();

  const normalizeAssignments = (assignments: Record<string, unknown>): { ok: true; assignments: Assignment[] } | { ok: false; errors: ConfigValidationError[] } => {
    const normalizedAssignments: Assignment[] = [];
    const seen = new Set<string>();
    const errors: ConfigValidationError[] = [];
    for (const [inputPath, value] of Object.entries(assignments)) {
      const normalized = normalizePath(inputPath, { config: effective, discoveredSensorKeys });
      if (!normalized.ok) {
        errors.push(normalized.error);
        continue;
      }
      if (seen.has(normalized.canonicalPath)) {
        errors.push(error("mutation-conflict", normalized.canonicalPath, "duplicate-path in runtime assignments"));
        continue;
      }
      seen.add(normalized.canonicalPath);
      const valueError = validateValue(normalized.canonicalPath, value, { config: effective, discoveredSensorKeys });
      if (valueError) errors.push(valueError);
      normalizedAssignments.push({ inputPath, canonicalPath: normalized.canonicalPath, value });
    }
    return errors.length === 0 ? { ok: true, assignments: normalizedAssignments } : { ok: false, errors };
  };

  const commit = async (assignments: readonly Assignment[], deletePaths: readonly string[], failPersistenceAt?: FailPoint): Promise<LightweightMutationResult> => {
    const nextDisk = patchDisk(disk, assignments, deletePaths);
    if (options.configPath) {
      const write = await writeConfigAtomically({ path: options.configPath, value: nextDisk, failAt: failPersistenceAt });
      if (!write.ok) return { ok: false, errors: [error("persist-failed", options.configPath, "persist-failed: config write failed")] };
    }
    const nextRuntime = runtime ? clone(runtime) : {};
    for (const assignment of assignments) setPathInOverlay(nextRuntime, assignment.canonicalPath, assignment.value);
    for (const deletePath of deletePaths) deleteNested(nextRuntime as unknown as JsonObject, deletePath.split("."));
    disk = nextDisk;
    runtime = nextRuntime;
    for (const assignment of assignments) if (!runtimeOverriddenPaths.includes(assignment.canonicalPath)) runtimeOverriddenPaths.push(assignment.canonicalPath);
    for (const deletePath of deletePaths) if (!runtimeOverriddenPaths.includes(deletePath)) runtimeOverriddenPaths.push(deletePath);
    effective = composeEffective(defaults, disk, launch, runtime, runtimeOverriddenPaths);
    return { ok: true, updatedPaths: assignments.map((assignment) => assignment.canonicalPath), deletedPaths: [...deletePaths] };
  };

  return {
    getEffectiveConfig() {
      return clone(effective);
    },
    getRuntimeOverriddenPaths() {
      return [...runtimeOverriddenPaths];
    },
    getStatusErrors() {
      return clone(statusErrors);
    },
    parseLaunchAssignments(input: string) {
      const parsed = parseLaunch(input, { config: effective, discoveredSensorKeys });
      return parsed.ok ? { ok: true, assignments: parsed.assignments } : { ok: false, errors: parsed.errors };
    },
    setRuntime(path, value, runtimeOptions) {
      return this.applyRuntime({ [path]: value }, runtimeOptions);
    },
    applyRuntime(assignments, runtimeOptions) {
      return queue.enqueue("applyRuntime", async () => {
        const normalized = normalizeAssignments(assignments);
        if (!normalized.ok) return { ok: false, errors: normalized.errors };
        return commit(normalized.assignments, [], runtimeOptions?.failPersistenceAt);
      }) as Promise<LightweightMutationResult>;
    },
    applyRuntimeProposal(proposal, runtimeOptions) {
      return queue.enqueue("applyRuntimeProposal", async () => {
        const normalized = normalizeAssignments(proposal.assignments ?? {});
        if (!normalized.ok) return { ok: false, errors: normalized.errors };
        const deletedPaths: string[] = [];
        const errors: ConfigValidationError[] = [];
        for (const deletePath of proposal.deletePaths ?? []) {
          const normalizedDelete = normalizePath(deletePath, { config: effective, discoveredSensorKeys });
          if (normalizedDelete.ok) deletedPaths.push(normalizedDelete.canonicalPath);
          else errors.push(normalizedDelete.error);
        }
        if (errors.length > 0) return { ok: false, errors };
        return commit(normalized.assignments, deletedPaths, runtimeOptions?.failPersistenceAt);
      }) as Promise<LightweightMutationResult>;
    },
    reloadDisk() {
      return queue.enqueue("reloadDisk", async () => {
        const loaded = await readDiskFromPath(options.configPath, { config: defaults, discoveredSensorKeys });
        if (loaded.errors.length > 0) return { ok: false, errors: loaded.errors };
        disk = loaded.disk;
        const skip = new Set(runtimeOverriddenPaths);
        launch = overlayFromAssignments(launchAssignments.filter((assignment) => !skip.has(assignment.canonicalPath)));
        effective = composeEffective(defaults, disk, launch, runtime, runtimeOverriddenPaths);
        return { ok: true, launchReappliedPaths: launchAssignments.filter((assignment) => !skip.has(assignment.canonicalPath)).map((assignment) => assignment.canonicalPath), runtimeOverriddenPaths: [...runtimeOverriddenPaths] };
      }) as Promise<LightweightReloadResult>;
    },
  };
};

export const applyRuntimeProposal = async ({ sensorKey, proposal }: { sensorKey: string; proposal: ConfigMutationProposal }): Promise<{ ok: boolean; updatedPaths: string[]; deletedPaths: string[]; persistedTombstones: false; errors?: ConfigValidationError[] }> => {
  const updatedPaths = Object.keys(proposal.assignments ?? {});
  const deletedPaths = proposal.deletePaths ?? [];
  const outside = [...updatedPaths, ...deletedPaths].filter((path) => !path.startsWith(`sensors.${sensorKey}.`));
  if (outside.length > 0) {
    return { ok: false, updatedPaths: [], deletedPaths: [], persistedTombstones: false, errors: outside.map((path) => error("invalid-path", path, "sensor proposals may only mutate their own namespace")) };
  }
  return { ok: true, updatedPaths, deletedPaths, persistedTombstones: false };
};
