/**
 * IndexedDB Storage Engine for Offline Dictionary (DICT-LOOKUP-001 & DICT-PACK-001)
 *
 * Capabilities:
 * - Chunked / streaming batch import to avoid UI freeze and excessive memory footprint.
 * - Integrity validation (SHA-256 checksum) computed on raw serialized file bytes.
 * - Versioned staging architecture: old active pack remains 100% queryable if update fails.
 * - Instantaneous atomic activation (O(1) switch in packs store).
 * - Safe asynchronous garbage collection of retired versions.
 * - Indexed point lookups (O(1) memory per query).
 * - Complete data segregation: never mixed with bookmark tree or exported in bookmark JSON.
 */

import { DICT_DB_NAME, DICT_DB_VERSION, DICT_STORES } from "./dict-constants.js";

function getIndexedDB() {
  if (typeof indexedDB !== "undefined") return indexedDB;
  if (typeof globalThis !== "undefined" && globalThis.indexedDB) return globalThis.indexedDB;
  throw new Error("IndexedDB is not available in current environment");
}

export async function computeStringSha256(str) {
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  try {
    const nodeCrypto = await import("node:crypto");
    return nodeCrypto.createHash("sha256").update(str, "utf8").digest("hex");
  } catch {
    return "";
  }
}

let cachedDb = null;

export function closeDictDb() {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch {}
    cachedDb = null;
  }
}

export function openDictDb() {
  if (cachedDb) {
    return Promise.resolve(cachedDb);
  }
  const idb = getIndexedDB();
  return new Promise((resolve, reject) => {
    const req = idb.open(DICT_DB_NAME, DICT_DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // 1. Packs store (metadata of installed packs: packId, activeVersion, etc.)
      if (!db.objectStoreNames.contains(DICT_STORES.PACKS)) {
        db.createObjectStore(DICT_STORES.PACKS, { keyPath: "packId" });
      }

      // 2. Entries store
      if (!db.objectStoreNames.contains(DICT_STORES.ENTRIES)) {
        const entryStore = db.createObjectStore(DICT_STORES.ENTRIES, { keyPath: "id" });
        entryStore.createIndex("packId", "packId", { unique: false });
        entryStore.createIndex("version", "version", { unique: false });
        entryStore.createIndex("word", "word", { unique: false });
        entryStore.createIndex("reading", "reading", { unique: false });
        entryStore.createIndex("lookupKeys", "lookupKeys", { unique: false, multiEntry: true });
      } else {
        const entryStore = req.transaction.objectStore(DICT_STORES.ENTRIES);
        if (!entryStore.indexNames.contains("version")) {
          entryStore.createIndex("version", "version", { unique: false });
        }
      }

      // 3. AI Cache store
      if (!db.objectStoreNames.contains(DICT_STORES.AI_CACHE)) {
        db.createObjectStore(DICT_STORES.AI_CACHE, { keyPath: "cacheKey" });
      }

      // 4. History store
      if (!db.objectStoreNames.contains(DICT_STORES.HISTORY)) {
        const histStore = db.createObjectStore(DICT_STORES.HISTORY, { keyPath: "id", autoIncrement: true });
        histStore.createIndex("timestamp", "timestamp", { unique: false });
      }
    };

    req.onsuccess = () => {
      cachedDb = req.result;
      cachedDb.onversionchange = () => {
        closeDictDb();
      };
      resolve(cachedDb);
    };
    req.onerror = () => reject(req.error || new Error("Failed to open dictionary database"));
  });
}

export function buildLookupKeys(entry) {
  const keys = new Set();
  if (entry.word) keys.add(entry.word.toLowerCase());
  if (entry.reading) keys.add(entry.reading.toLowerCase());
  if (Array.isArray(entry.altWords)) {
    for (const w of entry.altWords) {
      if (w) keys.add(w.toLowerCase());
    }
  }
  if (Array.isArray(entry.altReadings)) {
    for (const r of entry.altReadings) {
      if (r) keys.add(r.toLowerCase());
    }
  }
  return Array.from(keys);
}

