export type FakePiMode = "tui" | "rpc" | "json" | "print";

export interface FakeCommandRegistration {
  readonly name: string;
  readonly optionKeys: readonly string[];
}

export interface FakeFlagRegistration {
  readonly name: string;
  readonly type: string;
}

export interface FakeLifecycleRegistration {
  readonly eventName: string;
}

export interface FakeEventSubscription {
  readonly topic: string;
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
  on(eventName: string, handler: (event: unknown, context: FakePiContext) => unknown): void;
  readonly events: FakePiEventBus;
}

export interface FakePiHostFixture {
  readonly pi: FakePiExtensionApi;
  readonly context: FakePiContext;
  readonly ledger: FakePiHostLedger;
}

const optionKeys = (value: Record<string, unknown> | undefined): readonly string[] =>
  Object.keys(value ?? {}).sort();

export const createFakePiHost = (mode: FakePiMode = "tui"): FakePiHostFixture => {
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
      ledger.commands.push({ name, optionKeys: optionKeys(options) });
    },
    registerFlag(name, options) {
      ledger.flags.push({ name, type: options.type });
    },
    on(eventName, _handler) {
      ledger.lifecycleHandlers.push({ eventName });
    },
    events: {
      on(topic, _handler) {
        ledger.eventSubscriptions.push({ topic });
      },
      emit(topic, payload) {
        ledger.eventEmissions.push({ topic, payload });
      },
    },
  };

  return { pi, context, ledger };
};
