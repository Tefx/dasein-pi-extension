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

test("help command exposes deterministic command text without mutating runtime state", async () => {
  const api = await loadDaseinApi();
  const executeDaseinCommand = requireExportedFunction(api, "executeDaseinCommand", "Testing Gate Matrix row: Command parser and result typing");
  const result = await executeDaseinCommand("/dasein help", { discoveredSensorKeys: ["geo"] }) as { ok: boolean; command: string; message: string; data?: unknown };

  assert.equal(result.ok, true);
  assert.equal(result.command, "help");
  assert.match(result.message, /^dasein help:/u);
  assert.match(JSON.stringify(result.data), /status.*reload.*sensors.*set.*apply.*help/u);
  assertSingleLine(result.message, "help message");
});
