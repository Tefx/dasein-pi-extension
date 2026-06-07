# Dasein Sensor Examples

These examples are copyable user-local sensors for Dasein.

## Focus sensor

Files:

```text
examples/sensors/focus.ts
examples/config/focus.config.json
```

What it does:

- exposes one local string field: `focus.label`;
- defaults to `enabled=true`, `ui=true`, `agent=true`;
- does not read files, run subprocesses, contact the network, or schedule recurring background work;
- validates `label` as a non-empty string up to 80 characters;
- includes a sensor action: `/dasein focus set <label>`.

Trust note: `focus.ts` is local TypeScript sensor code. Like any user-added sensor, it is trusted executable code when Dasein imports it during startup or `/dasein reload`; Dasein does not sandbox sensor modules.

### Install the example sensor

If you have a repo/package checkout, run this from the checkout root with `bash` or another Bash-compatible shell:

```bash
(
  set -euo pipefail
  if [ ! -f examples/sensors/focus.ts ]; then
    echo "examples/sensors/focus.ts not found; run this from the checkout root." >&2
    exit 1
  fi
  cat examples/sensors/focus.ts
  printf '%s' "Install this inspected trusted executable sensor to ~/.pi/dasein/sensors/focus.ts? Type yes: "
  IFS= read -r confirm
  if [ "$confirm" != "yes" ]; then
    echo "Not installed."
  elif [ -e ~/.pi/dasein/sensors/focus.ts ]; then
    echo "~/.pi/dasein/sensors/focus.ts already exists; leave it unchanged and merge intentionally."
  else
    mkdir -p ~/.pi/dasein/sensors
    cp examples/sensors/focus.ts ~/.pi/dasein/sensors/focus.ts
  fi
)
```

If you do not have a checkout, download the raw example to a temp file first. This raw-download snippet should be run with `bash` or another Bash-compatible shell, and requires `curl`. It defaults to `main` to match the README install command, but `main` can move. For reproducibility, set `DASEIN_REF` to the same tag or commit you installed with `pi install git:...@ref` or `pi -e git:...@ref`:

```bash
(
  set -euo pipefail
  DASEIN_REF="${DASEIN_REF:-main}"
  tmp="$(mktemp "${TMPDIR:-/tmp}/dasein-focus.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  curl -fsSL "https://raw.githubusercontent.com/Tefx/dasein-pi-extension/${DASEIN_REF}/examples/sensors/focus.ts" \
    -o "$tmp"
  cat "$tmp"
  printf '%s' "Install this inspected trusted executable sensor to ~/.pi/dasein/sensors/focus.ts? Type yes: "
  IFS= read -r confirm
  if [ "$confirm" != "yes" ]; then
    echo "Not installed."
    exit 0
  fi
  if [ -e ~/.pi/dasein/sensors/focus.ts ]; then
    echo "~/.pi/dasein/sensors/focus.ts already exists; leave it unchanged and merge intentionally."
  else
    mkdir -p ~/.pi/dasein/sensors
    cp "$tmp" ~/.pi/dasein/sensors/focus.ts
  fi
)
```

Then inside Pi:

```text
/dasein reload
/dasein sensors
/dasein inspect agent
```

Expected result fragments, not exact full output:

- `/dasein sensors` returns a result whose `data.sensors` includes the focus sensor, for example:

  ```text
  data.sensors: [..., { key: "focus", loaded: true, ... }, ...]
  ```

- `/dasein inspect agent` includes a focus label fragment only when agent injection is enabled and `focus` is agent-visible, for example:

  ```text
  label=coding
  ```

### Optional config

If you have a repo/package checkout and do not already have `~/.pi/dasein/config.json`, inspect and copy the example config without overwriting an existing file. Run this from the checkout root with `bash` or another Bash-compatible shell:

