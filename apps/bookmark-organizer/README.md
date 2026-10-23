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
- **Bilingual Support**: Pure English and Japanese UI strings (no Chinese in production extension).

## Storage Architecture

```
IndexedDB: powerless_toy_bookmarks_db
 ├── categories  [id, name, description, revision, createdAt, updatedAt]
 ├── groups      [id, categoryId, name, revision, createdAt, updatedAt]
 ├── links       [id, groupId, name, url, badge, revision, createdAt, updatedAt]
 ├── importJobs  [id, sourceFileName, sourceFileHash, formatVersion, snapshotId, addedIds...]
 ├── snapshots   [id, createdAt, reason, data: {categories, groups, links}]
 └── metadata    [key, value]

chrome.storage.local / localStorage (Lightweight preferences)
 ├── powerless_toy_active_category_v1 (Active category ID)
 ├── powerless_toy_ui_lang (User language preference: "en" | "ja")
 ├── powerless_toy_theme_mode (Theme mode: "system" | "light" | "dark" | "auto")
 ├── powerless_toy_cached_geo (Cached lat/lon for solar calculations, local only)
 └── powerless_toy_migration_completed_v1 (Migration status flag)
```

## Excluded from Scope

- Account authentication, cloud databases, and cross-device syncing
- Reading, importing, or mutating Chrome's native bookmark library
- Automatic scraping of site favicons, page titles, or meta tags
- Third-party favicon aggregation services or external location APIs
- Link health monitoring or visit telemetry

## Architecture & Code Layers

- `src/newtab/db.js`: IndexedDB engine with schema definitions, transaction queuing, and revision checks
- `src/newtab/migration.js`: Non-destructive migration service from legacy `chrome.storage`
- `src/newtab/import-export.js`: JSON schema validation, SHA-256 hashing, conflict preview, atomic import, snapshot rollback, and export
- `src/newtab/solar.js`: Purely local NOAA solar equation for sunrise/sunset calculations
- `src/newtab/theme.js`: Complete theme state machine, storage persistence, and dynamic OS listeners
- `src/newtab/theme-init.js`: Synchronous CSP-compliant theme initializer in document head preventing FOUC
- `src/newtab/storage.js`: Workbench data access adapter with optimistic concurrency locking and cascade deletions
- `src/newtab/app.js`: Reactive UI controller, event listeners, modal sanitization, link expand logic, and keyboard handling
- `src/newtab/i18n.js`: English and Japanese translations
- `src/background/`: Service Worker / background script lifecycle management
- `src/popup/`: Toolbar quick launcher and link counter
- `src/options/`: Extension information and quick entry
- `tests/`: Automated unit and integration test suite (`node --test`) verified with 100% pass rate (93 tests)

