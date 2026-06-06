# Technical Design: Dasein Pi Ambient Context Broker

## Status

Draft, reviewer-fixed.

## Scope

Dasein is a standalone local project that provides a Pi extension ambient context broker and sensor framework.

The core product is the broker/framework, not any single sensor.

- **Core framework** owns config merge, config persistence, sensor loading, state store, rendering, request-path injection, UI, command routing, external event intake, and lifecycle cleanup.
- **Sensors** own data collection, sensor-specific state, optional structured view-fragment proposals, and sensor-specific slash actions. Core owns final prompt/status/widget strings.

Builtin sensors are limited to:

- `clock`
- `geo`
- `lapse`

Any other sensor is an external/extension sensor loaded from the canonical sensor directory.

## Verified Pi Mechanisms

Minimum supported Pi version is `0.78.1` or later until compatibility testing expands. Dasein still checks each required API at startup because version alone is not a feature probe.

Evidence status vocabulary:

- `SOURCE_VERIFIED`: documentation, examples, or local source were read. This is not live proof.
- `API_VERIFIED`: the API shape was verified against Pi docs/source or a fake host. This is not live TUI proof.
- `LIVE_SMOKE_VERIFIED`: the behavior was observed in a live Pi process.
- `LIVE_SMOKE_PENDING`: live behavior is required before release and has not yet been observed.

Evidence status is a non-empty set/list, not a single scalar, because a mechanism may be API-verified while still pending live smoke. Status payloads must preserve that distinction instead of collapsing it. Release support claims are separate from fake-host/API-shape tests: only the live-smoke ledger below can satisfy live support evidence.

Current verification evidence:

| Mechanism | Pi version | Binary path | Evidence statuses | Verification date | Observed behavior / evidence ledger | Release requirement |
|---|---:|---|---|---|---|---|
| `pi.registerCommand` for slash commands with raw args and completions | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` documents command registration. `npm run test:smoke` generated `.dasein/live-pi-smoke/latest/checklist_receipt.json` with `pi.registerCommand./dasein=PROVEN`; artifacts include `slash-command-proof.json` and `bare-dasein-outside-tui-proof.json`. | Re-run `npm run test:smoke` for release evidence; do not substitute fake-host integration tests. |
| `pi.registerFlag` with `type: "string"` for launch arguments | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` and `examples/extensions/ssh.ts` document string flags. Live ledger row `pi.registerFlag.--dasein=PROVEN`; artifact `launch-flag-proof.json` shows `--dasein` parsed and applied before context injection. | Re-run `npm run test:smoke` for release evidence. |
| `pi.on("before_agent_start")` per-turn system prompt modification | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` documents `before_agent_start` and its `systemPrompt` return. Live ledger row `pi.before-agent-start.system-prompt-context=PROVEN`; artifact `context-injection-proof.json` shows Dasein appending ambient context to the chained system prompt without adding a Dasein `CustomMessage` or user-role message. | Re-run `npm run test:smoke` for release evidence. |
| `CustomMessage display:false` conversion to LLM user message through Pi `convertToLlm` | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | Pi `convertToLlm` serializes extension `CustomMessage` entries as `role:"user"`; this is verified as a negative contract for Dasein, not the default ambient-context channel. Dasein ambient context must not rely on `display:false` custom messages for hidden agent context. | Re-run `npm run test:smoke` for release evidence. |
| `pi.events` for cross-extension state publishing | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `examples/extensions/event-bus.ts` documents the API. Live ledger row `pi.events.set-clear-live=PROVEN`; artifact `event-bus-proof.json` shows `dasein:state:set` and `dasein:state:clear` received through live `pi.events`. | Re-run `npm run test:smoke` for release evidence. |
| `ctx.ui.setStatus` for persistent footer status | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` documents `setStatus`. Live ledger row `tui.status-widget-render-clear=PROVEN`; artifacts `tui-render-proof.json`, `tui-render.raw.text`, and `lifecycle-cleanup-proof.json` show status sentinel rendering and shutdown clear calls. | Re-run `npm run test:smoke` for release evidence. |
| `ctx.ui.setWidget` for optional editor-adjacent context display | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` documents `setWidget`. Live ledger row `tui.status-widget-render-clear=PROVEN`; artifacts `tui-render-proof.json`, `tui-render.raw.text`, and `lifecycle-cleanup-proof.json` show widget sentinel rendering and shutdown clear calls. | Re-run `npm run test:smoke` for release evidence. |
| `ctx.ui.custom` plus `SettingsList` for interactive configuration UI | `0.78.1` | `/opt/homebrew/bin/pi` | `API_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `ctx.ui.custom` and `SettingsList` are API/source verified. Live ledger rows `settingslist.common-sensor-controls`, `settingslist.metadata-before-enable-and-persistence`, and `ctx.ui.custom.no-api-key-render-path` are `PROVEN`; artifacts include `settingslist-persistence-proof.json`, `settingslist-persistence.raw.text`, and `custom-no-api-key-proof.json`. | Re-run `npm run test:smoke`; do not treat SettingsList import availability alone as live TUI support. |
| `ctx.mode === "tui"` guard for TUI-only rendering | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` documents modes. Live smoke exercised both TUI rendering and print-mode fallback; artifacts `bare-dasein-outside-tui-proof.json` and `custom-no-api-key-proof.json` prove the non-TUI fallback and TUI custom path stay separated. | Re-run `npm run test:smoke` for release evidence. |
| `session_start` and `session_shutdown` for lifecycle and cleanup | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` documents both events. Live ledger row `lifecycle.before-agent-start-agent-end-cleanup=PROVEN`; artifact `lifecycle-cleanup-proof.json` shows startup, cleanup, per-sensor cleanup timeouts, and status/widget clear order. | Re-run `npm run test:smoke` for release evidence. |
| Human input observation through `input` when available, otherwise `before_agent_start` as fallback sampling point | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` documents `input` and `before_agent_start`. Live smoke proves the fallback observation path through `before_agent_start` in `lifecycle-cleanup-proof.json`; direct `input` availability remains a source/API-supported registration path and must not be overclaimed beyond that observation. | Re-run `npm run test:smoke`; if Pi changes lifecycle availability, fail the affected lapse observation feature closed and report it. |
| Agent completion observation through `agent_end` | `0.78.1` | `/opt/homebrew/bin/pi` | `SOURCE_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `docs/extensions.md` documents `agent_end`; artifact `lifecycle-cleanup-proof.json` shows live `agent_end` observation. | Re-run `npm run test:smoke` for release evidence. |
| Directory/package dynamic `.ts` sensor discovery and manual `/dasein reload` | `0.78.1` | `/opt/homebrew/bin/pi` | `API_VERIFIED`, `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `npm run test:smoke` generated `.dasein/dynamic-reload-smoke/latest/checklist_receipt.json` and `dynamic-reload-proof.json`; checklist proves cache-busted import of a changed sensor, rendered context update to v2, invalid reload failure, load-error reporting, and preservation of old registry/rendered context. | Re-run `npm run test:smoke`; single-file packaged installs still must not claim user-added dynamic discovery. |
| Installed Pi binary/version | `0.78.1` | `/opt/homebrew/bin/pi` | `LIVE_SMOKE_VERIFIED` | 2026-06-06 | `/opt/homebrew/bin/pi --version` returned `0.78.1`; `ls -l /opt/homebrew/bin/pi` showed the Homebrew symlink to the local package CLI. | Version-only support is insufficient; feature smoke gates above still apply. |

Support claims must not ship on `SOURCE_VERIFIED` or `API_VERIFIED` evidence alone. The current live-smoke ledger has zero blockers on this host, but release support still requires rerunning the executable gate for the release candidate and retaining its generated artifacts. If a Pi installation does not expose one of these mechanisms, Dasein must fail the affected feature closed and report it in `/dasein status`. This table is current evidence, not a permanent compatibility guarantee.

## Design Decisions

### Decision 1: `before_agent_start.systemPrompt` for agent ambient context

Dasein injects agent ambient context by appending a bounded block to Pi's per-turn `before_agent_start` `systemPrompt`. Pi owns provider serialization and may send that prompt as provider-native `developer` or `system` messages according to model/provider compatibility.

Rationale: Dasein's primary purpose is agent spacetime awareness, so agent injection remains enabled by default. The channel must still preserve role semantics: ambient context is runtime/developer context, not user speech. Pi `CustomMessage` entries, including `display:false` entries, participate in LLM context and `convertToLlm()` serializes them as `role:"user"`; therefore they are unsuitable as Dasein's default ambient-context channel.

Trade-off: system-prompt injection is per-turn rather than a persisted session message. That is intentional: Dasein ambient readings are ephemeral local context and should not become transcript history.

### Decision 2: Neutral diagnostic label

Dasein's renderer keeps a neutral canonical diagnostic label:

```text
ambient_ctx
```

The renderer's canonical diagnostic string is:

```text
[ambient_ctx: ...]
```

This string is a render/debug representation, not default human-facing chrome and not a transcript message. For model use, Dasein appends a bounded per-turn block to Pi's chained system prompt in `before_agent_start`; Pi then serializes that system prompt as provider-native `developer` or `system` according to provider compatibility. Dasein must not deliver this block through `CustomMessage`, because Pi `convertToLlm()` serializes custom messages as `role:"user"` even when `display:false`.

In TUI mode, Dasein must not publish the raw `[ambient_ctx: ...]` string through the visible status footer or default settings surface. Human-facing status defaults to a short Dasein summary, while raw renderer payload remains inspectable only through explicit diagnostics such as `/dasein status` proof data and debug artifacts.

Rationale: the project name `Dasein` is useful for UI and branding but too philosophically loaded for every inference payload. The raw renderer representation is useful for diagnostics but too noisy and semantically wrong for default human UI or user-message transcript.

Trade-off: provider-visible ambient context is less transcript-like, but safer for role semantics and agent behavior. The visible UI is less detailed by default, but diagnostics preserve inspectability on demand.

### Decision 3: No policy layer

Dasein has no policy, lock, or priority layer.

Rationale: configuration is enough. User/persona behavior should decide how to interpret enabled fields.

Configuration precedence is:

```text
defaults < global disk config < launch args < slash/UI runtime changes
```

Runtime slash/UI changes are validated, persisted immediately to `~/.pi/dasein/config.json`, and then applied to the active runtime. If persistence fails, the runtime must not change.

### Decision 4: Install-mode-specific sensor registry

Directory/package installs scan the canonical sensor directory on startup and on manual `/dasein reload`:

```text
<extension_root>/src/sensors/*.ts
```

Single-file packaged installs use only the bundled static sensor registry. They do not support user-added local sensor files unless the extension is installed in unpacked directory form.

Rationale: dynamic scan is useful for editable installs, but single-file packaging cannot safely promise runtime discovery of arbitrary `.ts` files.

Trade-off: automatic hot-plug is not supported. Core code changes still use Pi's global `/reload`, and packaged single-file users must switch to directory install for local sensors.

### Decision 5: No request-path I/O

The LLM injection path reads only a pre-rendered in-memory string through an injector allowlist.

Rationale: no `fs`, `child_process`, `http`, `https`, `net`, `tls`, `dns`, `fetch`, `XMLHttpRequest`, `WebSocket`, dynamic `import`, sensor refresh/action/cleanup/discovery, config mutation, native helper import, or helper module import may delay or change prompt construction.

Trade-off: injected ambient state can be stale until sensors refresh.

### Decision 6: All-or-keep-old reload

Sensor reload is all-or-keep-old.

Dasein builds and validates a complete candidate registry before touching the active registry. If rescan, import, duplicate-key validation, spec validation, config merge, or candidate renderer validation fails, the old sensor registry, old runtime, and old rendered strings remain active.

On successful candidate validation, Dasein commits with this deterministic sequence:

1. stop scheduling old sensor refreshes;
2. abort obsolete old refreshes;
3. run old sensor cleanup concurrently with `1000ms` timeout per sensor and aggregate errors;
4. swap the candidate registry, effective config, runtime scheduler, and renderer inputs;
5. start the new scheduler;
6. run initial refreshes for sensors whose effective config has `initialRefresh !== false`; manual reload bypasses native backoff delay but not refresh timeout;
7. recompute and publish UI/rendered strings.

Rationale: validation happens while the old system is still serving requests. Cleanup is delayed until there is a known-good replacement.

Trade-off: after the commit point, cleanup errors are reported but do not roll back to old code.

## Module Structure

```text
dasein-pi-extension/
├── CONSTITUTION.md
├── docs/
│   ├── PRD.md
│   └── TECHNICAL_DESIGN.md
├── index.ts                  # root Pi auto-discovery shim for ~/.pi/agent/extensions/dasein/index.ts
├── src/
│   ├── index.ts              # real extension composition entrypoint
│   ├── core/
│   │   ├── types.ts
│   │   ├── config.ts
│   │   ├── state.ts
│   │   ├── sensor-loader.ts
│   │   ├── sensor-runtime.ts
│   │   ├── renderer.ts
│   │   ├── injector.ts
│   │   ├── external-events.ts
│   │   └── lifecycle.ts
│   ├── commands/
│   │   └── dasein-command.ts
│   ├── ui/
│   │   ├── status.ts
│   │   ├── widget.ts
│   │   └── settings.ts
│   ├── native/
│   │   └── macos-location-helper.swift
│   └── sensors/
│       ├── clock.ts
│       ├── geo.ts
│       └── lapse.ts
└── tests/
```

The root `index.ts` shim exists because Pi's documented global extension auto-discovery loads `~/.pi/agent/extensions/*/index.ts`; it must do no work except delegate to `./src/index.ts`. The extension root is the project root that contains the shim and `src/index.ts`, not the `src/` directory. If the independent Dasein project is symlinked into Pi, the resolved real project root is still the extension root for sensor scanning.

## Core Contracts

### Dasein Config

```typescript
export type SensorKey = string;
export type ExternalStateKey = string;
export type CommandPath = string;

export interface DaseinConfig {
  version: 1;
  core: CoreConfig;
  sensors: Record<SensorKey, SensorConfig>;
  external: Record<ExternalStateKey, ExternalStateConfig>;
}

export type RenderOrderKey = SensorKey | `external:${ExternalStateKey}`;

export interface CoreConfig {
  agentInjectionEnabled: boolean;
  statusEnabled: boolean;
  widgetEnabled: boolean;
  maxAgentChars: number;
  injectedLabel: string;
  renderOrder: RenderOrderKey[];
}

export interface SensorConfig {
  enabled: boolean;
  ui: boolean;
  agent: boolean;
  intervalMs?: number | null;
  timeoutMs?: number;
  staleAfterMs?: number;
  initialRefresh?: boolean;
  acknowledgedManifestDigest?: string | null;
  [sensorSpecificKey: string]: unknown;
}

export interface ExternalStateConfig {
  ui: boolean;
  agent: boolean;
}
```

Key and path grammar:

- Sensor keys and external state keys must match `[A-Za-z0-9_-]{1,64}`. Dots are not allowed inside keys.
- Sensor keys matching reserved core command words are invalid load errors: `status`, `reload`, `sensors`, `set`, `apply`, and `help`.
- Command paths and launch-flag paths use dots only as segment separators.
- Canonical sensor config paths are `sensors.<sensorKey>.<field-path>`.
- Short sensor config paths are the only path aliases: `sensorKey.<field-path>` normalizes to `sensors.<sensorKey>.<field-path>` when `sensorKey` is a discovered sensor key. Example: `geo.agent` means `sensors.geo.agent`.
- External config paths are always `external.<externalKey>.<field>`. Example: `external.weather.agent` uses external key `weather`; `external.weather.alert.agent` is invalid because the key would contain a dot.
- Core config paths are `core.<field>`.
- Command aliases are not accepted for subcommands or sensor actions. Only documented command words and discovered sensor action names are valid.
- All validation and persistence uses normalized canonical paths; user-facing results may echo both `inputPath` and `canonicalPath` when they differ.

Full effective defaults after builtin sensor defaults and shared non-recurring timing defaults are composed:

```json
{
  "version": 1,
  "core": {
    "agentInjectionEnabled": true,
    "statusEnabled": true,
    "widgetEnabled": false,
    "maxAgentChars": 240,
    "injectedLabel": "ambient_ctx",
    "renderOrder": ["clock", "lapse", "geo"]
  },
  "sensors": {
    "clock": {
      "enabled": true,
      "ui": true,
      "agent": true,
      "intervalMs": 60000,
      "timeoutMs": 2000,
      "staleAfterMs": 120000,
      "initialRefresh": true,
      "precision": "minute"
    },
    "geo": {
      "enabled": false,
      "ui": true,
      "agent": false,
      "intervalMs": 60000,
      "timeoutMs": 3000,
      "staleAfterMs": 1800000,
      "initialRefresh": true,
      "precision": "city",
      "tags": {},
      "exactAddress": false,
      "exactCoordinates": false
    },
    "lapse": {
      "enabled": true,
      "ui": true,
      "agent": true,
      "intervalMs": 60000,
      "timeoutMs": 2000,
      "staleAfterMs": 120000,
      "initialRefresh": true,
      "persist": true,
      "agentFields": ["user_idle"]
    }
  },
  "external": {}
}
```

Validation rules:

- `version` must be `1`.
- `core.maxAgentChars` must be an integer from `40` to `2000`; default is `240`.
- `core.injectedLabel` must match `[A-Za-z0-9_.:-]{1,32}`; default is `ambient_ctx`.
- `core.renderOrder` must contain unique render keys. A render key is either a discovered sensor key matching `[A-Za-z0-9_-]{1,64}` or an external key written as `external:<externalKey>` where `externalKey` matches the same key grammar. Unknown unprefixed sensor keys are rejected after sensor discovery; prefixed external keys are allowed even before a live external snapshot exists.
- Builtin default agent fragments must be at most `240` characters each before global `core.maxAgentChars` truncation unless a future explicit verbose mode is added.
- Sensor keys and external state keys must match `[A-Za-z0-9_-]{1,64}`.
- `SensorConfig.intervalMs`, when omitted or `null`, means no recurring interval scheduler. A recurring scheduler exists only when the effective config contains a positive integer `intervalMs` from an explicit sensor default, disk config, launch overlay, or runtime change.
- `SensorConfig.timeoutMs`, when omitted, defaults to `2000`.
- `SensorConfig.staleAfterMs`, when omitted, defaults to `intervalMs * 2` when `intervalMs` is a positive integer, otherwise `120000`.
- `SensorConfig.initialRefresh`, when omitted, defaults to `true`; it is a one-shot startup/reload refresh, not recurring background work.
- `SensorConfig.acknowledgedManifestDigest`, when present, must be `null` or the lower-case SHA-256 hex digest exposed for that sensor by `/dasein sensors`; it has no effect for builtin sensors.
- An unconfigured external key defaults to `{ "ui": true, "agent": false }` when a valid external event for that key arrives.
- `SensorFieldSpec.type === "enum"` requires a non-empty unique `values` list.
- Enum config values must exactly match one listed value.
- `SensorFieldSpec.type === "array"` requires valid array values; if `item` is present, every element must validate against it.
- `SensorFieldSpec.type === "object"` requires a JSON object, not an array; declared child fields validate by child key.
- Sensor-specific config fields are rejected unless the field path is declared in `SensorSpec.fields` or accepted by the sensor's `validateConfig` hook.
- Builtin complex fields are valid by declared/validator contract: `geo.tags` is an object field managed by geo actions with canonical tag values shaped `{ lat, lon, radius_m, label? }` under each tag key, and `lapse.agentFields` is an array of allowed lapse field names.

### Config Source and Precedence

```typescript
export interface DaseinConfigOverlay {
  core?: Partial<CoreConfig>;
  sensors?: Record<SensorKey, Partial<SensorConfig>>;
  external?: Record<ExternalStateKey, Partial<ExternalStateConfig>>;
}

