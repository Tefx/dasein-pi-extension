import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface PackageJsonShape {
  readonly private?: boolean;
  readonly keywords?: readonly string[];
  readonly files?: readonly string[];
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
    if (entry.startsWith(".dasein-reload-")) return [];
    const absolutePath = join(absoluteDir, entry);
    const relativePath = join(dir, entry);
    if (statSync(absolutePath).isDirectory()) return listSourceFiles(relativePath);
    return extname(entry) === ".ts" ? [relativePath] : [];
  });
  return entries.sort();
};

test("package scaffold keeps zero runtime dependencies and approved Pi peers only", () => {
  assert.equal(packageJson.private, false);
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.keywords?.includes("pi-package"), true);
  assert.deepEqual(packageJson.files, [
    "index.ts",
    "src/",
    "docs/PRD.md",
    "docs/TECHNICAL_DESIGN.md",
    "docs/RELEASE.md",
    "docs/SENSOR_AUTHORING.md",
    "docs/config.sample.json",
    "examples/",
    "CONSTITUTION.md",
  ]);
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
  assert.equal(packageJson.scripts?.test, "node scripts/run-non-native-tests.mjs");
  const testRunner = readText("scripts/run-non-native-tests.mjs");
  for (const requiredRoot of ["tests/unit", "tests/integration", "tests/behavior", "tests/static"]) {
    assert.match(testRunner, new RegExp(requiredRoot));
  }
  assert.doesNotMatch(testRunner, /tests\/(native|smoke)/u);
  assert.match(testRunner, /--import", "tsx", "--test"/u);
  assert.match(testRunner, /endsWith\("\.test\.ts"\)/u);
  assert.equal(packageJson.scripts?.["test:file"], "node --import tsx --test");
  assert.equal(packageJson.scripts?.["test:native"], "node scripts/run-native-tests.mjs");
  const nativeTestRunner = readText("scripts/run-native-tests.mjs");
  assert.match(nativeTestRunner, /tests\/native/u);
  assert.doesNotMatch(nativeTestRunner, /tests\/smoke/u);
  assert.match(nativeTestRunner, /--import", "tsx", "--test"/u);
  assert.match(nativeTestRunner, /endsWith\("\.test\.ts"\)/u);
  assert.equal(packageJson.scripts?.["test:smoke"], "node --import tsx --test tests/smoke/**/*.test.ts");
  assert.equal(packageJson.scripts?.["package:check"], "node scripts/check-package-manifest.mjs");
  assert.equal(packageJson.scripts?.["release:check"], "npm run typecheck && npm test && npm run test:native && npm run package:check && npm run test:smoke");
});

test("package dry-run checker pins runtime tarball contents", () => {
  const checker = readText("scripts/check-package-manifest.mjs");
  assert.match(checker, /npm", \["pack", "--dry-run", "--json"\]/u);
  assert.match(checker, /package\.json keywords must include pi-package/u);
  assert.match(checker, /src\/native\/macos-location-helper\.swift/u);
  assert.match(checker, /docs\/RELEASE\.md/u);
  assert.match(checker, /docs\/SENSOR_AUTHORING\.md/u);
  assert.match(checker, /docs\/config\.sample\.json/u);
  assert.match(checker, /examples\/README\.md/u);
  assert.match(checker, /examples\/sensors\/focus\.ts/u);
  assert.match(checker, /examples\/config\/focus\.config\.json/u);
  assert.match(checker, /packed tarball contains non-runtime\/development path/u);
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
  assert.match(settingsContract, /import \{ matchesKey, SettingsList \} from "@earendil-works\/pi-tui";/);
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

  const statusFormat = readText("src/ui/status-format.ts");
  const overlayFrame = readText("src/ui/overlay-frame.ts");
  assert.match(statusFormat, /import \{ truncateToWidth, visibleWidth \} from "@earendil-works\/pi-tui";/);
  assert.match(overlayFrame, /import \{ truncateToWidth, visibleWidth, wrapTextWithAnsi \} from "@earendil-works\/pi-tui";/);
  assert.doesNotMatch(`${statusFormat}\n${overlayFrame}`, /\.slice\(|substring\(|substr\(/u);

  const resolvedTuiPeer = await import.meta.resolve("@earendil-works/pi-tui");
  assert.match(resolvedTuiPeer, /@earendil-works\/pi-tui/);
  const resolvedCodingAgentPeer = await import.meta.resolve("@earendil-works/pi-coding-agent");
  assert.match(resolvedCodingAgentPeer, /@earendil-works\/pi-coding-agent/);
});
