/**
 * Global Aggregated Palette & Quick Page Capture (CMD-SEARCH-001 & BMK-CAPTURE-001)
 *
 * Implements:
 * - Omnipresent popup entry via Ctrl/Cmd+Shift+K or extension action icon.
 * - Single continuous stream: Commands listed first, Bookmarks listed second.
 * - Scope toggling: Ctrl/Cmd+Shift+K toggles between "all" and "bookmarks".
 * - Quick Page Capture with URL tracking cleaner, Group combobox, and Duplicate detection.
 * - Full keyboard navigation (ArrowUp/Down, Enter, Ctrl/Cmd+Enter, Esc).
 * - Safe restricted-page detection without crashing.
 */

import {
  loadWorkbenchData,
  addLink,
  cleanTrackingUrl,
  findDuplicateLink,
  filterGroupsForCombobox,
  getGroupMetricsMap,
  getLinkMetricsMap
} from "../newtab/storage.js";

import { searchBookmarks, appendHighlightedText } from "../newtab/search.js";
import { SVG_ICONS, renderSvgIcon } from "../newtab/icons.js";
import { t } from "../newtab/i18n.js";

// Session-level in-memory private unlock state (default locked)
let isPrivateUnlocked = false;

// Global Palette State
const state = {
  scope: "all", // "all" | "bookmarks"
  data: null,
  linkMetrics: new Map(),
  groupMetrics: new Map(),
  activeTab: null,
  isRestricted: false,
  query: "",
  tabFilter: "ALL",
  tagFilter: "ALL",
  selectedIndex: 0,
  currentItems: [],
  comboboxHighlightedIndex: -1,
  comboboxMatches: [],
  capture: {
    originalUrl: "",
    cleanedUrl: "",
    isCleaned: true,
    selectedGroupId: "",
    selectedTag: "",
    duplicate: null
  }
};

// DOM References
const elements = {};

function initDomReferences() {
  elements.paletteContainer = document.getElementById("paletteContainer");
  elements.modeCmdBtn = document.getElementById("modeCmdBtn");
  elements.modeBmkBtn = document.getElementById("modeBmkBtn");
  elements.paletteInput = document.getElementById("paletteInput");
  elements.paletteClearBtn = document.getElementById("paletteClearBtn");
  elements.paletteFilterBar = document.getElementById("paletteFilterBar");
  elements.paletteTabFilter = document.getElementById("paletteTabFilter");
  elements.paletteTagFilter = document.getElementById("paletteTagFilter");
  elements.paletteClearFiltersBtn = document.getElementById("paletteClearFiltersBtn");
  elements.paletteResultsSection = document.getElementById("paletteResultsSection");
  elements.paletteSectionHeader = document.getElementById("paletteSectionHeader");
  elements.paletteListbox = document.getElementById("paletteListbox");
  elements.paletteEmptyState = document.getElementById("paletteEmptyState");
  elements.paletteEmptyTitle = document.getElementById("paletteEmptyTitle");
  elements.paletteEmptyDesc = document.getElementById("paletteEmptyDesc");
  elements.paletteStatCount = document.getElementById("paletteStatCount");

  // Quick Capture elements
  elements.quickCaptureView = document.getElementById("quickCaptureView");
  elements.captureBackBtn = document.getElementById("captureBackBtn");
  elements.captureRestrictedNotice = document.getElementById("captureRestrictedNotice");
  elements.quickCaptureForm = document.getElementById("quickCaptureForm");
  elements.captureTitleInput = document.getElementById("captureTitleInput");
  elements.captureFavicon = document.getElementById("captureFavicon");
  elements.captureFaviconFallback = document.getElementById("captureFaviconFallback");
  elements.captureTitleSuggestions = document.getElementById("captureTitleSuggestions");
  elements.titleChipsList = document.getElementById("titleChipsList");
  elements.captureUrlInput = document.getElementById("captureUrlInput");
  elements.captureRevertUrlBtn = document.getElementById("captureRevertUrlBtn");
  elements.urlCleanStatus = document.getElementById("urlCleanStatus");
  elements.captureGroupInput = document.getElementById("captureGroupInput");
  elements.captureGroupId = document.getElementById("captureGroupId");
  elements.groupSuggestionsList = document.getElementById("groupSuggestionsList");
  elements.groupValidationHint = document.getElementById("groupValidationHint");
  elements.captureQuickTags = document.getElementById("captureQuickTags");
  elements.captureCustomTagInput = document.getElementById("captureCustomTagInput");
  elements.captureDuplicateAlert = document.getElementById("captureDuplicateAlert");
  elements.captureDuplicateLocation = document.getElementById("captureDuplicateLocation");
  elements.captureOpenExistingBtn = document.getElementById("captureOpenExistingBtn");
  elements.captureEditExistingBtn = document.getElementById("captureEditExistingBtn");
  elements.captureCancelBtn = document.getElementById("captureCancelBtn");
  elements.captureSaveBtn = document.getElementById("captureSaveBtn");
  elements.captureToast = document.getElementById("captureToast");
}

