/**
 * Real Dasein extension composition entrypoint.
 *
 * Pi-facing registration remains in this file; config, sensor admission,
 * refresh normalization, state storage, rendering, injection, external events,
 * settings visibility, and shutdown sequencing are delegated to core modules.
 */
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DaseinExtensionContract } from "./contracts/dasein.ts";
import {
  buildReloadCommandResult,
  buildSensorsCommandResult,
  buildStatusCommandResult,
  classifyPiSupport,
  executeDaseinCommand,
  makeDaseinCommandResult,
  parseLaunchAssignments,
  type DaseinCommandResult,
  type DaseinStatusError,
  type PiMechanismError,
  type PiMechanismEvidenceStatus,
  type StatusPermissionData,
} from "./commands/dasein-command.ts";
import { createConfigManager } from "./core/config.ts";
import { createDurableStateStore, createStateStore } from "./core/state.ts";
import { createExternalStateBridge } from "./core/external-events.ts";
import { injectAmbientContextMessage } from "./core/injector.ts";
import { createDaseinLifecycle, reloadDaseinRuntime, type DaseinReloadResult } from "./core/lifecycle.ts";
import { renderDaseinContext } from "./core/renderer.ts";
import { createSensorRuntime, normalizeSensorRefreshResult, type SensorRuntimeHarness } from "./core/sensor-runtime.ts";
import {
  inspectSensorMetadata,
  loadSensorRegistry,
  type SensorInspectabilityMetadata,
} from "./core/sensor-loader.ts";
import type {
  ConfigMutationProposal,
  ConfigMutationResult,
  ConfigValidationError,
  DaseinConfig,
  DaseinStateStore,
  DiskDaseinConfig,
  ExternalStateSnapshot,
  LapsePersistedState,
  RenderedContext,
  SensorActionContext,
  SensorActionResult,
  SensorConfig,
  SensorKey,
  SensorLoadError,
  SensorObservationEvent,
  SensorRegistryEntry,
  SensorSnapshot,
  SensorSpec,
  SensorStateField,
  SensorStateSource,
  SensorValueType,
} from "./core/types.ts";
import clockSpec from "./sensors/clock.ts";
import geoSpec from "./sensors/geo.ts";
import lapseSpec from "./sensors/lapse.ts";
import {
  buildSettingsListVisibilityModel,
  getSettingsListTheme,
  SettingsList,
  type SettingsListControlItem,
  type SettingsListValue,
  type SettingsListVisibilityItem,
} from "./ui/settings-import-contract.ts";

export type {
  DaseinExtensionContract,
  DaseinPackageContract,
  DaseinEntrypointContract,
  DaseinSettingsImportContract,
  DaseinFakePiHostApiContract,
  DaseinTopLevelContracts,
} from "./contracts/dasein.ts";
export type {
  PiExtensionHostContract,
  PiExtensionContextContract,
  PiUiContract,
  PiEventBusContract,
} from "./contracts/pi-host.ts";
export type { FakePiHostContract } from "./contracts/fake-pi-host.ts";
export type * from "./core/types.ts";
export type * from "./core/config.ts";
export type * from "./core/state.ts";
export {
  applyRuntimeProposal,
  createConfigManager,
  createConfigMutationQueue,
  validateConfigAssignment,
  writeConfigAtomically,
} from "./core/config.ts";
export { createDurableStateStore, createStateStore } from "./core/state.ts";
export type * from "./core/sensor-loader.ts";
export type * from "./core/sensor-runtime.ts";
export type * from "./core/renderer.ts";
export type * from "./core/injector.ts";
export type * from "./core/external-events.ts";
export type * from "./core/lifecycle.ts";
export * from "./commands/dasein-command.ts";
export {
  CORE_INJECTED_LABEL_CONSTRAINT,
  CORE_MAX_AGENT_CHARS_CONSTRAINT,
  CORE_RESERVED_COMMAND_WORDS,
  DASEIN_CONFIG_PRECEDENCE,
  DASEIN_CONFIG_VERSION,
  DASEIN_GLOBAL_CONFIG_ROOT,
  SENSOR_AND_EXTERNAL_KEY_PATTERN,
} from "./core/config.ts";
export {
  createExternalStateBridge,
  EXTERNAL_STATE_CLEAR_EVENT_KEYS,
  EXTERNAL_STATE_DEFAULT_TTL_MS,
  EXTERNAL_STATE_EVENT_TOPICS,
  EXTERNAL_STATE_KEY_PATTERN,
  EXTERNAL_STATE_SET_EVENT_KEYS,
  EXTERNAL_STATE_TEXT_MAX_CHARS,
  EXTERNAL_STATE_TTL_MS_CONSTRAINT,
} from "./core/external-events.ts";
export {
  assertNoRequestPathRendering,
  createRenderInvalidationScheduler,
  renderDaseinContext,
} from "./core/renderer.ts";
export {
  convertAmbientContextMessageToLlm,
  injectAmbientContextMessage,
  proveInjectorNoIo,
} from "./core/injector.ts";
export {
  EXTERNAL_STATE_SNAPSHOT_KEYS,
  RENDERED_CONTEXT_KEYS,
  SENSOR_SNAPSHOT_ENVELOPE_KEYS,
  SENSOR_STATE_ENVELOPE_KEYS,
} from "./core/state.ts";
export {
  SENSOR_LOAD_ERROR_KINDS,
  SENSOR_REGISTRY_PROVENANCE_KINDS,
  SENSOR_SPEC_EXPORT_CONTRACT,
  detectDaseinInstallMode,
  inspectSensorMetadata,
  loadSensorRegistry,
} from "./core/sensor-loader.ts";
export { SENSOR_REFRESH_CONTRACT, createSensorRuntime, normalizeSensorRefreshResult, observeLapseLifecycle } from "./core/sensor-runtime.ts";
export { createDaseinLifecycle, reloadDaseinRuntime } from "./core/lifecycle.ts";
export type * from "./native/macos-location-helper.ts";
export {
  createMacOSLocationHelperSupervisor,
  getMacOSLocationHelperRuntimePolicy,
  mapMacOSLocationHelperOutput,
  runMacOSLocationHelperOnce,
} from "./native/macos-location-helper.ts";

