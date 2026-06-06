import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ConfigValidationError,
  SensorAction,
  SensorActionResult,
  SensorConfig,
  SensorSnapshot,
  SensorSpec,
  SensorStateField,
  SensorValueType,
} from "../core/types.ts";
import {
  createMacOSLocationHelperSupervisor,
  getMacOSLocationHelperRuntimePolicy,
  type GeoState,
  type MacOSLocationHelperRuntimePolicy,
} from "../native/macos-location-helper.ts";

export type GeoPrecision = "city" | "district" | "street" | "exact";

export interface GeoTag {
  lat: number;
  lon: number;
  radius_m: number;
  label?: string;
}

export interface GeoConfig extends SensorConfig {
  precision: GeoPrecision;
  tags: Record<string, GeoTag>;
  exactAddress: boolean;
  exactCoordinates: boolean;
}

export interface GeoTagListPayload {
  exactCoordinates: boolean;
  tags: Array<{
    name: string;
    radius_m: number;
    label: string | null;
    coordinates: { visible: true; lat: number; lon: number } | { visible: false; redacted: true };
  }>;
}

const STALE_AFTER_MS = 1_800_000;
const TAG_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const geoOutputFields = [
  { state_key: "geo.lat", value_type: "number", description: "latitude", agentVisibleByDefault: false, uiVisibleByDefault: false },
  { state_key: "geo.lon", value_type: "number", description: "longitude", agentVisibleByDefault: false, uiVisibleByDefault: false },
  { state_key: "geo.accuracy_m", value_type: "number", description: "horizontal accuracy in meters", agentVisibleByDefault: false, uiVisibleByDefault: true },
  { state_key: "geo.permission", value_type: "enum", description: "CoreLocation permission", agentVisibleByDefault: false, uiVisibleByDefault: true },
  { state_key: "geo.nearestTag", value_type: "string", description: "nearest configured geo tag", agentVisibleByDefault: true, uiVisibleByDefault: true },
  { state_key: "geo.placemark", value_type: "object", description: "best-effort reverse geocoded placemark", agentVisibleByDefault: false, uiVisibleByDefault: true },
] as const;

const geoDefaults: GeoConfig = {
  enabled: false,
  ui: true,
  agent: false,
  intervalMs: 60_000,
  timeoutMs: 3_000,
  staleAfterMs: STALE_AFTER_MS,
  initialRefresh: true,
  precision: "city",
  tags: {},
  exactAddress: false,
  exactCoordinates: false,
};

const validateGeoConfig = (config: Readonly<GeoConfig>): readonly ConfigValidationError[] => {
  const errors: ConfigValidationError[] = [];
  if (!["city", "district", "street", "exact"].includes(config.precision)) {
    errors.push({ kind: "invalid-value", path: "sensors.geo.precision", message: "geo precision must be city, district, street, or exact" });
  }
  if (!isRecord(config.tags)) {
    errors.push({ kind: "invalid-value", path: "sensors.geo.tags", message: "geo tags must be an object" });
    return errors;
  }
  for (const [name, tag] of Object.entries(config.tags)) {
    if (!TAG_NAME_RE.test(name)) errors.push({ kind: "invalid-path", path: `sensors.geo.tags.${name}`, message: "geo tag name must match [A-Za-z0-9_-]{1,64}" });
    if (!isRecord(tag)) {
      errors.push({ kind: "invalid-value", path: `sensors.geo.tags.${name}`, message: "geo tag must be an object" });
      continue;
    }
    const allowedKeys = new Set(["lat", "lon", "radius_m", "label"]);
    for (const key of Object.keys(tag)) {
      if (!allowedKeys.has(key)) errors.push({ kind: "invalid-value", path: `sensors.geo.tags.${name}.${key}`, message: "geo tag contains non-canonical key" });
    }
    if (!isFiniteNumber(tag.lat) || !isFiniteNumber(tag.lon)) {
      errors.push({ kind: "invalid-value", path: `sensors.geo.tags.${name}`, message: "geo tag lat/lon must be finite numbers" });
    }
    if (!Number.isInteger(tag.radius_m) || tag.radius_m < 1 || tag.radius_m > 100_000) {
      errors.push({ kind: "invalid-value", path: `sensors.geo.tags.${name}.radius_m`, message: "geo tag radius_m must be an integer from 1 to 100000" });
    }
    if ("label" in tag && typeof tag.label !== "string") {
      errors.push({ kind: "invalid-value", path: `sensors.geo.tags.${name}.label`, message: "geo tag label must be a string when present" });
    }
  }
  return errors;
};

