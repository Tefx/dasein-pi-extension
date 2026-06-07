# Sensor Authoring Guide

This guide explains how to add a local Dasein sensor after installing Dasein as a Pi package.

## Current extension model

Dasein loads user-added sensors from two non-recursive scan roots:

```text
~/.pi/dasein/sensors/*.ts
<dasein-extension-root>/src/sensors/*.ts
```

Startup and `/dasein reload` both perform this same top-level-only `*.ts` scan. Dasein does not recurse into subdirectories and does not watch files automatically.

For normal users, prefer `~/.pi/dasein/sensors/*.ts`. You do not need to fork Dasein just to add a private local sensor.

Trust boundary: sensor `.ts` modules are trusted local executable code at import/reload time. Dasein does not sandbox sensor modules. Risk acknowledgement is evaluated after load and controls only post-load runtime enablement, scheduling, actions, and visibility.

If you installed Dasein from GitHub, remember the ref you installed:

```bash
DASEIN_REF="<tag-or-commit-or-branch>" # match your pi install git:...@ref
```

Pi manages that package clone. Do not edit Pi's managed clone directly unless you accept that `pi update` may reset and clean it. Put your own sensors in `~/.pi/dasein/sensors/` instead. Use the same `DASEIN_REF` when downloading raw examples; this gives stable installed-package/example matching only for tag or commit pins, because branch refs such as `main` can move.

Use a fork or local checkout only when you want to modify Dasein itself or bundle sensors with a custom Dasein package.

## Sensor file contract

A sensor is one TypeScript file under `~/.pi/dasein/sensors/` or `<dasein-extension-root>/src/sensors/` with exactly one default export: a `SensorSpec`-shaped object. User-local sensors should not rely on relative imports into Dasein's package source; the simplest user-local sensor is a plain default-exported object that Dasein validates at load time.

Required basics:

- `key`: stable ID matching `[A-Za-z0-9_-]{1,64}`.
- `defaults`: sensor config defaults. Include at least `enabled`, `ui`, and `agent`; common runtime defaults include `timeoutMs`, `staleAfterMs`, and `initialRefresh`.
- `manifest`: describes inputs, output fields, permissions, remote/network behavior, and background work.
  - `declaredInputClasses`: `time`, `pi_lifecycle`, `native_location`, `filesystem`, `subprocess`, `network`, `external_event`, or `derived`.
  - output `value_type`: `string`, `number`, `boolean`, `enum`, `object`, `array`, or `null`.
  - permission `kind`: `none`, `macos_location`, `filesystem`, `subprocess`, `network`, or `other`.
  - remote `transmissionCadence`: `none`, `manual`, `startup`, `interval`, or `event`; `disableControl`: `none`, `sensor.enabled`, or `sensor-specific`.
  - background `kinds`: allowed manifest values are `initial_refresh`, `recurring_interval`, and `pi_lifecycle_observe`. Use `recurring_interval` for scheduler intervals. Do not declare `pi_lifecycle_observe` in package or user-local sensors today: lifecycle observe dispatch is not a stable user extension point yet and current runtime dispatch observes only the built-in lapse sensor. `initial_refresh` is available for sensors that intentionally declare startup refresh as manifest background work, but the common `defaults.initialRefresh` runtime one-shot refresh can be `true` even when `backgroundWork.capable=false`. `intervalRelationship` is `none` unless `recurring_interval` uses `default_interval_sets_effective_interval_unless_overridden` with a positive `defaultIntervalMs`.
- `fields`: optional map of sensor-specific config controls such as `label`. Each field spec requires `label` and `type`; `description` is optional. Enum controls must declare a non-empty, duplicate-free `values` list for settings/config validation. Array/object field specs may also describe `item`, nested `fields`, and `additionalProperties` metadata for SettingsList and schema clarity. `actionManaged: true` means Dasein should not expose the field through generic scalar set/apply controls; manage it through sensor actions or manual config edits instead.
- `normalizeState(value, context)`: optional converter from refresh return value to typed state fields.
- `validateConfig(config)`: optional validator returning `[]` or validation errors shaped like `{ kind, path, message }`. Allowed `kind` values are `invalid-path`, `invalid-value`, `unknown-sensor`, `invalid-schema`, `persist-failed`, and `mutation-conflict`; sensor validators should generally use `invalid-value` or `invalid-schema` as appropriate.
- `refresh(context, previous)`: optional collector. It may return a raw value or `{ value, fields, metadata }`, synchronously or as a Promise.
- `observe(event, context, previous)`: internal/built-in lifecycle observer hook. Do not rely on it from package or user-local sensors until runtime dispatch explicitly supports user sensor lifecycle observe.
- `actions[name](args, context)`: optional user-invoked subcommands. `args` is a `string[]` of command-tail tokens; the focus example joins tokens with spaces. Return `{ ok: true, message?, refreshScheduled?, mutation?, data? }` or `{ ok: false, message }`.
- `cleanup()`: optional shutdown cleanup, sync or Promise.

