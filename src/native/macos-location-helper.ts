import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { SensorError } from "../core/types.ts";

export type MacOSLocationPermission = "authorized" | "denied" | "restricted" | "not_determined" | "unknown";

export interface GeoPlacemark {
  city?: string;
  district?: string;
  street?: string;
  name?: string;
  formattedAddress?: string;
  country?: string;
  administrativeArea?: string;
  subAdministrativeArea?: string;
  postalCode?: string;
}

export interface GeoState {
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  permission: MacOSLocationPermission;
  timestamp: number | null;
  placemark: GeoPlacemark | null;
  nearestTag: string | null;
  helperBackoffUntil: number | null;
}

export type MacOSLocationHelperOutput =
  | {
      ok: true;
      lat: number;
      lon: number;
      accuracy_m: number | null;
      permission: "authorized";
      timestamp: number;
      placemark?: GeoPlacemark;
    }
  | {
      ok: false;
      error: "permission_denied" | "permission_restricted" | "timeout" | "unavailable" | "unknown";
      message: string;
      permission?: Exclude<MacOSLocationPermission, "authorized">;
      timestamp?: number;
    };

export type MacOSLocationHelperMapping = { status: "enabled" | "error"; error?: SensorError; state?: GeoState };

export interface MacOSLocationHelperRuntimePolicyInput {
  extensionRoot: string;
  installMode: "directory" | "single-file";
  packagedHelperPath?: string | null;
}

export interface MacOSLocationHelperRuntimePolicy {
  helperPathForDirectoryInstall: string;
  helperPath: string | null;
  spawnCommand: readonly ["swift", string, "--once"] | null;
  timeoutMs: 3000;
  killGraceMs: 250;
  stdoutLimitBytes: 16384;
  stderrLimitBytes: 16384;
  backoffMs: readonly [60000, 300000, 900000];
  manualRefreshBypassesBackoffDelay: true;
  manualRefreshBypassesTimeout: false;
}

export interface MacOSLocationHelperProcessControls {
  abort(): void;
  terminate(): void;
  kill(): void;
}

export interface RunMacOSLocationHelperOnceInput extends MacOSLocationHelperRuntimePolicyInput {
  now?: () => number;
  helperExists?: (path: string) => boolean;
  reason?: string;
  signal?: AbortSignal;
  onProcessControls?: (controls: MacOSLocationHelperProcessControls | null) => void;
}

export interface MacOSLocationHelperSupervisorInput extends MacOSLocationHelperRuntimePolicyInput {
  now?: () => number;
  helperExists?: (path: string) => boolean;
}

export interface MacOSLocationHelperRefreshInput {
  manual?: boolean;
  reason: string;
  signal?: AbortSignal;
}

export interface MacOSLocationHelperSupervisor extends MacOSLocationHelperProcessControls {
  refresh(input: MacOSLocationHelperRefreshInput): Promise<MacOSLocationHelperMapping>;
  getBackoffUntil(): number | null;
  getBackoffStep(): number;
  activeHelperCount(): number;
}

const TIMEOUT_MS = 3000 as const;
const KILL_GRACE_MS = 250 as const;
const STREAM_LIMIT_BYTES = 16 * 1024 as 16384;
const BACKOFF_MS = [60_000, 300_000, 900_000] as const;

export const getMacOSLocationHelperRuntimePolicy = (input: MacOSLocationHelperRuntimePolicyInput): MacOSLocationHelperRuntimePolicy => {
  const helperPathForDirectoryInstall = resolve(input.extensionRoot, "src", "native", "macos-location-helper.swift");
  const helperPath = input.installMode === "directory" ? helperPathForDirectoryInstall : input.packagedHelperPath ?? null;
  return {
    helperPathForDirectoryInstall,
    helperPath,
    spawnCommand: helperPath === null ? null : ["swift", helperPath, "--once"],
    timeoutMs: TIMEOUT_MS,
    killGraceMs: KILL_GRACE_MS,
    stdoutLimitBytes: STREAM_LIMIT_BYTES,
    stderrLimitBytes: STREAM_LIMIT_BYTES,
    backoffMs: BACKOFF_MS,
    manualRefreshBypassesBackoffDelay: true,
    manualRefreshBypassesTimeout: false,
  };
};

