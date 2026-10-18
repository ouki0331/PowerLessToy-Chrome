/**
 * Storage Layer for Bookmark Organizer
 * Interacts with chrome.storage.local with localStorage fallback for test/standalone environments.
 */

import { STORAGE_KEY, ACTIVE_CAT_KEY, getInitialSeedData } from "./constants.js";

// In-memory fallback if neither chrome.storage nor localStorage is available (e.g. mock Node env)
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
 * Low-level read from storage
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
    return raw ? JSON.parse(raw) : undefined;
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
 * Initializes default 3 categories on first run.
 * Restores last active category.
 */
export async function loadWorkbenchData() {
  let data = await rawRead(STORAGE_KEY);
  let isFirstRun = false;

  if (!data || !data.categories || data.categories.length === 0) {
    data = getInitialSeedData();
    isFirstRun = true;
    await rawWrite(STORAGE_KEY, data);
  }

  // Restore last active category if stored separately
  const lastActiveCat = await rawRead(ACTIVE_CAT_KEY);
  if (lastActiveCat && data.categories.some((c) => c.id === lastActiveCat)) {
    data.activeCategoryId = lastActiveCat;
  } else if (!data.activeCategoryId || !data.categories.some((c) => c.id === data.activeCategoryId)) {
    data.activeCategoryId = data.categories[0].id;
  }

  return { ...data, isFirstRun };
}

/**
 * Persist workbench data atomically
 */
export async function saveWorkbenchData(data) {
  if (!data || !Array.isArray(data.categories)) {
    throw new Error("Invalid data structure: categories array required");
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

/**
 * Switch active category and persist preference
 */
export async function setActiveCategory(data, categoryId) {
  if (!data.categories.some((c) => c.id === categoryId)) {
    throw new Error(`Category ${categoryId} does not exist`);
  }
  data.activeCategoryId = categoryId;
  await rawWrite(ACTIVE_CAT_KEY, categoryId);
  return data;
}

/**
 * Add a new category
 */
export async function addCategory(data, name, description = "") {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    throw new Error("Category name cannot be empty");
  }
  const newCat = {
    id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: trimmedName,
    description: (description || "").trim(),
    createdAt: Date.now()
  };
  data.categories.push(newCat);
  data.activeCategoryId = newCat.id;
  await saveWorkbenchData(data);
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
  const cat = data.categories.find((c) => c.id === categoryId);
  if (!cat) {
    throw new Error(`Category ${categoryId} not found`);
  }
  cat.name = trimmedName;
  await saveWorkbenchData(data);
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
  if (data.categories.length <= 1) {
    throw new Error("Cannot delete the last category");
  }
  const catIndex = data.categories.findIndex((c) => c.id === categoryId);
  if (catIndex === -1) {
    throw new Error(`Category ${categoryId} not found`);
  }

  // Find all groups in this category
  const groupsToDelete = data.groups.filter((g) => g.categoryId === categoryId);
  const groupIds = new Set(groupsToDelete.map((g) => g.id));
  const linksToDelete = data.links.filter((l) => groupIds.has(l.groupId));

  // Determine new active category if the deleted one is active
  let newActiveCatId = data.activeCategoryId;
  if (data.activeCategoryId === categoryId) {
    if (catIndex > 0) {
      newActiveCatId = data.categories[catIndex - 1].id;
    } else {
      newActiveCatId = data.categories[catIndex + 1].id;
    }
  }

  // Remove data
  data.categories.splice(catIndex, 1);
  data.groups = data.groups.filter((g) => g.categoryId !== categoryId);
  data.links = data.links.filter((l) => !groupIds.has(l.groupId));
  data.activeCategoryId = newActiveCatId;

  await saveWorkbenchData(data);

  return {
    deletedGroupsCount: groupsToDelete.length,
    deletedLinksCount: linksToDelete.length,
    newActiveCategoryId: newActiveCatId
  };
}

/**
 * Add a new group to the current category
 */
export async function addGroup(data, categoryId, name) {
  const trimmedName = (name || "").trim();
  if (!trimmedName) {
    throw new Error("Group name cannot be empty");
  }
  if (!data.categories.some((c) => c.id === categoryId)) {
    throw new Error(`Category ${categoryId} not found`);
  }
  const newGroup = {
    id: `grp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    categoryId,
    name: trimmedName,
    createdAt: Date.now()
  };
  data.groups.push(newGroup);
  await saveWorkbenchData(data);
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
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) {
    throw new Error(`Group ${groupId} not found`);
  }
  group.name = trimmedName;
  await saveWorkbenchData(data);
  return group;
}

/**
 * Delete a group and its associated links
 */
export async function deleteGroup(data, groupId) {
  const groupIndex = data.groups.findIndex((g) => g.id === groupId);
  if (groupIndex === -1) {
    throw new Error(`Group ${groupId} not found`);
  }
  const linksToDelete = data.links.filter((l) => l.groupId === groupId);

  data.groups.splice(groupIndex, 1);
  data.links = data.links.filter((l) => l.groupId !== groupId);

  await saveWorkbenchData(data);

  return {
    deletedLinksCount: linksToDelete.length
  };
}

/**
 * Add a link to a group
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
  if (!data.groups.some((g) => g.id === groupId)) {
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

  data.links.push(newLink);
  await saveWorkbenchData(data);
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
  const link = data.links.find((l) => l.id === linkId);
  if (!link) {
    throw new Error(`Link ${linkId} not found`);
  }

  link.name = trimmedName;
  link.url = trimmedUrl;
  link.badge = trimmedBadge;

  await saveWorkbenchData(data);
  return link;
}

/**
 * Delete a link
 */
export async function deleteLink(data, linkId) {
  const linkIndex = data.links.findIndex((l) => l.id === linkId);
  if (linkIndex === -1) {
    throw new Error(`Link ${linkId} not found`);
  }
  const deleted = data.links.splice(linkIndex, 1)[0];
  await saveWorkbenchData(data);
  return deleted;
}

/**
 * Reset memory store (useful for tests)
 */
export function _resetMemoryStore() {
  memoryStore = {};
}
