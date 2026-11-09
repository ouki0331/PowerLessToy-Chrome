# Bookmark Organizer

Organize, categorize, and access work projects and environment links directly on Chrome's New Tab page.

## Status

Version 1.1 with advanced Data Safety, Optimistic Concurrency Control, and Safe JSON Import/Export is implemented and verified.

Product Specification: [`docs/product/bookmark-organizer.md`](../../docs/product/bookmark-organizer.md)

UI/UX Design Guidelines: [`docs/product/bookmark-organizer-ui.md`](../../docs/product/bookmark-organizer-ui.md)

Visual Enhancements & Firefox Specification: [`docs/product/bookmark-organizer-enhancements.md`](../../docs/product/bookmark-organizer-enhancements.md)

## Implemented Scope

- **New Tab Workbench**: Overrides Chrome's New Tab with a quiet, responsive workbench panel.
- **Hierarchical Structure**: Category -> Project/Topic Group -> Environment Link.
- **Initial Seed**: 3 default categories on first launch (Work Projects, Company Management, Tech Interests).
- **Full CRUD Operations**: Create, rename, edit, and cascade delete with impact warnings.
- **Dual Open Behavior**: Standard click navigates in current tab; `Ctrl/Cmd+Click` opens in a background new tab.
- **Accessible Keyboard Navigation (`DEC-003`)**: Tab/Shift+Tab boundary detection to avoid keyboard traps; Arrow key cyclical category navigation without DOM reconstruction or focus loss.
- **Primary Storage (IndexedDB)**:
  - Six dedicated object stores: `categories`, `groups`, `links`, `importJobs`, `snapshots`, and `metadata`.
  - Seamless zero-loss migration from legacy `chrome.storage.local` with strict structural validation (`CORRUPTED_LEGACY_DATA` guard), count verification, and authoritative state recorded in IndexedDB `metadata` (never overwrites non-empty IndexedDB if local storage flags are cleared).
  - Multi-tab real-time sync using `BroadcastChannel` (`powerless_toy_bookmark_organizer_db_v1`) for committed IndexedDB transactions alongside `chrome.storage.onChanged` and `window.storage`.
- **Optimistic Concurrency Control (`revision`)**:
  - Incremental `revision` counter on all entities.
  - Compares `expectedRevision` before write; returns `CONFLICT` on stale writes with user reload prompt.
- **Zero-Loss JSON Import/Export (`DATA-IMPORT-001`)**:
  - **Append/Merge Only**: Never replaces or wipes existing workbench data.
  - **Canonical Flat Schema (`formatVersion: 1`)**: Uses top-level `categories`, `groups`, and `links` arrays with referential integrity validation (`categoryId`, `groupId`) and explicit rejection of nested structures.
  - **SHA-256 Fingerprinting**: Detects and warns on identical duplicate file imports.
  - **Interactive Preview & Conflict Resolution**: Shared deterministic `planImport()` planner across preview and execution; uses stable `links[i]` keys so "Keep existing" and "Keep both" work reliably even when imported links omit an `id`.
  - **Pre-Import Snapshot & Atomic Transactions**: Full snapshot captured prior to execution; mid-process failures roll back completely.
  - **Ownership-Checked Undo & Snapshot Restore**: Verifies imported items remain at `revision === 1` and have no user-added child groups/links before deleting; if modified or extended, blocks unsafe deletion (`UNDO_BLOCKED`) and offers explicit pre-import snapshot restoration.
  - **Standard Backup Export**: Reads fresh state directly from IndexedDB to produce a timestamped JSON backup file that round-trips cleanly.
- **Expandable Link Details (`VIEW-LINK-001`)**:
  - Independent expand/collapse toggle per link while maintaining standard navigation on title click (`OPEN-LINK-001`).
  - Default all collapsed; expands to show website icon, hostname, full URL (word-break safe), and environment badge.
  - At most one expanded link per group, with independent expansion across groups.
  - Strictly on-demand favicon loading from the site's origin (zero 3rd-party aggregators), with fallback domain initial placeholder.
  - In-memory session state only (not persisted or leaked).
- **Manual and System Themes (`VIEW-THEME-001`)**:
  - Supports 4 modes: `system` (default), `light`, `dark`, and `auto`.
  - Zero FOUC via early head script (`theme-init.js`), dynamic `prefers-color-scheme` listener, and instant seamless transitions without page reloads.
  - Preserves form inputs, focus, scroll, and link expand states on theme toggle.
