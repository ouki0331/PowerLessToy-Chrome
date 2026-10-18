# Bookmark Organizer

Organize, categorize, and access work projects and environment links directly on Chrome's New Tab page.

## Status

Version 1.1 with advanced Data Safety, Optimistic Concurrency Control, and Safe JSON Import/Export is implemented and verified.

Product Specification: [`docs/product/bookmark-organizer.md`](../../docs/product/bookmark-organizer.md)

UI/UX Design Guidelines: [`docs/product/bookmark-organizer-ui.md`](../../docs/product/bookmark-organizer-ui.md)

## Implemented Scope

- **New Tab Workbench**: Overrides Chrome's New Tab with a quiet, responsive workbench panel.
- **Hierarchical Structure**: Category -> Project/Topic Group -> Environment Link.
- **Initial Seed**: 3 default categories on first launch (Work Projects, Company Management, Tech Interests).
- **Full CRUD Operations**: Create, rename, edit, and cascade delete with impact warnings.
- **Dual Open Behavior**: Standard click navigates in current tab; `Ctrl/Cmd+Click` opens in a background new tab.
- **Accessible Keyboard Navigation (`DEC-003`)**: Tab/Shift+Tab boundary detection to avoid keyboard traps; Arrow key cyclical category navigation without DOM reconstruction or focus loss.
- **Primary Storage (IndexedDB)**:
  - Six dedicated object stores: `categories`, `groups`, `links`, `importJobs`, `snapshots`, and `metadata`.
  - Seamless zero-loss migration from legacy `chrome.storage.local` with count validation.
  - Multi-tab real-time sync listening to `chrome.storage.onChanged` and `window.storage`.
- **Optimistic Concurrency Control (`revision`)**:
  - Incremental `revision` counter on all entities.
  - Compares `expectedRevision` before write; returns `CONFLICT` on stale writes with user reload prompt.
- **Zero-Loss JSON Import/Export (`DATA-IMPORT-001`)**:
  - **Append/Merge Only**: Never replaces or wipes existing workbench data.
  - **Schema Validation (`formatVersion: 1`)**: Strict structure and URL format checks.
  - **SHA-256 Fingerprinting**: Detects and warns on identical duplicate file imports.
  - **Interactive Preview & Conflict Resolution**: Previews addition, merge, skip, and conflict counts before writing. Users choose "Keep existing" or "Keep both" (generating unique IDs).
  - **Pre-Import Snapshot & Atomic Transactions**: Full snapshot captured prior to execution; mid-process failures roll back completely.
  - **Reversible Undo**: Dedicated "Undo This Import" banner reverts only the newly imported batch.
  - **Standard Backup Export**: Timestamped JSON backup file that can be round-tripped and re-imported cleanly.
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

chrome.storage.local (Lightweight preferences)
 ├── powerless_toy_active_category_v1 (Active category ID)
 ├── powerless_toy_ui_lang (User language preference: "en" | "ja")
 └── powerless_toy_migration_completed_v1 (Migration status flag)
```

## Excluded from Scope

- Account authentication, cloud databases, and cross-device syncing
- Reading, importing, or mutating Chrome's native bookmark library
- Automatic scraping of site favicons, page titles, or meta tags
- Link health monitoring or visit telemetry

## Architecture & Code Layers

- `src/newtab/db.js`: IndexedDB engine with schema definitions, transaction queuing, and revision checks
- `src/newtab/migration.js`: Non-destructive migration service from legacy `chrome.storage`
- `src/newtab/import-export.js`: JSON schema validation, SHA-256 hashing, conflict preview, atomic import, snapshot rollback, and export
- `src/newtab/storage.js`: Workbench data access adapter with optimistic concurrency locking and cascade deletions
- `src/newtab/app.js`: Reactive UI controller, event listeners, modal sanitization, and keyboard handling
- `src/newtab/i18n.js`: English and Japanese translations
- `src/background/`: Service Worker lifecycle management
- `src/popup/`: Toolbar quick launcher and link counter
- `src/options/`: Extension information and quick entry
- `tests/`: Automated unit and integration test suite (`node --test`) verified with 100% pass rate
