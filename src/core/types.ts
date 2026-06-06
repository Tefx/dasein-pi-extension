/**
 * Core TypeScript boundary contracts for Dasein.
 *
 * This module intentionally contains only types for config, normalized state,
 * sensor specifications, renderable fragments, external state, and lifecycle
 * metadata. Runtime collection, persistence, rendering, and Pi wiring belong to
 * downstream implementation modules.
 */

export type SensorKey = string;
export type ExternalStateKey = string;
export type CommandPath = string;
export type RenderOrderKey = SensorKey | `external:${ExternalStateKey}`;

export interface DaseinConfig {
  version: 1;
  core: CoreConfig;
  sensors: Record<SensorKey, SensorConfig>;
  external: Record<ExternalStateKey, ExternalStateConfig>;
}

export interface CoreConfig {
  agentInjectionEnabled: boolean;
  statusEnabled: boolean;
  widgetEnabled: boolean;
  maxAgentChars: number;
  injectedLabel: string;
  renderOrder: RenderOrderKey[];
}

export interface SensorConfig {
  enabled: boolean;
  ui: boolean;
  agent: boolean;
  intervalMs?: number | null;
  timeoutMs?: number;
  staleAfterMs?: number;
  initialRefresh?: boolean;
  acknowledgedManifestDigest?: string | null;
  [sensorSpecificKey: string]: unknown;
}

export interface ExternalStateConfig {
  ui: boolean;
  agent: boolean;
}

export interface DaseinConfigOverlay {
  core?: Partial<CoreConfig>;
  sensors?: Record<SensorKey, Partial<SensorConfig>>;
  external?: Record<ExternalStateKey, Partial<ExternalStateConfig>>;
}

export interface DiskDaseinConfig extends DaseinConfigOverlay {
  version: 1;
}

export interface ConfigSources {
  defaults: DaseinConfig;
  disk: DiskDaseinConfig | null;
  launch: DaseinConfigOverlay | null;
  runtime: DaseinConfigOverlay | null;
  runtimeOverriddenPaths: string[];
}

export type ConfigValidationErrorKind =
  | "invalid-path"
  | "invalid-value"
  | "unknown-sensor"
  | "invalid-schema"
  | "persist-failed"
  | "mutation-conflict";

export interface ConfigValidationError {
  kind: ConfigValidationErrorKind;
  path: string;
  message: string;
}

export interface ConfigMutationProposal {
  assignments?: Record<string, unknown>;
  deletePaths?: string[];
}

export type ConfigMutationResult =
  | {
      ok: true;
      config: Readonly<DaseinConfig>;
      updatedPaths: string[];
      deletedPaths: string[];
      persistedPath: string;
    }
  | {
      ok: false;
      errors: ConfigValidationError[];
      config: Readonly<DaseinConfig>;
    };

export type ConfigReloadResult =
  | {
      ok: true;
      config: Readonly<DaseinConfig>;
      loadedPath: string;
      warnings: string[];
      launchReappliedPaths: string[];
      runtimeOverriddenPaths: string[];
    }
  | {
      ok: false;
      errors: ConfigValidationError[];
      config: Readonly<DaseinConfig>;
    };

export interface ConfigManager {
  getEffectiveConfig(): Readonly<DaseinConfig>;
  setRuntime(path: string, value: unknown): Promise<ConfigMutationResult>;
  applyRuntime(assignments: Record<string, unknown>): Promise<ConfigMutationResult>;
  applyRuntimeProposal(proposal: ConfigMutationProposal): Promise<ConfigMutationResult>;
  reloadDisk(): Promise<ConfigReloadResult>;
}

export type SensorValueType = "string" | "number" | "boolean" | "enum" | "object" | "array" | "null";
export type SensorStatus = "enabled" | "disabled" | "stale" | "error";

export interface SensorError {
  kind: "timeout" | "permission" | "unavailable" | "helper-unavailable" | "process" | "parse" | "config" | "unknown";
  message: string;
}

export interface SensorStateSource {
  sensor_id: SensorKey;
  source_kind: "builtin" | "local_sensor" | "external_event" | "derived";
  trace_id?: string;
  collected_by?: string;
  local_file_path?: string;
}

export interface SensorStateField<TValue = unknown> {
  contract_version: 1;
  schema_version: 1;
  sensor_id: SensorKey;
  state_key: string;
  value: TValue;
  value_type: SensorValueType;
  collected_at: number;
  stale_after_ms: number;
  status: SensorStatus;
  source: SensorStateSource;
  error?: SensorError;
}

export interface SensorRefreshCommitMetadata {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  generation: number;
  timedOut: boolean;
}