export interface DiskDaseinConfig extends DaseinConfigOverlay {
  version: 1;
}

export interface ConfigSources {
  defaults: DaseinConfig;
  disk: DiskDaseinConfig | null;
  launch: DaseinConfigOverlay | null;
  runtime: DaseinConfigOverlay | null;
  runtimeOverriddenPaths: string[];
}

export type ConfigValidationErrorKind =
  | "invalid-path"
  | "invalid-value"
  | "unknown-sensor"
  | "invalid-schema"
  | "persist-failed"
  | "mutation-conflict";

export interface ConfigValidationError {
  kind: ConfigValidationErrorKind;
  path: string;
  message: string;
}

export type ConfigMutationResult =
  | {
      ok: true;
      config: Readonly<DaseinConfig>;
      updatedPaths: string[];
      deletedPaths: string[];
      persistedPath: string;
    }
  | {
      ok: false;
      errors: ConfigValidationError[];
      config: Readonly<DaseinConfig>;
    };

export type ConfigReloadResult =
  | {
      ok: true;
      config: Readonly<DaseinConfig>;
      loadedPath: string;
      warnings: string[];
      launchReappliedPaths: string[];
      runtimeOverriddenPaths: string[];
    }
  | {
      ok: false;
      errors: ConfigValidationError[];
      config: Readonly<DaseinConfig>;
    };

export interface ConfigManager {
  getEffectiveConfig(): Readonly<DaseinConfig>;
  setRuntime(path: string, value: unknown): Promise<ConfigMutationResult>;
  applyRuntime(assignments: Record<string, unknown>): Promise<ConfigMutationResult>;
  applyRuntimeProposal(proposal: ConfigMutationProposal): Promise<ConfigMutationResult>;
  reloadDisk(): Promise<ConfigReloadResult>;
}
```

Runtime mutation serialization:

- There is exactly one async FIFO config mutation queue for this process.
- The queue serializes `/dasein set`, `/dasein apply`, SettingsList changes, sensor actions that return proposed config mutations, and `/dasein reload`.
- Enqueue order is the order the command/UI/action/reload request reaches Dasein core. The next request does not start validation, disk I/O, or active-config commit until the previous request has completed with success or failure.
- Failed mutations do not block later queued requests; they complete with structured errors and the queue advances.
- A queued `/dasein reload` observes all successful mutations committed before it in FIFO order and none queued after it.

Runtime mutation rules:

- Slash, SettingsList, and sensor-action changes validate against a candidate config first.
- A successful candidate patches `~/.pi/dasein/config.json` only at normalized canonical disk paths.
- Runtime mutation persistence must not serialize the full effective config and must not persist unrelated launch-derived values.
- The active runtime changes only after the disk write succeeds.
- `/dasein apply` is all-or-nothing: if any assignment is invalid or persistence fails, none of the assignments take effect.
- `applyRuntimeProposal` is the only ConfigManager entrypoint for sensor-action proposals; it accepts both `assignments` and `deletePaths`, validates them in one candidate transaction, and commits neither if any assignment or delete path is invalid.
- A successful slash/UI/sensor-action mutation records each normalized canonical path in `runtimeOverriddenPaths` for this process.
- Runtime-overridden paths persist to disk and win over launch overlays for the rest of the current process, including after `/dasein reload`.

Disk, launch, and reload rules:

- Normal precedence is `defaults < disk < launch < runtime`.
- Non-empty disk config must include top-level `version: 1`; `core`, `sensors`, `external`, sensor keys, external keys, and individual fields may still be partial.
- On startup there are no runtime-overridden paths, so every valid launch assignment overlays disk config.
- During `/dasein reload`, Dasein rereads disk config and reapplies the original valid launch overlay except for paths listed in `runtimeOverriddenPaths`.
- Runtime-overridden paths are sourced from the newly read disk config plus the in-memory runtime layer; the launch layer must not overwrite them after reload.
- Disk config is a partial config. Missing `core`, `sensors`, `external`, sensor keys, external keys, or individual fields are resolved from defaults and later precedence layers.
- Malformed disk config at startup does not abort startup. Dasein falls back to defaults plus valid launch args, records a status error, and does not treat malformed disk fields as active.
- Malformed disk config during `/dasein reload` keeps the last-known-good active config, registry, runtime, launch overlay state, `runtimeOverriddenPaths`, and rendered context.
- A malformed launch flag is all-or-nothing for the launch layer: no launch assignments apply, no disk write occurs, and `/dasein status` reports the launch parse/validation error.

### Launch Flag Grammar

Dasein registers one Pi launch flag:

```text
--dasein "path=value,path=value"
```

Grammar:

```text
launch-flag          := assignment ("," assignment)*
assignment           := command-path "=" value
command-path         := core-path | canonical-sensor-path | short-sensor-path | external-path
core-path            := "core" "." field-path
canonical-sensor-path:= "sensors" "." sensor-key "." field-path
short-sensor-path    := sensor-key "." field-path
external-path        := "external" "." external-key "." ("ui" | "agent")
field-path           := segment ("." segment)*
sensor-key           := key
external-key         := key
key                  := [A-Za-z0-9_-]{1,64}
segment              := [A-Za-z0-9_-]{1,64}
value                := boolean | number | quoted-string | bare-string
boolean              := "on" | "off" | "true" | "false" | "enabled" | "disabled"
number               := "-"? ("0" | [1-9][0-9]*) ("." [0-9]+)?
quoted-string        := '"' quoted-char* '"'
quoted-char          := unescaped-char | escape-sequence
bare-string          := bare-char+
bare-char            := any non-control character except whitespace, comma, equals, quote, or backslash
unescaped-char       := any non-control character except comma, quote, or backslash
escape-sequence      := "\\\\" | "\\\"" | "\\,"
ws                   := one or more ASCII spaces or tabs
```

Leading/trailing whitespace around assignments and comma-separated launch entries is trimmed before grammar matching. Whitespace inside quoted strings is preserved.

Quoted parser rules shared by launch and `/dasein apply`:

- Double quotes delimit quoted strings.
- Inside quoted strings, the only valid backslash escapes are `\\` for a literal backslash, `\"` for a literal double quote, and `\,` for a literal comma.
- A comma outside quotes separates assignments; `\,` inside quotes is part of the value.
- Unterminated quotes are parse errors.
- Any backslash escape other than `\\`, `\"`, or `\,` is a parse error.
- The parser rejects malformed input instead of normalizing or guessing intent.

Launch value coercion is identical to `/dasein set` and `/dasein apply`: booleans support `on/off/true/false/enabled/disabled`; numeric fields accept only finite decimal tokens with optional leading `-`, no leading `+`, no exponent, no `NaN`/`Infinity`, no leading zeros except `0` or `0.x`, and no trailing decimal point; enum fields require exact enum values after unquoting; quoted strings preserve spaces, equals signs, and valid escaped characters; and bare strings remain strings unless the target schema requires another type. Bare strings cannot contain whitespace, control characters, comma, equals, quote, or backslash; commas in string values must be written inside quotes as `\,`, and equals signs in string values must be quoted. Commas delimit assignments after whitespace-trimming, quote-aware, and escape-aware tokenization.

Invalid launch behavior:

- Unknown paths, unknown sensors, unknown fields, duplicate canonical assignments, bad grammar, failed value coercion, enum mismatch, unterminated quotes, invalid escapes, and sensor validator failures make the whole launch layer invalid. Duplicate detection runs after path normalization, so `geo.agent` and `sensors.geo.agent` conflict.
- Invalid launch args never persist to disk and never partially apply.
- Startup continues with defaults plus valid disk config when disk config is valid, or defaults only when disk config is malformed.
- The launch error is recorded as a status error visible in `/dasein status`.

### Sensor Spec

A sensor file must default-export exactly one `SensorSpec`. Named exports such as `sensorSpec` are not accepted as an alternative contract.

```typescript
export interface SensorSpec<TState = unknown, TConfig extends SensorConfig = SensorConfig> {
  key: SensorKey;
  defaults: TConfig;
  manifest: SensorManifest;
  fields?: Record<string, SensorFieldSpec>;
  normalizeState?: SensorStateNormalizer<TState>;
  validateConfig?: SensorConfigValidator<TConfig>;
  refresh?: SensorRefresh<TState, TConfig>;
  observe?: SensorObserve<TState, TConfig>;
  renderAgent?: SensorRender<TConfig>;
  renderUI?: SensorRender<TConfig>;
  actions?: Record<string, SensorAction<TConfig>>;
  cleanup?: SensorCleanup;
}

export interface SensorManifest {
  description: string;
  declaredInputClasses: readonly SensorInputClass[];
  outputFields: readonly SensorOutputFieldSpec[];
  permissions: readonly SensorPermissionSpec[];
  remote: SensorRemoteBehavior;
  backgroundWork: SensorBackgroundWorkDeclaration;
}

export type SensorInputClass =
  | "time"
  | "pi_lifecycle"
  | "native_location"
  | "filesystem"
  | "subprocess"
  | "network"
  | "external_event"
  | "derived";

export interface SensorOutputFieldSpec {
  state_key: string;
  value_type: SensorValueType;
  description: string;
  agentVisibleByDefault: boolean;
  uiVisibleByDefault: boolean;
}

export interface SensorPermissionSpec {
  kind: "none" | "macos_location" | "filesystem" | "subprocess" | "network" | "other";
  required: boolean;
  reason: string;
}

export type SensorRemoteCadence = "none" | "manual" | "startup" | "interval" | "event";

export interface SensorRemoteBehavior {
  capable: boolean;
  contactsNetworkByDefault: boolean;
  destinations: readonly string[];
  payloadClasses: readonly string[];
  transmissionCadence: SensorRemoteCadence;
  disableControl: "none" | "sensor.enabled" | "sensor-specific";
  description: string;
}

export type SensorBackgroundWorkKind = "initial_refresh" | "recurring_interval" | "pi_lifecycle_observe";

export type SensorIntervalRelationship = "none" | "default_interval_sets_effective_interval_unless_overridden";

export interface SensorBackgroundWorkDeclaration {
  capable: boolean;
  kinds: readonly SensorBackgroundWorkKind[];
  defaultIntervalMs: number | null;
  intervalRelationship: SensorIntervalRelationship;
  description: string;
}

export interface SensorFieldSpec {
  label: string;
  type: "boolean" | "string" | "number" | "enum" | "array" | "object";
  values?: readonly string[];
  item?: SensorFieldSpec;
  fields?: Record<string, SensorFieldSpec>;
  additionalProperties?: boolean;
  actionManaged?: boolean;
  description?: string;
}

export type SensorConfigValidator<TConfig extends SensorConfig = SensorConfig> = (
  config: Readonly<TConfig>,
) => readonly ConfigValidationError[];

export interface SensorContext<TConfig extends SensorConfig = SensorConfig> {
  config: Readonly<TConfig>;
  signal: AbortSignal;
  now(): number;
}

export interface SensorNormalizeContext {
  sensorKey: SensorKey;
  collectedAt: number;
  staleAfterMs: number;
  status: "enabled" | "error";
  source: SensorStateSource;
  error?: SensorError;
  outputFields: readonly SensorOutputFieldSpec[];
}

export type SensorStateNormalizer<TState = unknown> = (
  value: TState,
  context: SensorNormalizeContext,
) => Record<string, SensorStateField>;

export interface SensorRefreshMetadata {
  collectedAt?: number;
  staleAfterMs?: number;
  status?: "enabled" | "error";
  error?: SensorError;
  source?: SensorStateSource;
}

export interface SensorRefreshResult<TState = unknown> {
  value?: TState;
  fields?: Record<string, SensorStateField>;
  metadata?: SensorRefreshMetadata;
}

export type SensorRefreshReturn<TState = unknown> = TState | SensorRefreshResult<TState>;

export type SensorRefresh<TState, TConfig extends SensorConfig> = (
  context: SensorContext<TConfig>,
  previous: SensorSnapshot | null,
) => Promise<SensorRefreshReturn<TState>> | SensorRefreshReturn<TState>;

export interface SensorViewFragment {
  sensor_id: SensorKey;
  state_key: string;
  value: unknown;
  value_type: SensorValueType;
  label?: string;
  status?: SensorStatus;
  source?: SensorStateSource;
}

export type SensorRender<TConfig extends SensorConfig> = (
  snapshot: SensorSnapshot,
  config: Readonly<TConfig>,
) => SensorViewFragment | readonly SensorViewFragment[] | null;

export type SensorObservationEvent =
  | { kind: "input"; observedAt: number; turnId: string }
  | { kind: "before_agent_start"; observedAt: number; turnId: string }
  | { kind: "agent_end"; observedAt: number; turnId: string };

export type SensorObserve<TState, TConfig extends SensorConfig> = (
  event: SensorObservationEvent,
  context: SensorContext<TConfig>,
  previous: SensorSnapshot | null,
) => Promise<SensorRefreshReturn<TState> | null> | SensorRefreshReturn<TState> | null;

export type SensorAction<TConfig extends SensorConfig> = (
  args: string[],
  context: SensorActionContext<TConfig>,
) => Promise<SensorActionResult> | SensorActionResult;

export interface ConfigMutationProposal {
  assignments?: Record<string, unknown>;
  deletePaths?: string[];
}

export type SensorActionResult =
  | {
      ok: true;
      message?: string;
      refreshScheduled?: boolean;
      mutation?: ConfigMutationProposal;
      data?: unknown;
    }
  | {
      ok: false;
      message: string;
    };

export interface SensorActionRefreshOptions {
  bypassBackoff?: boolean;
  reason: string;
}

export type SensorActionRefreshResult =
  | { ok: true; snapshot: SensorSnapshot; fresh: true }
  | { ok: false; snapshot: SensorSnapshot | null; error: SensorError };

export interface SensorActionContext<TConfig extends SensorConfig> {
  sensorKey: SensorKey;
  config: Readonly<TConfig>;
  snapshot: SensorSnapshot | null;
  refreshNow(options: SensorActionRefreshOptions): Promise<SensorActionRefreshResult>;
  scheduleRefresh(reason: string): void;
}

export type SensorCleanup = () => Promise<void> | void;

export interface SensorRegistryEntry<TState = unknown, TConfig extends SensorConfig = SensorConfig> {
  spec: SensorSpec<TState, TConfig>;
  provenance: SensorRegistryProvenance;
}

export type SensorRegistryProvenance =
  | { kind: "builtin" }
  | { kind: "user_added_local_file"; filePath: string };
```

