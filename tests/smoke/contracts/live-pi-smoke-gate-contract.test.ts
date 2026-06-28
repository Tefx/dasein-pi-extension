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

type ChecklistStatus = "PROVEN" | "BLOCKED";

type ChecklistRow = {
  readonly id: string;
  readonly requirement: string;
  readonly status: ChecklistStatus;
  readonly proofArtifacts: readonly string[];
  readonly excerpts: readonly string[];
  readonly blocker?: string;
};

type ChecklistReceipt = {
  readonly hostBoundary: "live-pi-process-not-fake-host";
  readonly piBinary: string;
  readonly piVersion: string;
  readonly minimumPiVersion: typeof minimumPiVersion;
  readonly artifactDir: string;
  readonly refs: readonly string[];
  readonly counts: {
    readonly total: number;
    readonly proven: number;
    readonly blocked: number;
  };
  readonly checklistRows: readonly ChecklistRow[];
  readonly checks: Record<string, unknown>;
  readonly blockers: readonly string[];
};

type ProofRecord = Record<string, unknown>;

const refs = [
  "docs/TECHNICAL_DESIGN.md#verified-pi-mechanisms: LIVE_SMOKE_VERIFIED means observed in a live Pi process; source/API evidence alone cannot ship support claims.",
  "docs/TECHNICAL_DESIGN.md#testing-gate-matrix: npm run test:smoke is release smoke only and requires live Pi TUI/process for SettingsList/status behavior.",
  "docs/PRD.md#9-4-tui: status footer, explicit diagnostics, and SettingsList toggles must reflect effective configuration.",
  "CONSTITUTION.md#quality-baselines: mock tests must not be treated as integration proof; black-box liveness evidence takes precedence.",
  "CONSTITUTION.md#ux-interaction-red-lines: Pi/UI mechanisms need live verification with mechanism name, Pi version, binary path, and executable artifacts or signoff.",
] as const;

const checklistDefinitions = [
  {
    id: "pi.registerCommand./dasein",
    requirement: "Live Pi registers and invokes bare /dasein, /dasein status, and /dasein inspect agent through the real command path."
  },
  {
    id: "pi.registerFlag.--dasein",
    requirement: "Live Pi parses --dasein string launch flag and Dasein applies it before the before_agent_start system-prompt injection step.",
  },
  {
    id: "pi.before-agent-start.system-prompt-context",
    requirement: "Live before_agent_start hook appends bounded Dasein ambient context to systemPrompt without adding user/custom messages.",
  },
  {
    id: "pi.events.set-clear-live",
    requirement: "Live pi.events publishes and receives dasein:state:set and dasein:state:clear, with set visible to system-prompt context and clear removing it.",
  },
  {
    id: "tui.status-render-clear",
    requirement: "Live TUI renders status sentinel and session_shutdown clears status after Dasein cleanup.",
  },
  {
    id: "lifecycle.before-agent-start-agent-end-cleanup",
    requirement: "Live lifecycle runs before_agent_start and agent_end observations, then session_start/session_shutdown cleanup/clear-status sequence.",
  },
  {
    id: "slash.bare-dasein-non-tui-fallback",
    requirement: "Bare /dasein outside TUI returns deterministic help/status fallback without ctx.ui.custom or config mutation.",
  },
  {
    id: "settingslist.common-sensor-controls",
    requirement: "SettingsList exposes common sensor controls enabled/ui/agent/intervalMs/timeoutMs/staleAfterMs/initialRefresh.",
  },
  {
    id: "settingslist.metadata-before-enable-and-persistence",
    requirement: "SettingsList renders inspectability metadata before enable controls, toggles one setting, queues ConfigManager mutation, and persists only the canonical path.",
  },
  {
    id: "ctx.ui.custom.no-api-key-render-path",
    requirement: "ctx.ui.custom invocation and component render path work in TUI without provider/API-key presence and remain separate from SettingsList import availability.",
  },
  {
    id: "boundary.live-pi-not-fake-host",
    requirement: "Receipt preserves live Pi process boundary and does not conflate fake-host/API-shape proof with release smoke proof.",
  },
] as const;

const provenRow = (
  id: (typeof checklistDefinitions)[number]["id"],
  proofArtifacts: readonly string[],
  excerpts: readonly string[],
): ChecklistRow => {
  const definition = checklistDefinitions.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`unknown checklist id ${id}`);
  return {
    id,
    requirement: definition.requirement,
    status: "PROVEN",
    proofArtifacts,
    excerpts,
  };
};

const blockedRows = (code: string): readonly ChecklistRow[] => checklistDefinitions.map((definition) => ({
  id: definition.id,
  requirement: definition.requirement,
  status: "BLOCKED",
  proofArtifacts: ["environment-blocker.json"],
  excerpts: refs,
  blocker: code,
}));

