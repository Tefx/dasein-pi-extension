import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

type HelperPolicy = {
  helperPathForDirectoryInstall: string;
  spawnCommand: readonly ["swift", string, "--once"];
  timeoutMs: 3000;
  killGraceMs: 250;
  stdoutLimitBytes: 16384;
  stderrLimitBytes: 16384;
  backoffMs: readonly [60000, 300000, 900000];
  manualRefreshBypassesBackoffDelay: true;
  manualRefreshBypassesTimeout: false;
};

const skipReason = "macOS native helper gate requires process.platform === 'darwin' because it typechecks CoreLocation Swift helper behavior; non-macOS runs must skip explicitly.";
const helperPath = new URL("../../src/native/macos-location-helper.swift", import.meta.url).pathname;

if (process.platform !== "darwin") {
  test("macOS native helper contract is skipped on non-macOS", { skip: skipReason }, () => undefined);
} else {
  test("macOS CoreLocation helper source exists and typechecks only on macOS", () => {
    assert.equal(existsSync(helperPath), true, "directory/package installs require <extension_root>/src/native/macos-location-helper.swift");
    const swiftc = spawnSync("xcrun", ["--find", "swiftc"], { encoding: "utf8" });
    assert.equal(swiftc.status, 0, `swiftc must be discoverable on macOS native gate: ${swiftc.stderr || swiftc.stdout}`);
    const typecheck = spawnSync(swiftc.stdout.trim(), ["-typecheck", helperPath], { encoding: "utf8" });
    assert.equal(typecheck.status, 0, `macos-location-helper.swift must typecheck: ${typecheck.stderr || typecheck.stdout}`);
  });

  test("macOS native helper runtime policy exposes timeout, kill grace, caps, and backoff constants", async () => {
    const api = await loadDaseinApi();
    const getMacOSLocationHelperRuntimePolicy = requireExportedFunction(api, "getMacOSLocationHelperRuntimePolicy", "docs/TECHNICAL_DESIGN.md#builtin-sensors native helper cleanup guarantees") as (input: { extensionRoot: string; installMode: "directory" }) => HelperPolicy;
    const policy = getMacOSLocationHelperRuntimePolicy({ extensionRoot: "/extension", installMode: "directory" });

    assert.equal(policy.helperPathForDirectoryInstall, "/extension/src/native/macos-location-helper.swift");
    assert.deepEqual(policy.spawnCommand, ["swift", "/extension/src/native/macos-location-helper.swift", "--once"]);
    assert.equal(policy.timeoutMs, 3000);
    assert.equal(policy.killGraceMs, 250);
    assert.equal(policy.stdoutLimitBytes, 16 * 1024);
    assert.equal(policy.stderrLimitBytes, 16 * 1024);
    assert.deepEqual(policy.backoffMs, [60_000, 300_000, 900_000], "helper retry backoff must be 1m -> 5m -> 15m");
    assert.equal(policy.manualRefreshBypassesBackoffDelay, true);
    assert.equal(policy.manualRefreshBypassesTimeout, false);
  });
}
