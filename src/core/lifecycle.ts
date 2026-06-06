/**
 * Lifecycle and reload result contracts.
 *
 * Lifecycle code owns startup/shutdown sequencing and durable state coordination
 * in later implementation phases. This file only pins result shapes and bounded
 * cleanup contract metadata.
 */

import type {
  ConfigValidationError,
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
