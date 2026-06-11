# Mobile / PWA pass — agreed direction (June 2026)

> **Status: implemented (June 11, 2026).** See the "PWA / offline" section of README.md.

Decisions made with Louis at the end of the initial build session. The goal is a mobile
pass on **this** app + PWA install, not a separate app.

## Decisions

- **PWA, not Capacitor, not React Native.** Manifest + small service worker caching the
  static build for full offline use. No app-store distribution.
- **Constellation is desktop/tablet-first.** On small screens (< ~700px), show the
  part-grouped module list first; the constellation is hidden or demoted (its tooltip is
  hover-only and labels are unreadable at phone width — don't fight it).
- **Battery**: reduce `ParticleField` particle count and link distance on small screens
  (the O(n²) link pass is the hot loop), or pause the field on mobile entirely.
- **Touch ergonomics**: 44px minimum target audit (quiz choices, checklist rows, nav
  buttons), slimmer sticky header on mobile.
- **Progress stays per-device localStorage** with the existing export/import buttons.
  No sync backend — accepted limitation to keep the zero-backend design.

## Context for a fresh session

- `README.md` covers the content pipeline (`npm run sync`) and commands.
- Existing responsive behavior: reader TOC hides < 980px, overview grid stacks < 860px,
  tables already h-scroll, quiz/exercise flows are single-column already.
- Verify on a ~390px viewport: home, module overview, reader (module 02 for KaTeX,
  module 09 for the ASCII diagram), quiz, exercise reveal flow.
