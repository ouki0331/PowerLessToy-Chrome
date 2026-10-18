# Bookmark Organizer UI/UX Design Guidelines

Document Status: Implementation Constraints  
Target Surface: Bookmark Organizer New Tab Workbench  
Design Archetype: `Operate`  
Source of Truth: [`bookmark-organizer.md`](bookmark-organizer.md)  
Design Methodology: Impeccable 4.3.1

> This document defines visual standards, layout requirements, interactive states, and design constraints.

## 1. Context & User Workflow

Users open new tabs dozens of times daily to navigate project environments and corporate portals. The interface prioritizes rapid scanning and low cognitive friction.

- Primary usage environment: Desktop Chrome, daytime office lighting.
- Typical interaction duration: 2 to 5 seconds (open tab, scan category/group, launch link).
- Scaling: Gracefully scales from 3 initial categories to dozens of groups and hundreds of links without horizontal page overflow.

## 2. Visual Identity: Quiet Workbench

### Core Philosophy

A focused, matte, digital workbench. Rejects distracting neon glows, glassmorphism, heavy gradients, or card clutter.

### Visual Palette

- Tone: Calm, light neutral surface (`#f8fafc` / `#ffffff`) with automatic dark mode support (`#090d16` / `#0f172a`).
- Accent Color: Restrained Indigo (`#4f46e5` light / `#6366f1` dark), strictly used for active category, primary actions, and focus rings.
- Borders: Crisp 1px solid dividers defining distinct structural surfaces.
- Typography: System sans-serif stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).
- Icons: Functional glyphs only; no decorative illustration or random emoji mixing.

### Badges & Semantic Colors

- `Local`: Subtle emerald green.
- `Dev`: Subtle sky blue.
- `Test`: Subtle warm amber.
- `Prod`: Subtle purple/violet (Never warning red! Red is strictly reserved for destructive deletion actions and form errors).
- Custom tags: Subtle neutral slate.

## 3. Visual Hierarchy

Desktop first viewport hierarchy:
1. Compact Top Bar: Brand title, workbench badge, language toggle, Manage Content toggle.
2. Category Navigation Track: Horizontal tablist with distinct active tab indicator and "+ Add Category" button in manage mode.
3. Active Category Header: Category name, group count, and "+ Add Group" button.
4. Responsive Group Grid: Multi-column card layout displaying project cards and environment links.

## 4. Component States

All interactive elements (tabs, buttons, cards, links, inputs) implement complete visual states:
- `default`
- `hover`
- `focus-visible` (distinct, unclipped outline with 2px offset)
- `active / pressed`
- `disabled`
- `error`

## 5. Prohibited Visual Patterns

- Full-screen decorative gradients, neon glows, or frosted glassmorphism.
- Random accent colors per card.
- Excessive capsule / pill buttons across all components.
- Hero marketing banners, weather widgets, or clock distractions.
- Critical actions revealed only on hover.
- Color as the sole differentiator for environment badges or error states.
- Animations that delay interactive responsiveness (> 250ms).
