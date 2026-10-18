/**
 * Main Application Orchestrator for Bookmark Organizer
 * Follows Quiet Workbench UI/UX specifications and DEC product decisions.
 */

import {
  loadWorkbenchData,
  saveWorkbenchData,
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
  isValidUrl
} from "./storage.js";

import { handleCategoryKeydown, handleModalKeydown } from "./keyboard.js";
import { DEFAULT_BADGES } from "./constants.js";
import { t, getLanguage, setLanguage } from "./i18n.js";

// Application State
let state = {
  data: null,
  isManageMode: false,
  activeModal: null
};

// DOM References
const elements = {
  brandTitle: document.getElementById("appBrandTitle"),
  tagline: document.getElementById("appTagline"),
  categoryTabs: document.getElementById("categoryTabs"),
  addCategoryBtn: document.getElementById("addCategoryBtn"),
  activeCatTitle: document.getElementById("activeCatTitle"),
  catStatsLabel: document.getElementById("catStatsLabel"),
  catAdminButtons: document.getElementById("catAdminButtons"),
  renameCatBtn: document.getElementById("renameCatBtn"),
  deleteCatBtn: document.getElementById("deleteCatBtn"),
  addGroupBtn: document.getElementById("addGroupBtn"),
  groupGrid: document.getElementById("groupGrid"),
  categoryEmptyState: document.getElementById("categoryEmptyState"),
  emptyCatTitle: document.getElementById("emptyCatTitle"),
  emptyCatLead: document.getElementById("emptyCatLead"),
  createFirstGroupBtn: document.getElementById("createFirstGroupBtn"),
  toggleManageBtn: document.getElementById("toggleManageBtn"),
  manageIndicator: document.getElementById("manageIndicator"),
  manageBtnText: document.getElementById("manageBtnText"),
  langToggleBtn: document.getElementById("langToggleBtn"),
  currentLangLabel: document.getElementById("currentLangLabel"),
  errorBanner: document.getElementById("errorBanner"),
  errorTitle: document.getElementById("errorTitle"),
  errorDesc: document.getElementById("errorDesc"),
  retryLoadBtn: document.getElementById("retryLoadBtn"),
  modalContainer: document.getElementById("modalContainer")
};

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
  // Load language preference
  const savedLang = localStorage.getItem("powerless_toy_lang");
  if (savedLang) {
    setLanguage(savedLang);
  }
  updateI18nLabels();

  setupEventListeners();
  await initWorkbench();
});

function updateI18nLabels() {
  const lang = getLanguage();
  elements.currentLangLabel.textContent = lang.toUpperCase();
  elements.brandTitle.textContent = t("appTitle");
  elements.tagline.textContent = t("tagline");
  elements.manageBtnText.textContent = state.isManageMode ? t("doneManaging") : t("manageMode");
  elements.addCategoryBtn.textContent = t("addCategory");
  elements.addGroupBtn.textContent = t("addGroup");
  elements.renameCatBtn.textContent = t("rename");
  elements.deleteCatBtn.textContent = t("delete");
  elements.emptyCatTitle.textContent = t("noGroupsInCat");
  elements.emptyCatLead.textContent = t("noGroupsLead");
  elements.createFirstGroupBtn.textContent = t("createFirstGroup");
  elements.errorTitle.textContent = t("loadErrorTitle");
  elements.errorDesc.textContent = t("loadErrorDesc");
  elements.retryLoadBtn.textContent = t("retry");
}

async function initWorkbench() {
  try {
    elements.errorBanner.style.display = "none";
    state.data = await loadWorkbenchData();
    render();
  } catch (err) {
    console.error("Failed to load workbench data:", err);
    elements.errorBanner.style.display = "flex";
  }
}

