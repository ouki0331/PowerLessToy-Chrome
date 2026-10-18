/**
 * Storage and rule persistence management for Element Remover (RULE-SAVE-001, RULE-MANAGE-001, RULE-MANAGE-002).
 */

import { matchScope } from './scope.js';

const STORAGE_KEY = 'element_remover_rules_v1';

// In-memory fallback for test and non-extension environments
let memoryStore = null;

/**
 * Gets the raw storage interface.
 */
function getStorageArea() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  return {
    async get(keys) {
      if (memoryStore === null) return {};
      if (typeof keys === 'string') {
        return { [keys]: memoryStore[keys] };
      }
      return { ...memoryStore };
    },
    async set(items) {
      if (memoryStore === null) memoryStore = {};
      Object.assign(memoryStore, items);
    },
    async clear() {
      memoryStore = {};
    }
  };
}

/**
 * Resets the in-memory store (useful for tests).
 */
export function _resetMemoryStore(initial = null) {
  memoryStore = initial;
}

/**
 * Generates a unique rule ID.
 */
export function generateRuleId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `rule_${timestamp}_${random}`;
}

/**
 * Validates the structure of a rule object.
 */
export function validateRule(rule) {
  if (!rule || typeof rule !== 'object') {
    throw new Error('Rule must be an object');
  }
  if (!rule.hostname || typeof rule.hostname !== 'string') {
    throw new Error('Rule must contain a valid hostname');
  }
  if (!rule.selector || typeof rule.selector !== 'string') {
    throw new Error('Rule must contain a valid selector');
  }
  if (rule.action !== 'remove' && rule.action !== 'hide') {
    throw new Error('Rule action must be either "remove" or "hide"');
  }
  return true;
}

// Concurrency lock for atomic operations
let operationQueue = Promise.resolve();

function enqueue(operation) {
  const next = operationQueue.then(operation, operation);
  operationQueue = next.catch(() => {});
  return next;
}

/**
 * Retrieves all stored rules.
 * Fails safely: throws if read fails, ensuring we never overwrite with empty data.
 *
 * @returns {Promise<Array<object>>}
 */
export async function getAllRules() {
  const storage = getStorageArea();
  const data = await storage.get(STORAGE_KEY);
  const rules = data ? data[STORAGE_KEY] : null;
  if (!rules) return [];
  if (!Array.isArray(rules)) {
    throw new Error('Corrupted storage data: rules is not an array');
  }
  return rules;
}

/**
 * Retrieves all rules that match a given URL.
 *
 * @param {string} url
 * @returns {Promise<Array<object>>}
 */
export async function getRulesForUrl(url) {
  const allRules = await getAllRules();
  return allRules.filter(rule => matchScope(rule, url));
}

/**
 * Atomically appends a batch of new rules (RULE-SAVE-001, DEC-007).
 * Detects exact duplicates (same hostname, pathPattern, and selector) and skips them.
 *
 * @param {Array<object>} newRules
 * @returns {Promise<{ added: Array<object>, skipped: Array<object>, all: Array<object> }>}
 */
export async function saveRulesBatch(newRules) {
  if (!Array.isArray(newRules) || newRules.length === 0) {
    return { added: [], skipped: [], all: await getAllRules() };
  }

  for (const rule of newRules) {
    validateRule(rule);
  }

  return enqueue(async () => {
    const existingRules = await getAllRules();
    const existingSignatures = new Set(
      existingRules.map(r => `${r.hostname}::${r.pathPattern || '/*'}::${r.selector}`)
    );

    const added = [];
    const skipped = [];
    const now = Date.now();

    for (const rule of newRules) {
      const sig = `${rule.hostname}::${rule.pathPattern || '/*'}::${rule.selector}`;
      if (existingSignatures.has(sig)) {
        skipped.push(rule);
        continue;
      }

      const completeRule = {
        id: rule.id || generateRuleId(),
        name: rule.name || rule.selector,
        hostname: rule.hostname.toLowerCase(),
        pathPattern: rule.pathPattern || '/*',
        scopeType: rule.scopeType || 'suggested',
        action: rule.action === 'hide' ? 'hide' : 'remove',
        selector: rule.selector,
        fingerprint: rule.fingerprint || {
          tag: rule.tag || '',
          textPreview: rule.textPreview || '',
          expectedCount: rule.expectedCount || 1
        },
        enabled: rule.enabled !== false,
        status: rule.status || 'exact',
        createdAt: rule.createdAt || now,
        updatedAt: now
      };

      existingSignatures.add(sig);
      added.push(completeRule);
    }

    const updatedRules = [...existingRules, ...added];
    const storage = getStorageArea();
    await storage.set({ [STORAGE_KEY]: updatedRules });

    return { added, skipped, all: updatedRules };
  });
}

