/**
 * Main Application Orchestrator for Bookmark Organizer
 * Follows Quiet Workbench UI/UX specifications and DEC product decisions.
 * Implements:
 * - Persistent keyboard focus on category switching (P1 fix)
 * - Cross-tab synchronization via BroadcastChannel announcements of IndexedDB writes
 * - Safe DOM creation without unsafe innerHTML interpolation (P2 fix)
 * - Optimistic concurrency control via entity revisions (expectedRevision)
 * - JSON Import with Preview, Conflict Resolution, Snapshot, and Undo
 * - Full External JSON Backup Export
 */

import {
  loadWorkbenchData,
  setActiveCategory,
  addCategory,
  renameCategory,
  deleteCategory,
  addGroup,
  renameGroup,
  deleteGroup,
  addLink,
  editLink,
  deleteLink,
  pinLink,
  unpinLink,
  togglePinLink,
  reorderPinnedLinks,
  getPinnedLinks,
  isValidUrl,
  subscribeStorageChanges,
  reorderGroups,
  recordGroupClick,
  getGroupMetricsMap,
  recordLinkClick,
  getLinkMetricsMap
} from "./storage.js";

import {
  generateImportPreview,
  executeImport,
  previewUndoImport,
  undoImport,
  previewSnapshotRestore,
  restoreSnapshot,
  exportBackup,
  getBackupFilename,
  generateSelectiveBackupJson,
  generateNetscapeBookmarkHtml,
  getSelectiveBackupFilename
} from "./import-export.js";

import {
  initTheme,
  setThemeMode,
  getThemeMode,
  getResolvedTheme,
  getAutoInfo,
  onThemeChange
} from "./theme.js";

import { handleCategoryKeydown, handleModalKeydown } from "./keyboard.js";
import { DEFAULT_BADGES } from "./constants.js";
import { t, getLanguage, setLanguage } from "./i18n.js";
import { SVG_ICONS, renderSvgIcon } from "./icons.js";
import { initBackgroundUI, updateBackgroundUI } from "./background-ui.js";
import {
  searchBookmarks,
  appendHighlightedText,
  evaluateSearchShortcut,
  getPlatformSearchShortcutLabel,
  ENV_FILTER_ORDER,
  getNextEnvFilter,
  matchesEnvFilter,
  evaluateEnvFilterShortcut
} from "./search.js";

const FEATURE_ICONS = {
  pin: `<svg class="ui-icon ui-icon-compact" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="12" y1="17" x2="12" y2="22"></line>
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
  </svg>`,
  pinFilled: `<svg class="ui-icon ui-icon-compact" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <line x1="12" y1="17" x2="12" y2="22"></line>
    <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
  </svg>`,
  search: `<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>`
};

// Application State
let state = {
  data: null,
  isManageMode: false,
  activeModal: null,
  lastImportJobId: null,
  expandedLinks: new Map(), // groupId -> linkId (VIEW-LINK-001)
  isPinnedExpanded: false,
  isSearchOpen: false,
  searchQuery: "",
  searchSelectedIndex: 0,
  searchResults: [],
  searchTriggerElement: null,
  envFilter: "ALL",
  showHiddenBookmarks: false,
  get activeCategoryId() {
    return this.data?.activeCategoryId || null;
  },
  set activeCategoryId(val) {
    if (this.data && val) {
      this.data.activeCategoryId = val;
    }
  }
};

// DOM References
const el = (id) => (typeof document !== "undefined" && document.getElementById ? document.getElementById(id) : null);
const elements = {
  get brandTitle() { return el("appBrandTitle"); },
  get tagline() { return el("appTagline"); },
  get categoryTabs() { return el("categoryTabs"); },
  get addCategoryBtn() { return el("addCategoryBtn"); },
  get activeCatTitle() { return el("activeCatTitle"); },
  get catStatsLabel() { return el("catStatsLabel"); },
  get catAdminButtons() { return el("catAdminButtons"); },
  get renameCatBtn() { return el("renameCatBtn"); },
  get deleteCatBtn() { return el("deleteCatBtn"); },
  get addGroupBtn() { return el("addGroupBtn"); },
  get groupGrid() { return el("groupGrid"); },
  get categoryEmptyState() { return el("categoryEmptyState"); },
  get emptyCatTitle() { return el("emptyCatTitle"); },
  get emptyCatLead() { return el("emptyCatLead"); },
  get createFirstGroupBtn() { return el("createFirstGroupBtn"); },
  get toggleManageBtn() { return el("toggleManageBtn"); },
  get manageIndicator() { return el("manageIndicator"); },
  get manageBtnText() { return el("manageBtnText"); },
  get langToggleBtn() { return el("langToggleBtn"); },
  get currentLangLabel() { return el("currentLangLabel"); },
  get themeToggleBtn() { return el("themeToggleBtn"); },
  get themeBtnIcon() { return el("themeBtnIcon"); },
  get themeBtnText() { return el("themeBtnText"); },
  get errorBanner() { return el("errorBanner"); },
  get errorTitle() { return el("errorTitle"); },
  get errorDesc() { return el("errorDesc"); },
  get retryLoadBtn() { return el("retryLoadBtn"); },
  get modalContainer() { return el("modalContainer"); },

  // Consolidated Actions & More Menu (UI-ACTION-001)
  get moreMenuWrapper() { return el("moreMenuWrapper"); },
  get moreMenuBtn() { return el("moreMenuBtn"); },
  get moreMenuIcon() { return el("moreMenuIcon"); },
  get moreMenuDropdown() { return el("moreMenuDropdown"); },
  get headerAddGroupBtn() { return el("headerAddGroupBtn"); },
  get shortcutsBtn() { return el("shortcutsBtn"); },
  get shortcutsBtnIcon() { return el("shortcutsBtnIcon"); },
  get shortcutsBtnText() { return el("shortcutsBtnText"); },
  get dockThemeBtn() { return el("dockThemeBtn"); },
  get dockThemeBtnIcon() { return el("dockThemeBtnIcon"); },
  get bgOpacityBtn() { return el("bgOpacityBtn"); },

  // Import / Export Elements
  get importJsonBtn() { return el("importJsonBtn"); },
  get importBtnText() { return el("importBtnText"); },
  get exportBackupBtn() { return el("exportBackupBtn"); },
  get exportBtnText() { return el("exportBtnText"); },
  get importFileInput() { return el("importFileInput"); },
  get undoBanner() { return el("undoBanner"); },
  get undoBannerText() { return el("undoBannerText"); },
  get undoImportBtn() { return el("undoImportBtn"); },
  get dismissUndoBtn() { return el("dismissUndoBtn"); },

  // Background Gallery Elements
  get bgLayer() { return el("bgLayer"); },
  get bgImage() { return el("bgImage"); },
  get bgOverlay() { return el("bgOverlay"); },
  get bgFab() { return el("bgFab"); },
  get bgDock() { return el("bgDock"); },
  get bgDockActions() { return el("bgDockActions"); },
  get bgDockTrigger() { return el("bgDockTrigger") || el("bgToggleTrigger"); },
  get bgSourceBtn() { return el("bgSourceBtn"); },
  get bgToolbar() { return el("bgDockActions") || el("bgToolbar"); },
  get bgFavBtn() { return el("bgFavBtn"); },
  get bgNextBtn() { return el("bgNextBtn"); },
  get bgLockBtn() { return el("bgLockBtn"); },
  get bgCategoryBtn() { return el("bgCategoryBtn"); },
  get bgFreqBtn() { return el("bgFreqBtn"); },
  get bgInfoBtn() { return el("bgInfoBtn"); },
  get bgSettingsBtn() { return el("bgSettingsBtn"); },
  get bgToggleTrigger() { return el("bgDockTrigger") || el("bgToggleTrigger"); },
  get bgPopoverContainer() { return el("bgPopoverContainer"); },
  get bgHeaderBtn() { return el("bgHeaderBtn"); },
  get bgHeaderBtnText() { return el("bgHeaderBtnText"); },
  get catSortControls() { return el("catSortControls"); },
  get sortMostUsedBtn() { return el("sortMostUsedBtn"); },
  get sortRecentlyUsedBtn() { return el("sortRecentlyUsedBtn"); },
  get sortCreatedBtn() { return el("sortCreatedBtn"); },
  get a11yAnnouncer() { return el("a11yAnnouncer"); },
  get mainContent() { return el("mainContent"); },

  // Pinned Shelf Elements (BMK-PIN-001)
  get pinnedShelf() { return el("pinnedShelf"); },
  get pinnedShelfTitle() { return el("pinnedShelfTitle"); },
  get pinnedShelfCount() { return el("pinnedShelfCount"); },
  get pinnedShelfIcon() { return el("pinnedShelfIcon"); },
  get togglePinnedExpandBtn() { return el("togglePinnedExpandBtn"); },
  get togglePinnedExpandText() { return el("togglePinnedExpandText"); },
  get pinnedEmptyState() { return el("pinnedEmptyState"); },
  get pinnedEmptyText() { return el("pinnedEmptyText"); },
  get pinnedGrid() { return el("pinnedGrid"); },

  // Centralized Search Elements (BMK-SEARCH-001)
  get openSearchBtn() { return el("openSearchBtn"); },
  get searchBtnIcon() { return el("searchBtnIcon"); },
  get searchBtnText() { return el("searchBtnText"); },
  get searchShortcutBadge() { return el("searchShortcutBadge"); },
  get searchOverlay() { return el("searchOverlay"); },
  get searchDialog() { return el("searchDialog"); },
  get searchDialogTitle() { return el("searchDialogTitle"); },
  get searchModalIcon() { return el("searchModalIcon"); },
  get searchInput() { return el("searchInput"); },
  get closeSearchBtn() { return el("closeSearchBtn"); },
  get closeSearchIcon() { return el("closeSearchIcon"); },
  get searchSectionLabel() { return el("searchSectionLabel"); },
  get searchResultsListbox() { return el("searchResultsListbox"); },
  get searchEmptyState() { return el("searchEmptyState"); },
  get searchEmptyTitle() { return el("searchEmptyTitle"); },
  get searchEmptyDesc() { return el("searchEmptyDesc"); },
  get searchFooterNavHint() { return el("searchFooterNavHint"); },
  get searchShortcutNotice() { return el("searchShortcutNotice"); },
  get searchShortcutSettingsBtn() { return el("searchShortcutSettingsBtn"); },

  // Environment Filter & Privacy Controls (BMK-ENV-001 & BMK-PRIV-001)
  get envFilterBtn() { return el("envFilterBtn"); },
  get envFilterBtnText() { return el("envFilterBtnText"); },
  get envFilterDot() { return el("envFilterDot"); },
  get envFilterEmptyState() { return el("envFilterEmptyState"); },
  get envFilterEmptyTitle() { return el("envFilterEmptyTitle"); },
  get envFilterEmptyDesc() { return el("envFilterEmptyDesc"); },
  get resetEnvFilterBtn() { return el("resetEnvFilterBtn"); },
  get resetEnvFilterText() { return el("resetEnvFilterText"); },
  get privacyToggleBtn() { return el("privacyToggleBtn"); },
  get privacyToggleIcon() { return el("privacyToggleIcon"); }
};

// Initialize Application
async function bootstrapApp() {
  let savedLang = typeof localStorage !== "undefined" ? localStorage.getItem("powerless_toy_lang") : null;
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const stored = await chrome.storage.local.get("powerless_toy_lang");
      if (stored?.powerless_toy_lang) {
        savedLang = stored.powerless_toy_lang;
      }
    } catch {}
  }
  if (savedLang) {
    setLanguage(savedLang);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("powerless_toy_lang", savedLang);
    }
  }
  await initTheme();
  updateI18nLabels();
  updateThemeButtonUI();
  onThemeChange(() => updateThemeButtonUI());

  setupEventListeners();
  setupStorageSubscription();
  initStaticIcons();
  await initWorkbench();
  await initBackgroundUI(elements, openModal, closeModal);

  if (typeof window !== "undefined" && window.location?.hash) {
    if (window.location.hash === "#export") {
      setTimeout(() => openExportModal(), 100);
    } else if (window.location.hash === "#import") {
      setTimeout(() => elements.importFileInput?.click(), 100);
    } else if (window.location.hash === "#search") {
      setTimeout(() => openSearchModal(""), 100);
    }
  }

  // Check keyboard shortcut status
  if (typeof chrome !== "undefined" && chrome.commands?.getAll) {
    try {
      const commands = await chrome.commands.getAll();
      const searchCmd = commands.find((c) => c.name === "open-bookmark-search");
      if (searchCmd && !searchCmd.shortcut) {
        console.warn("[Bookmark Organizer] Centralized search shortcut is not bound. Configure it at chrome://extensions/shortcuts");
      }
    } catch {}
  }
}

if (typeof document !== "undefined" && document.addEventListener) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapApp);
  } else if (typeof window !== "undefined" && window.location?.protocol?.startsWith("http")) {
    bootstrapApp();
  } else {
    document.addEventListener("DOMContentLoaded", bootstrapApp);
  }
}

function setElementButtonText(btn, text) {
  if (!btn) return;
  const textSpan = btn.querySelector(".btn-text");
  if (textSpan) {
    textSpan.textContent = text;
  } else {
    const iconSlot = btn.querySelector(".icon-slot");
    if (iconSlot && typeof document !== "undefined") {
      const span = document.createElement("span");
      span.className = "btn-text";
      span.textContent = text;
      btn.replaceChildren(iconSlot, span);
    } else {
      btn.textContent = text;
    }
  }
}

function initStaticIcons() {
  const brandIconEl = el("brandIcon");
  if (brandIconEl) renderSvgIcon(brandIconEl, SVG_ICONS.bookmark);

  const importIconEl = el("importBtnIcon");
  if (importIconEl) renderSvgIcon(importIconEl, SVG_ICONS.import);

  const exportIconEl = el("exportBtnIcon");
  if (exportIconEl) renderSvgIcon(exportIconEl, SVG_ICONS.export);

  const langIconEl = el("langBtnIcon");
  if (langIconEl) renderSvgIcon(langIconEl, SVG_ICONS.globe);

  const manageIconEl = el("manageBtnIcon");
  if (manageIconEl) renderSvgIcon(manageIconEl, SVG_ICONS.manage);

  const addCatIcon = elements.addCategoryBtn?.querySelector(".icon-slot");
  if (addCatIcon) renderSvgIcon(addCatIcon, SVG_ICONS.circlePlus);

  const addGrpIcon = elements.addGroupBtn?.querySelector(".icon-slot");
  if (addGrpIcon) renderSvgIcon(addGrpIcon, SVG_ICONS.circlePlus);

  const renameCatIcon = elements.renameCatBtn?.querySelector(".icon-slot");
  if (renameCatIcon) renderSvgIcon(renameCatIcon, SVG_ICONS.edit);

  const deleteCatIcon = elements.deleteCatBtn?.querySelector(".icon-slot");
  if (deleteCatIcon) renderSvgIcon(deleteCatIcon, SVG_ICONS.trash);

  const retryIcon = elements.retryLoadBtn?.querySelector(".icon-slot");
  if (retryIcon) renderSvgIcon(retryIcon, SVG_ICONS.retry);

  const undoBannerIcon = el("undoIconSlot");
  if (undoBannerIcon) renderSvgIcon(undoBannerIcon, SVG_ICONS.checkCircle);

  const undoBtnIcon = elements.undoImportBtn?.querySelector(".icon-slot");
  if (undoBtnIcon) renderSvgIcon(undoBtnIcon, SVG_ICONS.undo);

  const dismissUndoIcon = elements.dismissUndoBtn?.querySelector(".icon-slot") || elements.dismissUndoBtn;
  if (dismissUndoIcon) renderSvgIcon(dismissUndoIcon, SVG_ICONS.close);

  const emptyCatIcon = el("emptyCategoryIcon");
  if (emptyCatIcon) renderSvgIcon(emptyCatIcon, SVG_ICONS.folder);

  const createFirstGrpIcon = elements.createFirstGroupBtn?.querySelector(".icon-slot");
  if (createFirstGrpIcon) renderSvgIcon(createFirstGrpIcon, SVG_ICONS.circlePlus);

  renderSvgIcon(elements.sortMostUsedBtn?.querySelector(".icon-slot"), SVG_ICONS.sortMostUsed);
  renderSvgIcon(elements.sortRecentlyUsedBtn?.querySelector(".icon-slot"), SVG_ICONS.sortRecentlyUsed);
  renderSvgIcon(elements.sortCreatedBtn?.querySelector(".icon-slot"), SVG_ICONS.sortCreatedAt);

  if (elements.pinnedShelfIcon) renderSvgIcon(elements.pinnedShelfIcon, FEATURE_ICONS.pinFilled);
  if (elements.searchBtnIcon) renderSvgIcon(elements.searchBtnIcon, FEATURE_ICONS.search);
  if (elements.searchModalIcon) renderSvgIcon(elements.searchModalIcon, FEATURE_ICONS.search);
  if (elements.closeSearchIcon) renderSvgIcon(elements.closeSearchIcon, SVG_ICONS.close);

  if (elements.moreMenuIcon) renderSvgIcon(elements.moreMenuIcon, SVG_ICONS.moreHorizontal);
  const headerAddGrpIcon = elements.headerAddGroupBtn?.querySelector(".icon-slot");
  if (headerAddGrpIcon) renderSvgIcon(headerAddGrpIcon, SVG_ICONS.circlePlus);
  if (elements.shortcutsBtnIcon) renderSvgIcon(elements.shortcutsBtnIcon, SVG_ICONS.settings);

  updatePrivacyToggleUI();
  updateEnvFilterUI();
}

