import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const artifactRoot = join(repoRoot, ".dasein", "live-pi-smoke");
const latestArtifactDir = join(artifactRoot, "latest");
const minimumPiVersion = "0.78.1";

type SpawnResult = {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

type ProbeProcess = {
  readonly result: SpawnResult;
  readonly output: string;
};

type ChecklistReceipt = {
  readonly hostBoundary: "live-pi-process-not-fake-host";
  readonly piBinary: string;
  readonly piVersion: string;
  readonly minimumPiVersion: typeof minimumPiVersion;
  readonly artifactDir: string;
  readonly refs: readonly string[];
  readonly checks: Record<string, unknown>;
  readonly blockers: readonly string[];
};

type ProofRecord = Record<string, unknown>;

const refs = [
  "docs/TECHNICAL_DESIGN.md#verified-pi-mechanisms: LIVE_SMOKE_VERIFIED means observed in a live Pi process; source/API evidence alone cannot ship support claims.",
  "docs/TECHNICAL_DESIGN.md#testing-gate-matrix: npm run test:smoke is release smoke only and requires live Pi TUI/process for SettingsList/status/widget behavior.",
  "docs/PRD.md#9-4-tui: status footer, optional widget, and SettingsList toggles must reflect effective configuration.",
  "CONSTITUTION.md#quality-baselines: mock tests must not be treated as integration proof; black-box liveness evidence takes precedence.",
  "CONSTITUTION.md#ux-and-pi-interaction-red-lines: Pi/UI mechanisms need live verification with mechanism name, Pi version, binary path, and executable artifacts or signoff.",
] as const;

const cleanArtifactDir = (): void => {
  rmSync(latestArtifactDir, { recursive: true, force: true });
  mkdirSync(latestArtifactDir, { recursive: true });
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const blocker = (code: string, details: Record<string, unknown>): never => {
  mkdirSync(latestArtifactDir, { recursive: true });
  const payload = {
    code,
    details,
    refs,
    hostBoundary: "live-pi-process-not-fake-host",
    remediation: "Run npm run test:smoke on a host with Pi >= 0.78.1, a working pty-compatible TUI, and no fake-host substitution.",
  };
  writeJson(join(latestArtifactDir, "environment-blocker.json"), payload);
  throw new Error(`LIVE_PI_ENVIRONMENT_BLOCKER ${code}: ${JSON.stringify(details)}`);
};

const commandOutput = (command: string, args: readonly string[], timeout = 10_000): SpawnResult => {
  const result = spawnSync(command, [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const discoverPiBinary = (): string => {
  const configured = process.env.DASEIN_PI_BINARY;
  if (configured !== undefined && configured.trim().length > 0) {
    if (!existsSync(configured)) blocker("configured-pi-binary-missing", { piBinary: configured });
    return configured;
  }
  for (const candidate of ["/opt/homebrew/bin/pi", "/usr/local/bin/pi"]) {
    if (existsSync(candidate)) return candidate;
  }
  const which = commandOutput("/bin/sh", ["-lc", "command -v pi || true"]);
  const found = which.stdout.trim();
  if (found.length === 0) blocker("pi-binary-not-found", { PATH: process.env.PATH ?? "" });
  return found;
};

const parseVersion = (value: string): readonly number[] => value.trim().split(".").map((part) => Number.parseInt(part, 10));

const assertMinimumVersion = (actual: string): void => {
  const actualParts = parseVersion(actual);
  const minimumParts = parseVersion(minimumPiVersion);
  for (let index = 0; index < minimumParts.length; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (actualPart > minimumPart) return;
    if (actualPart < minimumPart) blocker("pi-version-below-minimum", { actual, minimumPiVersion });
  }
};

const isolatedEnv = (home: string): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: home,
  PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
  PI_CODING_AGENT_SESSION_DIR: join(home, ".pi", "agent", "sessions"),
  PI_OFFLINE: "1",
  NO_COLOR: "1",
});

const spawnPi = (input: {
  readonly piBinary: string;
  readonly args: readonly string[];
  readonly home: string;
  readonly timeoutMs: number;
  readonly artifactName: string;
}): ProbeProcess => {
  const result = spawnSync(input.piBinary, [...input.args], {
    cwd: repoRoot,
    env: isolatedEnv(input.home),
    encoding: "utf8",
    timeout: input.timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });
  const normalized = {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  const output = `${normalized.stdout}${normalized.stderr}`;
  writeFileSync(join(latestArtifactDir, input.artifactName), output);
  return { result: normalized, output };
};

const tclQuote = (value: string): string => `{${value.replace(/\\/gu, "\\\\").replace(/\}/gu, "\\}")}}`;

const tclList = (values: readonly string[]): string => `[list ${values.map(tclQuote).join(" ")}]`;

const spawnPiViaScript = (input: {
  readonly piBinary: string;
  readonly args: readonly string[];
  readonly home: string;
  readonly timeoutMs: number;
  readonly rawArtifactName: string;
}): ProbeProcess => {
  const expectBinary = "/usr/bin/expect";
  if (!existsSync(expectBinary)) blocker("pty-expect-binary-not-found", { expectBinary });
  const rawArtifactPath = join(latestArtifactDir, input.rawArtifactName);
  const expectScriptPath = join(latestArtifactDir, `${input.rawArtifactName}.expect`);
  const env = isolatedEnv(input.home);
  writeFileSync(expectScriptPath, `
set timeout ${Math.ceil(input.timeoutMs / 1000)}
log_file -noappend ${tclQuote(rawArtifactPath)}
set env(HOME) ${tclQuote(env.HOME ?? input.home)}
set env(PI_CODING_AGENT_DIR) ${tclQuote(env.PI_CODING_AGENT_DIR ?? join(input.home, ".pi", "agent"))}
set env(PI_CODING_AGENT_SESSION_DIR) ${tclQuote(env.PI_CODING_AGENT_SESSION_DIR ?? join(input.home, ".pi", "agent", "sessions"))}
set env(PI_OFFLINE) 1
set env(NO_COLOR) 1
set command ${tclList([input.piBinary, ...input.args])}
spawn -noecho {*}$command
expect {
  eof {}
  timeout { exit 124 }
}
set wait_result [wait]
set exit_status [lindex $wait_result 3]
exit $exit_status
`);
  const result = spawnSync(expectBinary, [expectScriptPath], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    timeout: input.timeoutMs + 5_000,
    maxBuffer: 30 * 1024 * 1024,
  });
  const normalized = {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
  const raw = existsSync(rawArtifactPath) ? readFileSync(rawArtifactPath, "utf8") : "";
  const output = `${normalized.stdout}${normalized.stderr}${raw}`;
  writeFileSync(join(latestArtifactDir, `${input.rawArtifactName}.stdout.log`), `${normalized.stdout}${normalized.stderr}`);
  writeFileSync(join(latestArtifactDir, `${input.rawArtifactName}.text`), stripAnsi(raw));
  return { result: normalized, output };
};

const stripAnsi = (value: string): string => value
  .replace(/\x1B\][^\u0007]*(?:\u0007|\x1B\\)/gu, "")
  .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/gu, "");

const writeProbe = (name: string, content: string): string => {
  const path = join(latestArtifactDir, name);
  writeFileSync(path, content);
  return path;
};

const extractJsonAfter = (output: string, prefix: string): unknown => {
  const line = output.split(/\r?\n/u).find((candidate) => candidate.includes(prefix));
  assert.ok(line, `missing live Pi probe line ${prefix}`);
  const jsonStart = line.indexOf(prefix) + prefix.length;
  return JSON.parse(line.slice(jsonStart).trim()) as unknown;
};

const recordOf = (value: unknown, label: string): ProofRecord => {
  assert.equal(typeof value, "object", `${label} must be an object`);
  assert.notEqual(value, null, `${label} must not be null`);
  assert.equal(Array.isArray(value), false, `${label} must not be an array`);
  return value as ProofRecord;
};

const recordArrayOf = (value: unknown, label: string): readonly ProofRecord[] => {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  return (value as readonly unknown[]).map((item, index) => recordOf(item, `${label}[${index}]`));
};

const assertOkProcess = (label: string, process: ProbeProcess): void => {
  assert.equal(process.result.signal, null, `${label} must not be killed by signal`);
  assert.equal(process.result.status, 0, `${label} must exit 0; output artifact written under ${latestArtifactDir}`);
};

const basePiArgs = (extensionPath: string): readonly string[] => [
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--no-session",
  "--offline",
  "-e",
  extensionPath,
];

const runApiProbe = (piBinary: string, home: string): { readonly factory: unknown; readonly session: unknown } => {
  const extensionPath = writeProbe("api-signature-probe.ts", `
export default function(pi) {
  console.log('DASEIN_LIVE_API_FACTORY ' + JSON.stringify({
    hostBoundary: 'live-pi-process-not-fake-host',
    keys: Object.keys(pi).sort(),
    version: pi.version ?? null,
    binaryPath: pi.binaryPath ?? null,
  }));
  pi.registerCommand('dasein-smoke-exit', {
    description: 'exit live smoke',
    handler: async (_args, ctx) => {
      console.log('DASEIN_LIVE_API_COMMAND ' + JSON.stringify({ mode: ctx.mode, uiKeys: Object.keys(ctx.ui ?? {}).sort() }));
      ctx.shutdown?.();
    },
  });
  pi.on('session_start', (event, ctx) => {
    console.log('DASEIN_LIVE_API_SESSION ' + JSON.stringify({
      eventKeys: Object.keys(event ?? {}).sort(),
      mode: ctx.mode,
      hasUI: ctx.hasUI ?? null,
      uiKeys: Object.keys(ctx.ui ?? {}).sort(),
    }));
  });
  pi.on('input', (event, ctx) => {
    console.log('DASEIN_LIVE_API_INPUT ' + JSON.stringify({ eventKeys: Object.keys(event ?? {}).sort(), mode: ctx.mode, text: event.text }));
    ctx.shutdown?.();
    return { action: 'handled' };
  });
  pi.on('session_shutdown', (event, ctx) => {
    console.log('DASEIN_LIVE_API_SHUTDOWN ' + JSON.stringify({ eventKeys: Object.keys(event ?? {}).sort(), mode: ctx.mode }));
  });
}
`);
  const process = spawnPi({
    piBinary,
    home,
    args: [...basePiArgs(extensionPath), "-p", "dasein live api smoke"],
    timeoutMs: 45_000,
    artifactName: "api-signature-probe.log",
  });
  assertOkProcess("api-signature-probe", process);
  const factory = extractJsonAfter(process.output, "DASEIN_LIVE_API_FACTORY ");
  const session = extractJsonAfter(process.output, "DASEIN_LIVE_API_SESSION ");
  assert.match(process.output, /DASEIN_LIVE_API_INPUT/u);
  assert.match(process.output, /DASEIN_LIVE_API_SHUTDOWN/u);
  writeJson(join(latestArtifactDir, "api-signature-probe.json"), { factory, session });
  return { factory, session };
};

const runTuiRenderProbe = (piBinary: string, home: string): { readonly renderedStatus: boolean; readonly renderedWidget: boolean } => {
  const extensionPath = writeProbe("tui-render-probe.ts", `
export default function(pi) {
  pi.on('session_start', (_event, ctx) => {
    console.log('DASEIN_LIVE_TUI_RENDER_SESSION ' + JSON.stringify({ mode: ctx.mode, hasUI: ctx.hasUI ?? null, uiKeys: Object.keys(ctx.ui ?? {}).sort() }));
    ctx.ui.setStatus?.('dasein-smoke', 'DASEIN_SMOKE_STATUS_RENDERED');
    ctx.ui.setWidget?.('dasein-smoke', ['DASEIN_SMOKE_WIDGET_LINE_A', 'DASEIN_SMOKE_WIDGET_LINE_B']);
    setTimeout(() => ctx.shutdown?.(), 1200);
  });
  pi.on('session_shutdown', (_event, ctx) => console.log('DASEIN_LIVE_TUI_RENDER_SHUTDOWN ' + JSON.stringify({ mode: ctx.mode })));
}
`);
  const process = spawnPiViaScript({
    piBinary,
    home,
    args: basePiArgs(extensionPath),
    timeoutMs: 45_000,
    rawArtifactName: "tui-render.raw",
  });
  assertOkProcess("tui-render-probe", process);
  assert.match(process.output, /DASEIN_LIVE_TUI_RENDER_SESSION .*"mode":"tui"/u);
  const renderedStatus = process.output.includes("DASEIN_SMOKE_STATUS_RENDERED");
  const renderedWidget = process.output.includes("DASEIN_SMOKE_WIDGET_LINE_A") && process.output.includes("DASEIN_SMOKE_WIDGET_LINE_B");
  assert.equal(renderedStatus, true, "raw TUI transcript must contain the rendered footer status sentinel");
  assert.equal(renderedWidget, true, "raw TUI transcript must contain rendered widget line sentinels");
  writeJson(join(latestArtifactDir, "tui-render-proof.json"), {
    mode: "tui",
    renderedStatus,
    renderedWidget,
    rawArtifact: "tui-render.raw",
    textArtifact: "tui-render.raw.text",
  });
  return { renderedStatus, renderedWidget };
};

const runSlashCommandProofProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const extensionPath = writeProbe("slash-command-proof-probe.ts", `
import createDaseinExtension from ${JSON.stringify(daseinEntryPath)};

const safeJson = (value) => JSON.stringify(value, (_key, candidate) => {
  if (typeof candidate === 'bigint') return candidate.toString();
  if (candidate === undefined) return '__undefined__';
  return candidate;
});

export default function(pi) {
  const proof = {
    hostBoundary: 'live-pi-process-not-fake-host',
    literalCommand: '/dasein',
    literalPrompt: '/dasein status',
    registrations: [],
    invocations: [],
    results: [],
  };
  const proxy = {
    ...pi,
    registerCommand(name, options) {
      proof.registrations.push({
        name,
        literalRegistered: '/' + name,
        description: options.description ?? null,
        rawArgs: options.rawArgs === true,
        completions: options.completions === true,
      });
      return pi.registerCommand(name, {
        ...options,
        handler: async (args, ctx) => {
          proof.invocations.push({ name, literalInvoked: '/' + name, args, mode: ctx.mode });
          const result = await options.handler(args, ctx);
          proof.results.push(result);
          console.log('DASEIN_LIVE_SLASH_COMMAND_PROOF ' + safeJson(proof));
          return result;
        },
      });
    },
  };
  createDaseinExtension(proxy);
}
`);
  const process = spawnPi({
    piBinary,
    home,
    args: [...basePiArgs(extensionPath), "-p", "/dasein status"],
    timeoutMs: 45_000,
    artifactName: "slash-command-proof.log",
  });
  assertOkProcess("slash-command-proof-probe", process);
  const proof = recordOf(extractJsonAfter(process.output, "DASEIN_LIVE_SLASH_COMMAND_PROOF "), "slashCommandProof");
  assert.equal(proof.hostBoundary, "live-pi-process-not-fake-host");
  assert.equal(proof.literalCommand, "/dasein");
  assert.equal(proof.literalPrompt, "/dasein status");
  const registrations = recordArrayOf(proof.registrations, "slashCommandProof.registrations");
  const invocations = recordArrayOf(proof.invocations, "slashCommandProof.invocations");
  const results = recordArrayOf(proof.results, "slashCommandProof.results");
  assert.equal(registrations.some((entry) => entry.name === "dasein" && entry.literalRegistered === "/dasein" && entry.rawArgs === true && entry.completions === true), true);
  assert.equal(invocations.some((entry) => entry.name === "dasein" && entry.literalInvoked === "/dasein" && entry.args === "status" && entry.mode === "print"), true);
  assert.equal(results.some((entry) => entry.ok === true && entry.command === "status"), true);
  writeJson(join(latestArtifactDir, "slash-command-proof.json"), proof);
  return proof;
};

const runLaunchFlagProofProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const launchValue = "core.agentInjectionEnabled=false,core.statusEnabled=false,core.widgetEnabled=false";
  const extensionPath = writeProbe("launch-flag-proof-probe.ts", `
import createDaseinExtension from ${JSON.stringify(daseinEntryPath)};
import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai';

const faux = registerFauxProvider({
  api: 'dasein-live-launch-faux-api',
  provider: 'dasein-live-launch-faux',
  models: [{
    id: 'dasein-live-launch-faux-model',
    name: 'Dasein Live Launch Faux Model',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 1000,
  }],
});
faux.setResponses([fauxAssistantMessage('launch proof ok')]);

const safeJson = (value) => JSON.stringify(value, (_key, candidate) => {
  if (typeof candidate === 'bigint') return candidate.toString();
  if (candidate === undefined) return '__undefined__';
  return candidate;
});

export default function(pi) {
  pi.registerProvider('dasein-live-launch-faux', {
    baseUrl: 'http://localhost:0',
    apiKey: 'dummy',
    api: faux.api,
    models: faux.models,
  });
  const proof = {
    hostBoundary: 'live-pi-process-not-fake-host',
    argvLiteral: '--dasein',
    argvValue: ${JSON.stringify(launchValue)},
    registeredFlags: [],
    getFlagReads: [],
    contextEffect: null,
  };
  const proxy = {
    ...pi,
    registerFlag(name, options) {
      proof.registeredFlags.push({ name, type: options.type, literalFlag: '--' + name });
      return pi.registerFlag(name, options);
    },
    getFlag(name) {
      const value = pi.getFlag(name);
      proof.getFlagReads.push({ name, literalFlag: '--' + name, value });
      return value;
    },
    on(event, handler) {
      if (event === 'context') {
        return pi.on(event, async (evt, ctx) => {
          const beforeCount = Array.isArray(evt?.messages) ? evt.messages.length : 0;
          const result = await handler(evt, ctx);
          const afterMessages = Array.isArray(evt?.messages) ? evt.messages : [];
          proof.contextEffect = {
            mode: ctx.mode,
            beforeCount,
            afterCount: afterMessages.length,
            daseinCustomMessages: afterMessages.filter((message) => message?.role === 'custom' && message?.customType === 'dasein').length,
            agentInjectionDisabledByLaunchFlag: afterMessages.length === beforeCount,
            handlerReturnedUndefined: result === undefined,
          };
          console.log('DASEIN_LIVE_LAUNCH_FLAG_PROOF ' + safeJson(proof));
          return result;
        });
      }
      return pi.on(event, handler);
    },
  };
  createDaseinExtension(proxy);
}
`);
  const process = spawnPi({
    piBinary,
    home,
    args: [...basePiArgs(extensionPath), "--dasein", launchValue, "--model", "dasein-live-launch-faux/dasein-live-launch-faux-model", "-p", "trigger launch flag proof"],
    timeoutMs: 45_000,
    artifactName: "launch-flag-proof.log",
  });
  assertOkProcess("launch-flag-proof-probe", process);
  const proof = recordOf(extractJsonAfter(process.output, "DASEIN_LIVE_LAUNCH_FLAG_PROOF "), "launchFlagProof");
  assert.equal(proof.hostBoundary, "live-pi-process-not-fake-host");
  assert.equal(proof.argvLiteral, "--dasein");
  assert.equal(proof.argvValue, launchValue);
  assert.equal(recordArrayOf(proof.registeredFlags, "launchFlagProof.registeredFlags").some((entry) => entry.name === "dasein" && entry.type === "string" && entry.literalFlag === "--dasein"), true);
  assert.equal(recordArrayOf(proof.getFlagReads, "launchFlagProof.getFlagReads").some((entry) => entry.name === "dasein" && entry.value === launchValue), true);
  const effect = recordOf(proof.contextEffect, "launchFlagProof.contextEffect");
  assert.equal(effect.agentInjectionDisabledByLaunchFlag, true, "--dasein core.agentInjectionEnabled=false must suppress Dasein context injection in the live process");
  assert.equal(effect.daseinCustomMessages, 0);
  writeJson(join(latestArtifactDir, "launch-flag-proof.json"), proof);
  return proof;
};

const runContextInjectionProofProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const extensionPath = writeProbe("context-injection-proof-probe.ts", `
import createDaseinExtension, { convertAmbientContextMessageToLlm } from ${JSON.stringify(daseinEntryPath)};
import { convertToLlm } from '@earendil-works/pi-coding-agent';
import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai';

const faux = registerFauxProvider({
  api: 'dasein-live-context-faux-api',
  provider: 'dasein-live-context-faux',
  models: [{
    id: 'dasein-live-context-faux-model',
    name: 'Dasein Live Context Faux Model',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 1000,
  }],
});
faux.setResponses([fauxAssistantMessage('context proof ok')]);

const safeJson = (value) => JSON.stringify(value, (_key, candidate) => {
  if (typeof candidate === 'bigint') return candidate.toString();
  if (candidate === undefined) return '__undefined__';
  return candidate;
});

export default function(pi) {
  pi.registerProvider('dasein-live-context-faux', {
    baseUrl: 'http://localhost:0',
    apiKey: 'dummy',
    api: faux.api,
    models: faux.models,
  });
  const proxy = {
    ...pi,
    on(event, handler) {
      if (event === 'context') {
        return pi.on(event, async (evt, ctx) => {
          const beforeCount = Array.isArray(evt?.messages) ? evt.messages.length : 0;
          const result = await handler(evt, ctx);
          const afterMessages = Array.isArray(evt?.messages) ? evt.messages : [];
          const appended = afterMessages.at(-1) ?? null;
          const piConverted = convertToLlm(afterMessages);
          const proof = {
            hostBoundary: 'live-pi-process-not-fake-host',
            hook: 'context',
            mode: ctx.mode,
            beforeCount,
            afterCount: afterMessages.length,
            appended,
            hiddenDaseinCustomMessage: appended?.role === 'custom' && appended?.customType === 'dasein' && appended?.display === false,
            handlerReturnedMessages: Array.isArray(result?.messages),
            piConvertToLlmLast: piConverted.at(-1) ?? null,
            projectConvertLast: appended === null ? null : convertAmbientContextMessageToLlm(appended),
          };
          console.log('DASEIN_LIVE_CONTEXT_INJECTION_PROOF ' + safeJson(proof));
          return result;
        });
      }
      return pi.on(event, handler);
    },
  };
  createDaseinExtension(proxy);
}
`);
  const process = spawnPi({
    piBinary,
    home,
    args: [...basePiArgs(extensionPath), "--model", "dasein-live-context-faux/dasein-live-context-faux-model", "-p", "trigger context injection proof"],
    timeoutMs: 45_000,
    artifactName: "context-injection-proof.log",
  });
  assertOkProcess("context-injection-proof-probe", process);
  const proof = recordOf(extractJsonAfter(process.output, "DASEIN_LIVE_CONTEXT_INJECTION_PROOF "), "contextInjectionProof");
  assert.equal(proof.hostBoundary, "live-pi-process-not-fake-host");
  assert.equal(proof.hook, "context");
  assert.equal(proof.hiddenDaseinCustomMessage, true);
  assert.equal(proof.handlerReturnedMessages, true);
  assert.equal(recordOf(proof.appended, "contextInjectionProof.appended").display, false);
  const converted = recordOf(proof.piConvertToLlmLast, "contextInjectionProof.piConvertToLlmLast");
  assert.equal(converted.role, "user", "Pi convertToLlm must convert hidden Dasein CustomMessage into an LLM user message");
  assert.match(JSON.stringify(converted.content), /\[ambient_ctx:/u);
  writeJson(join(latestArtifactDir, "context-injection-proof.json"), proof);
  return proof;
};

