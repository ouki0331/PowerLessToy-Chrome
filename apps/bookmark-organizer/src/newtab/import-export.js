/**
 * Import & Export Engine for Bookmark Organizer
 * Implements:
 * - Deterministic SHA-256 file hashing
 * - Schema validation for formatVersion: 1
 * - Duplicate & conflict detection with non-destructive preview
 * - Atomic transactional import with automated pre-import snapshot
 * - Full Undo Import capability via importJob tracking
 * - Full JSON backup export matching the import schema
 */

import { withTransaction, STORES } from "./db.js";
import { isValidUrl } from "./storage.js";

/**
 * Cross-environment SHA-256 calculation (Browser SubtleCrypto or Node crypto)
 */
export async function computeFileHash(text) {
  if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Node.js fallback
  try {
    const nodeCrypto = await import("node:crypto");
    return nodeCrypto.createHash("sha256").update(text).digest("hex");
  } catch {
    // Basic fallback hash if crypto unavailable
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return `simple_${Math.abs(hash)}`;
  }
}

/**
 * Normalization utilities for comparison (preserves original display strings)
 */
export function normalizeCategoryName(name) {
  return (name || "").trim().toLowerCase();
}

export function normalizeGroupName(name) {
  return (name || "").trim().toLowerCase();
}

export function normalizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * Validate incoming JSON structure and format version
 */
