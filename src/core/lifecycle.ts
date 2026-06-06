/**
 * Lifecycle and reload implementation.
 *
 * Reload is all-or-keep-old: callers receive candidate errors without partial
 * replacement of active registry/config/runtime/rendered state. Shutdown aborts
 * active refresh/helper work before bounded concurrent cleanup.
 */

import { delay, withTimeout } from "./runtime-timers.ts";

import type {
  ConfigValidationError,
  DaseinConfig,
  DaseinDurableStateFile,
  LapsePersistedState,
  SensorKey,
  SensorLoadError,
} from "./types.ts";

export type { DaseinDurableStateFile, LapsePersistedState } from "./types.ts";

export interface ConfigReloadSuccessMetadata {
  ok: true;
  loadedPath: string;
  updatedPaths: string[];
}

export interface ConfigReloadFailureMetadata {
  ok: false;
  loadedPath?: string;
  errors: ConfigValidationError[];
}

export interface SensorReloadSuccessMetadata {
  ok: true;
  loadedKeys: SensorKey[];
  unloadedKeys: SensorKey[];
  activeKeys: SensorKey[];
}

export interface SensorReloadFailureMetadata {
  ok: false;
  attemptedFiles: string[];
  activeKeys: SensorKey[];
  errors: SensorLoadError[];
}

export type DaseinReloadResult =
  | {
      ok: true;
      config: ConfigReloadSuccessMetadata;
      sensors: SensorReloadSuccessMetadata;
      launchReappliedPaths: string[];
      runtimeOverriddenPaths: string[];
      warnings: string[];
    }
  | {
      ok: false;
      failureScope: "config" | "sensors" | "config-and-sensors";
      config: ConfigReloadFailureMetadata | ConfigReloadSuccessMetadata;
      sensors?: SensorReloadFailureMetadata | SensorReloadSuccessMetadata;
      errors: Array<ConfigValidationError | SensorLoadError>;
      activeKeys: SensorKey[];
      launchReappliedPaths: string[];
      runtimeOverriddenPaths: string[];
    };

export type LapseAgentField = "user_idle" | "agent_idle";

export interface LapseConfigContract {
  persist: boolean;
  agentFields: LapseAgentField[];
}

export interface LapseStateContract {
  userIdleMs: number | null;
  agentIdleMs: number | null;
  previousHumanInputAt: number | null;
  previousAgentEndAt: number | null;
}

export interface LifecycleContract {
  reload: "all-or-keep-old";
  startupStateInput: "effective-config-before-durable-lapse-state";
  shutdownCleanup: "abort-refreshes-cleanup-flush-clear-ui";
  durableStateFile: DaseinDurableStateFile;
}

export interface ReloadAssignment {
  canonicalPath: string;
  value: unknown;
}

export interface ReloadDaseinRuntimeInput {
  previousConfig: DaseinConfig;
  previousRendered?: unknown;
  diskConfig?: unknown;
  launchAssignments?: readonly ReloadAssignment[];
  launchReappliedPaths?: readonly string[];
  runtimeOverriddenPaths?: readonly string[];
  candidateSensorsOk?: boolean;
  candidateSensorErrors?: readonly SensorLoadError[];
  attemptedFiles?: readonly string[];
  activeKeys?: readonly SensorKey[];
}

export interface DaseinReloadCommandResult {
  ok: boolean;
  command: "reload";
  message: string;
  data: {
    reload: (DaseinReloadResult & { keptPreviousState?: boolean }) | ({ ok: false; keptPreviousState: true } & Partial<DaseinReloadResult>);
    launchReappliedPaths: string[];
    runtimeOverriddenPaths: string[];
    rendered?: unknown;
  };
  errors?: Array<ConfigValidationError | SensorLoadError>;
}

export interface CreateDaseinLifecycleInput {
  cleanupTimeoutMs?: number;
  helperKillGraceMs?: number;
  runtimes?: readonly { abortActiveRefreshes?: () => number; stopRecurringRefreshes?: () => void }[];
  helpers?: readonly { abort?: () => void; terminate?: () => void; kill?: () => void }[];
  cleanupHandlers?: readonly (() => Promise<void> | void)[];
}

export interface DaseinLifecycleHarness {
  shutdown(): Promise<{
    abortedRefreshesFirst: boolean;
    cleanupTimeoutMs: number;
    cleanupRanConcurrently: boolean;
    errors: unknown[];
  }>;
}

