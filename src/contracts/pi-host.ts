/**
 * Minimal Pi host API shape required by Dasein contract tests.
 *
 * This is not a live Pi support claim. It is the fake-host/API-shape contract
 * used by ordinary CI when a live Pi TUI process is unavailable.
 */

export type PiModeContract = "tui" | "rpc" | "json" | "print";

export interface PiCommandRegistrationContract {
  readonly name: string;
  readonly rawArgsSupported: boolean;
  readonly completionsSupported: boolean;
}

export interface PiFlagRegistrationContract {
  readonly name: "dasein";
  readonly type: "string";
}

export type PiLifecycleEventContract =
  | "session_start"
  | "session_shutdown"
  | "context"
  | "input"
  | "before_agent_start"
  | "agent_end";

export interface PiEventBusContract {
  readonly supportedTopics: readonly ["dasein:state:set", "dasein:state:clear"];
  readonly recordsEmittedEvents: true;
  readonly recordsSubscribedHandlers: true;
}

export interface PiUiContract {
  readonly setStatus: "record-call";
  readonly setWidget: "record-call";
  readonly custom: "record-call";
}

export interface PiExtensionContextContract {
  readonly mode: PiModeContract;
  readonly ui: PiUiContract;
}

export interface PiExtensionHostContract {
  readonly registerCommand: "record-registration";
  readonly registerFlag: "record-registration";
  readonly on: "record-lifecycle-handler";
  readonly events: PiEventBusContract;
  readonly context: PiExtensionContextContract;
}
