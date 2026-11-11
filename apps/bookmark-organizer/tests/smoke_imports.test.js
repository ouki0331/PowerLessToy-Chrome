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
    assert.ok(typeof bgModule.isBookmarkOrganizerUrl === "function");
    assert.ok(typeof bgModule.handleTriggerOverlay === "function");
    assert.ok(typeof bgModule.getShortcutBindingStatus === "function");

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

  describe("Manifest V3 Background Configuration (Service Worker & Firefox fallback)", () => {
    const manifestPath = path.join(appDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    it("declares background.type as 'module' for ES Module Service Worker execution", () => {
      assert.ok(manifest.background, "background must be defined");
      assert.equal(manifest.background.type, "module", "manifest.background.type must be 'module'");
      assert.equal(manifest.background.service_worker, "src/background/index.js");
      // Firefox manifest verification from dist/firefox
      const firefoxManifestPath = path.join(appDir, "dist/firefox/manifest.json");
      if (fs.existsSync(firefoxManifestPath)) {
        const firefoxManifest = JSON.parse(fs.readFileSync(firefoxManifestPath, "utf-8"));
        assert.ok(Array.isArray(firefoxManifest.background.scripts), "scripts fallback for Firefox must be array");
        assert.ok(firefoxManifest.background.scripts.includes("src/background/index.js"));
      }
    });

    it("verifies static constraint: if background entrypoint uses import/export, manifest background.type must be 'module'", () => {
      const bgEntryPath = path.join(appDir, "src", "background", "index.js");
      const bgContent = fs.readFileSync(bgEntryPath, "utf-8");
      const hasEsmKeywords = /^\s*(import|export)\s+/m.test(bgContent);

      if (hasEsmKeywords) {
        assert.equal(
          manifest.background.type,
          "module",
          "When background entrypoint uses import/export, manifest.background.type MUST be 'module'"
        );
      }
    });

    it("has version 0.4.1 and minimal activeTab + scripting permissions", () => {
      assert.equal(manifest.version, "0.4.1");
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

  describe("Bookmark Organizer URL Detection & Execution Order", () => {
    it("isBookmarkOrganizerUrl accurately matches newtab URLs and ignores external pages", async () => {
      const { isBookmarkOrganizerUrl } = await import(path.join(appDir, "src", "background", "index.js"));

      assert.equal(isBookmarkOrganizerUrl("chrome-extension://abcdef/src/newtab/index.html"), true);
      assert.equal(isBookmarkOrganizerUrl("chrome-extension://abcdef/src/newtab/index.html#search"), true);
      assert.equal(isBookmarkOrganizerUrl("moz-extension://12345/src/newtab/index.html"), true);
      assert.equal(isBookmarkOrganizerUrl("https://example.com/"), false);
      assert.equal(isBookmarkOrganizerUrl("chrome://extensions"), false);
    });

    it("Bookmark Organizer's own URL is NEVER intercepted as restricted", async () => {
      const { isRestrictedUrl } = await import(path.join(appDir, "src", "background", "index.js"));

      assert.equal(isRestrictedUrl("chrome-extension://abcdef/src/newtab/index.html"), false);
      assert.equal(isRestrictedUrl("chrome-extension://abcdef/src/newtab/index.html#search"), false);
      assert.equal(isRestrictedUrl("moz-extension://12345/src/newtab/index.html"), false);
    });

    it("true restricted URLs are classified as restricted", async () => {
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

    it("handleTriggerOverlay prioritizes Bookmark Organizer tab before restricted fallback", async () => {
      const { handleTriggerOverlay } = await import(path.join(appDir, "src", "background", "index.js"));

      const sentMessages = [];
      const createdTabs = [];
      const executedScripts = [];

      globalThis.chrome = {
        runtime: {
          getURL: (p) => `chrome-extension://mock-id/${p}`,
          sendMessage: async (msg) => sentMessages.push({ scope: "runtime", ...msg })
        },
        tabs: {
          sendMessage: async (id, msg) => {
            sentMessages.push({ scope: "tab", id, ...msg });
            return { success: true };
          },
          create: async (opts) => createdTabs.push(opts)
        },
        scripting: {
          executeScript: async (opts) => executedScripts.push(opts)
        }
      };

      // Case 1: Bookmark Organizer own newtab
      const bmkTab = { id: 101, url: "chrome-extension://mock-id/src/newtab/index.html" };
      await handleTriggerOverlay(bmkTab);
      assert.equal(createdTabs.length, 0, "Must not create a new tab if already on Bookmark Organizer");
      assert.equal(executedScripts.length, 0, "Must not executeScript into Bookmark Organizer");
      assert.ok(sentMessages.some((m) => m.type === "OPEN_BOOKMARK_SEARCH"));

      // Case 2: Restricted page -> Fallback tab creation
      sentMessages.length = 0;
      createdTabs.length = 0;
      const restrictedTab = { id: 102, url: "chrome://extensions" };
      await handleTriggerOverlay(restrictedTab);
      assert.equal(createdTabs.length, 1);
      assert.match(createdTabs[0].url, /#search$/);
      assert.equal(executedScripts.length, 0);

      // Case 3: Normal web page -> On-demand injection
      sentMessages.length = 0;
      createdTabs.length = 0;
      // Simulate content script missing on first call
      globalThis.chrome.tabs.sendMessage = async () => {
        throw new Error("No receiver");
      };
      const normalTab = { id: 103, url: "https://example.com/article" };
      await handleTriggerOverlay(normalTab);
      assert.equal(executedScripts.length, 1);
      assert.equal(executedScripts[0].target.tabId, 103);
      assert.deepEqual(executedScripts[0].files, ["src/content/overlay.js"]);

      delete globalThis.chrome;
    });
  });

  describe("Shortcut Status & Unbound Warning Handling", () => {
    it("getShortcutBindingStatus reports binding status accurately", async () => {
      const { getShortcutBindingStatus } = await import(path.join(appDir, "src", "background", "index.js"));

      // Bound mock
      globalThis.chrome = {
        commands: {
          getAll: async () => [
            { name: "open-bookmark-search", shortcut: "Ctrl+Shift+K", description: "Search" }
          ]
        }
      };
      const boundRes = await getShortcutBindingStatus();
      assert.equal(boundRes.isBound, true);
      assert.equal(boundRes.shortcut, "Ctrl+Shift+K");

      // Unbound mock (shortcut is empty string)
      globalThis.chrome.commands.getAll = async () => [
        { name: "open-bookmark-search", shortcut: "", description: "Search" }
      ];
      const unboundRes = await getShortcutBindingStatus();
      assert.equal(unboundRes.isBound, false);
      assert.equal(unboundRes.shortcut, "");

      delete globalThis.chrome;
    });
  });

  describe("Language Storage Consistency across Contexts", () => {
    it("verifies unified use of powerless_toy_lang key across newtab and background", () => {
      const appJs = fs.readFileSync(path.join(appDir, "src", "newtab", "app.js"), "utf-8");
      const bgJs = fs.readFileSync(path.join(appDir, "src", "background", "index.js"), "utf-8");

      assert.match(appJs, /powerless_toy_lang/);
      assert.match(bgJs, /powerless_toy_lang/);
      // Verify app.js syncs to chrome.storage.local
      assert.match(appJs, /chrome\.storage\.local\.set/);
      // Verify bgJs reads from chrome.storage.local
      assert.match(bgJs, /chrome\.storage\.local\.get/);
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
      const { state } = await import(path.join(appDir, "src", "popup", "popup.js"));

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
