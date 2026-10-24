/**
 * Keyless Background Image Gallery & Controls for Bookmark Organizer
 *
 * Provider: Wikimedia Commons (MediaWiki Action API)
 * - Zero API keys, zero 3rd-party aggregators
 * - Completely anonymous CORS requests (origin=*)
 * - Default OFF: zero network requests until user explicitly enables background
 * - 10 Categories: Nature, Architecture, Space, Animals, Travel / Places,
 *   Art, Minimal / Texture, Anime & Illustration, My Favorites, Local Images
 * - Frequency: Manual, Every new tab, Daily (default), Weekly
 * - Image lock & category lock
 * - Local image storage in segregated IndexedDB (PowerLessToy_Background_DB)
 * - Zero mutation or leakage into bookmark databases, JSON backups, or undo snapshots
 */

import {
  BG_CONFIG_KEY,
  BG_CURRENT_KEY,
  BG_FAVORITES_KEY,
  BG_CACHE_KEY,
  BG_DB_NAME,
  BG_LOCAL_STORE
} from "./constants.js";

export const DEFAULT_BG_CONFIG = {
  enabled: false,
  sourceMode: "random", // "random" | "my_images"
  lastLocalImageId: null,
  opacity: 35,
  frequency: "daily", // 'manual' | 'tab' | 'daily' | 'weekly'
  categories: ["nature"],
  isCategoryLocked: true,
  isImageLocked: false,
  order: "featured" // 'featured' | 'random' | 'newest' | 'favorites_first'
};

export const COMMONS_CATEGORIES = {
  nature: {
    id: "nature",
    title: "Category:Featured_pictures_of_landscapes",
    fallbackTitle: "Category:Featured_pictures_of_nature"
  },
  architecture: {
    id: "architecture",
    title: "Category:Featured_pictures_of_architecture",
    fallbackTitle: "Category:Featured_pictures_of_castles"
  },
  space: {
    id: "space",
    title: "Category:Featured_pictures_of_astronomy",
    fallbackTitle: "Category:Featured_pictures_of_space"
  },
  animals: {
    id: "animals",
    title: "Category:Featured_pictures_of_animals",
    fallbackTitle: "Category:Featured_pictures_of_birds"
  },
  travel: {
    id: "travel",
    title: "Category:Featured_pictures_of_places",
    fallbackTitle: "Category:Quality_images_of_landscapes_by_country"
  },
  art: {
    id: "art",
    title: "Category:Featured_pictures_of_artworks",
    fallbackTitle: "Category:Featured_pictures_of_paintings"
  },
  minimal: {
    id: "minimal",
    title: "Category:Textures",
    fallbackTitle: "Category:Minimalism"
  },
  anime: {
    id: "anime",
    title: "Category:Anime-style_art",
    fallbackTitle: "Category:Manga_and_anime-related_art"
  },
  favorites: {
    id: "favorites",
    isVirtual: true
  },
  local: {
    id: "local",
    isVirtual: true
  }
};

/**
 * Curated built-in fallback images from Wikimedia Commons with complete
 * Creative Commons and Public Domain credits.
 * These remote Wikimedia URLs serve as reliable built-in fallback seeds when
 * the user enables background but is offline or the Commons MediaWiki API is unreachable.
 */
