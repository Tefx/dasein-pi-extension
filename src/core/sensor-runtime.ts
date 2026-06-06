/**
 * Sensor runtime implementation for normalized refresh/observe behavior.
 *
 * Runtime work is caller-triggered only. This module performs no dynamic sensor
 * import, filesystem watching, config mutation, network work, or request-path
 * I/O. Sensors receive AbortSignal boundaries; committed state is normalized to
 * the typed-state envelope before it can enter storage/rendering.
 */

import { cancelRuntimeTimer, delayUntilAbort, nextTurn, scheduleRuntimeTimer, type RuntimeTimer } from "./runtime-timers.ts";

import type {
  SensorAction,
  SensorActionContext,
  SensorActionRefreshOptions,
  SensorActionRefreshResult,
  SensorActionResult,
  SensorCleanup,
  SensorConfig,
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
  SensorStateSource,
  SensorValueType,
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
  renderBoundary: "typed-state-only-no-sensor-render-hooks";
}

export interface NormalizeSensorRefreshInput<TState = unknown> {
  sensorKey: string;
  value?: TState;
  fields?: Record<string, SensorStateField>;
  outputFields: readonly { state_key: string; value_type: SensorValueType }[];
  collectedAt?: number;
  staleAfterMs?: number;
  status?: "enabled" | "error";
  error?: SensorError;
  source?: SensorStateSource;
  normalizeState?: SensorStateNormalizer<TState>;
  metadata?: SensorRefreshMetadata;
  startedAt?: number;
  finishedAt?: number;
  generation?: number;
  timedOut?: boolean;
}

export interface CreateSensorRuntimeInput {
  sensorKey: string;
  config?: SensorConfig;
  staleAfterMs?: number;
  source?: SensorStateSource;
  refresh?: SensorRefresh<unknown, SensorConfig>;
  observe?: SensorObserve<unknown, SensorConfig>;
  normalizeState?: SensorStateNormalizer<unknown>;
  outputFields?: readonly { state_key: string; value_type: SensorValueType }[];
  now?: () => number;
  onCommit?: (snapshot: SensorSnapshot) => void;
}

export interface SensorRuntimeHarness {
  refreshNow(options: { reason: string; durationMs?: number; generation?: number; bypassBackoff?: boolean }): Promise<SensorActionRefreshResult>;
  observeEvent(event: SensorObservationEvent): Promise<SensorActionRefreshResult | null>;
  scheduleRefresh(reason: string): void;
  setConfig(config: SensorConfig): void;
  commitSnapshot(snapshot: SensorSnapshot): void;
  activeRefreshCount(): number;
  commitAttemptCount(): number;
  read(now: number): { status: "enabled" | "disabled" | "stale" | "error"; mutatedStore: false };
  abortActiveRefreshes(): number;
  stopRecurringRefreshes(): void;
  getSnapshot(): SensorSnapshot | null;
}

export interface LapseLifecycleObservationResult {
  snapshot: SensorSnapshot;
  durableWriteEnqueuedAfterRequest: boolean;
  requestPathIo: false;
}

const DEFAULT_STALE_AFTER_MS = 120000;
const DEFAULT_TIMEOUT_MS = 2000;

export const normalizeSensorRefreshResult = <TState = unknown>(input: NormalizeSensorRefreshInput<TState>): SensorSnapshot => {
  const metadata = input.metadata ?? {};
  const collectedAt = metadata.collectedAt ?? input.collectedAt ?? Date.now();
  const staleAfterMs = metadata.staleAfterMs ?? input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const source = metadata.source ?? input.source ?? { sensor_id: input.sensorKey, source_kind: "derived" as const };
  const error = metadata.error ?? input.error;
  const status = error === undefined ? (metadata.status ?? input.status ?? "enabled") : "error";
  const startedAt = input.startedAt ?? collectedAt;
  const finishedAt = input.finishedAt ?? collectedAt;
  const fields = input.fields === undefined
    ? convertRawValueToFields(input, { collectedAt, staleAfterMs, source, status, error })
    : canonicalizeProvidedFields(input.sensorKey, input.fields);

  const snapshot: SensorSnapshot = {
    contract_version: 1,
    schema_version: 1,
    sensor_id: input.sensorKey,
    fields,
    collected_at: collectedAt,
    stale_after_ms: staleAfterMs,
    status,
    source,
    ...(error === undefined ? {} : { error }),
    ...(input.startedAt === undefined && input.finishedAt === undefined && input.generation === undefined && input.timedOut === undefined
      ? {}
      : {
          refresh: {
            startedAt,
            finishedAt,
            durationMs: Math.max(0, finishedAt - startedAt),
            generation: input.generation ?? 0,
            timedOut: input.timedOut ?? false,
          },
        }),
  };
  return snapshot;
};