```bash
(
  set -euo pipefail
  if [ ! -f examples/config/focus.config.json ]; then
    echo "examples/config/focus.config.json not found; run this from the checkout root." >&2
    exit 1
  fi
  cat examples/config/focus.config.json
  if [ -e ~/.pi/dasein/config.json ]; then
    printf '%s' "~/.pi/dasein/config.json already exists. After inspecting the example config above, continue to manual merge instructions? Type yes: "
    IFS= read -r confirm
    if [ "$confirm" != "yes" ]; then
      echo "Not installed or merged."
      exit 0
    fi
    echo "Leave ~/.pi/dasein/config.json unchanged here; merge sensors.focus intentionally using the block below."
  else
    printf '%s' "Install this inspected config to ~/.pi/dasein/config.json? Type yes: "
    IFS= read -r confirm
    if [ "$confirm" != "yes" ]; then
      echo "Not installed."
      exit 0
    fi
    mkdir -p ~/.pi/dasein
    cp examples/config/focus.config.json ~/.pi/dasein/config.json
  fi
)
```

If you do not have a checkout, download to a temporary path first, inspect it, then copy or merge it intentionally. This raw-download snippet should be run with `bash` or another Bash-compatible shell, and requires `curl`. It defaults to `main` to match the README install command, but stable tag or commit pins are better for reproducible installed-package/example matching:

```bash
(
  set -euo pipefail
  DASEIN_REF="${DASEIN_REF:-main}"
  tmp="$(mktemp "${TMPDIR:-/tmp}/dasein-focus-config.XXXXXX")"
  trap 'rm -f "$tmp"' EXIT
  curl -fsSL "https://raw.githubusercontent.com/Tefx/dasein-pi-extension/${DASEIN_REF}/examples/config/focus.config.json" \
    -o "$tmp"
  cat "$tmp"
  if [ -e ~/.pi/dasein/config.json ]; then
    printf '%s' "~/.pi/dasein/config.json already exists. After inspecting the downloaded config above, continue to manual merge instructions? Type yes: "
    IFS= read -r confirm
    if [ "$confirm" != "yes" ]; then
      echo "Not installed or merged."
      exit 0
    fi
    echo "Leave ~/.pi/dasein/config.json unchanged here; merge sensors.focus intentionally using the block below."
  else
    printf '%s' "Install this inspected config to ~/.pi/dasein/config.json? Type yes: "
    IFS= read -r confirm
    if [ "$confirm" != "yes" ]; then
      echo "Not installed."
      exit 0
    fi
    mkdir -p ~/.pi/dasein
    cp "$tmp" ~/.pi/dasein/config.json
  fi
)
```

When config already exists, merge only this block into the existing file instead of overwriting unrelated settings:

```json
{
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

Then inside Pi:

```text
/dasein reload
/dasein inspect agent
```

Expected config result: `/dasein inspect agent` includes a stable configured label fragment, for example `label=debugging`, when the focus sensor is loaded/effectively enabled, `sensors.focus.agent=true`, and agent injection is enabled.

### Change the label from Pi

```text
/dasein focus set reviewing docs
```

Expected action result fragment from the action command:

```text
focus label: reviewing docs
```

The action mutates config only; it does not itself refresh or publish a new sensor snapshot. `/dasein inspect agent` shows the updated label only after a later sensor refresh, such as a `/dasein reload`-triggered startup refresh when the sensor remains loaded/effectively enabled and agent-visible.

Sensor action args are `string[]` tokens from the command tail; this action joins them with spaces, so `reviewing docs` becomes one label. The action proposes a config mutation through the backend `ConfigManager` under its own namespace (`sensors.focus.*`). Assignment paths are normalized and value-validated before persistence. `deletePaths`, when present, are path-normalized and limited to the sensor's namespace, but they are not checked as exposed scalar controls and do not run the same value/schema validation as assignments. The mutation is persisted and applied atomically; if any assignment path/value, delete path, or persistence step fails, the mutation is rejected and no partial assignment or deletion becomes active.
