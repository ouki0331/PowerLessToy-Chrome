import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  loadWorkbenchData,
  setActiveCategory,
  addGroup,
  addLink,
  deleteGroup,
  _resetMemoryStore
} from "../src/newtab/storage.js";

describe("Bookmark Organizer - End-to-End User Story Workflow", () => {
  beforeEach(() => {
    _resetMemoryStore();
  });

  it("completes the core user journey: Seed -> Add Project -> Asymmetric Envs -> Switch Category -> Verify", async () => {
    // 1. First run initialization
    const data = await loadWorkbenchData();
    assert.equal(data.isFirstRun, true);
    assert.equal(data.categories.length, 3);
    const workCat = data.categories[0];
    assert.equal(workCat.name, "Work Projects");

    // 2. User creates a project group "Order Platform" in "Work Projects"
    const orderGroup = await addGroup(data, workCat.id, "Order Platform");
    assert.equal(orderGroup.name, "Order Platform");

    // 3. User adds Local, Test, and Prod links (intentionally missing Dev - asymmetric environment)
    await addLink(data, orderGroup.id, {
      name: "Local Web",
      url: "http://localhost:3000",
      badge: "Local"
    });
    await addLink(data, orderGroup.id, {
      name: "QA Staging",
      url: "https://qa.orders.example.com",
      badge: "Test"
    });
    await addLink(data, orderGroup.id, {
      name: "Production Cluster",
      url: "https://orders.example.com",
      badge: "Prod"
    });

    // Verify 3 links exist in Order Platform, no Dev slot
    const orderLinks = data.links.filter((l) => l.groupId === orderGroup.id);
    assert.equal(orderLinks.length, 3);
    assert.deepEqual(
      orderLinks.map((l) => l.badge),
      ["Local", "Test", "Prod"]
    );

    // 4. User switches to "Company Management" category
    const companyCat = data.categories[1];
    await setActiveCategory(data, companyCat.id);
    assert.equal(data.activeCategoryId, companyCat.id);

    // 5. In "Company Management", user adds "Internal Tools" group with GitHub & Attendance
    const toolsGroup = await addGroup(data, companyCat.id, "Internal Tools");
    await addLink(data, toolsGroup.id, {
      name: "Company GitHub",
      url: "https://github.com/my-org"
    });
    await addLink(data, toolsGroup.id, {
      name: "HR & Attendance Portal",
      url: "https://hr.example.com/attendance"
    });

    // 6. User reloads workbench (simulating new tab open)
    const reloaded = await loadWorkbenchData();
    assert.equal(reloaded.activeCategoryId, companyCat.id); // Remembered active category!

    // Verify Company Management links
    const compLinks = reloaded.links.filter((l) => l.groupId === toolsGroup.id);
    assert.equal(compLinks.length, 2);

    // Verify Work Projects data intact
    const reloadedOrderLinks = reloaded.links.filter((l) => l.groupId === orderGroup.id);
    assert.equal(reloadedOrderLinks.length, 3);
  });
});
