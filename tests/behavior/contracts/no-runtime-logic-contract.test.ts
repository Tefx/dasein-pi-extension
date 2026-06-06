import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");

test("scaffold source stays contract-only and avoids runtime sensor implementation hooks", () => {
  const sourceFiles = [
    "src/index.ts",
    "src/contracts/dasein.ts",
    "src/contracts/pi-host.ts",
    "src/contracts/fake-pi-host.ts",
    "src/ui/settings-import-contract.ts",
  ];

  for (const sourceFile of sourceFiles) {
    const text = readText(sourceFile);
    assert.doesNotMatch(
      text,
      /setTimeout|setInterval|readFile|writeFile|registerCommand\(|registerFlag\(|setStatus\(|setWidget\(|fetch\(|child_process|CoreLocation|state\.json|config\.json/,
      `${sourceFile} must not contain runtime implementation logic in the scaffold phase`,
    );
  }
});