export const BUILTIN_FALLBACK_IMAGES = [
  {
    id: "File:Moraine_Lake_17092005.jpg",
    title: "Moraine Lake, Banff National Park",
    artist: "Gorgo",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Moraine_Lake_17092005.jpg/1920px-Moraine_Lake_17092005.jpg",
    originalUrl: "https://upload.wikimedia.org/wikipedia/commons/c/c5/Moraine_Lake_17092005.jpg",
    commonsUrl: "https://commons.wikimedia.org/wiki/File:Moraine_Lake_17092005.jpg",
    license: "Public Domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    category: "nature"
  },
  {
    id: "File:Mount_Fuji_from_Lake_Shoji.jpg",
    title: "Mount Fuji from Lake Shoji",
    artist: "Alpsdake",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Mount_Fuji_from_Lake_Shoji.jpg/1920px-Mount_Fuji_from_Lake_Shoji.jpg",
    originalUrl: "https://upload.wikimedia.org/wikipedia/commons/1/1b/Mount_Fuji_from_Lake_Shoji.jpg",
    commonsUrl: "https://commons.wikimedia.org/wiki/File:Mount_Fuji_from_Lake_Shoji.jpg",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    category: "nature"
  },
  {
    id: "File:Neuschwanstein_Castle_LOC_print.jpg",
    title: "Neuschwanstein Castle",
    artist: "Photochrom Print Collection",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f8/Neuschwanstein_Castle_LOC_print.jpg/1920px-Neuschwanstein_Castle_LOC_print.jpg",
    originalUrl: "https://upload.wikimedia.org/wikipedia/commons/f/f8/Neuschwanstein_Castle_LOC_print.jpg",
    commonsUrl: "https://commons.wikimedia.org/wiki/File:Neuschwanstein_Castle_LOC_print.jpg",
    license: "Public Domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    category: "architecture"
  },
  {
    id: "File:Hubble_Ultra_Deep_Field_part_d.jpg",
    title: "Hubble Ultra Deep Field",
    artist: "NASA, ESA, S. Beckwith (STScI) and the HUDF Team",
    thumbUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Hubble_ultra_deep_field_high_rez_edit1.jpg/1920px-Hubble_ultra_deep_field_high_rez_edit1.jpg",
    originalUrl: "https://upload.wikimedia.org/wikipedia/commons/0/0d/Hubble_ultra_deep_field_high_rez_edit1.jpg",
    commonsUrl: "https://commons.wikimedia.org/wiki/File:Hubble_ultra_deep_field_high_rez_edit1.jpg",
    license: "Public Domain",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    category: "space"
  }
];

// Backward-compatible alias for existing tests
export const OFFLINE_SEED_IMAGES = BUILTIN_FALLBACK_IMAGES;

// In-memory cache for test/active tab speed
let memoryStorage = {};

/**
 * Universal isolated storage getter (chrome.storage.local with localStorage fallback)
 */
async function storageGet(key, defaultValue) {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.get) {
      const res = await chrome.storage.local.get([key]);
      if (res && res[key] !== undefined) {
        return res[key];
      }
    }
  } catch {
    // Ignore and fallback
  }

  try {
    if (typeof localStorage !== "undefined") {
      const item = localStorage.getItem(key);
      if (item !== null) {
        return JSON.parse(item);
      }
    }
  } catch {
    // Ignore and fallback
  }

  return memoryStorage[key] !== undefined ? memoryStorage[key] : defaultValue;
}

/**
 * Universal isolated storage setter
 */
async function storageSet(key, value) {
  memoryStorage[key] = value;

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local?.set) {
      await chrome.storage.local.set({ [key]: value });
    }
  } catch {
    // Ignore and fallback
  }

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Ignore fallback
  }
}

/**
 * Reads background configuration
 */
export async function getBgConfig() {
  const config = await storageGet(BG_CONFIG_KEY, null);
  if (!config || typeof config !== "object") {
    return { ...DEFAULT_BG_CONFIG };
  }
  return { ...DEFAULT_BG_CONFIG, ...config };
}

/**
 * Saves background configuration
 */
export async function saveBgConfig(updates) {
  const current = await getBgConfig();
  const next = { ...current, ...updates };
  await storageSet(BG_CONFIG_KEY, next);
  return next;
}

/**
 * Reads current active background record
/**
 * Generates local date key formatted as YYYY-MM-DD using user's system clock.
 * Avoids UTC date mismatch bugs caused by toISOString().
 */
export function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

let activeBlobUrl = null;

export function getActiveBlobUrl() {
  return activeBlobUrl;
}

export function revokeActiveBlobUrl() {
  if (activeBlobUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(activeBlobUrl);
    activeBlobUrl = null;
  }
}

