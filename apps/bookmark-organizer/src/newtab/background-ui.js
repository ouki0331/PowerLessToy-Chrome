/**
 * UI Controller for Keyless Background Gallery & Controls (Commit 2)
 *
 * Implements:
 * - Floating Action Bar (bottom-right) with macOS-inspired pill design
 * - Favorite toggle, Next image, Lock/Unlock toggle
 * - Category popover menu with 10 categories & lock checkbox
 * - Frequency popover menu (Manual, Every new tab, Daily, Weekly)
 * - Information popover card with full attribution (Artist, License, Source, Full-res)
 * - Settings modal with Enable/Disable switch, Opacity slider, and Local Image manager
 * - Zero FOUC, accessible focus-visible, keyboard navigation, and reduced-motion compliance
 */

import {
  getBgConfig,
  saveBgConfig,
  getBgCurrent,
  getNextImage,
  toggleFavorite,
  isFavorite,
  saveLocalImage,
  getLocalImagesList,
  deleteLocalImage,
  deleteLocalImageAndCascade,
  setLocalImageAsBackground,
  getLocalImagesTotalSize,
  resolveImageDisplayUrl,
  revokeActiveBlobUrl,
  COMMONS_CATEGORIES,
  DEFAULT_BG_CONFIG
} from "./background-service.js";

import { SVG_ICONS, renderSvgIcon } from "./icons.js";
import { t } from "./i18n.js";

let activePopoverType = null;

const CATEGORY_KEYS = [
  { id: "nature", i18nKey: "bgCatNature" },
  { id: "architecture", i18nKey: "bgCatArchitecture" },
  { id: "space", i18nKey: "bgCatSpace" },
  { id: "animals", i18nKey: "bgCatAnimals" },
  { id: "travel", i18nKey: "bgCatTravel" },
  { id: "art", i18nKey: "bgCatArt" },
  { id: "minimal", i18nKey: "bgCatMinimal" },
  { id: "anime", i18nKey: "bgCatAnime" },
  { id: "favorites", i18nKey: "bgCatFavorites" },
  { id: "local", i18nKey: "bgCatLocal" }
];

const FREQUENCY_KEYS = [
  { id: "manual", i18nKey: "bgFreqManual" },
  { id: "tab", i18nKey: "bgFreqTab" },
  { id: "daily", i18nKey: "bgFreqDaily" },
  { id: "weekly", i18nKey: "bgFreqWeekly" }
];

/**
 * Helper to keep aria-expanded attributes in sync on trigger buttons
 */
export function setPopoverAriaState(elements, activeBtn = null) {
  const buttons = [
    elements?.bgCategoryBtn,
    elements?.bgFreqBtn,
    elements?.bgInfoBtn,
    elements?.bgSettingsBtn,
    elements?.bgToggleTrigger,
    elements?.bgHeaderBtn
  ];
  buttons.forEach((btn) => {
    if (btn) {
      btn.setAttribute("aria-expanded", btn === activeBtn ? "true" : "false");
    }
  });
}

/**
 * Initializes Background UI, attaches event listeners, and applies initial state
 */