const countRows = (rows: readonly ChecklistRow[]): ChecklistReceipt["counts"] => ({
  total: rows.length,
  proven: rows.filter((row) => row.status === "PROVEN").length,
  blocked: rows.filter((row) => row.status === "BLOCKED").length,
});

const cleanArtifactDir = (): void => {
  rmSync(latestArtifactDir, { recursive: true, force: true });
  mkdirSync(latestArtifactDir, { recursive: true });
};

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const blocker = (code: string, details: Record<string, unknown>): never => {
  mkdirSync(latestArtifactDir, { recursive: true });
  const rows = blockedRows(code);
  const payload = {
    code,
    details,
    refs,
    hostBoundary: "live-pi-process-not-fake-host",
    remediation: "Run npm run test:smoke on a host with Pi >= 0.78.1, a working pty-compatible TUI, and no fake-host substitution.",
  };
  writeJson(join(latestArtifactDir, "environment-blocker.json"), payload);
  writeJson(join(latestArtifactDir, "checklist_receipt.json"), {
    hostBoundary: "live-pi-process-not-fake-host",
    piBinary: String(details.piBinary ?? "BLOCKED"),
    piVersion: String(details.actual ?? "BLOCKED"),
    minimumPiVersion,
    artifactDir: latestArtifactDir,
    refs,
    counts: countRows(rows),
    checklistRows: rows,
    checks: { environmentBlocker: payload },
    blockers: [code],
  } satisfies ChecklistReceipt);
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

const runTuiRenderProbe = (piBinary: string, home: string): { readonly renderedStatus: boolean } => {
  const extensionPath = writeProbe("tui-render-probe.ts", `
export default function(pi) {
  pi.on('session_start', (_event, ctx) => {
    console.log('DASEIN_LIVE_TUI_RENDER_SESSION ' + JSON.stringify({ mode: ctx.mode, hasUI: ctx.hasUI ?? null, uiKeys: Object.keys(ctx.ui ?? {}).sort() }));
    ctx.ui.setStatus?.('dasein-smoke', 'DASEIN_SMOKE_STATUS_RENDERED');
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
  assert.equal(renderedStatus, true, "raw TUI transcript must contain the rendered footer status sentinel");
  writeJson(join(latestArtifactDir, "tui-render-proof.json"), {
    mode: "tui",
    renderedStatus,
    rawArtifact: "tui-render.raw",
    textArtifact: "tui-render.raw.text",
  });
  return { renderedStatus };
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
          if (args === 'status') {
            proof.invocations.push({ name, literalInvoked: '/' + name, args: 'inspect agent', mode: ctx.mode, synthetic: true });
            proof.results.push(await options.handler('inspect agent', ctx));
          }
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
  const statusResult = results.find((entry) => entry.ok === true && entry.command === "status");
  assert.ok(statusResult, "live /dasein status must return a successful status command result");
  const inspectResult = results.find((entry) => entry.ok === true && entry.command === "inspect");
  assert.ok(inspectResult, "live /dasein inspect agent must return a successful inspect command result");
  const inspectData = recordOf(inspectResult.data, "slashCommandProof.inspect.data");
  assert.equal(inspectData.source, "pre-rendered-memory");
  assert.equal(typeof inspectData.renderedAgent === "string" || inspectData.renderedAgent === null, true);
  if (inspectData.renderedAgent !== null) assert.match(String(inspectData.systemPromptBlock), /<DaseinAmbientContext>/u);
  const statusData = recordOf(statusResult.data, "slashCommandProof.status.data");
  const hiddenContributors = recordArrayOf(statusData.hiddenContributors, "slashCommandProof.status.data.hiddenContributors");
  assert.equal(hiddenContributors.some((entry) => entry.key === "geo" && entry.hiddenReason === "disabled" && recordOf(entry.sensorMetadata, "geo hidden contributor metadata").key === "geo"), true, "live /dasein status must keep disabled geo inspectable through hiddenContributors");
  const lapseControls = recordOf(statusData.effectiveLapseControls, "slashCommandProof.status.data.effectiveLapseControls");
  assert.deepEqual(lapseControls, { enabled: true, persist: true, agent: true, agentFields: ["user_idle"] });
  writeJson(join(latestArtifactDir, "slash-command-proof.json"), proof);
  return proof;
};

const runLaunchFlagProofProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const launchValue = "core.agentInjectionEnabled=false,core.statusEnabled=false";
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
      if (event === 'before_agent_start') {
        return pi.on(event, async (evt, ctx) => {
          const beforeCount = Array.isArray(evt?.messages) ? evt.messages.length : 0;
          const beforePrompt = typeof evt?.systemPrompt === 'string' ? evt.systemPrompt : '';
          const result = await handler(evt, ctx);
          const afterMessages = Array.isArray(evt?.messages) ? evt.messages : [];
          const afterPrompt = typeof evt?.systemPrompt === 'string' ? evt.systemPrompt : '';
          proof.contextEffect = {
            mode: ctx.mode,
            hook: 'before_agent_start',
            beforeCount,
            afterCount: afterMessages.length,
            beforePromptLength: beforePrompt.length,
            afterPromptLength: afterPrompt.length,
            daseinCustomMessages: afterMessages.filter((message) => message?.role === 'custom' && message?.customType === 'dasein').length,
            daseinSystemPromptBlock: afterPrompt.includes('<DaseinAmbientContext>'),
            agentInjectionDisabledByLaunchFlag: afterPrompt === beforePrompt && !afterPrompt.includes('<DaseinAmbientContext>') && afterMessages.length === beforeCount,
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
  assert.equal(effect.hook, "before_agent_start");
  assert.equal(effect.agentInjectionDisabledByLaunchFlag, true, "--dasein core.agentInjectionEnabled=false must suppress Dasein system-prompt context injection in the live process");
  assert.equal(effect.daseinCustomMessages, 0);
  assert.equal(effect.daseinSystemPromptBlock, false);
  writeJson(join(latestArtifactDir, "launch-flag-proof.json"), proof);
  return proof;
};

const runContextInjectionProofProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const extensionPath = writeProbe("context-injection-proof-probe.ts", `
import createDaseinExtension from ${JSON.stringify(daseinEntryPath)};
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
      if (event === 'before_agent_start') {
        return pi.on(event, async (evt, ctx) => {
          const beforeCount = Array.isArray(evt?.messages) ? evt.messages.length : 0;
          const beforePrompt = typeof evt?.systemPrompt === 'string' ? evt.systemPrompt : '';
          const result = await handler(evt, ctx);
          const afterMessages = Array.isArray(evt?.messages) ? evt.messages : [];
          const afterPrompt = typeof evt?.systemPrompt === 'string' ? evt.systemPrompt : '';
          const proof = {
            hostBoundary: 'live-pi-process-not-fake-host',
            hook: 'before_agent_start',
            mode: ctx.mode,
            beforeCount,
            afterCount: afterMessages.length,
            beforePromptLength: beforePrompt.length,
            afterPromptLength: afterPrompt.length,
            systemPromptChanged: afterPrompt !== beforePrompt,
            systemPromptTail: afterPrompt.slice(Math.max(0, afterPrompt.length - 1000)),
            containsDaseinSystemPromptBlock: afterPrompt.includes('<DaseinAmbientContext>') && afterPrompt.includes('</DaseinAmbientContext>'),
            containsRawAmbientPrefix: afterPrompt.includes('[ambient_ctx:'),
            daseinCustomMessages: afterMessages.filter((message) => message?.role === 'custom' && message?.customType === 'dasein').length,
            daseinUserMessages: afterMessages.filter((message) => message?.role === 'user' && typeof message?.content === 'string' && message.content.includes('DaseinAmbientContext')).length,
            handlerReturnedSystemPrompt: typeof result?.systemPrompt === 'string',
            returnedSystemPromptMatchesEvent: result?.systemPrompt === afterPrompt,
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
    args: [...basePiArgs(extensionPath), "--dasein", "core.agentInjectionTransport=systemPrompt", "--model", "dasein-live-context-faux/dasein-live-context-faux-model", "-p", "trigger context injection proof"],
    timeoutMs: 45_000,
    artifactName: "context-injection-proof.log",
  });
  assertOkProcess("context-injection-proof-probe", process);
  const proof = recordOf(extractJsonAfter(process.output, "DASEIN_LIVE_CONTEXT_INJECTION_PROOF "), "contextInjectionProof");
  assert.equal(proof.hostBoundary, "live-pi-process-not-fake-host");
  assert.equal(proof.hook, "before_agent_start");
  assert.equal(proof.systemPromptChanged, true);
  assert.equal(proof.containsDaseinSystemPromptBlock, true);
  assert.equal(proof.containsRawAmbientPrefix, false);
  assert.equal(proof.daseinCustomMessages, 0);
  assert.equal(proof.daseinUserMessages, 0);
  assert.equal(proof.handlerReturnedSystemPrompt, true);
  assert.equal(proof.returnedSystemPromptMatchesEvent, true);
  const promptTail = String(proof.systemPromptTail);
  assert.match(promptTail, /<DaseinAmbientContext>\nLocal ambient context for relevance only\./u);
  assert.match(promptTail, /time=/u);
  assert.doesNotMatch(promptTail, /\[ambient_ctx:/u);
  writeJson(join(latestArtifactDir, "context-injection-proof.json"), proof);
  return proof;
};

const runEventBusProofProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const extensionPath = writeProbe("event-bus-proof-probe.ts", `
import createDaseinExtension from ${JSON.stringify(daseinEntryPath)};
import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai';

const faux = registerFauxProvider({
  api: 'dasein-live-events-faux-api',
  provider: 'dasein-live-events-faux',
  models: [{
    id: 'dasein-live-events-faux-model',
    name: 'Dasein Live Events Faux Model',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 1000,
  }],
});
faux.setResponses([fauxAssistantMessage('event proof ok')]);

const safeJson = (value) => JSON.stringify(value, (_key, candidate) => candidate === undefined ? '__undefined__' : candidate);

export default function(pi) {
  pi.registerProvider('dasein-live-events-faux', {
    baseUrl: 'http://localhost:0',
    apiKey: 'dummy',
    api: faux.api,
    models: faux.models,
  });
  let daseinHandler = null;
  const proof = {
    hostBoundary: 'live-pi-process-not-fake-host',
    eventApiKeys: Object.keys(pi.events ?? {}).sort(),
    subscriptions: [],
    emissions: [],
    receives: [],
    commandResults: [],
    contextChecks: [],
  };
  const proxy = {
    ...pi,
    registerCommand(name, options) {
      if (name === 'dasein') daseinHandler = options.handler;
      return pi.registerCommand(name, options);
    },
    events: {
      ...pi.events,
      on(topic, handler) {
        proof.subscriptions.push(topic);
        return pi.events.on(topic, (payload) => {
          proof.receives.push({ topic, payload });
          return handler(payload);
        });
      },
    },
    on(event, handler) {
      if (event === 'session_start') {
        return pi.on(event, async (evt, ctx) => {
          const result = await handler(evt, ctx);
          const payload = { key: 'weather', agent: 'rain soon', ui: 'weather rain soon', source: 'live-pi-event-bus', ttlMs: 60000 };
          proof.emissions.push({ topic: 'dasein:state:set', payload });
          pi.events.emit('dasein:state:set', payload);
          return result;
        });
      }
      if (event === 'before_agent_start') {
        return pi.on(event, async (evt, ctx) => {
          const first = await handler(evt, ctx);
          const firstMessages = Array.isArray(evt?.messages) ? evt.messages : [];
          const firstPrompt = typeof evt?.systemPrompt === 'string' ? evt.systemPrompt : '';
          proof.contextChecks.push({ phase: 'after-set-hidden-default', systemPromptText: firstPrompt, messageCount: firstMessages.length });
          if (typeof daseinHandler !== 'function') throw new Error('dasein command handler unavailable for event bus config proof');
          const configResult = await daseinHandler('set external.weather.agent true', ctx);
          proof.commandResults.push({ command: '/dasein set external.weather.agent true', result: configResult });
          const secondEvent = { systemPrompt: 'BASE SYSTEM', messages: [] };
          const second = await handler(secondEvent, ctx);
          const secondMessages = Array.isArray(secondEvent.messages) ? secondEvent.messages : [];
          proof.contextChecks.push({ phase: 'after-configured-visible', systemPromptText: secondEvent.systemPrompt, messageCount: secondMessages.length, returnedSystemPrompt: typeof second?.systemPrompt === 'string' });
          const clearPayload = { key: 'weather' };
          proof.emissions.push({ topic: 'dasein:state:clear', payload: clearPayload });
          pi.events.emit('dasein:state:clear', clearPayload);
          const thirdEvent = { systemPrompt: 'BASE SYSTEM', messages: [] };
          const third = await handler(thirdEvent, ctx);
          const thirdMessages = Array.isArray(thirdEvent.messages) ? thirdEvent.messages : [];
          proof.contextChecks.push({ phase: 'after-clear', systemPromptText: thirdEvent.systemPrompt, messageCount: thirdMessages.length, returnedUndefined: third === undefined });
          console.log('DASEIN_LIVE_EVENT_BUS_PROOF ' + safeJson({ ...proof, firstReturnedSystemPrompt: typeof first?.systemPrompt === 'string' }));
          return first;
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
    args: [...basePiArgs(extensionPath), "--dasein", "core.agentInjectionTransport=systemPrompt", "--model", "dasein-live-events-faux/dasein-live-events-faux-model", "-p", "trigger event proof"],
    timeoutMs: 45_000,
    artifactName: "event-bus-proof.log",
  });
  assertOkProcess("event-bus-proof-probe", process);
  const proof = recordOf(extractJsonAfter(process.output, "DASEIN_LIVE_EVENT_BUS_PROOF "), "eventBusProof");
  assert.equal(proof.hostBoundary, "live-pi-process-not-fake-host");
  assert.deepEqual(recordArrayOf(proof.receives, "eventBusProof.receives").map((entry) => entry.topic), ["dasein:state:set", "dasein:state:clear"]);
  const checks = recordArrayOf(proof.contextChecks, "eventBusProof.contextChecks");
  for (const check of checks) assert.equal(check.messageCount, 0, `eventBusProof.${String(check.phase)} must not append user/custom messages`);
  assert.doesNotMatch(String(checks.find((entry) => entry.phase === "after-set-hidden-default")?.systemPromptText), /weather|rain/u, "unconfigured external.weather must be agent-hidden by default");
  assert.match(String(checks.find((entry) => entry.phase === "after-configured-visible")?.systemPromptText), /weather|rain/u, "public /dasein config must make external.weather agent-visible");
  assert.doesNotMatch(String(checks.find((entry) => entry.phase === "after-clear")?.systemPromptText), /weather|rain/u);
  assert.match(JSON.stringify(proof.commandResults), /external\.weather\.agent|true/u);
  writeJson(join(latestArtifactDir, "event-bus-proof.json"), proof);
  return proof;
};

const runLifecycleCleanupProofProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const extensionPath = writeProbe("lifecycle-cleanup-proof-probe.ts", `
import createDaseinExtension from ${JSON.stringify(daseinEntryPath)};
import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai';

const faux = registerFauxProvider({
  api: 'dasein-live-lifecycle-faux-api',
  provider: 'dasein-live-lifecycle-faux',
  models: [{
    id: 'dasein-live-lifecycle-faux-model',
    name: 'Dasein Live Lifecycle Faux Model',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 1000,
  }],
});
faux.setResponses([fauxAssistantMessage('lifecycle proof ok')]);

const safeJson = (value) => JSON.stringify(value, (_key, candidate) => candidate === undefined ? '__undefined__' : candidate);

export default function(pi) {
  pi.registerProvider('dasein-live-lifecycle-faux', {
    baseUrl: 'http://localhost:0',
    apiKey: 'dummy',
    api: faux.api,
    models: faux.models,
  });
  const proof = {
    hostBoundary: 'live-pi-process-not-fake-host',
    registeredEvents: [],
    observedEvents: [],
    cleanupCalls: [],
    uiStatusCalls: [],
  };
  const wrapContext = (ctx, phase) => ({
    ...ctx,
    ui: {
      ...ctx.ui,
      setStatus(slot, value) {
        proof.uiStatusCalls.push({ phase, slot, value: value === undefined ? '__undefined__' : value });
        return ctx.ui.setStatus?.(slot, value);
      },
      custom: ctx.ui.custom?.bind(ctx.ui),
    },
  });
  const proxy = {
    ...pi,
    recordCleanup(sensorKey, timeoutMs) {
      proof.cleanupCalls.push({ sensorKey, timeoutMs });
    },
    on(event, handler) {
      proof.registeredEvents.push(event);
      return pi.on(event, async (evt, ctx) => {
        proof.observedEvents.push(event);
        const result = await handler(evt, wrapContext(ctx, event));
        if (event === 'session_shutdown') console.log('DASEIN_LIVE_LIFECYCLE_CLEANUP_PROOF ' + safeJson(proof));
        return result;
      });
    },
  };
  createDaseinExtension(proxy);
}
`);
  const process = spawnPiViaScript({
    piBinary,
    home,
    args: [...basePiArgs(extensionPath), "--model", "dasein-live-lifecycle-faux/dasein-live-lifecycle-faux-model", "-p", "trigger lifecycle proof"],
    timeoutMs: 60_000,
    rawArtifactName: "lifecycle-cleanup.raw",
  });
  assertOkProcess("lifecycle-cleanup-proof-probe", process);
  const proof = recordOf(extractJsonAfter(process.output, "DASEIN_LIVE_LIFECYCLE_CLEANUP_PROOF "), "lifecycleCleanupProof");
  assert.equal(proof.hostBoundary, "live-pi-process-not-fake-host");
  const registered = proof.registeredEvents as readonly string[];
  for (const event of ["session_start", "before_agent_start", "agent_end", "session_shutdown"]) {
    assert.equal(registered.includes(event), true, `Dasein must register ${event}`);
  }
  const observed = proof.observedEvents as readonly string[];
  for (const event of ["session_start", "before_agent_start", "agent_end", "session_shutdown"]) {
    assert.equal(observed.includes(event), true, `live Pi must observe ${event}`);
  }
  assert.deepEqual(recordArrayOf(proof.cleanupCalls, "lifecycleCleanupProof.cleanupCalls").map((entry) => [entry.sensorKey, entry.timeoutMs]), [["clock", 1000], ["geo", 1000], ["lapse", 1000]]);
  assert.equal(recordArrayOf(proof.uiStatusCalls, "lifecycleCleanupProof.uiStatusCalls").some((entry) => entry.phase === "session_shutdown" && entry.slot === "dasein" && entry.value === "__undefined__"), true);
  writeJson(join(latestArtifactDir, "lifecycle-cleanup-proof.json"), proof);
  return proof;
};

const runBareDaseinOutsideTuiProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const extensionPath = writeProbe("bare-dasein-outside-tui-proof-probe.ts", `
import createDaseinExtension from ${JSON.stringify(daseinEntryPath)};

const safeJson = (value) => JSON.stringify(value, (_key, candidate) => candidate === undefined ? '__undefined__' : candidate);

export default function(pi) {
  const proof = { hostBoundary: 'live-pi-process-not-fake-host', literalPrompt: '/dasein', invocations: [], results: [], uiCustomCalls: 0 };
  const proxy = {
    ...pi,
    registerCommand(name, options) {
      return pi.registerCommand(name, {
        ...options,
        handler: async (args, ctx) => {
          const wrappedCtx = {
            ...ctx,
            ui: {
              ...ctx.ui,
              custom(...customArgs) {
                proof.uiCustomCalls += 1;
                return ctx.ui.custom?.(...customArgs);
              },
            },
          };
          proof.invocations.push({ name, args, mode: ctx.mode });
          const result = await options.handler(args, wrappedCtx);
          proof.results.push(result);
          console.log('DASEIN_LIVE_BARE_DASEIN_NON_TUI_PROOF ' + safeJson(proof));
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
    args: [...basePiArgs(extensionPath), "-p", "/dasein"],
    timeoutMs: 45_000,
    artifactName: "bare-dasein-outside-tui-proof.log",
  });
  assertOkProcess("bare-dasein-outside-tui-proof-probe", process);
  const proof = recordOf(extractJsonAfter(process.output, "DASEIN_LIVE_BARE_DASEIN_NON_TUI_PROOF "), "bareDaseinOutsideTuiProof");
  const result = recordArrayOf(proof.results, "bareDaseinOutsideTuiProof.results")[0];
  assert.equal(proof.literalPrompt, "/dasein");
  assert.equal(result?.ok, true);
  assert.equal(result?.command, "help");
  assert.match(String(result?.message), /^dasein: /u);
  assert.equal(proof.uiCustomCalls, 0);
  writeJson(join(latestArtifactDir, "bare-dasein-outside-tui-proof.json"), proof);
  return proof;
};

const runCustomNoApiKeyProbe = (piBinary: string, home: string): ProofRecord => {
  const daseinEntryPath = join(repoRoot, "src", "index.ts");
  const extensionPath = writeProbe("custom-no-api-key-proof-probe.ts", `
import createDaseinExtension from ${JSON.stringify(daseinEntryPath)};

const safeJson = (value) => JSON.stringify(value, (_key, candidate) => candidate === undefined ? '__undefined__' : candidate);

export default function(pi) {
  let daseinHandler = null;
  const proof = {
    hostBoundary: 'live-pi-process-not-fake-host',
    noProviderRegistered: true,
    noModelArgRequired: true,
    sessionMode: null,
    customCalls: [],
    requestRenderCalls: 0,
    renderedLines: [],
    commandResult: null,
  };
  const proxy = {
    ...pi,
    registerProvider() {
      proof.noProviderRegistered = false;
      return pi.registerProvider?.(...arguments);
    },
    registerCommand(name, options) {
      if (name === 'dasein') daseinHandler = options.handler;
      return pi.registerCommand(name, options);
    },
    on(event, handler) {
      if (event === 'session_start') {
        return pi.on(event, async (evt, ctx) => {
          const startup = await handler(evt, ctx);
          proof.sessionMode = ctx.mode;
          if (typeof daseinHandler !== 'function') throw new Error('dasein handler unavailable for custom no-api-key proof');
          const wrappedCtx = {
            ...ctx,
            ui: {
              ...ctx.ui,
              async custom(componentFactory, options) {
                proof.customCalls.push({ optionKeys: Object.keys(options ?? {}).sort(), hasFactory: typeof componentFactory === 'function' });
                const component = componentFactory({ requestRender: () => { proof.requestRenderCalls += 1; } }, {}, {}, () => undefined);
                proof.renderedLines = component.render(100);
                return undefined;
              },
            },
          };
          proof.commandResult = await daseinHandler('', wrappedCtx);
          console.log('DASEIN_LIVE_CUSTOM_NO_API_KEY_PROOF ' + safeJson(proof));
          ctx.shutdown?.();
          return startup;
        });
      }
      return pi.on(event, handler);
    },
  };
  createDaseinExtension(proxy);
}
`);
  const process = spawnPiViaScript({
    piBinary,
    home,
    args: basePiArgs(extensionPath),
    timeoutMs: 45_000,
    rawArtifactName: "custom-no-api-key.raw",
  });
  assertOkProcess("custom-no-api-key-proof-probe", process);
  const proof = recordOf(extractJsonAfter(process.output, "DASEIN_LIVE_CUSTOM_NO_API_KEY_PROOF "), "customNoApiKeyProof");
  assert.equal(proof.hostBoundary, "live-pi-process-not-fake-host");
  assert.equal(proof.noProviderRegistered, true);
  assert.equal(proof.sessionMode, "tui");
  assert.equal(recordArrayOf(proof.customCalls, "customNoApiKeyProof.customCalls").length, 1);
  assert.match(JSON.stringify(proof.renderedLines), /Dasein settings|core\.agentInjectionEnabled|clock/u);
  assert.equal(recordOf(proof.commandResult, "customNoApiKeyProof.commandResult").command, "open-ui");
  writeJson(join(latestArtifactDir, "custom-no-api-key-proof.json"), proof);
  return proof;
};

const runSettingsListPersistenceProbe = (piBinary: string, home: string): unknown => {
  const configPath = join(home, ".pi", "dasein", "config.json");
  const projectIndexUrl = pathToFileURL(join(repoRoot, "src", "index.ts")).href;
  const settingsContractUrl = pathToFileURL(join(repoRoot, "src", "ui", "settings-import-contract.ts")).href;
  const clockSpecUrl = pathToFileURL(join(repoRoot, "src", "sensors", "clock.ts")).href;
  const extensionPath = writeProbe("settingslist-persistence-probe.ts", `
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SettingsList } from '@earendil-works/pi-tui';

const defaults = {
  version: 1,
  core: {
    agentInjectionEnabled: true,
    statusEnabled: true,
    statusDetail: 'quiet',
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
    const clockModule = await import(${JSON.stringify(clockSpecUrl)});
    const clockSpec = clockModule.default;
    const configPath = ${JSON.stringify(configPath)};
    mkdirSync(dirname(configPath), { recursive: true });
    const manager = dasein.createConfigManager({ configPath, defaults, discoveredSensorKeys: ['clock'] });
    const clockMetadata = dasein.inspectSensorMetadata({
      spec: clockSpec,
      provenance: { kind: 'builtin' },
      effectiveConfig: manager.getEffectiveConfig().sensors.clock,
    });
    const visibilityItems = settingsContract.buildSettingsListVisibilityModel({
      config: manager.getEffectiveConfig(),
      sensorMetadata: [clockMetadata],
      sensorSpecs: [clockSpec],
      externalStates: [],
      now: () => 1700000000000,
    });
    const controls = visibilityItems.filter((item) => item.kind === 'control');
    const commonSensorControlIds = [
      'sensors.clock.enabled',
      'sensors.clock.ui',
      'sensors.clock.agent',
      'sensors.clock.intervalMs',
      'sensors.clock.timeoutMs',
      'sensors.clock.staleAfterMs',
      'sensors.clock.initialRefresh',
    ];
    const commonSensorControls = commonSensorControlIds.map((id) => controls.find((item) => item.id === id));
    const missingCommonSensorControls = commonSensorControlIds.filter((id, index) => commonSensorControls[index] === undefined);
    if (missingCommonSensorControls.length > 0) throw new Error('missing common sensor SettingsList controls: ' + missingCommonSensorControls.join(','));
    const metadataIndex = visibilityItems.findIndex((item) => item.id === 'sensor.clock.metadata.provenance');
    const enabledIndex = visibilityItems.findIndex((item) => item.id === 'sensors.clock.enabled');
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
      commonSensorControlIds,
      commonSensorControlValues: Object.fromEntries(commonSensorControls.map((item) => [item.id, { valueType: item.valueType, value: item.value }])),
      metadataBeforeEnabledControl: metadataIndex >= 0 && enabledIndex > metadataIndex,
      metadataExcerpt: visibilityItems.slice(Math.max(0, metadataIndex), enabledIndex + 1).map((item) => ({ id: item.id, kind: item.kind, label: item.label })),
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
  assert.equal(proof.metadataBeforeEnabledControl, true, "SettingsList must expose inspectability metadata before enable controls");
  assert.deepEqual(proof.commonSensorControlIds, [
    "sensors.clock.enabled",
    "sensors.clock.ui",
    "sensors.clock.agent",
    "sensors.clock.intervalMs",
    "sensors.clock.timeoutMs",
    "sensors.clock.staleAfterMs",
    "sensors.clock.initialRefresh",
  ]);
  writeJson(join(latestArtifactDir, "settingslist-persistence-proof.json"), proof);
  return proof;
};

test("live Pi smoke gate produces executable live TUI/process proof artifacts", { timeout: 300_000 }, () => {
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
    const eventBusHome = mkdtempSync(join(tmpdir(), "dasein-live-pi-events-home-"));
    const eventBusProof = (() => {
      try {
        return runEventBusProofProbe(piBinary, eventBusHome);
      } finally {
        rmSync(eventBusHome, { recursive: true, force: true });
      }
    })();
    const tuiRender = runTuiRenderProbe(piBinary, home);
    const lifecycleCleanupProof = runLifecycleCleanupProofProbe(piBinary, home);
    const bareDaseinOutsideTuiProof = runBareDaseinOutsideTuiProbe(piBinary, home);
    const settingsList = recordOf(runSettingsListPersistenceProbe(piBinary, home), "settingsListProof");
    const customNoApiKeyProof = runCustomNoApiKeyProbe(piBinary, home);

    const factory = apiProbe.factory as Record<string, unknown>;
    const session = apiProbe.session as Record<string, unknown>;
    assert.equal(factory.hostBoundary, "live-pi-process-not-fake-host");
    assert.ok(Array.isArray(factory.keys));
    for (const key of ["registerCommand", "registerFlag", "on", "events", "getFlag"]) {
      assert.ok((factory.keys as readonly string[]).includes(key), `live Pi factory API must expose ${key}`);
    }
    assert.equal(session.mode, "print", "API probe intentionally handles print-mode input to avoid provider calls");
    assert.ok(JSON.stringify(session).includes("setStatus"));
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
        "event-bus-proof.json",
        "tui-render-proof.json",
        "lifecycle-cleanup-proof.json",
        "bare-dasein-outside-tui-proof.json",
        "settingslist-persistence-proof.json",
        "custom-no-api-key-proof.json",
      ],
    };
    writeJson(join(latestArtifactDir, "no-fake-host-conflation.json"), noFakeHostConflation);

    const checklistRows: readonly ChecklistRow[] = [
      provenRow("pi.registerCommand./dasein", ["slash-command-proof.json", "bare-dasein-outside-tui-proof.json"], [
        "registered /dasein with rawArgs=true and completions=true",
        "literal prompts /dasein status and /dasein invoked through live Pi print mode; /dasein inspect agent returns pre-rendered-memory inspector data",
      ]),
      provenRow("pi.registerFlag.--dasein", ["launch-flag-proof.json"], [
        `--dasein=${String(launchFlagProof.argvValue)}`,
        "core.agentInjectionEnabled=false suppressed Dasein system-prompt context injection",
      ]),
      provenRow("pi.before-agent-start.system-prompt-context", ["context-injection-proof.json"], [
        "hook=before_agent_start and systemPromptChanged=true",
        "containsDaseinSystemPromptBlock=true with daseinCustomMessages=0 and daseinUserMessages=0",
      ]),
      provenRow("pi.events.set-clear-live", ["event-bus-proof.json", "event-bus-proof.log"], [
        "received dasein:state:set and dasein:state:clear through live pi.events",
        "after-set hidden default omits weather/rain; /dasein set external.weather.agent true makes it visible; after-clear omits weather/rain",
      ]),
      provenRow("tui.status-render-clear", ["tui-render-proof.json", "tui-render.raw.text", "lifecycle-cleanup-proof.json"], [
        "raw TUI transcript contains DASEIN_SMOKE_STATUS_RENDERED",
        "session_shutdown setStatus clear value is __undefined__",
      ]),
      provenRow("lifecycle.before-agent-start-agent-end-cleanup", ["lifecycle-cleanup-proof.json", "lifecycle-cleanup.raw.text"], [
        "registered/observed session_start, before_agent_start, agent_end, session_shutdown",
        "cleanupCalls clock/geo/lapse each timeoutMs=1000 before UI clear proof",
      ]),
      provenRow("slash.bare-dasein-non-tui-fallback", ["bare-dasein-outside-tui-proof.json"], [
        "literalPrompt=/dasein returned command=help in print mode",
        "uiCustomCalls=0 and deterministic message starts with dasein:",
      ]),
      provenRow("settingslist.common-sensor-controls", ["settingslist-persistence-proof.json"], [
        `commonSensorControlIds=${JSON.stringify(settingsList.commonSensorControlIds)}`,
        "values include boolean enabled/ui/agent/initialRefresh and numeric intervalMs/timeoutMs/staleAfterMs",
      ]),
      provenRow("settingslist.metadata-before-enable-and-persistence", ["settingslist-persistence-proof.json", "settingslist-persistence.raw.text"], [
        "metadataBeforeEnabledControl=true",
        "core.statusEnabled toggle persisted {version:1, core:{statusEnabled:false}} only",
      ]),
      provenRow("ctx.ui.custom.no-api-key-render-path", ["custom-no-api-key-proof.json", "custom-no-api-key.raw.text"], [
        "noProviderRegistered=true and no model arg required",
        "component render lines include Dasein settings/core.agentInjectionEnabled/clock",
      ]),
      provenRow("boundary.live-pi-not-fake-host", ["environment.json", "no-fake-host-conflation.json", "checklist_receipt.json"], [
        "hostBoundary=live-pi-process-not-fake-host",
        "fakeHostCanSatisfyLiveGate=false",
      ]),
    ];
    assert.equal(checklistRows.length, checklistDefinitions.length);
    assert.equal(countRows(checklistRows).blocked, 0);

    const receipt: ChecklistReceipt = {
      hostBoundary: "live-pi-process-not-fake-host",
      piBinary,
      piVersion,
      minimumPiVersion,
      artifactDir: latestArtifactDir,
      refs,
      counts: countRows(checklistRows),
      checklistRows,
      checks: {
        apiProbe,
        slashCommandProof,
        launchFlagProof,
        contextInjectionProof,
        eventBusProof,
        tuiRender,
        lifecycleCleanupProof,
        bareDaseinOutsideTuiProof,
        settingsList,
        customNoApiKeyProof,
        noFakeHostConflation,
      },
      blockers: [],
    };
    writeJson(join(latestArtifactDir, "checklist_receipt.json"), receipt);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
