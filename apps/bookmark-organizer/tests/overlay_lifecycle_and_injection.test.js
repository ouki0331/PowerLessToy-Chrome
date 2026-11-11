import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import {
  isRestrictedUrl,
  isBookmarkOrganizerUrl,
  handleTriggerOverlay,
  executeInjectionWithRetry,
  fallbackToNewtabSearch
} from "../src/background/index.js";
import { buildTarget } from "../scripts/build-extension.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");
const overlaySource = fs.readFileSync(path.join(appDir, "src/content/overlay.js"), "utf8");

/**
 * Create a mock DOM environment to run and test overlay.js in node:vm
 */
function createMockOverlayEnvironment({ onSendMessage = null } = {}) {
  const elements = new Map();
  let nextId = 1;

  function createEl(tagName) {
    const id = `el_${nextId++}`;
    const classes = new Set();
    const listeners = {};
    const styles = {};
    const children = [];

    const el = {
      id,
      tagName: tagName.toUpperCase(),
      style: new Proxy(styles, {
        set(target, prop, value) {
          target[prop] = value;
          return true;
        },
        get(target, prop) {
          return target[prop] || "";
        }
      }),
      classList: {
        add: (...cls) => cls.forEach((c) => classes.add(c)),
        remove: (...cls) => cls.forEach((c) => classes.delete(c)),
        toggle: (c, force) => {
          if (force === undefined) {
            if (classes.has(c)) classes.delete(c);
            else classes.add(c);
          } else if (force) classes.add(c);
          else classes.delete(c);
        },
        contains: (c) => classes.has(c)
      },
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] || null; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(evt, fn) {
        listeners[evt] = listeners[evt] || [];
        listeners[evt].push(fn);
      },
      dispatchEvent(evt) {
        (listeners[evt.type] || []).forEach((fn) => fn(evt));
      },
      appendChild(child) {
        children.push(child);
        return child;
      },
      replaceChildren(...newChildren) {
        children.length = 0;
        children.push(...newChildren);
      },
      removeChild(child) {
        const idx = children.indexOf(child);
        if (idx !== -1) children.splice(idx, 1);
        return child;
      },
      querySelector(selector) {
        return findInTree(this, selector);
      },
      querySelectorAll(selector) {
        return findAllInTree(this, selector);
      },
      focus() {},
      select() {},
      value: "",
      textContent: ""
    };

    Object.defineProperty(el, "innerHTML", {
      set(html) {
        this._html = html;
        if (typeof html === "string") {
          const idMatches = html.matchAll(/id="([^"]+)"/g);
          for (const m of idMatches) {
            const matchedId = m[1];
            if (!elements.has(matchedId)) {
              const childEl = createEl("div");
              childEl.id = matchedId;
              childEl.attributes.id = matchedId;
              elements.set(matchedId, childEl);
            }
          }
          const classMatches = html.matchAll(/class="([^"]+)"/g);
          for (const m of classMatches) {
            const classNames = m[1].split(/\s+/);
            for (const c of classNames) {
              if (c) {
                const classEl = createEl("div");
                classEl.classList.add(c);
                elements.set(`cls_${c}_${nextId++}`, classEl);
              }
            }
          }
        }
      },
      get() {
        return this._html || "";
      }
    });

    elements.set(id, el);
    return el;
  }

  function findInTree(root, selector) {
    if (!root) return null;
    const clean = selector.trim();
    if (clean.startsWith("#")) {
      const targetId = clean.slice(1);
      for (const el of elements.values()) {
        if (el.attributes?.id === targetId || el.id === targetId) return el;
      }
      return null;
    }
    if (clean.startsWith(".")) {
      const cls = clean.slice(1);
      for (const el of elements.values()) {
        if (el.classList?.contains(cls)) return el;
      }
      return null;
    }
    return null;
  }

  function findAllInTree(root, selector) {
    const res = [];
    const clean = selector.trim();
    if (clean.startsWith(".")) {
      const cls = clean.slice(1);
      for (const el of elements.values()) {
        if (el.classList?.contains(cls)) res.push(el);
      }
    }
    return res;
  }

  const shadowRoot = createEl("div");
  shadowRoot.host = null;
  shadowRoot.getElementById = (id) => findInTree(shadowRoot, `#${id}`);

  const host = createEl("div");
  host.attachShadow = () => {
    shadowRoot.host = host;
    return shadowRoot;
  };

  const htmlEl = createEl("html");
  const bodyEl = createEl("body");
  htmlEl.appendChild(bodyEl);

  const documentMock = {
    activeElement: createEl("button"),
    documentElement: htmlEl,
    createElement: (tag) => {
      if (tag === "div" && !host.created) {
        host.created = true;
        return host;
      }
      return createEl(tag);
    },
    getElementById: (id) => findInTree(shadowRoot, `#${id}`),
    body: bodyEl,
    addEventListener: () => {}
  };

  const messageListeners = [];
  const chromeMock = {
    runtime: {
      sendMessage: onSendMessage || (async () => ({
        success: true,
        data: { categories: [], groups: [], links: [] },
        linkMetrics: [],
        groupMetrics: [],
        lang: "en",
        shortcutStatus: { isBound: true, shortcut: "Ctrl+Shift+K" }
      })),
      onMessage: {
        addListener: (fn) => messageListeners.push(fn)
      }
    }
  };

  const windowMock = {
    __POWERLESS_TOY_OVERLAY_INITIALIZED__: false,
    document: documentMock,
    chrome: chromeMock,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    location: { href: "https://example.com/test-article" },
    navigator: { platform: "MacIntel" }
  };

  const sandbox = {
    window: windowMock,
    document: documentMock,
    chrome: chromeMock,
    setTimeout: windowMock.setTimeout,
    clearTimeout: windowMock.clearTimeout,
    console,
    URL,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Date,
    RegExp
  };

  const context = vm.createContext(sandbox);

  return {
    context,
    sandbox,
    host,
    shadowRoot,
    messageListeners
  };
}

