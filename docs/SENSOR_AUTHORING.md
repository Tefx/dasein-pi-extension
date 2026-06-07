# Sensor Authoring Guide

This guide explains how to add a local Dasein sensor after installing Dasein as a Pi package.

## Current extension model

Dasein loads user-added sensors from two non-recursive scan roots:

```text
~/.pi/dasein/sensors/*.ts
<dasein-extension-root>/src/sensors/*.ts
```

For normal users, prefer `~/.pi/dasein/sensors/*.ts`. You do not need to fork Dasein just to add a private local sensor.

If you installed Dasein from GitHub with:

```bash
pi install git:github.com/Tefx/dasein-pi-extension@main
```

Pi manages that package clone. Do not edit Pi's managed clone directly unless you accept that `pi update` may reset and clean it. Put your own sensors in `~/.pi/dasein/sensors/` instead.

Use a fork or local checkout only when you want to modify Dasein itself or bundle sensors with a custom Dasein package.

## Sensor file contract

A sensor is one TypeScript file under `~/.pi/dasein/sensors/` or `<dasein-extension-root>/src/sensors/` with exactly one default export: a `SensorSpec`-shaped object. User-local sensors should not rely on relative imports into Dasein's package source; the simplest user-local sensor is a plain default-exported object that Dasein validates at load time.

Required basics:

- `key`: stable ID matching `[A-Za-z0-9_-]{1,64}`.
- `defaults`: must include `enabled`, `ui`, and `agent`.
- `manifest`: must describe inputs, output fields, permissions, remote/network behavior, and background work.
- `refresh`: optional function that collects current state.
- `observe`: optional Pi lifecycle observer.
- `actions`: optional user-invoked subcommands.
- `cleanup`: optional shutdown cleanup.

Reserved keys are not allowed for sensors:

```text
status, reload, sensors, inspect, set, apply, help
```

Dasein core owns final rendering. Sensors return typed state; they do not write final prompt text, status text, ordering, truncation, or visibility policy.

## Minimal safe local sensor

A copyable version of this example is also available at:

```text
examples/sensors/focus.ts
examples/config/focus.config.json
```

Create:

```bash
mkdir -p ~/.pi/dasein/sensors
$EDITOR ~/.pi/dasein/sensors/focus.ts
```

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

This is safe because it has no filesystem, subprocess, network, remote behavior, or recurring interval.

For a more complete version with `validateConfig` and `/dasein focus set <label>`, copy `examples/sensors/focus.ts`.

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

For the `focus` example:

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

## Risky sensors require acknowledgement

A user-added sensor is considered risky if it declares any of these:

- remote/network capability;
- `contactsNetworkByDefault: true`;
- required `network` permission;
- background work;
- a positive effective `intervalMs`.

Risky sensors are forced to effective `enabled=false` until the current manifest digest is acknowledged.

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

`enabled=true` alone is not enough for risky sensors.

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

If it has no remote behavior, use the exact safe shape:

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

If it refreshes on an interval, declare that and expect acknowledgement:

```typescript
backgroundWork: {
  capable: true,
  kinds: ["initial_refresh", "recurring_interval"],
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

When developing inside a fork or local Dasein checkout, run the repository checks before pushing or publishing:

```bash
npm run typecheck
npm test
npm run package:check
```

Useful focused tests while developing package-root sensors:

```bash
npm run test:file -- tests/unit/sensor-loader.test.ts tests/unit/sensor-runtime.test.ts tests/unit/renderer.test.ts tests/unit/sensors/loader-risk.test.ts
```

## Common mistakes

- Putting a sensor in a nested directory under `~/.pi/dasein/sensors`: only top-level `*.ts` files are scanned.
- Editing Pi's managed package clone instead of using `~/.pi/dasein/sensors` for private sensors.
- Using relative imports into Dasein source from a user-local sensor; prefer a plain default-exported object unless you are developing inside the package root.
- Exporting `sensorSpec` as a named export: not accepted; use default export.
- Using a reserved key such as `status` or `inspect`.
- Declaring multiple output fields but returning a raw single value without `normalizeState` or `fields`.
- Setting `enabled=true` for a risky sensor without `acknowledgedManifestDigest`.
- Expecting sensor code to control final prompt text; Dasein core owns final rendering.
- Editing Pi's managed git clone and then losing changes on `pi update`; use `~/.pi/dasein/sensors` for private sensors, or use a fork/local checkout for package changes.