Inspectable sensor metadata is the combination of loader-owned `SensorRegistryEntry.provenance`, spec-owned `SensorSpec.manifest`, runtime-owned effective scheduling values, and loader-computed `manifestDigest`. `SensorRegistryEntry.provenance` records source/provenance: builtin specs use `{ kind: "builtin" }`; user-added local sensors loaded from directory/package installs use `{ kind: "user_added_local_file", filePath }`. `SensorSpec.manifest` declares input classes, output fields, permissions, remote/network behavior, and background work before the sensor is enabled. Remote/network behavior includes destinations, payload classes, transmission cadence, and the disable control. Background work includes declared kind(s), default interval relationship, and description; runtime metadata separately exposes `effectiveIntervalMs`. `manifestDigest` is the lower-case SHA-256 hex digest of canonical JSON for the current inspectability metadata that a user reviews: provenance kind/file path, `SensorSpec.manifest`, declared output/input/permission metadata, remote/background declarations, and effective scheduling metadata. Single-file packaged installs do not create user-added local-file entries.

`observe` is optional and exists only for sensors that need Pi lifecycle observations, such as lapse. Core calls it from Pi `input`, fallback `before_agent_start`, and `agent_end` handlers outside the LLM request path. `observe` must obey the same no-request-path I/O rule as refresh scheduling: no disk, network, subprocess, config mutation, dynamic import, sensor discovery, or native/helper import may occur while Pi is constructing an LLM request. If an observation changes durable state, the sensor updates in-memory state only and asks core to enqueue/coalesce an asynchronous durable write after request construction/event handling has returned.

Sensor actions that require current state must call and await `context.refreshNow(...)`. `refreshNow` returns either a normalized committed `SensorSnapshot` or a structured `SensorError`; it never returns raw sensor state. `scheduleRefresh(reason)` is the separately named fire-and-forget path and is not sufficient for actions whose success depends on fresh data.

Sensor actions cannot mutate config directly. A human-invoked action may return a proposed `mutation: ConfigMutationProposal` only inside the calling sensor's own config namespace:

```text
sensors.<sensorKey>.*
```

`assignments` set canonical paths. `deletePaths` are delete tombstones used only inside the candidate mutation transaction: core validates each path, removes that property from the persisted partial config on commit, removes the active runtime value, and never persists a tombstone value or historical tombstone list. Core mediates the proposal through the single FIFO config mutation queue, validates it with the same config rules as slash/UI changes, persists it to disk, and updates runtime only after persistence succeeds. Actions only propose; core produces the `ConfigMutationResult` returned in command data after validation and persistence.

Refresh return conversion rules:

- `refresh` may return raw `TState` as candidate data, but raw candidate data is only an internal refresh result and is never stored.
- A sensor may instead return `SensorRefreshResult<TState>` when it needs to attach metadata or provide prebuilt `fields` at `SensorRefreshResult.fields`.
- A `SensorRefreshResult<TState>` must contain at least one of `value` or `fields`; if both are absent, core rejects the refresh result.
- Core computes normalized commit metadata first: `contract_version = 1`, `schema_version = 1`, `sensor_id = SensorSpec.key`, `collected_at = metadata.collectedAt ?? now()`, `stale_after_ms = metadata.staleAfterMs ?? effectiveConfig.staleAfterMs`, `source = metadata.source ?? provenance-derived source`, and `status = metadata.error ? "error" : metadata.status ?? "enabled"`.
- The provenance-derived source is `{ sensor_id: key, source_kind: "builtin" }` for builtin registry entries and `{ sensor_id: key, source_kind: "local_sensor", local_file_path: filePath }` for user-added local files.
- If `SensorRefreshResult.fields` is present, every field must already satisfy the typed-state envelope and must use the same `sensor_id`. Core rejects fields with mismatched keys or keys outside the envelope instead of repairing them.
- If `SensorRefreshResult.fields` is absent, core converts `value` into `Record<string, SensorStateField>` by calling `SensorSpec.normalizeState` when present; otherwise core maps the value through the single declared `SensorSpec.manifest.outputFields` entry. A raw value without `fields`, without `normalizeState`, and without exactly one declared output field is invalid.
- After field conversion, core discards the raw `TState` candidate and commits only the normalized `SensorSnapshot.fields` envelope plus snapshot-level aggregate metadata.
- Unavailable hardware, missing native permission, permission denied, and helper failure are all represented as `status: "error"` with a specific `SensorError.kind`; `SensorStatus` does not contain an `unavailable` or `ok` value.

Sensor config validation rules:

- Every `SensorSpec.defaults` must include the required visibility/control base fields `enabled`, `ui`, and `agent`; specs missing any of these fields are invalid. Core supplies deterministic shared defaults for omitted `timeoutMs`, `staleAfterMs`, and `initialRefresh` as described above. Core does not invent a recurring `intervalMs` for user-added sensors.
- When `manifest.remote.capable === true`, manifest validation requires non-empty `destinations`, non-empty `payloadClasses`, a `transmissionCadence` other than `"none"`, a `disableControl` other than `"none"`, and a human-readable `description`. When `manifest.remote.capable === false`, the only valid deterministic non-remote values are `contactsNetworkByDefault: false`, `destinations: []`, `payloadClasses: []`, `transmissionCadence: "none"`, `disableControl: "none"`, and `description: "none"`.
- When `manifest.backgroundWork.capable === false`, the only valid deterministic no-background values are `kinds: []`, `defaultIntervalMs: null`, `intervalRelationship: "none"`, and `description: "none"`. When `manifest.backgroundWork.capable === true`, validation requires non-empty `kinds` and a human-readable `description`; `defaultIntervalMs` must be a positive integer only when `kinds` includes `"recurring_interval"`, otherwise it must be `null`. For recurring interval work, `intervalRelationship` must be `"default_interval_sets_effective_interval_unless_overridden"`; for non-interval background work, it must be `"none"`. `effectiveIntervalMs` is derived from effective config: a positive integer `intervalMs` becomes that value, while omitted or `null` becomes `null`.
- User-added local sensors whose manifest declares `remote.capable === true`, `remote.contactsNetworkByDefault === true`, a required `network` permission, `backgroundWork.capable === true`, or a positive effective `intervalMs` are risky. Risky user-added sensors are forced to effective `enabled: false` unless the effective persisted/runtime config contains both `enabled: true` and `acknowledgedManifestDigest` equal to the current `manifestDigest`. Builtin sensors keep their declared defaults because their local refresh intervals are documented, visible, configurable, and disableable.
- Module defaults, disk config with only `enabled: true`, launch overlay with only `enabled:on`, and slash `/dasein set sensors.<key>.enabled enabled` alone do not satisfy acknowledgement for risky user-added sensors. Launch overlays never satisfy acknowledgement by themselves. SettingsList enable, after showing inspectability metadata, writes both `enabled: true` and the matching `acknowledgedManifestDigest`. `/dasein apply` may do the same only when the user explicitly includes `acknowledgedManifestDigest=<digest>` shown by `/dasein sensors` in the same atomic mutation as `enabled=true`.
- Any manifest, provenance path, declared inspectability metadata, or effective scheduling change that changes `manifestDigest` invalidates the old acknowledgement and forces the risky user-added sensor disabled again until re-acknowledged.
- Forced disable reporting uses `forcedDisabledReason`: remote/network only maps to `"user-added-remote-or-network"`, recurring/background only maps to `"user-added-recurring-work"`, and both together map to `"user-added-remote-or-network-and-recurring-work"`.
- Common base fields (`enabled`, `ui`, `agent`, `intervalMs`, `timeoutMs`, `staleAfterMs`, `initialRefresh`, `acknowledgedManifestDigest`) are owned by core and validated before sensor-specific fields.
- Unknown sensor-specific fields are rejected unless declared in `SensorSpec.fields` or accepted by `validateConfig`.
- Object fields with `additionalProperties !== true` reject undeclared child keys unless `validateConfig` accepts them.
- Array fields validate every element against `item` when `item` is present.
- `actionManaged: true` means the field is intended to be changed through sensor actions; direct disk config is still validated, but slash/UI scalar assignment to that object/array field must fail unless the sensor validator explicitly accepts the candidate.
- Sensor actions that propose config mutation, such as geo tag actions, return `ConfigMutationProposal`; after core validation/persistence succeeds, the command payload exposes the same deterministic `ConfigMutationResult` shape as slash/UI mutations. Actions never write config directly.

### Sensor State

Sensor state uses the Constitution typed-state envelope. A sensor may publish one or many fields, but every published field must use the envelope below; a multi-field snapshot is only valid when each field independently carries the envelope metadata.

```typescript
export type SensorValueType = "string" | "number" | "boolean" | "enum" | "object" | "array" | "null";

export type SensorStatus = "enabled" | "disabled" | "stale" | "error";

export interface SensorStateSource {
  sensor_id: SensorKey;
  source_kind: "builtin" | "local_sensor" | "external_event" | "derived";
  trace_id?: string;
  collected_by?: string;
  local_file_path?: string;
}

export interface SensorStateField<TValue = unknown> {
  contract_version: 1;
  schema_version: 1;
  sensor_id: SensorKey;
  state_key: string;
  value: TValue;
  value_type: SensorValueType;
  collected_at: number;
  stale_after_ms: number;
  status: SensorStatus;
  source: SensorStateSource;
  error?: SensorError;
}

export interface SensorSnapshot {
  contract_version: 1;
  schema_version: 1;
  sensor_id: SensorKey;
  fields: Record<string, SensorStateField>;
  collected_at: number;
  stale_after_ms: number;
  status: SensorStatus;
  source: SensorStateSource;
  error?: SensorError;
  refresh?: SensorRefreshCommitMetadata;
}

export interface SensorRefreshCommitMetadata {
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  generation: number;
  timedOut: boolean;
}

export interface SensorError {
  kind: "timeout" | "permission" | "unavailable" | "helper-unavailable" | "process" | "parse" | "config" | "unknown";
  message: string;
}
```

Envelope mapping rules:

- `contract_version` is the typed-state envelope contract version and must be `1` for the initial release.
- `schema_version` is the sensor field schema version and must be `1` unless a future explicit migration changes it.
- `sensor_id` is the canonical `SensorKey` of the publishing sensor.
- `state_key` is the stable field key inside that sensor, such as `clock.local_time`, `geo.lat`, or `lapse.user_idle_ms`.
- `value` is the field value after sensor-local parsing, before renderer formatting.
- `value_type` is the schema-level type of `value`; it must not be inferred by consumers from JavaScript runtime type alone. It maps to the Constitution `type` descriptor; the implementation-facing name is `value_type` to avoid ambiguity with TypeScript syntax.
- `collected_at` is the time the field value was observed or derived.
- `stale_after_ms` is copied from the effective sensor config or stricter field-level metadata when a sensor defines one. It maps to the Constitution stale metadata and defines the freshness window used for stale derivation.
- `status` is field-level; the snapshot `status` is only an aggregate convenience for listings.
- `source` records traceability. Builtin sensors use `source_kind: "builtin"`; user-added local sensor files use `source_kind: "local_sensor"` and must include `local_file_path`; `source_kind: "external_event"` is used only when a sensor explicitly consumes an external event and republishes it as normalized sensor state; derived values use `source_kind: "derived"`. Raw external snapshots remain separate `ExternalStateSnapshot` records and are not sensor envelopes. Native/helper collection for a builtin sensor stays `source_kind: "builtin"` and records helper identity in `collected_by`.
- `SensorSnapshot` never carries raw `TState` or arbitrary sensor-returned properties. Raw refresh candidates are discarded before commit.
- `SensorSnapshot.fields` keys must match their enclosed `state_key` values.
- Before storage, rendering, or command output, core canonicalizes each field to the typed-state envelope keys above and drops or rejects fields outside the envelope instead of passing unknown keys through.

Refresh runtime rules:

- A sensor may have at most one active refresh at a time.
- Manual refresh requests while one is active mark a follow-up refresh as pending instead of starting a second concurrent refresh.
- Each sensor runtime has a monotonic generation number.
- A refresh result may commit only if its generation is still current and its abort signal was not aborted.
- Aborted, timed-out, or obsolete refreshes must not commit state.
- Successful fresh data commits with base `status: "enabled"`.
- Disabled sensors are represented as `status: "disabled"` by core and are not refreshed while disabled.
- Timeout produces envelope fields with `status: "error"` and `SensorError.kind: "timeout"` only if the timed-out refresh is still current.
- Unavailable hardware, permission denied, permission restricted, missing native helper output, and similar inability to collect data all produce `status: "error"` with a specific `SensorError.kind`; they are not separate `SensorStatus` values.
- `status: "stale"` is derived at render/read time when `now - field.collected_at > field.stale_after_ms`.
- The store does not need to mutate a snapshot solely to mark it stale; a later successful refresh may overwrite it with `status: "enabled"`.
- A stored `status: "error"` remains the base field status; render/read may additionally treat it as stale when the field age check exceeds `stale_after_ms`.

### External State Event

External state is published through Pi's shared event bus.

Event names:

```text
dasein:state:set
dasein:state:clear
```

Set schema:

```typescript
export interface ExternalStateSetEvent {
  key: ExternalStateKey;
  agent?: string;
  ui?: string;
  ttlMs?: number;
  source?: string;
}
```

Clear schema:

```typescript
export interface ExternalStateClearEvent {
  key: ExternalStateKey;
}
```

Stored shape:

```typescript
export interface ExternalStateSnapshot {
  key: ExternalStateKey;
  agent: string | null;
  ui: string | null;
  source: string | null;
  updatedAt: number;
  expiresAt: number;
}
```

External snapshots are not sensor envelopes and do not use `SensorStateSource`. A sensor may use `source_kind: "external_event"` only after explicitly consuming an external event and republishing a normalized `SensorSnapshot`/`SensorStateField`; the raw external snapshot stays separate.

External config default:

- A valid set event for an external key that has no `config.external[key]` entry uses `{ ui: true, agent: false }`.
- External keys are open-ended local event names, not a predeclared registry. Therefore valid unconfigured external keys are not "unknown".
- Slash/UI config may create or update `external.<key>.ui` and `external.<key>.agent` for any key matching `[A-Za-z0-9_-]{1,64}`.

Validation rules:

- `key` must match `[A-Za-z0-9_-]{1,64}`.
- Set events may contain only `key`, `agent`, `ui`, `ttlMs`, and `source`.
- Clear events may contain only `key`; clear payload is `{ key }` only.
- Unknown event fields are rejected without mutating state.
- At least one of `agent` or `ui` must be present on set.
- `agent`, `ui`, and `source` must be strings when present.
- `agent`, `ui`, and `source` must be single-line payloads with no ASCII control characters, no Unicode line/paragraph separators, and no `\r` or `\n` characters.
- Multiline or control-character payloads are rejected without mutating state; Dasein must not normalize, strip, collapse, or otherwise silently repair them.
- Accepted `agent`, `ui`, and `source` strings must each be at most `120` characters.
- `ttlMs` is optional; when omitted, it defaults to `60000`.
- When present, `ttlMs` must be an integer from `1000` to `86400000`.
- `dasein:state:clear` clears only the matching key.
- Malformed events are rejected without mutating state.

### State Store

```typescript
export interface RenderedContext {
  agent: string | null;
  status: string | null;
  widgetLines: string[] | null;
  omittedKeys: string[];
  truncated: boolean;
}

export interface DaseinStateStore {
  getSensorSnapshot(sensorId: SensorKey): SensorSnapshot | null;
  setSensorSnapshot(snapshot: SensorSnapshot): void;
  clearSensorSnapshot(sensorId: SensorKey): void;
  listSensorSnapshots(): SensorSnapshot[];
  getExternalState(key: ExternalStateKey): ExternalStateSnapshot | null;
  setExternalState(snapshot: ExternalStateSnapshot): void;
  clearExternalState(key: ExternalStateKey): void;
  listExternalStates(): ExternalStateSnapshot[];
  getRenderedContext(): RenderedContext;
  setRenderedContext(value: RenderedContext): void;
  getRenderedAgentString(): string | null;
  setRenderedAgentString(value: string | null): void;
  getRenderedStatusString(): string | null;
  setRenderedStatusString(value: string | null): void;
  getRenderedWidgetLines(): string[] | null;
  setRenderedWidgetLines(value: string[] | null): void;
}
```

The request-path state store is in-memory only. Sensor storage accepts only normalized `SensorSnapshot` objects and `SensorStateField` envelopes; it must reject or strip any raw sensor-returned top-level key such as `state`, `value`, or sensor-specific properties before commit. Durable state needed across runs is explicitly written by the owning lifecycle module to `~/.pi/dasein/state.json`, never by the injector.

Initial durable state file schema:

```typescript
export interface DaseinDurableStateFile {
  version: 1;
  lapse: LapsePersistedState;
}
```

Durability decisions:

- `version` is required and must be `1`.
- `lapse` is required in the file schema when `state.json` exists, but startup reads `state.json` only after defaults, disk config, and launch args are merged and only when effective `sensors.lapse.persist === true`. Lapse disk writes happen only when effective `sensors.lapse.persist === true` or when `/dasein lapse reset` explicitly clears persisted timestamps.
- Lapse retention is bounded to only the latest `previous_human_input_at` and latest `previous_agent_end_at`. Each new observation overwrites the previous value; there is no historical list, event log, duration history, or tombstone list.
- `state.json` has no other top-level keys in the initial scope. Unknown top-level keys are ignored/dropped on the next write.
- Geo durable cache, including `geo.last_fix` and `geo.geocode_cache`, is out of initial scope unless a later design adds explicit retention, privacy, and invalidation controls.
- Geo tags are stored in `~/.pi/dasein/config.json` under `sensors.geo.tags`, not in `state.json`, because tags are user configuration.
- External state is not durable. External publishers must republish after restart if their state still matters.
- Rendered context strings are not durable. They are recomputed from config plus in-memory/durable sensor state.
- `/dasein status` reads and reports lapse-state health, including effective `lapse.enabled`, `lapse.persist`, `lapse.agent`, whether `state.json` loaded when persistence is enabled, whether persisted lapse timestamps are present, and any state load error.
- `/dasein lapse reset` clears in-memory lapse state and writes `lapse.previous_human_input_at = null` and `lapse.previous_agent_end_at = null` to `state.json` even if `lapse.persist === false`, so an explicit reset clears old durable data.

