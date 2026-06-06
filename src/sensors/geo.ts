import type {
  ConfigValidationError,
  SensorAction,
  SensorActionResult,
  SensorConfig,
  SensorSnapshot,
  SensorSpec,
  SensorStateField,
  SensorValueType,
  SensorViewFragment,
} from "../core/types.ts";
import { createMacOSLocationHelperSupervisor, type GeoPlacemark, type GeoState } from "../native/macos-location-helper.ts";

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

const renderAgent = (snapshot: SensorSnapshot, config: Readonly<GeoConfig>): SensorViewFragment | readonly SensorViewFragment[] | null => {
  if (!config.agent) return null;
  const placemark = getPlacemark(snapshot);
  const nearestTag = getString(snapshot, "geo.nearestTag");
  const suffix = nearestTag === null ? "" : `/${nearestTag}`;
  const lat = getNumber(snapshot, "geo.lat");
  const lon = getNumber(snapshot, "geo.lon");
  const accuracy = getNumber(snapshot, "geo.accuracy_m");
  const formattedAddress = placemark?.formattedAddress ?? placemark?.name ?? null;

  if (snapshot.status === "error") return fragment(`loc=unavailable(${snapshot.error?.kind ?? "unknown"})`);
  if (config.precision === "exact") {
    const parts: string[] = [];
    if (config.exactCoordinates && lat !== null && lon !== null) parts.push(`${lat},${lon}${accuracy === null ? "" : `±${accuracy}m`}`);
    if (config.exactAddress && formattedAddress !== null) parts.push(formattedAddress);
    return parts.length === 0 ? fragment(`loc=unavailable(exact)${suffix}`) : fragment(`loc=${parts.join(";")}${suffix}`);
  }
  const place = selectPlacemarkPrecision(placemark, config.precision);
  return place === null ? fragment("loc=unavailable(placemark)") : fragment(`loc=${compact(place)}${suffix}`);
};

const renderUI = (snapshot: SensorSnapshot, config: Readonly<GeoConfig>): SensorViewFragment | readonly SensorViewFragment[] | null => {
  if (!config.ui) return null;
  return renderAgent(snapshot, { ...config, agent: true, exactCoordinates: false, exactAddress: false });
};

const fragment = (value: string): SensorViewFragment => ({
  sensor_id: "geo",
  state_key: "geo.summary",
  value,
  value_type: "string",
  label: "Location",
  status: "enabled",
  source: { sensor_id: "geo", source_kind: "builtin" },
});

const tagAction: SensorAction<GeoConfig> = async (args, context): Promise<SensorActionResult> => {
  const [subcommand, name, radiusText] = args;
  if (subcommand === "list") return tagList(context.config);
  if (subcommand === "add") {
    if (name === undefined || radiusText === undefined || !TAG_NAME_RE.test(name)) return { ok: false, message: "usage: geo tag add <name> <radius_m>" };
    const radius = Number(radiusText);
    if (!Number.isInteger(radius) || radius < 1 || radius > 100_000) return { ok: false, message: "radius_m must be an integer from 1 to 100000" };
    const snapshot = context.snapshot ?? (await context.refreshNow({ bypassBackoff: true, reason: "geo_tag_add" })).snapshot;
    const lat = snapshot === null ? null : getNumber(snapshot, "geo.lat");
    const lon = snapshot === null ? null : getNumber(snapshot, "geo.lon");
    if (snapshot === null || snapshot.status !== "enabled" || lat === null || lon === null) return { ok: false, message: "cannot add geo tag without a fresh coordinate" };
    return { ok: true, message: `geo tag ${name} proposed`, mutation: { assignments: { [`sensors.geo.tags.${name}`]: { lat, lon, radius_m: radius, label: name } } } };
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
  const tags = Object.entries(config.tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, tag]) => ({
      name,
      radius_m: tag.radius_m,
      label: tag.label ?? null,
      coordinates: exactCoordinates ? { visible: true as const, lat: tag.lat, lon: tag.lon } : { visible: false as const, redacted: true as const },
    }));
  return { ok: true, message: `geo tags: ${tags.map((tag) => tag.name).join(", ") || "none"}`, data: { exactCoordinates, tags } };
};

let supervisor: ReturnType<typeof createMacOSLocationHelperSupervisor> | null = null;
const getSupervisor = (): ReturnType<typeof createMacOSLocationHelperSupervisor> => {
  supervisor ??= createMacOSLocationHelperSupervisor({ extensionRoot: process.cwd(), installMode: "directory" });
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
  refresh: async (_context) => {
    const result = await getSupervisor().refresh({ reason: "geo_refresh" });
    if (result.status === "enabled" && result.state !== undefined) return { value: result.state, metadata: { status: "enabled", collectedAt: result.state.timestamp === null ? Date.now() : result.state.timestamp * 1000, staleAfterMs: STALE_AFTER_MS } };
    const error = result.error ?? { kind: "unknown" as const, message: "macOS location helper failed" };
    return { value: errorGeoState(error.kind), metadata: { status: "error", error, collectedAt: Date.now(), staleAfterMs: STALE_AFTER_MS } };
  },
  renderAgent,
  renderUI,
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

const selectPlacemarkPrecision = (placemark: GeoPlacemark | null, precision: GeoPrecision): string | null => {
  if (placemark === null) return null;
  if (precision === "city") return placemark.city ?? placemark.district ?? placemark.street ?? null;
  if (precision === "district") return placemark.district ?? placemark.city ?? placemark.street ?? null;
  if (precision === "street") return placemark.street ?? placemark.district ?? placemark.city ?? null;
  return null;
};

const getField = (snapshot: SensorSnapshot, key: string): SensorStateField | undefined => snapshot.fields[key];
const getNumber = (snapshot: SensorSnapshot, key: string): number | null => {
  const value = getField(snapshot, key)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
const getString = (snapshot: SensorSnapshot, key: string): string | null => {
  const value = getField(snapshot, key)?.value;
  return typeof value === "string" && value.length > 0 ? value : null;
};
const getPlacemark = (snapshot: SensorSnapshot): GeoPlacemark | null => {
  const value = getField(snapshot, "geo.placemark")?.value;
  return isRecord(value) ? value as GeoPlacemark : null;
};
const compact = (value: string): string => value.replace(/\s+/gu, "_");
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export default geoSpec;