/**
 * Resolves the actual image URL to display.
 * For local images, loads Blob from IndexedDB and creates a document-scoped Object URL.
 * Automatically revokes previously created Object URL to prevent memory leaks.
 */
export async function resolveImageDisplayUrl(imageRecord) {
  if (!imageRecord) return "";

  if (imageRecord.isLocal) {
    const blob = await getLocalImageBlob(imageRecord.id);
    if (!blob) return "";
    revokeActiveBlobUrl();
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      activeBlobUrl = URL.createObjectURL(blob);
      return activeBlobUrl;
    }
    return "";
  }

  return imageRecord.thumbUrl || imageRecord.originalUrl || "";
}

/**
 * Reads current active background record
 */
export async function getBgCurrent() {
  return await storageGet(BG_CURRENT_KEY, null);
}

/**
 * Saves current active background record.
 * Never persists blob: URLs to storage.
 */
export async function saveBgCurrent(imageRecord) {
  if (!imageRecord) {
    await storageSet(BG_CURRENT_KEY, null);
    return null;
  }
  const toSave = { ...imageRecord };
  if (toSave.isLocal || toSave.category === "local" || (typeof toSave.url === "string" && toSave.url.startsWith("blob:"))) {
    delete toSave.url;
    delete toSave.thumbUrl;
    delete toSave.originalUrl;
    if (toSave.category === "local" || toSave.isLocal) {
      toSave.isLocal = true;
    }
  }
  if (typeof toSave.thumbUrl === "string" && toSave.thumbUrl.startsWith("blob:")) {
    delete toSave.thumbUrl;
  }
  if (typeof toSave.originalUrl === "string" && toSave.originalUrl.startsWith("blob:")) {
    delete toSave.originalUrl;
  }
  await storageSet(BG_CURRENT_KEY, toSave);
  return toSave;
}

/**
 * Reads user's favorited images
 */
export async function getBgFavorites() {
  const favs = await storageGet(BG_FAVORITES_KEY, []);
  return Array.isArray(favs) ? favs : [];
}

/**
 * Saves user's favorited images
 */
export async function saveBgFavorites(favs) {
  const valid = Array.isArray(favs) ? favs : [];
  await storageSet(BG_FAVORITES_KEY, valid);
  return valid;
}

/**
 * Checks if an image is currently favorited
 */
export async function isFavorite(idOrUrl) {
  if (!idOrUrl) return false;
  const favs = await getBgFavorites();
  return favs.some((f) => f.id === idOrUrl || (f.originalUrl && f.originalUrl === idOrUrl) || (f.thumbUrl && f.thumbUrl === idOrUrl));
}

/**
 * Adds an image to favorites (deduplicating by ID or URL)
 * Never persists blob: URLs for local images.
 */
export async function addFavorite(image) {
  if (!image || (!image.id && !image.originalUrl)) return false;
  const favs = await getBgFavorites();
  const exists = favs.some((f) => f.id === image.id || (f.originalUrl && f.originalUrl === image.originalUrl));
  if (exists) return true;

  const isLocal = Boolean(image.isLocal || image.category === "local");
  const entry = {
    id: image.id || `fav_${Date.now()}`,
    title: image.title || image.name || "Untitled",
    artist: isLocal ? "Local User Upload" : (image.artist || "Unknown"),
    thumbUrl: isLocal ? "" : (image.thumbUrl || image.originalUrl || ""),
    originalUrl: isLocal ? "" : (image.originalUrl || image.thumbUrl || ""),
    commonsUrl: image.commonsUrl || "",
    license: isLocal ? "Local Private Image" : (image.license || "Attribution / License"),
    licenseUrl: image.licenseUrl || "",
    category: isLocal ? "local" : (image.category || "nature"),
    isLocal,
    addedAt: Date.now()
  };

  favs.unshift(entry);
  await saveBgFavorites(favs);
  return true;
}

/**
 * Removes an image from favorites
 */
