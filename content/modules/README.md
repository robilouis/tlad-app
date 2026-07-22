# Locally-staged modules

This directory holds **vault-format module sources authored directly in the repo**, for
modules that are not (yet) in the external Obsidian vault the canonical `npm run sync`
reads from (`../robilouis-pro/Learning/Tech Lead AI & Data Path/`).

It exists because the vault is not always present in every environment (CI, the web app,
a fresh clone), but a new module still needs to be authored, validated, and shipped.

## What's here

| File | Purpose |
| --- | --- |
| `NN - Title.md` | A module in the **exact same markdown format as a vault note** (H1, `> **Weeks…**` blockquote, the 8 `##` sections). |
| `meta.json` | The bits the vault's `00 - Index…` note would supply: `{ "NN": { "partIndex": N, "addon": bool } }`. |

Quizzes/exercises for these modules live in `../evals/NN.json` exactly like every other
module — that path is shared by both sync scripts, so nothing special is needed there.

## How it ships

`npm run sync:local` (`scripts/sync-local.ts`) parses these files with the **same** parser
as the full sync (`scripts/parse-module.ts`), renders their evals with the **same** renderer
(`scripts/evals.ts`), runs the **same** validations (all 8 section kinds, `ModuleSchema`,
`ModuleEvalsSchema`, `conceptRef` ↔ Key-Concepts slugs, no unresolved `[[wikilinks]]`), then
**merges** the results into the already-generated `src/data/` (rather than rebuilding the whole
tree from the vault). It is additive and idempotent: re-running only touches the staged modules'
artifacts and re-derives their graph edges, and it back-fills a neighbour's `prev`/`next` only
where it is currently `null` (so it never clobbers the hand-authored chain).

```
content/modules/NN - Title.md ─┐
content/modules/meta.json      ├─ npm run sync:local ─► src/data/modules/NN.json
content/evals/NN.json          ┘                        src/data/evals/NN.json
                                                        + merged into index.json / graph.json
```

## Migrating a staged module into the Obsidian vault (the canonical home)

When you next have the vault, fold these in so a full `npm run sync` reproduces them and this
staging becomes redundant. For the two modules currently staged (**21 — Model Context Protocol
(MCP)**, **22 — World Models**):

1. **Copy** `21 - Model Context Protocol (MCP).md` and `22 - World Models.md` into the vault
   directory verbatim.
2. In the vault's `00 - Index…` note, add two rows to the timeline table, under Part III as
   add-ons (match the existing table's column layout — the parser reads
   `| Part | Weeks | [[NN - Title]] |`):

   ```
   | III — Deep Learning & Modern AI (add-on) | 40-41 | [[21 - Model Context Protocol (MCP)]] |
   | III — Deep Learning & Modern AI (add-on) | 42-43 | [[22 - World Models]]                 |
   ```

   The `(add-on)` in the label is what sets `addon: true`; the Roman numeral sets the part.
3. **Update module 20's** metadata blockquote so the linear chain continues into 21 — add
   `Next: [[21 - Model Context Protocol (MCP)]]` (module 20 currently ends its add-on chain with
   `Next: ` empty). Modules 21 and 22 already carry the correct `Previous:`/`Next:` lines.
4. *(Optional, nice-to-have)* in module 11's "Tools & Vendor Landscape" table, turn the existing
   plain-text **MCP** mention into a `[[21 - Model Context Protocol (MCP)]]` wikilink.
5. Run `npm run sync`. The file-count guard now expects **23** vault files (`00` + 22 modules);
   see the note below.

The evals (`content/evals/21.json`, `content/evals/22.json`) are already in the right place and
are consumed by both scripts — no move needed.

## Why the sync counts were bumped (safety, not bureaucracy)

To keep a future full `npm run sync` from **silently deleting** modules 21/22 (because the vault
wouldn't know about them), three hard-coded counts were raised to assume 22 modules:

- `shared/schema.ts` — `IndexDataSchema.modules` length `20 → 22`
- `scripts/build-content.ts` — expected vault files `21 → 23`, and the summary log `/20 → /22`

Consequence: until you complete the migration above, `npm run sync` will **fail loudly**
("expected 23 vault files, found 21") instead of quietly regenerating a 20-module site that drops
these two. That failure is the intended guardrail — run `npm run sync:local` in the meantime, and
switch back to `npm run sync` once the vault contains all 23 notes.
