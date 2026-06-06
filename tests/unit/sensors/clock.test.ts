import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import type { SensorConfig, SensorSpec, SensorViewFragment } from "../../../src/index.ts";

type ClockConfig = SensorConfig & { precision: string };
type ClockState = { epochMs: number; iso: string; local: string; utcOffsetMinutes: number };

const extensionRoot = new URL("../../..", import.meta.url);
const expectedClockFile = new URL("../../../src/sensors/clock.ts", import.meta.url);
const expectedBuiltinSensorFiles = ["clock.ts", "geo.ts", "lapse.ts"].map((name) => new URL(`../../../src/sensors/${name}`, import.meta.url));
const expectedPrecisions = ["exact", "minute", "hour", "period", "date"] as const;

const loadClockSpec = async (): Promise<SensorSpec<ClockState, ClockConfig>> => {
  const moduleValue = (await import(expectedClockFile.href)) as { default?: unknown };
  assert.equal(typeof moduleValue.default, "object", "src/sensors/clock.ts must default-export one SensorSpec");
  assert.notEqual(moduleValue.default, null, "src/sensors/clock.ts default export must not be null");
  return moduleValue.default as SensorSpec<ClockState, ClockConfig>;
};

const fragmentsToText = (value: SensorViewFragment | readonly SensorViewFragment[] | null | undefined): string => JSON.stringify(value ?? null);

test("builtin sensor source files exist only under <extension_root>/src/sensors/*.ts", () => {
  assert.equal(new URL("../../../src/sensors/clock.ts", import.meta.url).pathname, join(extensionRoot.pathname, "src", "sensors", "clock.ts"));
  assert.equal(new URL("../../../src/sensors/geo.ts", import.meta.url).pathname, join(extensionRoot.pathname, "src", "sensors", "geo.ts"));
  assert.equal(new URL("../../../src/sensors/lapse.ts", import.meta.url).pathname, join(extensionRoot.pathname, "src", "sensors", "lapse.ts"));
  for (const fileUrl of expectedBuiltinSensorFiles) {
    assert.equal(existsSync(fileUrl), true, `${fileUrl.pathname} is required by docs/TECHNICAL_DESIGN.md#module-structure and #builtin-sensors`);
  }
});