export async function initBackgroundUI(elements, openModalFn, closeModalFn) {
  if (!elements || !elements.bgFab) return;

  // Render icons on dock buttons and header button
  renderSvgIcon(elements.bgSourceBtn?.querySelector(".icon-slot"), SVG_ICONS.sourceRandom);
  renderSvgIcon(elements.bgFavBtn?.querySelector(".icon-slot"), SVG_ICONS.heart);
  renderSvgIcon(elements.bgNextBtn?.querySelector(".icon-slot"), SVG_ICONS.next);
  renderSvgIcon(elements.bgLockBtn?.querySelector(".icon-slot"), SVG_ICONS.unlock);
  renderSvgIcon(elements.bgCategoryBtn?.querySelector(".icon-slot"), SVG_ICONS.categoryGrid);
  renderSvgIcon(elements.bgFreqBtn?.querySelector(".icon-slot"), SVG_ICONS.frequencyClock);
  renderSvgIcon(elements.bgInfoBtn?.querySelector(".icon-slot"), SVG_ICONS.infoCircle);
  renderSvgIcon(elements.bgSettingsBtn?.querySelector(".icon-slot"), SVG_ICONS.settings);
  renderSvgIcon(elements.bgDockTrigger?.querySelector(".icon-slot"), SVG_ICONS.dockCenter);
  renderSvgIcon(elements.bgToggleTrigger?.querySelector(".icon-slot"), SVG_ICONS.dockCenter);
  renderSvgIcon(elements.bgHeaderBtn?.querySelector("#bgHeaderBtnIcon"), SVG_ICONS.wallpaper);

  // Dock Expand / Collapse behavior
  let dockCollapseTimer = null;

  const expandDock = () => {
    if (dockCollapseTimer) {
      clearTimeout(dockCollapseTimer);
      dockCollapseTimer = null;
    }
    if (elements.bgDock) {
      elements.bgDock.classList.add("is-expanded");
    }
    elements.bgDockTrigger?.setAttribute("aria-expanded", "true");
    elements.bgDockActions?.removeAttribute("aria-hidden");
  };

  const collapseDock = (immediate = false) => {
    if (dockCollapseTimer) {
      clearTimeout(dockCollapseTimer);
      dockCollapseTimer = null;
    }
    // Retain expansion if focus is inside dock
    if (typeof document !== "undefined" && elements.bgDock && elements.bgDock.contains(document.activeElement)) {
      return;
    }
    if (immediate) {
      if (elements.bgDock) {
        elements.bgDock.classList.remove("is-expanded");
      }
      elements.bgDockTrigger?.setAttribute("aria-expanded", "false");
      elements.bgDockActions?.setAttribute("aria-hidden", "true");
    } else {
      dockCollapseTimer = setTimeout(() => {
        if (typeof document !== "undefined" && elements.bgDock && elements.bgDock.contains(document.activeElement)) {
          return;
        }
        if (elements.bgDock) {
          elements.bgDock.classList.remove("is-expanded");
        }
        elements.bgDockTrigger?.setAttribute("aria-expanded", "false");
        elements.bgDockActions?.setAttribute("aria-hidden", "true");
      }, 250);
    }
  };

  elements.bgDock?.addEventListener("mouseenter", expandDock);
  elements.bgDock?.addEventListener("mouseleave", () => collapseDock(false));
  elements.bgDock?.addEventListener("focusin", expandDock);
  elements.bgDock?.addEventListener("focusout", () => collapseDock(false));

  elements.bgDockTrigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (elements.bgDock?.classList.contains("is-expanded")) {
      collapseDock(true);
    } else {
      expandDock();
    }
  });

  // Bind Header Background button
  elements.bgHeaderBtn?.addEventListener("click", () => {
    closeBgPopover(elements);
    openBgSettingsModal(elements, openModalFn, closeModalFn);
  });

  // Bind Source button
  elements.bgSourceBtn?.addEventListener("click", async () => {
    closeBgPopover(elements);
    const config = await getBgConfig();
    const currentMode = config.sourceMode || "random";
    const targetMode = currentMode === "random" ? "my_images" : "random";

    if (targetMode === "my_images") {
      const localList = await getLocalImagesList();
      if (localList.length === 0) {
        // No local images uploaded: open settings modal and focus upload dropzone
        openBgSettingsModal(elements, openModalFn, closeModalFn, { focusDropzone: true });
        return;
      }
      config.sourceMode = "my_images";
      config.enabled = true;
      await saveBgConfig(config);
      const nextImg = await getNextImage({ force: true });
      await applyBackgroundImage(elements, nextImg);
      await updateBackgroundUI(elements);
    } else {
      config.sourceMode = "random";
      config.enabled = true;
      await saveBgConfig(config);
      const nextImg = await getNextImage({ force: true });
      await applyBackgroundImage(elements, nextImg);
      await updateBackgroundUI(elements);
    }
  });

  // Bind Favorite button
  elements.bgFavBtn?.addEventListener("click", async () => {
    const current = await getBgCurrent();
    if (!current) return;
    const isNowFav = await toggleFavorite(current);
    updateFavButtonUI(elements.bgFavBtn, isNowFav);
  });

  // Bind Next button
  elements.bgNextBtn?.addEventListener("click", async () => {
    closeBgPopover(elements);
    const next = await getNextImage({ force: true });
    await applyBackgroundImage(elements, next);
  });

  // Bind Lock button
  elements.bgLockBtn?.addEventListener("click", async () => {
    const config = await getBgConfig();
    const updated = await saveBgConfig({ isImageLocked: !config.isImageLocked });
    updateLockButtonUI(elements.bgLockBtn, updated.isImageLocked);
  });

  elements.bgCategoryBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activePopoverType === "category") {
      closeBgPopover(elements);
    } else {
      openCategoryPopover(elements);
    }
  });

  elements.bgFreqBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activePopoverType === "frequency") {
      closeBgPopover(elements);
    } else {
      openFrequencyPopover(elements);
    }
  });

  elements.bgInfoBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activePopoverType === "info") {
      closeBgPopover(elements);
    } else {
      openInfoPopover(elements);
    }
  });

  elements.bgSettingsBtn?.addEventListener("click", () => {
    closeBgPopover(elements);
    openBgSettingsModal(elements, openModalFn, closeModalFn);
  });

  elements.bgToggleTrigger?.addEventListener("click", () => {
    openBgSettingsModal(elements, openModalFn, closeModalFn);
  });

  // Clean up object URLs on unload
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      revokeActiveBlobUrl();
    });
  }

  // Global listeners to close popovers and dock on outside click or Escape
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      if (activePopoverType && !e.target.closest("#bgFab") && !e.target.closest("#bgPopoverContainer") && !e.target.closest("#bgHeaderBtn")) {
        closeBgPopover(elements);
      }
      if (elements.bgDock && !elements.bgDock.contains(e.target)) {
        collapseDock(true);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (activePopoverType) closeBgPopover(elements);
        collapseDock(true);
      }
    });
  }

  // Initial load
  await updateBackgroundUI(elements);
}