export const mapMacOSLocationHelperOutput = (input: unknown): MacOSLocationHelperMapping => {
  if (isRecord(input) && input.installMode === "single-file" && input.packagedHelperPath == null) {
    return errorMapping("helper-unavailable", "macOS location helper is unavailable in this packaged install");
  }
  if (!isRecord(input)) return errorMapping("parse", "macOS location helper stdout was not a JSON object");
  if (input.ok === true) {
    if (!isFiniteNumber(input.lat) || !isFiniteNumber(input.lon) || input.permission !== "authorized" || !isFiniteNumber(input.timestamp)) {
      return errorMapping("parse", "macOS location helper success payload is missing required location fields");
    }
    return {
      status: "enabled",
      state: {
        lat: input.lat,
        lon: input.lon,
        accuracy_m: input.accuracy_m === null ? null : isFiniteNumber(input.accuracy_m) ? input.accuracy_m : null,
        permission: "authorized",
        timestamp: input.timestamp,
        placemark: sanitizePlacemark(input.placemark),
        nearestTag: null,
        helperBackoffUntil: null,
      },
    };
  }
  if (input.ok !== false || typeof input.error !== "string") return errorMapping("parse", "macOS location helper stdout did not match the one-shot JSON contract");
  const message = typeof input.message === "string" && input.message.length > 0 ? input.message : input.error;
  switch (input.error) {
    case "permission_denied":
    case "permission_restricted":
      return errorMapping("permission", message);
    case "timeout":
      return errorMapping("timeout", message);
    case "unavailable":
      return errorMapping("unavailable", message);
    case "unknown":
      return errorMapping("unknown", message);
    default:
      return errorMapping("parse", `unknown macOS helper error code: ${input.error}`);
  }
};

export const runMacOSLocationHelperOnce = async (input: RunMacOSLocationHelperOnceInput): Promise<MacOSLocationHelperMapping> => {
  if (input.reason === "request-path") return errorMapping("helper-unavailable", "macOS location helper must not be spawned from request-path injection");
  if (input.signal?.aborted === true) return errorMapping("timeout", "macOS location helper refresh was aborted before spawn");
  const policy = getMacOSLocationHelperRuntimePolicy(input);
  const helperExists = input.helperExists ?? existsSync;
  if (policy.helperPath === null || policy.spawnCommand === null || !helperExists(policy.helperPath)) {
    return errorMapping("helper-unavailable", "macOS location helper path is unavailable; failing closed without spawn");
  }
  const result = await runBoundedProcess(policy.spawnCommand, policy, {
    signal: input.signal,
    onProcessControls: input.onProcessControls,
  });
  if (!result.ok) return errorMapping(result.kind, result.message);
  try {
    return mapMacOSLocationHelperOutput(JSON.parse(result.stdout) as unknown);
  } catch (error) {
    return errorMapping("parse", error instanceof Error ? error.message : String(error));
  }
};