- **Solar Sunrise/Sunset Auto Theme (`VIEW-THEME-002`)**:
  - Purely local astronomical solar calculation (NOAA general solar position algorithm) with zero external network requests.
  - Requests geolocation only upon explicit user selection with prior explanation; coordinates are never exported or leaked.
  - Seamless automatic transition on day/night boundary crossing with scheduled timer.
  - Graceful fallback to system theme if location permissions are denied.
- **Firefox Desktop Support (`PLAT-FIREFOX-001`)**:
  - Dual background configuration supporting both Chrome MV3 `service_worker` and Firefox MV3 `scripts` fallback.
  - Manifest V3 compliant with Gecko extension ID and `data_collection_permissions: { required: ["none"] }` (0 errors in `web-ext lint`).
  - CSP-compliant external `theme-init.js` and cross-browser `runtime.getURL` newtab launcher in toolbar popup.
  - Real browser execution verified on both Google Chrome and Mozilla Firefox desktop.
- **macOS-Inspired Visual Refinement**:
  - Calm, focused digital workbench aesthetic adhering to Apple Human Interface Guidelines and `-apple-system` font hierarchy.
  - Soft light (`#f5f5f7`) and layered dark (`#1c1c1e` / `#2c2c2e`) backgrounds with 1px hairline borders and subtle depth.
  - macOS segmented control category track with high contrast active tab pill and smooth focus rings.
  - Unified local SVG icon library (SF Symbols 1.8px stroke geometry) replacing emojis with zero external CDN dependencies.
- **Keyless Background Gallery (`VIEW-BG-001`)**:
  - **Completely Keyless**: Powered by Wikimedia Commons MediaWiki Action API (`https://commons.wikimedia.org/w/api.php`) with anonymous CORS (`origin=*`) and zero API keys or user accounts.
  - **Default OFF**: Strictly zero network requests until explicitly enabled by the user in settings.
  - **10 Curated Categories**: Nature, Architecture, Space, Animals, Travel / Places, Art, Minimal / Texture, Anime & Illustration, My Favorites, and Local Images.
  - **Independent Category & Image Locking**: "Lock Category" restricts image pool to selected category; "Lock Image" pauses automatic rotation.
  - **Switching Frequencies**: Manual only, Every new tab, Daily (default, reuses cached choice across new tabs within the same calendar day), and Weekly.
  - **Readability & Contrast**: Background layer with adjustable opacity slider (0–100%) and adaptive light/dark overlay scrim preserving 100% WCAG AA text and focus contrast.
  - **Bottom-Right Floating Action Bar (FAB)**: Compact translucent macOS pill toolbar featuring Favorite, Next Image, Lock/Unlock, Category Selector, Frequency Selector, Info/Attribution, and Settings.
  - **Full Attribution Card**: Info popover displaying Image Title, Artist/Author, License (with link to Creative Commons / Public Domain license), and Wikimedia Commons source link.
  - **Segregated Local Image Storage**: User upload support for PNG, JPG, and WebP stored as Blobs in isolated IndexedDB database (`PowerLessToy_Background_DB`, store `local_images`). Enforces 10MB per file and 50MB total quota with image deletion controls and zero external network traffic.
  - **Offline & Failure Resilience**: Embedded curated offline seed pool; API timeouts, offline state, or broken images safely preserve current image or fallback to clean theme solid background without modal interruptions.
  - **Strict Bookmark Data Isolation**: Background configuration, favorites, and local image blobs are completely isolated in separate stores and NEVER touch bookmark IndexedDB stores, JSON backup exports, pre-import snapshots, or undo routines.
- **Bilingual Support**: Pure English and Japanese UI strings (zero Chinese in production code).
- **Expanded Ordinary Bookmark Row Hit Target (`BMK-HIT-001`)**:
  - 48–52px vertical row height (`min-height: 50px`) with comfortable vertical breathing room while preserving the 4-column responsive desktop layout.
  - Full row primary area navigates on click; Pin, Expand, Edit, and Delete buttons remain isolated (`>= 32x32px`) and never trigger navigation.
- **Environment Badge Filter Cycling (`BMK-ENV-001`)**:
  - Cycle filter across `ALL → LOCAL → DEV → TEST → PROD → ALL` via the `E` keyboard shortcut (disabled inside inputs/modals/search) or the toolbar status button (`#envFilterBtn`).
  - Filters both ordinary bookmarks and pinned bookmarks in the current Tab case-insensitively without mutating underlying data.
  - Unbadged and custom-badged links appear only in `ALL`; displays a lightweight empty state with a 1-click reset button when no links match in the active Tab.
