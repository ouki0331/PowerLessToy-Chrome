/**
 * Centralized Spotlight Search Engine & Keyboard Navigation (BMK-SEARCH-001)
 *
 * Capabilities:
 * - Cross-category indexing (Title, Full URL, Hostname, URL Path, Group, Category, Badge)
 * - Case-insensitive, whitespace-trimmed, multi-keyword AND matching
 * - Deterministic 6-tier priority ranking with Pinned tie-breaker
 * - Empty-query recommendations (Pinned bookmarks + Recently Used bookmarks)
 * - Safe DOM character highlighting without innerHTML
 * - Keyboard shortcut detection (Ctrl/Cmd+K and '/' fallback excluding inputs)
 * - Strictly offline/local: zero browser history access, zero network calls
 */

import { getPinnedLinks } from "./storage.js";

export const MATCH_TIERS = {
  TITLE_EXACT: 1,
  TITLE_PREFIX: 2,
  TITLE_CONTAINS: 3,
  DOMAIN: 4,
  URL_PATH: 5,
  META: 6
};

/**
 * Safely parse URL into searchable components.
 */
export function parseUrlComponents(rawUrl) {
  const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!url) {
    return {
      fullUrl: "",
      fullUrlLower: "",
      hostname: "",
      hostnameLower: "",
      cleanHostnameLower: "",
      urlPath: "",
      urlPathLower: ""
    };
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname || "";
    const hostnameLower = hostname.toLowerCase();
    const cleanHostnameLower = hostnameLower.replace(/^www\./i, "");
    const rawPath = `${parsed.pathname || ""}${parsed.search || ""}${parsed.hash || ""}`;
    const urlPath = rawPath === "/" ? "" : rawPath;
    return {
      fullUrl: url,
      fullUrlLower: url.toLowerCase(),
      hostname,
      hostnameLower,
      cleanHostnameLower,
      urlPath,
      urlPathLower: urlPath.toLowerCase()
    };
  } catch {
    const lower = url.toLowerCase();
    return {
      fullUrl: url,
      fullUrlLower: lower,
      hostname: url,
      hostnameLower: lower,
      cleanHostnameLower: lower.replace(/^www\./i, ""),
      urlPath: url,
      urlPathLower: lower
    };
  }
}

/**
 * Normalize and split a search query into lowercase tokens.
 */
export function tokenizeSearchQuery(query) {
  const raw = typeof query === "string" ? query.trim() : "";
  const normalized = raw.toLowerCase().replace(/\s+/g, " ");
  const tokens = normalized ? normalized.split(" ").filter(Boolean) : [];
  return { raw, normalized, tokens };
}

/**
 * Build searchable index entries across ALL categories, groups, and links.
 * Excludes hidden bookmarks by default unless includeHidden === true (BMK-PRIV-001).
 */
export function buildSearchIndex(
  data,
  { linkMetricsMap = new Map(), groupMetricsMap = new Map(), includeHidden = false } = {}
) {
  if (!data || !Array.isArray(data.links)) return [];

  const categories = Array.isArray(data.categories) ? data.categories : [];
  const groups = Array.isArray(data.groups) ? data.groups : [];

  const catMap = new Map(categories.map((c) => [c.id, c]));
  const grpMap = new Map(groups.map((g) => [g.id, g]));

  const entries = [];
  for (const link of data.links) {
    if (!link || typeof link !== "object") continue;
    if (!includeHidden && link.hidden === true) continue;
    const group = grpMap.get(link.groupId);
    if (!group) continue;
    const category = catMap.get(group.categoryId);
    if (!category) continue;

    const title = (link.name || "").trim();
    const titleLower = title.toLowerCase();
    const badge = (link.badge || "").trim();
    const badgeLower = badge.toLowerCase();
    const groupName = (group.name || "").trim();
    const groupLower = groupName.toLowerCase();
    const categoryName = (category.name || "").trim();
    const categoryLower = categoryName.toLowerCase();

    const urlParts = parseUrlComponents(link.url);
    const linkMetric = linkMetricsMap.get(link.id);
    const groupMetric = groupMetricsMap.get(group.id);
    const lastUsedAt = Math.max(
      linkMetric?.lastUsedAt || 0,
      link.lastUsedAt || 0,
      groupMetric?.lastUsedAt || 0
    );
    const usageCount = (linkMetric?.usageCount || 0) + (link.usageCount || 0);

    entries.push({
      link,
      group,
      category,
      title,
      titleLower,
      badge,
      badgeLower,
      groupName,
      groupLower,
      categoryName,
      categoryLower,
      ...urlParts,
      lastUsedAt,
      usageCount
    });
  }

  return entries;
}