export interface DaseinPiUiApi {
  readonly setStatus?: (slot: string, value?: string) => void;
  readonly setWidget?: (slot: string, value?: readonly string[] | string) => void;
  readonly custom?: (componentFactory: unknown, options?: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface DaseinPiExtensionContext {
  readonly mode?: "tui" | "rpc" | "json" | "print";
  readonly ui?: DaseinPiUiApi;
}

export interface DaseinPiExtensionApi {
  readonly version?: string | null;
  readonly binaryPath?: string | null;
  readonly registerCommand: (name: string, options: Record<string, unknown>) => void;
  readonly registerFlag: (name: string, options: { readonly type: "string" }) => void;
  readonly getFlag?: (name: string) => string | undefined;
  readonly probeFeature?: (mechanism: DaseinPiMechanism) => boolean;
  readonly recordCleanup?: (sensorKey: string, timeoutMs: number) => void;
  readonly on: (eventName: string, handler: (event: unknown, context: DaseinPiExtensionContext) => unknown) => void;
  readonly events?: {
    readonly on?: (topic: string, handler: (payload: unknown) => unknown) => void;
  };
}

export type DaseinPiExtensionFactory = (pi: DaseinPiExtensionApi) => void | Promise<void>;

type DaseinPiMechanism =
  | "registerCommand"
  | "registerFlag"
  | "context"
  | "events"
  | "setStatus"
  | "setWidget"
  | "custom"
  | "SettingsList";

type MutableContextEvent = { messages?: unknown[] };
type LightweightMutationResult = { ok: true; updatedPaths: string[]; deletedPaths: string[] } | { ok: false; errors: ConfigValidationError[] };

type ConfigManagerInstance = ReturnType<typeof createConfigManager>;

interface DaseinSettingItem {
  id: string;
  label: string;
  description?: string;
  currentValue: string;
  values?: string[];
}

interface SettingsListComponent {
  updateValue(id: string, newValue: string): void;
  render(width: number): string[];
  invalidate(): void;
  handleInput?(data: string): void;
}

interface SettingsListConstructor {
  new(
    items: DaseinSettingItem[],
    maxVisible: number,
    theme: unknown,
    onChange: (id: string, newValue: string) => void,
    onCancel: () => void,
    options?: { enableSearch?: boolean },
  ): SettingsListComponent;
}

export const daseinExtensionContract: DaseinExtensionContract = {
  packageName: "dasein-pi-extension",
  installPath: "~/.pi/agent/extensions/dasein",
  rootShim: "index.ts",
  delegatedEntrypoint: "./src/index.ts",
  contractPurity: "real-module-composition",
};

const SOURCE_FILE = fileURLToPath(import.meta.url);
const EXTENSION_ROOT = resolve(dirname(SOURCE_FILE), "..");
const CONFIG_PATH = join(homedir(), ".pi", "dasein", "config.json");
const STATE_PATH = join(homedir(), ".pi", "dasein", "state.json");
const BUILTIN_SPECS = [clockSpec, geoSpec, lapseSpec] as const;
const BUILTIN_KEYS = new Set<string>(BUILTIN_SPECS.map((spec) => spec.key));
const FEATURE_PROBE_ORDER: readonly DaseinPiMechanism[] = [
  "registerCommand",
  "registerFlag",
  "context",
  "events",
  "setStatus",
  "setWidget",
  "custom",
  "SettingsList",
];
const SettingsListCtor = SettingsList as unknown as SettingsListConstructor;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => structuredClone(value);

const piMechanismName = (mechanism: DaseinPiMechanism): string => {
  if (mechanism === "registerCommand") return "pi.registerCommand";
  if (mechanism === "registerFlag") return "pi.registerFlag";
  if (mechanism === "events") return "pi.events";
  if (mechanism === "setStatus") return "ctx.ui.setStatus";
  if (mechanism === "setWidget") return "ctx.ui.setWidget";
  if (mechanism === "custom") return "ctx.ui.custom";
  return mechanism;
};

const evidenceStatusesFor = (mechanism: DaseinPiMechanism): PiMechanismEvidenceStatus[] =>
  mechanism === "custom" || mechanism === "SettingsList"
    ? ["API_VERIFIED", "LIVE_SMOKE_PENDING"]
    : ["SOURCE_VERIFIED", "LIVE_SMOKE_PENDING"];

const mechanismError = (mechanism: DaseinPiMechanism, detail = "unavailable"): PiMechanismError => ({
  kind: "pi_mechanism",
  mechanism: piMechanismName(mechanism),
  evidenceStatuses: evidenceStatusesFor(mechanism),
  message: `PiMechanismError: ${piMechanismName(mechanism)} ${detail}`,
});

const mechanismEvidence = (mechanisms: readonly DaseinPiMechanism[]): Array<{
  mechanism: string;
  evidenceStatuses: PiMechanismEvidenceStatus[];
  observedBehavior: string;
  verificationDate: string | null;
}> => mechanisms.map((mechanism) => ({
  mechanism: piMechanismName(mechanism),
  evidenceStatuses: evidenceStatusesFor(mechanism),
  observedBehavior: "fake/API wiring verified; live smoke remains a release gate",
  verificationDate: null,
}));

const defaultCoreConfig = (entries: readonly SensorRegistryEntry[]): DaseinConfig["core"] => ({
  agentInjectionEnabled: true,
  statusEnabled: true,
  widgetEnabled: true,
  maxAgentChars: 240,
  injectedLabel: "ambient_ctx",
  renderOrder: entries.map((entry) => entry.spec.key),
});

const buildDefaultConfig = (entries: readonly SensorRegistryEntry[]): DaseinConfig => ({
  version: 1,
  core: defaultCoreConfig(entries),
  sensors: Object.fromEntries(entries.map((entry) => [entry.spec.key, clone(entry.spec.defaults)])),
  external: {},
});

const sourceFor = (entry: SensorRegistryEntry): SensorStateSource => ({
  sensor_id: entry.spec.key,
  source_kind: entry.provenance.kind === "builtin" ? "builtin" : "local_sensor",
  ...(entry.provenance.kind === "user_added_local_file" ? { local_file_path: entry.provenance.filePath } : {}),
});

const coerceEntryProvenance = (entry: SensorRegistryEntry): SensorRegistryEntry => {
  if (!BUILTIN_KEYS.has(entry.spec.key)) return entry;
  return { spec: entry.spec, provenance: { kind: "builtin" } };
};

const valueTypeForDisabled = (_declared: SensorValueType): SensorValueType => "null";

const disabledSnapshotFor = (entry: SensorRegistryEntry, now: number): SensorSnapshot => {
  const fields = Object.fromEntries(entry.spec.manifest.outputFields.map((outputField): [string, SensorStateField] => [
    outputField.state_key,
    {
      contract_version: 1,
      schema_version: 1,
      sensor_id: entry.spec.key,
      state_key: outputField.state_key,
      value: null,
      value_type: valueTypeForDisabled(outputField.value_type),
      collected_at: now,
      stale_after_ms: 120000,
      status: "disabled",
      source: sourceFor(entry),
    },
  ]));
  return {
    contract_version: 1,
    schema_version: 1,
    sensor_id: entry.spec.key,
    fields,
    collected_at: now,
    stale_after_ms: 120000,
    status: "disabled",
    source: sourceFor(entry),
  };
};

const effectiveStaleAfterMs = (config: Readonly<SensorConfig>): number => {
  if (typeof config.staleAfterMs === "number" && Number.isInteger(config.staleAfterMs) && config.staleAfterMs > 0) return config.staleAfterMs;
  if (typeof config.intervalMs === "number" && Number.isInteger(config.intervalMs) && config.intervalMs > 0) return config.intervalMs * 2;
  return 120000;
};

const effectiveIntervalMs = (config: Readonly<SensorConfig>): number | null =>
  typeof config.intervalMs === "number" && Number.isInteger(config.intervalMs) && config.intervalMs > 0 ? config.intervalMs : null;

const settingsValueLabel = (value: unknown): string => {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null) return "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const parseSettingsValue = (control: SettingsListControlItem, value: string): SettingsListValue => {
  if (control.valueType === "boolean") return value === "true" || value === "enabled";
  if (control.valueType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : control.value;
  }
  return value;
};

const requestTuiRender = (candidate: unknown): void => {
  if (isRecord(candidate) && typeof candidate.requestRender === "function") {
    (candidate.requestRender as () => void)();
  }
};

const observedAtFromEvent = (event: unknown): number => {
  if (isRecord(event) && typeof event.timestamp === "number") return event.timestamp;
  if (isRecord(event) && typeof event.observedAt === "number") return event.observedAt;
  return Date.now();
};

const turnIdFromEvent = (event: unknown, observedAt: number): string => {
  if (isRecord(event) && typeof event.turnId === "string" && event.turnId.length > 0) return event.turnId;
  return `turn-${observedAt}`;
};

const lightweightToConfigMutation = (
  result: LightweightMutationResult,
  config: DaseinConfig,
): ConfigMutationResult => {
  if (!result.ok) return { ok: false, errors: result.errors, config };
  return {
    ok: true,
    config,
    updatedPaths: result.updatedPaths,
    deletedPaths: result.deletedPaths,
    persistedPath: CONFIG_PATH,
  };
};

const durableError = (message: string): DaseinStatusError => ({
  kind: "durable_state",
  code: "load-failed",
  message,
  path: STATE_PATH,
});

const permissionForSensor = (entry: SensorRegistryEntry, snapshot: SensorSnapshot | null, now: number): StatusPermissionData => {
  const permissionKind = entry.spec.manifest.permissions.find((permission) => permission.required)?.kind ?? "none";
  const permission = permissionKind === "macos_location"
    ? String(snapshot?.fields["geo.permission"]?.value ?? "unknown")
    : "not_applicable";
  const freshness = snapshot === null ? "missing" : now - snapshot.collected_at > snapshot.stale_after_ms ? "stale" : "fresh";
  const health = snapshot?.status === "error" ? "error" : snapshot?.status === "disabled" ? "disabled" : freshness === "stale" ? "degraded" : "ok";
  return {
    key: entry.spec.key,
    permission: permission === "authorized" || permission === "denied" || permission === "restricted" || permission === "not_determined" ? permission : permission === "not_applicable" ? "not_applicable" : "unknown",
    freshness,
    health,
    checkedAt: snapshot?.collected_at ?? null,
    ...(snapshot?.error === undefined ? {} : { error: snapshot.error }),
  };
};

class DaseinAmbientContextBroker {
  private readonly stateStore: DaseinStateStore = createStateStore();
  private readonly externalBridge = createExternalStateBridge({ now: () => Date.now() });
  private readonly statusErrors: DaseinStatusError[] = [];
  private readonly sensorRuntimes = new Map<SensorKey, SensorRuntimeHarness>();
  private entries: SensorRegistryEntry[] = [];
  private configManager: ConfigManagerInstance | null = null;
  private config: DaseinConfig = buildDefaultConfig(BUILTIN_SPECS.map((spec) => ({ spec: spec as unknown as SensorSpec, provenance: { kind: "builtin" as const } })));
  private loadErrors: SensorLoadError[] = [];
  private attemptedFiles: string[] = [];
  private initialized: Promise<void> | null = null;
  private launchArgsApplied = false;
  private diskConfigLoaded = false;
  private durableStateFileLoaded = false;
  private durableLapse: LapsePersistedState | null = null;

