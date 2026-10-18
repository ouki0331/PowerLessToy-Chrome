/**
 * Cross-tab synchronisation: IndexedDB writes must be announced to other tabs.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { DATA_CHANGE_CHANNEL } from "../src/newtab/db.js";
import { loadWorkbenchData, addGroup, subscribeStorageChanges, _resetMemoryStore } from "../src/newtab/storage.js";
import { executeImport, exportBackup } from "../src/newtab/import-export.js";

function nextMessage(channel, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no broadcast received")), timeoutMs);
    channel.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data);
    };
  });
}

describe("Bookmark Organizer - Cross-tab sync", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("every committed IndexedDB write is broadcast to other tabs", async () => {
    const data = await loadWorkbenchData();
    const otherTab = new BroadcastChannel(DATA_CHANGE_CHANNEL);
    try {
      const received = nextMessage(otherTab);
      await addGroup(data, data.categories[0].id, "From tab A");
      const msg = await received;
      assert.equal(msg.type, "db-changed");
      assert.ok(msg.stores.includes("groups"));

      const receivedImport = nextMessage(otherTab);
      await executeImport({
        importData: {
          formatVersion: 1,
          categories: [{ id: "c", name: "Imported" }],
          groups: [],
          links: []
        }
      });
      assert.ok((await receivedImport).stores.includes("categories"));
    } finally {
      otherTab.close();
    }
  });

  it("subscribeStorageChanges fires for broadcasts from another tab", async () => {
    const otherTab = new BroadcastChannel(DATA_CHANGE_CHANNEL);
    let unsubscribe;
    try {
      const fired = new Promise((resolve) => {
        unsubscribe = subscribeStorageChanges(resolve);
      });
      otherTab.postMessage({ type: "db-changed", sourceId: "another-tab", stores: ["links"], at: Date.now() });
      const evt = await fired;
      assert.equal(evt.source, "indexeddb");
      assert.deepEqual(evt.stores, ["links"]);
    } finally {
      unsubscribe?.();
      otherTab.close();
    }
  });

  it("export reads the latest IndexedDB state, not a stale page snapshot", async () => {
    const tabA = await loadWorkbenchData(); // page snapshot taken here
    const tabB = JSON.parse(JSON.stringify(tabA));
    await addGroup(tabB, tabB.categories[0].id, "Saved in tab B");

    const backup = await exportBackup();
    assert.ok(backup.groups.some((g) => g.name === "Saved in tab B"));
    assert.equal(tabA.groups.length, 0, "tab A's cached state is stale, but export is not");
  });
});
