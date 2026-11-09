/**
 * Global Aggregated Palette & Quick Page Capture (CMD-SEARCH-001 & BMK-CAPTURE-001)
 *
 * Implements:
 * - Omnipresent popup entry via Ctrl/Cmd+Shift+K or extension action icon.
 * - Mode A: Commands Palette (Capture, Workbench, Search, Toggle Private, Import, Export).
 * - Mode B: Bookmark Search Palette (Cross-tab search, Tab/Tag filtering, Highlight, Pinned/Recent empty-state).
 * - Mode switching via Ctrl/Cmd+K or clicking header tab indicator.
 * - Quick Page Capture with URL tracking cleaner, Group combobox, Title suggestions, and Duplicate detection.
 * - Full keyboard navigation (ArrowUp/Down, Enter, Ctrl/Cmd+Enter, Esc).
 * - Safe restricted-page detection without crashing.
 */

import {
  loadWorkbenchData,
  addLink,
  cleanTrackingUrl,
  findDuplicateLink,
  filterGroupsForCombobox,
  getGroupUsageMetrics,
  getLinkUsageMetrics,
  isPrivateUnlocked,
  setPrivateUnlocked
} from "../newtab/storage.js";

import { searchBookmarks, appendHighlightedText } from "../newtab/search.js";
import { SVG_ICONS, renderSvgIcon } from "../newtab/icons.js";
import { t } from "../newtab/i18n.js";

// Global Palette State
const state = {
  mode: "commands", // "commands" | "bookmarks"
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
  renderSvgIcon(document.getElementById("modeCmdIcon"), SVG_ICONS.command);
  renderSvgIcon(document.getElementById("modeBmkIcon"), SVG_ICONS.bookmark);
  renderSvgIcon(document.getElementById("paletteSearchIcon"), SVG_ICONS.search);
  renderSvgIcon(document.getElementById("paletteClearIcon"), SVG_ICONS.close);
  renderSvgIcon(document.getElementById("captureBackIcon"), SVG_ICONS.chevronDown);
  renderSvgIcon(document.getElementById("captureFaviconFallback"), SVG_ICONS.globe);
  renderSvgIcon(document.getElementById("captureToastIcon"), SVG_ICONS.checkCircle);
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
  } else {
    window.open(newTabUrl, "_blank");
  }
  window.close();
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
    } else {
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
    } else {
      window.location.href = url;
    }
  }
  window.close();
}

/**
 * Switch mode between Commands (A) and Bookmarks (B)
 */
function switchMode(newMode) {
  state.mode = newMode;
  state.selectedIndex = 0;

  if (newMode === "commands") {
    elements.modeCmdBtn.classList.add("is-active");
    elements.modeCmdBtn.setAttribute("aria-selected", "true");
    elements.modeBmkBtn.classList.remove("is-active");
    elements.modeBmkBtn.setAttribute("aria-selected", "false");
    elements.paletteFilterBar.style.display = "none";
    elements.paletteInput.placeholder = t("paletteInputPlaceholder");
  } else {
    elements.modeBmkBtn.classList.add("is-active");
    elements.modeBmkBtn.setAttribute("aria-selected", "true");
    elements.modeCmdBtn.classList.remove("is-active");
    elements.modeCmdBtn.setAttribute("aria-selected", "false");
    elements.paletteFilterBar.style.display = "flex";
    elements.paletteInput.placeholder = t("searchPlaceholder");
  }

  elements.quickCaptureView.style.display = "none";
  elements.paletteResultsSection.style.display = "block";

  renderPaletteList();
  elements.paletteInput.focus();
}

/**
 * Build Command items for Mode A
 */
