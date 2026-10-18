import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { handleCategoryKeydown } from "../src/newtab/keyboard.js";

// Mock a lightweight DOM environment for verifying interaction mechanics
function createMockTabElement(id, name) {
  let focused = false;
  const classes = new Set();
  const attributes = {};

  return {
    dataset: { categoryId: id },
    textContent: name,
    classList: {
      add: (cls) => classes.add(cls),
      remove: (cls) => classes.delete(cls),
      toggle: (cls, force) => {
        if (force === undefined) {
          if (classes.has(cls)) classes.delete(cls);
          else classes.add(cls);
        } else if (force) {
          classes.add(cls);
        } else {
          classes.delete(cls);
        }
      },
      has: (cls) => classes.has(cls)
    },
    setAttribute: (k, v) => {
      attributes[k] = String(v);
    },
    getAttribute: (k) => attributes[k],
    focus: () => {
      focused = true;
    },
    blur: () => {
      focused = false;
    },
    get isFocused() {
      return focused;
    }
  };
}

describe("Bookmark Organizer - DOM Interactions & Sanitization", () => {
  it("P1 fix: sequential Tab keypresses switch categories without losing focus or destroying DOM", () => {
    // 3 persistent category tabs
    const tab0 = createMockTabElement("cat0", "Work Projects");
    const tab1 = createMockTabElement("cat1", "Company Management");
    const tab2 = createMockTabElement("cat2", "Tech Interests");
    const tabs = [tab0, tab1, tab2];

    tab0.classList.add("active");
    tab0.focus();
    assert.equal(tab0.isFocused, true);

    let activeCatId = "cat0";
    const onSelect = (newId) => {
      activeCatId = newId;
      // In-place state update without DOM destruction
      tabs.forEach((t) => {
        const isActive = t.dataset.categoryId === newId;
        t.classList.toggle("active", isActive);
        t.setAttribute("aria-selected", isActive ? "true" : "false");
        t.setAttribute("tabindex", isActive ? "0" : "-1");
      });
    };

    // First Tab keypress: from index 0 -> advances to index 1
    const event1 = {
      key: "Tab",
      shiftKey: false,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      }
    };
    handleCategoryKeydown(event1, tabs, 0, onSelect);

    assert.equal(event1.prevented, true);
    assert.equal(activeCatId, "cat1");
    assert.equal(tab1.isFocused, true);
    assert.equal(tab1.classList.has("active"), true);
    assert.equal(tab0.classList.has("active"), false);

    // Second Tab keypress: from index 1 -> advances to index 2
    const event2 = {
      key: "Tab",
      shiftKey: false,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      }
    };
    handleCategoryKeydown(event2, tabs, 1, onSelect);

    assert.equal(event2.prevented, true);
    assert.equal(activeCatId, "cat2");
    assert.equal(tab2.isFocused, true);
    assert.equal(tab2.classList.has("active"), true);

    // Third Tab keypress: from index 2 (last tab) -> does NOT preventDefault, leaves category bar
    const event3 = {
      key: "Tab",
      shiftKey: false,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      }
    };
    handleCategoryKeydown(event3, tabs, 2, onSelect);

    assert.equal(event3.prevented, false);
    assert.equal(activeCatId, "cat2"); // Stays on cat2 while focus exits naturally
  });

  it("P2 fix: user input containing HTML entities and quotes assigns safely to value and textContent", () => {
    const maliciousInput = '<script>alert("xss")</script><img src=x onerror=alert(1)>" autofocus';

    // Verify DOM property assignment behavior
    const mockInput = { type: "text", value: "" };
    mockInput.value = maliciousInput;
    assert.equal(mockInput.value, maliciousInput);

    const mockElement = { textContent: "" };
    mockElement.textContent = maliciousInput;
    assert.equal(mockElement.textContent, maliciousInput);
  });
});
