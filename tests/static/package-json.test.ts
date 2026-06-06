import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type PackageContract = {
  readonly type?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly pi?: { readonly extensions?: readonly string[] };
  readonly scripts?: Record<string, string>;
};

const readText = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");
const packageJson = JSON.parse(readText("package.json")) as PackageContract;

test("package.json pins the scaffold package and dependency contract", () => {
  assert.equal(packageJson.type, "module");
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
  assert.equal(
    packageJson.scripts?.test,
    "node --import tsx --test tests/unit/**/*.test.ts tests/integration/**/*.test.ts tests/behavior/**/*.test.ts tests/static/**/*.test.ts",
  );
  assert.equal(packageJson.scripts?.["test:file"], "node --import tsx --test");
  assert.equal(packageJson.scripts?.["test:native"], "node --import tsx --test tests/native/**/*.test.ts");
  assert.equal(packageJson.scripts?.["test:smoke"], "node --import tsx --test tests/smoke/**/*.test.ts");
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
  assert.match(settingsContract, /import \{ SettingsList \} from "@earendil-works\/pi-tui";/);
  assert.match(
    settingsContract,
    /const piCodingAgentPackageName = "@earendil-works\/pi-coding-agent";/,
  );
  assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-tui"], "*");
  assert.equal(packageJson.peerDependencies?.["@earendil-works/pi-coding-agent"], "*");
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-tui"], undefined);
  assert.equal(packageJson.dependencies?.["@earendil-works/pi-coding-agent"], undefined);
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
