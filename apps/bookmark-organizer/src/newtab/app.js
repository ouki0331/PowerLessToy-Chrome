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
  isValidUrl,
  subscribeStorageChanges,
  reorderGroups,
  recordGroupClick,
  getGroupMetricsMap
} from "./storage.js";

import {
  generateImportPreview,
  executeImport,
  previewUndoImport,
  undoImport,
  previewSnapshotRestore,
  restoreSnapshot,
  exportBackup,
  getBackupFilename
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

// Application State
let state = {
  data: null,
  isManageMode: false,
  activeModal: null,
  lastImportJobId: null,
  expandedLinks: new Map() // groupId -> linkId (VIEW-LINK-001)
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
  get a11yAnnouncer() { return el("a11yAnnouncer"); }
};

// Initialize Application
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", async () => {
  const savedLang = localStorage.getItem("powerless_toy_lang");
  if (savedLang) {
    setLanguage(savedLang);
  }
  await initTheme();
  updateI18nLabels();
  updateThemeButtonUI();
  onThemeChange(() => updateThemeButtonUI());

  setupEventListeners();
  setupStorageSubscription();
  await initWorkbench();
  await initBackgroundUI(elements, openModal, closeModal);
  });
}

function updateI18nLabels() {
  const lang = getLanguage();
  if (elements.currentLangLabel) elements.currentLangLabel.textContent = lang.toUpperCase();
  if (elements.brandTitle) elements.brandTitle.textContent = t("appTitle");
  if (elements.tagline) elements.tagline.textContent = t("tagline");
  if (elements.manageBtnText) elements.manageBtnText.textContent = state.isManageMode ? t("doneManaging") : t("manageMode");
  if (elements.addCategoryBtn) elements.addCategoryBtn.textContent = t("addCategory");
  if (elements.addGroupBtn) elements.addGroupBtn.textContent = t("addGroup");
  if (elements.renameCatBtn) elements.renameCatBtn.textContent = t("rename");
  if (elements.deleteCatBtn) elements.deleteCatBtn.textContent = t("delete");
  if (elements.emptyCatTitle) elements.emptyCatTitle.textContent = t("noGroupsInCat");
  if (elements.emptyCatLead) elements.emptyCatLead.textContent = t("noGroupsLead");
  if (elements.createFirstGroupBtn) elements.createFirstGroupBtn.textContent = t("createFirstGroup");
  if (elements.errorTitle) elements.errorTitle.textContent = t("loadErrorTitle");
  if (elements.errorDesc) elements.errorDesc.textContent = t("loadErrorDesc");
  if (elements.retryLoadBtn) elements.retryLoadBtn.textContent = t("retry");
  if (elements.importBtnText) elements.importBtnText.textContent = t("importBtn");
  if (elements.exportBtnText) elements.exportBtnText.textContent = t("exportBtn");
  if (elements.undoImportBtn) elements.undoImportBtn.textContent = t("undoImportBtn");
  if (elements.bgHeaderBtnText) elements.bgHeaderBtnText.textContent = t("bgButton");
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
}

async function initWorkbench() {
  try {
    elements.errorBanner.style.display = "none";
    state.data = await loadWorkbenchData();
    renderAll();
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
        renderAll(false);
      } catch (err) {
        console.warn("Storage sync error from background/other tab:", err);
      }
    }, 80);
  });
}

