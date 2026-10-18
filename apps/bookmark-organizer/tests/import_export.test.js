import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  generateImportPreview,
  executeImport,
  undoImport,
  restoreSnapshot,
  generateBackupJson
} from "../src/newtab/import-export.js";

import {
  loadWorkbenchData,
  addGroup,
  addLink,
  _resetMemoryStore
} from "../src/newtab/storage.js";
import { withTransaction, STORES } from "../src/newtab/db.js";

describe("Bookmark Organizer - JSON Import, Export, Snapshots & Undo", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("Requirements 6, 7 & 8: valid JSON import only appends, leaves existing untouched, skips duplicates", async () => {
    const data = await loadWorkbenchData();
    const workCat = data.categories[0];
    const initialGroup = await addGroup(data, workCat.id, "Existing Project");
    const initialLink = await addLink(data, initialGroup.id, {
      name: "Existing Local",
      url: "http://localhost:3000",
      badge: "Local"
    });

    const incomingJson = {
      formatVersion: 1,
      categories: [
        { id: "cat_imported_1", name: "Imported Category" },
        { id: "cat_work_projects", name: "Work Projects" } // Matches existing
      ],
      groups: [
        { id: "grp_imported_1", categoryId: "cat_imported_1", name: "New Service" },
        { id: "grp_existing", categoryId: "cat_work_projects", name: "Existing Project" } // Matches existing
      ],
      links: [
        // Completely new link
        { id: "lnk_imported_1", groupId: "grp_imported_1", name: "Docs", url: "https://newservice.com" },
        // Exact duplicate of initialLink
        { id: "lnk_duplicate_1", groupId: "grp_existing", name: "Existing Local", url: "http://localhost:3000", badge: "Local" }
      ]
    };

    // 1. Preview checks
    const preview = await generateImportPreview({
      fileContent: incomingJson,
      fileName: "test_import.json",
      existingCategories: data.categories,
      existingGroups: data.groups,
      existingLinks: data.links
    });

    assert.equal(preview.valid, true);
    assert.equal(preview.willAdd.categories, 1);
    assert.equal(preview.willMerge.categories, 1);
    assert.equal(preview.willAdd.groups, 1);
    assert.equal(preview.willMerge.groups, 1);
    assert.equal(preview.willAdd.links, 1);
    assert.equal(preview.willSkipCount, 1); // Exact duplicate skipped
    assert.equal(preview.conflictCount, 0);

    // 2. Execute import
    const result = await executeImport({
      importData: incomingJson,
      fileName: "test_import.json"
    });

    assert.equal(result.success, true);
    assert.equal(result.importJob.skippedCount, 1);
    assert.equal(result.importJob.addedLinkIds.length, 1);

    // 3. Verify state after import
    const updatedData = await loadWorkbenchData();

    // Existing content must remain completely intact
    const originalStillThere = updatedData.links.find((l) => l.id === initialLink.id);
    assert.ok(originalStillThere, "Existing link must remain unchanged");
    assert.equal(originalStillThere.name, "Existing Local");

    // New link was added
    const newLinkAdded = updatedData.links.find((l) => l.url === "https://newservice.com");
    assert.ok(newLinkAdded, "New link must be added");

    // Total links: 1 existing + 1 new = 2 (duplicate was skipped!)
    assert.equal(updatedData.links.length, 2);
  });

  it("Requirement 9: conflicting content is not written before confirmation and supports keep_both", async () => {
    const data = await loadWorkbenchData();
    const workCat = data.categories[0];
    const group = await addGroup(data, workCat.id, "Payment Gateway");
    const link = await addLink(data, group.id, {
      name: "Stripe Console",
      url: "https://dashboard.stripe.com",
      badge: "Prod"
    });

    // Incoming file with same URL but DIFFERENT name and badge -> Conflict!
    const incomingJson = {
      formatVersion: 1,
      categories: [{ id: "cat_work_projects", name: "Work Projects" }],
      groups: [{ id: "grp_payment", categoryId: "cat_work_projects", name: "Payment Gateway" }],
      links: [
        {
          id: "lnk_conflict_stripe",
          groupId: "grp_payment",
          name: "Stripe Team Dashboard", // Different name!
          url: "https://dashboard.stripe.com",
          badge: "Test" // Different badge!
        }
      ]
    };

    const preview = await generateImportPreview({
      fileContent: incomingJson,
      fileName: "conflicts.json",
      existingCategories: data.categories,
      existingGroups: data.groups,
      existingLinks: data.links
    });

    assert.equal(preview.conflictCount, 1);
    assert.equal(preview.conflicts.length, 1);
    assert.equal(preview.conflicts[0].existingName, "Stripe Console");
    assert.equal(preview.conflicts[0].incomingName, "Stripe Team Dashboard");
    const key = preview.conflicts[0].conflictKey;
    assert.equal(key, "links[0]");

    // Nothing written by the preview
    assert.equal((await loadWorkbenchData()).links.length, 1);

    // Case A: Default resolution "keep_existing"
    const resA = await executeImport({
      importData: incomingJson,
      fileName: "conflicts.json",
      conflictResolutions: { [key]: "keep_existing" },
      expectedPlanSignature: preview.planSignature
    });

    assert.equal(resA.importJob.skippedCount, 1);
    const dataA = await loadWorkbenchData();
    assert.equal(dataA.links.length, 1);
    assert.equal(dataA.links[0].name, "Stripe Console"); // Unchanged!

    // Case B: User resolution "keep_both"
    const resB = await executeImport({
      importData: incomingJson,
      fileName: "conflicts.json",
      conflictResolutions: { [key]: "keep_both" }
    });

    assert.equal(resB.importJob.addedLinkIds.length, 1);
    const dataB = await loadWorkbenchData();
    assert.equal(dataB.links.length, 2); // Both kept!
    assert.ok(dataB.links.some((l) => l.id === link.id && l.name === "Stripe Console"));
  });

  it("Requirement 10: import failure mid-way results in zero writes (atomic rollback)", async () => {
    const data = await loadWorkbenchData();
    const initialCatsCount = data.categories.length;

    // Simulate an import where a store operation fails (e.g. invalid object structure inside transaction)
    const malformedData = {
      formatVersion: 1,
      categories: [{ name: "Good Category" }],
      groups: [{ name: null }] // Will cause validation/put failure inside transaction
    };

    await assert.rejects(async () => {
      await executeImport({
        importData: malformedData,
        fileName: "malformed.json"
      });
    });

    // Verify zero writes occurred
    const reloaded = await loadWorkbenchData();
    assert.equal(reloaded.categories.length, initialCatsCount);
    assert.ok(!reloaded.categories.some((c) => c.name === "Good Category"));
  });

  it("Requirement 11 & 12: pre-import snapshot can be restored, and undoImport only reverts added batch", async () => {
    const data = await loadWorkbenchData();
    const cat = data.categories[0];
    const baseGroup = await addGroup(data, cat.id, "Baseline Group");
    await addLink(data, baseGroup.id, { name: "Base Link", url: "https://base.org" });

    const importJson = {
      formatVersion: 1,
      categories: [{ id: "cat_imported", name: "Imported Department" }],
      groups: [{ id: "grp_imported", categoryId: "cat_imported", name: "Imported Squad" }],
      links: [{ id: "lnk_imported", groupId: "grp_imported", name: "Squad Portal", url: "https://squad.org" }]
    };

    // Execute Import
    const res = await executeImport({
      importData: importJson,
      fileName: "batch_1.json"
    });

    const withImport = await loadWorkbenchData();
    assert.equal(withImport.categories.length, 4);
    assert.equal(withImport.links.length, 2);

    // Test Undo Import
    const undoRes = await undoImport(res.importJob.id);
    assert.equal(undoRes.success, true);
    assert.equal(undoRes.revertedLinksCount, 1);
    assert.equal(undoRes.revertedCategoriesCount, 1);

    // Verify state matches pre-import baseline
    const afterUndo = await loadWorkbenchData();
    assert.equal(afterUndo.categories.length, 3);
    assert.equal(afterUndo.links.length, 1);
    assert.equal(afterUndo.links[0].name, "Base Link");
    assert.ok(!afterUndo.categories.some((c) => c.id === "cat_imported"));

    // Test Snapshot Restore
    // Re-import then restore from snapshot
    const res2 = await executeImport({
      importData: importJson,
      fileName: "batch_2.json"
    });
    assert.equal((await loadWorkbenchData()).links.length, 2);

    const restoreRes = await restoreSnapshot(res2.snapshotId);
    assert.equal(restoreRes.success, true);

    const afterRestore = await loadWorkbenchData();
    assert.equal(afterRestore.links.length, 1);
    assert.equal(afterRestore.links[0].name, "Base Link");
  });

  it("Requirement 13: export backup can be re-imported and round-trips data identically", async () => {
    const data = await loadWorkbenchData();
    const cat = data.categories[0];
    const grp = await addGroup(data, cat.id, "Roundtrip Group");
    await addLink(data, grp.id, { name: "Roundtrip Link", url: "https://roundtrip.org", badge: "Test" });

    // Generate Backup JSON
    const fullData = await loadWorkbenchData();
    const backupObj = generateBackupJson({
      categories: fullData.categories,
      groups: fullData.groups,
      links: fullData.links
    });

    assert.equal(backupObj.formatVersion, 1);
    assert.equal(backupObj.categories.length, 3);
    assert.equal(backupObj.groups.length, 1);
    assert.equal(backupObj.links.length, 1);

    // Simulate re-importing the backup into a fresh database
    _resetMemoryStore();

    // Clean initial import of backup
    const importRes = await executeImport({
      importData: backupObj,
      fileName: "backup_export.json"
    });
    assert.equal(importRes.success, true);

    const reimportedData = await loadWorkbenchData();
    assert.equal(reimportedData.categories.length, 3);
    assert.equal(reimportedData.groups.length, 1);
    assert.equal(reimportedData.groups[0].name, "Roundtrip Group");
    assert.equal(reimportedData.links.length, 1);
    assert.equal(reimportedData.links[0].name, "Roundtrip Link");
    assert.equal(reimportedData.links[0].url, "https://roundtrip.org");
    assert.equal(reimportedData.links[0].badge, "Test");
  });

  it("Requirement 14: duplicate file hash detection recognizes identical file imports", async () => {
    const data = await loadWorkbenchData();
    const importJson = {
      formatVersion: 1,
      categories: [{ id: "cat_hashed", name: "Hashed Category" }],
      groups: [],
      links: []
    };

    // First import
    const firstRes = await executeImport({
      importData: importJson,
      fileName: "repeated.json"
    });
    assert.equal(firstRes.success, true);

    // Fetch jobs
    const jobs = await withTransaction([STORES.IMPORT_JOBS], "readonly", (stores) =>
      stores[STORES.IMPORT_JOBS].getAll()
    );

    // Generate preview with identical file content
    const preview = await generateImportPreview({
      fileContent: importJson,
      fileName: "repeated.json",
      existingCategories: (await loadWorkbenchData()).categories,
      existingGroups: [],
      existingLinks: [],
      existingImportJobs: jobs
    });

    assert.equal(preview.alreadyImported, true);
    assert.ok(preview.warnings.some((w) => w.includes("previously imported")));
  });
});
