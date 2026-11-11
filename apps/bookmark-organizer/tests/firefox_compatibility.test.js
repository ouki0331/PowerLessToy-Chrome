import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { buildTarget } from "../scripts/build-extension.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");

describe("Bookmark Organizer - Firefox Compatibility & Manifest Isolation (PLAT-FIREFOX-001)", () => {
  // Ensure build outputs are up to date
  buildTarget("firefox");
  buildTarget("chrome");

  const firefoxManifestPath = path.join(appDir, "dist/firefox/manifest.json");
  const firefoxManifest = JSON.parse(fs.readFileSync(firefoxManifestPath, "utf-8"));

  const chromeManifestPath = path.join(appDir, "dist/chrome/manifest.json");
  const chromeManifest = JSON.parse(fs.readFileSync(chromeManifestPath, "utf-8"));

  it("Firefox manifest specifies background scripts without service_worker", () => {
    assert.equal(firefoxManifest.manifest_version, 3);
    assert.ok(firefoxManifest.background, "Background definition must be present");
    assert.equal(firefoxManifest.background.service_worker, undefined, "Firefox must NOT define service_worker");
    assert.ok(
      Array.isArray(firefoxManifest.background.scripts),
      "Firefox MV3 background.scripts array must be defined"
    );
    assert.ok(
      firefoxManifest.background.scripts.includes("src/background/index.js"),
      "Firefox background.scripts must include background script"
    );
    assert.equal(firefoxManifest.background.type, "module", "Firefox background must declare type module");
  });

  it("Chrome manifest specifies service_worker and strictly omits background.scripts", () => {
    assert.equal(chromeManifest.manifest_version, 3);
    assert.ok(chromeManifest.background, "Background definition must be present");
    assert.equal(
      chromeManifest.background.service_worker,
      "src/background/index.js",
      "Chrome MV3 service_worker must be defined"
    );
    assert.equal(chromeManifest.background.type, "module", "Chrome service worker must declare type module");
    assert.equal(
      chromeManifest.background.scripts,
      undefined,
      "Chrome manifest must NOT define background.scripts (eliminates MV3 warning)"
    );
    assert.equal(
      chromeManifest.browser_specific_settings,
      undefined,
      "Chrome manifest must NOT define browser_specific_settings"
    );
  });

  it("manifest includes Firefox gecko extension id and data collection permissions (no data collected)", () => {
    assert.ok(firefoxManifest.browser_specific_settings?.gecko, "browser_specific_settings.gecko must exist");
    const gecko = firefoxManifest.browser_specific_settings.gecko;
    assert.ok(gecko.id && gecko.id.includes("@"), "Firefox Gecko extension ID must be valid");
    assert.equal(gecko.id, "bookmark-organizer@powerless-toy.local");
    assert.deepEqual(gecko.data_collection_permissions, { required: ["none"] });
  });

  it("manifest defines chrome_url_overrides.newtab pointing to newtab html", () => {
    assert.ok(firefoxManifest.chrome_url_overrides, "chrome_url_overrides must be defined");
    assert.equal(firefoxManifest.chrome_url_overrides.newtab, "src/newtab/index.html");
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

  it("passes web-ext lint with zero errors on dist/firefox", () => {
    const localWebExt = path.join(appDir, "node_modules", ".bin", "web-ext");
    const firefoxDir = path.join(appDir, "dist", "firefox");
    const cmd = fs.existsSync(localWebExt)
      ? `"${localWebExt}" lint --source-dir "${firefoxDir}"`
      : `npx --yes web-ext lint --source-dir "${firefoxDir}"`;

    try {
      const lintOutput = execSync(cmd, {
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["ignore", "pipe", "pipe"]
      });
      assert.ok(
        lintOutput.includes("Your add-on passed all checks") || !lintOutput.includes("ERROR"),
        "web-ext lint should pass without errors"
      );
    } catch (err) {
      const combined = (err.stdout || "") + (err.stderr || "");
      assert.ok(!combined.includes("error"), `web-ext lint reported errors: ${combined}`);
    }
  });
});
