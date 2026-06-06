import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const artifactRoot = join(repoRoot, ".dasein", "lapse-reset-smoke", "latest");
const refs = [
  "docs/TECHNICAL_DESIGN.md#builtin-sensors/lapse-continuity",
  "docs/PRD.md#9-5-builtin-sensors",
  "CONSTITUTION.md#testing-and-gates",
] as const;

const commandOutput = (command: string, args: readonly string[], cwd = repoRoot): { status: number | null; stdout: string; stderr: string; signal: NodeJS.Signals | null } => {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", signal: result.signal };
};

const discoverPiBinary = (): string => {
  const configured = process.env.DASEIN_PI_BINARY;
  if (configured !== undefined && configured.trim().length > 0) return configured;
  for (const candidate of ["/opt/homebrew/bin/pi", "/usr/local/bin/pi"]) {
    if (existsSync(candidate)) return candidate;
  }
  return commandOutput("/bin/sh", ["-lc", "command -v pi || true"]).stdout.trim();
};

const writeJson = (path: string, value: unknown): void => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const probeExtensionSource = (repo: string, home: string): string => `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import createDaseinExtension from ${JSON.stringify(join(repo, "src", "index.ts"))};
const statePath = join(${JSON.stringify(home)}, '.pi', 'dasein', 'state.json');
const refs = ${JSON.stringify(refs)};
export default function(pi) {
  let daseinHandler = null;
  const eventHandlers = new Map();
  const proxy = {
    ...pi,
    registerCommand(name, options) {
      if (name === 'dasein') daseinHandler = options.handler;
      return pi.registerCommand(name, options);
    },
    on(event, handler) {
      eventHandlers.set(event, handler);
      return pi.on(event, handler);
    },
  };
  createDaseinExtension(proxy);
  pi.registerCommand('dasein-lapse-reset-smoke-exit', {
    description: 'run Dasein lapse reset smoke and exit',
    handler: async (_args, ctx) => {
      if (daseinHandler === null) throw new Error('dasein handler was not registered');
      const smokeCtx = { ...ctx, mode: ctx.mode ?? 'print', ui: ctx.ui ?? {} };
      await eventHandlers.get('session_start')?.({ reason: 'lapse-reset-smoke' }, smokeCtx);
      await eventHandlers.get('input')?.({ timestamp: 1000, turnId: 'turn-1' }, smokeCtx);
      await eventHandlers.get('agent_end')?.({ timestamp: 2000, turnId: 'turn-1' }, smokeCtx);
      const before = JSON.parse(readFileSync(statePath, 'utf8')).lapse;
      const persistOff = await daseinHandler('set sensors.lapse.persist false', smokeCtx);
      const reset = await daseinHandler('lapse reset', smokeCtx);
      const after = JSON.parse(readFileSync(statePath, 'utf8')).lapse;
      const status = await daseinHandler('status', smokeCtx);
      const proof = {
        hostBoundary: 'live-pi-process-not-fake-host',
        refs,
        before,
        persistOffOk: persistOff.ok === true,
        resetOk: reset.ok === true,
        resetData: reset.data,
        after,
        statusDurableLapse: status.data.durableState.lapse,
        checklist_receipt: {
          previousTimestampsPersistedBeforeReset: before.previous_human_input_at === 1000 && before.previous_agent_end_at === 2000,
          resetWorksAfterPersistDisabled: persistOff.ok === true && reset.ok === true,
          memoryCleared: reset.data.actionPayload.memoryCleared === true,
          persistedCleared: after.previous_human_input_at === null && after.previous_agent_end_at === null,
          statusReflectsClearedDurableLapse: status.data.durableState.lapse.previous_human_input_at === null && status.data.durableState.lapse.previous_agent_end_at === null,
        },
      };
      console.log('DASEIN_LAPSE_RESET_LIVE_PROOF ' + JSON.stringify(proof));
      return { ok: true, command: 'dasein-lapse-reset-smoke-exit', message: 'dasein lapse reset smoke: ok', data: proof };
    },
  });
}
`;

test("live Pi wrapper clears lapse memory and persisted timestamps through /dasein lapse reset", () => {
  rmSync(artifactRoot, { recursive: true, force: true });
  mkdirSync(artifactRoot, { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), "dasein-lapse-reset-live-"));
  const home = mkdtempSync(join(tmpdir(), "dasein-lapse-reset-home-"));
  try {
    const piBinary = discoverPiBinary();
    if (piBinary.length === 0 || !existsSync(piBinary)) {
      const blocker = { code: "pi-binary-not-found", refs, PATH: process.env.PATH ?? "" };
      writeJson(join(artifactRoot, "checklist_receipt.json"), { blockers: [blocker], checklist_receipt: null });
      throw new Error(`LIVE_PI_ENVIRONMENT_BLOCKER ${JSON.stringify(blocker)}`);
    }
    const probePath = join(tempRoot, "lapse-reset-live-probe.ts");
    writeFileSync(probePath, probeExtensionSource(repoRoot, home));
    const run = spawnSync(piBinary, [
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-session",
      "--offline",
      "-e",
      probePath,
      "-p",
      "/dasein-lapse-reset-smoke-exit",
    ], {
      cwd: tempRoot,
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
        PI_CODING_AGENT_SESSION_DIR: join(home, ".pi", "agent", "sessions"),
        PI_OFFLINE: "1",
        NO_COLOR: "1",
      },
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    writeFileSync(join(artifactRoot, "pi-lapse-reset-stdout-stderr.log"), output);
    assert.equal(run.signal, null, "lapse reset smoke must not be killed by signal");
    assert.equal(run.status, 0, `lapse reset smoke must exit 0; output saved to ${artifactRoot}`);
    const line = output.split(/\r?\n/u).find((candidate) => candidate.includes("DASEIN_LAPSE_RESET_LIVE_PROOF "));
    assert.ok(line, "lapse reset live proof line must be present");
    const proof = JSON.parse(line.slice(line.indexOf("DASEIN_LAPSE_RESET_LIVE_PROOF ") + "DASEIN_LAPSE_RESET_LIVE_PROOF ".length)) as Record<string, unknown>;
    writeJson(join(artifactRoot, "lapse-reset-proof.json"), proof);
    writeJson(join(artifactRoot, "checklist_receipt.json"), { hostBoundary: "live-pi-process-not-fake-host", piBinary, refs, artifactDir: artifactRoot, checklist_receipt: proof.checklist_receipt, blockers: [] });
    const receipt = proof.checklist_receipt as Record<string, unknown>;
    assert.equal(receipt.previousTimestampsPersistedBeforeReset, true);
    assert.equal(receipt.resetWorksAfterPersistDisabled, true);
    assert.equal(receipt.memoryCleared, true);
    assert.equal(receipt.persistedCleared, true);
    assert.equal(receipt.statusReflectsClearedDurableLapse, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