function getCommandItems() {
  const isUnlocked = isPrivateUnlocked();

  const commands = [
    {
      id: "capture",
      title: t("cmdCaptureTitle"),
      desc: state.isRestricted ? t("captureRestrictedTitle") : t("cmdCaptureDesc"),
      icon: SVG_ICONS.bookmark,
      disabled: state.isRestricted,
      action: () => openQuickCapture()
    },
    {
      id: "workbench",
      title: t("cmdWorkbenchTitle"),
      desc: t("cmdWorkbenchDesc"),
      icon: SVG_ICONS.externalLink,
      action: () => openWorkbench()
    },
    {
      id: "search",
      title: t("cmdSearchTitle"),
      desc: t("cmdSearchDesc"),
      icon: SVG_ICONS.search,
      action: () => switchMode("bookmarks")
    },
    {
      id: "togglePrivate",
      title: isUnlocked ? t("hideHiddenTitle") : t("showHiddenTitle"),
      desc: t("cmdTogglePrivateDesc"),
      icon: isUnlocked ? SVG_ICONS.unlock : SVG_ICONS.lock,
      action: () => {
        setPrivateUnlocked(!isUnlocked);
        renderPaletteList();
      }
    },
    {
      id: "import",
      title: t("cmdImportTitle"),
      desc: t("cmdImportDesc"),
      icon: SVG_ICONS.import,
      action: () => openWorkbench("#import")
    },
    {
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
 * Build Bookmark search items for Mode B
 */
function getBookmarkItems() {
  if (!state.data) return [];

  const isUnlocked = isPrivateUnlocked();
  const searchRes = searchBookmarks(state.data, state.query, {
    linkMetricsMap: state.linkMetrics,
    groupMetricsMap: state.groupMetrics,
    includeHidden: isUnlocked,
    maxRecent: 10
  });

  let items = searchRes.results || [];

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
 * Render Palette items in listbox
 */
function renderPaletteList() {
  elements.paletteListbox.replaceChildren();

  if (state.mode === "commands") {
    const items = getCommandItems();
    state.currentItems = items;
    elements.paletteSectionHeader.textContent = t("cmdModeLabel");
    elements.paletteStatCount.textContent = `${items.length} commands`;

    if (items.length === 0) {
      elements.paletteEmptyState.style.display = "block";
      elements.paletteEmptyTitle.textContent = t("noCommandsMatch");
      elements.paletteEmptyDesc.textContent = state.query;
      return;
    }

    elements.paletteEmptyState.style.display = "none";
    if (state.selectedIndex >= items.length) state.selectedIndex = 0;

    items.forEach((cmd, idx) => {
      const itemEl = document.createElement("div");
      itemEl.className = `palette-item ${idx === state.selectedIndex ? "is-selected" : ""} ${
        cmd.disabled ? "is-disabled" : ""
      }`;
      itemEl.setAttribute("role", "option");
      itemEl.setAttribute("aria-selected", idx === state.selectedIndex ? "true" : "false");

      const iconBox = document.createElement("div");
      iconBox.className = "item-icon-box";
      renderSvgIcon(iconBox, cmd.icon);

      const content = document.createElement("div");
      content.className = "item-content";

      const titleRow = document.createElement("div");
      titleRow.className = "item-title-row";
      const titleSpan = document.createElement("span");
      titleSpan.className = "item-title";
      titleSpan.textContent = cmd.title;
      titleRow.appendChild(titleSpan);

      if (cmd.disabled) {
        const badgeSpan = document.createElement("span");
        badgeSpan.className = "item-badge";
        badgeSpan.textContent = "Disabled";
        titleRow.appendChild(badgeSpan);
      }

      const desc = document.createElement("div");
      desc.className = "item-desc";
      desc.textContent = cmd.desc;

      content.appendChild(titleRow);
      content.appendChild(desc);

      itemEl.appendChild(iconBox);
      itemEl.appendChild(content);

      itemEl.addEventListener("click", () => {
        if (!cmd.disabled && typeof cmd.action === "function") {
          cmd.action();
        }
      });

      elements.paletteListbox.appendChild(itemEl);
    });
  } else {
    // Bookmark Mode
    const items = getBookmarkItems();
    state.currentItems = items;
    const isFiltered = state.tabFilter !== "ALL" || state.tagFilter !== "ALL";
    elements.paletteClearFiltersBtn.style.display = isFiltered ? "inline-block" : "none";

    elements.paletteSectionHeader.textContent = state.query
      ? t("searchSectionResults", items.length)
      : t("searchSectionRecent");
    elements.paletteStatCount.textContent = `${items.length} bookmarks`;

    if (items.length === 0) {
      elements.paletteEmptyState.style.display = "block";
      elements.paletteEmptyTitle.textContent = t("searchNoResultsTitle");
      elements.paletteEmptyDesc.textContent = state.query
        ? t("searchNoResultsDesc", state.query)
        : t("searchEmptyWorkspace");
      return;
    }

    elements.paletteEmptyState.style.display = "none";
    if (state.selectedIndex >= items.length) state.selectedIndex = 0;

    const queryTokens = state.query ? state.query.toLowerCase().trim().split(/\s+/) : [];

    items.forEach((item, idx) => {
      const itemEl = document.createElement("div");
      itemEl.className = `palette-item ${idx === state.selectedIndex ? "is-selected" : ""}`;
      itemEl.setAttribute("role", "option");
      itemEl.setAttribute("aria-selected", idx === state.selectedIndex ? "true" : "false");

      const iconBox = document.createElement("div");
      iconBox.className = "item-icon-box";
      renderSvgIcon(iconBox, item.link?.pinned ? SVG_ICONS.heartFilled : SVG_ICONS.bookmark);

      const content = document.createElement("div");
      content.className = "item-content";

      const titleRow = document.createElement("div");
      titleRow.className = "item-title-row";
      const titleSpan = document.createElement("span");
      titleSpan.className = "item-title";
      appendHighlightedText(titleSpan, item.title, queryTokens);
      titleRow.appendChild(titleSpan);

      if (item.badge) {
        const badgeSpan = document.createElement("span");
        badgeSpan.className = "item-badge";
        badgeSpan.textContent = item.badge;
        titleRow.appendChild(badgeSpan);
      }

      const desc = document.createElement("div");
      desc.className = "item-desc";
      const breadcrumbs = `${item.categoryName || ""} › ${item.groupName || ""}`;
      const hostname = item.cleanHostnameLower || item.hostname || "";
      desc.textContent = `${breadcrumbs} · ${hostname}`;

      content.appendChild(titleRow);
      content.appendChild(desc);

      itemEl.appendChild(iconBox);
      itemEl.appendChild(content);

      itemEl.addEventListener("click", () => {
        openUrl(item.link?.url);
      });

      elements.paletteListbox.appendChild(itemEl);
    });
  }

  scrollSelectedItemIntoView();
}

function scrollSelectedItemIntoView() {
  const selectedEl = elements.paletteListbox.querySelector(".palette-item.is-selected");
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
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
    updateTitleSuggestions(defaultGroup.id, pageTitle);
  }

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
    // If all existing links in group have identical title, auto-reuse it
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
    elements.captureSaveBtn.disabled = false;
  }
}

/**
 * Handle Combobox Search & Selection
 */
function setupGroupCombobox() {
  const input = elements.captureGroupInput;
  const listbox = elements.groupSuggestionsList;

  function renderGroupSuggestions(query) {
    const matched = filterGroupsForCombobox(state.data, query, state.groupMetrics);
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
        elements.captureGroupId.value = group.id;
        input.value = `${group.name} (${group.categoryName})`;
        state.capture.selectedGroupId = group.id;
        listbox.style.display = "none";
        updateTitleSuggestions(group.id, elements.captureTitleInput.value);
      });

      listbox.appendChild(item);
    });
  }

  input.addEventListener("input", (e) => {
    renderGroupSuggestions(e.target.value);
  });

  input.addEventListener("focus", () => {
    renderGroupSuggestions(input.value);
  });

  document.addEventListener("click", (e) => {
    if (!elements.captureGroupInput.contains(e.target) && !listbox.contains(e.target)) {
      listbox.style.display = "none";
    }
  });
}

