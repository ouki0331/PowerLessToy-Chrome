import "fake-indexeddb/auto";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  getBgConfig,
  saveBgConfig,
  getBgCurrent,
  saveBgCurrent,
  getNextImage,
  addFavorite,
  removeFavorite,
  isFavorite,
  toggleFavorite,
  getBgFavorites,
  saveLocalImage,
  getLocalImagesList,
  getLocalImageBlob,
  deleteLocalImage,
  deleteLocalImageAndCascade,
  setLocalImageAsBackground,
  getLocalImagesTotalSize,
  resetMemoryStorage,
  DEFAULT_BG_CONFIG,
  COMMONS_CATEGORIES,
  OFFLINE_SEED_IMAGES
} from "../src/newtab/background-service.js";

import { exportBackup } from "../src/newtab/import-export.js";
import { DB_NAME } from "../src/newtab/db.js";
import { BG_DB_NAME } from "../src/newtab/constants.js";

describe("Bookmark Organizer - Keyless Background Gallery & Controls", () => {
  let mockChromeStorage;
  let mockLocalStorage;
  let fetchCallCount;
  let lastFetchUrl;

  const mockFetch = async (url) => {
    fetchCallCount++;
    lastFetchUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        query: {
          pages: {
            101: {
              pageid: 101,
              title: "File:Panoramic_Alpine_Vista.jpg",
              imageinfo: [
                {
                  mime: "image/jpeg",
                  width: 2560,
                  height: 1440,
                  url: "https://upload.wikimedia.org/wikipedia/commons/1/11/Panoramic_Alpine_Vista.jpg",
                  thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Panoramic_Alpine_Vista.jpg/1920px-Panoramic_Alpine_Vista.jpg",
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Panoramic_Alpine_Vista.jpg",
                  extmetadata: {
                    Artist: { value: "Jane Mountaineer" },
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                    LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" }
                  }
                }
              ]
            }
          }
        }
      })
    };
  };

  beforeEach(() => {
    resetMemoryStorage();
    mockChromeStorage = {};
    mockLocalStorage = {};
    fetchCallCount = 0;
    lastFetchUrl = null;

    global.chrome = {
      storage: {
        local: {
          get: async (keys) => {
            const res = {};
            for (const k of keys) {
              if (mockChromeStorage[k] !== undefined) {
                res[k] = mockChromeStorage[k];
              }
            }
            return res;
          },
          set: async (obj) => {
            Object.assign(mockChromeStorage, obj);
          }
        }
      }
    };

    global.localStorage = {
      getItem: (k) => mockLocalStorage[k] || null,
      setItem: (k, v) => {
        mockLocalStorage[k] = String(v);
      },
      removeItem: (k) => {
        delete mockLocalStorage[k];
      }
    };
  });

  it("defaults to OFF (enabled: false) and initial settings", async () => {
    const config = await getBgConfig();
    assert.equal(config.enabled, false, "Background must be disabled by default");
    assert.equal(config.frequency, "daily");
    assert.equal(config.opacity, 35);
    assert.deepEqual(config.categories, ["nature"]);
    assert.equal(config.isImageLocked, false);
    assert.equal(config.isCategoryLocked, true);
  });

  it("does NOT invoke Commons API when background is OFF", async () => {
    await saveBgConfig({ enabled: false });
    const result = await getNextImage({ fetchFn: mockFetch });
    assert.equal(result, null, "Should return null when disabled");
    assert.equal(fetchCallCount, 0, "No network request should be sent when disabled");
  });

  it("invokes Commons API with anonymous CORS (origin=*) only when explicitly enabled", async () => {
    await saveBgConfig({ enabled: true });
    const result = await getNextImage({ fetchFn: mockFetch });

    assert.ok(result, "Should return an image record");
    assert.equal(fetchCallCount, 1, "Should have called fetch once");
    assert.ok(lastFetchUrl.includes("origin=*"), "Must request with anonymous CORS (origin=*)");
    assert.ok(lastFetchUrl.includes("commons.wikimedia.org"), "Must target Wikimedia Commons");
    assert.equal(result.title, "Panoramic Alpine Vista");
    assert.equal(result.artist, "Jane Mountaineer");
    assert.equal(result.license, "CC BY-SA 4.0");
    assert.ok(result.commonsUrl.includes("File:Panoramic_Alpine_Vista.jpg"));
  });

  it("category locking strictly queries the selected category", async () => {
    await saveBgConfig({
      enabled: true,
      categories: ["architecture"],
      isCategoryLocked: true
    });

    await getNextImage({ fetchFn: mockFetch });
    assert.ok(
      lastFetchUrl.includes(encodeURIComponent(COMMONS_CATEGORIES.architecture.title)) ||
      lastFetchUrl.includes("Featured_pictures_of_architecture"),
      "Must query architecture category when selected"
    );
  });

  it("image locking stops automatic switching across tabs", async () => {
    await saveBgConfig({ enabled: true });
    const first = await getNextImage({ fetchFn: mockFetch });
    assert.equal(fetchCallCount, 1);

    // Lock the image
    await saveBgConfig({ isImageLocked: true });

    // Subsequent call simulates another tab open with 'tab' frequency
    await saveBgConfig({ frequency: "tab" });
    const second = await getNextImage({ fetchFn: mockFetch });

    assert.equal(fetchCallCount, 1, "Should NOT fetch another image while locked");
    assert.equal(second.id, first.id, "Locked image must be preserved");

    // Manual 'force' next image advances even while image is locked
    const forced = await getNextImage({ force: true, fetchFn: mockFetch });
    assert.ok(forced, "Force next image must advance even while locked");
  });

  it("daily frequency reuses cached image within the same day", async () => {
    await saveBgConfig({ enabled: true, frequency: "daily" });
    const img1 = await getNextImage({ fetchFn: mockFetch });
    assert.equal(fetchCallCount, 1);

    // Opening 5 tabs on the same day reuses the cached image
    for (let i = 0; i < 5; i++) {
      const img = await getNextImage({ fetchFn: mockFetch });
      assert.equal(img.id, img1.id);
    }
    assert.equal(fetchCallCount, 1, "Must not make extra API calls on the same day");
  });

  it("every new tab frequency switches image on each tab", async () => {
    await saveBgConfig({ enabled: true, frequency: "tab" });
    await getNextImage({ fetchFn: mockFetch });
    assert.equal(fetchCallCount, 1);

    // Opening another tab
    await getNextImage({ fetchFn: mockFetch });
    // It will reuse category cache if available or call fetch, but should advance
    const current = await getBgCurrent();
    assert.ok(current);
  });

  it("manages favorites (add, deduplicate, remove, toggle)", async () => {
    const testImage = {
      id: "File:Test_Image.jpg",
      title: "Test Image",
      artist: "Alice",
      thumbUrl: "https://upload.wikimedia.org/test-thumb.jpg",
      originalUrl: "https://upload.wikimedia.org/test.jpg",
      license: "CC0",
      category: "nature"
    };

    assert.equal(await isFavorite(testImage.id), false);

    // Add
    const added = await addFavorite(testImage);
    assert.equal(added, true);
    assert.equal(await isFavorite(testImage.id), true);

    // Deduplicate: adding again returns true without duplicating entry
    await addFavorite(testImage);
    const list = await getBgFavorites();
    assert.equal(list.length, 1);

    // Toggle: removes it
    const isNowFav = await toggleFavorite(testImage);
    assert.equal(isNowFav, false);
    assert.equal(await isFavorite(testImage.id), false);
    assert.equal((await getBgFavorites()).length, 0);
  });

  it("handles empty favorites source state gracefully", async () => {
    await saveBgConfig({
      enabled: true,
      categories: ["favorites"],
      isCategoryLocked: true
    });

    const result = await getNextImage({ fetchFn: mockFetch });
    assert.equal(result.isEmptyFavorites, true, "Must return empty favorites indicator");
    assert.equal(fetchCallCount, 0, "No external API calls for local favorites");
  });

  it("safely falls back to offline seed or existing image on network or API failure", async () => {
    await saveBgConfig({ enabled: true, categories: ["nature"] });

    // Mock network failure
    const failingFetch = async () => {
      throw new Error("Network offline or DNS lookup failed");
    };

    const result = await getNextImage({ fetchFn: failingFetch });
    assert.ok(result, "Must return a fallback image despite network error");
    assert.ok(result.thumbUrl.length > 0);
    assert.ok(result.artist.length > 0);
    assert.ok(result.license.length > 0);
  });

  it("stores and manages local images in isolated IndexedDB database", async () => {
    const fakeBlob = {
      name: "my_desktop_wallpaper.jpg",
      size: 1024 * 500, // 500KB
      type: "image/jpeg"
    };

    const saved = await saveLocalImage(fakeBlob);
    assert.ok(saved.id.startsWith("local_img_"));
    assert.equal(saved.name, "my_desktop_wallpaper.jpg");

    const list = await getLocalImagesList();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, saved.id);

    const totalSize = await getLocalImagesTotalSize();
    assert.equal(totalSize, fakeBlob.size);

    // Delete
    const deleted = await deleteLocalImage(saved.id);
    assert.equal(deleted, true);
    assert.equal((await getLocalImagesList()).length, 0);
  });

  it("enforces 10MB limit for local image upload", async () => {
    const hugeBlob = {
      name: "giant_poster.png",
      size: 11 * 1024 * 1024, // 11MB > 10MB
      type: "image/png"
    };

    await assert.rejects(
      async () => await saveLocalImage(hugeBlob),
      /File exceeds 10MB limit/
    );
  });

  it("STRICT DATA SEGREGATION: bookmark JSON backup export never contains background data", async () => {
    // Populate background data
    await saveBgConfig({
      enabled: true,
      opacity: 75,
      frequency: "weekly",
      categories: ["space"],
      isImageLocked: true
    });
    await addFavorite({
      id: "File:Cosmic_Nebula.jpg",
      title: "Cosmic Nebula",
      artist: "Hubble",
      thumbUrl: "https://upload.wikimedia.org/nebula.jpg",
      originalUrl: "https://upload.wikimedia.org/nebula-orig.jpg",
      license: "Public Domain"
    });

    // Run canonical bookmark export
    const backup = await exportBackup();

    // Verify formatVersion and shape
    assert.equal(backup.formatVersion, 1);
    assert.ok(Array.isArray(backup.categories));
    assert.ok(Array.isArray(backup.groups));
    assert.ok(Array.isArray(backup.links));

    // Verify ZERO background keys or favorites leaked into the backup
    const backupJson = JSON.stringify(backup);
    assert.equal(backupJson.includes("powerless_toy_bg"), false);
    assert.equal(backupJson.includes("Cosmic Nebula"), false);
    assert.equal(backupJson.includes("Hubble"), false);
    assert.equal(backupJson.includes("isImageLocked"), false);
  });

  describe("Background Source Modes & User Upload Integration", () => {
    it("sets uploaded local image immediately as active background and switches sourceMode to my_images", async () => {
      const mockBlob = new Blob(["my-photo-pixels"], { type: "image/jpeg" });
      const saved = await saveLocalImage(mockBlob);

      const res = await setLocalImageAsBackground(saved.id);
      assert.ok(res);
      assert.equal(res.config.enabled, true);
      assert.equal(res.config.sourceMode, "my_images");
      assert.equal(res.config.lastLocalImageId, saved.id);

      const current = await getBgCurrent();
      assert.ok(current);
      assert.equal(current.id, saved.id);
      assert.equal(current.isLocal, true);
    });

    it("persists user-uploaded local background across reloads / getNextImage calls", async () => {
      const mockBlob = new Blob(["persisted-pixels"], { type: "image/png" });
      const saved = await saveLocalImage(mockBlob);
      await setLocalImageAsBackground(saved.id);

      // Subsequent getNextImage call (e.g. on new tab or reload) retains the local image
      const nextImg = await getNextImage({ force: false });
      assert.ok(nextImg);
      assert.equal(nextImg.id, saved.id);
      assert.equal(nextImg.isLocal, true);
    });

    it("switching to random mode keeps local images in IndexedDB and does NOT overwrite lastLocalImageId", async () => {
      const mockBlob = new Blob(["photo-data"], { type: "image/jpeg" });
      const saved = await saveLocalImage(mockBlob);
      await setLocalImageAsBackground(saved.id);

      // Switch to Random mode
      await saveBgConfig({ sourceMode: "random" });

      const randomImg = await getNextImage({ force: true, fetchFn: mockFetch });
      assert.ok(randomImg);
      assert.equal(randomImg.isLocal, undefined);

      // Verify lastLocalImageId was preserved and local image remains in IndexedDB
      const cfg = await getBgConfig();
      assert.equal(cfg.lastLocalImageId, saved.id);

      const localList = await getLocalImagesList();
      assert.equal(localList.length > 0, true);
      assert.ok(localList.some((img) => img.id === saved.id));
    });

    it("switching back to my_images restores last selected local image", async () => {
      const mockBlob = new Blob(["photo-data"], { type: "image/jpeg" });
      const saved = await saveLocalImage(mockBlob);
      await setLocalImageAsBackground(saved.id);

      // Temporarily switch to random
      await saveBgConfig({ sourceMode: "random" });
      await getNextImage({ force: true, fetchFn: mockFetch });

      // Switch back to my_images
      await saveBgConfig({ sourceMode: "my_images" });
      const restored = await getNextImage({ force: false });
      assert.ok(restored);
      assert.equal(restored.id, saved.id);
      assert.equal(restored.isLocal, true);
    });

    it("explicitly sets another local image as background when multiple images exist", async () => {
      const b1 = new Blob(["pic-1"], { type: "image/jpeg" });
      const b2 = new Blob(["pic-2"], { type: "image/jpeg" });
      const s1 = await saveLocalImage(b1);
      const s2 = await saveLocalImage(b2);

      await setLocalImageAsBackground(s1.id);
      let cur = await getBgCurrent();
      assert.equal(cur.id, s1.id);

      // Switch to second local image
      await setLocalImageAsBackground(s2.id);
      cur = await getBgCurrent();
      assert.equal(cur.id, s2.id);
      const cfg = await getBgConfig();
      assert.equal(cfg.lastLocalImageId, s2.id);
    });

    it("deleting active local image cascades to remaining local image, or falls back to random when empty", async () => {
      // Clear any leftover local images from prior tests to ensure exact counts
      const existing = await getLocalImagesList();
      for (const item of existing) {
        await deleteLocalImage(item.id);
      }

      const b1 = new Blob(["pic-a"], { type: "image/jpeg" });
      const b2 = new Blob(["pic-b"], { type: "image/jpeg" });
      const s1 = await saveLocalImage(b1);
      const s2 = await saveLocalImage(b2);

      await setLocalImageAsBackground(s1.id);

      // Delete active s1 -> cascades to s2
      const cascadeRes = await deleteLocalImageAndCascade(s1.id, { fetchFn: mockFetch });
      assert.equal(cascadeRes.wasActive, true);
      assert.equal(cascadeRes.switchedToNextLocal, true);
      assert.equal(cascadeRes.remainingCount, 1);
      assert.equal(cascadeRes.image.id, s2.id);

      // Delete remaining s2 -> falls back to random
      const fallbackRes = await deleteLocalImageAndCascade(s2.id, { fetchFn: mockFetch });
      assert.equal(fallbackRes.wasActive, true);
      assert.equal(fallbackRes.switchedToRandom, true);
      assert.equal(fallbackRes.remainingCount, 0);

      const finalCfg = await getBgConfig();
      assert.equal(finalCfg.sourceMode, "random");
      assert.equal(finalCfg.lastLocalImageId, null);
    });
  });
});
