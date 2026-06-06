import assert from "node:assert/strict";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

type QueueHarness = {
  enqueue(label: string, work: () => Promise<unknown> | unknown): Promise<unknown>;
  events(): string[];
};

test("all runtime mutations, SettingsList changes, sensor proposals, and reload share one FIFO queue", async () => {
  const api = await loadDaseinApi();
  const createConfigMutationQueue = requireExportedFunction(api, "createConfigMutationQueue", "Testing Gate Matrix row: Config atomicity, mutation queue, and durable state");
  const queue = createConfigMutationQueue() as QueueHarness;
  const observed: string[] = [];

  const pending = [
    queue.enqueue("set", async () => observed.push("set")),
    queue.enqueue("apply", async () => observed.push("apply")),
    queue.enqueue("settings", async () => observed.push("settings")),
    queue.enqueue("sensor-action-proposal", async () => observed.push("sensor-action-proposal")),
    queue.enqueue("reload", async () => observed.push("reload")),
  ];

  await Promise.all(pending);
  assert.deepEqual(observed, ["set", "apply", "settings", "sensor-action-proposal", "reload"]);
  assert.deepEqual(queue.events(), observed);
});

test("ConfigMutationProposal assignments and deletePaths commit in one all-or-nothing transaction", async () => {
  const api = await loadDaseinApi();
  const applyRuntimeProposal = requireExportedFunction(api, "applyRuntimeProposal", "Testing Gate Matrix row: Config atomicity, mutation queue, and durable state");

  const result = await applyRuntimeProposal({
    sensorKey: "geo",
    proposal: {
      assignments: { "sensors.geo.tags.home": { lat: 31.2304, lon: 121.4737, radius_m: 100 } },
      deletePaths: ["sensors.geo.tags.office"],
    },
  });

  assert.deepEqual(result, {
    ok: true,
    updatedPaths: ["sensors.geo.tags.home"],
    deletedPaths: ["sensors.geo.tags.office"],
    persistedTombstones: false,
  });
});
