/**
 * `/dasein` command parser and result contracts.
 *
 * The command layer parses deterministic command shapes and returns structured
 * results before Pi text formatting. It deliberately delegates persistence,
 * Pi registration, TUI rendering, and sensor-specific semantics to upstream
 * runtime collaborators.
 */

import type {
  ConfigMutationProposal,
  ConfigMutationResult,
  ConfigValidationError,
  DaseinConfig,
  ExternalStateSnapshot,
  LapsePersistedState,
  RenderedContext,
  SensorActionResult,
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
  defaultEnabled?: boolean;
  effectiveEnabled?: boolean;
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

export type ParseSuccess = { ok: true; command: ParsedDaseinCommand };
export type ParseFailure = { ok: false; errors: CommandParseError[] };
export type ParseResult = ParseSuccess | ParseFailure;
export type LaunchAssignmentParseResult = { ok: true; assignments: ParsedAssignment[] } | ParseFailure;

export interface CommandParseOptions {
  discoveredSensorKeys?: readonly string[];
  sensorActions?: Record<string, readonly string[]>;
}

export interface ExecuteDaseinCommandOptions extends CommandParseOptions {
  mutateConfig?: (command: Extract<ParsedDaseinCommand, { kind: "set" | "apply" }> | ParsedDaseinCommand) => Promise<ConfigMutationResult> | ConfigMutationResult | void;
  runSensorAction?: (command: Extract<ParsedDaseinCommand, { kind: "sensor-action" }> | ParsedDaseinCommand) => Promise<SensorActionResult> | SensorActionResult | void;
  status?: BuildStatusCommandResultOptions;
  sensors?: BuildSensorsCommandResultOptions;
  reload?: BuildReloadCommandResultOptions;
}

export interface BuildStatusCommandResultOptions {
  fixture?: StatusCommandData;
  piVersion?: string | null;
  configPath?: string;
  statePath?: string;
  activeSensors?: SensorKey[];
  disabledSensors?: SensorKey[];
  hiddenContributors?: StatusContributorData[];
  permissions?: StatusPermissionData[];
  sensorMetadata?: SensorInspectableMetadata[];
  loadErrors?: SensorLoadError[];
  statusErrors?: DaseinStatusError[];
  launchArgsApplied?: boolean;
  diskConfigLoaded?: boolean;
  rendered?: Pick<RenderedContext, "omittedKeys" | "truncated">;
  durableState?: StatusCommandData["durableState"];
  piMechanisms?: StatusCommandData["piMechanisms"];
}

export interface BuildSensorsCommandResultOptions {
  fixture?: SensorsCommandData;
  sensors?: SensorListRecord[];
  loadErrors?: SensorLoadError[];
}

export interface BuildReloadCommandResultOptions {
  reload?: DaseinReloadResult;
  configPath?: string;
}

export interface MakeDaseinCommandResultInput {
  ok?: boolean;
  command: DaseinCommandName;
  message?: string;
  data?: unknown;
  updatedPaths?: string[];
  deletedPaths?: string[];
  errors?: DaseinCommandError[];
}

export interface PiSupportClassification {
  piVersion: string | null;
  minimumPiVersion: "0.78.1";
  classification: "unavailable" | "below-minimum" | "supported-version-feature-probes-still-required";
}

const ROOT_COMMAND = "/dasein";
const MINIMUM_PI_VERSION = "0.78.1" as const;
const CORE_COMMANDS = ["status", "reload", "sensors", "set", "apply", "help"] as const;
const CORE_COMMAND_SET = new Set<string>(CORE_COMMANDS);
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const SEGMENT_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const NUMBER_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const BOOLEAN_TRUE = new Set(["on", "true", "enabled"]);
const BOOLEAN_FALSE = new Set(["off", "false", "disabled"]);
const ASCII_WS = /[ \t]/u;
const CONTROL_OR_LINE_SEPARATOR = /[\u0000-\u001F\u007F\u2028\u2029]/u;

type FieldKind = "boolean" | "number" | "string" | "unknown";
type TokenResult = { ok: true; value: string; quoted: boolean; end: number } | { ok: false; error: CommandParseError };
type PathResult = { ok: true; canonicalPath: string } | { ok: false; error: CommandParseError };

const commandParseError = (
  code: CommandParseError["code"],
  message: string,
  extras: Pick<CommandParseError, "input" | "path"> = {},
): CommandParseError => ({ kind: "command_parse", code, message: singleLine(message), ...extras });

const singleLine = (value: string): string => value.replace(/[\r\n\u2028\u2029]+/gu, " ");

const isSpace = (char: string): boolean => ASCII_WS.test(char);
const isInvalidTextChar = (char: string): boolean => CONTROL_OR_LINE_SEPARATOR.test(char);
const discoveredSensors = (options: CommandParseOptions | undefined): Set<string> => new Set(options?.discoveredSensorKeys ?? []);

const stripSpaces = (value: string): string => value.trim();

const skipSpaces = (input: string, start: number): number => {
  let index = start;
  while (index < input.length && isSpace(input[index] ?? "")) {
    index += 1;
  }
  return index;
};

const validateSegments = (segments: readonly string[]): boolean => segments.every((segment) => SEGMENT_PATTERN.test(segment));

const normalizePath = (inputPath: string, options?: CommandParseOptions): PathResult => {
  const trimmed = stripSpaces(inputPath);
  const parts = trimmed.split(".");
  const sensors = discoveredSensors(options);

  if (parts.length < 2 || !validateSegments(parts)) {
    return { ok: false, error: commandParseError("invalid-path", `invalid command path ${trimmed}`, { path: trimmed }) };
  }

  if (parts[0] === "core") {
    if (parts.length < 2) {
      return { ok: false, error: commandParseError("invalid-path", `invalid core path ${trimmed}`, { path: trimmed }) };
    }
    return { ok: true, canonicalPath: trimmed };
  }

  if (parts[0] === "external") {
    if (parts.length !== 3 || !KEY_PATTERN.test(parts[1] ?? "") || !["ui", "agent"].includes(parts[2] ?? "")) {
      return { ok: false, error: commandParseError("invalid-path", `invalid external path ${trimmed}`, { path: trimmed }) };
    }
    return { ok: true, canonicalPath: trimmed };
  }

  if (parts[0] === "sensors") {
    const sensorKey = parts[1] ?? "";
    if (parts.length < 3 || !KEY_PATTERN.test(sensorKey)) {
      return { ok: false, error: commandParseError("invalid-path", `invalid sensor path ${trimmed}`, { path: trimmed }) };
    }
    if (sensors.size > 0 && !sensors.has(sensorKey)) {
      return { ok: false, error: commandParseError("unknown-sensor-key", `unknown sensor ${sensorKey}`, { path: trimmed }) };
    }
    return { ok: true, canonicalPath: trimmed };
  }

  const maybeSensor = parts[0] ?? "";
  if (KEY_PATTERN.test(maybeSensor) && sensors.has(maybeSensor)) {
    return { ok: true, canonicalPath: `sensors.${trimmed}` };
  }

  return { ok: false, error: commandParseError("invalid-path", `invalid command path ${trimmed}`, { path: trimmed }) };
};

const fieldKindForPath = (canonicalPath: string): FieldKind => {
  const parts = canonicalPath.split(".");
  const last = parts.at(-1) ?? "";

  if (canonicalPath === "core.maxAgentChars") {
    return "number";
  }
  if (["agentInjectionEnabled", "statusEnabled", "widgetEnabled"].includes(last)) {
    return "boolean";
  }
  if (parts[0] === "external" && ["ui", "agent"].includes(last)) {
    return "boolean";
  }
  if (["enabled", "ui", "agent", "initialRefresh", "persist", "exactAddress", "exactCoordinates"].includes(last)) {
    return "boolean";
  }
  if (["intervalMs", "timeoutMs", "staleAfterMs"].includes(last)) {
    return "number";
  }
  if (canonicalPath === "core.injectedLabel" || last === "acknowledgedManifestDigest" || last === "precision") {
    return "string";
  }
  return "unknown";
};

const parseQuotedToken = (input: string, start: number): TokenResult => {
  let value = "";
  let index = start + 1;

  while (index < input.length) {
    const char = input[index] ?? "";
    if (char === "\"") {
      return { ok: true, value, quoted: true, end: index + 1 };
    }
    if (isInvalidTextChar(char)) {
      return { ok: false, error: commandParseError("bad-grammar", "quoted strings cannot contain control characters", { input }) };
    }
    if (char === ",") {
      return { ok: false, error: commandParseError("bad-grammar", "commas in quoted strings must be escaped", { input }) };
    }
    if (char === "\\") {
      const next = input[index + 1];
      if (next === undefined) {
        return { ok: false, error: commandParseError("invalid-escape", "invalid trailing escape", { input }) };
      }
      if (next !== "\\" && next !== "\"" && next !== ",") {
        return { ok: false, error: commandParseError("invalid-escape", `invalid escape \\${next}`, { input }) };
      }
      value += next;
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }

  return { ok: false, error: commandParseError("unterminated-quote", "unterminated quoted string", { input }) };
};

const parseBareToken = (input: string, start: number, stopAtWhitespace: boolean): TokenResult => {
  let value = "";
  let index = start;
  while (index < input.length) {
    const char = input[index] ?? "";
    if (stopAtWhitespace && isSpace(char)) {
      break;
    }
    if (!stopAtWhitespace && isSpace(char)) {
      return { ok: false, error: commandParseError("bad-grammar", "bare values cannot contain whitespace", { input }) };
    }
    if (char === "," || char === "=" || char === "\"" || char === "\\" || isInvalidTextChar(char)) {
      return { ok: false, error: commandParseError("bad-grammar", "invalid bare token", { input }) };
    }
    value += char;
    index += 1;
  }

  if (value.length === 0) {
    return { ok: false, error: commandParseError("bad-grammar", "expected token", { input }) };
  }
  return { ok: true, value, quoted: false, end: index };
};

const parseValueToken = (input: string, canonicalPath: string): { ok: true; value: unknown; end: number } | { ok: false; error: CommandParseError } => {
  const start = skipSpaces(input, 0);
  const token = input[start] === "\"" ? parseQuotedToken(input, start) : parseBareToken(input, start, false);
  if (!token.ok) {
    return token;
  }

  const end = skipSpaces(input, token.end);
  if (end !== input.length) {
    return { ok: false, error: commandParseError("bad-grammar", "unexpected characters after value", { input }) };
  }

  const kind = fieldKindForPath(canonicalPath);
  const lowered = token.value.toLowerCase();

  if (!token.quoted && kind === "boolean") {
    if (BOOLEAN_TRUE.has(lowered)) {
      return { ok: true, value: true, end };
    }
    if (BOOLEAN_FALSE.has(lowered)) {
      return { ok: true, value: false, end };
    }
    return { ok: false, error: commandParseError("invalid-value", `invalid boolean for ${canonicalPath}`, { input, path: canonicalPath }) };
  }

  if (!token.quoted && kind === "number") {
    if (!NUMBER_PATTERN.test(token.value)) {
      return { ok: false, error: commandParseError("invalid-value", `invalid number for ${canonicalPath}`, { input, path: canonicalPath }) };
    }
    const numeric = Number(token.value);
    if (!Number.isFinite(numeric)) {
      return { ok: false, error: commandParseError("invalid-value", `invalid finite number for ${canonicalPath}`, { input, path: canonicalPath }) };
    }
    return { ok: true, value: numeric, end };
  }

  if (token.quoted && (kind === "boolean" || kind === "number")) {
    return { ok: false, error: commandParseError("invalid-value", `quoted value does not match ${canonicalPath}`, { input, path: canonicalPath }) };
  }

  if (!token.quoted && kind === "unknown") {
    if (BOOLEAN_TRUE.has(lowered)) {
      return { ok: true, value: true, end };
    }
    if (BOOLEAN_FALSE.has(lowered)) {
      return { ok: true, value: false, end };
    }
    if (NUMBER_PATTERN.test(token.value)) {
      const numeric = Number(token.value);
      if (Number.isFinite(numeric)) {
        return { ok: true, value: numeric, end };
      }
    }
  }

  return { ok: true, value: token.value, end };
};

const splitAssignments = (input: string): { ok: true; entries: string[] } | { ok: false; error: CommandParseError } => {
  const entries: string[] = [];
  let current = "";
  let inQuote = false;
  let escaping = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (isInvalidTextChar(char)) {
      return { ok: false, error: commandParseError("bad-grammar", "assignments cannot contain control characters", { input }) };
    }
    if (escaping) {
      if (char !== "\\" && char !== "\"" && char !== ",") {
        return { ok: false, error: commandParseError("invalid-escape", `invalid escape \\${char}`, { input }) };
      }
      current += `\\${char}`;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      if (!inQuote) {
        return { ok: false, error: commandParseError("bad-grammar", "bare values cannot contain backslashes", { input }) };
      }
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      current += char;
      continue;
    }
    if (char === "," && !inQuote) {
      const entry = current.trim();
      if (entry.length === 0) {
        return { ok: false, error: commandParseError("bad-grammar", "empty assignment", { input }) };
      }
      entries.push(entry);
      current = "";
      continue;
    }
    current += char;
  }

  if (escaping) {
    return { ok: false, error: commandParseError("invalid-escape", "invalid trailing escape", { input }) };
  }
  if (inQuote) {
    return { ok: false, error: commandParseError("unterminated-quote", "unterminated quoted string", { input }) };
  }

  const tail = current.trim();
  if (tail.length === 0) {
    return { ok: false, error: commandParseError("bad-grammar", "empty assignment", { input }) };
  }
  entries.push(tail);
  return { ok: true, entries };
};

const splitAssignmentPathValue = (entry: string): { ok: true; inputPath: string; valueSource: string } | { ok: false; error: CommandParseError } => {
  let inQuote = false;
  let escaping = false;
  for (let index = 0; index < entry.length; index += 1) {
    const char = entry[index] ?? "";
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inQuote = !inQuote;
      continue;
    }
    if (char === "=" && !inQuote) {
      const inputPath = entry.slice(0, index).trim();
      const valueSource = entry.slice(index + 1).trim();
      if (inputPath.length === 0 || valueSource.length === 0) {
        return { ok: false, error: commandParseError("bad-grammar", "assignment requires path and value", { input: entry }) };
      }
      return { ok: true, inputPath, valueSource };
    }
  }
  return { ok: false, error: commandParseError("bad-grammar", "assignment requires equals separator", { input: entry }) };
};

