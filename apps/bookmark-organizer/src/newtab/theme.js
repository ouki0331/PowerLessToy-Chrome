/**
 * Theme Management for Bookmark Organizer (VIEW-THEME-001 & VIEW-THEME-002)
 * Manages 4 modes: system, light, dark, auto (sunrise/sunset).
 * Zero FOUC, instant reactive updates, strictly local geolocation calculations.
 */

import { THEME_MODE_KEY, CACHED_GEO_KEY, DEFAULT_THEME_MODE } from "./constants.js";
import { getAutoThemeStatus } from "./solar.js";
import { t } from "./i18n.js";

let currentMode = DEFAULT_THEME_MODE;
let currentResolved = "light";
let currentAutoInfo = null;
let transitionTimer = null;
let changeListeners = [];
let mediaQueryList = null;

/**
 * Reads the stored theme mode from storage.
 * @returns {Promise<string>}
 */
export async function getStoredThemeMode() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get([THEME_MODE_KEY]);
      if (res && res[THEME_MODE_KEY]) {
        return res[THEME_MODE_KEY];
      }
    }
  } catch (err) {
    console.warn("Could not read theme from chrome.storage.local:", err);
  }

  try {
    const local = localStorage.getItem(THEME_MODE_KEY);
    if (local) return local;
  } catch {
    // Ignore localStorage access failures
  }

  return DEFAULT_THEME_MODE;
}

/**
 * Reads cached geolocation coordinates.
 * @returns {Promise<{ lat: number, lon: number } | null>}
 */
export async function getCachedGeo() {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get([CACHED_GEO_KEY]);
      if (res && res[CACHED_GEO_KEY]) {
        let val = res[CACHED_GEO_KEY];
        if (typeof val === "string") {
          try {
            val = JSON.parse(val);
          } catch {
            // Ignore parse error
          }
        }
        return val;
      }
    }
  } catch (err) {
    console.warn("Could not read cached geo from chrome.storage.local:", err);
  }

  try {
    const raw = localStorage.getItem(CACHED_GEO_KEY);
    if (raw) {
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Saves geolocation coordinates purely locally.
 * Never exported into bookmark backups or transmitted externally.
 */
export async function saveCachedGeo(lat, lon) {
  const geoObj = { lat, lon, timestamp: Date.now() };
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [CACHED_GEO_KEY]: geoObj });
    }
  } catch {
    // Ignore
  }
  try {
    localStorage.setItem(CACHED_GEO_KEY, JSON.stringify(geoObj));
  } catch {
    // Ignore
  }
}

/**
 * Resolves system color scheme preference.
 * @returns {"light" | "dark"}
 */
export function getSystemResolvedTheme() {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/**
 * Applies the given theme mode and resolved scheme to the DOM without page reload.
 */
export function applyTheme(resolved, mode = currentMode) {
  currentResolved = resolved;
  currentMode = mode;

  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.setAttribute("data-theme", mode);
    document.documentElement.setAttribute("data-resolved-theme", resolved);
    document.documentElement.style.colorScheme = resolved;
  }

  changeListeners.forEach((fn) => {
    try {
      fn({ mode, resolved, autoInfo: currentAutoInfo });
    } catch (e) {
      console.error("Theme listener error:", e);
    }
  });
}

export function clearTransitionTimer() {
  if (transitionTimer) {
    clearTimeout(transitionTimer);
    transitionTimer = null;
  }
}

/**
 * Schedules a seamless transition timer for auto sunrise/sunset mode.
 */
function scheduleAutoTransition(nextDate) {
  clearTransitionTimer();

  if (!nextDate) return;

  const msUntilNext = nextDate.getTime() - Date.now();
  // Buffer by 1 second past boundary
  const delay = Math.max(1000, msUntilNext + 1000);

  // Maximum setTimeout delay in browsers is 2147483647 ms (~24.8 days)
  if (delay < 2147483647) {
    transitionTimer = setTimeout(async () => {
      if (currentMode === "auto") {
        await evaluateAutoTheme();
      }
    }, delay);
    if (transitionTimer && typeof transitionTimer.unref === "function") {
      transitionTimer.unref();
    }
  }
}

/**
 * Resolves day/night theme based on IANA timezone and local hour (07:00 - 18:00 = light, else dark).
 * Eliminates all Geolocation API dependencies.
 */
