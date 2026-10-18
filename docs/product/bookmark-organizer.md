# Bookmark Organizer Product Specification

Document Status: Source of Truth  
Product Status: MVP `Ready for Delivery`; File Import `Defining`<br>
Current Availability: `Delivered`  
Applicable Version: MVP 1.0  
Last Updated: 2026-10-18

> This document defines user-visible product behavior. It does not dictate implementation frameworks, UI libraries, or storage internals. Technical preferences must not alter confirmed product decisions.

## 1. Product Positioning

### Target Users

Chrome users (engineers, product managers, DevOps) who maintain multiple ongoing projects, company administration portals, and technical documentation links, and frequently switch between local, development, staging/testing, and production environments.

### Problem Statement

Standard browser bookmarks accumulate chronologically or get buried in deep folder hierarchies, making it tedious to quickly answer: "Which project's which environment is this link?" Mixing internal corporate tools, project environments, and personal documentation also inflates search overhead.

### Product Promise

Every time a user opens a Chrome New Tab, they are presented with a complete digital workbench where they can switch categories by purpose, locate project groups, and launch the correct environment link with predictability.

### Differences from Adjacent Solutions

- Not a viewer or organizer for Chrome's native bookmarks.
- Not a cross-device cloud synchronization service.
- Not an automated web crawler, recommender, or URL categorizer.
- MVP is a user-maintained, local-first link workbench stored purely within the current browser.

## 2. Core User Scenarios

1. Open a New Tab, select "Work Projects", locate a project card, and launch its local, dev, staging, or production URL.
2. Switch to "Company Management" to access GitHub, corporate portals, attendance, or tracking tools.
3. Switch to "Tech Interests" to reference framework documentation, API specs, or research topics.
4. Add, edit, or delete categories, groups, and links as new workflows emerge.

## 3. Core Value Loop

```text
Open New Tab
  → Restore Last Active Category
  → Switch Category
  → Locate Project / Topic Group
  → Launch Target Link
  → Add / Maintain Items
  → Persist Across Browser Restarts
```

Requirements for loop stability: reliable New Tab override, clear category and group hierarchies, predictable link opening semantics, and persistent local storage across browser restarts.

## 4. Product Capability Map

```text
L0 Bookmark Organizer New Tab Digital Workbench
├── L1 New Tab Access (NAV)
│   ├── L2 Workbench Entry (HOME)
│   │   └── NAV-HOME-001 New Tab Workbench
│   └── L2 Category Navigation (CAT)
│       ├── NAV-CAT-001 Category Switching
│       └── NAV-CAT-002 Category Management
├── L1 Content Organization (ORG)
│   ├── L2 Groups (GROUP)
│   │   └── ORG-GROUP-001 Group Management
│   └── L2 Links (LINK)
│       └── ORG-LINK-001 Link Management & Environment Badges
├── L1 Link Access (OPEN)
│   └── L2 Opening Semantics (LINK)
│       └── OPEN-LINK-001 Current Tab & New Tab Opening
└── L1 Data Portability (DATA)
    └── L2 File Import (IMPORT)
        └── DATA-IMPORT-001 Structured File Import (Deferred)
```

### Feature Status Matrix

| Feature ID | Feature Name | Product Status | Current Availability | Spec Reference |
| --- | --- | --- | --- | --- |
| `NAV-HOME-001` | New Tab Workbench | Ready for Delivery | Delivered | Section 7.1 |
| `NAV-CAT-001` | Category Switching | Ready for Delivery | Delivered | Section 7.2 |
| `NAV-CAT-002` | Category Management | Ready for Delivery | Delivered | Section 7.3 |
| `ORG-GROUP-001` | Group Management | Ready for Delivery | Delivered | Section 7.4 |
| `ORG-LINK-001` | Link Management & Badges | Ready for Delivery | Delivered | Section 7.5 |
| `OPEN-LINK-001` | Current & New Tab Opening | Ready for Delivery | Delivered | Section 7.6 |
| `DATA-IMPORT-001` | Structured File Import | Defining | Not built | Section 7.7 |

## 5. Information Architecture & Layout

### 5.1 General Layout

The workbench occupies the entire New Tab surface as a dedicated application panel.

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Bookmark Organizer                                 [Manage Content]  │
│                                                                      │
│ [Work Projects]  [Company Management]  [Tech Interests]  [+ Category]│
├──────────────────────────────────────────────────────────────────────┤
│ Work Projects                                            [+ Add Group]│
│                                                                      │
│ ┌─ Project A ─────────────────┐  ┌─ Project B ─────────────────┐     │
│ │ [Local] [Dev] [Test] [Prod] │  │ [Local] [Dev]        [Prod] │     │
│ └─────────────────────────────┘  └─────────────────────────────┘     │
│                                                                      │
│ ┌─ Project C ─────────────────┐                                      │
│ │ [Local] [Test] [Prod]       │                                      │
│ └─────────────────────────────┘                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Layout Rules:
- Top bar contains application title, category navigation track, and manage mode toggle.
- Only content from the active category is displayed below the track.
- Groups are displayed as cards in a responsive grid (multi-column on wide screens, single-column on narrow viewports).
- Missing environments do not render empty placeholders (e.g., if a project has no test environment, only existing links are rendered).
- Browse mode emphasizes distraction-free navigation; management actions are tucked into Manage mode.

