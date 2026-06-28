import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CORE_INJECTED_LABEL_CONSTRAINT,
  CORE_MAX_AGENT_CHARS_CONSTRAINT,
  CORE_RESERVED_COMMAND_WORDS,
  DASEIN_CONFIG_PRECEDENCE,
  EXTERNAL_STATE_EVENT_TOPICS,
  RENDERED_CONTEXT_KEYS,
  SENSOR_SNAPSHOT_ENVELOPE_KEYS,
  SENSOR_SPEC_EXPORT_CONTRACT,
  SENSOR_STATE_ENVELOPE_KEYS,
} from "../../../src/index.ts";
import type {
  CommandParserContract,
  ConfigManager,
  DaseinConfig,
  DaseinContextInjectorContract,
  DaseinStateStore,
  ExternalStateClearEvent,
  ExternalStateSetEvent,
  RendererContract,
  SensorSpec,
  SensorSnapshot,
} from "../../../src/index.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const boundedContractFiles = [
  "src/core/types.ts",
  "src/core/config.ts",
  "src/core/state.ts",
  "src/core/sensor-loader.ts",
  "src/core/sensor-runtime.ts",
  "src/core/renderer.ts",
  "src/core/injector.ts",
  "src/core/external-events.ts",
  "src/core/lifecycle.ts",
  "src/commands/dasein-command.ts",
] as const;

test("core config schema constants pin exact validation boundaries", () => {
  assert.deepEqual(DASEIN_CONFIG_PRECEDENCE, ["defaults", "disk", "launch", "runtime"]);
  assert.deepEqual(CORE_RESERVED_COMMAND_WORDS, ["status", "reload", "sensors", "inspect", "set", "apply", "help"]);
  assert.deepEqual(CORE_MAX_AGENT_CHARS_CONSTRAINT, {
    path: "core.maxAgentChars",
    integer: true,
    minimum: 40,
    maximum: 2000,
    defaultValue: 240,
    accepts: [40, 240, 2000],
    rejects: [39, 2001, 40.5],
  });

  for (const accepted of CORE_MAX_AGENT_CHARS_CONSTRAINT.accepts) {
    assert.equal(Number.isInteger(accepted), true);
    assert.equal(accepted >= CORE_MAX_AGENT_CHARS_CONSTRAINT.minimum, true);
    assert.equal(accepted <= CORE_MAX_AGENT_CHARS_CONSTRAINT.maximum, true);
  }

  for (const rejected of CORE_MAX_AGENT_CHARS_CONSTRAINT.rejects) {
    assert.equal(
      Number.isInteger(rejected) &&
        rejected >= CORE_MAX_AGENT_CHARS_CONSTRAINT.minimum &&
        rejected <= CORE_MAX_AGENT_CHARS_CONSTRAINT.maximum,
      false,
    );
  }

  const injectedLabelRegex = new RegExp(`^${CORE_INJECTED_LABEL_CONSTRAINT.pattern}$`);
  assert.equal(CORE_INJECTED_LABEL_CONSTRAINT.pattern, "[A-Za-z0-9_.:-]{1,32}");

  for (const accepted of CORE_INJECTED_LABEL_CONSTRAINT.accepts) {
    assert.equal(injectedLabelRegex.test(accepted), true, `${accepted} should satisfy injected label contract`);
  }

  for (const rejected of CORE_INJECTED_LABEL_CONSTRAINT.rejects) {
    assert.equal(injectedLabelRegex.test(rejected), false, `${rejected} should violate injected label contract`);
  }

});

