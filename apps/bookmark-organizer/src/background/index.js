/**
 * Background Service Worker for Bookmark Organizer (Manifest V3)
 *
 * Implements:
 * - Authoritative entrypoint for shortcut (open-bookmark-search) and toolbar action icon.
 * - On-demand script injection into normal web pages via activeTab + scripting.
 * - Graceful fallback on restricted browser pages (opens new tab with search overlay).
 * - Direct messaging for existing Bookmark Organizer tabs.
 * - Secure message endpoints for in-page overlay data retrieval and capture saving.
 * - Offline Dictionary message endpoints & contextual lookup (DICT-SETTINGS-001 & DICT-LOOKUP-001).
 */

import {
  loadWorkbenchData,
  addLink,
  getLinkMetricsMap,
  getGroupMetricsMap
} from "../newtab/storage.js";
import {
  getDictSettings,
  saveDictSettings,
  getAiApiKey,
  saveAiApiKey,
  searchDictionary,
  explainWithAi,
  installPack,
  uninstallPack,
  getInstalledPacks,
  clearAiCache,
  clearHistory
} from "../dict/dict-service.js";
import { DICT_MESSAGE_TYPES } from "../dict/dict-constants.js";

const CONTEXT_MENU_ID = "dict-lookup-selection";

/**
 * Synchronize context menu with dictionary settings
 */
export async function updateContextMenuState() {
  if (typeof chrome === "undefined" || !chrome.contextMenus) return;
  try {
    const settings = await getDictSettings();
    await chrome.contextMenus.removeAll();
    if (settings.enabled && settings.contextMenuEnabled) {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: "Look up in PowerLessToy",
        contexts: ["selection"]
      });
    }
  } catch (err) {
    console.warn("Failed to update context menu state:", err);
  }
}

if (typeof chrome !== "undefined" && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
      console.log("PowerLessToy Bookmark Organizer installed successfully.");
    }
    await updateContextMenuState();
  });
}

if (typeof chrome !== "undefined" && chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    await updateContextMenuState();
  });
}

/**
 * Check if a URL belongs to the Bookmark Organizer extension itself.
 */
export function isBookmarkOrganizerUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const url = rawUrl.toLowerCase().trim();

  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    try {
      const newTabBase = chrome.runtime.getURL("src/newtab/index.html").toLowerCase();
      if (url.startsWith(newTabBase) || url.replace(/\/+$/, "") === newTabBase.replace(/\/+$/, "")) {
        return true;
      }
    } catch {}
  }

  const extensionId = typeof chrome !== "undefined" && chrome.runtime?.id ? chrome.runtime.id.toLowerCase() : "";
  if (extensionId && (url.startsWith(`chrome-extension://${extensionId}/`) || url.startsWith(`moz-extension://${extensionId}/`))) {
    if (url.includes("/src/newtab/index.html") || url.includes("/newtab.html")) {
      return true;
    }
  }

  if (url.includes("/src/newtab/index.html") || url.endsWith("/newtab.html")) {
    return true;
  }

  return false;
}

/**
 * Check if a URL cannot be injected with content scripts (browser internal, extension store, etc.).
 * Note: Bookmark Organizer's own new tab page is NOT restricted.
 */
export function isRestrictedUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return true;
  if (isBookmarkOrganizerUrl(rawUrl)) return false;

  const url = rawUrl.toLowerCase().trim();
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("moz-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("view-source:") ||
    url.startsWith("devtools://") ||
    url.includes("chromewebstore.google.com") ||
    url.includes("chrome.google.com/webstore") ||
    url.includes("addons.mozilla.org")
  );
}

/**
 * Check shortcut binding status via chrome.commands.getAll().
 */
export async function getShortcutBindingStatus() {
  if (typeof chrome === "undefined" || !chrome.commands?.getAll) {
    return { name: "open-bookmark-search", shortcut: "Ctrl+Shift+K", isBound: true };
  }
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === "open-bookmark-search");
    return {
      name: "open-bookmark-search",
      shortcut: cmd?.shortcut || "",
      isBound: Boolean(cmd?.shortcut && cmd.shortcut.trim().length > 0)
    };
  } catch (err) {
    return { name: "open-bookmark-search", shortcut: "", isBound: false, error: err.message };
  }
}

/**
 * Main trigger router for shortcut or action icon.
 */
export async function handleTriggerOverlay(targetTab = null, { initialQuery = "" } = {}) {
  let tab = targetTab;
  if (!tab || !tab.id) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs?.[0] || null;
  }
  if (!tab || !tab.id) return;

  const url = tab.url || "";
  const queryParam = initialQuery ? `search=${encodeURIComponent(initialQuery)}` : "search";

  // 1. Bookmark Organizer new tab page -> Trigger native spotlight search
  if (isBookmarkOrganizerUrl(url)) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "OPEN_BOOKMARK_SEARCH",
        initialQuery
      });
      if (response?.success) return;
    } catch {}

    try {
      await chrome.runtime.sendMessage({
        type: "OPEN_BOOKMARK_SEARCH",
        tabId: tab.id,
        initialQuery
      });
    } catch {}
    return;
  }

  // 2. Restricted browser page -> Fallback: Open Bookmark Organizer with search overlay
  if (isRestrictedUrl(url)) {
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`src/newtab/index.html#${queryParam}`)
    });
    return;
  }

  // 3. Normal webpage -> Toggle or on-demand inject in-page overlay
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "TOGGLE_BOOKMARK_ORGANIZER_OVERLAY",
      initialQuery
    });
  } catch {
    // Content script not yet present in this tab -> inject on demand
    try {
      if (chrome.scripting?.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["src/content/overlay.js"]
        });
        // Send initialQuery after injection
        setTimeout(() => {
          if (typeof chrome !== "undefined" && chrome.tabs?.sendMessage) {
            chrome.tabs.sendMessage(tab.id, {
              type: "TOGGLE_BOOKMARK_ORGANIZER_OVERLAY",
              initialQuery
            }).catch(() => {});
          }
        }, 150);
      } else {
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`src/newtab/index.html#${queryParam}`)
        });
      }
    } catch (err) {
      console.warn("Failed to inject overlay, falling back to new tab:", err);
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`src/newtab/index.html#${queryParam}`)
      });
    }
  }
}

