import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Setup global mock DOM before importing app
let elementsById = new Map();
let querySelectors = [];

class MockClassList {
  constructor() {
    this._set = new Set();
  }
  add(...classes) {
    classes.forEach((c) => this._set.add(c));
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

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
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
  }

  get id() {
    return this._id;
  }
  set id(val) {
    this._id = val;
    elementsById.set(val, this);
  }

  get className() {
    return this.classList.value;
  }
  set className(val) {
    this.classList._set.clear();
    if (val) {
      val.split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
    }
  }

  get textContent() {
    return this._textContent;
  }
  set textContent(val) {
    this._textContent = String(val);
    this.children = [];
    this.childNodes = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(val) {
    this._innerHTML = val;
  }

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === "id") this.id = String(v);
  }
  getAttribute(k) {
    return this.attributes.get(k) || null;
  }
  removeAttribute(k) {
    this.attributes.delete(k);
  }

  appendChild(child) {
    if (child) {
      this.children.push(child);
      this.childNodes.push(child);
      child.parentNode = this;
    }
    return child;
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
    const list = this.eventListeners[event.type] || [];
    for (const fn of list) {
      fn.call(this, event);
      if (event._propagationStopped) break;
    }
    return !event.defaultPrevented;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
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

function matchesSelector(el, selector) {
  if (selector.startsWith(".")) {
    const cls = selector.slice(1);
    return el.classList.contains(cls);
  }
  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    return el.id === id;
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

global.document = {
  createElement: (tag) => new MockElement(tag),
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
    const list = [];
    for (const el of elementsById.values()) {
      if (matchesSelector(el, sel)) list.push(el);
      list.push(...el.querySelectorAll(sel));
    }
    return list;
  },
  addEventListener: () => {}
};

global.window = {
  location: { href: "" },
  open: () => {}
};

global.chrome = {
  tabs: {
    create: () => {}
  }
};

const {
  state,
  getDomainInitial,
  loadFaviconOnDemand,
  createGroupCard,
  createLinkItem,
  updateGroupLinksExpandState
} = await import("../src/newtab/app.js");

describe("Bookmark Organizer - Expandable Link Details (VIEW-LINK-001)", () => {
  beforeEach(() => {
    elementsById.clear();
    state.expandedLinks.clear();
    state.isManageMode = false;
    global.window.location.href = "";
  });

  it("extracts clean domain initial for favicon placeholder fallback", () => {
    assert.equal(getDomainInitial("google.com"), "G");
    assert.equal(getDomainInitial("www.github.com"), "G");
    assert.equal(getDomainInitial("api.internal.corp"), "A");
    assert.equal(getDomainInitial("37signals.com"), "3");
    assert.equal(getDomainInitial("https://developer.mozilla.org"), "D");
    assert.equal(getDomainInitial(""), "?");
    assert.equal(getDomainInitial(null), "?");
  });

  it("renders collapsed link item by default with accessible expand control", () => {
    const group = { id: "grp_1", name: "Engineering" };
    const link = {
      id: "lnk_1",
      groupId: "grp_1",
      name: "GitHub Repository",
      url: "https://github.com/ouki0331/PowerLessToy-Chrome",
      badge: "Prod"
    };

    const linkItem = createLinkItem(link, group);

    const anchor = linkItem.querySelector(".link-anchor");
    assert.ok(anchor, "Anchor element must exist");
    assert.equal(anchor.href, link.url);

    const badge = anchor.querySelector(".link-badge");
    assert.ok(badge, "Badge element must exist in anchor");
    assert.equal(badge.textContent, "Prod");

    const expandBtn = linkItem.querySelector(".link-expand-btn");
    assert.ok(expandBtn, "Expand button must exist");
    assert.equal(expandBtn.getAttribute("aria-expanded"), "false");
    assert.equal(expandBtn.getAttribute("aria-controls"), "link-details-lnk_1");

    const panel = linkItem.querySelector(".link-details-panel");
    assert.ok(panel, "Details panel must exist");
    assert.equal(panel.id, "link-details-lnk_1");
    assert.equal(panel.classList.contains("is-expanded"), false, "Must be collapsed by default");

    const host = panel.querySelector(".link-detail-host");
    assert.equal(host.textContent, "github.com");

    const placeholder = panel.querySelector(".link-favicon-placeholder");
    assert.equal(placeholder.textContent, "G");
  });

  it("clicking link title triggers navigation and does NOT toggle expansion (OPEN-LINK-001)", () => {
    const group = { id: "grp_1", name: "Engineering" };
    const link = {
      id: "lnk_1",
      groupId: "grp_1",
      name: "GitHub Repository",
      url: "https://github.com/ouki0331/PowerLessToy-Chrome"
    };

    const linkItem = createLinkItem(link, group);
    const anchor = linkItem.querySelector(".link-anchor");

    let navEvent = {
      type: "click",
      ctrlKey: false,
      metaKey: false,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    anchor.dispatchEvent(navEvent);

    assert.equal(global.window.location.href, link.url, "Must navigate on title click");
    assert.equal(state.expandedLinks.has(group.id), false, "Must not expand on title click");

    // Test Ctrl-click for new tab
    let newTabUrl = null;
    global.chrome.tabs.create = (opts) => {
      newTabUrl = opts.url;
    };

    let ctrlEvent = {
      type: "click",
      ctrlKey: true,
      metaKey: false,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    anchor.dispatchEvent(ctrlEvent);

    assert.equal(newTabUrl, link.url, "Must open in background tab on Ctrl-click");
    assert.equal(state.expandedLinks.has(group.id), false, "Must not expand on Ctrl-click");
  });

  it("clicking expand button toggles expansion without triggering navigation", () => {
    const group = { id: "grp_1", name: "Engineering" };
    const link = {
      id: "lnk_1",
      groupId: "grp_1",
      name: "GitHub Repository",
      url: "https://github.com/ouki0331/PowerLessToy-Chrome"
    };

    const linkItem = createLinkItem(link, group);
    const expandBtn = linkItem.querySelector(".link-expand-btn");

    global.window.location.href = "chrome://newtab";
    let expandEvent = {
      type: "click",
      defaultPrevented: false,
      _propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this._propagationStopped = true;
      }
    };

    expandBtn.dispatchEvent(expandEvent);

    assert.equal(expandEvent.defaultPrevented, true, "Must prevent default");
    assert.equal(expandEvent._propagationStopped, true, "Must stop propagation");
    assert.equal(global.window.location.href, "chrome://newtab", "Must not change page URL");
    assert.equal(state.expandedLinks.get(group.id), "lnk_1", "Link must be marked expanded in group");
  });

  it("enforces at most 1 expanded link per group (expanding second collapses first)", () => {
    const group = { id: "grp_1", name: "Engineering" };
    const linkA = { id: "lnk_A", groupId: "grp_1", name: "Link A", url: "https://a.test" };
    const linkB = { id: "lnk_B", groupId: "grp_1", name: "Link B", url: "https://b.test" };

    state.data = { links: [linkA, linkB] };

    const card = createGroupCard(group);
    const itemA = card.querySelector('[data-link-id="lnk_A"]');
    const itemB = card.querySelector('[data-link-id="lnk_B"]');

    const btnA = itemA.querySelector(".link-expand-btn");
    const btnB = itemB.querySelector(".link-expand-btn");

    const click = (target) => {
      target.dispatchEvent({
        type: "click",
        preventDefault() {},
        stopPropagation() {}
      });
    };

    // 1. Expand Link A
    click(btnA);
    assert.equal(state.expandedLinks.get(group.id), "lnk_A");
    assert.equal(btnA.getAttribute("aria-expanded"), "true");
    assert.equal(itemA.querySelector(".link-details-panel").classList.contains("is-expanded"), true);
    assert.equal(btnB.getAttribute("aria-expanded"), "false");
    assert.equal(itemB.querySelector(".link-details-panel").classList.contains("is-expanded"), false);

    // 2. Expand Link B (Link A must collapse automatically)
    click(btnB);
    assert.equal(state.expandedLinks.get(group.id), "lnk_B");
    assert.equal(btnB.getAttribute("aria-expanded"), "true");
    assert.equal(itemB.querySelector(".link-details-panel").classList.contains("is-expanded"), true);
    assert.equal(btnA.getAttribute("aria-expanded"), "false", "Link A must now be collapsed");
    assert.equal(itemA.querySelector(".link-details-panel").classList.contains("is-expanded"), false);

    // 3. Click Link B again to collapse all in group
    click(btnB);
    assert.equal(state.expandedLinks.has(group.id), false, "All links in group now collapsed");
    assert.equal(btnB.getAttribute("aria-expanded"), "false");
    assert.equal(itemB.querySelector(".link-details-panel").classList.contains("is-expanded"), false);
  });

  it("supports expanding one link independently across different groups", () => {
    const group1 = { id: "grp_1", name: "Frontend" };
    const group2 = { id: "grp_2", name: "Backend" };

    const link1 = { id: "lnk_1", groupId: "grp_1", name: "React", url: "https://react.dev" };
    const link2 = { id: "lnk_2", groupId: "grp_2", name: "Node", url: "https://nodejs.org" };

    state.data = { links: [link1, link2] };

    const card1 = createGroupCard(group1);
    const card2 = createGroupCard(group2);

    const btn1 = card1.querySelector(".link-expand-btn");
    const btn2 = card2.querySelector(".link-expand-btn");

    const click = (target) => {
      target.dispatchEvent({
        type: "click",
        preventDefault() {},
        stopPropagation() {}
      });
    };

    click(btn1);
    click(btn2);

    assert.equal(state.expandedLinks.get("grp_1"), "lnk_1");
    assert.equal(state.expandedLinks.get("grp_2"), "lnk_2");
    assert.equal(btn1.getAttribute("aria-expanded"), "true");
    assert.equal(btn2.getAttribute("aria-expanded"), "true");
  });

  it("lazy loads favicon strictly from local origin on-demand (no 3rd-party aggregators)", () => {
    const panel = new MockElement("div");
    panel.className = "link-details-panel";

    const container = new MockElement("div");
    container.className = "link-favicon-container";

    const placeholder = new MockElement("div");
    placeholder.className = "link-favicon-placeholder";
    placeholder.textContent = "G";
    container.appendChild(placeholder);
    panel.appendChild(container);

    const targetUrl = "https://github.com/ouki0331/PowerLessToy-Chrome/tree/main";

    // 1. Initial state: no image element
    assert.equal(container.children.length, 1);
    assert.equal(container.dataset.loaded, undefined);

    // 2. Load on demand
    loadFaviconOnDemand(panel, targetUrl);

    assert.equal(container.dataset.loaded, "true");
    const img = container.children.find((c) => c.className === "link-favicon-img");
    assert.ok(img, "Favicon img must be created on-demand");

    // Strictly local origin request check
    assert.equal(img.src, "https://github.com/favicon.ico");
    assert.ok(!img.src.includes("google.com/s2"), "Must NOT use Google favicon aggregator");
    assert.ok(!img.src.includes("duckduckgo"), "Must NOT use DuckDuckGo favicon service");
    assert.ok(!img.src.includes("icon.horse"), "Must NOT use Icon Horse or other third party");

    // Test error handling: img error removes img, keeping placeholder intact
    img.onerror();
    assert.equal(container.children.includes(img), false, "Failed img must be cleanly removed");
    assert.equal(placeholder.textContent, "G", "Placeholder initial remains displayed");
  });
});