export const parseLaunchAssignments = (input: string, options: CommandParseOptions = {}): LaunchAssignmentParseResult => {
  const split = splitAssignments(input.trim());
  if (!split.ok) {
    return { ok: false, errors: [split.error] };
  }

  const assignments: ParsedAssignment[] = [];
  const seenCanonical = new Set<string>();

  for (const entry of split.entries) {
    const pair = splitAssignmentPathValue(entry);
    if (!pair.ok) {
      return { ok: false, errors: [pair.error] };
    }
    const path = normalizePath(pair.inputPath, options);
    if (!path.ok) {
      return { ok: false, errors: [path.error] };
    }
    if (seenCanonical.has(path.canonicalPath)) {
      return {
        ok: false,
        errors: [{ kind: "command_parse", code: "duplicate-path", path: path.canonicalPath } as CommandParseError],
      };
    }
    const value = parseValueToken(pair.valueSource, path.canonicalPath);
    if (!value.ok) {
      return { ok: false, errors: [value.error] };
    }
    seenCanonical.add(path.canonicalPath);
    assignments.push({ inputPath: pair.inputPath, canonicalPath: path.canonicalPath, value: value.value });
  }

  return { ok: true, assignments };
};

const parseWhitespaceTokens = (input: string): { ok: true; tokens: string[] } | { ok: false; error: CommandParseError } => {
  const tokens: string[] = [];
  let index = skipSpaces(input, 0);
  while (index < input.length) {
    const token = input[index] === "\"" ? parseQuotedToken(input, index) : parseBareToken(input, index, true);
    if (!token.ok) {
      return { ok: false, error: token.error };
    }
    tokens.push(token.value);
    index = skipSpaces(input, token.end);
  }
  return { ok: true, tokens };
};