const normalizeGeoState = (value: GeoState, context: { collectedAt: number; staleAfterMs: number; status: "enabled" | "error"; error?: { kind: string; message: string } }): Record<string, SensorStateField> => ({
  "geo.lat": makeField("geo.lat", value.lat, value.lat === null ? "null" : "number", context),
  "geo.lon": makeField("geo.lon", value.lon, value.lon === null ? "null" : "number", context),
  "geo.accuracy_m": makeField("geo.accuracy_m", value.accuracy_m, value.accuracy_m === null ? "null" : "number", context),
  "geo.permission": makeField("geo.permission", value.permission, "enum", context),
  "geo.placemark": makeField("geo.placemark", value.placemark, value.placemark === null ? "null" : "object", context),
  "geo.nearestTag": makeField("geo.nearestTag", value.nearestTag, value.nearestTag === null ? "null" : "string", context),
});

const makeField = (
  stateKey: string,
  value: unknown,
  valueType: SensorValueType,
  context: { collectedAt: number; staleAfterMs: number; status: "enabled" | "error"; error?: { kind: string; message: string } },
): SensorStateField => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: "geo",
  state_key: stateKey,
  value,
  value_type: valueType,
  collected_at: context.collectedAt,
  stale_after_ms: context.staleAfterMs,
  status: context.status,
  source: { sensor_id: "geo", source_kind: "builtin" },
  ...(context.error === undefined ? {} : { error: context.error as SensorStateField["error"] }),
});

const tagAction: SensorAction<GeoConfig> = async (args, context): Promise<SensorActionResult> => {
  const [subcommand, name, radiusText] = args;
  if (subcommand === "list") return tagList(context.config);
  if (subcommand === "add") {
    if (name === undefined || radiusText === undefined || !TAG_NAME_RE.test(name)) return { ok: false, message: "usage: geo tag add <name> <radius_m>" };
    const radius = Number(radiusText);
    if (!Number.isInteger(radius) || radius < 1 || radius > 100_000) return { ok: false, message: "radius_m must be an integer from 1 to 100000" };
    const currentCoordinate = freshCoordinateFromSnapshot(context.snapshot);
    if (currentCoordinate !== null) {
      return { ok: true, message: `geo tag ${name} proposed`, mutation: { assignments: { [`sensors.geo.tags.${name}`]: { ...currentCoordinate, radius_m: radius, label: name } } } };
    }
    const refreshResult = await context.refreshNow({ bypassBackoff: true, reason: "geo_tag_add" });
    if (!refreshResult.ok || !refreshResult.fresh) return { ok: false, message: refreshResult.ok ? "cannot add geo tag without a fresh coordinate" : refreshResult.error.message };
    const refreshedCoordinate = coordinateFromEnabledSnapshot(refreshResult.snapshot);
    if (refreshedCoordinate === null) return { ok: false, message: "cannot add geo tag without a fresh coordinate" };
    return { ok: true, message: `geo tag ${name} proposed`, mutation: { assignments: { [`sensors.geo.tags.${name}`]: { ...refreshedCoordinate, radius_m: radius, label: name } } } };
  }
  if (subcommand === "remove") {
    if (name === undefined || !Object.prototype.hasOwnProperty.call(context.config.tags, name)) return { ok: false, message: "tag not found" };
    return { ok: true, message: `geo tag ${name} removed`, mutation: { deletePaths: [`sensors.geo.tags.${name}`] } };
  }
  return { ok: false, message: "usage: geo tag list|add|remove" };
};

