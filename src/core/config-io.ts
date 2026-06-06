/**
 * Narrow runtime I/O helper for config persistence.
 *
 * Core config contracts and validation stay in `config.ts`; this module owns the
 * Node filesystem/path boundary used only during startup/reload/runtime mutation,
 * never on the LLM request injection path.
 */

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ConfigIoFailPoint = "write" | "fsync" | "rename";

export const writeConfigAtomically = async ({
  path,
  value,
  failAt,
  fsyncAvailable = true,
}: {
  path: string;
  value: unknown;
  failAt?: ConfigIoFailPoint;
  fsyncAvailable?: boolean;
}): Promise<{ ok: boolean; tempPath: string; fsynced: boolean; renamed: boolean; error?: unknown }> => {
  const tempPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  let fsynced = false;
  try {
    if (failAt === "write") throw new Error("config write failed at write");
    writeFileSync(tempPath, `${JSON.stringify(value)}\n`, "utf8");
    if (fsyncAvailable) {
      if (failAt === "fsync") throw new Error("config write failed at fsync");
      const fd = openSync(tempPath, "r");
      try {
        fsyncSync(fd);
        fsynced = true;
      } finally {
        closeSync(fd);
      }
    }
    if (failAt === "rename") throw new Error("config write failed at rename");
    renameSync(tempPath, path);
    return { ok: true, tempPath, fsynced, renamed: true };
  } catch (caught) {
    rmSync(tempPath, { force: true });
    return { ok: false, tempPath, fsynced, renamed: false, error: caught };
  }
};

export const readTextFileIfExistsSync = (path: string | undefined): string | null => {
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, "utf8");
};

export const readTextFileIfExists = async (path: string | undefined): Promise<string | null> => {
  if (!path || !existsSync(path)) return null;
  return readFile(path, "utf8");
};
