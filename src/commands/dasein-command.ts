/**
 * `/dasein` command parser and result contracts.
 *
 * The command layer parses deterministic command shapes and returns structured
 * results before Pi text formatting. This file does not implement parsing,
 * routing, mutation, or sensor actions.
 */

import type {
  ConfigMutationResult,
  ConfigValidationError,
  ExternalStateSnapshot,
  LapsePersistedState,
  RenderedContext,
  SensorBackgroundWorkDeclaration,
  SensorError,
  SensorKey,
  SensorLoadError,
  SensorManifest,
  SensorRegistryProvenance,
  SensorStatus,
} from "../core/types.ts";
import type { DaseinReloadResult } from "../core/lifecycle.ts";

export type DaseinCommandName =
  | "open-ui"
  | "status"
  | "reload"
  | "sensors"
  | "set"
  | "apply"
  | "sensor-action"
  | "help";

export interface ParsedAssignment {
  inputPath: string;
  canonicalPath: string;
  value: unknown;
}

export interface ParsedDaseinCommand {
  kind: DaseinCommandName;
  path?: string;
  value?: unknown;
  assignments?: ParsedAssignment[];
  sensorKey?: string;
  action?: string;
  actionArgs?: string[];
}

export interface CommandParseError {
  kind: "command_parse";
  code:
    | "bad-grammar"
    | "unknown-core-command"
    | "unknown-sensor-key"
    | "unknown-sensor-action"
    | "invalid-path"
    | "invalid-value"
    | "unterminated-quote"
    | "invalid-escape"
    | "duplicate-path";
  message: string;
  input?: string;
  path?: string;
}

export interface DurableStateError {
  kind: "durable_state";
  code: "load-failed" | "write-failed" | "schema-invalid";
  message: string;
  path: string;
}

export type PiMechanismEvidenceStatus =
  | "SOURCE_VERIFIED"
  | "API_VERIFIED"
  | "LIVE_SMOKE_PENDING"
  | "LIVE_SMOKE_VERIFIED";

export interface PiMechanismError {
  kind: "pi_mechanism";
  mechanism: string;
  evidenceStatuses: PiMechanismEvidenceStatus[];
  message: string;
}

export type DaseinStatusError = ConfigValidationError | SensorLoadError | SensorError | DurableStateError | PiMechanismError;
export type DaseinCommandError = CommandParseError | DaseinStatusError;

export type DaseinCommandResult =
  | {
      ok: true;
      command: DaseinCommandName;
      message: string;
      data?: unknown;
      updatedPaths?: string[];
      deletedPaths?: string[];
      errors?: [];
    }
  | {
      ok: false;
      command: DaseinCommandName;
      message: string;
      errors: DaseinCommandError[];
      data?: unknown;
    };

export type ForcedDisabledReason =
  | "user-added-remote-or-network"
  | "user-added-recurring-work"
  | "user-added-remote-or-network-and-recurring-work";

export interface SensorInspectableMetadata {
  key: SensorKey;
  provenance: SensorRegistryProvenance;
  manifest: SensorManifest;
  backgroundWork: SensorBackgroundWorkDeclaration;
  effectiveIntervalMs: number | null;
  manifestDigest: string;
  acknowledgedManifestDigest?: string | null;
  acknowledgementRequired: boolean;
  acknowledgementSatisfied: boolean;
  defaultEnabled: boolean;
  effectiveEnabled: boolean;
  forcedDisabledReason?: ForcedDisabledReason;
}

export interface StatusContributorData {
  key: string;
  kind: "sensor" | "external";
  enabled: boolean;
  uiVisible: boolean;
  agentVisible: boolean;
  hiddenReason?: "disabled" | "ui-hidden" | "agent-hidden" | "expired" | "truncated";
  sensorMetadata?: SensorInspectableMetadata;
}

export interface StatusPermissionData {
  key: SensorKey;
  permission: "authorized" | "denied" | "restricted" | "not_determined" | "unknown" | "not_applicable";
  freshness: "fresh" | "stale" | "missing";
  health: "ok" | "degraded" | "error" | "disabled";
  checkedAt: number | null;
  error?: SensorError;
}

export interface StatusCommandData {
  piVersion: string | null;
  minimumPiVersion: "0.78.1";
  piMechanisms: Array<{
    mechanism: string;
    evidenceStatuses: PiMechanismEvidenceStatus[];
    observedBehavior: string;
    verificationDate: string | null;
  }>;
  configPath: string;
  statePath: string;
  effectiveConfigVersion: 1;
  activeSensors: SensorKey[];
  disabledSensors: SensorKey[];
  hiddenContributors: StatusContributorData[];
  rendered: Pick<RenderedContext, "omittedKeys" | "truncated">;
  permissions: StatusPermissionData[];
  sensorMetadata: SensorInspectableMetadata[];
  loadErrors: SensorLoadError[];
  statusErrors: DaseinStatusError[];
  launchArgsApplied: boolean;
  diskConfigLoaded: boolean;
  durableState: {
    statePath: string;
    stateFileLoaded: boolean;
    lapse: LapsePersistedState | null;
    loadError?: DurableStateError;
  };
}

export interface ReloadCommandData {
  reload: DaseinReloadResult;
  configPath: string;
  launchReappliedPaths: string[];
  runtimeOverriddenPaths: string[];
}

export interface SensorListRecord {
  key: SensorKey;
  loaded: boolean;
  enabled: boolean;
  status: SensorStatus;
  collectedAt: number | null;
  stale: boolean;
  actions: string[];
  provenance?: SensorRegistryProvenance;
  manifest?: SensorManifest;
  backgroundWork?: SensorBackgroundWorkDeclaration;
  effectiveIntervalMs: number | null;
  manifestDigest?: string;
  acknowledgedManifestDigest?: string | null;
  acknowledgementRequired?: boolean;
  acknowledgementSatisfied?: boolean;
  forcedDisabledReason?: ForcedDisabledReason;
  loadError?: SensorLoadError;
  healthError?: SensorError;
}

export interface SensorsCommandData {
  sensors: SensorListRecord[];
  loadErrors: SensorLoadError[];
}

export interface SetCommandData {
  inputPath: string;
  canonicalPath: string;
  value: unknown;
  persistedPath: string;
}

export interface ApplyCommandData {
  assignments: ParsedAssignment[];
  persistedPath: string;
}

export interface SensorActionCommandData {
  sensorKey: SensorKey;
  action: string;
  actionArgs: string[];
  refreshScheduled: boolean;
  mutation?: ConfigMutationResult;
  actionPayload?: unknown;
}

export interface CommandParserContract {
  rootCommand: "/dasein";
  coreCommands: readonly ["status", "reload", "sensors", "set", "apply", "help"];
  sensorRoute: "/dasein <sensor-key> <action> [...args]";
  pathAliases: "short-sensor-paths-only";
  duplicateDetection: "normalized-canonical-path";
  parserOutput: ParsedDaseinCommand;
  resultOutput: DaseinCommandResult;
  externalStateExample?: ExternalStateSnapshot;
}