/**
 * Updates the background display, FAB visibility, and button states based on stored config
 */
export async function updateBackgroundUI(elements) {
  if (!elements) return;
  const config = await getBgConfig();

  const isMyImages = config.sourceMode === "my_images";
  const sourceIcon = isMyImages ? SVG_ICONS.sourceMyImages : SVG_ICONS.sourceRandom;
  const sourceLabel = isMyImages ? t("bgSourceMyImages") : t("bgSourceRandom");

  if (elements.bgSourceBtn) {
    elements.bgSourceBtn.setAttribute("aria-label", `${t("bgSourceToggle")}: ${sourceLabel}`);
    elements.bgSourceBtn.setAttribute("title", `${t("bgSourceToggle")}: ${sourceLabel}`);
    elements.bgSourceBtn.setAttribute("aria-pressed", isMyImages ? "true" : "false");
    if (isMyImages) {
      elements.bgSourceBtn.classList.add("is-active");
    } else {
      elements.bgSourceBtn.classList.remove("is-active");
    }
    renderSvgIcon(elements.bgSourceBtn.querySelector(".icon-slot"), sourceIcon);
  }

  if (elements.bgDockTrigger) {
    renderSvgIcon(elements.bgDockTrigger.querySelector(".icon-slot"), SVG_ICONS.dockCenter);
    elements.bgDockTrigger.setAttribute("aria-label", t("bgControlsLabel"));
    elements.bgDockTrigger.setAttribute("title", t("bgControlsLabel"));
  }

  if (elements.bgToggleTrigger) {
    renderSvgIcon(elements.bgToggleTrigger.querySelector(".icon-slot"), SVG_ICONS.dockCenter);
  }

  if (!config.enabled) {
    if (elements.bgLayer) elements.bgLayer.style.display = "none";
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("has-custom-bg");
    }
    return;
  }

  // Enabled State
  if (elements.bgLayer) elements.bgLayer.style.display = "block";
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.add("has-custom-bg");
  }

  // Apply Opacity
  const opacityVal = Math.max(0, Math.min(100, config.opacity !== undefined ? config.opacity : 35));
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.style.setProperty("--bg-image-opacity", String(opacityVal / 100));
  }

  // Update Lock Button State
  updateLockButtonUI(elements.bgLockBtn, !!config.isImageLocked);

  // Fetch or retrieve current image
  const image = await getNextImage();
  await applyBackgroundImage(elements, image);
}

/**
 * Applies background image to the DOM layer and updates favorite button
 */
async function applyBackgroundImage(elements, image) {
  if (!elements || !elements.bgImage) return;

  if (image) {
    const url = await resolveImageDisplayUrl(image);
    if (url) {
      elements.bgImage.style.backgroundImage = `url("${url}")`;
      const favorited = await isFavorite(image.id || image.originalUrl);
      updateFavButtonUI(elements.bgFavBtn, favorited);
      return;
    }
  }

  elements.bgImage.style.backgroundImage = "none";
  updateFavButtonUI(elements.bgFavBtn, false);
}

/**
 * Updates Favorite button icon and aria-label
 */
function updateFavButtonUI(btn, favorited) {
  if (!btn) return;
  const slot = btn.querySelector(".icon-slot");
  if (favorited) {
    btn.classList.add("is-favorited");
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-label", t("bgFavRemove"));
    btn.setAttribute("title", t("bgFavRemove"));
    renderSvgIcon(slot, SVG_ICONS.heartFilled);
  } else {
    btn.classList.remove("is-favorited");
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", t("bgFavAdd"));
    btn.setAttribute("title", t("bgFavAdd"));
    renderSvgIcon(slot, SVG_ICONS.heart);
  }
}

/**
 * Updates Lock button icon and aria-label
 */
