/**
 * Unit & Integration Tests: Quick Capture Group Combobox Fix (v0.4.0)
 *
 * Requirements:
 * 1. On focus / click with formatted value "Group Name (Tab Name)", does NOT filter to 0.
 * 2. Tokens with parentheses are sanitized so "Work (Dev)" matches both group and category.
 * 3. Recent usage ordering prioritizes lastUsedAt and usageCount.
 * 4. Empty group state handled cleanly without crashing or spoofing default tabs as groups.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterGroupsForCombobox } from "../src/newtab/storage.js";

describe("BMK-CAPTURE-001: Group Combobox Search & Pre-requisite Defect Fix", () => {
  const sampleData = {
    categories: [
      { id: "cat-dev", name: "Dev Tools" },
      { id: "cat-prod", name: "Production Portals" }
    ],
    groups: [
      { id: "grp-ci", categoryId: "cat-dev", name: "CI/CD Pipelines", lastUsedAt: 1000, usageCount: 2 },
      { id: "grp-logs", categoryId: "cat-dev", name: "Log Aggregators", lastUsedAt: 5000, usageCount: 10 },
      { id: "grp-db", categoryId: "cat-prod", name: "Database Consoles", lastUsedAt: 3000, usageCount: 5 }
    ],
    links: [
      { id: "l1", groupId: "grp-ci", name: "GitHub Actions", url: "https://github.com/actions" },
      { id: "l2", groupId: "grp-logs", name: "Datadog Logs", url: "https://app.datadoghq.com/logs" },
      { id: "l3", groupId: "grp-db", name: "Cloud SQL", url: "https://console.cloud.google.com/sql" }
    ]
  };

  const metrics = new Map([
    ["grp-logs", { lastUsedAt: 9000, usageCount: 20 }],
    ["grp-db", { lastUsedAt: 4000, usageCount: 8 }]
  ]);

  it("empty query returns all groups sorted by recent usage", () => {
    const res = filterGroupsForCombobox(sampleData, "", metrics);
    assert.equal(res.length, 3);
    assert.equal(res[0].id, "grp-logs", "Most recently used group should be first");
    assert.equal(res[1].id, "grp-db");
    assert.equal(res[2].id, "grp-ci");
    assert.equal(res[0].categoryName, "Dev Tools");
    assert.equal(res[0].linkCount, 1);
  });

  it("formatted combobox value 'Log Aggregators (Dev Tools)' matches cleanly instead of returning 0", () => {
    // When input text contains parenthesis formatting from previous selection
    const formattedQuery = "Log Aggregators (Dev Tools)";
    const res = filterGroupsForCombobox(sampleData, formattedQuery, metrics);

    assert.ok(res.length >= 1, "Must match group despite parentheses");
    assert.equal(res[0].id, "grp-logs");
  });

  it("matches across link title and hostname inside the group", () => {
    const matchByTitle = filterGroupsForCombobox(sampleData, "datadog", metrics);
    assert.equal(matchByTitle.length, 1);
    assert.equal(matchByTitle[0].id, "grp-logs");

    const matchByHost = filterGroupsForCombobox(sampleData, "datadoghq.com", metrics);
    assert.equal(matchByHost.length, 1);
    assert.equal(matchByHost[0].id, "grp-logs");
  });

  it("handles empty groups dataset without throwing or fabricating groups from categories", () => {
    const emptyData = {
      categories: [{ id: "cat-1", name: "Default Tab" }],
      groups: [],
      links: []
    };

    const res = filterGroupsForCombobox(emptyData, "", metrics);
    assert.equal(res.length, 0);

    // Categories are NOT groups
    const resWithTabName = filterGroupsForCombobox(emptyData, "Default Tab", metrics);
    assert.equal(resWithTabName.length, 0, "Must never return categories as fake groups");
  });

  it("handles null or malformed data gracefully", () => {
    assert.deepEqual(filterGroupsForCombobox(null, ""), []);
    assert.deepEqual(filterGroupsForCombobox({}, ""), []);
    assert.deepEqual(filterGroupsForCombobox({ groups: "not-an-array" }, ""), []);
  });
});
