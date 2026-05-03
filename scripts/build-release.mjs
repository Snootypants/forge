import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const distDir = path.join(projectRoot, "dist");

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runTypeScriptBuild() {
  const tscBin = path.join(projectRoot, "node_modules", "typescript", "bin", "tsc");

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tscBin, "-p", "tsconfig.build.json"], {
      cwd: projectRoot,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const reason = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`TypeScript release build failed with ${reason}`));
    });
  });
}

async function copyDirectoryWithoutDsStore(source, destination) {
  if (!(await pathExists(source))) {
    throw new Error(`Required release asset directory does not exist: ${path.relative(projectRoot, source)}`);
  }

  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: (sourcePath) => path.basename(sourcePath) !== ".DS_Store",
  });
}

async function removeDsStoreFiles(directory) {
  if (!(await pathExists(directory))) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.name === ".DS_Store") {
        await rm(entryPath, { force: true });
        return;
      }

      if (entry.isDirectory()) {
        await removeDsStoreFiles(entryPath);
      }
    }),
  );
}

async function buildRelease() {
  await rm(distDir, { recursive: true, force: true });
  await runTypeScriptBuild();
  await copyDirectoryWithoutDsStore(path.join(projectRoot, "src", "web", "public"), path.join(distDir, "web", "public"));
  await copyDirectoryWithoutDsStore(path.join(projectRoot, "src", "db", "schemas"), path.join(distDir, "db", "schemas"));
  await removeDsStoreFiles(distDir);
}

buildRelease().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