Useful context contracts:

- Refresh `context` provides:
  - `context.config`: effective config for this sensor.
  - `context.signal`: abort signal for refresh timeout or cancellation; stop expensive work when it aborts.
  - `context.now()`: deterministic clock access supplied by Dasein; prefer it over direct wall-clock calls inside sensors.
- Refresh `previous` is a separate parameter: previous `SensorSnapshot` or `null`.
- Internal observe paths, where used by built-in sensors, may receive a cancellation signal, but user-local observe timeout/abort behavior is not a stable contract.
- Action `context` provides:
  - `context.sensorKey`: stable key for the invoked sensor.
  - `context.config`: effective config for this sensor.
  - `context.snapshot`: current `SensorSnapshot` or `null`.
  - `context.refreshNow({ reason, bypassBackoff? })`: run an immediate refresh request.
  - `context.scheduleRefresh(reason)`: schedule a follow-up refresh.
- Action `context` does not provide `signal`, `now()`, or `previous`.

Reserved keys are not allowed for sensors:

```text
status, reload, sensors, inspect, set, apply, help
```

Dasein core owns final rendering. Sensors return typed state; they do not write final prompt text, status text, ordering, truncation, or visibility policy.

## Minimal local sensor

This inline sample is intentionally minimal. The packaged focus example is the copyable complete version, including validation, an action, and matching config:

```text
examples/sensors/focus.ts
examples/config/focus.config.json
```

Create the file by opening it in your editor after confirming that you want to create a trusted local sensor file, for example:

```bash
sensor_file="$HOME/.pi/dasein/sensors/focus.ts"
printf 'Create %s and open it in your editor? [y/N] ' "$sensor_file"
read -r answer
case "$answer" in
  [Yy]|[Yy][Ee][Ss])
    mkdir -p "$(dirname "$sensor_file")"
    vi "$sensor_file"
    # Or run your preferred editor explicitly, for example:
    # code -w "$sensor_file"
    ;;
  *)
    echo "Cancelled. No sensor directory or file was created."
    ;;
esac
```

If you prefer not to paste code manually, copy `examples/sensors/focus.ts` from a checkout/package or follow the raw download steps in `examples/README.md`. Inspect the file before placing trusted executable `.ts` code in `~/.pi/dasein/sensors/`.

Example:

```typescript
const manifest = {
  description: "local manually configured focus label",
  declaredInputClasses: ["derived"],
  outputFields: [
    {
      state_key: "focus.label",
      value_type: "string",
      description: "current focus label",
      agentVisibleByDefault: true,
      uiVisibleByDefault: true,
    },
  ],
  permissions: [{ kind: "none", required: false, reason: "uses only local config" }],
  remote: {
    capable: false,
    contactsNetworkByDefault: false,
    destinations: [],
    payloadClasses: [],
    transmissionCadence: "none",
    disableControl: "none",
    description: "none",
  },
  backgroundWork: {
    capable: false,
    kinds: [],
    defaultIntervalMs: null,
    intervalRelationship: "none",
    description: "none",
  },
};

const focus = {
  key: "focus",
  defaults: {
    enabled: true,
    ui: true,
    agent: true,
    timeoutMs: 2000,
    staleAfterMs: 120000,
    initialRefresh: true,
    label: "coding",
  },
  manifest,
  fields: {
    label: {
      label: "Focus label",
      description: "Short local label exposed as the focus sensor value.",
      type: "string",
    },
  },
  refresh: (context) => context.config.label,
};

export default focus;
```