export async function removeFavorite(idOrUrl) {
  if (!idOrUrl) return false;
  const favs = await getBgFavorites();
  const filtered = favs.filter(
    (f) => f.id !== idOrUrl && f.originalUrl !== idOrUrl && f.thumbUrl !== idOrUrl
  );
  await saveBgFavorites(filtered);
  return true;
}

/**
 * Toggles favorite state of an image
 */
export async function toggleFavorite(image) {
  if (!image) return false;
  const idOrUrl = image.id || image.originalUrl;
  const favorited = await isFavorite(idOrUrl);
  if (favorited) {
    await removeFavorite(idOrUrl);
    return false;
  } else {
    await addFavorite(image);
    return true;
  }
}

/**
 * Reads Commons category cache
 */
export async function getBgCache() {
  const cache = await storageGet(BG_CACHE_KEY, {});
  return cache && typeof cache === "object" ? cache : {};
}

/**
 * Saves Commons category cache
 */
export async function saveBgCache(cache) {
  await storageSet(BG_CACHE_KEY, cache);
}

/**
 * Clears in-memory storage (for testing)
 */
export function resetMemoryStorage() {
  memoryStorage = {};
}

/* ==========================================================================
   Segregated IndexedDB for Local Images (PowerLessToy_Background_DB)
   ========================================================================== */

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB per image
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total quota

/**
 * Opens or initializes the isolated background images IndexedDB
 */