/**
 * Get all installed dictionary packs.
 */
export async function getInstalledPacks() {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.PACKS, "readonly");
    const store = tx.objectStore(DICT_STORES.PACKS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Get pack metadata by packId.
 */
export async function getPackMeta(packId) {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.PACKS, "readonly");
    const store = tx.objectStore(DICT_STORES.PACKS);
    const req = store.get(packId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete entries matching a specific packId.
 */
async function deleteEntriesForPack(db, packId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.ENTRIES, "readwrite");
    const store = tx.objectStore(DICT_STORES.ENTRIES);
    const index = store.index("packId");
    const req = index.getAllKeys(IDBKeyRange.only(packId));

    req.onsuccess = () => {
      const keys = req.result || [];
      for (const k of keys) {
        store.delete(k);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function deleteEntriesForVersion(db, version) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.ENTRIES, "readwrite");
    const store = tx.objectStore(DICT_STORES.ENTRIES);
    const index = store.index("version");
    const req = index.getAllKeys(IDBKeyRange.only(version));

    req.onsuccess = () => {
      const keys = req.result || [];
      for (const k of keys) {
        store.delete(k);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Safely purge retired entries for a given packId whose version does not match activeVersion.
 * Note: failure during cleanup is caught and logged, never blocking new pack queries.
 */
async function purgeRetiredEntries(db, packId, currentActiveVersion) {
  try {
    const tx = db.transaction(DICT_STORES.ENTRIES, "readwrite");
    const store = tx.objectStore(DICT_STORES.ENTRIES);
    const index = store.index("packId");
    const req = index.openCursor(IDBKeyRange.only(packId));

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const record = cursor.value;
        if (record.version !== currentActiveVersion) {
          cursor.delete();
        }
        cursor.continue();
      }
    };

    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("Failed to purge retired dictionary entries for pack:", packId, err);
  }
}

/**
 * Count entries with a specific version.
 */
async function countEntriesForVersion(db, version) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.ENTRIES, "readonly");
    const store = tx.objectStore(DICT_STORES.ENTRIES);
    const index = store.index("version");
    const req = index.count(IDBKeyRange.only(version));
    req.onsuccess = () => resolve(req.result || 0);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Install a dictionary pack from raw chunks with staging, checksum verification, and atomic activation.
 *
 * Safety workflow:
 * 1. Download or read each chunk's raw bytes/text.
 * 2. Verify SHA-256 against chunk's expected checksum in manifest.
 * 3. Write entries into staging area with temporary stagingVersion.
 * 4. Verify total staged entry count.
 * 5. Atomically activate new version: update activeVersion in packs store (O(1)).
 * 6. Clean up old version entries in background.
 * 7. If any step fails before activation, rollback staging entries and preserve old active dictionary!
 */
export async function installPackFromChunks(packMeta, chunkLoader, { onProgress = null } = {}) {
  if (!packMeta || !packMeta.packId || !Array.isArray(packMeta.chunks)) {
    throw new Error("Invalid pack metadata for chunked installation");
  }

  const db = await openDictDb();
  const packId = packMeta.packId;
  const currentActiveMeta = await getPackMeta(packId);
  const oldActiveVersion = currentActiveMeta?.activeVersion || null;

  const stagingVersion = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const totalExpected = packMeta.entryCount;
  let stagedCount = 0;

  try {
    // 1. Process each chunk
    for (let cIdx = 0; cIdx < packMeta.chunks.length; cIdx++) {
      const chunkInfo = packMeta.chunks[cIdx];
      const rawText = await chunkLoader(chunkInfo.file);

      // Verify SHA-256 on raw string before parsing
      if (chunkInfo.checksum) {
        const computed = await computeStringSha256(rawText);
        if (computed !== chunkInfo.checksum) {
          throw new Error(`Checksum mismatch for chunk ${chunkInfo.file}: expected ${chunkInfo.checksum}, got ${computed}`);
        }
      }

      const chunkData = JSON.parse(rawText);
      const entries = chunkData.entries || [];
      const batchSize = 1000;

      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        await new Promise((resolve, reject) => {
          const tx = db.transaction(DICT_STORES.ENTRIES, "readwrite");
          const store = tx.objectStore(DICT_STORES.ENTRIES);

          for (const rawEntry of batch) {
            const stagedEntry = {
              ...rawEntry,
              id: `${packId}_${stagingVersion}_${rawEntry.id}`,
              entryId: rawEntry.id,
              packId,
              version: stagingVersion,
              language: packMeta.language,
              lookupKeys: buildLookupKeys(rawEntry)
            };
            store.put(stagedEntry);
          }

          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });

        stagedCount += batch.length;
        if (typeof onProgress === "function") {
          onProgress(stagedCount, totalExpected);
        }
      }
    }

    // 2. Verify total staged entries
    const actualCount = await countEntriesForVersion(db, stagingVersion);
    if (actualCount !== totalExpected) {
      throw new Error(`Staged entry count mismatch: expected ${totalExpected}, got ${actualCount}`);
    }

    // 3. Atomically activate new version in packs store (O(1))
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DICT_STORES.PACKS, "readwrite");
      const store = tx.objectStore(DICT_STORES.PACKS);
      store.put({
        packId,
        language: packMeta.language,
        name: packMeta.name || packId,
        version: packMeta.version || "1.0.0",
        activeVersion: stagingVersion,
        source: packMeta.source || "Unknown",
        sourceUrl: packMeta.sourceUrl || "",
        license: packMeta.license || "",
        attribution: packMeta.attribution || "",
        entryCount: stagedCount,
        installedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // 4. Safely clean up retired entries (including unversioned entries from v1)
    purgeRetiredEntries(db, packId, stagingVersion);

    return { success: true, packId, entryCount: stagedCount };
  } catch (err) {
    // Rollback: delete all staged entries, leaving existing active version untouched!
    try {
      await deleteEntriesForVersion(db, stagingVersion);
    } catch {}
    throw err;
  }
}

/**
 * Install a single dictionary pack object (used for test fixtures & backward compatibility)
 * with staging, checksum verification, and rollback on failure.
 */
export async function installPack(packData, { rawText = "", expectedChecksum = "", onProgress = null } = {}) {
  if (!packData || !packData.packId || !Array.isArray(packData.entries)) {
    throw new Error("Invalid dictionary pack data structure");
  }

  // Checksum verification on raw text if expectedChecksum provided
  if (expectedChecksum) {
    const rawToVerify = rawText || JSON.stringify(packData);
    const computed = await computeStringSha256(rawToVerify);
    if (computed && computed !== expectedChecksum) {
      throw new Error(`Dictionary pack checksum mismatch: expected ${expectedChecksum}, got ${computed}`);
    }
  }

  const db = await openDictDb();
  const packId = packData.packId;
  const currentActiveMeta = await getPackMeta(packId);
  const oldActiveVersion = currentActiveMeta?.activeVersion || null;

  const entries = packData.entries;
  const total = entries.length;
  const stagingVersion = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const chunkSize = 500;

  try {
    // 1. Chunked import into staging version
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DICT_STORES.ENTRIES, "readwrite");
        const store = tx.objectStore(DICT_STORES.ENTRIES);

        for (const rawEntry of chunk) {
          const entry = {
            ...rawEntry,
            id: `${packId}_${stagingVersion}_${rawEntry.id}`,
            entryId: rawEntry.id,
            packId,
            version: stagingVersion,
            language: packData.language,
            lookupKeys: buildLookupKeys(rawEntry)
          };
          store.put(entry);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
      });

      if (typeof onProgress === "function") {
        onProgress(Math.min(i + chunkSize, total), total);
      }
    }

    // 2. Controlled atomic switch: update packs store to activate staging version
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DICT_STORES.PACKS, "readwrite");
      const store = tx.objectStore(DICT_STORES.PACKS);
      const meta = {
        packId: packData.packId,
        language: packData.language,
        name: packData.name || packData.packId,
        version: packData.version || "1.0.0",
        activeVersion: stagingVersion,
        source: packData.source || "Unknown",
        sourceUrl: packData.sourceUrl || "",
        license: packData.license || "",
        attribution: packData.attribution || "",
        entryCount: total,
        installedAt: Date.now()
      };
      store.put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // 3. Safely clean up retired entries (including unversioned entries from v1)
    purgeRetiredEntries(db, packId, stagingVersion);

    return { success: true, packId, entryCount: total };
  } catch (err) {
    // Rollback: clear any staging entries on error, preserving existing active pack
    try {
      await deleteEntriesForVersion(db, stagingVersion);
    } catch {}
    throw err;
  }
}

