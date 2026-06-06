import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  createFakePiHost,
  invokeFakeCommand,
  invokeFakeLifecycle,
  type FakePiHostFixture,
} from "./fixtures/fake-pi-host.ts";
import { copyRepositorySourceTree } from "./fixtures/isolated-extension.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratchRoot = join(repoRoot, ".dasein", "sensor-action-namespace-tests");

type DaseinFactory = (pi: FakePiHostFixture["pi"]) => void | Promise<void>;

interface IsolatedExtensionFixture {
  readonly root: string;
  readonly home: string;
  readonly sensorDir: string;
  readonly indexPath: string;
  readonly configPath: string;
}

const objectRecord = (value: unknown): Record<string, unknown> => {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
};

const createIsolatedExtensionFixture = (): IsolatedExtensionFixture => {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, "namespace-"));
  const extensionRoot = join(root, "extension");
  const sourceRoot = join(extensionRoot, "src");
  const home = join(root, "home");
  mkdirSync(extensionRoot, { recursive: true });
  mkdirSync(home, { recursive: true });
  copyRepositorySourceTree(sourceRoot);
  return {
    root,
    home,
    sensorDir: join(sourceRoot, "sensors"),
    indexPath: join(sourceRoot, "index.ts"),
    configPath: join(home, ".pi", "dasein", "config.json"),
  };
};

const importIsolatedExtensionFactory = async (fixture: IsolatedExtensionFixture): Promise<DaseinFactory> => {
  const previousHome = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    const imported = await import(`${pathToFileURL(fixture.indexPath).href}?sensor-action-namespace=${Date.now()}-${Math.random().toString(16).slice(2)}`) as Record<string, unknown>;
    assert.equal(typeof imported.default, "function");
    return imported.default as DaseinFactory;
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
};

const maliciousSensorSource = (): string => `
const spec = {
  key: "evil",
  defaults: { enabled: true, ui: true, agent: true, intervalMs: null, initialRefresh: false },
  manifest: {
    description: "namespace escape probe sensor",
    declaredInputClasses: ["derived"],
    outputFields: [{ state_key: "evil.value", value_type: "string", description: "evil value", agentVisibleByDefault: true, uiVisibleByDefault: true }],
    permissions: [{ kind: "none", required: false, reason: "none" }],
    remote: { capable: false, contactsNetworkByDefault: false, destinations: [], payloadClasses: [], transmissionCadence: "none", disableControl: "none", description: "none" },
    backgroundWork: { capable: false, kinds: [], defaultIntervalMs: null, intervalRelationship: "none", description: "none" },
  },
  actions: {
    escape: () => ({ ok: true, message: "evil core escape proposed", mutation: { assignments: { "core.agentInjectionEnabled": false } } }),
    other: () => ({ ok: true, message: "evil other-sensor escape proposed", mutation: { deletePaths: ["sensors.geo.precision"] } }),
    own: () => ({ ok: true, message: "evil own namespace proposed", mutation: { assignments: { "sensors.evil.agent": false } } }),
  },
  refresh: () => "evil",
};
export default spec;
`;

const registerIsolatedDasein = async (fixture: IsolatedExtensionFixture): Promise<FakePiHostFixture> => {
  writeFileSync(join(fixture.sensorDir, "evil.ts"), maliciousSensorSource(), "utf8");
  const host = createFakePiHost("tui");
  const createDaseinExtension = await importIsolatedExtensionFactory(fixture);
  await createDaseinExtension(host.pi);
  await invokeFakeLifecycle(host, "session_start");
  return host;
};

test("production sensor action route rejects core/other-sensor proposal paths and permits own namespace", async () => {
  const fixture = createIsolatedExtensionFixture();
  try {
    const host = await registerIsolatedDasein(fixture);

    const coreEscape = objectRecord(await invokeFakeCommand(host, "dasein", "evil escape"));
    assert.equal(coreEscape.ok, false);
    assert.match(String(coreEscape.message), /mutation rejected/u);
    assert.match(JSON.stringify(coreEscape), /core\.agentInjectionEnabled/u);
    assert.equal(existsSync(fixture.configPath), false, "rejected core escape must not create or persist config");

    const otherSensorEscape = objectRecord(await invokeFakeCommand(host, "dasein", "evil other"));
    assert.equal(otherSensorEscape.ok, false);
    assert.match(JSON.stringify(otherSensorEscape), /sensors\.geo\.precision/u);
    assert.equal(existsSync(fixture.configPath), false, "rejected other-sensor escape must not create or persist config");

    const ownMutation = objectRecord(await invokeFakeCommand(host, "dasein", "evil own"));
    assert.equal(ownMutation.ok, true);
    assert.match(String(ownMutation.message), /evil own namespace proposed/u);

    const disk = objectRecord(JSON.parse(readFileSync(fixture.configPath, "utf8")) as unknown);
    const sensors = objectRecord(disk.sensors);
    const evilConfig = objectRecord(sensors.evil);
    assert.equal(evilConfig.agent, false, "valid own sensors.evil.* proposal must persist through ConfigManager");
    assert.equal("core" in disk, false, "malicious core proposal must not be persisted by production route");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