function setupEventListeners() {
  // Toggle Language
  elements.langToggleBtn.addEventListener("click", () => {
    const nextLang = getLanguage() === "en" ? "ja" : "en";
    setLanguage(nextLang);
    localStorage.setItem("powerless_toy_lang", nextLang);
    updateI18nLabels();
    render();
  });

  // Toggle Manage Mode
  elements.toggleManageBtn.addEventListener("click", () => {
    state.isManageMode = !state.isManageMode;
    elements.toggleManageBtn.setAttribute("aria-pressed", state.isManageMode ? "true" : "false");
    elements.manageIndicator.style.display = state.isManageMode ? "inline-block" : "none";
    elements.manageBtnText.textContent = state.isManageMode ? t("doneManaging") : t("manageMode");
    render();
  });

  // Retry loading
  elements.retryLoadBtn.addEventListener("click", () => {
    initWorkbench();
  });

  // Category Management Buttons
  elements.addCategoryBtn.addEventListener("click", () => openAddCategoryModal());
  elements.renameCatBtn.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openRenameCategoryModal(activeCat);
  });
  elements.deleteCatBtn.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openDeleteCategoryModal(activeCat);
  });

  // Group Management Buttons
  elements.addGroupBtn.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openAddGroupModal(activeCat.id);
  });
  elements.createFirstGroupBtn.addEventListener("click", () => {
    const activeCat = getActiveCategory();
    if (activeCat) openAddGroupModal(activeCat.id);
  });

  // Category Tabs keydown delegation (conforms to DEC-003)
  elements.categoryTabs.addEventListener("keydown", (e) => {
    if (state.activeModal) return; // Ignore while modal is open
    const tabElements = Array.from(elements.categoryTabs.querySelectorAll(".category-tab"));
    const currentIndex = tabElements.indexOf(document.activeElement);
    if (currentIndex !== -1) {
      handleCategoryKeydown(e, tabElements, currentIndex, async (newCatId) => {
        await switchCategory(newCatId);
      });
    }
  });
}

function getActiveCategory() {
  if (!state.data || !state.data.categories) return null;
  return state.data.categories.find((c) => c.id === state.data.activeCategoryId) || state.data.categories[0];
}

async function switchCategory(catId) {
  if (state.data.activeCategoryId === catId) return;
  await setActiveCategory(state.data, catId);
  render();

  // Keep active tab visible when horizontally scrolling
  const activeTabEl = elements.categoryTabs.querySelector(`[data-category-id="${catId}"]`);
  if (activeTabEl && typeof activeTabEl.scrollIntoView === "function") {
    activeTabEl.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }
}

// ==========================================================================
// Rendering
// ==========================================================================

function render() {
  if (!state.data) return;

  renderCategoryTabs();
  renderActiveCategoryHeader();
  renderGroups();
}

function renderCategoryTabs() {
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

    tab.addEventListener("click", () => switchCategory(cat.id));
    elements.categoryTabs.appendChild(tab);
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
  // Disable delete button if only one category exists
  elements.deleteCatBtn.disabled = state.data.categories.length <= 1;
}

function renderGroups() {
  const activeCat = getActiveCategory();
  if (!activeCat) return;

  const currentGroups = state.data.groups.filter((g) => g.categoryId === activeCat.id);

  if (currentGroups.length === 0) {
    elements.groupGrid.style.display = "none";
    elements.categoryEmptyState.style.display = "block";
    return;
  }

  elements.groupGrid.style.display = "grid";
  elements.categoryEmptyState.style.display = "none";
  elements.groupGrid.innerHTML = "";

  currentGroups.forEach((group) => {
    const groupCard = createGroupCard(group);
    elements.groupGrid.appendChild(groupCard);
  });
}

function createGroupCard(group) {
  const card = document.createElement("section");
  card.className = "group-card";
  card.setAttribute("aria-labelledby", `group-title-${group.id}`);

  // Card Header
  const header = document.createElement("div");
  header.className = "group-card-header";

  const title = document.createElement("h3");
  title.id = `group-title-${group.id}`;
  title.className = "group-title";
  title.textContent = group.name;
  header.appendChild(title);

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
    renameBtn.innerHTML = "✏️";
    renameBtn.title = t("rename");
    renameBtn.setAttribute("aria-label", `${t("rename")} ${group.name}`);
    renameBtn.addEventListener("click", () => openRenameGroupModal(group));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-icon danger";
    deleteBtn.innerHTML = "🗑️";
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
    emptyRow.innerHTML = `<span>${t("noLinksInGroup")}</span>`;

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
      const linkItem = createLinkItem(link);
      list.appendChild(linkItem);
    });

    body.appendChild(list);
  }

  card.appendChild(body);
  return card;
}

