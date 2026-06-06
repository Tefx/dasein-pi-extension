/**
 * Sensor loader boundary contracts.
 *
 * Loader provenance is core-owned metadata. Sensor modules provide exactly one
 * default SensorSpec; admission, discovery, and import behavior are downstream
 * runtime implementation work, not part of this contract artifact.
 */

import type {
  SensorConfig,
  SensorKey,
  SensorLoadError,
  SensorLoadErrorKind,
  SensorRegistryEntry,
  SensorRegistryProvenance,
  SensorSpec,
} from "./types.ts";

export type {
  SensorConfig,
  SensorKey,
  SensorLoadError,
  SensorLoadErrorKind,
  SensorRegistryEntry,
  SensorRegistryProvenance,
  SensorSpec,
} from "./types.ts";

export const SENSOR_SPEC_EXPORT_CONTRACT = {
  moduleExport: "default",
  namedExportAlternativeAccepted: false,
  keyPattern: "[A-Za-z0-9_-]{1,64}",
  canonicalDirectory: "<extension_root>/src/sensors/*.ts",
  singleFileInstallUserAddedSensors: false,
} as const;

export const SENSOR_REGISTRY_PROVENANCE_KINDS = ["builtin", "user_added_local_file"] as const;
export const SENSOR_LOAD_ERROR_KINDS = [
  "scan",
  "import",
  "duplicate-key",
  "reserved-key",
  "invalid-spec",
  "config",
  "renderer",
] as const;

export interface SensorLoaderContract {
  candidateValidation: "all-or-keep-old";
  provenance: SensorRegistryProvenance;
  loadErrors: readonly SensorLoadError[];
  admittedSpec: SensorSpec<unknown, SensorConfig>;
}
