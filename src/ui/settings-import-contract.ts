/**
 * SettingsList import-resolution contract.
 *
 * Contract obligations pinned here:
 * - SettingsList resolves from @earendil-works/pi-tui.
 * - getSettingsListTheme resolves from @earendil-works/pi-coding-agent.
 * - Both packages are approved Pi peer dependencies, not bundled runtime
 *   dependencies.
 * - This file performs no SettingsList rendering, mounting, or live TUI
 *   interaction. Its visibility model output is plain data for downstream Pi UI
 *   wiring.
 */
import { SettingsList } from "@earendil-works/pi-tui";

import type {
  ConfigMutationProposal,
  DaseinConfig,
  ExternalStateSnapshot,
  SensorConfig,
  SensorFieldSpec,
  SensorKey,
  SensorSpec,
} from "../core/types.ts";
import type { SensorInspectabilityMetadata } from "../core/sensor-loader.ts";

type SettingsThemeLoader = (...args: never[]) => unknown;

const piCodingAgentPackageName = "@earendil-works/pi-coding-agent";
const piCodingAgentPeer = (await import(piCodingAgentPackageName)) as {
  readonly getSettingsListTheme?: SettingsThemeLoader;
};

if (typeof piCodingAgentPeer.getSettingsListTheme !== "function") {
  throw new Error("@earendil-works/pi-coding-agent must export getSettingsListTheme");
}

export const getSettingsListTheme: SettingsThemeLoader = piCodingAgentPeer.getSettingsListTheme;

export type SettingsListPeerImportContract = {
  readonly SettingsList: typeof SettingsList;
  readonly getSettingsListTheme: typeof getSettingsListTheme;
  readonly settingsListPackageName: "@earendil-works/pi-tui";
  readonly settingsThemePackageName: "@earendil-works/pi-coding-agent";
  readonly dependencyPlacement: "peerDependencies";
};

export { SettingsList };

export type SettingsListValueType = "boolean" | "string" | "number" | "enum";
export type SettingsListValue = boolean | string | number | null;
export type SettingsListItemKind = "metadata" | "control";

export interface SettingsListMetadataItem {
  readonly id: string;
  readonly kind: "metadata";
  readonly section: "sensor";
  readonly sensorKey: SensorKey;
  readonly label: string;
  readonly value: string | readonly string[] | number | boolean | null;
  readonly readOnly: true;
}

export interface SettingsListControlItem {
  readonly id: string;
  readonly kind: "control";
  readonly section: "core" | "sensor" | "external";
  readonly label: string;
  readonly path: string;
  readonly valueType: SettingsListValueType;
  readonly value: SettingsListValue;
  readonly options?: readonly string[];
  readonly readOnly: false;
  readonly mutationForValue: (value: SettingsListValue) => ConfigMutationProposal;
}

export type SettingsListVisibilityItem = SettingsListMetadataItem | SettingsListControlItem;

export interface BuildSettingsListVisibilityModelInput {
  readonly config: Readonly<DaseinConfig>;
  readonly sensorMetadata: readonly SensorInspectabilityMetadata[];
  readonly sensorSpecs?: readonly SensorSpec[];
  readonly externalStates?: readonly ExternalStateSnapshot[];
  readonly now?: () => number;
}

const EXTERNAL_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const SIMPLE_SENSOR_FIELD_TYPES = new Set<SettingsListValueType>(["boolean", "string", "number", "enum"]);
const CORE_TOGGLE_PATHS = ["core.agentInjectionEnabled", "core.statusEnabled", "core.widgetEnabled"] as const;
const COMMON_SENSOR_FIELDS = ["enabled", "ui", "agent", "intervalMs"] as const;