  constructor(private readonly pi: DaseinPiExtensionApi) {}

  async startup(context: DaseinPiExtensionContext): Promise<void> {
    this.probeStartupFeatures();
    await this.initialize();
    await this.loadDurableLapseState();
    await this.startInitialRefreshes();
    this.renderAndPublish(context);
  }

  context(event: unknown): { messages: readonly unknown[] } | undefined {
    const mutable = event as MutableContextEvent;
    const messages = Array.isArray(mutable.messages) ? mutable.messages : [];
    const result = injectAmbientContextMessage({ stateStore: this.stateStore, messages, timestamp: Date.now() });
    if (!result.changed) return undefined;
    mutable.messages = [...result.messages];
    return { messages: result.messages };
  }

  async observePiLifecycle(kind: "input" | "before_agent_start" | "agent_end", event: unknown, context: DaseinPiExtensionContext): Promise<void> {
    await this.initialize();
    const observedAt = observedAtFromEvent(event);
    const observation: SensorObservationEvent = { kind, observedAt, turnId: turnIdFromEvent(event, observedAt) };
    const runtime = this.sensorRuntimes.get("lapse");
    await runtime?.observeEvent(observation);
    await this.persistLapseAfterObservation();
    this.renderAndPublish(context);
  }

  setExternal(payload: unknown): void {
    const result = this.externalBridge.set(payload);
    if (!result.ok) return;
    this.stateStore.setExternalState(result.snapshot);
    if (result.snapshot.agent !== null || result.snapshot.ui !== null) {
      this.config.external[result.snapshot.key] = {
        ui: result.snapshot.ui !== null,
        agent: result.snapshot.agent !== null,
      };
    }
    this.renderOnly();
  }