/**
 * Score a single index entry against a tokenized query.
 * Returns null if not all tokens match across the entry's fields.
 */
export function scoreSearchEntry(entry, queryObj) {
  const { normalized, tokens } = queryObj;
  if (!tokens || tokens.length === 0) return null;

  // Every token must match at least one searchable field (cross-field multi-keyword support)
  const matchesAll = tokens.every(
    (tok) =>
      entry.titleLower.includes(tok) ||
      entry.hostnameLower.includes(tok) ||
      entry.urlPathLower.includes(tok) ||
      entry.fullUrlLower.includes(tok) ||
      entry.groupLower.includes(tok) ||
      entry.categoryLower.includes(tok) ||
      entry.badgeLower.includes(tok)
  );

  if (!matchesAll) return null;

  const allInTitle = tokens.every((tok) => entry.titleLower.includes(tok));
  const allInDomain = tokens.every((tok) => entry.hostnameLower.includes(tok));
  const allInUrl = tokens.every(
    (tok) => entry.urlPathLower.includes(tok) || entry.fullUrlLower.includes(tok)
  );

  let tier = MATCH_TIERS.META;
  let subScore = 0;

  if (entry.titleLower === normalized) {
    tier = MATCH_TIERS.TITLE_EXACT;
    subScore = 0;
  } else if (entry.titleLower.startsWith(normalized)) {
    tier = MATCH_TIERS.TITLE_PREFIX;
    subScore = 0;
  } else if (allInTitle) {
    tier = MATCH_TIERS.TITLE_CONTAINS;
    // Prefer title matches that start with the first token
    subScore = entry.titleLower.startsWith(tokens[0]) ? 0 : 1;
  } else if (entry.hostnameLower.includes(normalized) || allInDomain) {
    tier = MATCH_TIERS.DOMAIN;
    subScore =
      entry.cleanHostnameLower === normalized || entry.cleanHostnameLower.startsWith(tokens[0])
        ? 0
        : 1;
  } else if (
    entry.urlPathLower.includes(normalized) ||
    entry.fullUrlLower.includes(normalized) ||
    allInUrl
  ) {
    tier = MATCH_TIERS.URL_PATH;
    subScore = entry.urlPathLower.includes(normalized) ? 0 : 1;
  } else {
    tier = MATCH_TIERS.META;
    // Prefer exact badge/group/category matches within tier 6
    if (
      entry.badgeLower === normalized ||
      entry.groupLower === normalized ||
      entry.categoryLower === normalized
    ) {
      subScore = 0;
    } else {
      subScore = 1;
    }
  }

  return {
    ...entry,
    tier,
    subScore
  };
}

/**
 * Compare two scored search results according to BMK-SEARCH-001 ranking rules:
 * 1. Tier priority (Title Exact -> Title Prefix -> Title Contains -> Domain -> URL Path -> Group/Category/Badge)
 * 2. Pinned status priority at equal match tier
 * 3. Pinned order (when both are pinned)
 * 4. Sub-score within the same tier
 * 5. Recent usage timestamp
 * 6. Alphabetical title
 */
export function compareSearchResults(a, b) {
  if (a.tier !== b.tier) {
    return a.tier - b.tier;
  }

  const aPinned = a.link?.pinned === true;
  const bPinned = b.link?.pinned === true;
  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  if (aPinned && bPinned) {
    const orderA =
      typeof a.link.pinnedOrder === "number" ? a.link.pinnedOrder : Number.MAX_SAFE_INTEGER;
    const orderB =
      typeof b.link.pinnedOrder === "number" ? b.link.pinnedOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
  }

  if (a.subScore !== b.subScore) {
    return a.subScore - b.subScore;
  }

  if ((b.lastUsedAt || 0) !== (a.lastUsedAt || 0)) {
    return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
  }

  return a.title.localeCompare(b.title);
}

/**
 * Build empty-query recommendations: Pinned items + Recently Used items (BMK-SEARCH-001).
 */