This declares low-risk runtime behavior under Dasein's acknowledgement model because it has no filesystem, subprocess, network, remote behavior, recurring interval, or lifecycle observer. Its `initialRefresh: true` may cause a one-shot startup/reload refresh from runtime config, but that is not itself a remote, recurring, or lifecycle background-risk declaration. It is still trusted executable `.ts` code at import/reload time; Dasein does not sandbox sensor modules.

For the copyable complete version with `validateConfig` and `/dasein focus set <label>`, copy `examples/sensors/focus.ts`.

## Load the sensor

After adding the file, run inside Pi:

```text
/dasein reload
/dasein sensors
/dasein status
/dasein inspect agent
```

Expected behavior:

- `/dasein reload` rescans `~/.pi/dasein/sensors/*.ts` and package-root `src/sensors/*.ts` for directory/package installs.
- `/dasein sensors` should list `focus` in `data.sensors`.
- `/dasein inspect agent` should show the current agent context block if agent injection is enabled and the sensor is agent-visible.

If reload fails, Dasein keeps the previous working registry/config active and reports load errors.

## Configure the sensor

Dasein stores config at:

```text
~/.pi/dasein/config.json
```

Each sensor owns its config namespace under `sensors.<key>.*`. If `~/.pi/dasein/config.json` already exists, merge the `sensors.focus` block into it; do not replace the whole file and lose unrelated settings. For the `focus` example:

```json
{
  "version": 1,
  "sensors": {
    "focus": {
      "enabled": true,
      "ui": true,
      "agent": true,
      "label": "debugging"
    }
  }
}
```

Then run:

```text
/dasein reload
```

You can also update simple fields through slash commands:

```text
/dasein set focus.label debugging
/dasein set focus.agent on
```

Sensor actions may propose config mutations instead of editing files directly:

```js
{
  backend: "ConfigManager",
  assignments: {
    "sensors.focus.label": "debugging"
  },
  deletePaths: ["sensors.focus.temporaryLabel"]
}
```

`deletePaths` is optional; include it only when an action needs to remove config keys.

Mutation semantics:

- Use canonical paths under your own namespace: `sensors.<key>.*`.
- Simple sensor-specific scalar controls are settable through `/dasein set`, `/dasein apply`, and ConfigManager proposals only when declared in `fields`, not `actionManaged`, and typed as `boolean`, `string`, `number`, or `enum`. Defaults may provide values, but defaults alone do not expose settable controls. Enum controls need explicit allowed values.
- Nested, object, and array fields should be action-managed with deliberate validation or manually edited in config; they are not generic scalar controls.
- Dasein core applies proposals through the backend `ConfigManager`; sensors should not write `~/.pi/dasein/config.json` themselves.
- Assignment paths are normalized and value-validated before persistence. Sensor-specific assignments must target exposed scalar controls, and the sensor's `validateConfig` hook is checked against the assigned candidate value.
- `deletePaths` entries are path-normalized and namespace-limited, then included in the same persisted/runtime mutation. They are not checked as exposed scalar controls and do not run the same value/schema validation as assignments.
- Use `deletePaths` only for optional keys owned by your sensor, such as action-managed nested data under `sensors.<key>.*`.
- If any assignment path/value, delete path, or persistence step fails, the whole mutation is rejected; no partial assignment or deletion becomes active.

## Risky sensors require acknowledgement

A user-added sensor is considered risky if it declares any of these:

- remote/network capability;
- `contactsNetworkByDefault: true`;
- required `network` permission;
- background work;
- a positive effective `intervalMs`.

Risky sensors are forced to effective `enabled=false` until the current manifest digest is acknowledged.

Important: acknowledgement is not a sandbox and does not make importing the `.ts` file safe. Sensor modules are already trusted executable code at import/reload time. The acknowledgement gate only controls post-load runtime enablement, scheduling, actions, and visibility.

Flow:

1. Add the sensor file.
2. Run:

   ```text
   /dasein reload
   /dasein sensors
   ```

3. Inspect the sensor metadata and copy its `manifestDigest`.
4. Enable it with the matching digest:

   ```text
   /dasein apply sensors.<key>.enabled=true,sensors.<key>.acknowledgedManifestDigest=<manifestDigest>
   ```

`enabled=true` alone is not enough for risky sensors; `sensors.<key>.acknowledgedManifestDigest` must match the current digest.

