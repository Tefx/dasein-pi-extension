# Dasein Project Constitution

## Mission

`dasein-pi-extension` is a standalone local Pi extension that provides an ambient context broker and sensor framework for Pi coding-agent sessions.

Dasein collects typed ambient state, exposes selected state to humans, and injects selected state into Pi LLM context through explicit, configurable mechanisms.

Dasein is not a time plugin, space plugin, clock plugin, geo plugin, lapse plugin, continuity plugin, policy engine, workflow engine, memory product, or ranking system. Clock, geo, and lapse are builtin sensors. Continuity is a semantic property of lapse, not a separate builtin sensor. Builtin sensors are not the core product.

Dasein MUST be loadable as a Pi extension from:

```text
~/.pi/agent/extensions/dasein
```

## Constitution Version and Amendment Lifecycle

1. This constitution version is `1.0.0`, dated `2026-06-06`.
2. This constitution is a compact source of truth for constraints; it MUST NOT be treated as a substitute for executable verification gates.
3. Every technical MUST in this constitution MUST map to schema, static, unit, golden, live, or equivalent automated checks where feasible.
4. Manual review MUST be a last resort for non-automatable semantics, privacy judgment, and support-claim judgment.
5. Amendments that change constitutional constraints MUST be approved by the human project owner before merge; ordinary implementation PRs MUST NOT require owner approval merely because this constitution exists.
6. Amendment evidence MUST include the reason for change, affected invariants, verification performed, and compatibility or migration notes.
7. Compatibility or migration notes MUST state affected configuration, sensor contract, UI, testing gate, or runtime behavior changes; if none exist, the notes MUST explicitly say `none`.
8. Constitution review MUST be event-triggered, lightweight, and REQUIRED only when core injection logic, sensor interfaces, configuration schema, privacy rules, Pi mechanism support claims, or constitutional constraints change.
9. When automated gates cover a constitutional constraint change or implementation change, review evidence MAY cite those gate artifacts instead of duplicating manual analysis.
10. Amendments MUST NOT add feature roadmaps, target-user narratives, or speculative product design.

## Non-Goals

Dasein MUST NOT implement hidden agent memory.

Dasein MUST NOT infer global user intent from sensor state.

Dasein MUST NOT rank, prioritize, or privilege sensors through hidden semantics.

Dasein MUST NOT implement an agent behavioral policy layer, workflow policy layer, priority policy layer, task-ranking layer, access-control layer, or autonomous decision layer.

Dasein MUST enforce product safety and privacy constraints for sensor declaration, permissions, collection, retention, visibility, and injection.

Dasein MUST NOT convert ambient context into agent instructions, behavioral policy, task ranking, workflow decisions, or priority semantics.

Dasein MUST NOT perform autonomous configuration mutation.

Dasein MUST NOT run hidden or undeclared watchers, filesystem observation, network polling, or recurring work.

Dasein MUST NOT run automatic file watchers.

Dasein defaults MAY include documented builtin local sensor refresh intervals only when they are declared in defaults, visible in `/dasein status` and settings, configurable, disableable, and cleanup-safe.

User-added sensors MUST NOT run recurring work by default.

Dasein MUST NOT require, infer, or read project-local configuration.

Dasein MUST NOT treat builtin sensors as product-defining features.

Dasein MUST NOT become a general plugin marketplace, scheduler, daemon supervisor, or external automation framework.

Dasein MUST NOT make ambient context invisible to the human.

## Architectural Dogmas