function updateI18nLabels() {
  const lang = getLanguage();
  const shortcutLabel = getPlatformSearchShortcutLabel();
  if (elements.currentLangLabel) elements.currentLangLabel.textContent = lang.toUpperCase();
  if (elements.brandTitle) elements.brandTitle.textContent = t("appTitle");
  if (elements.tagline) elements.tagline.textContent = t("tagline");
  if (elements.manageBtnText) elements.manageBtnText.textContent = state.isManageMode ? t("doneManaging") : t("manageMode");
  setElementButtonText(elements.addCategoryBtn, t("addCategory"));
  setElementButtonText(elements.addGroupBtn, t("addGroup"));
  setElementButtonText(elements.renameCatBtn, t("rename"));
  setElementButtonText(elements.deleteCatBtn, t("delete"));
  if (elements.emptyCatTitle) elements.emptyCatTitle.textContent = t("noGroupsInCat");
  if (elements.emptyCatLead) elements.emptyCatLead.textContent = t("noGroupsLead");
  setElementButtonText(elements.createFirstGroupBtn, t("createFirstGroup"));
  if (elements.errorTitle) elements.errorTitle.textContent = t("loadErrorTitle");
  if (elements.errorDesc) elements.errorDesc.textContent = t("loadErrorDesc");
  setElementButtonText(elements.retryLoadBtn, t("retry"));
  if (elements.importBtnText) elements.importBtnText.textContent = t("importBtn");
  if (elements.exportBtnText) elements.exportBtnText.textContent = t("exportBtn");
  setElementButtonText(elements.undoImportBtn, t("undoImportBtn"));
  if (elements.bgHeaderBtnText) elements.bgHeaderBtnText.textContent = t("bgButton");
  if (elements.pinnedShelfTitle) elements.pinnedShelfTitle.textContent = t("pinnedShelfTitle");
  if (elements.pinnedEmptyText) elements.pinnedEmptyText.textContent = t("pinnedEmptyHint");
  if (elements.searchBtnText) elements.searchBtnText.textContent = t("searchBtn");
  if (elements.searchShortcutBadge) elements.searchShortcutBadge.textContent = shortcutLabel;
  if (elements.openSearchBtn) {
    elements.openSearchBtn.title = t("searchBtnHint", shortcutLabel);
    elements.openSearchBtn.setAttribute("aria-label", t("searchBtnHint", shortcutLabel));
  }
  if (elements.searchDialogTitle) elements.searchDialogTitle.textContent = t("searchDialogTitle");
  if (elements.searchInput) elements.searchInput.placeholder = t("searchPlaceholder");
  if (elements.searchFooterNavHint) elements.searchFooterNavHint.textContent = t("searchFooterNavHint");
  if (elements.searchShortcutNotice) elements.searchShortcutNotice.textContent = t("searchShortcutNotice");
  if (elements.searchShortcutSettingsBtn) elements.searchShortcutSettingsBtn.textContent = t("searchShortcutSettingsBtn");
  if (elements.sortMostUsedBtn) {
    elements.sortMostUsedBtn.title = t("sortMostUsed");
    elements.sortMostUsedBtn.setAttribute("aria-label", t("sortMostUsed"));
  }
  if (elements.sortRecentlyUsedBtn) {
    elements.sortRecentlyUsedBtn.title = t("sortRecentlyUsed");
    elements.sortRecentlyUsedBtn.setAttribute("aria-label", t("sortRecentlyUsed"));
  }
  if (elements.sortCreatedBtn) {
    elements.sortCreatedBtn.title = t("sortCreatedAt");
    elements.sortCreatedBtn.setAttribute("aria-label", t("sortCreatedAt"));
  }
  updateThemeButtonUI();
  updateBackgroundUI(elements);
  updateEnvFilterUI();
  updatePrivacyToggleUI();
}

async function initWorkbench() {
  try {
    if (elements.errorBanner) elements.errorBanner.style.display = "none";
    // Always restore hidden bookmarks to hidden on page init / refresh (BMK-PRIV-001)
    state.showHiddenBookmarks = false;
    updatePrivacyToggleUI();
    updateEnvFilterUI();
    state.data = await loadWorkbenchData();
    await renderAll();
  } catch (err) {
    console.error("Failed to load workbench data:", err);
    if (elements.errorDesc) {
      let desc = t("loadErrorDesc");
      if (err?.code === "CORRUPTED_LEGACY_DATA") {
        desc = `${t("migrationErrorDesc")} ${(err.details || []).slice(0, 5).join("; ")}`;
      }
      elements.errorDesc.textContent = desc;
    }
    elements.errorBanner.style.display = "flex";
  }
}

/**
 * Listen for data changes committed by other tabs (IndexedDB writes are
 * announced over BroadcastChannel). Reloads are debounced, and this tab keeps
 * its own active category so another tab's navigation does not move it.
 */
let syncTimer = null;
function setupStorageSubscription() {
  subscribeStorageChanges(() => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
      try {
        const localActive = state.data?.activeCategoryId;
        const freshData = await loadWorkbenchData();
        if (localActive && freshData.categories.some((c) => c.id === localActive)) {
          freshData.activeCategoryId = localActive;
        }
        state.data = freshData;
        await renderAll(false);
        if (state.isSearchOpen) {
          await refreshSearchResults();
        }
      } catch (err) {
        console.warn("Storage sync error from background/other tab:", err);
      }
    }, 80);
  });
}

function setupEventListeners() {
  // More Actions Menu (UI-ACTION-001)
  function closeMoreMenu() {
    if (elements.moreMenuDropdown) {
      elements.moreMenuDropdown.style.display = "none";
      elements.moreMenuBtn?.setAttribute("aria-expanded", "false");
    }
  }

  function openMoreMenu() {
    if (elements.moreMenuDropdown) {
      elements.moreMenuDropdown.style.display = "block";
      elements.moreMenuBtn?.setAttribute("aria-expanded", "true");
    }
  }

  elements.moreMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = elements.moreMenuDropdown?.style.display === "block";
    if (isOpen) {
      closeMoreMenu();
    } else {
      openMoreMenu();
    }
  });

  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      if (
        elements.moreMenuWrapper &&
        !elements.moreMenuWrapper.contains(e.target) &&
        elements.moreMenuDropdown?.style.display === "block"
      ) {
        closeMoreMenu();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && elements.moreMenuDropdown?.style.display === "block") {
        closeMoreMenu();
        elements.moreMenuBtn?.focus();
      }
    });
  }

  // Header Add Group Action (UI-ACTION-001)
  elements.headerAddGroupBtn?.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openAddGroupModal(activeCat.id);
  });

  // Dock Theme Button (UI-ACTION-001)
  elements.dockThemeBtn?.addEventListener("click", () => {
    openThemeModal();
  });

  // Shortcuts Button
  elements.shortcutsBtn?.addEventListener("click", () => {
    closeMoreMenu();
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
    } else {
      alert(t("searchShortcutNotice"));
    }
  });

  // Toggle Language
  elements.langToggleBtn?.addEventListener("click", async () => {
    closeMoreMenu();
    const nextLang = getLanguage() === "en" ? "ja" : "en";
    setLanguage(nextLang);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("powerless_toy_lang", nextLang);
    }
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ powerless_toy_lang: nextLang });
    }
    updateI18nLabels();
    renderAll(false);
  });

  // Toggle Manage Mode
  elements.toggleManageBtn?.addEventListener("click", () => {
    closeMoreMenu();
    state.isManageMode = !state.isManageMode;
    elements.toggleManageBtn.setAttribute("aria-pressed", state.isManageMode ? "true" : "false");
    elements.manageIndicator.style.display = state.isManageMode ? "inline-block" : "none";
    elements.manageBtnText.textContent = state.isManageMode ? t("doneManaging") : t("manageMode");
    renderAll(false);
  });

  // Theme Selector Button
  elements.themeToggleBtn?.addEventListener("click", () => {
    openThemeModal();
  });

  // Export Backup Button
  elements.exportBackupBtn?.addEventListener("click", () => {
    closeMoreMenu();
    handleExportBackup();
  });

  // Import JSON Button
  elements.importJsonBtn?.addEventListener("click", () => {
    closeMoreMenu();
    elements.importFileInput.value = "";
    elements.importFileInput.click();
  });

  // Import File Input change
  elements.importFileInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleImportFile(file);
  });

  // Undo Import Button
  elements.undoImportBtn?.addEventListener("click", async () => {
    if (!state.lastImportJobId) return;
    await handleUndoImport(state.lastImportJobId);
  });

  // Dismiss Undo Banner
  elements.dismissUndoBtn?.addEventListener("click", () => {
    elements.undoBanner.style.display = "none";
  });

  // Retry loading
  elements.retryLoadBtn?.addEventListener("click", () => {
    initWorkbench();
  });

  // Category Management Buttons
  elements.addCategoryBtn?.addEventListener("click", () => openAddCategoryModal());
  elements.renameCatBtn?.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openRenameCategoryModal(activeCat);
  });
  elements.deleteCatBtn?.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openDeleteCategoryModal(activeCat);
  });

  // Group Management Buttons
  elements.addGroupBtn?.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openAddGroupModal(activeCat.id);
  });
  elements.createFirstGroupBtn?.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openAddGroupModal(activeCat.id);
  });

  // Category Tabs keydown delegation (DEC-003)
  elements.categoryTabs?.addEventListener("keydown", (e) => {
    if (state.activeModal) return;
    const tabElements = Array.from(elements.categoryTabs.querySelectorAll(".category-tab"));
    const currentIndex = tabElements.indexOf(document.activeElement);
    if (currentIndex !== -1) {
      handleCategoryKeydown(e, tabElements, currentIndex, async (newCatId) => {
        await switchCategory(newCatId, true);
      });
    }
  });

  // Category Group Sort Controls
  renderSvgIcon(elements.sortMostUsedBtn?.querySelector(".icon-slot"), SVG_ICONS.sortMostUsed);
  renderSvgIcon(elements.sortRecentlyUsedBtn?.querySelector(".icon-slot"), SVG_ICONS.sortRecentlyUsed);
  renderSvgIcon(elements.sortCreatedBtn?.querySelector(".icon-slot"), SVG_ICONS.sortCreatedAt);

  elements.sortMostUsedBtn?.addEventListener("click", () => handleSortToggle("most_used"));
  elements.sortRecentlyUsedBtn?.addEventListener("click", () => handleSortToggle("recently_used"));
  elements.sortCreatedBtn?.addEventListener("click", () => handleSortToggle("created_at"));

  // Environment Filter Cycling Button & Reset (BMK-ENV-001)
  elements.envFilterBtn?.addEventListener("click", () => {
    cycleEnvFilter();
  });
  elements.resetEnvFilterBtn?.addEventListener("click", () => {
    setEnvFilter("ALL");
  });

  // Private / Hidden Bookmarks Lock Toggle Button (BMK-PRIV-001)
  elements.privacyToggleBtn?.addEventListener("click", () => {
    toggleHiddenBookmarksVisibility();
  });

  // Pinned Shelf Expand/Collapse Toggle (BMK-PIN-001)
  elements.togglePinnedExpandBtn?.addEventListener("click", () => {
    state.isPinnedExpanded = !state.isPinnedExpanded;
    renderPinnedShelf();
  });

  // Centralized Spotlight Search Events (BMK-SEARCH-001)
  elements.openSearchBtn?.addEventListener("click", () => {
    openSearchModal("");
  });

  elements.closeSearchBtn?.addEventListener("click", () => {
    closeSearchModal();
  });

  elements.searchOverlay?.addEventListener("click", (e) => {
    if (e.target === elements.searchOverlay) {
      closeSearchModal();
    }
  });

  elements.searchInput?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value || "";
    state.searchSelectedIndex = 0;
    refreshSearchResults();
  });

  elements.searchDialog?.addEventListener("keydown", (e) => {
    handleSearchDialogKeydown(e);
  });

  elements.searchShortcutSettingsBtn?.addEventListener("click", () => {
    openExtensionShortcutSettings();
  });

  // Global keyboard shortcuts for Centralized Search (Ctrl/Cmd+K and '/')
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("keydown", handleGlobalSearchKeydown);
  }

  // Extension command listener (when user triggers shortcut via browser extension command)
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === "OPEN_BOOKMARK_SEARCH") {
        openSearchModal("");
        if (typeof sendResponse === "function") {
          sendResponse({ success: true });
        }
        return true;
      }
    });
  }
  if (typeof chrome !== "undefined" && chrome.commands?.onCommand) {
    chrome.commands.onCommand.addListener((command) => {
      if (command === "open-bookmark-search") {
        openSearchModal("");
      }
    });
  }

  // Hash route listener for in-situ overlay triggers
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("hashchange", () => {
      if (window.location.hash === "#search") {
        openSearchModal("");
      } else if (window.location.hash === "#export") {
        openExportModal();
      } else if (window.location.hash === "#import") {
        elements.importFileInput?.click();
      }
    });
  }
}

let currentDraggedGroupId = null;

function getCategorySortMode(categoryId) {
  try {
    return localStorage.getItem(`powerless_toy_cat_sort_${categoryId}`) || "manual";
  } catch {
    return "manual";
  }
}

function setCategorySortMode(categoryId, mode) {
  try {
    localStorage.setItem(`powerless_toy_cat_sort_${categoryId}`, mode);
  } catch {
    // Ignore storage errors
  }
}

function announceA11y(message) {
  if (elements.a11yAnnouncer) {
    elements.a11yAnnouncer.textContent = "";
    setTimeout(() => {
      if (elements.a11yAnnouncer) {
        elements.a11yAnnouncer.textContent = message;
      }
    }, 50);
  }
}

async function handleSortToggle(mode) {
  const activeCat = getActiveCategory();
  if (!activeCat) return;

  const currentMode = getCategorySortMode(activeCat.id);
  const nextMode = currentMode === mode ? "manual" : mode;
  setCategorySortMode(activeCat.id, nextMode);
  await renderGroups();
}

// ==========================================================================
// Theme UI Controller (VIEW-THEME-001 & VIEW-THEME-002)
// ==========================================================================

function updateThemeButtonUI() {
  const mode = getThemeMode();
  const resolved = getResolvedTheme();
  const autoInfo = getAutoInfo();

  let icon = SVG_ICONS.themeSystem;
  let text = t("themeLabel");
  let tooltip = t("themeLabel");

  if (mode === "light") {
    icon = SVG_ICONS.themeLight;
    text = t("themeLight");
    tooltip = `${t("themeLabel")}: ${t("themeLight")}`;
  } else if (mode === "dark") {
    icon = SVG_ICONS.themeDark;
    text = t("themeDark");
    tooltip = `${t("themeLabel")}: ${t("themeDark")}`;
  } else if (mode === "system") {
    icon = SVG_ICONS.themeSystem;
    const sub = resolved === "dark" ? t("themeDark") : t("themeLight");
    text = `${t("themeSystem")} (${sub})`;
    tooltip = `${t("themeLabel")}: ${t("themeSystem")}`;
  } else if (mode === "auto") {
    icon = SVG_ICONS.themeAuto;
    if (autoInfo) {
      const currentScheme = autoInfo.resolvedTheme === "dark" ? t("themeDark") : t("themeLight");
      const transType = autoInfo.nextTransitionType === "sunrise" ? t("sunriseText") : t("sunsetText");
      text = `${currentScheme}`;
      tooltip = `${t("themeAuto")}: ${currentScheme} · ${t(
        "nextTransitionLabel",
        transType,
        autoInfo.nextTransitionTimeStr
      )}`;
    } else {
      text = t("themeAuto");
      tooltip = `${t("themeLabel")}: ${t("themeAuto")}`;
    }
  }

  if (elements.themeBtnIcon) renderSvgIcon(elements.themeBtnIcon, icon);
  if (elements.themeBtnText) elements.themeBtnText.textContent = text;
  if (elements.themeToggleBtn) elements.themeToggleBtn.title = tooltip;

  if (elements.dockThemeBtn) {
    elements.dockThemeBtn.title = tooltip;
    elements.dockThemeBtn.setAttribute("aria-label", tooltip);
    const dockIconSlot = elements.dockThemeBtnIcon || elements.dockThemeBtn.querySelector(".icon-slot");
    if (dockIconSlot) renderSvgIcon(dockIconSlot, icon);
  }
}

