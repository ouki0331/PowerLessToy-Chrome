/**
 * IndexedDB Layer for Bookmark Organizer
 * Provides atomic transactions, optimistic locking with revisions, snapshots,
 * and seamless fallback for Node.js test runner.
 */

export const DB_NAME = "PowerLessToy_BookmarkOrganizer_DB";
export const DB_VERSION = 2;

export const STORES = {
  CATEGORIES: "categories",
  GROUPS: "groups",
  LINKS: "links",
  IMPORT_JOBS: "importJobs",
  SNAPSHOTS: "snapshots",
  METADATA: "metadata",
  GROUP_METRICS: "groupMetrics"
};

// In-memory simulation of IndexedDB for Node.js test runner when globalThis.indexedDB is absent
class MemoryObjectStore {
  constructor(name, keyPath, indexes = {}) {
    this.name = name;
    this.keyPath = keyPath;
    this.indexes = indexes;
    this.records = new Map();
  }

  get(key) {
    const val = this.records.get(key);
    return val ? JSON.parse(JSON.stringify(val)) : undefined;
  }

  getAll() {
    return Array.from(this.records.values()).map((v) => JSON.parse(JSON.stringify(v)));
  }

  put(value) {
    const key = value[this.keyPath];
    if (!key) throw new Error(`Missing keyPath ${this.keyPath}`);
    this.records.set(key, JSON.parse(JSON.stringify(value)));
    return key;
  }

  add(value) {
    const key = value[this.keyPath];
    if (this.records.has(key)) {
      throw new Error(`Key ${key} already exists in store ${this.name}`);
    }
    return this.put(value);
  }

  delete(key) {
    this.records.delete(key);
  }

  clear() {
    this.records.clear();
  }

  getByIndex(indexName, indexValue) {
    const keyPath = this.indexes[indexName];
    if (!keyPath) throw new Error(`Index ${indexName} does not exist`);
    for (const val of this.records.values()) {
      if (val[keyPath] === indexValue) {
        return JSON.parse(JSON.stringify(val));
      }
    }
    return undefined;
  }

  getAllByIndex(indexName, indexValue) {
    const keyPath = this.indexes[indexName];
    if (!keyPath) throw new Error(`Index ${indexName} does not exist`);
    const results = [];
    for (const val of this.records.values()) {
      if (val[keyPath] === indexValue) {
        results.push(JSON.parse(JSON.stringify(val)));
      }
    }
    return results;
  }

  clone() {
    const copy = new MemoryObjectStore(this.name, this.keyPath, this.indexes);
    for (const [k, v] of this.records.entries()) {
      copy.records.set(k, JSON.parse(JSON.stringify(v)));
    }
    return copy;
  }
}

class MemoryDatabase {
  constructor(name) {
    this.name = name;
    this.stores = new Map([
      [STORES.CATEGORIES, new MemoryObjectStore(STORES.CATEGORIES, "id")],
      [STORES.GROUPS, new MemoryObjectStore(STORES.GROUPS, "id", { categoryId: "categoryId" })],
      [STORES.LINKS, new MemoryObjectStore(STORES.LINKS, "id", { groupId: "groupId" })],
      [STORES.IMPORT_JOBS, new MemoryObjectStore(STORES.IMPORT_JOBS, "id", { importedAt: "importedAt" })],
      [STORES.SNAPSHOTS, new MemoryObjectStore(STORES.SNAPSHOTS, "id", { createdAt: "createdAt" })],
      [STORES.METADATA, new MemoryObjectStore(STORES.METADATA, "key")],
      [STORES.GROUP_METRICS, new MemoryObjectStore(STORES.GROUP_METRICS, "groupId")]
    ]);
    this.transactionQueue = Promise.resolve();
  }

  runTransaction(storeNames, mode, callback) {
    const execute = async () => {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      const snapshots = new Map();
      for (const name of names) {
        const store = this.stores.get(name);
        if (!store) throw new Error(`Store ${name} not found`);
        snapshots.set(name, store.clone());
      }

      try {
        const transactionStores = {};
        for (const name of names) {
          transactionStores[name] = this.stores.get(name);
        }
        const result = await callback(transactionStores);
        return result;
      } catch (err) {
        // Rollback on abort or error
        for (const [name, snap] of snapshots.entries()) {
          this.stores.set(name, snap);
        }
        throw err;
      }
    };

    // Chain to serial queue mimicking IndexedDB transactional mutual exclusion
    const nextPromise = this.transactionQueue.then(execute, execute);
    this.transactionQueue = nextPromise.catch(() => {});
    return nextPromise;
  }

  clearAll() {
    for (const store of this.stores.values()) {
      store.clear();
    }
    this.transactionQueue = Promise.resolve();
  }
}

let memoryDbInstance = null;

function getMemoryDb() {
  if (!memoryDbInstance) {
    memoryDbInstance = new MemoryDatabase(DB_NAME);
  }
  return memoryDbInstance;
}

/**
 * Open native IndexedDB in browser
 */
function openBrowserDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(STORES.CATEGORIES)) {
        db.createObjectStore(STORES.CATEGORIES, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.GROUPS)) {
        const groupStore = db.createObjectStore(STORES.GROUPS, { keyPath: "id" });
        groupStore.createIndex("categoryId", "categoryId", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.LINKS)) {
        const linkStore = db.createObjectStore(STORES.LINKS, { keyPath: "id" });
        linkStore.createIndex("groupId", "groupId", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.IMPORT_JOBS)) {
        const jobStore = db.createObjectStore(STORES.IMPORT_JOBS, { keyPath: "id" });
        jobStore.createIndex("importedAt", "importedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.SNAPSHOTS)) {
        const snapStore = db.createObjectStore(STORES.SNAPSHOTS, { keyPath: "id" });
        snapStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.METADATA)) {
        db.createObjectStore(STORES.METADATA, { keyPath: "key" });
      }

      if (!db.objectStoreNames.contains(STORES.GROUP_METRICS)) {
        db.createObjectStore(STORES.GROUP_METRICS, { keyPath: "groupId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Cross-tab change notification.
 *
 * IndexedDB writes do NOT fire `chrome.storage.onChanged` or `window.storage`
 * events, so every committed readwrite transaction is announced on a
 * BroadcastChannel. Each module instance (i.e. each tab) tags its messages with
 * a random source ID so a tab can ignore its own announcements.
 */
export const DATA_CHANGE_CHANNEL = "powerless_toy_bookmark_organizer_db_v1";
const INSTANCE_SOURCE_ID = `src_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
let publishChannel = null;

function createChannel() {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(DATA_CHANGE_CHANNEL);
  // Node.js: do not keep the test runner alive because of an idle channel
  if (typeof channel.unref === "function") channel.unref();
  return channel;
}

export function notifyDataChanged(storeNames = []) {
  try {
    if (!publishChannel) publishChannel = createChannel();
    publishChannel?.postMessage({
      type: "db-changed",
      sourceId: INSTANCE_SOURCE_ID,
      stores: storeNames,
      at: Date.now()
    });
  } catch {
    // Notification is best-effort; data has already been committed safely.
  }
}

/**
 * Subscribe to data changes committed by OTHER tabs.
 * Returns an unsubscribe function.
 */
export function subscribeDataChanges(callback) {
  const channel = createChannel();
  if (!channel) return () => {};
  channel.onmessage = (event) => {
    const msg = event?.data;
    if (!msg || msg.type !== "db-changed") return;
    if (msg.sourceId === INSTANCE_SOURCE_ID) return;
    callback(msg);
  };
  return () => channel.close();
}

/**
 * Universal transaction runner that works seamlessly in Browser and Node
 */
export async function withTransaction(storeNames, mode, callback) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];

  if (typeof indexedDB === "undefined") {
    const result = await getMemoryDb().runTransaction(names, mode, callback);
    if (mode === "readwrite") notifyDataChanged(names);
    return result;
  }

  const db = await openBrowserDatabase();
  try {
    const tx = db.transaction(names, mode);

    // Attach completion handlers BEFORE issuing any request so the
    // complete/abort event can never be missed.
    const completion = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction error"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    });
    // Prevent an unhandled rejection when we abort deliberately below
    completion.catch(() => {});

    const wrap = (req) =>
      new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

    const stores = {};
    for (const name of names) {
      const s = tx.objectStore(name);
      stores[name] = {
        get: (key) => wrap(s.get(key)),
        getAll: () => wrap(s.getAll()),
        put: (value) => wrap(s.put(value)),
        add: (value) => wrap(s.add(value)),
        delete: (key) => wrap(s.delete(key)).then(() => undefined),
        clear: () => wrap(s.clear()).then(() => undefined),
        getAllByIndex: (indexName, value) => wrap(s.index(indexName).getAll(value))
      };
    }

    let result;
    try {
      result = await callback(stores);
    } catch (err) {
      try {
        tx.abort();
      } catch {
        // Ignored if already completed or aborted
      }
      throw err;
    }

    await completion;
    if (mode === "readwrite") notifyDataChanged(names);
    return result;
  } finally {
    db.close();
  }
}

/**
 * Optimistic Concurrency Check Helper:
 * Compares latest.revision with expectedRevision.
 * Returns error if mismatched.
 */
export function verifyRevision(latest, expectedRevision, entityName, id) {
  if (!latest) {
    const err = new Error(`${entityName} ${id} not found in database`);
    err.code = "NOT_FOUND";
    throw err;
  }

  if (typeof expectedRevision === "number") {
    const currentRev = latest.revision || 1;
    if (currentRev !== expectedRevision) {
      const err = new Error(
        `Revision conflict on ${entityName} (${id}): expected revision ${expectedRevision}, but found ${currentRev}. Data has been modified in another session.`
      );
      err.code = "CONFLICT";
      err.entityName = entityName;
      err.id = id;
      err.expectedRevision = expectedRevision;
      err.currentRevision = currentRev;
      throw err;
    }
  }
}

/**
 * Reset in-memory database (used by unit tests)
 */
export function _resetDatabaseForTesting() {
  if (memoryDbInstance) {
    memoryDbInstance.clearAll();
  }
}
