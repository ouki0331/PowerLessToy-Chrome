# Chrome Extension Specifications

Each top-level subdirectory in this directory represents an independently developable, buildable, and publishable Chrome extension.

When introducing a new extension, provide the following details:

1. Extension name and lowercase kebab-case directory name.
2. A one-sentence description explaining the problem it solves.

All directory hierarchies, file formats, naming standards, and validations follow the guidelines established below.

## Directory Layout

New extensions must use lowercase `kebab-case` directory names and follow this skeleton:

```text
apps/<extension-slug>/
├── README.md
├── manifest.json
├── package.json
├── assets/
│   └── icons/
│       └── .gitkeep
├── src/
│   ├── background/
│   │   └── .gitkeep
│   ├── content/
│   │   └── .gitkeep
│   ├── options/
│   │   └── .gitkeep
│   └── popup/
│       └── .gitkeep
└── tests/
    └── .gitkeep
```

`.gitkeep` files are only retained while a directory does not yet contain real implementation files. Replace them once code files are added.

## File Templates

### `package.json`

```json
{
  "name": "@powerless-toy/<extension-slug>",
  "version": "0.1.0",
  "private": true,
  "description": "<English one-line description>"
}
```

### `manifest.json`

During the skeleton stage, declare only minimal Manifest V3 metadata without requesting speculative permissions:

```json
{
  "manifest_version": 3,
  "name": "PowerLessToy <Extension Name>",
  "version": "0.1.0",
  "description": "<One-line description>"
}
```

Add `permissions`, `host_permissions`, `background`, `action`, `content_scripts`, `options_page`, and icons only when implementing actual functionality.

### `README.md`

Each extension README uses the following standard structure:

```markdown
# <Extension Name>

<One-sentence description of purpose>.

## Status

Current status and scope description.

## Planned Scope

- <Core capability 1>
- <Core capability 2>

## Excluded / Out of Scope

- <Items explicitly deferred or out of current scope>
```

## Directory Responsibilities

| Directory | Responsibility |
| --- | --- |
| `assets/icons` | Extension icons and store artwork |
| `src/background` | Service Worker, browser events, and cross-tab state |
| `src/content` | Content scripts injected into web pages |
| `src/options` | Persistent configuration and options UI |
| `src/popup` | Browser action toolbar popup UI |
| `tests` | Unit tests, integration tests, and fixtures |

Retain directory layers even if a specific layer is not immediately used to preserve uniform structure across all extensions.

## Code Sharing Guidelines

- Code used by only one extension remains inside that extension.
- Promote to `packages/shared` only after real reuse across two or more extensions is established.
- Do not build speculative abstractions or add external runtime dependencies prematurely.

## Checklist for New Extensions

- [ ] Directory name uses lowercase `kebab-case`.
- [ ] Required directories and files exist.
- [ ] Package name matches `@powerless-toy/<extension-slug>`.
- [ ] Manifest version is 3, with valid name, version, and description.
- [ ] No unjustified Chrome permissions requested.
- [ ] Root `README.md` extension list updated.
- [ ] Workspace validation (`node scripts/validate-workspace.mjs`) passes.
- [ ] Changes committed to Git.
