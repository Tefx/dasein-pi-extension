#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

const fail = (message) => {
  console.error(`dasein package check failed: ${message}`);
  process.exitCode = 1;
};

if (packageJson.private === true) fail("package.json private must not be true for a publishable Pi package");
if (!Array.isArray(packageJson.keywords) || !packageJson.keywords.includes("pi-package")) fail("package.json keywords must include pi-package");
if (packageJson.pi?.extensions?.includes("./index.ts") !== true) fail("package.json pi.extensions must include ./index.ts");
if (JSON.stringify(packageJson.dependencies ?? {}) !== "{}") fail("runtime dependencies must remain empty for the current release design");
for (const peer of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
  if (packageJson.peerDependencies?.[peer] !== "*") fail(`${peer} must be a peerDependency with * range`);
}

const requiredFileWhitelist = [
  "index.ts",
  "src/",
  "docs/PRD.md",
  "docs/TECHNICAL_DESIGN.md",
  "docs/RELEASE.md",
  "docs/SENSOR_AUTHORING.md",
  "docs/config.sample.json",
  "CONSTITUTION.md",
];
for (const entry of requiredFileWhitelist) {
  if (!packageJson.files?.includes(entry)) fail(`package.json files must include ${entry}`);
}

let packOutput;
try {
  packOutput = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (error) {
  fail(`npm pack --dry-run --json failed: ${error instanceof Error ? error.message : String(error)}`);
}

let pack;
try {
  const parsed = JSON.parse(packOutput);
  pack = parsed?.[0];
} catch (error) {
  fail(`could not parse npm pack JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const paths = new Set((pack?.files ?? []).map((file) => file.path));
const requiredPackedPaths = [
  "package.json",
  "index.ts",
  "src/index.ts",
  "src/core/renderer.ts",
  "src/ui/status-format.ts",
  "src/native/macos-location-helper.swift",
  "docs/PRD.md",
  "docs/TECHNICAL_DESIGN.md",
  "docs/RELEASE.md",
  "docs/SENSOR_AUTHORING.md",
  "docs/config.sample.json",
  "CONSTITUTION.md",
];
for (const path of requiredPackedPaths) {
  if (!paths.has(path)) fail(`packed tarball missing required path: ${path}`);
}

const forbidden = [
  /^tests\//u,
  /^scripts\//u,
  /^\.dasein\//u,
  /^\.vectl\//u,
  /^node_modules\//u,
  /^plan\.yaml(?:\.lock)?$/u,
  /^package-lock\.json$/u,
  /^tsconfig\.json$/u,
  /^\.gitignore$/u,
];
for (const path of paths) {
  if (forbidden.some((pattern) => pattern.test(path))) fail(`packed tarball contains non-runtime/development path: ${path}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`dasein package check passed: ${paths.size} packed files, ${pack?.filename ?? "dry-run tarball"}`);