  clearExternal(payload: unknown): void {
    const result = this.externalBridge.clear(payload);
    if (!result.ok) return;
    this.stateStore.clearExternalState(result.clearedKey);
    this.renderOnly();
  }

  async command(rawArgs: unknown, context: DaseinPiExtensionContext): Promise<DaseinCommandResult> {
    await this.initialize();
    const args = typeof rawArgs === "string" ? rawArgs.trim() : "";
    if (args.length === 0) {
      if (context.mode === "tui") {
        await this.openSettingsSurface(context);
        return makeDaseinCommandResult({ command: "open-ui", message: "dasein: open settings" });
      }
      return makeDaseinCommandResult({ command: "help", message: "dasein: status | reload | sensors | set | apply" });
    }
    if (args === "status") return this.statusResult();
    if (args === "sensors") return this.sensorsResult();
    if (args === "reload") return this.reloadResult();

    return executeDaseinCommand(`/dasein ${args}`, {
      discoveredSensorKeys: this.sensorKeys(),
      sensorActions: this.sensorActions(),
      mutateConfig: async (command) => this.mutateFromCommand(command.assignments ?? []),
      runSensorAction: async (command) => this.runSensorAction(command.sensorKey ?? "", command.action ?? "", command.actionArgs ?? [], context),
    });
  }