1. The architecture MUST remain minimal, local, and dependency-light.
2. The initial implementation MUST use 0 non-Pi external runtime npm dependencies. Pi-owned packages REQUIRED by documented Pi extension or TUI APIs, including `@earendil-works/pi-tui` for `SettingsList`, MAY be declared only as Technical Design-approved Pi peer dependencies, not bundled runtime dependencies, and package/static gates MUST verify them. Arbitrary npm dependencies MUST NOT be declared.
3. The core MUST be a context broker, not a sensor implementation.
4. Sensors MUST publish typed state.
5. Dasein core MUST own typed state normalization, deterministic ordering, truncation, token budgets, renderable view models, and Pi context injection.
6. Dasein core MUST normalize sensor state to the typed-state envelope and MUST drop every sensor state field outside that envelope before storage, rendering, or injection.
7. Sensor-owned final injection text, injection order, or ordering-control fields MUST NOT survive core normalization.
8. The Pi extension/UI shell MUST own Pi display plumbing, including `setStatus`, `setWidget`, `SettingsList`, command registration, event wiring, and widget/status rendering.
9. Sensors MUST NOT format final prompt text directly.
10. Sensors MUST NOT decide injection priority.
11. Sensors MUST NOT mutate Dasein configuration.
12. Dasein MUST use global configuration only under:

   ```text
   ~/.pi/dasein/
   ```

13. Configuration precedence MUST be:

   ```text
   defaults < global disk config < launch args < slash/UI runtime changes
   ```

14. Dasein MUST NOT read any implicit configuration source.
15. Dasein MUST NOT read any project-local config file.
16. Dasein MUST NOT walk upward from a working directory to discover configuration.
17. Project-specific behavior MUST use explicit launch args or a future human-selected global profile stored under `~/.pi/dasein/`; it MUST NOT use implicit project-local reads.
18. Future profile selection MUST be explicit, human-visible, and global-to-Dasein; profile selection MUST NOT be inferred from repository files or current working directory.
19. Runtime context injection MUST be deterministic for a given configuration and typed sensor state.
20. Render order MUST be deterministic: configured core `renderOrder` first, then all remaining enabled sensor keys in lexicographic order by stable `sensor_id` and `state_key`.
21. Dasein core MUST own all context budgets and truncation decisions.
22. Dasein MUST preserve a strict boundary between sensor collection, typed state normalization, human-visible configuration, renderable view models, Pi UI plumbing, and final injection.
23. Only human-triggered launch configuration, slash commands, or UI controls MAY mutate Dasein configuration.
24. The LLM request path and ordinary agent runtime path MUST be read-only with respect to Dasein configuration unless a future explicit human-approved tool is added.

## Quality Baselines

1. TypeScript source MUST be typed at module boundaries.
2. Sensor interfaces MUST be schema-validated before state enters core storage.
3. Golden rendering tests MUST verify deterministic ordering, truncation markers, disabled key visibility, omitted key visibility, and default compact formatting.
4. Static import checks MUST verify the request-path injector boundary.
5. Static schema checks MUST verify that sensors publish the required typed-state envelope before core storage.
6. Normalization tests MUST verify that Dasein core drops fields outside the typed-state envelope before rendering or injection.
7. Manual review MUST be limited to non-automatable semantics, privacy copy, permission explanations, and support-claim judgment that executable gates cannot prove.
8. Mock tests MUST NOT be treated as integration proof.
9. Black-box liveness evidence MUST take precedence over mock-only coverage for extension integration claims.
10. A default injected agent-context string for any single sensor state entry MUST be <= 240 characters before core truncation, unless an explicit human-configured verbose mode is active.

## Privacy and Safety Laws

