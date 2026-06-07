import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import createDaseinExtension from "../../src/index.ts";
import {
  classifyFakePiSupport,
  createFakePiHost,
  invokeFakeCommand,
  invokeFakeLifecycle,
  type FakePiHostFixture,
  type FakePiHostOptions,
  type FakePiMode,
} from "./fixtures/fake-pi-host.ts";

const FAKE_EVIDENCE_BOUNDARY = "fake-host-api-shape-only";

type MutableBeforeAgentStartEvent = {
  systemPrompt?: string;
  messages?: unknown[];
  timestamp?: number;
  turnId?: string;
};

const registerInFakeHost = async (
  flags: Readonly<Record<string, string | undefined>> = {},
  mode: FakePiMode = "tui",
  options: FakePiHostOptions = {},
): Promise<FakePiHostFixture> => {
  const host = createFakePiHost(mode, flags, options);
  await createDaseinExtension(host.pi);
  return host;
};

const objectRecord = (value: unknown): Record<string, unknown> => {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
};

const ambientSystemPromptContent = async (host: FakePiHostFixture, event: MutableBeforeAgentStartEvent = {}): Promise<string> => {
  event.systemPrompt ??= "BASE SYSTEM";
  event.messages ??= [];
  await invokeFakeLifecycle(host, "before_agent_start", event);
  assert.equal(event.messages.length, 0, "Dasein ambient context must not append user/custom messages");
  assert.equal(typeof event.systemPrompt, "string");
  return event.systemPrompt;
};

test("[expected-red] fake-host evidence remains fake and never records a live Pi support claim", async () => {
  const host = await registerInFakeHost();

  assert.equal(FAKE_EVIDENCE_BOUNDARY, "fake-host-api-shape-only");
  assert.equal(
    "LIVE_SMOKE_VERIFIED" in host.ledger,
    false,
    "fake_host ledger must not contain live-smoke verification status fields",
  );
});

test("fake-host evidenceStatuses preserve source/API/live-pending separation without live support claims", async () => {
  const host = await registerInFakeHost();
  const customEvidence = host.evidence.find((entry) => entry.mechanism === "custom");
  const commandEvidence = host.evidence.find((entry) => entry.mechanism === "registerCommand");

  assert.deepEqual(commandEvidence?.evidenceStatuses, ["SOURCE_VERIFIED", "LIVE_SMOKE_PENDING"]);
  assert.deepEqual(customEvidence?.evidenceStatuses, ["API_VERIFIED", "LIVE_SMOKE_PENDING"]);
  assert.equal(host.evidence.every((entry) => entry.liveSupportClaim === false), true);
  assert.equal(host.evidence.some((entry) => entry.evidenceStatuses.includes("LIVE_SMOKE_VERIFIED")), false);
});

test("ordinary npm test discovery excludes live Pi smoke while keeping fake-host integration runnable", () => {
  const runner = readFileSync("scripts/run-non-native-tests.mjs", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    readonly scripts: Readonly<Record<string, string>>;
  };

  assert.match(packageJson.scripts.test, /run-non-native-tests/u);
  assert.match(runner, /tests\/integration/u);
  assert.doesNotMatch(runner, /tests\/smoke/u);
});

test("[expected-red] startup probes Pi APIs and fail-closes status for unavailable mechanisms", async () => {
  const host = await registerInFakeHost({ dasein: "core.statusDetail=quiet" }, "tui", {
    unavailableMechanisms: ["custom"],
  });

  await invokeFakeLifecycle(host, "session_start");
  const statusResult = objectRecord(await invokeFakeCommand(host, "dasein", "status"));
  const data = objectRecord(statusResult.data);

  assert.deepEqual(
    host.ledger.featureProbes.map((probe) => [probe.mechanism, probe.available]),
    [
      ["registerCommand", true],
      ["registerFlag", true],
      ["before_agent_start", true],
      ["events", true],
      ["setStatus", true],
      ["custom", false],
      ["SettingsList", true],
    ],
  );
  assert.match(JSON.stringify(data.statusErrors), /PiMechanismError|custom/u);
  assert.doesNotMatch(JSON.stringify(data.statusErrors), /setWidget/u);
  assert.match(host.ledger.uiStatusCalls.at(-1)?.value ?? "", /^! degraded 1$/u, "quiet statusbar must surface degraded runtime state");
});

