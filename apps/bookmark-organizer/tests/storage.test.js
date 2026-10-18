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
  _resetMemoryStore
} from "../src/newtab/storage.js";

describe("Bookmark Organizer - Storage & CRUD Logic", () => {
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

    assert.equal(data.categories[0].name, "Core Products");
  });

  it("enforces DEC-004: cannot delete the only remaining category", async () => {
    const data = await loadWorkbenchData();
    // Delete until only 1 remains
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

    assert.equal(data.groups.length, 1);
    assert.equal(data.links.length, 2);

    const result = await deleteCategory(data, catId);
    assert.equal(result.deletedGroupsCount, 1);
    assert.equal(result.deletedLinksCount, 2);
    assert.equal(data.groups.length, 0);
    assert.equal(data.links.length, 0);
    // Active category switched to next remaining category
    assert.equal(data.activeCategoryId, data.categories[0].id);
  });

  it("manages groups within a category", async () => {
    const data = await loadWorkbenchData();
    const catId = data.categories[0].id;

    const group = await addGroup(data, catId, "Billing Engine");
    assert.equal(group.name, "Billing Engine");
    assert.equal(group.categoryId, catId);

    await renameGroup(data, group.id, "Payments & Billing");
    assert.equal(data.groups.find((g) => g.id === group.id).name, "Payments & Billing");

    await addLink(data, group.id, { name: "Docs", url: "https://stripe.com" });
    assert.equal(data.links.length, 1);

    const deleteRes = await deleteGroup(data, group.id);
    assert.equal(deleteRes.deletedLinksCount, 1);
    assert.equal(data.groups.length, 0);
    assert.equal(data.links.length, 0);
  });

  it("manages links with optional badges and validates URL", async () => {
    const data = await loadWorkbenchData();
    const catId = data.categories[0].id;
    const group = await addGroup(data, catId, "Order System");

    // Invalid URL should be rejected
    await assert.rejects(async () => {
      await addLink(data, group.id, { name: "Broken", url: "not-a-valid-url" });
    }, /valid URL/);

    // Empty name should be rejected
    await assert.rejects(async () => {
      await addLink(data, group.id, { name: "   ", url: "https://example.com" });
    }, /cannot be empty/);

    // Valid link with badge
    const link = await addLink(data, group.id, {
      name: "Staging Console",
      url: "https://staging.example.com",
      badge: "Test"
    });
    assert.equal(link.name, "Staging Console");
    assert.equal(link.badge, "Test");

    // Edit link
    await editLink(data, link.id, {
      name: "Prod Console",
      url: "https://prod.example.com",
      badge: "Prod"
    });
    const updated = data.links.find((l) => l.id === link.id);
    assert.equal(updated.name, "Prod Console");
    assert.equal(updated.url, "https://prod.example.com");
    assert.equal(updated.badge, "Prod");

    // Delete link
    await deleteLink(data, link.id);
    assert.equal(data.links.length, 0);
  });
});