export function openLocalImagesDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const request = indexedDB.open(BG_DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(BG_LOCAL_STORE)) {
        db.createObjectStore(BG_LOCAL_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Stores a local image Blob in the isolated IndexedDB
 */
export async function saveLocalImage(file) {
  if (!file) throw new Error("No file provided");
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("File exceeds 10MB limit.");
  }

  const currentTotal = await getLocalImagesTotalSize();
  if (currentTotal + file.size > MAX_TOTAL_SIZE) {
    throw new Error("Total images exceed 50MB quota.");
  }

  const db = await openLocalImagesDb();
  if (!db) throw new Error("IndexedDB not available");

  const id = `local_img_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const record = {
    id,
    name: file.name || "Untitled",
    size: file.size,
    type: file.type || "image/jpeg",
    blob: file,
    createdAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction([BG_LOCAL_STORE], "readwrite");
    const store = tx.objectStore(BG_LOCAL_STORE);
    const req = store.add(record);
    req.onsuccess = () => {
      resolve({
        id: record.id,
        name: record.name,
        size: record.size,
        type: record.type,
        createdAt: record.createdAt
      });
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

/**
 * Lists metadata of stored local images (without pulling blobs into memory)
 */
export async function getLocalImagesList() {
  const db = await openLocalImagesDb();
  if (!db) return [];

  return new Promise((resolve, reject) => {
    const tx = db.transaction([BG_LOCAL_STORE], "readonly");
    const store = tx.objectStore(BG_LOCAL_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const list = (req.result || []).map((r) => ({
        id: r.id,
        name: r.name,
        size: r.size,
        type: r.type,
        createdAt: r.createdAt
      }));
      resolve(list);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

/**
 * Retrieves a single local image Blob by ID
 */
export async function getLocalImageBlob(id) {
  const db = await openLocalImagesDb();
  if (!db) return null;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([BG_LOCAL_STORE], "readonly");
    const store = tx.objectStore(BG_LOCAL_STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

/**
 * Deletes a local image by ID
 */
export async function deleteLocalImage(id) {
  const db = await openLocalImagesDb();
  if (!db) return false;

  return new Promise((resolve, reject) => {
    const tx = db.transaction([BG_LOCAL_STORE], "readwrite");
    const store = tx.objectStore(BG_LOCAL_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
  });
}

/**
 * Calculates total size of all stored local images
 */
export async function getLocalImagesTotalSize() {
  const list = await getLocalImagesList();
  return list.reduce((sum, item) => sum + (item.size || 0), 0);
}

/* ==========================================================================
   Wikimedia Commons MediaWiki API Client
   ========================================================================== */

/**
 * Sanitizes HTML tags from Wikimedia extmetadata strings
 */
function sanitizeMetaString(htmlStr) {
  if (!htmlStr) return "";
  return String(htmlStr)
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Clean readable title from Commons File: name
 */
function cleanImageTitle(rawTitle) {
  if (!rawTitle) return "Wikimedia Commons Image";
  return rawTitle
    .replace(/^File:/i, "")
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(/_/g, " ")
    .trim();
}

/**
 * Queries Wikimedia Commons for images in a category with anonymous CORS
 */
export async function fetchCommonsCategoryImages(categoryId, { fetchFn = fetch } = {}) {
  const categoryDef = COMMONS_CATEGORIES[categoryId];
  if (!categoryDef || categoryDef.isVirtual) {
    return [];
  }

  // 1. Check cached pool (TTL 12 hours)
  const cache = await getBgCache();
  const cachedEntry = cache[categoryId];
  const now = Date.now();
  if (cachedEntry && Array.isArray(cachedEntry.images) && cachedEntry.images.length > 0) {
    if (now - (cachedEntry.cachedAt || 0) < 12 * 60 * 60 * 1000) {
      return cachedEntry.images;
    }
  }

  // 2. Query MediaWiki Action API
  const queryTitle = categoryDef.title;
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.search = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "categorymembers",
    gcmtitle: queryTitle,
    gcmtype: "file",
    gcmlimit: "40",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime",
    iiurlwidth: "1920"
  }).toString();

  try {
    const res = await fetchFn(endpoint.toString());
    if (!res.ok) {
      throw new Error(`Wikimedia API responded with HTTP ${res.status}`);
    }
    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) {
      // Fallback to cached images if available, else empty
      return cachedEntry?.images || [];
    }

    const validImages = [];
    for (const pageId of Object.keys(pages)) {
      const page = pages[pageId];
      const info = page.imageinfo?.[0];
      if (!info) continue;

      // Filter: bitmap images only
      const mime = (info.mime || "").toLowerCase();
      if (!mime.startsWith("image/jpeg") && !mime.startsWith("image/png") && !mime.startsWith("image/webp")) {
        continue;
      }

      // Filter: resolution and landscape aspect ratio
      const w = info.width || 0;
      const h = info.height || 0;
      if (w < 1200 || h < 700) continue;
      const aspect = w / h;
      if (aspect < 1.15 || aspect > 3.2) continue; // Must be landscape orientation

      const ext = info.extmetadata || {};
      const artist = sanitizeMetaString(ext.Artist?.value) || sanitizeMetaString(ext.Credit?.value) || "Wikimedia Contributor";
      const license = ext.LicenseShortName?.value || ext.License?.value || "Creative Commons / Public Domain";
      const licenseUrl = ext.LicenseUrl?.value || "";
      const rawTitle = page.title || "File:Image.jpg";

      validImages.push({
        id: rawTitle,
        title: cleanImageTitle(rawTitle),
        artist,
        thumbUrl: info.thumburl || info.url,
        originalUrl: info.url,
        commonsUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(rawTitle)}`,
        license,
        licenseUrl,
        category: categoryId
      });
    }

    if (validImages.length > 0) {
      cache[categoryId] = {
        cachedAt: now,
        images: validImages
      };
      await saveBgCache(cache);
      return validImages;
    }
  } catch (err) {
    console.warn(`[Bookmark Organizer] Commons fetch for "${categoryId}" failed:`, err.message);
  }

  // Fallback to existing cached pool if available
  if (cachedEntry?.images?.length) {
    return cachedEntry.images;
  }

  // Offline fallback seeds for landscape/architecture/space
  return OFFLINE_SEED_IMAGES.filter((img) => img.category === categoryId || categoryId === "nature");
}

/**
 * Checks whether the background should switch based on frequency and lock state
 */
