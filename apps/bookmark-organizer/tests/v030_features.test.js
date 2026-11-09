import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanTrackingUrl,
  normalizeComparableUrl,
  findDuplicateLink,
  filterGroupsForCombobox,
  loadWorkbenchData,
  addLink
} from "../src/newtab/storage.js";

import {
  generateSelectiveBackupJson,
  generateNetscapeBookmarkHtml,
  getSelectiveBackupFilename,
  normalizeTagForHtml
} from "../src/newtab/import-export.js";

import { SVG_ICONS } from "../src/newtab/icons.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");

describe("Bookmark Organizer v0.3.0 Capabilities", () => {
  const sampleData = {
    schemaVersion: 1,
    activeCategoryId: "cat-work",
    categories: [
      { id: "cat-work", name: "Work & Projects", sortOrder: 0, revision: 1 },
      { id: "cat-tools", name: "Dev Tools", sortOrder: 1, revision: 1 },
      { id: "cat-infra", name: "Cloud & Infra", sortOrder: 2, revision: 1 }
    ],
    groups: [
      { id: "grp-alpha", categoryId: "cat-work", name: "Alpha Service", sortOrder: 0, revision: 1 },
      { id: "grp-beta", categoryId: "cat-work", name: "Beta App", sortOrder: 1, revision: 1 },
      { id: "grp-tools", categoryId: "cat-tools", name: "Utilities", sortOrder: 0, revision: 1 }
    ],
    links: [
      {
        id: "lnk-1",
        groupId: "grp-alpha",
        name: "Alpha Dashboard",
        url: "https://alpha.example.com/dash",
        badge: "PROD",
        pinned: true,
        pinnedOrder: 0,
        hidden: false,
        revision: 1
      },
      {
        id: "lnk-2",
        groupId: "grp-alpha",
        name: "Alpha Staging",
        url: "https://staging.alpha.example.com/",
        badge: "TEST",
        pinned: false,
        hidden: false,
        revision: 1
      },
      {
        id: "lnk-3",
        groupId: "grp-beta",
        name: "Beta Console",
        url: "https://beta.example.com/console",
        badge: "DEV",
        pinned: false,
        hidden: true,
        revision: 1
      },
      {
        id: "lnk-4",
        groupId: "grp-tools",
        name: "Log Viewer",
        url: "https://logs.example.com/",
        badge: "PROD | EU",
        pinned: false,
        hidden: false,
        revision: 1
      }
    ]
  };

  describe("CMD-SEARCH-001 & Popup Manifest / Action Integration", () => {
    it("manifest.json defines 0.3.1, activeTab/scripting permission, and open-bookmark-search shortcut", () => {
      const manifestPath = path.join(appDir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      assert.equal(manifest.version, "0.3.1");
      assert.ok(manifest.permissions.includes("storage"));
      assert.ok(manifest.permissions.includes("activeTab"));
      assert.ok(manifest.permissions.includes("scripting"));
      assert.ok(!manifest.permissions.includes("<all_urls>"), "Must never request <all_urls>");

      assert.ok(manifest.commands);
      assert.ok(manifest.commands["open-bookmark-search"]);
      assert.equal(manifest.commands["open-bookmark-search"].suggested_key.default, "Ctrl+Shift+K");
      assert.equal(manifest.commands["open-bookmark-search"].suggested_key.mac, "Command+Shift+K");
      assert.ok(!manifest.commands._execute_action, "Must not duplicate with _execute_action");
    });

    it("popup index.html defines both Command Mode and Bookmark Mode with autofocus input", () => {
      const htmlPath = path.join(appDir, "src", "popup", "index.html");
      const html = fs.readFileSync(htmlPath, "utf-8");

      assert.match(html, /id="modeCmdBtn"/);
      assert.match(html, /id="modeBmkBtn"/);
      assert.match(html, /id="paletteInput"/);
      assert.match(html, /autofocus/);
      assert.match(html, /id="quickCaptureView"/);
      assert.match(html, /id="captureRestrictedNotice"/);
    });

    it("popup.js includes commands for Capture, Workbench, Search, Toggle Private, Import, Export", () => {
      const jsPath = path.join(appDir, "src", "popup", "popup.js");
      const js = fs.readFileSync(jsPath, "utf-8");

      assert.match(js, /cmdCaptureTitle/);
      assert.match(js, /cmdWorkbenchTitle/);
      assert.match(js, /cmdSearchTitle/);
      assert.match(js, /cmdTogglePrivateDesc/);
      assert.match(js, /cmdImportTitle/);
      assert.match(js, /cmdExportTitle/);
    });
  });

  describe("BMK-CAPTURE-001: URL Cleaning, Combobox & Duplicate Detection", () => {
    it("strips common marketing and tracking query parameters while preserving functional parameters and hash", () => {
      const raw =
        "https://example.com/product/view?id=42&utm_source=google&utm_medium=cpc&utm_campaign=winter&gclid=abc123xyz&fbclid=fb_456&ref=blog#section-reviews";
      const cleaned = cleanTrackingUrl(raw);

      assert.equal(
        cleaned,
        "https://example.com/product/view?id=42&ref=blog#section-reviews",
        "Tracking params must be stripped while functional query params (id, ref) and hash are preserved"
      );
    });

    it("normalizes URLs for reliable duplicate matching across trailing slashes and tracking noise", () => {
      const url1 = "https://example.com/app/?utm_source=newsletter";
      const url2 = "https://example.com/app";

      assert.equal(normalizeComparableUrl(url1), normalizeComparableUrl(url2));
    });

    it("findDuplicateLink accurately locates existing bookmark and its breadcrumbs", () => {
      const dup = findDuplicateLink(sampleData, "https://alpha.example.com/dash?utm_medium=email");
      assert.ok(dup, "Duplicate must be detected despite extra tracking parameters");
      assert.equal(dup.link.id, "lnk-1");
      assert.equal(dup.categoryName, "Work & Projects");
      assert.equal(dup.groupName, "Alpha Service");

      const noDup = findDuplicateLink(sampleData, "https://brandnew.example.com/");
      assert.equal(noDup, null);
    });

    it("filterGroupsForCombobox prioritizes recent usage and matches across Tab, Group name, and links", () => {
      const metrics = new Map([["grp-beta", { usageCount: 15, lastUsedAt: Date.now() }]]);
      const res = filterGroupsForCombobox(sampleData, "", metrics);

      assert.equal(res[0].id, "grp-beta", "Most recently used group must appear first");

      const matchByTab = filterGroupsForCombobox(sampleData, "Dev Tools", metrics);
      assert.ok(matchByTab.some((g) => g.id === "grp-tools"));

      const matchByLink = filterGroupsForCombobox(sampleData, "Log Viewer", metrics);
      assert.ok(matchByLink.some((g) => g.id === "grp-tools"));
    });
  });

  describe("UI-ACTION-001: Header Consolidation & Appearance Dock", () => {
    it("main newtab header contains only 3 permanent actions: Search, Add Group, and More Menu", () => {
      const htmlPath = path.join(appDir, "src", "newtab", "index.html");
      const html = fs.readFileSync(htmlPath, "utf-8");

      assert.match(html, /id="openSearchBtn"/);
      assert.match(html, /id="headerAddGroupBtn"/);
      assert.match(html, /id="moreMenuBtn"/);

      // Verify Theme and Background are removed from header-actions
      const headerSection = html.slice(html.indexOf('<div class="header-actions">'), html.indexOf("</header>"));
      assert.doesNotMatch(headerSection, /id="themeToggleBtn"/);
      assert.doesNotMatch(headerSection, /id="bgHeaderBtn"/);
    });

    it("Appearance Dock contains Theme, Source, Fav, Next, Lock, Frequency, Opacity, and Info buttons", () => {
      const htmlPath = path.join(appDir, "src", "newtab", "index.html");
      const html = fs.readFileSync(htmlPath, "utf-8");

      assert.match(html, /id="dockThemeBtn"/);
      assert.match(html, /id="bgSourceBtn"/);
      assert.match(html, /id="bgFavBtn"/);
      assert.match(html, /id="bgNextBtn"/);
      assert.match(html, /id="bgLockBtn"/);
      assert.match(html, /id="bgFreqBtn"/);
      assert.match(html, /id="bgOpacityBtn"/);
      assert.match(html, /id="bgInfoBtn"/);
      assert.match(html, /id="bgDockTrigger"/);
    });
  });

  describe("DATA-EXPORT-002: Selective Tab Export (JSON & Netscape HTML)", () => {
    it("normalizes badges for Netscape HTML format: trims, uppercase, pipes to spaces", () => {
      assert.equal(normalizeTagForHtml("  prod | eu  "), "PROD EU");
      assert.equal(normalizeTagForHtml("local"), "LOCAL");
      assert.equal(normalizeTagForHtml(""), "");
    });

    it("generateSelectiveBackupJson exports only selected tabs and their groups/links with formatVersion 1", () => {
      const exported = generateSelectiveBackupJson(sampleData, ["cat-tools"], { includeHidden: true });

      assert.equal(exported.formatVersion, 1);
      assert.equal(exported.categories.length, 1);
      assert.equal(exported.categories[0].id, "cat-tools");
      assert.equal(exported.groups.length, 1);
      assert.equal(exported.groups[0].id, "grp-tools");
      assert.equal(exported.links.length, 1);
      assert.equal(exported.links[0].id, "lnk-4");
    });

    it("generateSelectiveBackupJson respects includeHidden flag", () => {
      const withHidden = generateSelectiveBackupJson(sampleData, ["cat-work"], { includeHidden: true });
      assert.ok(withHidden.links.some((l) => l.hidden === true));

      const withoutHidden = generateSelectiveBackupJson(sampleData, ["cat-work"], { includeHidden: false });
      assert.ok(!withoutHidden.links.some((l) => l.hidden === true));
    });

    it("generateNetscapeBookmarkHtml exports valid DL/DT bookmarks tree with TAG | Title format and escaped HTML", () => {
      const html = generateNetscapeBookmarkHtml(sampleData, ["cat-work", "cat-tools"], { includeHidden: false });

      assert.match(html, /<!DOCTYPE NETSCAPE-Bookmark-file-1>/);
      assert.match(html, /<H1>Bookmarks<\/H1>/);
      assert.match(html, /PowerLessToy Export/);
      assert.match(html, /<H3[^>]*>Work &amp; Projects<\/H3>/);
      assert.match(html, /<H3[^>]*>Alpha Service<\/H3>/);
      assert.match(html, /PROD \| Alpha Dashboard/);
      assert.doesNotMatch(html, /Beta Console/, "Hidden bookmarks must be excluded by default");
    });

    it("getSelectiveBackupFilename generates meaningful filenames for single and multi-tab exports", () => {
      const fixedDate = new Date("2026-10-25T14:30:00Z");
      const singleName = getSelectiveBackupFilename({
        format: "json",
        selectedCategoryNames: ["Work & Projects"],
        date: fixedDate
      });
      assert.match(singleName, /^powerless-toy-bookmarks-.*-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);

      const htmlName = getSelectiveBackupFilename({
        format: "html",
        selectedCategoryNames: ["Work", "Personal"],
        date: fixedDate
      });
      assert.match(htmlName, /^powerless-toy-bookmarks-\d{4}-\d{2}-\d{2}-\d{4}\.html$/);
    });
  });
});