- **UI-Level Private / Hidden Bookmarks (`BMK-PRIV-001`)**:
  - Mark or unmark any bookmark as hidden (`hidden: true`) in the Add/Edit Link dialog.
  - Hidden by default on page load and refresh: excluded from ordinary group lists, Pinned Shelf, Centralized Spotlight Search, and environment filter results.
  - Lock button (`#privacyToggleBtn`) temporarily reveals hidden bookmarks in their original Tab/Group, Pinned Shelf, and Search with a subtle `Hidden` indicator badge; note that this is UI-level hiding only, not cryptographic encryption.
- **Tab-Scoped Pinned Bookmarks (`BMK-PIN-002`)**:
  - Pinned Shelf is isolated per Tab (Category) so each Tab displays and reorders only its own pinned bookmarks without affecting other Tabs.
- **Centralized Spotlight Search (`BMK-SEARCH-001`)**:
  - Cross-Tab search (`Ctrl/Cmd+K`, `/`, or extension command `Ctrl/Cmd+Shift+K`) with 6-tier ranking and Pinned priority while respecting hidden bookmark state.

## Release, Versioning & Git Tag Rules

Every completed, test-verified, deliverable batch of changes for `apps/bookmark-organizer` **MUST** follow these mandatory release steps:

1. **Semantic Versioning (`manifest.json` & `package.json`)**:
   - Bug fixes increment **patch** (`0.2.x`).
   - Backward-compatible new features increment **minor** (`0.x.0`).
   - Incompatible breaking changes increment **major** (`x.0.0`).
2. **Commit & Push**:
   - Verify `git status` and `git diff` contain zero `test-data/`, temporary files, personal bookmark data, or out-of-scope changes.
   - Create an explicit Git commit and push to `origin/main`.
3. **Annotated Git Tag**:
   - Create an annotated tag named `bookmark-organizer-vX.Y.Z` (e.g., `bookmark-organizer-v0.2.0`) summarizing the user-visible changes.
   - Push the tag to `origin` (`git push origin bookmark-organizer-vX.Y.Z`).
   - Never tag incomplete, unverified, or debug-only commits.

## Storage Architecture

```
IndexedDB: powerless_toy_bookmarks_db (BOOKMARK CORE DATA)
 ├── categories  [id, name, description, revision, createdAt, updatedAt]
 ├── groups      [id, categoryId, name, revision, createdAt, updatedAt]
 ├── links       [id, groupId, name, url, badge, revision, createdAt, updatedAt]
 ├── importJobs  [id, sourceFileName, sourceFileHash, formatVersion, snapshotId, addedIds...]
 ├── snapshots   [id, createdAt, reason, data: {categories, groups, links}]
 └── metadata    [key, value]

IndexedDB: PowerLessToy_Background_DB (ISOLATED LOCAL IMAGES)
 └── local_images [id, name, size, type, blob, createdAt]

chrome.storage.local / localStorage (LIGHTWEIGHT PREFERENCES)
 ├── powerless_toy_active_category_v1 (Active category ID)
 ├── powerless_toy_lang (User language preference: "en" | "ja")
 ├── powerless_toy_theme_mode (Theme mode: "system" | "light" | "dark" | "auto")
 ├── powerless_toy_cached_geo (Cached lat/lon for solar calculations, local only)
 ├── powerless_toy_migration_completed_v1 (Migration status flag)
 ├── powerless_toy_bg_config (Background config: enabled, opacity, frequency, categories, locks)
 ├── powerless_toy_bg_current (Current background record with attribution metadata)
 ├── powerless_toy_bg_favorites (Array of favorited images with attribution)
 └── powerless_toy_bg_cache (Cached Wikimedia Commons category search responses)
```

## Excluded from Scope & Future TODOs

- **API-Key Photo Providers (TODO)**: Pixabay, Unsplash, Pexels, and other commercial photo APIs require user registration, API keys, or central proxy servers; strictly excluded from this keyless version and recorded as future enhancement candidates.
- **Favicon Aggregators**: Third-party favicon services (Google Favicon, Icon Horse) are excluded for user privacy.
- Account authentication, cloud databases, and cross-device syncing.
- Reading, importing, or mutating Chrome's native bookmark library.

## Architecture & Code Layers

