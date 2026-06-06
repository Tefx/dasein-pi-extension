/**
 * Real Dasein extension composition entrypoint contract.
 *
 * This file intentionally contains acceptance-only scaffold metadata and type
 * exports. Runtime registration, sensor startup, persistence, rendering, and
 * Pi UI behavior belong to downstream implementation steps.
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

export const daseinExtensionContract: DaseinExtensionContract = {
  packageName: "dasein-pi-extension",
  installPath: "~/.pi/agent/extensions/dasein",
  rootShim: "index.ts",
  delegatedEntrypoint: "./src/index.ts",
  contractPurity: "stubs-types-docstrings-only",
};

export default daseinExtensionContract;
