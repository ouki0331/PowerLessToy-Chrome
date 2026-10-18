import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  migrateFromChromeStorageIfNeeded,
  MIGRATION_FLAG_KEY
} from "../src/newtab/migration.js";
import { STORAGE_KEY } from "../src/newtab/constants.js";
import { rawRead, rawWrite, loadWorkbenchData, _resetMemoryStore } from "../src/newtab/storage.js";
import { withTransaction, STORES } from "../src/newtab/db.js";

describe("Bookmark Organizer - Migration Tests", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("Requirement 1: successfully migrates legacy chrome.storage data with count verification", async () => {
    // Setup legacy chrome.storage data
    const legacyData = {
      version: 1,
      activeCategoryId: "cat_legacy_1",
      categories: [
        { id: "cat_legacy_1", name: "Legacy Projects", createdAt: 1000 },
        { id: "cat_legacy_2", name: "Legacy Portals", createdAt: 1001 }
      ],
      groups: [
        { id: "grp_legacy_1", categoryId: "cat_legacy_1", name: "Billing API", createdAt: 1002 },
        { id: "grp_legacy_2", categoryId: "cat_legacy_2", name: "HR Portal", createdAt: 1003 }
      ],
      links: [
        { id: "lnk_legacy_1", groupId: "grp_legacy_1", name: "Local", url: "http://localhost:3000", badge: "Local", createdAt: 1004 },
        { id: "lnk_legacy_2", groupId: "grp_legacy_2", name: "Login", url: "https://hr.example.com", badge: "Prod", createdAt: 1005 }
      ]
    };

    await rawWrite(STORAGE_KEY, legacyData);
    await rawWrite(MIGRATION_FLAG_KEY, false);

    // Execute migration
    const res = await migrateFromChromeStorageIfNeeded();
    assert.equal(res.migrated, true);
    assert.equal(res.categoriesCount, 2);
    assert.equal(res.groupsCount, 2);
    assert.equal(res.linksCount, 2);

    // Verify migrationCompleted flag
    const flag = await rawRead(MIGRATION_FLAG_KEY);
    assert.equal(flag, true);

    // Verify IndexedDB entities have revisions initialized to 1
    const { categories, groups, links } = await withTransaction(
      [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS],
      "readonly",
      async (stores) => ({
        categories: await stores[STORES.CATEGORIES].getAll(),
        groups: await stores[STORES.GROUPS].getAll(),
        links: await stores[STORES.LINKS].getAll()
      })
    );

    assert.equal(categories.length, 2);
    assert.equal(categories[0].revision, 1);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].revision, 1);
    assert.equal(links.length, 2);
    assert.equal(links[0].revision, 1);

    // Legacy data in chrome.storage must still be preserved as backup
    const preservedLegacy = await rawRead(STORAGE_KEY);
    assert.deepEqual(preservedLegacy, legacyData);
  });

  it("Requirement 2: migration failure does not overwrite or destroy legacy data", async () => {
    // Malformed legacy data (categories is not an array)
    const corruptedLegacy = {
      version: 1,
      categories: "invalid_not_an_array",
      groups: [{ id: "valuable_group", name: "Do Not Lose Me" }]
    };

    await rawWrite(STORAGE_KEY, corruptedLegacy);
    await rawWrite(MIGRATION_FLAG_KEY, false);

    await assert.rejects(async () => {
      await migrateFromChromeStorageIfNeeded();
    }, (err) => {
      assert.equal(err.code, "CORRUPTED_LEGACY_DATA");
      return true;
    });

    // Verification: flag is NOT set
    const flag = await rawRead(MIGRATION_FLAG_KEY);
    assert.notEqual(flag, true);

    // Verification: legacy storage is preserved exactly as was
    const stored = await rawRead(STORAGE_KEY);
    assert.deepEqual(stored, corruptedLegacy);
  });
});
