/**
 * Storage Layer for Bookmark Organizer
 * Primary Source of Truth: IndexedDB
 * Lightweight UI State: chrome.storage.local
 * Features:
 * - Optimistic concurrency control via entity revisions (expectedRevision)
 * - Single-transaction cascade deletions
 * - Old data migration from chrome.storage.local
 * - JSON Import/Export with snapshot and undo support
 */

import {
  withTransaction,
  STORES,
  verifyRevision,
  subscribeDataChanges,
  _resetDatabaseForTesting
} from "./db.js";
import { migrateFromChromeStorageIfNeeded } from "./migration.js";
import { STORAGE_KEY, ACTIVE_CAT_KEY } from "./constants.js";

// In-memory fallback for raw chrome.storage.local preferences in test env
let rawMemoryStore = {};

function getChromeStorage() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  return null;
}

function getLocalStorage() {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Low-level read for lightweight preferences (active category, language, migration flag)
 */
export async function rawRead(key) {
  const chromeStorage = getChromeStorage();
  if (chromeStorage) {
    return new Promise((resolve, reject) => {
      chromeStorage.get([key], (result) => {
        if (chrome.runtime?.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve(result[key]);
      });
    });
  }

  const localStorage = getLocalStorage();
  if (localStorage) {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : undefined;
  }

  return rawMemoryStore[key];
}

/**
 * Low-level write for lightweight preferences
 */
export async function rawWrite(key, value) {
  const chromeStorage = getChromeStorage();
  if (chromeStorage) {
    return new Promise((resolve, reject) => {
      chromeStorage.set({ [key]: value }, () => {
        if (chrome.runtime?.lastError) {
          return reject(chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  const localStorage = getLocalStorage();
  if (localStorage) {
    localStorage.setItem(key, JSON.stringify(value));
    return;
  }

  rawMemoryStore[key] = value;
}

/**
 * Subscribe to data changes made in OTHER tabs.
 *
 * Categories, groups and links live in IndexedDB, whose writes do not fire
 * storage events, so the primary signal is the BroadcastChannel announcement
 * emitted by `withTransaction` after every committed readwrite transaction.
 * Legacy chrome.storage / window.storage events are still forwarded.
 */
export function subscribeStorageChanges(callback) {
  const unsubscribers = [];

  unsubscribers.push(subscribeDataChanges((msg) => callback({ source: "indexeddb", ...msg })));

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    const listener = (changes, areaName) => {
      if (areaName === "local" && changes[STORAGE_KEY]) {
        callback({ source: "chrome.storage", changes });
      }
    };
    chrome.storage.onChanged.addListener(listener);
    unsubscribers.push(() => chrome.storage.onChanged.removeListener(listener));
  } else if (typeof window !== "undefined" && window.addEventListener) {
    const listener = (event) => {
      if (event.key === STORAGE_KEY) {
        callback({ source: "window.storage", key: event.key });
      }
    };
    window.addEventListener("storage", listener);
    unsubscribers.push(() => window.removeEventListener("storage", listener));
  }

  return () => unsubscribers.forEach((fn) => fn());
}

/**
 * Validate URL string
 */
export function isValidUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return ["http:", "https:", "ftp:", "chrome:", "edge:", "file:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Tracking parameter patterns to strip for BMK-CAPTURE-001
 */
export const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^gclid$/i,
  /^dclid$/i,
  /^fbclid$/i,
  /^msclkid$/i,
  /^yclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i
];

/**
 * Remove tracking parameters while strictly preserving functional parameters and hash (BMK-CAPTURE-001).
 */
export function cleanTrackingUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const urlObj = new URL(trimmed);
    const keysToDelete = [];
    for (const key of urlObj.searchParams.keys()) {
      if (TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      urlObj.searchParams.delete(key);
    }
    return urlObj.toString();
  } catch {
    return trimmed;
  }
}

/**
 * Normalize a URL for duplicate detection comparison (BMK-CAPTURE-001).
 */
export function normalizeComparableUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const cleaned = cleanTrackingUrl(rawUrl);
  try {
    const parsed = new URL(cleaned);
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname) pathname = "";
    const search = parsed.search || "";
    const hash = parsed.hash || "";
    return `${parsed.protocol}//${parsed.host}${pathname}${search}${hash}`.toLowerCase();
  } catch {
    return cleaned.toLowerCase();
  }
}

/**
 * Find existing duplicate bookmark for duplicate warning in capture dialog (BMK-CAPTURE-001).
 */
export function findDuplicateLink(data, url) {
  if (!data || !Array.isArray(data.links) || !url) return null;
  const targetNorm = normalizeComparableUrl(url);
  if (!targetNorm) return null;

  const found = data.links.find((l) => l && normalizeComparableUrl(l.url) === targetNorm);
  if (!found) return null;

  const group = (data.groups || []).find((g) => g.id === found.groupId) || null;
  const category = group ? (data.categories || []).find((c) => c.id === group.categoryId) || null : null;

  return {
    link: found,
    group,
    category,
    groupName: group?.name || "",
    categoryName: category?.name || ""
  };
}

/**
 * Filter groups for the searchable combobox picker (BMK-CAPTURE-001).
 * Matches Group Name, Tab Name, and existing Link Names / Domains inside the group.
 * Sorted by recent usage first.
 */
export function filterGroupsForCombobox(data, query = "", recentGroupMetrics = new Map()) {
  if (!data || !Array.isArray(data.groups)) return [];
  const categories = data.categories || [];
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const links = data.links || [];
  const linksByGroup = new Map();
  for (const l of links) {
    if (!l) continue;
    if (!linksByGroup.has(l.groupId)) linksByGroup.set(l.groupId, []);
    linksByGroup.get(l.groupId).push(l);
  }

  const trimmedQuery = (query || "").trim().toLowerCase();
  const sanitizedQuery = trimmedQuery.replace(/[()[\]{}]/g, " ");
  const queryTokens = sanitizedQuery ? sanitizedQuery.split(/\s+/).filter(Boolean) : [];

  const groupItems = [];
  for (const group of data.groups) {
    if (!group) continue;
    const category = catMap.get(group.categoryId);
    const groupLinks = linksByGroup.get(group.id) || [];
    const linkCount = groupLinks.length;
    const metric = recentGroupMetrics.get(group.id);
    const lastUsedAt = metric?.lastUsedAt || group.lastUsedAt || 0;
    const usageCount = metric?.usageCount || group.usageCount || 0;

    const groupNameLower = (group.name || "").toLowerCase();
    const catNameLower = (category?.name || "").toLowerCase();
    const linkNames = groupLinks.map((l) => (l.name || "").toLowerCase()).join(" ");
    const linkHosts = groupLinks.map((l) => {
      try { return new URL(l.url).hostname.toLowerCase(); } catch { return ""; }
    }).join(" ");

    const fullSearchText = `${groupNameLower} ${catNameLower} ${linkNames} ${linkHosts}`;
    const matches = queryTokens.length === 0 || queryTokens.every((tok) => fullSearchText.includes(tok));

    if (matches) {
      groupItems.push({
        id: group.id,
        name: group.name,
        categoryId: group.categoryId,
        categoryName: category?.name || "",
        group,
        category,
        linkCount,
        lastUsedAt,
        usageCount,
        groupLinks
      });
    }
  }

  groupItems.sort((a, b) => {
    if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
    if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
    return (a.group.sortOrder ?? 0) - (b.group.sortOrder ?? 0);
  });

  return groupItems;
}

/**
 * Load complete workbench data from IndexedDB.
 * Automatically runs migration from legacy chrome.storage if needed.
 * Restores last active category.
 */
export async function loadWorkbenchData() {
  // Step 1: Migrate legacy data if not yet migrated
  const migrationRes = await migrateFromChromeStorageIfNeeded();

  // Step 2: Read all entities from IndexedDB
  const { categories, groups, links } = await withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS],
    "readonly",
    async (stores) => {
      const cats = await stores[STORES.CATEGORIES].getAll();
      const grps = await stores[STORES.GROUPS].getAll();
      const lnks = await stores[STORES.LINKS].getAll();
      return {
        categories: cats.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
        groups: grps.sort((a, b) => (a.sortOrder ?? a.createdAt ?? 0) - (b.sortOrder ?? b.createdAt ?? 0)),
        links: lnks.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      };
    }
  );

  if (!categories || categories.length === 0) {
    const err = new Error("Corrupted or invalid workbench storage data: 0 categories found");
    err.code = "CORRUPTED_STORAGE";
    throw err;
  }

  // Step 3: Determine active category
  let activeCategoryId = categories[0].id;
  const savedActiveCatId = await rawRead(ACTIVE_CAT_KEY);
  if (savedActiveCatId && categories.some((c) => c.id === savedActiveCatId)) {
    activeCategoryId = savedActiveCatId;
  }

  return {
    categories,
    groups,
    links,
    activeCategoryId,
    isFirstRun: Boolean(migrationRes?.firstRun)
  };
}

// NOTE: A former `saveWorkbenchData()` helper cleared all stores and rewrote
// them from a page snapshot. It bypassed revision checks and could overwrite
// changes from other tabs, so it was removed. All writes go through the
// object-level, revision-checked functions below.


/**
 * Set and persist active category in lightweight storage
 */
export async function setActiveCategory(data, categoryId) {
  const exists = await withTransaction([STORES.CATEGORIES], "readonly", async (stores) => {
    return Boolean(await stores[STORES.CATEGORIES].get(categoryId));
  });

  if (!exists) {
    throw new Error(`Category ${categoryId} does not exist`);
  }

  await rawWrite(ACTIVE_CAT_KEY, categoryId);
  if (data && typeof data === "object") {
    data.activeCategoryId = categoryId;
  }
  return data;
}

/**
 * Add a new category to IndexedDB
 */
export async function addCategory(data, name, description = "") {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    throw new Error("Category name cannot be empty");
  }

  const newCat = await withTransaction([STORES.CATEGORIES], "readwrite", async (stores) => {
    const all = await stores[STORES.CATEGORIES].getAll();
    const maxCreatedAt = all.reduce((max, c) => Math.max(max, c.createdAt || 0), 0);
    const now = Math.max(Date.now(), maxCreatedAt + 1);
    const cat = {
      id: `cat_${now}_${Math.random().toString(36).substring(2, 7)}`,
      name: trimmedName,
      description: (description || "").trim(),
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    await stores[STORES.CATEGORIES].add(cat);
    return cat;
  });

  await rawWrite(ACTIVE_CAT_KEY, newCat.id);

  if (data && typeof data === "object") {
    if (Array.isArray(data.categories)) data.categories.push(newCat);
    data.activeCategoryId = newCat.id;
  }

  return newCat;
}

/**
 * Rename an existing category with optimistic revision lock
 */
export async function renameCategory(data, categoryId, newName, expectedRevision) {
  const trimmedName = (newName || "").trim();
  if (!trimmedName) {
    throw new Error("Category name cannot be empty");
  }

  const updated = await withTransaction([STORES.CATEGORIES], "readwrite", async (stores) => {
    const latest = await stores[STORES.CATEGORIES].get(categoryId);
    verifyRevision(latest, expectedRevision, "Category", categoryId);

    const nextRev = (latest.revision || 1) + 1;
    const now = Date.now();
    const mutated = {
      ...latest,
      name: trimmedName,
      revision: nextRev,
      updatedAt: now
    };
    await stores[STORES.CATEGORIES].put(mutated);
    return mutated;
  });

  if (data && typeof data === "object" && Array.isArray(data.categories)) {
    const item = data.categories.find((c) => c.id === categoryId);
    if (item) Object.assign(item, updated);
  }

  return updated;
}

/**
 * Delete a category in a single transaction with cascade deletion.
 * Enforces DEC-004: Cannot delete the last category.
 */
export async function deleteCategory(data, categoryId) {
  return withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS, STORES.GROUP_METRICS],
    "readwrite",
    async (stores) => {
      const allCats = await stores[STORES.CATEGORIES].getAll();
      if (allCats.length <= 1) {
        throw new Error("Cannot delete the last category");
      }

      const catIndex = allCats.findIndex((c) => c.id === categoryId);
      if (catIndex === -1) {
        throw new Error(`Category ${categoryId} not found`);
      }

      // Find groups and links in this category
      const allGroups = await stores[STORES.GROUPS].getAll();
      const groupsToDelete = allGroups.filter((g) => g.categoryId === categoryId);
      const groupIds = new Set(groupsToDelete.map((g) => g.id));

      const allLinks = await stores[STORES.LINKS].getAll();
      const linksToDelete = allLinks.filter((l) => groupIds.has(l.groupId));

      // Cascade delete in transaction
      for (const link of linksToDelete) {
        await stores[STORES.LINKS].delete(link.id);
      }
      for (const group of groupsToDelete) {
        await stores[STORES.GROUPS].delete(group.id);
        await stores[STORES.GROUP_METRICS].delete(group.id);
      }
      await stores[STORES.CATEGORIES].delete(categoryId);

      // Determine new active category
      let newActiveCatId;
      if (catIndex > 0) {
        newActiveCatId = allCats[catIndex - 1].id;
      } else {
        newActiveCatId = allCats[catIndex + 1].id;
      }

      await rawWrite(ACTIVE_CAT_KEY, newActiveCatId);

      if (data && typeof data === "object") {
        if (Array.isArray(data.categories)) {
          data.categories = data.categories.filter((c) => c.id !== categoryId);
        }
        if (Array.isArray(data.groups)) {
          data.groups = data.groups.filter((g) => g.categoryId !== categoryId);
        }
        if (Array.isArray(data.links)) {
          data.links = data.links.filter((l) => !groupIds.has(l.groupId));
        }
        data.activeCategoryId = newActiveCatId;
      }

      return {
        deletedGroupsCount: groupsToDelete.length,
        deletedLinksCount: linksToDelete.length,
        newActiveCategoryId: newActiveCatId
      };
    }
  );
}

/**
 * Add a new group to a category
 */
export async function addGroup(data, categoryId, name) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    throw new Error("Group name cannot be empty");
  }

  const newGroup = await withTransaction([STORES.CATEGORIES, STORES.GROUPS], "readwrite", async (stores) => {
    const catExists = await stores[STORES.CATEGORIES].get(categoryId);
    if (!catExists) {
      throw new Error(`Category ${categoryId} not found`);
    }
    const all = await stores[STORES.GROUPS].getAll();
    const catGroups = all.filter((g) => g.categoryId === categoryId);
    const maxSortOrder = catGroups.reduce((max, g) => Math.max(max, g.sortOrder || 0), 0);
    const sortOrder = maxSortOrder + 1;

    const maxCreatedAt = all.reduce((max, g) => Math.max(max, g.createdAt || 0), 0);
    const now = Math.max(Date.now(), maxCreatedAt + 1);
    const grp = {
      id: `grp_${now}_${Math.random().toString(36).substring(2, 7)}`,
      categoryId,
      name: trimmedName,
      sortOrder,
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    await stores[STORES.GROUPS].add(grp);
    return grp;
  });

  if (data && typeof data === "object" && Array.isArray(data.groups)) {
    data.groups.push(newGroup);
  }

  return newGroup;
}