export const parseDaseinCommand = (input: string, options: CommandParseOptions = {}): ParseResult => {
  const trimmed = input.trim();
  if (trimmed !== ROOT_COMMAND && !trimmed.startsWith(`${ROOT_COMMAND} `) && !trimmed.startsWith(`${ROOT_COMMAND}\t`)) {
    return { ok: false, errors: [commandParseError("bad-grammar", "command must start with /dasein", { input })] };
  }

  const rest = trimmed.slice(ROOT_COMMAND.length).trim();
  if (rest.length === 0) {
    return { ok: true, command: { kind: "open-ui" } };
  }

  const firstTokenMatch = /^(\S+)/u.exec(rest);
  const first = firstTokenMatch?.[1] ?? "";
  const afterFirst = rest.slice(first.length).trim();

  if (first === "set") {
    const split = parseWhitespaceTokens(afterFirst);
    if (!split.ok) {
      return { ok: false, errors: [split.error] };
    }
    if (split.tokens.length !== 2) {
      return { ok: false, errors: [commandParseError("bad-grammar", "set requires path and value", { input })] };
    }
    const path = normalizePath(split.tokens[0] ?? "", options);
    if (!path.ok) {
      return { ok: false, errors: [path.error] };
    }
    const rawValueStart = afterFirst.indexOf(split.tokens[0] ?? "") + (split.tokens[0]?.length ?? 0);
    const rawValue = afterFirst.slice(rawValueStart).trim();
    const value = parseValueToken(rawValue, path.canonicalPath);
    if (!value.ok) {
      return { ok: false, errors: [value.error] };
    }
    return { ok: true, command: { kind: "set", path: path.canonicalPath, value: value.value, assignments: [{ inputPath: split.tokens[0] ?? "", canonicalPath: path.canonicalPath, value: value.value }] } };
  }

  if (first === "apply") {
    if (afterFirst.length === 0) {
      return { ok: false, errors: [commandParseError("bad-grammar", "apply requires assignments", { input })] };
    }
    const parsed = parseLaunchAssignments(afterFirst, options);
    if (!parsed.ok) {
      return parsed;
    }
    return { ok: true, command: { kind: "apply", assignments: parsed.assignments } };
  }

  if (CORE_COMMAND_SET.has(first)) {
    if (afterFirst.length > 0) {
      return { ok: false, errors: [commandParseError("bad-grammar", `${first} does not accept arguments`, { input })] };
    }
    return { ok: true, command: { kind: first as DaseinCommandName } };
  }

  if (first === "core" || first === "external" || first === "sensors") {
    return { ok: false, errors: [commandParseError("unknown-core-command", `unknown core command ${first}`, { input })] };
  }

  const sensors = discoveredSensors(options);
  if (!KEY_PATTERN.test(first) || !sensors.has(first)) {
    return { ok: false, errors: [commandParseError("unknown-sensor-key", `unknown sensor ${first}`, { input })] };
  }

  const tokens = parseWhitespaceTokens(afterFirst);
  if (!tokens.ok) {
    return { ok: false, errors: [tokens.error] };
  }
  if (tokens.tokens.length === 0) {
    return { ok: false, errors: [commandParseError("bad-grammar", "sensor command requires an action", { input })] };
  }
  const action = tokens.tokens[0] ?? "";
  const allowedActions = options.sensorActions?.[first];
  if (allowedActions !== undefined && !allowedActions.includes(action)) {
    return { ok: false, errors: [commandParseError("unknown-sensor-action", `unknown ${first} action ${action}`, { input })] };
  }
  return { ok: true, command: { kind: "sensor-action", sensorKey: first, action, actionArgs: tokens.tokens.slice(1) } };
};