// Shortcut listener (Commands API)
if (typeof chrome !== "undefined" && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === "open-bookmark-search") {
      await handleTriggerOverlay();
    }
  });
}

// Action icon click listener (when default_popup is omitted)
if (typeof chrome !== "undefined" && chrome.action?.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    await handleTriggerOverlay(tab);
  });
}

// Context Menu listener
if (typeof chrome !== "undefined" && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === CONTEXT_MENU_ID && info.selectionText) {
      const text = info.selectionText.trim();
      if (text) {
        await handleTriggerOverlay(tab, { initialQuery: `dict ${text}` });
      }
    }
  });
}

// Internal messaging
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return;

    if (message.type === "GET_OVERLAY_DATA") {
      (async () => {
        try {
          const data = await loadWorkbenchData();
          const linkMetricsMap = await getLinkMetricsMap();
          const groupMetricsMap = await getGroupMetricsMap();
          const storageRes = await chrome.storage.local.get("powerless_toy_lang").catch(() => ({}));
          const lang = storageRes?.powerless_toy_lang || "en";
          const shortcutStatus = await getShortcutBindingStatus();
          const dictSettings = await getDictSettings();

          sendResponse({
            success: true,
            data,
            linkMetrics: Array.from(linkMetricsMap.entries()),
            groupMetrics: Array.from(groupMetricsMap.entries()),
            lang,
            shortcutStatus,
            dictSettings
          });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === "SAVE_CAPTURED_LINK") {
      (async () => {
        try {
          const data = await loadWorkbenchData();
          const newLink = await addLink(data, message.groupId, {
            name: message.name,
            url: message.url,
            badge: message.badge || ""
          });
          sendResponse({ success: true, link: newLink });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === "CHECK_SHORTCUT_STATUS") {
      (async () => {
        const status = await getShortcutBindingStatus();
        sendResponse(status);
      })();
      return true;
    }

    if (message.type === "OPEN_SHORTCUTS_SETTINGS") {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
      sendResponse({ success: true });
      return;
    }

    if (message.type === "OPEN_URL") {
      if (message.inBackground) {
        chrome.tabs.create({ url: message.url, active: false });
      } else if (sender.tab?.id) {
        chrome.tabs.update(sender.tab.id, { url: message.url });
      } else {
        chrome.tabs.create({ url: message.url });
      }
      sendResponse({ success: true });
      return;
    }

    if (message.type === "OPEN_WORKBENCH") {
      const url = chrome.runtime.getURL(`src/newtab/index.html${message.hash || ""}`);
      chrome.tabs.create({ url });
      sendResponse({ success: true });
      return;
    }

    // --- Dictionary Endpoints ---
    if (message.type === DICT_MESSAGE_TYPES.SEARCH) {
      (async () => {
        try {
          const res = await searchDictionary(message.query, message.options);
          sendResponse({ success: true, ...res });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.GET_SETTINGS) {
      (async () => {
        try {
          const settings = await getDictSettings();
          sendResponse({ success: true, settings });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.SAVE_SETTINGS) {
      (async () => {
        try {
          const updated = await saveDictSettings(message.settings);
          await updateContextMenuState();
          sendResponse({ success: true, settings: updated });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.GET_AI_KEY) {
      (async () => {
        try {
          const key = await getAiApiKey();
          sendResponse({ success: true, hasKey: Boolean(key), key });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.SAVE_AI_KEY) {
      (async () => {
        try {
          await saveAiApiKey(message.key);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.GET_PACK_STATUS) {
      (async () => {
        try {
          const packs = await getInstalledPacks();
          sendResponse({ success: true, packs });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.INSTALL_PACK) {
      (async () => {
        try {
          const packId = message.packId;
          const fileName = packId === "ja_jmdict" ? "dict_ja_jmdict.json" : "dict_en_wordnet.json";
          const packUrl = chrome.runtime.getURL(`src/dict/packs/${fileName}`);
          const res = await fetch(packUrl);
          if (!res.ok) throw new Error(`Could not load pack file: ${fileName}`);
          const packData = await res.json();
          await installPack(packData);
          const settings = await getDictSettings();
          await saveDictSettings({
            installedPacks: { ...settings.installedPacks, [packId]: true }
          });
          sendResponse({ success: true, packId });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.UNINSTALL_PACK) {
      (async () => {
        try {
          const packId = message.packId;
          await uninstallPack(packId);
          const settings = await getDictSettings();
          await saveDictSettings({
            installedPacks: { ...settings.installedPacks, [packId]: false }
          });
          sendResponse({ success: true, packId });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.AI_EXPLAIN) {
      (async () => {
        try {
          const result = await explainWithAi(message.params);
          sendResponse({ success: true, result });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.CLEAR_CACHE) {
      (async () => {
        try {
          await clearAiCache();
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }

    if (message.type === DICT_MESSAGE_TYPES.CLEAR_HISTORY) {
      (async () => {
        try {
          await clearHistory();
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
  });
}