test("[expected-red] Pi version status captures minimum/current/classification independently from API probes", async () => {
  assert.equal(classifyFakePiSupport(null), "unavailable");
  assert.equal(classifyFakePiSupport("0.78.0"), "below-minimum");
  assert.equal(classifyFakePiSupport("0.78.1"), "supported-version-feature-probes-still-required");

  const host = await registerInFakeHost({}, "tui", { piVersion: "0.78.0" });
  const statusResult = objectRecord(await invokeFakeCommand(host, "dasein", "status"));
  const data = objectRecord(statusResult.data);

  assert.equal(data.minimumPiVersion, host.minimumPiVersion);
  assert.equal(data.piVersion, "0.78.0");
  assert.equal(data.piSupportClassification, "below-minimum");
  assert.match(JSON.stringify(data.piMechanisms), /evidenceStatuses/u);
  assert.equal(host.ledger.featureProbes.length, 0, "version capture must not be collapsed into API probe evidence");
});

test("[expected-red] Pi lifecycle wiring registers startup, shutdown, input, before-agent-start, and agent-end hooks", async () => {
  const host = await registerInFakeHost();
  const eventNames = host.ledger.lifecycleHandlers.map((handler) => handler.eventName).sort();

  assert.deepEqual(eventNames, [
    "agent_end",
    "before_agent_start",
    "input",
    "session_shutdown",
    "session_start",
  ]);
});

test("no-config/no-launch startup does not publish a Dasein widget", async () => {
  const host = await registerInFakeHost();

  await invokeFakeLifecycle(host, "session_start");

  assert.equal(host.ledger.uiWidgetCalls.some((call) => call.slot === "dasein"), false, "Dasein must not use a persistent widget surface");
});

