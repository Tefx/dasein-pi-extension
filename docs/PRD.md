# Product Requirements Document: Dasein (`dasein-pi-extension`)

## 1. Summary

Dasein is an ambient context broker and sensor framework for the Pi coding-agent environment.

Its purpose is to collect bounded, privacy-controlled ambient state from builtin sensors, user-added sensors, and external Pi extensions; normalize that state; and expose it to both:

1. the LLM agent, through short deterministic context injection; and
2. the human user, through Pi TUI surfaces such as a status footer, optional widgets, and configuration UI.

Clock, geo, and lapse are the only builtin sensors for this product scope. Continuity is a semantic property provided by the lapse sensor, not a separate builtin sensor. They are not the core product. The core product is the framework that lets ambient state be configured, brokered, rendered, and injected safely.

**Normative companion artifact:** `docs/TECHNICAL_DESIGN.md` owns exact technical fields and implementation contracts, including `intervalMs`, `timeoutMs`, `staleAfterMs`, `initialRefresh`, parser contracts, and TypeScript signatures. This PRD owns product behavior and acceptance criteria; when a technical field shape or signature is needed, use the Technical Design as normative.

## 2. Problem

Pi coding-agent sessions often lack lightweight ambient context that is useful for coordination and continuity, such as local time, approximate place labels, elapsed user/agent inactivity, active persona, or MCP availability.

Today, this context is either absent, manually typed by the user, or embedded ad hoc by individual extensions. That creates inconsistent UX, avoidable token usage, unclear privacy controls, and duplicated sensor implementations.

Dasein solves this by providing a single ambient context broker with explicit configuration, bounded LLM injection, visible human-facing state, and an extension event bridge.

## 3. Goals

- Provide a small, deterministic ambient context framework for Pi.
- Expose ambient context to both the LLM agent and the human TUI.
- Support builtin sensors for clock, geo, and lapse only.
- Support user-added sensors loaded from Dasein's extension sensor directory.
- Allow external Pi extensions to publish ambient state through `pi.events`.
- Provide global user configuration under `~/.pi/dasein/`.
- Support runtime configuration through slash commands and UI settings.
- Persist runtime slash/UI configuration changes immediately to `~/.pi/dasein/config.json`.
- Support launch-time overrides for spawned agents through a string CLI flag.
- Keep LLM request-path injection free of I/O and subprocess work.
- Make privacy controls explicit, especially for location.
- Keep token usage bounded and predictable.
- Preserve KISS: no policy engine, no automatic file watcher, manual reload only.

## 4. Non-Goals

- Dasein is not a general automation engine.
- Dasein is not a policy engine.
- Dasein will not decide when the agent should act based on ambient context.
- Dasein will not include a rule language or lock layer.
- Dasein will not watch config files automatically.
- Dasein will not perform I/O or subprocess calls during LLM request-path injection.
- Dasein will not expose precise location to the agent by default.
- Dasein will not require every Pi extension to adopt Dasein.
- Dasein will not be the owner of Pi's global settings system.
- Dasein will not provide a full telemetry or analytics platform.
- Dasein will not load sensors from `~/.pi/dasein/sensors` in this product scope.

## 5. Target Users

### Primary User: Pi coding-agent user

A human using Pi who wants useful ambient context visible in the TUI and optionally available to the agent, without repeatedly typing it or leaking sensitive data.

### Secondary User: Pi extension author

A developer building Pi extensions who wants to publish ambient state once and have it appear consistently in Dasein's UI and optional agent context.

### Tertiary User: sensor author

A developer who wants to add a local sensor by adding a typed sensor module to Dasein's extension sensor directory and reloading Dasein manually.

## 6. User Stories

- As a Pi user, I want to see whether Dasein is enabled and which sensors are active from the TUI.
- As a Pi user, I want to opt into location context visibly before it is injected.
- As a Pi user, I want to configure whether each sensor appears in the UI, the agent context, both, or neither.
- As a Pi user, I want to reload Dasein config and sensor modules manually after editing files.
- As a Pi user, I want to set runtime values through slash commands without restarting Pi.
- As a Pi user, I want runtime slash/UI changes to save immediately so `/dasein reload` does not unexpectedly revert normal runtime edits.
- As a Pi user, I want launch arguments to override disk config for a single Pi invocation or spawned subagent.
- As a Pi extension author, I want to publish ambient state through `pi.events` so Dasein can render and optionally inject it.
- As a sensor author, I want to define sensor defaults, fields, renderers, and sensor-specific commands without changing Dasein core injection logic.
- As the LLM agent runtime, I need a short, stable ambient context string that is served from memory and does not trigger request-path I/O.

## 7. Functional Requirements

### 7.1 Ambient Context Broker

Dasein must provide a central broker that:

- loads builtin and user-added sensor modules;
- receives normalized readings from sensors;
- receives external ambient state from Pi extensions through `pi.events`;
- stores the latest effective ambient state in memory;
- exposes separate render paths for:
  - LLM agent injection;
  - human TUI display;
  - settings/configuration UI;
- applies sensor-level and external-state visibility controls before rendering context.

### 7.2 Sensor Model

Each sensor must support the following common configuration fields:

```text
enabled
ui
agent
```

Meaning:

- `enabled`: whether the sensor runs, refreshes, or accepts updates.
- `ui`: whether the sensor may appear in human-facing TUI surfaces.
- `agent`: whether the sensor may appear in LLM agent context injection.

Sensors may define additional sensor-specific fields, including optional refresh interval fields described by the Technical Design. Sensor-specific interval config must only schedule background or explicit refresh work; it must not cause refresh work inside the LLM injection path.

Sensor IDs and short command/config aliases must match `[A-Za-z0-9_-]{1,64}`. Dots are disallowed inside sensor IDs; dots are reserved only as command path separators, such as `geo.agent` or `clock.precision`.

User-added sensor modules must implement the `SensorSpec` contract exactly as defined in `docs/TECHNICAL_DESIGN.md`:

- The module default export must be exactly one valid `SensorSpec`; named-export-only modules are not accepted.
- `SensorSpec.key` is required and must be the stable sensor ID/short alias matching `[A-Za-z0-9_-]{1,64}`.
- `SensorSpec.defaults` is required and must include common config fields that let Dasein determine whether the sensor is enabled and visible to UI and/or agent surfaces; sensor-specific defaults may add declared fields.
- The Technical Design owns the exact `SensorSpec` members, TypeScript types, manifest field names, and refresh/render/action signatures. This PRD must not define alternate function signatures.
- Inspectable user-added sensor metadata must be composed of loader-owned provenance plus the spec-owned `SensorSpec.manifest`, with exact manifest field names owned by the Technical Design.
- `SensorSpec.manifest` must declare input classes, output fields, permissions, remote/network behavior, whether the sensor is remote/network-capable, and declared recurring/background work where applicable. Source/provenance is loader-owned metadata derived during loading and is not required in the sensor manifest.
- User-added sensors with missing or malformed required `SensorSpec.manifest` fields must fail validation and be reported as load errors without replacing the active runtime; missing loader-owned provenance must not be treated as a sensor manifest validation failure.
- Remote/network-capable user-added sensors must default to `enabled=false` even if their module defaults request enabled behavior; the user must explicitly enable them after inspection.
- User-added sensors that declare recurring/background work, including any positive effective `intervalMs`, must also default to `enabled=false` until explicit human enablement after metadata inspection.
- `/dasein sensors` and/or SettingsList must expose inspectable user-added sensor metadata before enablement, including loader-owned provenance plus manifest-declared permissions, input classes, output fields, remote/network behavior, remote/network-capable status, declared recurring/background work, and effective `intervalMs` where applicable.
- Sensor modules may propose rendered fragments, but Dasein core owns final visibility checks, ordering, sanitization, character limits, stale-reading behavior, and final injection into agent context or TUI surfaces.

User-added sensors are loaded from the canonical sensor directory for supported directory/package-form installs:

```text
<extension_root>/src/sensors/*.ts
```

`<extension_root>` is the Dasein project/extension root. Supported install modes are:

- Directory/package-form extension installs, where the extension root is a directory containing `src/sensors/*.ts`; these installs support user-added sensors.
- Single-file extension installs, which do not expose `<extension_root>/src/sensors/*.ts` and therefore do not support user-added sensors. A single-file packaged Dasein can still run sensors bundled into that package by the Dasein build.

The recommended install for user-added sensors is a standalone Dasein project symlinked into Pi as:

```text
~/.pi/agent/extensions/dasein
```

Dasein must not treat `~/.pi/dasein/sensors` as a sensor directory unless a future product decision adds that path.

Minimal sensor refresh lifecycle:

- At startup, Dasein must run an initial refresh for enabled sensors where the sensor has a `refresh` hook and startup refresh is applicable to that sensor.
- If a sensor declares optional interval config from the Technical Design, Dasein may schedule refreshes on that interval while the sensor is enabled.
- Sensor-owned actions, such as `/dasein geo refresh`, may perform manual refresh when provided by the sensor.
- The LLM agent injection path must never trigger sensor refresh, filesystem reads, network calls, location subprocesses, or other fresh computation; it may only render current in-memory readings.
- Stale readings must be omitted or explicitly marked stale according to render config and sensor render behavior.

Example sensor config subset:

```json
{
  "clock": {
    "enabled": true,
    "ui": true,
    "agent": true,
    "precision": "minute"
  },
  "geo": {
    "enabled": false,
    "ui": true,
    "agent": false,
    "precision": "city",
    "tags": {
      "home": {
        "lat": 12.345678,
        "lon": -98.765432,
        "radius_m": 120,
        "label": "home"
      }
    }
  }
}
```

### 7.3 Builtin Sensors

Dasein must ship with exactly these builtin sensors for this product scope:

- clock;
- geo;
- lapse.

Continuity is a semantic property provided by the lapse sensor, not a separate builtin sensor.

#### Clock Sensor

The clock sensor provides current local time context.

Default configuration:

```json
{
  "enabled": true,
  "ui": true,
  "agent": true,
  "precision": "minute"
}
```

Required configuration fields:

- `clock.enabled`
- `clock.ui`
- `clock.agent`
- `clock.precision`

Supported precision must include:

- `exact`
- `minute`
- `hour`
- `period`
- `date`

The clock sensor must avoid unnecessary verbosity in agent injection.

#### Geo Sensor

The geo sensor provides user-approved location context through a macOS CoreLocation Swift helper run as a local `Dasein Location Helper` app bundle so Location Services can present a clear permission prompt.

Default configuration:

```json
{
  "enabled": false,
  "ui": true,
  "agent": false,
  "precision": "city",
  "tags": {}
}
```

Required behavior:

- Location must be opt-in for agent injection.
- Location permission status must be visible in the TUI.
- The user must be able to disable geo entirely.
- The user must be able to expose geo to UI and agent independently.
- The user must be able to configure location precision.
- The geo sensor must support user-defined tags, such as `home`, stored canonically as `{ lat, lon, radius_m, label? }`, where `lat`/`lon` come from a fresh geo fix, `radius_m` is meters, and `label` is optional.
- `/dasein geo tag add <name> <radius_m>` may reuse a current fresh CoreLocation fix or request a new fix when no current fresh fix is available, then store the tag as `{ lat, lon, radius_m, label? }` and store an optional label when available; if geo is disabled, permission is denied, or no current fresh fix can be obtained, the command must fail clearly and store nothing.
- Geo tag matching must use the nearest matching tag within `radius_m` only by default; overlapping tags must not all be emitted by default.

Supported geo precision levels and privacy implications:

- `city`: coarse city-level description or nearest matching semantic tag; default and safest for agent use.
- `district`: neighborhood/district-level description; more revealing than city and must still require `geo.agent=true` for agent exposure.
- `street`: street-level description; privacy-sensitive and should be visually obvious in UI when agent-exposed.
- `exact`: precise coordinates or equivalent exact location. Agent injection at `exact` precision requires both `geo.agent=true` and `geo.precision="exact"` explicitly.

Required example subcommands:

```text
/dasein geo tag add home 120
/dasein geo tag list
/dasein geo tag remove home
/dasein geo refresh
```

The geo sensor must prefer semantic labels or coarse descriptions over precise coordinates for agent injection unless the user explicitly chooses `geo.precision="exact"` and `geo.agent=true`.

#### Lapse Sensor

The lapse sensor tracks interaction continuity.

Default configuration:

```json
{
  "enabled": true,
  "ui": true,
  "agent": true,
  "persist": true,
  "agentFields": ["user_idle"]
}
```

It must support:

- `user_idle`: time since previous human input;
- `agent_idle`: time since previous agent completion.

Required example subcommand:

```text
/dasein lapse reset
```

`/dasein lapse reset` clears in-memory lapse state and persisted lapse timestamps without changing configuration.

Product-level lapse persistence requirements:

- Lapse persistence exists only to preserve continuity across Pi restarts.
- Canonical controls are separate: `sensors.lapse.enabled` controls collection, `sensors.lapse.persist` controls persistence, and `sensors.lapse.agent` controls agent injection.
- Retention is limited to the latest `previous_human_input_at` and latest `previous_agent_end_at` in `~/.pi/dasein/state.json`; Dasein must not keep lapse history, lists, or cache entries.
- Outside the explicit `/dasein lapse reset` clear operation, Dasein reads or writes persisted lapse timestamps only when the effective `sensors.lapse.persist === true`; otherwise persisted timestamps are ignored and observations do not update `state.json`.
- `/dasein status` must expose lapse persistence health and whether persisted timestamps are present.

Definitions:

- `user_idle` answers: how long has the human been silent since their previous input?
- `agent_idle` answers: how long has the agent/system been idle since the previous agent completion?
- `run` is not stored; when useful for UI it can be derived as `user_idle - agent_idle` for the previous turn.
- `lapse.agentFields` controls which lapse fields may be rendered into agent context; it defaults to `["user_idle"]`.

Example:

```text
13:00 human starts a turn
19:00 agent finishes autonomous work
20:00 human speaks again

user_idle = 7h
agent_idle = 1h
derived previous_run = 6h
```

### 7.4 External State Bridge

External Pi extensions must be able to publish ambient state through `pi.events`.

External state is a core broker input path. It is not a builtin time/space sensor.

External state keys must match `[A-Za-z0-9_-]{1,64}`. Dots are disallowed inside external keys; dots are reserved only for config/command path separators, such as `external.weather.agent`.

#### Event Topics

Dasein must subscribe to exactly these external event topics for this product scope:

```text
dasein:state:set
dasein:state:clear
```

#### `dasein:state:set` Contract

The event payload schema is:

```ts
{
  key: string;
  agent?: string;
  ui?: string;
  ttlMs?: number;
  source?: string;
}
```

Validation rules:

- `key` is required and must match `[A-Za-z0-9_-]{1,64}`.
- At least one of `agent` or `ui` must be present.
- `agent`, `ui`, and `source` strings must each be single-line strings with maximum length 120 characters.
- `agent`, `ui`, and `source` strings containing embedded newlines, carriage returns, tabs, other control characters, or hidden multiline content must be rejected; Dasein must not silently normalize, truncate across lines, or coerce multiline/control-character payloads into single-line values.
- `ttlMs` must be an integer from `1000` through `86400000` inclusive.
- If `ttlMs` is omitted, the `dasein:state:set` contract permits Dasein to apply a default TTL of `60000` ms.
- Unknown fields must be rejected; invalid event payloads must not be stored or rendered.

Semantics:

- `key` identifies the external state slot.
- `agent` is the optional string payload eligible for agent injection, subject to Dasein configuration and max-length budgeting.
- `ui` is the optional string payload eligible for human TUI rendering.
- `source` identifies the publishing extension for status/debug display only.
- A later valid set for the same `key` replaces the previous value.
- A value expires when its TTL elapses and must no longer render in UI or agent output.
- External publishers cannot force agent injection if Dasein config disallows external state or if the event omits `agent`.

#### `dasein:state:clear` Contract

The event payload schema is exactly:

```ts
{
  key: string;
}
```

Validation rules:

- `key` is required and must match `[A-Za-z0-9_-]{1,64}`.
- Unknown fields must be rejected.

Semantics:

- A valid clear removes only the external state slot for `key` from memory.
- Clearing an absent key is a no-op and must not error.
- Clear events do not support source-wide or wildcard clearing in this product scope.

Dasein must:

- accept valid external ambient state events;
- validate event shape before storing;
- allow external state to be configured for UI and agent exposure;
- prevent unbounded injected output from external publishers;
- degrade safely if an external publisher disappears.

### 7.5 Configuration Storage and Schema

Dasein must store global configuration under:

```text
~/.pi/dasein/
```

Required user-editable configuration file:

```text
~/.pi/dasein/config.json
```

The only initial runtime support path is the lapse persistence file, used only where lapse persistence is explicitly defined:

```text
~/.pi/dasein/state.json
```

No cache directory is in initial product scope. Any future durable cache requires an explicit purpose, retention policy, inspect/clear UI, and separate collection, persistence, and injection controls.

User-editable global configuration must live under `~/.pi/dasein/`. Sensor modules do not live under this directory in the current product scope.

