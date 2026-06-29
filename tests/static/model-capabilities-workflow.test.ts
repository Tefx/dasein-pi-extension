import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("scheduled model capability workflow refreshes generated cache outside the request path", () => {
  const workflow = readFileSync(".github/workflows/update-model-capabilities.yml", "utf8");
  const script = readFileSync("scripts/update-model-capabilities.mjs", "utf8");
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };

  assert.match(workflow, /cron: "17 3 \* \* 1"/u, "workflow must run on a fixed weekly schedule");
  assert.match(workflow, /workflow_dispatch:/u, "workflow must support manual refreshes");
  assert.match(workflow, /npm run models:update/u, "workflow must use the checked-in updater script");
  assert.match(workflow, /src\/generated\/model-capabilities\.json/u, "workflow should only PR generated capability cache changes");
  assert.equal(packageJson.scripts["models:update"], "node scripts/update-model-capabilities.mjs");
  assert.match(script, /runtimeNetworkAccess: false/u, "generated document must encode no runtime network access");
  assert.match(script, /fallbackTransport: "systemPrompt"/u, "auto fallback policy must be explicit in generated metadata");
});
