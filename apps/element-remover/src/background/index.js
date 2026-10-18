/**
 * Service Worker background script for Element Remover (STATUS-BADGE-001).
 */

const BADGE_COLOR = '#5b5bd6';
const UNSUPPORTED_PROTOCOLS = ['chrome:', 'chrome-extension:', 'devtools:', 'edge:', 'about:', 'view-source:'];
const UNSUPPORTED_DOMAINS = ['chromewebstore.google.com', 'chrome.google.com'];

// Map of tabId -> count of processed element instances
const tabCounts = new Map();

/**
 * Checks whether a URL is supported for element removing.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isSupportedUrl(url) {
  if (!url || typeof url !== 'string') return false;

  try {
    const parsed = new URL(url);
    if (UNSUPPORTED_PROTOCOLS.includes(parsed.protocol)) {
      return false;
    }
    if (UNSUPPORTED_DOMAINS.includes(parsed.hostname)) {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'file:';
  } catch {
    return false;
  }
}

/**
 * Formats instance count into badge string (STATUS-BADGE-001).
 *
 * @param {number} count
 * @returns {string}
 */
export function formatBadgeText(count) {
  if (!count || count <= 0) return '';
  if (count > 99) return '99+';
  return String(count);
}

/**
 * Updates the extension badge text and color for a specific tab.
 *
 * @param {number} tabId
 * @param {number} count
 */
export async function updateTabBadge(tabId, count) {
  tabCounts.set(tabId, count);

  if (typeof chrome === 'undefined' || !chrome.action) return;

  const text = formatBadgeText(count);
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
    }
  } catch {
    // Tab might have been closed
  }
}

// Set up Chrome extension listeners
if (typeof chrome !== 'undefined') {
  // Listen for messages from content scripts
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'UPDATE_BADGE' && sender.tab) {
        updateTabBadge(sender.tab.id, message.count);
        sendResponse({ success: true });
        return false;
      }

      if (message.type === 'CHECK_SUPPORTED') {
        const supported = isSupportedUrl(message.url);
        sendResponse({ supported });
        return false;
      }
    });
  }

  // Clear badge when tab is updated or closed
  if (chrome.tabs) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.status === 'loading') {
        updateTabBadge(tabId, 0);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      tabCounts.delete(tabId);
    });

    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      const count = tabCounts.get(activeInfo.tabId) || 0;
      updateTabBadge(activeInfo.tabId, count);
    });
  }
}
