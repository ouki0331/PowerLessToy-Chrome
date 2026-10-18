import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleCategoryKeydown } from "../src/newtab/keyboard.js";

function createMockTab(id) {
  let isFocused = false;
  return {
    dataset: { categoryId: id },
    focus: () => {
      isFocused = true;
    },
    get focused() {
      return isFocused;
    }
  };
}

function createMockEvent(key, shiftKey = false) {
  let prevented = false;
  return {
    key,
    shiftKey,
    preventDefault: () => {
      prevented = true;
    },
    get isDefaultPrevented() {
      return prevented;
    }
  };
}

describe("Bookmark Organizer - DEC-003 Category Keyboard Navigation", () => {
  it("ArrowRight cyclically advances to the next category tab", () => {
    const tabs = [createMockTab("cat1"), createMockTab("cat2"), createMockTab("cat3")];
    let selectedId = null;

    // From index 0 -> 1
    const evt1 = createMockEvent("ArrowRight");
    handleCategoryKeydown(evt1, tabs, 0, (id) => {
      selectedId = id;
    });
    assert.equal(evt1.isDefaultPrevented, true);
    assert.equal(selectedId, "cat2");
    assert.equal(tabs[1].focused, true);

    // From index 2 -> 0 (cyclic wrap)
    const evt2 = createMockEvent("ArrowRight");
    handleCategoryKeydown(evt2, tabs, 2, (id) => {
      selectedId = id;
    });
    assert.equal(evt2.isDefaultPrevented, true);
    assert.equal(selectedId, "cat1");
    assert.equal(tabs[0].focused, true);
  });

  it("ArrowLeft cyclically steps to the previous category tab", () => {
    const tabs = [createMockTab("cat1"), createMockTab("cat2"), createMockTab("cat3")];
    let selectedId = null;

    // From index 1 -> 0
    const evt1 = createMockEvent("ArrowLeft");
    handleCategoryKeydown(evt1, tabs, 1, (id) => {
      selectedId = id;
    });
    assert.equal(evt1.isDefaultPrevented, true);
    assert.equal(selectedId, "cat1");
    assert.equal(tabs[0].focused, true);

    // From index 0 -> 2 (cyclic wrap backward)
    const evt2 = createMockEvent("ArrowLeft");
    handleCategoryKeydown(evt2, tabs, 0, (id) => {
      selectedId = id;
    });
    assert.equal(evt2.isDefaultPrevented, true);
    assert.equal(selectedId, "cat3");
    assert.equal(tabs[2].focused, true);
  });

  it("Tab advances category when not on the last tab (DEC-003)", () => {
    const tabs = [createMockTab("cat1"), createMockTab("cat2"), createMockTab("cat3")];
    let selectedId = null;

    const evt = createMockEvent("Tab", false);
    handleCategoryKeydown(evt, tabs, 0, (id) => {
      selectedId = id;
    });
    assert.equal(evt.isDefaultPrevented, true);
    assert.equal(selectedId, "cat2");
    assert.equal(tabs[1].focused, true);
  });

  it("Tab does NOT intercept on the last tab to prevent keyboard trap (DEC-003)", () => {
    const tabs = [createMockTab("cat1"), createMockTab("cat2"), createMockTab("cat3")];
    let selectedId = null;

    const evt = createMockEvent("Tab", false);
    handleCategoryKeydown(evt, tabs, 2, (id) => {
      selectedId = id;
    });
    // Crucial requirement: default is NOT prevented, allowing Tab to move to next page element
    assert.equal(evt.isDefaultPrevented, false);
    assert.equal(selectedId, null);
  });

  it("Shift+Tab moves backward when not on the first tab", () => {
    const tabs = [createMockTab("cat1"), createMockTab("cat2"), createMockTab("cat3")];
    let selectedId = null;

    const evt = createMockEvent("Tab", true);
    handleCategoryKeydown(evt, tabs, 2, (id) => {
      selectedId = id;
    });
    assert.equal(evt.isDefaultPrevented, true);
    assert.equal(selectedId, "cat2");
    assert.equal(tabs[1].focused, true);
  });

  it("Shift+Tab does NOT intercept on the first tab to prevent keyboard trap", () => {
    const tabs = [createMockTab("cat1"), createMockTab("cat2"), createMockTab("cat3")];
    let selectedId = null;

    const evt = createMockEvent("Tab", true);
    handleCategoryKeydown(evt, tabs, 0, (id) => {
      selectedId = id;
    });
    // Crucial requirement: default is NOT prevented, allowing Shift+Tab to move backwards out of tablist
    assert.equal(evt.isDefaultPrevented, false);
    assert.equal(selectedId, null);
  });
});