const refreshAction: SensorAction<GeoConfig> = async (_args, context): Promise<SensorActionResult> => {
  const result = await context.refreshNow({ bypassBackoff: true, reason: "geo_manual_refresh" });
  return result.ok ? { ok: true, message: "geo refresh completed", refreshScheduled: false } : { ok: false, message: result.error.message };
};

const tagList = (config: Readonly<GeoConfig>): SensorActionResult => {
  const exactCoordinates = config.agent === true && config.precision === "exact" && config.exactCoordinates === true;
  const tags: GeoTagListPayload["tags"] = Object.entries(config.tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, tag]) => ({
      name,
      radius_m: tag.radius_m,
      label: tag.label ?? null,
      coordinates: exactCoordinates ? { visible: true as const, lat: tag.lat, lon: tag.lon } : { visible: false as const, redacted: true as const },
    }));
  const payload: GeoTagListPayload = { exactCoordinates, tags };
  return { ok: true, message: `geo tags: ${tags.map((tag) => tag.name).join(", ") || "none"}`, data: payload };
};

interface GeoNativeHelperConfiguration {
  extensionRoot: string;
  installMode: "directory" | "single-file";
  packagedHelperPath: string | null;
}

const DEFAULT_EXTENSION_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
let helperConfiguration: GeoNativeHelperConfiguration = {
  extensionRoot: DEFAULT_EXTENSION_ROOT,
  installMode: "directory",
  packagedHelperPath: null,
};
let supervisor: ReturnType<typeof createMacOSLocationHelperSupervisor> | null = null;

export const configureGeoNativeHelper = (input: {
  extensionRoot: string;
  installMode?: "directory" | "single-file";
  packagedHelperPath?: string | null;
}): void => {
  const next: GeoNativeHelperConfiguration = {
    extensionRoot: resolve(input.extensionRoot),
    installMode: input.installMode ?? "directory",
    packagedHelperPath: input.packagedHelperPath ?? null,
  };
  if (
    helperConfiguration.extensionRoot !== next.extensionRoot ||
    helperConfiguration.installMode !== next.installMode ||
    helperConfiguration.packagedHelperPath !== next.packagedHelperPath
  ) {
    supervisor = null;
  }
  helperConfiguration = next;
};

export const getGeoNativeHelperRuntimePolicy = (): MacOSLocationHelperRuntimePolicy => getMacOSLocationHelperRuntimePolicy(helperConfiguration);

const getSupervisor = (): ReturnType<typeof createMacOSLocationHelperSupervisor> => {
  supervisor ??= createMacOSLocationHelperSupervisor(helperConfiguration);
  return supervisor;
};