Atomic write behavior:

- Writes create `~/.pi/dasein/` if missing.
- Writers serialize a complete candidate JSON document, write it to a temp file in the same directory, fsync when the platform exposes it, and rename over `state.json` atomically.
- A failed durable-state write must leave the previous `state.json` unchanged and surface a status error.
- Startup with malformed `state.json` ignores the durable file, starts with empty durable lapse state, and records a status error only when effective `sensors.lapse.persist === true`; it must not block config loading or command registration. When effective persistence is false, startup does not read `state.json` and therefore cannot fail on malformed dormant durable state.

## Rendering Contract

Renderer input is the effective config, current state store snapshots, and `now` supplied by the caller. Renderer output is stored as one value:

```typescript
export interface RenderedContext {
  agent: string | null;
  status: string | null;
  widgetLines: string[] | null;
  omittedKeys: string[];
  truncated: boolean;
}
```

Agent render order is deterministic and combines sensor and external contributors fairly:

1. render keys listed in `core.renderOrder`; sensor keys render that sensor, and `external:<key>` renders that external key;
2. remaining enabled sensor keys not already rendered, in lexicographic order;
3. remaining live external state keys not already rendered, in lexicographic order.

This keeps the rule simple and testable while allowing external publishers to opt into explicit ordering without pretending to be sensors.

Rendering rules:

- The renderer has two input classes: typed sensor envelope fields and sanitized external state snapshots. External state snapshots are not sensor envelopes; core still validates their keys, applies `config.external` visibility, drops expired snapshots, sanitizes the stored snapshot shape, and orders external keys separately after sensors.
- Disabled sensors never render.
- `agent: false` fields never enter the agent string.
- `ui: false` fields never enter status/widget strings.
- Expired external state is ignored and may be lazily removed.
- Before formatting sensor fields, core drops keys outside `contract_version`, `schema_version`, `sensor_id`, `state_key`, `value`, `value_type`, `collected_at`, `stale_after_ms`, `status`, `source`, and `error`.
- Before formatting external state, core drops keys outside `key`, `agent`, `ui`, `source`, `updatedAt`, and `expiresAt`.
- Sensor stale state is derived during render/read from each field envelope when `now - field.collected_at > field.stale_after_ms`; the renderer must not require a store mutation only to mark staleness.
- Sensor `renderAgent` and `renderUI` hooks are optional pure `SensorViewFragment` proposal hooks. They never return final prompt/UI strings. Core may invoke them only after typed-envelope normalization and only with normalized `SensorSnapshot`/`SensorStateField` data plus read-only effective sensor config. Hooks never receive raw sensor `TState`.
- Sensor render hooks must not perform I/O, refreshes, actions, config mutation, discovery, durable state access, native/helper import, sanitization, final labeling, ordering, stale derivation, or global truncation. The renderer does not call sensor refresh/action/I/O paths; it may call pure render hooks.
- Core owns canonical labels, field-level order, visibility, stale handling, sanitization, truncation, `omittedKeys`, and final injection/UI strings. For sensor fields and proposed fragments, canonical field ordering is by `sensor_id` first and then `state_key`; render hooks may propose `label`, but core may replace it with the canonical label from `SensorSpec.manifest.outputFields` or `SensorFieldSpec`.
- Hook output is only candidate structured data and may still be omitted, sanitized, relabeled, marked stale, or truncated by core.
- Every default per-sensor/per-field agent fragment must be at most `240` characters before global `core.maxAgentChars` truncation unless a future explicit verbose mode is added. Core rejects, truncates, or omits overlong default fragments before applying the global agent-string limit.
- The core renderer owns final truncation to `core.maxAgentChars` and sets `truncated: true` when truncation occurs.
- `omittedKeys` contains keys skipped because of config visibility, disabled state, expiry, schema/contract mismatch, or truncation.
- When `core.agentInjectionEnabled === false`, the renderer/state store exposes `RenderedContext.agent` and `getRenderedAgentString()` as `null` or an empty string. The injector does not read config to decide this.
- Status rendering and `/dasein status` keep disabled and hidden contributors inspectable even when their values do not enter agent/widget output.
- Sensor renderers must return compact `SensorViewFragment` proposals and must not self-truncate based on global max length or include preformatted final prompt/status/widget strings.
- The injected message is appended at the end of the copied Pi message list.

Render invalidation scheduler:

- After each render, core schedules exactly one in-memory render invalidation timer at the minimum upcoming freshness deadline: any `field.collected_at + field.stale_after_ms` from rendered sensor fields or any live external snapshot `expiresAt`.
- If there are no rendered sensor freshness deadlines and no live external `expiresAt`, core cancels any existing invalidation timer and does not schedule a new one.
- When the timer fires, core recomputes `RenderedContext` from the existing in-memory normalized sensor state and sanitized external snapshots, then publishes changed status/widget strings when in TUI mode.
- The scheduler must not refresh sensors, perform disk/network/subprocess I/O, call dynamic `import`, mutate config, read durable state, load sensors, or run during LLM request construction. The request path only reads the last pre-rendered in-memory `RenderedContext`.
- Recomputing because a freshness timer fired may omit expired external state and may mark or omit stale sensor fields, but it must not mutate sensor snapshots only to represent staleness.

Default injected content example:

```text
[ambient_ctx: time=Fri_14:32+08; user_idle=7h; loc=Shanghai/home]
```

## Data Flow

### Startup

1. Pi loads Dasein extension entrypoint.
2. Dasein resolves `<extension_root>` from the loaded index file/project root.
3. Dasein registers `--dasein` string flag.
4. Dasein registers `/dasein` command.
5. On `session_start`, Dasein:
   - in directory/package install mode, scans `<extension_root>/src/sensors/*.ts`;
   - in single-file packaged install mode, uses the bundled/static sensor registry and does not scan for user-added sensors;
   - validates sensor specs and duplicate keys;
   - builds defaults from sensor specs;
   - reads global disk config from `~/.pi/dasein/config.json`, accepting partial config and recording but ignoring malformed disk config;
   - parses launch args from `pi.getFlag("dasein")`;
   - merges effective config by precedence, filling all missing fields from defaults;
   - reads persisted sensor state from `~/.pi/dasein/state.json` only when the merged effective config has `sensors.lapse.persist === true`;
   - starts enabled sensors;
   - starts initial refreshes unless `initialRefresh === false`;
   - registers TUI status/widget if in TUI mode;
   - subscribes to external events;
   - subscribes to lapse hooks.

### Sensor Refresh

1. Runtime schedules or explicitly requests sensor refresh. Recurring refresh exists only for enabled sensors whose effective config contains a positive integer `intervalMs`; omitted or `null` `intervalMs` means no recurring scheduler. Any recurring scheduler is visible in `/dasein sensors`, `/dasein status`, and SettingsList, configurable through canonical config paths, and disableable by setting `sensors.<key>.enabled=false` or `sensors.<key>.intervalMs=null`. There is no file watcher, hidden polling loop, or undeclared background work.
2. Runtime skips starting a refresh if that sensor already has one active and records one pending follow-up.
3. Refresh receives config, previous normalized `SensorSnapshot`, `now()`, and an `AbortSignal`.
4. Refresh may perform I/O or subprocess work outside the LLM injection path.
5. Runtime wraps refresh with timeout/error handling.
6. Refresh returns either raw candidate `TState` or `SensorRefreshResult<TState>` with metadata and/or `fields`.
7. Runtime converts the return value into `Record<string, SensorStateField>` before commit, using `SensorRefreshResult.fields` when supplied, otherwise using `SensorSpec.normalizeState` or the single declared `SensorSpec.manifest.outputFields` mapping.
8. Runtime constructs `SensorSnapshot` from normalized envelope fields plus aggregate metadata and discards raw candidate data.
9. Runtime commits the snapshot only if the refresh generation is current and not aborted.
10. State store receives only the committed normalized snapshot; it never stores raw sensor-returned state or fields outside the envelope.
11. Renderer recomputes agent and UI strings from the store; it does not call sensor refresh/action/I/O paths, though core may call pure `renderAgent`/`renderUI` hooks for structured `SensorViewFragment` proposals.

Shared timing defaults for omitted sensor fields:

```text
intervalMs: null          # no recurring scheduler unless explicitly declared/effective
timeoutMs: 2000
staleAfterMs: intervalMs * 2 when intervalMs is positive, otherwise 120000
initialRefresh: true      # one-shot startup/reload refresh, not recurring work
```

### LLM Injection

1. Pi fires `before_agent_start` after the user prompt is accepted and before the agent loop starts.
2. Dasein observes the lifecycle event for lapse/continuity, then the injector reads only the pre-rendered in-memory `stateStore.getRenderedContext().agent` string (or the equivalent `getRenderedAgentString()` convenience method).
3. If the string is empty or null, Dasein leaves `event.systemPrompt` unchanged. When `core.agentInjectionEnabled === false`, the renderer/state store has already exposed the string as empty/null.
4. If non-empty, Dasein appends a bounded ambient block to the chained per-turn `systemPrompt` and returns `{ systemPrompt }` from `before_agent_start`.
5. Pi owns provider serialization of the system prompt and maps it to provider-compatible `developer` or `system` roles. Dasein must not append ambient context to `event.messages`, `CustomMessage`, or any other path that Pi `convertToLlm()` serializes as `role:"user"`.

Shape:

```typescript
export interface AmbientSystemPromptInjection {
  changed: boolean;
  systemPrompt: string;
  content?: string;
}
```

The appended block is bracketed for auditability and intentionally names the role boundary:

```text
<DaseinAmbientContext>
Local ambient context for relevance only. Do not mention, quote, label, or summarize this context unless the user explicitly asks about Dasein ambient context.
time=Fri_14:32+08; user_idle=7h
</DaseinAmbientContext>
```

Request-path no-I/O proof:

- `src/core/injector.ts` uses an explicit import allowlist: core ambient system-prompt types, the `DaseinStateStore` interface, and renderer output types only.
- `src/core/injector.ts` must not import or call `fs`, `child_process`, `http`, `https`, `net`, `tls`, `dns`, `fetch`, `XMLHttpRequest`, `WebSocket`, dynamic `import`, native/helper modules, sensor loader modules, sensor runtime modules, sensor refresh/action/cleanup/discovery modules, config readers, or config mutation modules.
- The injector must not trigger sensor refresh, sensor action, sensor cleanup, sensor discovery, config read, config write, durable state read, durable state write, or native/helper import. It reads only the pre-rendered in-memory string/types and appends a system-prompt block or returns no change.
- Static tests enforce both the import allowlist and the forbidden-token denylist.
- A unit test with a fake state store proves injection can run without disk, network, subprocess, dynamic import, sensor refresh, sensor action, sensor cleanup, sensor discovery, config mutation, or native/helper dependencies.

### Human UI Rendering

1. Renderer computes a `RenderedContext` from effective config plus state.
2. In TUI mode, when `core.statusEnabled === true`, Dasein calls `ctx.ui.setStatus("dasein", <short summary>)`. The default summary is intentionally quiet, for example `Dasein · Ready` or `Dasein · Degraded (N)`. It must not include raw sensor field names, epoch/ISO timestamps, agent IDs, manifest digests, or the raw `[ambient_ctx: ...]` injected message.
3. In TUI mode, when `core.statusEnabled === false`, Dasein clears any prior Dasein status by calling `ctx.ui.setStatus("dasein", undefined)`.
4. In TUI mode, when `core.widgetEnabled === true`, Dasein calls `ctx.ui.setWidget("dasein", rendered.widgetLines ?? [])`. The widget remains opt-in and may show richer context than the status footer.
5. In TUI mode, when `core.widgetEnabled === false`, Dasein clears any prior Dasein widget by calling `ctx.ui.setWidget("dasein", undefined)`.
6. Settings UI uses Pi TUI `SettingsList`, but the default `/dasein` surface is common-first: core toggles, primary builtin sensor enablement, location privacy controls, and valid external visibility controls. It must not default to a flat diagnostic list.
7. Full inspectability metadata remains available through `/dasein status`, `/dasein sensors`, and diagnostic/debug artifacts. Metadata includes source/provenance, declared input classes, output fields, permissions, remote/network behavior, declared background work, `effectiveIntervalMs`, destinations, payload classes, transmission cadence, disable control, and manifest digest.
8. Common sensor fields are `enabled`, `ui`, `agent`, `intervalMs`, `timeoutMs`, `staleAfterMs`, and `initialRefresh`; they remain ConfigManager-owned and may appear in diagnostics or future advanced settings.
9. Simple sensor-specific SettingsList fields are only `SensorFieldSpec` entries of type `boolean`, `string`, `number`, or `enum` when included in the selected settings surface.
10. Object, array, and map-like fields, including `geo.tags` and `lapse.agentFields`, are not SettingsList controls; they are managed by sensor commands or a future submenu design.
11. Before enabling risky user-added sensors, Dasein must still expose required read-only inspectability metadata in a diagnostic/advanced path before the enabling action is accepted.
12. For every valid external key matching `[A-Za-z0-9_-]{1,64}` that exists in config or has a live external state snapshot, the default SettingsList exposes both `external.<key>.ui` and `external.<key>.agent` controls.
13. SettingsList must not create controls for invalid external keys, dotted external keys, expired external state, malformed external events, or object/array/map-like sensor fields.
14. UI setting changes enter the same validated FIFO config mutation queue as slash commands and persist only canonical disk paths.
15. Slash command results in TUI mode must provide visible feedback, such as a Pi notification, so `/dasein status` and `/dasein sensors` do not appear to do nothing when invoked from the main input.

### Shutdown

On `session_shutdown`, Dasein uses a bounded cleanup sequence:

1. abort active and pending sensor refreshes first;
2. signal supervised helpers owned by those refreshes to terminate;
3. run all sensor `cleanup` handlers concurrently with a `1000ms` timeout per sensor;
4. aggregate cleanup/helper errors for `/dasein status` or logs, but continue shutdown;
5. terminate remaining helpers in order: graceful terminate, wait `250ms`, then force kill if still alive;
6. flush explicit durable state such as lapse timestamps to `~/.pi/dasein/state.json`;
7. clear status/widget UI last where possible.

A cleanup timeout is reported as a cleanup error. It must not block UI clearing or process exit.

## Command Design

### Core Commands

```text
/dasein
/dasein status
/dasein reload
/dasein sensors
/dasein set <path> <value>
/dasein apply <path=value>[,<path=value>...]
/dasein help
```

`/dasein` opens the TUI settings surface when TUI is available; otherwise it prints help/status.

### Sensor Commands

Sensor-specific commands route as:

```text
/dasein <sensor-key> <action> [...args]
```

Examples:

```text
/dasein geo tag add home 120
/dasein geo tag list
/dasein geo refresh
/dasein lapse reset
```

Core does not implement geo tag semantics. It only routes to the geo sensor action. The reserved words `status`, `reload`, `sensors`, `set`, `apply`, and `help` are always parsed as core commands before sensor-command routing; discovered sensor keys matching those words are invalid load errors, so sensors cannot shadow core commands.

### Command Parser Contract

Grammar:

```text
command              := "/dasein" ws? (core-command | sensor-command)?
core-command         := "status" | "reload" | "sensors" | "help" | set-command | apply-command
set-command          := "set" ws command-path ws value
apply-command        := "apply" ws assignment ("," assignment)*
assignment           := command-path "=" value
sensor-command       := sensor-key ws action (ws arg)*
action               := key
arg                  := quoted-string | bare-string
command-path         := core-path | canonical-sensor-path | short-sensor-path | external-path
core-path            := "core" "." field-path
canonical-sensor-path:= "sensors" "." sensor-key "." field-path
short-sensor-path    := sensor-key "." field-path
external-path        := "external" "." external-key "." ("ui" | "agent")
field-path           := segment ("." segment)*
sensor-key           := key
external-key         := key
key                  := [A-Za-z0-9_-]{1,64}
segment              := [A-Za-z0-9_-]{1,64}
value                := boolean | number | quoted-string | bare-string
boolean              := "on" | "off" | "true" | "false" | "enabled" | "disabled"
number               := "-"? ("0" | [1-9][0-9]*) ("." [0-9]+)?
quoted-string        := '"' quoted-char* '"'
quoted-char          := unescaped-char | escape-sequence
bare-string          := bare-char+
bare-char            := any non-control character except whitespace, comma, equals, quote, or backslash
unescaped-char       := any non-control character except comma, quote, or backslash
escape-sequence      := "\\\\" | "\\\"" | "\\,"
ws                   := one or more ASCII spaces or tabs
```

Leading/trailing whitespace around command tokens, assignments, and comma-separated launch/apply entries is trimmed before grammar matching. Whitespace inside quoted strings is preserved.

Path normalization:

- `geo.agent` normalizes to `sensors.geo.agent` when `geo` is a discovered sensor key.
- Short sensor paths are the only accepted path aliases; there are no aliases for core fields or external paths.
- `external.<key>.agent` and `external.<key>.ui` are the only external config paths.
- Dots separate path segments; dots are never part of a sensor key or external key.
- All command results report canonical normalized paths for successful mutations.
- `/dasein apply` and launch parsing preserve ordered assignment entries before collapse. Duplicate detection runs on normalized canonical paths before mutation, so aliases such as `geo.agent` and `sensors.geo.agent` fail as duplicates even though their input paths differ.

Value and quoting rules:

- `on`, `true`, and `enabled` become boolean `true` for boolean fields.
- `off`, `false`, and `disabled` become boolean `false` for boolean fields.
- Number tokens become numbers only when the target field type is `number`; accepted number syntax is finite decimal only, with optional leading `-`, no leading `+`, no exponent, no `NaN`/`Infinity`, no leading zeros except `0` or `0.x`, and no trailing decimal point.
- Double quotes delimit quoted strings for `/dasein set`, `/dasein apply`, and launch values.
- Inside quoted strings, the only valid backslash escapes are `\\`, `\"`, and `\,`.
- Quoted strings preserve spaces, equals signs, and valid escaped characters after unquoting.
- Commas in string values must be written inside quotes as `\,`; commas in bare strings are parse errors because comma separates `/dasein apply` and `--dasein` entries.
- Equals signs in string values must be quoted; equals signs in bare strings are parse errors because equals separates assignment paths from values.
- Unterminated quotes and invalid escapes are parse errors.
- Bare strings cannot contain whitespace, control characters, comma, equals, quote, or backslash; they remain strings unless the target field schema requires boolean, number, or enum.
- Enum values are matched exactly after unquoting.
- `/dasein apply` uses the same whitespace-trimming, quote-aware, escape-aware comma splitting as `--dasein` launch parsing.
- Sensor action arguments are always parsed as strings from quoted or bare `arg` tokens; core preserves their order and content after unquoting, and sensor action validators interpret them.

Parser result:

```typescript
export interface ParsedAssignment {
  inputPath: string;
  canonicalPath: string;
  value: unknown;
}

export interface ParsedDaseinCommand {
  kind: "open-ui" | "status" | "reload" | "sensors" | "set" | "apply" | "sensor-action" | "help";
  path?: string;
  value?: unknown;
  assignments?: ParsedAssignment[];
  sensorKey?: string;
  action?: string;
  actionArgs?: string[];
}
```

Invalid command errors:

- bad grammar;
- unknown core command;
- unknown sensor key;
- unknown sensor action;
- invalid path;
- invalid value for the target schema;
- unterminated quote;
- invalid escape;
- duplicate canonical path in `/dasein apply` or launch assignment parsing, including duplicates created by aliases such as `geo.agent` and `sensors.geo.agent`.

Invalid commands return `CommandParseError` entries in `DaseinCommandResult.errors` and do not mutate runtime config or disk config.

### Command Result and Output Contract

Every `/dasein` command returns one deterministic result object before formatting text for Pi:

```typescript
export type DaseinCommandName =
  | "open-ui"
  | "status"
  | "reload"
  | "sensors"
  | "set"
  | "apply"
  | "sensor-action"
  | "help";

export interface CommandParseError {
  kind: "command_parse";
  code:
    | "bad-grammar"
    | "unknown-core-command"
    | "unknown-sensor-key"
    | "unknown-sensor-action"
    | "invalid-path"
    | "invalid-value"
    | "unterminated-quote"
    | "invalid-escape"
    | "duplicate-path";
  message: string;
  input?: string;
  path?: string;
}

export interface DurableStateError {
  kind: "durable_state";
  code: "load-failed" | "write-failed" | "schema-invalid";
  message: string;
  path: string;
}

export type PiMechanismEvidenceStatus =
  | "SOURCE_VERIFIED"
  | "API_VERIFIED"
  | "LIVE_SMOKE_PENDING"
  | "LIVE_SMOKE_VERIFIED";

export interface PiMechanismError {
  kind: "pi_mechanism";
  mechanism: string;
  evidenceStatuses: PiMechanismEvidenceStatus[];
  message: string;
}

export type DaseinStatusError =
  | ConfigValidationError
  | SensorLoadError
  | SensorError
  | DurableStateError
  | PiMechanismError;

export type DaseinCommandError = CommandParseError | DaseinStatusError;

export type DaseinCommandResult =
  | {
      ok: true;
      command: DaseinCommandName;
      message: string;
      data?: unknown;
      updatedPaths?: string[];
      deletedPaths?: string[];
      errors?: [];
    }
  | {
      ok: false;
      command: DaseinCommandName;
      message: string;
      errors: DaseinCommandError[];
      data?: unknown;
    };
```

Formatting rules:

- `message` is a single-line human summary suitable for Pi command output.
- `data` is the machine-readable payload used by tests and future UI surfaces.
- Failed commands must set `ok: false`, must include at least one structured error, and must not mutate runtime config or disk config.
- Parse failures use `CommandParseError` and never reach config mutation or sensor action execution.
- Successful config mutations must list normalized canonical `updatedPaths` and `deletedPaths` in lexicographic order; either list may be empty, but a successful mutation must have at least one updated or deleted path.

Per-command payloads:

```typescript
export type ForcedDisabledReason =
  | "user-added-remote-or-network"
  | "user-added-recurring-work"
  | "user-added-remote-or-network-and-recurring-work";

export interface SensorInspectableMetadata {
  key: SensorKey;
  provenance: SensorRegistryProvenance;
  manifest: SensorManifest;
  backgroundWork: SensorBackgroundWorkDeclaration;
  effectiveIntervalMs: number | null;
  manifestDigest: string;
  acknowledgedManifestDigest?: string | null;
  acknowledgementRequired: boolean;
  acknowledgementSatisfied: boolean;
  defaultEnabled: boolean;
  effectiveEnabled: boolean;
  forcedDisabledReason?: ForcedDisabledReason;
}

export interface StatusContributorData {
  key: string;
  kind: "sensor" | "external";
  enabled: boolean;
  uiVisible: boolean;
  agentVisible: boolean;
  hiddenReason?: "disabled" | "ui-hidden" | "agent-hidden" | "expired" | "truncated";
  sensorMetadata?: SensorInspectableMetadata;
}

export interface StatusPermissionData {
  key: SensorKey;
  permission: "authorized" | "denied" | "restricted" | "not_determined" | "unknown" | "not_applicable";
  freshness: "fresh" | "stale" | "missing";
  health: "ok" | "degraded" | "error" | "disabled";
  checkedAt: number | null;
  error?: SensorError;
}

export interface StatusCommandData {
  piVersion: string | null;
  minimumPiVersion: "0.78.1";
  piMechanisms: Array<{
    mechanism: string;
    evidenceStatuses: PiMechanismEvidenceStatus[];
    observedBehavior: string;
    verificationDate: string | null;
  }>;
  configPath: string;
  statePath: string;
  effectiveConfigVersion: 1;
  activeSensors: SensorKey[];
  disabledSensors: SensorKey[];
  hiddenContributors: StatusContributorData[];
  rendered: Pick<RenderedContext, "omittedKeys" | "truncated">;
  permissions: StatusPermissionData[];
  sensorMetadata: SensorInspectableMetadata[];
  loadErrors: SensorLoadError[];
  statusErrors: DaseinStatusError[];
  launchArgsApplied: boolean;
  diskConfigLoaded: boolean;
  durableState: {
    statePath: string;
    stateFileLoaded: boolean;
    lapse: LapsePersistedState | null;
    loadError?: DurableStateError;
  };
}

export interface ReloadCommandData {
  reload: DaseinReloadResult;
  configPath: string;
  launchReappliedPaths: string[];
  runtimeOverriddenPaths: string[];
}

export interface SensorListRecord {
  key: SensorKey;
  loaded: boolean;
  enabled: boolean;
  status: SensorStatus;
  collectedAt: number | null;
  stale: boolean;
  actions: string[];
  provenance?: SensorRegistryProvenance;
  manifest?: SensorManifest;
  backgroundWork?: SensorBackgroundWorkDeclaration;
  effectiveIntervalMs: number | null;
  manifestDigest?: string;
  acknowledgedManifestDigest?: string | null;
  acknowledgementRequired?: boolean;
  acknowledgementSatisfied?: boolean;
  forcedDisabledReason?: ForcedDisabledReason;
  loadError?: SensorLoadError;
  healthError?: SensorError;
}

export interface SensorsCommandData {
  sensors: SensorListRecord[];
  loadErrors: SensorLoadError[];
}

export interface SetCommandData {
  inputPath: string;
  canonicalPath: string;
  value: unknown;
  persistedPath: string;
}

export interface ApplyCommandData {
  assignments: Array<{
    inputPath: string;
    canonicalPath: string;
    value: unknown;
  }>;
  persistedPath: string;
}

export interface SensorActionCommandData {
  sensorKey: SensorKey;
  action: string;
  actionArgs: string[];
  refreshScheduled: boolean;
  mutation?: ConfigMutationResult;
  actionPayload?: unknown;
}
```

For successful sensor actions, core copies `SensorActionResult.data` to `SensorActionCommandData.actionPayload` without interpreting it; sensor-specific specs own that payload shape.

`/dasein reload` command binding:

- On full success, the command returns `{ ok: true, command: "reload", data: ReloadCommandData }` and `data.reload.ok === true`.
- On config, sensor scan/import/spec, merge, or renderer validation failure, the command returns `{ ok: false, command: "reload", data: ReloadCommandData }` and leaves the old registry/config/runtime/rendered context active.
- Reload command errors use `DaseinCommandError` objects and include the structured underlying `ConfigValidationError`, `SensorLoadError`, or `SensorError` values.
- The command result must expose `launchReappliedPaths` and `runtimeOverriddenPaths` so tests can prove launch overlays reapply after reload except for runtime-overridden paths.

Deterministic command messages:

- `/dasein status` success message starts with `dasein status: ok` when `statusErrors` is empty, otherwise `dasein status: degraded`.
- `/dasein status` output must include rendered `omittedKeys`, `truncated`, disabled/hidden contributors, sensor inspectability metadata, declared background work, effective interval values, permission state, freshness, health, load errors, effective lapse collection/persistence/injection controls, and persisted lapse-state health.
- `/dasein reload` success message is `dasein reload: ok (<n> sensors)` where `<n>` is the count of active sensors after commit.
- `/dasein reload` failure message is `dasein reload: failed; kept previous state`.
- `/dasein sensors` lists loaded and load-failed sensor records by key/file lexicographically, one line per record in the form `<key-or-file> <loaded|load-failed> <enabled|disabled> <status>`, warns that user-added local `.ts` sensors are trusted executable code at import time and are not sandboxed, and exposes each loaded sensor's provenance, declared input classes, output fields, permissions, remote/network behavior, declared background work, `effectiveIntervalMs`, `manifestDigest`, and acknowledgement status before enablement, including destinations, payload classes, transmission cadence, and disable control.
- `/dasein set` success message is `updated <canonicalPath>`.
- `/dasein apply` success message is `updated <n> paths`.
- Sensor action success messages are owned by the sensor but must be single-line and deterministic for the same action result. Sensor action failures use `ok: false` and must not mutate outside the calling sensor namespace.

## Configuration Files

Global root:

```text
~/.pi/dasein/
```

Files:

```text
~/.pi/dasein/config.json
~/.pi/dasein/state.json
```

Example partial persisted disk config schema:

```json
{
  "version": 1,
  "core": {
    "maxAgentChars": 240,
    "renderOrder": ["clock", "lapse", "geo"]
  },
  "sensors": {
    "geo": {
      "enabled": false,
      "agent": false,
      "tags": {
        "home": {
          "lat": 31.2304,
          "lon": 121.4737,
          "radius_m": 100,
          "label": "home"
        }
      }
    },
    "lapse": {
      "agentFields": ["user_idle"]
    }
  },
  "external": {
    "weather": {
      "ui": true,
      "agent": false
    }
  }
}
```

Disk config decisions:

- A non-empty `config.json` must include top-level `version: 1`.
- Fields may be partial. Missing `core`, `sensors`, `external`, sensor keys, external keys, and individual fields are filled from defaults and later overlays.
- Runtime mutations patch the persisted disk config at normalized canonical paths only, such as `core.maxAgentChars`, `sensors.geo.agent`, `sensors.geo.tags.home`, `external.weather.ui`, or `external.weather.agent`.
- Config mutation delete semantics are path-local: a validated delete tombstone such as `sensors.geo.tags.home` removes only that property from the persisted partial config and active effective config; empty parent objects may remain or be pruned, but no tombstone value is persisted.
- Runtime mutations must not serialize the full effective config.
- Runtime mutations must not persist unrelated values that came only from launch flags, defaults, or in-memory runtime derivation.
- The full effective config exists only in memory after applying `defaults < disk < launch < runtime`.

Durable state file schema:

```json
{
  "version": 1,
  "lapse": {
    "previous_human_input_at": null,
    "previous_agent_end_at": null
  }
}
```

`state.json` decisions:

- Top-level `version` is required and must be `1`.
- `lapse` is required when the state file exists and is the only durable sensor state in the initial scope.
- Lapse persistence is controlled separately by `sensors.lapse.persist`; when false, startup ignores persisted lapse timestamps for active continuity and observations do not enqueue durable timestamp writes.
- Unknown top-level state keys are ignored on read and dropped on the next successful write.
- Geo durable cache is out of initial scope. Geo tags are config, not state; they live under `sensors.geo.tags` using the canonical stored shape `{ "lat", "lon", "radius_m", "label"? }` under the tag key.
- External state is not stored in `state.json`; publishers must republish after restart.
- Both `config.json` and `state.json` use atomic temp-file-and-rename writes. Failed writes leave the previous file unchanged.
- `state.json` never stores lapse history: it stores only the two latest overwritten continuity timestamp fields shown above.

Malformed disk config behavior is deterministic:

- At startup, malformed disk config is ignored; Dasein starts with defaults plus valid launch args and records a status error.
- During `/dasein reload`, malformed disk config keeps the last-known-good active config/runtime/rendered context, launch overlay state, and runtime-overridden paths, then records a status error.
- Malformed disk config never partially applies.

## Sensor Loading and Reload

### Startup Scan

Dasein has two install modes:

| Install mode | Sensor registry behavior |
|---|---|
| Directory/package install | Scan `<extension_root>/src/sensors/*.ts` on startup and manual `/dasein reload`; builtin sensors and user-added local sensor files are both supported. |
| Single-file packaged install | Use bundled/static sensor registry only; dynamic `src/sensors/*.ts` discovery is disabled, and user-added sensors are unsupported unless the user switches to unpacked directory form. Builtin geo may use a packaged helper only if the package exposes a materialized helper file path at startup; otherwise geo fails closed with `SensorError.kind: "helper-unavailable"` and does not spawn a helper. |

For directory/package installs, Dasein scans:

```text
<extension_root>/src/sensors/*.ts
```

for sensor specs.

The prior shorthand `sensors/*.ts` is not normative. The canonical directory is always `src/sensors/*.ts` under the resolved extension root. Loader output is a registry of `SensorRegistryEntry` values with explicit provenance: `{ kind: "builtin" }` for builtin specs and `{ kind: "user_added_local_file", filePath }` for local files.

User-added directory/package `.ts` sensors are trusted local executable code at import time. Dasein does not sandbox top-level side effects during module import. Manifest disclosure, acknowledgement, default-off controls, refresh/action/background scheduling controls, and network controls govern post-load runtime behavior only; they are not a defense against malicious import-time code.

### Sensor Export Validation

Each sensor module must default-export one valid `SensorSpec`.

Rules:

- The default export must be the sensor spec object.
- A module with no default export is invalid.
- A named export is ignored for admission and is not an alternative contract.
- `spec.key` must match `[A-Za-z0-9_-]{1,64}`.
- `spec.manifest` is required and must declare input classes, output fields, permissions, remote/network behavior, and background work.
- `spec.defaults` must include `enabled`, `ui`, and `agent`; invalid defaults, missing required visibility/control defaults, or unknown enum defaults invalidate the entire candidate registry.
- Duplicate `spec.key` across scanned modules invalidates the entire candidate registry.
- `spec.key` matching a reserved core command word (`status`, `reload`, `sensors`, `set`, `apply`, or `help`) invalidates the entire candidate registry and is reported as a load error.
- Invalid field specs or invalid manifest entries invalidate the entire candidate registry.
- Invalid candidate registries never replace the active registry.
- First-party/builtin sensor modules must have no top-level side effects beyond defining constants/types and the default `SensorSpec`; static lint/tests enforce no top-level filesystem, subprocess, network, timer, native helper, config, or refresh/action execution in builtin sensors.
- Load failures are retained as `SensorLoadError` records so `/dasein sensors` and `/dasein status` can report load-failed local files even when the active registry stays on the old known-good set.

### Manual Reload

`/dasein reload` returns one combined result that reports both disk-config reload and sensor-registry reload status. The slash command wraps this object in `DaseinCommandResult` with `command: "reload"`.