export const createMacOSLocationHelperSupervisor = (input: MacOSLocationHelperSupervisorInput): MacOSLocationHelperSupervisor => {
  const now = input.now ?? Date.now;
  let backoffStep = 0;
  let backoffUntil: number | null = null;
  let activeControls: MacOSLocationHelperProcessControls | null = null;

  const refresh = async (refreshInput: MacOSLocationHelperRefreshInput): Promise<MacOSLocationHelperMapping> => {
    const currentTime = now();
    if (backoffUntil !== null && currentTime < backoffUntil && refreshInput.manual !== true) {
      return errorMapping("unavailable", `macOS location helper backoff active until ${backoffUntil}`);
    }
    const result = await runMacOSLocationHelperOnce({
      ...input,
      reason: refreshInput.reason,
      signal: refreshInput.signal,
      onProcessControls: (controls) => {
        activeControls = controls;
      },
    });
    if (result.status === "enabled") {
      backoffStep = 0;
      backoffUntil = null;
      return result;
    }
    if (shouldIncrementBackoff(result.error)) {
      const delayMs = BACKOFF_MS[Math.min(backoffStep, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      backoffUntil = now() + delayMs;
      backoffStep = Math.min(backoffStep + 1, BACKOFF_MS.length - 1);
    }
    return result;
  };

  return {
    refresh,
    abort: () => activeControls?.abort(),
    terminate: () => activeControls?.terminate(),
    kill: () => activeControls?.kill(),
    getBackoffUntil: () => backoffUntil,
    getBackoffStep: () => backoffStep,
    activeHelperCount: () => activeControls === null ? 0 : 1,
  };
};

interface RunBoundedProcessOptions {
  signal?: AbortSignal;
  onProcessControls?: (controls: MacOSLocationHelperProcessControls | null) => void;
}

const runBoundedProcess = async (
  command: readonly ["swift", string, "--once"],
  policy: MacOSLocationHelperRuntimePolicy,
  options: RunBoundedProcessOptions = {},
): Promise<{ ok: true; stdout: string } | { ok: false; kind: SensorError["kind"]; message: string }> =>
  await new Promise((resolvePromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command[0], [command[1], command[2]], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (error) {
      resolvePromise({ ok: false, kind: "process", message: error instanceof Error ? error.message : String(error) });
      return;
    }

    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let finished = false;
    let timedOut = false;
    let aborted = false;
    let overflowed = false;
    let forceTimer: NodeJS.Timeout | null = null;

    const appendCapped = (existing: Buffer<ArrayBufferLike>, chunk: Buffer, limit: number): Buffer<ArrayBufferLike> => {
      if (existing.byteLength >= limit) return existing;
      const remaining = limit - existing.byteLength;
      return Buffer.concat([existing, chunk.subarray(0, remaining)]);
    };

    const kill = (): void => {
      if (child.exitCode !== null) return;
      child.kill("SIGKILL");
    };

    const terminate = (): void => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      forceTimer ??= setTimeout(kill, policy.killGraceMs);
    };

    const abort = (): void => {
      if (finished) return;
      aborted = true;
      terminate();
    };

    const cleanupControls = (): void => {
      clearTimeout(timeout);
      if (forceTimer !== null) clearTimeout(forceTimer);
      options.signal?.removeEventListener("abort", abort);
      options.onProcessControls?.(null);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, policy.timeoutMs);

    options.onProcessControls?.({ abort, terminate, kill });
    if (options.signal?.aborted === true) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.byteLength >= policy.stdoutLimitBytes) return;
      if (stdout.byteLength + chunk.byteLength > policy.stdoutLimitBytes) overflowed = true;
      stdout = appendCapped(stdout, chunk, policy.stdoutLimitBytes);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.byteLength >= policy.stderrLimitBytes) return;
      if (stderr.byteLength + chunk.byteLength > policy.stderrLimitBytes) overflowed = true;
      stderr = appendCapped(stderr, chunk, policy.stderrLimitBytes);
    });
    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      cleanupControls();
      resolvePromise({ ok: false, kind: "process", message: error.message });
    });
    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      cleanupControls();
      if (timedOut || aborted) {
        resolvePromise({ ok: false, kind: "timeout", message: timedOut ? "macOS location helper timed out after 3000ms" : "macOS location helper aborted" });
        return;
      }
      if (overflowed) {
        resolvePromise({ ok: false, kind: "process", message: "macOS location helper exceeded stdout/stderr limit" });
        return;
      }
      if (code !== 0) {
        const stderrText = stderr.toString("utf8").trim();
        resolvePromise({ ok: false, kind: "process", message: stderrText || `macOS location helper exited with code ${code ?? "null"} signal ${signal ?? "null"}` });
        return;
      }
      resolvePromise({ ok: true, stdout: stdout.toString("utf8") });
    });
  });

const errorMapping = (kind: SensorError["kind"], message: string): MacOSLocationHelperMapping => ({ status: "error", error: { kind, message } });

const shouldIncrementBackoff = (error: SensorError | undefined): boolean => error?.kind === "timeout" || error?.kind === "process" || error?.kind === "permission";

const sanitizePlacemark = (value: unknown): GeoPlacemark | null => {
  if (!isRecord(value)) return null;
  const output: GeoPlacemark = {};
  const keys = ["city", "district", "street", "name", "formattedAddress", "country", "administrativeArea", "subAdministrativeArea", "postalCode"] as const;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) output[key] = candidate;
  }
  return Object.keys(output).length === 0 ? null : output;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
