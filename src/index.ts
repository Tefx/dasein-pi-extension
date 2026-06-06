/**
 * Real Dasein extension composition entrypoint.
 *
 * This scaffold implementation registers the Pi API surfaces required by the
 * package/entrypoint contract. Sensor startup, persistence, rendering, command
 * routing, and UI interaction remain downstream product implementation work.
 */
import type { DaseinExtensionContract } from "./contracts/dasein.ts";

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
  EXTERNAL_STATE_CLEAR_EVENT_KEYS,
  EXTERNAL_STATE_DEFAULT_TTL_MS,
  EXTERNAL_STATE_EVENT_TOPICS,
  EXTERNAL_STATE_KEY_PATTERN,
  EXTERNAL_STATE_SET_EVENT_KEYS,
  EXTERNAL_STATE_TEXT_MAX_CHARS,
  EXTERNAL_STATE_TTL_MS_CONSTRAINT,
} from "./core/external-events.ts";
export {
  EXTERNAL_STATE_SNAPSHOT_KEYS,
  RENDERED_CONTEXT_KEYS,
  SENSOR_SNAPSHOT_ENVELOPE_KEYS,
  SENSOR_STATE_ENVELOPE_KEYS,
} from "./core/state.ts";
export { SENSOR_LOAD_ERROR_KINDS, SENSOR_REGISTRY_PROVENANCE_KINDS, SENSOR_SPEC_EXPORT_CONTRACT } from "./core/sensor-loader.ts";
export { SENSOR_REFRESH_CONTRACT } from "./core/sensor-runtime.ts";

export interface DaseinPiExtensionApi {
  readonly registerCommand: (name: string, options: Record<string, unknown>) => void;
  readonly registerFlag: (name: string, options: { readonly type: "string" }) => void;
  readonly on: (eventName: string, handler: (event: unknown, context: unknown) => unknown) => void;
  readonly events?: {
    readonly on?: (topic: string, handler: (payload: unknown) => unknown) => void;
  };
}

export type DaseinPiExtensionFactory = (pi: DaseinPiExtensionApi) => void | Promise<void>;

export const daseinExtensionContract: DaseinExtensionContract = {
  packageName: "dasein-pi-extension",
  installPath: "~/.pi/agent/extensions/dasein",
  rootShim: "index.ts",
  delegatedEntrypoint: "./src/index.ts",
  contractPurity: "stubs-types-docstrings-only",
};

const noOperation = (): undefined => undefined;

export const createDaseinExtension: DaseinPiExtensionFactory = (pi) => {
  pi["registerFlag"]("dasein", { type: "string" });
  pi["registerCommand"]("dasein", {
    rawArgs: true,
    completions: true,
    handler: noOperation,
  });

  pi.on("context", noOperation);
  pi.on("session_start", noOperation);
  pi.on("session_shutdown", noOperation);

  pi.events?.on?.("dasein:state:set", noOperation);
  pi.events?.on?.("dasein:state:clear", noOperation);
};

export default createDaseinExtension;
