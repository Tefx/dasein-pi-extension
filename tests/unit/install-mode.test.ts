import assert from "node:assert/strict";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("directory/package install scans src/sensors/*.ts while single-file packaged install uses static registry only", async () => {
  const api = await loadDaseinApi();
  const detectDaseinInstallMode = requireExportedFunction(api, "detectDaseinInstallMode", "Testing Gate Matrix row: Sensor export, install modes, provenance, and reload all-or-keep-old");
  const directory = detectDaseinInstallMode({ extensionRoot: "/extension", entrypoint: "/extension/index.ts", packageForm: "directory" }) as { userSensorScanGlob: string | null; dynamicUserSensorsSupported: boolean };
  const singleFile = detectDaseinInstallMode({ extensionRoot: "/extension/dist", entrypoint: "/extension/dist/index.js", packageForm: "single-file" }) as { userSensorScanGlob: string | null; dynamicUserSensorsSupported: boolean };

  assert.deepEqual(directory, { userSensorScanGlob: "/extension/src/sensors/*.ts", dynamicUserSensorsSupported: true });
  assert.deepEqual(singleFile, { userSensorScanGlob: null, dynamicUserSensorsSupported: false });
});