function createLinkItem(link) {
  const item = document.createElement("li");
  item.className = "link-item";

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
      // Prevent navigation when in manage mode
      e.preventDefault();
      return;
    }

    // Ctrl+click or Cmd+click: open in new tab
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (typeof chrome !== "undefined" && chrome.tabs?.create) {
        chrome.tabs.create({ url: link.url, active: false });
      } else {
        window.open(link.url, "_blank");
      }
      return;
    }

    // Normal click: open in current tab
    e.preventDefault();
    window.location.href = link.url;
  });

  item.appendChild(anchor);

  if (state.isManageMode) {
    const actions = document.createElement("div");
    actions.className = "link-manage-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-icon";
    editBtn.innerHTML = "✏️";
    editBtn.title = t("edit");
    editBtn.setAttribute("aria-label", `${t("edit")} ${link.name}`);
    editBtn.addEventListener("click", () => openEditLinkModal(link));

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-icon danger";
    deleteBtn.innerHTML = "🗑️";
    deleteBtn.title = t("delete");
    deleteBtn.setAttribute("aria-label", `${t("delete")} ${link.name}`);
    deleteBtn.addEventListener("click", () => openDeleteLinkModal(link));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(actions);
  }

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
  closeBtn.innerHTML = "✕";
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

  // Backdrop click closes modal
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      closeModal();
    }
  });

  // Focus initial input
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
// Category Modals
// ==========================================================================

