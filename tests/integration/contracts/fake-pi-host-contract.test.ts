import assert from "node:assert/strict";
import test from "node:test";

import type { FakePiHostContract } from "../../../src/contracts/fake-pi-host.ts";

const fakeHostShape: FakePiHostContract = {
  mode: "tui",
  ledger: {
    commands: [{ name: "dasein", rawArgsSupported: true, completionsSupported: true }],
    flags: [{ name: "dasein", type: "string" }],
    lifecycleHandlers: ["session_start", "session_shutdown", "context"],
    eventBus: {
      supportedTopics: ["dasein:state:set", "dasein:state:clear"],
      recordsEmittedEvents: true,
      recordsSubscribedHandlers: true,
    },
    uiStatusCalls: ["setStatus"],
    uiWidgetCalls: ["setWidget"],
    uiCustomCalls: ["custom"],
  },
  liveSupportClaim: false,
  evidenceBoundary: "fake-host-api-shape-only",
};

test("fake Pi host contract records API shape without making live support claims", () => {
  assert.equal(fakeHostShape.mode, "tui");
  assert.equal(fakeHostShape.ledger.flags[0]?.type, "string");
  assert.deepEqual(fakeHostShape.ledger.eventBus.supportedTopics, [
    "dasein:state:set",
    "dasein:state:clear",
  ]);
  assert.equal(fakeHostShape.liveSupportClaim, false);
  assert.equal(fakeHostShape.evidenceBoundary, "fake-host-api-shape-only");
});
