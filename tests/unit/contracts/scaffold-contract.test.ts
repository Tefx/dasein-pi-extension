import assert from "node:assert/strict";
import test from "node:test";

import createDaseinExtension, { daseinExtensionContract as namedContract } from "../../../src/index.ts";
import type { DaseinPiExtensionFactory } from "../../../src/index.ts";
import type { DaseinTopLevelContracts } from "../../../src/contracts/dasein.ts";

const topLevelContract: DaseinTopLevelContracts = {
  package: {
    packageManager: "npm",
    moduleFormat: "typescript-esm-node",
    requiredScripts: ["typecheck", "test", "test:file", "test:native", "test:smoke"],
    runtimeDependencies: "none",
    piPeerDependencies: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"],
    dependencyPolicy: "zero-non-pi-runtime-npm-dependencies",
  },
  entrypoint: {
    symlinkedInstallPath: "~/.pi/agent/extensions/dasein",
    piAutoDiscoveryShim: "index.ts",
    delegatedEntrypoint: "./src/index.ts",
    shimAllowedBehavior: "delegate-only",
  },
  settingsImports: {
    settingsListPackageName: "@earendil-works/pi-tui",
    settingsThemePackageName: "@earendil-works/pi-coding-agent",
    requiredRuntimeImports: ["SettingsList", "getSettingsListTheme", "matchesKey"],
    packagePlacement: "peerDependencies",
    bundledRuntimeDependency: false,
    liveSupportClaim: "not-claimed-by-fake-host",
  },
  fakePiHost: {
    recordsRegisteredCommands: true,
    recordsRegisteredFlags: true,
    recordsLifecycleHandlers: true,
    recordsEventBusHandlers: true,
    recordsUiStatusCalls: true,
    recordsUiCustomCalls: true,
    exposesMode: "tui-rpc-json-print",
    supportClaimBoundary: "api-shape-only-not-live-pi-smoke",
  },
};

test("src/index.ts exposes the runtime composition contract descriptor and a Pi extension factory", () => {
  const extensionFactory: DaseinPiExtensionFactory = createDaseinExtension;

  assert.equal(typeof extensionFactory, "function");
  assert.deepEqual(namedContract, {
    packageName: "dasein-pi-extension",
    installPath: "~/.pi/agent/extensions/dasein",
    rootShim: "index.ts",
    delegatedEntrypoint: "./src/index.ts",
    contractPurity: "real-module-composition",
  });
});

test("top-level contracts pin package, entrypoint, SettingsList import, and fake host obligations", () => {
  assert.equal(topLevelContract.package.runtimeDependencies, "none");
  assert.equal(topLevelContract.entrypoint.symlinkedInstallPath, "~/.pi/agent/extensions/dasein");
  assert.deepEqual(topLevelContract.settingsImports.requiredRuntimeImports, [
    "SettingsList",
    "getSettingsListTheme",
    "matchesKey",
  ]);
  assert.equal(topLevelContract.fakePiHost.supportClaimBoundary, "api-shape-only-not-live-pi-smoke");
});
