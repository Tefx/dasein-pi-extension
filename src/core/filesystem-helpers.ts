/** Runtime filesystem helper for explicit sensor directory scans. */

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const listTypeScriptFilenames = (directoryPath: string): string[] => {
  try {
    return readdirSync(directoryPath)
      .filter((name) => !name.startsWith(".") && name.endsWith(".ts"))
      .sort();
  } catch {
    return [];
  }
};

export const createCacheBustedImportTarget = (filePath: string, token: string): string => {
  const source = readFileSync(filePath);
  const digest = createHash("sha256").update(source).digest("hex");
  const safeToken = token.replace(/[^A-Za-z0-9_-]/gu, "_");
  const cacheFile = join(dirname(filePath), `.dasein-reload-${basename(filePath, ".ts")}-${digest}-${safeToken}.ts`);
  mkdirSync(dirname(cacheFile), { recursive: true });
  copyFileSync(filePath, cacheFile);
  return cacheFile;
};

export const removeCacheBustedImportTarget = (filePath: string, importTarget: string): void => {
  if (importTarget !== filePath) rmSync(importTarget, { force: true });
};
