import type { SettingsListControlItem, SettingsListVisibilityItem } from "./settings-import-contract.ts";

const ANSI_RE = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const SETTINGS_LIST_PEER_HINTS = new Set([
  "Type to search · Enter/Space to change · Esc to cancel",
  "Enter/Space to change · Esc to cancel",
]);

const stripAnsi = (value: string): string => value.replace(ANSI_RE, "");

const sensorTitle = (sensorKey: string): string => {
  if (sensorKey === "geo") return "Location";
  if (sensorKey === "clock") return "Clock";
  if (sensorKey === "lapse") return "Lapse";
  return sensorKey;
};

const explicitLabels: Readonly<Record<string, string>> = {
  "core.agentInjectionEnabled": "Agent context",
  "core.statusEnabled": "Status bar",
  "core.statusDetail": "Status detail",
  "sensors.clock.enabled": "Clock sensor",
  "sensors.geo.enabled": "Location sensor",
  "sensors.geo.agent": "Location to agent",
  "sensors.geo.precision": "Location precision",
  "sensors.geo.exactCoordinates": "Exact coordinates to agent",
  "sensors.geo.exactAddress": "Exact address to agent",
  "sensors.lapse.enabled": "Lapse sensor",
};

const explicitDescriptions: Readonly<Record<string, string>> = {
  "core.agentInjectionEnabled": "Adds enabled ambient context to the agent system prompt.",
  "core.statusEnabled": "Shows bounded Dasein status in the footer.",
  "core.statusDetail": "Status verbosity: quiet, summary, or diagnostic.",
  "sensors.clock.enabled": "Collect local time context.",
  "sensors.geo.enabled": "Run the local macOS location helper.",
  "sensors.geo.agent": "Allow location fields that pass precision and privacy gates into agent context.",
  "sensors.geo.precision": "Maximum location detail: city, district, street, or exact.",
  "sensors.geo.exactCoordinates": "Permit lat/lon/accuracy_m only when location precision is exact.",
  "sensors.geo.exactAddress": "Permit formatted address/name only when location precision is exact.",
  "sensors.lapse.enabled": "Track human and agent idle continuity from local Pi lifecycle events.",
};

const commonSensorLabel = (item: SettingsListControlItem): string | null => {
  const match = /^sensors\.([^.]+)\.([^.]+)$/u.exec(item.path);
  if (match === null) return null;
  const [, sensorKey, field] = match;
  if (sensorKey === undefined || field === undefined) return null;
  const title = sensorTitle(sensorKey);
  if (field === "enabled") return `${title} sensor`;
  if (field === "ui") return `${title} in UI`;
  if (field === "agent") return `${title} to agent`;
  if (field === "intervalMs") return `${title} refresh interval`;
  if (field === "timeoutMs") return `${title} timeout`;
  if (field === "staleAfterMs") return `${title} stale after`;
  if (field === "initialRefresh") return `${title} initial refresh`;
  return null;
};

const commonSensorDescription = (item: SettingsListControlItem): string | null => {
  const match = /^sensors\.([^.]+)\.([^.]+)$/u.exec(item.path);
  if (match === null) return null;
  const [, sensorKey, field] = match;
  if (sensorKey === undefined || field === undefined) return null;
  const title = sensorTitle(sensorKey).toLowerCase();
  if (field === "enabled") return `Enable the ${title} sensor.`;
  if (field === "ui") return `Show ${title} output in user-facing Dasein UI/status surfaces.`;
  if (field === "agent") return `Allow ${title} output into agent context when field-level rules permit it.`;
  if (field === "intervalMs") return `Override the ${title} recurring refresh interval in milliseconds.`;
  if (field === "timeoutMs") return `Abort ${title} refreshes after this many milliseconds.`;
  if (field === "staleAfterMs") return `Mark ${title} data stale after this many milliseconds.`;
  if (field === "initialRefresh") return `Refresh ${title} once when the session starts.`;
  return null;
};

const externalLabel = (item: SettingsListControlItem): string | null => {
  const match = /^external\.([A-Za-z0-9_-]+)\.(ui|agent)$/u.exec(item.path);
  if (match === null) return null;
  const [, key, field] = match;
  if (key === undefined || field === undefined) return null;
  return field === "ui" ? `External ${key} in UI` : `External ${key} to agent`;
};

const externalDescription = (item: SettingsListControlItem): string | null => {
  const match = /^external\.([A-Za-z0-9_-]+)\.(ui|agent)$/u.exec(item.path);
  if (match === null) return null;
  const [, key, field] = match;
  if (key === undefined || field === undefined) return null;
  return field === "ui"
    ? `Show external ${key} state in Dasein UI/status surfaces.`
    : `Allow external ${key} state into agent context.`;
};

export const daseinSettingDisplayLabel = (item: SettingsListVisibilityItem): string => {
  if (item.kind === "metadata") return item.label;
  return explicitLabels[item.id] ?? commonSensorLabel(item) ?? externalLabel(item) ?? item.label;
};

export const daseinSettingDisplayDescription = (item: SettingsListVisibilityItem): string => {
  if (item.kind === "metadata") {
    return "Read-only inspectability metadata for this sensor.";
  }
  return explicitDescriptions[item.id]
    ?? commonSensorDescription(item)
    ?? externalDescription(item)
    ?? item.description
    ?? `Config path: ${item.path}`;
};

export const stripSettingsListPeerHintLines = (lines: readonly string[]): string[] => {
  const result = [...lines];
  const normalizedLast = stripAnsi(result.at(-1) ?? "").trim();
  if (!SETTINGS_LIST_PEER_HINTS.has(normalizedLast)) {
    return result;
  }
  result.pop();
  if (stripAnsi(result.at(-1) ?? "").trim().length === 0) {
    result.pop();
  }
  return result;
};

export const geoSettingsFieldOrder = (fieldName: string): number => {
  if (fieldName === "precision") return 0;
  if (fieldName === "exactCoordinates") return 1;
  if (fieldName === "exactAddress") return 2;
  return 10;
};

export const compareSensorFieldNamesForSettings = (sensorKey: string, left: string, right: string): number => {
  if (sensorKey === "geo") {
    const orderDelta = geoSettingsFieldOrder(left) - geoSettingsFieldOrder(right);
    if (orderDelta !== 0) return orderDelta;
  }
  return left.localeCompare(right);
};