function updateLockButtonUI(btn, isLocked) {
  if (!btn) return;
  const slot = btn.querySelector(".icon-slot");
  if (isLocked) {
    btn.classList.add("is-locked");
    btn.setAttribute("aria-pressed", "true");
    btn.setAttribute("aria-label", t("bgUnlockImage"));
    btn.setAttribute("title", t("bgUnlockImage"));
    renderSvgIcon(slot, SVG_ICONS.lock);
  } else {
    btn.classList.remove("is-locked");
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", t("bgLockImage"));
    btn.setAttribute("title", t("bgLockImage"));
    renderSvgIcon(slot, SVG_ICONS.unlock);
  }
}

/**
 * Closes any active background popover
 */
export function closeBgPopover(elements) {
  if (elements?.bgPopoverContainer) {
    elements.bgPopoverContainer.replaceChildren();
    elements.bgPopoverContainer.style.display = "none";
  }
  setPopoverAriaState(elements, null);
  activePopoverType = null;
}

/**
 * Opens Category Selection Popover with multi-select support
 */
export async function openCategoryPopover(elements) {
  if (!elements?.bgPopoverContainer) return;
  closeBgPopover(elements);
  activePopoverType = "category";
  setPopoverAriaState(elements, elements?.bgCategoryBtn);

  const config = await getBgConfig();
  let selectedCats = Array.isArray(config.categories) && config.categories.length > 0 ? [...config.categories] : ["nature"];

  const popover = document.createElement("div");
  popover.className = "bg-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", t("bgCategoryLabel"));

  const header = document.createElement("div");
  header.className = "bg-popover-header";
  header.textContent = t("bgCategoryLabel");
  popover.appendChild(header);

  const notice = document.createElement("div");
  notice.className = "bg-popover-notice";
  notice.style.display = "none";
  notice.style.fontSize = "11px";
  notice.style.color = "var(--danger)";
  notice.style.padding = "4px 8px";
  notice.textContent = t("bgCategoryMinRequired");
  popover.appendChild(notice);

  const listContainer = document.createElement("div");
  listContainer.className = "bg-popover-list";

  const renderList = () => {
    listContainer.replaceChildren();
    for (const cat of CATEGORY_KEYS) {
      const isSelected = selectedCats.includes(cat.id);
      const row = document.createElement("label");
      row.className = `bg-popover-item bg-popover-checkbox-row ${isSelected ? "selected" : ""}`;
      row.style.cursor = "pointer";
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = isSelected;
      chk.style.accentColor = "var(--primary)";

      chk.addEventListener("change", async () => {
        if (!chk.checked) {
          if (selectedCats.length <= 1) {
            chk.checked = true;
            notice.style.display = "block";
            return;
          }
          selectedCats = selectedCats.filter((id) => id !== cat.id);
          notice.style.display = "none";
        } else {
          if (!selectedCats.includes(cat.id)) {
            selectedCats.push(cat.id);
          }
          notice.style.display = "none";
        }
        await saveBgConfig({ categories: selectedCats });
        renderList();
      });

      const labelSpan = document.createElement("span");
      labelSpan.style.flex = "1";
      labelSpan.textContent = t(cat.i18nKey);

      row.appendChild(chk);
      row.appendChild(labelSpan);
      listContainer.appendChild(row);
    }
  };

  renderList();
  popover.appendChild(listContainer);

  // Divider & Category Lock checkbox
  const divider = document.createElement("div");
  divider.className = "bg-popover-divider";
  popover.appendChild(divider);

  const lockRow = document.createElement("label");
  lockRow.className = "bg-popover-label-row";
  const lockCheckbox = document.createElement("input");
  lockCheckbox.type = "checkbox";
  lockCheckbox.checked = !!config.isCategoryLocked;
  lockCheckbox.addEventListener("change", async () => {
    await saveBgConfig({ isCategoryLocked: lockCheckbox.checked });
  });
  const lockText = document.createElement("span");
  lockText.textContent = t("bgLockCategory");
  lockRow.appendChild(lockCheckbox);
  lockRow.appendChild(lockText);
  popover.appendChild(lockRow);

  elements.bgPopoverContainer.appendChild(popover);
  elements.bgPopoverContainer.style.display = "block";
}

/**
 * Opens Frequency Selection Popover
 */