```typescript
export type DaseinReloadResult =
  | {
      ok: true;
      config: ConfigReloadSuccessMetadata;
      sensors: SensorReloadSuccessMetadata;
      launchReappliedPaths: string[];
      runtimeOverriddenPaths: string[];
      warnings: string[];
    }
  | {
      ok: false;
      failureScope: "config" | "sensors" | "config-and-sensors";
      config: ConfigReloadFailureMetadata | ConfigReloadSuccessMetadata;
      sensors?: SensorReloadFailureMetadata | SensorReloadSuccessMetadata;
      errors: Array<ConfigValidationError | SensorLoadError>;
      activeKeys: SensorKey[];
      launchReappliedPaths: string[];
      runtimeOverriddenPaths: string[];
    };

export interface ConfigReloadSuccessMetadata {
  ok: true;
  loadedPath: string;
  updatedPaths: string[];
}

export interface ConfigReloadFailureMetadata {
  ok: false;
  loadedPath?: string;
  errors: ConfigValidationError[];
}

export interface SensorReloadSuccessMetadata {
  ok: true;
  loadedKeys: SensorKey[];
  unloadedKeys: SensorKey[];
  activeKeys: SensorKey[];
}

export interface SensorReloadFailureMetadata {
  ok: false;
  attemptedFiles: string[];
  activeKeys: SensorKey[];
  errors: SensorLoadError[];
}

export interface SensorLoadError {
  file: string;
  key?: SensorKey;
  kind: "scan" | "import" | "duplicate-key" | "reserved-key" | "invalid-spec" | "config" | "renderer";
  message: string;
}
```

Failure shape rules:

- Config-only failure uses `failureScope: "config"`; `sensors` is optional and must not be required when sensor reload was not attempted or did not fail.
- Sensor-only failure uses `failureScope: "sensors"`, `config.ok === true`, and `sensors.ok === false`.
- Combined failure uses `failureScope: "config-and-sensors"`, `config.ok === false`, and `sensors.ok === false` when sensor failure metadata exists.

Reload behavior:

1. in directory/package install mode, resolve `<extension_root>/src/sensors/*.ts`; in single-file packaged install mode, select the bundled/static sensor registry and skip dynamic file discovery;
2. in directory/package install mode, import candidate sensor files with cache busting; in single-file packaged install mode, do not import user-added sensor files;
3. validate exports and duplicate keys;
4. rebuild defaults;
5. reload global disk config, accepting partial config but rejecting malformed config;
6. merge candidate effective config by filling missing fields from defaults, applying valid disk config, reapplying the valid launch overlay except for `runtimeOverriddenPaths`, and then applying runtime changes last; this reload runs inside the single FIFO config mutation queue;
7. validate renderer inputs;
8. if any previous step fails, keep old registry, last-known-good active config, runtime, launch overlay state, `runtimeOverriddenPaths`, and rendered context active and report errors;
9. if all candidate steps pass, commit using Decision 6 sequence and return `ok: true`.

Command-result binding:

- Success returns `DaseinCommandResult` with `ok: true`, `command: "reload"`, message `dasein reload: ok (<n> sensors)`, and `data.reload` equal to the `DaseinReloadResult`.
- Failure returns `DaseinCommandResult` with `ok: false`, `command: "reload"`, message `dasein reload: failed; kept previous state`, structured errors, and `data.reload` equal to the failed `DaseinReloadResult`.
- `<n>` is `data.reload.sensors.activeKeys.length` after a successful commit.

### Dynamic Import

Dynamic `.ts` import is allowed only in directory/package install mode and only during startup scan or manual `/dasein reload`, never in the LLM request path.

In the current Pi Node installation, Pi's extension loader uses `jiti` and dynamic `.ts` imports work from an already-loaded extension. Live Pi smoke now confirms directory/package install discovery of user-added `.ts` sensors and manual `/dasein reload` cache-busting of changed sensor modules; the release evidence is generated by `npm run test:smoke` under `.dasein/dynamic-reload-smoke/latest/`.

Changed sensor files are imported through a cache-busted temporary copy plus query token, not by assuming Node will reload the original path:

```text
<sensor-dir>/.dasein-reload-<sensor-basename>-<sha256>-<batch-token>.ts?reload=<timestamp>
```

The hidden cache file is removed after import. The live proof records this as `cacheBustStrategy` in `.dasein/dynamic-reload-smoke/latest/dynamic-reload-proof.json`.

Single-file packaged installs do not use dynamic import for user-added sensors. They run the bundled/static sensor registry only.

Core code changes still require Pi global `/reload`.

## Error Model

### Sensor Errors

Sensor failures must not crash Pi.

Represent sensor availability through the Constitution status set only:

```typescript
SensorSnapshot.status = "enabled" | "disabled" | "stale" | "error"
```

Rules:

- Fresh successful data uses `status: "enabled"`.
- Disabled sensors use `status: "disabled"` and are not refreshed.
- Staleness uses `status: "stale"` only as a derived read/render status.
- Timeout, unavailable hardware, permission denied, permission restricted, helper process failure, parse failure, and config failure use `status: "error"` plus `SensorError.kind`.
- There is no `SensorStatus` value named `ok` or `unavailable`.

### External State Errors

Malformed external events must be rejected and surfaced in `/dasein status` only when useful.

External strings must be:

- single-line;
- length-bounded to `120` characters;
- free of control characters and line separators;
- rejected, not normalized, when malformed;
- expired by TTL;
- independently gated by Dasein config.

### Config Errors

Malformed disk config must not replace active config.

Invalid slash command updates fail before mutating runtime config or disk config.

`/dasein apply` is atomic.

### Native Helper Errors

The macOS location helper must be supervised with fixed constants:

```text
timeout: 3000ms
max stdout: 16KiB
max stderr: 16KiB
kill grace: 250ms
retry backoff: 1m -> 5m -> 15m max
stale after: 30m
```

Permission-denied, process, timeout, and parse failures become typed geo sensor states and must not crash Pi.

Native backoff rules:

- Backoff increments only on helper timeout, helper process failure, or permission error.
- Backoff resets after a successful geo refresh that produces a valid location state.
- Manual refresh bypasses the backoff delay but still obeys the `3000ms` helper timeout and normal process limits.
- During backoff, geo state remains the last stale/error snapshot; no helper process is spawned until the next eligible time unless the user manually refreshes.
- Parse errors are recorded as typed errors; they do not grant fresh location state.

## Builtin Sensors

Builtin sensors follow the same `SensorSpec` contract as extension sensors. They do not get private framework privileges except for the geo sensor's supervised native helper.

Builtin inspectability manifests are deterministic:

| Sensor | Declared input classes | Output fields | Permissions | Remote/network behavior | Background work |
|---|---|---|---|---|---|
| `clock` | `time` | `clock.local_time` and supporting time fields | `none` | `capable:false`, `contactsNetworkByDefault:false`, `destinations:[]`, `payloadClasses:[]`, `transmissionCadence:"none"`, `disableControl:"none"`, `description:"none"` | `capable:true`, `kinds:["initial_refresh","recurring_interval"]`, `defaultIntervalMs:60000`, `intervalRelationship:"default_interval_sets_effective_interval_unless_overridden"`, `description:"local clock refresh"` |
| `geo` | `native_location`, `subprocess` | `geo.lat`, `geo.lon`, `geo.permission`, `geo.nearestTag`, placemark fields | required `macos_location`; `subprocess` for supervised Swift helper | `capable:false`, `contactsNetworkByDefault:false`, `destinations:[]`, `payloadClasses:[]`, `transmissionCadence:"none"`, `disableControl:"none"`, `description:"none"` | `capable:true`, `kinds:["initial_refresh","recurring_interval"]`, `defaultIntervalMs:60000`, `intervalRelationship:"default_interval_sets_effective_interval_unless_overridden"`, `description:"local geo refresh"` |
| `lapse` | `pi_lifecycle`, `derived` | `lapse.user_idle`, `lapse.agent_idle`, latest continuity timestamps | `none` | `capable:false`, `contactsNetworkByDefault:false`, `destinations:[]`, `payloadClasses:[]`, `transmissionCadence:"none"`, `disableControl:"none"`, `description:"none"` | `capable:true`, `kinds:["initial_refresh","recurring_interval","pi_lifecycle_observe"]`, `defaultIntervalMs:60000`, `intervalRelationship:"default_interval_sets_effective_interval_unless_overridden"`, `description:"local lapse refresh and Pi lifecycle observation"` |

### Clock

Responsibilities:

- format local time;
- obey precision config;
- publish typed snapshot;
- render compact agent and UI strings.

Non-responsibilities:

- timezone policy;
- natural language advice;
- agent behavior shaping.

Contract:

```typescript
export type ClockPrecision = "exact" | "minute" | "hour" | "period" | "date";

export interface ClockConfig extends SensorConfig {
  precision: ClockPrecision;
}

export interface ClockState {
  epochMs: number;
  iso: string;
  local: string;
  utcOffsetMinutes: number;
}
```

Defaults and enums:

```json
{
  "enabled": true,
  "ui": true,
  "agent": true,
  "intervalMs": 60000,
  "timeoutMs": 2000,
  "precision": "minute"
}
```

Allowed `precision` values: `exact`, `minute`, `hour`, `period`, `date`.

`exact` means seconds-level local time. Lower precision values intentionally omit smaller units.

Field specs:

```typescript
export const clockFields: Record<string, SensorFieldSpec> = {
  precision: {
    label: "Time precision",
    type: "enum",
    values: ["exact", "minute", "hour", "period", "date"],
  },
};
```

Actions: none for initial implementation.

Sample render outputs:

```text
agent: time=Fri_14:32+08
status/widget: time Fri 14:32 +08
```

### Geo

Responsibilities:

- call supervised macOS CoreLocation helper outside request path;
- maintain latest location snapshot;
- support precision levels;
- support geofence tags;
- expose tag actions under `/dasein geo ...`.

Non-responsibilities:

- cloud/IP geolocation;
- route tracking;
- maps UI;
- continuous real-time navigation.

Contract:

```typescript
export type GeoPrecision = "city" | "district" | "street" | "exact";

export interface GeoTag {
  lat: number;
  lon: number;
  radius_m: number;
  label?: string;
}

export interface GeoConfig extends SensorConfig {
  precision: GeoPrecision;
  tags: Record<string, GeoTag>;
  exactAddress: boolean;
  exactCoordinates: boolean;
}

export interface GeoPlacemark {
  city?: string;
  district?: string;
  street?: string;
  name?: string;
  formattedAddress?: string;
  country?: string;
  administrativeArea?: string;
  subAdministrativeArea?: string;
  postalCode?: string;
}

export interface GeoState {
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  permission: "authorized" | "denied" | "restricted" | "not_determined" | "unknown";
  timestamp: number | null;
  placemark: GeoPlacemark | null;
  nearestTag: string | null;
  helperBackoffUntil: number | null;
}
```

Defaults and enums:

```json
{
  "enabled": false,
  "ui": true,
  "agent": false,
  "intervalMs": 60000,
  "timeoutMs": 3000,
  "staleAfterMs": 1800000,
  "precision": "city",
  "tags": {},
  "exactAddress": false,
  "exactCoordinates": false
}
```

Allowed `precision` values: `city`, `district`, `street`, `exact`.

`geo.tags` is not a precision value. Tags annotate any precision when the latest coordinates fall within a configured tag radius. Exact coordinate output requires `sensors.geo.agent === true`, `sensors.geo.precision === "exact"`, `sensors.geo.exactCoordinates === true`, and fresh coordinates. Exact address text requires `sensors.geo.agent === true`, `sensors.geo.precision === "exact"`, `sensors.geo.exactAddress === true`, and helper address/placemark fields.

Canonical geo tag storage:

```json
{
  "sensors": {
    "geo": {
      "tags": {
        "home": {
          "lat": 31.2304,
          "lon": 121.4737,
          "radius_m": 100,
          "label": "home"
        }
      }
    }
  }
}
```

The tag key is the stable tag name. The stored tag object is `{ lat, lon, radius_m, label? }`; legacy long-form coordinate keys and alternate radius keys are invalid. `label` is optional display text and defaults to the tag key when omitted.

Field specs:

```typescript
export const geoFields: Record<string, SensorFieldSpec> = {
  precision: {
    label: "Location precision",
    type: "enum",
    values: ["city", "district", "street", "exact"],
  },
  tags: {
    label: "Location tags",
    type: "object",
    additionalProperties: true,
    actionManaged: true,
    description: "Managed by /dasein geo tag actions and validated by the geo validator.",
  },
  exactAddress: { label: "Include exact address", type: "boolean" },
  exactCoordinates: { label: "Include exact coordinates", type: "boolean" },
};
```

Action grammar:

```text
/dasein geo refresh
/dasein geo tag list
/dasein geo tag add <name> <radius_m>
/dasein geo tag remove <name>
```

Geo tag list payload:

```typescript
export interface GeoTagListPayload {
  exactCoordinates: boolean;
  tags: Array<{
    name: string;
    radius_m: number;
    label: string | null;
    coordinates: { visible: true; lat: number; lon: number } | { visible: false; redacted: true };
  }>;
}
```

Action constraints:

- `name` must match `[A-Za-z0-9_-]{1,64}`.
- `radius_m` must be an integer from `1` to `100000`.
- `tag list` reads only the current effective config at `sensors.geo.tags`; it never requests geo refresh, calls `refreshNow`, schedules refresh, spawns the native helper, reads sensor state, or reads durable state. It sorts tags lexicographically by tag name. Its `actionPayload` is `GeoTagListPayload`. Coordinates are visible only when `sensors.geo.agent === true`, `sensors.geo.precision === "exact"`, and `sensors.geo.exactCoordinates === true`; otherwise `coordinates` is `{ visible: false, redacted: true }` and no lat/lon numbers appear in command text or payload.
- `tag add` first uses the current fresh geo snapshot when available; otherwise it awaits `context.refreshNow({ bypassBackoff: true, reason: "geo_tag_add" })`. The action succeeds only when the resulting normalized `SensorSnapshot` is fresh and contains valid coordinates, then captures the anchor as `{ lat, lon }` from that snapshot and stores `{ lat, lon, radius_m, label? }` under `sensors.geo.tags[name]`.
- `tag add` fails deterministically if `refreshNow` returns a structured error, times out, or yields no fresh valid coordinate; it must not create a tag from a stale, errored, or permission-denied fix.
- `tag remove` requires an existing `sensors.geo.tags.<name>` entry. If the tag is absent, it returns `ok: false` with a deterministic `tag not found` message and does not mutate config.
- For an existing tag, `tag remove` returns `ConfigMutationProposal.deletePaths = ["sensors.geo.tags.<name>"]`. Core treats that path as a transaction-local tombstone, deletes the property from `config.json`, removes it from the active effective config after persistence succeeds, and never writes a persisted tombstone marker.
- After deletion, geofence rendering immediately stops considering that tag. Historical location snapshots are not rewritten; they are rendered against the current effective tag config.
- `refresh` requests a manual refresh and may bypass backoff delay, but not timeout or helper limits.

Native helper contract:

```text
directory/package helper path: <extension_root>/src/native/macos-location-helper.swift
single-file packaged helper path: materialized packaged helper path, if the package exposes one
spawn shape: swift <helper path> --once
```

Directory/package installs use the source helper path under the extension root. Single-file packaged installs do not assume `<extension_root>/src/native/...` exists; they either expose a materialized packaged helper file path during startup or geo native collection fails closed with `SensorError.kind: "helper-unavailable"` and no helper spawn. This failure does not disable Dasein core, clock, lapse, external state, or non-geo UI.

The macOS helper source is CoreLocation for coordinates/accuracy/permission/timestamp and best-effort `CLGeocoder` reverse geocoding for placemark fields. Reverse geocoding is optional helper output: lack of placemark data must not turn a valid coordinate fix into an error. The native gate typechecks the Swift helper and verifies runtime policy; it does not prove that the current developer machine can obtain live coordinates, because macOS TCC/CoreLocation permission can block collection. Documentation and release notes must therefore claim fail-closed permission handling and helper policy, not successful coordinate availability, unless a separate permission-granted live geo artifact exists.

Helper stdout JSON:

```typescript
export type MacOSLocationHelperOutput =
  | {
      ok: true;
      lat: number;
      lon: number;
      accuracy_m: number | null;
      permission: "authorized";
      timestamp: number;
      placemark?: GeoPlacemark;
    }
  | {
      ok: false;
      error: "permission_denied" | "permission_restricted" | "timeout" | "unavailable" | "unknown";
      message: string;
      permission?: "denied" | "restricted" | "not_determined" | "unknown";
      timestamp?: number;
    };
```

Permission and fallback mapping:

- CoreLocation authorized states become `status: "enabled"` when coordinates parse.
- denied/restricted become `status: "error"` with `SensorError.kind: "permission"`.
- not-determined without a coordinate becomes `status: "error"` with `SensorError.kind: "permission"`.
- helper `unavailable` errors become `status: "error"` with `SensorError.kind: "unavailable"`.
- missing materialized helper paths in single-file packaged installs become `status: "error"` with `SensorError.kind: "helper-unavailable"` and no helper spawn.
- timeout becomes `status: "error"` with `SensorError.kind: "timeout"`.
- malformed stdout becomes `status: "error"` with `SensorError.kind: "parse"`.
- If coordinates are unavailable, stale, or permission-blocked, render output degrades to `loc=unavailable(<reason>)` or `loc=stale(<age>)`.
- If placemark fields are unavailable, `city`, `district`, and `street` precision degrade to the nearest available placemark field in that order; if no usable placemark field exists, they render `loc=unavailable(placemark)` instead of inventing a name.
- Agent output may render exact coordinates only when `sensors.geo.agent === true`, `sensors.geo.precision === "exact"`, `sensors.geo.exactCoordinates === true`, and fresh coordinates exist.
- Agent output may render exact address text only when `sensors.geo.agent === true`, `sensors.geo.precision === "exact"`, `sensors.geo.exactAddress === true`, and helper placemark/address fields exist.
- `exact` must never fabricate an address, street, district, city, or coordinate from missing helper fields.