test("status detail launch setting suppresses readiness and raw clock/debug status", async () => {
  const host = await registerInFakeHost({ dasein: "core.statusDetail=summary" });

  await invokeFakeLifecycle(host, "session_start");

  const value = host.ledger.uiStatusCalls.at(-1)?.value;
  if (value !== undefined) {
    assert.equal(visibleWidth(value) <= 80, true, "summary status must stay compact for split terminal layouts");
    assert.doesNotMatch(value, /Dasein · Ready|epoch_ms|utc_offset|\[ambient_ctx:|"city":/u);
  }
  assert.equal(host.ledger.uiStatusCalls.some((call) => /Dasein · Ready|epoch_ms|utc_offset|\[ambient_ctx:|"city":/u.test(call.value ?? "")), false);
});

test("[expected-red] /dasein slash command and --dasein flag drive runtime behavior in the fake host", async () => {
  const host = await registerInFakeHost({
    dasein: "core.statusEnabled=false,sensors.clock.precision=hour",
  });

  assert.deepEqual(
    host.ledger.flags.map((flag) => [flag.name, flag.type]),
    [["dasein", "string"]],
  );
  const daseinCommand = host.ledger.commands.find((command) => command.name === "dasein");
  assert.equal(daseinCommand?.rawArgsSupported, true);
  assert.equal(daseinCommand?.completionsSupported, true);

  await invokeFakeLifecycle(host, "session_start");
  const commandResult = await invokeFakeCommand(host, "dasein", "status");

  assert.notEqual(commandResult, undefined, "slash command handler should return a status/help result");
  assert.deepEqual(host.ledger.uiStatusCalls.at(-1), { slot: "dasein", value: undefined });
  assert.equal(host.ledger.uiWidgetCalls.some((call) => call.slot === "dasein"), false);
});

test("[expected-red] before_agent_start appends Dasein ambient context to system prompt only", async () => {
  const host = await registerInFakeHost();
  await invokeFakeLifecycle(host, "session_start");

  const event: MutableBeforeAgentStartEvent = { systemPrompt: "BASE SYSTEM", messages: [], timestamp: 1_001, turnId: "turn-1" };
  const results = await invokeFakeLifecycle(host, "before_agent_start", event);

  assert.equal(event.messages?.length, 0);
  assert.equal(objectRecord(results[0]).systemPrompt, event.systemPrompt);
  assert.match(event.systemPrompt ?? "", /^BASE SYSTEM\n\n<DaseinAmbientContext>/u);
  assert.match(event.systemPrompt ?? "", /local=/u);
  assert.doesNotMatch(event.systemPrompt ?? "", /^\[ambient_ctx:/u);
});

test("pi.events external state keeps unconfigured agent payload hidden until ConfigManager-owned visibility enables it", async () => {
  const defaultHiddenHost = await registerInFakeHost();
  await invokeFakeLifecycle(defaultHiddenHost, "session_start");

  defaultHiddenHost.pi.events.emit("dasein:state:set", {
    key: "weather",
    agent: "rain soon",
    ui: "weather rain soon",
    source: "test-fixture",
    ttlMs: 60_000,
  });

  const hiddenContext = await ambientSystemPromptContent(defaultHiddenHost);

  assert.doesNotMatch(hiddenContext, /weather|rain/u);

  const launchVisibleHost = await registerInFakeHost({ dasein: "external.weather.agent=true" });
  await invokeFakeLifecycle(launchVisibleHost, "session_start");
  launchVisibleHost.pi.events.emit("dasein:state:set", {
    key: "weather",
    agent: "rain soon",
    ui: "weather rain soon",
    source: "test-fixture",
    ttlMs: 60_000,
  });

  const visibleContext = await ambientSystemPromptContent(launchVisibleHost);

  assert.match(visibleContext, /weather=rain soon/u);
});

test("summary statusbar shows agent-visible external context after a lifecycle publish", async () => {
  const host = await registerInFakeHost({ dasein: "core.statusDetail=summary,external.weather.agent=true" });
  await invokeFakeLifecycle(host, "session_start");

  host.pi.events.emit("dasein:state:set", {
    key: "weather",
    agent: "rain soon",
    ui: "rain soon",
    source: "test-fixture",
    ttlMs: 60_000,
  });
  await invokeFakeLifecycle(host, "input", { text: "hello", timestamp: 10_000, turnId: "turn-weather" });

  const value = host.ledger.uiStatusCalls.at(-1)?.value ?? "";
  assert.match(value, /weather rain soon/u);
  assert.doesNotMatch(value, /\(agent hidden\)|Dasein · Ready|ambient_ctx|time Fri|utc_offset/u);
});

test("pi.events malformed Unicode-separator external updates preserve previous state without mutation", async () => {
  const host = await registerInFakeHost({ dasein: "external.weather.agent=true" });
  await invokeFakeLifecycle(host, "session_start");

  host.pi.events.emit("dasein:state:set", {
    key: "weather",
    agent: "safe rain",
    ui: "safe weather",
    source: "test-fixture",
    ttlMs: 60_000,
  });

  for (const separator of ["\u2028", "\u2029"] as const) {
    host.pi.events.emit("dasein:state:set", {
      key: "weather",
      agent: `bad${separator}rain`,
      ui: "bad weather",
      source: "test-fixture",
      ttlMs: 60_000,
    });
  }

  const content = await ambientSystemPromptContent(host);
  assert.match(content, /weather=safe rain/u);
  assert.doesNotMatch(content, /bad|weather=bad/u);
});

test("[expected-red] TUI session start publishes status only through ctx.ui in tui mode", async () => {
  const host = await registerInFakeHost();

  await invokeFakeLifecycle(host, "session_start");

  assert.equal(host.ledger.uiStatusCalls.length > 0, true, "session_start should set dasein status");
  assert.equal(host.ledger.uiWidgetCalls.some((call) => call.slot === "dasein"), false, "session_start must not set a Dasein widget");
  assert.equal(host.ledger.uiStatusCalls.every((call) => call.slot === "dasein"), true);
});

test("[expected-red] /dasein opens a SettingsList-backed TUI surface with metadata before controls", async () => {
  const host = await registerInFakeHost();
  await invokeFakeLifecycle(host, "session_start");

  await invokeFakeCommand(host, "dasein", "");

  assert.equal(host.ledger.uiCustomCalls.length, 1, "bare /dasein should call ctx.ui.custom in TUI mode");
  assert.deepEqual(host.ledger.uiCustomCalls[0]?.optionKeys, ["component", "overlay", "overlayOptions", "title"]);
});

test("/dasein inspect agent opens an explicit TUI inspector instead of a persistent widget", async () => {
  const host = await registerInFakeHost({ dasein: "external.weather.agent=true" });
  await invokeFakeLifecycle(host, "session_start");

  host.pi.events.emit("dasein:state:set", {
    key: "weather",
    agent: "rain soon",
    ui: "rain soon",
    source: "test-fixture",
    ttlMs: 60_000,
  });
  await ambientSystemPromptContent(host);
  const result = objectRecord(await invokeFakeCommand(host, "dasein", "inspect agent"));

  assert.equal(result.ok, true);
  assert.equal(result.command, "inspect");
  assert.notEqual(result.message, "dasein inspect agent: ok");
  assert.match(String(result.message), /DaseinAmbientContext|rain soon/u);
  assert.match(JSON.stringify(result.data), /systemPromptBlock|pre-rendered-memory|rain soon/u);
  assert.equal(host.ledger.uiCustomCalls.length, 1, "explicit inspect command should open a TUI custom diagnostic surface");
  assert.deepEqual(host.ledger.uiCustomCalls[0]?.optionKeys, ["component", "overlay", "overlayOptions", "title"]);
  assert.equal(host.ledger.uiWidgetCalls.some((call) => call.slot === "dasein"), false, "inspect must not reintroduce persistent Dasein widgets");
});

test("[expected-red] bare /dasein outside TUI falls back to deterministic help/status without config mutation", async () => {
  const host = await registerInFakeHost({}, "rpc");

  const result = objectRecord(await invokeFakeCommand(host, "dasein", ""));

  assert.equal(result.ok, true);
  assert.equal(result.command, "help");
  assert.match(String(result.message), /^dasein: /u);
  assert.equal(host.ledger.uiCustomCalls.length, 0);
  assert.equal(host.ledger.configMutations.length, 0);
});

test("[expected-red] ctx.ui.custom unavailability is separate from SettingsList and fail-closes status", async () => {
  const host = await registerInFakeHost({}, "tui", {
    unavailableMechanisms: ["custom"],
    customAvailable: false,
  });

  await invokeFakeLifecycle(host, "session_start");
  await invokeFakeCommand(host, "dasein", "");
  const statusResult = objectRecord(await invokeFakeCommand(host, "dasein", "status"));

  assert.equal(host.ledger.uiCustomCalls.length, 0, "unavailable ctx.ui.custom must not be recorded as rendered");
  assert.match(JSON.stringify(statusResult), /PiMechanismError|ctx\.ui\.custom|custom unavailable/u);
});

test("[expected-red] builtin clock/geo/lapse wiring starts sensors while default visible TUI stays quiet", async () => {
  const host = await registerInFakeHost();

  await invokeFakeLifecycle(host, "session_start");
  await invokeFakeLifecycle(host, "input", { text: "hello", timestamp: 1_000, turnId: "turn-1" });
  const beforeAgentEvent: MutableBeforeAgentStartEvent = { systemPrompt: "BASE SYSTEM", messages: [], timestamp: 1_001, turnId: "turn-1" };
  await invokeFakeLifecycle(host, "before_agent_start", beforeAgentEvent);
  await invokeFakeLifecycle(host, "agent_end", { timestamp: 4_000, turnId: "turn-1" });
  await invokeFakeLifecycle(host, "input", { text: "again", timestamp: 10_000, turnId: "turn-2" });

  const renderedStatus = host.ledger.uiStatusCalls.map((call) => call.value ?? "").join("\n");

  assert.equal(/Dasein · Ready/u.test(renderedStatus), false, "default quiet TUI status must not waste footer space on readiness text");
  assert.doesNotMatch(renderedStatus, /epoch_ms|utc_offset|"city":/u, "default visible TUI status must not expose raw clock/debug JSON");
  assert.doesNotMatch(renderedStatus, /\[ambient_ctx:|epoch_ms|clock\.iso|agent_id|manifest digest|user_idle=|loc=/u, "default visible TUI must not expose raw ambient/debug context");

  const hiddenContext = beforeAgentEvent.systemPrompt ?? "";
  assert.equal(beforeAgentEvent.messages?.length, 0, "agent-facing ambient context must not append user/custom messages");
  assert.match(hiddenContext, /<DaseinAmbientContext>\nLocal ambient context for relevance only\./u, "agent-facing ambient context must remain available through system prompt context");
  assert.doesNotMatch(hiddenContext, /^\[ambient_ctx:/u, "agent-facing ambient context must not use the raw visible ambient_ctx wrapper");
});

test("[expected-red] session_shutdown routes bounded cleanup with 1000ms per-sensor timeout", async () => {
  const host = await registerInFakeHost();

  await invokeFakeLifecycle(host, "session_start");
  await invokeFakeLifecycle(host, "session_shutdown");

  assert.deepEqual(host.ledger.cleanupCalls, [
    { sensorKey: "clock", timeoutMs: 1000 },
    { sensorKey: "geo", timeoutMs: 1000 },
    { sensorKey: "lapse", timeoutMs: 1000 },
  ]);
  assert.deepEqual(host.ledger.uiStatusCalls.at(-1), { slot: "dasein", value: undefined });
  assert.equal(host.ledger.uiWidgetCalls.some((call) => call.slot === "dasein"), false);
});
