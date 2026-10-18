import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  loadWorkbenchData,
  addCategory,
  renameCategory,
  addGroup,
  renameGroup,
  addLink,
  editLink,
  _resetMemoryStore
} from "../src/newtab/storage.js";
import { withTransaction, STORES, verifyRevision } from "../src/newtab/db.js";

describe("Bookmark Organizer - Concurrency & Revision Locking", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("Requirement 3: Category, Group, and Link revision conflicts are rejected", async () => {
    const data = await loadWorkbenchData();
    const cat = data.categories[0];
    assert.equal(cat.revision, 1);

    // 1. Category revision conflict
    // Stale expectedRevision (e.g. expected 999 while current is 1)
    await assert.rejects(async () => {
      await renameCategory(data, cat.id, "Renamed Category", 999);
    }, (err) => {
      assert.equal(err.code, "CONFLICT");
      assert.equal(err.expectedRevision, 999);
      assert.equal(err.currentRevision, 1);
      return true;
    });

    // Valid update advances revision to 2
    const updatedCat = await renameCategory(data, cat.id, "Renamed Category", 1);
    assert.equal(updatedCat.revision, 2);

    // 2. Group revision conflict
    const group = await addGroup(data, updatedCat.id, "Alpha Service");
    assert.equal(group.revision, 1);

    await assert.rejects(async () => {
      await renameGroup(data, group.id, "Renamed Group", 5);
    }, (err) => {
      assert.equal(err.code, "CONFLICT");
      return true;
    });

    const updatedGroup = await renameGroup(data, group.id, "Renamed Group", 1);
    assert.equal(updatedGroup.revision, 2);

    // 3. Link revision conflict
    const link = await addLink(data, updatedGroup.id, {
      name: "Dashboard",
      url: "https://example.com/dash"
    });
    assert.equal(link.revision, 1);

    await assert.rejects(async () => {
      await editLink(data, link.id, { name: "New Name", url: "https://example.com/dash" }, 42);
    }, (err) => {
      assert.equal(err.code, "CONFLICT");
      return true;
    });

    const updatedLink = await editLink(
      data,
      link.id,
      { name: "New Name", url: "https://example.com/dash" },
      1
    );
    assert.equal(updatedLink.revision, 2);
  });

  it("Requirement 4: simulates true concurrent writes using Promise.all", async () => {
    const data = await loadWorkbenchData();
    const cat = data.categories[0];
    const group = await addGroup(data, cat.id, "Concurrent Target");

    // We simulate 5 concurrent requests all wanting to rename the same group from revision 1
    const attempts = [
      renameGroup(data, group.id, "Update A", 1),
      renameGroup(data, group.id, "Update B", 1),
      renameGroup(data, group.id, "Update C", 1),
      renameGroup(data, group.id, "Update D", 1),
      renameGroup(data, group.id, "Update E", 1)
    ];

    const results = await Promise.allSettled(attempts);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one update must succeed, while the others must be rejected with CONFLICT
    assert.equal(fulfilled.length, 1, "Exactly one concurrent update must succeed");
    assert.equal(rejected.length, 4, "Concurrent attempts with stale revision must be rejected");

    for (const rej of rejected) {
      assert.equal(rej.reason.code, "CONFLICT");
    }

    // Verify final state in DB has revision 2
    const finalData = await loadWorkbenchData();
    const finalGroup = finalData.groups.find((g) => g.id === group.id);
    assert.equal(finalGroup.revision, 2);
  });

  it("Requirement 5: corrupted categories, groups, links are NOT silently replaced with empty arrays", async () => {
    // Initialize first so migration is marked completed
    await loadWorkbenchData();

    // Corrupt state by clearing categories
    await withTransaction([STORES.CATEGORIES], "readwrite", async (stores) => {
      await stores[STORES.CATEGORIES].clear();
    });

    // loadWorkbenchData must throw CORRUPTED_STORAGE rather than silently injecting empty array or overwriting
    await assert.rejects(
      async () => {
        await loadWorkbenchData();
      },
      (err) => {
        assert.equal(err.code, "CORRUPTED_STORAGE");
        return true;
      }
    );
  });
});
