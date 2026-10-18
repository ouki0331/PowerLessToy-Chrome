/**
 * Import & Export Engine for Bookmark Organizer
 *
 * Canonical file format (formatVersion: 1) — three FLAT top-level arrays linked
 * by ID references. This is the ONLY accepted shape; it is identical for import
 * and for backup export. Nested `categories[].groups[].links[]` is rejected with
 * an explicit error instead of being silently ignored.
 *
 *   {
 *     "formatVersion": 1,
 *     "categories": [{ "id", "name", "description"? }],
 *     "groups":     [{ "id", "categoryId", "name" }],
 *     "links":      [{ "id"?, "groupId", "name", "url", "badge"? }]
 *   }
 *
 * Implements:
 * - Strict schema + referential integrity validation with locatable errors
 * - A single pure planner (`planImport`) shared by preview, execution and
 *   verification, so the executed result always equals the confirmed preview
 * - Stable conflict keys (`links[<index>]`) that work for links without IDs
 * - Atomic transactional import with automated pre-import snapshot
 * - Ownership-checked Undo Import (never orphans user data)
 * - Snapshot restore with impact analysis
 * - Full JSON backup export read fresh from IndexedDB
 */

import { withTransaction, STORES } from "./db.js";
import { isValidUrl } from "./storage.js";

export const IMPORT_FORMAT_VERSION = 1;
const KNOWN_TOP_LEVEL_KEYS = new Set(["formatVersion", "categories", "groups", "links", "exportedAt", "app"]);
const RESOLUTIONS = new Set(["keep_existing", "keep_both"]);
const BUSINESS_STORES = [STORES.CATEGORIES, STORES.GROUPS, STORES.LINKS];

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