export function getLocalTimeAutoStatus(date = new Date()) {
  let timeZone = "UTC";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    timeZone = "UTC";
  }

  const hour = date.getHours();
  const isDay = hour >= 7 && hour < 18;
  const resolvedTheme = isDay ? "light" : "dark";

  let nextTransitionDate = new Date(date);
  if (isDay) {
    nextTransitionDate.setHours(18, 0, 0, 0);
  } else if (hour >= 18) {
    nextTransitionDate.setDate(nextTransitionDate.getDate() + 1);
    nextTransitionDate.setHours(7, 0, 0, 0);
  } else {
    nextTransitionDate.setHours(7, 0, 0, 0);
  }

  return {
    timeZone,
    isDay,
    resolvedTheme,
    nextTransitionDate
  };
}

/**
 * Evaluates the auto theme using local time & timezone.
 */
export async function evaluateAutoTheme(date = new Date()) {
  const status = getLocalTimeAutoStatus(date);
  currentAutoInfo = status;
  applyTheme(status.resolvedTheme, "auto");
  scheduleAutoTransition(status.nextTransitionDate);

  return { success: true, status };
}

/**
 * Initializes theme controller and listeners.
 */
export async function initTheme() {
  const storedMode = await getStoredThemeMode();
  currentMode = storedMode;

  // Setup matchMedia listener for system theme changes
  if (typeof window !== "undefined" && window.matchMedia) {
    mediaQueryList = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (currentMode === "system") {
        const resolved = getSystemResolvedTheme();
        applyTheme(resolved, "system");
      }
    };
    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener("change", handleSystemChange);
    } else if (mediaQueryList.addListener) {
      mediaQueryList.addListener(handleSystemChange);
    }
  }

  // Periodic fallback check (e.g. waking up from sleep or tab visibility change)
  if (typeof window !== "undefined") {
    const handleResume = async () => {
      if (currentMode === "auto") {
        await evaluateAutoTheme();
      } else if (currentMode === "system") {
        applyTheme(getSystemResolvedTheme(), "system");
      }
    };

    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible") {
          await handleResume();
        }
      });
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("focus", handleResume);
    }
  }

  if (currentMode === "light") {
    applyTheme("light", "light");
  } else if (currentMode === "dark") {
    applyTheme("dark", "dark");
  } else if (currentMode === "auto") {
    await evaluateAutoTheme();
  } else {
    // Default system
    applyTheme(getSystemResolvedTheme(), "system");
  }

  return { mode: currentMode, resolved: currentResolved, autoInfo: currentAutoInfo };
}

/**
 * Sets theme mode with automatic local time support.
 *
 * @param {"system" | "light" | "dark" | "auto"} targetMode
 * @param {object} [options]
 * @returns {Promise<{ mode: string, resolved: string, autoInfo: object | null, notice?: string }>}
 */
export async function setThemeMode(targetMode, options = {}) {
  let notice = null;

  if (targetMode === "light") {
    currentMode = "light";
    currentAutoInfo = null;
    applyTheme("light", "light");
  } else if (targetMode === "dark") {
    currentMode = "dark";
    currentAutoInfo = null;
    applyTheme("dark", "dark");
  } else if (targetMode === "system") {
    currentMode = "system";
    currentAutoInfo = null;
    applyTheme(getSystemResolvedTheme(), "system");
  } else if (targetMode === "auto") {
    currentMode = "auto";
    const status = getLocalTimeAutoStatus(new Date());
    currentAutoInfo = status;
    applyTheme(status.resolvedTheme, "auto");
    scheduleAutoTransition(status.nextTransitionDate);
  }

  // Persist mode to chrome.storage.local and localStorage
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [THEME_MODE_KEY]: currentMode });
    }
  } catch {
    // Ignore
  }
  try {
    localStorage.setItem(THEME_MODE_KEY, currentMode);
  } catch {
    // Ignore
  }

  return {
    mode: currentMode,
    resolved: currentResolved,
    autoInfo: currentAutoInfo,
    notice
  };
}

export function getThemeMode() {
  return currentMode;
}

export function getResolvedTheme() {
  return currentResolved;
}

export function getAutoInfo() {
  return currentAutoInfo;
}

export function onThemeChange(listener) {
  if (typeof listener === "function") {
    changeListeners.push(listener);
  }
}