/**
 * Rename an existing group with optimistic revision lock
 */
export async function renameGroup(data, groupId, newName, expectedRevision) {
  const trimmedName = (newName || "").trim();
  if (!trimmedName) {
    throw new Error("Group name cannot be empty");
  }

  const updated = await withTransaction([STORES.GROUPS], "readwrite", async (stores) => {
    const latest = await stores[STORES.GROUPS].get(groupId);
    verifyRevision(latest, expectedRevision, "Group", groupId);

    const nextRev = (latest.revision || 1) + 1;
    const now = Date.now();
    const mutated = {
      ...latest,
      name: trimmedName,
      revision: nextRev,
      updatedAt: now
    };
    await stores[STORES.GROUPS].put(mutated);
    return mutated;
  });

  if (data && typeof data === "object" && Array.isArray(data.groups)) {
    const item = data.groups.find((g) => g.id === groupId);
    if (item) Object.assign(item, updated);
  }

  return updated;
}

/**
 * Delete a group in a single transaction with cascade deletion of its links and usage metrics
 */
export async function deleteGroup(data, groupId) {
  return withTransaction([STORES.GROUPS, STORES.LINKS, STORES.GROUP_METRICS], "readwrite", async (stores) => {
    const group = await stores[STORES.GROUPS].get(groupId);
    if (!group) {
      throw new Error(`Group ${groupId} not found`);
    }

    const allLinks = await stores[STORES.LINKS].getAll();
    const linksToDelete = allLinks.filter((l) => l.groupId === groupId);

    for (const link of linksToDelete) {
      await stores[STORES.LINKS].delete(link.id);
    }
    await stores[STORES.GROUPS].delete(groupId);
    await stores[STORES.GROUP_METRICS].delete(groupId);

    if (data && typeof data === "object") {
      if (Array.isArray(data.groups)) {
        data.groups = data.groups.filter((g) => g.id !== groupId);
      }
      if (Array.isArray(data.links)) {
        data.links = data.links.filter((l) => l.groupId !== groupId);
      }
    }

    return {
      deletedLinksCount: linksToDelete.length
    };
  });
}

