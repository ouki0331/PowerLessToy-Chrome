# System Architecture

## Design Principles

PowerLessToy uses a pnpm monorepo workspace to manage multiple independent Chrome extensions. Each extension can be developed, built, tested, and published autonomously. Reusable code across extensions is centralized in `packages/shared`.

## Directory Layout

```text
apps/<extension>/
├── manifest.json      # Chrome Manifest V3 manifest
├── package.json       # Extension metadata and npm scripts
├── README.md          # Extension boundaries and documentation
├── assets/icons/      # Extension icon assets
├── src/background/    # Background Service Worker
├── src/content/       # Page-injected content scripts
├── src/options/       # Configuration and options UI
├── src/popup/         # Toolbar action popup UI
└── tests/             # Unit and integration test suites
```

## Extension Boundaries

### Bookmark Organizer

Replaces Chrome's New Tab page with an organized, quiet digital workbench to manage categorized links and environment portals. The MVP operates purely locally without touching Chrome's native bookmark database. Permissions are strictly confined to local storage.

### Element Remover

Enters an interactive element selection mode to highlight and remove designated DOM elements from the active tab. Future work will define one-time vs. persistent rules before requesting permissions like `activeTab`, `scripting`, or `storage`.

### Message Center

Receives, stores, and presents notifications within a dedicated extension surface. External message transports and notification sources will be evaluated once integration specifications are clarified.

## Code Sharing Rules

Only code genuinely reused by two or more extensions is promoted to `packages/shared`. No premature abstractions or speculative dependencies are permitted.

## Permission Hygiene

All manifests adhere to minimal permission principles. Extensions request only what is strictly necessary for their core capabilities.