export async function openFrequencyPopover(elements) {
  if (!elements?.bgPopoverContainer) return;
  closeBgPopover(elements);
  activePopoverType = "frequency";
  setPopoverAriaState(elements, elements?.bgFreqBtn);

  const config = await getBgConfig();
  const currentFreq = config.frequency || "daily";

  const popover = document.createElement("div");
  popover.className = "bg-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", t("bgFrequencyLabel"));

  const header = document.createElement("div");
  header.className = "bg-popover-header";
  header.textContent = t("bgFrequencyLabel");
  popover.appendChild(header);

  for (const freq of FREQUENCY_KEYS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `bg-popover-item ${freq.id === currentFreq ? "selected" : ""}`;
    item.textContent = t(freq.i18nKey);

    if (freq.id === currentFreq) {
      const check = document.createElement("span");
      renderSvgIcon(check, SVG_ICONS.checkCircle);
      item.appendChild(check);
    }

    item.addEventListener("click", async () => {
      await saveBgConfig({ frequency: freq.id });
      closeBgPopover(elements);
    });

    popover.appendChild(item);
  }

  elements.bgPopoverContainer.appendChild(popover);
  elements.bgPopoverContainer.style.display = "block";
}

/**
 * Opens Image Information & Attribution Popover
 */
export async function openInfoPopover(elements) {
  if (!elements?.bgPopoverContainer) return;
  closeBgPopover(elements);
  activePopoverType = "info";
  setPopoverAriaState(elements, elements?.bgInfoBtn);

  const current = await getBgCurrent();

  const popover = document.createElement("div");
  popover.className = "bg-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", t("bgInfoTitle"));

  const card = document.createElement("div");
  card.className = "bg-info-card";

  if (!current || current.isEmptyFavorites || current.isEmptyLocal) {
    const title = document.createElement("div");
    title.className = "bg-info-title";
    title.textContent = current?.isEmptyFavorites ? t("bgFavEmptyTitle") : t("bgInfoTitle");
    const meta = document.createElement("div");
    meta.className = "bg-info-meta";
    meta.textContent = current?.isEmptyFavorites ? t("bgFavEmptyDesc") : t("bgLocalEmpty");
    card.appendChild(title);
    card.appendChild(meta);
  } else {
    // Title
    const title = document.createElement("div");
    title.className = "bg-info-title";
    title.textContent = current.title || "Wikimedia Commons Image";
    card.appendChild(title);

    // Meta details
    const meta = document.createElement("div");
    meta.className = "bg-info-meta";

    const authorRow = document.createElement("div");
    const authorLabel = document.createElement("strong");
    authorLabel.textContent = `${t("bgAuthorLabel")}: `;
    authorRow.appendChild(authorLabel);
    authorRow.appendChild(document.createTextNode(current.artist || "Unknown"));
    meta.appendChild(authorRow);

    const licenseRow = document.createElement("div");
    const licenseLabel = document.createElement("strong");
    licenseLabel.textContent = `${t("bgLicenseLabel")}: `;
    licenseRow.appendChild(licenseLabel);
    const licenseText = current.license || "Creative Commons / Public Domain";
    if (current.licenseUrl) {
      const licenseLink = document.createElement("a");
      licenseLink.href = current.licenseUrl;
      licenseLink.target = "_blank";
      licenseLink.rel = "noopener noreferrer";
      licenseLink.textContent = licenseText;
      licenseRow.appendChild(licenseLink);
    } else {
      licenseRow.appendChild(document.createTextNode(licenseText));
    }
    meta.appendChild(licenseRow);

    const sourceRow = document.createElement("div");
    const sourceLabel = document.createElement("strong");
    sourceLabel.textContent = `${t("bgSourceLabel")}: `;
    sourceRow.appendChild(sourceLabel);
    sourceRow.appendChild(document.createTextNode(current.isLocal ? t("bgCatLocal") : t("bgSourceCommons")));
    meta.appendChild(sourceRow);

    card.appendChild(meta);

    // Links
    if (!current.isLocal && (current.commonsUrl || current.originalUrl)) {
      const linksContainer = document.createElement("div");
      linksContainer.className = "bg-info-links";

      if (current.commonsUrl) {
        const commonsLink = document.createElement("a");
        commonsLink.className = "bg-info-link";
        commonsLink.href = current.commonsUrl;
        commonsLink.target = "_blank";
        commonsLink.rel = "noopener noreferrer";
        commonsLink.textContent = t("bgViewCommons");
        const iconSpan = document.createElement("span");
        renderSvgIcon(iconSpan, SVG_ICONS.externalLink);
        commonsLink.appendChild(iconSpan);
        linksContainer.appendChild(commonsLink);
      }

      if (current.originalUrl) {
        const origLink = document.createElement("a");
        origLink.className = "bg-info-link";
        origLink.href = current.originalUrl;
        origLink.target = "_blank";
        origLink.rel = "noopener noreferrer";
        origLink.textContent = t("bgViewOriginal");
        const iconSpan = document.createElement("span");
        renderSvgIcon(iconSpan, SVG_ICONS.externalLink);
        origLink.appendChild(iconSpan);
        linksContainer.appendChild(origLink);
      }

      card.appendChild(linksContainer);
    }
  }

  popover.appendChild(card);
  elements.bgPopoverContainer.appendChild(popover);
  elements.bgPopoverContainer.style.display = "block";
}

