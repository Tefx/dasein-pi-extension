import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const readText = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("src/core/injector.ts import surface is limited to in-memory state/rendered-context types", () => {
  const source = stripComments(readText("src/core/injector.ts"));
  const imports = [...source.matchAll(/^import\s+(?:type\s+)?[^;]+from\s+["']([^"']+)["'];/gm)].map((match) => match[1]);
  assert.deepEqual(imports, ["./types.ts"]);
  assert.match(source, /DaseinStateStore|RenderedContext/u);
  assert.doesNotMatch(source, /config|sensor-loader|sensor-runtime|external-events|lifecycle|renderer/u);
});

test("request-path dependencies reject disk, subprocess, network, dynamic import, sensor work, config mutation, durable state, and native/helper tokens", () => {
  const requestPathFiles = ["src/core/injector.ts"];
  const forbidden = /\b(?:readFile|writeFile|fsync|rename|mkdir|rm|unlink|child_process|spawn|exec|http|https|net|tls|dns|fetch|XMLHttpRequest|WebSocket|import\s*\(|refreshNow|scheduleRefresh|cleanup|discover|loadSensor|setRuntime|applyRuntime|reloadDisk|state\.json|config\.json|native|helper)\b/u;

  for (const file of requestPathFiles) {
    assert.doesNotMatch(stripComments(readText(file)), forbidden, `${file} must stay no-I/O on the LLM request path`);
  }
});
