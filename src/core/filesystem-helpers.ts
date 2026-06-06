/** Runtime filesystem helper for explicit sensor directory scans. */

import { readdirSync } from "node:fs";

export const listTypeScriptFilenames = (directoryPath: string): string[] => {
  try {
    return readdirSync(directoryPath).filter((name) => name.endsWith(".ts")).sort();
  } catch {
    return [];
  }
};
