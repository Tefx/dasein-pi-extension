#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TEST_ROOTS = ["tests/native"];

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

const runNodeTest = (testArgs) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testArgs], {
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
};

const explicitArgs = process.argv.slice(2);
if (explicitArgs.length > 0) {
  console.log(`dasein native test discovery: platform=${process.platform} mode=explicit args=${explicitArgs.length}`);
  for (const explicitArg of explicitArgs) console.log(`dasein native test arg: ${explicitArg}`);
  runNodeTest(explicitArgs);
}

const existingRoots = TEST_ROOTS.filter((root) => statSync(root, { throwIfNoEntry: false })?.isDirectory());
const testFiles = existingRoots.flatMap((root) => listTestFiles(root)).sort();

console.log(`dasein native test discovery: platform=${process.platform} roots=${existingRoots.join(",")} files=${testFiles.length}`);
for (const testFile of testFiles) console.log(`dasein native test file: ${testFile}`);

if (testFiles.length === 0) {
  console.error("dasein native test discovery failed: no .test.ts files found");
  process.exit(1);
}

runNodeTest(testFiles);
