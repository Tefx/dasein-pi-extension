export type FakePiMode = "tui" | "rpc" | "json" | "print";

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

export interface FakePiHostLedger {
  readonly commands: FakeCommandRegistration[];
  readonly flags: FakeFlagRegistration[];
  readonly lifecycleHandlers: FakeLifecycleRegistration[];
  readonly eventSubscriptions: FakeEventSubscription[];
  readonly eventEmissions: FakeEventEmission[];
  readonly uiStatusCalls: FakeStatusCall[];
  readonly uiWidgetCalls: FakeWidgetCall[];
  readonly uiCustomCalls: FakeCustomCall[];
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
  registerCommand(name: string, options: Record<string, unknown>): void;
  registerFlag(name: string, options: { readonly type: string }): void;
  getFlag(name: string): string | undefined;
  on(eventName: string, handler: FakeLifecycleHandler): void;
  readonly events: FakePiEventBus;
}

export interface FakePiHostFixture {
  readonly pi: FakePiExtensionApi;
  readonly context: FakePiContext;
  readonly ledger: FakePiHostLedger;
}

const optionKeys = (value: Record<string, unknown> | undefined): readonly string[] =>
  Object.keys(value ?? {}).sort();

const commandHandler = (value: unknown): FakeCommandHandler | null =>
  typeof value === "function" ? value as FakeCommandHandler : null;

export const createFakePiHost = (
  mode: FakePiMode = "tui",
  flags: Readonly<Record<string, string | undefined>> = {},
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
  };

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
        ledger.uiCustomCalls.push({ optionKeys: optionKeys(options) });
        return undefined;
      },
    },
  };

  const pi: FakePiExtensionApi = {
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

  return { pi, context, ledger };
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
