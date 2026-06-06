#!/usr/bin/env node
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") process.exit(0);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(repoRoot, "node_modules", ".bin");
mkdirSync(binDir, { recursive: true });

const realXcrun = "/usr/bin/xcrun";
const swiftc = spawnSync(realXcrun, ["--find", "swiftc"], { encoding: "utf8" });
const sdk = spawnSync(realXcrun, ["--show-sdk-path"], { encoding: "utf8" });
if (swiftc.status !== 0 || sdk.status !== 0) process.exit(0);

const swiftcWrapper = join(binDir, "dasein-swiftc");
writeFileSync(swiftcWrapper, `#!/bin/sh\nexport SDKROOT=${JSON.stringify(sdk.stdout.trim())}\nexec ${JSON.stringify(swiftc.stdout.trim())} "$@"\n`);
chmodSync(swiftcWrapper, 0o755);

const xcrunWrapper = join(binDir, "xcrun");
writeFileSync(xcrunWrapper, `#!/bin/sh\nif [ "$1" = "--find" ] && [ "$2" = "swiftc" ]; then\n  printf '%s\\n' ${JSON.stringify(swiftcWrapper)}\n  exit 0\nfi\nexec ${realXcrun} "$@"\n`);
chmodSync(xcrunWrapper, 0o755);
