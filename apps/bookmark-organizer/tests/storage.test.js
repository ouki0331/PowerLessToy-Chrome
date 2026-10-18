import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  loadWorkbenchData,
  saveWorkbenchData,
  setActiveCategory,
  addCategory,
  renameCategory,
  deleteCategory,
  addGroup,
  renameGroup,
  deleteGroup,
  addLink,
  editLink,
  deleteLink,
  rawRead,
  rawWrite,
  subscribeStorageChanges,
  _resetMemoryStore
} from "../src/newtab/storage.js";
import { STORAGE_KEY } from "../src/newtab/constants.js";

describe("Bookmark Organizer - Storage & Concurrency Logic", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("initializes with 3 default categories on first run", async () => {
    const data = await loadWorkbenchData();
    assert.equal(data.isFirstRun, true);
    assert.equal(data.categories.length, 3);
    assert.equal(data.categories[0].name, "Work Projects");
    assert.equal(data.categories[1].name, "Company Management");
    assert.equal(data.categories[2].name, "Tech Interests");
    assert.equal(data.activeCategoryId, data.categories[0].id);
    assert.deepEqual(data.groups, []);
    assert.deepEqual(data.links, []);
  });

  it("persists and restores data across reloads", async () => {
    const data = await loadWorkbenchData();
    await addCategory(data, "Personal Finance");

    const reloaded = await loadWorkbenchData();
    assert.equal(reloaded.categories.length, 4);
    assert.equal(reloaded.categories[3].name, "Personal Finance");
    assert.equal(reloaded.activeCategoryId, reloaded.categories[3].id);
  });

  it("handles category switching and remembers active category", async () => {
    const data = await loadWorkbenchData();
    const secondCatId = data.categories[1].id;
    await setActiveCategory(data, secondCatId);

    const reloaded = await loadWorkbenchData();
    assert.equal(reloaded.activeCategoryId, secondCatId);
  });

  it("validates category name and rejects empty or whitespace-only", async () => {
    const data = await loadWorkbenchData();
    await assert.rejects(async () => {
      await addCategory(data, "   ");
    }, /cannot be empty/);
  });

  it("renames an existing category", async () => {
    const data = await loadWorkbenchData();
    const catId = data.categories[0].id;
    await renameCategory(data, catId, "Core Products");

    const reloaded = await loadWorkbenchData();
    assert.equal(reloaded.categories[0].name, "Core Products");
  });

  it("enforces DEC-004: cannot delete the only remaining category", async () => {
    const data = await loadWorkbenchData();
    await deleteCategory(data, data.categories[2].id);
    await deleteCategory(data, data.categories[1].id);
    assert.equal(data.categories.length, 1);

    await assert.rejects(async () => {
      await deleteCategory(data, data.categories[0].id);
    }, /Cannot delete the last category/);
  });

  it("cascades deletion of groups and links when a category is deleted", async () => {
    const data = await loadWorkbenchData();
    const catId = data.categories[0].id;

    const group = await addGroup(data, catId, "Alpha Service");
    await addLink(data, group.id, { name: "Local", url: "http://localhost:3000", badge: "Local" });
    await addLink(data, group.id, { name: "Prod", url: "https://alpha.example.com", badge: "Prod" });

    const beforeDelete = await loadWorkbenchData();
    assert.equal(beforeDelete.groups.length, 1);
    assert.equal(beforeDelete.links.length, 2);

    const result = await deleteCategory(data, catId);
    assert.equal(result.deletedGroupsCount, 1);
    assert.equal(result.deletedLinksCount, 2);

    const afterDelete = await loadWorkbenchData();
    assert.equal(afterDelete.groups.length, 0);
    assert.equal(afterDelete.links.length, 0);
    assert.equal(afterDelete.activeCategoryId, afterDelete.categories[0].id);
  });

  it("manages groups within a category", async () => {
    const data = await loadWorkbenchData();
    const catId = data.categories[0].id;

    const group = await addGroup(data, catId, "Billing Engine");
    assert.equal(group.name, "Billing Engine");
    assert.equal(group.categoryId, catId);

    await renameGroup(data, group.id, "Payments & Billing");
    const reloaded = await loadWorkbenchData();
    assert.equal(reloaded.groups.find((g) => g.id === group.id).name, "Payments & Billing");

    await addLink(data, group.id, { name: "Docs", url: "https://stripe.com" });
    const withLink = await loadWorkbenchData();
    assert.equal(withLink.links.length, 1);

    const deleteRes = await deleteGroup(data, group.id);
    assert.equal(deleteRes.deletedLinksCount, 1);
    const finalData = await loadWorkbenchData();
    assert.equal(finalData.groups.length, 0);
    assert.equal(finalData.links.length, 0);
  });

  it("manages links with optional badges and validates URL", async () => {
    const data = await loadWorkbenchData();
    const catId = data.categories[0].id;
    const group = await addGroup(data, catId, "Order System");

    await assert.rejects(async () => {
      await addLink(data, group.id, { name: "Broken", url: "not-a-valid-url" });
    }, /valid URL/);

    await assert.rejects(async () => {
      await addLink(data, group.id, { name: "   ", url: "https://example.com" });
    }, /cannot be empty/);

    const link = await addLink(data, group.id, {
      name: "Staging Console",
      url: "https://staging.example.com",
      badge: "Test"
    });
    assert.equal(link.name, "Staging Console");
    assert.equal(link.badge, "Test");

    await editLink(data, link.id, {
      name: "Prod Console",
      url: "https://prod.example.com",
      badge: "Prod"
    });
    const updatedData = await loadWorkbenchData();
    const updated = updatedData.links.find((l) => l.id === link.id);
    assert.equal(updated.name, "Prod Console");
    assert.equal(updated.url, "https://prod.example.com");
    assert.equal(updated.badge, "Prod");

    await deleteLink(data, link.id);
    const emptyLinksData = await loadWorkbenchData();
    assert.equal(emptyLinksData.links.length, 0);
  });

  // =========================================================================
  // P1 Test: Storage Corruption Protection
  // =========================================================================
  it("does NOT overwrite corrupted or invalid storage data with default seed (P1 fix)", async () => {
    // Simulate corrupted storage data where categories is empty array or missing
    await rawWrite(STORAGE_KEY, { version: 1, categories: [], groups: [{ id: "valuable_group" }] });

    await assert.rejects(async () => {
      await loadWorkbenchData();
    }, (err) => {
      assert.equal(err.code, "CORRUPTED_STORAGE");
      return true;
    });

    // Verify storage was NOT overwritten by seed data
    const rawAfter = await rawRead(STORAGE_KEY);
    assert.equal(rawAfter.groups.length, 1);
    assert.equal(rawAfter.groups[0].id, "valuable_group");
    assert.equal(rawAfter.categories.length, 0); // Not replaced with 3 seed categories!
  });

  it("does NOT overwrite malformed non-object storage data (P1 fix)", async () => {
    await rawWrite(STORAGE_KEY, "completely invalid json or string");

    await assert.rejects(async () => {
      await loadWorkbenchData();
    }, (err) => {
      assert.equal(err.code, "CORRUPTED_STORAGE");
      return true;
    });

    const rawAfter = await rawRead(STORAGE_KEY);
    assert.equal(rawAfter, "completely invalid json or string");
  });

  // =========================================================================
  // P1 Test: Concurrent Multi-Tab Safe Mutations
  // =========================================================================
  it("handles multi-tab concurrent mutations without overwriting each other (P1 fix)", async () => {
    // Initialize storage
    const initial = await loadWorkbenchData();
    const catId = initial.categories[0].id;

    // Simulate Tab A and Tab B opening simultaneously with initial data snapshots
    const tabAData = JSON.parse(JSON.stringify(initial));
    const tabBData = JSON.parse(JSON.stringify(initial));

    // Tab A adds a group
    const groupA = await addGroup(tabAData, catId, "Group from Tab A");

    // Tab B adds a group using its older local snapshot
    const groupB = await addGroup(tabBData, catId, "Group from Tab B");

    // Re-read storage: BOTH groups must exist!
    const persisted = await loadWorkbenchData();
    const groupNames = persisted.groups.map((g) => g.name);
    assert.ok(groupNames.includes("Group from Tab A"), "Group from Tab A must be preserved");
    assert.ok(groupNames.includes("Group from Tab B"), "Group from Tab B must be preserved");
    assert.equal(persisted.groups.length, 2);

    // Now Tab A adds a link to groupA, Tab B adds a link to groupB
    await addLink(tabAData, groupA.id, { name: "Link A", url: "https://a.example.com" });
    await addLink(tabBData, groupB.id, { name: "Link B", url: "https://b.example.com" });

    const persistedWithLinks = await loadWorkbenchData();
    assert.equal(persistedWithLinks.links.length, 2);
    const linkNames = persistedWithLinks.links.map((l) => l.name);
    assert.ok(linkNames.includes("Link A"));
    assert.ok(linkNames.includes("Link B"));
  });
});
