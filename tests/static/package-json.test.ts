import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type PackageContract = {
  readonly private?: boolean;
  readonly type?: string;
  readonly keywords?: readonly string[];
  readonly files?: readonly string[];
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly pi?: { readonly extensions?: readonly string[] };
  readonly scripts?: Record<string, string>;
};

const readText = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const packageJson = JSON.parse(readText("package.json")) as PackageContract;

test("package.json pins the scaffold package and dependency contract", () => {
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
    "CONSTITUTION.md",
  ]);
  assert.deepEqual(packageJson.dependencies, {});
  assert.deepEqual(packageJson.peerDependencies, {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
  });
  assert.deepEqual(packageJson.pi?.extensions, ["./index.ts"]);

  for (const runtimeDependency of Object.keys(packageJson.dependencies ?? {})) {
    assert.fail(`runtime dependency is forbidden in scaffold contract: ${runtimeDependency}`);
  }

  assert.deepEqual(Object.keys(packageJson.devDependencies ?? {}).sort(), [
    "@types/node",
    "tsx",
    "typescript",
  ]);
});

test("package.json pins the required npm script command shapes", () => {
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

test("package dry-run checker enforces publishable Pi package contents", () => {
  const checker = readText("scripts/check-package-manifest.mjs");
  assert.match(checker, /npm", \["pack", "--dry-run", "--json"\]/u);
  assert.match(checker, /keywords.*pi-package/su);
  assert.match(checker, /package\.json pi\.extensions must include \.\/index\.ts/u);
  assert.match(checker, /packed tarball missing required path/u);
  assert.match(checker, /packed tarball contains non-runtime\/development path/u);
  assert.match(checker, /src\/native\/macos-location-helper\.swift/u);
  assert.match(checker, /docs\/RELEASE\.md/u);
  assert.match(checker, /docs\/SENSOR_AUTHORING\.md/u);
  assert.match(checker, /docs\/config\.sample\.json/u);
});

test("root index.ts is a symlink-load Pi auto-discovery shim delegating to ./src/index.ts", () => {
  const shim = readText("index.ts");
  assert.match(shim, /~\/\.pi\/agent\/extensions\/dasein\/index\.ts/);
  assert.match(shim, /export \{ default \} from "\.\/src\/index\.ts";/);
  assert.match(shim, /export \* from "\.\/src\/index\.ts";/);
  assert.doesNotMatch(shim, /registerCommand|registerFlag|setStatus|setWidget|SettingsList|fs|child_process|fetch/);
});

test("SettingsList/getSettingsListTheme resolve only through approved Pi peer dependency paths", () => {
  const settingsContract = readText("src/ui/settings-import-contract.ts");
  assert.match(settingsContract, /import \{ matchesKey, SettingsList \} from "@earendil-works\/pi-tui";/);
  assert.match(
    settingsContract,
    /const piCodingAgentPackageName = "@earendil-works\/pi-coding-agent";/,
  );
  assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-tui"], "*");
  assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], "*");
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-tui"], undefined);
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-coding-agent"], undefined);
});

test("Dasein TUI text fitting uses approved Pi TUI width helpers", () => {
  const statusFormat = readText("src/ui/status-format.ts");
  const overlayFrame = readText("src/ui/overlay-frame.ts");
  assert.match(statusFormat, /import \{ truncateToWidth, visibleWidth \} from "@earendil-works\/pi-tui";/);
  assert.match(overlayFrame, /import \{ truncateToWidth, visibleWidth, wrapTextWithAnsi \} from "@earendil-works\/pi-tui";/);
  assert.doesNotMatch(`${statusFormat}\n${overlayFrame}`, /\.slice\(|substring\(|substr\(/u);
});

test("fake Pi host API shape is contract-only and does not claim live support", () => {
  const fakeHostContract = readText("src/contracts/fake-pi-host.ts");
  assert.match(fakeHostContract, /commands: readonly PiCommandRegistrationContract\[]/);
  assert.match(fakeHostContract, /flags: readonly PiFlagRegistrationContract\[]/);
  assert.match(fakeHostContract, /lifecycleHandlers: readonly PiLifecycleEventContract\[]/);
  assert.match(fakeHostContract, /uiStatusCalls: readonly string\[]/);
  assert.match(fakeHostContract, /uiWidgetCalls: readonly string\[]/);
  assert.match(fakeHostContract, /uiCustomCalls: readonly string\[]/);
  assert.match(fakeHostContract, /liveSupportClaim: false/);
});