The core configuration schema must include:

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
      "precision": "minute"
    },
    "geo": {
      "enabled": false,
      "ui": true,
      "agent": false,
      "precision": "city",
      "tags": {}
    },
    "lapse": {
      "enabled": true,
      "ui": true,
      "agent": true,
      "persist": true,
      "agentFields": ["user_idle"]
    }
  },
  "external": {
    "example_key": {
      "ui": true,
      "agent": false
    }
  }
}
```

Any non-empty disk `~/.pi/dasein/config.json` must include top-level `"version": 1`. Other top-level sections and nested fields may be partial; Dasein completes omitted fields from defaults when constructing the effective config. An absent config file is equivalent to no disk overrides.

Config version default:

- `version`: `1`

Core defaults:

- `core.agentInjectionEnabled`: `true`
- `core.statusEnabled`: `true`
- `core.widgetEnabled`: `false`
- `core.maxAgentChars`: `240`
- `core.injectedLabel`: `ambient_ctx`
- `core.renderOrder`: `["clock", "lapse", "geo"]`

Builtin sensor defaults:

- Clock: `enabled=true`, `ui=true`, `agent=true`, `precision="minute"`.
- Geo: `enabled=false`, `ui=true`, `agent=false`, `precision="city"`, `tags={}`.
- Lapse: `enabled=true`, `ui=true`, `agent=true`, `persist=true`, `agentFields=["user_idle"]`.

External state configuration defaults:

- The `external` object is an optional map keyed by external state key.
- Each external key must match `[A-Za-z0-9_-]{1,64}`; dots are not allowed inside the key.
- Each external config value may include `ui` and `agent` booleans only in this product scope.
- Unconfigured external keys default to `{ "ui": true, "agent": false }`.
- Disk config may override visibility per key, for example `external.weather.agent=true` or `external.weather.ui=false`.
- External command/config paths must use `external.<key>.agent` and `external.<key>.ui`; the `<key>` segment is the literal external key and cannot contain dots.

### 7.6 Configuration Precedence and Runtime Persistence

Dasein must apply configuration using this precedence order, from lowest to highest:

1. defaults for core, builtin sensors, user-added sensors, and unconfigured external keys;
2. global disk configuration from `~/.pi/dasein/config.json`;
3. launch arguments as process-local overlays;
4. slash command or UI runtime changes for explicitly changed paths.

Runtime slash command and UI changes must:

- validate the full candidate target path/value patch before applying;
- atomically persist the canonical path patch to `~/.pi/dasein/config.json` after successful validation, preserving unrelated disk config values;
- commit the in-memory runtime configuration, current-process runtime-overridden path set, affected sensor behavior, TUI rendering, and agent context only after disk persistence succeeds;
- on persistence failure, report the error and leave both runtime/memory state and disk config unchanged;
- mark each explicitly changed path as a current-process runtime-overridden path only as part of the post-persistence runtime commit;
- override launch arguments for those changed paths for the rest of the current process only after that commit;
- update affected sensors, TUI rendering, and agent context without requiring Pi restart after the persistence-backed commit succeeds.

Launch arguments are process overlays, not disk config writes. If a launch flag sets `geo.agent=on`, Dasein must not write `geo.agent` to `~/.pi/dasein/config.json` merely because the process launched with that value. If the user later changes that exact path through `/dasein set geo.agent off` or the UI, Dasein must persist the explicit user change for `geo.agent` to disk and mark `geo.agent` runtime-overridden for the current process. If the user changes a different path, Dasein must not serialize unrelated launch-only values into disk config.

Manual disk and sensor reload must be explicit through:

```text
/dasein reload
```

`/dasein reload` reloads disk config and sensors only after validating the candidate disk config, sensor specs, and restart plan. During the current process, reload must rebuild effective configuration by:

1. loading defaults;
2. loading the current disk config from `~/.pi/dasein/config.json`;
3. reapplying launch-argument overlays except for paths marked runtime-overridden in the current process;
4. keeping current-process runtime overrides effective for those runtime-overridden paths.

A successful reload replaces the active in-memory config and sensor instances with the validated effective config and fresh sensor state. A failed reload must keep the last-known-good active config, active sensors, runtime-overridden path set, and runtime state in place, report the validation/load errors, and avoid partial replacement.

Example: launch with `--dasein "geo.agent=on"`, then run `/dasein set geo.agent off`, then run `/dasein reload`; the effective value after reload must remain `geo.agent=off` because `geo.agent` is a runtime-overridden path in the current process and the explicit user change was persisted to disk.

Dasein must not implement an automatic file watcher.

### 7.7 Launch Argument

Dasein must support a launch flag:

```text
--dasein "geo.agent=off,clock.precision=minute"
```

The flag must accept comma-separated key-value assignments using the same path grammar as slash commands, including short sensor aliases such as `geo.agent` and external paths such as `external.weather.agent`.

Launch values must override defaults and global disk config as process-local overlays. They must remain runtime-only overlays unless the user explicitly changes the same path through slash command or UI. Later runtime slash/UI changes override launch values for changed paths, persist those paths to disk, and remain effective for those paths across `/dasein reload` in the current process.

### 7.8 Slash Commands

Dasein must provide these core slash commands:

```text
/dasein
/dasein status
/dasein reload
/dasein sensors
/dasein set <path> <value>
/dasein apply <k=v,...>
```

Dasein must also allow sensor-owned subcommands, including:

```text
/dasein geo tag add home 120
/dasein geo tag list
/dasein geo tag remove home
/dasein geo refresh
/dasein lapse reset
```

Command path grammar:

- Core paths use `core.<field>`, such as `core.agentInjectionEnabled`, `core.statusEnabled`, `core.widgetEnabled`, and `core.maxAgentChars`.
- Slash command paths must accept short sensor aliases directly, such as `geo.agent`, `geo.ui`, `geo.enabled`, `clock.precision`, and `lapse.agentFields`; the `sensors.` prefix is not required. Canonical sensor paths are defined by Technical Design and may also be accepted.
- External visibility paths use `external.<key>.agent` and `external.<key>.ui`, such as `external.weather.agent`.
- Sensor aliases and external keys in command paths must match `[A-Za-z0-9_-]{1,64}` and therefore cannot contain dots.

Command behavior:

- `/dasein` opens the configuration UI in TUI mode, and falls back to concise help/status outside TUI mode.
- `/dasein status` shows effective config, sensor health, freshness, lapse persistence health/presence, and privacy-sensitive state summaries; the exact output data shape is deferred to Technical Design.
- `/dasein reload` reloads `~/.pi/dasein/config.json`, reapplies launch overlays except for current-process runtime-overridden paths, stops old sensors, rescans `<extension_root>/src/sensors/*.ts` where supported, and restarts enabled sensors only if the full reload candidate validates; on failure it keeps the last-known-good runtime active.
- `/dasein sensors` lists loaded sensors, load errors, and inspectable user-added sensor metadata required for safety inspection before enablement, including loader-owned provenance plus spec-owned manifest fields for permissions, input classes, output fields, remote/network behavior, remote/network-capable status, declared recurring/background work, and effective `intervalMs` where applicable; the exact list item data shape is deferred to Technical Design.
- `/dasein set <path> <value>` validates one runtime configuration path/value candidate, atomically persists only that canonical path patch to `~/.pi/dasein/config.json`, then commits runtime behavior and marks that path runtime-overridden for the current process only after persistence succeeds.
- `/dasein apply <k=v,...>` validates all assignments first, atomically persists only the explicitly supplied canonical path patches together, then commits runtime behavior and marks those paths runtime-overridden for the current process only after persistence succeeds. If any assignment is invalid or persistence fails, the entire apply operation aborts with no runtime or disk changes.
- `/dasein geo tag add <name> <radius_m>` creates or updates a geo tag by reusing a current fresh geo fix when one exists, or requesting a new fix when none is currently fresh, then storing the tag canonically as `{ lat, lon, radius_m, label? }`. If geo is disabled, permission is denied, or no current fresh fix can be obtained, it returns a clear error and stores nothing.
- `/dasein geo tag list` lists configured geo tags without exposing exact coordinates unless exact display is explicitly enabled elsewhere.
- `/dasein geo tag remove <name>` removes the named geo tag or returns a clear no-op/not-found message without changing other tags.
- `/dasein geo refresh` requests a fresh geo reading outside the LLM request path and reports permission/unavailability errors without enabling geo agent exposure.
- `/dasein lapse reset` clears in-memory lapse state and persisted lapse timestamps without changing configuration.
- Invalid paths or values must produce clear errors without partially corrupting runtime config or disk config.

### 7.9 Agent Context Injection
Dasein must inject ambient context into the LLM agent only from pre-rendered in-memory state. Agent spacetime awareness is the primary product goal, so `core.agentInjectionEnabled` remains enabled by default; human-facing UI is secondary and must stay quieter than the model instruction channel.

The injected context must:

- be short;
- be deterministic;
- be bounded by `core.maxAgentChars`, default `240` characters;
- use stable ordering from `core.renderOrder`, default `["clock", "lapse", "geo"]`, with deterministic fallback ordering for other state;
- omit all state when `core.agentInjectionEnabled=false`;
- omit disabled sensors;
- omit sensors with `agent=false`;
- omit external state values with per-key `agent=false`, including the unconfigured external key default;
- omit sensitive details unless explicitly enabled;
- omit stale readings or mark them stale according to render config and sensor render behavior;
- avoid branding-heavy labels;
- enter the model through Pi's per-turn system/developer prompt path, not through a user-role message.

The injection path must not perform sensor refresh work, filesystem reads, network calls, CoreLocation/helper subprocess calls, or other fresh computation. It must render only the current in-memory readings and external state.

Dasein must append ambient context during `before_agent_start` by returning an updated `systemPrompt`. Pi may serialize that system prompt to provider-native `developer` or `system` messages according to provider compatibility, but Dasein must not inject ambient context as a `CustomMessage` or other message that Pi `convertToLlm()` serializes as `role:"user"`.

The renderer's canonical diagnostic label remains neutral:

```text
[ambient_ctx: local_time=14:32; user_idle=4m]
```

That string is a renderer/debug representation, not default human-facing UI and not a transcript message. Dasein must not show raw `[ambient_ctx: ...]` text in the default TUI status footer, editor-adjacent chrome, default settings surface, or user-message transcript. Raw renderer payload may appear only in explicit diagnostics/debug proof paths.

The default label must not be:

```text
[Dasein: ...]
```

Dasein must not inject priority semantics such as `low_priority` by default.

### 7.10 Human TUI Surfaces

Dasein must expose ambient context to the human TUI through:

- a status footer;
- an optional widget;
- a `SettingsList` configuration UI.

The status footer must respect `core.statusEnabled`. The default footer is a quiet summary such as `Dasein · Ready` or `Dasein · Degraded (N)`, not a raw field dump. It must not show raw sensor keys, epoch/ISO timestamps, agent IDs, manifest digests, or raw `[ambient_ctx: ...]` text by default.

The optional widget must respect `core.widgetEnabled`. Both surfaces must omit disabled sensors, sensors with `ui=false`, and external values whose per-key config has `ui=false`.

The TUI must make privacy-sensitive state inspectable on demand, especially location state, geo precision, and whether geo is available to the agent. Default surfaces should stay low-noise; diagnostics remain available through `/dasein status` and `/dasein sensors`.

The default SettingsList UI is common-first, not a flat diagnostic inventory. It should show a short set of common controls first and keep manifest/audit/background-work metadata in diagnostic or advanced paths.

The SettingsList UI must allow users to configure at least:

- core visibility toggles: `core.agentInjectionEnabled`, `core.statusEnabled`, and `core.widgetEnabled`;
- for every loaded sensor, the common fields `enabled`, `ui`, and `agent`;
- for user-added sensors, inspectable metadata before enablement, including loader-owned provenance plus manifest-declared permissions, input classes, output fields, remote/network behavior, remote/network-capable status, declared recurring/background work, and effective `intervalMs` where applicable;
- each sensor-declared simple config field whose type is `boolean`, `string`, `number`, or constrained string `enum`, including builtin `clock.precision` and `geo.precision`;
- external visibility controls: `external.<key>.ui` and `external.<key>.agent` for valid external keys, with exact SettingsList control data shapes deferred to Technical Design.

SettingsList must not be the management surface for complex sensor fields such as objects, arrays, maps, or structured values. For this product scope, `geo.tags` is managed by `/dasein geo tag ...` sensor commands, not by SettingsList.

SettingsList changes must use the same validation, explicit-path persistence, and runtime-update semantics as slash command changes.

### 7.11 Sensor Reload

Dasein must support manual reload:

```text
/dasein reload
```

Reload must build and validate a complete candidate state before replacing the active runtime. The candidate must:

- load and validate global disk config from `~/.pi/dasein/config.json`;
- reapply launch-argument overlays except for current-process runtime-overridden paths;
- keep current-process runtime overrides effective for runtime-overridden paths;
- rescan `<extension_root>/src/sensors/*.ts` when the install mode supports that directory;
- load valid sensor specs;
- report invalid specs;
- prepare enabled sensors for restart.

On successful candidate validation, reload must:

- stop old sensors;
- run old sensor cleanup;
- replace active in-memory config with the validated effective config after disk reload, launch overlay reapplication, and current-process runtime overrides;
- replace active sensor instances with the freshly loaded sensor state;
- restart enabled sensors;
- run startup refresh for enabled sensors where the sensor has a `refresh` hook and startup refresh is applicable;
- schedule optional sensor interval refreshes only as allowed by sensor config from the Technical Design;
- update UI and in-memory rendered agent context.

On reload failure, Dasein must:

- keep the last-known-good active config, active sensors, runtime-overridden path set, and runtime state in place;
- avoid partial replacement of config, sensors, or rendered context;
- report validation, disk, or sensor-load errors in `/dasein status`, `/dasein sensors`, and the reload command result where applicable.

Refresh lifecycle constraints:

- Startup and post-reload refresh may run only for enabled sensors where applicable.
- Manual refresh may run only through sensor-owned actions where provided, such as `/dasein geo refresh`.
- Optional interval refresh may run only according to sensor interval config from the Technical Design.
- LLM request-path injection must not trigger refresh work.
- Stale readings must be omitted or marked stale according to render config and sensor render behavior.

Dasein must not watch the sensor directory automatically.

## 8. Non-Functional Requirements

### 8.1 Request-Path Safety

Dasein must not perform disk I/O, network I/O, location requests, or subprocess execution during LLM request-path injection.

All expensive or permissioned work must happen before injection and update in-memory state asynchronously or through explicit user action.

### 8.2 Privacy

Dasein must provide strong privacy controls.

Required privacy behavior:

- Geo agent injection is opt-in.
- Geo defaults to `enabled=false`, `agent=false`, and `precision="city"`.
- Geo permission, configured precision, and exposure state must be visible in UI.
- UI exposure and agent exposure must be independently configurable.
- Agent injection must default to minimal, coarse context.
- Sensitive data must not be injected unless the relevant sensor is enabled and `agent=true`.
- Exact geo agent injection requires both `geo.agent=true` and `geo.precision="exact"` explicitly.
- Geo precision levels have increasing privacy sensitivity: `city` < `district` < `street` < `exact`.
- External publishers must not be trusted to inject unbounded, multiline, hidden, or control-character data; invalid payloads must be rejected rather than silently normalized.

### 8.3 Token Economy

Dasein must keep injected context compact.

Requirements:

- deterministic key ordering;
- bounded string length with default `core.maxAgentChars=240`;
- no verbose prose in default injection;
- no raw JSON injection by default;
- no duplicate sensor output;
- graceful truncation or omission when context exceeds limits.

### 8.4 KISS Constraints

Dasein must remain simple.

Required constraints:

- no policy layer;
- no rule engine;
- no automatic config file watcher;
- manual `/dasein reload`;
- explicit configuration precedence;
- clear separation between broker, sensors, UI rendering, and agent injection.

### 8.5 Reliability

Dasein must degrade gracefully when:

- the CoreLocation helper is unavailable;
- location permission is denied;
- disk config is malformed;
- a sensor module fails to load;
- an external publisher sends invalid state;
- an external state TTL expires;
- a sensor is disabled at runtime.

Failures should be visible in `/dasein status` and should not prevent Pi from running.

Reload failures must be atomic from the user's perspective: Dasein keeps the last-known-good active config, active sensors, and runtime state, reports errors, and does not partially replace live state.

## 9. Acceptance Criteria

Current evidence note (2026-06-06): ordinary `npm test` covers all-platform unit/integration/behavior/static gates and intentionally excludes live Pi TUI/process smoke and macOS native helper gates. Release-support evidence for Pi mechanisms and dynamic reload comes from `npm run test:smoke`, which generated local ledgers at `.dasein/live-pi-smoke/latest/checklist_receipt.json` and `.dasein/dynamic-reload-smoke/latest/checklist_receipt.json` with zero blockers on Pi `0.78.1` at `/opt/homebrew/bin/pi`. macOS native helper acceptance is limited to typecheck/runtime-policy/fail-closed permission handling unless a separate permission-granted coordinate artifact exists; the product must not claim successful live coordinates from the native gate alone.

### 9.1 Configuration

- Given no disk config or launch args, Dasein starts with the defined core, builtin sensor, and unconfigured external key defaults.
- Given no disk config or launch args, lapse uses separate effective controls: `sensors.lapse.enabled=true`, `sensors.lapse.persist=true`, and `sensors.lapse.agent=true`.
- Given an external state key with no disk config, Dasein treats it as `{ "ui": true, "agent": false }`.
- Given a non-empty `~/.pi/dasein/config.json` with top-level `"version": 1`, Dasein loads it and applies it over defaults, including partial configs and per-key external overrides such as `external.weather.agent=true`.
- Given a non-empty `~/.pi/dasein/config.json` without top-level `"version": 1`, Dasein rejects it as invalid disk config and reports validation/load errors instead of silently accepting or migrating it.
- Given `--dasein "geo.agent=off,clock.precision=minute"`, launch values override disk config as process-local overlays.
- Given launch-only values, Dasein does not write those values to `~/.pi/dasein/config.json` unless the user changes the same path through slash command or UI.
- Given a later `/dasein set clock.precision hour`, Dasein validates the candidate, atomically persists only the canonical `clock.precision` path patch to `~/.pi/dasein/config.json`, then commits the runtime value, marks `clock.precision` runtime-overridden for the current process, overrides the launch value, and updates runtime behavior without Pi restart only after persistence succeeds; if persistence fails, neither runtime nor disk changes occur.
- Given a SettingsList change, Dasein validates the candidate, atomically persists only the explicitly changed canonical path patch to `~/.pi/dasein/config.json`, then marks that path runtime-overridden for the current process and updates runtime behavior without Pi restart only after persistence succeeds; if persistence fails, neither runtime nor disk changes occur.
- Given launch with `--dasein "geo.agent=on"`, then `/dasein set geo.agent off`, then `/dasein reload`, Dasein must keep the effective value `geo.agent=off` after reload.
- Given `/dasein reload` with valid config and sensors, Dasein reloads disk config, reapplies launch overlays except for current-process runtime-overridden paths, keeps current-process runtime overrides effective, reloads sensors, and reports success.
- Given `/dasein reload` with invalid disk config or sensor specs, Dasein keeps the last-known-good active config, sensors, runtime-overridden path set, and runtime state, performs no partial replacement, and reports validation/load errors.
- Given a changed disk config, Dasein does not reload it automatically.

### 9.2 Slash Commands

- `/dasein` opens the configuration UI in TUI mode.
- `/dasein status` returns effective config, active sensors, permission state, recent sensor health, and lapse persistence health/presence using the Technical Design-defined output data shape.
- `/dasein sensors` lists builtin, user-added, and load-failed sensors using the Technical Design-defined list item data shape, and exposes inspectable user-added sensor metadata before enablement: loader-owned provenance plus spec-owned manifest fields for permissions, input classes, output fields, remote/network behavior, remote/network-capable status, declared recurring/background work, and effective `intervalMs` where applicable.
- `/dasein set <path> <value>` validates one runtime path/value candidate, atomically persists only that canonical path patch to disk, then marks that path runtime-overridden for the current process and updates runtime behavior only after persistence succeeds; if persistence fails, neither runtime nor disk changes occur.
- `/dasein apply <k=v,...>` is all-or-nothing: if every assignment is valid, only the supplied canonical path patches are atomically persisted, then applied and marked runtime-overridden for the current process after persistence succeeds; if any assignment is invalid or persistence fails, no runtime or disk change occurs.
- Slash command paths must accept short aliases such as `geo.agent`; `sensors.` prefix is not required; canonical sensor paths are defined by Technical Design and may also be accepted.
- Slash command paths for external state use `external.<key>.agent` or `external.<key>.ui`, such as `external.weather.agent`.
- Sensor aliases and external keys in command paths reject dots and must match `[A-Za-z0-9_-]{1,64}`.
- Invalid slash command input returns a clear error without corrupting runtime config or disk config.
- `/dasein geo tag add home 120` reuses a current fresh geo fix when one exists, or requests a new fix when none is currently fresh, then creates or updates a geo tag named `home` stored canonically as `{ lat, lon, radius_m, label? }` with `radius_m=120`; if geo is disabled, permission is denied, or no current fresh fix can be obtained, it returns a clear error and stores nothing.
- `/dasein geo tag list` lists configured geo tags without requiring a location refresh.
- `/dasein geo tag remove home` removes only the `home` geo tag or returns a clear not-found/no-op message if absent.
- `/dasein geo refresh` requests a fresh geo reading outside the LLM request path, reports permission/unavailability errors, and does not enable geo agent exposure by itself.
- `/dasein lapse reset` clears in-memory lapse state and persisted lapse timestamps, does not change config, and reports the result clearly.

### 9.3 Agent Injection
- Agent injection remains enabled by default because agent spacetime awareness is Dasein's primary purpose.
- Agent injection uses Pi's per-turn system prompt path (`before_agent_start.systemPrompt`) so providers receive the context as system/developer instructions according to Pi provider compatibility.
- Agent injection must not use `CustomMessage`, hidden `display:false` messages, or any other default path that Pi `convertToLlm()` serializes as `role:"user"`.
- Agent injection does not use `[Dasein: ...]` by default.
- Agent injection does not include default priority semantics.
- Agent injection performs no disk I/O, network I/O, location lookup, or subprocess execution during request construction.
- Agent injection does not trigger sensor refresh work and renders only current in-memory readings.
- Agent injection omits stale readings or marks them stale according to render config.
- Agent injection omits sensors where `enabled=false` or `agent=false`.
- Agent injection omits all sensor and external state when `core.agentInjectionEnabled=false`.
- Agent injection omits external values whose per-key config has `agent=false`, including the default for unconfigured external keys.
- Agent injection output is deterministic for identical in-memory state.
- Agent injection output is bounded by `core.maxAgentChars`, default `240` characters.
- Agent injection remains valid if one sensor fails.
- Default visible transcript and TUI surfaces do not show the ambient context block unless the user explicitly asks for diagnostics/status output.

### 9.4 TUI

- The status footer can show Dasein state when `core.statusEnabled=true` and is hidden when `core.statusEnabled=false`.
- An optional widget can show richer ambient context when `core.widgetEnabled=true` and is hidden when `core.widgetEnabled=false`.
- SettingsList allows configuration of core visibility toggles: `core.agentInjectionEnabled`, `core.statusEnabled`, and `core.widgetEnabled`.
- SettingsList allows configuration of each loaded sensor's common `enabled`, `ui`, and `agent` fields.
- SettingsList exposes inspectable user-added sensor metadata before enablement, including loader-owned provenance plus manifest-declared permissions, input classes, output fields, remote/network behavior, remote/network-capable status, declared recurring/background work, and effective `intervalMs` where applicable.
- SettingsList allows configuration of sensor-declared simple fields with `boolean`, `string`, `number`, or constrained string `enum` types, including builtin `clock.precision` and `geo.precision`.
- SettingsList does not manage complex sensor fields such as `geo.tags`; those fields are managed by sensor commands.
- SettingsList allows configuration of external visibility controls `external.<key>.ui` and `external.<key>.agent` for valid external keys, with exact control data shapes defined by Technical Design.
- TUI surfaces omit sensors where `enabled=false` or `ui=false`.
- TUI surfaces omit external values whose per-key config has `ui=false`.
- Location opt-in state, configured geo precision, and CoreLocation permission state are visible in the UI.
- The UI clearly indicates whether geo context can be exposed to the agent.

### 9.5 Builtin Sensors

- Dasein core remains a broker/framework; clock, geo, and lapse are the only builtin sensors in this product scope.
- Continuity is a semantic property provided by the lapse sensor, not a separate builtin sensor.
- Clock sensor can render local time at configured precision and defaults to minute precision.
- Enabled builtin sensors run startup refresh where applicable and may run optional interval refresh only according to sensor interval config from the Technical Design.
- Geo sensor defaults to disabled, UI-visible when available, not agent-visible, and city precision.
- Geo sensor supports exactly `city`, `district`, `street`, and `exact` precision values.
- Geo sensor uses the macOS CoreLocation Swift helper app bundle only outside the LLM request-path injection path.
- Geo sensor handles denied or unavailable location permission gracefully.
- Geo tags are stored canonically as `{ lat, lon, radius_m, label? }`.
- Geo tag rendering uses only the nearest matching tag within `radius_m` by default.
- Lapse sensor reports `user_idle` and `agent_idle`, and agent injection defaults to `agentFields=["user_idle"]`.
- Lapse persistence, when `sensors.lapse.persist=true`, stores only the latest `previous_human_input_at` and latest `previous_agent_end_at` in `~/.pi/dasein/state.json` for Pi restart continuity; it stores no history, list, or cache.
- On startup, Dasein reads persisted lapse timestamps only when the effective `sensors.lapse.persist === true`; when false, persisted timestamps are ignored and observation writes do not update `state.json`.
- `/dasein lapse reset` is the explicit clear exception: it clears both in-memory and persisted lapse timestamps even when `sensors.lapse.persist=false`, without changing `sensors.lapse.enabled`, `sensors.lapse.persist`, or `sensors.lapse.agent`.
- Stale builtin sensor readings are omitted or marked stale according to render config.

### 9.6 External State

- External state bridge accepts valid `dasein:state:set` events.
- External state bridge accepts valid `dasein:state:clear` events with payload exactly `{ key }`.
- External state bridge rejects clear events with `source`, wildcard, or any other unknown field.
- External state bridge rejects set events with unknown fields.
- External state bridge rejects malformed keys, including keys containing dots, malformed TTLs, missing payload strings, oversized strings, multiline strings, and strings containing control characters.
- External state bridge must not silently normalize multiline or control-character payloads into accepted single-line values.
- External state expires after `ttlMs`, or after the default `60000` ms when `ttlMs` is omitted from a valid set event.
- External publishers cannot force agent injection if Dasein config disallows it.
- Per-key external config controls UI and agent exposure independently; unconfigured keys are UI-visible by default and agent-hidden by default.

### 9.7 Sensor Loading and Reload

- User-added sensors are loaded only from `<extension_root>/src/sensors/*.ts` in this product scope.
- Directory/package-form extension installs support user-added sensors at `<extension_root>/src/sensors/*.ts`.
- Single-file extension installs do not support user-added sensors because there is no user-editable `<extension_root>/src/sensors/*.ts`; they can still run sensors bundled into the packaged Dasein build.
- The recommended install for user-added sensors is a standalone Dasein project symlinked as `~/.pi/agent/extensions/dasein`.
- A user-added sensor module that does not implement `SensorSpec` exactly as defined in `docs/TECHNICAL_DESIGN.md` fails validation and is reported as a load error without replacing the active runtime.
- A user-added sensor module that omits or malforms required `SensorSpec.manifest` fields for permissions, input classes, output fields, remote/network behavior, remote/network-capable status, or declared recurring/background-work fields where applicable fails validation and is reported as a load error without replacing the active runtime; source/provenance is loader-owned and is not required in `SensorSpec.manifest`.
- A valid user-added `SensorSpec` may use the fields, manifest metadata, refresh/render hooks, actions, and cleanup hooks defined by the Technical Design; Dasein core still owns loader provenance, final visibility checks, ordering, sanitization, limits, stale-reading behavior, and injection.
- Remote/network-capable user-added sensors default to disabled and require explicit user enablement after `/dasein sensors` or SettingsList exposes their inspectable metadata.
- User-added sensors that declare recurring/background work, including any positive effective `intervalMs`, default to disabled, cannot schedule recurring/background work while disabled, and require explicit human enablement after `/dasein sensors` or SettingsList exposes their inspectable metadata.
- `/dasein reload` with a valid candidate stops old sensors, runs cleanup, reloads `~/.pi/dasein/config.json`, reapplies launch overlays except for current-process runtime-overridden paths, rescans `<extension_root>/src/sensors/*.ts` where supported, restarts enabled sensors, and runs startup refresh for enabled sensors where applicable.
- `/dasein reload` with an invalid candidate keeps the last-known-good active config, sensors, runtime-overridden path set, and runtime state, reports errors, and performs no partial replacement.
- Enabled sensors may refresh on optional configured intervals from the Technical Design; sensor-owned actions may manually refresh where provided.
- LLM request-path injection never performs sensor refresh work and renders only in-memory readings.
- Stale readings are omitted or marked stale according to render config.
- Dasein does not load sensors from `~/.pi/dasein/sensors`.

## 10. Metrics

Initial success metrics are implementation-readiness metrics rather than adoption metrics.

- 100% of loaded sensors support `enabled`, `ui`, and `agent` configuration.
- 100% of LLM request-path injection is served from in-memory state.
- 0 subprocess, disk, network, or location calls occur during agent injection.
- Agent injected context is bounded by `core.maxAgentChars`, default `240` characters.
- All required slash commands have acceptance tests.
- Geo permission, precision, and agent exposure state are visible in at least one TUI surface.
- Runtime slash/UI config changes persist to `~/.pi/dasein/config.json` in the same successful operation that updates runtime behavior.

## 11. Dependencies

- Pi `0.78.1` is the current minimum target until broader compatibility is tested.
- Individual Pi mechanisms, including slash command registration, string launch flags, context-hook injection, TUI status/widget/`SettingsList`, `pi.events`, lifecycle hooks, and dynamic `.ts` sensor reload, are governed by the evidence-status table and live smoke gates in `docs/TECHNICAL_DESIGN.md`.
- Source/API verification alone does not equal release support; release support requires the relevant live smoke gate ledger or documented fail-closed behavior for unavailable mechanisms. Fake-host integration evidence must remain separate from release support claims.
- macOS CoreLocation for builtin geo sensor, subject to user/system permission. Native helper tests prove helper typecheck, runtime policy, and fail-closed mapping; they do not prove that a permission-blocked host can emit coordinates.
- Swift compiler or prebuilt app-bundled helper strategy for builtin geo sensor.
- Local filesystem access to `~/.pi/dasein/`.
- Dasein extension root access for `<extension_root>/src/sensors/*.ts` in directory/package-form installs.
- Single-file packaged Dasein install behavior for bundled sensors when no user-editable sensor directory exists.

## 12. Risks

- macOS CoreLocation permission UX may still require clear Pi/user guidance when the local `Dasein Location Helper` app first appears in Location Services.
- External publishers may send noisy, stale, or overly verbose state.
- Ambient context could consume excessive tokens if not strictly bounded.
- Runtime config precedence may confuse users unless `/dasein status` clearly shows effective values and sources.
- Immediate runtime persistence could surprise users who expect temporary changes; `/dasein status` and command feedback must make persistence clear.
- Location context could create privacy concerns if defaults or UI indicators are unclear.
- Request-path injection could accidentally grow expensive if sensors are allowed to compute during render.
- Dynamic sensor reload may leak module instances if abused; it must be manual and cleanup-driven.

## 13. Out of Scope

- Project-local Dasein config.
- Automatic file watching.
- Agent-callable configuration mutation tool.
- Policy/lock/rule engine.
- Cloud geolocation.
- Remote telemetry analytics.
- Full plugin marketplace.
- Loading sensors from `~/.pi/dasein/sensors`.
- Additional builtin sensors beyond clock, geo, and lapse.

## 14. Open Questions

Acceptance-critical questions for the initial PRD have been closed by the normative decisions in this revision.

Nonblocking future questions:

- Should a future release add a separate user sensor directory under `~/.pi/dasein/` or another user-controlled path?
- Should external state support per-key persistent visibility policy beyond the event payload's `agent` and `ui` strings?
- Should geo support alternative tag-match policies beyond nearest matching tag within radius?
- Which Pi versions earlier than `0.78.1`, if any, are compatible after explicit testing?
