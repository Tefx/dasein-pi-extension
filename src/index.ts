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
