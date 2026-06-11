# TLAD — Interactive Learning App

An interactive course built from the Obsidian vault's **Tech Lead AI & Data Path**
(`../robilouis-pro/Learning/Tech Lead AI & Data Path/`). Dark, particle-styled reader
with per-module quizzes and self-check exercises.

## Commands

| Command | What it does |
| --- | --- |
| `npm run sync` | Re-parse the vault notes → `src/data/` (run after editing notes in Obsidian) |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build (`dist/`, fully static, works from any host) |
| `npm run preview` | Serve the production build |
| `npm run icons` | Regenerate the PNG app icons in `public/` (design lives in `scripts/make-icons.ts`) |
| `npx tsx scripts/check-eval.ts NN` | Validate one authored eval file |

## PWA / offline

The app is an installable PWA. `npm run build` also emits `dist/sw.js` (see the
`offline-service-worker` plugin in `vite.config.ts`): it precaches every built file, so
after one visit the whole curriculum works offline. Navigations are network-first, so a
new deploy is picked up on the next online visit. Installation/offline need HTTPS (or
localhost). Manifest + icons live in `public/`. On phones (< 700px) the home
constellation is hidden and the particle background runs a smaller swarm.

## How content flows

```
vault markdown ──(scripts/build-content.ts)──► src/data/modules/NN.json   (typed blocks, KaTeX pre-rendered)
content/evals/NN.json  ──(same script)──────► src/data/evals/NN.json     (markdown fields → HTML)
```

- `content/evals/*.json` is the **authored source of truth** for quizzes and exercises —
  edit these, then `npm run sync`.
- `src/data/` is generated; never hand-edit.
- Schemas (zod) for both live in `shared/schema.ts`; `sync` fails loudly on violations
  (missing sections, unresolved wikilinks, bad LaTeX, quiz with ≠1 correct answer, …).

## Progress

Stored in `localStorage` (`tlad-progress-v1`): sections read, checklist ticks, best quiz
scores, exercises done. Export/import buttons are at the bottom of the home page.
