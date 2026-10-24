/**
 * Regression tests for the data-safety review findings on DATA-IMPORT-001.
 * Each test reproduces a reported defect and asserts the safe behavior.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  validateImportJson,
  generateImportPreview,
  executeImport,
  previewUndoImport,
  undoImport,
  previewSnapshotRestore,
  restoreSnapshot,
  exportBackup
} from "../src/newtab/import-export.js";
import {
  loadWorkbenchData,
  addGroup,
  addLink,
  renameGroup,
  getImportJobs,
  _resetMemoryStore
} from "../src/newtab/storage.js";
import { withTransaction, STORES } from "../src/newtab/db.js";

const readAll = () =>
  withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS, STORES.SNAPSHOTS, STORES.IMPORT_JOBS],
    "readonly",
    async (s) => ({
      categories: await s[STORES.CATEGORIES].getAll(),
      groups: await s[STORES.GROUPS].getAll(),
      links: await s[STORES.LINKS].getAll(),
      snapshots: await s[STORES.SNAPSHOTS].getAll(),
      importJobs: await s[STORES.IMPORT_JOBS].getAll()
    })
  );

const sampleFile = () => ({
  formatVersion: 1,
  categories: [{ id: "c1", name: "Imported Dept" }],
  groups: [{ id: "g1", categoryId: "c1", name: "Imported Squad" }],
  links: [{ id: "l1", groupId: "g1", name: "Portal", url: "https://squad.example.com" }]
});

describe("Bookmark Organizer - Import data-safety regressions", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  // ---------------------------------------------------------------- Schema
  describe("P1: single canonical flat schema", () => {
    it("rejects the nested categories[].groups[].links[] shape instead of silently dropping data", async () => {
      await loadWorkbenchData();
      const before = await readAll();
      const nested = {
        formatVersion: 1,
        categories: [
          {
            id: "c1",
            name: "Nested Category",
            groups: [{ id: "g1", name: "Nested Group", links: [{ name: "L", url: "https://n.example.com" }] }]
          }
        ]
      };

      const preview = await generateImportPreview({ fileContent: nested, fileName: "nested.json" });
      assert.equal(preview.valid, false);
      assert.ok(preview.errors.some((e) => e.includes("categories[].groups")));
      assert.ok(preview.errors.some((e) => e.startsWith("groups:")), "missing top-level groups must be reported");
      assert.ok(preview.errors.some((e) => e.startsWith("links:")), "missing top-level links must be reported");

      await assert.rejects(executeImport({ importData: nested }), (err) => err.code === "IMPORT_INVALID");
      assert.deepEqual(await readAll(), before, "zero writes");
    });

    it("enforces referential integrity and unique IDs with locatable errors", () => {
      const res = validateImportJson({
        formatVersion: 1,
        categories: [{ id: "c1", name: "A" }, { id: "c1", name: "B" }],
        groups: [{ id: "g1", categoryId: "missing_cat", name: "G" }],
        links: [
          { groupId: "missing_grp", name: "L", url: "https://a.example.com" },
          { groupId: "g1", name: "", url: "not a url" }
        ]
      });
      assert.equal(res.valid, false);
      const joined = res.errors.join("\n");
      assert.match(joined, /categories\[1\]\.id: duplicate id 'c1'/);
      assert.match(joined, /groups\[0\]\.categoryId: 'missing_cat' does not match/);
      assert.match(joined, /links\[0\]\.groupId: 'missing_grp' does not match/);
      assert.match(joined, /links\[1\]\.name/);
      assert.match(joined, /links\[1\]\.url/);
    });

    it("rejects unsupported formatVersion and empty files", () => {
      assert.equal(validateImportJson({ formatVersion: 2, categories: [], groups: [], links: [] }).valid, false);
      const empty = validateImportJson({ formatVersion: 1, categories: [], groups: [], links: [] });
      assert.equal(empty.valid, false);
      assert.match(empty.errors[0], /no data/);
    });

    it("export output is exactly the canonical import format and round-trips", async () => {
      const data = await loadWorkbenchData();
      const grp = await addGroup(data, data.categories[0].id, "Roundtrip");
      await addLink(data, grp.id, { name: "RT", url: "https://rt.example.com", badge: "Dev" });

      const backup = await exportBackup();
      assert.equal(validateImportJson(backup).valid, true);
      assert.deepEqual(Object.keys(backup.groups[0]).sort(), ["categoryId", "id", "name", "sortOrder"]);

      _resetMemoryStore();
      // Fresh DB: seed then import backup -> categories merge by name, group + link added
      await loadWorkbenchData();
      await executeImport({ importData: backup, fileName: "backup.json" });
      const after = await loadWorkbenchData();
      assert.equal(after.categories.length, 3);
      assert.equal(after.groups.length, 1);
      assert.equal(after.links.length, 1);
      assert.equal(after.links[0].badge, "Dev");
    });
  });

  // ------------------------------------------------------------- keep_both
  describe("P2: stable conflict keys", () => {
    it("keep_both works for links WITHOUT an id", async () => {
      const data = await loadWorkbenchData();
      const grp = await addGroup(data, data.categories[0].id, "Payments");
      await addLink(data, grp.id, { name: "Stripe", url: "https://dashboard.stripe.com" });

      const file = {
        formatVersion: 1,
        categories: [{ id: "c", name: data.categories[0].name }],
        groups: [{ id: "g", categoryId: "c", name: "Payments" }],
        links: [{ groupId: "g", name: "Stripe (team)", url: "https://dashboard.stripe.com/" }]
      };

      const preview = await generateImportPreview({ fileContent: JSON.stringify(file) });
      assert.equal(preview.conflictCount, 1);
      const key = preview.conflicts[0].conflictKey;
      assert.equal(key, "links[0]");

      const res = await executeImport({
        importData: JSON.stringify(file),
        conflictResolutions: { [key]: "keep_both" },
        expectedPlanSignature: preview.planSignature
      });
      assert.equal(res.importJob.keepBothCount, 1);
      const after = await loadWorkbenchData();
      assert.equal(after.links.length, 2);
      assert.ok(after.links.some((l) => l.name === "Stripe"));
      assert.ok(after.links.some((l) => l.name === "Stripe (team)"));
    });

    it("duplicate URLs inside the same file are surfaced as conflicts, never silently resolved", async () => {
      await loadWorkbenchData();
      const file = {
        formatVersion: 1,
        categories: [{ id: "c", name: "New" }],
        groups: [{ id: "g", categoryId: "c", name: "G" }],
        links: [
          { groupId: "g", name: "First", url: "https://dup.example.com" },
          { groupId: "g", name: "Second", url: "https://dup.example.com" }
        ]
      };
      const preview = await generateImportPreview({ fileContent: file });
      assert.equal(preview.conflictCount, 1);
      assert.equal(preview.conflicts[0].existingSource, "file");
      assert.equal(preview.conflicts[0].conflictKey, "links[1]");
    });

    it("imported records always get fresh IDs, even if the file reuses existing IDs", async () => {
      const data = await loadWorkbenchData();
      const existingId = data.categories[0].id;
      const file = {
        formatVersion: 1,
        categories: [{ id: existingId, name: "Totally Different Name" }],
        groups: [],
        links: []
      };
      const res = await executeImport({ importData: file });
      assert.notEqual(res.importJob.addedCategoryIds[0], existingId);
      const after = await loadWorkbenchData();
      assert.equal(after.categories.find((c) => c.id === existingId).name, data.categories[0].name);
    });
  });

  // ---------------------------------------------------------- staleness
  describe("preview / execute consistency", () => {
    it("refuses to execute when data changed after the preview (PREVIEW_STALE, zero writes)", async () => {
      const data = await loadWorkbenchData();
      const file = {
        formatVersion: 1,
        categories: [{ id: "c", name: data.categories[0].name }],
        groups: [{ id: "g", categoryId: "c", name: "Late Group" }],
        links: []
      };
      const preview = await generateImportPreview({ fileContent: file });
      assert.equal(preview.willAdd.groups, 1);

      // Another tab creates the same group in between
      await addGroup(data, data.categories[0].id, "Late Group");
      const before = await readAll();

      await assert.rejects(
        executeImport({ importData: file, expectedPlanSignature: preview.planSignature }),
        (err) => err.code === "PREVIEW_STALE"
      );
      assert.deepEqual(await readAll(), before);
    });

    it("a failure in the middle of the transaction rolls back everything, including snapshot and job", async () => {
      await loadWorkbenchData();
      const before = await readAll();
      const original = crypto.randomUUID;
      // Force an ID collision on the 2nd category so `add` throws mid-transaction
      crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";
      try {
        await assert.rejects(
          executeImport({
            importData: {
              formatVersion: 1,
              categories: [
                { id: "a", name: "First New" },
                { id: "b", name: "Second New" }
              ],
              groups: [],
              links: []
            }
          })
        );
      } finally {
        crypto.randomUUID = original;
      }
      assert.deepEqual(await readAll(), before);
    });
  });

  // ------------------------------------------------------------------ Undo
  describe("P1: undo never orphans user data", () => {
    it("blocks undo when the user added a link inside an imported group (reviewer repro)", async () => {
      await loadWorkbenchData();
      const res = await executeImport({ importData: sampleFile() });
      const importedGroupId = res.importJob.addedGroupIds[0];

      const data = await loadWorkbenchData();
      const userLink = await addLink(data, importedGroupId, { name: "Mine", url: "https://mine.example.com" });

      const analysis = await previewUndoImport(res.importJob.id);
      assert.equal(analysis.canUndo, false);
      assert.equal(analysis.blockers.foreignLinks.length, 1);
      assert.equal(analysis.blockers.foreignLinks[0].id, userLink.id);

      const before = await readAll();
      await assert.rejects(undoImport(res.importJob.id), (err) => {
        assert.equal(err.code, "UNDO_BLOCKED");
        assert.equal(err.analysis.blockers.foreignLinks.length, 1);
        return true;
      });
      assert.deepEqual(await readAll(), before, "blocked undo writes nothing");

      // No orphan links exist
      const after = await readAll();
      const groupIds = new Set(after.groups.map((g) => g.id));
      assert.ok(after.links.every((l) => groupIds.has(l.groupId)));
    });

    it("blocks undo when an imported record was edited (revision > 1)", async () => {
      await loadWorkbenchData();
      const res = await executeImport({ importData: sampleFile() });
      const gid = res.importJob.addedGroupIds[0];
      await renameGroup(null, gid, "Renamed by user", 1);

      const analysis = await previewUndoImport(res.importJob.id);
      assert.equal(analysis.canUndo, false);
      assert.equal(analysis.blockers.modified[0].id, gid);
      await assert.rejects(undoImport(res.importJob.id), (err) => err.code === "UNDO_BLOCKED");
    });

    it("blocks undo when a later import merged new content into this import's category", async () => {
      await loadWorkbenchData();
      const first = await executeImport({ importData: sampleFile(), fileName: "first.json" });
      await executeImport({
        importData: {
          formatVersion: 1,
          categories: [{ id: "x", name: "Imported Dept" }],
          groups: [{ id: "y", categoryId: "x", name: "Second Squad" }],
          links: []
        },
        fileName: "second.json"
      });
      const analysis = await previewUndoImport(first.importJob.id);
      assert.equal(analysis.canUndo, false);
      assert.equal(analysis.blockers.foreignGroups[0].name, "Second Squad");
    });

    it("clean undo removes only the batch and writes a pre-undo snapshot", async () => {
      const data = await loadWorkbenchData();
      const base = await addGroup(data, data.categories[0].id, "Baseline");
      const res = await executeImport({ importData: sampleFile() });

      const undo = await undoImport(res.importJob.id);
      assert.equal(undo.success, true);
      const after = await readAll();
      assert.equal(after.categories.length, 3);
      assert.deepEqual(after.groups.map((g) => g.id), [base.id]);
      assert.equal(after.links.length, 0);
      assert.ok(after.snapshots.some((s) => s.id === undo.safetySnapshotId && s.reason === "pre_undo_import"));
      assert.equal((await getImportJobs())[0].status, "reverted");
      await assert.rejects(undoImport(res.importJob.id), (err) => err.code === "ALREADY_REVERTED");
    });

    it("explicit snapshot restore shows impact first, is itself reversible, and marks the job reverted", async () => {
      await loadWorkbenchData();
      const res = await executeImport({ importData: sampleFile() });
      const data = await loadWorkbenchData();
      await addLink(data, res.importJob.addedGroupIds[0], { name: "Mine", url: "https://mine.example.com" });

      const impact = await previewSnapshotRestore(res.snapshotId);
      assert.equal(impact.links.removed, 2, "imported link + user link would be discarded");
      assert.equal(impact.groups.removed, 1);

      const restored = await restoreSnapshot(res.snapshotId, { markImportJobReverted: res.importJob.id });
      const after = await readAll();
      assert.equal(after.links.length, 0);
      assert.equal(after.groups.length, 0);
      assert.ok(after.snapshots.some((s) => s.id === restored.safetySnapshotId));
      assert.equal(after.importJobs[0].status, "reverted");
      assert.equal(after.importJobs[0].revertMethod, "snapshot_restore");

      // The restore can itself be undone from its safety snapshot
      await restoreSnapshot(restored.safetySnapshotId);
      assert.equal((await readAll()).links.length, 2);
    });

    it("restored records get a higher revision so stale editors in other tabs get CONFLICT", async () => {
      const data = await loadWorkbenchData();
      const grp = await addGroup(data, data.categories[0].id, "Edited");
      const res = await executeImport({ importData: sampleFile() });
      await restoreSnapshot(res.snapshotId);
      // A tab still holding revision 1 must not be able to write
      await assert.rejects(renameGroup(null, grp.id, "Stale write", 1), (err) => err.code === "CONFLICT");
    });
  });
});