/**
 * Opens Background Settings Modal
 */
export async function openBgSettingsModal(elements, openModalFn, closeModalFn, { focusDropzone = false } = {}) {
  const config = await getBgConfig();
  let currentSourceMode = config.sourceMode || "random";
  let selectedCats = Array.isArray(config.categories) && config.categories.length > 0 ? [...config.categories] : ["nature"];
  let selectedFreq = config.frequency || "daily";

  const container = document.createElement("div");
  container.className = "bg-settings-form";

  // 1. Enable / Disable Switch
  const enableRow = document.createElement("div");
  enableRow.className = "bg-setting-row";
  const enableLabelWrap = document.createElement("div");
  const enableLabel = document.createElement("div");
  enableLabel.className = "bg-setting-label";
  enableLabel.textContent = t("bgEnabledLabel");
  const enableDesc = document.createElement("div");
  enableDesc.className = "bg-setting-desc";
  enableDesc.textContent = t("bgEnableDesc");
  enableLabelWrap.appendChild(enableLabel);
  enableLabelWrap.appendChild(enableDesc);

  const enableCheckbox = document.createElement("input");
  enableCheckbox.type = "checkbox";
  enableCheckbox.checked = !!config.enabled;
  enableCheckbox.style.cursor = "pointer";
  enableCheckbox.style.accentColor = "var(--primary)";

  enableRow.appendChild(enableLabelWrap);
  enableRow.appendChild(enableCheckbox);
  container.appendChild(enableRow);

  // 2. Opacity Slider
  const opacityRow = document.createElement("div");
  opacityRow.className = "bg-setting-row";
  const opacityLabelWrap = document.createElement("div");
  const opacityLabel = document.createElement("div");
  opacityLabel.className = "bg-setting-label";
  opacityLabel.textContent = t("bgOpacityLabel");
  const opacityDesc = document.createElement("div");
  opacityDesc.className = "bg-setting-desc";
  opacityDesc.textContent = t("bgOpacityDesc");
  opacityLabelWrap.appendChild(opacityLabel);
  opacityLabelWrap.appendChild(opacityDesc);

  const rangeWrap = document.createElement("div");
  rangeWrap.className = "bg-range-wrap";
  const opacityInput = document.createElement("input");
  opacityInput.type = "range";
  opacityInput.min = "5";
  opacityInput.max = "100";
  opacityInput.value = String(config.opacity !== undefined ? config.opacity : 35);

  const opacityVal = document.createElement("span");
  opacityVal.className = "bg-range-val";
  opacityVal.textContent = `${opacityInput.value}%`;

  opacityInput.addEventListener("input", () => {
    opacityVal.textContent = `${opacityInput.value}%`;
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.style.setProperty("--bg-image-opacity", String(Number(opacityInput.value) / 100));
    }
  });

  rangeWrap.appendChild(opacityInput);
  rangeWrap.appendChild(opacityVal);
  opacityRow.appendChild(opacityLabelWrap);
  opacityRow.appendChild(rangeWrap);
  container.appendChild(opacityRow);

  // 3. Background Source Mode
  const sourceSection = document.createElement("div");
  sourceSection.className = "bg-setting-row";
  const sourceLabelWrap = document.createElement("div");
  const sourceTitle = document.createElement("div");
  sourceTitle.className = "bg-setting-label";
  sourceTitle.textContent = t("bgSourceLabel");
  const sourceDesc = document.createElement("div");
  sourceDesc.className = "bg-setting-desc";
  sourceDesc.textContent = currentSourceMode === "my_images" ? t("bgSourceMyImagesDesc") : t("bgSourceRandomDesc");
  sourceLabelWrap.appendChild(sourceTitle);
  sourceLabelWrap.appendChild(sourceDesc);

  const sourceControlWrap = document.createElement("div");
  sourceControlWrap.className = "bg-source-segmented";
  sourceControlWrap.style.display = "flex";
  sourceControlWrap.style.gap = "6px";

  const randomBtn = document.createElement("button");
  randomBtn.type = "button";
  randomBtn.className = `btn btn-sm ${currentSourceMode === "random" ? "btn-primary" : "btn-secondary"}`;
  randomBtn.textContent = t("bgSourceRandom");

  const myImagesBtn = document.createElement("button");
  myImagesBtn.type = "button";
  myImagesBtn.className = `btn btn-sm ${currentSourceMode === "my_images" ? "btn-primary" : "btn-secondary"}`;
  myImagesBtn.textContent = t("bgSourceMyImages");

  const updateSourceButtons = () => {
    if (currentSourceMode === "random") {
      randomBtn.className = "btn btn-sm btn-primary";
      myImagesBtn.className = "btn btn-sm btn-secondary";
      sourceDesc.textContent = t("bgSourceRandomDesc");
    } else {
      randomBtn.className = "btn btn-sm btn-secondary";
      myImagesBtn.className = "btn btn-sm btn-primary";
      sourceDesc.textContent = t("bgSourceMyImagesDesc");
    }
  };

  randomBtn.addEventListener("click", () => {
    currentSourceMode = "random";
    updateSourceButtons();
  });

  myImagesBtn.addEventListener("click", async () => {
    const list = await getLocalImagesList();
    if (list.length === 0) {
      uploadError.textContent = t("bgLocalEmpty");
      uploadError.style.display = "block";
      dropzone.focus();
      return;
    }
    currentSourceMode = "my_images";
    updateSourceButtons();
  });

  sourceControlWrap.appendChild(randomBtn);
  sourceControlWrap.appendChild(myImagesBtn);
  sourceSection.appendChild(sourceLabelWrap);
  sourceSection.appendChild(sourceControlWrap);
  container.appendChild(sourceSection);

  // 4. Frequency Selection
  const freqRow = document.createElement("div");
  freqRow.className = "bg-setting-row";
  const freqLabelWrap = document.createElement("div");
  const freqTitle = document.createElement("div");
  freqTitle.className = "bg-setting-label";
  freqTitle.textContent = t("bgFrequencyLabel");
  freqLabelWrap.appendChild(freqTitle);

  const freqSelect = document.createElement("select");
  freqSelect.className = "form-select";
  freqSelect.style.padding = "4px 8px";
  freqSelect.style.borderRadius = "var(--radius-sm, 6px)";
  for (const f of FREQUENCY_KEYS) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = t(f.i18nKey);
    if (f.id === selectedFreq) opt.selected = true;
    freqSelect.appendChild(opt);
  }
  freqSelect.addEventListener("change", () => {
    selectedFreq = freqSelect.value;
  });

  freqRow.appendChild(freqLabelWrap);
  freqRow.appendChild(freqSelect);
  container.appendChild(freqRow);

  // 5. Local Images Section
  const localSection = document.createElement("div");
  localSection.style.marginTop = "12px";
  localSection.style.display = "flex";
  localSection.style.flexDirection = "column";
  localSection.style.gap = "8px";

  const localTitleRow = document.createElement("div");
  localTitleRow.className = "bg-setting-row";
  const localTitle = document.createElement("div");
  localTitle.className = "bg-setting-label";
  localTitle.textContent = t("bgLocalUpload");
  const localQuotaLabel = document.createElement("div");
  localQuotaLabel.className = "bg-setting-desc";
  localTitleRow.appendChild(localTitle);
  localTitleRow.appendChild(localQuotaLabel);
  localSection.appendChild(localTitleRow);

  // Dropzone / File trigger
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.style.display = "none";

  const dropzone = document.createElement("div");
  dropzone.className = "bg-dropzone";
  dropzone.setAttribute("role", "button");
  dropzone.setAttribute("tabindex", "0");
  const dropzoneIcon = document.createElement("span");
  renderSvgIcon(dropzoneIcon, SVG_ICONS.upload);
  const dropzoneText = document.createElement("div");
  dropzoneText.className = "bg-dropzone-text";
  dropzoneText.textContent = t("bgLocalDropHint");
  dropzone.appendChild(dropzoneIcon);
  dropzone.appendChild(dropzoneText);

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      fileInput.click();
    }
  });

  const uploadError = document.createElement("div");
  uploadError.className = "bg-upload-error";
  uploadError.style.display = "none";
  uploadError.style.color = "var(--danger)";
  uploadError.style.fontSize = "12px";
  uploadError.style.padding = "6px 10px";
  uploadError.style.borderRadius = "var(--radius-sm, 6px)";
  uploadError.style.background = "var(--danger-subtle, rgba(223, 56, 43, 0.08))";
  uploadError.style.border = "1px solid var(--danger-border, rgba(223, 56, 43, 0.25))";

  localSection.appendChild(fileInput);
  localSection.appendChild(uploadError);
  localSection.appendChild(dropzone);

  // Local images list container
  const localListEl = document.createElement("div");
  localListEl.className = "bg-local-list";
  localSection.appendChild(localListEl);

  const refreshLocalList = async () => {
    const list = await getLocalImagesList();
    const totalSize = await getLocalImagesTotalSize();
    localQuotaLabel.textContent = `${(totalSize / (1024 * 1024)).toFixed(1)} MB / 50 MB`;

    localListEl.replaceChildren();
    if (list.length === 0) {
      const emptyItem = document.createElement("div");
      emptyItem.style.padding = "8px";
      emptyItem.style.color = "var(--text-muted)";
      emptyItem.style.fontSize = "11.5px";
      emptyItem.textContent = t("bgLocalEmpty");
      localListEl.appendChild(emptyItem);
      return;
    }

    const currentConfig = await getBgConfig();
    const currentBg = await getBgCurrent();

    for (const item of list) {
      const row = document.createElement("div");
      row.className = "bg-local-item";

      const info = document.createElement("div");
      info.className = "bg-local-item-info";
      const name = document.createElement("span");
      name.className = "bg-local-item-name";
      name.textContent = item.name;
      const size = document.createElement("span");
      size.className = "bg-local-item-size";
      size.textContent = `${(item.size / 1024).toFixed(0)} KB`;
      info.appendChild(name);
      info.appendChild(size);

      const actionsWrap = document.createElement("div");
      actionsWrap.className = "bg-local-item-actions";
      actionsWrap.style.display = "flex";
      actionsWrap.style.alignItems = "center";
      actionsWrap.style.gap = "8px";

      const isActive = currentConfig.sourceMode === "my_images" && (currentBg?.id === item.id || currentConfig.lastLocalImageId === item.id);

      if (isActive) {
        const activeBadge = document.createElement("span");
        activeBadge.className = "bg-badge-current";
        activeBadge.textContent = t("bgCurrentBackground");
        actionsWrap.appendChild(activeBadge);
      } else {
        const setBtn = document.createElement("button");
        setBtn.type = "button";
        setBtn.className = "btn btn-secondary btn-sm";
        setBtn.textContent = t("bgSetAsBackground");
        setBtn.addEventListener("click", async () => {
          const res = await setLocalImageAsBackground(item.id);
          enableCheckbox.checked = true;
          currentSourceMode = "my_images";
          updateSourceButtons();
          if (res?.image) {
            await applyBackgroundImage(elements, res.image);
          }
          await updateBackgroundUI(elements);
          await refreshLocalList();
        });
        actionsWrap.appendChild(setBtn);
      }

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-ghost btn-sm btn-icon danger";
      delBtn.setAttribute("aria-label", t("bgDeleteImage"));
      delBtn.setAttribute("title", t("bgDeleteImage"));
      renderSvgIcon(delBtn, SVG_ICONS.trash);
      delBtn.addEventListener("click", async () => {
        const res = await deleteLocalImageAndCascade(item.id);
        if (res.switchedToNextLocal && res.image) {
          await applyBackgroundImage(elements, res.image);
        } else if (res.switchedToRandom && res.image) {
          currentSourceMode = "random";
          updateSourceButtons();
          await applyBackgroundImage(elements, res.image);
          uploadError.textContent = t("bgSwitchedToRandomNotice");
          uploadError.style.display = "block";
        }
        await updateBackgroundUI(elements);
        await refreshLocalList();
      });

      actionsWrap.appendChild(delBtn);
      row.appendChild(info);
      row.appendChild(actionsWrap);
      localListEl.appendChild(row);
    }
  };

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    uploadError.style.display = "none";
    try {
      const saved = await saveLocalImage(file);
      fileInput.value = "";
      // Immediately enable, switch to My Images, apply, and persist
      const res = await setLocalImageAsBackground(saved.id);
      enableCheckbox.checked = true;
      currentSourceMode = "my_images";
      updateSourceButtons();
      if (res?.image) {
        await applyBackgroundImage(elements, res.image);
      }
      await updateBackgroundUI(elements);
      await refreshLocalList();
    } catch (err) {
      uploadError.textContent = err.message || t("bgLocalLimitExceeded");
      uploadError.style.display = "block";
    }
  });

  await refreshLocalList();
  container.appendChild(localSection);

  setPopoverAriaState(elements, elements?.bgHeaderBtn || elements?.bgSettingsBtn);

  if (focusDropzone) {
    setTimeout(() => {
      dropzone.focus();
    }, 80);
  }

  // Open modal
  openModalFn(
    t("bgSettingsTitle"),
    container,
    async () => {
      setPopoverAriaState(elements, null);
      const newEnabled = enableCheckbox.checked;
      const newOpacity = Number(opacityInput.value);
      await saveBgConfig({
        enabled: newEnabled,
        opacity: newOpacity,
        sourceMode: currentSourceMode,
        frequency: selectedFreq,
        categories: selectedCats
      });
      await updateBackgroundUI(elements);
      return true;
    },
    t("save"),
    () => {
      setPopoverAriaState(elements, null);
    }
  );
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
