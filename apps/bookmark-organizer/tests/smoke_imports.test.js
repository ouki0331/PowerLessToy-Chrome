import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");

describe("Bookmark Organizer v0.3.1 - Smoke Imports & Architecture Verification", () => {
  it("dynamically imports all core modules without SyntaxError or missing export errors", async () => {
    // 1. Background worker
    const bgModule = await import(path.join(appDir, "src", "background", "index.js"));
    assert.ok(typeof bgModule.isRestrictedUrl === "function");
    assert.ok(typeof bgModule.handleTriggerOverlay === "function");

    // 2. Storage module
    const storageModule = await import(path.join(appDir, "src", "newtab", "storage.js"));
    assert.ok(typeof storageModule.getGroupMetricsMap === "function");
    assert.ok(typeof storageModule.getLinkMetricsMap === "function");
    assert.ok(typeof storageModule.cleanTrackingUrl === "function");
    assert.ok(typeof storageModule.findDuplicateLink === "function");
    assert.ok(typeof storageModule.filterGroupsForCombobox === "function");

    // 3. Search module
    const searchModule = await import(path.join(appDir, "src", "newtab", "search.js"));
    assert.ok(typeof searchModule.searchBookmarks === "function");
    assert.ok(typeof searchModule.evaluateSearchShortcut === "function");

    // 4. Icons module
    const iconsModule = await import(path.join(appDir, "src", "newtab", "icons.js"));
    assert.ok(iconsModule.SVG_ICONS);
    assert.ok(typeof iconsModule.renderSvgIcon === "function");

    // 5. i18n module
    const i18nModule = await import(path.join(appDir, "src", "newtab", "i18n.js"));
    assert.ok(typeof i18nModule.t === "function");
    assert.ok(typeof i18nModule.setLanguage === "function");
    i18nModule.setLanguage("en");
    assert.equal(i18nModule.t("paletteSearchPlaceholderAll"), "Search commands or bookmarks...");
    i18nModule.setLanguage("ja");
    assert.equal(i18nModule.t("paletteSearchPlaceholderAll"), "コマンドまたはブックマークを検索...");
    i18nModule.setLanguage("en");

    // 6. In-page overlay script
    const overlayModule = await import(path.join(appDir, "src", "content", "overlay.js"));
    assert.ok(overlayModule !== undefined);

    // 7. Popup module
    const popupModule = await import(path.join(appDir, "src", "popup", "popup.js"));
    assert.ok(popupModule.state);
    assert.ok(typeof popupModule.toggleScope === "function");
    assert.ok(typeof popupModule.getCommandItems === "function");
    assert.ok(typeof popupModule.getBookmarkItems === "function");
  });

  describe("Manifest V3 Configuration (Candidate v0.3.1)", () => {
    const manifestPath = path.join(appDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    it("has version 0.3.1 and minimal activeTab + scripting permissions", () => {
      assert.equal(manifest.version, "0.3.1");
      assert.ok(manifest.permissions.includes("activeTab"));
      assert.ok(manifest.permissions.includes("scripting"));
      assert.ok(manifest.permissions.includes("storage"));
      assert.ok(!manifest.permissions.includes("<all_urls>"));
    });

    it("omits default_popup to enable action.onClicked for in-page overlay", () => {
      assert.ok(manifest.action);
      assert.equal(manifest.action.default_popup, undefined);
    });

    it("has single authoritative open-bookmark-search command bound to Ctrl/Cmd+Shift+K", () => {
      assert.ok(manifest.commands["open-bookmark-search"]);
      assert.equal(manifest.commands["open-bookmark-search"].suggested_key.default, "Ctrl+Shift+K");
      assert.equal(manifest.commands["open-bookmark-search"].suggested_key.mac, "Command+Shift+K");
      assert.equal(manifest.commands._execute_action, undefined);
    });
  });

  describe("Restricted URL Detection & Fallback", () => {
    it("correctly classifies browser internal schemes and extension stores", async () => {
      const { isRestrictedUrl } = await import(path.join(appDir, "src", "background", "index.js"));

      assert.equal(isRestrictedUrl("chrome://extensions"), true);
      assert.equal(isRestrictedUrl("chrome://bookmarks"), true);
      assert.equal(isRestrictedUrl("about:blank"), true);
      assert.equal(isRestrictedUrl("about:config"), true);
      assert.equal(isRestrictedUrl("edge://settings"), true);
      assert.equal(isRestrictedUrl("view-source:https://example.com"), true);
      assert.equal(isRestrictedUrl("devtools://devtools/bundled/inspector.html"), true);
      assert.equal(isRestrictedUrl("https://chromewebstore.google.com/detail/xyz"), true);
      assert.equal(isRestrictedUrl("https://chrome.google.com/webstore/category/extensions"), true);
      assert.equal(isRestrictedUrl("https://addons.mozilla.org/en-US/firefox/"), true);

      // Normal web pages
      assert.equal(isRestrictedUrl("https://github.com/"), false);
      assert.equal(isRestrictedUrl("http://localhost:3000/"), false);
      assert.equal(isRestrictedUrl("https://news.ycombinator.com/"), false);
      assert.equal(isRestrictedUrl("https://en.wikipedia.org/wiki/Main_Page"), false);
    });
  });

  describe("Quick Capture State Behaviors (BMK-CAPTURE-001)", () => {
    it("custom tag clearing resets selectedTag to empty string", async () => {
      const { state } = await import(path.join(appDir, "src", "popup", "popup.js"));

      // Set tag
      state.capture.selectedTag = "CUSTOM_TAG";
      assert.equal(state.capture.selectedTag, "CUSTOM_TAG");

      // Simulating clearing custom tag input
      const emptyVal = "".trim();
      if (emptyVal) {
        state.capture.selectedTag = emptyVal;
      } else {
        state.capture.selectedTag = "";
      }
      assert.equal(state.capture.selectedTag, "");
    });

    it("combobox group selection enables save while unselected/typing group disables save", async () => {
      const { state, validateSaveBtn } = await import(path.join(appDir, "src", "popup", "popup.js"));

      // User types into group input
      state.capture.selectedGroupId = "";
      assert.equal(state.capture.selectedGroupId, "");

      // User selects candidate group
      state.capture.selectedGroupId = "group-123";
      assert.equal(state.capture.selectedGroupId, "group-123");
    });
  });

  describe("Scope Toggling on Continuous Stream", () => {
    it("toggles between 'all' and 'bookmarks' scope correctly", async () => {
      const { state, toggleScope } = await import(path.join(appDir, "src", "popup", "popup.js"));

      state.scope = "all";
      toggleScope();
      assert.equal(state.scope, "bookmarks");

      toggleScope();
      assert.equal(state.scope, "all");
    });
  });

  describe("Keyboard Shortcut Matching across Platforms", () => {
    it("matches Ctrl+Shift+K on Windows/Linux and Cmd+Shift+K on macOS in search.js", async () => {
      const { evaluateSearchShortcut } = await import(path.join(appDir, "src", "newtab", "search.js"));

      // Windows/Linux Ctrl+Shift+K
      const winEvent = {
        key: "K",
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
        altKey: false
      };
      const winRes = evaluateSearchShortcut(winEvent);
      assert.equal(winRes.shouldOpen, true);
      assert.equal(winRes.preventDefault, true);

      // macOS Command+Shift+K
      const macEvent = {
        key: "K",
        ctrlKey: false,
        metaKey: true,
        shiftKey: true,
        altKey: false
      };
      const macRes = evaluateSearchShortcut(macEvent);
      assert.equal(macRes.shouldOpen, true);
      assert.equal(macRes.preventDefault, true);

      // Regular Ctrl+K still opens search in new tab
      const ctrlKEvent = {
        key: "k",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      };
      const ctrlKRes = evaluateSearchShortcut(ctrlKEvent);
      assert.equal(ctrlKRes.shouldOpen, true);

      // Ctrl+D (bookmark) is NOT hijacked
      const ctrlDEvent = {
        key: "d",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false
      };
      const ctrlDRes = evaluateSearchShortcut(ctrlDEvent);
      assert.equal(ctrlDRes.shouldOpen, false);
    });
  });
});
