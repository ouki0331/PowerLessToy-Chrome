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

import { withTransaction, STORES, verifyRevision, _resetDatabaseForTesting } from "./db.js";
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
        groups: grps.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
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

/**
 * Persist workbench data atomically (provided for backward compatibility)
 */
export async function saveWorkbenchData(data) {
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    throw new Error("Invalid data structure: non-empty categories array required");
  }

  await withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS],
    "readwrite",
    async (stores) => {
      await stores[STORES.CATEGORIES].clear();
      await stores[STORES.GROUPS].clear();
      await stores[STORES.LINKS].clear();

      const now = Date.now();
      for (const cat of data.categories || []) {
        await stores[STORES.CATEGORIES].put({
          ...cat,
          revision: cat.revision || 1,
          createdAt: cat.createdAt || now,
          updatedAt: cat.updatedAt || now
        });
      }
      for (const grp of data.groups || []) {
        await stores[STORES.GROUPS].put({
          ...grp,
          revision: grp.revision || 1,
          createdAt: grp.createdAt || now,
          updatedAt: grp.updatedAt || now
        });
      }
      for (const lnk of data.links || []) {
        await stores[STORES.LINKS].put({
          ...lnk,
          revision: lnk.revision || 1,
          createdAt: lnk.createdAt || now,
          updatedAt: lnk.updatedAt || now
        });
      }
    }
  );

  if (data.activeCategoryId) {
    await rawWrite(ACTIVE_CAT_KEY, data.activeCategoryId);
  }
}


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
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS],
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
    const maxCreatedAt = all.reduce((max, g) => Math.max(max, g.createdAt || 0), 0);
    const now = Math.max(Date.now(), maxCreatedAt + 1);
    const grp = {
      id: `grp_${now}_${Math.random().toString(36).substring(2, 7)}`,
      categoryId,
      name: trimmedName,
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
 * Delete a group in a single transaction with cascade deletion of its links
 */
export async function deleteGroup(data, groupId) {
  return withTransaction([STORES.GROUPS, STORES.LINKS], "readwrite", async (stores) => {
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
export async function editLink(data, linkId, { name, url, badge = "" }, expectedRevision) {
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
    const mutated = {
      ...latest,
      name: trimmedName,
      url: trimmedUrl,
      badge: trimmedBadge,
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