function setupEventListeners() {
  // Toggle Language
  elements.langToggleBtn?.addEventListener("click", () => {
    const nextLang = getLanguage() === "en" ? "ja" : "en";
    setLanguage(nextLang);
    localStorage.setItem("powerless_toy_lang", nextLang);
    updateI18nLabels();
    renderAll(false);
  });

  // Toggle Manage Mode
  elements.toggleManageBtn?.addEventListener("click", () => {
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
    handleExportBackup();
  });

  // Import JSON Button
  elements.importJsonBtn?.addEventListener("click", () => {
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
  if (!elements.themeToggleBtn) return;
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
  elements.themeToggleBtn.title = tooltip;
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
// Backup Export & Import Handlers
// ==========================================================================

async function handleExportBackup() {
  try {
    // Always read fresh from IndexedDB so another tab's edits are never missed
    const backupObj = await exportBackup();

    const jsonStr = JSON.stringify(backupObj, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getBackupFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Export failed: ${err.message}`);
  }
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

  openModal(
    t("importPreviewTitle"),
    container,
    async () => {
      try {
        const result = await executeImport({
          importData: fileContent,
          fileName,
          conflictResolutions,
          expectedPlanSignature: preview.planSignature
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
  renderCategoryTabs(maintainActiveFocus);
  await renderCategoryContent();
}

async function renderCategoryContent() {
  renderActiveCategoryHeader();
  await renderGroups();
}

function renderCategoryTabs(maintainActiveFocus = false) {
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

  elements.addCategoryBtn.style.display = state.isManageMode ? "inline-flex" : "none";
}

function renderActiveCategoryHeader() {
  const activeCat = getActiveCategory();
  if (!activeCat) return;

  elements.activeCatTitle.textContent = activeCat.name;

  const currentGroups = state.data.groups.filter((g) => g.categoryId === activeCat.id);
  elements.catStatsLabel.textContent = `${currentGroups.length} ${currentGroups.length === 1 ? "group" : "groups"}`;

  elements.catAdminButtons.style.display = state.isManageMode ? "inline-flex" : "none";
  elements.deleteCatBtn.disabled = state.data.categories.length <= 1;
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
    return;
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

  sortedGroups.forEach((group) => {
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
    addLinkBtn.textContent = "+ Link";
    addLinkBtn.title = t("addLink");
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

  const groupLinks = state.data.links.filter((l) => l.groupId === group.id);

  if (groupLinks.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "group-empty";

    const emptyText = document.createElement("span");
    emptyText.textContent = t("noLinksInGroup");
    emptyRow.appendChild(emptyText);

    if (state.isManageMode) {
      const quickAddBtn = document.createElement("button");
      quickAddBtn.className = "btn btn-ghost btn-sm";
      quickAddBtn.textContent = t("addLink");
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

function createLinkItem(link, group) {
  const item = document.createElement("li");
  item.className = "link-item";
  item.dataset.linkId = link.id;

  const isExpanded = state.expandedLinks.get(group.id) === link.id;

  let hostname = "";
  try {
    hostname = new URL(link.url).hostname;
  } catch {
    hostname = link.url;
  }

  // Row Container
  const row = document.createElement("div");
  row.className = "link-row";

  // Anchor
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

  const nameSpan = document.createElement("span");
  nameSpan.className = "link-name";
  nameSpan.textContent = link.name;
  anchor.appendChild(nameSpan);

  // Link open behavior strictly implementing OPEN-LINK-001 & DEC-007
  anchor.addEventListener("click", (e) => {
    if (state.isManageMode) {
      e.preventDefault();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      recordGroupClick(group.id).catch((err) => {
        console.warn("Failed to record group click:", err);
      });
      if (typeof chrome !== "undefined" && chrome.tabs?.create) {
        chrome.tabs.create({ url: link.url, active: false });
      } else {
        window.open(link.url, "_blank");
      }
      return;
    }

    e.preventDefault();
    recordGroupClick(group.id).catch((err) => {
      console.warn("Failed to record group click:", err);
    });
    window.location.href = link.url;
  });

  row.appendChild(anchor);

  // Actions Container (Expand Button & Manage Actions)
  const actionsContainer = document.createElement("div");
  actionsContainer.className = "link-actions-container";

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

  expandBtn.innerHTML = `
    <svg class="expand-chevron" viewBox="0 0 20 20" aria-hidden="true" width="14" height="14">
      <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" fill="currentColor"/>
    </svg>
  `;

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
    editBtn.className = "btn-icon";
    renderSvgIcon(editBtn, SVG_ICONS.edit);
    editBtn.title = t("edit");
    editBtn.setAttribute("aria-label", `${t("edit")} ${link.name}`);
    editBtn.addEventListener("click", () => openEditLinkModal(link));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-icon danger";
    renderSvgIcon(deleteBtn, SVG_ICONS.trash);
    deleteBtn.title = t("delete");
    deleteBtn.setAttribute("aria-label", `${t("delete")} ${link.name}`);
    deleteBtn.addEventListener("click", () => openDeleteLinkModal(link));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    actionsContainer.appendChild(actions);
  }

  row.appendChild(actionsContainer);
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
  closeBtn.className = "btn-icon";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close");
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

  openModal(t("addLink"), container, async () => {
    let hasError = false;
    const nameVal = nameInput.value.trim();
    const urlVal = urlInput.value.trim();
    const badgeVal = customBadgeInput.value.trim();

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
      await addLink(state.data, groupId, { name: nameVal, url: urlVal, badge: badgeVal });
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

  openModal(t("edit"), container, async () => {
    let hasError = false;
    const nameVal = nameInput.value.trim();
    const urlVal = urlInput.value.trim();
    const badgeVal = customBadgeInput.value.trim();

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
      await editLink(state.data, link.id, { name: nameVal, url: urlVal, badge: badgeVal }, link.revision);
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

export {
  state,
  elements,
  getDomainInitial,
  loadFaviconOnDemand,
  createGroupCard,
  createLinkItem,
  updateGroupLinksExpandState,
  initWorkbench
};