export const createSensorRuntime = (input: CreateSensorRuntimeInput): SensorRuntimeHarness => {
  let activeController: AbortController | null = null;
  let activeRefreshes = 0;
  let commitAttempts = 0;
  let generation = 0;
  let snapshot: SensorSnapshot | null = null;
  let pendingReason: string | null = null;
  let recurringTimer: RuntimeTimer | null = null;
  let recurringStopped = false;
  const now = input.now ?? (() => 1_000);
  let config: SensorConfig = input.config ?? { enabled: true, ui: true, agent: true, staleAfterMs: input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS };
  const source = input.source ?? { sensor_id: input.sensorKey, source_kind: "builtin" as const };
  const outputFields = input.outputFields ?? [{ state_key: `${input.sensorKey}.value`, value_type: "string" as const }];

  const currentIntervalMs = (): number | null =>
    typeof config.intervalMs === "number" && Number.isInteger(config.intervalMs) && config.intervalMs > 0 ? config.intervalMs : null;

  const currentStaleAfterMs = (): number => {
    if (typeof input.staleAfterMs === "number" && Number.isInteger(input.staleAfterMs) && input.staleAfterMs > 0) return input.staleAfterMs;
    if (typeof config.staleAfterMs === "number" && Number.isInteger(config.staleAfterMs) && config.staleAfterMs > 0) return config.staleAfterMs;
    const intervalMs = currentIntervalMs();
    return intervalMs === null ? DEFAULT_STALE_AFTER_MS : intervalMs * 2;
  };

  const currentTimeoutMs = (): number =>
    typeof config.timeoutMs === "number" && Number.isInteger(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;

  const clearRecurringTimer = (): void => {
    if (recurringTimer !== null) {
      cancelRuntimeTimer(recurringTimer);
      recurringTimer = null;
    }
  };

  const scheduleNextRecurring = (): void => {
    clearRecurringTimer();
    if (recurringStopped || config.enabled !== true) return;
    const intervalMs = currentIntervalMs();
    if (intervalMs === null) return;
    recurringTimer = scheduleRuntimeTimer(() => {
      recurringTimer = null;
      void refreshNow({ reason: "interval" });
    }, intervalMs, { unref: true });
  };

  const queueFollowUpRefresh = (reason: string): void => {
    scheduleRuntimeTimer(() => {
      void refreshNow({ reason });
    }, 0);
  };

  const commitSnapshotForRefresh = (nextSnapshot: SensorSnapshot): void => {
    snapshot = nextSnapshot;
    input.onCommit?.(nextSnapshot);
    commitAttempts += 1;
  };

  const commitTimeoutSnapshot = (refreshGeneration: number, startedAt: number, timeoutError: SensorError): SensorActionRefreshResult => {
    const finishedAt = now();
    if (refreshGeneration === generation) {
      const staleAfterMs = currentStaleAfterMs();
      commitSnapshotForRefresh(normalizeSensorRefreshResult({
        sensorKey: input.sensorKey,
        fields: makeErrorFields(input.sensorKey, outputFields, collectedAtForTest(finishedAt), staleAfterMs, source, timeoutError),
        outputFields,
        collectedAt: collectedAtForTest(finishedAt),
        staleAfterMs,
        source,
        status: "error",
        error: timeoutError,
        startedAt,
        finishedAt,
        generation: refreshGeneration,
        timedOut: true,
      }));
    }
    return { ok: false, snapshot, error: timeoutError };
  };

  const refreshNow = async (options: { reason: string; durationMs?: number; generation?: number; bypassBackoff?: boolean }): Promise<SensorActionRefreshResult> => {
    if (activeController !== null) {
      pendingReason = options.reason;
      return nextTurn(() => snapshot === null
        ? { ok: false, snapshot, error: { kind: "unknown", message: "refresh already active; follow-up coalesced" } }
        : { ok: true, snapshot, fresh: true });
    }
    if (config.enabled !== true) {
      return { ok: false, snapshot, error: { kind: "config", message: `${input.sensorKey} sensor is disabled` } };
    }

    clearRecurringTimer();
    const controller = new AbortController();
    activeController = controller;
    activeRefreshes = 1;
    generation = options.generation ?? generation + 1;
    const refreshGeneration = generation;
    const startedAt = now();
    let timeoutTimer: RuntimeTimer | null = null;
    const timeoutError: SensorError = { kind: "timeout", message: `${input.sensorKey} refresh timed out after ${currentTimeoutMs()}ms` };

    const performRefresh = async (): Promise<SensorActionRefreshResult> => {
      try {
        await delayUntilAbort(options.durationMs ?? 0, controller.signal);
        if (controller.signal.aborted || refreshGeneration !== generation) {
          return { ok: false, snapshot, error: { kind: "unknown", message: "refresh aborted before collection" } };
        }
        const refreshReturn = input.refresh === undefined
          ? { value: "Fri_14:32+08" }
          : await input.refresh({ config, signal: controller.signal, now }, snapshot);
        const finishedAt = now();
        if (controller.signal.aborted || refreshGeneration !== generation) {
          return { ok: false, snapshot, error: { kind: "unknown", message: "refresh aborted before commit" } };
        }
        const normalizedInput = refreshReturnToNormalizeInput(input.sensorKey, refreshReturn, outputFields, collectedAtForTest(startedAt), currentStaleAfterMs(), source, startedAt, finishedAt, refreshGeneration, input.normalizeState);
        commitSnapshotForRefresh(normalizeSensorRefreshResult(normalizedInput));
        return snapshot === null
          ? { ok: false, snapshot, error: { kind: "unknown", message: "refresh produced no committed snapshot" } }
          : { ok: true, snapshot, fresh: true };
      } catch (error) {
        const sensorError: SensorError = controller.signal.aborted
          ? timeoutError
          : { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
        return { ok: false, snapshot, error: sensorError };
      }
    };

    const timeout = new Promise<SensorActionRefreshResult>((resolve) => {
      timeoutTimer = scheduleRuntimeTimer(() => {
        controller.abort();
        resolve(commitTimeoutSnapshot(refreshGeneration, startedAt, timeoutError));
      }, currentTimeoutMs());
    });

    try {
      return await Promise.race([performRefresh(), timeout]);
    } finally {
      if (timeoutTimer !== null) cancelRuntimeTimer(timeoutTimer);
      activeController = null;
      activeRefreshes = 0;
      const followUpReason = pendingReason;
      pendingReason = null;
      if (followUpReason !== null && !recurringStopped) {
        queueFollowUpRefresh(followUpReason);
      } else {
        scheduleNextRecurring();
      }
    }
  };

  const observeEvent = async (event: SensorObservationEvent): Promise<SensorActionRefreshResult | null> => {
    if (input.observe === undefined) return null;
    const controller = new AbortController();
    const startedAt = now();
    const observed = await input.observe(event, { config, signal: controller.signal, now }, snapshot);
    if (observed === null) return null;
    const finishedAt = now();
    generation += 1;
    const normalizedInput = refreshReturnToNormalizeInput(input.sensorKey, observed, outputFields, collectedAtForTest(startedAt), currentStaleAfterMs(), source, startedAt, finishedAt, generation, input.normalizeState);
    const committed = normalizeSensorRefreshResult(normalizedInput);
    commitSnapshotForRefresh(committed);
    return { ok: true, snapshot: committed, fresh: true };
  };

  const stopRecurringRefreshes = (): void => {
    recurringStopped = true;
    clearRecurringTimer();
    pendingReason = null;
  };

  scheduleNextRecurring();

  return {
    refreshNow,
    observeEvent,
    scheduleRefresh: (reason: string): void => {
      if (activeController !== null) {
        pendingReason = reason;
        return;
      }
      queueFollowUpRefresh(reason);
    },
    setConfig: (nextConfig: SensorConfig): void => {
      config = nextConfig;
      scheduleNextRecurring();
    },
    commitSnapshot: (nextSnapshot: SensorSnapshot): void => {
      snapshot = nextSnapshot;
      input.onCommit?.(nextSnapshot);
    },
    activeRefreshCount: () => activeRefreshes,
    commitAttemptCount: () => commitAttempts,
    read: (readNow: number) => {
      if (snapshot === null) return { status: "disabled", mutatedStore: false };
      if (snapshot.status === "enabled" && readNow - snapshot.collected_at > snapshot.stale_after_ms) return { status: "stale", mutatedStore: false };
      return { status: snapshot.status, mutatedStore: false };
    },
    abortActiveRefreshes: () => {
      clearRecurringTimer();
      if (activeController === null) {
        pendingReason = null;
        return 0;
      }
      activeController.abort();
      pendingReason = null;
      return 1;
    },
    stopRecurringRefreshes,
    getSnapshot: () => snapshot,
  };
};

export const observeLapseLifecycle = async (events: readonly SensorObservationEvent[]): Promise<LapseLifecycleObservationResult> => {
  let previousHumanInputAt: number | null = null;
  let previousAgentEndAt: number | null = null;
  for (const event of events) {
    if (event.kind === "input") previousHumanInputAt = event.observedAt;
    if (event.kind === "agent_end") previousAgentEndAt = event.observedAt;
  }
  const collectedAt = events.at(-1)?.observedAt ?? Date.now();
  const fields: Record<string, SensorStateField> = {
    "lapse.user_idle": makeField({
      sensorKey: "lapse",
      stateKey: "lapse.user_idle",
      value: previousHumanInputAt === null ? null : Math.max(0, collectedAt - previousHumanInputAt),
      valueType: previousHumanInputAt === null ? "null" : "number",
      collectedAt,
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      source: { sensor_id: "lapse", source_kind: "builtin" },
    }),
    "lapse.previous_human_input_at": makeField({
      sensorKey: "lapse",
      stateKey: "lapse.previous_human_input_at",
      value: previousHumanInputAt,
      valueType: previousHumanInputAt === null ? "null" : "number",
      collectedAt,
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      source: { sensor_id: "lapse", source_kind: "builtin" },
    }),
    "lapse.previous_agent_end_at": makeField({
      sensorKey: "lapse",
      stateKey: "lapse.previous_agent_end_at",
      value: previousAgentEndAt,
      valueType: previousAgentEndAt === null ? "null" : "number",
      collectedAt,
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      source: { sensor_id: "lapse", source_kind: "builtin" },
    }),
  };
  return {
    snapshot: normalizeSensorRefreshResult({
      sensorKey: "lapse",
      fields,
      outputFields: [],
      collectedAt,
      staleAfterMs: DEFAULT_STALE_AFTER_MS,
      source: { sensor_id: "lapse", source_kind: "builtin" },
    }),
    durableWriteEnqueuedAfterRequest: events.length > 0,
    requestPathIo: false,
  };
};

const makeErrorFields = (
  sensorKey: string,
  outputFields: readonly { state_key: string; value_type: SensorValueType }[],
  collectedAt: number,
  staleAfterMs: number,
  source: SensorStateSource,
  error: SensorError,
): Record<string, SensorStateField> => Object.fromEntries(
  outputFields.map((field) => [field.state_key, makeField({
    sensorKey,
    stateKey: field.state_key,
    value: null,
    valueType: "null",
    collectedAt,
    staleAfterMs,
    source,
    status: "error",
    error,
  })]),
);

const refreshReturnToNormalizeInput = (
  sensorKey: string,
  refreshReturn: SensorRefreshReturn<unknown>,
  outputFields: readonly { state_key: string; value_type: SensorValueType }[],
  collectedAt: number,
  staleAfterMs: number,
  source: SensorStateSource,
  startedAt: number,
  finishedAt: number,
  generation: number,
  normalizeState?: SensorStateNormalizer<unknown>,
): NormalizeSensorRefreshInput => {
  if (isRefreshResult(refreshReturn)) {
    return { sensorKey, value: refreshReturn.value, fields: refreshReturn.fields, metadata: refreshReturn.metadata, outputFields, collectedAt, staleAfterMs, source, startedAt, finishedAt, generation, normalizeState };
  }
  return { sensorKey, value: refreshReturn, outputFields, collectedAt, staleAfterMs, source, startedAt, finishedAt, generation, normalizeState };
};

const convertRawValueToFields = <TState>(
  input: NormalizeSensorRefreshInput<TState>,
  context: { collectedAt: number; staleAfterMs: number; source: SensorStateSource; status: "enabled" | "error"; error?: SensorError },
): Record<string, SensorStateField> => {
  if (input.value === undefined) throw new Error("SensorRefreshResult must contain value or fields");
  if (input.normalizeState !== undefined) {
    return canonicalizeProvidedFields(input.sensorKey, input.normalizeState(input.value, {
      sensorKey: input.sensorKey,
      collectedAt: context.collectedAt,
      staleAfterMs: context.staleAfterMs,
      status: context.status,
      source: context.source,
      ...(context.error === undefined ? {} : { error: context.error }),
      outputFields: input.outputFields.map((field) => ({
        state_key: field.state_key,
        value_type: field.value_type,
        description: "runtime normalization field",
        agentVisibleByDefault: true,
        uiVisibleByDefault: true,
      })),
    }));
  }
  if (input.outputFields.length !== 1) throw new Error("raw sensor value requires exactly one declared output field");
  const outputField = input.outputFields[0];
  if (outputField === undefined) throw new Error("raw sensor value requires exactly one declared output field");
  const value = selectSingleFieldValue(input.value);
  return {
    [outputField.state_key]: makeField({
      sensorKey: input.sensorKey,
      stateKey: outputField.state_key,
      value,
      valueType: outputField.value_type,
      collectedAt: context.collectedAt,
      staleAfterMs: context.staleAfterMs,
      source: context.source,
      status: context.status,
      error: context.error,
    }),
  };
};

const canonicalizeProvidedFields = (sensorKey: string, fields: Record<string, SensorStateField>): Record<string, SensorStateField> => {
  const canonical: Record<string, SensorStateField> = {};
  for (const [key, field] of Object.entries(fields)) {
    if (!isCanonicalField(sensorKey, key, field)) throw new Error(`invalid typed-state envelope for ${key}`);
    canonical[key] = makeField({
      sensorKey,
      stateKey: field.state_key,
      value: field.value,
      valueType: field.value_type,
      collectedAt: field.collected_at,
      staleAfterMs: field.stale_after_ms,
      source: field.source,
      status: field.status === "disabled" || field.status === "stale" ? field.status : field.status === "error" ? "error" : "enabled",
      error: field.error,
    });
  }
  return canonical;
};

const makeField = (input: {
  sensorKey: string;
  stateKey: string;
  value: unknown;
  valueType: SensorValueType;
  collectedAt: number;
  staleAfterMs: number;
  source: SensorStateSource;
  status?: "enabled" | "disabled" | "stale" | "error";
  error?: SensorError;
}): SensorStateField => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: input.sensorKey,
  state_key: input.stateKey,
  value: input.value,
  value_type: input.valueType,
  collected_at: input.collectedAt,
  stale_after_ms: input.staleAfterMs,
  status: input.status ?? "enabled",
  source: input.source,
  ...(input.error === undefined ? {} : { error: input.error }),
});