function openThemeModal() {
  const container = document.createElement("div");
  container.className = "theme-options-list";

  const currentMode = getThemeMode();
  const autoInfo = getAutoInfo();

  const options = [
    {
      key: "system",
      title: t("themeSystem"),
      desc: "Automatically match your operating system theme.",
      icon: SVG_ICONS.themeSystem
    },
    {
      key: "light",
      title: t("themeLight"),
      desc: "Bright, focused workbench suitable for daytime work.",
      icon: SVG_ICONS.themeLight
    },
    {
      key: "dark",
      title: t("themeDark"),
      desc: "High-contrast dark surface suitable for low light.",
      icon: SVG_ICONS.themeDark
    },
    {
      key: "auto",
      title: t("themeAuto"),
      desc: "Calculate local sunrise and sunset to switch automatically.",
      icon: SVG_ICONS.themeAuto,
      badge: autoInfo
        ? `${autoInfo.resolvedTheme === "dark" ? t("themeDark") : t("themeLight")} · ${t(
            "nextTransitionLabel",
            autoInfo.nextTransitionType === "sunrise" ? t("sunriseText") : t("sunsetText"),
            autoInfo.nextTransitionTimeStr
          )}`
        : null
    }
  ];

  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `theme-option-btn ${currentMode === opt.key ? "selected" : ""}`;
    btn.setAttribute("role", "button");
    btn.setAttribute("aria-pressed", currentMode === opt.key ? "true" : "false");

    const left = document.createElement("div");
    left.className = "theme-option-main";

    const iconSpan = document.createElement("span");
    iconSpan.className = "theme-option-icon";
    renderSvgIcon(iconSpan, opt.icon);
    left.appendChild(iconSpan);

    const textCol = document.createElement("div");
    textCol.className = "theme-option-text";

    const titleEl = document.createElement("span");
    titleEl.className = "theme-option-title";
    titleEl.textContent = opt.title;
    textCol.appendChild(titleEl);

    const descEl = document.createElement("span");
    descEl.className = "theme-option-desc";
    descEl.textContent = opt.desc;
    textCol.appendChild(descEl);

    left.appendChild(textCol);
    btn.appendChild(left);

    if (opt.badge) {
      const badgeEl = document.createElement("span");
      badgeEl.className = "theme-info-badge";
      badgeEl.textContent = opt.badge;
      btn.appendChild(badgeEl);
    }

    btn.addEventListener("click", async () => {
      closeModal();
      const res = await setThemeMode(opt.key);
      updateThemeButtonUI();
      if (res.notice) {
        showThemeNotice(res.notice);
      }
    });

    container.appendChild(btn);
  });

  openModal(t("themeTitle"), container, () => true, "Close");
}

function showThemeNotice(message) {
  if (elements.errorBanner && elements.errorDesc) {
    elements.errorTitle.textContent = t("themeLabel");
    elements.errorDesc.textContent = message;
    elements.errorBanner.style.display = "flex";
    setTimeout(() => {
      if (elements.errorTitle.textContent === t("themeLabel")) {
        elements.errorBanner.style.display = "none";
      }
    }, 6000);
  }
}

// ==========================================================================
// Backup Export & Import Handlers (DATA-EXPORT-002)
// ==========================================================================

async function openExportModal() {
  try {
    const latestData = await loadWorkbenchData();
    const categories = Array.isArray(latestData?.categories) ? latestData.categories : [];
    const groups = Array.isArray(latestData?.groups) ? latestData.groups : [];
    const links = Array.isArray(latestData?.links) ? latestData.links : [];

    const container = document.createElement("div");
    container.className = "selective-export-modal";

    // Section 1: Tab Selection
    const tabsSection = document.createElement("div");
    tabsSection.className = "export-section";

    const tabsHeaderRow = document.createElement("div");
    tabsHeaderRow.className = "export-section-header-row";

    const tabsTitle = document.createElement("h4");
    tabsTitle.className = "export-section-title";
    tabsTitle.textContent = t("exportTabsHeader");
    tabsHeaderRow.appendChild(tabsTitle);

    const quickActions = document.createElement("div");
    quickActions.className = "export-quick-actions";

    const selectAllBtn = document.createElement("button");
    selectAllBtn.type = "button";
    selectAllBtn.className = "btn btn-ghost btn-sm";
    selectAllBtn.textContent = t("exportSelectAll");

    const deselectAllBtn = document.createElement("button");
    deselectAllBtn.type = "button";
    deselectAllBtn.className = "btn btn-ghost btn-sm";
    deselectAllBtn.textContent = t("exportDeselectAll");

    const currentTabOnlyBtn = document.createElement("button");
    currentTabOnlyBtn.type = "button";
    currentTabOnlyBtn.className = "btn btn-ghost btn-sm";
    currentTabOnlyBtn.textContent = t("exportCurrentTabOnly");

    quickActions.appendChild(selectAllBtn);
    quickActions.appendChild(deselectAllBtn);
    quickActions.appendChild(currentTabOnlyBtn);
    tabsHeaderRow.appendChild(quickActions);
    tabsSection.appendChild(tabsHeaderRow);

    const tabsList = document.createElement("div");
    tabsList.className = "export-tabs-list";

    const checkboxes = [];
    categories.forEach((cat) => {
      const catGroups = groups.filter((g) => g.categoryId === cat.id);
      const catGroupIds = new Set(catGroups.map((g) => g.id));
      const catLinks = links.filter((l) => catGroupIds.has(l.groupId));

      const itemLabel = document.createElement("label");
      itemLabel.className = "export-tab-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = cat.id;
      cb.checked = true;
      cb.dataset.catName = cat.name;
      checkboxes.push(cb);

      const nameSpan = document.createElement("span");
      nameSpan.className = "export-tab-name";
      nameSpan.textContent = cat.name;

      const countBadge = document.createElement("span");
      countBadge.className = "export-tab-badge";
      countBadge.textContent = t("tabGroupLinkCount", catGroups.length, catLinks.length);

      itemLabel.appendChild(cb);
      itemLabel.appendChild(nameSpan);
      itemLabel.appendChild(countBadge);
      tabsList.appendChild(itemLabel);
    });
    tabsSection.appendChild(tabsList);

    const validationMsg = document.createElement("div");
    validationMsg.className = "export-validation-msg";
    validationMsg.style.display = "none";
    validationMsg.textContent = t("exportMinOneTab");
    tabsSection.appendChild(validationMsg);
    container.appendChild(tabsSection);

    // Section 2: Format Selection
    const formatSection = document.createElement("div");
    formatSection.className = "export-section";

    const formatTitle = document.createElement("h4");
    formatTitle.className = "export-section-title";
    formatTitle.textContent = t("exportFormatHeader");
    formatSection.appendChild(formatTitle);

    const formatOptions = document.createElement("div");
    formatOptions.className = "export-format-options";

    const jsonLabel = document.createElement("label");
    jsonLabel.className = "export-format-item";
    const jsonRadio = document.createElement("input");
    jsonRadio.type = "radio";
    jsonRadio.name = "exportFormat";
    jsonRadio.value = "json";
    jsonRadio.checked = true;
    const jsonText = document.createElement("span");
    jsonText.textContent = t("exportFormatJson");
    jsonLabel.appendChild(jsonRadio);
    jsonLabel.appendChild(jsonText);

    const htmlLabel = document.createElement("label");
    htmlLabel.className = "export-format-item";
    const htmlRadio = document.createElement("input");
    htmlRadio.type = "radio";
    htmlRadio.name = "exportFormat";
    htmlRadio.value = "html";
    const htmlText = document.createElement("span");
    htmlText.textContent = t("exportFormatHtml");
    htmlLabel.appendChild(htmlRadio);
    htmlLabel.appendChild(htmlText);

    formatOptions.appendChild(jsonLabel);
    formatOptions.appendChild(htmlLabel);
    formatSection.appendChild(formatOptions);
    container.appendChild(formatSection);

    // Section 3: Privacy & Disclaimers
    const optionsSection = document.createElement("div");
    optionsSection.className = "export-section";

    const hiddenLabel = document.createElement("label");
    hiddenLabel.className = "export-option-item";
    const hiddenCb = document.createElement("input");
    hiddenCb.type = "checkbox";
    hiddenCb.id = "exportIncludeHiddenCheckbox";
    hiddenCb.checked = true; // Default true for JSON
    const hiddenText = document.createElement("span");
    hiddenText.textContent = t("exportIncludeHidden");
    hiddenLabel.appendChild(hiddenCb);
    hiddenLabel.appendChild(hiddenText);
    optionsSection.appendChild(hiddenLabel);

    const disclaimerNote = document.createElement("div");
    disclaimerNote.className = "export-disclaimer-note";
    disclaimerNote.textContent = t("exportHiddenNotice");
    optionsSection.appendChild(disclaimerNote);
    container.appendChild(optionsSection);

    function updateState() {
      const checkedCount = checkboxes.filter((c) => c.checked).length;
      const confirmBtn = document.querySelector(".modal-confirm-btn");
      if (checkedCount === 0) {
        validationMsg.style.display = "block";
        if (confirmBtn) confirmBtn.disabled = true;
      } else {
        validationMsg.style.display = "none";
        if (confirmBtn) confirmBtn.disabled = false;
      }

      const isHtml = htmlRadio.checked;
      if (isHtml) {
        disclaimerNote.textContent = `${t("exportHtmlDisclaimer")} ${t("exportHiddenNotice")}`;
      } else {
        disclaimerNote.textContent = t("exportHiddenNotice");
      }
    }

    checkboxes.forEach((cb) => cb.addEventListener("change", updateState));
    jsonRadio.addEventListener("change", () => {
      hiddenCb.checked = true;
      updateState();
    });
    htmlRadio.addEventListener("change", () => {
      hiddenCb.checked = false;
      updateState();
    });

    selectAllBtn.addEventListener("click", () => {
      checkboxes.forEach((c) => (c.checked = true));
      updateState();
    });

    deselectAllBtn.addEventListener("click", () => {
      checkboxes.forEach((c) => (c.checked = false));
      updateState();
    });

    currentTabOnlyBtn.addEventListener("click", () => {
      checkboxes.forEach((c) => (c.checked = c.value === state.activeCategoryId));
      updateState();
    });

    openModal(
      t("exportModalTitle"),
      container,
      async () => {
        const selectedIds = checkboxes.filter((c) => c.checked).map((c) => c.value);
        if (selectedIds.length === 0) return false;

        const isHtml = htmlRadio.checked;
        const includeHidden = hiddenCb.checked;
        const selectedCats = categories.filter((c) => selectedIds.includes(c.id));
        const selectedNames = selectedCats.map((c) => c.name);

        let blob;
        let filename;

        if (isHtml) {
          const htmlContent = generateNetscapeBookmarkHtml(latestData, selectedIds, { includeHidden });
          blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
          filename = getSelectiveBackupFilename({ format: "html", selectedCategoryNames: selectedNames });
        } else {
          const jsonObj = generateSelectiveBackupJson(latestData, selectedIds, { includeHidden });
          blob = new Blob([JSON.stringify(jsonObj, null, 2)], { type: "application/json" });
          filename = getSelectiveBackupFilename({ format: "json", selectedCategoryNames: selectedNames });
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
      },
      t("exportConfirmBtn")
    );

    updateState();
  } catch (err) {
    alert(`Export configuration failed: ${err.message}`);
  }
}

async function handleExportBackup() {
  await openExportModal();
}

async function handleImportFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    alert(`Could not read file: ${err.message}`);
    return;
  }

  // generateImportPreview reads the latest categories/groups/links/importJobs directly from IndexedDB
  const preview = await generateImportPreview({
    fileContent: text,
    fileName: file.name
  });

  if (!preview.valid) {
    openImportErrorsModal(preview.errors);
    return;
  }

  openImportPreviewModal(file.name, text, preview);
}

function openImportErrorsModal(errors) {
  const container = document.createElement("div");
  container.className = "form-group";

  const errorTitle = document.createElement("p");
  errorTitle.className = "form-label";
  errorTitle.style.color = "var(--danger)";
  errorTitle.textContent = "The selected file is invalid and cannot be imported:";
  container.appendChild(errorTitle);

  const list = document.createElement("ul");
  list.style.paddingLeft = "20px";
  list.style.color = "var(--danger)";
  errors.forEach((err) => {
    const li = document.createElement("li");
    li.textContent = err;
    list.appendChild(li);
  });
  container.appendChild(list);

  openModal("Import Error", container, () => true, "Close");
}

function openImportPreviewModal(fileName, fileContent, preview, noticeMessage = "") {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "14px";

  if (noticeMessage) {
    const noticeBox = document.createElement("div");
    noticeBox.className = "error-banner";
    const noticeTxt = document.createElement("span");
    noticeTxt.style.fontSize = "13px";
    noticeTxt.textContent = noticeMessage;
    noticeBox.appendChild(noticeTxt);
    container.appendChild(noticeBox);
  }

  // Warning banner if already imported
  if (preview.alreadyImported) {
    const warnBox = document.createElement("div");
    warnBox.className = "error-banner";
    warnBox.style.background = "var(--badge-test-bg)";
    warnBox.style.borderColor = "var(--badge-test-border)";
    const warnTxt = document.createElement("span");
    warnTxt.style.color = "var(--badge-test-text)";
    warnTxt.style.fontSize = "13px";
    warnTxt.textContent = `Notice: This exact file was previously imported on ${new Date(preview.lastImportedAt).toLocaleString()}. You can still proceed if you wish.`;
    warnBox.appendChild(warnTxt);
    container.appendChild(warnBox);
  }

  // Summary Card
  const statsCard = document.createElement("div");
  statsCard.className = "preview-stats-grid";

  function addStatRow(label, value) {
    const row = document.createElement("div");
    row.className = "preview-stat-row";
    const lbl = document.createElement("span");
    lbl.textContent = label;
    const val = document.createElement("span");
    val.className = "preview-stat-val";
    val.textContent = String(value);
    row.appendChild(lbl);
    row.appendChild(val);
    statsCard.appendChild(row);
  }

  addStatRow("File Name:", fileName);
  addStatRow("Format Version:", preview.formatVersion);
  addStatRow("Total Categories in File:", preview.totalCategories);
  addStatRow("Total Groups in File:", preview.totalGroups);
  addStatRow("Total Links in File:", preview.totalLinks);
  addStatRow("Categories to Add:", preview.willAdd.categories);
  addStatRow("Categories to Merge:", preview.willMerge.categories);
  addStatRow("Groups to Add:", preview.willAdd.groups);
  addStatRow("Groups to Merge:", preview.willMerge.groups);
  addStatRow("New Links to Add:", preview.willAdd.links);
  addStatRow("Exact Duplicate Links (Skip):", preview.willSkipCount);
  addStatRow("Conflicts Detected:", preview.conflictCount);

  container.appendChild(statsCard);

  // Conflicts Section (if any) — keyed by deterministic `c.conflictKey` (e.g. "links[0]")
  const conflictResolutions = {};
  if (preview.conflictCount > 0) {
    const conflictSection = document.createElement("div");
    conflictSection.className = "form-group";

    const conflictTitle = document.createElement("label");
    conflictTitle.className = "form-label";
    conflictTitle.textContent = `${t("conflictChoiceTitle")} (${preview.conflictCount})`;
    conflictSection.appendChild(conflictTitle);

    const conflictList = document.createElement("div");
    conflictList.className = "conflict-list-container";

    preview.conflicts.forEach((c, idx) => {
      conflictResolutions[c.conflictKey] = "keep_existing";

      const card = document.createElement("div");
      card.className = "conflict-card";

      const urlSpan = document.createElement("span");
      urlSpan.className = "conflict-url";
      urlSpan.textContent = c.url;
      card.appendChild(urlSpan);

      const descSpan = document.createElement("span");
      descSpan.textContent = `Existing: "${c.existingName}" [${c.existingBadge || "no tag"}] ➔ Incoming: "${c.incomingName}" [${c.incomingBadge || "no tag"}]`;
      card.appendChild(descSpan);

      const opts = document.createElement("div");
      opts.className = "conflict-options";

      const keepExistLabel = document.createElement("label");
      const keepExistRadio = document.createElement("input");
      keepExistRadio.type = "radio";
      keepExistRadio.name = `conflict_${idx}`;
      keepExistRadio.value = "keep_existing";
      keepExistRadio.checked = true;
      keepExistRadio.addEventListener("change", () => {
        conflictResolutions[c.conflictKey] = "keep_existing";
      });
      keepExistLabel.appendChild(keepExistRadio);
      keepExistLabel.appendChild(document.createTextNode(t("keepExisting")));

      const keepBothLabel = document.createElement("label");
      const keepBothRadio = document.createElement("input");
      keepBothRadio.type = "radio";
      keepBothRadio.name = `conflict_${idx}`;
      keepBothRadio.value = "keep_both";
      keepBothRadio.addEventListener("change", () => {
        conflictResolutions[c.conflictKey] = "keep_both";
      });
      keepBothLabel.appendChild(keepBothRadio);
      keepBothLabel.appendChild(document.createTextNode(t("keepBoth")));

      opts.appendChild(keepExistLabel);
      opts.appendChild(keepBothLabel);
      card.appendChild(opts);

      conflictList.appendChild(card);
    });

    conflictSection.appendChild(conflictList);
    container.appendChild(conflictSection);
  }

  // Option to preserve pinned state from backup (defaults to false for normal append import, BMK-PIN-001)
  const pinOptRow = document.createElement("label");
  pinOptRow.className = "bg-popover-label-row";
  pinOptRow.style.padding = "4px 0";
  const preservePinnedCheckbox = document.createElement("input");
  preservePinnedCheckbox.type = "checkbox";
  preservePinnedCheckbox.id = "importPreservePinnedCheckbox";
  preservePinnedCheckbox.checked = false;
  const pinOptText = document.createElement("span");
  pinOptText.textContent = t("preservePinnedOnImport");
  pinOptRow.appendChild(preservePinnedCheckbox);
  pinOptRow.appendChild(pinOptText);
  container.appendChild(pinOptRow);

  openModal(
    t("importPreviewTitle"),
    container,
    async () => {
      try {
        const preservePinned = Boolean(preservePinnedCheckbox.checked);
        const result = await executeImport({
          importData: fileContent,
          fileName,
          conflictResolutions,
          expectedPlanSignature: preservePinned ? undefined : preview.planSignature,
          preservePinned
        });

        state.lastImportJobId = result.importJob.id;
        await initWorkbench();

        // Show Undo Banner
        elements.undoBannerText.textContent = t(
          "importSuccessMsg",
          result.importJob.addedLinkIds.length,
          result.importJob.skippedCount,
          result.importJob.conflictCount
        );
        elements.undoBanner.style.display = "flex";

        return true;
      } catch (err) {
        if (err?.code === "PREVIEW_STALE") {
          const refreshed = await generateImportPreview({ fileContent, fileName });
          if (refreshed.valid) {
            openImportPreviewModal(fileName, fileContent, refreshed, t("previewStaleNotice"));
            return false;
          }
        }
        alert(`Import failed: ${err.message}`);
        return false;
      }
    },
    t("confirmImportBtn")
  );
}