/**
 * Batch update sortOrder for groups within a category
 * Runs in a single readwrite transaction with optimistic locking on each group.
 */
export async function reorderGroups(data, categoryId, orderedGroupIds) {
  if (!Array.isArray(orderedGroupIds) || orderedGroupIds.length === 0) {
    return [];
  }

  const updatedGroups = await withTransaction([STORES.GROUPS], "readwrite", async (stores) => {
    const allGroups = await stores[STORES.GROUPS].getAll();
    const catGroups = allGroups.filter((g) => g.categoryId === categoryId);
    const groupMap = new Map(catGroups.map((g) => [g.id, g]));

    const now = Date.now();
    const updated = [];

    for (let i = 0; i < orderedGroupIds.length; i++) {
      const gId = orderedGroupIds[i];
      const grp = groupMap.get(gId);
      if (!grp) continue;

      const newSortOrder = i + 1;
      if (grp.sortOrder !== newSortOrder) {
        const nextRev = (grp.revision || 1) + 1;
        const mutated = {
          ...grp,
          sortOrder: newSortOrder,
          revision: nextRev,
          updatedAt: now
        };
        await stores[STORES.GROUPS].put(mutated);
        updated.push(mutated);
      }
    }

    return updated;
  });

  if (data && typeof data === "object" && Array.isArray(data.groups)) {
    for (const updated of updatedGroups) {
      const item = data.groups.find((g) => g.id === updated.id);
      if (item) Object.assign(item, updated);
    }
  }

  return updatedGroups;
}