1. Builtin state MUST be visible to the human when enabled.
2. External state MUST be visible to the human when enabled.
3. Every enabled sensor MUST be configurable by the human.
4. Every injected field MUST be traceable to a configured sensor or external state key.
5. Dasein MUST NOT collect or inject hidden fields.
6. Remote or network-capable sensors MUST be default-off.
7. Remote or network-capable sensors MUST require explicit human opt-in before any network transmission.
8. Remote or network-capable sensors MUST expose the destination, payload class, transmission cadence, and disable control before enablement and while enabled.
9. Dasein MUST NOT transmit sensor state to remote services unless an explicit human-visible sensor declares that behavior and the human enables it.
10. Dasein MUST NOT read project files as ambient context unless a sensor explicitly declares that input and the human enables it.
11. Dasein MUST NOT implicitly read project files for configuration, profile selection, sensor selection, render order, or injection behavior.
12. Dasein MUST NOT store secrets in logs, status widgets, rendered context, or default configuration.
13. Dasein MUST NOT keep durable ambient history by default.
14. Any durable persistence of ambient state MUST declare an explicit purpose, retention boundary, human inspect/clear UI, and separate controls for collection, persistence, and injection.
15. Agents MUST NOT modify Dasein config unless a future explicit human-approved tool exists for that purpose.
16. Product safety and privacy constraints MUST be enforced even though Dasein has no agent behavioral/workflow policy layer.

## Performance Laws

1. The context injector module MUST consume already-available in-memory typed state only.
2. The request-path injector MUST NOT import or call `fs`, `child_process`, `http`, `https`, `net`, `tls`, `dns`, `fetch`, `XMLHttpRequest`, `WebSocket`, dynamic `import()`, any sensor refresh API, or any module that performs filesystem, subprocess, network, dynamic import, sensor refresh, or configuration mutation work.
3. The runtime path that injects context MUST NOT perform disk I/O.
4. The runtime path that injects context MUST NOT perform subprocess calls.
5. The runtime path that injects context MUST NOT perform network calls.
6. The runtime path that injects context MUST NOT trigger sensor load, start, refresh, action execution, cleanup, discovery, or configuration mutation.
7. Sensors that require I/O MUST publish cached typed state before injection time.
8. Slow, failing, stale, or unavailable sensors MUST NOT block prompt construction.
9. Dasein MUST fail safely for unavailable sensor state by omitting or marking that state according to configuration.
10. Dasein MUST keep extension startup work minimal.
11. Long-running sensor work MUST be isolated from prompt injection.
12. The injector import/call boundary MUST be enforceable by static import checks and targeted unit tests.

## Token Economy Laws

1. Dasein core MUST own all truncation.
2. Sensors MUST publish structured state, not unbounded prose.
3. Each injected context block MUST have a configured or hardcoded character budget owned by core.
4. Dasein MUST NOT inject raw unbounded sensor output.
5. `/dasein status` MUST show disabled, truncated, and omitted context keys for the active session, unless a documented exception identifies the exact unavailable surface and the alternative human-visible inspection path.
6. Any Pi status/widget surface that summarizes Dasein state MUST expose or link to `/dasein status` for disabled, truncated, and omitted key details.
7. Context formatting MUST be compact by default.
8. Defaults MUST favor low token usage over completeness.
9. Any verbose mode MUST be explicit and human-configurable.

## UX and Pi Interaction Red-lines

1. Dasein MUST expose enabled sensors and current state visibility through Pi UI surfaces.
2. Dasein MUST expose configuration state through a human-readable UI path.
3. Dasein MUST expose retention, persistence, and injection controls separately when persistence exists.
4. Any UI/Pi mechanism MUST be live-verified against a real Pi extension load or live Pi binary path and documented before release support is claimed.
5. The currently API/source-verified mechanism candidates are planning candidates, not live support claims:
   - `registerCommand`
   - `registerFlag` with string values
   - `context` hook
   - `pi.events`
   - `setStatus`
   - `setWidget`
   - `SettingsList`
6. This constitution MUST NOT claim live verification for any Pi mechanism unless corresponding live evidence exists.
7. Technical Design and evidence documentation MUST distinguish API/source observations from release support claims and MUST reference executable verification artifacts when feasible, or explicit live smoke signoff status for pure UI mechanisms.
8. Future Pi mechanisms MAY be supported only after live verification with executable artifacts or explicit signoff status.
9. UI changes MUST reflect effective configuration after precedence resolution.
10. Slash/UI runtime changes MUST override launch args for the active runtime session.
11. UI MUST NOT imply hidden priority semantics.
12. UI MUST NOT hide builtin sensors behind product terminology that misrepresents Dasein as a time/space plugin.
13. UI MUST provide a visible disable path for every enabled sensor.
14. UI support claims MUST include the mechanism name, Pi version, relevant binary path, and evidence as either automated headless/snapshot execution artifacts or explicit live smoke signoff status for pure UI mechanisms.

