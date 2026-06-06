/**
 * Fake Pi host acceptance contract.
 *
 * The fake host may prove registration/call API shape in CI, but it must not be
 * cited as live Pi TUI support for status, widget, SettingsList, or dynamic
 * sensor reload behavior.
 */
import type {
  PiCommandRegistrationContract,
  PiEventBusContract,
  PiFlagRegistrationContract,
  PiLifecycleEventContract,
  PiModeContract,
} from "./pi-host.ts";

export interface FakePiHostCallLedgerContract {
  readonly commands: readonly PiCommandRegistrationContract[];
  readonly flags: readonly PiFlagRegistrationContract[];
  readonly lifecycleHandlers: readonly PiLifecycleEventContract[];
  readonly eventBus: PiEventBusContract;
  readonly uiStatusCalls: readonly string[];
  readonly uiWidgetCalls: readonly string[];
  readonly uiCustomCalls: readonly string[];
}

export interface FakePiHostContract {
  readonly mode: PiModeContract;
  readonly ledger: FakePiHostCallLedgerContract;
  readonly liveSupportClaim: false;
  readonly evidenceBoundary: "fake-host-api-shape-only";
}