const inferCommandName = (input: string): DaseinCommandName => {
  const trimmed = input.trim();
  const rest = trimmed.startsWith(ROOT_COMMAND) ? trimmed.slice(ROOT_COMMAND.length).trim() : "";
  const first = /^(\S+)/u.exec(rest)?.[1];
  if (first === "set" || first === "apply" || first === "status" || first === "reload" || first === "sensors" || first === "help") {
    return first;
  }
  if (first !== undefined && first.length > 0) {
    return "sensor-action";
  }
  return "open-ui";
};

const defaultMessageFor = (input: MakeDaseinCommandResultInput): string => {
  if (input.message !== undefined) {
    return singleLine(input.message);
  }
  if (input.command === "reload") {
    const data = input.data as Partial<ReloadCommandData> | undefined;
    if (data?.reload?.ok === false) {
      return "dasein reload: failed; kept previous state";
    }
    const activeCount = data?.reload?.ok === true ? data.reload.sensors.activeKeys.length : 0;
    return `dasein reload: ok (${activeCount} sensors)`;
  }
  if (input.ok === false) {
    return `dasein ${input.command}: failed`;
  }
  if (input.command === "set") {
    const data = input.data as Partial<SetCommandData> | undefined;
    return `updated ${data?.canonicalPath ?? input.updatedPaths?.[0] ?? "path"}`;
  }
  if (input.command === "apply") {
    const count = input.updatedPaths?.length ?? (input.data as Partial<ApplyCommandData> | undefined)?.assignments?.length ?? 0;
    return `updated ${count} paths`;
  }
  if (input.command === "status") {
    const data = input.data as Partial<StatusCommandData> | undefined;
    return `dasein status: ${(data?.statusErrors?.length ?? 0) === 0 ? "ok" : "degraded"}`;
  }
  if (input.command === "sensors") {
    const data = input.data as Partial<SensorsCommandData> | undefined;
    return `dasein sensors: ${(data?.sensors?.length ?? 0)} records; user-added local .ts sensors are trusted executable code at import time and are not sandboxed`;
  }
  if (input.command === "help") {
    return "dasein help: /dasein status | reload | sensors | set <path> <value> | apply <path=value,...> | help";
  }
  if (input.command === "open-ui") {
    return "dasein: open settings";
  }
  return "dasein sensor-action: ok";
};

