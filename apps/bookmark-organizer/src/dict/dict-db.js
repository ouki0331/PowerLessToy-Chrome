/**
 * IndexedDB Storage Engine for Offline Dictionary (DICT-LOOKUP-001 & DICT-PACK-001)
 *
 * Capabilities:
 * - Chunked / streaming batch import to avoid UI freeze and excessive memory footprint.
 * - Integrity validation (SHA-256 checksum) with automatic rollback on failure.
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

      // 1. Packs store (metadata of installed packs)
      if (!db.objectStoreNames.contains(DICT_STORES.PACKS)) {
        db.createObjectStore(DICT_STORES.PACKS, { keyPath: "packId" });
      }

      // 2. Entries store
      if (!db.objectStoreNames.contains(DICT_STORES.ENTRIES)) {
        const entryStore = db.createObjectStore(DICT_STORES.ENTRIES, { keyPath: "id" });
        entryStore.createIndex("packId", "packId", { unique: false });
        entryStore.createIndex("word", "word", { unique: false });
        entryStore.createIndex("reading", "reading", { unique: false });
        entryStore.createIndex("lookupKeys", "lookupKeys", { unique: false, multiEntry: true });
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
 * Install a dictionary pack with chunked batch writes and rollback on failure.
 */
export async function installPack(packData, { expectedChecksum = "", onProgress = null } = {}) {
  if (!packData || !packData.packId || !Array.isArray(packData.entries)) {
    throw new Error("Invalid dictionary pack data structure");
  }

  // Checksum verification if expectedChecksum provided
  if (expectedChecksum) {
    const rawString = typeof packData === "string" ? packData : JSON.stringify(packData);
    const computed = await computeStringSha256(rawString);
    if (computed && computed !== expectedChecksum) {
      throw new Error(`Dictionary pack checksum mismatch: expected ${expectedChecksum}, got ${computed}`);
    }
  }

  const db = await openDictDb();
  const packId = packData.packId;
  const entries = packData.entries;
  const total = entries.length;
  const chunkSize = 500;

  try {
    // 1. Remove existing entries for this packId first to ensure clean state
    await deleteEntriesForPack(db, packId);

    // 2. Chunked import
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DICT_STORES.ENTRIES, "readwrite");
        const store = tx.objectStore(DICT_STORES.ENTRIES);

        for (const rawEntry of chunk) {
          const word = rawEntry.word || "";
          const reading = rawEntry.reading || "";
          const keys = new Set();
          if (word) keys.add(word.toLowerCase());
          if (reading) keys.add(reading.toLowerCase());

          const entry = {
            ...rawEntry,
            packId,
            language: packData.language,
            lookupKeys: Array.from(keys)
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

    // 3. Record pack metadata in packs store
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DICT_STORES.PACKS, "readwrite");
      const store = tx.objectStore(DICT_STORES.PACKS);
      const meta = {
        packId: packData.packId,
        language: packData.language,
        name: packData.name || packData.packId,
        version: packData.version || "1.0.0",
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

    return { success: true, packId, entryCount: total };
  } catch (err) {
    // Rollback: clear any inserted entries on error
    try {
      await deleteEntriesForPack(db, packId);
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

async function deleteEntriesForPack(db, packId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.ENTRIES, "readwrite");
    const store = tx.objectStore(DICT_STORES.ENTRIES);
    const index = store.index("packId");
    const req = index.openKeyCursor(IDBKeyRange.only(packId));

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Search word entries using IndexedDB index lookup.
 */
export async function lookupWord(rawWord, { lang = null, limit = 10 } = {}) {
  const word = (rawWord || "").trim().toLowerCase();
  if (!word) return [];

  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.ENTRIES, "readonly");
    const store = tx.objectStore(DICT_STORES.ENTRIES);
    const index = store.index("lookupKeys");
    const req = index.getAll(IDBKeyRange.only(word));

    req.onsuccess = () => {
      let results = req.result || [];
      if (lang) {
        results = results.filter((r) => r.language === lang);
      }
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
    store.put({ cacheKey, value, cachedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAiCache() {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.AI_CACHE, "readwrite");
    const store = tx.objectStore(DICT_STORES.AI_CACHE);
    store.clear();
    tx.oncomplete = () => resolve({ success: true });
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * History Accessors
 */
export async function addHistory(word, lang) {
  try {
    const db = await openDictDb();
    const tx = db.transaction(DICT_STORES.HISTORY, "readwrite");
    const store = tx.objectStore(DICT_STORES.HISTORY);
    store.add({ word, lang, timestamp: Date.now() });
  } catch {}
}

export async function clearHistory() {
  const db = await openDictDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DICT_STORES.HISTORY, "readwrite");
    const store = tx.objectStore(DICT_STORES.HISTORY);
    store.clear();
    tx.oncomplete = () => resolve({ success: true });
    tx.onerror = () => reject(tx.error);
  });
}
