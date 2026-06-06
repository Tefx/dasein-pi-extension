import assert from "node:assert/strict";
import test from "node:test";

import createDaseinExtension from "../../src/index.ts";
import {
  createFakePiHost,
  invokeFakeCommand,
  invokeFakeLifecycle,
  type FakePiHostFixture,
} from "./fixtures/fake-pi-host.ts";

const FAKE_EVIDENCE_BOUNDARY = "fake-host-api-shape-only";

type MutableContextEvent = {
  readonly messages: unknown[];
};

const registerInFakeHost = async (
  flags: Readonly<Record<string, string | undefined>> = {},
): Promise<FakePiHostFixture> => {
  const host = createFakePiHost("tui", flags);
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
  const content = record.content;
  if (typeof content !== "string") {
    throw new TypeError("expected hidden custom message content to be a string");
  }
  return content;
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

test("[expected-red] Pi lifecycle wiring registers startup, shutdown, request, input, and agent-end hooks", async () => {
  const host = await registerInFakeHost();
  const eventNames = host.ledger.lifecycleHandlers.map((handler) => handler.eventName).sort();

  assert.deepEqual(eventNames, [
    "agent_end",
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

test("[expected-red] builtin clock/geo/lapse wiring starts sensors and routes lapse Pi lifecycle observations", async () => {
  const host = await registerInFakeHost();

  await invokeFakeLifecycle(host, "session_start");
  await invokeFakeLifecycle(host, "input", { text: "hello", timestamp: 1_000 });
  await invokeFakeLifecycle(host, "agent_end", { timestamp: 4_000 });
  await invokeFakeLifecycle(host, "input", { text: "again", timestamp: 10_000 });

  const renderedStatus = host.ledger.uiStatusCalls.map((call) => call.value ?? "").join("\n");
  const renderedWidget = host.ledger.uiWidgetCalls.map((call) => call.value).join("\n");
  const renderedTui = `${renderedStatus}\n${renderedWidget}`;

  assert.match(renderedTui, /time|clock/u, "clock builtin should render local time in TUI");
  assert.match(renderedTui, /loc=unavailable|geo|location/u, "geo builtin should expose permission/availability in UI");
  assert.match(renderedTui, /idle|lapse|user_idle/u, "lapse builtin should render lifecycle-derived continuity");
});
