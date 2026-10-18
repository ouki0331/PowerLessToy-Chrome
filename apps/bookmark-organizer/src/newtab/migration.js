/**
 * Migration Service: Migrates legacy chrome.storage.local data to IndexedDB.
 *
 * Safety rules (see docs/product/bookmark-organizer.md, DATA-IMPORT-001):
 * 1. The authoritative migration record lives in IndexedDB `metadata`
 *    (key: "migration"). The chrome.storage.local flag is only a mirror.
 * 2. If IndexedDB already contains ANY category, group or link, migration
 *    never clears or rewrites it. IndexedDB is treated as the newer source of
 *    truth and only the missing metadata record is reconciled.
 * 3. Legacy data is validated strictly (all three collections, record shape,
 *    unique IDs, parent references). Any violation aborts the migration with
 *    CORRUPTED_LEGACY_DATA, writes nothing, and leaves the legacy data intact.
 * 4. Conversion, read-back count verification and the metadata record are
 *    written in ONE IndexedDB transaction, so a failed verification rolls back.
 * 5. Legacy chrome.storage.local data is never deleted; it remains available
 *    as a recovery source.
 */

import { withTransaction, STORES } from "./db.js";
import { STORAGE_KEY, ACTIVE_CAT_KEY, getInitialSeedData } from "./constants.js";
import { rawRead, rawWrite } from "./storage.js";

/** Mirror flag in chrome.storage.local (informational only, never trusted alone) */
export const MIGRATION_FLAG_KEY = "powerless_toy_migration_completed_v1";
/** Authoritative record key in the IndexedDB `metadata` store */
export const MIGRATION_METADATA_KEY = "migration";

const BUSINESS_STORES = [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS];

function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Strictly validate legacy chrome.storage.local data.
 * Returns an array of human readable, locatable error strings (empty = valid).
 */
export function validateLegacyData(oldData) {
  const errors = [];

  if (typeof oldData !== "object" || oldData === null || Array.isArray(oldData)) {
    return [`Legacy data must be an object, found ${describeType(oldData)}`];
  }

  for (const key of ["categories", "groups", "links"]) {
    if (!Array.isArray(oldData[key])) {
      errors.push(`Legacy '${key}' must be an array, found ${describeType(oldData[key])}`);
    }
  }
  if (errors.length > 0) return errors;

  if (oldData.categories.length === 0) {
    errors.push("Legacy 'categories' is empty; at least one category is required");
  }

  const checkIds = (collection, label) => {
    const ids = new Set();
    collection.forEach((item, i) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        errors.push(`${label}[${i}] must be an object`);
        return;
      }
      if (!isNonEmptyString(item.id)) {
        errors.push(`${label}[${i}] is missing a valid 'id'`);
      } else if (ids.has(item.id)) {
        errors.push(`${label}[${i}] has duplicate id '${item.id}'`);
      } else {
        ids.add(item.id);
      }
      if (!isNonEmptyString(item.name)) {
        errors.push(`${label}[${i}] is missing a valid 'name'`);
      }
    });
    return ids;
  };

  const categoryIds = checkIds(oldData.categories, "categories");
  const groupIds = checkIds(oldData.groups, "groups");
  checkIds(oldData.links, "links");

  oldData.groups.forEach((grp, i) => {
    if (grp && typeof grp === "object" && !categoryIds.has(grp.categoryId)) {
      errors.push(`groups[${i}] references unknown categoryId '${grp.categoryId}'`);
    }
  });

  oldData.links.forEach((lnk, i) => {
    if (!lnk || typeof lnk !== "object") return;
    if (!groupIds.has(lnk.groupId)) {
      errors.push(`links[${i}] references unknown groupId '${lnk.groupId}'`);
    }
    if (!isNonEmptyString(lnk.url)) {
      errors.push(`links[${i}] is missing a valid 'url'`);
    }
  });

  return errors;
}

