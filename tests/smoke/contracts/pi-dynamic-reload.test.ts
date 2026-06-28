import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const artifactRoot = join(repoRoot, ".dasein", "dynamic-reload-smoke", "latest");
const minimumPiVersion = "0.78.1";

const refs = [
  "docs/TECHNICAL_DESIGN.md#sensor-loading-and-reload",
  "docs/TECHNICAL_DESIGN.md#testing-gate-matrix",
  "docs/PRD.md#7-11-sensor-reload",
  "docs/PRD.md#9-7-sensor-loading-and-reload",
  "CONSTITUTION.md#architectural-dogmas",
  "CONSTITUTION.md#quality-baselines",
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

const parseVersion = (value: string): readonly number[] => value.trim().split(".").map((part) => Number.parseInt(part, 10));
const isAtLeast = (actual: string, minimum: string): boolean => {
  const actualParts = parseVersion(actual);
  const minimumParts = parseVersion(minimum);
  for (let index = 0; index < minimumParts.length; index += 1) {
    const left = actualParts[index] ?? 0;
    const right = minimumParts[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
};

const writeJson = (path: string, value: unknown): void => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const sensorSource = (label: "v1" | "v2"): string => `
const label = ${JSON.stringify(label)};
const spec = {
  key: "dynamic_smoke",
  defaults: { enabled: true, ui: true, agent: true, staleAfterMs: 60000, initialRefresh: true },
  manifest: {
    description: "dynamic reload manifest ${label}",
    declaredInputClasses: ["derived"],
    outputFields: [{ state_key: "dynamic.version", value_type: "string", description: "dynamic version", agentVisibleByDefault: true, uiVisibleByDefault: true }],
    permissions: [{ kind: "none", required: false, reason: "local smoke fixture" }],
    remote: { capable: false, contactsNetworkByDefault: false, destinations: [], payloadClasses: [], transmissionCadence: "none", disableControl: "none", description: "none" },
    backgroundWork: { capable: false, kinds: [], defaultIntervalMs: null, intervalRelationship: "none", description: "none" },
  },
  refresh: async () => ({
    fields: {
      "dynamic.version": {
        contract_version: 1,
        schema_version: 1,
        sensor_id: "dynamic_smoke",
        state_key: "dynamic.version",
        value: "manifest-${label}",
        value_type: "string",
        collected_at: Date.now(),
        stale_after_ms: 60000,
        status: "enabled",
        source: { sensor_id: "dynamic_smoke", source_kind: "local_sensor", local_file_path: import.meta.url },
      },
    },
  }),
};
export default spec;
`;

const probeExtensionSource = (tempRoot: string, sensorPath: string): string => `
import { writeFileSync } from 'node:fs';
import createDaseinExtension from ${JSON.stringify(join(tempRoot, "src", "index.ts"))};
const sensorPath = ${JSON.stringify(sensorPath)};
const sensorV2 = ${JSON.stringify(sensorSource("v2"))};
const invalidSensor = 'export default { key: ';
const proof = {
  hostBoundary: 'live-pi-process-not-fake-host',
  refs: ${JSON.stringify(refs)},
  cacheBustStrategy: 'content-addressed hidden .dasein-reload-<sensor>-<sha256>.ts import target plus ?reload token; hidden cache file is removed after import',
  oldStatePreservedStrategy: 'manual reload imports/validates sensor candidate before disk-config commit; on sensor failure only loadErrors/attemptedFiles are updated while entries/config/runtime/rendered context remain previous',
  loadErrorSurface: '/dasein reload returns ok:false with SensorLoadError; /dasein sensors reports loadErrors alongside old loaded records',
  fixturePath: sensorPath,
};
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
  pi.registerCommand('dasein-dynamic-smoke-exit', {
    description: 'run Dasein dynamic reload smoke and exit',
    handler: async (_args, ctx) => {
      if (daseinHandler === null) throw new Error('dasein handler was not registered');
      const smokeCtx = { ...ctx, mode: ctx.mode ?? 'print', ui: ctx.ui ?? {} };
      await eventHandlers.get('session_start')?.({ reason: 'dynamic-smoke' }, smokeCtx);
      const ambientPromptText = async () => {
        const event = { systemPrompt: 'BASE SYSTEM', messages: [] };
        const result = await eventHandlers.get('before_agent_start')?.(event, smokeCtx);
        if (event.messages.length !== 0) throw new Error('Dasein ambient injection appended a user/custom message');
        if (typeof result?.systemPrompt === 'string' && result.systemPrompt !== event.systemPrompt) throw new Error('Dasein returned mismatched systemPrompt');
        return String(event.systemPrompt ?? '');
      };
      const initialSensors = await daseinHandler('sensors', smokeCtx);
      const initialDynamic = initialSensors.data.sensors.find((item) => item.key === 'dynamic_smoke');
      proof.initialManifestV1 = initialDynamic?.manifest?.description === 'dynamic reload manifest v1';
      proof.initialRenderedHasV1 = (await ambientPromptText()).includes('manifest-v1');

      writeFileSync(sensorPath, sensorV2);
      const validReload = await daseinHandler('reload', smokeCtx);
      const sensorsAfterValid = await daseinHandler('sensors', smokeCtx);
      const dynamicAfterValid = sensorsAfterValid.data.sensors.find((item) => item.key === 'dynamic_smoke');
      const renderedAfterValid = await ambientPromptText();
      proof.validReloadResult = validReload.message;
      proof.validReloadOk = validReload.ok === true;
      proof.cacheBustManifestV2 = dynamicAfterValid?.manifest?.description === 'dynamic reload manifest v2';
      proof.renderedContextAfterChangeHasV2 = renderedAfterValid.includes('manifest-v2');

      writeFileSync(sensorPath, invalidSensor);
      const invalidReload = await daseinHandler('reload', smokeCtx);
      const sensorsAfterInvalid = await daseinHandler('sensors', smokeCtx);
      const statusAfterInvalid = await daseinHandler('status', smokeCtx);
      const renderedAfterInvalid = await ambientPromptText();
      proof.invalidReloadResult = invalidReload.message;
      proof.invalidReloadFails = invalidReload.ok === false;
      proof.invalidReloadErrorKinds = (invalidReload.errors ?? []).map((error) => error.kind);
      proof.invalidLoadErrorsReportedInSensorsOrStatus = JSON.stringify([sensorsAfterInvalid.data.loadErrors, statusAfterInvalid.data.loadErrors]).includes('SensorLoadError');
      proof.preservedRenderedContextAfterInvalid = renderedAfterInvalid.includes('manifest-v2') && !renderedAfterInvalid.includes('manifest-v1');
      proof.oldRegistryPreservedAfterInvalid = sensorsAfterInvalid.data.sensors.some((item) => item.key === 'dynamic_smoke' && item.loaded === true && item.manifest.description === 'dynamic reload manifest v2');
      proof.checklist_receipt = {
        cacheBustManifestV2: proof.cacheBustManifestV2,
        renderedContextAfterChangeHasV2: proof.renderedContextAfterChangeHasV2,
        invalidReloadFails: proof.invalidReloadFails,
        invalidLoadErrorsReportedInSensorsOrStatus: proof.invalidLoadErrorsReportedInSensorsOrStatus,
        preservedRenderedContextAfterInvalid: proof.preservedRenderedContextAfterInvalid,
        oldRegistryPreservedAfterInvalid: proof.oldRegistryPreservedAfterInvalid,
      };
      console.log('DASEIN_DYNAMIC_RELOAD_PROOF ' + JSON.stringify(proof));
      return { ok: true, command: 'dasein-dynamic-smoke-exit', message: 'dasein dynamic reload smoke: ok', data: proof };
    },
  });
}
`;

test("live Pi dynamic sensor reload cache-busts and keeps old state on invalid replacement", () => {
  rmSync(artifactRoot, { recursive: true, force: true });
  mkdirSync(artifactRoot, { recursive: true });
  const tempRoot = mkdtempSync(join(tmpdir(), "dasein-dynamic-reload-extension-"));
  const home = mkdtempSync(join(tmpdir(), "dasein-dynamic-reload-home-"));
  try {
    const piBinary = discoverPiBinary();
    if (piBinary.length === 0 || !existsSync(piBinary)) {
      const blocker = { code: "pi-binary-not-found", refs, PATH: process.env.PATH ?? "" };
      writeJson(join(artifactRoot, "checklist_receipt.json"), { blockers: [blocker], checklist_receipt: null });
      throw new Error(`LIVE_PI_ENVIRONMENT_BLOCKER ${JSON.stringify(blocker)}`);
    }
    const versionResult = commandOutput(piBinary, ["--version"]);
    const piVersion = `${versionResult.stdout}${versionResult.stderr}`.trim();
    assert.equal(versionResult.status, 0, "pi --version must exit 0");
    assert.match(piVersion, /^\d+\.\d+\.\d+$/u);
    assert.equal(isAtLeast(piVersion, minimumPiVersion), true, `Pi ${piVersion} must be >= ${minimumPiVersion}`);

    cpSync(join(repoRoot, "src"), join(tempRoot, "src"), { recursive: true });
    const sensorPath = join(tempRoot, "src", "sensors", "dynamic-smoke.ts");
    writeFileSync(sensorPath, sensorSource("v1"));
    const probePath = join(tempRoot, "dynamic-reload-probe.ts");
    writeFileSync(probePath, probeExtensionSource(tempRoot, sensorPath));

    const run = spawnSync(piBinary, [
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-session",
      "--offline",
      "-e",
      probePath,
      "--dasein",
      "core.agentInjectionTransport=systemPrompt",
      "-p",
      "/dasein-dynamic-smoke-exit",
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
    writeFileSync(join(artifactRoot, "pi-dynamic-reload-stdout-stderr.log"), output);
    assert.equal(run.signal, null, "dynamic reload smoke must not be killed by signal");
    assert.equal(run.status, 0, `dynamic reload smoke must exit 0; output saved to ${artifactRoot}`);
    const line = output.split(/\r?\n/u).find((candidate) => candidate.includes("DASEIN_DYNAMIC_RELOAD_PROOF "));
    assert.ok(line, "dynamic reload proof line must be present");
    const proof = JSON.parse(line.slice(line.indexOf("DASEIN_DYNAMIC_RELOAD_PROOF ") + "DASEIN_DYNAMIC_RELOAD_PROOF ".length)) as Record<string, unknown>;
    writeJson(join(artifactRoot, "dynamic-reload-proof.json"), proof);
    writeJson(join(artifactRoot, "checklist_receipt.json"), {
      hostBoundary: "live-pi-process-not-fake-host",
      piBinary,
      piVersion,
      minimumPiVersion,
      refs,
      artifactDir: artifactRoot,
      checklist_receipt: proof.checklist_receipt,
      blockers: [],
    });
    assert.equal(proof.cacheBustManifestV2, true);
    assert.equal(proof.renderedContextAfterChangeHasV2, true);
    assert.equal(proof.invalidReloadFails, true);
    assert.equal(proof.invalidLoadErrorsReportedInSensorsOrStatus, true);
    assert.equal(proof.preservedRenderedContextAfterInvalid, true);
    assert.equal(proof.oldRegistryPreservedAfterInvalid, true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
