# Dasein Project Constitution

## Mission

Dasein is a local Pi ambient-context broker and sensor framework for coding-agent sessions.

Dasein collects typed ambient state, exposes selected state to the human, and injects selected bounded context into the agent runtime through explicit human-governed mechanisms.

Dasein MUST remain a broker. It MUST NOT become hidden memory, an agent policy layer, a workflow engine, a ranking system, a daemon marketplace, or an external automation platform.

## Constitutional Scope

This constitution is the supreme source for durable project invariants only.

Implementation details, file paths, package names, exact schemas, command names, sensor inventories, UI mechanism ledgers, release procedures, and proof artifact names MUST live in the PRD, Technical Design, release documentation, or executable tests.

A constitutional amendment MUST change only durable constraints. It MUST NOT add feature roadmaps, target-user narratives, ephemeral UI copy, package checklists, or speculative implementation plans.

Every constitutional MUST MUST map to executable verification where feasible. Manual review MUST be reserved for privacy judgment, semantic clarity, and support-claim judgment that automation cannot prove.

## Architectural Dogmas

1. Dasein MUST remain local, minimal, dependency-light, and Pi-extension-shaped.
2. Dasein MUST preserve a strict separation between collection, normalization, storage, rendering, UI publication, configuration mutation, and agent-context injection.
3. Sensors and external publishers MUST publish structured typed state. They MUST NOT own final prompt text, final UI text, ordering priority, truncation policy, or configuration mutation.
4. Core MUST own normalization, deterministic ordering, visibility filtering, budget enforcement, truncation, and final rendering for both humans and agents.
5. Runtime agent-context injection MUST read only precomputed in-memory context. It MUST NOT perform disk I/O, network I/O, subprocess work, dynamic loading, sensor refresh, sensor discovery, cleanup, or configuration mutation.
6. Ambient context MUST remain contextual evidence. It MUST NOT become an instruction, hidden behavioral policy, task priority, workflow decision, or inferred user intent.
7. Configuration changes MUST require explicit human action through documented launch, command, UI, or future approved tool paths. Agents MUST NOT mutate configuration through ordinary runtime behavior.
8. Dasein MUST NOT use implicit project-local files, repository discovery, hidden profiles, or undeclared inputs to alter collection, visibility, rendering, or injection behavior.
9. Background work, durable persistence, remote transmission, and user-added executable code MUST be declared, inspectable, disableable, and gated by explicit human control.
10. Packaging and release design MUST preserve the local-extension trust boundary, dependency-light runtime, reproducible install path, and verifiable compatibility with the real Pi runtime.

## Quality Baselines

1. Public module boundaries, configuration overlays, sensor contracts, and rendered-context contracts MUST be typed and schema-validated.
2. State entering core storage MUST satisfy a documented typed-state contract. Invalid or extra fields MUST be rejected or dropped before rendering or injection.
3. Rendering MUST be deterministic for equivalent configuration and state.
4. Token and visible-surface budgets MUST be enforced by core-owned formatters, not by sensors or publishers.
5. Failures, unavailable state, stale state, and truncation MUST fail safely by omission, explicit degraded state, or explicit inspection guidance.
6. Static checks MUST enforce the read-only/no-I/O agent-injection boundary.
7. Unit and golden tests MUST cover normalization, ordering, visibility, truncation, persistence safety, and compact default formatting.
8. Mock tests MUST NOT be treated as integration proof.
9. Black-box liveness evidence against the real runtime or binary MUST take precedence over fake-host, source-only, or mock-only evidence for integration support claims.
10. Release support claims MUST identify the mechanism, compatible runtime, and executable evidence. Unsupported or source-only mechanisms MUST remain labeled as unproven.
11. Documentation MUST distinguish constitutional invariants, product requirements, technical design, release procedures, and verification artifacts.

## UX/Interaction Red-lines
1. Enabled collection, human visibility, agent visibility, persistence, and transmission MUST be separately inspectable and configurable.
2. Human-visible inspection MUST exist for active state, disabled state, omitted state, truncation, permissions, remote behavior, and persistence behavior.
3. Persistent UI chrome MUST NOT exist merely to prove readiness. It MUST be absent or quiet unless it communicates actionable state, degraded behavior, or exposure.
4. Human-facing summaries MUST maximize semantic density. They MUST NOT render raw debug dumps, redundant representations, hidden-detail counters without an action, or injected-prompt wrappers.
5. Agent-visible context MUST be clearly distinguishable from human-only visibility, and exact agent-injection inspection MUST use an explicit diagnostic surface rather than persistent chrome.
6. Sensitive, exact, durable, remote, or user-added data MUST be default-private unless the human explicitly enables the relevant collection, display, injection, persistence, or transmission path.
7. UI copy MUST NOT imply hidden priority, hidden policy, sandbox guarantees, or integration support that has not been verified.
8. User-added executable code MUST be presented as trusted local code, not as sandboxed content.
9. Product and technical documentation MUST describe Dasein as an ambient-context broker and sensor framework, not as a single-purpose sensor plugin.
