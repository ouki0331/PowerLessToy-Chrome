/**
 * Storage Layer for Bookmark Organizer
 * Interacts with chrome.storage.local with localStorage/memory fallback.
 * Implements:
 * - Strict first-run detection vs corrupted storage protection (P1 fix)
 * - Read-Merge-Write concurrency safety across multiple tabs (P1 fix)
 * - Cross-tab storage change subscription
 */

import { STORAGE_KEY, ACTIVE_CAT_KEY, getInitialSeedData } from "./constants.js";

// In-memory fallback if neither chrome.storage nor localStorage is available
let memoryStore = {};

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
 * Low-level read from storage.
 * Distinguishes between key not found (undefined) vs stored value.
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

  return memoryStore[key];
}

/**
 * Low-level write to storage
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

  memoryStore[key] = value;
}

/**
 * Subscribe to storage changes across tabs
 */
export function subscribeStorageChanges(callback) {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    const listener = (changes, areaName) => {
      if (areaName === "local" && (changes[STORAGE_KEY] || changes[ACTIVE_CAT_KEY])) {
        callback(changes);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  if (typeof window !== "undefined" && window.addEventListener) {
    const listener = (event) => {
      if (event.key === STORAGE_KEY || event.key === ACTIVE_CAT_KEY) {
        callback({ [event.key]: { newValue: event.newValue ? JSON.parse(event.newValue) : null } });
      }
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }

  return () => {};
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
 * Load complete workbench data.
 * CRITICAL RULE:
 * - Only initializes default seed data when the storage key is completely absent (undefined / null).
 * - If the key exists but the structure is corrupted or invalid, throws an error to enter
 *   non-destructive error mode, NEVER overwriting or destroying user data!
 */
export async function loadWorkbenchData() {
  const raw = await rawRead(STORAGE_KEY);
  let isFirstRun = false;
  let data = raw;

  // True First Run: key is completely absent
  if (raw === undefined || raw === null) {
    data = getInitialSeedData();
    isFirstRun = true;
    await rawWrite(STORAGE_KEY, data);
    await rawWrite(ACTIVE_CAT_KEY, data.activeCategoryId);
    return { ...data, isFirstRun };
  }

  // Storage key exists: Validate structure integrity
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray(data.categories) ||
    data.categories.length === 0
  ) {
    const error = new Error("Corrupted or invalid workbench storage data");
    error.code = "CORRUPTED_STORAGE";
    error.rawData = raw;
    throw error;
  }

  // Ensure groups and links arrays are present
  if (!Array.isArray(data.groups)) {
    data.groups = [];
  }
  if (!Array.isArray(data.links)) {
    data.links = [];
  }

  // Restore last active category if stored separately
  const lastActiveCat = await rawRead(ACTIVE_CAT_KEY);
  if (lastActiveCat && data.categories.some((c) => c.id === lastActiveCat)) {
    data.activeCategoryId = lastActiveCat;
  } else if (!data.activeCategoryId || !data.categories.some((c) => c.id === data.activeCategoryId)) {
    data.activeCategoryId = data.categories[0].id;
  }

  return { ...data, isFirstRun: false };
}

/**
 * Persist workbench data atomically
 */
export async function saveWorkbenchData(data) {
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new Error("Invalid data structure: non-empty categories array required");
  }
  await rawWrite(STORAGE_KEY, {
    version: 1,
    categories: data.categories,
    groups: data.groups || [],
    links: data.links || [],
    activeCategoryId: data.activeCategoryId
  });

  if (data.activeCategoryId) {
    await rawWrite(ACTIVE_CAT_KEY, data.activeCategoryId);
  }
}

function syncInMemoryData(target, source) {
  if (target && typeof target === "object" && target !== source) {
    target.categories = source.categories;
    target.groups = source.groups;
    target.links = source.links;
    target.activeCategoryId = source.activeCategoryId;
  }
}

/**
 * Switch active category and persist preference
 */
export async function setActiveCategory(data, categoryId) {
  const freshData = await loadWorkbenchData();
  if (!freshData.categories.some((c) => c.id === categoryId)) {
    throw new Error(`Category ${categoryId} does not exist`);
  }
  freshData.activeCategoryId = categoryId;
  await rawWrite(ACTIVE_CAT_KEY, categoryId);
  syncInMemoryData(data, freshData);
  return freshData;
}

/**
 * Add a new category with fresh storage re-read to avoid cross-tab clobbering
 */
export async function addCategory(data, name, description = "") {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    throw new Error("Category name cannot be empty");
  }

  // Re-read fresh data from storage
  const freshData = await loadWorkbenchData();

  const newCat = {
    id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: trimmedName,
    description: (description || "").trim(),
    createdAt: Date.now()
  };
  freshData.categories.push(newCat);
  freshData.activeCategoryId = newCat.id;

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);
  return newCat;
}

/**
 * Rename an existing category
 */
export async function renameCategory(data, categoryId, newName) {
  const trimmedName = (newName || "").trim();
  if (!trimmedName) {
    throw new Error("Category name cannot be empty");
  }

  const freshData = await loadWorkbenchData();
  const cat = freshData.categories.find((c) => c.id === categoryId);
  if (!cat) {
    throw new Error(`Category ${categoryId} not found`);
  }
  cat.name = trimmedName;

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);
  return cat;
}