export interface SensorSnapshot {
  contract_version: 1;
  schema_version: 1;
  sensor_id: SensorKey;
  fields: Record<string, SensorStateField>;
  collected_at: number;
  stale_after_ms: number;
  status: SensorStatus;
  source: SensorStateSource;
  error?: SensorError;
  refresh?: SensorRefreshCommitMetadata;
}

export interface ExternalStateSetEvent {
  key: ExternalStateKey;
  agent?: string;
  ui?: string;
  ttlMs?: number;
  source?: string;
}

export interface ExternalStateClearEvent {
  key: ExternalStateKey;
}

export interface ExternalStateSnapshot {
  key: ExternalStateKey;
  agent: string | null;
  ui: string | null;
  source: string | null;
  updatedAt: number;
  expiresAt: number;
}

export interface RenderedContext {
  agent: string | null;
  status: string | null;
  widgetLines: string[] | null;
  omittedKeys: string[];
  truncated: boolean;
}

export interface DaseinStateStore {
  getSensorSnapshot(sensorId: SensorKey): SensorSnapshot | null;
  setSensorSnapshot(snapshot: SensorSnapshot): void;
  clearSensorSnapshot(sensorId: SensorKey): void;
  listSensorSnapshots(): SensorSnapshot[];
  getExternalState(key: ExternalStateKey): ExternalStateSnapshot | null;
  setExternalState(snapshot: ExternalStateSnapshot): void;
  clearExternalState(key: ExternalStateKey): void;
  listExternalStates(): ExternalStateSnapshot[];
  getRenderedContext(): RenderedContext;
  setRenderedContext(value: RenderedContext): void;
  getRenderedAgentString(): string | null;
  setRenderedAgentString(value: string | null): void;
  getRenderedStatusString(): string | null;
  setRenderedStatusString(value: string | null): void;
  getRenderedWidgetLines(): string[] | null;
  setRenderedWidgetLines(value: string[] | null): void;
}

export interface SensorManifest {
  description: string;
  declaredInputClasses: readonly SensorInputClass[];
  outputFields: readonly SensorOutputFieldSpec[];
  permissions: readonly SensorPermissionSpec[];
  remote: SensorRemoteBehavior;
  backgroundWork: SensorBackgroundWorkDeclaration;
}

export type SensorInputClass =
  | "time"
  | "pi_lifecycle"
  | "native_location"
  | "filesystem"
  | "subprocess"
  | "network"
  | "external_event"
  | "derived";

export interface SensorOutputFieldSpec {
  state_key: string;
  value_type: SensorValueType;
  description: string;
  agentVisibleByDefault: boolean;
  uiVisibleByDefault: boolean;
}

export interface SensorPermissionSpec {
  kind: "none" | "macos_location" | "filesystem" | "subprocess" | "network" | "other";
  required: boolean;
  reason: string;
}

export type SensorRemoteCadence = "none" | "manual" | "startup" | "interval" | "event";

export interface SensorRemoteBehavior {
  capable: boolean;
  contactsNetworkByDefault: boolean;
  destinations: readonly string[];
  payloadClasses: readonly string[];
  transmissionCadence: SensorRemoteCadence;
  disableControl: "none" | "sensor.enabled" | "sensor-specific";
  description: string;
}

export type SensorBackgroundWorkKind = "initial_refresh" | "recurring_interval" | "pi_lifecycle_observe";
export type SensorIntervalRelationship = "none" | "default_interval_sets_effective_interval_unless_overridden";

export interface SensorBackgroundWorkDeclaration {
  capable: boolean;
  kinds: readonly SensorBackgroundWorkKind[];
  defaultIntervalMs: number | null;
  intervalRelationship: SensorIntervalRelationship;
  description: string;
}

export interface SensorFieldSpec {
  label: string;
  type: "boolean" | "string" | "number" | "enum" | "array" | "object";
  values?: readonly string[];
  item?: SensorFieldSpec;
  fields?: Record<string, SensorFieldSpec>;
  additionalProperties?: boolean;
  actionManaged?: boolean;
  description?: string;
}

export type SensorConfigValidator<TConfig extends SensorConfig = SensorConfig> = (
  config: Readonly<TConfig>,
) => readonly ConfigValidationError[];

export interface SensorContext<TConfig extends SensorConfig = SensorConfig> {
  config: Readonly<TConfig>;
  signal: AbortSignal;
  now(): number;
}

export interface SensorNormalizeContext {
  sensorKey: SensorKey;
  collectedAt: number;
  staleAfterMs: number;
  status: "enabled" | "error";
  source: SensorStateSource;
  error?: SensorError;
  outputFields: readonly SensorOutputFieldSpec[];
}

