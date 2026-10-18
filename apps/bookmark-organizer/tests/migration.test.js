import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  migrateFromChromeStorageIfNeeded,
  getMigrationRecord,
  MIGRATION_FLAG_KEY,
  MIGRATION_METADATA_KEY
} from "../src/newtab/migration.js";
import { STORAGE_KEY } from "../src/newtab/constants.js";
import { rawRead, rawWrite, loadWorkbenchData, addGroup, _resetMemoryStore } from "../src/newtab/storage.js";
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

  const validLegacy = () => ({
    version: 1,
    activeCategoryId: "cat_1",
    categories: [{ id: "cat_1", name: "Legacy Projects", createdAt: 1000 }],
    groups: [{ id: "grp_1", categoryId: "cat_1", name: "Billing API", createdAt: 1001 }],
    links: [{ id: "lnk_1", groupId: "grp_1", name: "Local", url: "http://localhost:3000", createdAt: 1002 }]
  });

  const countAll = () =>
    withTransaction([STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS], "readonly", async (s) => ({
      categories: await s[STORES.CATEGORIES].getAll(),
      groups: await s[STORES.GROUPS].getAll(),
      links: await s[STORES.LINKS].getAll()
    }));

  it("records the authoritative migration state in IndexedDB metadata", async () => {
    await rawWrite(STORAGE_KEY, validLegacy());
    await migrateFromChromeStorageIfNeeded();
    const record = await getMigrationRecord();
    assert.equal(record.status, "completed");
    assert.equal(record.source, "chrome.storage.local");
    assert.deepEqual(record.counts, { categories: 1, groups: 1, links: 1 });
  });

  it("P1 repro: losing the chrome.storage flag does NOT re-migrate over newer IndexedDB data", async () => {
    await rawWrite(STORAGE_KEY, validLegacy());
    const data = await loadWorkbenchData();

    // User keeps working after migration
    const newGroup = await addGroup(data, "cat_1", "Post-migration group");

    // Flag lost / reset to false (e.g. storage cleared, extension bug)
    await rawWrite(MIGRATION_FLAG_KEY, false);
    await loadWorkbenchData();
    let after = await countAll();
    assert.ok(after.groups.some((g) => g.id === newGroup.id), "post-migration group must survive flag loss");

    // Even if the IndexedDB metadata record is ALSO lost, data must not be cleared
    await withTransaction([STORES.METADATA], "readwrite", (s) => s[STORES.METADATA].delete(MIGRATION_METADATA_KEY));
    await rawWrite(MIGRATION_FLAG_KEY, false);
    const res = await migrateFromChromeStorageIfNeeded();
    assert.equal(res.reconciled, true);
    after = await countAll();
    assert.ok(after.groups.some((g) => g.id === newGroup.id), "post-migration group must survive metadata loss");
    assert.equal(after.groups.length, 2);
    assert.equal((await getMigrationRecord()).source, "reconciled_existing_indexeddb");

    // Legacy copy remains as recovery source
    assert.deepEqual(await rawRead(STORAGE_KEY), validLegacy());
  });

  for (const [field, bad] of [
    ["groups", "not-an-array"],
    ["links", { broken: true }],
    ["groups", undefined],
    ["links", null]
  ]) {
    it(`P1 repro: legacy '${field}' = ${JSON.stringify(bad)} aborts migration instead of becoming []`, async () => {
      const legacy = validLegacy();
      legacy[field] = bad;
      await rawWrite(STORAGE_KEY, legacy);

      await assert.rejects(migrateFromChromeStorageIfNeeded(), (err) => {
        assert.equal(err.code, "CORRUPTED_LEGACY_DATA");
        assert.ok(err.details.some((d) => d.includes(`'${field}'`)));
        return true;
      });

      const after = await countAll();
      assert.equal(after.categories.length + after.groups.length + after.links.length, 0, "nothing written");
      assert.notEqual(await rawRead(MIGRATION_FLAG_KEY), true);
      assert.equal(await getMigrationRecord(), undefined);
      assert.deepEqual(await rawRead(STORAGE_KEY), legacy);
    });
  }

  it("rejects legacy records with orphan references or duplicate ids", async () => {
    const legacy = validLegacy();
    legacy.links.push({ id: "lnk_1", groupId: "grp_missing", name: "Orphan", url: "https://o.example.com" });
    await rawWrite(STORAGE_KEY, legacy);
    await assert.rejects(migrateFromChromeStorageIfNeeded(), (err) => {
      assert.equal(err.code, "CORRUPTED_LEGACY_DATA");
      assert.ok(err.details.some((d) => d.includes("duplicate id 'lnk_1'")));
      assert.ok(err.details.some((d) => d.includes("unknown groupId 'grp_missing'")));
      return true;
    });
  });

  it("upgrading from the previous build (flag only, no metadata) keeps IndexedDB intact", async () => {
    // Simulate previous build: data in IndexedDB + chrome flag true, no metadata record
    await withTransaction([STORES.CATEGORIES, STORES.GROUPS], "readwrite", async (s) => {
      await s[STORES.CATEGORIES].put({ id: "cat_x", name: "Existing", revision: 3, createdAt: 1, updatedAt: 2 });
      await s[STORES.GROUPS].put({ id: "grp_x", categoryId: "cat_x", name: "Kept", revision: 1, createdAt: 1, updatedAt: 1 });
    });
    await rawWrite(MIGRATION_FLAG_KEY, true);
    await rawWrite(STORAGE_KEY, validLegacy());

    const data = await loadWorkbenchData();
    assert.deepEqual(data.categories.map((c) => c.id), ["cat_x"]);
    assert.deepEqual(data.groups.map((g) => g.id), ["grp_x"]);
    assert.equal((await getMigrationRecord()).status, "completed");
  });
});
