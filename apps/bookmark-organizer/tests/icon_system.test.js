import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, "..");

describe("Bookmark Organizer - Quiet Glyph Apple-style Icon System", async () => {
  const iconsPath = path.join(appDir, "src", "newtab", "icons.js");
  const cssPath = path.join(appDir, "src", "newtab", "style.css");
  const htmlPath = path.join(appDir, "src", "newtab", "index.html");

  const iconsModule = await import(`file://${iconsPath}`);
  const { SVG_ICONS } = iconsModule;
  const cssContent = fs.readFileSync(cssPath, "utf-8");
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");

  it("exports SVG_ICONS with all required Quiet Glyph icon keys", () => {
    const requiredKeys = [
      "bookmark",
      "manage",
      "settings",
      "import",
      "export",
      "globe",
      "edit",
      "trash",
      "circlePlus",
      "plus",
      "addLink",
      "checkCircle",
      "undo",
      "retry",
      "close",
      "chevronDown",
      "themeSystem",
      "themeLight",
      "themeDark",
      "themeAuto",
      "wallpaper",
      "dockCenter",
      "sourceRandom",
      "sourceMyImages",
      "heart",
      "heartFilled",
      "next",
      "lock",
      "unlock",
      "infoCircle",
      "categoryGrid",
      "frequencyClock",
      "upload",
      "externalLink",
      "sortMostUsed",
      "sortRecentlyUsed",
      "sortCreatedAt",
      "dragHandle",
      "folder"
    ];

    for (const key of requiredKeys) {
      assert.ok(SVG_ICONS[key], `Missing required icon definition for: ${key}`);
      assert.ok(typeof SVG_ICONS[key] === "string", `Icon ${key} must be an SVG string`);
    }
  });

  it("all SVG_ICONS have standard 24x24 viewBox and rounded caps/joins", () => {
    for (const [key, svg] of Object.entries(SVG_ICONS)) {
      assert.match(svg, /viewBox="0 0 24 24"/, `Icon ${key} must use viewBox="0 0 24 24"`);
      assert.match(svg, /stroke-linecap="round"/, `Icon ${key} must use stroke-linecap="round"`);
      assert.match(svg, /stroke-linejoin="round"/, `Icon ${key} must use stroke-linejoin="round"`);
      assert.match(svg, /<svg[\s\S]*<\/svg>/, `Icon ${key} must be valid closing SVG`);
    }
  });

  it("dock icons use distinct glyphs for dock trigger, settings, and sources", () => {
    // Dock trigger must be dockCenter (mountain landscape), distinct from sourceRandom
    assert.notEqual(
      SVG_ICONS.dockCenter,
      SVG_ICONS.sourceRandom,
      "Dock center trigger must not reuse shuffle/random icon"
    );
    // Settings icon must be a gear (cog), distinct from manage (sliders)
    assert.notEqual(
      SVG_ICONS.settings,
      SVG_ICONS.manage,
      "Background settings must not reuse content manage sliders icon"
    );
    // Settings should contain circle and cog teeth paths/elements
    assert.match(SVG_ICONS.settings, /circle/, "Settings gear must include center circle");
    // Sources must be distinct
    assert.notEqual(
      SVG_ICONS.sourceRandom,
      SVG_ICONS.sourceMyImages,
      "Random and My Images sources must use distinct icons"
    );
    // My images must feature stacked photo geometry (rects or rect + line)
    assert.match(SVG_ICONS.sourceMyImages, /rect/, "My Images icon must include photo rectangles");
    // Next / skip forward must include line and polygon/triangle
    assert.match(SVG_ICONS.next, /polygon/, "Next icon must include forward triangle");
    assert.match(SVG_ICONS.next, /line/, "Next icon must include right-hand end bar");
    // Favorite empty vs filled
    assert.notEqual(SVG_ICONS.heart, SVG_ICONS.heartFilled, "Heart outline and filled must be distinct");
    assert.match(SVG_ICONS.heartFilled, /fill="currentColor"/, "Heart filled must use fill currentColor");
    // Lock vs unlock
    assert.notEqual(SVG_ICONS.lock, SVG_ICONS.unlock, "Locked and unlocked padlocks must be distinct");
  });

  it("sorting icons are visually distinguishable at 14px", () => {
    // sortMostUsed should feature vertical bars
    assert.match(SVG_ICONS.sortMostUsed, /line x1="18"|line x1="12"|line x1="6"/, "sortMostUsed must have high-low bar geometry");
    // sortRecentlyUsed must feature counter-clockwise/rewind arrow around clock
    assert.notEqual(
      SVG_ICONS.sortRecentlyUsed,
      SVG_ICONS.frequencyClock,
      "sortRecentlyUsed must not reuse standard frequency clock"
    );
    assert.match(SVG_ICONS.sortRecentlyUsed, /polyline points="3 3 3 8 8 8"/, "sortRecentlyUsed must include rewind arrow");
    // sortCreatedAt should feature a calendar sheet
    assert.match(SVG_ICONS.sortCreatedAt, /rect x="3" y="4"/, "sortCreatedAt must feature calendar sheet");
  });

  it("themeAuto features half-sun / half-moon with clock hands", () => {
    const autoIcon = SVG_ICONS.themeAuto;
    // Circular hemisphere and divider
    assert.match(autoIcon, /<path d="M12 2a10 10 0 0 0 0 20">/, "themeAuto must feature circular celestial body");
    // Clock hands
    assert.match(autoIcon, /polyline points="12 8 12 12 15 13.5"/, "themeAuto must feature clock hands");
  });

  it("css enforces Quiet Glyph dimension tiers and minimum 28px click areas", () => {
    // Base .ui-icon must be 16x16px
    assert.match(cssContent, /\.ui-icon\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/);
    // Compact tier must be 14x14px
    assert.match(cssContent, /\.ui-icon-compact[^}]*width:\s*14px;[^}]*height:\s*14px;/);
    // Brand icon must be 18x18px
    assert.match(cssContent, /\.brand-icon \.ui-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/);
    // Click area for compact/icon buttons must be at least 28x28px
    assert.match(cssContent, /\.cat-sort-btn\s*\{[^}]*min-width:\s*28px;[^}]*min-height:\s*28px;/);
    assert.match(cssContent, /\.drag-handle-btn\s*\{[^}]*min-width:\s*28px;[^}]*min-height:\s*28px;/);
    assert.match(cssContent, /\.link-expand-btn\s*\{[^}]*min-width:\s*28px;[^}]*min-height:\s*28px;/);
    assert.match(cssContent, /\.btn-icon\s*\{[^}]*min-width:\s*28px;[^}]*min-height:\s*28px;/);
    // Drag handle color #FF9F0A
    assert.match(cssContent, /\.drag-handle-btn\s*\{[^}]*color:\s*#FF9F0A;/);
    // Disabled styling
    assert.match(cssContent, /opacity:\s*0\.55\s*!important/);
    assert.match(cssContent, /pointer-events:\s*none\s*!important/);
  });

  it("index.html contains no raw text close characters and retains icon slots", () => {
    // Check that close buttons in HTML do not use raw '✕'
    assert.ok(!htmlContent.includes("✕"), "index.html must not use raw text character '✕'");
    // Check for icon slots in header buttons
    assert.match(htmlContent, /id="themeBtnIcon"\s+class="icon-slot"/);
    assert.match(htmlContent, /id="bgHeaderBtnIcon"\s+class="icon-slot"/);
    assert.match(htmlContent, /id="importBtnIcon"\s+class="icon-slot"/);
    assert.match(htmlContent, /id="exportBtnIcon"\s+class="icon-slot"/);
    assert.match(htmlContent, /id="langBtnIcon"\s+class="icon-slot"/);
    assert.match(htmlContent, /id="manageBtnIcon"\s+class="icon-slot"/);
  });
});