test("builtin sensor modules have no top-level collection/import-time side effects", () => {
  const forbiddenTopLevelPatterns: Array<[RegExp, string]> = [
    [/\breadFileSync\s*\(/u, "filesystem read"],
    [/\bwriteFileSync\s*\(/u, "filesystem write"],
    [/\bspawn\s*\(/u, "subprocess spawn"],
    [/\bexec(?:File)?\s*\(/u, "subprocess exec"],
    [/\bfetch\s*\(/u, "network fetch"],
    [/\bset(?:Timeout|Interval)\s*\(/u, "timer scheduling"],
    [/\bcreateMacOSLocationHelperSupervisor\s*\(/u, "native helper work"],
    [/\b(refresh|refreshNow|scheduleRefresh|cleanup|action)\s*\(/u, "refresh/action execution"],
    [/config\.json|state\.json|~\/\.pi\/dasein/u, "config or durable-state access"],
  ];

  for (const fileUrl of expectedBuiltinSensorFiles) {
    assert.equal(existsSync(fileUrl), true, `${fileUrl.pathname} must exist before static import-time side-effect checks can run`);
    const source = readFileSync(fileUrl, "utf8");
    let braceDepth = 0;
    const topLevelExecutableLines = source.split(/\r?\n/u).filter((line) => {
      const trimmed = line.trim();
      const wasTopLevel = braceDepth === 0;
      braceDepth += (line.match(/\{/gu)?.length ?? 0) - (line.match(/\}/gu)?.length ?? 0);
      return wasTopLevel && trimmed.length > 0 && !trimmed.startsWith("import") && !trimmed.startsWith("export type") && !trimmed.startsWith("export interface") && !trimmed.startsWith("//") && !trimmed.startsWith("/*") && !trimmed.startsWith("*");
    });
    const topLevelText = topLevelExecutableLines.join("\n");
    for (const [pattern, label] of forbiddenTopLevelPatterns) {
      assert.doesNotMatch(topLevelText, pattern, `${fileUrl.pathname} must not perform ${label} at import time`);
    }
  }
});

test("clock SensorSpec defaults, manifest, and precision enum match builtin contract", async () => {
  const clock = await loadClockSpec();

  assert.equal(clock.key, "clock");
  assert.deepEqual(clock.defaults, {
    enabled: true,
    ui: true,
    agent: true,
    intervalMs: 60000,
    timeoutMs: 2000,
    staleAfterMs: 120000,
    initialRefresh: true,
    precision: "minute",
  });
  assert.deepEqual(clock.manifest.declaredInputClasses, ["time"]);
  assert.deepEqual(clock.manifest.remote, {
    capable: false,
    contactsNetworkByDefault: false,
    destinations: [],
    payloadClasses: [],
    transmissionCadence: "none",
    disableControl: "none",
    description: "none",
  });
  assert.deepEqual(clock.manifest.backgroundWork, {
    capable: true,
    kinds: ["initial_refresh", "recurring_interval"],
    defaultIntervalMs: 60000,
    intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
    description: "local clock refresh",
  });
  assert.deepEqual(clock.fields?.precision?.values, expectedPrecisions);
});

test("clock precision renders exact/minute/hour/period/date without overlong agent fragments", async () => {
  const clock = await loadClockSpec();
  if (typeof clock.normalizeState !== "function") assert.fail("clock must normalize ClockState into typed fields");
  if (typeof clock.renderAgent !== "function") assert.fail("clock must provide compact agent fragments");

  const state: ClockState = {
    epochMs: Date.UTC(2026, 5, 6, 14, 32, 45),
    iso: "2026-06-06T14:32:45.000Z",
    local: "Sat_14:32:45+00",
    utcOffsetMinutes: 0,
  };

  const snapshot = {
    contract_version: 1 as const,
    schema_version: 1 as const,
    sensor_id: "clock",
    fields: clock.normalizeState(state, {
      sensorKey: "clock",
      collectedAt: state.epochMs,
      staleAfterMs: 120000,
      status: "enabled",
      source: { sensor_id: "clock", source_kind: "builtin" },
      outputFields: clock.manifest.outputFields,
    }),
    collected_at: state.epochMs,
    stale_after_ms: 120000,
    status: "enabled" as const,
    source: { sensor_id: "clock", source_kind: "builtin" as const },
  };

  const renderedByPrecision = new Map<string, string>();
  for (const precision of expectedPrecisions) {
    const rendered = fragmentsToText(clock.renderAgent(snapshot, { ...clock.defaults, precision }));
    assert.ok(rendered.length <= 240, `clock ${precision} agent fragment must be <=240 chars`);
    renderedByPrecision.set(precision, rendered);
  }

  assert.match(renderedByPrecision.get("exact") ?? "", /14:32:45/u, "exact precision includes seconds");
  assert.match(renderedByPrecision.get("minute") ?? "", /14:32/u, "minute precision includes minute");
  assert.doesNotMatch(renderedByPrecision.get("minute") ?? "", /14:32:45/u, "minute precision omits seconds");
  assert.match(renderedByPrecision.get("hour") ?? "", /14/u, "hour precision includes hour");
  assert.doesNotMatch(renderedByPrecision.get("hour") ?? "", /14:32/u, "hour precision omits minutes");
  assert.doesNotMatch(renderedByPrecision.get("period") ?? "", /14:32|14:32:45/u, "period precision omits exact time");
  assert.doesNotMatch(renderedByPrecision.get("date") ?? "", /14:32|14:32:45/u, "date precision omits time of day");
});