export const makeDaseinCommandResult = (input: MakeDaseinCommandResultInput): DaseinCommandResult => {
  const ok = input.ok ?? input.errors === undefined;
  const message = defaultMessageFor({ ...input, ok });
  if (!ok) {
    const errors = input.errors ?? [commandParseError("bad-grammar", "command failed")];
    return { ok: false, command: input.command, message, errors, data: input.data };
  }
  return {
    ok: true,
    command: input.command,
    message,
    data: input.data,
    updatedPaths: [...(input.updatedPaths ?? [])].sort(),
    deletedPaths: [...(input.deletedPaths ?? [])].sort(),
    errors: [],
  };
};

export const classifyPiSupport = (piVersion: string | null): PiSupportClassification => {
  if (piVersion === null) {
    return { piVersion, minimumPiVersion: MINIMUM_PI_VERSION, classification: "unavailable" };
  }

  const parseVersion = (value: string): number[] => value.split(".").map((part) => Number.parseInt(part, 10));
  const actual = parseVersion(piVersion);
  const minimum = parseVersion(MINIMUM_PI_VERSION);
  for (let index = 0; index < minimum.length; index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart < minimumPart) {
      return { piVersion, minimumPiVersion: MINIMUM_PI_VERSION, classification: "below-minimum" };
    }
    if (actualPart > minimumPart) {
      return { piVersion, minimumPiVersion: MINIMUM_PI_VERSION, classification: "supported-version-feature-probes-still-required" };
    }
  }
  return { piVersion, minimumPiVersion: MINIMUM_PI_VERSION, classification: "supported-version-feature-probes-still-required" };
};

