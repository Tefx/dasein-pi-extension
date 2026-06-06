/**
 * Real Dasein extension composition entrypoint.
 *
 * This entrypoint wires the Pi API surfaces required by the package/runtime
 * contract while keeping live Pi support claims separate from fake-host API
 * evidence. SettingsList is wired for fake-host/API-shape verification only;
 * live TUI smoke remains the support-claim gate.
 */
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
  type PiMechanismError,
  type PiMechanismEvidenceStatus,
} from "./commands/dasein-command.ts";
import { createConfigManager } from "./core/config.ts";
import { createExternalStateBridge } from "./core/external-events.ts";
import { injectAmbientContextMessage } from "./core/injector.ts";
import { renderDaseinContext } from "./core/renderer.ts";
import { inspectSensorMetadata } from "./core/sensor-loader.ts";
import { createStateStore } from "./core/state.ts";
import type {
  DaseinConfig,
  DaseinStateStore,
  RenderedContext,
  SensorSnapshot,
  SensorSpec,
  SensorStateField,
  SensorStatus,
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

export const daseinExtensionContract: DaseinExtensionContract = {
  packageName: "dasein-pi-extension",
  installPath: "~/.pi/agent/extensions/dasein",
  rootShim: "index.ts",
  delegatedEntrypoint: "./src/index.ts",
  contractPurity: "stubs-types-docstrings-only",
};

const BUILTIN_SENSOR_KEYS = ["clock", "geo", "lapse"] as const;
const BUILTIN_SENSOR_SPECS = [clockSpec, geoSpec, lapseSpec] as const;
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

const piMechanismName = (mechanism: DaseinPiMechanism): string => {
  if (mechanism === "registerCommand") return "pi.registerCommand";
  if (mechanism === "registerFlag") return "pi.registerFlag";
  if (mechanism === "events") return "pi.events";
  if (mechanism === "setStatus") return "ctx.ui.setStatus";
  if (mechanism === "setWidget") return "ctx.ui.setWidget";
  if (mechanism === "custom") return "ctx.ui.custom";
  return mechanism;
};

const defaultDaseinConfig = (): DaseinConfig => ({
  version: 1,
  core: {
    agentInjectionEnabled: true,
    statusEnabled: true,
    widgetEnabled: true,
    maxAgentChars: 240,
    injectedLabel: "ambient_ctx",
    renderOrder: ["clock", "geo", "lapse"],
  },
  sensors: {
    clock: {
      enabled: true,
      ui: true,
      agent: true,
      intervalMs: 60000,
      timeoutMs: 2000,
      staleAfterMs: 120000,
      initialRefresh: true,
      precision: "minute",
    },
    geo: {
      enabled: false,
      ui: true,
      agent: false,
      intervalMs: 60000,
      timeoutMs: 3000,
      staleAfterMs: 1800000,
      initialRefresh: true,
      precision: "city",
      tags: {},
      exactAddress: false,
      exactCoordinates: false,
    },
    lapse: {
      enabled: true,
      ui: true,
      agent: true,
      intervalMs: 60000,
      timeoutMs: 2000,
      staleAfterMs: 120000,
      initialRefresh: true,
      persist: true,
      agentFields: ["user_idle"],
    },
  },
  external: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requestTuiRender = (candidate: unknown): void => {
  if (isRecord(candidate) && typeof candidate.requestRender === "function") {
    (candidate.requestRender as () => void)();
  }
};

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

const SettingsListCtor = SettingsList as unknown as SettingsListConstructor;

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

const nowFromEvent = (event: unknown): number => {
  if (isRecord(event) && typeof event.timestamp === "number") return event.timestamp;
  if (isRecord(event) && typeof event.observedAt === "number") return event.observedAt;
  return Date.now();
};

const field = (
  sensorKey: string,
  stateKey: string,
  value: unknown,
  valueType: SensorValueType,
  collectedAt: number,
  staleAfterMs: number,
  status: SensorStatus = "enabled",
): SensorStateField => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: sensorKey,
  state_key: stateKey,
  value,
  value_type: valueType,
  collected_at: collectedAt,
  stale_after_ms: staleAfterMs,
  status,
  source: { sensor_id: sensorKey, source_kind: "builtin" },
});

const snapshot = (
  sensorKey: string,
  fields: Record<string, SensorStateField>,
  collectedAt: number,
  staleAfterMs: number,
  status: SensorStatus = "enabled",
): SensorSnapshot => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: sensorKey,
  fields,
  collected_at: collectedAt,
  stale_after_ms: staleAfterMs,
  status,
  source: { sensor_id: sensorKey, source_kind: "builtin" },
});