- `src/newtab/db.js`: IndexedDB engine with schema definitions, transaction queuing, and revision checks
- `src/newtab/migration.js`: Non-destructive migration service from legacy `chrome.storage`
- `src/newtab/import-export.js`: JSON schema validation, SHA-256 hashing, conflict preview, atomic import, snapshot rollback, and export
- `src/newtab/solar.js`: Purely local NOAA solar equation for sunrise/sunset calculations
- `src/newtab/theme.js`: Complete theme state machine, storage persistence, and dynamic OS listeners
- `src/newtab/theme-init.js`: Synchronous CSP-compliant theme initializer in document head preventing FOUC
- `src/newtab/background-service.js`: Keyless Wikimedia Commons client, frequency scheduler, favorites, and local image IndexedDB manager
- `src/newtab/background-ui.js`: Floating action bar controller, category/frequency/attribution popovers, and settings modal
- `src/newtab/icons.js`: Unified SF Symbols-inspired local SVG icon repository (zero innerHTML warnings)
- `src/newtab/storage.js`: Workbench data access adapter with optimistic concurrency locking and cascade deletions
- `src/newtab/app.js`: Reactive UI controller, event listeners, modal sanitization, link expand logic, and keyboard handling
- `src/newtab/i18n.js`: English and Japanese translations
- `src/background/`: Service Worker / background script lifecycle management
- `src/popup/`: Toolbar quick launcher and link counter
- `src/options/`: Extension information and quick entry
- `src/dict/`: Offline dictionary engine:
  - `dict-constants.js`: Storage keys, default settings, and action constants
  - `lang-detector.js`: Multi-layer language detection (Kana -> JA, Latin -> EN, Chinese detection and unsupported rejection, ambiguous Kanji fallback)
  - `dict-db.js`: IndexedDB `powerless_toy_dict_v1` manager with chunked import, indexed point lookups, and local AI cache
  - `dict-service.js`: High-level dictionary service and on-demand BYOK AI explanation
  - `packs/`: Bundled dictionary packs (JMdict_e for Japanese, Open English WordNet for English) and manifest
- `scripts/build-dictionary-packs.js`: Reproducible script to validate, hash (SHA-256), and bundle dictionary data packs
- `tests/`: Automated unit and integration test suite (`node --test`) verified with 100% pass rate (198 tests)

## Version 0.4.0 Features

### 1. Offline Dictionary & Language Packs (`DICT-PACK-001`, `DICT-LOOKUP-001`)
- **Default OFF**: Zero background queries, zero memory overhead, and no context menus registered until explicitly enabled in `More → Settings → Dictionary`.
- **Authentic Open-Source Sources**:
  - Japanese: JMdict_e by Electronic Dictionary Research and Development Group (EDRDG), licensed under CC BY-SA 4.0.
  - English: Open English WordNet by Global WordNet Association, licensed under CC BY 4.0.
- **IndexedDB Storage (`powerless_toy_dict_v1`)**: Point lookups execute in O(1) memory via indexed keys (`word`, `reading`) without keeping large dictionary files in RAM.
- **Checksum Verification & Safe Rollback**: Packs are validated via SHA-256 before installation; corrupted or invalid packs are rolled back without overwriting existing data.
- **Language Boundaries**: First release officially supports Japanese and English. Chinese is explicitly unsupported (with clear explanatory notice). Architecture is extensible for future French and Spanish packs.

### 2. Optional BYOK AI Context Explanation (`DICT-AI-001`)
- **Bring Your Own Key (BYOK)**: Supports OpenAI (`gpt-4o-mini`) and Google Gemini (`gemini-1.5-flash`).
- **Strict Data Segregation**: API keys are saved exclusively in local storage under `powerless_toy_dict_ai_key` and are NEVER included in bookmark JSON backup exports.
- **On-Demand & Bounded**: Only triggered when user clicks "Explain in Context with AI". Sends at most 1 surrounding sentence and dictionary glosses — never the full webpage.
- **Local Caching**: Explanations are cached in IndexedDB `ai_cache` to eliminate redundant API calls and costs.

### 3. Spotlight Central Search & Context Menu (`DICT-ENTRY-001`)
- **Spotlight Search**: Supports `dict <word>`, `dict: <word>`, `dict ja <word>`, `dict en <word>`, and `辞書 <word>`. Renders headwords, kana readings, POS badges, definitions, and AI explanation buttons directly inside the existing search dialog.
- **Context Menu**: "Look up in PowerLessToy" context menu option (when enabled) opens search with selected text directly in the active page.

### 4. Group Combobox Pre-requisite Defect Fix
- **Empty Query on Focus/Click**: Clicking or focusing on `captureGroupInput` queries with `""`, displaying the top 10+ recent groups without being filtered by the formatted display value `Group (Tab)`.
- **Typing & Validation**: Manual typing clears `selectedGroupId`, validates requirements, and filters candidates across group name, category name, link names, and domains in real-time.
- **Dropdown Controls**: Toggle chevron button, keyboard navigation (ArrowUp/ArrowDown/Enter), and Escape key handling (closes dropdown without closing the modal).
- **Empty State**: Explicit "No groups created yet" notice with direct button to open Bookmark Manager. Save button is disabled whenever no valid group is selected.