/**
 * Delete a category.
 * Business rules:
 * - At least one category must remain (DEC-004)
 * - If current active category is deleted: activate left sibling, or right sibling if no left.
 * - Cascades deletion to its groups and links.
 */
export async function deleteCategory(data, categoryId) {
  const freshData = await loadWorkbenchData();

  if (freshData.categories.length <= 1) {
    throw new Error("Cannot delete the last category");
  }
  const catIndex = freshData.categories.findIndex((c) => c.id === categoryId);
  if (catIndex === -1) {
    throw new Error(`Category ${categoryId} not found`);
  }

  const groupsToDelete = freshData.groups.filter((g) => g.categoryId === categoryId);
  const groupIds = new Set(groupsToDelete.map((g) => g.id));
  const linksToDelete = freshData.links.filter((l) => groupIds.has(l.groupId));

  let newActiveCatId = freshData.activeCategoryId;
  if (freshData.activeCategoryId === categoryId) {
    if (catIndex > 0) {
      newActiveCatId = freshData.categories[catIndex - 1].id;
    } else {
      newActiveCatId = freshData.categories[catIndex + 1].id;
    }
  }

  freshData.categories.splice(catIndex, 1);
  freshData.groups = freshData.groups.filter((g) => g.categoryId !== categoryId);
  freshData.links = freshData.links.filter((l) => !groupIds.has(l.groupId));
  freshData.activeCategoryId = newActiveCatId;

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);

  return {
    deletedGroupsCount: groupsToDelete.length,
    deletedLinksCount: linksToDelete.length,
    newActiveCategoryId: newActiveCatId
  };
}

/**
 * Add a new group to the current category with fresh re-read
 */
export async function addGroup(data, categoryId, name) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    throw new Error("Group name cannot be empty");
  }

  const freshData = await loadWorkbenchData();
  if (!freshData.categories.some((c) => c.id === categoryId)) {
    throw new Error(`Category ${categoryId} not found`);
  }

  const newGroup = {
    id: `grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    categoryId,
    name: trimmedName,
    createdAt: Date.now()
  };
  freshData.groups.push(newGroup);

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);
  return newGroup;
}

/**
 * Rename an existing group
 */
export async function renameGroup(data, groupId, newName) {
  const trimmedName = (newName || "").trim();
  if (!trimmedName) {
    throw new Error("Group name cannot be empty");
  }

  const freshData = await loadWorkbenchData();
  const group = freshData.groups.find((g) => g.id === groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }
  group.name = trimmedName;

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);
  return group;
}

/**
 * Delete a group and its associated links
 */
export async function deleteGroup(data, groupId) {
  const freshData = await loadWorkbenchData();

  const groupIndex = freshData.groups.findIndex((g) => g.id === groupId);
  if (groupIndex === -1) {
    throw new Error(`Group ${groupId} not found`);
  }
  const linksToDelete = freshData.links.filter((l) => l.groupId === groupId);

  freshData.groups.splice(groupIndex, 1);
  freshData.links = freshData.links.filter((l) => l.groupId !== groupId);

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);

  return {
    deletedLinksCount: linksToDelete.length
  };
}

/**
 * Add a link to a group with fresh re-read
 */
export async function addLink(data, groupId, { name, url, badge = "" }) {
  const trimmedName = (name || "").trim();
  const trimmedUrl = (url || "").trim();
  const trimmedBadge = (badge || "").trim();

  if (!trimmedName) {
    throw new Error("Link name cannot be empty");
  }
  if (!isValidUrl(trimmedUrl)) {
    throw new Error("Please enter a valid URL (e.g. https://example.com)");
  }

  const freshData = await loadWorkbenchData();
  if (!freshData.groups.some((g) => g.id === groupId)) {
    throw new Error(`Group ${groupId} not found`);
  }

  const newLink = {
    id: `lnk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    groupId,
    name: trimmedName,
    url: trimmedUrl,
    badge: trimmedBadge,
    createdAt: Date.now()
  };

  freshData.links.push(newLink);

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);
  return newLink;
}

/**
 * Edit an existing link
 */
export async function editLink(data, linkId, { name, url, badge = "" }) {
  const trimmedName = (name || "").trim();
  const trimmedUrl = (url || "").trim();
  const trimmedBadge = (badge || "").trim();

  if (!trimmedName) {
    throw new Error("Link name cannot be empty");
  }
  if (!isValidUrl(trimmedUrl)) {
    throw new Error("Please enter a valid URL (e.g. https://example.com)");
  }

  const freshData = await loadWorkbenchData();
  const link = freshData.links.find((l) => l.id === linkId);
  if (!link) {
    throw new Error(`Link ${linkId} not found`);
  }

  link.name = trimmedName;
  link.url = trimmedUrl;
  link.badge = trimmedBadge;

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);
  return link;
}

/**
 * Delete a link
 */
export async function deleteLink(data, linkId) {
  const freshData = await loadWorkbenchData();

  const linkIndex = freshData.links.findIndex((l) => l.id === linkId);
  if (linkIndex === -1) {
    throw new Error(`Link ${linkId} not found`);
  }
  const deleted = freshData.links.splice(linkIndex, 1)[0];

  await saveWorkbenchData(freshData);
  syncInMemoryData(data, freshData);
  return deleted;
}

/**
 * Reset memory store (useful for tests)
 */
export function _resetMemoryStore() {
  memoryStore = {};
}