export const buildStatusCommandResult = (options: BuildStatusCommandResultOptions = {}): DaseinCommandResult => {
  const data: StatusCommandData = options.fixture ?? {
    piVersion: options.piVersion ?? null,
    minimumPiVersion: MINIMUM_PI_VERSION,
    piMechanisms: options.piMechanisms ?? [
      {
        mechanism: "pi.registerCommand",
        evidenceStatuses: ["SOURCE_VERIFIED", "LIVE_SMOKE_VERIFIED"],
        observedBehavior: "live Pi smoke ledger pi.registerCommand./dasein=PROVEN",
        verificationDate: "2026-06-06",
      },
    ],
    configPath: options.configPath ?? "~/.pi/dasein/config.json",
    statePath: options.statePath ?? "~/.pi/dasein/state.json",
    effectiveConfigVersion: 1,
    activeSensors: options.activeSensors ?? [],
    disabledSensors: options.disabledSensors ?? [],
    hiddenContributors: options.hiddenContributors ?? [],
    rendered: options.rendered ?? { omittedKeys: [], truncated: false },
    permissions: options.permissions ?? [],
    sensorMetadata: options.sensorMetadata ?? [],
    loadErrors: options.loadErrors ?? [],
    statusErrors: options.statusErrors ?? [],
    launchArgsApplied: options.launchArgsApplied ?? false,
    diskConfigLoaded: options.diskConfigLoaded ?? false,
    durableState: options.durableState ?? {
      statePath: options.statePath ?? "~/.pi/dasein/state.json",
      stateFileLoaded: false,
      lapse: null,
    },
  };

  return makeDaseinCommandResult({ command: "status", data });
};

