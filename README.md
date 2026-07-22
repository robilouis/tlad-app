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
| `npm test` | Unit tests for the progress-merge logic (`shared/merge.test.ts`) |
| `npm run worker:dev` | Run the Cloudflare Worker locally (`dist/` + `/api` against a local D1) |
| `npm run deploy` | Build + `wrangler deploy` (Worker + assets) |
| `npm run db:migrate` | Apply D1 migrations to the remote database |
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

### Locally-staged modules (when the vault isn't present)

Some modules are authored **directly in the repo** under `content/modules/` (vault-format
markdown + a small `meta.json`) for environments where the Obsidian vault isn't available.
`npm run sync:local` (`scripts/build-content.ts`'s eval renderer is shared via
`scripts/evals.ts`) parses them with the same parser, runs the same zod validation, and
**merges** them into the generated `src/data/` instead of rebuilding from the vault. See
[`content/modules/README.md`](content/modules/README.md) for the mechanism and the steps to
fold a staged module back into the vault. Note: the `sync` file-count guard now expects the
staged modules to exist in the vault too, so a full `npm run sync` fails loudly until they're
migrated — this is deliberate, so a vault-only sync can't silently drop them.

## Progress

Local-first in `localStorage` (`tlad-progress-v1`): sections read, checklist ticks, best
quiz scores, exercises done. Export/import buttons are at the bottom of the home page
(import now **merges** rather than overwrites, so it can never wipe newer progress).

**Cross-device sync (optional).** When served by the Cloudflare Worker, progress also
syncs through `/api/progress` (D1, gated by Cloudflare Access), so multiple devices
converge. The sync is a commutative/idempotent **merge** — devices never clobber each
other. If no backend is present (plain static hosting, offline), the app silently stays
localStorage-only. Merge logic lives in `shared/merge.ts` (shared by the client and the
Worker); the Worker is `worker/`. See [`docs/cloudflare-setup.md`](docs/cloudflare-setup.md)
for the one-time provisioning steps.

## Hosting

Deployed as a Cloudflare Worker (`wrangler.toml`) that serves the static build and the
sync API. `.github/workflows/deploy.yml` builds, tests, and deploys on push to `main`.
The build is still fully static, so it also runs from any plain static host — just
without sync.
