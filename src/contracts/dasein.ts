/**
 * Top-level Dasein TypeScript contracts for the scaffold phase.
 *
 * These interfaces pin package/tooling, entrypoint, SettingsList import, and
 * fake-host obligations without implementing runtime sensor, persistence, or
 * Pi UI behavior.
 */

export type ContractPurity = "stubs-types-docstrings-only";

export interface DaseinPackageContract {
  readonly packageManager: "npm";
  readonly moduleFormat: "typescript-esm-node";
  readonly requiredScripts: readonly [
    "typecheck",
    "test",
    "test:file",
    "test:native",
    "test:smoke",
  ];
  readonly runtimeDependencies: "none";
  readonly piPeerDependencies: readonly [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ];
  readonly dependencyPolicy: "zero-non-pi-runtime-npm-dependencies";
}

export interface DaseinEntrypointContract {
  readonly symlinkedInstallPath: "~/.pi/agent/extensions/dasein";
  readonly piAutoDiscoveryShim: "index.ts";
  readonly delegatedEntrypoint: "./src/index.ts";
  readonly shimAllowedBehavior: "delegate-only";
}

export interface DaseinSettingsImportContract {
  readonly packageName: "@earendil-works/pi-tui";
  readonly requiredRuntimeImports: readonly ["SettingsList", "getSettingsListTheme"];
  readonly packagePlacement: "peerDependencies";
  readonly bundledRuntimeDependency: false;
  readonly liveSupportClaim: "not-claimed-by-fake-host";
}

export interface DaseinFakePiHostApiContract {
  readonly recordsRegisteredCommands: true;
  readonly recordsRegisteredFlags: true;
  readonly recordsLifecycleHandlers: true;
  readonly recordsEventBusHandlers: true;
  readonly recordsUiStatusCalls: true;
  readonly recordsUiWidgetCalls: true;
  readonly recordsUiCustomCalls: true;
  readonly exposesMode: "tui-rpc-json-print";
  readonly supportClaimBoundary: "api-shape-only-not-live-pi-smoke";
}

export interface DaseinTopLevelContracts {
  readonly package: DaseinPackageContract;
  readonly entrypoint: DaseinEntrypointContract;
  readonly settingsImports: DaseinSettingsImportContract;
  readonly fakePiHost: DaseinFakePiHostApiContract;
}

export interface DaseinExtensionContract {
  readonly packageName: "dasein-pi-extension";
  readonly installPath: "~/.pi/agent/extensions/dasein";
  readonly rootShim: "index.ts";
  readonly delegatedEntrypoint: "./src/index.ts";
  readonly contractPurity: ContractPurity;
}
