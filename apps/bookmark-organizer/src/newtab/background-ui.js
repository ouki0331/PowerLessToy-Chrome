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
  getLocalImagesTotalSize,
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
 * Initializes Background UI, attaches event listeners, and applies initial state
 */
export async function initBackgroundUI(elements, openModalFn, closeModalFn) {
  if (!elements || !elements.bgFab) return;

  // Render icons on toolbar buttons
  renderSvgIcon(elements.bgFavBtn?.querySelector(".icon-slot"), SVG_ICONS.heart);
  renderSvgIcon(elements.bgNextBtn?.querySelector(".icon-slot"), SVG_ICONS.next);
  renderSvgIcon(elements.bgLockBtn?.querySelector(".icon-slot"), SVG_ICONS.unlock);
  renderSvgIcon(elements.bgCategoryBtn?.querySelector(".icon-slot"), SVG_ICONS.categoryGrid);
  renderSvgIcon(elements.bgFreqBtn?.querySelector(".icon-slot"), SVG_ICONS.frequencyClock);
  renderSvgIcon(elements.bgInfoBtn?.querySelector(".icon-slot"), SVG_ICONS.infoCircle);
  renderSvgIcon(elements.bgSettingsBtn?.querySelector(".icon-slot"), SVG_ICONS.manage);
  renderSvgIcon(elements.bgToggleTrigger?.querySelector(".icon-slot"), SVG_ICONS.wallpaper);

  // Bind FAB events
  elements.bgFavBtn?.addEventListener("click", async () => {
    const current = await getBgCurrent();
    if (!current) return;
    const isNowFav = await toggleFavorite(current);
    updateFavButtonUI(elements.bgFavBtn, isNowFav);
  });

  elements.bgNextBtn?.addEventListener("click", async () => {
    closeBgPopover(elements);
    const next = await getNextImage({ force: true });
    await applyBackgroundImage(elements, next);
  });

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

  // Global listeners to close popovers on outside click or Escape
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      if (activePopoverType && !e.target.closest("#bgFab") && !e.target.closest("#bgPopoverContainer")) {
        closeBgPopover(elements);
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && activePopoverType) {
        closeBgPopover(elements);
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

  if (!config.enabled) {
    if (elements.bgLayer) elements.bgLayer.style.display = "none";
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.remove("has-custom-bg");
    }
    if (elements.bgToolbar) elements.bgToolbar.style.display = "none";
    if (elements.bgToggleTrigger) elements.bgToggleTrigger.style.display = "flex";
    return;
  }

  // Enabled State
  if (elements.bgLayer) elements.bgLayer.style.display = "block";
  if (typeof document !== "undefined" && document.body) {
    document.body.classList.add("has-custom-bg");
  }
  if (elements.bgToolbar) elements.bgToolbar.style.display = "flex";
  if (elements.bgToggleTrigger) elements.bgToggleTrigger.style.display = "none";

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

  if (image && (image.thumbUrl || image.originalUrl)) {
    const url = image.thumbUrl || image.originalUrl;
    elements.bgImage.style.backgroundImage = `url("${url}")`;
    const favorited = await isFavorite(image.id || image.originalUrl);
    updateFavButtonUI(elements.bgFavBtn, favorited);
  } else {
    elements.bgImage.style.backgroundImage = "none";
    updateFavButtonUI(elements.bgFavBtn, false);
  }
}

/**
 * Updates Favorite button icon and aria-label
 */
function updateFavButtonUI(btn, favorited) {
  if (!btn) return;
  const slot = btn.querySelector(".icon-slot");
  if (favorited) {
    btn.classList.add("is-favorited");
    btn.setAttribute("aria-label", t("bgFavRemove"));
    btn.setAttribute("title", t("bgFavRemove"));
    renderSvgIcon(slot, SVG_ICONS.heartFilled);
  } else {
    btn.classList.remove("is-favorited");
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
    btn.setAttribute("aria-label", t("bgUnlockImage"));
    btn.setAttribute("title", t("bgUnlockImage"));
    renderSvgIcon(slot, SVG_ICONS.lock);
  } else {
    btn.classList.remove("is-locked");
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
  activePopoverType = null;
}

/**
 * Opens Category Selection Popover
 */
export async function openCategoryPopover(elements) {
  if (!elements?.bgPopoverContainer) return;
  closeBgPopover(elements);
  activePopoverType = "category";

  const config = await getBgConfig();
  const currentCat = (config.categories && config.categories[0]) || "nature";

  const popover = document.createElement("div");
  popover.className = "bg-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", t("bgCategoryLabel"));

  const header = document.createElement("div");
  header.className = "bg-popover-header";
  header.textContent = t("bgCategoryLabel");
  popover.appendChild(header);

  // List of categories
  for (const cat of CATEGORY_KEYS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `bg-popover-item ${cat.id === currentCat ? "selected" : ""}`;
    item.textContent = t(cat.i18nKey);

    if (cat.id === currentCat) {
      const check = document.createElement("span");
      renderSvgIcon(check, SVG_ICONS.checkCircle);
      item.appendChild(check);
    }

    item.addEventListener("click", async () => {
      await saveBgConfig({ categories: [cat.id] });
      closeBgPopover(elements);
      const next = await getNextImage({ force: true });
      await applyBackgroundImage(elements, next);
    });

    popover.appendChild(item);
  }

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
    sourceLabel.textContent = "Source: ";
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
export async function openBgSettingsModal(elements, openModalFn, closeModalFn) {
  const config = await getBgConfig();

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
  enableDesc.textContent = "Toggle keyless Wikimedia Commons background gallery";
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
  opacityDesc.textContent = "Adjust visibility for comfortable reading";
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

  // 3. Local Images Section
  const localSection = document.createElement("div");
  localSection.style.marginTop = "8px";
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

  localSection.appendChild(fileInput);
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

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-ghost btn-sm btn-icon danger";
      delBtn.setAttribute("aria-label", t("bgDeleteImage"));
      delBtn.setAttribute("title", t("bgDeleteImage"));
      renderSvgIcon(delBtn, SVG_ICONS.trash);
      delBtn.addEventListener("click", async () => {
        await deleteLocalImage(item.id);
        await refreshLocalList();
      });

      row.appendChild(info);
      row.appendChild(delBtn);
      localListEl.appendChild(row);
    }
  };

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      await saveLocalImage(file);
      fileInput.value = "";
      await refreshLocalList();
    } catch (err) {
      alert(err.message || t("bgLocalLimitExceeded"));
    }
  });

  await refreshLocalList();
  container.appendChild(localSection);

  // Open modal
  openModalFn(
    t("bgSettingsTitle"),
    container,
    async () => {
      const newEnabled = enableCheckbox.checked;
      const newOpacity = Number(opacityInput.value);
      await saveBgConfig({
        enabled: newEnabled,
        opacity: newOpacity
      });
      await updateBackgroundUI(elements);
      return true;
    },
    t("save")
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