describe("Overlay Lifecycle & Robust Injection (v0.4.1 Fixes)", () => {
  it("Requirement 1: openOverlay explicitly accepts initialQuery parameter and sets input value", () => {
    assert.ok(
      overlaySource.includes("async function openOverlay(initialQuery = \"\")"),
      "openOverlay must be declared with (initialQuery = \"\")"
    );
    assert.ok(
      !overlaySource.includes("openOverlay();\n})()"),
      "overlay.js must NOT automatically invoke openOverlay() at the bottom of the file"
    );
  });

  it("Requirement 2: Initial script injection does NOT auto-open overlay; opening is purely message-driven", () => {
    const { context, sandbox } = createMockOverlayEnvironment();
    vm.runInContext(overlaySource, context);

    assert.equal(sandbox.window.__POWERLESS_TOY_OVERLAY_INITIALIZED__, true);
    const controller = sandbox.window.__POWERLESS_TOY_OVERLAY_CONTROLLER__;
    assert.ok(controller, "Controller must be exposed on window");
    assert.equal(controller.getState().isOpen, false, "Overlay must remain closed after initial injection");
  });

  it("Requirement 3 & 4: executeScript does NOT rely on setTimeout 150ms remedy in background", () => {
    const bgSource = fs.readFileSync(path.join(appDir, "src/background/index.js"), "utf8");
    assert.ok(
      !bgSource.includes("150"),
      "Background script must not contain setTimeout 150ms remedy"
    );
    assert.ok(
      !bgSource.includes("setTimeout"),
      "Background script must have zero setTimeout timers"
    );
  });

  it("Requirement 5: First open follows exact 10-step lifecycle and returns success", async () => {
    const { context, sandbox } = createMockOverlayEnvironment();
    vm.runInContext(overlaySource, context);
    const controller = sandbox.window.__POWERLESS_TOY_OVERLAY_CONTROLLER__;

    const res = await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "github",
      triggerSource: "shortcut"
    });

    assert.equal(res.success, true);
    assert.equal(res.state, "opened");
    assert.equal(controller.getState().isOpen, true);
    assert.equal(controller.getState().query, "github");
    assert.equal(controller.getState().scope, "all");
  });

  it("Requirement 6: Repeated shortcut while open toggles scope between all and bookmarks", async () => {
    const { context, sandbox } = createMockOverlayEnvironment();
    vm.runInContext(overlaySource, context);
    const controller = sandbox.window.__POWERLESS_TOY_OVERLAY_CONTROLLER__;

    // 1. Open
    await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "",
      triggerSource: "shortcut"
    });
    assert.equal(controller.getState().scope, "all");

    // 2. Repeat shortcut
    const res2 = await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "",
      triggerSource: "shortcut"
    });
    assert.equal(res2.success, true);
    assert.equal(res2.state, "scope-toggled");
    assert.equal(controller.getState().scope, "bookmarks");

    // 3. Repeat shortcut again
    const res3 = await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "",
      triggerSource: "shortcut"
    });
    assert.equal(res3.state, "scope-toggled");
    assert.equal(controller.getState().scope, "all");
  });

  it("Requirement 7: Message carrying initialQuery while open updates query and does NOT toggle scope", async () => {
    const { context, sandbox } = createMockOverlayEnvironment();
    vm.runInContext(overlaySource, context);
    const controller = sandbox.window.__POWERLESS_TOY_OVERLAY_CONTROLLER__;

    // Open first
    await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "initial",
      triggerSource: "shortcut"
    });

    // Send update query
    const res = await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "dict apple",
      triggerSource: "contextMenu"
    });

    assert.equal(res.success, true);
    assert.equal(res.state, "updated");
    assert.equal(controller.getState().query, "dict apple");
    assert.equal(controller.getState().scope, "all", "Scope must remain unchanged on query update");
  });

  it("Requirement 8: Action click while open does NOT toggle scope", async () => {
    const { context, sandbox } = createMockOverlayEnvironment();
    vm.runInContext(overlaySource, context);
    const controller = sandbox.window.__POWERLESS_TOY_OVERLAY_CONTROLLER__;

    await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "",
      triggerSource: "action"
    });
    assert.equal(controller.getState().scope, "all");

    // Click action again
    const res = await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "",
      triggerSource: "action"
    });
    assert.equal(res.success, true);
    assert.equal(controller.getState().scope, "all", "Action click must not toggle scope");
  });

  it("Requirement 9: Background data fetch failure is handled gracefully without unhandled rejection", async () => {
    const { context, sandbox } = createMockOverlayEnvironment({
      onSendMessage: async () => {
        throw new Error("Extension context invalidated");
      }
    });
    vm.runInContext(overlaySource, context);
    const controller = sandbox.window.__POWERLESS_TOY_OVERLAY_CONTROLLER__;

    // Must not throw UnhandledPromiseRejection
    const res = await controller.handleMessage({
      type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery: "",
      triggerSource: "shortcut"
    });

    assert.equal(res.success, true);
    assert.equal(res.state, "opened");
    const data = JSON.parse(JSON.stringify(controller.getState().data));
    assert.deepEqual(data, { categories: [], groups: [], links: [] });
  });
});

