#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TEST_ROOTS = ["tests/unit", "tests/integration", "tests/behavior", "tests/static"];

const listTestFiles = (directory) => {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTestFiles(path));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
};

const existingRoots = TEST_ROOTS.filter((root) => statSync(root, { throwIfNoEntry: false })?.isDirectory());
const testFiles = existingRoots.flatMap((root) => listTestFiles(root)).sort();

console.log(`dasein non-native test discovery: roots=${existingRoots.join(",")} files=${testFiles.length}`);
for (const testFile of testFiles) console.log(`dasein non-native test file: ${testFile}`);

if (testFiles.length === 0) {
  console.error("dasein non-native test discovery failed: no .test.ts files found");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