export function shouldSwitchImage(config, currentImage) {
  if (!config.enabled) return false;
  if (config.isImageLocked) return false;
  if (!currentImage) return true;

  // Source mode mismatch requires switching
  if (config.sourceMode === "random" && currentImage.isLocal) return true;
  if (config.sourceMode === "my_images" && !currentImage.isLocal) return true;

  if (config.frequency === "manual") {
    return false;
  }

  if (config.frequency === "tab") {
    return true;
  }

  const now = Date.now();
  const todayStr = getLocalDateKey(new Date(now));

  if (config.frequency === "daily") {
    return currentImage.dateKey !== todayStr;
  }

  if (config.frequency === "weekly") {
    const elapsed = now - (currentImage.updatedAt || 0);
    return elapsed >= 7 * 24 * 60 * 60 * 1000;
  }

  return false;
}

/**
 * Selects and sets the next background image
 */
export async function getNextImage({ force = false, fetchFn = fetch } = {}) {
  const config = await getBgConfig();
  if (!config.enabled) {
    return null; // Zero network, zero changes when disabled
  }

  const current = await getBgCurrent();

  // 1. My Images Mode
  if (config.sourceMode === "my_images") {
    const localList = await getLocalImagesList();
    if (localList.length === 0) {
      // Local images emptied out, auto fallback to random
      config.sourceMode = "random";
      config.lastLocalImageId = null;
      await saveBgConfig(config);
      const fallbackRecord = await getNextImage({ force: true, fetchFn });
      return {
        ...fallbackRecord,
        fallbackFromLocal: true
      };
    }

    if (!force && !shouldSwitchImage(config, current) && current?.isLocal && localList.some((img) => img.id === current.id)) {
      return current;
    }

    let chosen = null;
    if (force && current?.id && localList.length > 1) {
      const curIdx = localList.findIndex((img) => img.id === current.id);
      const nextIdx = curIdx >= 0 ? (curIdx + 1) % localList.length : 0;
      chosen = localList[nextIdx];
    } else if (config.lastLocalImageId) {
      chosen = localList.find((img) => img.id === config.lastLocalImageId);
    }

    if (!chosen) {
      chosen = localList[0];
    }

    if (config.lastLocalImageId !== chosen.id) {
      config.lastLocalImageId = chosen.id;
      await saveBgConfig(config);
    }

    const todayStr = getLocalDateKey(new Date());
    const nextRecord = {
      id: chosen.id,
      title: chosen.name || "Local Image",
      artist: "Local User Upload",
      thumbUrl: "",
      originalUrl: "",
      commonsUrl: "",
      license: "Local Private Image",
      licenseUrl: "",
      category: "local",
      isLocal: true,
      createdAt: chosen.createdAt || 0,
      updatedAt: Date.now(),
      dateKey: todayStr
    };

    await saveBgCurrent(nextRecord);
    return nextRecord;
  }

  // 2. Random Mode (never overwrites config.lastLocalImageId)
  if (!force && !shouldSwitchImage(config, current)) {
    return current;
  }

  const orderMode = config.order || "featured";

  // Determine active category pool
  let targetCategory = "nature";
  const favsList = await getBgFavorites();

  if (orderMode === "favorites_first" && favsList.length > 0) {
    targetCategory = "favorites";
  } else if (Array.isArray(config.categories) && config.categories.length > 0) {
    if (config.isCategoryLocked) {
      targetCategory = config.categories[0];
    } else {
      const idx = Math.floor(Math.random() * config.categories.length);
      targetCategory = config.categories[idx];
    }
  }

  let candidates = [];

  // Special Category: Favorites
  if (targetCategory === "favorites") {
    const favs = favsList;
    if (favs.length === 0) {
      return { isEmptyFavorites: true, category: "favorites" };
    }
    candidates = [...favs];
  } else if (targetCategory === "local") {
    // Special Category: Local Images
    const localList = await getLocalImagesList();
    if (localList.length === 0) {
      return { isEmptyLocal: true, category: "local" };
    }
    candidates = localList.map((item) => ({
      id: item.id,
      title: item.name || "Local Private Image",
      artist: "Local User Upload",
      thumbUrl: "",
      originalUrl: "",
      commonsUrl: "",
      license: "Local Private Image",
      licenseUrl: "",
      category: "local",
      isLocal: true,
      createdAt: item.createdAt || 0
    }));
  } else {
    // Normal Wikimedia Commons Category
    candidates = await fetchCommonsCategoryImages(targetCategory, { fetchFn });
  }

  if (!candidates || candidates.length === 0) {
    // Safe fallback: keep existing if available, or built-in seed
    if (current && !current.isEmptyFavorites && !current.isEmptyLocal) {
      return current;
    }
    candidates = [...BUILTIN_FALLBACK_IMAGES];
  }

  // Apply order sorting
  if (orderMode === "newest") {
    candidates.sort((a, b) => {
      const timeA = a.createdAt || a.addedAt || 0;
      const timeB = b.createdAt || b.addedAt || 0;
      return timeB - timeA;
    });
  }

  let chosen = candidates[0];
  if (orderMode === "random" || candidates.length > 1) {
    if (candidates.length > 1 && current?.id) {
      const others = candidates.filter((c) => c.id !== current.id);
      if (others.length > 0) {
        const idx = Math.floor(Math.random() * others.length);
        chosen = others[idx];
      }
    } else if (candidates.length > 1) {
      chosen = candidates[Math.floor(Math.random() * candidates.length)];
    }
  }

  const todayStr = getLocalDateKey(new Date());
  const nextRecord = {
    ...chosen,
    updatedAt: Date.now(),
    dateKey: todayStr
  };

  await saveBgCurrent(nextRecord);
  return nextRecord;
}

