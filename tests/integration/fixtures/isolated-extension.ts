import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const repositorySourceRoot = join(repositoryRoot, "src");
const repositorySensorRoot = join(repositorySourceRoot, "sensors");

const isDirectory = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
const isTransientReloadFile = (name: string): boolean => name.startsWith(".dasein-reload-");

const assertRepositorySourceFixture = (): void => {
  if (!isDirectory(repositorySourceRoot) || !isDirectory(repositorySensorRoot)) {
    throw new Error(`repository source fixture missing src/sensors at ${repositorySensorRoot}`);
  }
};

const copyDirectoryStable = (source: string, target: string): void => {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (isTransientReloadFile(entry.name)) continue;
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryStable(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath);
    }
  }
};

export const copyRepositorySourceTree = (targetSourceRoot: string): void => {
  assertRepositorySourceFixture();
  copyDirectoryStable(repositorySourceRoot, targetSourceRoot);
  if (!isDirectory(join(targetSourceRoot, "sensors"))) {
    throw new Error(`isolated extension source copy missing src/sensors at ${join(targetSourceRoot, "sensors")}`);
  }
};