/**
 * Atomically record click usage for a group (usageCount and lastUsedAt)
 * Uses separate store STORES.GROUP_METRICS so group entity revision is untouched.
 */
export async function recordGroupClick(groupId) {
  if (!groupId) return null;
  return withTransaction([STORES.GROUP_METRICS], "readwrite", async (stores) => {
    const existing = (await stores[STORES.GROUP_METRICS].get(groupId)) || {
      groupId,
      usageCount: 0,
      lastUsedAt: 0
    };
    const updated = {
      groupId,
      usageCount: (existing.usageCount || 0) + 1,
      lastUsedAt: Date.now()
    };
    await stores[STORES.GROUP_METRICS].put(updated);
    return updated;
  });
}

/**
 * Reads all group metrics as a Map of groupId -> metric
 */
export async function getGroupMetricsMap() {
  return withTransaction([STORES.GROUP_METRICS], "readonly", async (stores) => {
    const list = await stores[STORES.GROUP_METRICS].getAll();
    const map = new Map();
    for (const item of list) {
      if (item && item.groupId) {
        map.set(item.groupId, item);
      }
    }
    return map;
  });
}

/**
 * Add a link to a group
 */
export async function addLink(data, groupId, { name, url, badge = "", hidden = false }) {
  const trimmedName = (name || "").trim();
  const trimmedUrl = (url || "").trim();
  const trimmedBadge = (badge || "").trim();
  const isHidden = Boolean(hidden);

  if (!trimmedName) {
    throw new Error("Link name cannot be empty");
  }
  if (!isValidUrl(trimmedUrl)) {
    throw new Error("Please enter a valid URL (e.g. https://example.com)");
  }

  const newLink = await withTransaction([STORES.GROUPS, STORES.LINKS], "readwrite", async (stores) => {
    const groupExists = await stores[STORES.GROUPS].get(groupId);
    if (!groupExists) {
      throw new Error(`Group ${groupId} not found`);
    }
    const all = await stores[STORES.LINKS].getAll();
    const maxCreatedAt = all.reduce((max, l) => Math.max(max, l.createdAt || 0), 0);
    const now = Math.max(Date.now(), maxCreatedAt + 1);
    const lnk = {
      id: `lnk_${now}_${Math.random().toString(36).substring(2, 7)}`,
      groupId,
      name: trimmedName,
      url: trimmedUrl,
      badge: trimmedBadge,
      hidden: isHidden,
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    await stores[STORES.LINKS].add(lnk);
    return lnk;
  });

  if (data && typeof data === "object" && Array.isArray(data.links)) {
    data.links.push(newLink);
  }

  return newLink;
}

/**
 * Edit an existing link with optimistic revision lock
 */
export async function editLink(data, linkId, { name, url, badge = "", hidden }, expectedRevision) {
  const trimmedName = (name || "").trim();
  const trimmedUrl = (url || "").trim();
  const trimmedBadge = (badge || "").trim();

  if (!trimmedName) {
    throw new Error("Link name cannot be empty");
  }
  if (!isValidUrl(trimmedUrl)) {
    throw new Error("Please enter a valid URL (e.g. https://example.com)");
  }

  const updated = await withTransaction([STORES.LINKS], "readwrite", async (stores) => {
    const latest = await stores[STORES.LINKS].get(linkId);
    verifyRevision(latest, expectedRevision, "Link", linkId);

    const nextRev = (latest.revision || 1) + 1;
    const now = Date.now();
    const nextHidden = hidden !== undefined ? Boolean(hidden) : Boolean(latest.hidden);
    const mutated = {
      ...latest,
      name: trimmedName,
      url: trimmedUrl,
      badge: trimmedBadge,
      hidden: nextHidden,
      revision: nextRev,
      updatedAt: now
    };
    await stores[STORES.LINKS].put(mutated);
    return mutated;
  });

  if (data && typeof data === "object" && Array.isArray(data.links)) {
    const item = data.links.find((l) => l.id === linkId);
    if (item) Object.assign(item, updated);
  }

  return updated;
}

/**
 * Delete a link
 */
export async function deleteLink(data, linkId) {
  return withTransaction([STORES.LINKS], "readwrite", async (stores) => {
    const link = await stores[STORES.LINKS].get(linkId);
    if (!link) {
      throw new Error(`Link ${linkId} not found`);
    }
    await stores[STORES.LINKS].delete(linkId);

    if (data && typeof data === "object" && Array.isArray(data.links)) {
      data.links = data.links.filter((l) => l.id !== linkId);
    }

    return link;
  });
}

/**
 * Return pinned links in deterministic display order (BMK-PIN-001 / BMK-PIN-002).
 * Only returns links whose parent group still exists (when groups array is present).
 * Supports optional scoping by categoryId, hidden visibility (BMK-PRIV-001),
 * and environment badge filter (BMK-ENV-001).
 */
export function getPinnedLinks(data, options = {}) {
  if (!data || !Array.isArray(data.links)) return [];

  const normalizedOptions =
    typeof options === "string"
      ? { categoryId: options }
      : options && typeof options === "object"
        ? options
        : {};

  const {
    categoryId = null,
    includeHidden = false,
    envFilter = "ALL"
  } = normalizedOptions;

  const validGroupIds = Array.isArray(data.groups)
    ? new Set(
        data.groups
          .filter((g) => g && (!categoryId || g.categoryId === categoryId))
          .map((g) => g.id)
      )
    : null;

  const activeEnv = String(envFilter || "ALL").trim().toUpperCase();

  return data.links
    .filter((l) => {
      if (!l || l.pinned !== true) return false;
      if (validGroupIds && !validGroupIds.has(l.groupId)) return false;
      if (!includeHidden && l.hidden === true) return false;
      if (activeEnv && activeEnv !== "ALL") {
        const linkBadge = String(l.badge || "").trim().toUpperCase();
        if (linkBadge !== activeEnv) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const orderA = typeof a.pinnedOrder === "number" ? a.pinnedOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.pinnedOrder === "number" ? b.pinnedOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      const timeA = a.pinnedAt || a.createdAt || 0;
      const timeB = b.pinnedAt || b.createdAt || 0;
      if (timeA !== timeB) return timeA - timeB;
      return String(a.id).localeCompare(String(b.id));
    });
}

/**
 * Pin a link globally to the Pinned Shelf with optimistic revision lock (BMK-PIN-001).
 * Each link can only be pinned once; calling pinLink on an already-pinned link is idempotent.
 */
export async function pinLink(data, linkId, expectedRevision) {
  const updated = await withTransaction([STORES.LINKS], "readwrite", async (stores) => {
    const latest = await stores[STORES.LINKS].get(linkId);
    verifyRevision(latest, expectedRevision, "Link", linkId);

    if (latest.pinned === true && typeof latest.pinnedOrder === "number") {
      return latest;
    }

    const allLinks = await stores[STORES.LINKS].getAll();
    const maxPinnedOrder = allLinks
      .filter((l) => l.pinned === true && l.id !== linkId)
      .reduce((max, l) => Math.max(max, typeof l.pinnedOrder === "number" ? l.pinnedOrder : 0), 0);

    const nextRev = (latest.revision || 1) + 1;
    const now = Date.now();
    const mutated = {
      ...latest,
      pinned: true,
      pinnedOrder: maxPinnedOrder + 1,
      pinnedAt: now,
      revision: nextRev,
      updatedAt: now
    };
    await stores[STORES.LINKS].put(mutated);
    return mutated;
  });

  if (data && typeof data === "object" && Array.isArray(data.links)) {
    const item = data.links.find((l) => l.id === linkId);
    if (item) Object.assign(item, updated);
  }

  return updated;
}

/**
 * Unpin a link from the Pinned Shelf with optimistic revision lock (BMK-PIN-001).
 */
export async function unpinLink(data, linkId, expectedRevision) {
  const updated = await withTransaction([STORES.LINKS], "readwrite", async (stores) => {
    const latest = await stores[STORES.LINKS].get(linkId);
    verifyRevision(latest, expectedRevision, "Link", linkId);

    if (!latest.pinned) {
      return latest;
    }

    const nextRev = (latest.revision || 1) + 1;
    const now = Date.now();
    const mutated = {
      ...latest,
      pinned: false,
      pinnedOrder: null,
      pinnedAt: null,
      revision: nextRev,
      updatedAt: now
    };
    await stores[STORES.LINKS].put(mutated);
    return mutated;
  });

  if (data && typeof data === "object" && Array.isArray(data.links)) {
    const item = data.links.find((l) => l.id === linkId);
    if (item) Object.assign(item, updated);
  }

  return updated;
}

/**
 * Toggle pin state of a link with optimistic revision lock (BMK-PIN-001).
 */
export async function togglePinLink(data, linkId, expectedRevision) {
  const current = await withTransaction([STORES.LINKS], "readonly", (stores) =>
    stores[STORES.LINKS].get(linkId)
  );
  if (!current) {
    throw new Error(`Link ${linkId} not found`);
  }
  if (current.pinned === true) {
    return unpinLink(data, linkId, expectedRevision);
  }
  return pinLink(data, linkId, expectedRevision);
}

/**
 * Batch reorder pinned links in a single atomic transaction (BMK-PIN-001 / BMK-PIN-002).
 * Reordering is scoped to a single Tab (categoryId) so dragging pinned links in one Tab
 * never alters the order or revisions of pinned links in other Tabs.
 */
export async function reorderPinnedLinks(data, orderedLinkIds, categoryId = null) {
  if (!Array.isArray(orderedLinkIds) || orderedLinkIds.length === 0) {
    return [];
  }

  const updatedLinks = await withTransaction([STORES.GROUPS, STORES.LINKS], "readwrite", async (stores) => {
    const allGroups = await stores[STORES.GROUPS].getAll();
    const allLinks = await stores[STORES.LINKS].getAll();
    const groupById = new Map(allGroups.map((g) => [g.id, g]));

    let targetCategoryId = categoryId;
    if (!targetCategoryId) {
      for (const id of orderedLinkIds) {
        const foundLink = allLinks.find((l) => l && l.id === id);
        if (foundLink) {
          const grp = groupById.get(foundLink.groupId);
          if (grp && grp.categoryId) {
            targetCategoryId = grp.categoryId;
            break;
          }
        }
      }
    }

    const catGroupIds = targetCategoryId
      ? new Set(allGroups.filter((g) => g && g.categoryId === targetCategoryId).map((g) => g.id))
      : null;

    const pinnedLinks = allLinks.filter(
      (l) => l && l.pinned === true && (!catGroupIds || catGroupIds.has(l.groupId))
    );
    const pinnedMap = new Map(pinnedLinks.map((l) => [l.id, l]));

    const seen = new Set();
    const finalSequence = [];
    for (const id of orderedLinkIds) {
      if (pinnedMap.has(id) && !seen.has(id)) {
        seen.add(id);
        finalSequence.push(pinnedMap.get(id));
      }
    }
    // Preserve any pinned links within the same category not included in orderedLinkIds at the end
    const remaining = pinnedLinks
      .filter((l) => !seen.has(l.id))
      .sort((a, b) => (a.pinnedOrder ?? 999999) - (b.pinnedOrder ?? 999999));
    finalSequence.push(...remaining);

    const now = Date.now();
    const updated = [];

    for (let i = 0; i < finalSequence.length; i++) {
      const lnk = finalSequence[i];
      const newOrder = i + 1;
      if (lnk.pinnedOrder !== newOrder) {
        const nextRev = (lnk.revision || 1) + 1;
        const mutated = {
          ...lnk,
          pinnedOrder: newOrder,
          revision: nextRev,
          updatedAt: now
        };
        await stores[STORES.LINKS].put(mutated);
        updated.push(mutated);
      }
    }

    return updated;
  });

  if (data && typeof data === "object" && Array.isArray(data.links)) {
    for (const updated of updatedLinks) {
      const item = data.links.find((l) => l.id === updated.id);
      if (item) Object.assign(item, updated);
    }
  }

  return updatedLinks;
}

const LINK_METRICS_META_KEY = "link_metrics";

/**
 * Record click usage for an individual link without touching link revision (BMK-SEARCH-001).
 */
export async function recordLinkClick(linkId) {
  if (!linkId) return null;
  return withTransaction([STORES.METADATA], "readwrite", async (stores) => {
    const record = (await stores[STORES.METADATA].get(LINK_METRICS_META_KEY)) || {
      key: LINK_METRICS_META_KEY,
      items: {}
    };
    const items = record.items && typeof record.items === "object" ? { ...record.items } : {};
    const existing = items[linkId] || { linkId, usageCount: 0, lastUsedAt: 0 };
    const updated = {
      linkId,
      usageCount: (existing.usageCount || 0) + 1,
      lastUsedAt: Date.now()
    };
    items[linkId] = updated;
    await stores[STORES.METADATA].put({
      key: LINK_METRICS_META_KEY,
      items
    });
    return updated;
  });
}

/**
 * Read all link click metrics as a Map of linkId -> { linkId, usageCount, lastUsedAt }
 */
export async function getLinkMetricsMap() {
  return withTransaction([STORES.METADATA], "readonly", async (stores) => {
    const record = await stores[STORES.METADATA].get(LINK_METRICS_META_KEY);
    const map = new Map();
    if (record && record.items && typeof record.items === "object") {
      for (const [k, v] of Object.entries(record.items)) {
        if (v && typeof v === "object") {
          map.set(k, v);
        }
      }
    }
    return map;
  });
}

/**
 * Fetch all import jobs
 */
export async function getImportJobs() {
  return withTransaction([STORES.IMPORT_JOBS], "readonly", (stores) => {
    return stores[STORES.IMPORT_JOBS].getAll();
  });
}

/**
 * Reset memory store and database (used by unit tests)
 */
export function _resetMemoryStore() {
  rawMemoryStore = {};
  _resetDatabaseForTesting();
}
