// Focused Pi integration gate entrypoint required by docs/TECHNICAL_DESIGN.md#testing-gate-matrix.
// Re-export the runtime wiring assertions from the expected-red regression suite
// so the checklist command has a stable file name without duplicating tests.
import "./pi-runtime-red.test.ts";
