# Dasein Pi Extension

Dasein is a local Pi extension that gives coding-agent sessions bounded ambient context.

It collects local sensor state, keeps privacy-sensitive fields gated by config, and appends the selected context to Pi's agent system prompt path. It is not a daemon, memory product, workflow engine, policy layer, or cloud service.

## What it adds

- A compact agent context block for useful local facts such as time, idle continuity, and explicitly enabled external context.
- Optional local sensors for clock, lapse/continuity, and macOS location.
- Quiet-by-default status behavior: normal healthy state does not occupy persistent footer space.
- On-demand diagnostics through `/dasein status`, `/dasein sensors`, and `/dasein inspect agent`.
- Local config under `~/.pi/dasein/config.json`.

## Install from GitHub

Dasein is a Pi coding-agent extension installed with `pi install`. Until an npm release exists, install it from GitHub using Pi's `git:` package source, not GitHub Packages and not `npm:`.

Prerequisites/checks:

- Pi coding-agent is installed and `pi` is on your PATH.
- Node.js 20 or newer is available to Pi.
- `git` is available for `git:` installs.
- Minimum supported Pi coding-agent version is `0.78.1` or later. This checkout's current live-smoke evidence is against Pi `0.78.1`; do not treat that as evidence that every later Pi version has been live-tested. `/dasein status` surfaces known Pi support and mechanism evidence when available, including negative runtime probe results when Pi exposes them.

```bash
pi install git:github.com/Tefx/dasein-pi-extension@main
```

`@main` is convenient for the latest repository state, but it is mutable. For a reproducible install, and for raw example downloads that keep matching the installed package, pin a tag or commit instead:

```bash
DASEIN_REF="replace-with-tag-or-commit"
pi install "git:github.com/Tefx/dasein-pi-extension@${DASEIN_REF}"
```

Then restart Pi and check:

```text
/dasein status
```

Expected result: the command should start with `dasein status: ok` when no `statusErrors` are present, or `dasein status: degraded` when Dasein has recorded `statusErrors`, such as unavailable feature errors. Support/version fields such as `piVersion`, `minimumPiVersion`, and `piSupportClassification` are data fields to inspect separately; they do not by themselves determine the compact `ok`/`degraded` wording. Do not depend on exact formatting, but stable result fragments/keys include `data`, `statusErrors`, `piVersion`, `minimumPiVersion`, `piSupportClassification`, `piMechanisms`, `evidenceStatuses`, `effectiveConfigVersion`, `activeSensors`, `disabledSensors`, `hiddenContributors`, `permissions`, `sensorMetadata`, `loadErrors`, `rendered.omittedKeys`, and `rendered.truncated`.

To try it for one Pi run without installing it into your Pi settings:

```bash
pi -e git:github.com/Tefx/dasein-pi-extension@main
```

Compatibility note: Dasein is a Pi package, not a standalone daemon. The minimum supported Pi coding-agent version is `0.78.1` or later until compatibility testing expands. The current repository support evidence is recorded in `docs/TECHNICAL_DESIGN.md`; this checkout has live-smoke evidence against Pi `0.78.1` only. Mechanism evidence in `/dasein status` may come from the release ledger, source/API support evidence, negative runtime probes when Pi exposes them, or errors observed while using a mechanism. It is not a guarantee that every missing host mechanism is detected before use.

## Local development install

From a local checkout:

```bash
pi install /absolute/path/to/dasein-pi-extension
```

Or for one run only:

```bash
pi -e /absolute/path/to/dasein-pi-extension
```

Local path installs point directly at the working directory. If package code changes, restart Pi. `/dasein reload` reloads Dasein config and supported sensors only; it is not a Pi package-code reload.

## Basic usage

Inside Pi:

```text
/dasein
/dasein status
/dasein sensors
/dasein inspect agent
/dasein reload
/dasein help
```

Useful checks:

