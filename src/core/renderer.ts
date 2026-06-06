/**
 * Rendering boundary contracts.
 *
 * Renderer input is effective config, normalized store snapshots, and caller
 * time. Renderer output is a precomputed RenderedContext owned by core. Sensor
 * render hooks may propose structured fragments only; core owns ordering,
 * labels, visibility, omission, and truncation.
 */

import type {
  CoreConfig,
  DaseinConfig,
  DaseinStateStore,
  ExternalStateSnapshot,
  RenderedContext,
  SensorRender,
  SensorSnapshot,
  SensorViewFragment,
} from "./types.ts";

export type {
  RenderedContext,
  SensorRender,
  SensorViewFragment,
} from "./types.ts";

export interface RendererInput {
  config: Readonly<DaseinConfig>;
  stateStore: DaseinStateStore;
  now: number;
}

export interface RenderContributorInput {
  config: Readonly<CoreConfig>;
  sensorSnapshots: readonly SensorSnapshot[];
  externalSnapshots: readonly ExternalStateSnapshot[];
  now: number;
}

export interface RenderInvalidationContract {
  trigger: "minimum-rendered-freshness-or-expiry-deadline";
  recomputeInput: "existing-in-memory-normalized-state";
  refreshSensors: false;
  mutateConfig: false;
}

export interface RendererContract {
  input: "effective-config-current-state-store-and-now";
  output: RenderedContext;
  agentOrder: readonly ["configured-renderOrder", "remaining-sensors-lexicographic", "remaining-external-lexicographic"];
  sensorHookOutput: "SensorViewFragment-proposals";
  coreOwnedFinalText: true;
  coreOwnedTruncation: true;
}
