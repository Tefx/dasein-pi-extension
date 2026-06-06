import test from "node:test";

test("live Pi smoke remains a release gate outside ordinary CI", { skip: process.env.DASEIN_LIVE_PI_SMOKE !== "1" ? "requires live Pi TUI/process; fake host cannot satisfy release support" : "live smoke implementation is out of scaffold-contracts scope" }, () => {
  // Contract-only scaffold: live Pi smoke behavior is owned by later implementation.
});
