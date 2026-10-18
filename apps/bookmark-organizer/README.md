# Bookmark Organizer

Organize, categorize, and access work projects and environment links directly on Chrome's New Tab page.

## Status

MVP 1.0 is implemented and verified. Structured file import remains in `Defining` status.

Product Specification: [`docs/product/bookmark-organizer.md`](../../docs/product/bookmark-organizer.md)

UI/UX Design Guidelines: [`docs/product/bookmark-organizer-ui.md`](../../docs/product/bookmark-organizer-ui.md)

## Implemented Scope (MVP)

- Overrides Chrome's New Tab with a quiet, responsive workbench panel
- Multi-level structure: Category -> Project/Topic Group -> Environment Link
- 3 initial categories on first launch: Work Projects, Company Management, Tech Interests
- Full CRUD for Categories, Groups, and Links with confirmation dialogs and field validation
- Dual open behavior: standard click opens in current tab; `Ctrl/Cmd+Click` opens in new tab
- Accessible keyboard navigation conforming to `DEC-003` (Tab/Shift+Tab boundary handling, Arrow key cycling)
- Persistent local storage using `chrome.storage.local` with non-destructive error recovery
- Bilingual UI support (English and Japanese)

## Future Scope (Deferred)

- Structured file import (`DATA-IMPORT-001`): batch import from user-supplied JSON files with preview and atomic write
- Drag-and-drop reordering for categories, groups, and links
- Global search and filtering across categories

## Excluded from MVP

- Account authentication, cloud backup, and cross-device sync
- Reading, importing, or mutating Chrome's native bookmark library
- Automatic scraping of site favicons, page titles, or meta tags
- Link health monitoring or visit telemetry

## Architecture & Code Layers

- `src/newtab/`: Full-page digital workbench (HTML, CSS, modern JS modules)
- `src/background/`: Service Worker lifecycle management
- `src/popup/`: Toolbar quick launcher and link counter
- `src/options/`: Extension information and quick entry
- `tests/`: Automated unit and integration test suite (`node --test`)
