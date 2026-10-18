/**
 * DOM manipulation engine for Element Remover.
 * Handles element removal, hiding, early suppression, in-situ restore, and reload fallback.
 * (ACTION-APPLY-001, STATUS-DEBUG-001, RULE-MATCH-001, STATUS-BADGE-001)
 */

import { evaluateSelectorReliability } from './selector.js';

const ANCHOR_PREFIX = 'element-remover-anchor';
const HIDE_ATTRIBUTE = 'data-element-remover-hidden';
const EARLY_STYLE_ID = 'element-remover-early-suppress';
const RELOAD_STATE_KEY = 'element_remover_reload_restore_v1';

export class DomEngine {
  constructor(documentRef = (typeof document !== 'undefined' ? document : null)) {
    this.doc = documentRef;
    this.rules = [];
    // Registry of processed element instances: Map<string, Array<InstanceRecord>>
    this.instances = new Map();
    this.observer = null;
    this.onCountChange = null;
    this.earlyStyleElement = null;
  }

  /**
   * Initializes the engine with rules for the current page.
   *
   * @param {Array<object>} rules
   * @param {Function} onCountChange
   */
  init(rules = [], onCountChange = null) {
    this.rules = rules.filter(r => r.enabled);
    this.onCountChange = onCountChange;
    this.setupEarlySuppression();
    this.processAllRules();
    this.setupMutationObserver();
    this.checkPendingReloadRestore();
  }

  /**
   * Cleans up observer and restored elements.
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.earlyStyleElement && this.earlyStyleElement.parentNode) {
      this.earlyStyleElement.remove();
    }
  }

  /**
   * Injects CSS rules to hide matching elements as early as possible before render (DEC-001).
   */
  setupEarlySuppression() {
    if (!this.doc || !this.doc.head || typeof this.doc.head.appendChild !== 'function') return;

    const selectors = this.rules
      .filter(r => r.enabled && r.selector)
      .map(r => r.selector);

    if (selectors.length === 0) return;

    if (!this.earlyStyleElement) {
      this.earlyStyleElement = this.doc.createElement('style');
      this.earlyStyleElement.id = EARLY_STYLE_ID;
      this.doc.head.appendChild(this.earlyStyleElement);
    }

    // Early suppress visibility to avoid flash
    this.earlyStyleElement.textContent = selectors
      .map(sel => `${sel} { visibility: hidden !important; }`)
      .join('\n');
  }

  /**
   * Evaluates and applies all active rules to the document.
   */
  processAllRules() {
    if (!this.doc) return;

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      this.applyRule(rule);
    }