/**
 * Safe Undo Import flow:
 * 1. Previews whether all imported items are still at revision 1 and contain no
 *    user-added children.
 * 2. If safe, executes `undoImport`.
 * 3. If blocked, displays the impact preview modal listing the modified/added
 *    items and allowing explicit snapshot restoration if desired.
 */
async function handleUndoImport(importJobId) {
  try {
    const analysis = await previewUndoImport(importJobId);
    if (analysis.canUndo) {
      await undoImport(importJobId);
      state.lastImportJobId = null;
      elements.undoBanner.style.display = "none";
      await initWorkbench();
      alert(t("undoSuccessMsg"));
      return;
    }

    const impact = analysis.snapshotId
      ? await previewSnapshotRestore(analysis.snapshotId)
      : null;
    openUndoBlockedModal(importJobId, analysis, impact);
  } catch (err) {
    alert(`Failed to undo import: ${err.message}`);
  }
}

function openUndoBlockedModal(importJobId, analysis, impact) {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "12px";

  const lead = document.createElement("p");
  lead.textContent = t("undoBlockedMsg");
  container.appendChild(lead);

  const list = document.createElement("ul");
  list.style.paddingLeft = "20px";
  for (const m of analysis.blockers.modified) {
    const li = document.createElement("li");
    li.textContent = `Modified ${m.type}: "${m.name}" (revision ${m.revision})`;
    list.appendChild(li);
  }
  for (const g of analysis.blockers.foreignGroups) {
    const li = document.createElement("li");
    li.textContent = `User-created group inside imported category: "${g.name}"`;
    list.appendChild(li);
  }
  for (const l of analysis.blockers.foreignLinks) {
    const li = document.createElement("li");
    li.textContent = `User-created link inside imported group: "${l.name}" (${l.url})`;
    list.appendChild(li);
  }
  container.appendChild(list);

  if (impact) {
    const impactNote = document.createElement("p");
    impactNote.style.color = "var(--danger)";
    impactNote.style.fontSize = "13px";
    impactNote.textContent =
      `Snapshot restore impact: will remove ${impact.categories.removed} category(ies), ` +
      `${impact.groups.removed} group(s), and ${impact.links.removed} link(s) created since the import.`;
    container.appendChild(impactNote);
  }

  openModal(
    t("undoBlockedTitle"),
    container,
    async () => {
      if (!analysis.snapshotId) return true;
      await restoreSnapshot(analysis.snapshotId, { markImportJobReverted: importJobId });
      state.lastImportJobId = null;
      elements.undoBanner.style.display = "none";
      await initWorkbench();
      return true;
    },
    t("restoreSnapshotConfirmBtn"),
    true
  );
}

function getActiveCategory() {
  if (!state.data || !state.data.categories || state.data.categories.length === 0) return null;
  return state.data.categories.find((c) => c.id === state.data.activeCategoryId) || state.data.categories[0];
}

/**
 * Check whether a bookmark link should be displayed in the current UI view (BMK-PRIV-001 & BMK-ENV-001).
 * Hidden rule ALWAYS takes strict precedence over environment filter.
 */
function isLinkVisibleInCurrentView(link) {
  if (!link || typeof link !== "object") return false;
  if (!state.showHiddenBookmarks && link.hidden === true) {
    return false;
  }
  return matchesEnvFilter(link, state.envFilter);
}

function updateEnvFilterUI() {
  const env = String(state.envFilter || "ALL").trim().toUpperCase();
  const isActive = env !== "ALL";
  if (elements.envFilterBtn) {
    elements.envFilterBtn.dataset.envFilter = env;
    elements.envFilterBtn.setAttribute("aria-pressed", isActive ? "true" : "false");
    elements.envFilterBtn.classList.toggle("is-active", isActive);
    const title = t("envFilterBtnTitle", env);
    elements.envFilterBtn.title = title;
    elements.envFilterBtn.setAttribute("aria-label", title);
  }
  if (elements.envFilterBtnText) {
    elements.envFilterBtnText.textContent = t("envFilterBtnText", env);
  }
  if (elements.resetEnvFilterText) {
    elements.resetEnvFilterText.textContent = t("envFilterResetBtn");
  }
}

function setEnvFilter(nextFilter = "ALL") {
  const normalized = String(nextFilter || "ALL").trim().toUpperCase();
  state.envFilter = ENV_FILTER_ORDER.includes(normalized) ? normalized : "ALL";
  updateEnvFilterUI();
  renderCategoryContent();
  return state.envFilter;
}

function cycleEnvFilter() {
  return setEnvFilter(getNextEnvFilter(state.envFilter));
}

function updatePrivacyToggleUI() {
  const revealed = Boolean(state.showHiddenBookmarks);
  if (elements.privacyToggleBtn) {
    elements.privacyToggleBtn.setAttribute("aria-pressed", revealed ? "true" : "false");
    elements.privacyToggleBtn.classList.toggle("is-unlocked", revealed);
    const title = revealed ? t("hideHiddenTitle") : t("showHiddenTitle");
    elements.privacyToggleBtn.title = title;
    elements.privacyToggleBtn.setAttribute("aria-label", title);
  }
  const iconTarget = elements.privacyToggleIcon || elements.privacyToggleBtn;
  if (iconTarget) {
    renderSvgIcon(iconTarget, revealed ? SVG_ICONS.unlock : SVG_ICONS.lock);
  }
}

function setShowHiddenBookmarks(visible) {
  state.showHiddenBookmarks = Boolean(visible);
  updatePrivacyToggleUI();
  renderAll(false);
  if (state.isSearchOpen) {
    refreshSearchResults();
  }
  return state.showHiddenBookmarks;
}

function toggleHiddenBookmarksVisibility() {
  return setShowHiddenBookmarks(!state.showHiddenBookmarks);
}

function createHiddenIndicatorBadge() {
  const pill = document.createElement("span");
  pill.className = "link-hidden-indicator";
  pill.title = t("hideBookmarkHint");
  const iconSpan = document.createElement("span");
  iconSpan.className = "link-hidden-indicator-icon icon-slot";
  renderSvgIcon(iconSpan, SVG_ICONS.lock);
  const textSpan = document.createElement("span");
  textSpan.className = "link-hidden-indicator-text";
  textSpan.textContent = t("hiddenBookmarkBadge");
  pill.appendChild(iconSpan);
  pill.appendChild(textSpan);
  return pill;
}

/**
 * Switch active category without destroying tab DOM elements.
 * Preserves keyboard focus on the newly selected tab.
 */
async function switchCategory(catId, preserveFocus = false) {
  if (!state.data) return;
  state.data.activeCategoryId = catId;
  await setActiveCategory(state.data, catId);

  // Update existing category tab button states in place without recreating DOM
  const tabs = elements.categoryTabs.querySelectorAll(".category-tab");
  tabs.forEach((tab) => {
    const isActive = tab.dataset.categoryId === catId;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute("tabindex", isActive ? "0" : "-1");
    if (isActive && preserveFocus) {
      tab.focus();
    }
  });

  renderCategoryContent();

  const activeTabEl = elements.categoryTabs.querySelector(`[data-category-id="${catId}"]`);
  if (activeTabEl && typeof activeTabEl.scrollIntoView === "function") {
    activeTabEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }
}

// ==========================================================================
// Rendering
// ==========================================================================

async function renderAll(maintainActiveFocus = false) {
  if (!state.data) return;
  elements.mainContent?.classList.toggle("is-manage-mode", Boolean(state.isManageMode));
  renderCategoryTabs(maintainActiveFocus);
  await renderCategoryContent();
}

async function renderCategoryContent() {
  elements.mainContent?.classList.toggle("is-manage-mode", Boolean(state.isManageMode));
  renderPinnedShelf();
  renderActiveCategoryHeader();
  await renderGroups();
}

let currentDraggedPinnedId = null;

/**
 * Render the Tab-Scoped Pinned Shelf at the top of mainContent (BMK-PIN-002).
 * Scoped to the active category and respects both hidden state (BMK-PRIV-001)
 * and active environment filter (BMK-ENV-001).
 */
function renderPinnedShelf() {
  if (!elements.pinnedShelf || !state.data) return;

  const activeCat = getActiveCategory();
  const pinnedLinks = getPinnedLinks(state.data, {
    categoryId: activeCat?.id || null,
    includeHidden: Boolean(state.showHiddenBookmarks),
    envFilter: state.envFilter || "ALL"
  });
  const count = pinnedLinks.length;

  if (elements.pinnedShelfTitle) {
    elements.pinnedShelfTitle.textContent = t("pinnedShelfTitle");
  }
  if (elements.pinnedShelfCount) {
    elements.pinnedShelfCount.textContent = String(count);
  }
  if (elements.pinnedEmptyText) {
    const activeEnv = String(state.envFilter || "ALL").trim().toUpperCase();
    elements.pinnedEmptyText.textContent =
      activeEnv !== "ALL" ? t("pinnedEmptyEnvHint", activeEnv) : t("pinnedEmptyHint");
  }

  if (count === 0) {
    state.isPinnedExpanded = false;
    elements.pinnedShelf.classList.add("is-empty");
    elements.pinnedShelf.classList.remove("has-items", "is-expanded");
    if (elements.pinnedEmptyState) elements.pinnedEmptyState.style.display = "block";
    if (elements.pinnedGrid) {
      elements.pinnedGrid.style.display = "none";
      elements.pinnedGrid.innerHTML = "";
    }
    if (elements.togglePinnedExpandBtn) {
      elements.togglePinnedExpandBtn.style.display = "none";
    }
    return;
  }

  elements.pinnedShelf.classList.remove("is-empty");
  elements.pinnedShelf.classList.add("has-items");
  elements.pinnedShelf.classList.toggle("is-expanded", Boolean(state.isPinnedExpanded));

  if (elements.pinnedEmptyState) {
    elements.pinnedEmptyState.style.display = "none";
  }

  const grpMap = new Map((state.data.groups || []).map((g) => [g.id, g]));
  const catMap = new Map((state.data.categories || []).map((c) => [c.id, c]));

  if (elements.pinnedGrid) {
    elements.pinnedGrid.style.display = "grid";
    elements.pinnedGrid.innerHTML = "";

    pinnedLinks.forEach((link) => {
      const group = grpMap.get(link.groupId);
      if (!group) return;
      const category = catMap.get(group.categoryId);
      const card = createPinnedCard(link, group, category);
      elements.pinnedGrid.appendChild(card);
    });
  }

  if (elements.togglePinnedExpandBtn) {
    const showToggle = count > 6;
    elements.togglePinnedExpandBtn.style.display = showToggle ? "inline-flex" : "none";
    elements.togglePinnedExpandBtn.setAttribute(
      "aria-expanded",
      state.isPinnedExpanded ? "true" : "false"
    );
    if (elements.togglePinnedExpandText) {
      elements.togglePinnedExpandText.textContent = state.isPinnedExpanded
        ? t("collapsePinned")
        : t("showAllPinned", count);
    } else {
      elements.togglePinnedExpandBtn.textContent = state.isPinnedExpanded
        ? t("collapsePinned")
        : t("showAllPinned", count);
    }
  }
}

function createPinnedCard(link, group, category) {
  if (!group && state.data?.groups) {
    group = state.data.groups.find((g) => g.id === link.groupId) || { name: "" };
  }
  if (!category && group && state.data?.categories) {
    category = state.data.categories.find((c) => c.id === group.categoryId) || null;
  }
  const card = document.createElement("div");
  card.className = `pinned-card ${link.hidden === true ? "is-hidden-bookmark" : ""}`.trim();
  card.setAttribute("role", "listitem");
  card.dataset.pinnedLinkId = link.id;
  card.dataset.linkId = link.id;

  let hostname = "";
  try {
    hostname = new URL(link.url).hostname;
  } catch {
    hostname = link.url;
  }

  if (state.isManageMode) {
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "drag-handle-btn pinned-drag-handle";
    dragHandle.setAttribute("draggable", "true");
    dragHandle.setAttribute("aria-label", t("pinnedDragHandleAria", link.name));
    dragHandle.title = t("pinnedDragHandleAria", link.name);
    dragHandle.dataset.pinnedLinkId = link.id;
    renderSvgIcon(dragHandle, SVG_ICONS.dragHandle);
    setupPinnedDragEvents(dragHandle, card, link);
    card.appendChild(dragHandle);
    setupPinnedCardDropEvents(card, link);
  }

  const anchor = document.createElement("a");
  anchor.className = "pinned-card-anchor";
  anchor.href = link.url;
  anchor.title = `${link.name} (${link.url})\n${group.name}${category ? ` · ${category.name}` : ""}\n${t("openNewTabHint")}`;

  const faviconContainer = document.createElement("div");
  faviconContainer.className = "link-favicon-container pinned-favicon-container";
  const placeholder = document.createElement("div");
  placeholder.className = "link-favicon-placeholder";
  placeholder.textContent = getDomainInitial(hostname);
  faviconContainer.appendChild(placeholder);
  anchor.appendChild(faviconContainer);

  const info = document.createElement("div");
  info.className = "pinned-card-info";

  const topRow = document.createElement("div");
  topRow.className = "pinned-card-top-row";

  if (link.badge) {
    const badgeSpan = document.createElement("span");
    const lowerBadge = link.badge.toLowerCase();
    const isStandardBadge = ["local", "dev", "test", "prod"].includes(lowerBadge);
    badgeSpan.className = `link-badge ${isStandardBadge ? `badge-${lowerBadge}` : "badge-custom"}`;
    badgeSpan.textContent = link.badge;
    topRow.appendChild(badgeSpan);
  }

  const titleSpan = document.createElement("span");
  titleSpan.className = "pinned-title";
  titleSpan.textContent = link.name;
  topRow.appendChild(titleSpan);

  if (link.hidden === true) {
    topRow.appendChild(createHiddenIndicatorBadge());
  }

  info.appendChild(topRow);

  const metaRow = document.createElement("div");
  metaRow.className = "pinned-card-meta-row";

  const domainSpan = document.createElement("span");
  domainSpan.className = "pinned-domain";
  domainSpan.textContent = hostname;
  metaRow.appendChild(domainSpan);

  const sep = document.createElement("span");
  sep.className = "pinned-meta-sep";
  sep.textContent = "·";
  metaRow.appendChild(sep);

  const groupPill = document.createElement("span");
  groupPill.className = "pinned-group-pill";
  groupPill.textContent = group.name;
  metaRow.appendChild(groupPill);

  info.appendChild(metaRow);
  anchor.appendChild(info);

  anchor.addEventListener("click", (e) => {
    navigateToBookmark(link, group.id, e);
  });

  anchor.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      navigateToBookmark(link, group.id, e);
    }
  });

  card.appendChild(anchor);

  // Load local-origin favicon on demand
  loadFaviconOnDemand(card, link.url);

  // Actions container (Unpin button)
  const actions = document.createElement("div");
  actions.className = "pinned-card-actions";

  const unpinBtn = document.createElement("button");
  unpinBtn.type = "button";
  unpinBtn.className = "btn-icon pinned-unpin-btn";
  unpinBtn.setAttribute("aria-label", t("unpinLinkFor", link.name));
  unpinBtn.title = t("unpinLink");
  renderSvgIcon(unpinBtn, FEATURE_ICONS.pinFilled);
  unpinBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await unpinLink(state.data, link.id, link.revision);
      await renderAll(false);
    } catch (err) {
      console.error("Failed to unpin link:", err);
    }
  });

  actions.appendChild(unpinBtn);
  card.appendChild(actions);

  // Full card click delegation (excluding action buttons and drag handle)
  card.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    if (
      e.target === unpinBtn ||
      unpinBtn.contains?.(e.target) ||
      e.target?.classList?.contains("pinned-drag-handle") ||
      e.target?.closest?.(".pinned-card-actions, .pinned-drag-handle, button")
    ) {
      return;
    }
    if (e.target === anchor || anchor.contains?.(e.target)) {
      return;
    }
    navigateToBookmark(link, group.id, e);
  });

  return card;
}