const runSettingsListPersistenceProbe = (piBinary: string, home: string): unknown => {
  const configPath = join(home, ".pi", "dasein", "config.json");
  const projectIndexUrl = pathToFileURL(join(repoRoot, "src", "index.ts")).href;
  const settingsContractUrl = pathToFileURL(join(repoRoot, "src", "ui", "settings-import-contract.ts")).href;
  const extensionPath = writeProbe("settingslist-persistence-probe.ts", `
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SettingsList } from '@earendil-works/pi-tui';

const defaults = {
  version: 1,
  core: {
    agentInjectionEnabled: true,
    statusEnabled: true,
    widgetEnabled: true,
    maxAgentChars: 240,
    injectedLabel: 'ambient_ctx',
    renderOrder: ['clock'],
  },
  sensors: {
    clock: {
      enabled: true,
      ui: true,
      agent: true,
      intervalMs: 60000,
      timeoutMs: 2000,
      staleAfterMs: 120000,
      initialRefresh: true,
      precision: 'minute',
    },
  },
  external: {},
};

const theme = {
  cursor: '> ',
  label: (value) => value,
  value: (value) => value,
  hint: (value) => value,
  description: (value) => value,
};

export default function(pi) {
  pi.on('session_start', async (_event, ctx) => {
    const dasein = await import(${JSON.stringify(projectIndexUrl)});
    const settingsContract = await import(${JSON.stringify(settingsContractUrl)});
    const configPath = ${JSON.stringify(configPath)};
    mkdirSync(dirname(configPath), { recursive: true });
    const manager = dasein.createConfigManager({ configPath, defaults, discoveredSensorKeys: ['clock'] });
    const controls = settingsContract.buildSettingsListVisibilityModel({
      config: manager.getEffectiveConfig(),
      sensorMetadata: [],
      sensorSpecs: [],
      externalStates: [],
      now: () => 1700000000000,
    }).filter((item) => item.kind === 'control');
    const statusControl = controls.find((item) => item.id === 'core.statusEnabled');
    if (!statusControl) throw new Error('core.statusEnabled control missing from Dasein SettingsList model');
    const settingItems = [{
      id: statusControl.id,
      label: statusControl.label,
      currentValue: String(statusControl.value),
      values: ['false', 'true'],
      description: statusControl.path + ' via ' + (statusControl.mutationBackend ?? 'ConfigManager'),
    }];
    const pending = [];
    const list = new SettingsList(settingItems, 3, theme, (id, newValue) => {
      if (id !== statusControl.id) throw new Error('unexpected SettingsList mutation id ' + id);
      pending.push(manager.applyRuntime({ [statusControl.path]: newValue === 'true' }));
    }, () => undefined, { enableSearch: false });
    const beforeLines = list.render(80);
    list.handleInput(' ');
    const mutationResults = await Promise.all(pending);
    const afterLines = list.render(80);
    const diskConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    const effective = manager.getEffectiveConfig();
    const proof = {
      hostBoundary: 'live-pi-process-not-fake-host',
      mode: ctx.mode,
      settingsListPackage: '@earendil-works/pi-tui',
      controlId: statusControl.id,
      canonicalPath: statusControl.path,
      beforeLines,
      afterLines,
      mutationResults,
      diskConfig,
      effectiveCoreStatusEnabled: effective.core.statusEnabled,
      persistedCanonicalPathOnly: JSON.stringify(diskConfig) === JSON.stringify({ version: 1, core: { statusEnabled: false } }),
    };
    console.log('DASEIN_LIVE_SETTINGSLIST_PERSISTENCE ' + JSON.stringify(proof));
    ctx.shutdown?.();
  });
}
`);
  const process = spawnPiViaScript({
    piBinary,
    home,
    args: basePiArgs(extensionPath),
    timeoutMs: 45_000,
    rawArtifactName: "settingslist-persistence.raw",
  });
  assertOkProcess("settingslist-persistence-probe", process);
  const proof = extractJsonAfter(process.output, "DASEIN_LIVE_SETTINGSLIST_PERSISTENCE ") as Record<string, unknown>;
  assert.equal(proof.hostBoundary, "live-pi-process-not-fake-host");
  assert.equal(proof.mode, "tui");
  assert.equal(proof.controlId, "core.statusEnabled");
  assert.equal(proof.canonicalPath, "core.statusEnabled");
  assert.equal(proof.effectiveCoreStatusEnabled, false);
  assert.equal(proof.persistedCanonicalPathOnly, true, "SettingsList probe must persist only the canonical changed path");
  writeJson(join(latestArtifactDir, "settingslist-persistence-proof.json"), proof);
  return proof;
};