export const buildSensorsCommandResult = (options: BuildSensorsCommandResultOptions = {}): DaseinCommandResult => {
  const data: SensorsCommandData = options.fixture ?? {
    sensors: options.sensors ?? [],
    loadErrors: options.loadErrors ?? [],
  };

  return makeDaseinCommandResult({ command: "sensors", data });
};

export const buildReloadCommandResult = (options: BuildReloadCommandResultOptions = {}): DaseinCommandResult => {
  const reload: DaseinReloadResult = options.reload ?? {
    ok: true,
    config: { ok: true, loadedPath: options.configPath ?? "~/.pi/dasein/config.json", updatedPaths: [] },
    sensors: { ok: true, loadedKeys: [], unloadedKeys: [], activeKeys: [] },
    launchReappliedPaths: [],
    runtimeOverriddenPaths: [],
    warnings: [],
  };
  const data: ReloadCommandData = {
    reload,
    configPath: options.configPath ?? (reload.ok ? reload.config.loadedPath : "~/.pi/dasein/config.json"),
    launchReappliedPaths: reload.launchReappliedPaths,
    runtimeOverriddenPaths: reload.runtimeOverriddenPaths,
  };
  const errors = reload.ok ? undefined : reload.errors;
  return makeDaseinCommandResult({ ok: reload.ok, command: "reload", data, errors });
};

const resultFromMutation = (command: ParsedDaseinCommand, mutation: ConfigMutationResult | void): DaseinCommandResult => {
  if (mutation !== undefined && !mutation.ok) {
    return makeDaseinCommandResult({ ok: false, command: command.kind, errors: mutation.errors });
  }

  const updatedPaths = mutation?.ok === true ? mutation.updatedPaths : command.assignments?.map((assignment) => assignment.canonicalPath) ?? [];
  const deletedPaths = mutation?.ok === true ? mutation.deletedPaths : [];
  if (command.kind === "set") {
    const assignment = command.assignments?.[0];
    const data: SetCommandData = {
      inputPath: assignment?.inputPath ?? command.path ?? "",
      canonicalPath: assignment?.canonicalPath ?? command.path ?? "",
      value: assignment?.value ?? command.value,
      persistedPath: mutation?.ok === true ? mutation.persistedPath : "~/.pi/dasein/config.json",
    };
    return makeDaseinCommandResult({ command: "set", data, updatedPaths, deletedPaths });
  }

  const data: ApplyCommandData = {
    assignments: command.assignments ?? [],
    persistedPath: mutation?.ok === true ? mutation.persistedPath : "~/.pi/dasein/config.json",
  };
  return makeDaseinCommandResult({ command: "apply", data, updatedPaths, deletedPaths });
};

