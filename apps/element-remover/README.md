# Element Remover

Select multiple page elements through an inspector-like workflow, then save removal or hiding rules scoped by hostname and path.

## Status

Currently contains directory structure and a minimal Manifest V3 declaration. Feature implementation is pending, and the MVP product specification is `Ready for Delivery`.

## Implementation Sources

- [Element Remover Product Definition](../../docs/product/element-remover.md)
- [Element Remover UI/UX Guidelines](../../docs/product/element-remover-ui.md)

Implementation agents must read both documents before coding and must not rely on this README summary alone.

## MVP Scope

- Select multiple elements continuously in one selection session.
- Remove by default or hide when requested, without automatically expanding the target to its parent.
- Scope rules to the exact hostname and path, ignore query parameters, and safely identify obvious dynamic path segments.
- Append new rules without overwriting existing rules.
- Restore, disable, or delete rules from the extension panel and settings page.
- Show the number of element instances currently affected on the page in the extension badge.
- Mark affected locations in Debug mode and support direct restoration or controlled reload restoration.

## Excluded / Out of Scope

- Cross-device rule synchronization
- Network request blocking or third-party ad-filter lists
- uBlock Origin compatibility
