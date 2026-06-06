import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..", "..");

const writeProbe = (probePath: string, home: string): void => writeFileSync(probePath, `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import createDaseinExtension from ${JSON.stringify(pathToFileURL(join(repoRoot, "src", "index.ts")).href)};
import { createFakePiHost, invokeFakeCommand, invokeFakeLifecycle } from ${JSON.stringify(pathToFileURL(join(repoRoot, "tests", "integration", "fixtures", "fake-pi-host.ts")).href)};

const main = async () => {
  const statePath = join(${JSON.stringify(home)}, '.pi', 'dasein', 'state.json');
  const host = createFakePiHost('tui');
  await createDaseinExtension(host.pi);
  await invokeFakeLifecycle(host, 'session_start');
  await invokeFakeLifecycle(host, 'input', { timestamp: 1000, turnId: 'turn-1' });
  await invokeFakeLifecycle(host, 'agent_end', { timestamp: 2000, turnId: 'turn-1' });
  const before = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(before.lapse.previous_human_input_at, 1000);
  assert.equal(before.lapse.previous_agent_end_at, 2000);

  const persistOff = await invokeFakeCommand(host, 'dasein', 'set sensors.lapse.persist false');
  assert.equal(persistOff.ok, true);
  const reset = await invokeFakeCommand(host, 'dasein', 'lapse reset');
  assert.equal(reset.ok, true);
  assert.equal(reset.data.actionPayload.memoryCleared, true);
  assert.equal(reset.data.actionPayload.persistedCleared, true);
  const after = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.deepEqual(after.lapse, { previous_human_input_at: null, previous_agent_end_at: null });
  const status = await invokeFakeCommand(host, 'dasein', 'status');
  assert.deepEqual(status.data.durableState.lapse, { previous_human_input_at: null, previous_agent_end_at: null });
  console.log('DASEIN_LAPSE_RESET_FAKE_PROOF ' + JSON.stringify({ before: before.lapse, after: after.lapse, reset: reset.data, persistOff: true }));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`);

test("/dasein lapse reset public command clears in-memory and persisted timestamps in fake-host wrapper", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "dasein-lapse-reset-fake-"));
  const home = join(tempRoot, "home");
  mkdirSync(home, { recursive: true });
  const probePath = join(tempRoot, "lapse-reset-fake-probe.mts");
  writeProbe(probePath, home);
  try {
    const run = spawnSync(process.execPath, ["--import", "tsx", probePath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: home,
        PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
        PI_CODING_AGENT_SESSION_DIR: join(home, ".pi", "agent", "sessions"),
      },
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.equal(run.signal, null, `lapse reset fake probe killed: ${run.stderr || run.stdout}`);
    assert.equal(run.status, 0, `lapse reset fake probe failed: ${run.stderr || run.stdout}`);
    assert.match(`${run.stdout}${run.stderr}`, /DASEIN_LAPSE_RESET_FAKE_PROOF/u);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