    this.notifyCountChange();
  }

  /**
   * Applies a single rule according to RULE-MATCH-001 and ACTION-APPLY-001.
   *
   * @param {object} rule
   */
  applyRule(rule) {
    if (!this.doc || !rule.selector) return;

    const evalResult = evaluateSelectorReliability(
      rule.selector,
      rule.fingerprint || {},
      this.doc
    );

    // If expected 1 and found multiple: SUSPEND rule for safety! (RULE-MATCH-001)
    if (evalResult.status === 'needs_review') {
      rule.status = 'needs_review';
      return;
    }

    rule.status = evalResult.status;
    const elements = evalResult.elements;
    if (elements.length === 0) return;

    if (!this.instances.has(rule.id)) {
      this.instances.set(rule.id, []);
    }
    const ruleInstances = this.instances.get(rule.id);

    elements.forEach((element, index) => {
      // Check if already processed
      if (element.hasAttribute && element.hasAttribute(HIDE_ATTRIBUTE)) return;
      if (element.__elementRemoverProcessed) return;

      const instanceId = `${rule.id}_inst_${index}_${Date.now()}`;

      if (rule.action === 'hide') {
        // ACTION-APPLY-001: Hide target, keep in DOM
        element.setAttribute(HIDE_ATTRIBUTE, 'true');
        element.style.setProperty('display', 'none', 'important');
        element.style.setProperty('visibility', 'hidden', 'important');
        element.__elementRemoverProcessed = instanceId;

        ruleInstances.push({
          instanceId,
          ruleId: rule.id,
          action: 'hide',
          element,
          active: true
        });
      } else {
        // ACTION-APPLY-001: Remove target from structure, create anchor comment
        const parent = element.parentNode;
        if (!parent) return;

        const anchor = this.doc.createComment(`${ANCHOR_PREFIX}:${rule.id}:${instanceId}`);
        parent.insertBefore(anchor, element);

        element.__elementRemoverProcessed = instanceId;
        parent.removeChild(element);

        ruleInstances.push({
          instanceId,
          ruleId: rule.id,
          action: 'remove',
          element,
          anchor,
          parent,
          active: true
        });
      }
    });
  }

  /**
   * Sets up a MutationObserver to handle dynamically rendered elements without infinite badge accumulation.
   */
  setupMutationObserver() {
    if (!this.doc || typeof MutationObserver === 'undefined') return;

    this.observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length > 0) {
          shouldProcess = true;
          break;
        }
      }

      if (shouldProcess) {
        this.processAllRules();
      }
    });

    this.observer.observe(this.doc.body || this.doc.documentElement, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Calculates the total number of active element instances processed on this page (STATUS-BADGE-001).
   *
   * @returns {{ total: number, removed: number, hidden: number }}
   */
  getActiveCounts() {
    let removed = 0;
    let hidden = 0;

    for (const instances of this.instances.values()) {
      for (const inst of instances) {
        if (inst.active) {
          if (inst.action === 'remove') removed++;
          else if (inst.action === 'hide') hidden++;
        }
      }
    }

    return {
      total: removed + hidden,
      removed,
      hidden
    };
  }

  notifyCountChange() {
    if (typeof this.onCountChange === 'function') {
      this.onCountChange(this.getActiveCounts());
    }
  }

  /**
   * Attempts direct in-situ restoration for a rule (STATUS-DEBUG-001, DEC-011).
   * If in-situ restore is unsafe or anchor is missing, returns { requiresReload: true }.
   *
   * @param {string} ruleId
   * @returns {{ success: boolean, restoredCount: number, requiresReload?: boolean, reason?: string }}
   */
  restoreRule(ruleId) {
    const instances = this.instances.get(ruleId);
    if (!instances || instances.length === 0) {
      return { success: false, restoredCount: 0, requiresReload: true, reason: '未找到元素实例缓存' };
    }

    let restoredCount = 0;
    let requiresReload = false;

    for (const inst of instances) {
      if (!inst.active) continue;

      if (inst.action === 'hide') {
        // Direct unhide
        if (inst.element) {
          inst.element.removeAttribute(HIDE_ATTRIBUTE);
          inst.element.style.removeProperty('display');
          inst.element.style.removeProperty('visibility');
          delete inst.element.__elementRemoverProcessed;
          inst.active = false;
          restoredCount++;
        }
      } else if (inst.action === 'remove') {
        // Direct in-situ DOM reinsertion before anchor
        const anchor = inst.anchor;
        const element = inst.element;

        if (anchor && anchor.parentNode) {
          anchor.parentNode.insertBefore(element, anchor);
          anchor.remove();
          delete element.__elementRemoverProcessed;
          inst.active = false;
          restoredCount++;
        } else {
          // Anchor missing or container rebuilt -> requires reload fallback
          requiresReload = true;
        }
      }
    }

    // Disable this rule in our local rule list
    const rule = this.rules.find(r => r.id === ruleId);
    if (rule) {
      rule.enabled = false;
    }

    this.notifyCountChange();

    if (requiresReload && restoredCount === 0) {
      return {
        success: false,
        restoredCount: 0,
        requiresReload: true,
        reason: '目标容器已重建，原位锚点失效'
      };
    }

    return {
      success: true,
      restoredCount,
      requiresReload: requiresReload
    };
  }

  /**
   * Prepares for controlled reload fallback (STATUS-DEBUG-001, 场景 D).
   * Saves current scroll position and URL to sessionStorage before reload.
   */
  prepareControlledReload(ruleId) {
    if (typeof window === 'undefined' || !window.sessionStorage) return;

    const state = {
      ruleId,
      url: window.location.href,
      scrollX: window.scrollX || 0,
      scrollY: window.scrollY || 0,
      timestamp: Date.now()
    };

    try {
      window.sessionStorage.setItem(RELOAD_STATE_KEY, JSON.stringify(state));
    } catch {
      // Ignore quota error
    }
  }

  /**
   * Checks and executes scroll position restoration on page load after controlled reload.
   */
  checkPendingReloadRestore() {
    if (typeof window === 'undefined' || !window.sessionStorage) return;

    try {
      const raw = window.sessionStorage.getItem(RELOAD_STATE_KEY);
      if (!raw) return;

      const state = JSON.parse(raw);
      // Valid for 60 seconds
      if (Date.now() - state.timestamp < 60000 && state.url === window.location.href) {
        window.sessionStorage.removeItem(RELOAD_STATE_KEY);

        const prefersReducedMotion = window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const scrollToTarget = () => {
          window.scrollTo({
            left: state.scrollX,
            top: state.scrollY,
            behavior: prefersReducedMotion ? 'auto' : 'smooth'
          });
        };

        // Scroll immediately and once more after potential layout shift
        if (this.doc.readyState === 'complete') {
          scrollToTarget();
        } else {
          window.addEventListener('load', () => {
            scrollToTarget();
            // Maximum one layout correction
            setTimeout(scrollToTarget, 150);
          }, { once: true });
        }
      }
    } catch {
      // Ignore
    }
  }
}
