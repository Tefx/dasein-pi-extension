import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const scratchRoot = join(repoRoot, ".dasein", "manual-reload-late-sensor-tests");

type DaseinFactory = (pi: FakePiHostFixture["pi"]) => void | Promise<void>;

type MutableBeforeAgentStartEvent = { systemPrompt: string; messages: unknown[] };

interface IsolatedExtensionFixture {
  readonly root: string;
  readonly home: string;
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
  const root = mkdtempSync(join(scratchRoot, "late-"));
  const extensionRoot = join(root, "extension");
  const sourceRoot = join(extensionRoot, "src");
  mkdirSync(extensionRoot, { recursive: true });
  copyRepositorySourceTree(sourceRoot);
  return {
    root,
    home: join(root, "home"),
    sensorDir: join(sourceRoot, "sensors"),
    indexPath: join(sourceRoot, "index.ts"),
  };
};

const importIsolatedExtensionFactory = async (fixture: IsolatedExtensionFixture): Promise<DaseinFactory> => {
  const previousHome = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    const imported = await import(`${pathToFileURL(fixture.indexPath).href}?manual-reload-late=${Date.now()}-${Math.random().toString(16).slice(2)}`) as Record<string, unknown>;
    assert.equal(typeof imported.default, "function");
    return imported.default as DaseinFactory;
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
};

const registerIsolatedDasein = async (fixture: IsolatedExtensionFixture): Promise<FakePiHostFixture> => {
  const host = createFakePiHost("tui");
  const createDaseinExtension = await importIsolatedExtensionFactory(fixture);
  await createDaseinExtension(host.pi);
  return host;
};

const lateSensorSource = (value: string): string => `
const spec = {
  key: "late",
  defaults: { enabled: true, ui: true, agent: true, initialRefresh: true },
  manifest: {
    description: "late reload sensor",
    declaredInputClasses: ["derived"],
    outputFields: [{ state_key: "late.value", value_type: "string", description: "late value", agentVisibleByDefault: true, uiVisibleByDefault: true }],
    permissions: [{ kind: "none", required: false, reason: "none" }],
    remote: { capable: false, contactsNetworkByDefault: false, destinations: [], payloadClasses: [], transmissionCadence: "none", disableControl: "none", description: "none" },
    backgroundWork: { capable: false, kinds: [], defaultIntervalMs: null, intervalRelationship: "none", description: "none" },
  },
  refresh: () => ${JSON.stringify(value)},
};
export default spec;
`;

const contextContent = async (host: FakePiHostFixture): Promise<string> => {
  const event: MutableBeforeAgentStartEvent = { systemPrompt: "BASE SYSTEM", messages: [] };
  const result = await invokeFakeLifecycle(host, "before_agent_start", event);
  const returned = objectRecord(result[0]);
  assert.equal(event.messages.length, 0, "Dasein must not append CustomMessage/user messages for agent context");
  assert.equal(returned.systemPrompt, event.systemPrompt);
  assert.equal(typeof event.systemPrompt, "string");
  return event.systemPrompt;
};

test("manual reload rebuilds effective defaults so a sensor added after startup renders after reload", async () => {
  const fixture = createIsolatedExtensionFixture();
  try {
    const host = await registerIsolatedDasein(fixture);
    await invokeFakeLifecycle(host, "session_start");

    assert.doesNotMatch(await contextContent(host), /late-after-startup/u, "late sensor must not be present before its file exists");

    writeFileSync(join(fixture.sensorDir, "late.ts"), lateSensorSource("late-after-startup"), "utf8");
    const reloadResult = objectRecord(await invokeFakeCommand(host, "dasein", "reload"));
    assert.equal(reloadResult.ok, true);
    assert.match(String(reloadResult.message), /dasein reload: ok/u);

    const sensorsResult = objectRecord(await invokeFakeCommand(host, "dasein", "sensors"));
    const sensorsData = objectRecord(sensorsResult.data);
    const sensors = sensorsData.sensors as Array<Record<string, unknown>>;
    const late = sensors.find((sensor) => sensor.key === "late");
    assert.equal(late?.enabled, true, "late sensor must be listed and effective-enabled after reload");

    const rendered = await contextContent(host);
    assert.match(rendered, /late-after-startup/u, "late enabled sensor must render from rebuilt effective config/defaults after reload");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
