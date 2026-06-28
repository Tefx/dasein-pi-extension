import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";
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
const scratchRoot = join(repoRoot, ".dasein", "non-blocking-startup-tests");

type DaseinFactory = (pi: FakePiHostFixture["pi"]) => void | Promise<void>;
type MutableBeforeAgentStartEvent = { systemPrompt: string; messages: unknown[] };

interface IsolatedExtensionFixture {
  readonly root: string;
  readonly home: string;
  readonly sensorDir: string;
  readonly indexPath: string;
}

interface SlowStartupGlobals {
  __daseinSlowStarted?: boolean;
  __daseinSlowResolved?: boolean;
  __daseinSlowResolve?: () => void;
}

const slowGlobals = (): SlowStartupGlobals => globalThis as SlowStartupGlobals;

const clearSlowGlobals = (): void => {
  delete slowGlobals().__daseinSlowStarted;
  delete slowGlobals().__daseinSlowResolved;
  delete slowGlobals().__daseinSlowResolve;
};

const objectRecord = (value: unknown): Record<string, unknown> => {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
};

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await wait(10);
  }
  assert.fail(`timed out waiting for ${label}`);
};

const createIsolatedExtensionFixture = (): IsolatedExtensionFixture => {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, "startup-"));
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
    const imported = await import(`${pathToFileURL(fixture.indexPath).href}?non-blocking-startup=${Date.now()}-${Math.random().toString(16).slice(2)}`) as Record<string, unknown>;
    assert.equal(typeof imported.default, "function");
    return imported.default as DaseinFactory;
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  }
};

const registerIsolatedDasein = async (fixture: IsolatedExtensionFixture): Promise<FakePiHostFixture> => {
  const host = createFakePiHost("tui", { dasein: "core.statusDetail=summary,core.agentInjectionTransport=systemPrompt" });
  const createDaseinExtension = await importIsolatedExtensionFactory(fixture);
  await createDaseinExtension(host.pi);
  return host;
};

const slowSensorSource = (): string => `
const spec = {
  key: "zz_slow",
  defaults: { enabled: true, ui: true, agent: true, initialRefresh: true, intervalMs: null, staleAfterMs: 60000 },
  manifest: {
    description: "slow startup probe sensor",
    declaredInputClasses: ["derived"],
    outputFields: [{ state_key: "zz_slow.value", value_type: "string", description: "slow value", agentVisibleByDefault: true, uiVisibleByDefault: true }],
    permissions: [{ kind: "none", required: false, reason: "none" }],
    remote: { capable: false, contactsNetworkByDefault: false, destinations: [], payloadClasses: [], transmissionCadence: "none", disableControl: "none", description: "none" },
    backgroundWork: { capable: false, kinds: [], defaultIntervalMs: null, intervalRelationship: "none", description: "none" },
  },
  refresh: () => new Promise((resolve) => {
    globalThis.__daseinSlowStarted = true;
    globalThis.__daseinSlowResolved = false;
    globalThis.__daseinSlowResolve = () => {
      globalThis.__daseinSlowResolved = true;
      resolve("slow-ready");
    };
  }),
};
export default spec;
`;

const failingSensorSource = (): string => `
const spec = {
  key: "zz_fail",
  defaults: { enabled: true, ui: true, agent: true, initialRefresh: true, intervalMs: null, staleAfterMs: 60000 },
  manifest: {
    description: "failing startup probe sensor",
    declaredInputClasses: ["derived"],
    outputFields: [{ state_key: "zz_fail.value", value_type: "string", description: "failing value", agentVisibleByDefault: true, uiVisibleByDefault: true }],
    permissions: [{ kind: "none", required: false, reason: "none" }],
    remote: { capable: false, contactsNetworkByDefault: false, destinations: [], payloadClasses: [], transmissionCadence: "none", disableControl: "none", description: "none" },
    backgroundWork: { capable: false, kinds: [], defaultIntervalMs: null, intervalRelationship: "none", description: "none" },
  },
  refresh: () => { throw new Error("startup-boom"); },
};
export default spec;
`;