  async shutdown(context: DaseinPiExtensionContext): Promise<void> {
    await this.initialize();
    for (const entry of this.entries) {
      this.pi.recordCleanup?.(entry.spec.key, 1000);
    }
    const lifecycle = createDaseinLifecycle({
      cleanupTimeoutMs: 1000,
      runtimes: [...this.sensorRuntimes.values()],
      cleanupHandlers: this.entries.map((entry) => entry.spec.cleanup).filter((cleanup): cleanup is NonNullable<SensorSpec["cleanup"]> => cleanup !== undefined),
    });
    const result = await lifecycle.shutdown();
    for (const error of result.errors) {
      this.statusErrors.push({ kind: "unknown", message: error instanceof Error ? error.message : String(error) });
    }
    await this.persistLapseAfterObservation();
    context.ui?.setStatus?.("dasein", undefined);
    context.ui?.setWidget?.("dasein", undefined);
  }

  private async initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce();
    await this.initialized;
  }

  private async initializeOnce(): Promise<void> {
    const registry = await loadSensorRegistry({ extensionRoot: EXTENSION_ROOT, cacheBustToken: Date.now() });
    this.entries = registry.entries.map(coerceEntryProvenance).sort((left, right) => left.spec.key.localeCompare(right.spec.key));
    this.loadErrors = registry.loadErrors;
    this.attemptedFiles = registry.attemptedFiles;
    const defaults = buildDefaultConfig(this.entries);
    const launch = this.pi.getFlag?.("dasein") ?? null;
    if (launch !== null && launch.trim().length > 0) {
      const parsed = parseLaunchAssignments(launch, { discoveredSensorKeys: this.entries.map((entry) => entry.spec.key) });
      this.launchArgsApplied = parsed.ok;
    }
    this.configManager = createConfigManager({
      configPath: CONFIG_PATH,
      defaults,
      launch,
      discoveredSensorKeys: this.entries.map((entry) => entry.spec.key),
    });
    this.statusErrors.push(...this.configManager.getStatusErrors());
    this.config = this.configManager.getEffectiveConfig();
    this.diskConfigLoaded = this.configManager.getStatusErrors().length === 0;
    this.rebuildSensorRuntimes();
    this.renderOnly();
  }

  private rebuildSensorRuntimes(): void {
    this.sensorRuntimes.clear();
    for (const entry of this.entries) {
      const config = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
      const runtime = createSensorRuntime({
        sensorKey: entry.spec.key,
        config,
        staleAfterMs: effectiveStaleAfterMs(config),
        source: sourceFor(entry),
        refresh: entry.spec.refresh as SensorSpec["refresh"],
        observe: entry.spec.observe as SensorSpec["observe"],
        normalizeState: entry.spec.normalizeState,
        outputFields: entry.spec.manifest.outputFields,
        now: () => Date.now(),
        onCommit: (snapshot) => this.stateStore.setSensorSnapshot(snapshot),
      });
      this.sensorRuntimes.set(entry.spec.key, runtime);
    }
  }

  private syncRuntimeConfigs(): void {
    for (const entry of this.entries) {
      const config = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
      this.sensorRuntimes.get(entry.spec.key)?.setConfig(config);
    }
  }

  private async startInitialRefreshes(): Promise<void> {
    const now = Date.now();
    for (const entry of this.entries) {
      const config = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
      const runtime = this.sensorRuntimes.get(entry.spec.key);
      if (config.enabled === true && config.initialRefresh !== false && entry.spec.refresh !== undefined) {
        await runtime?.refreshNow({ reason: "initial" });
      } else {
        runtime?.commitSnapshot(disabledSnapshotFor(entry, now));
      }
    }
    this.commitDurableLapseSnapshot(now);
  }

  private async loadDurableLapseState(): Promise<void> {
    const lapseConfig = this.config.sensors.lapse;
    const durable = createDurableStateStore({ statePath: STATE_PATH, lapsePersistEnabled: lapseConfig?.persist === true });
    const loaded = await durable.load();
    this.durableStateFileLoaded = loaded.ok && loaded.lapse !== null;
    if (loaded.ok) {
      this.durableLapse = loaded.lapse;
      return;
    }
    if (loaded.error !== undefined) this.statusErrors.push(durableError(loaded.error.message));
  }

