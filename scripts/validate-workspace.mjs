import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const extensions = [
  "bookmark-organizer",
  "element-remover",
  "message-center",
];
const requiredDirectories = [
  "assets/icons",
  "src/background",
  "src/content",
  "src/options",
  "src/popup",
  "tests",
];

const failures = [];

for (const extension of extensions) {
  const extensionRoot = new URL(`apps/${extension}/`, root);

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