/**
 * Uninstall a dictionary pack and its entries.
 */
export async function uninstallPack(packId) {
  const db = await openDictDb();
  await deleteEntriesForPack(db, packId);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.PACKS, "readwrite");
    const store = tx.objectStore(DICT_STORES.PACKS);
    store.delete(packId);
    tx.oncomplete = () => resolve({ success: true, packId });
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Point lookup for words using IndexedDB multi-entry index (O(1) memory per query).
 * Only returns entries belonging to currently active pack versions!
 */
export async function lookupWord(rawWord, { lang = null, limit = 10 } = {}) {
  const word = (rawWord || "").trim().toLowerCase();
  if (!word) return [];

  const db = await openDictDb();
  const installedPacks = await getInstalledPacks();
  if (installedPacks.length === 0) return [];

  const activeVersionMap = new Map();
  const packLangMap = new Map();
  for (const p of installedPacks) {
    if (p.activeVersion) {
      activeVersionMap.set(p.packId, p.activeVersion);
    }
    if (p.language) {
      packLangMap.set(p.packId, p.language);
    }
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.ENTRIES, "readonly");
    const store = tx.objectStore(DICT_STORES.ENTRIES);
    const index = store.index("lookupKeys");
    const req = index.getAll(IDBKeyRange.only(word));

    req.onsuccess = () => {
      let results = req.result || [];
      // Filter strictly by active pack version
      results = results.filter((r) => {
        const activeVer = activeVersionMap.get(r.packId);
        // If activeVersion is set, only match active version. If not set (legacy), allow.
        return !activeVer || r.version === activeVer;
      });

      if (lang) {
        results = results.filter((r) => (r.language || packLangMap.get(r.packId)) === lang);
      }
      // Prioritize common entries
      results.sort((a, b) => (b.common ? 1 : 0) - (a.common ? 1 : 0));
      resolve(results.slice(0, limit));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * AI Cache Accessors
 */
export async function getAiCache(cacheKey) {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.AI_CACHE, "readonly");
    const store = tx.objectStore(DICT_STORES.AI_CACHE);
    const req = store.get(cacheKey);
    req.onsuccess = () => resolve(req.result?.value || null);
    req.onerror = () => reject(req.error);
  });
}

export async function setAiCache(cacheKey, value) {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.AI_CACHE, "readwrite");
    const store = tx.objectStore(DICT_STORES.AI_CACHE);
    store.put({ cacheKey, value, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAiCacheDb() {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.AI_CACHE, "readwrite");
    const store = tx.objectStore(DICT_STORES.AI_CACHE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Search History Accessors
 */
export async function addHistoryEntry(word, lang) {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.HISTORY, "readwrite");
    const store = tx.objectStore(DICT_STORES.HISTORY);
    store.add({ word, lang, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getHistoryEntries(limit = 50) {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.HISTORY, "readonly");
    const store = tx.objectStore(DICT_STORES.HISTORY);
    const index = store.index("timestamp");
    const req = index.openCursor(null, "prev");
    const items = [];

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && items.length < limit) {
        items.push(cursor.value);
        cursor.continue();
      } else {
        resolve(items);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearHistoryDb() {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.HISTORY, "readwrite");
    const store = tx.objectStore(DICT_STORES.HISTORY);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export {
  clearAiCacheDb as clearAiCache,
  addHistoryEntry as addHistory,
  clearHistoryDb as clearHistory
};
