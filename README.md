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

Dasein is a Pi package. Until an npm release exists, install it from GitHub using Pi's `git:` package source, not GitHub Packages and not `npm:`.

```bash
pi install git:github.com/Tefx/dasein-pi-extension@main
```

For a reproducible install, pin a tag or commit instead of `main`:

```bash
pi install git:github.com/Tefx/dasein-pi-extension@<tag-or-commit>
```

Then restart Pi and check:

```text
/dasein status
```

To try it for one Pi run without installing it into your Pi settings:

```bash
pi -e git:github.com/Tefx/dasein-pi-extension@main
```

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

The geo sensor uses a local `Dasein Location Helper` app bundle so macOS Location Services can show a clear permission prompt. If location remains unavailable, open macOS Location Services settings and approve Dasein Location Helper, then run `/dasein geo refresh` or restart Pi.

## User-added sensors

User-added sensors are loaded from this package's `src/sensors/*.ts` directory for supported directory/package installs.

For a step-by-step tutorial, see:

```text
docs/SENSOR_AUTHORING.md
```

Risky user-added sensors, such as sensors that declare network/remote behavior or recurring background work, are forced effectively disabled until you inspect and acknowledge their current manifest digest. Use:

```text
/dasein sensors
```

SettingsList or explicit config can then enable the sensor with the matching current digest.

## Release and verification

For release candidates:

```bash
npm run release:check
```

This runs typecheck, ordinary non-live tests, native tests, package checks, and live Pi smoke tests. Ordinary `npm test` intentionally excludes live smoke.

Package/release details are in:

```text
docs/RELEASE.md
```

## Package model

Dasein ships as a source Pi package. Pi loads:

```text
./index.ts
```

Runtime dependencies are intentionally empty. Pi-owned imports are peer dependencies.
