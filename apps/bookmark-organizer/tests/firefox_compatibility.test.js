import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");

describe("Bookmark Organizer - Firefox Compatibility (PLAT-FIREFOX-001)", () => {
  const manifestPath = path.join(appDir, "manifest.json");
  const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw);

  it("manifest specifies MV3 compatible background for both Chrome service worker and Firefox background scripts", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.background, "Background definition must be present");
    assert.equal(
      manifest.background.service_worker,
      "src/background/index.js",
      "Chrome MV3 service_worker must be defined"
    );
    assert.ok(
      Array.isArray(manifest.background.scripts),
      "Firefox MV3 fallback background.scripts array must be defined"
    );
    assert.ok(
      manifest.background.scripts.includes("src/background/index.js"),
      "Firefox background.scripts must include background script"
    );
  });

  it("manifest includes Firefox gecko extension id and data collection permissions (no data collected)", () => {
    assert.ok(manifest.browser_specific_settings?.gecko, "browser_specific_settings.gecko must exist");
    const gecko = manifest.browser_specific_settings.gecko;
    assert.ok(gecko.id && gecko.id.includes("@"), "Firefox Gecko extension ID must be valid");
    assert.equal(gecko.id, "bookmark-organizer@powerless-toy.local");
    assert.deepEqual(gecko.data_collection_permissions, { required: ["none"] });
  });

  it("manifest defines chrome_url_overrides.newtab pointing to newtab html", () => {
    assert.ok(manifest.chrome_url_overrides, "chrome_url_overrides must be defined");
    assert.equal(manifest.chrome_url_overrides.newtab, "src/newtab/index.html");
  });

  it("popup uses cross-browser runtime.getURL instead of hardcoded chrome://newtab", () => {
    const popupJsPath = path.join(appDir, "src/popup/popup.js");
    const popupContent = fs.readFileSync(popupJsPath, "utf-8");

    assert.ok(
      !popupContent.includes('url: "chrome://newtab"'),
      "Popup must not use hardcoded chrome://newtab which Firefox blocks"
    );
    assert.ok(
      popupContent.includes('chrome.runtime.getURL("src/newtab/index.html")') ||
        popupContent.includes("runtime.getURL"),
      "Popup must use runtime.getURL for newtab launcher"
    );
  });

  it("html uses external theme-init.js to comply with Firefox MV3 default CSP (no inline scripts)", () => {
    const htmlPath = path.join(appDir, "src/newtab/index.html");
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");

    // Firefox MV3 default CSP forbids inline scripts
    assert.ok(
      !htmlContent.includes("<script>"),
      "Must not contain inline script blocks forbidden by Firefox MV3 CSP"
    );
    assert.ok(
      htmlContent.includes('src="theme-init.js"'),
      "Must include external theme-init.js in head for zero-FOUC theme application"
    );
  });

  it("passes web-ext lint with zero errors", () => {
    try {
      const lintOutput = execSync(`npx --yes web-ext lint --source-dir "${appDir}"`, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      assert.ok(
        lintOutput.includes("Your add-on passed all checks") || !lintOutput.includes("ERROR"),
        "web-ext lint should pass without errors"
      );
    } catch (err) {
      const combined = (err.stdout || "") + (err.stderr || "");
      // Fail only if there are errors (warnings are non-fatal)
      assert.ok(!combined.includes("error"), `web-ext lint reported errors: ${combined}`);
    }
  });
});