/**
 * Updates an existing rule by ID (e.g. toggling enabled status).
 *
 * @param {string} ruleId
 * @param {Partial<object>} updates
 * @returns {Promise<object|null>} The updated rule or null if not found
 */
export async function updateRule(ruleId, updates) {
  if (!ruleId) return null;

  return enqueue(async () => {
    const rules = await getAllRules();
    const index = rules.findIndex(r => r.id === ruleId);
    if (index === -1) return null;

    const current = rules[index];
    const updated = {
      ...current,
      ...updates,
      id: current.id, // ID cannot be changed
      updatedAt: Date.now()
    };

    validateRule(updated);
    rules[index] = updated;

    const storage = getStorageArea();
    await storage.set({ [STORAGE_KEY]: rules });
    return updated;
  });
}

/**
 * Toggles a rule's enabled state (DEC-008: 恢复显示停用规则但保留记录).
 *
 * @param {string} ruleId
 * @param {boolean} enabled
 * @returns {Promise<object|null>}
 */
export async function setRuleEnabled(ruleId, enabled) {
  return updateRule(ruleId, { enabled: Boolean(enabled) });
}

/**
 * Batch updates enabled state for rules matching a hostname and optional pathPattern (RULE-MANAGE-002: 批量恢复).
 *
 * @param {{ hostname: string, pathPattern?: string }} scope
 * @param {boolean} enabled
 * @returns {Promise<Array<object>>} Updated rules
 */
export async function batchSetEnabledByScope(scope, enabled) {
  if (!scope || !scope.hostname) return [];

  return enqueue(async () => {
    const rules = await getAllRules();
    const targetHostname = scope.hostname.toLowerCase();
    const targetPath = scope.pathPattern;
    const updated = [];

    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.hostname !== targetHostname) continue;
      if (targetPath && r.pathPattern !== targetPath) continue;

      if (r.enabled !== enabled) {
        rules[i] = {
          ...r,
          enabled,
          updatedAt: Date.now()
        };
        updated.push(rules[i]);
      }
    }

    if (updated.length > 0) {
      const storage = getStorageArea();
      await storage.set({ [STORAGE_KEY]: rules });
    }

    return updated;
  });
}

/**
 * Permanently deletes a single rule by ID (DEC-008: 删除规则是独立的永久操作).
 *
 * @param {string} ruleId
 * @returns {Promise<boolean>}
 */
export async function deleteRule(ruleId) {
  if (!ruleId) return false;

  return enqueue(async () => {
    const rules = await getAllRules();
    const filtered = rules.filter(r => r.id !== ruleId);
    if (filtered.length === rules.length) return false;

    const storage = getStorageArea();
    await storage.set({ [STORAGE_KEY]: filtered });
    return true;
  });
}

/**
 * Permanently deletes multiple rules by IDs (RULE-MANAGE-002: 批量删除).
 *
 * @param {Array<string>} ruleIds
 * @returns {Promise<number>} Number of rules deleted
 */
export async function batchDeleteRules(ruleIds) {
  if (!Array.isArray(ruleIds) || ruleIds.length === 0) return 0;
  const idSet = new Set(ruleIds);

  return enqueue(async () => {
    const rules = await getAllRules();
    const filtered = rules.filter(r => !idSet.has(r.id));
    const deletedCount = rules.length - filtered.length;

    if (deletedCount > 0) {
      const storage = getStorageArea();
      await storage.set({ [STORAGE_KEY]: filtered });
    }

    return deletedCount;
  });
}