describe("Background Dispatch & Service Worker Stability (v0.4.1 Fixes)", () => {
  let createdTabs = [];
  let sentMessages = [];
  let executedScripts = [];

  beforeEach(() => {
    createdTabs = [];
    sentMessages = [];
    executedScripts = [];

    globalThis.chrome = {
      runtime: {
        getURL: (p) => `chrome-extension://mock-id/${p}`
      },
      tabs: {
        query: async () => [{ id: 101, url: "https://news.ycombinator.com" }],
        get: async (tabId) => ({ id: tabId, url: "https://news.ycombinator.com" }),
        create: async (opts) => {
          createdTabs.push(opts);
          return { id: 201, ...opts };
        },
        sendMessage: async (tabId, msg) => {
          sentMessages.push({ tabId, msg });
          return { success: true, state: "opened" };
        }
      },
      scripting: {
        executeScript: async (opts) => {
          executedScripts.push(opts);
          return [{ result: null }];
        }
      }
    };
  });

  it("Requirement 10: Restricted URL triggers fallback without calling executeScript", async () => {
    const restrictedUrls = [
      "chrome://extensions",
      "chrome-extension://other-ext/index.html",
      "about:blank",
      "https://chromewebstore.google.com/detail/xyz",
      "https://addons.mozilla.org/en-US/firefox/"
    ];

    for (const url of restrictedUrls) {
      assert.equal(isRestrictedUrl(url), true, `URL should be restricted: ${url}`);
      createdTabs = [];
      executedScripts = [];
      globalThis.chrome.tabs.query = async () => [{ id: 99, url }];

      await handleTriggerOverlay(null, { initialQuery: "search query" });

      assert.equal(executedScripts.length, 0, "Must NOT attempt executeScript on restricted page");
      assert.equal(createdTabs.length, 1, "Must open fallback new tab");
      assert.ok(createdTabs[0].url.includes("search=search%20query"));
    }
  });

  it("Requirement 11: Loading / navigation failure retries at most once and falls back cleanly", async () => {
    let executeAttempts = 0;
    globalThis.chrome.scripting.executeScript = async () => {
      executeAttempts++;
      throw new Error("Frame was removed during execution");
    };

    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));

    try {
      await executeInjectionWithRetry(101, {
        type: "OPEN_BOOKMARK_ORGANIZER_OVERLAY",
        initialQuery: "test",
        triggerSource: "shortcut"
      });

      assert.equal(executeAttempts, 2, "Must retry at most once (attempt 1 + retry = 2 attempts)");
      assert.equal(createdTabs.length, 1, "Must open fallback newtab search upon final failure");
      assert.ok(
        warnings.some((w) => w.includes("tabId=101") && w.includes("urlType=webpage")),
        "Structured warning must record tabId and urlType without sensitive query"
      );
    } finally {
      console.warn = origWarn;
    }
  });

  it("Requirement 12: Normal webpage with existing overlay sends message directly without executeScript", async () => {
    await handleTriggerOverlay({ id: 101, url: "https://example.com" });

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].msg.type, "OPEN_BOOKMARK_ORGANIZER_OVERLAY");
    assert.equal(executedScripts.length, 0, "Must not inject if overlay responds successfully");
    assert.equal(createdTabs.length, 0);
  });

  it("Requirement 13 & 14: Manifest isolation verifies Chrome has no background.scripts and Firefox has no service_worker", () => {
    buildTarget("chrome");
    buildTarget("firefox");

    const chromeManifest = JSON.parse(
      fs.readFileSync(path.join(appDir, "dist/chrome/manifest.json"), "utf8")
    );
    const firefoxManifest = JSON.parse(
      fs.readFileSync(path.join(appDir, "dist/firefox/manifest.json"), "utf8")
    );

    assert.equal(chromeManifest.background.scripts, undefined, "Chrome manifest must NOT contain background.scripts");
    assert.equal(chromeManifest.background.service_worker, "src/background/index.js");

    assert.equal(firefoxManifest.background.service_worker, undefined, "Firefox manifest must NOT contain service_worker");
    assert.deepEqual(firefoxManifest.background.scripts, ["src/background/index.js"]);
  });
});
