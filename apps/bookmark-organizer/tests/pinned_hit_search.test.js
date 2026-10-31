/**
 * Comprehensive tests for:
 * - BMK-PIN-001: Global Pinned Bookmarks Shelf (pin, unpin, edit sync, delete sync, ordering, drag/keyboard reorder)
 * - BMK-HIT-001: Expanded Bookmark Click Area & Action Button Isolation
 * - BMK-SEARCH-001: Centralized Spotlight Search, Ranking, Shortcuts, Navigation & Focus Restoration
 * - Legacy Data Compatibility & Backup/Import Pinned Safety
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Minimal DOM mock for testing app.js UI rendering, events & focus management
// ---------------------------------------------------------------------------
const elementsById = new Map();

class MockClassList {
  constructor() {
    this._set = new Set();
  }
  add(...classes) {
    classes.forEach((c) => c && this._set.add(c));
  }
  remove(...classes) {
    classes.forEach((c) => this._set.delete(c));
  }
  toggle(c, force) {
    if (force === undefined) {
      if (this._set.has(c)) this._set.delete(c);
      else this._set.add(c);
    } else if (force) {
      this._set.add(c);
    } else {
      this._set.delete(c);
    }
  }
  contains(c) {
    return this._set.has(c);
  }
  get value() {
    return Array.from(this._set).join(" ");
  }
}

function matchesSelector(el, selector) {
  if (!el || !el.tagName) return false;
  if (selector.includes(",")) {
    return selector
      .split(",")
      .map((s) => s.trim())
      .some((s) => matchesSelector(el, s));
  }
  if (selector.startsWith(".")) {
    return el.classList.contains(selector.slice(1));
  }
  if (selector.startsWith("#")) {
    return el.id === selector.slice(1);
  }
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const inner = selector.slice(1, -1);
    if (inner.includes("=")) {
      const [attr, rawVal] = inner.split("=");
      const val = rawVal.replace(/^["']|["']$/g, "");
      if (attr.startsWith("data-")) {
        const key = attr.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
        return el.dataset[key] === val;
      }
      return el.getAttribute(attr) === val;
    }
    return el.getAttribute(inner) !== null;
  }
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

class MockElement {
  constructor(tagName) {
    this.tagName = String(tagName || "div").toUpperCase();
    this.children = [];
    this.childNodes = [];
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new MockClassList();
    this.style = {};
    this.eventListeners = {};
    this._textContent = "";
    this._innerHTML = "";
    this._id = "";
    this.value = "";
    this.disabled = false;
    this.draggable = false;
    this.tabIndex = 0;
    this.parentNode = null;
  }

  get id() {
    return this._id;
  }
  set id(val) {
    this._id = String(val);
    if (this._id) elementsById.set(this._id, this);
  }

  get className() {
    return this.classList.value;
  }
  set className(val) {
    this.classList._set.clear();
    if (val) {
      String(val)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => this.classList.add(c));
    }
  }

  get textContent() {
    if (this.childNodes.length > 0) {
      return this.childNodes.map((n) => n.textContent || "").join("");
    }
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val ?? "");
    this.children = [];
    this.childNodes = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = String(val ?? "");
    if (val === "") {
      this.children = [];
      this.childNodes = [];
      this._textContent = "";
    }
  }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === "id") this.id = String(v);
    if (k.startsWith("data-")) {
      const key = k.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      this.dataset[key] = String(v);
    }
  }
  getAttribute(k) {
    if (k.startsWith("data-")) {
      const key = k.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
      if (this.dataset[key] !== undefined) return this.dataset[key];
    }
    return this.attributes.get(k) ?? null;
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }

  appendChild(child) {
    if (child) {
      if (child.nodeType !== 3) {
        this.children.push(child);
      }
      this.childNodes.push(child);
      child.parentNode = this;
      if (child.id) {
        elementsById.set(child.id, child);
      }
    }
    return child;
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.childNodes = [];
    this._textContent = "";
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      const cIdx = this.parentNode.childNodes.indexOf(this);
      if (cIdx !== -1) this.parentNode.childNodes.splice(cIdx, 1);
      this.parentNode = null;
    }
  }

  addEventListener(type, fn) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(fn);
  }

  dispatchEvent(event) {
    if (!event.target) event.target = this;
    if (!event.currentTarget) event.currentTarget = this;
    if (!event.preventDefault) {
      event.preventDefault = function () {
        this.defaultPrevented = true;
      };
    }
    if (!event.stopPropagation) {
      event.stopPropagation = function () {
        this._propagationStopped = true;
      };
    }
    const list = this.eventListeners[event.type] || [];
    for (const fn of list) {
      fn.call(this, event);
      if (event._propagationStopped) break;
    }
    return !event.defaultPrevented;
  }

  focus() {
    global.document.activeElement = this;
  }

  select() {
    this._selected = true;
  }

  scrollIntoView() {
    this._scrolledIntoView = true;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (matchesSelector(curr, selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children || []) {
        if (matchesSelector(child, selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }
}

global.document = {
  activeElement: null,
  body: new MockElement("body"),
  documentElement: new MockElement("html"),
  createElement: (tag) => new MockElement(tag),
  createElementNS: (_ns, tag) => new MockElement(tag),
  createTextNode: (text) => ({ textContent: String(text), nodeType: 3 }),
  getElementById: (id) => elementsById.get(id) || null,
  querySelector: (sel) => {
    for (const el of elementsById.values()) {
      if (matchesSelector(el, sel)) return el;
      const found = el.querySelector(sel);
      if (found) return found;
    }
    return null;
  },
  querySelectorAll: (sel) => {
    const seen = new Set();
    const list = [];
    for (const el of elementsById.values()) {
      if (matchesSelector(el, sel) && !seen.has(el)) {
        seen.add(el);
        list.push(el);
      }
      for (const child of el.querySelectorAll(sel)) {
        if (!seen.has(child)) {
          seen.add(child);
          list.push(child);
        }
      }
    }
    return list;
  },
  addEventListener: () => {}
};

global.window = {
  location: { href: "chrome://newtab" },
  open: (url) => {
    global.window._lastOpenedUrl = url;
  },
  addEventListener: () => {}
};

global.chrome = {
  tabs: {
    create: (opts) => {
      global.chrome._lastCreatedTab = opts;
    }
  },
  runtime: {
    onMessage: {
      addListener: () => {}
    }
  }
};

function setupTestDomElements() {
  elementsById.clear();
  const ids = [
    "pinnedShelf",
    "pinnedShelfTitle",
    "pinnedShelfCount",
    "pinnedShelfIcon",
    "pinnedEmptyState",
    "pinnedEmptyText",
    "pinnedGrid",
    "togglePinnedExpandBtn",
    "togglePinnedExpandText",
    "openSearchBtn",
    "searchBtnIcon",
    "searchBtnText",
    "searchShortcutBadge",
    "searchOverlay",
    "searchDialog",
    "searchDialogTitle",
    "searchModalIcon",
    "searchInput",
    "closeSearchBtn",
    "closeSearchIcon",
    "searchSectionLabel",
    "searchResultsListbox",
    "searchEmptyState",
    "searchEmptyTitle",
    "searchEmptyDesc",
    "searchFooterNavHint",
    "searchShortcutSettingsBtn",
    "groupGrid",
    "categoryEmptyState",
    "activeCatTitle",
    "categoryTabs",
    "modalContainer"
  ];
  for (const id of ids) {
    const el = new MockElement("div");
    el.id = id;
  }
  const searchOverlay = elementsById.get("searchOverlay");
  searchOverlay.classList.add("modal-overlay", "search-overlay");
  const searchInput = elementsById.get("searchInput");
  searchInput.tagName = "INPUT";
}

// Import modules under test
const {
  loadWorkbenchData,
  deleteCategory,
  addGroup,
  deleteGroup,
  addLink,
  editLink,
  deleteLink,
  getPinnedLinks,
  pinLink,
  unpinLink,
  reorderPinnedLinks,
  recordLinkClick,
  getLinkMetricsMap,
  rawWrite,
  _resetMemoryStore
} = await import("../src/newtab/storage.js");

const { STORAGE_KEY } = await import("../src/newtab/constants.js");

const {
  MATCH_TIERS,
  searchBookmarks,
  getHighlightSegments,
  appendHighlightedText,
  evaluateSearchShortcut
} = await import("../src/newtab/search.js");

const {
  validateImportJson,
  exportBackup,
  executeImport,
  restoreBackup
} = await import("../src/newtab/import-export.js");

const { migrateFromChromeStorageIfNeeded } = await import("../src/newtab/migration.js");

const {
  state,
  createLinkItem,
  createPinnedCard,
  renderPinnedShelf,
  openSearchModal,
  handleSearchDialogKeydown,
  handleGlobalSearchKeydown
} = await import("../src/newtab/app.js");

// ===========================================================================
// 1. BMK-PIN-001: Pin, Unpin, Delete Sync, Edit Sync, and Pinned Ordering
// ===========================================================================
describe("BMK-PIN-001: Global Pinned Bookmarks Shelf", () => {
  beforeEach(() => {
    _resetMemoryStore();
    setupTestDomElements();
    state.isManageMode = false;
    state.isPinnedExpanded = false;
    state.expandedLinks.clear();
  });

  it("pins and unpins specific bookmark links, keeps original link in group, and prevents duplicate pinning", async () => {
    const data = await loadWorkbenchData();
    const cat1 = data.categories[0];
    const cat2 = data.categories[1];
    const g1 = await addGroup(data, cat1.id, "Frontend");
    const g2 = await addGroup(data, cat2.id, "Cloud Infra");

    const l1 = await addLink(data, g1.id, { name: "Vite Docs", url: "https://vitejs.dev", badge: "DEV" });
    const l2 = await addLink(data, g2.id, { name: "AWS Console", url: "https://console.aws.amazon.com", badge: "PROD" });

    // Pin l1 and l2 across different categories
    const pinned1 = await pinLink(data, l1.id, l1.revision);
    assert.equal(pinned1.pinned, true);
    assert.equal(pinned1.pinnedOrder, 1);

    const pinned2 = await pinLink(data, l2.id, l2.revision);
    assert.equal(pinned2.pinned, true);
    assert.equal(pinned2.pinnedOrder, 2);

    // Re-pinning an already-pinned link is idempotent and does not duplicate
    const pinned1Again = await pinLink(data, l1.id);
    assert.equal(pinned1Again.id, l1.id);
    assert.equal(getPinnedLinks(data).length, 2, "Each link can only be pinned once");

    // Original links remain in their original groups (no data duplication)
    assert.equal(data.links.length, 2);
    assert.equal(data.links.find((l) => l.id === l1.id).groupId, g1.id);
    assert.equal(data.links.find((l) => l.id === l2.id).groupId, g2.id);

    // Pinned Shelf is globally visible across category switches
    state.data = data;
    state.activeCategoryId = cat1.id;
    renderPinnedShelf();
    assert.equal(elementsById.get("pinnedShelfCount").textContent, "2");

    state.activeCategoryId = cat2.id;
    renderPinnedShelf();
    assert.equal(elementsById.get("pinnedShelfCount").textContent, "2");

    // Unpin l1
    const unpinned1 = await unpinLink(data, l1.id, pinned1Again.revision);
    assert.equal(unpinned1.pinned, false);
    assert.equal(unpinned1.pinnedOrder, null);
    assert.deepEqual(
      getPinnedLinks(data).map((l) => l.id),
      [l2.id]
    );
  });

  it("automatically reflects edited link title, URL, and badge in Pinned Shelf while preserving pin state & order", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Core");
    const l1 = await addLink(data, grp.id, { name: "Old Name", url: "https://old.example.com", badge: "DEV" });
    const l2 = await addLink(data, grp.id, { name: "Second Link", url: "https://second.example.com" });

    await pinLink(data, l1.id);
    await pinLink(data, l2.id);

    const currentL1 = data.links.find((l) => l.id === l1.id);
    const updated = await editLink(
      data,
      l1.id,
      { name: "New Dashboard", url: "https://new.example.com/app", badge: "PROD" },
      currentL1.revision
    );

    assert.equal(updated.pinned, true, "Editing a link must preserve pinned status");
    assert.equal(updated.pinnedOrder, 1, "Editing a link must preserve pinnedOrder");

    state.data = data;
    const card = createPinnedCard(updated, grp);
    assert.equal(card.querySelector(".pinned-title").textContent, "New Dashboard");
    assert.equal(card.querySelector(".pinned-domain").textContent, "new.example.com");
    assert.equal(card.querySelector(".pinned-group-pill").textContent, "Core");
    assert.equal(card.querySelector(".link-badge").textContent, "PROD");
  });

  it("synchronously removes pinned entries when original link, parent group, or category is deleted", async () => {
    const data = await loadWorkbenchData();
    const cat1 = data.categories[0];
    const cat2 = data.categories[1];
    const g1 = await addGroup(data, cat1.id, "Group 1");
    const g2 = await addGroup(data, cat1.id, "Group 2");
    const g3 = await addGroup(data, cat2.id, "Group 3");

    const l1 = await addLink(data, g1.id, { name: "Link 1", url: "https://one.example.com" });
    const l2 = await addLink(data, g2.id, { name: "Link 2", url: "https://two.example.com" });
    const l3 = await addLink(data, g3.id, { name: "Link 3", url: "https://three.example.com" });

    await pinLink(data, l1.id);
    await pinLink(data, l2.id);
    await pinLink(data, l3.id);
    assert.equal(getPinnedLinks(data).length, 3);

    // 1. Direct link deletion removes from pinned
    await deleteLink(data, l1.id);
    assert.deepEqual(
      getPinnedLinks(data).map((l) => l.id),
      [l2.id, l3.id]
    );

    // 2. Group deletion removes its pinned links
    await deleteGroup(data, g2.id);
    assert.deepEqual(
      getPinnedLinks(data).map((l) => l.id),
      [l3.id]
    );

    // 3. Category deletion removes its groups and pinned links
    await deleteCategory(data, cat2.id);
    assert.equal(getPinnedLinks(data).length, 0);
  });

  it("reorders pinned links atomically via storage and keyboard in Manage Mode", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Tools");
    const l1 = await addLink(data, grp.id, { name: "Alpha", url: "https://alpha.example.com" });
    const l2 = await addLink(data, grp.id, { name: "Beta", url: "https://beta.example.com" });
    const l3 = await addLink(data, grp.id, { name: "Gamma", url: "https://gamma.example.com" });

    await pinLink(data, l1.id);
    await pinLink(data, l2.id);
    await pinLink(data, l3.id);

    assert.deepEqual(
      getPinnedLinks(data).map((l) => l.name),
      ["Alpha", "Beta", "Gamma"]
    );

    // Reorder to [Gamma, Alpha, Beta]
    await reorderPinnedLinks(data, [l3.id, l1.id, l2.id]);
    const reordered = getPinnedLinks(data);
    assert.deepEqual(
      reordered.map((l) => l.name),
      ["Gamma", "Alpha", "Beta"]
    );
    assert.deepEqual(
      reordered.map((l) => l.pinnedOrder),
      [1, 2, 3]
    );

    // Verify revision incremented for concurrency protection
    assert.ok(reordered[0].revision >= 3);
  });
});

// ===========================================================================
// 2. BMK-SEARCH-001: Cross-Category Search, Matching & 6-Tier Ranking
// ===========================================================================
describe("BMK-SEARCH-001: Centralized Search & Ranking Priority", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("searches across ALL categories covering Title, Full URL, Hostname, URL Path, Group, Category, and Badge", async () => {
    const data = await loadWorkbenchData();
    const workCat = data.categories[0];
    const personalCat = data.categories[1];
    const toolsCat = data.categories[2];

    const gBackend = await addGroup(data, workCat.id, "Backend Microservices");
    const gReading = await addGroup(data, personalCat.id, "Reading List");
    const gCluster = await addGroup(data, toolsCat.id, "Kubernetes Cluster");

    await addLink(data, gBackend.id, {
      name: "Laravel Documentation",
      url: "https://laravel.com/docs/11.x/routing",
      badge: "DEV"
    });
    await addLink(data, gReading.id, {
      name: "System Design Primer",
      url: "https://github.com/donnemartin/system-design-primer",
      badge: "LOCAL"
    });
    await addLink(data, gCluster.id, {
      name: "Grafana Metrics",
      url: "https://monitoring.internal.corp:8443/d/k8s-nodes/cluster-overview",
      badge: "PROD"
    });

    // 1. Multi-keyword case-insensitive + trimmed query ("  lar DOC  " -> "Laravel Documentation")
    const rMulti = searchBookmarks(data, "  lar DOC  ").results;
    assert.equal(rMulti.length, 1);
    assert.equal(rMulti[0].link.name, "Laravel Documentation");

    // 2. Hostname match ("monitoring.internal.corp")
    const rHost = searchBookmarks(data, "monitoring.internal.corp").results;
    assert.equal(rHost.length, 1);
    assert.equal(rHost[0].link.name, "Grafana Metrics");
    assert.equal(rHost[0].tier, MATCH_TIERS.DOMAIN);

    // 3. URL path match ("k8s-nodes")
    const rPath = searchBookmarks(data, "k8s-nodes").results;
    assert.equal(rPath.length, 1);
    assert.equal(rPath[0].link.name, "Grafana Metrics");
    assert.equal(rPath[0].tier, MATCH_TIERS.URL_PATH);

    // 4. Group match ("Microservices")
    const rGroup = searchBookmarks(data, "Microservices").results;
    assert.equal(rGroup.length, 1);
    assert.equal(rGroup[0].link.name, "Laravel Documentation");
    assert.equal(rGroup[0].tier, MATCH_TIERS.META);

    // 5. Category match ("Company Management")
    const rCat = searchBookmarks(data, "Company Management").results;
    assert.equal(rCat.length, 1);
    assert.equal(rCat[0].link.name, "System Design Primer");
    assert.equal(rCat[0].tier, MATCH_TIERS.META);

    // 6. Badge match ("PROD")
    const rBadge = searchBookmarks(data, "PROD").results;
    assert.equal(rBadge.length, 1);
    assert.equal(rBadge[0].link.name, "Grafana Metrics");
    assert.equal(rBadge[0].tier, MATCH_TIERS.META);
  });

  it("enforces strict 6-tier ranking priority and prioritizes Pinned links at equal match tier", async () => {
    const data = await loadWorkbenchData();
    const cat = data.categories[0];
    const gOther = await addGroup(data, cat.id, "General");
    const gApi = await addGroup(data, cat.id, "api");

    // Create 6 links that each match the query "api" at a different tier:
    // Tier 6: Group/Category/Badge match
    const lTier6 = await addLink(data, gApi.id, {
      name: "Service Catalog",
      url: "https://catalog.example.com/home"
    });
    // Tier 5: URL path match
    const lTier5 = await addLink(data, gOther.id, {
      name: "Customer Portal",
      url: "https://portal.example.com/v2/api/endpoints"
    });
    // Tier 4: Domain match
    const lTier4 = await addLink(data, gOther.id, {
      name: "Developer Gateway",
      url: "https://api.example.com/overview"
    });
    // Tier 3: Title contains match
    const lTier3 = await addLink(data, gOther.id, {
      name: "Core API Reference",
      url: "https://docs.example.com/ref"
    });
    // Tier 2: Title prefix match (unpinned)
    const lTier2Unpinned = await addLink(data, gOther.id, {
      name: "API Explorer Unpinned",
      url: "https://docs.example.com/explorer-a"
    });
    // Tier 2: Title prefix match (pinned -> must beat lTier2Unpinned)
    const lTier2Pinned = await addLink(data, gOther.id, {
      name: "API Explorer Pinned",
      url: "https://docs.example.com/explorer-b"
    });
    await pinLink(data, lTier2Pinned.id);

    // Tier 1: Title exact match
    const lTier1 = await addLink(data, gOther.id, {
      name: "API",
      url: "https://docs.example.com/root"
    });

    const { results } = searchBookmarks(data, "api");
    assert.deepEqual(
      results.map((r) => r.link.id),
      [
        lTier1.id,         // 1. Title exact match
        lTier2Pinned.id,   // 2. Title prefix match (Pinned first!)
        lTier2Unpinned.id, // 3. Title prefix match (Unpinned)
        lTier3.id,         // 4. Title contains
        lTier4.id,         // 5. Domain match
        lTier5.id,         // 6. URL path match
        lTier6.id          // 7. Group/Category/Badge match
      ]
    );
  });

  it("returns Pinned items and Recently Used items on empty query, and highlights matched characters safely", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Dev");
    const lPinned = await addLink(data, grp.id, { name: "Pinned App", url: "https://pinned.example.com" });
    const lRecent = await addLink(data, grp.id, { name: "Recent App", url: "https://recent.example.com" });
    await addLink(data, grp.id, { name: "Cold App", url: "https://cold.example.com" });

    await pinLink(data, lPinned.id);
    await recordLinkClick(lRecent.id);
    const linkMetricsMap = await getLinkMetricsMap();

    const emptySearch = searchBookmarks(data, "", { linkMetricsMap });
    assert.equal(emptySearch.isEmptyQuery, true);
    assert.equal(emptySearch.results.length, 2, "Empty query shows pinned and recently used items");
    assert.equal(emptySearch.results[0].link.id, lPinned.id);
    assert.equal(emptySearch.results[0].section, "pinned");
    assert.equal(emptySearch.results[1].link.id, lRecent.id);
    assert.equal(emptySearch.results[1].section, "recent");

    // Highlight segments test
    const segments = getHighlightSegments("Laravel Documentation", ["lar", "doc"]);
    const matchedTexts = segments.filter((s) => s.highlight).map((s) => s.text);
    assert.deepEqual(matchedTexts, ["Lar", "Doc"]);

    // Safe DOM highlight builder (no innerHTML injection)
    const container = new MockElement("span");
    appendHighlightedText(container, "<script>alert(1)</script> Laravel", ["lar"]);
    assert.equal(container.innerHTML, "", "Must never use innerHTML");
    const mark = container.querySelector("mark");
    assert.ok(mark, "Must create <mark> element for matched substring");
    assert.equal(mark.textContent, "Lar");
  });
});

// ===========================================================================
// 3. BMK-SEARCH-001: Shortcuts, Esc, Arrow Navigation, Enter & Focus Restore
// ===========================================================================
describe("BMK-SEARCH-001: Keyboard Shortcuts, Dialog Navigation & Focus Restoration", () => {
  beforeEach(() => {
    _resetMemoryStore();
    setupTestDomElements();
    state.isSearchOpen = false;
    state.searchSelectedIndex = 0;
    state.searchTriggerElement = null;
    global.window.location.href = "chrome://newtab";
    global.chrome._lastCreatedTab = null;
  });

  it("evaluates Ctrl+K, Command+K, and '/' shortcuts while ignoring '/' inside editable inputs", () => {
    const inputEl = new MockElement("input");
    assert.deepEqual(
      evaluateSearchShortcut(
        { key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, target: inputEl },
        { activeElement: inputEl }
      ),
      { shouldOpen: true, trigger: "ctrl+k", preventDefault: true }
    );

    // Command+K on macOS opens search
    assert.deepEqual(
      evaluateSearchShortcut(
        { key: "k", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false, target: inputEl },
        { activeElement: inputEl }
      ),
      { shouldOpen: true, trigger: "cmd+k", preventDefault: true }
    );

    // '/' on non-editable element opens search
    const buttonEl = new MockElement("button");
    assert.deepEqual(
      evaluateSearchShortcut(
        { key: "/", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: buttonEl },
        { activeElement: buttonEl }
      ),
      { shouldOpen: true, trigger: "slash", preventDefault: true }
    );

    // '/' inside <input>, <textarea>, or contenteditable MUST NOT open search
    const textareaEl = new MockElement("textarea");
    const editableDiv = new MockElement("div");
    editableDiv.isContentEditable = true;

    assert.equal(
      evaluateSearchShortcut({ key: "/", ctrlKey: false, metaKey: false, target: inputEl }, { activeElement: inputEl })
        .shouldOpen,
      false
    );
    assert.equal(
      evaluateSearchShortcut(
        { key: "/", ctrlKey: false, metaKey: false, target: textareaEl },
        { activeElement: textareaEl }
      ).shouldOpen,
      false
    );
    assert.equal(
      evaluateSearchShortcut(
        { key: "/", ctrlKey: false, metaKey: false, target: editableDiv },
        { activeElement: editableDiv }
      ).shouldOpen,
      false
    );
  });

  it("supports ArrowDown/ArrowUp selection, Enter current-tab open, Ctrl/Cmd+Enter new-tab open, Esc close, and restores focus", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Core");
    const l1 = await addLink(data, grp.id, { name: "First Service", url: "https://first.example.com" });
    const l2 = await addLink(data, grp.id, { name: "Second Service", url: "https://second.example.com" });
    await pinLink(data, l1.id);
    await pinLink(data, l2.id);

    state.data = data;

    // Focus trigger button before opening search
    const triggerBtn = elementsById.get("openSearchBtn");
    triggerBtn.focus();
    assert.equal(global.document.activeElement, triggerBtn);

    // Open search via global shortcut handler
    let prevented = false;
    handleGlobalSearchKeydown({
      key: "k",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      target: triggerBtn,
      preventDefault() {
        prevented = true;
      }
    });

    assert.equal(prevented, true, "Ctrl+K must call preventDefault()");
    assert.equal(state.isSearchOpen, true, "Search modal must be open");
    assert.equal(
      global.document.activeElement,
      elementsById.get("searchInput"),
      "Search input must receive focus immediately upon opening"
    );

    // Wait for async refreshSearchResults inside openSearchModal
    await openSearchModal("", triggerBtn);
    assert.equal(state.searchResults.length, 2);
    assert.equal(state.searchSelectedIndex, 0);

    // ArrowDown moves selection to index 1
    handleSearchDialogKeydown({
      key: "ArrowDown",
      preventDefault() {},
      stopPropagation() {}
    });
    assert.equal(state.searchSelectedIndex, 1);
    assert.equal(elementsById.get("searchInput").getAttribute("aria-activedescendant"), "search-option-1");

    // ArrowUp moves selection back to index 0
    handleSearchDialogKeydown({
      key: "ArrowUp",
      preventDefault() {},
      stopPropagation() {}
    });
    assert.equal(state.searchSelectedIndex, 0);

    // Ctrl+Enter opens selected result in new background tab
    handleSearchDialogKeydown({
      key: "Enter",
      ctrlKey: true,
      metaKey: false,
      preventDefault() {},
      stopPropagation() {}
    });
    assert.equal(global.chrome._lastCreatedTab.url, "https://first.example.com");
    assert.equal(state.isSearchOpen, false, "Search closes after opening result");
    assert.equal(global.document.activeElement, triggerBtn, "Focus restored to trigger element on close");

    // Re-open, select second result, press Enter for current tab navigation
    await openSearchModal("", triggerBtn);
    handleSearchDialogKeydown({
      key: "ArrowDown",
      preventDefault() {},
      stopPropagation() {}
    });
    handleSearchDialogKeydown({
      key: "Enter",
      ctrlKey: false,
      metaKey: false,
      preventDefault() {},
      stopPropagation() {}
    });
    assert.equal(global.window.location.href, "https://second.example.com");

    // Re-open and close with Escape
    await openSearchModal("", triggerBtn);
    assert.equal(state.isSearchOpen, true);
    handleSearchDialogKeydown({
      key: "Escape",
      preventDefault() {},
      stopPropagation() {}
    });
    assert.equal(state.isSearchOpen, false);
    assert.equal(global.document.activeElement, triggerBtn, "Esc restores focus to trigger element");
  });
});

// ===========================================================================
// 4. BMK-HIT-001: Expanded Click Area & Action Button Isolation
// ===========================================================================
describe("BMK-HIT-001: Expanded Bookmark Row Click Area & Action Button Isolation", () => {
  beforeEach(() => {
    _resetMemoryStore();
    setupTestDomElements();
    state.isManageMode = false;
    state.expandedLinks.clear();
    global.window.location.href = "chrome://newtab";
    global.chrome._lastCreatedTab = null;
  });

  it("navigates when clicking anywhere in the primary row area (title, URL summary, or row whitespace), but NOT in Manage Mode", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Platform");
    const link = await addLink(data, grp.id, {
      name: "Production Logs",
      url: "https://logs.example.com/stream",
      badge: "PROD"
    });
    state.data = data;

    const item = createLinkItem(link, grp);
    const linkRow = item.querySelector(".link-row");
    const urlSummary = item.querySelector(".link-url-summary");
    assert.ok(urlSummary, "Row must display hostname summary inside clickable area");
    assert.equal(urlSummary.textContent, "logs.example.com");

    // Clicking on row whitespace (outside the <a> tag directly on .link-row) navigates in normal mode
    linkRow.dispatchEvent({
      type: "click",
      target: linkRow,
      ctrlKey: false,
      metaKey: false
    });
    assert.equal(global.window.location.href, "https://logs.example.com/stream");

    // In Manage Mode, clicking the row or anchor must NOT navigate
    global.window.location.href = "chrome://newtab";
    state.isManageMode = true;
    const anchor = item.querySelector(".link-anchor");
    anchor.dispatchEvent({
      type: "click",
      target: anchor,
      ctrlKey: false,
      metaKey: false
    });
    linkRow.dispatchEvent({
      type: "click",
      target: linkRow,
      ctrlKey: false,
      metaKey: false
    });
    assert.equal(global.window.location.href, "chrome://newtab", "Manage mode must prevent navigation");
  });

  it("clicking Pin, Expand, Edit, or Delete buttons stops propagation and NEVER triggers link navigation", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Platform");
    const link = await addLink(data, grp.id, {
      name: "Production Logs",
      url: "https://logs.example.com/stream"
    });
    state.data = data;

    const item = createLinkItem(link, grp);
    const pinBtn = item.querySelector(".link-pin-btn");
    const expandBtn = item.querySelector(".link-expand-btn");
    assert.ok(pinBtn, "Pin button must exist on bookmark row");
    assert.ok(expandBtn, "Expand button must exist on bookmark row");

    // Click Pin button
    const pinEvt = { type: "click", target: pinBtn };
    pinBtn.dispatchEvent(pinEvt);
    assert.equal(pinEvt.defaultPrevented, true);
    assert.equal(pinEvt._propagationStopped, true);
    assert.equal(global.window.location.href, "chrome://newtab", "Pin click must not navigate");

    // Click Expand button
    const expandEvt = { type: "click", target: expandBtn };
    expandBtn.dispatchEvent(expandEvt);
    assert.equal(expandEvt.defaultPrevented, true);
    assert.equal(expandEvt._propagationStopped, true);
    assert.equal(global.window.location.href, "chrome://newtab", "Expand click must not navigate");

    // In Manage Mode, Edit & Delete buttons exist and stop propagation
    state.isManageMode = true;
    const manageItem = createLinkItem(link, grp);
    const manageActions = manageItem.querySelector(".link-manage-actions");
    const manageBtns = manageActions ? manageActions.querySelectorAll(".btn-icon") : [];
    assert.equal(manageBtns.length, 2, "Edit and Delete buttons must exist in Manage Mode");

    for (const btn of manageBtns) {
      const evt = { type: "click", target: btn };
      btn.dispatchEvent(evt);
      assert.equal(evt.defaultPrevented, true);
      assert.equal(evt._propagationStopped, true);
      assert.equal(global.window.location.href, "chrome://newtab", "Manage action click must not navigate");
    }
  });
});

// ===========================================================================
// 5. Legacy Data Upgrade Compatibility
// ===========================================================================
describe("Data Compatibility: Legacy Data Upgrade", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("loads and migrates legacy bookmark data without pinned fields cleanly and supports pinning after upgrade", async () => {
    await rawWrite(STORAGE_KEY, {
      categories: [{ id: "cat_legacy", name: "Legacy Work" }],
      groups: [{ id: "grp_legacy", categoryId: "cat_legacy", name: "Legacy Group" }],
      links: [
        {
          id: "lnk_legacy_1",
          groupId: "grp_legacy",
          name: "Legacy Portal",
          url: "https://legacy.example.com",
          badge: "PROD"
        }
      ],
      activeCategoryId: "cat_legacy"
    });

    const migResult = await migrateFromChromeStorageIfNeeded();
    assert.equal(migResult.migrated, true);

    const data = await loadWorkbenchData();
    assert.equal(data.links.length, 1);
    assert.equal(data.links[0].name, "Legacy Portal");
    assert.equal(getPinnedLinks(data).length, 0);

    // Can pin the upgraded legacy link seamlessly
    const pinned = await pinLink(data, "lnk_legacy_1");
    assert.equal(pinned.pinned, true);
    assert.equal(getPinnedLinks(data).length, 1);
  });
});

// ===========================================================================
// 6. Full Backup Restore vs. Normal Append Import Pinned Rules
// ===========================================================================
describe("Backup & Import Pinned Rules (BMK-PIN-001 Rules 10 & 11)", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("full backup export and restore preserves pinned status and exact pinnedOrder", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Core");
    const l1 = await addLink(data, grp.id, { name: "One", url: "https://one.example.com" });
    const l2 = await addLink(data, grp.id, { name: "Two", url: "https://two.example.com" });
    const l3 = await addLink(data, grp.id, { name: "Three", url: "https://three.example.com" });

    // Pin l3 first (order 1), then l1 (order 2); leave l2 unpinned
    await pinLink(data, l3.id);
    await pinLink(data, l1.id);

    const backup = await exportBackup();
    assert.equal(validateImportJson(backup).valid, true);

    const exportedL3 = backup.links.find((l) => l.name === "Three");
    const exportedL1 = backup.links.find((l) => l.name === "One");
    const exportedL2 = backup.links.find((l) => l.name === "Two");
    assert.equal(exportedL3.pinned, true);
    assert.equal(exportedL3.pinnedOrder, 1);
    assert.equal(exportedL1.pinned, true);
    assert.equal(exportedL1.pinnedOrder, 2);
    assert.equal(exportedL2.pinned, undefined);

    // Restore backup into a fresh database
    _resetMemoryStore();
    await loadWorkbenchData();
    await restoreBackup({ backupData: backup, fileName: "full-backup.json" });

    const restoredData = await loadWorkbenchData();
    const restoredPinned = getPinnedLinks(restoredData);
    assert.deepEqual(
      restoredPinned.map((l) => l.name),
      ["Three", "One"],
      "Full backup restore must preserve pinned items and their exact order"
    );
  });

  it("normal append import does NOT auto-pin imported links and does NOT disrupt existing pinned links", async () => {
    const data = await loadWorkbenchData();
    const grp = await addGroup(data, data.categories[0].id, "Existing Group");
    const existingLink = await addLink(data, grp.id, {
      name: "My Existing Pinned Link",
      url: "https://existing.example.com"
    });
    await pinLink(data, existingLink.id);

    // External import file where links have pinned: true
    const externalImport = {
      formatVersion: 1,
      categories: [{ id: "ext_c", name: "Work" }],
      groups: [{ id: "ext_g", categoryId: "ext_c", name: "Imported Group" }],
      links: [
        {
          id: "ext_l1",
          groupId: "ext_g",
          name: "Imported Link With Pin Flag",
          url: "https://imported.example.com",
          pinned: true,
          pinnedOrder: 1
        }
      ]
    };

    // Normal append import (default preservePinned = false)
    await executeImport({ importData: externalImport, fileName: "append.json" });

    const afterAppend = await loadWorkbenchData();
    const pinnedAfter = getPinnedLinks(afterAppend);
    assert.equal(pinnedAfter.length, 1, "Normal append import must not auto-pin imported links");
    assert.equal(pinnedAfter[0].id, existingLink.id, "Existing pinned link must remain intact");

    const importedLink = afterAppend.links.find((l) => l.url === "https://imported.example.com");
    assert.ok(importedLink);
    assert.equal(Boolean(importedLink.pinned), false);
  });
});