export function getEmptyQueryResults(
  data,
  { linkMetricsMap = new Map(), groupMetricsMap = new Map(), maxRecent = 8, includeHidden = false } = {}
) {
  const index = buildSearchIndex(data, { linkMetricsMap, groupMetricsMap, includeHidden });
  const entryById = new Map(index.map((e) => [e.link.id, e]));

  const pinnedLinks = getPinnedLinks(data, { includeHidden });
  const pinnedResults = [];
  const pinnedIds = new Set();

  for (const lnk of pinnedLinks) {
    const entry = entryById.get(lnk.id);
    if (entry) {
      pinnedIds.add(lnk.id);
      pinnedResults.push({
        ...entry,
        section: "pinned",
        tier: 0,
        subScore: 0
      });
    }
  }

  // Recently used items: links with recorded click metrics or group usage, or fallback to newest links
  const candidatesWithUsage = index
    .filter((e) => !pinnedIds.has(e.link.id) && e.lastUsedAt > 0)
    .sort((a, b) => {
      if (b.lastUsedAt !== a.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return (b.link.createdAt || 0) - (a.link.createdAt || 0);
    });

  let recentEntries = candidatesWithUsage.slice(0, maxRecent);

  // If fewer than maxRecent have explicit click timestamps, supplement with recently created/updated unpinned links
  if (recentEntries.length === 0) {
    recentEntries = index
      .filter((e) => !pinnedIds.has(e.link.id))
      .sort((a, b) => (b.link.updatedAt || b.link.createdAt || 0) - (a.link.updatedAt || a.link.createdAt || 0))
      .slice(0, Math.min(5, maxRecent));
  }

  const recentResults = recentEntries.map((entry) => ({
    ...entry,
    section: "recent",
    tier: 0,
    subScore: 1
  }));

  return {
    isEmptyQuery: true,
    tokens: [],
    pinnedResults,
    recentResults,
    results: [...pinnedResults, ...recentResults]
  };
}

/**
 * Execute centralized search across all categories (BMK-SEARCH-001).
 * Excludes hidden bookmarks when includeHidden === false (BMK-PRIV-001).
 */
export function searchBookmarks(
  data,
  query,
  { linkMetricsMap = new Map(), groupMetricsMap = new Map(), maxRecent = 8, includeHidden = false } = {}
) {
  const queryObj = tokenizeSearchQuery(query);
  if (queryObj.tokens.length === 0) {
    return getEmptyQueryResults(data, { linkMetricsMap, groupMetricsMap, maxRecent, includeHidden });
  }

  const index = buildSearchIndex(data, { linkMetricsMap, groupMetricsMap, includeHidden });
  const matched = [];

  for (const entry of index) {
    const scored = scoreSearchEntry(entry, queryObj);
    if (scored) {
      matched.push({
        ...scored,
        section: "match"
      });
    }
  }

  matched.sort(compareSearchResults);

  return {
    isEmptyQuery: false,
    tokens: queryObj.tokens,
    pinnedResults: [],
    recentResults: [],
    results: matched
  };
}

/**
 * Compute character highlight segments [{ text, highlight: boolean }] for safe DOM rendering.
 */
export function getHighlightSegments(text, tokens) {
  const source = String(text ?? "");
  if (!source) return [];
  const validTokens = Array.isArray(tokens)
    ? tokens.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : [];
  if (validTokens.length === 0) {
    return [{ text: source, highlight: false }];
  }

  const lower = source.toLowerCase();
  const intervals = [];

  for (const tok of validTokens) {
    let startIdx = 0;
    while (startIdx < lower.length) {
      const found = lower.indexOf(tok, startIdx);
      if (found === -1) break;
      intervals.push([found, found + tok.length]);
      startIdx = found + 1;
    }
  }

  if (intervals.length === 0) {
    return [{ text: source, highlight: false }];
  }

  // Sort and merge overlapping intervals
  intervals.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = intervals[i];
    if (cur[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], cur[1]);
    } else {
      merged.push([...cur]);
    }
  }

  const segments = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: source.slice(cursor, start), highlight: false });
    }
    segments.push({ text: source.slice(start, end), highlight: true });
    cursor = end;
  }
  if (cursor < source.length) {
    segments.push({ text: source.slice(cursor), highlight: false });
  }

  return segments;
}

/**
 * Append highlighted text nodes and <mark class="search-highlight"> elements into container.
 * Uses pure DOM APIs (createElement / createTextNode) — never uses innerHTML.
 */
export function appendHighlightedText(container, text, tokens, doc = globalThis.document) {
  if (!container || !doc) return;
  const segments = getHighlightSegments(text, tokens);
  for (const seg of segments) {
    if (seg.highlight) {
      const mark = doc.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = seg.text;
      container.appendChild(mark);
    } else {
      container.appendChild(doc.createTextNode(seg.text));
    }
  }
}

/**
 * Determine whether an element is an editable text input where '/' must NOT trigger search.
 */
export function isEditableElement(el) {
  if (!el || typeof el !== "object") return false;
  if (el.id === "searchInput") return false;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable === true) {
    return true;
  }
  const ceAttr = typeof el.getAttribute === "function" ? el.getAttribute("contenteditable") : null;
  if (ceAttr === "" || ceAttr === "true" || ceAttr === "plaintext-only") {
    return true;
  }
  return false;
}

/**
 * Evaluate whether a keydown event should open the centralized search overlay (BMK-SEARCH-001).
 */