/**
 * Populate Tab and Tag filter dropdowns
 */
function setupFilters() {
  if (!state.data) return;

  // Tab filter options
  elements.paletteTabFilter.replaceChildren();
  const defaultOpt = document.createElement("option");
  defaultOpt.value = "ALL";
  defaultOpt.textContent = t("tabFilterAll");
  elements.paletteTabFilter.appendChild(defaultOpt);
  (state.data.categories || []).forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat.id;
    opt.textContent = cat.name;
    elements.paletteTabFilter.appendChild(opt);
  });

  elements.paletteTabFilter.addEventListener("change", (e) => {
    state.tabFilter = e.target.value;
    state.selectedIndex = 0;
    renderPaletteList();
  });

  elements.paletteTagFilter.addEventListener("change", (e) => {
    state.tagFilter = e.target.value;
    state.selectedIndex = 0;
    renderPaletteList();
  });

  elements.paletteClearFiltersBtn.addEventListener("click", () => {
    state.tabFilter = "ALL";
    state.tagFilter = "ALL";
    elements.paletteTabFilter.value = "ALL";
    elements.paletteTagFilter.value = "ALL";
    state.selectedIndex = 0;
    renderPaletteList();
  });
}

/**
 * Setup Keyboard Event Listeners for Palette
 */
function setupKeyboardNavigation() {
  window.addEventListener("keydown", (e) => {
    const isCmdK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k";
    if (isCmdK) {
      e.preventDefault();
      switchMode(state.mode === "commands" ? "bookmarks" : "commands");
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
        const selected = state.currentItems[state.selectedIndex];
        if (!selected) return;

        if (state.mode === "commands") {
          if (!selected.disabled && typeof selected.action === "function") {
            selected.action();
          }
        } else {
          const inBackground = e.ctrlKey || e.metaKey;
          openUrl(selected.link?.url, { inBackground });
        }
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

  elements.captureCustomTagInput.addEventListener("input", (e) => {
    if (e.target.value.trim()) {
      elements.captureQuickTags
        .querySelectorAll(".tag-chip")
        .forEach((c) => c.classList.remove("is-active"));
      state.capture.selectedTag = e.target.value.trim();
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
document.addEventListener("DOMContentLoaded", async () => {
  initDomReferences();
  renderStaticIcons();

  elements.modeCmdBtn.addEventListener("click", () => switchMode("commands"));
  elements.modeBmkBtn.addEventListener("click", () => switchMode("bookmarks"));

  await detectActiveTab();

  try {
    state.data = await loadWorkbenchData();
    state.linkMetrics = await getLinkUsageMetrics();
    state.groupMetrics = await getGroupUsageMetrics();
  } catch (err) {
    console.error("Failed to load workbench data in popup:", err);
  }

  setupFilters();
  setupGroupCombobox();
  setupKeyboardNavigation();
  setupQuickCaptureHandlers();

  switchMode("commands");
});
