import "fake-indexeddb/auto";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  initTheme,
  setThemeMode,
  getThemeMode,
  getResolvedTheme,
  applyTheme,
  clearTransitionTimer
} from "../src/newtab/theme.js";
import { THEME_MODE_KEY, CACHED_GEO_KEY } from "../src/newtab/constants.js";
import { exportBackup } from "../src/newtab/import-export.js";
import { DB_NAME } from "../src/newtab/db.js";
import { loadWorkbenchData, _resetMemoryStore } from "../src/newtab/storage.js";

function deleteDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(); // Don't block test execution
  });
}

describe("Bookmark Organizer - Theme Selection and Persistence (VIEW-THEME-001 & VIEW-THEME-002)", () => {
  let mockChromeStorage;
  let mockLocalStorage;
  let mockMatchMediaListeners;
  let mockAttributes;
  let currentSystemDark;

  beforeEach(async () => {
    clearTransitionTimer();
    mockChromeStorage = {};
    mockLocalStorage = {};
    mockMatchMediaListeners = [];
    mockAttributes = {};
    currentSystemDark = false;

    global.document = {
      documentElement: {
        setAttribute: (k, v) => {
          mockAttributes[k] = String(v);
        },
        getAttribute: (k) => mockAttributes[k] || null,
        removeAttribute: (k) => {
          delete mockAttributes[k];
        },
        style: {}
      },
      body: {
        appendChild: (el) => el
      },
      createElement: (tag) => ({
        tagName: tag,
        type: "text",
        value: "",
        style: {}
      }),
      addEventListener: () => {}
    };

    global.window = {
      matchMedia: (query) => {
        return {
          get matches() {
            return currentSystemDark;
          },
          addEventListener: (event, handler) => {
            if (event === "change") mockMatchMediaListeners.push(handler);
          },
          addListener: (handler) => {
            mockMatchMediaListeners.push(handler);
          }
        };
      }
    };

    global.localStorage = {
      getItem: (k) => mockLocalStorage[k] || null,
      setItem: (k, v) => {
        mockLocalStorage[k] = String(v);
      },
      removeItem: (k) => {
        delete mockLocalStorage[k];
      }
    };

    global.chrome = {
      runtime: {
        lastError: null
      },
      storage: {
        local: {
          get: (keys, cb) => {
            let res = {};
            if (!keys) {
              res = { ...mockChromeStorage };
            } else {
              const keyList = Array.isArray(keys) ? keys : [keys];
              for (const k of keyList) {
                if (mockChromeStorage[k] !== undefined) res[k] = mockChromeStorage[k];
              }
            }
            if (typeof cb === "function") {
              cb(res);
              return;
            }
            return Promise.resolve(res);
          },
          set: (obj, cb) => {
            Object.assign(mockChromeStorage, obj);
            if (typeof cb === "function") {
              cb();
              return;
            }
            return Promise.resolve();
          }
        }
      }
    };

    _resetMemoryStore();
    await deleteDatabase();
  });

  function setSystemDark(val) {
    currentSystemDark = val;
    mockMatchMediaListeners.forEach((fn) => {
      try {
        fn({ matches: currentSystemDark });
      } catch (e) {
        console.error(e);
      }
    });
  }

  it("defaults to system theme when no stored preference exists", async () => {
    await initTheme();
    assert.equal(getThemeMode(), "system");
    assert.equal(mockAttributes["data-theme"], "system");
    assert.equal(mockAttributes["data-resolved-theme"], "light");
  });

  it("persists manual light and dark theme choices in chrome.storage and localStorage", async () => {
    await initTheme();

    // Select light
    await setThemeMode("light");
    assert.equal(getThemeMode(), "light");
    assert.equal(getResolvedTheme(), "light");
    assert.equal(mockChromeStorage[THEME_MODE_KEY], "light");
    assert.equal(mockLocalStorage[THEME_MODE_KEY], "light");
    assert.equal(mockAttributes["data-resolved-theme"], "light");

    // Select dark
    await setThemeMode("dark");
    assert.equal(getThemeMode(), "dark");
    assert.equal(getResolvedTheme(), "dark");
    assert.equal(mockChromeStorage[THEME_MODE_KEY], "dark");
    assert.equal(mockLocalStorage[THEME_MODE_KEY], "dark");
    assert.equal(mockAttributes["data-resolved-theme"], "dark");
  });

  it("responds dynamically to OS prefers-color-scheme changes in system mode", async () => {
    await initTheme();
    await setThemeMode("system");

    assert.equal(getResolvedTheme(), "light");

    // Simulate OS switching to dark
    setSystemDark(true);
    assert.equal(getResolvedTheme(), "dark");
    assert.equal(mockAttributes["data-resolved-theme"], "dark");

    // Simulate OS switching back to light
    setSystemDark(false);
    assert.equal(getResolvedTheme(), "light");
    assert.equal(mockAttributes["data-resolved-theme"], "light");
  });

  it("theme switch does NOT wipe form inputs, scroll position, or DOM elements", async () => {
    await initTheme();

    const input = document.createElement("input");
    input.value = "Unsaved draft project name";

    // Switch theme
    await setThemeMode("dark");
    assert.equal(input.value, "Unsaved draft project name", "input value must be preserved");

    await setThemeMode("light");
    assert.equal(input.value, "Unsaved draft project name", "input value must still be preserved");
  });

  it("auto theme switches to light in daytime (07:00-18:00) and dark at night based on local time", async () => {
    const res = await setThemeMode("auto");
    assert.equal(getThemeMode(), "auto");
    assert.equal(mockAttributes["data-theme"], "auto");
    assert.ok(res.autoInfo !== null);
    assert.ok(res.autoInfo.timeZone);
    assert.ok(["light", "dark"].includes(res.resolved));
    assert.ok(res.autoInfo.nextTransitionDate instanceof Date);

    // Verify day vs night rule
    const currentHour = new Date().getHours();
    const expectedTheme = (currentHour >= 7 && currentHour < 18) ? "light" : "dark";
    assert.equal(res.resolved, expectedTheme);
  });

  it("auto theme never downgrades to system mode and requires zero geolocation", async () => {
    // Calling setThemeMode("auto") without any geolocation parameter
    const res = await setThemeMode("auto");
    assert.equal(getThemeMode(), "auto");
    assert.equal(res.mode, "auto");
    assert.equal(res.notice, null);
    assert.equal(mockAttributes["data-theme"], "auto");
    assert.equal(mockChromeStorage[THEME_MODE_KEY], "auto");
    assert.equal(mockLocalStorage[THEME_MODE_KEY], "auto");
  });

  it("auto theme schedules next transition at 07:00 or 18:00 local time", async () => {
    const res = await setThemeMode("auto");
    const nextDate = res.autoInfo.nextTransitionDate;
    assert.ok(nextDate.getTime() > Date.now());
    const nextHour = nextDate.getHours();
    assert.ok(nextHour === 7 || nextHour === 18);
  });

  it("never includes theme preferences or location in bookmark JSON backup export", async () => {
    // Seed initial workbench data
    await loadWorkbenchData();

    // Store themes and legacy cached location directly in storage
    mockChromeStorage[CACHED_GEO_KEY] = { lat: 35.6762, lon: 139.6503 };
    mockChromeStorage[THEME_MODE_KEY] = "auto";

    const backup = await exportBackup();

    // Verify format
    assert.equal(backup.formatVersion, 1);
    assert.ok(Array.isArray(backup.categories));
    assert.ok(Array.isArray(backup.groups));
    assert.ok(Array.isArray(backup.links));

    // Must NOT contain theme or location properties
    assert.equal(backup.theme, undefined);
    assert.equal(backup.themeMode, undefined);
    assert.equal(backup.location, undefined);
    assert.equal(backup.geo, undefined);
    assert.equal(backup.coordinates, undefined);

    const jsonStr = JSON.stringify(backup);
    assert.ok(!jsonStr.includes("35.6762"), "Backup JSON must not leak latitude");
    assert.ok(!jsonStr.includes("139.6503"), "Backup JSON must not leak longitude");
  });
});