function openAddCategoryModal() {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="newCatName">${t("nameLabel")}</label>
      <input type="text" id="newCatName" class="form-input" placeholder="e.g. Personal Tools" autofocus>
      <span class="form-error-msg" id="catNameError" style="display: none;"></span>
    </div>
  `;

  const nameInput = container.querySelector("#newCatName");
  const errorEl = container.querySelector("#catNameError");

  openModal(t("addCategory"), container, async () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      nameInput.classList.add("has-error");
      errorEl.textContent = t("fieldRequired");
      errorEl.style.display = "block";
      nameInput.focus();
      return false;
    }

    await addCategory(state.data, nameVal);
    render();
    return true;
  });
}

function openRenameCategoryModal(cat) {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="renameCatName">${t("nameLabel")}</label>
      <input type="text" id="renameCatName" class="form-input" value="${cat.name}" autofocus>
      <span class="form-error-msg" id="catRenameError" style="display: none;"></span>
    </div>
  `;

  const nameInput = container.querySelector("#renameCatName");
  const errorEl = container.querySelector("#catRenameError");

  openModal(t("rename"), container, async () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      nameInput.classList.add("has-error");
      errorEl.textContent = t("fieldRequired");
      errorEl.style.display = "block";
      nameInput.focus();
      return false;
    }

    await renameCategory(state.data, cat.id, nameVal);
    render();
    return true;
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
  container.innerHTML = `
    <div class="delete-impact-summary">
      ${t("categoryDeleteConfirm", cat.name, groupsInCat.length, linksInCat.length)}
    </div>
  `;

  openModal(
    t("deleteCategoryTitle"),
    container,
    async () => {
      await deleteCategory(state.data, cat.id);
      render();
      return true;
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
  container.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="newGroupName">${t("nameLabel")}</label>
      <input type="text" id="newGroupName" class="form-input" placeholder="e.g. Order Service" autofocus>
      <span class="form-error-msg" id="groupNameError" style="display: none;"></span>
    </div>
  `;

  const nameInput = container.querySelector("#newGroupName");
  const errorEl = container.querySelector("#groupNameError");

  openModal(t("addGroup"), container, async () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      nameInput.classList.add("has-error");
      errorEl.textContent = t("fieldRequired");
      errorEl.style.display = "block";
      nameInput.focus();
      return false;
    }

    await addGroup(state.data, categoryId, nameVal);
    render();
    return true;
  });
}

function openRenameGroupModal(group) {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="renameGroupName">${t("nameLabel")}</label>
      <input type="text" id="renameGroupName" class="form-input" value="${group.name}" autofocus>
      <span class="form-error-msg" id="groupRenameError" style="display: none;"></span>
    </div>
  `;

  const nameInput = container.querySelector("#renameGroupName");
  const errorEl = container.querySelector("#groupRenameError");

  openModal(t("rename"), container, async () => {
    const nameVal = nameInput.value.trim();
    if (!nameVal) {
      nameInput.classList.add("has-error");
      errorEl.textContent = t("fieldRequired");
      errorEl.style.display = "block";
      nameInput.focus();
      return false;
    }

    await renameGroup(state.data, group.id, nameVal);
    render();
    return true;
  });
}

function openDeleteGroupModal(group) {
  const linksInGroup = state.data.links.filter((l) => l.groupId === group.id);

  const container = document.createElement("div");
  container.innerHTML = `
    <div class="delete-impact-summary">
      ${t("groupDeleteConfirm", group.name, linksInGroup.length)}
    </div>
  `;

  openModal(
    t("deleteGroupTitle"),
    container,
    async () => {
      await deleteGroup(state.data, group.id);
      render();
      return true;
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
  container.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="newLinkName">${t("nameLabel")}</label>
      <input type="text" id="newLinkName" class="form-input" placeholder="e.g. Frontend App" autofocus>
      <span class="form-error-msg" id="linkNameError" style="display: none;"></span>
    </div>
    <div class="form-group">
      <label class="form-label" for="newLinkUrl">${t("urlLabel")}</label>
      <input type="url" id="newLinkUrl" class="form-input" placeholder="https://">
      <span class="form-error-msg" id="linkUrlError" style="display: none;"></span>
    </div>
    <div class="form-group">
      <label class="form-label">${t("badgeLabel")} (${t("optional")})</label>
      <div class="badge-selector-row">
        ${DEFAULT_BADGES.map((b) => `<button type="button" class="badge-preset-btn" data-badge="${b.label}">${b.label}</button>`).join("")}
      </div>
      <input type="text" id="customBadgeInput" class="form-input" style="margin-top: 6px;" placeholder="${t("customBadgePlaceholder")}">
    </div>
  `;

  const nameInput = container.querySelector("#newLinkName");
  const urlInput = container.querySelector("#newLinkUrl");
  const customBadgeInput = container.querySelector("#customBadgeInput");
  const presetBtns = container.querySelectorAll(".badge-preset-btn");
  const nameError = container.querySelector("#linkNameError");
  const urlError = container.querySelector("#linkUrlError");

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const badge = btn.dataset.badge;
      customBadgeInput.value = badge;
      presetBtns.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });

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

    await addLink(state.data, groupId, { name: nameVal, url: urlVal, badge: badgeVal });
    render();
    return true;
  });
}

function openEditLinkModal(link) {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="form-group">
      <label class="form-label" for="editLinkName">${t("nameLabel")}</label>
      <input type="text" id="editLinkName" class="form-input" value="${link.name}" autofocus>
      <span class="form-error-msg" id="editLinkNameError" style="display: none;"></span>
    </div>
    <div class="form-group">
      <label class="form-label" for="editLinkUrl">${t("urlLabel")}</label>
      <input type="url" id="editLinkUrl" class="form-input" value="${link.url}">
      <span class="form-error-msg" id="editLinkUrlError" style="display: none;"></span>
    </div>
    <div class="form-group">
      <label class="form-label">${t("badgeLabel")} (${t("optional")})</label>
      <div class="badge-selector-row">
        ${DEFAULT_BADGES.map(
          (b) => `<button type="button" class="badge-preset-btn ${link.badge === b.label ? "selected" : ""}" data-badge="${b.label}">${b.label}</button>`
        ).join("")}
      </div>
      <input type="text" id="editCustomBadgeInput" class="form-input" style="margin-top: 6px;" value="${link.badge || ""}" placeholder="${t("customBadgePlaceholder")}">
    </div>
  `;

  const nameInput = container.querySelector("#editLinkName");
  const urlInput = container.querySelector("#editLinkUrl");
  const customBadgeInput = container.querySelector("#editCustomBadgeInput");
  const presetBtns = container.querySelectorAll(".badge-preset-btn");
  const nameError = container.querySelector("#editLinkNameError");
  const urlError = container.querySelector("#editLinkUrlError");

  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const badge = btn.dataset.badge;
      customBadgeInput.value = badge;
      presetBtns.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
  });

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

    await editLink(state.data, link.id, { name: nameVal, url: urlVal, badge: badgeVal });
    render();
    return true;
  });
}

function openDeleteLinkModal(link) {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="delete-impact-summary">
      ${t("linkDeleteConfirm", link.name, link.url)}
    </div>
  `;

  openModal(
    t("deleteLinkTitle"),
    container,
    async () => {
      await deleteLink(state.data, link.id);
      render();
      return true;
    },
    t("confirmDelete"),
    true
  );
}