const ambientSystemPromptContent = async (host: FakePiHostFixture): Promise<string> => {
  const event: MutableBeforeAgentStartEvent = { systemPrompt: "BASE SYSTEM", messages: [] };
  const result = await invokeFakeLifecycle(host, "before_agent_start", event);
  assert.equal(event.messages.length, 0, "Dasein must not append CustomMessage/user messages for agent context");
  if (result[0] !== undefined) assert.equal(objectRecord(result[0]).systemPrompt, event.systemPrompt);
  return event.systemPrompt;
};

const waitForAmbientPrompt = async (host: FakePiHostFixture, pattern: RegExp): Promise<string> => {
  let content = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    content = await ambientSystemPromptContent(host);
    if (pattern.test(content)) return content;
    await wait(10);
  }
  assert.fail(`timed out waiting for ambient prompt ${pattern}`);
};

test("session_start renders before slow initial sensor refresh and gates agent injection until refresh succeeds", async () => {
  clearSlowGlobals();
  const fixture = createIsolatedExtensionFixture();
  try {
    writeFileSync(join(fixture.sensorDir, "zz_slow.ts"), slowSensorSource(), "utf8");
    const host = await registerIsolatedDasein(fixture);

    await invokeFakeLifecycle(host, "session_start");

    await waitFor(() => slowGlobals().__daseinSlowStarted === true, "slow initial refresh start");
    assert.equal(slowGlobals().__daseinSlowResolved, false, "session_start must return before the slow initial refresh resolves");
    assert.match(host.ledger.uiStatusCalls[0]?.value ?? "", /Dasein sync/u, "first paint should show a low-noise sync status");

    const pendingPrompt = await ambientSystemPromptContent(host);
    assert.equal(pendingPrompt, "BASE SYSTEM", "pending startup placeholders must stay UI-only and out of agent prompt");

    slowGlobals().__daseinSlowResolve?.();

    const readyPrompt = await waitForAmbientPrompt(host, /value=slow-ready/u);
    assert.match(readyPrompt, /<DaseinAmbientContext>/u);
    assert.doesNotMatch(readyPrompt, /Dasein sync|Loading|syncing/u);
  } finally {
    clearSlowGlobals();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("shutdown clear is not overwritten by a late background initial refresh completion", async () => {
  clearSlowGlobals();
  const fixture = createIsolatedExtensionFixture();
  try {
    writeFileSync(join(fixture.sensorDir, "zz_slow.ts"), slowSensorSource(), "utf8");
    const host = await registerIsolatedDasein(fixture);

    await invokeFakeLifecycle(host, "session_start");
    await waitFor(() => slowGlobals().__daseinSlowStarted === true, "slow initial refresh start");
    await invokeFakeLifecycle(host, "session_shutdown");
    assert.deepEqual(host.ledger.uiStatusCalls.at(-1), { slot: "dasein", value: undefined });

    slowGlobals().__daseinSlowResolve?.();
    await wait(40);

    assert.deepEqual(host.ledger.uiStatusCalls.at(-1), { slot: "dasein", value: undefined }, "late background refresh completion must not republish status after shutdown clear");
  } finally {
    clearSlowGlobals();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("background initial refresh failure is visible in status but never injected into the agent prompt", async () => {
  const fixture = createIsolatedExtensionFixture();
  try {
    writeFileSync(join(fixture.sensorDir, "zz_fail.ts"), failingSensorSource(), "utf8");
    const host = await registerIsolatedDasein(fixture);

    await invokeFakeLifecycle(host, "session_start");
    await waitFor(() => host.ledger.uiStatusCalls.some((call) => /degraded|!/u.test(call.value ?? "")), "degraded status publish");

    const prompt = await ambientSystemPromptContent(host);
    assert.equal(prompt, "BASE SYSTEM", "failed initial refresh must keep Dasein out of agent prompt");

    const status = objectRecord(await invokeFakeCommand(host, "dasein", "status"));
    assert.match(JSON.stringify(status), /zz_fail initial refresh failed: startup-boom/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