export function validateImportJson(rawJson) {
  const errors = [];
  const warnings = [];

  if (typeof rawJson !== "object" || rawJson === null || Array.isArray(rawJson)) {
    return {
      valid: false,
      errors: ["Import file must be a JSON object"],
      warnings
    };
  }

  const formatVersion = rawJson.formatVersion;
  if (formatVersion !== 1) {
    errors.push(`Unsupported formatVersion: ${formatVersion}. Only formatVersion: 1 is supported.`);
  }

  if (!Array.isArray(rawJson.categories)) {
    errors.push("Missing 'categories' array in import file");
  }

  const categories = Array.isArray(rawJson.categories) ? rawJson.categories : [];
  const groups = Array.isArray(rawJson.groups) ? rawJson.groups : [];
  const links = Array.isArray(rawJson.links) ? rawJson.links : [];

  // Validate categories
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    if (!cat || typeof cat !== "object") {
      errors.push(`Category at index ${i} is not a valid object`);
      continue;
    }
    if (!cat.name || typeof cat.name !== "string" || !cat.name.trim()) {
      errors.push(`Category at index ${i} is missing required 'name'`);
    }
  }

  // Validate groups
  for (let i = 0; i < groups.length; i++) {
    const grp = groups[i];
    if (!grp || typeof grp !== "object") {
      errors.push(`Group at index ${i} is not a valid object`);
      continue;
    }
    if (!grp.name || typeof grp.name !== "string" || !grp.name.trim()) {
      errors.push(`Group at index ${i} is missing required 'name'`);
    }
  }

  // Validate links
  for (let i = 0; i < links.length; i++) {
    const lnk = links[i];
    if (!lnk || typeof lnk !== "object") {
      errors.push(`Link at index ${i} is not a valid object`);
      continue;
    }
    if (!lnk.name || typeof lnk.name !== "string" || !lnk.name.trim()) {
      errors.push(`Link at index ${i} is missing required 'name'`);
    }
    if (!lnk.url || typeof lnk.url !== "string" || !isValidUrl(lnk.url)) {
      errors.push(`Link at index ${i} ('${lnk.name || "unnamed"}') has invalid URL: '${lnk.url}'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Generate preview of import without modifying any database records.
 * Analyzes additions, merges, skips, and conflicts.
 */
export async function generateImportPreview({
  fileContent,
  fileName = "bookmarks.json",
  existingCategories,
  existingGroups,
  existingLinks,
  existingImportJobs = []
}) {
  let parsed;
  try {
    parsed = typeof fileContent === "string" ? JSON.parse(fileContent) : fileContent;
  } catch (err) {
    return {
      valid: false,
      errors: [`JSON parse error: ${err.message}`],
      warnings: []
    };
  }

  const validation = validateImportJson(parsed);
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors,
      warnings: validation.warnings
    };
  }

  const fileString = typeof fileContent === "string" ? fileContent : JSON.stringify(fileContent);
  const fileHash = await computeFileHash(fileString);

  // Check if identical file was previously imported
  const alreadyImportedJob = existingImportJobs.find(
    (job) => job.sourceFileHash === fileHash && job.status === "completed"
  );

  const incomingCategories = parsed.categories || [];
  const incomingGroups = parsed.groups || [];
  const incomingLinks = parsed.links || [];

  // Maps for normalized matching
  const existingCatMap = new Map();
  for (const cat of existingCategories) {
    existingCatMap.set(normalizeCategoryName(cat.name), cat);
  }

  // Existing groups by catId + normalized name
  const existingGroupMap = new Map();
  for (const grp of existingGroups) {
    const key = `${grp.categoryId}:::${normalizeGroupName(grp.name)}`;
    existingGroupMap.set(key, grp);
  }

  // Existing links by groupId + normalized URL
  const existingLinkMap = new Map();
  for (const lnk of existingLinks) {
    const key = `${lnk.groupId}:::${normalizeUrl(lnk.url)}`;
    existingLinkMap.set(key, lnk);
  }

  const preview = {
    valid: true,
    fileName,
    fileHash,
    formatVersion: parsed.formatVersion,
    alreadyImported: Boolean(alreadyImportedJob),
    lastImportedAt: alreadyImportedJob?.importedAt || null,
    totalCategories: incomingCategories.length,
    totalGroups: incomingGroups.length,
    totalLinks: incomingLinks.length,
    willAdd: {
      categories: 0,
      groups: 0,
      links: 0
    },
    willMerge: {
      categories: 0,
      groups: 0
    },
    willSkipCount: 0,
    conflictCount: 0,
    conflicts: [],
    errors: [],
    warnings: validation.warnings
  };

  if (preview.alreadyImported) {
    preview.warnings.push(
      `Warning: This exact file was previously imported on ${new Date(alreadyImportedJob.importedAt).toLocaleString()}.`
    );
  }

  // Category matching simulation
  const simulatedCatMap = new Map(); // incomingCatId -> matchedOrNewCatId
  for (const inCat of incomingCategories) {
    const normName = normalizeCategoryName(inCat.name);
    const existing = existingCatMap.get(normName);
    if (existing) {
      simulatedCatMap.set(inCat.id || inCat.name, existing.id);
      preview.willMerge.categories++;
    } else {
      simulatedCatMap.set(inCat.id || inCat.name, inCat.id || `new_cat_${inCat.name}`);
      preview.willAdd.categories++;
    }
  }

  // Group matching simulation
  const simulatedGroupMap = new Map(); // incomingGroupId -> matchedOrNewGroupId
  for (const inGrp of incomingGroups) {
    const targetCatId = simulatedCatMap.get(inGrp.categoryId) || inGrp.categoryId;
    const normName = normalizeGroupName(inGrp.name);
    const groupKey = `${targetCatId}:::${normName}`;
    const existing = existingGroupMap.get(groupKey);

    if (existing) {
      simulatedGroupMap.set(inGrp.id || inGrp.name, existing.id);
      preview.willMerge.groups++;
    } else {
      simulatedGroupMap.set(inGrp.id || inGrp.name, inGrp.id || `new_grp_${inGrp.name}`);
      preview.willAdd.groups++;
    }
  }

  // Link matching simulation
  for (const inLnk of incomingLinks) {
    const targetGroupId = simulatedGroupMap.get(inLnk.groupId) || inLnk.groupId;
    const normUrl = normalizeUrl(inLnk.url);
    const linkKey = `${targetGroupId}:::${normUrl}`;
    const existing = existingLinkMap.get(linkKey);

    if (!existing) {
      preview.willAdd.links++;
    } else {
      const isExactMatch =
        (existing.name || "").trim() === (inLnk.name || "").trim() &&
        (existing.badge || "").trim().toLowerCase() === (inLnk.badge || "").trim().toLowerCase();

      if (isExactMatch) {
        // Completely identical duplicate: skip
        preview.willSkipCount++;
      } else {
        // Same URL but differing name or badge: CONFLICT
        preview.conflictCount++;
        preview.conflicts.push({
          linkId: inLnk.id || `temp_${Math.random()}`,
          groupId: targetGroupId,
          url: inLnk.url,
          existingName: existing.name,
          existingBadge: existing.badge || "",
          incomingName: inLnk.name,
          incomingBadge: inLnk.badge || "",
          resolution: "keep_existing" // default per spec
        });
      }
    }
  }

  return preview;
}

/**
 * Execute import in a SINGLE atomic IndexedDB transaction.
 * Creates pre-import snapshot, merges records, records importJob.
 */
export async function executeImport({
  importData,
  fileName = "bookmarks.json",
  conflictResolutions = {}
}) {
  const fileString = typeof importData === "string" ? importData : JSON.stringify(importData);
  const parsed = typeof importData === "string" ? JSON.parse(importData) : importData;
  const fileHash = await computeFileHash(fileString);

  return withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS, STORES.SNAPSHOTS, STORES.IMPORT_JOBS],
    "readwrite",
    async (stores) => {
      const now = Date.now();

      // 1. Fetch current database state
      const currentCats = await stores[STORES.CATEGORIES].getAll();
      const currentGrps = await stores[STORES.GROUPS].getAll();
      const currentLnks = await stores[STORES.LINKS].getAll();

      // 2. Create and persist pre-import snapshot
      const snapshotId = `snapshot_import_${now}_${Math.random().toString(36).substring(2, 6)}`;
      const snapshot = {
        id: snapshotId,
        createdAt: now,
        reason: `pre_import_${fileName}`,
        data: {
          categories: currentCats,
          groups: currentGrps,
          links: currentLnks
        }
      };
      await stores[STORES.SNAPSHOTS].put(snapshot);

      // 3. Execution tracking
      const addedCategoryIds = [];
      const addedGroupIds = [];
      const addedLinkIds = [];
      let skippedCount = 0;
      let conflictCount = 0;

      // Existing maps
      const existingCatMap = new Map();
      for (const cat of currentCats) {
        existingCatMap.set(normalizeCategoryName(cat.name), cat);
      }

      const existingGroupMap = new Map();
      for (const grp of currentGrps) {
        existingGroupMap.set(`${grp.categoryId}:::${normalizeGroupName(grp.name)}`, grp);
      }

      const existingLinkMap = new Map();
      for (const lnk of currentLnks) {
        existingLinkMap.set(`${lnk.groupId}:::${normalizeUrl(lnk.url)}`, lnk);
      }

      // Map incoming category IDs to database category IDs
      const categoryIdMap = new Map();
      for (const inCat of parsed.categories || []) {
        const normName = normalizeCategoryName(inCat.name);
        const existing = existingCatMap.get(normName);
        if (existing) {
          categoryIdMap.set(inCat.id || inCat.name, existing.id);
        } else {
          const newId = inCat.id && !currentCats.some((c) => c.id === inCat.id)
            ? inCat.id
            : `cat_${now}_${Math.random().toString(36).substring(2, 7)}`;
          const newCat = {
            id: newId,
            name: inCat.name.trim(),
            description: (inCat.description || "").trim(),
            revision: 1,
            createdAt: inCat.createdAt || now,
            updatedAt: inCat.updatedAt || now
          };
          await stores[STORES.CATEGORIES].put(newCat);
          categoryIdMap.set(inCat.id || inCat.name, newId);
          existingCatMap.set(normName, newCat);
          addedCategoryIds.push(newId);
        }
      }

      // Map incoming group IDs to database group IDs
      const groupIdMap = new Map();
      for (const inGrp of parsed.groups || []) {
        const targetCatId = categoryIdMap.get(inGrp.categoryId) || inGrp.categoryId;
        const normName = normalizeGroupName(inGrp.name);
        const groupKey = `${targetCatId}:::${normName}`;
        const existing = existingGroupMap.get(groupKey);

        if (existing) {
          groupIdMap.set(inGrp.id || inGrp.name, existing.id);
        } else {
          const newId = inGrp.id && !currentGrps.some((g) => g.id === inGrp.id)
            ? inGrp.id
            : `grp_${now}_${Math.random().toString(36).substring(2, 7)}`;
          const newGroup = {
            id: newId,
            categoryId: targetCatId,
            name: inGrp.name.trim(),
            revision: 1,
            createdAt: inGrp.createdAt || now,
            updatedAt: inGrp.updatedAt || now
          };
          await stores[STORES.GROUPS].put(newGroup);
          groupIdMap.set(inGrp.id || inGrp.name, newId);
          existingGroupMap.set(groupKey, newGroup);
          addedGroupIds.push(newId);
        }
      }

      // Process links
      for (const inLnk of parsed.links || []) {
        const targetGroupId = groupIdMap.get(inLnk.groupId) || inLnk.groupId;
        const normUrl = normalizeUrl(inLnk.url);
        const linkKey = `${targetGroupId}:::${normUrl}`;
        const existing = existingLinkMap.get(linkKey);

        if (!existing) {
          const newId = inLnk.id && !currentLnks.some((l) => l.id === inLnk.id)
            ? inLnk.id
            : `lnk_${now}_${Math.random().toString(36).substring(2, 7)}`;
          const newLink = {
            id: newId,
            groupId: targetGroupId,
            name: inLnk.name.trim(),
            url: inLnk.url.trim(),
            badge: (inLnk.badge || "").trim(),
            revision: 1,
            createdAt: inLnk.createdAt || now,
            updatedAt: inLnk.updatedAt || now
          };
          await stores[STORES.LINKS].put(newLink);
          addedLinkIds.push(newId);
          existingLinkMap.set(linkKey, newLink);
        } else {
          const isExact =
            (existing.name || "").trim() === (inLnk.name || "").trim() &&
            (existing.badge || "").trim().toLowerCase() === (inLnk.badge || "").trim().toLowerCase();

          if (isExact) {
            skippedCount++;
          } else {
            conflictCount++;
            const resolution = conflictResolutions[inLnk.id] || conflictResolutions[inLnk.url] || "keep_existing";
            if (resolution === "keep_both") {
              // User explicitly selected to keep both -> generate new ID
              const newId = `lnk_${now}_${Math.random().toString(36).substring(2, 7)}`;
              const newLink = {
                id: newId,
                groupId: targetGroupId,
                name: inLnk.name.trim(),
                url: inLnk.url.trim(),
                badge: (inLnk.badge || "").trim(),
                revision: 1,
                createdAt: inLnk.createdAt || now,
                updatedAt: inLnk.updatedAt || now
              };
              await stores[STORES.LINKS].put(newLink);
              addedLinkIds.push(newId);
            } else {
              // Default: keep existing, do not overwrite
              skippedCount++;
            }
          }
        }
      }

      // 4. Save import job record
      const importJobId = `import_${now}_${Math.random().toString(36).substring(2, 7)}`;
      const importJob = {
        id: importJobId,
        sourceFileName: fileName,
        sourceFileHash: fileHash,
        formatVersion: parsed.formatVersion || 1,
        importedAt: now,
        snapshotId,
        addedCategoryIds,
        addedGroupIds,
        addedLinkIds,
        skippedCount,
        conflictCount,
        status: "completed"
      };
      await stores[STORES.IMPORT_JOBS].put(importJob);

      return {
        success: true,
        importJob,
        snapshotId
      };
    }
  );
}

/**
 * Undo an import job by deleting only the records added in that batch.
 * Guarantees zero damage to pre-existing data.
 */
export async function undoImport(importJobId) {
  return withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS, STORES.IMPORT_JOBS],
    "readwrite",
    async (stores) => {
      const job = await stores[STORES.IMPORT_JOBS].get(importJobId);
      if (!job) {
        throw new Error(`Import job ${importJobId} not found`);
      }
      if (job.status === "reverted") {
        throw new Error(`Import job ${importJobId} has already been reverted`);
      }

      // Remove added links
      for (const linkId of job.addedLinkIds || []) {
        await stores[STORES.LINKS].delete(linkId);
      }

      // Remove added groups
      for (const groupId of job.addedGroupIds || []) {
        await stores[STORES.GROUPS].delete(groupId);
      }

      // Remove added categories (ensuring at least 1 remains)
      const allCats = await stores[STORES.CATEGORIES].getAll();
      const remainingCats = allCats.filter((c) => !(job.addedCategoryIds || []).includes(c.id));
      if (remainingCats.length === 0) {
        throw new Error("Cannot undo import because it would leave 0 categories");
      }

      for (const catId of job.addedCategoryIds || []) {
        await stores[STORES.CATEGORIES].delete(catId);
      }

      job.status = "reverted";
      await stores[STORES.IMPORT_JOBS].put(job);

      return {
        success: true,
        revertedLinksCount: (job.addedLinkIds || []).length,
        revertedGroupsCount: (job.addedGroupIds || []).length,
        revertedCategoriesCount: (job.addedCategoryIds || []).length
      };
    }
  );
}

/**
 * Restore an internal snapshot.
 * Creates a pre-restore snapshot first so the restore itself is fully reversible.
 */
export async function restoreSnapshot(snapshotId) {
  return withTransaction(
    [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS, STORES.SNAPSHOTS],
    "readwrite",
    async (stores) => {
      const snapshot = await stores[STORES.SNAPSHOTS].get(snapshotId);
      if (!snapshot) {
        throw new Error(`Snapshot ${snapshotId} not found`);
      }

      const now = Date.now();
      const currentCats = await stores[STORES.CATEGORIES].getAll();
      const currentGrps = await stores[STORES.GROUPS].getAll();
      const currentLnks = await stores[STORES.LINKS].getAll();

      // Create pre-restore safety snapshot
      const safetySnapshotId = `snapshot_pre_restore_${now}`;
      await stores[STORES.SNAPSHOTS].put({
        id: safetySnapshotId,
        createdAt: now,
        reason: `pre_restore_of_${snapshotId}`,
        data: {
          categories: currentCats,
          groups: currentGrps,
          links: currentLnks
        }
      });

      // Clear current data and restore snapshot data
      await stores[STORES.CATEGORIES].clear();
      await stores[STORES.GROUPS].clear();
      await stores[STORES.LINKS].clear();

      for (const cat of snapshot.data.categories || []) {
        await stores[STORES.CATEGORIES].put(cat);
      }
      for (const grp of snapshot.data.groups || []) {
        await stores[STORES.GROUPS].put(grp);
      }
      for (const lnk of snapshot.data.links || []) {
        await stores[STORES.LINKS].put(lnk);
      }

      return {
        success: true,
        restoredFromSnapshotId: snapshotId,
        safetySnapshotId
      };
    }
  );
}

/**
 * Generate full external backup JSON adhering to formatVersion: 1
 */
export function generateBackupJson({ categories, groups, links }) {
  const now = Date.now();
  return {
    formatVersion: 1,
    exportedAt: now,
    app: "PowerLessToy Bookmark Organizer",
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || "",
      revision: c.revision || 1,
      createdAt: c.createdAt || now,
      updatedAt: c.updatedAt || now
    })),
    groups: groups.map((g) => ({
      id: g.id,
      categoryId: g.categoryId,
      name: g.name,
      revision: g.revision || 1,
      createdAt: g.createdAt || now,
      updatedAt: g.updatedAt || now
    })),
    links: links.map((l) => ({
      id: l.id,
      groupId: l.groupId,
      name: l.name,
      url: l.url,
      badge: l.badge || "",
      revision: l.revision || 1,
      createdAt: l.createdAt || now,
      updatedAt: l.updatedAt || now
    }))
  };
}

/**
 * Generate date-time formatted filename for external backup
 */
export function getBackupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins = pad(date.getMinutes());
  return `bookmark-organizer-backup-${year}-${month}-${day}-${hours}${mins}.json`;
}