const pathValue = (source: unknown, path: string): SettingsListValue => {
  let cursor: unknown = source;
  for (const part of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return typeof cursor === "boolean" || typeof cursor === "string" || typeof cursor === "number" ? cursor : null;
};

const assignment = (path: string, value: SettingsListValue): ConfigMutationProposal => ({ assignments: { [path]: value } });

const control = (input: {
  readonly id: string;
  readonly section: SettingsListControlItem["section"];
  readonly label: string;
  readonly path: string;
  readonly valueType: SettingsListValueType;
  readonly value: SettingsListValue;
  readonly options?: readonly string[];
  readonly mutationForValue?: (value: SettingsListValue) => ConfigMutationProposal;
}): SettingsListControlItem => ({
  id: input.id,
  kind: "control",
  section: input.section,
  label: input.label,
  path: input.path,
  valueType: input.valueType,
  value: input.value,
  ...(input.options === undefined ? {} : { options: input.options }),
  readOnly: false,
  mutationForValue: input.mutationForValue ?? ((value) => assignment(input.path, value)),
});

const metadata = (
  sensorKey: SensorKey,
  id: string,
  label: string,
  value: SettingsListMetadataItem["value"],
): SettingsListMetadataItem => ({
  id: `sensor.${sensorKey}.metadata.${id}`,
  kind: "metadata",
  section: "sensor",
  sensorKey,
  label,
  value,
  readOnly: true,
});

const commonSensorControl = (
  sensorKey: SensorKey,
  sensorConfig: Readonly<SensorConfig>,
  field: (typeof COMMON_SENSOR_FIELDS)[number],
  digest: string,
  acknowledgementRequired: boolean,
): SettingsListControlItem => {
  const path = `sensors.${sensorKey}.${field}`;
  return control({
    id: path,
    section: "sensor",
    label: `${sensorKey}.${field}`,
    path,
    valueType: field === "intervalMs" ? "number" : "boolean",
    value: pathValue({ sensors: { [sensorKey]: sensorConfig } }, path),
    mutationForValue: field === "enabled" && acknowledgementRequired
      ? (value) => ({
          assignments: value === true
            ? { [path]: true, [`sensors.${sensorKey}.acknowledgedManifestDigest`]: digest }
            : { [path]: false },
        })
      : undefined,
  });
};

const specFieldControls = (
  sensorKey: SensorKey,
  sensorConfig: Readonly<SensorConfig>,
  fields: Readonly<Record<string, SensorFieldSpec>>,
): SettingsListControlItem[] => Object.entries(fields)
  .filter(([, field]) => SIMPLE_SENSOR_FIELD_TYPES.has(field.type as SettingsListValueType) && field.actionManaged !== true)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([fieldName, field]) => {
    const path = `sensors.${sensorKey}.${fieldName}`;
    return control({
      id: path,
      section: "sensor",
      label: field.label,
      path,
      valueType: field.type as SettingsListValueType,
      value: pathValue({ sensors: { [sensorKey]: sensorConfig } }, path),
      ...(field.type === "enum" && field.values !== undefined ? { options: field.values } : {}),
    });
  });

const liveExternalKeys = (
  config: Readonly<DaseinConfig>,
  states: readonly ExternalStateSnapshot[],
  now: number,
): string[] => {
  const keys = new Set<string>();
  for (const key of Object.keys(config.external)) {
    if (EXTERNAL_KEY_RE.test(key)) keys.add(key);
  }
  for (const state of states) {
    if (EXTERNAL_KEY_RE.test(state.key) && state.expiresAt > now) keys.add(state.key);
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
};

export const buildSettingsListVisibilityModel = (
  input: BuildSettingsListVisibilityModelInput,
): readonly SettingsListVisibilityItem[] => {
  const items: SettingsListVisibilityItem[] = [];
  const now = input.now?.() ?? Date.now();
  const specsByKey = new Map((input.sensorSpecs ?? []).map((spec) => [spec.key, spec]));

  for (const path of CORE_TOGGLE_PATHS) {
    items.push(control({
      id: path,
      section: "core",
      label: path,
      path,
      valueType: "boolean",
      value: pathValue(input.config, path),
    }));
  }

  for (const entry of [...input.sensorMetadata].sort((left, right) => left.key.localeCompare(right.key))) {
    const sensorConfig = input.config.sensors[entry.key] ?? {
      enabled: false,
      ui: true,
      agent: false,
      intervalMs: entry.effectiveIntervalMs,
    };
    const spec = specsByKey.get(entry.key);

    items.push(metadata(entry.key, "remote.destinations", "Remote destinations", entry.manifest.remote.destinations));
    items.push(metadata(entry.key, "remote.payloadClasses", "Payload classes", entry.manifest.remote.payloadClasses));
    items.push(metadata(entry.key, "remote.transmissionCadence", "Transmission cadence", entry.manifest.remote.transmissionCadence));
    items.push(metadata(entry.key, "remote.disableControl", "Disable control", entry.manifest.remote.disableControl));
    items.push(metadata(entry.key, "backgroundWork", "Declared background work", entry.backgroundWork.description));
    items.push(metadata(entry.key, "effectiveIntervalMs", "Effective interval", entry.effectiveIntervalMs));
    items.push(metadata(entry.key, "manifestDigest", "Manifest digest", entry.manifestDigest));

    for (const field of COMMON_SENSOR_FIELDS) {
      items.push(commonSensorControl(entry.key, sensorConfig, field, entry.manifestDigest, entry.acknowledgementRequired));
    }
    if (spec?.fields !== undefined) items.push(...specFieldControls(entry.key, sensorConfig, spec.fields));
  }

  for (const key of liveExternalKeys(input.config, input.externalStates ?? [], now)) {
    const visibility = input.config.external[key] ?? { ui: true, agent: false };
    for (const field of ["ui", "agent"] as const) {
      const path = `external.${key}.${field}`;
      items.push(control({
        id: path,
        section: "external",
        label: path,
        path,
        valueType: "boolean",
        value: visibility[field],
      }));
    }
  }

  return items;
};