function setupPinnedDragEvents(dragHandle, card, link) {
  dragHandle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  dragHandle.addEventListener("dragstart", (e) => {
    currentDraggedPinnedId = link.id;
    card.classList.add("is-dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", link.id);
    }
  });

  dragHandle.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
    document.querySelectorAll?.(".pinned-card")?.forEach((c) => {
      c.classList.remove("is-dragging", "drop-target-before", "drop-target-after");
    });
    currentDraggedPinnedId = null;
  });

  // Keyboard Reordering for Pinned Items (Alt+Arrow or Arrow keys on handle)
  dragHandle.addEventListener("keydown", async (e) => {
    if (
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown" &&
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight"
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const activeCat = getActiveCategory();
    const pinnedLinks = getPinnedLinks(state.data, {
      categoryId: activeCat?.id || null,
      includeHidden: Boolean(state.showHiddenBookmarks),
      envFilter: state.envFilter || "ALL"
    });
    const currentIndex = pinnedLinks.findIndex((l) => l.id === link.id);
    if (currentIndex === -1) return;

    const moveBackward = e.key === "ArrowUp" || e.key === "ArrowLeft";
    const targetIndex = moveBackward ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= pinnedLinks.length) return;

    const [moved] = pinnedLinks.splice(currentIndex, 1);
    pinnedLinks.splice(targetIndex, 0, moved);
    const orderedIds = pinnedLinks.map((l) => l.id);

    try {
      await reorderPinnedLinks(state.data, orderedIds, activeCat?.id || null);
      announceA11y(t("pinnedMoved", moved.name, currentIndex + 1, targetIndex + 1));
      renderPinnedShelf();
      const newHandle = elements.pinnedGrid?.querySelector(
        `[data-pinned-link-id="${link.id}"] .pinned-drag-handle`
      );
      newHandle?.focus();
    } catch (err) {
      console.error("Failed to reorder pinned links via keyboard:", err);
    }
  });
}