export type SensorStateNormalizer<TState = unknown> = (
  value: TState,
  context: SensorNormalizeContext,
) => Record<string, SensorStateField>;

export interface SensorRefreshMetadata {
  collectedAt?: number;
  staleAfterMs?: number;
  status?: "enabled" | "error";
  error?: SensorError;
  source?: SensorStateSource;
}

export interface SensorRefreshResult<TState = unknown> {
  value?: TState;
  fields?: Record<string, SensorStateField>;
  metadata?: SensorRefreshMetadata;
}

export type SensorRefreshReturn<TState = unknown> = TState | SensorRefreshResult<TState>;

export type SensorRefresh<TState, TConfig extends SensorConfig> = (
  context: SensorContext<TConfig>,
  previous: SensorSnapshot | null,
) => Promise<SensorRefreshReturn<TState>> | SensorRefreshReturn<TState>;

export interface SensorViewFragment {
  sensor_id: SensorKey;
  state_key: string;
  value: unknown;
  value_type: SensorValueType;
  label?: string;
  status?: SensorStatus;
  source?: SensorStateSource;
}

export type SensorRender<TConfig extends SensorConfig> = (
  snapshot: SensorSnapshot,
  config: Readonly<TConfig>,
) => SensorViewFragment | readonly SensorViewFragment[] | null;

export type SensorObservationEvent =
  | { kind: "input"; observedAt: number; turnId: string }
  | { kind: "before_agent_start"; observedAt: number; turnId: string }
  | { kind: "agent_end"; observedAt: number; turnId: string };

export type SensorObserve<TState, TConfig extends SensorConfig> = (
  event: SensorObservationEvent,
  context: SensorContext<TConfig>,
  previous: SensorSnapshot | null,
) => Promise<SensorRefreshReturn<TState> | null> | SensorRefreshReturn<TState> | null;

export type SensorAction<TConfig extends SensorConfig> = (
  args: string[],
  context: SensorActionContext<TConfig>,
) => Promise<SensorActionResult> | SensorActionResult;

export type SensorActionResult =
  | {
      ok: true;
      message?: string;
      refreshScheduled?: boolean;
      mutation?: ConfigMutationProposal;
      data?: unknown;
    }
  | {
      ok: false;
      message: string;
    };

export interface SensorActionRefreshOptions {
  bypassBackoff?: boolean;
  reason: string;
}

export type SensorActionRefreshResult =
  | { ok: true; snapshot: SensorSnapshot; fresh: true }
  | { ok: false; snapshot: SensorSnapshot | null; error: SensorError };

export interface SensorActionContext<TConfig extends SensorConfig> {
  sensorKey: SensorKey;
  config: Readonly<TConfig>;
  snapshot: SensorSnapshot | null;
  refreshNow(options: SensorActionRefreshOptions): Promise<SensorActionRefreshResult>;
  scheduleRefresh(reason: string): void;
}

export type SensorCleanup = () => Promise<void> | void;

export interface SensorSpec<TState = unknown, TConfig extends SensorConfig = SensorConfig> {
  key: SensorKey;
  defaults: TConfig;
  manifest: SensorManifest;
  fields?: Record<string, SensorFieldSpec>;
  normalizeState?: SensorStateNormalizer<TState>;
  validateConfig?: SensorConfigValidator<TConfig>;
  refresh?: SensorRefresh<TState, TConfig>;
  observe?: SensorObserve<TState, TConfig>;
  renderAgent?: SensorRender<TConfig>;
  renderUI?: SensorRender<TConfig>;
  actions?: Record<string, SensorAction<TConfig>>;
  cleanup?: SensorCleanup;
}

export interface SensorRegistryEntry<TState = unknown, TConfig extends SensorConfig = SensorConfig> {
  spec: SensorSpec<TState, TConfig>;
  provenance: SensorRegistryProvenance;
}

export type SensorRegistryProvenance =
  | { kind: "builtin" }
  | { kind: "user_added_local_file"; filePath: string };

export type SensorLoadErrorKind = "scan" | "import" | "duplicate-key" | "reserved-key" | "invalid-spec" | "config" | "renderer";

export interface SensorLoadError {
  file: string;
  key?: SensorKey;
  kind: SensorLoadErrorKind;
  message: string;
}

export interface LapsePersistedState {
  previous_human_input_at: number | null;
  previous_agent_end_at: number | null;
}

export interface DaseinDurableStateFile {
  version: 1;
  lapse: LapsePersistedState;
}
