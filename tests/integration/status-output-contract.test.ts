import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
const scratchRoot = join(repoRoot, ".dasein", "status-output-contract-tests");
const launchFlags = "clock.agent=false,lapse.agent=false,lapse.persist=false";

type DaseinFactory = (pi: FakePiHostFixture["pi"]) => void | Promise<void>;

interface IsolatedExtensionFixture {
  readonly root: string;
  readonly home: string;
  readonly indexPath: string;
}

const recordOf = (value: unknown, label: string): Record<string, unknown> => {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
  return value as Record<string, unknown>;
};

const recordArrayOf = (value: unknown, label: string): readonly Record<string, unknown>[] => {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  return (value as readonly unknown[]).map((item, index) => recordOf(item, `${label}[${index}]`));
};

const stringArrayOf = (value: unknown, label: string): readonly string[] => {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  const items = value as readonly unknown[];
  for (const [index, item] of items.entries()) assert.equal(typeof item, "string", `${label}[${index}] must be a string`);
  return items as readonly string[];
};

const createIsolatedExtensionFixture = (): IsolatedExtensionFixture => {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, "status-"));
  const extensionRoot = join(root, "extension");
  const sourceRoot = join(extensionRoot, "src");
  const home = join(root, "home");
  mkdirSync(extensionRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  cpSync(join(repoRoot, "src"), sourceRoot, { recursive: true });
  return {
    root,
    home,
    indexPath: join(sourceRoot, "index.ts"),
  };
};

const importIsolatedExtensionFactory = async (fixture: IsolatedExtensionFixture): Promise<DaseinFactory> => {
  const previousHome = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    const imported = await import(`${pathToFileURL(fixture.indexPath).href}?status-output-contract=${Date.now()}-${Math.random().toString(16).slice(2)}`) as Record<string, unknown>;
    assert.equal(typeof imported.default, "function");
    return imported.default as DaseinFactory;
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
};

const registerIsolatedDasein = async (fixture: IsolatedExtensionFixture): Promise<FakePiHostFixture> => {
  const host = createFakePiHost("print", { dasein: launchFlags });
  const createDaseinExtension = await importIsolatedExtensionFactory(fixture);
  await createDaseinExtension(host.pi);
  await invokeFakeLifecycle(host, "session_start");
  return host;
};

test("production /dasein status reports disabled/hidden contributors and effective lapse controls", async () => {
  const fixture = createIsolatedExtensionFixture();
  try {
    const host = await registerIsolatedDasein(fixture);
    const status = recordOf(await invokeFakeCommand(host, "dasein", "status"), "status result");
    assert.equal(status.ok, true);
    assert.equal(status.command, "status");
    const data = recordOf(status.data, "status result data");

    assert.deepEqual([...stringArrayOf(data.activeSensors, "data.activeSensors")].sort(), ["clock", "lapse"]);
    assert.deepEqual(stringArrayOf(data.disabledSensors, "data.disabledSensors"), ["geo"]);
    assert.deepEqual(recordOf(data.effectiveLapseControls, "data.effectiveLapseControls"), {
      enabled: true,
      persist: false,
      agent: false,
      agentFields: ["user_idle"],
    });

    const hiddenContributors = recordArrayOf(data.hiddenContributors, "data.hiddenContributors");
    const geo = hiddenContributors.find((entry) => entry.key === "geo");
    assert.ok(geo, "disabled geo contributor must remain inspectable");
    assert.equal(geo.enabled, false);
    assert.equal(geo.hiddenReason, "disabled");
    assert.equal(recordOf(geo.sensorMetadata, "geo.sensorMetadata").key, "geo");

    const clock = hiddenContributors.find((entry) => entry.key === "clock");
    assert.ok(clock, "agent-hidden clock contributor must remain inspectable");
    assert.equal(clock.enabled, true);
    assert.equal(clock.hiddenReason, "agent-hidden");
    assert.equal(recordOf(clock.sensorMetadata, "clock.sensorMetadata").key, "clock");

    const lapse = hiddenContributors.find((entry) => entry.key === "lapse");
    assert.ok(lapse, "agent-hidden lapse contributor must remain inspectable");
    assert.equal(lapse.enabled, true);
    assert.equal(lapse.hiddenReason, "agent-hidden");
    assert.equal(recordOf(lapse.sensorMetadata, "lapse.sensorMetadata").key, "lapse");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