If the manifest, provenance path, declared inspectability metadata, or effective scheduling changes, the digest changes and the sensor must be acknowledged again.

## Remote/network manifest shape

If a sensor can contact a remote service, its manifest must say so clearly. Example remote block:

```typescript
remote: {
  capable: true,
  contactsNetworkByDefault: false,
  destinations: ["https://api.example.com"],
  payloadClasses: ["query"],
  transmissionCadence: "manual",
  disableControl: "sensor.enabled",
  description: "manual lookup against api.example.com",
}
```

If it has no remote behavior, use this exact no-remote manifest shape for the `remote` block:

```typescript
remote: {
  capable: false,
  contactsNetworkByDefault: false,
  destinations: [],
  payloadClasses: [],
  transmissionCadence: "none",
  disableControl: "none",
  description: "none",
}
```

## Background work shape

If the sensor has no background work, use:

```typescript
backgroundWork: {
  capable: false,
  kinds: [],
  defaultIntervalMs: null,
  intervalRelationship: "none",
  description: "none",
}
```

`defaults.initialRefresh: true` by itself is not a reason to set `backgroundWork.capable=true`; it only asks Dasein to run a one-shot refresh at startup/reload for effectively enabled sensors. Declare background work when the sensor itself has recurring intervals, or when the manifest intentionally treats startup refresh as background work that should require acknowledgement. Do not declare lifecycle observer background work for package or user-local sensors until runtime dispatch supports it as a stable extension point.

If it refreshes on an interval, declare that and expect acknowledgement:

```typescript
backgroundWork: {
  capable: true,
  kinds: ["recurring_interval"],
  defaultIntervalMs: 60000,
  intervalRelationship: "default_interval_sets_effective_interval_unless_overridden",
  description: "local recurring refresh",
}
```

Then include `intervalMs` in defaults if you want recurring scheduling.

## Validation checklist

After adding a user-local sensor, the immediate runtime check is:

```text
/dasein reload
/dasein sensors
```

For the `focus` example, expected evidence includes `focus` in `data.sensors` with the sensor loaded and effectively enabled. `/dasein inspect agent` should contain a stable label fragment such as `label=coding`, `label=debugging`, or `label=reviewing docs` only when the focus sensor is loaded/effectively enabled, `sensors.focus.agent=true`, and agent injection is enabled.

When developing inside a fork or local Dasein checkout, run the repository checks before pushing or publishing:

```bash
npm run typecheck
npm test
npm run package:check
```

Useful focused tests while developing package-root sensors and examples:

```bash
npm run test:file -- tests/unit/sensor-loader.test.ts tests/unit/sensor-runtime.test.ts tests/unit/renderer.test.ts tests/unit/sensors/loader-risk.test.ts tests/unit/example-sensors.test.ts
```

Maintainer package expectation: `npm run package:check` must keep `docs/SENSOR_AUTHORING.md`, `docs/config.sample.json`, `examples/README.md`, `examples/sensors/focus.ts`, and `examples/config/focus.config.json` in the packed Pi package so installed-package users can inspect authoring and config examples.

## Common mistakes

- Putting a sensor in a nested directory under `~/.pi/dasein/sensors`: only top-level `*.ts` files are scanned.
- Expecting Dasein to watch sensor files automatically; run `/dasein reload` after changes.
- Treating risky-sensor acknowledgement as sandboxing; `.ts` sensor code is trusted executable code at import/reload time.
- Editing Pi's managed package clone instead of using `~/.pi/dasein/sensors` for private sensors.
- Using relative imports into Dasein source from a user-local sensor; prefer a plain default-exported object unless you are developing inside the package root.
- Exporting `sensorSpec` as a named export: not accepted; use default export.
- Using a reserved key such as `status` or `inspect`.
- Declaring multiple output fields but returning a raw single value without `normalizeState` or `fields`.
- Mutating config outside your own `sensors.<key>.*` namespace.
- Writing `~/.pi/dasein/config.json` directly from sensor action code instead of returning a ConfigManager mutation proposal.
- Setting `enabled=true` for a risky sensor without `acknowledgedManifestDigest`.
- Expecting sensor code to control final prompt text; Dasein core owns final rendering.
- Editing Pi's managed git clone and then losing changes on `pi update`; use `~/.pi/dasein/sensors` for private sensors, or use a fork/local checkout for package changes.