test("required contract surfaces are typed at module boundaries", () => {
  const config: DaseinConfig = {
    version: 1,
    core: {
      agentInjectionEnabled: true,
      agentInjectionTransport: "providerPayload",
      statusEnabled: true,
      statusDetail: "quiet",
      maxAgentChars: 240,
      injectedLabel: "ambient_ctx",
      renderOrder: ["clock", "lapse", "geo", "external:weather"],
    },
    sensors: {
      clock: { enabled: true, ui: true, agent: true, intervalMs: 60000 },
    },
    external: {
      weather: { ui: true, agent: false },
    },
  };

  const snapshot: SensorSnapshot = {
    contract_version: 1,
    schema_version: 1,
    sensor_id: "clock",
    fields: {
      local_time: {
        contract_version: 1,
        schema_version: 1,
        sensor_id: "clock",
        state_key: "local_time",
        value: "14:32",
        value_type: "string",
        collected_at: 1,
        stale_after_ms: 120000,
        status: "enabled",
        source: { sensor_id: "clock", source_kind: "builtin" },
      },
    },
    collected_at: 1,
    stale_after_ms: 120000,
    status: "enabled",
    source: { sensor_id: "clock", source_kind: "builtin" },
  };

  const rendered = {
    agent: "[ambient_ctx: time=14:32]",
    status: "dasein: ok",
    omittedKeys: [],
    truncated: false,
  };

  const store: DaseinStateStore = {
    getSensorSnapshot: () => snapshot,
    setSensorSnapshot: () => undefined,
    clearSensorSnapshot: () => undefined,
    listSensorSnapshots: () => [snapshot],
    getExternalState: () => null,
    setExternalState: () => undefined,
    clearExternalState: () => undefined,
    listExternalStates: () => [],
    getRenderedContext: () => rendered,
    setRenderedContext: () => undefined,
    getRenderedAgentString: () => rendered.agent,
    setRenderedAgentString: () => undefined,
    getRenderedStatusString: () => rendered.status,
    setRenderedStatusString: () => undefined,
  };

  const configManager: ConfigManager = {
    getEffectiveConfig: () => config,
    setRuntime: async () => ({ ok: true, config, updatedPaths: ["core.maxAgentChars"], deletedPaths: [], persistedPath: "~/.pi/dasein/config.json" }),
    applyRuntime: async () => ({ ok: false, errors: [{ kind: "invalid-path", path: "bad", message: "bad" }], config }),
    applyRuntimeProposal: async () => ({ ok: false, errors: [{ kind: "invalid-value", path: "bad", message: "bad" }], config }),
    reloadDisk: async () => ({ ok: true, config, loadedPath: "~/.pi/dasein/config.json", warnings: [], launchReappliedPaths: [], runtimeOverriddenPaths: [] }),
  };

  const sensorSpec: SensorSpec = {
    key: "clock",
    defaults: { enabled: true, ui: true, agent: true },
    manifest: {
      description: "clock",
      declaredInputClasses: ["time"],
      outputFields: [{ state_key: "local_time", value_type: "string", description: "time", agentVisibleByDefault: true, uiVisibleByDefault: true }],
      permissions: [{ kind: "none", required: false, reason: "none" }],
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
        defaultIntervalMs: 60000,
        intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
        description: "local clock cadence",
      },
    },
  };

  const setEvent: ExternalStateSetEvent = { key: "weather", agent: "dry", ttlMs: 60000 };
  const clearEvent: ExternalStateClearEvent = { key: "weather" };
  const injectorContract: DaseinContextInjectorContract = {
    readSurface: "pre-rendered-in-memory-agent-string",
    inputStore: store,
    appendedSystemPromptBlock: "<DaseinAmbientContext>\ntime=14:32\n</DaseinAmbientContext>",
    mutatesConfig: false,
    triggersSensorWork: false,
    appendsUserMessage: false,
    appendsCustomMessage: false,
  };
  const rendererContract: RendererContract = {
    input: "effective-config-current-state-store-and-now",
    output: rendered,
    agentOrder: ["configured-renderOrder", "remaining-sensors-lexicographic", "remaining-external-lexicographic"],
    sensorInputSurface: "normalized-typed-state-envelope-only",
    coreOwnedFinalText: true,
    coreOwnedTruncation: true,
  };
  const commandContract: CommandParserContract = {
    rootCommand: "/dasein",
    coreCommands: ["status", "reload", "sensors", "inspect", "set", "apply", "help"],
    sensorRoute: "/dasein <sensor-key> <action> [...args]",
    pathAliases: "short-sensor-paths-only",
    duplicateDetection: "normalized-canonical-path",
    parserOutput: { kind: "status" },
    resultOutput: { ok: true, command: "status", message: "dasein status: ok" },
  };

  assert.equal(configManager.getEffectiveConfig().core.injectedLabel, "ambient_ctx");
  assert.equal(sensorSpec.key, "clock");
  assert.equal(setEvent.key, clearEvent.key);
  assert.equal(injectorContract.readSurface, "pre-rendered-in-memory-agent-string");
  assert.equal(rendererContract.coreOwnedFinalText, true);
  assert.equal(commandContract.duplicateDetection, "normalized-canonical-path");
});

test("contract constants preserve broker boundaries and envelope keys", () => {
  assert.deepEqual(SENSOR_STATE_ENVELOPE_KEYS, [
    "contract_version",
    "schema_version",
    "sensor_id",
    "state_key",
    "value",
    "value_type",
    "collected_at",
    "stale_after_ms",
    "status",
    "source",
    "error",
  ]);
  assert.deepEqual(SENSOR_SNAPSHOT_ENVELOPE_KEYS, [
    "contract_version",
    "schema_version",
    "sensor_id",
    "fields",
    "collected_at",
    "stale_after_ms",
    "status",
    "source",
    "error",
    "refresh",
  ]);
  assert.deepEqual(RENDERED_CONTEXT_KEYS, ["agent", "status", "omittedKeys", "truncated"]);
  assert.deepEqual(EXTERNAL_STATE_EVENT_TOPICS, { set: "dasein:state:set", clear: "dasein:state:clear" });
  assert.equal(SENSOR_SPEC_EXPORT_CONTRACT.moduleExport, "default");
  assert.equal(SENSOR_SPEC_EXPORT_CONTRACT.namedExportAlternativeAccepted, false);
});

test("new core contract files do not ship runtime dependencies or implementation imports", () => {
  const forbiddenImportPattern = /from\s+["'](?:node:)?(?:fs|child_process|http|https|net|tls|dns)["']|from\s+["'][^"']*(?:sensor-loader|sensor-runtime)[^"']*["']/;
  const forbiddenCallPattern = /\b(?:fetch|setInterval|setTimeout|registerCommand|registerFlag|setStatus|setWidget)\s*\(/;

  for (const file of boundedContractFiles) {
    const executableSource = stripComments(readText(file));
    assert.doesNotMatch(executableSource, forbiddenImportPattern, `${file} must not import runtime dependencies`);
    assert.doesNotMatch(executableSource, forbiddenCallPattern, `${file} must not call runtime APIs`);
  }
});