test("live Pi smoke gate produces executable live TUI/process proof artifacts", { timeout: 180_000 }, () => {
  cleanArtifactDir();
  const home = mkdtempSync(join(tmpdir(), "dasein-live-pi-home-"));
  try {
    const piBinary = discoverPiBinary();
    const versionResult = commandOutput(piBinary, ["--version"]);
    if (versionResult.status !== 0) blocker("pi-version-command-failed", { piBinary, stderr: versionResult.stderr, stdout: versionResult.stdout });
    const piVersion = `${versionResult.stdout}${versionResult.stderr}`.trim();
    assert.match(piVersion, /^\d+\.\d+\.\d+$/u, "pi --version must return a bare semantic version on stdout or stderr");
    assertMinimumVersion(piVersion);

    writeJson(join(latestArtifactDir, "environment.json"), {
      hostBoundary: "live-pi-process-not-fake-host",
      piBinary,
      piVersion,
      minimumPiVersion,
      isolatedHome: home,
      fakeHostModulesImported: false,
      ordinaryNpmTestBoundary: "tests/smoke is not discovered by scripts/run-non-native-tests.mjs",
    });

    const apiProbe = runApiProbe(piBinary, home);
    const slashCommandProof = runSlashCommandProofProbe(piBinary, home);
    const launchFlagProof = runLaunchFlagProofProbe(piBinary, home);
    const contextInjectionProof = runContextInjectionProofProbe(piBinary, home);
    const tuiRender = runTuiRenderProbe(piBinary, home);
    const settingsList = runSettingsListPersistenceProbe(piBinary, home);

    const factory = apiProbe.factory as Record<string, unknown>;
    const session = apiProbe.session as Record<string, unknown>;
    assert.equal(factory.hostBoundary, "live-pi-process-not-fake-host");
    assert.ok(Array.isArray(factory.keys));
    for (const key of ["registerCommand", "registerFlag", "on", "events", "getFlag"]) {
      assert.ok((factory.keys as readonly string[]).includes(key), `live Pi factory API must expose ${key}`);
    }
    assert.equal(session.mode, "print", "API probe intentionally handles print-mode input to avoid provider calls");
    assert.ok(JSON.stringify(session).includes("setStatus"));
    assert.ok(JSON.stringify(session).includes("setWidget"));
    assert.ok(JSON.stringify(session).includes("custom"));

    const noFakeHostConflation = {
      hostBoundary: "live-pi-process-not-fake-host",
      fakeHostModulesImported: false,
      fakeHostCanSatisfyLiveGate: false,
      ordinaryNpmTestBoundary: "fake-host integration remains ordinary npm test only; live smoke support claims require these real Pi process artifacts",
      liveArtifacts: [
        "slash-command-proof.json",
        "launch-flag-proof.json",
        "context-injection-proof.json",
        "tui-render-proof.json",
        "settingslist-persistence-proof.json",
      ],
    };
    writeJson(join(latestArtifactDir, "no-fake-host-conflation.json"), noFakeHostConflation);

    const receipt: ChecklistReceipt = {
      hostBoundary: "live-pi-process-not-fake-host",
      piBinary,
      piVersion,
      minimumPiVersion,
      artifactDir: latestArtifactDir,
      refs,
      checks: {
        apiProbe,
        slashCommandProof,
        launchFlagProof,
        contextInjectionProof,
        tuiRender,
        settingsList,
        noFakeHostConflation,
      },
      blockers: [],
    };
    writeJson(join(latestArtifactDir, "checklist_receipt.json"), receipt);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
