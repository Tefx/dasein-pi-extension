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
  buildAgentInspectCommandResult,
  buildReloadCommandResult,
  buildSensorsCommandResult,
  buildStatusCommandResult,
  classifyPiSupport,
  compactAgentInspectCommandMessage,
  executeDaseinCommand,
  makeDaseinCommandResult,
  parseLaunchAssignments,
  type AgentInspectCommandData,
  type DaseinCommandResult,
  type DaseinStatusError,
  type PiMechanismError,
  type PiMechanismEvidenceStatus,
  type StatusContributorData,
  type StatusEffectiveLapseControls,
  type StatusPermissionData,
} from "./commands/dasein-command.ts";
import { createConfigManager } from "./core/config.ts";
import { createDurableStateStore, createStateStore } from "./core/state.ts";
import { createExternalStateBridge } from "./core/external-events.ts";
import { injectAmbientSystemPrompt } from "./core/injector.ts";
import { createDaseinLifecycle, reloadDaseinRuntime, type DaseinReloadResult } from "./core/lifecycle.ts";
import { renderDaseinContext } from "./core/renderer.ts";
import { createAgentInspectOverlayComponent } from "./ui/agent-inspect-overlay.ts";
import { DASEIN_SETTINGS_OVERLAY_HINT } from "./ui/overlay-hints.ts";
import { renderDaseinOverlayFrame } from "./ui/overlay-frame.ts";
import { daseinSettingDisplayDescription, daseinSettingDisplayLabel, stripSettingsListPeerHintLines } from "./ui/settings-copy.ts";
import { formatDaseinStatusBar } from "./ui/status-format.ts";
import { cancelRuntimeTimer, scheduleRuntimeTimer, type RuntimeTimer } from "./core/runtime-timers.ts";
import { createSensorRuntime, normalizeSensorRefreshResult, type SensorRuntimeHarness } from "./core/sensor-runtime.ts";
import {
  deriveEffectiveSensorRuntimeConfig,
  loadSensorRegistry,
  type EffectiveSensorRuntimeConfig,
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
import geoSpec, { configureGeoNativeHelper, getGeoNativeHelperSupervisor } from "./sensors/geo.ts";
import lapseSpec from "./sensors/lapse.ts";
import {
  buildSettingsListVisibilityModel,
  filterDefaultSettingsListItems,
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
export { createAgentInspectOverlayComponent } from "./ui/agent-inspect-overlay.ts";
export { DASEIN_SETTINGS_OVERLAY_HINT, daseinScrollableOverlayHint } from "./ui/overlay-hints.ts";
export { renderDaseinOverlayFrame } from "./ui/overlay-frame.ts";
export { daseinSettingDisplayDescription, daseinSettingDisplayLabel, stripSettingsListPeerHintLines } from "./ui/settings-copy.ts";
export { DASEIN_STATUS_BAR_DEFAULT_MAX_WIDTH, formatDaseinStatusBar } from "./ui/status-format.ts";
export {
  formatAmbientSystemPromptBlock,
  injectAmbientSystemPrompt,
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
  deriveEffectiveSensorRuntimeConfig,
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
export { configureGeoNativeHelper, getGeoNativeHelperRuntimePolicy, getGeoNativeHelperSupervisor } from "./sensors/geo.ts";

export interface DaseinPiUiApi {
  readonly setStatus?: (slot: string, value?: string) => void;
  readonly custom?: (componentFactory: unknown, options?: Record<string, unknown>) => Promise<unknown> | unknown;
  readonly notify?: (message: string, level?: "info" | "success" | "warning" | "error") => void;
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
  | "before_agent_start"
  | "events"
  | "setStatus"
  | "custom"
  | "SettingsList";

type MutableBeforeAgentStartEvent = { systemPrompt?: unknown };
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
const BUILTIN_ENTRIES: readonly SensorRegistryEntry[] = BUILTIN_SPECS.map((spec) => ({ spec: spec as unknown as SensorSpec, provenance: { kind: "builtin" as const } }));
const BUILTIN_KEYS = new Set<string>(BUILTIN_SPECS.map((spec) => spec.key));
export const DEFAULT_CORE_RENDER_ORDER = ["clock", "lapse", "geo"] as const;
configureGeoNativeHelper({ extensionRoot: EXTENSION_ROOT, installMode: "directory" });
const FEATURE_PROBE_ORDER: readonly DaseinPiMechanism[] = [
  "registerCommand",
  "registerFlag",
  "before_agent_start",
  "events",
  "setStatus",
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
  if (mechanism === "before_agent_start") return "pi.on(\"before_agent_start\")";
  if (mechanism === "events") return "pi.events";
  if (mechanism === "setStatus") return "ctx.ui.setStatus";
  if (mechanism === "custom") return "ctx.ui.custom";
  return mechanism;
};

const LIVE_SMOKE_VERIFICATION_DATE = "2026-06-06" as const;

const evidenceStatusesFor = (mechanism: DaseinPiMechanism): PiMechanismEvidenceStatus[] =>
  mechanism === "custom" || mechanism === "SettingsList"
    ? ["API_VERIFIED", "LIVE_SMOKE_VERIFIED"]
    : ["SOURCE_VERIFIED", "LIVE_SMOKE_VERIFIED"];

const observedBehaviorFor = (mechanism: DaseinPiMechanism): string => {
  if (mechanism === "registerCommand") return "live Pi smoke ledger pi.registerCommand./dasein=PROVEN";
  if (mechanism === "registerFlag") return "live Pi smoke ledger pi.registerFlag.--dasein=PROVEN";
  if (mechanism === "before_agent_start") return "live Pi smoke ledger pi.before-agent-start.system-prompt-context=PROVEN";
  if (mechanism === "events") return "live Pi smoke ledger pi.events.set-clear-live=PROVEN";
  if (mechanism === "setStatus") return "live Pi smoke ledger tui.status-render-clear=PROVEN";
  if (mechanism === "custom") return "live Pi smoke ledger ctx.ui.custom.no-api-key-render-path=PROVEN";
  return "live Pi smoke ledger settingslist controls/metadata/persistence rows=PROVEN";
};

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
  observedBehavior: observedBehaviorFor(mechanism),
  verificationDate: LIVE_SMOKE_VERIFICATION_DATE,
}));

const defaultCoreConfig = (entries: readonly SensorRegistryEntry[]): DaseinConfig["core"] => {
  const availableKeys = new Set(entries.map((entry) => entry.spec.key));
  return {
    agentInjectionEnabled: true,
    statusEnabled: true,
    statusDetail: "quiet",
    maxAgentChars: 240,
    injectedLabel: "ambient_ctx",
    renderOrder: DEFAULT_CORE_RENDER_ORDER.filter((key) => availableKeys.has(key)),
  };
};

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

const effectiveSensorRuntimeConfigFor = (entry: SensorRegistryEntry, config: Readonly<SensorConfig>): EffectiveSensorRuntimeConfig => deriveEffectiveSensorRuntimeConfig({
  spec: entry.spec,
  provenance: entry.provenance,
  effectiveConfig: config,
});

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

const durableError = (message: string, code: "load-failed" | "write-failed" | "schema-invalid" = "load-failed"): DaseinStatusError => ({
  kind: "durable_state",
  code,
  message,
  path: STATE_PATH,
});

const sensorActionNamespaceErrors = (sensorKey: SensorKey, proposal: ConfigMutationProposal): ConfigValidationError[] => {
  const prefix = `sensors.${sensorKey}.`;
  const proposedPaths = [...Object.keys(proposal.assignments ?? {}), ...(proposal.deletePaths ?? [])];
  return proposedPaths
    .filter((path) => !path.startsWith(prefix))
    .map((path) => ({
      kind: "invalid-path" as const,
      path,
      message: `sensor action proposals for ${sensorKey} may only mutate ${prefix}*`,
    }));
};

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

const hiddenReasonForSensor = (config: Readonly<SensorConfig>): StatusContributorData["hiddenReason"] | null => {
  if (config.enabled !== true) return "disabled";
  if (config.ui !== true) return "ui-hidden";
  if (config.agent !== true) return "agent-hidden";
  return null;
};

const hiddenReasonForExternal = (
  config: Readonly<{ ui: boolean; agent: boolean }>,
  snapshot: Readonly<ExternalStateSnapshot>,
  now: number,
): StatusContributorData["hiddenReason"] | null => {
  if (now > snapshot.expiresAt) return "expired";
  if (config.ui !== true) return "ui-hidden";
  if (config.agent !== true) return "agent-hidden";
  return null;
};

const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const effectiveLapseControlsFor = (config: Readonly<DaseinConfig>): StatusEffectiveLapseControls => {
  const lapseConfig = config.sensors.lapse;
  return {
    enabled: lapseConfig?.enabled === true,
    persist: lapseConfig?.persist === true,
    agent: lapseConfig?.agent === true,
    agentFields: stringArray(lapseConfig?.agentFields).sort(),
  };
};

class DaseinAmbientContextBroker {
  private readonly stateStore: DaseinStateStore = createStateStore();
  private readonly externalBridge = createExternalStateBridge({ now: () => Date.now() });
  private readonly statusErrors: DaseinStatusError[] = [];
  private readonly sensorRuntimes = new Map<SensorKey, SensorRuntimeHarness>();
  private entries: SensorRegistryEntry[] = [];
  private configManager: ConfigManagerInstance | null = null;
  private config: DaseinConfig = buildDefaultConfig(BUILTIN_ENTRIES);
  private loadErrors: SensorLoadError[] = [];
  private attemptedFiles: string[] = [];
  private initialized: Promise<void> | null = null;
  private launchArgsApplied = false;
  private diskConfigLoaded = false;
  private durableStateFileLoaded = false;
  private durableLapse: LapsePersistedState | null = null;
  private pendingLapsePersist: LapsePersistedState | null = null;
  private lapsePersistTimer: RuntimeTimer | null = null;
  private lapsePersistInFlight: Promise<void> | null = null;

  constructor(private readonly pi: DaseinPiExtensionApi) {}

  async startup(context: DaseinPiExtensionContext): Promise<void> {
    this.probeStartupFeatures();
    await this.initialize();
    await this.loadDurableLapseState();
    await this.startInitialRefreshes();
    this.renderAndPublish(context);
  }

  async beforeAgentStart(event: unknown, context: DaseinPiExtensionContext): Promise<{ systemPrompt: string } | undefined> {
    await this.observePiLifecycle("before_agent_start", event, context);
    const mutable = event as MutableBeforeAgentStartEvent;
    const systemPrompt = typeof mutable.systemPrompt === "string" ? mutable.systemPrompt : "";
    const result = injectAmbientSystemPrompt({ stateStore: this.stateStore, systemPrompt });
    if (!result.changed) return undefined;
    mutable.systemPrompt = result.systemPrompt;
    return { systemPrompt: result.systemPrompt };
  }

  async observePiLifecycle(kind: "input" | "before_agent_start" | "agent_end", event: unknown, context: DaseinPiExtensionContext): Promise<void> {
    await this.initialize();
    const observedAt = observedAtFromEvent(event);
    const observation: SensorObservationEvent = { kind, observedAt, turnId: turnIdFromEvent(event, observedAt) };
    const runtime = this.sensorRuntimes.get("lapse");
    await runtime?.observeEvent(observation);
    this.scheduleLapsePersistenceAfterObservation();
    this.renderAndPublish(context);
  }

  setExternal(payload: unknown): void {
    const result = this.externalBridge.set(payload);
    if (!result.ok) return;
    this.stateStore.setExternalState(result.snapshot);
    this.renderOnly();
  }

  clearExternal(payload: unknown): void {
    const result = this.externalBridge.clear(payload);
    if (!result.ok) return;
    this.stateStore.clearExternalState(result.clearedKey);
    this.renderOnly();
  }

  private publishCommandResult(result: DaseinCommandResult, context: DaseinPiExtensionContext): DaseinCommandResult {
    if (result.command !== "open-ui") {
      context.ui?.notify?.(result.message, result.ok ? "info" : "error");
    }
    return result;
  }

  private async publishInspectAgentResult(result: DaseinCommandResult, context: DaseinPiExtensionContext): Promise<void> {
    if (!result.ok || !isRecord(result.data)) {
      context.ui?.notify?.(result.message, result.ok ? "info" : "error");
      return;
    }
    const data = result.data as unknown as AgentInspectCommandData;
    if (context.mode !== "tui" || typeof context.ui?.custom !== "function" || this.statusErrors.some((error) => error.kind === "pi_mechanism" && error.mechanism === "ctx.ui.custom")) {
      context.ui?.notify?.(compactAgentInspectCommandMessage(data), "info");
      return;
    }

    try {
      await context.ui.custom(
        (tui: unknown, _theme: unknown, _keybindings: unknown, done: (value: undefined) => void) => createAgentInspectOverlayComponent({
          data,
          done,
          requestRender: () => requestTuiRender(tui),
        }),
        {
          component: "DaseinAgentInspect",
          overlay: true,
          title: "Dasein agent inspect",
          overlayOptions: { width: "75%", minWidth: 68, maxHeight: "85%", anchor: "center", margin: 2 },
        },
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "custom unavailable";
      this.statusErrors.push(mechanismError("custom", `custom unavailable: ${message}`));
      context.ui?.notify?.(compactAgentInspectCommandMessage(data), "info");
    }
  }

  async command(rawArgs: unknown, context: DaseinPiExtensionContext): Promise<DaseinCommandResult> {
    await this.initialize();
    const args = typeof rawArgs === "string" ? rawArgs.trim() : "";
    if (args.length === 0) {
      if (context.mode === "tui") {
        await this.openSettingsSurface(context);
        return makeDaseinCommandResult({ command: "open-ui", message: "dasein: open settings" });
      }
      return this.publishCommandResult(makeDaseinCommandResult({ command: "help", message: "dasein: status | reload | sensors | inspect agent | set | apply" }), context);
    }
    if (args === "status") return this.publishCommandResult(this.statusResult(), context);
    if (args === "sensors") return this.publishCommandResult(this.sensorsResult(), context);
    if (args === "inspect agent") {
      const result = this.inspectAgentResult();
      await this.publishInspectAgentResult(result, context);
      return result;
    }
    if (args === "reload") return this.publishCommandResult(await this.reloadResult(), context);

    const result = await executeDaseinCommand(`/dasein ${args}`, {
      discoveredSensorKeys: this.sensorKeys(),
      sensorActions: this.sensorActions(),
      inspectAgent: this.inspectAgentOptions(),
      mutateConfig: async (command) => this.mutateFromCommand(command.assignments ?? []),
      runSensorAction: async (command) => this.runSensorAction(command.sensorKey ?? "", command.action ?? "", command.actionArgs ?? [], context),
    });
    return this.publishCommandResult(result, context);
  }

  async shutdown(context: DaseinPiExtensionContext): Promise<void> {
    await this.initialize();
    for (const entry of this.entries) {
      this.pi.recordCleanup?.(entry.spec.key, 1000);
    }
    const lifecycle = createDaseinLifecycle({
      cleanupTimeoutMs: 1000,
      runtimes: [...this.sensorRuntimes.values()],
      helpers: [getGeoNativeHelperSupervisor()],
      cleanupHandlers: this.entries.map((entry) => entry.spec.cleanup).filter((cleanup): cleanup is NonNullable<SensorSpec["cleanup"]> => cleanup !== undefined),
    });
    const result = await lifecycle.shutdown();
    for (const error of result.errors) {
      this.statusErrors.push({ kind: "unknown", message: error instanceof Error ? error.message : String(error) });
    }
    await this.flushLapsePersistenceQueue();
    await this.persistCurrentLapseSnapshotNow();
    context.ui?.setStatus?.("dasein", undefined);
  }

  private async initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce();
    await this.initialized;
  }

  private async initializeOnce(): Promise<void> {
    const registry = await loadSensorRegistry({ extensionRoot: EXTENSION_ROOT, builtinEntries: BUILTIN_ENTRIES, cacheBustToken: Date.now() });
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
      sensorSpecs: this.entries.map((entry) => entry.spec),
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
      const rawConfig = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
      const { config } = effectiveSensorRuntimeConfigFor(entry, rawConfig);
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
      const rawConfig = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
      const { config } = effectiveSensorRuntimeConfigFor(entry, rawConfig);
      this.sensorRuntimes.get(entry.spec.key)?.setConfig(config);
    }
  }

  private async startInitialRefreshes(): Promise<void> {
    const now = Date.now();
    for (const entry of this.entries) {
      const rawConfig = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
      const { config } = effectiveSensorRuntimeConfigFor(entry, rawConfig);
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

  private captureCurrentLapsePersistedState(): LapsePersistedState | null {
    const lapseConfig = this.config.sensors.lapse;
    if (lapseConfig?.persist !== true) return null;
    const snapshot = this.stateStore.getSensorSnapshot("lapse");
    const persisted: LapsePersistedState = {
      previous_human_input_at: this.numberField(snapshot, "lapse.previous_human_input_at"),
      previous_agent_end_at: this.numberField(snapshot, "lapse.previous_agent_end_at"),
    };
    this.durableLapse = persisted;
    return persisted;
  }

  private scheduleLapsePersistenceAfterObservation(): void {
    const persisted = this.captureCurrentLapsePersistedState();
    if (persisted === null) return;
    this.pendingLapsePersist = persisted;
    this.scheduleLapsePersistenceTimer();
  }

  private scheduleLapsePersistenceTimer(): void {
    if (this.lapsePersistTimer !== null || this.lapsePersistInFlight !== null) return;
    this.lapsePersistTimer = scheduleRuntimeTimer(() => {
      this.lapsePersistTimer = null;
      void this.drainLapsePersistenceQueue();
    }, 0);
  }

  private async writeLapsePersistedState(persisted: LapsePersistedState): Promise<void> {
    const durable = createDurableStateStore({ statePath: STATE_PATH, lapsePersistEnabled: true });
    try {
      const result = await durable.writeLapse(persisted);
      if (!result.ok) {
        this.statusErrors.push(durableError(result.error.message, "write-failed"));
        return;
      }
      this.durableStateFileLoaded = true;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      this.statusErrors.push(durableError(message, "write-failed"));
    }
  }

  private async drainLapsePersistenceQueue(): Promise<void> {
    if (this.lapsePersistInFlight !== null) {
      await this.lapsePersistInFlight;
      return;
    }
    const persisted = this.pendingLapsePersist;
    if (persisted === null) return;
    this.pendingLapsePersist = null;
    const write = this.writeLapsePersistedState(persisted);
    this.lapsePersistInFlight = write;
    try {
      await write;
    } finally {
      this.lapsePersistInFlight = null;
      if (this.pendingLapsePersist !== null) this.scheduleLapsePersistenceTimer();
    }
  }

  private async flushLapsePersistenceQueue(): Promise<void> {
    if (this.lapsePersistTimer !== null) {
      cancelRuntimeTimer(this.lapsePersistTimer);
      this.lapsePersistTimer = null;
    }
    while (this.pendingLapsePersist !== null || this.lapsePersistInFlight !== null) {
      if (this.lapsePersistInFlight !== null) await this.lapsePersistInFlight;
      else await this.drainLapsePersistenceQueue();
    }
  }

  private async discardQueuedLapsePersistence(): Promise<void> {
    if (this.lapsePersistTimer !== null) {
      cancelRuntimeTimer(this.lapsePersistTimer);
      this.lapsePersistTimer = null;
    }
    this.pendingLapsePersist = null;
    if (this.lapsePersistInFlight !== null) await this.lapsePersistInFlight;
  }

  private async persistCurrentLapseSnapshotNow(): Promise<void> {
    const persisted = this.captureCurrentLapsePersistedState();
    if (persisted === null) return;
    await this.writeLapsePersistedState(persisted);
  }

  private async resetLapseTimestamps(context: DaseinPiExtensionContext): Promise<SensorActionResult> {
    const entry = this.entries.find((candidate) => candidate.spec.key === "lapse");
    if (entry === undefined) return { ok: false, message: "lapse reset failed: lapse sensor unavailable" };
    await this.discardQueuedLapsePersistence();
    const emptyPersisted: LapsePersistedState = { previous_human_input_at: null, previous_agent_end_at: null };
    const emptyState = {
      userIdleMs: null,
      agentIdleMs: null,
      previousHumanInputAt: null,
      previousAgentEndAt: null,
    };
    const now = Date.now();
    const snapshot = normalizeSensorRefreshResult({
      sensorKey: "lapse",
      value: emptyState,
      outputFields: entry.spec.manifest.outputFields,
      collectedAt: now,
      staleAfterMs: effectiveStaleAfterMs(this.config.sensors.lapse ?? entry.spec.defaults),
      source: sourceFor(entry),
      normalizeState: entry.spec.normalizeState,
    });
    const runtime = this.sensorRuntimes.get("lapse");
    if (runtime === undefined) this.stateStore.setSensorSnapshot(snapshot);
    else runtime.commitSnapshot(snapshot);

    this.durableLapse = emptyPersisted;
    this.durableStateFileLoaded = true;
    const durable = createDurableStateStore({ statePath: STATE_PATH, lapsePersistEnabled: true });
    const persisted = await durable.writeLapse(emptyPersisted);
    this.renderAndPublish(context);
    if (!persisted.ok) {
      const error = durableError(persisted.error.message, "write-failed");
      this.statusErrors.push(error);
      return { ok: false, message: `lapse reset failed: ${persisted.error.message}` };
    }
    return {
      ok: true,
      message: "lapse reset: ok",
      data: { memoryCleared: true, persistedCleared: true, actionPayload: emptyPersisted },
    };
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

  private async applyProposal(proposal: ConfigMutationProposal, options: { sensorKey?: SensorKey } = {}): Promise<ConfigMutationResult> {
    if (options.sensorKey !== undefined) {
      const namespaceErrors = sensorActionNamespaceErrors(options.sensorKey, proposal);
      if (namespaceErrors.length > 0) return { ok: false, errors: namespaceErrors, config: this.config };
    }
    const manager = this.requireConfigManager();
    const result = await manager.applyRuntimeProposal(proposal);
    if (result.ok) {
      this.config = manager.getEffectiveConfig();
      this.syncRuntimeConfigs();
      this.renderOnly();
    }
    return lightweightToConfigMutation(result, manager.getEffectiveConfig());
  }

  private async runSensorAction(sensorKey: string, action: string, args: readonly string[], context: DaseinPiExtensionContext): Promise<SensorActionResult> {
    if (sensorKey === "lapse" && action === "reset") return this.resetLapseTimestamps(context);
    const entry = this.entries.find((candidate) => candidate.spec.key === sensorKey);
    const handler = entry?.spec.actions?.[action];
    if (entry === undefined || handler === undefined) return { ok: false, message: `unknown ${sensorKey} action ${action}` };
    const runtime = this.sensorRuntimes.get(sensorKey);
    const rawConfig = this.config.sensors[sensorKey] ?? entry.spec.defaults;
    const { config, metadata } = effectiveSensorRuntimeConfigFor(entry, rawConfig);
    if (!metadata.effectiveEnabled && metadata.acknowledgementRequired) {
      return { ok: false, message: `${sensorKey} sensor requires metadata acknowledgement before actions can run` };
    }
    const actionContext: SensorActionContext<SensorConfig> = {
      sensorKey,
      config,
      snapshot: this.stateStore.getSensorSnapshot(sensorKey),
      refreshNow: (options) => runtime?.refreshNow({ reason: options.reason, bypassBackoff: options.bypassBackoff }) ?? Promise.resolve({ ok: false, snapshot: null, error: { kind: "unknown", message: "sensor runtime unavailable" } }),
      scheduleRefresh: (reason) => runtime?.scheduleRefresh(reason),
    };
    const result = await handler([...args], actionContext);
    if (result.ok && result.mutation !== undefined) {
      const mutation = await this.applyProposal(result.mutation, { sensorKey });
      this.renderAndPublish(context);
      if (!mutation.ok) {
        return {
          ok: false,
          message: `${sensorKey} ${action} mutation rejected: ${mutation.errors.map((item) => `${item.path}: ${item.message}`).join("; ")}`,
        };
      }
      return { ...result, data: { mutationApplied: true, mutation, actionPayload: result.data } };
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

  private visibleStatusSummary(rendered: RenderedContext): string | undefined {
    return formatDaseinStatusBar({
      statusDetail: this.config.core.statusDetail,
      rendered,
      errorCount: this.statusErrors.length,
    });
  }

  private renderAndPublish(context: DaseinPiExtensionContext): void {
    const rendered = this.renderOnly();
    if (context.mode !== "tui") return;
    if (this.config.core.statusEnabled) context.ui?.setStatus?.("dasein", this.visibleStatusSummary(rendered));
    else context.ui?.setStatus?.("dasein", undefined);
  }

  private async openSettingsSurface(context: DaseinPiExtensionContext): Promise<void> {
    if (this.statusErrors.some((error) => error.kind === "pi_mechanism" && error.mechanism === "ctx.ui.custom")) return;
    const visibilityItems = filterDefaultSettingsListItems(this.settingsVisibilityItems());
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
              const contentWidth = Math.max(1, Math.min(96, Math.floor(width) - 6));
              return renderDaseinOverlayFrame({
                title: "Dasein settings",
                width,
                maxWidth: 100,
                lines: [
                  "Ambient context broker controls.",
                  DASEIN_SETTINGS_OVERLAY_HINT,
                  "",
                  ...stripSettingsListPeerHintLines(settingsList.render(contentWidth)),
                ],
              });
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
        {
          component: "SettingsList",
          overlay: true,
          title: "Dasein settings",
          overlayOptions: { width: "70%", minWidth: 64, maxHeight: "85%", anchor: "center", margin: 2 },
        },
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
          label: daseinSettingDisplayLabel(item),
          currentValue: settingsValueLabel(item.value),
          description: daseinSettingDisplayDescription(item),
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
        label: daseinSettingDisplayLabel(item),
        currentValue,
        ...(values === undefined ? {} : { values }),
        description: daseinSettingDisplayDescription(item),
      };
    });
  }

  private sensorMetadata(): SensorInspectabilityMetadata[] {
    return this.entries.map((entry) => effectiveSensorRuntimeConfigFor(
      entry,
      this.config.sensors[entry.spec.key] ?? entry.spec.defaults,
    ).metadata);
  }

  private hiddenContributors(sensorMetadata: readonly SensorInspectabilityMetadata[], now: number): StatusContributorData[] {
    const metadataByKey = new Map(sensorMetadata.map((item) => [item.key, item]));
    const sensorContributors = this.entries.flatMap((entry): StatusContributorData[] => {
      const rawConfig = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
      const { config } = effectiveSensorRuntimeConfigFor(entry, rawConfig);
      const hiddenReason = hiddenReasonForSensor(config);
      if (hiddenReason === null) return [];
      const metadata = metadataByKey.get(entry.spec.key);
      return [{
        key: entry.spec.key,
        kind: "sensor",
        enabled: config.enabled === true,
        uiVisible: config.ui === true,
        agentVisible: config.agent === true,
        hiddenReason,
        ...(metadata === undefined ? {} : { sensorMetadata: metadata }),
      }];
    });
    const externalContributors = this.stateStore.listExternalStates().flatMap((external): StatusContributorData[] => {
      const config = this.config.external[external.key] ?? { ui: true, agent: false };
      const hiddenReason = hiddenReasonForExternal(config, external, now);
      if (hiddenReason === null) return [];
      return [{
        key: external.key,
        kind: "external",
        enabled: now <= external.expiresAt,
        uiVisible: config.ui === true,
        agentVisible: config.agent === true,
        hiddenReason,
      }];
    });
    return [...sensorContributors, ...externalContributors].sort((left, right) => `${left.kind}:${left.key}`.localeCompare(`${right.kind}:${right.key}`));
  }

  private inspectAgentOptions(): Parameters<typeof buildAgentInspectCommandResult>[0] {
    const rendered = this.stateStore.getRenderedContext();
    return {
      rendered: { agent: rendered.agent, omittedKeys: rendered.omittedKeys, truncated: rendered.truncated },
      agentInjectionEnabled: this.config.core.agentInjectionEnabled,
      injectedLabel: this.config.core.injectedLabel,
      source: "pre-rendered-memory",
    };
  }

  private inspectAgentResult(): DaseinCommandResult {
    return buildAgentInspectCommandResult(this.inspectAgentOptions());
  }

  private statusResult(): DaseinCommandResult {
    const support = classifyPiSupport(this.pi.version ?? null);
    const now = Date.now();
    const rendered = this.stateStore.getRenderedContext();
    const sensorMetadata = this.sensorMetadata();
    const result = buildStatusCommandResult({
      piVersion: this.pi.version ?? null,
      configPath: CONFIG_PATH,
      statePath: STATE_PATH,
      activeSensors: this.entries.filter((entry) => effectiveSensorRuntimeConfigFor(entry, this.config.sensors[entry.spec.key] ?? entry.spec.defaults).config.enabled === true).map((entry) => entry.spec.key),
      disabledSensors: this.entries.filter((entry) => effectiveSensorRuntimeConfigFor(entry, this.config.sensors[entry.spec.key] ?? entry.spec.defaults).config.enabled !== true).map((entry) => entry.spec.key),
      hiddenContributors: this.hiddenContributors(sensorMetadata, now),
      effectiveLapseControls: effectiveLapseControlsFor(this.config),
      rendered: { omittedKeys: rendered.omittedKeys, truncated: rendered.truncated },
      permissions: this.entries.map((entry) => permissionForSensor(entry, this.stateStore.getSensorSnapshot(entry.spec.key), now)),
      sensorMetadata,
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
        const rawConfig = this.config.sensors[entry.spec.key] ?? entry.spec.defaults;
        const { config } = effectiveSensorRuntimeConfigFor(entry, rawConfig);
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
    const previousEntries = this.entries;
    const previousConfig = this.config;
    const previousRendered = this.stateStore.getRenderedContext();
    const registry = await loadSensorRegistry({ extensionRoot: EXTENSION_ROOT, builtinEntries: BUILTIN_ENTRIES, cacheBustToken: Date.now() });
    const candidateEntries = registry.entries.map(coerceEntryProvenance).sort((left, right) => left.spec.key.localeCompare(right.spec.key));
    const configReload = registry.ok
      ? await manager.reloadDisk({
          defaults: buildDefaultConfig(candidateEntries),
          discoveredSensorKeys: candidateEntries.map((entry) => entry.spec.key),
          sensorSpecs: candidateEntries.map((entry) => entry.spec),
        })
      : {
          ok: true as const,
          launchReappliedPaths: manager.getLaunchReappliedPaths(),
          runtimeOverriddenPaths: manager.getRuntimeOverriddenPaths(),
        };
    if (configReload.ok && registry.ok) {
      this.entries = candidateEntries;
      this.loadErrors = [];
      this.attemptedFiles = registry.attemptedFiles;
      this.config = manager.getEffectiveConfig();
      this.rebuildSensorRuntimes();
      await this.startInitialRefreshes();
      this.renderOnly();
    } else {
      this.loadErrors = registry.loadErrors;
      this.attemptedFiles = registry.attemptedFiles;
    }
    const reloadCommand = await reloadDaseinRuntime({
      previousConfig,
      previousRendered,
      diskConfig: configReload.ok ? { version: 1 } satisfies DiskDaseinConfig : { version: 0 },
      candidateSensorsOk: registry.ok,
      candidateSensorErrors: registry.loadErrors,
      attemptedFiles: registry.attemptedFiles,
      activeKeys: (configReload.ok && registry.ok ? candidateEntries : previousEntries).map((entry) => entry.spec.key),
      launchReappliedPaths: configReload.launchReappliedPaths,
      runtimeOverriddenPaths: configReload.runtimeOverriddenPaths,
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
    getArgumentCompletions: (prefix: string) => ["status", "reload", "sensors", "inspect", "set", "apply", "help"]
      .filter((item) => item.startsWith(prefix.trim()))
      .map((item) => ({ value: item, label: item })),
    handler: (args: unknown, context: DaseinPiExtensionContext) => broker.command(args, context),
  });

  pi.on("session_start", (_event, context) => broker.startup(context));
  pi.on("session_shutdown", (_event, context) => broker.shutdown(context));
  pi.on("input", (event, context) => broker.observePiLifecycle("input", event, context));
  pi.on("before_agent_start", (event, context) => broker.beforeAgentStart(event, context));
  pi.on("agent_end", (event, context) => broker.observePiLifecycle("agent_end", event, context));

  pi.events?.on?.("dasein:state:set", (payload) => broker.setExternal(payload));
  pi.events?.on?.("dasein:state:clear", (payload) => broker.clearExternal(payload));
};

export default createDaseinExtension;
