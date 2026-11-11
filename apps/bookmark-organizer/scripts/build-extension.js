/**
 * Browser-Specific Extension Build Script
 *
 * Builds clean, lint-compliant extensions for Chrome and Firefox from single codebase:
 * - Chrome: MV3 Service Worker (no background.scripts, no gecko settings)
 * - Firefox: MV3 Background Scripts (no service_worker, retains gecko id and min_version)
 * - Output: dist/chrome and dist/firefox (both gitignored)
 * - Does NOT duplicate 83MB dictionary files in git.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");
const distDir = path.resolve(appDir, "dist");

function getGitCommitHash() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: appDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "dev";
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function linkOrCopy(srcPath, destPath, { copy = false } = {}) {
  if (fs.existsSync(destPath)) {
    try {
      const stat = fs.lstatSync(destPath);
      if (stat.isSymbolicLink() || stat.isDirectory() || stat.isFile()) {
        fs.rmSync(destPath, { recursive: true, force: true });
      }
    } catch {}
  }

  if (copy) {
    fs.cpSync(srcPath, destPath, { recursive: true });
    return;
  }

  try {
    const rel = path.relative(path.dirname(destPath), srcPath);
    fs.symlinkSync(rel, destPath, "junction");
  } catch (err) {
    // Fallback to copy if symlinks are not permitted on host OS
    fs.cpSync(srcPath, destPath, { recursive: true });
  }
}

export function buildTarget(target, { copy = true } = {}) {
  const baseManifestPath = path.join(appDir, "manifest.base.json");
  const targetManifestPath = path.join(appDir, `manifest.${target}.json`);

  if (!fs.existsSync(baseManifestPath)) {
    throw new Error(`Base manifest not found: ${baseManifestPath}`);
  }
  if (!fs.existsSync(targetManifestPath)) {
    throw new Error(`Target manifest not found: ${targetManifestPath}`);
  }

  const baseManifest = JSON.parse(fs.readFileSync(baseManifestPath, "utf8"));
  const targetManifest = JSON.parse(fs.readFileSync(targetManifestPath, "utf8"));

  // Merge manifest deeply
  const manifest = {
    ...baseManifest,
    ...targetManifest,
    background: {
      ...baseManifest.background,
      ...targetManifest.background
    }
  };

  if (target === "chrome") {
    delete manifest.background.scripts;
    delete manifest.browser_specific_settings;
  } else if (target === "firefox") {
    delete manifest.background.service_worker;
  }

  const outDir = path.join(distDir, target);
  ensureDir(outDir);

  // Write browser manifest
  const manifestOut = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestOut, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // Copy src and assets into isolated dist target directory
  linkOrCopy(path.join(appDir, "src"), path.join(outDir, "src"), { copy: true });
  linkOrCopy(path.join(appDir, "assets"), path.join(outDir, "assets"), { copy: true });

  // Build metadata written ONLY to dist output
  const commitHash = getGitCommitHash();
  const buildInfo = {
    target,
    version: manifest.version,
    commit: commitHash,
    builtAt: new Date().toISOString()
  };
  fs.writeFileSync(
    path.join(outDir, "src", "build-info.json"),
    JSON.stringify(buildInfo, null, 2) + "\n",
    "utf8"
  );

  // If Chrome target, also update root manifest.json for clean zero-warning development
  if (target === "chrome") {
    fs.writeFileSync(
      path.join(appDir, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      "utf8"
    );
  }

  console.log(`[build] Built ${target.toUpperCase()} extension in: ${outDir} (Build ID: ${commitHash})`);
  return { outDir, manifest, buildInfo };
}

export function buildAll({ copy = true } = {}) {
  buildTarget("chrome", { copy });
  buildTarget("firefox", { copy });
}

// CLI entrypoint
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const copy = args.includes("--copy");
  const targetArg = args.find((a) => a.startsWith("--target="));
  const target = targetArg ? targetArg.split("=")[1].toLowerCase() : null;

  try {
    if (target) {
      if (!["chrome", "firefox"].includes(target)) {
        throw new Error(`Unknown build target: "${target}". Expected "chrome" or "firefox".`);
      }
      buildTarget(target, { copy });
    } else {
      buildAll({ copy });
    }
  } catch (err) {
    console.error("[build] Failed:", err.message);
    process.exit(1);
  }
}
