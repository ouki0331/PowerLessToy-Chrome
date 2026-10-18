# PowerLessToy

PowerLessToy is a collection of focused Chrome extensions designed to simplify bookmark management, web page cleanup, and notification viewing.

## Extensions

| Extension | Directory | Planned Purpose | Status |
| --- | --- | --- | --- |
| Bookmark Organizer | `apps/bookmark-organizer` | Manage work projects, company portals, and tech links on Chrome's New Tab | MVP Implemented |
| Element Remover | `apps/element-remover` | Select and remove designated elements from any web page | Skeleton |
| Message Center | `apps/message-center` | Receive, store, and display notifications | Skeleton |

## Repository Structure

```text
.
├── apps/                       # Independent Chrome extensions
│   ├── bookmark-organizer/
│   ├── element-remover/
│   └── message-center/
├── packages/
│   └── shared/                 # Reusable types, utilities, and UI (reserved)
├── docs/
│   ├── architecture.md         # Architecture conventions
│   └── product/                # Product specifications & design guidelines
└── scripts/
    └── validate-workspace.mjs  # Workspace consistency checks
```

Each extension follows Manifest V3 with the standard directory layers:

- `src/background`: Service Worker and browser-level events
- `src/content`: Content scripts injected into web pages
- `src/popup`: Toolbar action popup interface
- `src/options`: Persistent settings and options page
- `assets/icons`: Extension icons and store artwork
- `tests`: Unit and integration tests

All new extensions follow the directory layout, naming rules, permission principles, and checklists defined in [`apps/README.md`](apps/README.md).

## Local Verification

Run workspace consistency checks:

```bash
node scripts/validate-workspace.mjs
```

Run test suite:

```bash
node --test apps/*/tests/*.test.js
```

## Current Status

- [x] Monorepo workspace skeleton with 3 extension directories
- [x] Manifest V3 baseline manifests
- [x] Shared package workspace reservation
- [x] Automated workspace structure verification
- [x] Bookmark Organizer product specification
- [x] Bookmark Organizer UI/UX design guidelines
- [x] Bookmark Organizer MVP implementation & test suite
- [ ] Bookmark Organizer structured file import (defining)
- [ ] Element Remover selection and removal functionality
- [ ] Message Center receiving and display functionality
