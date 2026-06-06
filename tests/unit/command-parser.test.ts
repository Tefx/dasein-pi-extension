import assert from "node:assert/strict";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

type ParsedCommand = {
  kind: string;
  path?: string;
  value?: unknown;
  assignments?: Array<{ inputPath: string; canonicalPath: string; value: unknown }>;
  sensorKey?: string;
  action?: string;
  actionArgs?: string[];
  target?: "agent";
};

test("/dasein help is a core command before sensor routing and preserves deterministic parser output", async () => {
  const api = await loadDaseinApi();
  const parseDaseinCommand = requireExportedFunction(api, "parseDaseinCommand", "Testing Gate Matrix row: Command parser and result typing");

  assert.deepEqual(parseDaseinCommand("/dasein help", { discoveredSensorKeys: ["help", "geo"] }), { ok: true, command: { kind: "help" } });
  assert.deepEqual(parseDaseinCommand("/dasein status", { discoveredSensorKeys: ["status", "geo"] }), { ok: true, command: { kind: "status" } });
  assert.deepEqual(parseDaseinCommand("/dasein inspect agent", { discoveredSensorKeys: ["inspect", "geo"] }), { ok: true, command: { kind: "inspect", target: "agent" } });
  assert.deepEqual(parseDaseinCommand("/dasein geo tag add \"home base\" 120", { discoveredSensorKeys: ["geo"] }), {
    ok: true,
    command: { kind: "sensor-action", sensorKey: "geo", action: "tag", actionArgs: ["add", "home base", "120"] },
  });
});

test("command assignments normalize paths, preserve order, coerce values, and reject duplicates before mutation", async () => {
  const api = await loadDaseinApi();
  const parseDaseinCommand = requireExportedFunction(api, "parseDaseinCommand", "Testing Gate Matrix row: Command parser and result typing");
  const parsed = parseDaseinCommand("/dasein apply geo.agent=on, core.maxAgentChars=40, external.weather.ui=false,clock.precision=\"hour\"", {
    discoveredSensorKeys: ["clock", "geo", "lapse"],
  }) as { ok: true; command: ParsedCommand };

  assert.deepEqual(parsed.command.assignments, [
    { inputPath: "geo.agent", canonicalPath: "sensors.geo.agent", value: true },
    { inputPath: "core.maxAgentChars", canonicalPath: "core.maxAgentChars", value: 40 },
    { inputPath: "external.weather.ui", canonicalPath: "external.weather.ui", value: false },
    { inputPath: "clock.precision", canonicalPath: "sensors.clock.precision", value: "hour" },
  ]);

  assert.deepEqual(parseDaseinCommand("/dasein apply geo.agent=on,sensors.geo.agent=off", { discoveredSensorKeys: ["geo"] }), {
    ok: false,
    errors: [{ kind: "command_parse", code: "duplicate-path", path: "sensors.geo.agent" }],
  });
});

test("value grammar rejects invalid numbers, bare separators, invalid escapes, controls, and unicode separators", async () => {
  const api = await loadDaseinApi();
  const parseDaseinCommand = requireExportedFunction(api, "parseDaseinCommand", "Testing Gate Matrix row: Command parser and result typing");

  for (const input of [
    "/dasein set core.maxAgentChars +40",
    "/dasein set core.maxAgentChars 01",
    "/dasein set core.maxAgentChars 1e3",
    "/dasein set core.maxAgentChars NaN",
    "/dasein set core.injectedLabel bad=value",
    "/dasein set core.injectedLabel bad,value",
    "/dasein set core.injectedLabel \"bad\\n\"",
    "/dasein set core.injectedLabel \"unterminated",
    "/dasein set core.injectedLabel line\u2028separator",
  ]) {
    const result = parseDaseinCommand(input, { discoveredSensorKeys: ["clock", "geo", "lapse"] }) as { ok: boolean; errors?: unknown[] };
    assert.equal(result.ok, false, input);
    assert.match(JSON.stringify(result.errors), /command_parse/u);
  }
});