const geoSpec: SensorSpec<GeoState, GeoConfig> = {
  key: "geo",
  defaults: geoDefaults,
  manifest: {
    description: "local macOS CoreLocation helper",
    declaredInputClasses: ["native_location", "subprocess"],
    outputFields: geoOutputFields,
    permissions: [
      { kind: "macos_location", required: true, reason: "CoreLocation user-approved location" },
      { kind: "subprocess", required: true, reason: "supervised Swift helper" },
    ],
    remote: {
      capable: false,
      contactsNetworkByDefault: false,
      destinations: [],
      payloadClasses: [],
      transmissionCadence: "none",
      disableControl: "none",
      description: "none",
    },
    backgroundWork: {
      capable: true,
      kinds: ["initial_refresh", "recurring_interval"],
      defaultIntervalMs: 60_000,
      intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
      description: "local geo refresh",
    },
  },
  fields: {
    precision: { label: "Location precision", type: "enum", values: ["city", "district", "street", "exact"] },
    tags: { label: "Location tags", type: "object", additionalProperties: true, actionManaged: true, description: "Managed by /dasein geo tag actions and validated by the geo validator." },
    exactAddress: { label: "Include exact address", type: "boolean" },
    exactCoordinates: { label: "Include exact coordinates", type: "boolean" },
  },
  validateConfig: validateGeoConfig,
  normalizeState: (value, context) => normalizeGeoState(value, context),
  refresh: async (context) => {
    const supervisor = getSupervisor();
    const result = await supervisor.refresh({ reason: "geo_refresh", manual: false });
    if (result.status === "enabled" && result.state !== undefined) {
      const state = withCurrentTag({ ...result.state, helperBackoffUntil: supervisor.getBackoffUntil() }, context.config.tags);
      return { value: state, metadata: { status: "enabled", collectedAt: state.timestamp === null ? context.now() : state.timestamp * 1000, staleAfterMs: STALE_AFTER_MS } };
    }
    const error = result.error ?? { kind: "unknown" as const, message: "macOS location helper failed" };
    return { value: { ...errorGeoState(error.kind), helperBackoffUntil: supervisor.getBackoffUntil() }, metadata: { status: "error", error, collectedAt: context.now(), staleAfterMs: STALE_AFTER_MS } };
  },
  actions: { tag: tagAction, refresh: refreshAction },
};

const errorGeoState = (kind: string): GeoState => ({
  lat: null,
  lon: null,
  accuracy_m: null,
  permission: kind === "permission" ? "denied" : "unknown",
  timestamp: null,
  placemark: null,
  nearestTag: null,
  helperBackoffUntil: null,
});

const coordinateFromEnabledSnapshot = (snapshot: SensorSnapshot): { lat: number; lon: number } | null => {
  if (snapshot.status !== "enabled") return null;
  const lat = getNumber(snapshot, "geo.lat");
  const lon = getNumber(snapshot, "geo.lon");
  return lat === null || lon === null ? null : { lat, lon };
};

const freshCoordinateFromSnapshot = (snapshot: SensorSnapshot | null): { lat: number; lon: number } | null => {
  if (snapshot === null || !isFresh(snapshot, Date.now())) return null;
  return coordinateFromEnabledSnapshot(snapshot);
};

const isFresh = (snapshot: SensorSnapshot, now: number): boolean => snapshot.status === "enabled" && now - snapshot.collected_at <= snapshot.stale_after_ms;

const withCurrentTag = (state: GeoState, tags: Readonly<Record<string, GeoTag>>): GeoState => ({
  ...state,
  nearestTag: findNearestTagName(state.lat, state.lon, tags),
});

const findNearestTagName = (lat: number | null, lon: number | null, tags: Readonly<Record<string, GeoTag>>): string | null => {
  if (lat === null || lon === null) return null;
  const matches = Object.entries(tags)
    .map(([name, tag]) => ({ name, label: tag.label, distance_m: distanceMeters(lat, lon, tag.lat, tag.lon), radius_m: tag.radius_m }))
    .filter((match) => match.distance_m <= match.radius_m)
    .sort((left, right) => left.distance_m - right.distance_m || left.name.localeCompare(right.name));
  const nearest = matches[0];
  return nearest === undefined ? null : nearest.label ?? nearest.name;
};

const distanceMeters = (leftLat: number, leftLon: number, rightLat: number, rightLon: number): number => {
  const earthRadiusMeters = 6_371_000;
  const leftLatRad = degreesToRadians(leftLat);
  const rightLatRad = degreesToRadians(rightLat);
  const deltaLat = degreesToRadians(rightLat - leftLat);
  const deltaLon = degreesToRadians(rightLon - leftLon);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(leftLatRad) * Math.cos(rightLatRad) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const degreesToRadians = (value: number): number => (value * Math.PI) / 180;

const getField = (snapshot: SensorSnapshot, key: string): SensorStateField | undefined => snapshot.fields[key];
const getNumber = (snapshot: SensorSnapshot, key: string): number | null => {
  const value = getField(snapshot, key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export default geoSpec;