## Extension and Sensor Laws

1. Dasein MUST run as a Pi extension.
2. The extension entrypoint MUST be compatible with symlinked loading from:

   ```text
   ~/.pi/agent/extensions/dasein
   ```

3. Sensor interfaces MUST be typed.
4. Sensor output MUST include these REQUIRED typed-state envelope fields using exact names:
   - `contract_version`: sensor contract version
   - `schema_version`: typed-state schema version
   - `sensor_id`: stable sensor identifier
   - `state_key`: stable key within the sensor
   - `value`: typed value
   - `value_type`: value type
   - `collected_at`: collection timestamp
   - `stale_after_ms`: stale-after duration in milliseconds
   - `status`: one of `enabled`, `disabled`, `stale`, or `error`
   - `source`: traceability metadata identifying origin and declared input
5. Builtin sensors MUST obey the same interface as user-added sensors.
6. External state publishers MUST NOT gain special privileges over builtin sensors.
7. Builtin sensors MUST NOT gain hidden priority over external state.
8. Builtin sensors are limited to clock, geo, and lapse unless this constitution is explicitly amended.
9. Sensor discovery MUST be explicit and inspectable.
10. User-added sensors MUST load only from explicit local sensor files configured by the human. User-added local sensor modules are trusted local executable code at import/load time; Dasein is not a sandbox for arbitrary `.ts` top-level side effects.
11. User-added sensor source, permissions, declared inputs, declared outputs, and remote behavior MUST be inspectable by humans before enablement. Privacy/default-off rules for user-added sensors govern compliant Dasein-controlled runtime behavior after loading, including refresh, actions, background work, and network transmission; they MUST NOT be represented as protection against malicious import-time code execution.
12. Dasein MUST NOT implement remote sensor marketplace semantics, remote package install semantics, or automatic third-party sensor loading.
13. Sensor configuration MUST be explicit.
14. Sensor failure MUST be represented as typed state or absence, not as injected exception text.
15. Dasein core MUST remain sensor-agnostic.
16. Adding a sensor MUST NOT require changing core injection semantics.
17. The minimal REQUIRED sensor contract is stable `sensor_id`, stable `state_key`, declared defaults, and publication of the typed-state envelope.
18. Sensor refresh, actions, cleanup, and background work are OPTIONAL capabilities. Watchers, filesystem observation, network polling, and recurring work MUST be declared and MUST NOT run by default, except documented builtin local sensor refresh intervals declared in defaults. Automatic file watchers MUST NOT run. Documented builtin local sensor refresh intervals MAY run only when visible in `/dasein status` and settings, configurable, disableable, and cleanup-safe. User-added sensors MUST NOT run recurring work by default.
19. Sensor refresh MAY collect or update typed state only within declared inputs and permissions.
20. Sensor actions MAY run only after explicit human invocation or explicit human-visible enablement of that action path.
21. Sensor cleanup MAY release resources and MUST NOT mutate unrelated configuration.
22. Sensors MAY use internal implementation fields before publication, but only the typed-state envelope MAY enter core storage.
23. Dasein core MUST discard every published field outside the typed-state envelope before rendering or injection.
24. Sensor-owned final injection text, injection order, or ordering-control fields MUST NOT survive core normalization.
25. Injection ordering MUST be controlled only by Dasein core `renderOrder`.
26. Sensor disablement MUST stop collection paths owned by that sensor and prevent injection of enabled-state values.

## Testing and Gates