function setupPinnedCardDropEvents(card, link) {
  card.addEventListener("dragover", (e) => {
    if (!currentDraggedPinnedId || currentDraggedPinnedId === link.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const rect = card.getBoundingClientRect ? card.getBoundingClientRect() : { left: 0, width: 100 };
    const midX = rect.left + rect.width / 2;
    if ((e.clientX || 0) < midX) {
      card.classList.add("drop-target-before");
      card.classList.remove("drop-target-after");
    } else {
      card.classList.add("drop-target-after");
      card.classList.remove("drop-target-before");
    }
  });

  card.addEventListener("dragleave", (e) => {
    if (!card.contains?.(e.relatedTarget)) {
      card.classList.remove("drop-target-before", "drop-target-after");
    }
  });

  card.addEventListener("drop", async (e) => {
    e.preventDefault();
    const sourceId =
      currentDraggedPinnedId || (e.dataTransfer ? e.dataTransfer.getData("text/plain") : null);
    card.classList.remove("drop-target-before", "drop-target-after");
    if (!sourceId || sourceId === link.id) return;

    const activeCat = getActiveCategory();
    const pinnedLinks = getPinnedLinks(state.data, {
      categoryId: activeCat?.id || null,
      includeHidden: Boolean(state.showHiddenBookmarks),
      envFilter: state.envFilter || "ALL"
    });
    const sourceIndex = pinnedLinks.findIndex((l) => l.id === sourceId);
    const targetIndex = pinnedLinks.findIndex((l) => l.id === link.id);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const [moved] = pinnedLinks.splice(sourceIndex, 1);
    const rect = card.getBoundingClientRect ? card.getBoundingClientRect() : { left: 0, width: 100 };
    const insertBefore = (e.clientX ?? 0) < rect.left + rect.width / 2;
    const newTargetIndex = pinnedLinks.findIndex((l) => l.id === link.id);
    const insertIndex = insertBefore ? newTargetIndex : newTargetIndex + 1;
    pinnedLinks.splice(insertIndex, 0, moved);

    const orderedIds = pinnedLinks.map((l) => l.id);
    try {
      await reorderPinnedLinks(state.data, orderedIds, activeCat?.id || null);
      announceA11y(t("pinnedMoved", moved.name, sourceIndex + 1, insertIndex + 1));
      renderPinnedShelf();
    } catch (err) {
      console.error("Failed to reorder pinned links on drop:", err);
    }
  });
}

function renderCategoryTabs(maintainActiveFocus = false) {
  if (!elements.categoryTabs) return;
  const previouslyFocusedId = document.activeElement?.dataset?.categoryId;
  elements.categoryTabs.innerHTML = "";

  state.data.categories.forEach((cat) => {
    const isActive = cat.id === state.data.activeCategoryId;
    const tab = document.createElement("button");
    tab.className = `category-tab ${isActive ? "active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.setAttribute("tabindex", isActive ? "0" : "-1");
    tab.dataset.categoryId = cat.id;
    tab.textContent = cat.name;

    tab.addEventListener("click", () => switchCategory(cat.id, false));
    elements.categoryTabs.appendChild(tab);

    if (maintainActiveFocus && cat.id === previouslyFocusedId) {
      setTimeout(() => tab.focus(), 0);
    }
  });

  if (elements.addCategoryBtn) {
    elements.addCategoryBtn.style.display = state.isManageMode ? "inline-flex" : "none";
  }
}

function renderActiveCategoryHeader() {
  const activeCat = getActiveCategory();
  if (!activeCat) return;

  if (elements.activeCatTitle) {
    elements.activeCatTitle.textContent = activeCat.name;
  }

  const currentGroups = state.data.groups.filter((g) => g.categoryId === activeCat.id);
  if (elements.catStatsLabel) {
    elements.catStatsLabel.textContent = `${currentGroups.length} ${currentGroups.length === 1 ? "group" : "groups"}`;
  }

  if (elements.catAdminButtons) {
    elements.catAdminButtons.style.display = state.isManageMode ? "inline-flex" : "none";
  }
  if (elements.deleteCatBtn) {
    elements.deleteCatBtn.disabled = state.data.categories.length <= 1;
  }
}

async function renderGroups() {
  const activeCat = getActiveCategory();
  if (!activeCat) return;

  const sortMode = getCategorySortMode(activeCat.id);

  if (elements.sortMostUsedBtn) {
    elements.sortMostUsedBtn.setAttribute("aria-pressed", sortMode === "most_used" ? "true" : "false");
  }
  if (elements.sortRecentlyUsedBtn) {
    elements.sortRecentlyUsedBtn.setAttribute("aria-pressed", sortMode === "recently_used" ? "true" : "false");
  }
  if (elements.sortCreatedBtn) {
    elements.sortCreatedBtn.setAttribute("aria-pressed", sortMode === "created_at" ? "true" : "false");
  }

  const currentGroups = state.data.groups.filter((g) => g.categoryId === activeCat.id);

  if (currentGroups.length === 0) {
    elements.groupGrid.style.display = "none";
    elements.categoryEmptyState.style.display = "block";
    if (elements.envFilterEmptyState) elements.envFilterEmptyState.style.display = "none";
    return;
  }

  const activeEnv = String(state.envFilter || "ALL").trim().toUpperCase();
  const isEnvFiltering = activeEnv !== "ALL";

  if (isEnvFiltering) {
    const catGroupIds = new Set(currentGroups.map((g) => g.id));
    const matchingLinksInCat = (state.data.links || []).filter(
      (l) => l && catGroupIds.has(l.groupId) && isLinkVisibleInCurrentView(l)
    );
    if (matchingLinksInCat.length === 0) {
      elements.groupGrid.style.display = "none";
      elements.groupGrid.innerHTML = "";
      elements.categoryEmptyState.style.display = "none";
      if (elements.envFilterEmptyState) {
        elements.envFilterEmptyState.style.display = "block";
        if (elements.envFilterEmptyTitle) {
          elements.envFilterEmptyTitle.textContent = t("envFilterEmptyTitle", activeEnv);
        }
        if (elements.envFilterEmptyDesc) {
          elements.envFilterEmptyDesc.textContent = t("envFilterEmptyDesc", activeEnv);
        }
        if (elements.resetEnvFilterText) {
          elements.resetEnvFilterText.textContent = t("envFilterResetBtn");
        }
      }
      return;
    }
  }

  if (elements.envFilterEmptyState) {
    elements.envFilterEmptyState.style.display = "none";
  }

  elements.groupGrid.style.display = "grid";
  elements.categoryEmptyState.style.display = "none";
  elements.groupGrid.innerHTML = "";

  let sortedGroups = [...currentGroups];
  const metricsMap = await getGroupMetricsMap().catch(() => new Map());

  if (sortMode === "most_used") {
    sortedGroups.sort((a, b) => {
      const aMetric = metricsMap.get(a.id) || { usageCount: 0 };
      const bMetric = metricsMap.get(b.id) || { usageCount: 0 };
      const diff = (bMetric.usageCount || 0) - (aMetric.usageCount || 0);
      if (diff !== 0) return diff;
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      const createdDiff = (b.createdAt || 0) - (a.createdAt || 0);
      if (createdDiff !== 0) return createdDiff;
      return a.id.localeCompare(b.id);
    });
  } else if (sortMode === "recently_used") {
    sortedGroups.sort((a, b) => {
      const aMetric = metricsMap.get(a.id) || { lastUsedAt: 0 };
      const bMetric = metricsMap.get(b.id) || { lastUsedAt: 0 };
      const diff = (bMetric.lastUsedAt || 0) - (aMetric.lastUsedAt || 0);
      if (diff !== 0) return diff;
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      const createdDiff = (b.createdAt || 0) - (a.createdAt || 0);
      if (createdDiff !== 0) return createdDiff;
      return a.id.localeCompare(b.id);
    });
  } else if (sortMode === "created_at") {
    sortedGroups.sort((a, b) => {
      const diff = (b.createdAt || 0) - (a.createdAt || 0);
      if (diff !== 0) return diff;
      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.id.localeCompare(b.id);
    });
  } else {
    // manual sort
    sortedGroups.sort((a, b) => {
      const orderDiff = (a.sortOrder ?? a.createdAt ?? 0) - (b.sortOrder ?? b.createdAt ?? 0);
      if (orderDiff !== 0) return orderDiff;
      const createdDiff = (a.createdAt || 0) - (b.createdAt || 0);
      if (createdDiff !== 0) return createdDiff;
      return a.id.localeCompare(b.id);
    });
  }

  const groupsToRender =
    isEnvFiltering && !state.isManageMode
      ? sortedGroups.filter((g) =>
          state.data.links.some((l) => l.groupId === g.id && isLinkVisibleInCurrentView(l))
        )
      : sortedGroups;

  groupsToRender.forEach((group) => {
    const groupCard = createGroupCard(group);
    elements.groupGrid.appendChild(groupCard);
  });
}

function exitAutoSortIfActive() {
  const activeCat = getActiveCategory();
  if (activeCat && getCategorySortMode(activeCat.id) !== "manual") {
    setCategorySortMode(activeCat.id, "manual");
    elements.sortMostUsedBtn?.setAttribute("aria-pressed", "false");
    elements.sortRecentlyUsedBtn?.setAttribute("aria-pressed", "false");
    elements.sortCreatedBtn?.setAttribute("aria-pressed", "false");
    announceA11y(t("switchedToManualSort"));
    return true;
  }
  return false;
}

function setupDragHandleEvents(dragHandle, card, group) {
  dragHandle.addEventListener("dragstart", (e) => {
    currentDraggedGroupId = group.id;
    card.classList.add("is-dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", group.id);
    }
    exitAutoSortIfActive();
  });

  dragHandle.addEventListener("dragend", () => {
    card.classList.remove("is-dragging");
    document.querySelectorAll(".group-card").forEach((c) => {
      c.classList.remove("is-dragging", "drop-target-before", "drop-target-after");
    });
    currentDraggedGroupId = null;
  });

  // Touch Support
  dragHandle.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    currentDraggedGroupId = group.id;
    card.classList.add("is-dragging");
    exitAutoSortIfActive();
  }, { passive: true });

  dragHandle.addEventListener("touchmove", (e) => {
    if (!currentDraggedGroupId || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const targetElem = document.elementFromPoint(touch.clientX, touch.clientY);
    const overCard = targetElem?.closest(".group-card");

    document.querySelectorAll(".group-card").forEach((c) => {
      if (c !== overCard) c.classList.remove("drop-target-before", "drop-target-after");
    });

    if (overCard && overCard !== card) {
      const rect = overCard.getBoundingClientRect();
      if (touch.clientY < rect.top + rect.height / 2) {
        overCard.classList.add("drop-target-before");
        overCard.classList.remove("drop-target-after");
      } else {
        overCard.classList.add("drop-target-after");
        overCard.classList.remove("drop-target-before");
      }
    }
  }, { passive: true });

  dragHandle.addEventListener("touchend", async () => {
    if (!currentDraggedGroupId) return;
    card.classList.remove("is-dragging");
    const overCard = document.querySelector(".group-card.drop-target-before, .group-card.drop-target-after");
    if (overCard && overCard !== card) {
      const isBefore = overCard.classList.contains("drop-target-before");
      overCard.classList.remove("drop-target-before", "drop-target-after");
      const targetGroupId = overCard.dataset.groupId;
      const activeCat = getActiveCategory();
      if (activeCat && targetGroupId) {
        exitAutoSortIfActive();
        const catGroups = state.data.groups
          .filter((g) => g.categoryId === activeCat.id)
          .sort((a, b) => (a.sortOrder ?? a.createdAt ?? 0) - (b.sortOrder ?? b.createdAt ?? 0));
        const sIdx = catGroups.findIndex((g) => g.id === group.id);
        const tIdx = catGroups.findIndex((g) => g.id === targetGroupId);
        if (sIdx !== -1 && tIdx !== -1) {
          const [moved] = catGroups.splice(sIdx, 1);
          const newTIdx = catGroups.findIndex((g) => g.id === targetGroupId);
          const insIdx = isBefore ? newTIdx : newTIdx + 1;
          catGroups.splice(insIdx, 0, moved);
          const orderedIds = catGroups.map((g) => g.id);
          await reorderGroups(state.data, activeCat.id, orderedIds);
          announceA11y(t("groupMoved", moved.name, sIdx + 1, insIdx + 1));
          await renderGroups();
        }
      }
    }
    document.querySelectorAll(".group-card").forEach((c) => {
      c.classList.remove("is-dragging", "drop-target-before", "drop-target-after");
    });
    currentDraggedGroupId = null;
  });

  // Keyboard Support (Alt+Arrow)
  dragHandle.addEventListener("keydown", async (e) => {
    if (!e.altKey) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

    e.preventDefault();
    const activeCat = getActiveCategory();
    if (!activeCat) return;

    exitAutoSortIfActive();

    const catGroups = state.data.groups
      .filter((g) => g.categoryId === activeCat.id)
      .sort((a, b) => (a.sortOrder ?? a.createdAt ?? 0) - (b.sortOrder ?? b.createdAt ?? 0));

    const currentIndex = catGroups.findIndex((g) => g.id === group.id);
    if (currentIndex === -1) return;

    const moveUp = e.key === "ArrowUp" || e.key === "ArrowLeft";
    const targetIndex = moveUp ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex < 0 || targetIndex >= catGroups.length) {
      return;
    }

    const [movedGroup] = catGroups.splice(currentIndex, 1);
    catGroups.splice(targetIndex, 0, movedGroup);

    const orderedIds = catGroups.map((g) => g.id);
    try {
      await reorderGroups(state.data, activeCat.id, orderedIds);
      announceA11y(t("groupMoved", movedGroup.name, currentIndex + 1, targetIndex + 1));
      await renderGroups();
      const newHandle = document.querySelector(`.group-card[data-group-id="${group.id}"] .drag-handle-btn`);
      newHandle?.focus();
    } catch (err) {
      console.error("Failed to reorder groups via keyboard:", err);
    }
  });
}

function setupCardDropEvents(card, group) {
  card.addEventListener("dragover", (e) => {
    if (!currentDraggedGroupId || currentDraggedGroupId === group.id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      card.classList.add("drop-target-before");
      card.classList.remove("drop-target-after");
    } else {
      card.classList.add("drop-target-after");
      card.classList.remove("drop-target-before");
    }
  });

  card.addEventListener("dragleave", (e) => {
    if (!card.contains(e.relatedTarget)) {
      card.classList.remove("drop-target-before", "drop-target-after");
    }
  });

  card.addEventListener("drop", async (e) => {
    e.preventDefault();
    const sourceId = currentDraggedGroupId || (e.dataTransfer ? e.dataTransfer.getData("text/plain") : null);
    card.classList.remove("drop-target-before", "drop-target-after");
    if (!sourceId || sourceId === group.id) return;

    const activeCat = getActiveCategory();
    if (!activeCat) return;

    exitAutoSortIfActive();

    const catGroups = state.data.groups
      .filter((g) => g.categoryId === activeCat.id)
      .sort((a, b) => (a.sortOrder ?? a.createdAt ?? 0) - (b.sortOrder ?? b.createdAt ?? 0));

    const sourceIndex = catGroups.findIndex((g) => g.id === sourceId);
    const targetIndex = catGroups.findIndex((g) => g.id === group.id);
    if (sourceIndex === -1 || targetIndex === -1) return;

    const [movedGroup] = catGroups.splice(sourceIndex, 1);
    const rect = card.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const newTargetIndex = catGroups.findIndex((g) => g.id === group.id);
    const insertIndex = insertBefore ? newTargetIndex : newTargetIndex + 1;
    catGroups.splice(insertIndex, 0, movedGroup);

    const orderedIds = catGroups.map((g) => g.id);
    try {
      await reorderGroups(state.data, activeCat.id, orderedIds);
      announceA11y(t("groupMoved", movedGroup.name, sourceIndex + 1, insertIndex + 1));
      await renderGroups();
    } catch (err) {
      console.error("Failed to reorder groups on drop:", err);
    }
  });
}

function createGroupCard(group) {
  const card = document.createElement("section");
  card.className = "group-card";
  card.id = `group-card-${group.id}`;
  card.dataset.groupId = group.id;
  card.setAttribute("aria-labelledby", `group-title-${group.id}`);

  // Card Header
  const header = document.createElement("div");
  header.className = "group-card-header";

  const lead = document.createElement("div");
  lead.className = "group-header-lead";

  if (state.isManageMode) {
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "drag-handle-btn";
    dragHandle.setAttribute("draggable", "true");
    dragHandle.setAttribute("aria-label", t("dragHandleAria", group.name));
    dragHandle.title = t("dragHandleAria", group.name);
    dragHandle.dataset.groupId = group.id;
    renderSvgIcon(dragHandle, SVG_ICONS.dragHandle);

    setupDragHandleEvents(dragHandle, card, group);
    lead.appendChild(dragHandle);

    setupCardDropEvents(card, group);
  }

  const title = document.createElement("h3");
  title.id = `group-title-${group.id}`;
  title.className = "group-title";
  title.textContent = group.name;
  lead.appendChild(title);

  header.appendChild(lead);

  if (state.isManageMode) {
    const actions = document.createElement("div");
    actions.className = "group-actions";

    const addLinkBtn = document.createElement("button");
    addLinkBtn.className = "btn btn-ghost btn-sm";
    const addLinkIcon = document.createElement("span");
    addLinkIcon.className = "icon-slot";
    renderSvgIcon(addLinkIcon, SVG_ICONS.addLink);
    const addLinkText = document.createElement("span");
    addLinkText.className = "btn-text";
    addLinkText.textContent = "Link";
    addLinkBtn.appendChild(addLinkIcon);
    addLinkBtn.appendChild(addLinkText);
    addLinkBtn.title = t("addLink");
    addLinkBtn.setAttribute("aria-label", `${t("addLink")} in ${group.name}`);
    addLinkBtn.addEventListener("click", () => openAddLinkModal(group.id));

    const renameBtn = document.createElement("button");
    renameBtn.className = "btn-icon";
    renderSvgIcon(renameBtn, SVG_ICONS.edit);
    renameBtn.title = t("rename");
    renameBtn.setAttribute("aria-label", `${t("rename")} ${group.name}`);
    renameBtn.addEventListener("click", () => openRenameGroupModal(group));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-icon danger";
    renderSvgIcon(deleteBtn, SVG_ICONS.trash);
    deleteBtn.title = t("delete");
    deleteBtn.setAttribute("aria-label", `${t("delete")} ${group.name}`);
    deleteBtn.addEventListener("click", () => openDeleteGroupModal(group));

    actions.appendChild(addLinkBtn);
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    header.appendChild(actions);
  }

  card.appendChild(header);

  // Card Body (Links)
  const body = document.createElement("div");
  body.className = "group-card-body";

  const groupLinks = state.data.links.filter(
    (l) => l.groupId === group.id && isLinkVisibleInCurrentView(l)
  );

  if (groupLinks.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "group-empty";

    const emptyText = document.createElement("span");
    emptyText.textContent = t("noLinksInGroup");
    emptyRow.appendChild(emptyText);

    if (state.isManageMode) {
      const quickAddBtn = document.createElement("button");
      quickAddBtn.className = "btn btn-ghost btn-sm";
      const quickAddIcon = document.createElement("span");
      quickAddIcon.className = "icon-slot";
      renderSvgIcon(quickAddIcon, SVG_ICONS.addLink);
      const quickAddText = document.createElement("span");
      quickAddText.className = "btn-text";
      quickAddText.textContent = t("addLink");
      quickAddBtn.appendChild(quickAddIcon);
      quickAddBtn.appendChild(quickAddText);
      quickAddBtn.addEventListener("click", () => openAddLinkModal(group.id));
      emptyRow.appendChild(quickAddBtn);
    }
    body.appendChild(emptyRow);
  } else {
    const list = document.createElement("ul");
    list.className = "link-list";

    groupLinks.forEach((link) => {
      const linkItem = createLinkItem(link, group);
      list.appendChild(linkItem);
    });

    body.appendChild(list);
  }

  card.appendChild(body);
  return card;
}

function getDomainInitial(hostname) {
  if (!hostname) return "?";
  let clean = String(hostname).trim();
  try {
    if (clean.includes("://")) {
      clean = new URL(clean).hostname;
    }
  } catch {
    // Ignore URL parse error
  }
  clean = clean.replace(/^www\./i, "");
  const match = clean.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : (clean.charAt(0).toUpperCase() || "?");
}

/**
 * On-demand favicon loader (VIEW-LINK-001)
 * Strictly local origin request; never uses 3rd-party aggregators.
 */
function loadFaviconOnDemand(detailsPanel, url) {
  const container = detailsPanel.querySelector(".link-favicon-container");
  if (!container || container.dataset.loaded === "true") return;
  container.dataset.loaded = "true";

  try {
    const origin = new URL(url).origin;
    if (!origin || origin === "null") return;
    const faviconUrl = `${origin}/favicon.ico`;
    const img = document.createElement("img");
    img.className = "link-favicon-img";
    img.alt = "";
    img.width = 18;
    img.height = 18;
    img.style.display = "none";
    img.onload = () => {
      img.style.display = "inline-block";
      const placeholder = container.querySelector(".link-favicon-placeholder");
      if (placeholder) placeholder.style.display = "none";
    };
    img.onerror = () => {
      // Leave domain initial placeholder cleanly displayed
      img.remove();
    };
    img.src = faviconUrl;
    container.appendChild(img);
  } catch {
    // Keep placeholder on invalid URL
  }
}

/**
 * Updates link items expand state in-place to preserve keyboard focus.
 */
function updateGroupLinksExpandState(groupId) {
  const groupCard =
    document.getElementById(`group-card-${groupId}`) ||
    elements.groupGrid?.querySelector(`[data-group-id="${groupId}"]`);
  if (!groupCard) return;

  const currentExpandedId = state.expandedLinks.get(groupId);
  const items = groupCard.querySelectorAll(".link-item");

  items.forEach((item) => {
    const linkId = item.dataset.linkId;
    const expandBtn = item.querySelector(".link-expand-btn");
    const detailsPanel = item.querySelector(".link-details-panel");
    const linkAnchor = item.querySelector(".link-anchor");
    const linkName = item.querySelector(".link-name")?.textContent || "";

    const isThisExpanded = linkId === currentExpandedId;

    if (expandBtn) {
      expandBtn.setAttribute("aria-expanded", isThisExpanded ? "true" : "false");
      expandBtn.setAttribute(
        "aria-label",
        isThisExpanded ? t("collapseDetailsFor", linkName) : t("expandDetailsFor", linkName)
      );
      expandBtn.title = isThisExpanded ? t("collapseDetails") : t("expandDetails");
    }

    if (detailsPanel) {
      if (isThisExpanded) {
        detailsPanel.classList.add("is-expanded");
        if (linkAnchor && linkAnchor.href) {
          loadFaviconOnDemand(detailsPanel, linkAnchor.href);
        }
      } else {
        detailsPanel.classList.remove("is-expanded");
      }
    }
  });
}

/**
 * Unified bookmark navigation handler (OPEN-LINK-001 & BMK-HIT-001).
 * Never navigates in Manage Mode. Supports Ctrl/Cmd+Click/Enter for new tab.
 */
function navigateToBookmark(link, groupId, e) {
  if (state.isManageMode) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    return false;
  }

  const openInNewTab = Boolean(e && (e.ctrlKey || e.metaKey));
  if (e && typeof e.preventDefault === "function") {
    e.preventDefault();
  }

  if (groupId) {
    recordGroupClick(groupId).catch((err) => {
      console.warn("Failed to record group click:", err);
    });
  }
  if (link?.id) {
    recordLinkClick(link.id).catch(() => {});
  }

  if (openInNewTab) {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: link.url, active: false });
    } else if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(link.url, "_blank");
    }
    return true;
  }

  if (typeof window !== "undefined" && window.location) {
    window.location.href = link.url;
  }
  return true;
}

function createLinkItem(link, group) {
  const item = document.createElement("li");
  item.className = `link-item ${link.hidden === true ? "is-hidden-bookmark" : ""}`.trim();
  item.dataset.linkId = link.id;

  const isExpanded = state.expandedLinks.get(group.id) === link.id;
  const isPinned = link.pinned === true;

  let hostname = "";
  try {
    hostname = new URL(link.url).hostname;
  } catch {
    hostname = link.url;
  }

  // Row Container (BMK-HIT-001: full row clickable, min-height 48px)
  const row = document.createElement("div");
  row.className = "link-row";

  // Anchor spanning primary click area (Title + URL Summary + inline whitespace)
  const anchor = document.createElement("a");
  anchor.className = "link-anchor";
  anchor.href = link.url;
  anchor.title = `${link.name} (${link.url})\n${t("openNewTabHint")}`;

  // Environment badge
  if (link.badge) {
    const badgeSpan = document.createElement("span");
    const lowerBadge = link.badge.toLowerCase();
    const isStandardBadge = ["local", "dev", "test", "prod"].includes(lowerBadge);
    badgeSpan.className = `link-badge ${isStandardBadge ? `badge-${lowerBadge}` : "badge-custom"}`;
    badgeSpan.textContent = link.badge;
    anchor.appendChild(badgeSpan);
  }

  const textWrap = document.createElement("div");
  textWrap.className = "link-primary-text";

  const nameSpan = document.createElement("span");
  nameSpan.className = "link-name";
  nameSpan.textContent = link.name;
  textWrap.appendChild(nameSpan);

  const summarySpan = document.createElement("span");
  summarySpan.className = "link-url-summary";
  summarySpan.textContent = hostname;
  textWrap.appendChild(summarySpan);

  anchor.appendChild(textWrap);

  if (link.hidden === true) {
    anchor.appendChild(createHiddenIndicatorBadge());
  }

  // Link open behavior strictly implementing OPEN-LINK-001, DEC-007 & BMK-HIT-001
  anchor.addEventListener("click", (e) => {
    navigateToBookmark(link, group.id, e);
  });

  anchor.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      navigateToBookmark(link, group.id, e);
    }
  });

  row.appendChild(anchor);

  // Actions Container (Pin/Unpin, Expand Button & Manage Actions)
  const actionsContainer = document.createElement("div");
  actionsContainer.className = "link-actions-container";

  // Pin / Unpin button (BMK-PIN-001)
  const pinBtn = document.createElement("button");
  pinBtn.type = "button";
  pinBtn.className = `link-pin-btn ${isPinned ? "is-pinned" : ""}`;
  pinBtn.id = `link-pin-btn-${link.id}`;
  pinBtn.setAttribute("aria-pressed", isPinned ? "true" : "false");
  pinBtn.setAttribute(
    "aria-label",
    isPinned ? t("unpinLinkFor", link.name) : t("pinLinkFor", link.name)
  );
  pinBtn.title = isPinned ? t("unpinLink") : t("pinLink");
  renderSvgIcon(pinBtn, isPinned ? FEATURE_ICONS.pinFilled : FEATURE_ICONS.pin);

  pinBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    try {
      await togglePinLink(state.data, link.id, link.revision);
      await renderAll(false);
    } catch (err) {
      console.error("Failed to toggle pin state:", err);
    }
  });

  actionsContainer.appendChild(pinBtn);

  // Expand / Collapse button
  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "link-expand-btn";
  expandBtn.id = `link-expand-btn-${link.id}`;
  expandBtn.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  expandBtn.setAttribute("aria-controls", `link-details-${link.id}`);
  expandBtn.setAttribute(
    "aria-label",
    isExpanded ? t("collapseDetailsFor", link.name) : t("expandDetailsFor", link.name)
  );
  expandBtn.title = isExpanded ? t("collapseDetails") : t("expandDetails");

  renderSvgIcon(expandBtn, SVG_ICONS.chevronDown);

  expandBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const currentlyExpandedLinkId = state.expandedLinks.get(group.id);
    if (currentlyExpandedLinkId === link.id) {
      state.expandedLinks.delete(group.id);
    } else {
      state.expandedLinks.set(group.id, link.id);
    }

    updateGroupLinksExpandState(group.id);
  });

  actionsContainer.appendChild(expandBtn);

  if (state.isManageMode) {
    const actions = document.createElement("div");
    actions.className = "link-manage-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-icon link-edit-btn";
    renderSvgIcon(editBtn, SVG_ICONS.edit);
    editBtn.title = t("edit");
    editBtn.setAttribute("aria-label", `${t("edit")} ${link.name}`);
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openEditLinkModal(link);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-icon danger link-delete-btn";
    renderSvgIcon(deleteBtn, SVG_ICONS.trash);
    deleteBtn.title = t("delete");
    deleteBtn.setAttribute("aria-label", `${t("delete")} ${link.name}`);
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openDeleteLinkModal(link);
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    actionsContainer.appendChild(actions);
  }

  row.appendChild(actionsContainer);

  // Full row click delegation (covers inline whitespace and padding outside action buttons)
  row.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    if (
      e.target === actionsContainer ||
      actionsContainer.contains?.(e.target) ||
      e.target?.closest?.(".link-actions-container, button")
    ) {
      return;
    }
    if (e.target === anchor || anchor.contains?.(e.target)) {
      return;
    }
    navigateToBookmark(link, group.id, e);
  });

  row.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (
      e.target === actionsContainer ||
      actionsContainer.contains?.(e.target) ||
      e.target?.closest?.(".link-actions-container, button")
    ) {
      return;
    }
    if (e.target === anchor) return;
    navigateToBookmark(link, group.id, e);
  });

  item.appendChild(row);

  // Expandable Details Panel
  const detailsPanel = document.createElement("div");
  detailsPanel.id = `link-details-${link.id}`;
  detailsPanel.className = `link-details-panel ${isExpanded ? "is-expanded" : ""}`;
  detailsPanel.setAttribute("role", "region");
  detailsPanel.setAttribute("aria-label", `Details for ${link.name}`);

  // Header with Favicon + Hostname
  const detailHeader = document.createElement("div");
  detailHeader.className = "link-detail-header";

  const faviconContainer = document.createElement("div");
  faviconContainer.className = "link-favicon-container";

  const placeholder = document.createElement("div");
  placeholder.className = "link-favicon-placeholder";
  placeholder.textContent = getDomainInitial(hostname);
  faviconContainer.appendChild(placeholder);

  detailHeader.appendChild(faviconContainer);

  const hostSpan = document.createElement("span");
  hostSpan.className = "link-detail-host";
  hostSpan.textContent = hostname;
  detailHeader.appendChild(hostSpan);

  detailsPanel.appendChild(detailHeader);

  // Full URL row
  const urlRow = document.createElement("div");
  urlRow.className = "link-detail-row";

  const urlLabel = document.createElement("span");
  urlLabel.className = "link-detail-label";
  urlLabel.textContent = t("fullUrlLabel");
  urlRow.appendChild(urlLabel);

  const urlVal = document.createElement("a");
  urlVal.className = "link-detail-url";
  urlVal.href = link.url;
  urlVal.target = "_blank";
  urlVal.rel = "noopener noreferrer";
  urlVal.textContent = link.url;
  urlRow.appendChild(urlVal);

  detailsPanel.appendChild(urlRow);

  // Environment / Tag row (if present)
  if (link.badge) {
    const badgeRow = document.createElement("div");
    badgeRow.className = "link-detail-row";

    const badgeLabel = document.createElement("span");
    badgeLabel.className = "link-detail-label";
    badgeLabel.textContent = t("badgeLabel");
    badgeRow.appendChild(badgeLabel);

    const badgeVal = document.createElement("span");
    const lowerBadge = link.badge.toLowerCase();
    const isStandardBadge = ["local", "dev", "test", "prod"].includes(lowerBadge);
    badgeVal.className = `link-badge ${isStandardBadge ? `badge-${lowerBadge}` : "badge-custom"}`;
    badgeVal.textContent = link.badge;
    badgeVal.style.alignSelf = "flex-start";
    badgeRow.appendChild(badgeVal);

    detailsPanel.appendChild(badgeRow);
  }

  // Load favicon if already expanded
  if (isExpanded) {
    loadFaviconOnDemand(detailsPanel, link.url);
  }

  item.appendChild(detailsPanel);
  return item;
}

// ==========================================================================
// Accessible Modal Dialogs
// ==========================================================================

function openModal(titleText, contentEl, onConfirm, confirmBtnText = t("save"), isDanger = false) {
  closeModal();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-label", titleText);

  const dialog = document.createElement("div");
  dialog.className = "modal-dialog";

  // Header
  const header = document.createElement("div");
  header.className = "modal-header";
  const title = document.createElement("h3");
  title.className = "modal-title";
  title.textContent = titleText;
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-icon modal-close-btn";
  closeBtn.setAttribute("aria-label", t("close") || "Close");
  closeBtn.title = t("close") || "Close";
  renderSvgIcon(closeBtn, SVG_ICONS.close);
  closeBtn.addEventListener("click", closeModal);
  header.appendChild(title);
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  // Body
  const body = document.createElement("div");
  body.className = "modal-body";
  body.appendChild(contentEl);
  dialog.appendChild(body);

  // Footer
  const footer = document.createElement("div");
  footer.className = "modal-footer";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = t("cancel");
  cancelBtn.addEventListener("click", closeModal);

  const confirmBtn = document.createElement("button");
  confirmBtn.className = `btn ${isDanger ? "btn-danger" : "btn-primary"}`;
  confirmBtn.textContent = confirmBtnText;

  confirmBtn.addEventListener("click", async () => {
    try {
      const shouldClose = await onConfirm();
      if (shouldClose !== false) {
        closeModal();
      }
    } catch (err) {
      console.error("Modal confirm error:", err);
    }
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);
  dialog.appendChild(footer);

  backdrop.appendChild(dialog);
  elements.modalContainer.innerHTML = "";
  elements.modalContainer.appendChild(backdrop);
  elements.modalContainer.style.display = "block";
  state.activeModal = backdrop;

  // Trap focus & Escape
  backdrop.addEventListener("keydown", (e) => {
    handleModalKeydown(dialog, e, closeModal);
  });

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeModal();
    }
  });

  const initialInput = dialog.querySelector("input, button");
  if (initialInput) {
    setTimeout(() => initialInput.focus(), 50);
  }
}

function closeModal() {
  elements.modalContainer.innerHTML = "";
  elements.modalContainer.style.display = "none";
  state.activeModal = null;
}

// ==========================================================================
// Category Modals (Safe DOM construction, zero raw innerHTML)
// ==========================================================================

function openAddCategoryModal() {
  const container = document.createElement("div");
  const formGroup = document.createElement("div");
  formGroup.className = "form-group";

  const label = document.createElement("label");
  label.className = "form-label";
  label.htmlFor = "newCatName";
  label.textContent = t("nameLabel");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "newCatName";
  nameInput.className = "form-input";
  nameInput.placeholder = "e.g. Personal Tools";

  const errorEl = document.createElement("span");
  errorEl.className = "form-error-msg";
  errorEl.style.display = "none";

  formGroup.appendChild(label);
  formGroup.appendChild(nameInput);
  formGroup.appendChild(errorEl);
  container.appendChild(formGroup);

  openModal(t("addCategory"), container, async () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      nameInput.classList.add("has-error");
      errorEl.textContent = t("fieldRequired");
      errorEl.style.display = "block";
      nameInput.focus();
      return false;
    }

    try {
      await addCategory(state.data, nameVal);
      renderAll(true);
      return true;
    } catch (err) {
      nameInput.classList.add("has-error");
      errorEl.textContent = `${t("saveFailedMsg")} (${err.message})`;
      errorEl.style.display = "block";
      return false;
    }
  });
}

function openRenameCategoryModal(cat) {
  const container = document.createElement("div");
  const formGroup = document.createElement("div");
  formGroup.className = "form-group";

  const label = document.createElement("label");
  label.className = "form-label";
  label.htmlFor = "renameCatName";
  label.textContent = t("nameLabel");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "renameCatName";
  nameInput.className = "form-input";
  nameInput.value = cat.name;

  const errorEl = document.createElement("span");
  errorEl.className = "form-error-msg";
  errorEl.style.display = "none";

  formGroup.appendChild(label);
  formGroup.appendChild(nameInput);
  formGroup.appendChild(errorEl);
  container.appendChild(formGroup);

  openModal(t("rename"), container, async () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      nameInput.classList.add("has-error");
      errorEl.textContent = t("fieldRequired");
      errorEl.style.display = "block";
      nameInput.focus();
      return false;
    }

    try {
      await renameCategory(state.data, cat.id, nameVal, cat.revision);
      renderAll(true);
      return true;
    } catch (err) {
      nameInput.classList.add("has-error");
      if (err.code === "CONFLICT") {
        errorEl.textContent = t("revisionConflictMsg");
      } else {
        errorEl.textContent = `${t("saveFailedMsg")} (${err.message})`;
      }
      errorEl.style.display = "block";
      return false;
    }
  });
}

function openDeleteCategoryModal(cat) {
  if (state.data.categories.length <= 1) {
    alert(t("cannotDeleteLastCat"));
    return;
  }

  const groupsInCat = state.data.groups.filter((g) => g.categoryId === cat.id);
  const groupIds = new Set(groupsInCat.map((g) => g.id));
  const linksInCat = state.data.links.filter((l) => groupIds.has(l.groupId));

  const container = document.createElement("div");
  container.className = "delete-impact-summary";
  container.textContent = t("categoryDeleteConfirm", cat.name, groupsInCat.length, linksInCat.length);

  openModal(
    t("deleteCategoryTitle"),
    container,
    async () => {
      try {
        await deleteCategory(state.data, cat.id);
        renderAll(true);
        return true;
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
        return false;
      }
    },
    t("confirmDelete"),
    true
  );
}

// ==========================================================================
// Group Modals
// ==========================================================================

function openAddGroupModal(categoryId) {
  const container = document.createElement("div");
  const formGroup = document.createElement("div");
  formGroup.className = "form-group";

  const label = document.createElement("label");
  label.className = "form-label";
  label.htmlFor = "newGroupName";
  label.textContent = t("nameLabel");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "newGroupName";
  nameInput.className = "form-input";
  nameInput.placeholder = "e.g. Order Service";

  const errorEl = document.createElement("span");
  errorEl.className = "form-error-msg";
  errorEl.style.display = "none";

  formGroup.appendChild(label);
  formGroup.appendChild(nameInput);
  formGroup.appendChild(errorEl);
  container.appendChild(formGroup);

  openModal(t("addGroup"), container, async () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      nameInput.classList.add("has-error");
      errorEl.textContent = t("fieldRequired");
      errorEl.style.display = "block";
      nameInput.focus();
      return false;
    }

    try {
      await addGroup(state.data, categoryId, nameVal);
      renderCategoryContent();
      return true;
    } catch (err) {
      nameInput.classList.add("has-error");
      errorEl.textContent = `${t("saveFailedMsg")} (${err.message})`;
      errorEl.style.display = "block";
      return false;
    }
  });
}

function openRenameGroupModal(group) {
  const container = document.createElement("div");
  const formGroup = document.createElement("div");
  formGroup.className = "form-group";

  const label = document.createElement("label");
  label.className = "form-label";
  label.htmlFor = "renameGroupName";
  label.textContent = t("nameLabel");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "renameGroupName";
  nameInput.className = "form-input";
  nameInput.value = group.name;

  const errorEl = document.createElement("span");
  errorEl.className = "form-error-msg";
  errorEl.style.display = "none";

  formGroup.appendChild(label);
  formGroup.appendChild(nameInput);
  formGroup.appendChild(errorEl);
  container.appendChild(formGroup);

  openModal(t("rename"), container, async () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      nameInput.classList.add("has-error");
      errorEl.textContent = t("fieldRequired");
      errorEl.style.display = "block";
      nameInput.focus();
      return false;
    }

    try {
      await renameGroup(state.data, group.id, nameVal, group.revision);
      renderCategoryContent();
      return true;
    } catch (err) {
      nameInput.classList.add("has-error");
      if (err.code === "CONFLICT") {
        errorEl.textContent = t("revisionConflictMsg");
      } else {
        errorEl.textContent = `${t("saveFailedMsg")} (${err.message})`;
      }
      errorEl.style.display = "block";
      return false;
    }
  });
}

function openDeleteGroupModal(group) {
  const linksInGroup = state.data.links.filter((l) => l.groupId === group.id);

  const container = document.createElement("div");
  container.className = "delete-impact-summary";
  container.textContent = t("groupDeleteConfirm", group.name, linksInGroup.length);

  openModal(
    t("deleteGroupTitle"),
    container,
    async () => {
      try {
        await deleteGroup(state.data, group.id);
        renderCategoryContent();
        return true;
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
        return false;
      }
    },
    t("confirmDelete"),
    true
  );
}

// ==========================================================================
// Link Modals
// ==========================================================================

function openAddLinkModal(groupId) {
  const container = document.createElement("div");

  // Name Field
  const nameGroup = document.createElement("div");
  nameGroup.className = "form-group";
  const nameLabel = document.createElement("label");
  nameLabel.className = "form-label";
  nameLabel.htmlFor = "newLinkName";
  nameLabel.textContent = t("nameLabel");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "newLinkName";
  nameInput.className = "form-input";
  nameInput.placeholder = "e.g. Frontend App";
  const nameError = document.createElement("span");
  nameError.className = "form-error-msg";
  nameError.style.display = "none";
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);
  nameGroup.appendChild(nameError);
  container.appendChild(nameGroup);

  // URL Field
  const urlGroup = document.createElement("div");
  urlGroup.className = "form-group";
  const urlLabel = document.createElement("label");
  urlLabel.className = "form-label";
  urlLabel.htmlFor = "newLinkUrl";
  urlLabel.textContent = t("urlLabel");
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.id = "newLinkUrl";
  urlInput.className = "form-input";
  urlInput.placeholder = "https://";
  const urlError = document.createElement("span");
  urlError.className = "form-error-msg";
  urlError.style.display = "none";
  urlGroup.appendChild(urlLabel);
  urlGroup.appendChild(urlInput);
  urlGroup.appendChild(urlError);
  container.appendChild(urlGroup);

  // Badge Field
  const badgeGroup = document.createElement("div");
  badgeGroup.className = "form-group";
  const badgeLabel = document.createElement("label");
  badgeLabel.className = "form-label";
  badgeLabel.textContent = `${t("badgeLabel")} (${t("optional")})`;
  badgeGroup.appendChild(badgeLabel);

  const presetRow = document.createElement("div");
  presetRow.className = "badge-selector-row";

  const customBadgeInput = document.createElement("input");
  customBadgeInput.type = "text";
  customBadgeInput.className = "form-input";
  customBadgeInput.style.marginTop = "6px";
  customBadgeInput.placeholder = t("customBadgePlaceholder");

  DEFAULT_BADGES.forEach((b) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "badge-preset-btn";
    btn.textContent = b.label;
    btn.addEventListener("click", () => {
      customBadgeInput.value = b.label;
      presetRow.querySelectorAll(".badge-preset-btn").forEach((p) => p.classList.remove("selected"));
      btn.classList.add("selected");
    });
    presetRow.appendChild(btn);
  });

  badgeGroup.appendChild(presetRow);
  badgeGroup.appendChild(customBadgeInput);
  container.appendChild(badgeGroup);

  // Private / Hidden Bookmark Field (BMK-PRIV-001)
  const hiddenGroup = document.createElement("div");
  hiddenGroup.className = "form-group form-group-checkbox";
  const hiddenLabelWrap = document.createElement("label");
  hiddenLabelWrap.className = "form-checkbox-label";
  hiddenLabelWrap.htmlFor = "newLinkHiddenCheckbox";
  const hiddenCheckbox = document.createElement("input");
  hiddenCheckbox.type = "checkbox";
  hiddenCheckbox.id = "newLinkHiddenCheckbox";
  hiddenCheckbox.className = "form-checkbox";
  hiddenCheckbox.checked = false;
  const hiddenTextSpan = document.createElement("span");
  hiddenTextSpan.textContent = t("hideBookmarkLabel");
  hiddenLabelWrap.appendChild(hiddenCheckbox);
  hiddenLabelWrap.appendChild(hiddenTextSpan);
  const hiddenHint = document.createElement("span");
  hiddenHint.className = "form-hint";
  hiddenHint.textContent = t("hideBookmarkHint");
  hiddenGroup.appendChild(hiddenLabelWrap);
  hiddenGroup.appendChild(hiddenHint);
  container.appendChild(hiddenGroup);

  openModal(t("addLink"), container, async () => {
    let hasError = false;
    const nameVal = nameInput.value.trim();
    const urlVal = urlInput.value.trim();
    const badgeVal = customBadgeInput.value.trim();
    const hiddenVal = Boolean(hiddenCheckbox.checked);

    if (!nameVal) {
      nameInput.classList.add("has-error");
      nameError.textContent = t("fieldRequired");
      nameError.style.display = "block";
      hasError = true;
    } else {
      nameInput.classList.remove("has-error");
      nameError.style.display = "none";
    }

    if (!isValidUrl(urlVal)) {
      urlInput.classList.add("has-error");
      urlError.textContent = t("invalidUrl");
      urlError.style.display = "block";
      hasError = true;
    } else {
      urlInput.classList.remove("has-error");
      urlError.style.display = "none";
    }

    if (hasError) return false;

    try {
      await addLink(state.data, groupId, { name: nameVal, url: urlVal, badge: badgeVal, hidden: hiddenVal });
      renderCategoryContent();
      return true;
    } catch (err) {
      nameError.textContent = `${t("saveFailedMsg")} (${err.message})`;
      nameError.style.display = "block";
      return false;
    }
  });
}

function openEditLinkModal(link) {
  const container = document.createElement("div");

  // Name Field
  const nameGroup = document.createElement("div");
  nameGroup.className = "form-group";
  const nameLabel = document.createElement("label");
  nameLabel.className = "form-label";
  nameLabel.htmlFor = "editLinkName";
  nameLabel.textContent = t("nameLabel");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.id = "editLinkName";
  nameInput.className = "form-input";
  nameInput.value = link.name;
  const nameError = document.createElement("span");
  nameError.className = "form-error-msg";
  nameError.style.display = "none";
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);
  nameGroup.appendChild(nameError);
  container.appendChild(nameGroup);

  // URL Field
  const urlGroup = document.createElement("div");
  urlGroup.className = "form-group";
  const urlLabel = document.createElement("label");
  urlLabel.className = "form-label";
  urlLabel.htmlFor = "editLinkUrl";
  urlLabel.textContent = t("urlLabel");
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.id = "editLinkUrl";
  urlInput.className = "form-input";
  urlInput.value = link.url;
  const urlError = document.createElement("span");
  urlError.className = "form-error-msg";
  urlError.style.display = "none";
  urlGroup.appendChild(urlLabel);
  urlGroup.appendChild(urlInput);
  urlGroup.appendChild(urlError);
  container.appendChild(urlGroup);

  // Badge Field
  const badgeGroup = document.createElement("div");
  badgeGroup.className = "form-group";
  const badgeLabel = document.createElement("label");
  badgeLabel.className = "form-label";
  badgeLabel.textContent = `${t("badgeLabel")} (${t("optional")})`;
  badgeGroup.appendChild(badgeLabel);

  const presetRow = document.createElement("div");
  presetRow.className = "badge-selector-row";

  const customBadgeInput = document.createElement("input");
  customBadgeInput.type = "text";
  customBadgeInput.className = "form-input";
  customBadgeInput.style.marginTop = "6px";
  customBadgeInput.value = link.badge || "";
  customBadgeInput.placeholder = t("customBadgePlaceholder");

  DEFAULT_BADGES.forEach((b) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `badge-preset-btn ${link.badge === b.label ? "selected" : ""}`;
    btn.textContent = b.label;
    btn.addEventListener("click", () => {
      customBadgeInput.value = b.label;
      presetRow.querySelectorAll(".badge-preset-btn").forEach((p) => p.classList.remove("selected"));
      btn.classList.add("selected");
    });
    presetRow.appendChild(btn);
  });

  badgeGroup.appendChild(presetRow);
  badgeGroup.appendChild(customBadgeInput);
  container.appendChild(badgeGroup);

  // Private / Hidden Bookmark Field (BMK-PRIV-001)
  const hiddenGroup = document.createElement("div");
  hiddenGroup.className = "form-group form-group-checkbox";
  const hiddenLabelWrap = document.createElement("label");
  hiddenLabelWrap.className = "form-checkbox-label";
  hiddenLabelWrap.htmlFor = "editLinkHiddenCheckbox";
  const hiddenCheckbox = document.createElement("input");
  hiddenCheckbox.type = "checkbox";
  hiddenCheckbox.id = "editLinkHiddenCheckbox";
  hiddenCheckbox.className = "form-checkbox";
  hiddenCheckbox.checked = Boolean(link.hidden);
  const hiddenTextSpan = document.createElement("span");
  hiddenTextSpan.textContent = t("hideBookmarkLabel");
  hiddenLabelWrap.appendChild(hiddenCheckbox);
  hiddenLabelWrap.appendChild(hiddenTextSpan);
  const hiddenHint = document.createElement("span");
  hiddenHint.className = "form-hint";
  hiddenHint.textContent = t("hideBookmarkHint");
  hiddenGroup.appendChild(hiddenLabelWrap);
  hiddenGroup.appendChild(hiddenHint);
  container.appendChild(hiddenGroup);

  openModal(t("edit"), container, async () => {
    let hasError = false;
    const nameVal = nameInput.value.trim();
    const urlVal = urlInput.value.trim();
    const badgeVal = customBadgeInput.value.trim();
    const hiddenVal = Boolean(hiddenCheckbox.checked);

    if (!nameVal) {
      nameInput.classList.add("has-error");
      nameError.textContent = t("fieldRequired");
      nameError.style.display = "block";
      hasError = true;
    } else {
      nameInput.classList.remove("has-error");
      nameError.style.display = "none";
    }

    if (!isValidUrl(urlVal)) {
      urlInput.classList.add("has-error");
      urlError.textContent = t("invalidUrl");
      urlError.style.display = "block";
      hasError = true;
    } else {
      urlInput.classList.remove("has-error");
      urlError.style.display = "none";
    }

    if (hasError) return false;

    try {
      await editLink(
        state.data,
        link.id,
        { name: nameVal, url: urlVal, badge: badgeVal, hidden: hiddenVal },
        link.revision
      );
      renderCategoryContent();
      return true;
    } catch (err) {
      if (err.code === "CONFLICT") {
        urlError.textContent = t("revisionConflictMsg");
      } else {
        urlError.textContent = `${t("saveFailedMsg")} (${err.message})`;
      }
      urlError.style.display = "block";
      return false;
    }
  });
}

function openDeleteLinkModal(link) {
  const container = document.createElement("div");
  container.className = "delete-impact-summary";
  container.textContent = t("linkDeleteConfirm", link.name, link.url);

  openModal(
    t("deleteLinkTitle"),
    container,
    async () => {
      try {
        await deleteLink(state.data, link.id);
        renderCategoryContent();
        return true;
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
        return false;
      }
    },
    t("confirmDelete"),
    true
  );
}

// ==========================================================================
// Feature 3: Centralized Spotlight Search (BMK-SEARCH-001)
// ==========================================================================

let searchRequestSeq = 0;

async function openSearchModal(initialQuery = "", triggerElement = null) {
  if (!state.isSearchOpen) {
    state.searchTriggerElement =
      triggerElement ||
      (typeof document !== "undefined" ? document.activeElement : null);
  }

  state.isSearchOpen = true;
  state.searchQuery = initialQuery;
  state.searchSelectedIndex = 0;

  if (elements.openSearchBtn) {
    elements.openSearchBtn.setAttribute("aria-expanded", "true");
  }

  if (elements.searchOverlay) {
    elements.searchOverlay.style.display = "flex";
  }

  if (elements.searchInput) {
    elements.searchInput.value = initialQuery;
    if (typeof elements.searchInput.focus === "function") {
      elements.searchInput.focus();
    }
  }

  await refreshSearchResults();

  if (state.isSearchOpen && elements.searchInput && typeof elements.searchInput.focus === "function") {
    elements.searchInput.focus();
  }
}

function closeSearchModal() {
  searchRequestSeq++;
  const wasOpen = state.isSearchOpen;
  state.isSearchOpen = false;

  if (elements.searchInput && typeof elements.searchInput.blur === "function") {
    elements.searchInput.blur();
  }

  if (elements.searchOverlay) {
    elements.searchOverlay.style.display = "none";
  }

  if (elements.openSearchBtn) {
    elements.openSearchBtn.setAttribute("aria-expanded", "false");
  }

  const prev = state.searchTriggerElement;
  state.searchTriggerElement = null;
  if (wasOpen && prev && typeof prev.focus === "function") {
    prev.focus();
  }
}

async function refreshSearchResults() {
  if (!state.data) return [];
  const reqId = ++searchRequestSeq;

  const [linkMetricsMap, groupMetricsMap] = await Promise.all([
    getLinkMetricsMap().catch(() => new Map()),
    getGroupMetricsMap().catch(() => new Map())
  ]);

  if (reqId !== searchRequestSeq) {
    return state.searchResults;
  }

  const searchOut = searchBookmarks(state.data, state.searchQuery, {
    linkMetricsMap,
    groupMetricsMap,
    includeHidden: Boolean(state.showHiddenBookmarks)
  });

  state.searchResults = searchOut.results;
  if (state.searchSelectedIndex >= state.searchResults.length) {
    state.searchSelectedIndex = Math.max(0, state.searchResults.length - 1);
  }
  if (state.searchSelectedIndex < 0) {
    state.searchSelectedIndex = 0;
  }

  renderSearchResultsDOM(searchOut);
  return state.searchResults;
}

function renderSearchResultsDOM(searchOut) {
  const listbox = elements.searchResultsListbox;
  if (!listbox) return;

  listbox.innerHTML = "";

  const results = searchOut.results || [];
  const tokens = searchOut.tokens || [];

  if (elements.searchSectionLabel) {
    if (searchOut.isEmptyQuery) {
      const hasPinned = (searchOut.pinnedResults?.length || 0) > 0;
      const hasRecent = (searchOut.recentResults?.length || 0) > 0;
      if (hasPinned && hasRecent) {
        elements.searchSectionLabel.textContent = `${t("searchSectionPinned")} & ${t("searchSectionRecent")}`;
      } else if (hasPinned) {
        elements.searchSectionLabel.textContent = t("searchSectionPinned");
      } else if (hasRecent) {
        elements.searchSectionLabel.textContent = t("searchSectionRecent");
      } else {
        elements.searchSectionLabel.textContent = "";
      }
    } else {
      elements.searchSectionLabel.textContent = t("searchSectionResults", results.length);
    }
  }

  if (results.length === 0) {
    listbox.style.display = "none";
    if (elements.searchEmptyState) {
      elements.searchEmptyState.style.display = "block";
    }
    if (elements.searchEmptyTitle) {
      elements.searchEmptyTitle.textContent = searchOut.isEmptyQuery
        ? t("searchEmptyWorkspace")
        : t("searchNoResultsTitle");
    }
    if (elements.searchEmptyDesc) {
      elements.searchEmptyDesc.textContent = searchOut.isEmptyQuery
        ? ""
        : t("searchNoResultsDesc", (state.searchQuery || "").trim());
    }
    if (elements.searchInput) {
      elements.searchInput.setAttribute("aria-activedescendant", "");
    }
    return;
  }

  listbox.style.display = "flex";
  if (elements.searchEmptyState) {
    elements.searchEmptyState.style.display = "none";
  }

  results.forEach((item, index) => {
    const optionId = `search-option-${index}`;
    const isSelected = index === state.searchSelectedIndex;

    const option = document.createElement("div");
    option.id = optionId;
    option.className = `search-result-option ${isSelected ? "is-active" : ""} ${item.link.hidden === true ? "is-hidden-bookmark" : ""}`.trim();
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", isSelected ? "true" : "false");
    option.dataset.index = String(index);
    option.dataset.linkId = item.link.id;

    // Left: Favicon + Title + Domain
    const left = document.createElement("div");
    left.className = "search-result-left";

    const faviconContainer = document.createElement("div");
    faviconContainer.className = "link-favicon-container";
    const placeholder = document.createElement("div");
    placeholder.className = "link-favicon-placeholder";
    placeholder.textContent = getDomainInitial(item.hostname || item.link.url);
    faviconContainer.appendChild(placeholder);
    left.appendChild(faviconContainer);

    const textCol = document.createElement("div");
    textCol.className = "search-result-text";

    const titleRow = document.createElement("div");
    titleRow.className = "search-result-title-row";

    const titleSpan = document.createElement("span");
    titleSpan.className = "search-result-title";
    appendHighlightedText(titleSpan, item.title, tokens);
    titleRow.appendChild(titleSpan);

    if (item.link.pinned) {
      const pinTag = document.createElement("span");
      pinTag.className = "search-result-pin-tag";
      pinTag.textContent = t("searchSectionPinned");
      titleRow.appendChild(pinTag);
    }

    if (item.link.hidden === true) {
      titleRow.appendChild(createHiddenIndicatorBadge());
    }

    textCol.appendChild(titleRow);

    const domainSpan = document.createElement("span");
    domainSpan.className = "search-result-domain";
    const displayHostAndPath = item.urlPath
      ? `${item.hostname}${item.urlPath}`
      : item.hostname;
    appendHighlightedText(domainSpan, displayHostAndPath, tokens);
    textCol.appendChild(domainSpan);

    left.appendChild(textCol);
    option.appendChild(left);

    // Right: Badge + Category / Group
    const right = document.createElement("div");
    right.className = "search-result-right";

    if (item.badge) {
      const badgeSpan = document.createElement("span");
      const lowerBadge = item.badge.toLowerCase();
      const isStandardBadge = ["local", "dev", "test", "prod"].includes(lowerBadge);
      badgeSpan.className = `link-badge search-result-badge ${isStandardBadge ? `badge-${lowerBadge}` : "badge-custom"}`;
      appendHighlightedText(badgeSpan, item.badge, tokens);
      right.appendChild(badgeSpan);
    }

    const breadcrumb = document.createElement("span");
    breadcrumb.className = "search-result-breadcrumb";

    const catSpan = document.createElement("span");
    catSpan.className = "search-result-category";
    appendHighlightedText(catSpan, item.categoryName, tokens);
    breadcrumb.appendChild(catSpan);

    const sep = document.createElement("span");
    sep.className = "search-result-sep";
    sep.textContent = "/";
    breadcrumb.appendChild(sep);

    const grpSpan = document.createElement("span");
    grpSpan.className = "search-result-group";
    appendHighlightedText(grpSpan, item.groupName, tokens);
    breadcrumb.appendChild(grpSpan);

    right.appendChild(breadcrumb);
    option.appendChild(right);

    option.addEventListener("mouseenter", () => {
      updateSearchActiveIndex(index, false);
    });

    option.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openSearchResult(item, Boolean(e.ctrlKey || e.metaKey));
    });

    loadFaviconOnDemand(option, item.link.url);
    listbox.appendChild(option);
  });

  if (elements.searchInput) {
    elements.searchInput.setAttribute(
      "aria-activedescendant",
      `search-option-${state.searchSelectedIndex}`
    );
  }
}

function updateSearchActiveIndex(newIndex, scrollIntoView = true) {
  const count = state.searchResults.length;
  if (count === 0) {
    state.searchSelectedIndex = 0;
    elements.searchInput?.setAttribute("aria-activedescendant", "");
    return;
  }

  const normalized = ((newIndex % count) + count) % count;
  state.searchSelectedIndex = normalized;

  const listbox = elements.searchResultsListbox;
  if (listbox) {
    const options = listbox.querySelectorAll(".search-result-option");
    options.forEach((opt, idx) => {
      const active = idx === normalized;
      opt.classList.toggle("is-active", active);
      opt.setAttribute("aria-selected", active ? "true" : "false");
      if (active && scrollIntoView && typeof opt.scrollIntoView === "function") {
        opt.scrollIntoView({ block: "nearest" });
      }
    });
  }

  elements.searchInput?.setAttribute("aria-activedescendant", `search-option-${normalized}`);
}

function openSearchResult(item, openInNewTab = false) {
  if (!item || !item.link) return;
  const link = item.link;
  const groupId = item.group?.id || link.groupId;

  if (groupId) {
    recordGroupClick(groupId).catch(() => {});
  }
  recordLinkClick(link.id).catch(() => {});

  closeSearchModal();

  if (openInNewTab) {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: link.url, active: false });
    } else if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(link.url, "_blank");
    }
    return;
  }

  if (typeof window !== "undefined" && window.location) {
    window.location.href = link.url;
  }
}

function handleSearchDialogKeydown(e) {
  if (!state.isSearchOpen) return;

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeSearchModal();
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    updateSearchActiveIndex(state.searchSelectedIndex + 1, true);
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    updateSearchActiveIndex(state.searchSelectedIndex - 1, true);
    return;
  }

  if (e.key === "Enter") {
    // Do not intercept Enter if focus is explicitly on the close or shortcut settings button
    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    if (
      activeEl &&
      activeEl !== elements.searchInput &&
      String(activeEl.tagName || "").toUpperCase() === "BUTTON"
    ) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const selected = state.searchResults[state.searchSelectedIndex];
    if (selected) {
      openSearchResult(selected, Boolean(e.ctrlKey || e.metaKey));
    }
    return;
  }

  if (e.key === "Tab" && elements.searchDialog) {
    const focusables = Array.from(
      elements.searchDialog.querySelectorAll("input, button")
    ).filter((node) => !node.disabled);
    if (focusables.length > 0) {
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = typeof document !== "undefined" ? document.activeElement : null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
}

function handleGlobalSearchKeydown(e) {
  if (state.isSearchOpen) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeSearchModal();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key?.toLowerCase() === "k") {
      e.preventDefault();
      elements.searchInput?.focus();
    }
    return;
  }

  const activeEl = typeof document !== "undefined" ? document.activeElement : null;
  const hasOpenPopover = elements.bgPopoverContainer?.style?.display === "block";
  const hasBlockingModal = Boolean(state.activeModal || hasOpenPopover);

  const decision = evaluateSearchShortcut(e, {
    activeElement: activeEl,
    hasBlockingModal
  });

  if (decision.shouldOpen) {
    if (decision.preventDefault && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    openSearchModal("", activeEl);
    return;
  }

  const envDecision = evaluateEnvFilterShortcut(e, {
    activeElement: activeEl,
    hasBlockingModal,
    isSearchOpen: Boolean(state.isSearchOpen)
  });

  if (envDecision.shouldCycle) {
    if (envDecision.preventDefault && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    cycleEnvFilter();
  }
}

function openExtensionShortcutSettings() {
  const isFirefox =
    typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent || "");
  const targetUrl = isFirefox ? "about:addons" : "chrome://extensions/shortcuts";

  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    chrome.tabs.create({ url: targetUrl }).catch(() => {
      alert(
        isFirefox
          ? "Open about:addons and click the Gear icon -> Manage Extension Shortcuts to customize shortcuts."
          : "Open chrome://extensions/shortcuts in your address bar to customize extension shortcuts."
      );
    });
  } else {
    alert(
      `To customize extension shortcuts, open ${targetUrl} in your browser.`
    );
  }
}

export {
  state,
  elements,
  getDomainInitial,
  loadFaviconOnDemand,
  createGroupCard,
  createLinkItem,
  createPinnedCard,
  renderPinnedShelf,
  renderGroups,
  renderCategoryContent,
  switchCategory,
  cycleEnvFilter,
  setEnvFilter,
  setShowHiddenBookmarks,
  toggleHiddenBookmarksVisibility,
  isLinkVisibleInCurrentView,
  openAddLinkModal,
  openEditLinkModal,
  updateGroupLinksExpandState,
  openSearchModal,
  closeSearchModal,
  refreshSearchResults,
  handleSearchDialogKeydown,
  handleGlobalSearchKeydown,
  initWorkbench
};