function describeType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function generateId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function makeError(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

/**
 * Validate incoming JSON structure, format version and referential integrity.
 * Every error string carries a JSON path so the user can locate the problem.
 */
export function validateImportJson(rawJson) {
  const errors = [];
  const warnings = [];

  if (typeof rawJson !== "object" || rawJson === null || Array.isArray(rawJson)) {
    return { valid: false, errors: ["Import file must be a JSON object"], warnings };
  }

  if (rawJson.formatVersion !== IMPORT_FORMAT_VERSION) {
    errors.push(
      `formatVersion: unsupported value '${rawJson.formatVersion}'. Only formatVersion: ${IMPORT_FORMAT_VERSION} is supported.`
    );
  }

  for (const key of Object.keys(rawJson)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) warnings.push(`Unknown top-level field '${key}' will be ignored.`);
  }

  // All three collections are mandatory top-level arrays (may be empty)
  for (const key of ["categories", "groups", "links"]) {
    if (!Array.isArray(rawJson[key])) {
      errors.push(`${key}: required top-level array is missing (found ${describeType(rawJson[key])})`);
    }
  }

  const categories = Array.isArray(rawJson.categories) ? rawJson.categories : [];
  const groups = Array.isArray(rawJson.groups) ? rawJson.groups : [];
  const links = Array.isArray(rawJson.links) ? rawJson.links : [];

  // Explicitly reject the nested shape instead of silently dropping data
  const nestedGroups = categories.some((c) => c && typeof c === "object" && "groups" in c);
  const nestedLinks = groups.some((g) => g && typeof g === "object" && "links" in g);
  if (nestedGroups) {
    errors.push(
      "categories[].groups: nested groups are not supported. formatVersion 1 requires a flat top-level 'groups' array where each group has a 'categoryId'."
    );
  }
  if (nestedLinks) {
    errors.push(
      "groups[].links: nested links are not supported. formatVersion 1 requires a flat top-level 'links' array where each link has a 'groupId'."
    );
  }

  const categoryIds = new Set();
  categories.forEach((cat, i) => {
    const path = `categories[${i}]`;
    if (!cat || typeof cat !== "object" || Array.isArray(cat)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    if (!isNonEmptyString(cat.id)) errors.push(`${path}.id: required non-empty string`);
    else if (categoryIds.has(cat.id)) errors.push(`${path}.id: duplicate id '${cat.id}'`);
    else categoryIds.add(cat.id);
    if (!isNonEmptyString(cat.name)) errors.push(`${path}.name: required non-empty string`);
    if (cat.description !== undefined && typeof cat.description !== "string") {
      errors.push(`${path}.description: must be a string when present`);
    }
  });

  const groupIds = new Set();
  groups.forEach((grp, i) => {
    const path = `groups[${i}]`;
    if (!grp || typeof grp !== "object" || Array.isArray(grp)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    if (!isNonEmptyString(grp.id)) errors.push(`${path}.id: required non-empty string`);
    else if (groupIds.has(grp.id)) errors.push(`${path}.id: duplicate id '${grp.id}'`);
    else groupIds.add(grp.id);
    if (!isNonEmptyString(grp.name)) errors.push(`${path}.name: required non-empty string`);
    if (!isNonEmptyString(grp.categoryId)) {
      errors.push(`${path}.categoryId: required non-empty string`);
    } else if (!categoryIds.has(grp.categoryId)) {
      errors.push(`${path}.categoryId: '${grp.categoryId}' does not match any categories[].id in this file`);
    }
  });

  const linkIds = new Set();
  links.forEach((lnk, i) => {
    const path = `links[${i}]`;
    if (!lnk || typeof lnk !== "object" || Array.isArray(lnk)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    if (lnk.id !== undefined) {
      if (!isNonEmptyString(lnk.id)) errors.push(`${path}.id: must be a non-empty string when present`);
      else if (linkIds.has(lnk.id)) errors.push(`${path}.id: duplicate id '${lnk.id}'`);
      else linkIds.add(lnk.id);
    }
    if (!isNonEmptyString(lnk.name)) errors.push(`${path}.name: required non-empty string`);
    if (typeof lnk.url !== "string" || !isValidUrl(lnk.url)) {
      errors.push(`${path}.url: invalid URL '${lnk.url}'`);
    }
    if (lnk.badge !== undefined && typeof lnk.badge !== "string") {
      errors.push(`${path}.badge: must be a string when present`);
    }
    if (!isNonEmptyString(lnk.groupId)) {
      errors.push(`${path}.groupId: required non-empty string`);
    } else if (!groupIds.has(lnk.groupId)) {
      errors.push(`${path}.groupId: '${lnk.groupId}' does not match any groups[].id in this file`);
    }
  });

  if (errors.length === 0 && categories.length === 0) {
    errors.push("categories: the file contains no data to import");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Pure import planner. Shared by preview, execution and verification.
 *
 * Matching rules (normalisation is only used for comparison):
 * - Category: normalised name
 * - Group: normalised name within the resolved target category
 * - Link: normalised URL within the resolved target group
 *
 * New records ALWAYS receive freshly generated IDs so they can never collide
 * with existing or previously deleted records referenced by older import jobs.
 */
export function planImport(parsed, current, conflictResolutions = {}) {
  const existingCategories = current.categories || [];
  const existingGroups = current.groups || [];
  const existingLinks = current.links || [];
  const warnings = [];

  const catById = new Map(existingCategories.map((c) => [c.id, c]));
  const grpById = new Map(existingGroups.map((g) => [g.id, g]));

  // Category resolution
  const catByName = new Map(existingCategories.map((c) => [normalizeCategoryName(c.name), { id: c.id, source: "database", record: c }]));
  const categoryTarget = new Map(); // incoming id -> target id
  const newCategories = [];
  const mergedCategories = [];
  parsed.categories.forEach((inCat, index) => {
    const key = normalizeCategoryName(inCat.name);
    const match = catByName.get(key);
    if (match) {
      categoryTarget.set(inCat.id, match.id);
      mergedCategories.push({ index, incomingName: inCat.name, targetId: match.id, targetName: match.record.name, source: match.source });
      if (match.source === "file") {
        warnings.push(`categories[${index}] '${inCat.name}' has the same name as an earlier category in this file; they will be merged.`);
      } else if ((inCat.description || "").trim() && (inCat.description || "").trim() !== (match.record.description || "").trim()) {
        warnings.push(`categories[${index}] '${inCat.name}': description differs from the existing category; the existing description is kept.`);
      }
    } else {
      const record = {
        id: generateId("cat"),
        name: inCat.name.trim(),
        description: (inCat.description || "").trim()
      };
      newCategories.push({ index, record });
      categoryTarget.set(inCat.id, record.id);
      catByName.set(key, { id: record.id, source: "file", record });
    }
  });

  // Group resolution
  const grpByKey = new Map(
    existingGroups.map((g) => [`${g.categoryId}:::${normalizeGroupName(g.name)}`, { id: g.id, source: "database", record: g }])
  );
  const groupTarget = new Map();
  const newGroups = [];
  const mergedGroups = [];
  parsed.groups.forEach((inGrp, index) => {
    const targetCatId = categoryTarget.get(inGrp.categoryId);
    const key = `${targetCatId}:::${normalizeGroupName(inGrp.name)}`;
    const match = grpByKey.get(key);
    if (match) {
      groupTarget.set(inGrp.id, match.id);
      mergedGroups.push({ index, incomingName: inGrp.name, targetId: match.id, targetName: match.record.name, source: match.source });
      if (match.source === "file") {
        warnings.push(`groups[${index}] '${inGrp.name}' has the same name as an earlier group in the same category; they will be merged.`);
      }
    } else {
      const record = { id: generateId("grp"), categoryId: targetCatId, name: inGrp.name.trim() };
      newGroups.push({ index, record });
      groupTarget.set(inGrp.id, record.id);
      grpByKey.set(key, { id: record.id, source: "file", record });
    }
  });

  const groupNameOf = (groupId) => {
    const fromDb = grpById.get(groupId);
    if (fromDb) return { group: fromDb.name, category: catById.get(fromDb.categoryId)?.name || "" };
    const planned = newGroups.find((g) => g.record.id === groupId)?.record;
    const catName =
      catById.get(planned?.categoryId)?.name || newCategories.find((c) => c.record.id === planned?.categoryId)?.record.name || "";
    return { group: planned?.name || "", category: catName };
  };

  // Link resolution
  const linkByKey = new Map(
    existingLinks.map((l) => [`${l.groupId}:::${normalizeUrl(l.url)}`, { source: "database", record: l, ref: `existing:${l.id}` }])
  );
  const newLinks = [];
  const skipped = [];
  const conflicts = [];
  parsed.links.forEach((inLnk, index) => {
    const conflictKey = `links[${index}]`;
    const targetGroupId = groupTarget.get(inLnk.groupId);
    const key = `${targetGroupId}:::${normalizeUrl(inLnk.url)}`;
    const candidate = {
      groupId: targetGroupId,
      name: inLnk.name.trim(),
      url: inLnk.url.trim(),
      badge: (inLnk.badge || "").trim()
    };
    const match = linkByKey.get(key);

    if (!match) {
      const record = { id: generateId("lnk"), ...candidate };
      newLinks.push({ index, record, reason: "new" });
      linkByKey.set(key, { source: "file", record, ref: `file:links[${index}]` });
      return;
    }

    const isExact =
      (match.record.name || "").trim() === candidate.name &&
      (match.record.badge || "").trim().toLowerCase() === candidate.badge.toLowerCase();

    if (isExact) {
      skipped.push({ index, reason: match.source === "database" ? "duplicate_existing" : "duplicate_in_file" });
      if (match.source === "file") {
        warnings.push(`links[${index}] is an exact duplicate of an earlier link in this file and will be skipped.`);
      }
      return;
    }

    const resolution = conflictResolutions[conflictKey] || "keep_existing";
    const names = groupNameOf(targetGroupId);
    conflicts.push({
      conflictKey,
      incomingIndex: index,
      existingSource: match.source,
      existingRef: match.ref,
      groupId: targetGroupId,
      groupName: names.group,
      categoryName: names.category,
      url: candidate.url,
      existingName: match.record.name,
      existingBadge: match.record.badge || "",
      incomingName: candidate.name,
      incomingBadge: candidate.badge,
      resolution
    });
    if (resolution === "keep_both") {
      newLinks.push({ index, record: { id: generateId("lnk"), ...candidate }, reason: "keep_both" });
    } else {
      skipped.push({ index, reason: "conflict_keep_existing" });
    }
  });

  const baseAddedLinks = newLinks.filter((l) => l.reason === "new").length;
  const summary = {
    totalCategories: parsed.categories.length,
    totalGroups: parsed.groups.length,
    totalLinks: parsed.links.length,
    willAdd: { categories: newCategories.length, groups: newGroups.length, links: baseAddedLinks },
    willMerge: { categories: mergedCategories.length, groups: mergedGroups.length },
    willSkipCount: skipped.filter((s) => s.reason !== "conflict_keep_existing").length,
    conflictCount: conflicts.length,
    keepBothCount: newLinks.length - baseAddedLinks
  };

  // Resolution-independent fingerprint of the plan. If the database changes
  // between preview and confirmation, the fingerprint changes and execution is
  // refused instead of producing a result the user never saw.
  const signature = JSON.stringify({
    willAdd: summary.willAdd,
    willMerge: summary.willMerge,
    willSkipCount: summary.willSkipCount,
    mergedCategoryTargets: mergedCategories.map((m) => `${m.index}>${m.targetId}`),
    mergedGroupTargets: mergedGroups.map((m) => `${m.index}>${m.targetId}`),
    conflicts: conflicts.map((c) => `${c.conflictKey}>${c.existingRef}`)
  });

  return {
    newCategories,
    newGroups,
    newLinks,
    mergedCategories,
    mergedGroups,
    skipped,
    conflicts,
    summary,
    signature,
    warnings
  };
}

function parseImportContent(content) {
  if (typeof content === "string") {
    try {
      return { parsed: JSON.parse(content), text: content };
    } catch (err) {
      return { parseError: `JSON parse error: ${err.message}` };
    }
  }
  return { parsed: content, text: JSON.stringify(content) };
}

/**
 * Read the latest business data directly from IndexedDB (never a page cache).
 */
export async function readCurrentData() {
  return withTransaction(BUSINESS_STORES, "readonly", async (stores) => ({
    categories: await stores[STORES.CATEGORIES].getAll(),
    groups: await stores[STORES.GROUPS].getAll(),
    links: await stores[STORES.LINKS].getAll()
  }));
}

/**
 * Generate preview of import without modifying any database records.
 * When existing data is not supplied it is read fresh from IndexedDB.
 */
export async function generateImportPreview({
  fileContent,
  fileName = "bookmarks.json",
  existingCategories,
  existingGroups,
  existingLinks,
  existingImportJobs
}) {
  const { parsed, text, parseError } = parseImportContent(fileContent);
  if (parseError) return { valid: false, errors: [parseError], warnings: [] };

  const validation = validateImportJson(parsed);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors, warnings: validation.warnings };
  }

  let current;
  if (existingCategories && existingGroups && existingLinks) {
    current = { categories: existingCategories, groups: existingGroups, links: existingLinks };
  } else {
    current = await readCurrentData();
  }
  const jobs =
    existingImportJobs ??
    (await withTransaction([STORES.IMPORT_JOBS], "readonly", (stores) => stores[STORES.IMPORT_JOBS].getAll()));

  const fileHash = await computeFileHash(text);
  const previousJobs = (jobs || [])
    .filter((job) => job.sourceFileHash === fileHash)
    .sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0));
  const lastJob = previousJobs[0];

  const plan = planImport(parsed, current);
  const warnings = [...validation.warnings, ...plan.warnings];
  if (lastJob) {
    warnings.unshift(
      `Warning: This exact file was previously imported on ${new Date(lastJob.importedAt).toLocaleString()} (status: ${lastJob.status}).`
    );
  }

  return {
    valid: true,
    fileName,
    fileHash,
    formatVersion: parsed.formatVersion,
    alreadyImported: Boolean(lastJob),
    lastImportedAt: lastJob?.importedAt || null,
    lastImportStatus: lastJob?.status || null,
    ...plan.summary,
    mergedCategories: plan.mergedCategories,
    mergedGroups: plan.mergedGroups,
    conflicts: plan.conflicts,
    planSignature: plan.signature,
    errors: [],
    warnings
  };
}

/**
 * Execute import in a SINGLE atomic IndexedDB transaction.
 * Re-validates, re-plans against the latest data, refuses stale previews,
 * creates a pre-import snapshot, appends records with `add`, verifies the
 * result and records the importJob — all or nothing.
 */
export async function executeImport({
  importData,
  fileName = "bookmarks.json",
  conflictResolutions = {},
  expectedPlanSignature
}) {
  const { parsed, text, parseError } = parseImportContent(importData);
  if (parseError) throw makeError("IMPORT_INVALID", parseError, { details: [parseError] });

  const validation = validateImportJson(parsed);
  if (!validation.valid) {
    throw makeError("IMPORT_INVALID", `Import file is invalid: ${validation.errors[0]}`, {
      details: validation.errors
    });
  }

  for (const [key, value] of Object.entries(conflictResolutions)) {
    if (!RESOLUTIONS.has(value)) {
      throw makeError("IMPORT_INVALID", `Unknown conflict resolution '${value}' for ${key}`);
    }
  }

  const fileHash = await computeFileHash(text);

  return withTransaction(
    [...BUSINESS_STORES, STORES.SNAPSHOTS, STORES.IMPORT_JOBS],
    "readwrite",
    async (stores) => {
      const currentCats = await stores[STORES.CATEGORIES].getAll();
      const currentGrps = await stores[STORES.GROUPS].getAll();
      const currentLnks = await stores[STORES.LINKS].getAll();
      const current = { categories: currentCats, groups: currentGrps, links: currentLnks };

      const plan = planImport(parsed, current, conflictResolutions);

      if (expectedPlanSignature !== undefined && plan.signature !== expectedPlanSignature) {
        throw makeError(
          "PREVIEW_STALE",
          "Your bookmarks changed after the preview was generated. Nothing was imported; please review the updated preview."
        );
      }

      const unknownKeys = Object.keys(conflictResolutions).filter(
        (key) => !plan.conflicts.some((c) => c.conflictKey === key)
      );
      if (unknownKeys.length > 0) {
        throw makeError("PREVIEW_STALE", `Conflict choices no longer match the file: ${unknownKeys.join(", ")}`);
      }

      const now = Date.now();
      const importJobId = generateId("import");
      const snapshotId = generateId("snapshot");

      // 1. Pre-import snapshot (same transaction)
      await stores[STORES.SNAPSHOTS].put({
        id: snapshotId,
        createdAt: now,
        reason: "pre_import",
        importJobId,
        sourceFileName: fileName,
        data: current
      });

      // 2. Append only. `add` throws instead of replacing if an ID ever exists.
      const maxCreatedAt = Math.max(
        0,
        ...currentCats.map((c) => c.createdAt || 0),
        ...currentGrps.map((g) => g.createdAt || 0),
        ...currentLnks.map((l) => l.createdAt || 0)
      );
      let clock = Math.max(now, maxCreatedAt + 1);
      const stamp = (record) => ({
        ...record,
        revision: 1,
        createdAt: clock,
        updatedAt: clock++,
        sourceImportJobId: importJobId
      });

      for (const { record } of plan.newCategories) await stores[STORES.CATEGORIES].add(stamp(record));
      for (const { record } of plan.newGroups) await stores[STORES.GROUPS].add(stamp(record));
      for (const { record } of plan.newLinks) await stores[STORES.LINKS].add(stamp(record));

      // 3. Verify actual result inside the transaction (rollback on mismatch)
      const afterCats = await stores[STORES.CATEGORIES].getAll();
      const afterGrps = await stores[STORES.GROUPS].getAll();
      const afterLnks = await stores[STORES.LINKS].getAll();
      const untouched = (before, after) => {
        const afterById = new Map(after.map((r) => [r.id, r]));
        return before.every((r) => {
          const a = afterById.get(r.id);
          return a && a.revision === r.revision && a.updatedAt === r.updatedAt;
        });
      };
      if (
        afterCats.length !== currentCats.length + plan.newCategories.length ||
        afterGrps.length !== currentGrps.length + plan.newGroups.length ||
        afterLnks.length !== currentLnks.length + plan.newLinks.length ||
        !untouched(currentCats, afterCats) ||
        !untouched(currentGrps, afterGrps) ||
        !untouched(currentLnks, afterLnks)
      ) {
        throw makeError("IMPORT_VERIFY_FAILED", "Import verification failed; the import was rolled back and nothing changed.");
      }

      // 4. Import job record
      const importJob = {
        id: importJobId,
        sourceFileName: fileName,
        sourceFileHash: fileHash,
        formatVersion: parsed.formatVersion,
        importedAt: now,
        snapshotId,
        addedCategoryIds: plan.newCategories.map((c) => c.record.id),
        addedGroupIds: plan.newGroups.map((g) => g.record.id),
        addedLinkIds: plan.newLinks.map((l) => l.record.id),
        mergedCategoryIds: [...new Set(plan.mergedCategories.filter((m) => m.source === "database").map((m) => m.targetId))],
        mergedGroupIds: [...new Set(plan.mergedGroups.filter((m) => m.source === "database").map((m) => m.targetId))],
        skippedCount: plan.summary.willSkipCount + plan.skipped.filter((s) => s.reason === "conflict_keep_existing").length,
        duplicateCount: plan.summary.willSkipCount,
        conflictCount: plan.summary.conflictCount,
        keepBothCount: plan.summary.keepBothCount,
        conflictResolutions: Object.fromEntries(plan.conflicts.map((c) => [c.conflictKey, c.resolution])),
        status: "completed"
      };
      await stores[STORES.IMPORT_JOBS].put(importJob);

      return { success: true, importJob, snapshotId };
    }
  );
}

/**
 * Analyse whether an import job can be undone WITHOUT touching anything the
 * user created or modified afterwards. Pure function.
 */
export function analyzeUndo(job, current) {
  const addedCats = new Set(job.addedCategoryIds || []);
  const addedGrps = new Set(job.addedGroupIds || []);
  const addedLnks = new Set(job.addedLinkIds || []);

  const presentCats = current.categories.filter((c) => addedCats.has(c.id));
  const presentGrps = current.groups.filter((g) => addedGrps.has(g.id));
  const presentLnks = current.links.filter((l) => addedLnks.has(l.id));

  const isModified = (r) => r.revision !== 1 || (r.sourceImportJobId && r.sourceImportJobId !== job.id);
  const modified = [
    ...presentCats.filter(isModified).map((r) => ({ type: "category", id: r.id, name: r.name, revision: r.revision })),
    ...presentGrps.filter(isModified).map((r) => ({ type: "group", id: r.id, name: r.name, revision: r.revision })),
    ...presentLnks.filter(isModified).map((r) => ({ type: "link", id: r.id, name: r.name, revision: r.revision }))
  ];

  // Content created after the import inside containers the import created
  const foreignGroups = current.groups
    .filter((g) => addedCats.has(g.categoryId) && !addedGrps.has(g.id))
    .map((g) => ({ type: "group", id: g.id, name: g.name }));
  const foreignLinks = current.links
    .filter((l) => addedGrps.has(l.groupId) && !addedLnks.has(l.id))
    .map((l) => ({ type: "link", id: l.id, name: l.name, url: l.url }));

  const remainingCategories = current.categories.filter((c) => !addedCats.has(c.id)).length;
  const wouldLeaveNoCategories = remainingCategories === 0;

  return {
    importJobId: job.id,
    snapshotId: job.snapshotId,
    canUndo: modified.length === 0 && foreignGroups.length === 0 && foreignLinks.length === 0 && !wouldLeaveNoCategories,
    willRemove: { categories: presentCats.length, groups: presentGrps.length, links: presentLnks.length },
    alreadyRemoved: {
      categories: addedCats.size - presentCats.length,
      groups: addedGrps.size - presentGrps.length,
      links: addedLnks.size - presentLnks.length
    },
    blockers: { modified, foreignGroups, foreignLinks, wouldLeaveNoCategories }
  };
}

async function loadJobOrThrow(stores, importJobId) {
  const job = await stores[STORES.IMPORT_JOBS].get(importJobId);
  if (!job) throw makeError("NOT_FOUND", `Import job ${importJobId} not found`);
  if (job.status === "reverted") throw makeError("ALREADY_REVERTED", `Import job ${importJobId} has already been reverted`);
  return job;
}

/**
 * Read-only undo impact preview for the UI.
 */
export async function previewUndoImport(importJobId) {
  return withTransaction([...BUSINESS_STORES, STORES.IMPORT_JOBS], "readonly", async (stores) => {
    const job = await loadJobOrThrow(stores, importJobId);
    const current = {
      categories: await stores[STORES.CATEGORIES].getAll(),
      groups: await stores[STORES.GROUPS].getAll(),
      links: await stores[STORES.LINKS].getAll()
    };
    return analyzeUndo(job, current);
  });
}

/**
 * Undo an import job by deleting only the untouched records it added.
 * Refuses (UNDO_BLOCKED) when any imported record was edited, or when the user
 * added content inside an imported category/group — no orphans are possible.
 * A pre-undo snapshot is written in the same transaction.
 */
export async function undoImport(importJobId) {
  return withTransaction(
    [...BUSINESS_STORES, STORES.IMPORT_JOBS, STORES.SNAPSHOTS],
    "readwrite",
    async (stores) => {
      const job = await loadJobOrThrow(stores, importJobId);
      const current = {
        categories: await stores[STORES.CATEGORIES].getAll(),
        groups: await stores[STORES.GROUPS].getAll(),
        links: await stores[STORES.LINKS].getAll()
      };

      const analysis = analyzeUndo(job, current);
      if (!analysis.canUndo) {
        throw makeError(
          "UNDO_BLOCKED",
          "This import cannot be undone automatically because imported items were changed or new content was added inside them.",
          { analysis }
        );
      }

      const now = Date.now();
      const safetySnapshotId = generateId("snapshot");
      await stores[STORES.SNAPSHOTS].put({
        id: safetySnapshotId,
        createdAt: now,
        reason: "pre_undo_import",
        importJobId: job.id,
        data: current
      });

      const ids = (list, set) => list.filter((r) => set.has(r.id)).map((r) => r.id);
      for (const id of ids(current.links, new Set(job.addedLinkIds || []))) await stores[STORES.LINKS].delete(id);
      for (const id of ids(current.groups, new Set(job.addedGroupIds || []))) await stores[STORES.GROUPS].delete(id);
      for (const id of ids(current.categories, new Set(job.addedCategoryIds || []))) await stores[STORES.CATEGORIES].delete(id);

      // Integrity check: no orphans may remain
      const cats = await stores[STORES.CATEGORIES].getAll();
      const grps = await stores[STORES.GROUPS].getAll();
      const lnks = await stores[STORES.LINKS].getAll();
      const catIds = new Set(cats.map((c) => c.id));
      const grpIds = new Set(grps.map((g) => g.id));
      if (cats.length === 0 || grps.some((g) => !catIds.has(g.categoryId)) || lnks.some((l) => !grpIds.has(l.groupId))) {
        throw makeError("UNDO_VERIFY_FAILED", "Undo verification failed; nothing was changed.");
      }

      await stores[STORES.IMPORT_JOBS].put({
        ...job,
        status: "reverted",
        revertedAt: now,
        revertMethod: "undo",
        preUndoSnapshotId: safetySnapshotId
      });

      return {
        success: true,
        safetySnapshotId,
        revertedLinksCount: analysis.willRemove.links,
        revertedGroupsCount: analysis.willRemove.groups,
        revertedCategoriesCount: analysis.willRemove.categories
      };
    }
  );
}

/**
 * Pure diff between current data and a snapshot, used to show the user what a
 * restore would discard BEFORE they confirm it.
 */
export function analyzeSnapshotRestore(snapshot, current) {
  const diff = (snapList = [], curList = []) => {
    const snapById = new Map(snapList.map((r) => [r.id, r]));
    const curById = new Map(curList.map((r) => [r.id, r]));
    return {
      removed: curList.filter((r) => !snapById.has(r.id)).length,
      restored: snapList.filter((r) => !curById.has(r.id)).length,
      reverted: curList.filter((r) => snapById.has(r.id) && snapById.get(r.id).revision !== r.revision).length
    };
  };
  return {
    snapshotId: snapshot.id,
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
    categories: diff(snapshot.data?.categories, current.categories),
    groups: diff(snapshot.data?.groups, current.groups),
    links: diff(snapshot.data?.links, current.links)
  };
}

export async function previewSnapshotRestore(snapshotId) {
  return withTransaction([...BUSINESS_STORES, STORES.SNAPSHOTS], "readonly", async (stores) => {
    const snapshot = await stores[STORES.SNAPSHOTS].get(snapshotId);
    if (!snapshot) throw makeError("NOT_FOUND", `Snapshot ${snapshotId} not found`);
    const current = {
      categories: await stores[STORES.CATEGORIES].getAll(),
      groups: await stores[STORES.GROUPS].getAll(),
      links: await stores[STORES.LINKS].getAll()
    };
    return analyzeSnapshotRestore(snapshot, current);
  });
}

/**
 * Restore an internal snapshot.
 * Creates a pre-restore snapshot first so the restore itself is fully reversible.
 * Restored records get a revision higher than any current one so editors still
 * holding an older revision in another tab receive CONFLICT instead of writing.
 * Optionally marks an import job as reverted (used by "restore pre-import state").
 */
export async function restoreSnapshot(snapshotId, { markImportJobReverted } = {}) {
  return withTransaction(
    [...BUSINESS_STORES, STORES.SNAPSHOTS, STORES.IMPORT_JOBS],
    "readwrite",
    async (stores) => {
      const snapshot = await stores[STORES.SNAPSHOTS].get(snapshotId);
      if (!snapshot) throw makeError("NOT_FOUND", `Snapshot ${snapshotId} not found`);

      const snapCats = snapshot.data?.categories || [];
      if (snapCats.length === 0) {
        throw makeError("INVALID_SNAPSHOT", `Snapshot ${snapshotId} contains no categories and cannot be restored`);
      }

      const now = Date.now();
      const current = {
        categories: await stores[STORES.CATEGORIES].getAll(),
        groups: await stores[STORES.GROUPS].getAll(),
        links: await stores[STORES.LINKS].getAll()
      };

      const safetySnapshotId = generateId("snapshot");
      await stores[STORES.SNAPSHOTS].put({
        id: safetySnapshotId,
        createdAt: now,
        reason: `pre_restore_of_${snapshotId}`,
        data: current
      });

      const restoreStore = async (storeName, snapList, curList) => {
        const curRev = new Map(curList.map((r) => [r.id, r.revision || 1]));
        await stores[storeName].clear();
        for (const rec of snapList) {
          const revision = Math.max(rec.revision || 1, curRev.get(rec.id) || 0) + 1;
          await stores[storeName].add({ ...rec, revision, updatedAt: now });
        }
      };
      await restoreStore(STORES.CATEGORIES, snapCats, current.categories);
      await restoreStore(STORES.GROUPS, snapshot.data.groups || [], current.groups);
      await restoreStore(STORES.LINKS, snapshot.data.links || [], current.links);

      if (markImportJobReverted) {
        const job = await stores[STORES.IMPORT_JOBS].get(markImportJobReverted);
        if (job && job.status !== "reverted") {
          await stores[STORES.IMPORT_JOBS].put({
            ...job,
            status: "reverted",
            revertedAt: now,
            revertMethod: "snapshot_restore",
            preRestoreSnapshotId: safetySnapshotId
          });
        }
      }

      return { success: true, restoredFromSnapshotId: snapshotId, safetySnapshotId };
    }
  );
}

/**
 * Generate full external backup JSON adhering to formatVersion: 1.
 * The output is the canonical import format and can be re-imported as-is.
 */
export function generateBackupJson({ categories, groups, links }) {
  const now = Date.now();
  const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
  return {
    formatVersion: IMPORT_FORMAT_VERSION,
    exportedAt: now,
    app: "PowerLessToy Bookmark Organizer",
    categories: [...categories].sort(byCreated).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description || ""
    })),
    groups: [...groups].sort(byCreated).map((g) => ({
      id: g.id,
      categoryId: g.categoryId,
      name: g.name
    })),
    links: [...links].sort(byCreated).map((l) => ({
      id: l.id,
      groupId: l.groupId,
      name: l.name,
      url: l.url,
      badge: l.badge || ""
    }))
  };
}

/**
 * Build a backup from the LATEST IndexedDB state (never from a page cache that
 * may be stale relative to another tab).
 */
export async function exportBackup() {
  return generateBackupJson(await readCurrentData());
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
