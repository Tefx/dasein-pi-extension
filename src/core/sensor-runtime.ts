/**
 * Sensor runtime boundary contracts.
 *
 * These exports describe refresh, observation, action, cleanup, normalized
 * commit, and reload metadata surfaces. They do not schedule refreshes or run
 * sensor code.
 */

import type {
  SensorAction,
  SensorActionContext,
  SensorActionRefreshOptions,
  SensorActionRefreshResult,
  SensorActionResult,
  SensorCleanup,
  SensorContext,
  SensorError,
  SensorObservationEvent,
  SensorObserve,
  SensorRefresh,
  SensorRefreshCommitMetadata,
  SensorRefreshMetadata,
  SensorRefreshResult,
  SensorRefreshReturn,
  SensorSnapshot,
  SensorStateField,
  SensorStateNormalizer,
} from "./types.ts";

export type {
  SensorAction,
  SensorActionContext,
  SensorActionRefreshOptions,
  SensorActionRefreshResult,
  SensorActionResult,
  SensorCleanup,
  SensorContext,
  SensorError,
  SensorObservationEvent,
  SensorObserve,
  SensorRefresh,
  SensorRefreshCommitMetadata,
  SensorRefreshMetadata,
  SensorRefreshResult,
  SensorRefreshReturn,
  SensorSnapshot,
  SensorStateField,
  SensorStateNormalizer,
} from "./types.ts";

export type {
  ConfigReloadFailureMetadata,
  ConfigReloadSuccessMetadata,
  DaseinReloadResult,
  SensorReloadFailureMetadata,
  SensorReloadSuccessMetadata,
} from "./lifecycle.ts";

export const SENSOR_REFRESH_CONTRACT = {
  maxActiveRefreshesPerSensor: 1,
  committedStateShape: "SensorSnapshot",
  rawCandidatePersistence: false,
  disabledStatus: "disabled",
  freshSuccessStatus: "enabled",
  errorStatus: "error",
  staleDerivation: "render-or-read-time",
} as const;

export interface SensorRuntimeContract {
  refreshInput: "SensorContext-and-previous-SensorSnapshot";
  refreshOutput: "SensorRefreshReturn";
  commitOutput: "SensorSnapshot";
  actionMutationBoundary: "ConfigMutationProposal-only-through-core-fifo-queue";
  renderHooks: "pure-SensorViewFragment-proposals-only";
}
