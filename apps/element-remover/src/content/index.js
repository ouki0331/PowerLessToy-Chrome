/**
 * Content Script entry point for Element Remover.
 */

import { DomEngine } from './dom-engine.js';
import { PickerOverlay } from './picker-overlay.js';
import { DebugOverlay } from './debug-overlay.js';
import { getRulesForUrl, setRuleEnabled } from '../common/storage.js';
import { normalizeUrl } from '../common/scope.js';

let engine = null;
let picker = null;
let debugOverlay = null;
let isDebugActive = false;

async function bootstrap() {
  const currentUrl = window.location.href;
  const normalized = normalizeUrl(currentUrl);

  // Load rules matching this URL
  let matchedRules = [];
  try {
    matchedRules = await getRulesForUrl(currentUrl);
  } catch (err) {
    console.warn('[Element Remover] Error loading rules:', err);
  }

  // Initialize DOM engine
  engine = new DomEngine(document);
  engine.init(matchedRules, (counts) => {
    // Notify background service worker of updated instance count
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'UPDATE_BADGE',
        count: counts.total
      }).catch(() => {});
    }
  });

  // Initialize overlays
  picker = new PickerOverlay(document);
  debugOverlay = new DebugOverlay(engine, document);

  // Listen for extension runtime messages
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      handleMessage(message).then(sendResponse);
      return true; // async response
    });
  }
}

async function handleMessage(message) {
  if (!message || !message.type) return { success: false };

  switch (message.type) {
    case 'GET_PAGE_STATUS': {
      const counts = engine ? engine.getActiveCounts() : { total: 0, removed: 0, hidden: 0 };
      const normalized = normalizeUrl(window.location.href);

      // Collect rules applied on this page
      const rulesStatus = engine ? engine.rules.map(r => ({
        id: r.id,
        name: r.name,
        action: r.action,
        status: r.status,
        enabled: r.enabled,
        selector: r.selector,
        count: (engine.instances.get(r.id) || []).filter(i => i.active).length
      })) : [];

      return {
        success: true,
        url: window.location.href,
        hostname: normalized.hostname,
        pathname: normalized.pathname,
        counts,
        rules: rulesStatus,
        debugActive: isDebugActive
      };
    }

    case 'START_PICKER': {
      if (picker) {
        picker.start(async () => {
          // Re-load rules after picker completes
          const rules = await getRulesForUrl(window.location.href);
          engine.init(rules);
        });
        return { success: true };
      }
      return { success: false };
    }

    case 'TOGGLE_DEBUG': {
      isDebugActive = Boolean(message.enabled);
      if (debugOverlay) {
        debugOverlay.setEnabled(isDebugActive);
      }
      return { success: true, debugActive: isDebugActive };
    }

    case 'RESTORE_RULE': {
      const ruleId = message.ruleId;
      if (!ruleId || !engine) return { success: false };

      const result = engine.restoreRule(ruleId);
      if (result.success) {
        await setRuleEnabled(ruleId, false);
      } else if (result.requiresReload) {
        await setRuleEnabled(ruleId, false);
        engine.prepareControlledReload(ruleId);
      }
      return result;
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// Start execution
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
