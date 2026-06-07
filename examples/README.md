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

### Install the example sensor

```bash
mkdir -p ~/.pi/dasein/sensors
cp examples/sensors/focus.ts ~/.pi/dasein/sensors/focus.ts
```

Then inside Pi:

```text
/dasein reload
/dasein sensors
/dasein inspect agent
```

Expected result:

- `/dasein sensors` lists `focus` in `data.sensors`.
- `/dasein inspect agent` includes the configured focus label when agent injection is enabled.

### Optional config

You can copy the example config into your Dasein config if you do not already have one:

```bash
mkdir -p ~/.pi/dasein
cp examples/config/focus.config.json ~/.pi/dasein/config.json
```

If you already have `~/.pi/dasein/config.json`, merge only the `sensors.focus` block into your existing file instead of overwriting it.

Then inside Pi:

```text
/dasein reload
```

### Change the label from Pi

```text
/dasein focus set reviewing docs
/dasein inspect agent
```

The action proposes a config mutation under `sensors.focus.*`; Dasein core validates, persists, and applies it.