1. Mock tests MUST NOT be treated as integration proof.
2. Any Pi extension boundary MUST be verified against the real Pi extension runtime or an equivalent live Pi binary path.
3. Static and unit checks MUST verify the configuration precedence order:

   ```text
   defaults < global disk config < launch args < slash/UI runtime changes
   ```

4. Static and unit checks MUST verify that no implicit or project-local Dasein configuration source is read.
5. Static import checks MUST verify that runtime context injection performs no disk I/O, subprocess calls, network calls, dynamic imports, sensor refresh, or configuration mutation.
6. Static import checks MUST verify that the request-path injector module does not import or call forbidden modules or APIs named in the Performance Laws.
7. Schema validation MUST verify that sensors publish the required typed-state envelope and do not own final prompt formatting.
8. Golden rendering tests MUST verify that Dasein core owns formatting, deterministic ordering, truncation, renderable view models, and injection.
9. Schema validation and golden rendering tests MUST assert structural injection control by verifying:
   - required typed-state envelope fields are present with exact names: `contract_version`, `schema_version`, `sensor_id`, `state_key`, `value`, `value_type`, `collected_at`, `stale_after_ms`, `status`, and `source`
   - Dasein core drops every field outside the typed-state envelope before rendering or injection
   - sensor-owned final injection text, injection order, and ordering-control fields do not survive core normalization
   - core `renderOrder` is honored first
   - remaining enabled keys render lexicographically by stable `sensor_id` and `state_key`
   - Dasein core alone applies budgets and truncation
10. Static checks and unit tests MUST verify that agents and LLM request handling cannot mutate Dasein config through ordinary runtime behavior.
11. Live Pi smoke tests MUST verify Pi mechanisms before release support is claimed.
12. stdout/stderr-capable Pi mechanism checks MUST use automated headless/snapshot execution when feasible and MUST preserve the executable command, script, fixture, or test artifact as evidence; pure UI mechanisms MUST have explicit live smoke signoff status rather than copied historical transcripts.
13. Black-box liveness evidence MUST take precedence over mock-only coverage for extension integration claims.
14. Manual review MUST be limited to non-automatable semantics, privacy language, user-visible permissions, retention explanations, and support-claim judgment; when automated gates cover a change, review evidence MAY cite those gates.

## Documentation Requirements

1. Documentation MUST describe Dasein as a Pi coding-agent ambient context broker and sensor framework.
2. Documentation MUST NOT describe Dasein as a time/space plugin.
3. Documentation MUST identify clock, geo, and lapse as builtin sensors only.
4. Documentation MUST state that continuity is a semantic property of lapse, not a separate builtin sensor.
5. Documentation MUST document the global config root:

   ```text
   ~/.pi/dasein/
   ```

6. Documentation MUST document configuration precedence exactly as:

   ```text
   defaults < global disk config < launch args < slash/UI runtime changes
   ```

7. Documentation MUST document that no implicit or project-local Dasein config is supported.
8. Documentation MUST document that project-specific behavior MUST use launch args or a future human-selected global profile; it MUST NOT use implicit project-local reads.
9. Documentation MUST document that agents cannot modify Dasein configuration unless a future explicit human-approved tool is added.
10. Documentation MUST document that runtime context injection performs no I/O, subprocess calls, network calls, dynamic imports, sensor refresh, action execution, cleanup, or configuration mutation.
11. Documentation MUST document the sensor/core/UI-shell boundary and minimal sensor contract.
12. Documentation MUST document the typed-state envelope fields by exact field name.
13. Documentation MUST document all human-visible UI surfaces.
14. Documentation MUST distinguish API/source-verified mechanism candidates from release-supported Pi mechanisms and MUST document evidence expectations: executable verification artifacts for stdout/stderr-capable mechanisms when feasible, explicit live smoke signoff status for pure UI mechanisms, and no manual raw-transcript ledger requirement.
15. Documentation MUST document privacy, retention, remote sensor, and user-added local sensor boundaries.
16. Documentation MUST avoid speculative feature promises in this constitution.
