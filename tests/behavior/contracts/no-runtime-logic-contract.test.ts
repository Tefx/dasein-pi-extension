import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");

test("entrypoint composes real modules while the root shim remains delegate-only", () => {
  const shim = readText("index.ts");
  const entrypoint = readText("src/index.ts");

  assert.match(shim, /export \{ default \} from "\.\/src\/index\.ts";/u);
  assert.doesNotMatch(shim, /registerCommand\(|registerFlag\(|setStatus\(|setWidget\(|loadSensorRegistry|createSensorRuntime/u);

  for (const requiredModule of [
    "createConfigManager",
    "createStateStore",
    "loadSensorRegistry",
    "createSensorRuntime",
    "renderDaseinContext",
    "injectAmbientSystemPrompt",
    "createExternalStateBridge",
    "createDaseinLifecycle",
  ]) {
    assert.match(entrypoint, new RegExp(requiredModule, "u"), `src/index.ts must wire ${requiredModule}`);
  }

  assert.doesNotMatch(entrypoint, /NotImplementedError|_Stub|_Placeholder|TODO/u);
});
