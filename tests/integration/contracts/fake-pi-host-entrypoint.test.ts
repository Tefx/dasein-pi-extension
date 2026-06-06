import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";

import { createFakePiHost, type FakePiExtensionApi } from "../fixtures/fake-pi-host.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

type PiExtensionFactory = (pi: FakePiExtensionApi) => unknown | Promise<unknown>;

const loadSymlinkedDaseinEntrypoint = async (): Promise<unknown> => {
  const fakeHome = mkdtempSync(join(tmpdir(), "dasein-pi-home-"));
  const extensionParent = join(fakeHome, ".pi", "agent", "extensions");
  mkdirSync(extensionParent, { recursive: true });
  const symlinkedExtensionRoot = join(extensionParent, "dasein");
  symlinkSync(repoRoot, symlinkedExtensionRoot, "dir");

  assert.equal(lstatSync(symlinkedExtensionRoot).isSymbolicLink(), true);

  const entrypointUrl = new URL(
    `${pathToFileURL(join(symlinkedExtensionRoot, "index.ts")).href}?symlink-load=${Date.now()}`,
  );
  const loadedModule = (await import(entrypointUrl.href)) as { readonly default?: unknown };
  return loadedModule.default;
};

test("symlinked ~/.pi/agent/extensions/dasein load exposes a Pi extension factory", async () => {
  const loadedDefault = await loadSymlinkedDaseinEntrypoint();

  assert.equal(
    typeof loadedDefault,
    "function",
    "scaffold.entrypoint must export a Pi extension factory when loaded through ~/.pi/agent/extensions/dasein/index.ts",
  );
});

test("symlinked entrypoint registers required APIs against the fake Pi host recording ledger", async () => {
  const loadedDefault = await loadSymlinkedDaseinEntrypoint();
  assert.equal(typeof loadedDefault, "function");

  const extensionFactory = loadedDefault as PiExtensionFactory;
  const { pi, ledger } = createFakePiHost("tui");
  await extensionFactory(pi);

  assert.deepEqual(
    ledger.flags.map((flag) => [flag.name, flag.type]),
    [["dasein", "string"]],
  );
  assert.equal(
    ledger.commands.some((command) => command.name === "dasein"),
    true,
    "fake_host must record /dasein command registration",
  );
  assert.equal(
    ledger.lifecycleHandlers.some((handler) => handler.eventName === "before_agent_start"),
    true,
    "fake_host must record before_agent_start lifecycle registration for system-prompt injection",
  );
  assert.equal(
    ledger.lifecycleHandlers.some((handler) => handler.eventName === "session_start"),
    true,
    "fake_host must record session_start lifecycle registration",
  );
  assert.equal(
    ledger.lifecycleHandlers.some((handler) => handler.eventName === "session_shutdown"),
    true,
    "fake_host must record session_shutdown cleanup registration",
  );
  assert.deepEqual(
    ledger.eventSubscriptions.map((subscription) => subscription.topic).sort(),
    ["dasein:state:clear", "dasein:state:set"],
  );
});

test("fake Pi host fixture records UI/status/widget/custom calls without live support claims", async () => {
  const { context, ledger } = createFakePiHost("tui");

  context.ui.setStatus("dasein", "ready");
  context.ui.setStatus("dasein", undefined);
  context.ui.setWidget("dasein", ["line"]);
  await context.ui.custom(() => undefined, { overlay: true });

  assert.deepEqual(ledger.uiStatusCalls, [
    { slot: "dasein", value: "ready" },
    { slot: "dasein", value: undefined },
  ]);
  assert.deepEqual(ledger.uiWidgetCalls, [{ slot: "dasein", value: ["line"] }]);
  assert.deepEqual(ledger.uiCustomCalls, [{ optionKeys: ["overlay"] }]);
});