Cleanup guarantees:

- The runtime kills the helper if it exceeds `3000ms`.
- On timeout, send terminate, wait `250ms`, then force kill if still alive.
- stdout and stderr collection stops at `16KiB` each.
- Shutdown aborts active geo refresh before cleanup.
- Cleanup then terminates supervised helpers in graceful-then-force order.
- No orphan helper process is allowed after shutdown.

Geo tag rule: render the nearest matching tag within radius only; ties are resolved by lexicographic tag name. A tag annotates the selected precision output instead of replacing the precision. This keeps UI and agent output compact.

Sample render outputs:

```text
agent precision=city: loc=Shanghai/home
agent precision=district: loc=Jing'an/home
agent precision=street: loc=Nanjing_W_Rd/home
agent precision=exact: loc=31.2304,121.4737±80m/home
status/widget unavailable: loc=unavailable(permission)
status/widget stale: loc=stale(31m)
```

### Lapse / Continuity

Responsibilities:

- implement the optional `SensorSpec.observe` hook for Pi lifecycle observations;
- observe human input through `input` or fallback `before_agent_start`;
- observe agent completion through `agent_end`;
- track previous human input timestamp;
- track previous agent completion timestamp;
- derive `user_idle` and `agent_idle` at the correct sampling points;
- persist continuity timestamps in `~/.pi/dasein/state.json`.

Contract:

```typescript
export type LapseAgentField = "user_idle" | "agent_idle";

export interface LapseConfig extends SensorConfig {
  persist: boolean;
  agentFields: LapseAgentField[];
}

export interface LapseState {
  userIdleMs: number | null;
  agentIdleMs: number | null;
  previousHumanInputAt: number | null;
  previousAgentEndAt: number | null;
}

export interface LapsePersistedState {
  previous_human_input_at: number | null;
  previous_agent_end_at: number | null;
}
```

Defaults and enums:

```json
{
  "enabled": true,
  "ui": true,
  "agent": true,
  "intervalMs": 60000,
  "timeoutMs": 2000,
  "persist": true,
  "agentFields": ["user_idle"]
}
```

Allowed `agentFields` values: `user_idle`, `agent_idle`.

Field specs:

```typescript
export const lapseFields: Record<string, SensorFieldSpec> = {
  persist: { label: "Persist lapse continuity", type: "boolean" },
  agentFields: {
    label: "Agent-visible lapse fields",
    type: "array",
    item: {
      label: "Lapse field",
      type: "enum",
      values: ["user_idle", "agent_idle"],
    },
  },
};
```

Action grammar:

```text
/dasein lapse reset
```

Action constraints:

- `reset` clears in-memory lapse state and persisted lapse timestamps.
- `reset` does not change config; it does not toggle `lapse.enabled`, `lapse.persist`, or `lapse.agent`.

Sampling semantics:

- Collection, persistence, and injection are separate controls: `sensors.lapse.enabled` controls whether lifecycle observations are collected, `sensors.lapse.persist` controls whether the latest two timestamps are read/written to `state.json`, and `sensors.lapse.agent` controls whether allowed lapse fields enter the agent string.
- Core routes Pi `input`, fallback `before_agent_start`, and `agent_end` events to lapse through `SensorSpec.observe`; lapse does not use request-path I/O for these observations.
- On a new human input at time `t`, compute `user_idle = t - previous_human_input_at` when a previous human timestamp exists.
- On the same new human input, compute `agent_idle = t - previous_agent_end_at` when a previous agent-end timestamp exists.
- A previous-run duration may be derived for human UI at the next human input only, before updating `previous_human_input_at`, and only when both previous timestamps exist and `previous_agent_end_at >= previous_human_input_at`.
- Previous-run duration is not part of `LapseAgentField`, is not stored as a separate lapse state field, and is not agent-facing unless a future PRD explicitly adds it.
- After sampling human input, store `previous_human_input_at = t` in memory. When `lapse.persist === true`, enqueue or coalesce an asynchronous durable write of the latest in-memory lapse timestamps after request construction/event handling returns.
- On `agent_end` at time `t`, store `previous_agent_end_at = t` in memory. When `lapse.persist === true`, enqueue or coalesce an asynchronous durable write of the latest in-memory lapse timestamps after request construction/event handling returns.
- Durable write failure surfaces a `DurableStateError` in status and leaves the previous `state.json` unchanged; it does not change the already constructed request or block future request construction.
- If both `input` and `before_agent_start` fire for the same user turn, lapse records the turn once.

Definitions at a human input sample:

```text
user_idle = now - previous_human_input_at
agent_idle = now - previous_agent_end_at
ui previous-run duration = previous_agent_end_at - previous_human_input_at
```

Sample render outputs:

```text
agent: user_idle=7h
agent: user_idle=7h; agent_idle=2m
status/widget: idle user 7h, agent 2m
```

Non-responsibilities:

- conversation memory;
- semantic recall;
- emotional policy.

## Implementation Scaffold

Package/tooling choices are part of the initial implementation contract:

- Package manager: `npm`.
- Module format: TypeScript ESM with package `"type": "module"` and `tsconfig.json` set for Node ESM output.
- Required npm scripts:
  - `npm run typecheck`: runs `tsc --noEmit`.
  - `npm test`: runs the ordinary all-platform Node test runner against the full non-native, non-smoke TypeScript suite; it must skip live Pi TUI smoke tests.
  - `npm run test:file -- <files>`: runs the Node TypeScript test runner for explicit file-scoped checks, using a checked-in loader strategy such as `node --import tsx --test`.
  - `npm run test:native`: runs native/macOS tests and must skip with an explicit reason on non-macOS.
  - `npm run test:smoke`: runs release smoke tests that require a live Pi TUI, including SettingsList rendering and interaction.
- Runtime npm dependency contract: `package.json.dependencies` must be absent or `{}` for initial scope. Pi-owned runtime imports required by documented Pi APIs must be declared in `package.json.peerDependencies` with `"*"` and must not be bundled; for the current SettingsList/getSettingsListTheme surface this means `@earendil-works/pi-tui` and, when documented runtime imports require it, `@earendil-works/pi-coding-agent`. Any non-Pi runtime dependency key is forbidden without a design update.
- Pi extension entrypoint contract: the project must be loadable when symlinked as `~/.pi/agent/extensions/dasein`; the repository root must contain `index.ts` as the Pi auto-discovery shim, and that shim must delegate to `./src/index.ts`. `package.json.pi.extensions` may also include `./index.ts` for package/local-path install metadata, but it is not a replacement for the root shim in symlinked extension mode.
- Required dev tooling: `typescript`, `tsx` for TypeScript test execution under Node's test runner, and Node type definitions if needed by TypeScript.
- Dev dependencies are allowed only for TypeScript/test tooling; they must not be imported by runtime modules.
- Tests use Node's built-in `node:test` assertions and must not introduce a second test framework without a design update.
- Fake Pi API strategy: unit and integration tests construct a small fake Pi extension host that records registered commands, flags, lifecycle handlers, events, `ctx.mode`, `ctx.ui.setStatus`, `ctx.ui.setWidget`, and `ctx.ui.custom` calls. The fake host is the default for CI when `/opt/homebrew/bin/pi` or matching Pi APIs are unavailable.
- Install modes:
  - Directory/package install keeps `src/sensors/*.ts` available and supports user-added local sensors through manual `/dasein reload`.
  - Single-file packaged install embeds a static sensor registry and does not support user-added sensors or dynamic sensor scanning.
- Live Pi smoke remains a release gate for Pi UI surfaces and live reload behavior that cannot be proven by the fake host alone, including SettingsList rendering/interaction and directory/package `.ts` sensor discovery plus `/dasein reload` cache-busting. It is run through `npm run test:smoke`, not ordinary `npm test`.

Rationale: this keeps implementation boring and testable while avoiding a full Pi process for ordinary CI. Trade-off: fake API tests can prove registration and call contracts, but not final TUI rendering fidelity; that requires the live smoke gate.

### Package script contract

```json
{
  "type": "module",
  "dependencies": {},
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "pi": {
    "extensions": ["./index.ts"]
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node scripts/run-non-native-tests.mjs",
    "test:file": "node --import tsx --test",
    "pretest:native": "node scripts/prepare-native-test-env.mjs",
    "test:native": "node scripts/run-native-tests.mjs",
    "test:smoke": "node --import tsx --test tests/smoke/**/*.test.ts"
  }
}
```

Downstream implementation may add build or lint scripts, but the required gate scripts above must remain stable. Ordinary `npm test` is the full all-platform non-native/non-smoke CI gate and must not require a live Pi TUI; it may delegate to a checked-in discovery script so native/smoke files remain excluded by construction. `npm run test:file -- <files>` is for file-scoped matrix rows; `npm run test:native` is the macOS native-helper gate and must skip explicitly on non-macOS; `npm run test:smoke` is the live Pi release smoke gate. The package/static gate must fail if runtime `dependencies` is present and non-empty; if Pi-owned runtime imports are missing from `peerDependencies` or use any range other than `"*"`; if a non-Pi runtime dependency is declared without a design update; if root `index.ts` is missing or does more than delegate to `./src/index.ts`; if `package.json.pi.extensions`, when present, does not include `./index.ts`; if the root extension entrypoint is not loadable from a symlinked `~/.pi/agent/extensions/dasein` install; or if that symlinked load cannot resolve the documented SettingsList/getSettingsListTheme imports. `devDependencies` are permitted for TypeScript/test tooling only.

## Testing Gate Matrix

The implementation scaffold above is normative. CI must run `npm run typecheck` and ordinary non-native full-suite `npm test` gates on every platform; `npm test` must skip live Pi TUI smoke. File-scoped matrix rows use `npm run test:file -- <files>` so they do not imply that `npm test` itself is scoped. The native gate runs only on macOS and must skip with an explicit reason elsewhere. Release smoke uses `npm run test:smoke` against a live Pi TUI.