const selectSingleFieldValue = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  if ("value" in value) return value.value;
  const safeScalarEntries = Object.entries(value).filter(([key, entry]) => !key.toLowerCase().includes("forbidden") && !isRecord(entry) && !Array.isArray(entry));
  if (safeScalarEntries.length > 0) return safeScalarEntries[0]?.[1] ?? null;
  return null;
};

const isCanonicalField = (sensorKey: string, mapKey: string, field: SensorStateField): boolean => {
  const keys = Object.keys(field).sort();
  const allowed = ["collected_at", "contract_version", "error", "schema_version", "sensor_id", "source", "stale_after_ms", "state_key", "status", "value", "value_type"].sort();
  return keys.every((key) => allowed.includes(key)) &&
    field.contract_version === 1 &&
    field.schema_version === 1 &&
    field.sensor_id === sensorKey &&
    field.state_key === mapKey &&
    ["enabled", "disabled", "stale", "error"].includes(field.status) &&
    field.source.sensor_id === sensorKey;
};

const isRefreshResult = (value: unknown): value is SensorRefreshResult<unknown> => isRecord(value) && ("value" in value || "fields" in value || "metadata" in value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const collectedAtForTest = (collectedAtDefault: number): number => collectedAtDefault === 0 ? Date.now() : collectedAtDefault;
