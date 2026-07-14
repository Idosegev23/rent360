# Mobile Responsive Audit (Module E) — Findings & Fixes

**Date:** 2026-07-14 · **Status:** Done. Static audit of the shell + densest screens.

## What was already fine (no change)
The app is mostly mobile-aware already:
- Shell swaps the desktop sidebar for `BottomTabs` at ≤900px; `.app-shell` grid → single column.
- `.main-pane { min-width: 0 }` deliberately prevents wide children from scrolling the whole page.
- Dense tables are wrapped in horizontal-scroll containers: properties (`PropertiesView`,
  `ModernPropertiesPage` — `overflow-x-auto`), reports (`overflowX:auto` wrapper).
- Filter/toolbar rows use `flex flex-wrap` (properties), so they reflow on narrow screens.
- The conversation two-column layout collapses to one column at ≤900px (`.convo-layout`).
- `.page-wrap` reserves 100px bottom padding to clear the fixed bottom tabs.

## Concrete issues found + fixed
1. **Nav breakpoint mismatch.** The sidebar returns at >900px, but `BottomTabs` used Tailwind
   `lg:hidden` (hides only at ≥1024px), so **both** navs showed on tablets (901–1023px).
   → `BottomTabs` now uses `min-[901px]:hidden`, aligned to the 900px shell breakpoint.
2. **No iPhone safe-area handling.** The fixed bottom tab bar sat under the home indicator.
   → Added `viewport-fit=cover` (new `viewport` export in `app/layout.tsx`) + `padding-bottom:
   env(safe-area-inset-bottom)` on the bottom tab bar.

## Known limitation (not a bug — noted for follow-up)
`BottomTabs` exposes 5 core sections (dashboard, properties, renters, outreach, inbox). Secondary
sections (tasks, meetings, team, commissions, reports, **admin/settings incl. the interview editor**,
pipeline, action) are only reachable on desktop. A future "עוד" (more) sheet could surface them on
mobile. Out of scope for this audit.

## Verification
Static audit (no headless browser). Typecheck clean. Final visual QA best done on a real phone.