| Gate | Target test file(s) | Command | Required assertions | Platform rule |
|---|---|---|---|---|
| Package scaffold static contract | `tests/static/package-json.test.ts` | `npm run test:file -- tests/static/package-json.test.ts` | `package.json.dependencies` is absent or `{}`; Pi-owned runtime imports are declared only in `peerDependencies` with `"*"`; any non-Pi runtime dependency key fails without a design update; root `index.ts` exists as the symlink auto-discovery shim and delegates to `./src/index.ts`; `package.json.pi.extensions`, when present, includes `./index.ts`; the root package entrypoint is loadable when the project is symlinked as `~/.pi/agent/extensions/dasein`; that symlinked load resolves SettingsList/getSettingsListTheme imports; runtime modules do not import dev-only packages; `devDependencies` are limited to TypeScript/test tooling; required scripts `typecheck`, `test`, `test:file`, `test:native`, and `test:smoke` exist and keep the documented command shapes. | All platforms |
| Config precedence and key/path validation | `tests/unit/config.test.ts` | `npm run test:file -- tests/unit/config.test.ts` | Merges `defaults < disk < launch < runtime`; composes full effective defaults with top-level `version`, core defaults, builtin sensor defaults, and shared non-recurring timing defaults; omitted or `null` `intervalMs` means no recurring scheduler; accepts partial disk config only when non-empty disk config has `version: 1`; validates `acknowledgedManifestDigest` as `null` or lower-case SHA-256 hex; fills missing fields from defaults; startup ignores malformed disk config and applies valid launch args; reload reapplies launch overlays except runtime-overridden paths; runtime changes persist changed canonical paths and win without serializing full effective config; rejects sensor/external keys with dots; rejects discovered sensor keys matching reserved core command words; accepts keys matching `[A-Za-z0-9_-]{1,64}`; normalizes `geo.agent` to `sensors.geo.agent`; accepts `external.weather.ui`, `external.weather.agent`, and `core.renderOrder` entries such as `external:weather`; rejects `external.weather.alert.agent` and unknown unprefixed render-order sensor keys. | All platforms |
| Config atomicity, mutation queue, and durable state | `tests/unit/config-atomicity.test.ts`, `tests/unit/config-queue.test.ts`, `tests/unit/state-file.test.ts` | `npm run test:file -- tests/unit/config-atomicity.test.ts tests/unit/config-queue.test.ts tests/unit/state-file.test.ts` | Runtime mutation writes temp file then renames; active runtime changes only after persistence success; failed write leaves runtime and disk unchanged; `/dasein apply` is all-or-nothing; `/dasein set`, `/dasein apply`, SettingsList changes, sensor-action proposed config mutations, and `/dasein reload` execute through one deterministic FIFO queue; sensor actions cannot write config directly; `ConfigManager.applyRuntimeProposal` accepts `ConfigMutationProposal.assignments` plus `deletePaths` in one transaction; `ConfigMutationProposal.deletePaths` removes only the validated canonical path from persisted partial config and active effective config, with no persisted tombstone value; successful mutations report lexicographic `updatedPaths` and `deletedPaths`; `config.json` runtime writes patch/delete canonical paths only and do not persist unrelated launch-derived values; `state.json` schema requires exactly top-level `version` and `lapse`; unknown durable top-level keys are dropped on next write; geo durable cache is out of initial scope; geo tags are config not state; external state is not durable; startup merges defaults/disk/launch before reading `state.json`; `lapse.persist=false` prevents startup timestamp import and observation durable writes while `lapse.enabled` collection and `lapse.agent` injection remain separate controls; malformed `state.json` is ignored with a status error only when effective persistence is true; persisted lapse state retains only latest `previous_human_input_at` and `previous_agent_end_at`; observe updates in-memory state and enqueues/coalesces asynchronous durable writes after request construction/event handling; `/dasein lapse reset` is the explicit clear exception and clears in-memory and persisted lapse timestamps even when `lapse.persist=false`; failed state write leaves old file unchanged, surfaces `DurableStateError`, and does not affect request construction. | All platforms |
| Command parser and result typing | `tests/unit/command-parser.test.ts`, `tests/unit/command-result.test.ts` | `npm run test:file -- tests/unit/command-parser.test.ts tests/unit/command-result.test.ts` | Parses core commands, sensor actions, canonical sensor paths, short sensor path aliases, external paths, and `--dasein "path=value,path=value"`; defines sensor `action` as the safe key token and `arg` as quoted or bare string; preserves action args as ordered strings for sensor validators; treats `status`, `reload`, `sensors`, `set`, `apply`, and `help` as core words before sensor-command routing; preserves ordered `ParsedAssignment[]` entries with `inputPath`, `canonicalPath`, and `value`; trims whitespace around commands, assignments, and comma-separated entries while preserving whitespace inside quotes; booleans accept `on/off/true/false/enabled/disabled`; numbers accept finite decimal only with optional leading `-`, no `+`, no exponent, no `NaN`/`Infinity`, no leading zeros except `0` or `0.x`, and no trailing decimal point; bare strings reject whitespace/control/comma/equals/quote/backslash; quoted values use double quotes, preserve spaces and equals, and accept escaped commas as `\,`; valid escapes are `\\`, `\"`, and `\,`; unquoted comma/equal in values, unterminated quotes, invalid numeric tokens, and invalid escapes fail with `CommandParseError`; duplicate canonical apply/launch paths fail before assignment collapse, including alias conflicts like `geo.agent` plus `sensors.geo.agent`; invalid launch is all-or-nothing; invalid paths do not mutate config; successful mutation results expose lexicographic `updatedPaths` and `deletedPaths`; failed commands populate `DaseinCommandResult.errors` with `CommandParseError | DaseinStatusError`. | All platforms |
| Status and sensors command payloads | `tests/unit/commands-status.test.ts`, `tests/unit/commands-sensors.test.ts` | `npm run test:file -- tests/unit/commands-status.test.ts tests/unit/commands-sensors.test.ts` | `/dasein status` returns `omittedKeys`, `truncated`, disabled/hidden contributors, `sensorMetadata`, declared background work, `effectiveIntervalMs`, `manifestDigest`, acknowledgement required/satisfied state, permission state, freshness, health, Pi mechanism evidence statuses, sensor load errors, effective lapse `enabled/persist/agent` controls, durable lapse load health, visible recurring refresh controls/intervals, and `DaseinStatusError[]`; `/dasein status` inspects persisted lapse state without exposing history; `/dasein sensors` includes loaded records, load-failed sensor records with `SensorLoadError`, warns that user-added local `.ts` sensors are trusted executable code at import time and not sandboxed, and exposes provenance, declared input classes, output fields, permissions, remote/network behavior with destinations, payload classes, transmission cadence, disable control, deterministic non-remote `none` values, declared background work with deterministic none/null values, `effectiveIntervalMs`, `manifestDigest`, acknowledgement fields, and forced-disabled reasons before enablement; command text is deterministic. | All platforms |
| Sensor export, install modes, provenance, and reload all-or-keep-old | `tests/unit/sensor-loader.test.ts`, `tests/unit/reload.test.ts`, `tests/unit/install-mode.test.ts` | `npm run test:file -- tests/unit/sensor-loader.test.ts tests/unit/reload.test.ts tests/unit/install-mode.test.ts` | Directory/package install scans `<extension_root>/src/sensors/*.ts`; single-file packaged install uses bundled/static registry only and rejects/disables user-added sensor scanning; treats user-added `.ts` sensor modules as trusted local executable code at import time with no sandbox for top-level side effects; accepts default export exactly one `SensorSpec`; rejects named-export-only module; rejects missing `manifest`; rejects defaults missing `enabled`, `ui`, or `agent`; rejects duplicate keys; rejects sensor keys matching reserved core command words with `reserved-key` load errors; validates manifest-declared input classes, output fields, permissions, remote/network behavior, and background work; computes stable `manifestDigest` from canonical inspectability metadata/current manifest; `remote.capable=true` requires destinations, payload classes, non-`none` cadence, and disable control; `remote.capable=false` requires deterministic empty/`none` values; `backgroundWork.capable=false` requires deterministic `kinds: []`, `defaultIntervalMs: null`, `intervalRelationship: "none"`, and `description: "none"`; manifest/ack/default-off controls govern post-load refresh/action/background/network behavior only; user-added sensors with background work, remote/network behavior, or positive effective `intervalMs` stay effective disabled for module default `enabled:true`, disk `enabled:true`, launch `enabled:on`, and slash enabled-alone cases; SettingsList enable and explicit `/dasein apply sensors.<key>.enabled=true,sensors.<key>.acknowledgedManifestDigest=<current-digest>` enable only when the digest matches; manifest/digest changes invalidate old acknowledgement and force disabled again; registry provenance distinguishes `{kind:"builtin"}` from `{kind:"user_added_local_file", filePath}`; static lint/tests enforce no top-level filesystem, subprocess, network, timer, native helper, config, refresh, or action side effects in first-party/builtin sensors; load failures are retained for status/sensors output; candidate import/spec/config/renderer failure keeps old registry, old runtime, launch overlay state, runtime-overridden paths, and old rendered context; failed `DaseinReloadResult` represents config-only, sensor-only, and combined failures without requiring `sensors` for config-only failure; successful reload returns `DaseinReloadResult`; `/dasein reload` returns deterministic success/failure messages. | All platforms |
| Sensor runtime typed state, observe hook, stale, refresh, and cleanup | `tests/unit/sensor-runtime.test.ts`, `tests/unit/lifecycle.test.ts` | `npm run test:file -- tests/unit/sensor-runtime.test.ts tests/unit/lifecycle.test.ts` | Every committed `SensorSnapshot` and field carries `contract_version`, `schema_version`, and typed-state envelope fields with `sensor_id`, `state_key`, `value`, `value_type`, `collected_at`, `stale_after_ms`, `status`, and `source`; committed snapshots never contain raw `state` or arbitrary raw sensor-returned fields outside the envelope; source kinds include `builtin`, `local_sensor`, `external_event`, and `derived`; `external_event` is used only for sensor-republished normalized state, while raw external snapshots remain separate and are not sensor envelopes; extra envelope keys are rejected or dropped before storage/render; `SensorStatus` accepts only `enabled`, `disabled`, `stale`, `error`; raw refresh returns, `SensorSpec.normalizeState`, single-output-field manifest mapping, and `SensorRefreshResult.fields` all convert into snapshots deterministically before commit; multi-field snapshots require every field envelope; allows one active refresh per sensor; `refreshNow({bypassBackoff, reason})` resolves to a normalized fresh `SensorSnapshot` or structured `SensorError`, while `scheduleRefresh(reason)` is fire-and-forget; recurring refresh uses only visible/configurable/disableable `intervalMs` scheduling with no file watcher or hidden polling; `observe` receives `input`, `before_agent_start`, and `agent_end` events for lapse without request-path I/O and without disk I/O during request construction/event handling; aborted/obsolete refresh cannot commit; stale is derived without store mutation; shutdown aborts refresh before cleanup; cleanup runs concurrently with `1000ms` timeout per sensor and aggregates errors. | All platforms |
| External state intake and SettingsList visibility | `tests/unit/external-events.test.ts`, `tests/unit/settings-list.test.ts` | `npm run test:file -- tests/unit/external-events.test.ts tests/unit/settings-list.test.ts` | Unconfigured key defaults to `{ui:true, agent:false}`; omitted `ttlMs` defaults to `60000`; present `ttlMs` is bounded `1000..86400000`; set rejects unknown event fields; clear accepts `{key}` only; rejects multiline/control-character `agent`, `ui`, and `source` without normalization; `listExternalStates()` enumerates live snapshots; expired state is ignored; raw external snapshots are separate from sensor envelopes; SettingsList exposes read-only sensor inspectability metadata before enable controls, including remote destinations, payload classes, transmission cadence, disable control, declared background work, `effectiveIntervalMs`, and `manifestDigest`; user-added remote/network-capable or background-capable sensors remain disabled while their metadata is visible; enabling a risky user-added sensor from SettingsList writes both `enabled:true` and the matching `acknowledgedManifestDigest`; SettingsList exposes core toggles, common sensor fields including visible recurring interval controls, simple `boolean`/`string`/`number`/`enum` sensor fields, and `external.<key>.ui`/`external.<key>.agent` for valid configured/live external keys; it omits invalid/expired keys and object/array/map-like fields such as `geo.tags` and `lapse.agentFields`. | All platforms |
| Renderer output contract | `tests/unit/renderer.test.ts` | `npm run test:file -- tests/unit/renderer.test.ts` | Produces `RenderedContext { agent, status, widgetLines, omittedKeys, truncated }`; renderer accepts typed sensor envelope fields plus sanitized external state snapshots; external snapshots are not sensor envelopes and can participate in `core.renderOrder` only with the deterministic `external:<key>` prefix; deterministic order is prefixed/unprefixed renderOrder entries, remaining sensors, then remaining external keys; every default per-sensor/per-field agent fragment is at most `240` chars before global `core.maxAgentChars` truncation unless a future explicit verbose mode exists, and core rejects/truncates/omits overlong default fragments before global truncation; after render, core schedules the next one-shot in-memory render invalidation at the minimum upcoming sensor stale deadline or external `expiresAt`, or cancels/does not schedule a timer when no rendered sensor freshness deadline and no live external `expiresAt` exist; timer fire recomputes from in-memory normalized state/external snapshots and republishes UI strings if changed, without sensor refresh, disk/network/subprocess I/O, dynamic import, config mutation, or request-path execution; tests prove stale sensor fields and expired external state are omitted or marked stale after timer fire even without another sensor event and without request-path recomputation; when `core.agentInjectionEnabled=false`, renderer/state store exposes `agent` as null/empty; optional `renderAgent`/`renderUI` hooks receive only normalized `SensorSnapshot`/`SensorStateField` data, return only structured `SensorViewFragment` proposals, never final prompt/UI strings, and cannot perform refresh/action/I/O paths; core canonicalizes labels, field-level order by `sensor_id` then `state_key`, visibility, stale handling, sanitization, truncation, and final injection/status/widget strings; truncation sets `truncated`; disabled/hidden/expired/schema/contract-invalid fields enter `omittedKeys`; disabled/hidden contributors remain inspectable by `/dasein status`; geo unavailable/stale and placemark-missing cases degrade without fabricating exact location details. | All platforms |
| Request-path no I/O | `tests/unit/injector.test.ts`, `tests/static/no-request-io.test.ts` | `npm run test:file -- tests/unit/injector.test.ts tests/static/no-request-io.test.ts` | Injector reads only the pre-rendered in-memory agent string/types through an explicit import allowlist and appends or returns no change; it does not read config, durable state, or sensor state directly; request construction does not invoke the renderer or render invalidation scheduler; fake store test performs no `fs`, `child_process`, `http`, `https`, `net`, `tls`, `dns`, `fetch`, `XMLHttpRequest`, `WebSocket`, dynamic `import`, sensor refresh/action/cleanup/discovery, config read/mutation, durable state read/write, native/helper import, or helper module work; with `core.agentInjectionEnabled=false`, the fake store exposes empty/null `agent` and injector returns no change without consulting config; static test rejects the full denylist from `src/core/injector.ts` and its request-path dependencies. | All platforms |
| Builtin contracts | `tests/unit/sensors/clock.test.ts`, `tests/unit/sensors/geo.test.ts`, `tests/unit/sensors/lapse.test.ts` | `npm run test:file -- tests/unit/sensors/clock.test.ts tests/unit/sensors/geo.test.ts tests/unit/sensors/lapse.test.ts` | Validates builtin defaults/enums and required `enabled/ui/agent` defaults; builtin local refresh intervals are visible/configurable/disableable; clock precision is exactly `exact/minute/hour/period/date`; builtin default agent fragments are each at most `240` chars before global truncation; geo precision is exactly `city/district/street/exact`; `sensors.geo.exactCoordinates` defaults to `false`; geo exact coordinate output requires `sensors.geo.agent === true`, `sensors.geo.precision === "exact"`, and `sensors.geo.exactCoordinates === true`; exact address text requires `sensors.geo.agent === true`, `sensors.geo.precision === "exact"`, and `sensors.geo.exactAddress === true`; geo tags use canonical `{lat, lon, radius_m, label?}` under key; `geo tag list` reads effective config only, performs no refresh/scheduling/helper spawn/state read, sorts by tag name, and redacts lat/lon from text and payload unless exact coordinate gates are all true; tag add uses an existing fresh normalized snapshot or awaits `refreshNow({ bypassBackoff: true, reason: "geo_tag_add" })`, fails deterministically on structured refresh error/stale/missing coordinates, and captures `{lat, lon}` through a core-mediated proposed config mutation; `geo tag remove` fails deterministically for absent tags and deletes existing tags through `ConfigMutationProposal.deletePaths` with no persisted tombstone marker; validates helper placemark fallback and exact no-fabrication rule; validates geo unavailable/permission-denied conditions map to `status: "error"` plus `SensorError.kind`; validates `lapse.persist` independently gates durable reads/writes, `lapse.agentFields` accepts only `user_idle` and `agent_idle` and rejects `previous_run`; clock sample render; geo nearest-tag tie rule; lapse `observe` sampling/reset semantics and persisted state shape without a separate previous-run storage/history field. | All platforms |
| Pi integration smoke | `tests/integration/pi-extension.test.ts` | `npm run test:file -- tests/integration/pi-extension.test.ts` | Requires Pi `0.78.1` or later unless compatibility tests explicitly expand support; records mechanism evidence as non-empty `evidenceStatuses` lists containing `SOURCE_VERIFIED`, `API_VERIFIED`, `LIVE_SMOKE_PENDING`, and/or `LIVE_SMOKE_VERIFIED`; docs/source-only evidence never reports live verification; fake Pi API may prove registration shape but cannot satisfy live support claims; registers `/dasein`; registers `--dasein` string flag; `before_agent_start` observes lapse and appends Dasein ambient context to the per-turn `systemPrompt`; Dasein does not append ambient `CustomMessage`/user messages by default; TUI status/widget calls are guarded by `ctx.mode === "tui"`; `core.statusEnabled=false` calls `ctx.ui.setStatus("dasein", undefined)` and `core.widgetEnabled=false` calls `ctx.ui.setWidget("dasein", undefined)`; SettingsList import/model checks remain API-shape evidence only unless paired with `npm run test:smoke` artifacts. | All platforms, with Pi APIs faked when Pi is unavailable |
| macOS native helper | `tests/native/macos-location-helper.test.ts` | `npm run test:native -- tests/native/macos-location-helper.test.ts` | Swift helper typechecks; directory/package installs use `<extension_root>/src/native/macos-location-helper.swift`; single-file packaged installs either expose a materialized packaged helper file path or geo fails closed with `SensorError.kind: "helper-unavailable"` and no helper spawn; timeout is `3000ms`; stdout/stderr cap at `16KiB`; helper stdout success contract is `lat`, `lon`, `accuracy_m`, `permission`, `timestamp`, and optional `placemark`, but the native gate does not claim permission-granted live coordinates; timeout/process/permission errors increment backoff; success resets backoff; manual refresh bypasses delay but not timeout; no helper spawns during backoff unless manual; no orphan helper processes after timeout/shutdown. | Run only on `process.platform === "darwin"`; skip with explicit reason on non-macOS; live coordinate availability requires separate permission-granted evidence. |
| Pi live mechanism and SettingsList smoke release gate | `tests/smoke/contracts/live-pi-smoke-gate-contract.test.ts` | `npm run test:smoke` | Runs against a live Pi `0.78.1+` TUI/process environment; proves command registration, `--dasein`, `before_agent_start` system-prompt ambient context injection with no Dasein custom/user message fallback, `pi.events`, status/widget render and cleanup, lifecycle observation, non-TUI fallback, SettingsList common controls, inspectability metadata before enablement, canonical-path persistence, `ctx.ui.custom` without provider/API key, and no fake-host conflation. Generates `.dasein/live-pi-smoke/latest/checklist_receipt.json` with all rows proven and zero blockers when successful. | Blocking release gate with live Pi TUI/process required; not satisfied by fake Pi API alone and not run by ordinary `npm test` |
| Pi dynamic sensor reload live smoke release gate | `tests/smoke/contracts/pi-dynamic-reload.test.ts` | `npm run test:smoke` | Runs against a real Pi process in directory/package install mode; adds or changes a local `.ts` sensor under `<extension_root>/src/sensors`; verifies startup/manual `/dasein reload` discovers it, imports the changed module through a content-addressed hidden `.dasein-reload-...ts` copy plus `?reload` token, load failure keeps the old registry/rendered context, load errors surface in commands, and single-file packaged mode does not claim dynamic user-added sensor discovery. Generates `.dasein/dynamic-reload-smoke/latest/checklist_receipt.json` and `dynamic-reload-proof.json` when successful. | Blocking release gate with live Pi process required; not satisfied by fake Pi API alone and not run by ordinary `npm test` |
| Behavioral guardrails | `tests/behavior/ambient-context.test.ts` | `npm run test:file -- tests/behavior/ambient-context.test.ts` | Ordinary coding prompt does not require model to mention ambient context; relevant prompt can use enabled fields; disabled fields never appear in agent string; UI shows whether sensitive fields are agent-visible; malformed publishers cannot inject multiline or overlong strings. | All platforms |

Gate closure command set:

```text
npm run typecheck
npm test              # all-platform ordinary CI; skips live Pi TUI smoke
npm run test:native   # macOS only; must skip, not fail, on non-macOS
npm run test:smoke    # release smoke only; requires live Pi TUI/process, including SettingsList and dynamic sensor reload
```

Latest live-smoke evidence generated on 2026-06-06 with `/opt/homebrew/bin/pi` `0.78.1`:

- `.dasein/live-pi-smoke/latest/checklist_receipt.json`: 11 total rows, 11 proven, 0 blocked.
- `.dasein/dynamic-reload-smoke/latest/checklist_receipt.json`: cache bust, rendered-context update, invalid reload failure, load-error surfacing, and old-registry preservation all true.

These generated artifacts are local evidence ledgers, not source files required by ordinary CI. `npm test` intentionally excludes live Pi smoke and native macOS helper gates; `npm run test:native` and `npm run test:smoke` are separate release/evidence commands.

No-I/O injection, reload all-or-keep-old, config atomicity, typed-state envelope, external event rejection, durable lapse state atomicity and retention bounds, startup lapse persistence gating, command/status error typing, install-mode behavior, user-added sensor import trust-boundary warnings, builtin no-top-level-side-effect static checks, sensor inspectability metadata, remote/background manifest disclosure, remote and recurring user-added sensor default-disable behavior, geo exact-location privacy gates, geo tag list privacy/no-refresh behavior, geo tag add fresh async refresh, render-hook boundary canonicalization, per-fragment render cap, render invalidation TTL/no-deadline behavior, external render-order fairness, package approved-runtime-dependency and Pi entrypoint static checks, SettingsList external/background controls, UI status/widget clear behavior, dynamic `.ts` sensor reload live smoke, and helper cleanup are blocking gates for initial release. Live Pi smoke is a release gate for support claims, TUI behavior, and dynamic reload behavior.

## Risks

- CoreLocation permission behavior may differ by terminal emulator.
- Dynamic import cache-busting may accumulate module instances if overused.
- External publishers may send noisy strings; strict rejection, length bounds, and TTL are required.
- Ambient context in a user-like message may be overweighted by some models.
- Immediate config persistence means disk-write failure must be visible and must block runtime mutation.

## Nonblocking Future Notes

These are not open design questions for the initial implementation:

- Minimum Pi version is pinned to `0.78.1` or later until compatibility testing expands. Dasein still gates features by checking the verified APIs at startup and reports missing APIs in `/dasein status`.
- Automatic sensor file watching is intentionally deferred. Manual `/dasein reload` is the only dynamic sensor reload path.
- Geo maps, route tracking, and cloud/IP geolocation are out of scope.
- Geo durable cache (`last_fix` / `geocode_cache`) is out of initial scope unless a later design adds explicit retention, privacy, and invalidation controls.
- Multiple geofence tag rendering is deferred; initial behavior renders nearest matching tag only.
- Rich policy for how agents should interpret ambient context is out of scope; Dasein only brokers and renders bounded context.

## Open Questions

None for initial implementation.
