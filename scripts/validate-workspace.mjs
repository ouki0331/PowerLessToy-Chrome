import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const appsRoot = new URL("apps/", root);
const extensions = (await readdir(appsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();
const requiredDirectories = [
  "assets/icons",
  "src/background",
  "src/content",
  "src/options",
  "src/popup",
  "tests",
];
const requiredFiles = ["README.md", "manifest.json", "package.json"];

const failures = [];

if (extensions.length === 0) {
  failures.push("apps: at least one extension directory is required");
}

for (const extension of extensions) {
  const extensionRoot = new URL(`apps/${extension}/`, root);

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(extension)) {
    failures.push(`${extension}: directory name must use lowercase kebab-case`);
  }

  try {
    const manifestPath = new URL("manifest.json", extensionRoot);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    if (manifest.manifest_version !== 3) {
      failures.push(`${extension}: manifest_version must be 3`);
    }

    if (!manifest.name || !manifest.version || !manifest.description) {
      failures.push(`${extension}: manifest metadata is incomplete`);
    }
  } catch (error) {
    failures.push(`${extension}: invalid or missing manifest.json (${error.message})`);
  }

  try {
    const packagePath = new URL("package.json", extensionRoot);
    const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
    const expectedName = `@powerless-toy/${extension}`;

    if (packageJson.name !== expectedName) {
      failures.push(`${extension}: package name must be ${expectedName}`);
    }

    if (packageJson.private !== true) {
      failures.push(`${extension}: package must be private`);
    }
  } catch (error) {
    failures.push(`${extension}: invalid or missing package.json (${error.message})`);
  }

  for (const file of requiredFiles) {
    try {
      await access(join(extensionRoot.pathname, file));
    } catch {
      failures.push(`${extension}: missing ${file}`);
    }
  }

  for (const directory of requiredDirectories) {
    try {
      await access(join(extensionRoot.pathname, directory));
    } catch {
      failures.push(`${extension}: missing ${directory}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Workspace validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Workspace is valid: ${extensions.length} Chrome extension skeletons found.`);
}
