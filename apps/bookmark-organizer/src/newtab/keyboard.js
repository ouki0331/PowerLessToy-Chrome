/**
 * Keyboard Navigation Handler for Bookmark Organizer
 * Implements DEC-003: Tab/Shift+Tab category switching with non-trapping boundaries,
 * cyclic arrow navigation, and accessible modal trapping.
 */

/**
 * Handle category tab navigation conforming strictly to DEC-003
 * @param {KeyboardEvent} event
 * @param {HTMLElement[]} tabElements - List of category button/tab elements in order
 * @param {number} currentIndex - Index of the currently focused category tab
 * @param {Function} onSelectCategory - Callback function receiving the newly selected category ID
 */
export function handleCategoryKeydown(event, tabElements, currentIndex, onSelectCategory) {
  if (!tabElements || tabElements.length === 0 || currentIndex < 0) {
    return;
  }

  const count = tabElements.length;

  // Arrow Right: cyclic move to next
  if (event.key === "ArrowRight") {
    event.preventDefault();
    const nextIndex = (currentIndex + 1) % count;
    focusAndActivateTab(tabElements, nextIndex, onSelectCategory);
    return;
  }

  // Arrow Left: cyclic move to previous
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    const prevIndex = (currentIndex - 1 + count) % count;
    focusAndActivateTab(tabElements, prevIndex, onSelectCategory);
    return;
  }

  // Tab (Forward)
  if (event.key === "Tab" && !event.shiftKey) {
    if (currentIndex < count - 1) {
      // Not on the last tab: advance to next tab and activate it
      event.preventDefault();
      focusAndActivateTab(tabElements, currentIndex + 1, onSelectCategory);
    }
    // If on the last tab: do NOT preventDefault(); let focus move out naturally
    return;
  }

  // Shift + Tab (Backward)
  if (event.key === "Tab" && event.shiftKey) {
    if (currentIndex > 0) {
      // Not on the first tab: move to previous tab and activate it
      event.preventDefault();
      focusAndActivateTab(tabElements, currentIndex - 1, onSelectCategory);
    }
    // If on the first tab: do NOT preventDefault(); let focus move out backwards
    return;
  }
}

function focusAndActivateTab(tabElements, index, onSelectCategory) {
  const targetTab = tabElements[index];
  if (!targetTab) return;
  targetTab.focus();
  const catId = targetTab.dataset.categoryId;
  if (catId && onSelectCategory) {
    onSelectCategory(catId);
  }
}

/**
 * Modal focus trap utility
 * @param {HTMLElement} modalEl
 * @param {KeyboardEvent} event
 * @param {Function} onClose
 */
export function handleModalKeydown(modalEl, event, onClose) {
  if (event.key === "Escape") {
    event.preventDefault();
    if (onClose) onClose();
    return;
  }

  if (event.key === "Tab") {
    const focusable = modalEl.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
}