### 5.2 Initial Categories

On first launch, 3 default empty categories are initialized:
1. `Work Projects`: Ongoing projects and environment portals.
2. `Company Management`: Corporate portals, GitHub, attendance, trackers.
3. `Tech Interests`: Technical documentation, libraries, and reference bookmarks.

These are default values, not reserved keywords; users may rename or delete them.

### 5.3 Content Data Model

```text
Category
└── Group (Represents a project in Work Projects, or a topic elsewhere)
    └── Link
        ├── Display Name
        ├── URL
        └── Optional Badge (Local / Dev / Test / Prod / Custom)
```

## 6. Confirmed Product Decisions

| Decision ID | Related Feature | Confirmed Rule | Rationale |
| --- | --- | --- | --- |
| `DEC-001` | `NAV-HOME-001` | Extension overrides Chrome's New Tab page; appears on startup only if Chrome is configured to open New Tab. | Respects existing startup URL preferences. |
| `DEC-002` | `NAV-CAT-001` | Initializes with 3 default categories on first run; subsequent visits restore the last active category. | Eliminates repetitive switching. |
| `DEC-003` | `NAV-CAT-001` | In category track, `Tab` advances and activates next category, `Shift+Tab` moves to and activates previous category; at boundaries, focus exits track without trapping. | Enables rapid keyboard navigation without trapping focus. |
| `DEC-004` | `NAV-CAT-002` | At least one category must be preserved; the final category cannot be deleted. | Ensures a valid root container always exists. |
| `DEC-005` | `ORG-GROUP-001` | Groups represent projects in Work Projects and arbitrary topics elsewhere. | Consistent structure without limiting future organization. |
| `DEC-006` | `ORG-LINK-001` | Local, Dev, Test, Prod are shortcut suggestions, not mandatory slots; links may use custom labels or no badge. | Adapts to asymmetric project environments. |
| `DEC-007` | `OPEN-LINK-001` | Primary click opens URL in current tab; `Ctrl/Cmd+Click` opens URL in a new tab. | Standard browser navigation conventions. |
| `DEC-008` | All | Stored strictly in local browser storage; no cloud sync, accounts, or telemetry. | Local-first, private by design. |
| `DEC-009` | All | MVP does not read, import, or modify Chrome native bookmarks. | Independent workbench experience. |

## 7. Functional Specifications

### 7.1 NAV-HOME-001 New Tab Workbench
- Overrides default New Tab page via Manifest V3 `chrome_url_overrides.newtab`.
- Restores user data and last active category across restarts.
- Initial run creates 3 default categories and displays guided empty state.
- Graceful error recovery: if storage read fails, displays non-destructive error state with Retry button without overwriting data.

### 7.2 NAV-CAT-001 Category Switching
- Click category tab to activate immediately.
- Keyboard: `ArrowRight` and `ArrowLeft` cycle with wrap-around.
- `Tab` advances to next category and activates it; on the last category, `Tab` exits to next page element.
- `Shift+Tab` moves to previous category and activates it; on the first category, `Shift+Tab` exits backwards.

### 7.3 NAV-CAT-002 Category Management
- Add category with non-empty trimmed name.
- Rename existing category.
- Delete category with confirmation dialog showing affected groups and links count.
- Prevent deleting the only remaining category (minimum 1 required).
- If active category is deleted, fallback to left sibling, or right sibling if none.

### 7.4 ORG-GROUP-001 Group Management
- Add named group within active category.
- Rename group.
- Delete group with confirmation dialog showing affected links count.
- Empty group displays "No links added yet" empty state. No ghost slots for missing environments.

### 7.5 ORG-LINK-001 Link Management & Environment Badges
- Add link: Name (required), URL (required, valid web/file protocol), Badge (optional).
- Badges: Quick presets (Local, Dev, Test, Prod) and custom tag input.
- Edit and delete link with confirmation dialog.
- Inline form validation preserving user input on failure.

### 7.6 OPEN-LINK-001 Current & New Tab Opening
- Standard primary click navigates current tab.
- `Ctrl+Click` (Windows/Linux) and `Cmd+Click` (macOS) open in new tab without navigating workbench.
- Middle-click opens in new tab.
- Native context menu preserved on right-click.

### 7.7 DATA-IMPORT-001 Structured File Import
- Status: `Defining` (Deferred from MVP 1.0).
- Reserved for future batch import from user-supplied JSON files with schema validation, conflict preview, and atomic writes.

## 8. Immutable Delivery Constraints

1. New Tab is the primary product surface; not a browser popup.
2. First run must initialize "Work Projects", "Company Management", and "Tech Interests".
3. Categories, groups, and links are user-managed; at least one category must remain.
4. Groups prioritize project/topic identity; environments are optional badges.
5. Environments are never mandatory fixed slots.
6. Standard click opens in current tab; `Ctrl/Cmd+Click` opens in new tab.
7. Local-first persistence; no cloud sync or native bookmark mutation.
