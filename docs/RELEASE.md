# Dasein Release and Pi Package Guide

## Package Model

Dasein ships as a Pi package source package.

Pi loads the extension from `package.json`:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

The published tarball includes only runtime source and user-facing docs. It does not include tests, scripts, local proof ledgers, `node_modules`, vectl state, plan files, or TypeScript project tooling.

Pi-owned runtime imports stay in `peerDependencies` with `"*"` ranges and are not bundled:

- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

Current release scope allows no non-Pi runtime npm dependencies.

## Install Channels

Supported channels follow Pi package semantics:

```bash
pi install npm:dasein-pi-extension@<version>
pi install git:<repo-url>@<tag-or-commit>
pi install /absolute/path/to/dasein-pi-extension
pi -e /absolute/path/to/dasein-pi-extension
```

Notes:

- Versioned npm specs are pinned by Pi and skipped by package updates.
- Git refs are pinned by Pi; `pi update` reconciles to the configured ref but does not move to a newer ref.
- Local paths are not copied; they point at the working directory on disk.
- Project-scoped installs via `pi install -l ...` may be used for team trials, but Dasein runtime configuration remains in Dasein's documented config root and is not inferred from project package settings.

## Release Candidate Gate

Run:

```bash
npm run release:check
```

This expands to:

```bash
npm run typecheck
npm test
npm run test:native
npm run package:check
npm run test:smoke
```

Gate meanings:

- `typecheck`: TypeScript boundary and contract typing.
- `npm test`: all-platform non-native/non-smoke tests.
- `test:native`: macOS helper contract; skips explicitly on non-macOS.
- `package:check`: `npm pack --dry-run --json` metadata/tarball allowlist check.
- `test:smoke`: live Pi mechanism and TUI/process evidence gate.

A release support claim MUST cite the live-smoke evidence generated for that release candidate. Fake-host tests, source inspection, and API-shape tests do not satisfy release support claims.

## Package Dry-Run Gate

Run:

```bash
npm run package:check
```

The checker verifies:

- package is publishable (`private` is not `true`);
- `keywords` includes `pi-package`;
- `pi.extensions` includes `./index.ts`;
- runtime dependencies remain empty;
- Pi runtime imports are peer dependencies with `"*"` range;
- package `files` allowlist includes runtime source and required docs;
- dry-run tarball contains required runtime files;
- dry-run tarball excludes development-only and local-state files.

Use this before any `npm publish`, git tag, or package install smoke.

## NPM Release Procedure
1. Ensure the version in `package.json` is the intended release version.
2. Run `npm run release:check`.
3. Inspect package contents:

   ```bash
   npm pack --dry-run
   ```

4. Publish from a clean working tree:

   ```bash
   npm publish
   ```

5. Verify install in a clean Pi profile or temporary environment using the documented npm install channel:

   ```bash
   pi install npm:dasein-pi-extension@<version>
   ```

   Then start Pi normally for that profile and run `/dasein status` or the release smoke procedure needed for the support claim. Do not cite undocumented npm execute specs unless Pi documentation adds support and live evidence is captured.

6. Retain the release-candidate smoke artifacts for the release note.

## Git Release Procedure
1. Run `npm run release:check`.
2. Create a signed or annotated tag if available:

   ```bash
   git tag -a v<version> -m "dasein v<version>"
   git push origin v<version>
   ```

3. Verify the pinned ref through the documented git install channel:

   ```bash
   pi install git:<repo-url>@v<version>
   ```

   Then start Pi normally for that profile and run `/dasein status` or the release smoke procedure needed for the support claim. Do not cite undocumented git execute specs unless Pi documentation adds support and live evidence is captured.

Git installs run `npm install` when `package.json` exists. Dasein still depends only on Pi-owned peers and development tooling is not required at runtime.

## Local Trial Procedure

Use local path installs for development and operator testing:

```bash
pi -e /absolute/path/to/dasein-pi-extension
pi install /absolute/path/to/dasein-pi-extension
```

Local path installs point directly to the directory. They are not immutable release artifacts and MUST NOT be cited as npm release proof.

## Rollback
- For npm installs, install a previous versioned spec.
- For git installs, install a previous tag or commit ref.
- For local installs, switch the local checkout and restart Pi when extension package code changed. Use Dasein's `/dasein reload` only for Dasein disk config and supported sensor reload behavior; it is not a Pi package-code reload command.

Runtime config is separate from package installation and remains under Dasein configuration management.
