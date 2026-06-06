import test from "node:test";

test("native gate is a platform-specific future implementation gate", { skip: process.platform !== "darwin" ? "native/macOS checks require darwin" : "native helper implementation is out of scaffold-contracts scope" }, () => {
  // Contract-only scaffold: native helper behavior is owned by later implementation.
});