/**
 * Explicitly sets a local image as the active background.
 * Enables background, sets source to 'my_images', sets as lastLocalImageId, and saves.
 */
export async function setLocalImageAsBackground(imageId) {
  const localList = await getLocalImagesList();
  const target = localList.find((item) => item.id === imageId);
  if (!target) return null;

  const config = await getBgConfig();
  config.enabled = true;
  config.sourceMode = "my_images";
  config.lastLocalImageId = target.id;
  await saveBgConfig(config);

  const todayStr = getLocalDateKey(new Date());
  const localRecord = {
    id: target.id,
    title: target.name || "Local Image",
    artist: "Local User Upload",
    thumbUrl: "",
    originalUrl: "",
    commonsUrl: "",
    license: "Local Private Image",
    licenseUrl: "",
    category: "local",
    isLocal: true,
    createdAt: target.createdAt || 0,
    updatedAt: Date.now(),
    dateKey: todayStr
  };
  await saveBgCurrent(localRecord);
  return { config, image: localRecord };
}

/**
 * Deletes a local image and cascades background selection if it was active.
 */
export async function deleteLocalImageAndCascade(id, { fetchFn = fetch } = {}) {
  await deleteLocalImage(id);
  const remainingList = await getLocalImagesList();
  const config = await getBgConfig();
  const current = await getBgCurrent();

  const wasActive = config.sourceMode === "my_images" && (config.lastLocalImageId === id || current?.id === id);

  if (!wasActive) {
    if (config.lastLocalImageId === id) {
      config.lastLocalImageId = remainingList.length > 0 ? remainingList[0].id : null;
      await saveBgConfig(config);
    }
    return { wasActive: false, remainingCount: remainingList.length };
  }

  if (remainingList.length > 0) {
    const nextLocal = remainingList[0];
    const { image } = await setLocalImageAsBackground(nextLocal.id);
    return {
      wasActive: true,
      switchedToNextLocal: true,
      remainingCount: remainingList.length,
      image
    };
  } else {
    config.sourceMode = "random";
    config.lastLocalImageId = null;
    await saveBgConfig(config);
    const nextRand = await getNextImage({ force: true, fetchFn });
    return {
      wasActive: true,
      switchedToRandom: true,
      remainingCount: 0,
      image: nextRand
    };
  }
}

