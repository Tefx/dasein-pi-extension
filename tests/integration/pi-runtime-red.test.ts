import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import createDaseinExtension from "../../src/index.ts";
import {
  classifyFakePiSupport,
  convertFakeCustomMessageToLlmUserMessage,
  createFakePiHost,
  invokeFakeCommand,
  invokeFakeLifecycle,
  type FakePiHostFixture,
  type FakePiHostOptions,
  type FakePiMode,
} from "./fixtures/fake-pi-host.ts";

const FAKE_EVIDENCE_BOUNDARY = "fake-host-api-shape-only";

type MutableContextEvent = {
  readonly messages: unknown[];
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

const messageContent = (value: unknown): string => {
  const record = objectRecord(value);
  assert.equal(record.role, "custom");
  assert.equal(record.customType, "dasein");
  assert.equal(record.display, false);
  assert.equal(typeof record.timestamp, "number");
  const converted = convertFakeCustomMessageToLlmUserMessage(value);
  assert.equal(converted.role, "user");
  return converted.content;
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
  const host = await registerInFakeHost({}, "tui", {
    unavailableMechanisms: ["custom", "setWidget"],
  });

  await invokeFakeLifecycle(host, "session_start");
  const statusResult = objectRecord(await invokeFakeCommand(host, "dasein", "status"));
  const data = objectRecord(statusResult.data);

  assert.deepEqual(
    host.ledger.featureProbes.map((probe) => [probe.mechanism, probe.available]),
    [
      ["registerCommand", true],
      ["registerFlag", true],
      ["context", true],
      ["events", true],
      ["setStatus", true],
      ["setWidget", false],
      ["custom", false],
      ["SettingsList", true],
    ],
  );
  assert.match(JSON.stringify(data.statusErrors), /PiMechanismError|setWidget|custom/u);
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

test("[expected-red] Pi lifecycle wiring registers startup, shutdown, request, input, before-agent-start, and agent-end hooks", async () => {
  const host = await registerInFakeHost();
  const eventNames = host.ledger.lifecycleHandlers.map((handler) => handler.eventName).sort();

  assert.deepEqual(eventNames, [
    "agent_end",
    "before_agent_start",
    "context",
    "input",
    "session_shutdown",
    "session_start",
  ]);
});

test("[expected-red] /dasein slash command and --dasein flag drive runtime behavior in the fake host", async () => {
  const host = await registerInFakeHost({
    dasein: "core.statusEnabled=false,core.widgetEnabled=false,sensors.clock.precision=hour",
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
  assert.deepEqual(host.ledger.uiWidgetCalls.at(-1), { slot: "dasein", value: undefined });
});

test("[expected-red] context hook appends a hidden Dasein CustomMessage converted from rendered memory only", async () => {
  const host = await registerInFakeHost();
  await invokeFakeLifecycle(host, "session_start");

  const contextEvent: MutableContextEvent = { messages: [] };
  await invokeFakeLifecycle(host, "context", contextEvent);

  assert.equal(contextEvent.messages.length, 1);
  const content = messageContent(contextEvent.messages[0]);
  assert.match(content, /^\[ambient_ctx:/u);
});

test("[expected-red] pi.events external state updates are subscribed, sanitized, and reflected through context", async () => {
  const host = await registerInFakeHost();
  await invokeFakeLifecycle(host, "session_start");

  host.pi.events.emit("dasein:state:set", {
    key: "weather",
    agent: "rain soon",
    ui: "weather rain soon",
    source: "test-fixture",
    ttlMs: 60_000,
  });

  const contextEvent: MutableContextEvent = { messages: [] };
  await invokeFakeLifecycle(host, "context", contextEvent);

  assert.equal(contextEvent.messages.length, 1);
  assert.match(messageContent(contextEvent.messages[0]), /weather|rain/u);
});

test("[expected-red] TUI session start publishes status and widget only through ctx.ui in tui mode", async () => {
  const host = await registerInFakeHost();

  await invokeFakeLifecycle(host, "session_start");

  assert.equal(host.ledger.uiStatusCalls.length > 0, true, "session_start should set dasein status");
  assert.equal(host.ledger.uiWidgetCalls.length > 0, true, "session_start should set dasein widget");
  assert.equal(host.ledger.uiStatusCalls.every((call) => call.slot === "dasein"), true);
  assert.equal(host.ledger.uiWidgetCalls.every((call) => call.slot === "dasein"), true);
});

test("[expected-red] /dasein opens a SettingsList-backed TUI surface with metadata before controls", async () => {
  const host = await registerInFakeHost();
  await invokeFakeLifecycle(host, "session_start");

  await invokeFakeCommand(host, "dasein", "");

  assert.equal(host.ledger.uiCustomCalls.length, 1, "bare /dasein should call ctx.ui.custom in TUI mode");
  assert.deepEqual(host.ledger.uiCustomCalls[0]?.optionKeys, ["component", "overlay", "title"]);
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

test("[expected-red] builtin clock/geo/lapse wiring starts sensors and routes lapse Pi lifecycle observations", async () => {
  const host = await registerInFakeHost();

  await invokeFakeLifecycle(host, "session_start");
  await invokeFakeLifecycle(host, "input", { text: "hello", timestamp: 1_000, turnId: "turn-1" });
  await invokeFakeLifecycle(host, "before_agent_start", { timestamp: 1_001, turnId: "turn-1" });
  await invokeFakeLifecycle(host, "agent_end", { timestamp: 4_000, turnId: "turn-1" });
  await invokeFakeLifecycle(host, "input", { text: "again", timestamp: 10_000, turnId: "turn-2" });

  const renderedStatus = host.ledger.uiStatusCalls.map((call) => call.value ?? "").join("\n");
  const renderedWidget = host.ledger.uiWidgetCalls.map((call) => call.value).join("\n");
  const renderedTui = `${renderedStatus}\n${renderedWidget}`;

  assert.match(renderedTui, /time|clock/u, "clock builtin should render local time in TUI");
  assert.match(renderedTui, /loc=unavailable|geo|location/u, "geo builtin should expose permission/availability in UI");
  assert.match(renderedTui, /idle|lapse|user_idle/u, "lapse builtin should render lifecycle-derived continuity");
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
  assert.deepEqual(host.ledger.uiWidgetCalls.at(-1), { slot: "dasein", value: undefined });
});
