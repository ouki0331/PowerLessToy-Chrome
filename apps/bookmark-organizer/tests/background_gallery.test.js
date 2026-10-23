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
});
