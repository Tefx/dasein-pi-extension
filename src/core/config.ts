/**
 * Dasein config contracts and validation schema constants.
 *
 * Contract-only: this file pins config surfaces, source precedence, FIFO
 * mutation interfaces, reload result shapes, and core validation boundaries. It
 * does not read, write, merge, or mutate configuration.
 */

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
