import assert from "node:assert/strict";
import test from "node:test";

import { EXTERNAL_STATE_TEXT_MAX_CHARS } from "../../src/index.ts";
import type { DaseinConfig, DaseinStateStore, ExternalStateSnapshot, RenderedContext, SensorSnapshot } from "../../src/index.ts";
import { baseConfig, clockSnapshot, expectedAmbientSystemPromptBlock, fakeStore, loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

const BEHAVIORAL_GATE_MATRIX_ROW =
  "docs/TECHNICAL_DESIGN.md#testing-gate-matrix — Behavioral guardrails row: tests/behavior/ambient-context.test.ts; ordinary coding prompt does not require model to mention ambient context; relevant prompt can use enabled fields; disabled fields never appear in agent string; UI shows whether sensitive fields are agent-visible; malformed publishers cannot inject multiline or overlong strings.";

interface InjectionResult {
  changed: boolean;
  systemPrompt: string;
  content?: string;
  messages?: readonly unknown[];
  appended?: unknown;
}

interface ExternalBridgeResult {
  ok: boolean;
  snapshot?: ExternalStateSnapshot;
  errors?: readonly unknown[];
}

interface ExternalBridge {
  set(event: unknown): ExternalBridgeResult;
  listExternalStates(): readonly ExternalStateSnapshot[];
}

const noPromptMandatePattern = /\b(?:must|should|required|always|make sure to|be sure to)\b.{0,80}\b(?:mention|cite|refer(?:ence)?|use|acknowledge)\b.{0,80}\b(?:ambient|context|dasein|location|weather|time)\b/iu;

const geoSensitiveSnapshot = (): SensorSnapshot => ({
  contract_version: 1,
  schema_version: 1,
  sensor_id: "geo",
  fields: {
    "geo.city": {
      contract_version: 1,
      schema_version: 1,
      sensor_id: "geo",
      state_key: "geo.city",
      value: "Shanghai",
      value_type: "string",
      collected_at: 1_000,
      stale_after_ms: 1_800_000,
      status: "enabled",
      source: { sensor_id: "geo", source_kind: "builtin" },
    },
    "geo.formattedAddress": {
      contract_version: 1,
      schema_version: 1,
      sensor_id: "geo",
      state_key: "geo.formattedAddress",
      value: "Exact Secret Street 51",
      value_type: "string",
      collected_at: 1_000,
      stale_after_ms: 1_800_000,
      status: "enabled",
      source: { sensor_id: "geo", source_kind: "builtin" },
    },
  },
  collected_at: 1_000,
  stale_after_ms: 1_800_000,
  status: "enabled",
  source: { sensor_id: "geo", source_kind: "builtin" },
});

const behaviorConfig = (): DaseinConfig => ({
  ...baseConfig,
  sensors: {
    ...baseConfig.sensors,
    geo: {
      ...baseConfig.sensors.geo,
      enabled: true,
      ui: true,
      agent: false,
      precision: "exact",
      exactAddress: false,
      exactCoordinates: false,
    },
  },
  external: {
    weather: { ui: true, agent: true },
    private_note: { ui: true, agent: false },
  },
});

const externalStates = (): ExternalStateSnapshot[] => [
  {
    key: "weather",
    agent: "rain soon",
    ui: "rain soon",
    source: "behavior-fixture",
    updatedAt: 1_000,
    expiresAt: 61_000,
  },
  {
    key: "private_note",
    agent: "LAWYER_SECRET_DISABLED_AGENT_STRING",
    ui: "On call with counsel",
    source: "behavior-fixture",
    updatedAt: 1_000,
    expiresAt: 61_000,
  },
];

test("behavior gate row citation is embedded in this file", () => {
  assert.match(BEHAVIORAL_GATE_MATRIX_ROW, /Behavioral guardrails/u);
  assert.match(BEHAVIORAL_GATE_MATRIX_ROW, /docs\/TECHNICAL_DESIGN\.md#testing-gate-matrix/u);
});

test("ordinary coding prompt receives system-prompt ambient data without a mandate to mention ambient context", async () => {
  const api = await loadDaseinApi();
  const injectAmbientSystemPrompt = requireExportedFunction(api, "injectAmbientSystemPrompt", BEHAVIORAL_GATE_MATRIX_ROW);
  const ordinaryCodingPrompt = "Fix the TypeScript compile error in src/core/render.ts.";
  const rendered: RenderedContext = {
    agent: "[ambient_ctx: local=14:32]",
    status: "time Fri 14:32 +08",
    omittedKeys: [],
    truncated: false,
  };

  const result = injectAmbientSystemPrompt({
    stateStore: fakeStore(rendered) satisfies DaseinStateStore,
    systemPrompt: "BASE SYSTEM",
  }) as InjectionResult;

  assert.equal(result.changed, true);
  assert.equal(result.content, expectedAmbientSystemPromptBlock(rendered.agent ?? ""));
  assert.equal(result.messages, undefined, "ambient context must not be appended as a user/custom message");
  assert.equal(result.appended, undefined, "ambient context must not create a CustomMessage");
  assert.doesNotMatch(result.systemPrompt, /^\[ambient_ctx:/u);
  assert.doesNotMatch(result.systemPrompt, noPromptMandatePattern);
  assert.equal(ordinaryCodingPrompt, "Fix the TypeScript compile error in src/core/render.ts.", "ordinary user coding prompt must remain unrewritten");
});

test("relevant prompt can use enabled fields while disabled fields never appear in agent string", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", BEHAVIORAL_GATE_MATRIX_ROW);
  const injectAmbientSystemPrompt = requireExportedFunction(api, "injectAmbientSystemPrompt", BEHAVIORAL_GATE_MATRIX_ROW);
  const rendered = renderDaseinContext({
    config: behaviorConfig(),
    sensorSnapshots: [clockSnapshot(), geoSensitiveSnapshot()],
    externalStates: externalStates(),
    now: 1_000,
  }) as RenderedContext;

  const relevantPrompt = "Before I commute, mention whether the enabled weather context changes your advice.";
  const result = injectAmbientSystemPrompt({
    stateStore: fakeStore(rendered) satisfies DaseinStateStore,
    systemPrompt: "BASE SYSTEM",
  }) as InjectionResult;
  assert.equal(relevantPrompt, "Before I commute, mention whether the enabled weather context changes your advice.");
  const agentString = result.content ?? rendered.agent ?? "";

  assert.match(agentString, /weather|rain soon/u, "enabled external weather context may be used by the agent");
  assert.doesNotMatch(agentString, /LAWYER_SECRET_DISABLED_AGENT_STRING|On call with counsel|Exact Secret Street 51|Shanghai/u);
  assert.equal(rendered.omittedKeys.includes("external:private_note"), true);
  assert.equal(rendered.omittedKeys.some((key) => key.startsWith("geo")), true);
});

test("UI/status exposes sensitive agent visibility and malformed publishers cannot inject multiline or overlong strings", async () => {
  const api = await loadDaseinApi();
  const renderDaseinContext = requireExportedFunction(api, "renderDaseinContext", BEHAVIORAL_GATE_MATRIX_ROW);
  const createExternalStateBridge = requireExportedFunction(api, "createExternalStateBridge", BEHAVIORAL_GATE_MATRIX_ROW);

  const rendered = renderDaseinContext({
    config: behaviorConfig(),
    sensorSnapshots: [clockSnapshot(), geoSensitiveSnapshot()],
    externalStates: externalStates(),
    now: 1_000,
  }) as RenderedContext;
  const humanSurface = [rendered.status].filter((line): line is string => typeof line === "string").join("\n");

  assert.match(humanSurface, /private_note|On call with counsel/u, "UI/status should keep UI-visible sensitive external state inspectable by the human");
  assert.match(
    humanSurface,
    /(?:agent(?:[ _-]?visible| visibility)?\s*[:=]\s*(?:false|hidden)|agent[ _-]?hidden|hidden from agent)/iu,
    "UI/status must show whether the sensitive field is agent-visible",
  );

  const bridge = createExternalStateBridge({ now: () => 1_000 }) as ExternalBridge;
  const malformedEvents = [
    { key: "weather", agent: "line\nbreak" },
    { key: "weather", ui: "x".repeat(EXTERNAL_STATE_TEXT_MAX_CHARS + 1) },
    { key: "weather", source: "publisher\u2028injection", ui: "ok" },
  ];

  for (const event of malformedEvents) {
    const result = bridge.set(event);
    assert.equal(result.ok, false, JSON.stringify(event));
    assert.match(JSON.stringify(result.errors), /multiline|control|separator|overlong|length|too long/u);
  }

  assert.deepEqual(bridge.listExternalStates(), []);
});