  private commitDurableLapseSnapshot(now: number): void {
    if (this.durableLapse === null) return;
    const state = {
      userIdleMs: this.durableLapse.previous_human_input_at === null ? null : Math.max(0, now - this.durableLapse.previous_human_input_at),
      agentIdleMs: this.durableLapse.previous_agent_end_at === null ? null : Math.max(0, now - this.durableLapse.previous_agent_end_at),
      previousHumanInputAt: this.durableLapse.previous_human_input_at,
      previousAgentEndAt: this.durableLapse.previous_agent_end_at,
    };
    const entry = this.entries.find((candidate) => candidate.spec.key === "lapse");
    if (entry === undefined) return;
    const snapshot = normalizeSensorRefreshResult({
      sensorKey: "lapse",
      value: state,
      outputFields: entry.spec.manifest.outputFields,
      collectedAt: now,
      staleAfterMs: effectiveStaleAfterMs(this.config.sensors.lapse ?? entry.spec.defaults),
      source: sourceFor(entry),
      normalizeState: entry.spec.normalizeState,
    });
    this.sensorRuntimes.get("lapse")?.commitSnapshot(snapshot);
  }

  private async persistLapseAfterObservation(): Promise<void> {
    const lapseConfig = this.config.sensors.lapse;
    if (lapseConfig?.persist !== true) return;
    const snapshot = this.stateStore.getSensorSnapshot("lapse");
    const persisted: LapsePersistedState = {
      previous_human_input_at: this.numberField(snapshot, "lapse.previous_human_input_at"),
      previous_agent_end_at: this.numberField(snapshot, "lapse.previous_agent_end_at"),
    };
    const durable = createDurableStateStore({ statePath: STATE_PATH, lapsePersistEnabled: true });
    const result = await durable.writeLapse(persisted);
    if (!result.ok) this.statusErrors.push(durableError(result.error.message));
  }

