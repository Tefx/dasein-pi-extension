import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  createFakePiHost,
  invokeFakeCommand,
  invokeFakeLifecycle,
  type FakePiHostFixture,
} from "./fixtures/fake-pi-host.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratchRoot = join(repoRoot, ".dasein", "reload-launch-metadata-tests");
const launchFlags = "geo.agent=on,clock.precision=hour";
const expectedLaunchReappliedPaths = ["sensors.geo.agent"];
const expectedRuntimeOverriddenPaths = ["sensors.clock.precision"];

type DaseinFactory = (pi: FakePiHostFixture["pi"]) => void | Promise<void>;

interface IsolatedExtensionFixture {
  readonly root: string;
  readonly home: string;
  readonly configPath: string;
  readonly sensorDir: string;
  readonly indexPath: string;
}

const objectRecord = (value: unknown): Record<string, unknown> => {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
};

const createIsolatedExtensionFixture = (): IsolatedExtensionFixture => {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, "reload-"));
  const extensionRoot = join(root, "extension");
  const sourceRoot = join(extensionRoot, "src");
  mkdirSync(extensionRoot, { recursive: true });
  cpSync(join(repoRoot, "src"), sourceRoot, { recursive: true });
  const home = join(root, "home");
  return {
    root,
    home,
    configPath: join(home, ".pi", "dasein", "config.json"),
    sensorDir: join(sourceRoot, "sensors"),
    indexPath: join(sourceRoot, "index.ts"),
  };
};

const cleanupIsolatedExtensionFixture = (fixture: IsolatedExtensionFixture): void => {
  // Each test owns only its mkdtemp-created fixture root. Removing the shared
  // scratchRoot here can invalidate a sibling test while node:test/full-suite
  // execution is still preparing or importing its isolated extension copy.
  rmSync(fixture.root, { recursive: true, force: true });
};

const importIsolatedExtensionFactory = async (fixture: IsolatedExtensionFixture): Promise<DaseinFactory> => {
  const previousHome = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    const imported = await import(`${pathToFileURL(fixture.indexPath).href}?reload-metadata=${Date.now()}-${Math.random().toString(16).slice(2)}`) as Record<string, unknown>;
    assert.equal(typeof imported.default, "function");
    return imported.default as DaseinFactory;
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
};

const registerIsolatedDasein = async (fixture: IsolatedExtensionFixture): Promise<FakePiHostFixture> => {
  const host = createFakePiHost("tui", { dasein: launchFlags });
  const createDaseinExtension = await importIsolatedExtensionFactory(fixture);
  await createDaseinExtension(host.pi);
  return host;
};

const markClockPrecisionRuntimeOverridden = async (host: FakePiHostFixture): Promise<void> => {
  const setResult = objectRecord(await invokeFakeCommand(host, "dasein", "set clock.precision exact"));
  assert.equal(setResult.ok, true);
};

const assertReloadPreservedLaunchMetadata = (commandResult: unknown, expectedFailureScope: "config" | "sensors"): void => {
  const result = objectRecord(commandResult);
  const data = objectRecord(result.data);
  const reload = objectRecord(data.reload);

  assert.equal(result.ok, false);
  assert.equal(reload.ok, false);
  assert.equal(reload.failureScope, expectedFailureScope);
  assert.deepEqual(data.launchReappliedPaths, expectedLaunchReappliedPaths);
  assert.deepEqual(reload.launchReappliedPaths, expectedLaunchReappliedPaths);
  assert.deepEqual(data.runtimeOverriddenPaths, expectedRuntimeOverriddenPaths);
  assert.deepEqual(reload.runtimeOverriddenPaths, expectedRuntimeOverriddenPaths);
  assert.equal(JSON.stringify(data.launchReappliedPaths).includes("sensors.clock.precision"), false);
  assert.equal(JSON.stringify(reload.launchReappliedPaths).includes("sensors.clock.precision"), false);
};

test("/dasein reload fake-host sensor-load failure preserves non-runtime-overridden launch metadata", async () => {
  const fixture = createIsolatedExtensionFixture();
  try {
    const host = await registerIsolatedDasein(fixture);
    await invokeFakeLifecycle(host, "session_start");
    await markClockPrecisionRuntimeOverridden(host);

    writeFileSync(
      join(fixture.sensorDir, "__reload_launch_metadata_failure.ts"),
      "export default { key: 'reload_launch_metadata_failure' };\n",
      "utf8",
    );

    const reloadResult = await invokeFakeCommand(host, "dasein", "reload");
    assertReloadPreservedLaunchMetadata(reloadResult, "sensors");
    assert.match(JSON.stringify(reloadResult), /invalid-spec|reload_launch_metadata_failure/u);
  } finally {
    cleanupIsolatedExtensionFixture(fixture);
  }
});

test("/dasein reload config failure preserves non-runtime-overridden launch metadata", async () => {
  const fixture = createIsolatedExtensionFixture();
  try {
    const host = await registerIsolatedDasein(fixture);
    await invokeFakeLifecycle(host, "session_start");
    await markClockPrecisionRuntimeOverridden(host);

    mkdirSync(dirname(fixture.configPath), { recursive: true });
    writeFileSync(fixture.configPath, "{\"version\":2}\n", "utf8");

    const reloadResult = await invokeFakeCommand(host, "dasein", "reload");
    assertReloadPreservedLaunchMetadata(reloadResult, "config");
    assert.match(JSON.stringify(reloadResult), /invalid-schema|version/u);
  } finally {
    cleanupIsolatedExtensionFixture(fixture);
  }
});
