import "fake-indexeddb/auto";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { DB_NAME } from "../src/newtab/db.js";
import { BG_DB_NAME } from "../src/newtab/constants.js";

import {
  loadWorkbenchData,
  addCategory,
  deleteCategory,
  addGroup,
  deleteGroup,
  reorderGroups,
  recordGroupClick,
  getGroupMetricsMap,
  _resetMemoryStore
} from "../src/newtab/storage.js";

import {
  exportBackup
} from "../src/newtab/import-export.js";

import {
  saveBgConfig,
  getBgConfig,
  saveBgCurrent,
  getBgCurrent,
  addFavorite,
  getBgFavorites,
  saveLocalImage,
  resolveImageDisplayUrl,
  revokeActiveBlobUrl,
  resetMemoryStorage
} from "../src/newtab/background-service.js";

function deleteDatabase(name) {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve();
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("Bookmark Organizer - Group Ordering, Sorting & Usage Metrics", () => {
  beforeEach(async () => {
    _resetMemoryStore();
    resetMemoryStorage();
    await deleteDatabase(DB_NAME);
    await deleteDatabase(BG_DB_NAME);
  });

  describe("Group sortOrder and Manual Reordering", () => {
    it("assigns sequential sortOrder within category when adding groups", async () => {
      const data = await loadWorkbenchData();
      const catId = data.categories[0].id;

      const g1 = await addGroup(data, catId, "Group Alpha");
      const g2 = await addGroup(data, catId, "Group Beta");
      const g3 = await addGroup(data, catId, "Group Gamma");

      assert.equal(g1.sortOrder, 1);
      assert.equal(g2.sortOrder, 2);
      assert.equal(g3.sortOrder, 3);

      // Adding group to a different category starts its own sortOrder sequence at 1
      const cat2Id = data.categories[1].id;
      const gOther = await addGroup(data, cat2Id, "Other Group");
      assert.equal(gOther.sortOrder, 1);
    });

    it("reorders groups in a single atomic transaction and increments revision", async () => {
      const data = await loadWorkbenchData();
      const catId = data.categories[0].id;

      const g1 = await addGroup(data, catId, "Group 1");
      const g2 = await addGroup(data, catId, "Group 2");
      const g3 = await addGroup(data, catId, "Group 3");

      const initialRev1 = g1.revision || 1;
      const initialRev3 = g3.revision || 1;

      // Reorder to: g3, g1, g2
      const updated = await reorderGroups(data, catId, [g3.id, g1.id, g2.id]);
      assert.equal(updated.length, 3);

      // In-memory data updated
      assert.equal(data.groups.find((g) => g.id === g3.id).sortOrder, 1);
      assert.equal(data.groups.find((g) => g.id === g1.id).sortOrder, 2);
      assert.equal(data.groups.find((g) => g.id === g2.id).sortOrder, 3);

      // Revisions incremented for moved groups
      assert.equal(data.groups.find((g) => g.id === g3.id).revision, initialRev3 + 1);
      assert.equal(data.groups.find((g) => g.id === g1.id).revision, initialRev1 + 1);

      // Reload from IndexedDB confirms persistence
      const reloaded = await loadWorkbenchData();
      const catGroups = reloaded.groups.filter((g) => g.categoryId === catId);
      assert.equal(catGroups[0].id, g3.id);
      assert.equal(catGroups[1].id, g1.id);
      assert.equal(catGroups[2].id, g2.id);
    });

    it("dragging/reordering groups maintains manual order without writing temporary auto-sort positions", async () => {
      const data = await loadWorkbenchData();
      const catId = data.categories[0].id;

      const g1 = await addGroup(data, catId, "Group 1");
      const g2 = await addGroup(data, catId, "Group 2");
      const g3 = await addGroup(data, catId, "Group 3");

      // Record clicks on g2 so that in 'most-used' auto-sort mode, g2 is at the top
      await recordGroupClick(g2.id);
      await recordGroupClick(g2.id);

      const metricsMap = await getGroupMetricsMap();
      assert.equal(metricsMap.get(g2.id).usageCount, 2);

      // Verify that data in storage still preserves manual sortOrder (g1=1, g2=2, g3=3)
      const freshData = await loadWorkbenchData();
      assert.equal(freshData.groups.find((g) => g.id === g1.id).sortOrder, 1);
      assert.equal(freshData.groups.find((g) => g.id === g2.id).sortOrder, 2);
      assert.equal(freshData.groups.find((g) => g.id === g3.id).sortOrder, 3);

      // Now simulate a drag reorder of manual groups (moving g3 before g1)
      await reorderGroups(freshData, catId, [g3.id, g1.id, g2.id]);

      const afterDragData = await loadWorkbenchData();
      const reloadedGroups = afterDragData.groups
        .filter((g) => g.categoryId === catId)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      assert.equal(reloadedGroups[0].id, g3.id);
      assert.equal(reloadedGroups[1].id, g1.id);
      assert.equal(reloadedGroups[2].id, g2.id);
    });
  });

  describe("Group Usage Metrics Tracking", () => {
    it("atomically increments usageCount and sets lastUsedAt without touching group revision", async () => {
      const data = await loadWorkbenchData();
      const catId = data.categories[0].id;
      const group = await addGroup(data, catId, "Analytics Group");
      const initialRev = group.revision;

      const metric1 = await recordGroupClick(group.id);
      assert.equal(metric1.usageCount, 1);
      assert.ok(metric1.lastUsedAt > 0);

      const metric2 = await recordGroupClick(group.id);
      assert.equal(metric2.usageCount, 2);
      assert.ok(metric2.lastUsedAt >= metric1.lastUsedAt);

      // Group entity revision MUST remain completely untouched (no false CONFLICT errors)
      const reloaded = await loadWorkbenchData();
      const reloadedGroup = reloaded.groups.find((g) => g.id === group.id);
      assert.equal(reloadedGroup.revision, initialRev);

      // Metrics map contains recorded stats
      const metricsMap = await getGroupMetricsMap();
      assert.equal(metricsMap.get(group.id).usageCount, 2);
    });

    it("cascades deletion of group metrics when a group is deleted", async () => {
      const data = await loadWorkbenchData();
      const catId = data.categories[0].id;
      const group = await addGroup(data, catId, "Ephemeral Group");

      await recordGroupClick(group.id);
      let map = await getGroupMetricsMap();
      assert.ok(map.has(group.id));

      await deleteGroup(data, group.id);
      map = await getGroupMetricsMap();
      assert.equal(map.has(group.id), false);
    });

    it("cascades deletion of all group metrics when a category is deleted", async () => {
      const data = await loadWorkbenchData();
      const cat = await addCategory(data, "Projects To Delete");
      const g1 = await addGroup(data, cat.id, "Group 1");
      const g2 = await addGroup(data, cat.id, "Group 2");

      await recordGroupClick(g1.id);
      await recordGroupClick(g2.id);

      let map = await getGroupMetricsMap();
      assert.ok(map.has(g1.id));
      assert.ok(map.has(g2.id));

      await deleteCategory(data, cat.id);

      map = await getGroupMetricsMap();
      assert.equal(map.has(g1.id), false);
      assert.equal(map.has(g2.id), false);
    });

    it("excludes group metrics from bookmark JSON backup export", async () => {
      const data = await loadWorkbenchData();
      const catId = data.categories[0].id;
      const group = await addGroup(data, catId, "Metric Group");
      await recordGroupClick(group.id);

      const backup = await exportBackup();
      const exportedGroup = backup.groups.find((g) => g.id === group.id);
      assert.ok(exportedGroup);
      assert.equal(exportedGroup.sortOrder, 1);
      assert.equal(exportedGroup.usageCount, undefined);
      assert.equal(exportedGroup.lastUsedAt, undefined);
      assert.equal(backup.groupMetrics, undefined);
    });
  });

  describe("Background Multi-Select Categories & Local Image Blob Safety", () => {
    it("supports multi-select background categories in config", async () => {
      await saveBgConfig({ categories: ["nature", "architecture", "space"] });
      const config = await getBgConfig();
      assert.deepEqual(config.categories, ["nature", "architecture", "space"]);
    });

    it("strips blob URLs from storage and resolves display URLs safely", async () => {
      if (typeof global.URL.createObjectURL !== "function") {
        global.URL.createObjectURL = () => `blob:mock-url-${Math.random()}`;
      }
      if (typeof global.URL.revokeObjectURL !== "function") {
        global.URL.revokeObjectURL = () => {};
      }

      const mockBlob = new Blob(["fake-image-bytes"], { type: "image/png" });
      const localImg = await saveLocalImage(mockBlob, "desktop-wallpaper.png");

      // Save as current image - must strip any blob: URL before persisting
      const currentWithBlob = {
        ...localImg,
        category: "local",
        isLocal: true,
        url: "blob:http://localhost/should-not-persist",
        thumbUrl: "blob:http://localhost/should-not-persist-thumb"
      };
      await saveBgCurrent(currentWithBlob);

      const saved = await getBgCurrent();
      assert.equal(saved.url, undefined);
      assert.equal(saved.thumbUrl, undefined);
      assert.equal(saved.isLocal, true);
      assert.equal(saved.id, localImg.id);

      // Resolving display url creates fresh object URL from IndexedDB Blob
      const displayUrl = await resolveImageDisplayUrl(saved);
      assert.ok(displayUrl.startsWith("blob:"));
      revokeActiveBlobUrl();
    });

    it("saves local image favorites without persisting dead blob URLs", async () => {
      const mockBlob = new Blob(["test-pixels"], { type: "image/jpeg" });
      const localImg = await saveLocalImage(mockBlob, "nature-hike.jpg");

      const success = await addFavorite({
        ...localImg,
        category: "local",
        isLocal: true,
        url: "blob:temporary-blob-url"
      });
      assert.equal(success, true);

      const allFavs = await getBgFavorites();
      const storedFav = allFavs.find((f) => f.id === localImg.id);
      assert.ok(storedFav);
      assert.equal(storedFav.url, undefined);
      assert.equal(storedFav.isLocal, true);
    });
  });
});
