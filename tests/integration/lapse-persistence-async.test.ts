import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const scratchRoot = join(repoRoot, ".dasein", "lapse-persistence-async-tests");

type DaseinFactory = (pi: FakePiHostFixture["pi"]) => void | Promise<void>;

interface IsolatedExtensionFixture {
  readonly root: string;
  readonly home: string;
  readonly indexPath: string;
  readonly statePath: string;
}

const objectRecord = (value: unknown): Record<string, unknown> => {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
};

const sleep = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs));

const waitFor = async (predicate: () => boolean | Promise<boolean>, label: string): Promise<void> => {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(10);
  }
  assert.fail(`timed out waiting for ${label}`);
};

const createIsolatedExtensionFixture = (homeKind: "directory" | "file" = "directory"): IsolatedExtensionFixture => {
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, "lapse-"));
  const extensionRoot = join(root, "extension");
  const sourceRoot = join(extensionRoot, "src");
  const home = join(root, homeKind === "directory" ? "home" : "home-file");
  mkdirSync(extensionRoot, { recursive: true });
  if (homeKind === "directory") mkdirSync(home, { recursive: true });
  else writeFileSync(home, "not a directory", "utf8");
  cpSync(join(repoRoot, "src"), sourceRoot, { recursive: true });
  return {
    root,
    home,
    indexPath: join(sourceRoot, "index.ts"),
    statePath: join(home, ".pi", "dasein", "state.json"),
  };
};

const importIsolatedExtensionFactory = async (fixture: IsolatedExtensionFixture): Promise<DaseinFactory> => {
  const previousHome = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    const imported = await import(`${pathToFileURL(fixture.indexPath).href}?lapse-persistence-async=${Date.now()}-${Math.random().toString(16).slice(2)}`) as Record<string, unknown>;
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
  await invokeFakeLifecycle(host, "session_start");
  return host;
};

const readLapseState = (statePath: string): Record<string, unknown> => {
  const disk = objectRecord(JSON.parse(readFileSync(statePath, "utf8")) as unknown);
  return objectRecord(disk.lapse);
};

test("lapse lifecycle observations return before durable state write begins and coalesce latest async write", async () => {
  const fixture = createIsolatedExtensionFixture();
  try {
    const host = await registerIsolatedDasein(fixture);
    assert.equal(existsSync(fixture.statePath), false, "startup must not create state.json before lapse observation");

    await invokeFakeLifecycle(host, "input", { timestamp: 1000, turnId: "turn-1" });
    assert.equal(existsSync(fixture.statePath), false, "input handler must return before state.json write begins/completes");

    await invokeFakeLifecycle(host, "before_agent_start", { timestamp: 1001, turnId: "turn-1" });
    assert.equal(existsSync(fixture.statePath), false, "before_agent_start handler must return before state.json write begins/completes");

    await invokeFakeLifecycle(host, "agent_end", { timestamp: 2000, turnId: "turn-1" });
    assert.equal(existsSync(fixture.statePath), false, "agent_end handler must return before state.json write begins/completes");

    await waitFor(() => existsSync(fixture.statePath), "async lapse state write");
    assert.deepEqual(readLapseState(fixture.statePath), {
      previous_human_input_at: 1000,
      previous_agent_end_at: 2000,
    });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("async lapse durable write failures surface in /dasein status without blocking observation handler", async () => {
  const fixture = createIsolatedExtensionFixture("file");
  try {
    const host = await registerIsolatedDasein(fixture);

    await invokeFakeLifecycle(host, "input", { timestamp: 3000, turnId: "turn-error" });
    assert.equal(existsSync(fixture.statePath), false, "failed async write path must not create state.json synchronously");

    await waitFor(async () => {
      const status = objectRecord(await invokeFakeCommand(host, "dasein", "status"));
      return JSON.stringify(status).includes("write-failed");
    }, "durable write failure status error");

    const status = objectRecord(await invokeFakeCommand(host, "dasein", "status"));
    const data = objectRecord(status.data);
    const statusErrors = data.statusErrors as readonly unknown[];
    assert.equal(statusErrors.some((item) => JSON.stringify(item).includes("durable_state") && JSON.stringify(item).includes("write-failed")), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