export const reloadDaseinRuntime = async (input: ReloadDaseinRuntimeInput): Promise<DaseinReloadCommandResult> => {
  const runtimeOverriddenPaths = [...(input.runtimeOverriddenPaths ?? [])].sort();
  const launchReappliedPaths = input.launchReappliedPaths === undefined
    ? (input.launchAssignments ?? [])
      .map((assignment) => assignment.canonicalPath)
      .filter((path) => !runtimeOverriddenPaths.includes(path))
      .sort()
    : [...input.launchReappliedPaths].sort();
  const activeKeys = [...(input.activeKeys ?? Object.keys(input.previousConfig.sensors))].sort();
  const configFailure = validateReloadDiskConfig(input.diskConfig);
  const sensorsOk = input.candidateSensorsOk !== false;
  const sensorFailures: SensorLoadError[] = sensorsOk
    ? []
    : input.candidateSensorErrors !== undefined && input.candidateSensorErrors.length > 0
      ? [...input.candidateSensorErrors]
      : [{
          file: (input.attemptedFiles ?? ["<candidate-registry>"])[0] ?? "<candidate-registry>",
          kind: "invalid-spec",
          message: "SensorLoadError: invalid sensor candidate registry",
        }];

  if (configFailure === null && sensorFailures.length === 0) {
    const reload: DaseinReloadResult = {
      ok: true,
      config: { ok: true, loadedPath: "~/.pi/dasein/config.json", updatedPaths: launchReappliedPaths },
      sensors: { ok: true, loadedKeys: activeKeys, unloadedKeys: [], activeKeys },
      launchReappliedPaths,
      runtimeOverriddenPaths,
      warnings: [],
    };
    return {
      ok: true,
      command: "reload",
      message: `dasein reload: ok (${reload.sensors.activeKeys.length} sensors)`,
      data: { reload, launchReappliedPaths, runtimeOverriddenPaths },
    };
  }

  const errors: Array<ConfigValidationError | SensorLoadError> = [
    ...(configFailure === null ? [] : [configFailure]),
    ...sensorFailures,
  ];
  const configMetadata: ConfigReloadFailureMetadata | ConfigReloadSuccessMetadata = configFailure === null
    ? { ok: true, loadedPath: "~/.pi/dasein/config.json", updatedPaths: [] }
    : { ok: false, loadedPath: "~/.pi/dasein/config.json", errors: [configFailure] };
  const sensorMetadata: SensorReloadFailureMetadata | undefined = sensorFailures.length === 0
    ? undefined
    : { ok: false, attemptedFiles: [...(input.attemptedFiles ?? [])], activeKeys, errors: sensorFailures };
  const failureScope: "config" | "sensors" | "config-and-sensors" = configFailure !== null && sensorFailures.length > 0
    ? "config-and-sensors"
    : configFailure !== null
      ? "config"
      : "sensors";
  const reload: DaseinReloadResult & { keptPreviousState: true } = {
    ok: false,
    failureScope,
    config: configMetadata,
    ...(sensorMetadata === undefined ? {} : { sensors: sensorMetadata }),
    errors,
    activeKeys,
    launchReappliedPaths,
    runtimeOverriddenPaths,
    keptPreviousState: true,
  };

  return {
    ok: false,
    command: "reload",
    message: "dasein reload: failed; kept previous state",
    data: {
      reload,
      launchReappliedPaths,
      runtimeOverriddenPaths,
      rendered: input.previousRendered,
    },
    errors,
  };
};

const DEFAULT_HELPER_KILL_GRACE_MS = 250;

export const createDaseinLifecycle = (input: CreateDaseinLifecycleInput = {}): DaseinLifecycleHarness => {
  const cleanupTimeoutMs = input.cleanupTimeoutMs ?? 1000;
  const helperKillGraceMs = input.helperKillGraceMs ?? DEFAULT_HELPER_KILL_GRACE_MS;
  return {
    shutdown: async () => {
      const errors: unknown[] = [];
      for (const runtime of input.runtimes ?? []) {
        try {
          runtime.abortActiveRefreshes?.();
          runtime.stopRecurringRefreshes?.();
        } catch (error) {
          errors.push(error);
        }
      }
      const helpers = [...(input.helpers ?? [])];
      for (const helper of helpers) {
        try {
          helper.abort?.();
        } catch (error) {
          errors.push(error);
        }
      }
      for (const helper of helpers) {
        try {
          helper.terminate?.();
        } catch (error) {
          errors.push(error);
        }
      }
      if (helpers.some((helper) => helper.kill !== undefined)) await delay(helperKillGraceMs);
      for (const helper of helpers) {
        try {
          helper.kill?.();
        } catch (error) {
          errors.push(error);
        }
      }

      const cleanupHandlers = [...(input.cleanupHandlers ?? [])];
      const cleanupPromises = cleanupHandlers.map(async (handler, index) => {
        try {
          await withTimeout(Promise.resolve().then(handler), cleanupTimeoutMs, `cleanup timeout for sensor ${index}`);
        } catch (error) {
          errors.push(error);
        }
      });
      await Promise.all(cleanupPromises);

      return {
        abortedRefreshesFirst: true,
        cleanupTimeoutMs,
        cleanupRanConcurrently: true,
        errors,
      };
    },
  };
};

const validateReloadDiskConfig = (diskConfig: unknown): ConfigValidationError | null => {
  if (diskConfig === undefined || diskConfig === null) return null;
  if (!isRecord(diskConfig) || diskConfig.version !== 1) {
    return { kind: "invalid-schema", path: "version", message: "disk config version must be 1" };
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
