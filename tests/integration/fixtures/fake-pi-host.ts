export type FakePiMode = "tui" | "rpc" | "json" | "print";

export type FakePiMechanism =
  | "registerCommand"
  | "registerFlag"
  | "context"
  | "customMessageConversion"
  | "events"
  | "setStatus"
  | "setWidget"
  | "custom"
  | "SettingsList"
  | "session_start"
  | "session_shutdown"
  | "input"
  | "agent_end";

export type FakeEvidenceStatus =
  | "SOURCE_VERIFIED"
  | "API_VERIFIED"
  | "LIVE_SMOKE_PENDING"
  | "LIVE_SMOKE_VERIFIED";

export type FakePiSupportClassification =
  | "unavailable"
  | "below-minimum"
  | "supported-version-feature-probes-still-required";

export interface FakePiMechanismEvidence {
  readonly mechanism: FakePiMechanism;
  readonly evidenceStatuses: readonly FakeEvidenceStatus[];
  readonly liveSupportClaim: false;
}

export interface FakeFeatureProbeRecord {
  readonly mechanism: FakePiMechanism;
  readonly available: boolean;
}

export type FakeCommandHandler = (rawArgs: string, context: FakePiContext) => unknown | Promise<unknown>;

export interface FakeCommandRegistration {
  readonly name: string;
  readonly optionKeys: readonly string[];
  readonly rawArgsSupported: boolean;
  readonly completionsSupported: boolean;
  readonly handler: FakeCommandHandler | null;
}

export interface FakeFlagRegistration {
  readonly name: string;
  readonly type: string;
}

export type FakeLifecycleHandler = (event: unknown, context: FakePiContext) => unknown | Promise<unknown>;

export interface FakeLifecycleRegistration {
  readonly eventName: string;
  readonly handler: FakeLifecycleHandler;
}

export type FakeEventHandler = (payload: unknown) => unknown | Promise<unknown>;

export interface FakeEventSubscription {
  readonly topic: string;
  readonly handler: FakeEventHandler;
}

export interface FakeEventEmission {
  readonly topic: string;
  readonly payload: unknown;
}

export interface FakeStatusCall {
  readonly slot: string;
  readonly value: string | undefined;
}

export interface FakeWidgetCall {
  readonly slot: string;
  readonly value: readonly string[] | string | undefined;
}

export interface FakeCustomCall {
  readonly optionKeys: readonly string[];
}

export interface FakeConfigMutationRecord {
  readonly source: "slash" | "settings";
  readonly paths: readonly string[];
}

export interface FakeCleanupRecord {
  readonly sensorKey: string;
  readonly timeoutMs: number;
}

export interface FakePiHostLedger {
  readonly commands: FakeCommandRegistration[];
  readonly flags: FakeFlagRegistration[];
  readonly lifecycleHandlers: FakeLifecycleRegistration[];
  readonly eventSubscriptions: FakeEventSubscription[];
  readonly eventEmissions: FakeEventEmission[];
  readonly uiStatusCalls: FakeStatusCall[];
  readonly uiWidgetCalls: FakeWidgetCall[];
  readonly uiCustomCalls: FakeCustomCall[];
  readonly featureProbes: FakeFeatureProbeRecord[];
  readonly configMutations: FakeConfigMutationRecord[];
  readonly cleanupCalls: FakeCleanupRecord[];
}

export interface FakePiUiApi {
  setStatus(slot: string, value?: string): void;
  setWidget(slot: string, value?: readonly string[] | string): void;
  custom(componentFactory: unknown, options?: Record<string, unknown>): Promise<unknown>;
}

export interface FakePiContext {
  readonly mode: FakePiMode;
  readonly ui: FakePiUiApi;
}

export interface FakePiEventBus {
  on(topic: string, handler: (payload: unknown) => unknown): void;
  emit(topic: string, payload: unknown): void;
}

export interface FakePiExtensionApi {
  readonly version: string | null;
  readonly binaryPath: string | null;
  registerCommand(name: string, options: Record<string, unknown>): void;
  registerFlag(name: string, options: { readonly type: string }): void;
  getFlag(name: string): string | undefined;
  probeFeature(mechanism: FakePiMechanism): boolean;
  on(eventName: string, handler: FakeLifecycleHandler): void;
  readonly events: FakePiEventBus;
}

export interface FakePiHostFixture {
  readonly pi: FakePiExtensionApi;
  readonly context: FakePiContext;
  readonly ledger: FakePiHostLedger;
  readonly minimumPiVersion: "0.78.1";
  readonly evidence: readonly FakePiMechanismEvidence[];
}

export interface FakePiHostOptions {
  readonly piVersion?: string | null;
  readonly binaryPath?: string | null;
  readonly unavailableMechanisms?: readonly FakePiMechanism[];
  readonly customAvailable?: boolean;
}

const optionKeys = (value: Record<string, unknown> | undefined): readonly string[] =>
  Object.keys(value ?? {}).sort();

const commandHandler = (value: unknown): FakeCommandHandler | null =>
  typeof value === "function" ? value as FakeCommandHandler : null;

const versionParts = (version: string): readonly number[] =>
  version.split(".").map((part) => Number.parseInt(part, 10));

