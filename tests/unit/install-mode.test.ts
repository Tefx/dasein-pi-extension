import assert from "node:assert/strict";
import test from "node:test";

import { loadDaseinApi, requireExportedFunction } from "../fixtures/helpers/core-fixtures.ts";

test("directory/package install scans package and user-local sensors while single-file packaged install uses static registry only", async () => {
  const api = await loadDaseinApi();
  const detectDaseinInstallMode = requireExportedFunction(api, "detectDaseinInstallMode", "Testing Gate Matrix row: Sensor export, install modes, provenance, and reload all-or-keep-old");
  const directory = detectDaseinInstallMode({ extensionRoot: "/extension", entrypoint: "/extension/index.ts", packageForm: "directory" }) as { packageSensorScanGlob: string | null; userLocalSensorScanGlob: string | null; userSensorScanGlobs: string[]; dynamicUserSensorsSupported: boolean };
  const singleFile = detectDaseinInstallMode({ extensionRoot: "/extension/dist", entrypoint: "/extension/dist/index.js", packageForm: "single-file" }) as { packageSensorScanGlob: string | null; userLocalSensorScanGlob: string | null; userSensorScanGlobs: string[]; dynamicUserSensorsSupported: boolean };

  assert.deepEqual(directory, {
    packageSensorScanGlob: "/extension/src/sensors/*.ts",
    userLocalSensorScanGlob: "~/.pi/dasein/sensors/*.ts",
    userSensorScanGlobs: ["/extension/src/sensors/*.ts", "~/.pi/dasein/sensors/*.ts"],
    dynamicUserSensorsSupported: true,
  });
  assert.deepEqual(singleFile, { packageSensorScanGlob: null, userLocalSensorScanGlob: null, userSensorScanGlobs: [], dynamicUserSensorsSupported: false });
});
