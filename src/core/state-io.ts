/**
 * Narrow runtime I/O helper for durable state persistence.
 *
 * State contracts and in-memory store behavior stay in `state.ts`; this module
 * owns the explicit state.json filesystem boundary used by lifecycle/state
 * persistence, never by request-path injection.
 */

import { closeSync, existsSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DaseinDurableStateFile } from "./types.ts";

export type StateIoFailPoint = "write" | "fsync" | "rename";

export const writeStateAtomically = async ({
  path,
  value,
  failAt,
  fsyncAvailable = true,
}: {
  path: string;
  value: DaseinDurableStateFile;
  failAt?: StateIoFailPoint;
  fsyncAvailable?: boolean;
}): Promise<{ ok: boolean; fsynced: boolean; renamed: boolean; error?: unknown }> => {
  const tempPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  let fsynced = false;
  try {
    if (failAt === "write") throw new Error("durable_state write-failed at write");
    writeFileSync(tempPath, `${JSON.stringify(value)}\n`, "utf8");
    if (fsyncAvailable) {
      if (failAt === "fsync") throw new Error("durable_state write-failed at fsync");
      const fd = openSync(tempPath, "r");
      try {
        fsyncSync(fd);
        fsynced = true;
      } finally {
        closeSync(fd);
      }
    }
    if (failAt === "rename") throw new Error("durable_state write-failed at rename");
    renameSync(tempPath, path);
    return { ok: true, fsynced, renamed: true };
  } catch (caught) {
    rmSync(tempPath, { force: true });
    return { ok: false, fsynced, renamed: false, error: caught };
  }
};

export const readStateTextIfExists = async (path: string): Promise<string | null> => {
  if (!existsSync(path)) return null;
  return readFile(path, "utf8");
};