function renderStaticIcons() {
  if (elements.modeCmdIcon) renderSvgIcon(elements.modeCmdIcon, SVG_ICONS.command);
  if (elements.modeBmkIcon) renderSvgIcon(elements.modeBmkIcon, SVG_ICONS.bookmark);
  const pSearchIcon = document.getElementById("paletteSearchIcon");
  if (pSearchIcon) renderSvgIcon(pSearchIcon, SVG_ICONS.search);
  const pClearIcon = document.getElementById("paletteClearIcon");
  if (pClearIcon) renderSvgIcon(pClearIcon, SVG_ICONS.close);
  const cBackIcon = document.getElementById("captureBackIcon");
  if (cBackIcon) renderSvgIcon(cBackIcon, SVG_ICONS.chevronDown);
  const cFavFallback = document.getElementById("captureFaviconFallback");
  if (cFavFallback) renderSvgIcon(cFavFallback, SVG_ICONS.globe);
  const cToastIcon = document.getElementById("captureToastIcon");
  if (cToastIcon) renderSvgIcon(cToastIcon, SVG_ICONS.checkCircle);
}

/**
 * Detect current active tab safely with restricted URL handling
 */
async function detectActiveTab() {
  try {
    const queryApi =
      typeof chrome !== "undefined" && chrome.tabs?.query
        ? chrome.tabs.query
        : typeof browser !== "undefined" && browser.tabs?.query
          ? browser.tabs.query
          : null;

    if (!queryApi) {
      state.isRestricted = true;
      return;
    }

    const tabs = await queryApi({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      state.isRestricted = true;
      return;
    }

    const tab = tabs[0];
    state.activeTab = tab;
    const url = (tab.url || "").trim();

    const isRestrictedScheme =
      !url ||
      url.startsWith("chrome://") ||
      url.startsWith("chrome-extension://") ||
      url.startsWith("edge://") ||
      url.startsWith("about:") ||
      url.startsWith("view-source:") ||
      url.startsWith("devtools://") ||
      url.startsWith("https://chrome.google.com/webstore") ||
      url.startsWith("https://chromewebstore.google.com");

    state.isRestricted = isRestrictedScheme;
  } catch (err) {
    console.warn("Failed to detect active tab:", err);
    state.isRestricted = true;
  }
}

/**
 * Open new tab / workbench helper
 */
function openWorkbench(hash = "") {
  const newTabUrl =
    typeof chrome !== "undefined" && chrome.runtime?.getURL
      ? chrome.runtime.getURL(`src/newtab/index.html${hash}`)
      : typeof browser !== "undefined" && browser.runtime?.getURL
        ? browser.runtime.getURL(`src/newtab/index.html${hash}`)
        : `../newtab/index.html${hash}`;

  const createTab =
    typeof chrome !== "undefined" && chrome.tabs?.create
      ? chrome.tabs.create
      : typeof browser !== "undefined" && browser.tabs?.create
        ? browser.tabs.create
        : null;

  if (createTab) {
    createTab({ url: newTabUrl });
  } else if (typeof window !== "undefined") {
    window.open(newTabUrl, "_blank");
  }
  if (typeof window !== "undefined" && window.close) {
    window.close();
  }
}

/**
 * Navigate current tab or open new tab
 */
function openUrl(url, { inBackground = false } = {}) {
  if (!url) return;

  if (inBackground) {
    const createTab =
      typeof chrome !== "undefined" && chrome.tabs?.create
        ? chrome.tabs.create
        : typeof browser !== "undefined" && browser.tabs?.create
          ? browser.tabs.create
          : null;

    if (createTab) {
      createTab({ url, active: false });
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank");
    }
  } else {
    const updateTab =
      typeof chrome !== "undefined" && chrome.tabs?.update
        ? chrome.tabs.update
        : typeof browser !== "undefined" && browser.tabs?.update
          ? browser.tabs.update
          : null;

    if (updateTab && state.activeTab?.id) {
      updateTab(state.activeTab.id, { url });
    } else if (typeof window !== "undefined") {
      window.location.href = url;
    }
  }
  if (typeof window !== "undefined" && window.close) {
    window.close();
  }
}

/**
 * Switch scope between all (Commands + Bookmarks) and bookmarks
 */
function toggleScope() {
  state.scope = state.scope === "all" ? "bookmarks" : "all";
  state.selectedIndex = 0;
  if (elements.paletteInput) {
    elements.paletteInput.placeholder =
      state.scope === "all" ? t("paletteSearchPlaceholderAll") : t("paletteSearchPlaceholderBookmarks");
    elements.paletteInput.focus();
  }
  if (elements.paletteListbox) {
    renderPaletteList();
  }
}

/**
 * Build Command items
 */
function getCommandItems() {
  const commands = [
    {
      type: "command",
      id: "capture",
      title: t("cmdCaptureTitle"),
      desc: state.isRestricted ? t("captureRestrictedTitle") : t("cmdCaptureDesc"),
      icon: SVG_ICONS.bookmark,
      disabled: state.isRestricted,
      action: () => openQuickCapture()
    },
    {
      type: "command",
      id: "workbench",
      title: t("cmdWorkbenchTitle"),
      desc: t("cmdWorkbenchDesc"),
      icon: SVG_ICONS.externalLink,
      action: () => openWorkbench()
    },
    {
      type: "command",
      id: "search",
      title: t("cmdSearchTitle"),
      desc: t("cmdSearchDesc"),
      icon: SVG_ICONS.search,
      action: () => toggleScope()
    },
    {
      type: "command",
      id: "togglePrivate",
      title: isPrivateUnlocked ? t("hideHiddenTitle") : t("showHiddenTitle"),
      desc: t("cmdTogglePrivateDesc"),
      icon: isPrivateUnlocked ? SVG_ICONS.unlock : SVG_ICONS.lock,
      action: () => {
        isPrivateUnlocked = !isPrivateUnlocked;
        renderPaletteList();
      }
    },
    {
      type: "command",
      id: "import",
      title: t("cmdImportTitle"),
      desc: t("cmdImportDesc"),
      icon: SVG_ICONS.import,
      action: () => openWorkbench("#import")
    },
    {
      type: "command",
      id: "export",
      title: t("cmdExportTitle"),
      desc: t("cmdExportDesc"),
      icon: SVG_ICONS.export,
      action: () => openWorkbench("#export")
    }
  ];

  if (!state.query) return commands;

  const q = state.query.toLowerCase().trim();
  return commands.filter(
    (c) => c.title.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
  );
}

/**
 * Build Bookmark search items
 */
function getBookmarkItems() {
  if (!state.data) return [];

  const searchRes = searchBookmarks(state.data, state.query, {
    linkMetricsMap: state.linkMetrics,
    groupMetricsMap: state.groupMetrics,
    includeHidden: isPrivateUnlocked,
    maxRecent: 10
  });

  let items = (searchRes.results || []).map((item) => ({
    ...item,
    type: "bookmark"
  }));

  // Filter by Tab
  if (state.tabFilter !== "ALL") {
    items = items.filter((item) => item.category?.id === state.tabFilter);
  }

  // Filter by Tag
  if (state.tagFilter !== "ALL") {
    items = items.filter(
      (item) => (item.badge || "").trim().toUpperCase() === state.tagFilter.toUpperCase()
    );
  }

  return items;
}

/**
 * Render Unified Continuous Stream
 */
function renderPaletteList() {
  elements.paletteListbox.replaceChildren();

  const commands = state.scope === "all" ? getCommandItems() : [];
  const bookmarks = getBookmarkItems();
  const allItems = [...commands, ...bookmarks];
  state.currentItems = allItems;

  if (allItems.length === 0) {
    elements.paletteEmptyState.style.display = "block";
    elements.paletteEmptyTitle.textContent = state.query ? t("searchNoResultsTitle") : t("noCommandsMatch");
    elements.paletteEmptyDesc.textContent = state.query ? t("searchNoResultsDesc", state.query) : "";
    if (elements.paletteSectionHeader) elements.paletteSectionHeader.textContent = "";
    if (elements.paletteStatCount) elements.paletteStatCount.textContent = "0 items";
    return;
  }

  elements.paletteEmptyState.style.display = "none";
  if (state.selectedIndex >= allItems.length) state.selectedIndex = 0;

  if (elements.paletteStatCount) {
    elements.paletteStatCount.textContent = `${allItems.length} items`;
  }
  if (elements.paletteSectionHeader) {
    elements.paletteSectionHeader.textContent = state.query ? t("searchResultsHeading") || "Results" : t("searchSectionRecent");
  }

  const queryTokens = state.query ? state.query.toLowerCase().trim().split(/\s+/) : [];

  allItems.forEach((item, idx) => {
    const isSelected = idx === state.selectedIndex;
    const itemEl = document.createElement("div");
    itemEl.className = `palette-item ${isSelected ? "is-selected" : ""} ${item.disabled ? "is-disabled" : ""}`;
    itemEl.setAttribute("role", "option");
    itemEl.setAttribute("aria-selected", isSelected ? "true" : "false");

    const iconBox = document.createElement("div");
    iconBox.className = "item-icon-box";
    if (item.type === "command") {
      renderSvgIcon(iconBox, item.icon);
    } else {
      renderSvgIcon(iconBox, item.link?.pinned ? SVG_ICONS.heartFilled : SVG_ICONS.bookmark);
    }

    const content = document.createElement("div");
    content.className = "item-content";

    const titleRow = document.createElement("div");
    titleRow.className = "item-title-row";
    const titleSpan = document.createElement("span");
    titleSpan.className = "item-title";

    if (item.type === "command") {
      titleSpan.textContent = item.title;
    } else {
      appendHighlightedText(titleSpan, item.title, queryTokens);
    }
    titleRow.appendChild(titleSpan);

    if (item.badge) {
      const badgeSpan = document.createElement("span");
      badgeSpan.className = "item-badge";
      badgeSpan.textContent = item.badge;
      titleRow.appendChild(badgeSpan);
    } else if (item.disabled) {
      const badgeSpan = document.createElement("span");
      badgeSpan.className = "item-badge";
      badgeSpan.textContent = "Disabled";
      titleRow.appendChild(badgeSpan);
    }

    const desc = document.createElement("div");
    desc.className = "item-desc";
    if (item.type === "command") {
      desc.textContent = item.desc;
    } else {
      const breadcrumbs = `${item.categoryName || ""} › ${item.groupName || ""}`;
      const hostname = item.cleanHostnameLower || item.hostname || "";
      desc.textContent = `${breadcrumbs} · ${hostname}`;
    }

    content.appendChild(titleRow);
    content.appendChild(desc);

    itemEl.appendChild(iconBox);
    itemEl.appendChild(content);

    itemEl.addEventListener("click", () => {
      state.selectedIndex = idx;
      executeSelectedItem({ inBackground: false });
    });

    elements.paletteListbox.appendChild(itemEl);
  });

  scrollSelectedItemIntoView();
}

function scrollSelectedItemIntoView() {
  const selectedEl = elements.paletteListbox.querySelector(".palette-item.is-selected");
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function executeSelectedItem({ inBackground = false } = {}) {
  const selected = state.currentItems[state.selectedIndex];
  if (!selected) return;

  if (selected.type === "command") {
    if (!selected.disabled && typeof selected.action === "function") {
      selected.action();
    }
  } else {
    openUrl(selected.link?.url, { inBackground });
  }
}

/**
 * Open Quick Page Capture view
 */
function openQuickCapture() {
  elements.paletteResultsSection.style.display = "none";
  elements.quickCaptureView.style.display = "block";

  if (state.isRestricted) {
    elements.captureRestrictedNotice.style.display = "block";
    elements.quickCaptureForm.style.display = "none";
    return;
  }

  elements.captureRestrictedNotice.style.display = "none";
  elements.quickCaptureForm.style.display = "flex";

  const rawUrl = state.activeTab?.url || "";
  const pageTitle = (state.activeTab?.title || "").trim();
  const favIconUrl = state.activeTab?.favIconUrl;

  state.capture.originalUrl = rawUrl;
  state.capture.cleanedUrl = cleanTrackingUrl(rawUrl);
  state.capture.isCleaned = state.capture.cleanedUrl !== rawUrl;

  // Favicon setup
  if (favIconUrl && !favIconUrl.startsWith("chrome://")) {
    elements.captureFavicon.src = favIconUrl;
    elements.captureFavicon.style.display = "block";
    elements.captureFaviconFallback.style.display = "none";
  } else {
    elements.captureFavicon.style.display = "none";
    elements.captureFaviconFallback.style.display = "inline-block";
  }

  // Pre-fill Title & URL
  elements.captureTitleInput.value = pageTitle || rawUrl;
  elements.captureUrlInput.value = state.capture.cleanedUrl;

  if (state.capture.isCleaned) {
    elements.urlCleanStatus.style.display = "flex";
    elements.captureRevertUrlBtn.style.display = "inline";
    elements.captureRevertUrlBtn.textContent = t("captureRevertUrl");
  } else {
    elements.urlCleanStatus.style.display = "none";
    elements.captureRevertUrlBtn.style.display = "none";
  }

  // Populate Group Combobox with most recently used group default
  const groups = filterGroupsForCombobox(state.data, "", state.groupMetrics);
  if (groups.length > 0) {
    const defaultGroup = groups[0];
    elements.captureGroupId.value = defaultGroup.id;
    elements.captureGroupInput.value = `${defaultGroup.name} (${defaultGroup.categoryName})`;
    state.capture.selectedGroupId = defaultGroup.id;
    if (elements.groupValidationHint) elements.groupValidationHint.style.display = "none";
    updateTitleSuggestions(defaultGroup.id, pageTitle);
  } else {
    elements.captureGroupId.value = "";
    elements.captureGroupInput.value = "";
    state.capture.selectedGroupId = "";
  }

  // Reset tag
  state.capture.selectedTag = "";
  elements.captureCustomTagInput.value = "";
  elements.captureQuickTags.querySelectorAll(".tag-chip").forEach((c) => c.classList.remove("is-active"));

  // Check duplicate
  checkDuplicateUrl(elements.captureUrlInput.value);

  elements.captureTitleInput.focus();
}

/**
 * Update smart title suggestions for chosen group
 */
function updateTitleSuggestions(groupId, pageTitle) {
  if (!state.data || !groupId) return;
  const groupLinks = (state.data.links || []).filter((l) => l.groupId === groupId);
  elements.titleChipsList.replaceChildren();

  if (groupLinks.length === 0) {
    elements.captureTitleSuggestions.style.display = "none";
    return;
  }

  const existingTitles = [...new Set(groupLinks.map((l) => (l.name || "").trim()).filter(Boolean))];

  if (existingTitles.length === 1 && existingTitles[0] !== pageTitle) {
    elements.captureTitleInput.value = existingTitles[0];
  }

  if (existingTitles.length > 0) {
    elements.captureTitleSuggestions.style.display = "flex";
    existingTitles.slice(0, 4).forEach((title) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "suggestion-chip";
      chip.textContent = title;
      chip.addEventListener("click", () => {
        elements.captureTitleInput.value = title;
        validateSaveBtn();
      });
      elements.titleChipsList.appendChild(chip);
    });
  } else {
    elements.captureTitleSuggestions.style.display = "none";
  }
}

/**
 * Duplicate URL Detection
 */
function checkDuplicateUrl(url) {
  if (!state.data) return;
  const dup = findDuplicateLink(state.data, url);
  state.capture.duplicate = dup;

  if (dup) {
    elements.captureDuplicateAlert.style.display = "flex";
    const locText = `${dup.categoryName || ""} › ${dup.groupName || ""} › ${dup.link?.name || ""}${
      dup.link?.badge ? ` [${dup.link.badge}]` : ""
    }`;
    elements.captureDuplicateLocation.textContent = locText;
    elements.captureSaveBtn.disabled = true;
  } else {
    elements.captureDuplicateAlert.style.display = "none";
    validateSaveBtn();
  }
}

function validateSaveBtn() {
  const hasTitle = Boolean(elements.captureTitleInput.value.trim());
  const hasUrl = Boolean(elements.captureUrlInput.value.trim());
  const hasGroup = Boolean(state.capture.selectedGroupId);
  const hasDup = Boolean(state.capture.duplicate);

  elements.captureSaveBtn.disabled = !hasTitle || !hasUrl || !hasGroup || hasDup;
}

/**
 * Handle Combobox Search & Selection
 */
function setupGroupCombobox() {
  const input = elements.captureGroupInput;
  const listbox = elements.groupSuggestionsList;

  function renderGroupSuggestions(query) {
    const matched = filterGroupsForCombobox(state.data, query, state.groupMetrics);
    state.comboboxMatches = matched;
    state.comboboxHighlightedIndex = -1;
    listbox.replaceChildren();

    if (matched.length === 0) {
      listbox.style.display = "none";
      return;
    }

    listbox.style.display = "block";
    matched.slice(0, 10).forEach((group) => {
      const item = document.createElement("div");
      item.className = "combobox-group-item";
      item.setAttribute("role", "option");

      const nameSpan = document.createElement("span");
      nameSpan.textContent = group.name;

      const tabSpan = document.createElement("span");
      tabSpan.className = "combobox-group-tab";
      tabSpan.textContent = `${group.categoryName} (${group.linkCount})`;

      item.appendChild(nameSpan);
      item.appendChild(tabSpan);

      item.addEventListener("click", () => {
        selectGroupCandidate(group);
      });

      listbox.appendChild(item);
    });
  }

  function selectGroupCandidate(group) {
    elements.captureGroupId.value = group.id;
    input.value = `${group.name} (${group.categoryName})`;
    state.capture.selectedGroupId = group.id;
    listbox.style.display = "none";
    if (elements.groupValidationHint) elements.groupValidationHint.style.display = "none";
    updateTitleSuggestions(group.id, elements.captureTitleInput.value);
    validateSaveBtn();
  }

  // Typing in Group input immediately clears selectedGroupId and disables save
  input.addEventListener("input", (e) => {
    elements.captureGroupId.value = "";
    state.capture.selectedGroupId = "";
    if (elements.groupValidationHint) {
      elements.groupValidationHint.textContent = t("captureSelectGroupHint");
      elements.groupValidationHint.style.display = "block";
    }
    validateSaveBtn();
    renderGroupSuggestions(e.target.value);
  });

  input.addEventListener("focus", () => {
    renderGroupSuggestions(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (listbox.style.display === "none") return;
    const items = listbox.querySelectorAll(".combobox-group-item");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.comboboxHighlightedIndex = (state.comboboxHighlightedIndex + 1) % items.length;
      items.forEach((it, i) => it.classList.toggle("is-highlighted", i === state.comboboxHighlightedIndex));
      items[state.comboboxHighlightedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.comboboxHighlightedIndex = (state.comboboxHighlightedIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle("is-highlighted", i === state.comboboxHighlightedIndex));
      items[state.comboboxHighlightedIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (state.comboboxHighlightedIndex >= 0 && state.comboboxMatches[state.comboboxHighlightedIndex]) {
        selectGroupCandidate(state.comboboxMatches[state.comboboxHighlightedIndex]);
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!elements.captureGroupInput.contains(e.target) && !listbox.contains(e.target)) {
      listbox.style.display = "none";
    }
  });
}

/**
 * Setup Keyboard Event Listeners for Palette
 */
function setupKeyboardNavigation() {
  window.addEventListener("keydown", (e) => {
    const isShortcut = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k");
    if (isShortcut) {
      e.preventDefault();
      toggleScope();
      return;
    }

    if (e.key === "Escape") {
      if (elements.quickCaptureView.style.display === "block") {
        e.preventDefault();
        elements.quickCaptureView.style.display = "none";
        elements.paletteResultsSection.style.display = "block";
        elements.paletteInput.focus();
      } else {
        window.close();
      }
      return;
    }

    // Only handle list navigation if results section is visible
    if (elements.paletteResultsSection.style.display !== "none") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (state.currentItems.length > 0) {
          state.selectedIndex = (state.selectedIndex + 1) % state.currentItems.length;
          renderPaletteList();
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (state.currentItems.length > 0) {
          state.selectedIndex =
            (state.selectedIndex - 1 + state.currentItems.length) % state.currentItems.length;
          renderPaletteList();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const inBackground = e.ctrlKey || e.metaKey;
        executeSelectedItem({ inBackground });
      }
    }
  });

  elements.paletteInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    state.selectedIndex = 0;
    elements.paletteClearBtn.style.display = state.query ? "block" : "none";
    renderPaletteList();
  });

  elements.paletteClearBtn.addEventListener("click", () => {
    state.query = "";
    elements.paletteInput.value = "";
    elements.paletteClearBtn.style.display = "none";
    state.selectedIndex = 0;
    renderPaletteList();
    elements.paletteInput.focus();
  });
}

/**
 * Setup Quick Capture Form Interactions
 */
function setupQuickCaptureHandlers() {
  elements.captureBackBtn.addEventListener("click", () => {
    elements.quickCaptureView.style.display = "none";
    elements.paletteResultsSection.style.display = "block";
    elements.paletteInput.focus();
  });

  elements.captureCancelBtn.addEventListener("click", () => {
    window.close();
  });

  elements.captureRevertUrlBtn.addEventListener("click", () => {
    if (elements.captureUrlInput.value === state.capture.cleanedUrl) {
      elements.captureUrlInput.value = state.capture.originalUrl;
      elements.captureRevertUrlBtn.textContent = t("captureCleanUrlToggle");
      elements.urlCleanStatus.style.display = "none";
    } else {
      elements.captureUrlInput.value = state.capture.cleanedUrl;
      elements.captureRevertUrlBtn.textContent = t("captureRevertUrl");
      elements.urlCleanStatus.style.display = "flex";
    }
    checkDuplicateUrl(elements.captureUrlInput.value);
  });

  elements.captureUrlInput.addEventListener("input", (e) => {
    checkDuplicateUrl(e.target.value);
  });

  elements.captureTitleInput.addEventListener("input", () => {
    validateSaveBtn();
  });

  // Tag quick selection
  elements.captureQuickTags.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const tag = chip.getAttribute("data-tag");
      if (state.capture.selectedTag === tag) {
        state.capture.selectedTag = "";
        chip.classList.remove("is-active");
      } else {
        elements.captureQuickTags
          .querySelectorAll(".tag-chip")
          .forEach((c) => c.classList.remove("is-active"));
        chip.classList.add("is-active");
        state.capture.selectedTag = tag;
        elements.captureCustomTagInput.value = "";
      }
    });
  });

  // Custom Tag Input: clearing immediately resets selectedTag to ""
  elements.captureCustomTagInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    if (val) {
      elements.captureQuickTags
        .querySelectorAll(".tag-chip")
        .forEach((c) => c.classList.remove("is-active"));
      state.capture.selectedTag = val;
    } else {
      state.capture.selectedTag = "";
    }
  });

  // Duplicate button actions
  elements.captureOpenExistingBtn.addEventListener("click", () => {
    if (state.capture.duplicate?.link?.url) {
      openUrl(state.capture.duplicate.link.url);
    }
  });

  elements.captureEditExistingBtn.addEventListener("click", () => {
    openWorkbench();
  });

  // Submit Save
  elements.quickCaptureForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = elements.captureTitleInput.value.trim();
    const url = elements.captureUrlInput.value.trim();
    const groupId = elements.captureGroupId.value;
    const badge = state.capture.selectedTag || elements.captureCustomTagInput.value.trim();

    if (!title || !url || !groupId) return;

    try {
      elements.captureSaveBtn.disabled = true;
      await addLink(state.data, groupId, { name: title, url, badge });

      elements.captureToast.style.display = "flex";
      setTimeout(() => {
        window.close();
      }, 500);
    } catch (err) {
      console.error("Failed to add link:", err);
      elements.captureSaveBtn.disabled = false;
    }
  });
}

// Bootstrap
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", async () => {
    initDomReferences();
    renderStaticIcons();

    if (elements.modeCmdBtn) {
      elements.modeCmdBtn.addEventListener("click", () => {
        state.scope = "all";
        renderPaletteList();
      });
    }
    if (elements.modeBmkBtn) {
      elements.modeBmkBtn.addEventListener("click", () => {
        state.scope = "bookmarks";
        renderPaletteList();
      });
    }

    await detectActiveTab();

    try {
      state.data = await loadWorkbenchData();
      state.linkMetrics = await getLinkMetricsMap();
      state.groupMetrics = await getGroupMetricsMap();
    } catch (err) {
      console.error("Failed to load workbench data in popup:", err);
    }

    setupGroupCombobox();
    setupKeyboardNavigation();
    setupQuickCaptureHandlers();

    state.scope = "all";
    elements.paletteInput.placeholder = t("paletteSearchPlaceholderAll");
    renderPaletteList();
  });
}

export {
  state,
  getCommandItems,
  getBookmarkItems,
  toggleScope,
  checkDuplicateUrl,
  validateSaveBtn
};