- `/dasein status` shows effective config, sensor health, hidden/degraded contributors, and Pi support evidence.
- `/dasein sensors` shows loaded sensors, load errors, permissions, background/remote declarations, and user-added sensor acknowledgement state.
- `/dasein inspect agent` shows the exact ambient context block Dasein would append to the next agent request.

Agent injection mechanism: Dasein appends that block to Pi's per-turn `before_agent_start` `systemPrompt` (`event.systemPrompt`). It does not inject user-role content and does not use Pi `CustomMessage` entries for ambient context.

## Privacy defaults

Dasein defaults are intentionally conservative:

- Agent context injection is enabled by default because it is the main product value.
- Location is disabled by default.
- Location agent exposure is disabled by default.
- Exact coordinates and exact address are disabled by default even if geo is later enabled.
- External context is agent-hidden unless explicitly configured.
- Normal healthy status is quiet by default.

A starter config is available at:

```text
docs/config.sample.json
```

Copy the parts you need into:

```text
~/.pi/dasein/config.json
```

Then run:

```text
/dasein reload
```

## macOS location note

The geo sensor uses a local `Dasein Location Helper` app bundle so macOS Location Services can show a clear permission prompt. Background initial/interval refreshes check existing permission without opening the macOS authorization prompt; use `/dasein geo refresh` when you explicitly want to authorize or refresh location. If location remains unavailable, open macOS Location Services settings and approve Dasein Location Helper, then run `/dasein geo refresh` or restart Pi. If macOS shows `LocationHeader` instead of `Dasein Location Helper`, update/restart Dasein so it can rebuild and resign the stale helper bundle; as an immediate stopgap, disable geo with `/dasein set sensors.geo.enabled false` and `/dasein reload`.

## User-added sensors

User-added sensors can be added without forking Dasein. Put top-level `*.ts` sensor files in:

```text
~/.pi/dasein/sensors/
```

Dasein also scans package-root sensors from `src/sensors/*.ts`. Startup and `/dasein reload` use the same top-level-only scan: no recursion and no file watcher.

Important trust boundary: user-added `.ts` sensor modules are trusted local executable code at import/reload time. Dasein does not sandbox them. The risky-sensor acknowledgement mechanism runs after the module has loaded; it controls post-load runtime enablement, scheduling, actions, and visibility only.

For copyable examples and the step-by-step tutorial, see:

```text
examples/README.md
docs/SENSOR_AUTHORING.md
```

Risky user-added sensors, such as sensors that declare network/remote behavior or recurring background work, are forced effectively disabled until you inspect and acknowledge their current manifest digest. Use:

```text
/dasein sensors
```

SettingsList or explicit config can then enable the sensor by setting both `sensors.<key>.enabled=true` and `sensors.<key>.acknowledgedManifestDigest` to the matching current digest. `enabled=true` alone is ineffective until that digest is acknowledged.

## Release and verification

For release candidates:

```bash
npm run release:check
```

This runs typecheck, ordinary non-live tests, native tests, package checks, and live Pi smoke tests. Ordinary `npm test` intentionally excludes live smoke.

Focused maintainer checks for docs/examples/package inclusion:

```bash
npm run test:file -- tests/unit/example-sensors.test.ts tests/static/package-json.test.ts tests/static/contracts/scaffold-package-contract.test.ts tests/static/contracts/package-json-suite.test.ts
npm run package:check
```

`npm run package:check` runs `npm pack --dry-run --json` and verifies that runtime package artifacts include the sensor authoring guide, sample config, and example sensor/config/docs while excluding tests, scripts, local state, and lock/plan files.

Package/release details are in:

```text
docs/RELEASE.md
```

## Package model

Dasein ships as a source Pi package. Pi loads:

```text
./index.ts
```

Runtime dependencies are intentionally empty. Pi-owned imports are peer dependencies. Published package contents intentionally include `docs/SENSOR_AUTHORING.md`, `docs/config.sample.json`, and `examples/` so installed-package users can inspect authoring/config examples.