async function readDatabaseState() {
  return withTransaction([...BUSINESS_STORES, STORES.METADATA], "readonly", async (stores) => {
    const marker = await stores[STORES.METADATA].get(MIGRATION_METADATA_KEY);
    const cats = await stores[STORES.CATEGORIES].getAll();
    const grps = await stores[STORES.GROUPS].getAll();
    const lnks = await stores[STORES.LINKS].getAll();
    return {
      marker,
      counts: { categories: cats.length, groups: grps.length, links: lnks.length }
    };
  });
}

function hasBusinessData(counts) {
  return counts.categories + counts.groups + counts.links > 0;
}

async function mirrorFlag() {
  try {
    await rawWrite(MIGRATION_FLAG_KEY, true);
  } catch {
    // Mirror only; the IndexedDB record is authoritative.
  }
}

/**
 * Execute migration if needed.
 */
export async function migrateFromChromeStorageIfNeeded() {
  const dbState = await readDatabaseState();

  // 1. Authoritative record present -> nothing to do
  if (dbState.marker?.status === "completed") {
    const mirrored = await rawRead(MIGRATION_FLAG_KEY);
    if (mirrored !== true) await mirrorFlag();
    return { migrated: false, alreadyMigrated: true };
  }

  // 2. IndexedDB already holds business data but the record is missing
  //    (lost metadata, or data written by an earlier build that only kept the
  //    chrome.storage flag). NEVER clear: IndexedDB is newer than any legacy
  //    copy. Reconcile by recording the state; legacy data stays untouched.
  if (hasBusinessData(dbState.counts)) {
    const legacyPresent = (await rawRead(STORAGE_KEY)) != null;
    await withTransaction([STORES.METADATA], "readwrite", async (stores) => {
      const latest = await stores[STORES.METADATA].get(MIGRATION_METADATA_KEY);
      if (latest?.status === "completed") return;
      await stores[STORES.METADATA].put({
        key: MIGRATION_METADATA_KEY,
        status: "completed",
        source: "reconciled_existing_indexeddb",
        completedAt: Date.now(),
        counts: dbState.counts,
        legacyDataPreserved: legacyPresent
      });
    });
    await mirrorFlag();
    return { migrated: false, reconciled: true, legacyDataPreserved: legacyPresent };
  }

  const oldData = await rawRead(STORAGE_KEY);

  // 3. Fresh install: IndexedDB empty and no legacy data
  if (oldData === undefined || oldData === null) {
    const seed = getInitialSeedData();
    const baseTime = Date.now() - 10000;
    const seeded = await withTransaction(
      [...BUSINESS_STORES, STORES.METADATA],
      "readwrite",
      async (stores) => {
        // Another tab may have initialised the database in the meantime
        const latest = await stores[STORES.METADATA].get(MIGRATION_METADATA_KEY);
        const existing = await stores[STORES.CATEGORIES].getAll();
        if (latest?.status === "completed" || existing.length > 0) return false;

        let idx = 0;
        for (const cat of seed.categories) {
          await stores[STORES.CATEGORIES].add({
            ...cat,
            revision: 1,
            createdAt: baseTime + idx++ * 1000,
            updatedAt: baseTime
          });
        }
        await stores[STORES.METADATA].put({
          key: MIGRATION_METADATA_KEY,
          status: "completed",
          source: "fresh_install",
          completedAt: Date.now(),
          counts: { categories: seed.categories.length, groups: 0, links: 0 }
        });
        return true;
      }
    );
    if (seeded) await rawWrite(ACTIVE_CAT_KEY, seed.activeCategoryId);
    await mirrorFlag();
    return { migrated: seeded, firstRun: seeded };
  }

  // 4. Legacy data exists and IndexedDB is empty -> strict validation first
  const validationErrors = validateLegacyData(oldData);
  if (validationErrors.length > 0) {
    const err = new Error(
      `Cannot migrate: legacy storage data is corrupted or invalid (${validationErrors.length} problem(s)). ` +
        "Your original data has been preserved and nothing was written."
    );
    err.code = "CORRUPTED_LEGACY_DATA";
    err.details = validationErrors;
    err.rawData = oldData;
    throw err;
  }

  const now = Date.now();
  const expected = {
    categories: oldData.categories.length,
    groups: oldData.groups.length,
    links: oldData.links.length
  };

  // 5. Convert + verify + record in ONE transaction
  const result = await withTransaction(
    [...BUSINESS_STORES, STORES.METADATA],
    "readwrite",
    async (stores) => {
      const latest = await stores[STORES.METADATA].get(MIGRATION_METADATA_KEY);
      const existingCats = await stores[STORES.CATEGORIES].getAll();
      const existingGrps = await stores[STORES.GROUPS].getAll();
      const existingLnks = await stores[STORES.LINKS].getAll();
      if (
        latest?.status === "completed" ||
        existingCats.length + existingGrps.length + existingLnks.length > 0
      ) {
        // Another tab finished first; never write over its result
        return { migrated: false, alreadyMigrated: true };
      }

      // `add` (not `put`) guarantees nothing is ever silently replaced
      for (const cat of oldData.categories) {
        await stores[STORES.CATEGORIES].add({
          id: cat.id,
          name: cat.name,
          description: typeof cat.description === "string" ? cat.description : "",
          revision: Number.isInteger(cat.revision) && cat.revision > 0 ? cat.revision : 1,
          createdAt: cat.createdAt || now,
          updatedAt: cat.updatedAt || now
        });
      }
      for (const grp of oldData.groups) {
        await stores[STORES.GROUPS].add({
          id: grp.id,
          categoryId: grp.categoryId,
          name: grp.name,
          revision: Number.isInteger(grp.revision) && grp.revision > 0 ? grp.revision : 1,
          createdAt: grp.createdAt || now,
          updatedAt: grp.updatedAt || now
        });
      }
      for (const lnk of oldData.links) {
        await stores[STORES.LINKS].add({
          id: lnk.id,
          groupId: lnk.groupId,
          name: lnk.name,
          url: lnk.url,
          badge: typeof lnk.badge === "string" ? lnk.badge : "",
          revision: Number.isInteger(lnk.revision) && lnk.revision > 0 ? lnk.revision : 1,
          createdAt: lnk.createdAt || now,
          updatedAt: lnk.updatedAt || now
        });
      }

      // Read-back verification INSIDE the transaction: a mismatch aborts it
      const verified = {
        categories: (await stores[STORES.CATEGORIES].getAll()).length,
        groups: (await stores[STORES.GROUPS].getAll()).length,
        links: (await stores[STORES.LINKS].getAll()).length
      };
      if (
        verified.categories !== expected.categories ||
        verified.groups !== expected.groups ||
        verified.links !== expected.links
      ) {
        const err = new Error(
          `Migration count mismatch! Expected (${expected.categories} cats, ${expected.groups} grps, ${expected.links} lnks), ` +
            `but got (${verified.categories}, ${verified.groups}, ${verified.links})`
        );
        err.code = "MIGRATION_COUNT_MISMATCH";
        throw err;
      }

      // Only now, in the same transaction, record completion
      await stores[STORES.METADATA].put({
        key: MIGRATION_METADATA_KEY,
        status: "completed",
        source: "chrome.storage.local",
        legacyKey: STORAGE_KEY,
        completedAt: Date.now(),
        counts: verified
      });

      return {
        migrated: true,
        categoriesCount: verified.categories,
        groupsCount: verified.groups,
        linksCount: verified.links
      };
    }
  );

  if (result.migrated && oldData.activeCategoryId) {
    await rawWrite(ACTIVE_CAT_KEY, oldData.activeCategoryId);
  }
  await mirrorFlag();
  return result;
}

/**
 * Read the authoritative migration record (for diagnostics and tests).
 */
export async function getMigrationRecord() {
  return withTransaction([STORES.METADATA], "readonly", (stores) =>
    stores[STORES.METADATA].get(MIGRATION_METADATA_KEY)
  );
}