const pad2 = (value: number): string => String(value).padStart(2, "0");

const localClockText = (date: Date): string => {
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
  return `${weekday}_${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

const makeClockSnapshot = (collectedAt: number): SensorSnapshot => {
  const date = new Date(collectedAt);
  return snapshot(
    "clock",
    {
      "clock.local_time": field("clock", "clock.local_time", localClockText(date), "string", collectedAt, 120000),
    },
    collectedAt,
    120000,
  );
};

const makeGeoSnapshot = (collectedAt: number): SensorSnapshot =>
  snapshot(
    "geo",
    {
      "geo.permission": field("geo", "geo.permission", "unavailable", "enum", collectedAt, 1800000, "enabled"),
    },
    collectedAt,
    1800000,
    "enabled",
  );

const makeLapseSnapshot = (
  collectedAt: number,
  previousHumanInputAt: number | null,
  previousAgentEndAt: number | null,
): SensorSnapshot => {
  const userIdleMs = previousHumanInputAt === null ? null : Math.max(0, collectedAt - previousHumanInputAt);
  const agentIdleMs = previousAgentEndAt === null ? null : Math.max(0, collectedAt - previousAgentEndAt);
  return snapshot(
    "lapse",
    {
      "lapse.user_idle": field("lapse", "lapse.user_idle", userIdleMs, userIdleMs === null ? "null" : "number", collectedAt, 120000),
      "lapse.agent_idle": field("lapse", "lapse.agent_idle", agentIdleMs, agentIdleMs === null ? "null" : "number", collectedAt, 120000),
      "lapse.previous_human_input_at": field(
        "lapse",
        "lapse.previous_human_input_at",
        previousHumanInputAt,
        previousHumanInputAt === null ? "null" : "number",
        collectedAt,
        120000,
      ),
      "lapse.previous_agent_end_at": field(
        "lapse",
        "lapse.previous_agent_end_at",
        previousAgentEndAt,
        previousAgentEndAt === null ? "null" : "number",
        collectedAt,
        120000,
      ),
    },
    collectedAt,
    120000,
  );
};

const applyAssignment = (config: DaseinConfig, canonicalPath: string, value: unknown): void => {
  const [scope, key, ...rest] = canonicalPath.split(".");
  if (scope === "core" && key !== undefined && rest.length === 0) {
    (config.core as unknown as Record<string, unknown>)[key] = value;
    return;
  }
  if (scope === "sensors" && key !== undefined && rest.length > 0) {
    config.sensors[key] ??= { enabled: true, ui: true, agent: true };
    let target: Record<string, unknown> = config.sensors[key] as Record<string, unknown>;
    for (const segment of rest.slice(0, -1)) {
      const next = target[segment];
      if (!isRecord(next)) target[segment] = {};
      target = target[segment] as Record<string, unknown>;
    }
    target[rest.at(-1) ?? ""] = value;
    return;
  }
  if (scope === "external" && key !== undefined && rest.length === 1) {
    config.external[key] ??= { ui: true, agent: false };
    (config.external[key] as unknown as Record<string, unknown>)[rest[0] ?? ""] = value;
  }
};

const mechanismEvidence = (mechanisms: readonly DaseinPiMechanism[]): Array<{
  mechanism: string;
  evidenceStatuses: PiMechanismEvidenceStatus[];
  observedBehavior: string;
  verificationDate: string | null;
}> => mechanisms.map((mechanism) => ({
  mechanism: piMechanismName(mechanism),
  evidenceStatuses: [mechanism === "custom" || mechanism === "SettingsList" ? "API_VERIFIED" : "SOURCE_VERIFIED", "LIVE_SMOKE_PENDING"],
  observedBehavior: "fake/API wiring only; live smoke remains a release gate",
  verificationDate: null,
}));

const mechanismError = (mechanism: DaseinPiMechanism, detail = "unavailable"): PiMechanismError => ({
  kind: "pi_mechanism",
  mechanism: piMechanismName(mechanism),
  evidenceStatuses: [mechanism === "custom" || mechanism === "SettingsList" ? "API_VERIFIED" : "SOURCE_VERIFIED", "LIVE_SMOKE_PENDING"],
  message: `PiMechanismError: ${piMechanismName(mechanism)} ${detail}`,
});

class DaseinRuntimeWiring {
  private readonly stateStore: DaseinStateStore = createStateStore();
  private readonly externalBridge = createExternalStateBridge({ now: () => Date.now() });
  private config: DaseinConfig = defaultDaseinConfig();
  private readonly statusErrors: PiMechanismError[] = [];
  private launchArgsApplied = false;
  private previousHumanInputAt: number | null = null;
  private previousAgentEndAt: number | null = null;

  constructor(private readonly pi: DaseinPiExtensionApi) {}

  startup(context: DaseinPiExtensionContext): void {
    this.probeStartupFeatures();
    this.applyLaunchFlag();
    const now = Date.now();
    this.stateStore.setSensorSnapshot(makeClockSnapshot(now));
    this.stateStore.setSensorSnapshot(makeGeoSnapshot(now));
    this.stateStore.setSensorSnapshot(makeLapseSnapshot(now, this.previousHumanInputAt, this.previousAgentEndAt));
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

  observeInput(event: unknown, context: DaseinPiExtensionContext): void {
    const observedAt = nowFromEvent(event);
    this.previousHumanInputAt = observedAt;
    this.stateStore.setSensorSnapshot(makeLapseSnapshot(observedAt, this.previousHumanInputAt, this.previousAgentEndAt));
    this.renderAndPublish(context);
  }

  observeAgentEnd(event: unknown, context: DaseinPiExtensionContext): void {
    const observedAt = nowFromEvent(event);
    this.previousAgentEndAt = observedAt;
    this.stateStore.setSensorSnapshot(makeLapseSnapshot(observedAt, this.previousHumanInputAt, this.previousAgentEndAt));
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

  async applySettingsControlMutation(control: SettingsListControlItem, rawValue: string, context: DaseinPiExtensionContext): Promise<void> {
    const proposal = control.mutationForValue(parseSettingsValue(control, rawValue));
    const manager = createConfigManager({
      defaults: this.config,
      diskConfig: { version: 1 },
      discoveredSensorKeys: BUILTIN_SENSOR_KEYS,
    });
    const result = await manager.applyRuntimeProposal(proposal);
    if (!result.ok) return;
    this.config = manager.getEffectiveConfig();
    this.renderAndPublish(context);
  }

  async command(rawArgs: unknown, context: DaseinPiExtensionContext): Promise<DaseinCommandResult> {
    const args = typeof rawArgs === "string" ? rawArgs.trim() : "";
    if (args.length === 0) {
      if (context.mode === "tui") {
        await this.openSettingsSurface(context);
        return makeDaseinCommandResult({ command: "open-ui", message: "dasein: open settings" });
      }
      return makeDaseinCommandResult({ command: "help", message: "dasein: status | reload | sensors | set | apply" });
    }

    if (args === "status") return this.statusResult();
    if (args === "sensors") return buildSensorsCommandResult({ sensors: BUILTIN_SENSOR_KEYS.map((key) => ({
      key,
      loaded: true,
      enabled: this.config.sensors[key]?.enabled === true,
      status: this.config.sensors[key]?.enabled === true ? "enabled" : "disabled",
      collectedAt: this.stateStore.getSensorSnapshot(key)?.collected_at ?? null,
      stale: false,
      actions: key === "geo" ? ["tag", "refresh"] : key === "lapse" ? ["reset"] : [],
      effectiveIntervalMs: typeof this.config.sensors[key]?.intervalMs === "number" ? this.config.sensors[key].intervalMs : null,
    })) });
    if (args === "reload") return buildReloadCommandResult();

    const result = await executeDaseinCommand(`/dasein ${args}`, {
      discoveredSensorKeys: BUILTIN_SENSOR_KEYS,
      sensorActions: { geo: ["tag", "refresh"], lapse: ["reset"] },
    });
    return result;
  }

  shutdown(context: DaseinPiExtensionContext): void {
    for (const sensorKey of BUILTIN_SENSOR_KEYS) {
      this.pi.recordCleanup?.(sensorKey, 1000);
    }
    context.ui?.setStatus?.("dasein", undefined);
    context.ui?.setWidget?.("dasein", undefined);
  }

  private probeStartupFeatures(): void {
    for (const mechanism of FEATURE_PROBE_ORDER) {
      const available = this.pi.probeFeature?.(mechanism) ?? true;
      if (!available) this.statusErrors.push(mechanismError(mechanism));
    }
  }

  private applyLaunchFlag(): void {
    const launch = this.pi.getFlag?.("dasein");
    if (launch === undefined || launch.trim().length === 0) return;
    const parsed = parseLaunchAssignments(launch, { discoveredSensorKeys: BUILTIN_SENSOR_KEYS });
    if (!parsed.ok) {
      this.statusErrors.push({
        kind: "pi_mechanism",
        mechanism: "--dasein",
        evidenceStatuses: ["SOURCE_VERIFIED", "LIVE_SMOKE_PENDING"],
        message: `PiMechanismError: invalid --dasein launch assignments: ${parsed.errors.map((error) => error.message).join("; ")}`,
      });
      return;
    }
    for (const assignment of parsed.assignments) {
      applyAssignment(this.config, assignment.canonicalPath, assignment.value);
    }
    this.launchArgsApplied = true;
  }

  private rendered(): RenderedContext {
    return this.stateStore.getRenderedContext();
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
    if (this.statusErrors.some((error) => error.mechanism === "ctx.ui.custom")) return;
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

  private settingsVisibilityItems(): readonly SettingsListVisibilityItem[] {
    const sensorMetadata = BUILTIN_SENSOR_SPECS.map((spec) => {
      const genericSpec = spec as unknown as SensorSpec;
      return inspectSensorMetadata({
        spec: genericSpec,
        provenance: { kind: "builtin" },
        effectiveConfig: this.config.sensors[genericSpec.key] ?? genericSpec.defaults,
      });
    });
    return buildSettingsListVisibilityModel({
      config: this.config,
      sensorMetadata,
      sensorSpecs: BUILTIN_SENSOR_SPECS.map((spec) => spec as unknown as SensorSpec),
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

  private statusResult(): DaseinCommandResult {
    const support = classifyPiSupport(this.pi.version ?? null);
    const rendered = this.rendered();
    const result = buildStatusCommandResult({
      piVersion: this.pi.version ?? null,
      activeSensors: BUILTIN_SENSOR_KEYS.filter((key) => this.config.sensors[key]?.enabled === true),
      disabledSensors: BUILTIN_SENSOR_KEYS.filter((key) => this.config.sensors[key]?.enabled !== true),
      rendered: { omittedKeys: rendered.omittedKeys, truncated: rendered.truncated },
      launchArgsApplied: this.launchArgsApplied,
      piMechanisms: mechanismEvidence(FEATURE_PROBE_ORDER),
      statusErrors: this.statusErrors,
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
}

export const createDaseinExtension: DaseinPiExtensionFactory = (pi) => {
  const runtime = new DaseinRuntimeWiring(pi);

  pi["registerFlag"]("dasein", { type: "string" });
  pi["registerCommand"]("dasein", {
    description: "Inspect and configure Dasein ambient context",
    rawArgs: true,
    completions: true,
    getArgumentCompletions: (prefix: string) => ["status", "reload", "sensors", "set", "apply", "help"]
      .filter((item) => item.startsWith(prefix.trim()))
      .map((item) => ({ value: item, label: item })),
    handler: (args: unknown, context: DaseinPiExtensionContext) => runtime.command(args, context),
  });

  pi.on("context", (event) => runtime.context(event));
  pi.on("session_start", (_event, context) => runtime.startup(context));
  pi.on("session_shutdown", (_event, context) => runtime.shutdown(context));
  pi.on("input", (event, context) => runtime.observeInput(event, context));
  pi.on("agent_end", (event, context) => runtime.observeAgentEnd(event, context));

  pi.events?.on?.("dasein:state:set", (payload) => runtime.setExternal(payload));
  pi.events?.on?.("dasein:state:clear", (payload) => runtime.clearExternal(payload));
};

export default createDaseinExtension;
