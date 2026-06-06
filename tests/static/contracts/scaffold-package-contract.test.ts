import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface PackageJsonShape {
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly pi?: { readonly extensions?: readonly string[] };
  readonly scripts?: Record<string, string>;
  readonly type?: string;
}

const readText = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const packageJson = JSON.parse(readText("package.json")) as PackageJsonShape;

const stripBlockAndLineComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();

const listSourceFiles = (dir: string): readonly string[] => {
  const absoluteDir = resolve(repoRoot, dir);
  const entries = readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = join(absoluteDir, entry);
    const relativePath = join(dir, entry);
    if (statSync(absolutePath).isDirectory()) return listSourceFiles(relativePath);
    return extname(entry) === ".ts" ? [relativePath] : [];
  });
  return entries.sort();
};

test("package scaffold keeps zero runtime dependencies and approved Pi peers only", () => {
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.dependencies ?? {}, {});
  assert.deepEqual(packageJson.peerDependencies, {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
  });

  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    assert.fail(`non-Pi runtime dependency is forbidden by scaffold.no_deps: ${dependencyName}`);
  }

  const allowedDevDependencies = new Set(["@types/node", "tsx", "typescript"]);
  for (const dependencyName of Object.keys(packageJson.devDependencies ?? {})) {
    assert.equal(
      allowedDevDependencies.has(dependencyName),
      true,
      `devDependency is outside TypeScript/test tooling allowlist: ${dependencyName}`,
    );
  }
});

test("required npm scripts preserve the Technical Design command shapes", () => {
  assert.equal(packageJson.scripts?.typecheck, "tsc --noEmit");
  assert.equal(
    packageJson.scripts?.test,
    "node --import tsx --test tests/unit/**/*.test.ts tests/integration/**/*.test.ts tests/behavior/**/*.test.ts tests/static/**/*.test.ts",
  );
  assert.equal(packageJson.scripts?.["test:file"], "node --import tsx --test");
  assert.equal(packageJson.scripts?.["test:native"], "node --import tsx --test tests/native/**/*.test.ts");
  assert.equal(packageJson.scripts?.["test:smoke"], "node --import tsx --test tests/smoke/**/*.test.ts");
});

test("package.json pi.extensions includes the root symlink discovery shim when present", () => {
  assert.deepEqual(packageJson.pi?.extensions, ["./index.ts"]);
});

test("root index.ts is exactly a delegate-only shim to ./src/index.ts", () => {
  const executableShim = stripBlockAndLineComments(readText("index.ts"));
  assert.equal(
    executableShim,
    'export { default } from "./src/index.ts";\nexport * from "./src/index.ts";',
  );
});

test("SettingsList/getSettingsListTheme imports resolve only through approved Pi peer dependencies", async () => {
  const settingsContractPath = "src/ui/settings-import-contract.ts";
  const settingsContract = readText(settingsContractPath);
  assert.match(settingsContract, /import \{ SettingsList \} from "@earendil-works\/pi-tui";/);
  assert.match(
    settingsContract,
    /const piCodingAgentPackageName = "@earendil-works\/pi-coding-agent";/,
  );
  assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-tui"], "*");
  assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], "*");
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-tui"], undefined);
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-coding-agent"], undefined);

  for (const sourceFile of listSourceFiles("src")) {
    const sourceText = readText(sourceFile);
    const settingsImportLines = sourceText
      .split("\n")
      .filter((line) => /import\s+.*\bSettingsList\b.*from/.test(line));
    if (settingsImportLines.length === 0) continue;
    assert.equal(
      sourceFile,
      settingsContractPath,
      `SettingsList/getSettingsListTheme must not be imported outside the approved peer-import contract: ${sourceFile}`,
    );
    for (const importLine of settingsImportLines) {
      if (/\bSettingsList\b/.test(importLine)) {
        assert.match(importLine, /from "@earendil-works\/pi-tui";/);
      }
    }
  }

  const resolvedTuiPeer = await import.meta.resolve("@earendil-works/pi-tui");
  assert.match(resolvedTuiPeer, /@earendil-works\/pi-tui/);
  const resolvedCodingAgentPeer = await import.meta.resolve("@earendil-works/pi-coding-agent");
  assert.match(resolvedCodingAgentPeer, /@earendil-works\/pi-coding-agent/);
});
