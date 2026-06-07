import assert from "node:assert/strict";
import test from "node:test";

import { assertSingleLine, loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("command results are deterministic typed objects before text formatting", async () => {
  const api = await loadDaseinApi();
  const makeDaseinCommandResult = requireExportedFunction(api, "makeDaseinCommandResult", "Testing Gate Matrix row: Command parser and result typing");

  const ok = makeDaseinCommandResult({ command: "set", updatedPaths: ["sensors.clock.precision"], data: { canonicalPath: "sensors.clock.precision" } }) as {
    ok: boolean;
    command: string;
    message: string;
    updatedPaths: string[];
    deletedPaths: string[];
    errors?: [];
  };

  assert.equal(ok.ok, true);
  assert.equal(ok.command, "set");
  assert.equal(ok.message, "updated sensors.clock.precision");
  assert.deepEqual(ok.updatedPaths, ["sensors.clock.precision"]);
  assert.deepEqual(ok.deletedPaths, []);
  assert.deepEqual(ok.errors, []);
  assertSingleLine(ok.message, "set message");
});

test("parse failures return CommandParseError and never reach mutation or sensor actions", async () => {
  const api = await loadDaseinApi();
  const executeDaseinCommand = requireExportedFunction(api, "executeDaseinCommand", "Testing Gate Matrix row: Command parser and result typing");
  const calls: string[] = [];

  const result = await executeDaseinCommand("/dasein apply geo.agent=on,sensors.geo.agent=off", {
    discoveredSensorKeys: ["geo"],
    mutateConfig: () => calls.push("mutate"),
    runSensorAction: () => calls.push("action"),
  }) as { ok: boolean; command: string; errors: unknown[]; message: string };

  assert.equal(result.ok, false);
  assert.equal(result.command, "apply");
  assert.match(JSON.stringify(result.errors), /command_parse.*duplicate-path/u);
  assert.deepEqual(calls, []);
  assertSingleLine(result.message, "parse failure message");
});

test("sensor action command data exposes mutation proposals without top-level mutation results", async () => {
  const api = await loadDaseinApi();
  const executeDaseinCommand = requireExportedFunction(api, "executeDaseinCommand", "SensorActionCommandData mutationProposal contract");

  const result = await executeDaseinCommand("/dasein geo tag home", {
    discoveredSensorKeys: ["geo"],
    sensorActions: { geo: ["tag"] },
    runSensorAction: () => ({
      ok: true,
      message: "tag proposal ready",
      refreshScheduled: true,
      mutation: { assignments: { "sensors.geo.tags.home": { lat: 1, lon: 2, radius_m: 50 } } },
      data: { applied: false },
    }),
  }) as { ok: boolean; command: string; data: { mutation?: unknown; mutationProposal?: unknown; actionPayload?: unknown; refreshScheduled: boolean } };

  assert.equal(result.ok, true);
  assert.equal(result.command, "sensor-action");
  assert.equal("mutation" in result.data, false);
  assert.deepEqual(result.data.mutationProposal, { assignments: { "sensors.geo.tags.home": { lat: 1, lon: 2, radius_m: 50 } } });
  assert.deepEqual(result.data.actionPayload, { applied: false });
  assert.equal(result.data.refreshScheduled, true);
});

test("help command exposes deterministic command text without mutating runtime state", async () => {
  const api = await loadDaseinApi();
  const executeDaseinCommand = requireExportedFunction(api, "executeDaseinCommand", "Testing Gate Matrix row: Command parser and result typing");
  const result = await executeDaseinCommand("/dasein help", { discoveredSensorKeys: ["geo"] }) as { ok: boolean; command: string; message: string; data?: unknown };

  assert.equal(result.ok, true);
  assert.equal(result.command, "help");
  assert.match(result.message, /^dasein help:/u);
  assert.match(JSON.stringify(result.data), /status.*reload.*sensors.*inspect.*set.*apply.*help/u);
  assertSingleLine(result.message, "help message");
});

test("inspect agent command returns the exact pre-rendered system prompt block", async () => {
  const api = await loadDaseinApi();
  const executeDaseinCommand = requireExportedFunction(api, "executeDaseinCommand", "Testing Gate Matrix row: Command parser and result typing");
  const formatAgentInspectCommandLines = requireExportedFunction(api, "formatAgentInspectCommandLines", "explicit /dasein inspect agent diagnostics");
  const result = await executeDaseinCommand("/dasein inspect agent", {
    inspectAgent: {
      rendered: { agent: "[ambient_ctx: local=14:32; idle=7h]", omittedKeys: ["geo.lat"], truncated: true },
      agentInjectionEnabled: true,
      injectedLabel: "ambient_ctx",
    },
  }) as { ok: boolean; command: string; message: string; data: { systemPromptBlock: string | null; renderedAgent: string | null; source: string; omittedKeys: string[]; truncated: boolean } };

  assert.equal(result.ok, true);
  assert.equal(result.command, "inspect");
  assert.equal(result.data.source, "pre-rendered-memory");
  assert.equal(result.data.renderedAgent, "[ambient_ctx: local=14:32; idle=7h]");
  assert.match(result.data.systemPromptBlock ?? "", /<DaseinAmbientContext>\n[\s\S]*local=14:32; idle=7h\n<\/DaseinAmbientContext>/u);
  assert.deepEqual(result.data.omittedKeys, ["geo.lat"]);
  assert.equal(result.data.truncated, true);
  assertSingleLine(result.message, "inspect message");
  assert.notEqual(result.message, "dasein inspect agent: ok", "visible inspect message must not collapse to a useless ok toast");
  assert.match(result.message, /<DaseinAmbientContext>.*local=14:32; idle=7h/u);
  const lines = formatAgentInspectCommandLines(result.data) as string[];
  const text = lines.join("\n");
  assert.match(text, /systemPromptBlock:\n<DaseinAmbientContext>\n[\s\S]*local=14:32; idle=7h/u);
  assert.doesNotMatch(text, /renderedAgent:/u, "human-facing inspect lines must not duplicate the same payload twice");
});

test("agent inspect overlay hides duplicate renderer payload and supports close/scroll keys", async () => {
  const api = await loadDaseinApi();
  const createAgentInspectOverlayComponent = requireExportedFunction(api, "createAgentInspectOverlayComponent", "explicit /dasein inspect agent TUI overlay behavior");
  let renders = 0;
  let closed = 0;
  const component = createAgentInspectOverlayComponent({
    data: {
      target: "agent",
      source: "pre-rendered-memory",
      agentInjectionEnabled: true,
      injectedLabel: "ambient_ctx",
      renderedAgent: "[ambient_ctx: local=14:32; weather=rain]",
      systemPromptBlock: [
        "<DaseinAmbientContext>",
        "Local ambient context for relevance only.",
        ...Array.from({ length: 12 }, (_value, index) => `line-${index}`),
        "</DaseinAmbientContext>",
      ].join("\n"),
      truncated: false,
      omittedKeys: [],
    },
    maxBodyLines: 8,
    requestRender: () => { renders += 1; },
    done: () => { closed += 1; },
  }) as { render(width: number): string[]; handleInput(data: string): void };

  const initial = component.render(100).join("\n");
  assert.match(initial, /↑↓ scroll • PgUp\/PgDn page • Home\/End jump • Esc\/q close/u);
  assert.doesNotMatch(initial, /mouse unsupported/u);
  assert.match(initial, /systemPromptBlock:/u);
  assert.doesNotMatch(initial, /renderedAgent:/u);

  component.handleInput("\x1b[B");
  assert.equal(renders, 1, "down arrow should scroll and request a re-render");
  component.handleInput("\x1b[6~");
  assert.equal(renders > 1, true, "pageDown should page and request a re-render");
  component.handleInput("\x1b");
  assert.equal(closed, 1, "escape should close the inspect overlay");
});
