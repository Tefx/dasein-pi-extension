/**
 * Pi auto-discovery shim for symlinked installs at:
 * ~/.pi/agent/extensions/dasein/index.ts
 *
 * Contract: this root file performs no extension work. It only delegates to
 * the real composition entrypoint at ./src/index.ts so the resolved project
 * root remains the extension root for package/directory installs.
 */
export { default } from "./src/index.ts";
export * from "./src/index.ts";
