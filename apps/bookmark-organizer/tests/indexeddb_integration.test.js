/**
 * Integration tests against a spec-compliant IndexedDB implementation
 * (fake-indexeddb). Unlike the other suites, which use the in-memory test
 * double, these exercise the REAL browser adapter path in db.js:
 * IDBFactory.open / onupgradeneeded, IDBTransaction auto-commit, abort and
 * rollback semantics, and request error propagation.
 */
import "fake-indexeddb/auto";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { DB_NAME, withTransaction, STORES } from "../src/newtab/db.js";
import {
  loadWorkbenchData,
  addGroup,
  addLink,
  renameGroup,
  deleteCategory,
  rawWrite,
  _resetMemoryStore
} from "../src/newtab/storage.js";
import {
  generateImportPreview,
  executeImport,
  undoImport,
  previewUndoImport,
  exportBackup
} from "../src/newtab/import-export.js";
import { migrateFromChromeStorageIfNeeded, getMigrationRecord, MIGRATION_FLAG_KEY } from "../src/newtab/migration.js";
import { STORAGE_KEY } from "../src/newtab/constants.js";

function deleteDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("deleteDatabase blocked: a connection was left open"));
  });
}

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

describe("Bookmark Organizer - Real IndexedDB adapter (fake-indexeddb)", () => {
  beforeEach(async () => {
    assert.equal(typeof indexedDB, "object", "fake-indexeddb must be installed for this suite");
    _resetMemoryStore();
    await deleteDatabase();
  });

  it("creates all object stores and seeds a fresh install with a metadata record", async () => {
    const data = await loadWorkbenchData();
    assert.equal(data.isFirstRun, true);
    assert.equal(data.categories.length, 3);
    assert.equal((await getMigrationRecord()).source, "fresh_install");
  });

  it("serialises true concurrent revision-checked writes (Promise.all)", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Contended");
    const results = await Promise.allSettled([
      renameGroup(null, grp.id, "Tab A", 1),
      renameGroup(null, grp.id, "Tab B", 1),
      renameGroup(null, grp.id, "Tab C", 1)
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(results.filter((r) => r.status === "rejected").every((r) => r.reason.code === "CONFLICT"));
    const stored = (await readAll()).groups[0];
    assert.equal(stored.revision, 2);
  });

  it("cascade delete is atomic", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Doomed");
    await addLink(data, grp.id, { name: "L", url: "https://l.example.com" });
    await deleteCategory(data, data.categories[0].id);
    const after = await readAll();
    assert.equal(after.groups.length, 0);
    assert.equal(after.links.length, 0);
    assert.equal(after.categories.length, 2);
  });

  it("a request failure aborts the real IDB transaction and rolls back every prior write", async () => {
    await loadWorkbenchData();
    const before = await readAll();
    const original = crypto.randomUUID;
    crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";
    try {
      await assert.rejects(
        executeImport({
          importData: {
            formatVersion: 1,
            categories: [
              { id: "a", name: "New A" },
              { id: "b", name: "New B" }
            ],
            groups: [],
            links: []
          }
        })
      );
    } finally {
      crypto.randomUUID = original;
    }
    assert.deepEqual(await readAll(), before, "snapshot, job and first category must all be rolled back");
  });

  it("full import -> undo-blocked -> clean undo flow on real IndexedDB", async () => {
    await loadWorkbenchData();
    const file = {
      formatVersion: 1,
      categories: [{ id: "c", name: "Imported" }],
      groups: [{ id: "g", categoryId: "c", name: "Squad" }],
      links: [
        { groupId: "g", name: "A", url: "https://a.example.com" },
        { groupId: "g", name: "B", url: "https://b.example.com" }
      ]
    };
    const preview = await generateImportPreview({ fileContent: JSON.stringify(file), fileName: "f.json" });
    assert.equal(preview.willAdd.links, 2);
    const res = await executeImport({
      importData: JSON.stringify(file),
      fileName: "f.json",
      expectedPlanSignature: preview.planSignature
    });

    const data = await loadWorkbenchData();
    const mine = await addLink(data, res.importJob.addedGroupIds[0], { name: "Mine", url: "https://m.example.com" });
    assert.equal((await previewUndoImport(res.importJob.id)).canUndo, false);
    await assert.rejects(undoImport(res.importJob.id), (err) => err.code === "UNDO_BLOCKED");

    // User removes their own link -> undo becomes safe
    const { deleteLink } = await import("../src/newtab/storage.js");
    await deleteLink(null, mine.id);
    await undoImport(res.importJob.id);
    const after = await readAll();
    assert.equal(after.categories.length, 3);
    assert.equal(after.links.length, 0);

    const backup = await exportBackup();
    assert.equal(backup.links.length, 0);
  });

  it("migration flag loss on real IndexedDB never clears newer data", async () => {
    await rawWrite(STORAGE_KEY, {
      categories: [{ id: "cat_1", name: "Legacy" }],
      groups: [],
      links: []
    });
    const data = await loadWorkbenchData();
    await addGroup(data, "cat_1", "Newer than legacy");
    await rawWrite(MIGRATION_FLAG_KEY, false);
    await migrateFromChromeStorageIfNeeded();
    const after = await readAll();
    assert.equal(after.groups.length, 1);
    assert.equal(after.groups[0].name, "Newer than legacy");
  });
});
