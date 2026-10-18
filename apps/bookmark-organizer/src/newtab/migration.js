/**
 * Migration Service: Migrates legacy chrome.storage.local data to IndexedDB.
 * Enforces zero-loss guarantees and post-migration count verification.
 */

import { withTransaction, STORES } from "./db.js";
import { STORAGE_KEY, ACTIVE_CAT_KEY, getInitialSeedData } from "./constants.js";
import { rawRead, rawWrite } from "./storage.js";

export const MIGRATION_FLAG_KEY = "powerless_toy_migration_completed_v1";

/**
 * Execute migration if needed
 */
export async function migrateFromChromeStorageIfNeeded() {
  const isMigrated = await rawRead(MIGRATION_FLAG_KEY);
  if (isMigrated === true) {
    return { migrated: false, alreadyMigrated: true };
  }

  const oldData = await rawRead(STORAGE_KEY);

  // If no legacy data exists, check if IndexedDB is already seeded or needs first-run seed
  if (oldData === undefined || oldData === null) {
    const existingCats = await withTransaction([STORES.CATEGORIES], "readonly", (stores) =>
      stores[STORES.CATEGORIES].getAll()
    );

    if (!existingCats || existingCats.length === 0) {
      // First run: seed default categories in IndexedDB
      const seed = getInitialSeedData();
      const baseTime = Date.now() - 10000;
      await withTransaction([STORES.CATEGORIES], "readwrite", async (stores) => {
        let idx = 0;
        for (const cat of seed.categories) {
          await stores[STORES.CATEGORIES].put({
            ...cat,
            revision: 1,
            createdAt: baseTime + (idx++) * 1000,
            updatedAt: baseTime
          });
        }
      });
      await rawWrite(ACTIVE_CAT_KEY, seed.activeCategoryId);
    }

    await rawWrite(MIGRATION_FLAG_KEY, true);
    return { migrated: true, firstRun: true };
  }

  // Validate integrity of old data before migrating
  if (
    typeof oldData !== "object" ||
    oldData === null ||
    !Array.isArray(oldData.categories)
  ) {
    const err = new Error("Cannot migrate: legacy storage data is corrupted or invalid");
    err.code = "CORRUPTED_LEGACY_DATA";
    err.rawData = oldData;
    throw err;
  }

  const oldCategories = oldData.categories;
  const oldGroups = Array.isArray(oldData.groups) ? oldData.groups : [];
  const oldLinks = Array.isArray(oldData.links) ? oldData.links : [];

  const now = Date.now();

  // Execute migration in an atomic IndexedDB transaction
  await withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS],
    "readwrite",
    async (stores) => {
      // Clear existing records in target stores before fresh migration
      await stores[STORES.CATEGORIES].clear();
      await stores[STORES.GROUPS].clear();
      await stores[STORES.LINKS].clear();

      for (const cat of oldCategories) {
        await stores[STORES.CATEGORIES].put({
          id: cat.id,
          name: cat.name,
          description: cat.description || "",
          revision: cat.revision || 1,
          createdAt: cat.createdAt || now,
          updatedAt: cat.updatedAt || now
        });
      }

      for (const grp of oldGroups) {
        await stores[STORES.GROUPS].put({
          id: grp.id,
          categoryId: grp.categoryId,
          name: grp.name,
          revision: grp.revision || 1,
          createdAt: grp.createdAt || now,
          updatedAt: grp.updatedAt || now
        });
      }

      for (const lnk of oldLinks) {
        await stores[STORES.LINKS].put({
          id: lnk.id,
          groupId: lnk.groupId,
          name: lnk.name,
          url: lnk.url,
          badge: lnk.badge || "",
          revision: lnk.revision || 1,
          createdAt: lnk.createdAt || now,
          updatedAt: lnk.updatedAt || now
        });
      }
    }
  );

  // Post-migration count verification
  const verification = await withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS],
    "readonly",
    async (stores) => {
      const cats = await stores[STORES.CATEGORIES].getAll();
      const grps = await stores[STORES.GROUPS].getAll();
      const lnks = await stores[STORES.LINKS].getAll();
      return {
        catCount: cats.length,
        grpCount: grps.length,
        lnkCount: lnks.length
      };
    }
  );

  if (
    verification.catCount !== oldCategories.length ||
    verification.grpCount !== oldGroups.length ||
    verification.lnkCount !== oldLinks.length
  ) {
    const err = new Error(
      `Migration count mismatch! Expected (${oldCategories.length} cats, ${oldGroups.length} grps, ${oldLinks.length} lnks), but got (${verification.catCount}, ${verification.grpCount}, ${verification.lnkCount})`
    );
    err.code = "MIGRATION_COUNT_MISMATCH";
    throw err;
  }

  // Preserve active category ID
  if (oldData.activeCategoryId) {
    await rawWrite(ACTIVE_CAT_KEY, oldData.activeCategoryId);
  }

  // Mark migration as completed only after full verification succeeds
  await rawWrite(MIGRATION_FLAG_KEY, true);

  return {
    migrated: true,
    categoriesCount: verification.catCount,
    groupsCount: verification.grpCount,
    linksCount: verification.lnkCount
  };
}