export function evaluateSearchShortcut(event, { activeElement = null, hasBlockingModal = false } = {}) {
  if (!event || typeof event.key !== "string") {
    return { shouldOpen: false };
  }

  const key = event.key;
  const lowerKey = key.toLowerCase();

  // 1. Ctrl+K or Command+K (metaKey+K)
  if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && lowerKey === "k") {
    if (hasBlockingModal) {
      return { shouldOpen: false, reason: "blocking_modal" };
    }
    return {
      shouldOpen: true,
      trigger: event.metaKey ? "cmd+k" : "ctrl+k",
      preventDefault: true
    };
  }

  // 2. Fallback '/' shortcut in page (must NOT fire inside input, textarea, select, or contenteditable)
  if (!event.ctrlKey && !event.metaKey && !event.altKey && key === "/") {
    if (hasBlockingModal) {
      return { shouldOpen: false, reason: "blocking_modal" };
    }
    const target = event.target || activeElement;
    if (isEditableElement(target) || isEditableElement(activeElement)) {
      return { shouldOpen: false, reason: "editable_target" };
    }
    return {
      shouldOpen: true,
      trigger: "slash",
      preventDefault: true
    };
  }

  return { shouldOpen: false };
}

/**
 * Standard environment cycle order (BMK-ENV-001):
 * ALL -> LOCAL -> DEV -> TEST -> PROD -> ALL
 */
export const ENV_FILTER_ORDER = ["ALL", "LOCAL", "DEV", "TEST", "PROD"];

/**
 * Advance environment filter to the next value in the cycle (BMK-ENV-001).
 */
export function getNextEnvFilter(currentFilter = "ALL") {
  const normalized = String(currentFilter || "ALL").trim().toUpperCase();
  const idx = ENV_FILTER_ORDER.indexOf(normalized);
  if (idx === -1) {
    return ENV_FILTER_ORDER[1];
  }
  return ENV_FILTER_ORDER[(idx + 1) % ENV_FILTER_ORDER.length];
}

/**
 * Check whether a bookmark link matches the active environment filter (BMK-ENV-001).
 * - "ALL" matches all links (including links with no badge or custom badges).
 * - Standard environments ("LOCAL", "DEV", "TEST", "PROD") match case-insensitively.
 * - Links without a badge or with custom badges only match in "ALL" state.
 */
export function matchesEnvFilter(link, envFilter = "ALL") {
  const active = String(envFilter || "ALL").trim().toUpperCase();
  if (!active || active === "ALL") {
    return true;
  }
  if (!link || typeof link !== "object") {
    return false;
  }
  const badge = String(link.badge || "").trim().toUpperCase();
  if (!badge) {
    return false;
  }
  return badge === active;
}

/**
 * Check whether an element is any keyboard text input control (including #searchInput,
 * form inputs, textareas, selects, contenteditable elements, or elements inside open modals).
 */
export function isKeyboardInputControl(el) {
  if (!el || typeof el !== "object") return false;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable === true) {
    return true;
  }
  const ceAttr = typeof el.getAttribute === "function" ? el.getAttribute("contenteditable") : null;
  if (ceAttr === "" || ceAttr === "true" || ceAttr === "plaintext-only") {
    return true;
  }
  const roleAttr = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
  if (roleAttr === "textbox" || roleAttr === "searchbox" || roleAttr === "combobox") {
    return true;
  }
  return false;
}

/**
 * Evaluate whether a keydown event should cycle the environment filter via 'E' shortcut (BMK-ENV-001).
 */
export function evaluateEnvFilterShortcut(
  event,
  { activeElement = null, hasBlockingModal = false, isSearchOpen = false } = {}
) {
  if (!event || typeof event.key !== "string") {
    return { shouldCycle: false };
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return { shouldCycle: false, reason: "modifier_key" };
  }
  if (event.key.toLowerCase() !== "e") {
    return { shouldCycle: false };
  }
  if (hasBlockingModal || isSearchOpen) {
    return { shouldCycle: false, reason: "blocking_modal" };
  }
  const target = event.target || activeElement;
  if (isKeyboardInputControl(target) || isKeyboardInputControl(activeElement)) {
    return { shouldCycle: false, reason: "input_focused" };
  }
  return {
    shouldCycle: true,
    preventDefault: true
  };
}


/**
 * Detect platform shortcut label for display in UI ('⌘K' on macOS, 'Ctrl+K' elsewhere).
 */
export function getPlatformSearchShortcutLabel(nav = globalThis.navigator) {
  const platform = String(nav?.userAgentData?.platform || nav?.platform || nav?.userAgent || "").toLowerCase();
  if (platform.includes("mac") || platform.includes("iphone") || platform.includes("ipad")) {
    return "⌘K";
  }
  return "Ctrl+K";
}