const sanitizeSensorActionMessage = (message: string | undefined): string => singleLine(message ?? "dasein sensor-action: ok");

export const executeDaseinCommand = async (input: string, options: ExecuteDaseinCommandOptions = {}): Promise<DaseinCommandResult> => {
  const parsed = parseDaseinCommand(input, options);
  if (!parsed.ok) {
    return makeDaseinCommandResult({ ok: false, command: inferCommandName(input), errors: parsed.errors });
  }

  const { command } = parsed;
  if (command.kind === "help") {
    return makeDaseinCommandResult({ command: "help", data: { commands: [...CORE_COMMANDS], sensorRoute: "/dasein <sensor-key> <action> [...args]" } });
  }
  if (command.kind === "open-ui") {
    return makeDaseinCommandResult({ command: "open-ui", data: { suggestedCommands: "help/status" } });
  }
  if (command.kind === "status") {
    return buildStatusCommandResult(options.status);
  }
  if (command.kind === "sensors") {
    return buildSensorsCommandResult(options.sensors);
  }
  if (command.kind === "reload") {
    return buildReloadCommandResult(options.reload);
  }
  if (command.kind === "set" || command.kind === "apply") {
    const mutation = await options.mutateConfig?.(command);
    return resultFromMutation(command, mutation);
  }

  const actionResult = await options.runSensorAction?.(command);
  if (actionResult !== undefined && !actionResult.ok) {
    return makeDaseinCommandResult({
      ok: false,
      command: "sensor-action",
      message: sanitizeSensorActionMessage(actionResult.message),
      errors: [commandParseError("bad-grammar", actionResult.message)],
      data: { sensorKey: command.sensorKey, action: command.action, actionArgs: command.actionArgs ?? [] },
    });
  }

  const mutationProposal = actionResult?.ok === true ? actionResult.mutation : undefined;
  const data: SensorActionCommandData & { mutationProposal?: ConfigMutationProposal } = {
    sensorKey: command.sensorKey ?? "",
    action: command.action ?? "",
    actionArgs: command.actionArgs ?? [],
    refreshScheduled: actionResult?.ok === true ? actionResult.refreshScheduled ?? false : false,
    actionPayload: actionResult?.ok === true ? actionResult.data : undefined,
    mutationProposal,
  };
  return makeDaseinCommandResult({ command: "sensor-action", message: sanitizeSensorActionMessage(actionResult?.ok === true ? actionResult.message : undefined), data });
};

export const commandParserContract: CommandParserContract = {
  rootCommand: ROOT_COMMAND,
  coreCommands: CORE_COMMANDS,
  sensorRoute: "/dasein <sensor-key> <action> [...args]",
  pathAliases: "short-sensor-paths-only",
  duplicateDetection: "normalized-canonical-path",
  parserOutput: { kind: "help" },
  resultOutput: { ok: true, command: "help", message: "dasein help: status reload sensors set apply help" },
};

export const validateConfigAssignment = (path: string, value: unknown, options: { config?: Readonly<DaseinConfig>; discoveredSensorKeys?: readonly string[] } = {}): boolean => {
  const normalized = normalizePath(path, options);
  if (!normalized.ok) {
    return false;
  }
  const canonicalPath = normalized.canonicalPath;
  const kind = fieldKindForPath(canonicalPath);
  if (kind === "boolean") {
    return typeof value === "boolean";
  }
  if (kind === "number") {
    if (typeof value !== "number") {
      return false;
    }
    if (canonicalPath === "core.maxAgentChars") {
      return Number.isInteger(value) && value >= 40 && value <= 2000;
    }
    return Number.isInteger(value) && value > 0;
  }
  if (canonicalPath === "core.injectedLabel") {
    return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,32}$/u.test(value);
  }
  if (canonicalPath.endsWith(".acknowledgedManifestDigest")) {
    return value === null || (typeof value === "string" && /^[a-f0-9]{64}$/u.test(value));
  }
  if (canonicalPath === "sensors.weather.alert.agent" || canonicalPath === "external.weather.alert.agent") {
    return false;
  }
  return true;
};