export const classifyFakePiSupport = (version: string | null): FakePiSupportClassification => {
  if (version === null) return "unavailable";
  const [major = 0, minor = 0, patch = 0] = versionParts(version);
  if (major < 0 || (major === 0 && minor < 78) || (major === 0 && minor === 78 && patch < 1)) {
    return "below-minimum";
  }
  return "supported-version-feature-probes-still-required";
};

const fakeMechanismEvidence = (): readonly FakePiMechanismEvidence[] => [
  { mechanism: "registerCommand", evidenceStatuses: ["SOURCE_VERIFIED", "LIVE_SMOKE_PENDING"], liveSupportClaim: false },
  { mechanism: "registerFlag", evidenceStatuses: ["SOURCE_VERIFIED", "LIVE_SMOKE_PENDING"], liveSupportClaim: false },
  { mechanism: "custom", evidenceStatuses: ["API_VERIFIED", "LIVE_SMOKE_PENDING"], liveSupportClaim: false },
  { mechanism: "SettingsList", evidenceStatuses: ["API_VERIFIED", "LIVE_SMOKE_PENDING"], liveSupportClaim: false },
];

export const createFakePiHost = (
  mode: FakePiMode = "tui",
  flags: Readonly<Record<string, string | undefined>> = {},
  options: FakePiHostOptions = {},
): FakePiHostFixture => {
  const ledger: FakePiHostLedger = {
    commands: [],
    flags: [],
    lifecycleHandlers: [],
    eventSubscriptions: [],
    eventEmissions: [],
    uiStatusCalls: [],
    uiWidgetCalls: [],
    uiCustomCalls: [],
    featureProbes: [],
    configMutations: [],
    cleanupCalls: [],
  };
  const unavailableMechanisms = new Set(options.unavailableMechanisms ?? []);
  const customAvailable = options.customAvailable ?? !unavailableMechanisms.has("custom");

  const context: FakePiContext = {
    mode,
    ui: {
      setStatus(slot, value) {
        ledger.uiStatusCalls.push({ slot, value });
      },
      setWidget(slot, value) {
        ledger.uiWidgetCalls.push({ slot, value });
      },
      async custom(_componentFactory, options) {
        if (!customAvailable) {
          throw new Error("fake Pi ctx.ui.custom unavailable");
        }
        ledger.uiCustomCalls.push({ optionKeys: optionKeys(options) });
        return undefined;
      },
    },
  };

  const pi: FakePiExtensionApi = {
    version: options.piVersion ?? "0.78.1",
    binaryPath: options.binaryPath ?? "/opt/homebrew/bin/pi",
    registerCommand(name, options) {
      ledger.commands.push({
        name,
        optionKeys: optionKeys(options),
        rawArgsSupported: options.rawArgs === true,
        completionsSupported: options.completions === true,
        handler: commandHandler(options.handler),
      });
    },
    registerFlag(name, options) {
      ledger.flags.push({ name, type: options.type });
    },
    getFlag(name) {
      return flags[name];
    },
    probeFeature(mechanism) {
      const available = !unavailableMechanisms.has(mechanism);
      ledger.featureProbes.push({ mechanism, available });
      return available;
    },
    on(eventName, handler) {
      ledger.lifecycleHandlers.push({ eventName, handler });
    },
    events: {
      on(topic, handler) {
        ledger.eventSubscriptions.push({ topic, handler });
      },
      emit(topic, payload) {
        ledger.eventEmissions.push({ topic, payload });
        for (const subscription of ledger.eventSubscriptions.filter((entry) => entry.topic === topic)) {
          void subscription.handler(payload);
        }
      },
    },
  };

  return {
    pi,
    context,
    ledger,
    minimumPiVersion: "0.78.1",
    evidence: fakeMechanismEvidence(),
  };
};

export const convertFakeCustomMessageToLlmUserMessage = (message: unknown): { readonly role: "user"; readonly content: string } => {
  if (typeof message !== "object" || message === null || Array.isArray(message)) {
    throw new TypeError("CustomMessage must be an object");
  }
  const record = message as Record<string, unknown>;
  if (record.role !== "custom" || record.customType !== "dasein" || record.display !== false) {
    throw new TypeError("CustomMessage must be hidden dasein custom content");
  }
  if (typeof record.content !== "string" || typeof record.timestamp !== "number") {
    throw new TypeError("CustomMessage must include string content and numeric timestamp");
  }
  return { role: "user", content: record.content };
};

export const invokeFakeCommand = async (
  host: FakePiHostFixture,
  name: string,
  rawArgs = "",
): Promise<unknown> => {
  const command = host.ledger.commands.find((entry) => entry.name === name);
  if (command?.handler === null || command?.handler === undefined) {
    throw new Error(`fake Pi command not registered with an invokable handler: ${name}`);
  }
  return command.handler(rawArgs, host.context);
};

export const invokeFakeLifecycle = async (
  host: FakePiHostFixture,
  eventName: string,
  event: unknown = {},
): Promise<readonly unknown[]> => {
  const handlers = host.ledger.lifecycleHandlers.filter((entry) => entry.eventName === eventName);
  const results: unknown[] = [];
  for (const entry of handlers) {
    results.push(await entry.handler(event, host.context));
  }
  return results;
};