  private numberField(snapshot: SensorSnapshot | null, field: string): number | null {
    const value = snapshot?.fields[field]?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private sensorKeys(): string[] {
    return this.entries.map((entry) => entry.spec.key);
  }

  private sensorActions(): Record<string, readonly string[]> {
    return Object.fromEntries(this.entries.map((entry) => [entry.spec.key, Object.keys(entry.spec.actions ?? {})]));
  }

  private async mutateFromCommand(assignments: readonly { canonicalPath: string; value: unknown }[]): Promise<ConfigMutationResult> {
    const manager = this.requireConfigManager();
    const result = await manager.applyRuntime(Object.fromEntries(assignments.map((assignment) => [assignment.canonicalPath, assignment.value])));
    this.config = manager.getEffectiveConfig();
    this.syncRuntimeConfigs();
    this.renderOnly();
    return lightweightToConfigMutation(result, this.config);
  }

  private async applyProposal(proposal: ConfigMutationProposal): Promise<ConfigMutationResult> {
    const manager = this.requireConfigManager();
    const result = await manager.applyRuntimeProposal(proposal);
    this.config = manager.getEffectiveConfig();
    this.syncRuntimeConfigs();
    this.renderOnly();
    return lightweightToConfigMutation(result, this.config);
  }

  private async runSensorAction(sensorKey: string, action: string, args: readonly string[], context: DaseinPiExtensionContext): Promise<SensorActionResult> {
    const entry = this.entries.find((candidate) => candidate.spec.key === sensorKey);
    const handler = entry?.spec.actions?.[action];
    if (entry === undefined || handler === undefined) return { ok: false, message: `unknown ${sensorKey} action ${action}` };
    const runtime = this.sensorRuntimes.get(sensorKey);
    const config = this.config.sensors[sensorKey] ?? entry.spec.defaults;
    const actionContext: SensorActionContext<SensorConfig> = {
      sensorKey,
      config,
      snapshot: this.stateStore.getSensorSnapshot(sensorKey),
      refreshNow: (options) => runtime?.refreshNow({ reason: options.reason, bypassBackoff: options.bypassBackoff }) ?? Promise.resolve({ ok: false, snapshot: null, error: { kind: "unknown", message: "sensor runtime unavailable" } }),
      scheduleRefresh: (reason) => runtime?.scheduleRefresh(reason),
    };
    const result = await handler([...args], actionContext);
    if (result.ok && result.mutation !== undefined) {
      await this.applyProposal(result.mutation);
      this.renderAndPublish(context);
      return { ...result, data: { mutationApplied: true, actionPayload: result.data } };
    }
    this.renderAndPublish(context);
    return result;
  }

  private requireConfigManager(): ConfigManagerInstance {
    if (this.configManager === null) throw new Error("Dasein config manager unavailable before initialization");
    return this.configManager;
  }

  private probeStartupFeatures(): void {
    for (const mechanism of FEATURE_PROBE_ORDER) {
      const available = this.pi.probeFeature?.(mechanism) ?? true;
      if (!available) this.statusErrors.push(mechanismError(mechanism));
    }
  }

  private renderOnly(): RenderedContext {
    const rendered = renderDaseinContext({
      config: this.config,
      stateStore: this.stateStore,
      now: Date.now(),
    });
    this.stateStore.setRenderedContext(rendered);
    return rendered;
  }

  private renderAndPublish(context: DaseinPiExtensionContext): void {
    const rendered = this.renderOnly();
    if (context.mode !== "tui") return;
    if (this.config.core.statusEnabled) context.ui?.setStatus?.("dasein", rendered.status ?? undefined);
    else context.ui?.setStatus?.("dasein", undefined);
    if (this.config.core.widgetEnabled) context.ui?.setWidget?.("dasein", rendered.widgetLines ?? []);
    else context.ui?.setWidget?.("dasein", undefined);
  }

  private async openSettingsSurface(context: DaseinPiExtensionContext): Promise<void> {
    if (this.statusErrors.some((error) => error.kind === "pi_mechanism" && error.mechanism === "ctx.ui.custom")) return;
    const visibilityItems = this.settingsVisibilityItems();
    const controlsById = new Map(
      visibilityItems
        .filter((item): item is SettingsListControlItem => item.kind === "control")
        .map((item) => [item.id, item]),
    );
    const settingItems = this.toSettingItems(visibilityItems);
    try {
      await context.ui?.custom?.(
        (tui: unknown, _theme: unknown, _keybindings: unknown, done: (value: undefined) => void) => {
          const settingsList = new SettingsListCtor(
            settingItems,
            Math.min(settingItems.length + 2, 18),
            getSettingsListTheme(),
            (id, newValue) => {
              const control = controlsById.get(id);
              if (control === undefined) return;
              void this.applySettingsControlMutation(control, newValue, context);
              settingsList.updateValue(id, newValue);
              requestTuiRender(tui);
            },
            () => done(undefined),
            { enableSearch: true },
          );
          return {
            render(width: number): string[] {
              return ["Dasein settings", "", ...settingsList.render(width)];
            },
            invalidate(): void {
              settingsList.invalidate();
            },
            handleInput(data: string): void {
              settingsList.handleInput?.(data);
              requestTuiRender(tui);
            },
          };
        },
        { component: "SettingsList", overlay: true, title: "Dasein settings" },
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "custom unavailable";
      this.statusErrors.push(mechanismError("custom", `custom unavailable: ${message}`));
    }
  }

  private async applySettingsControlMutation(control: SettingsListControlItem, rawValue: string, context: DaseinPiExtensionContext): Promise<void> {
    await this.applyProposal(control.mutationForValue(parseSettingsValue(control, rawValue)));
    this.renderAndPublish(context);
  }

  private settingsVisibilityItems(): readonly SettingsListVisibilityItem[] {
    return buildSettingsListVisibilityModel({
      config: this.config,
      sensorMetadata: this.sensorMetadata(),
      sensorSpecs: this.entries.map((entry) => entry.spec),
      externalStates: this.stateStore.listExternalStates(),
      now: () => Date.now(),
    });
  }

  private toSettingItems(items: readonly SettingsListVisibilityItem[]): DaseinSettingItem[] {
    return items.map((item) => {
      if (item.kind === "metadata") {
        return {
          id: item.id,
          label: item.label,
          currentValue: settingsValueLabel(item.value),
          description: "Read-only inspectability metadata shown before risky controls.",
        };
      }
      const currentValue = settingsValueLabel(item.value);
      const values = item.valueType === "boolean"
        ? ["false", "true"]
        : item.valueType === "enum"
          ? [...(item.options ?? [])]
          : undefined;
      return {
        id: item.id,
        label: item.label,
        currentValue,
        ...(values === undefined ? {} : { values }),
        description: `${item.path} via ${item.mutationBackend ?? "ConfigManager"}`,
      };
    });
  }

  private sensorMetadata(): SensorInspectabilityMetadata[] {
    return this.entries.map((entry) => inspectSensorMetadata({
      spec: entry.spec,
      provenance: entry.provenance,
      effectiveConfig: this.config.sensors[entry.spec.key] ?? entry.spec.defaults,
    }));
  }

  private statusResult(): DaseinCommandResult {
    const support = classifyPiSupport(this.pi.version ?? null);
    const rendered = this.stateStore.getRenderedContext();
    const result = buildStatusCommandResult({
      piVersion: this.pi.version ?? null,
      configPath: CONFIG_PATH,
      statePath: STATE_PATH,
      activeSensors: this.entries.filter((entry) => this.config.sensors[entry.spec.key]?.enabled === true).map((entry) => entry.spec.key),
      disabledSensors: this.entries.filter((entry) => this.config.sensors[entry.spec.key]?.enabled !== true).map((entry) => entry.spec.key),
      rendered: { omittedKeys: rendered.omittedKeys, truncated: rendered.truncated },
      permissions: this.entries.map((entry) => permissionForSensor(entry, this.stateStore.getSensorSnapshot(entry.spec.key), Date.now())),
      sensorMetadata: this.sensorMetadata(),
      loadErrors: this.loadErrors,
      statusErrors: this.statusErrors,
      launchArgsApplied: this.launchArgsApplied,
      diskConfigLoaded: this.diskConfigLoaded,
      durableState: {
        statePath: STATE_PATH,
        stateFileLoaded: this.durableStateFileLoaded,
        lapse: this.durableLapse,
      },
      piMechanisms: mechanismEvidence(FEATURE_PROBE_ORDER),
    });
    if (!result.ok || !isRecord(result.data)) return result;
    return {
      ...result,
      data: {
        ...result.data,
        minimumPiVersion: support.minimumPiVersion,
        piVersion: support.piVersion,
        piSupportClassification: support.classification,
        binaryPath: this.pi.binaryPath ?? null,
      },
    };
  }

  private sensorsResult(): DaseinCommandResult {
    const metadata = new Map(this.sensorMetadata().map((item) => [item.key, item]));
    return buildSensorsCommandResult({
      sensors: this.entries.map((entry) => {
        const config = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
        const snapshot = this.stateStore.getSensorSnapshot(entry.spec.key);
        const item = metadata.get(entry.spec.key);
        return {
          key: entry.spec.key,
          loaded: true,
          enabled: config.enabled === true,
          status: snapshot?.status ?? (config.enabled === true ? "enabled" : "disabled"),
          collectedAt: snapshot?.collected_at ?? null,
          stale: snapshot === null ? false : Date.now() - snapshot.collected_at > snapshot.stale_after_ms,
          actions: Object.keys(entry.spec.actions ?? {}),
          provenance: entry.provenance,
          manifest: entry.spec.manifest,
          backgroundWork: entry.spec.manifest.backgroundWork,
          effectiveIntervalMs: effectiveIntervalMs(config),
          manifestDigest: item?.manifestDigest,
          acknowledgedManifestDigest: item?.acknowledgedManifestDigest,
          acknowledgementRequired: item?.acknowledgementRequired,
          acknowledgementSatisfied: item?.acknowledgementSatisfied,
          defaultEnabled: item?.defaultEnabled,
          effectiveEnabled: item?.effectiveEnabled,
          forcedDisabledReason: item?.forcedDisabledReason,
          ...(snapshot?.error === undefined ? {} : { healthError: snapshot.error }),
        };
      }),
      loadErrors: this.loadErrors,
    });
  }

  private async reloadResult(): Promise<DaseinCommandResult> {
    const manager = this.requireConfigManager();
    const configReload = await manager.reloadDisk();
    const registry = await loadSensorRegistry({ extensionRoot: EXTENSION_ROOT, cacheBustToken: Date.now() });
    const previousEntries = this.entries;
    const previousConfig = this.config;
    if (configReload.ok && registry.ok) {
      this.entries = registry.entries.map(coerceEntryProvenance).sort((left, right) => left.spec.key.localeCompare(right.spec.key));
      this.loadErrors = registry.loadErrors;
      this.attemptedFiles = registry.attemptedFiles;
      this.config = manager.getEffectiveConfig();
      this.rebuildSensorRuntimes();
      this.renderOnly();
    }
    const reloadCommand = await reloadDaseinRuntime({
      previousConfig,
      previousRendered: this.stateStore.getRenderedContext(),
      diskConfig: configReload.ok ? { version: 1 } satisfies DiskDaseinConfig : { version: 0 },
      candidateSensorsOk: registry.ok,
      attemptedFiles: registry.attemptedFiles,
      activeKeys: (registry.ok ? registry.entries : previousEntries).map((entry) => entry.spec.key),
      runtimeOverriddenPaths: manager.getRuntimeOverriddenPaths(),
    });
    return buildReloadCommandResult({ reload: reloadCommand.data.reload as DaseinReloadResult, configPath: CONFIG_PATH });
  }
}

export const createDaseinExtension: DaseinPiExtensionFactory = (pi) => {
  const broker = new DaseinAmbientContextBroker(pi);

  pi.registerFlag("dasein", { type: "string" });
  pi.registerCommand("dasein", {
    description: "Inspect and configure Dasein ambient context",
    rawArgs: true,
    completions: true,
    getArgumentCompletions: (prefix: string) => ["status", "reload", "sensors", "set", "apply", "help"]
      .filter((item) => item.startsWith(prefix.trim()))
      .map((item) => ({ value: item, label: item })),
    handler: (args: unknown, context: DaseinPiExtensionContext) => broker.command(args, context),
  });

  pi.on("context", (event) => broker.context(event));
  pi.on("session_start", (_event, context) => broker.startup(context));
  pi.on("session_shutdown", (_event, context) => broker.shutdown(context));
  pi.on("input", (event, context) => broker.observePiLifecycle("input", event, context));
  pi.on("before_agent_start", (event, context) => broker.observePiLifecycle("before_agent_start", event, context));
  pi.on("agent_end", (event, context) => broker.observePiLifecycle("agent_end", event, context));

  pi.events?.on?.("dasein:state:set", (payload) => broker.setExternal(payload));
  pi.events?.on?.("dasein:state:clear", (payload) => broker.clearExternal(payload));
};

export default createDaseinExtension;
