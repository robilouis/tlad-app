/**
 * sync-local — generate `src/data/` entries for modules authored in-repo under
 * `content/modules/`, without the full Obsidian vault.
 *
 * The canonical pipeline (`npm run sync`, scripts/build-content.ts) rebuilds the
 * whole of `src/data/` from the external vault, which is not present in this
 * repo. This script lets a module be authored and shipped here: it parses the
 * staged vault-format markdown with the SAME parser, renders its evals with the
 * SAME renderer, runs the SAME validations, then MERGES the results into the
 * existing generated data (rather than rebuilding from scratch).
 *
 * It is deliberately additive and idempotent: re-running replaces only the
 * staged modules' artifacts and re-derives their graph edges. Neighbour
 * prev/next links are back-filled only where currently null, so it never
 * clobbers the hand-authored linear chain.
 *
 * A sidecar `content/modules/meta.json` supplies what the vault's index note
 * would ({ "21": { "partIndex": 3, "addon": true }, ... }).
 *
 * See content/modules/README.md for how to migrate these files into the vault
 * so a future `npm run sync` reproduces them.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  GraphSchema,
  IndexDataSchema,
  ModuleEvalsSchema,
  ModuleSchema,
  type GraphData,
  type IndexData,
  type ModuleData,
  type ModuleEvals,
  type ModuleMeta,
} from '../shared/schema';
import { DATA_DIR, EVALS_SRC_DIR, ROOT } from './config';
import { renderEvals } from './evals';
import { parseModuleFile } from './parse-module';

const MODULES_SRC_DIR = path.join(ROOT, 'content', 'modules');
const REQUIRED_KINDS = ['objectives', 'concepts', 'missions', 'tools', 'overkill', 'resources', 'artifacts', 'self-assessment'];

const errors: string[] = [];
function fail(msg: string) {
  errors.push(msg);
}
function done() {
  if (errors.length > 0) {
    console.error(`\n✗ sync-local failed with ${errors.length} error(s):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}
function writeJson(p: string, value: unknown) {
  fs.writeFileSync(p, JSON.stringify(value, null, 1));
}

// diagrams keep [[...]] verbatim; tex is raw LaTeX — same carve-out as build-content
function checkNoRawWikilinks(value: unknown, where: string) {
  if (typeof value === 'string') {
    if (value.includes('[[')) fail(`${where}: unresolved wikilink in HTML output`);
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => checkNoRawWikilinks(v, `${where}[${i}]`));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'text' || k === 'tex') continue;
      checkNoRawWikilinks(v, `${where}.${k}`);
    }
  }
}

// ---------- 1. load existing generated data + staged sources ----------

const index = readJson<IndexData>(path.join(DATA_DIR, 'index.json'));
const graph = readJson<GraphData>(path.join(DATA_DIR, 'graph.json'));

const stagedFiles = fs
  .readdirSync(MODULES_SRC_DIR)
  .filter((f) => /^\d{2} - .*\.md$/.test(f))
  .sort();

if (stagedFiles.length === 0) fail(`no staged module files in ${MODULES_SRC_DIR}`);

const metaPath = path.join(MODULES_SRC_DIR, 'meta.json');
const sidecar = fs.existsSync(metaPath) ? readJson<Record<string, { partIndex: number; addon: boolean }>>(metaPath) : {};

const stagedIds = new Set(stagedFiles.map((f) => f.slice(0, 2)));
const existingIds = new Set(index.modules.map((m) => m.id));
for (const id of stagedIds) {
  if (!sidecar[id]) fail(`meta.json: missing entry for staged module ${id}`);
}

// basename -> id map for wikilink resolution: existing modules (reconstructed as
// they appear in the vault, "NN - Title") plus the staged files themselves
const moduleByBasename = new Map<string, string>();
for (const m of index.modules) moduleByBasename.set(`${m.id} - ${m.title}`, m.id);
for (const f of stagedFiles) moduleByBasename.set(f.replace(/\.md$/, ''), f.slice(0, 2));

const partLabel = new Map(index.parts.map((p) => [p.index, p.label]));

done(); // stop before parsing if the staging inputs are malformed

// ---------- 2. parse staged modules + evals ----------

interface Built {
  module: ModuleData;
  links: string[];
}

const built: Built[] = [];
const evalsToWrite = new Map<string, ModuleEvals>();

for (const f of stagedFiles) {
  const id = f.slice(0, 2);
  const src = fs.readFileSync(path.join(MODULES_SRC_DIR, f), 'utf8');
  const parsed = parseModuleFile(src, id, moduleByBasename);
  const side = sidecar[id];

  // evals (authored source of truth in content/evals/NN.json)
  let evals: ModuleEvals | undefined;
  const evalPath = path.join(EVALS_SRC_DIR, `${id}.json`);
  if (!fs.existsSync(evalPath)) {
    fail(`evals: missing ${id}.json`);
  } else {
    const result = ModuleEvalsSchema.safeParse(readJson(evalPath));
    if (!result.success) {
      fail(`evals ${id}.json: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    } else {
      if (result.data.moduleId !== id) fail(`evals ${id}.json: moduleId is "${result.data.moduleId}"`);
      const conceptIds = new Set(
        parsed.sections.filter((s) => s.kind === 'concepts').flatMap((s) => s.subsections.map((x) => x.id)),
      );
      for (const q of result.data.quiz) {
        if (q.conceptRef && !conceptIds.has(q.conceptRef)) {
          fail(`evals ${id}.json: question "${q.id}" conceptRef "${q.conceptRef}" matches no Key Concepts subsection (valid: ${[...conceptIds].join(', ')})`);
        }
      }
      const ids = result.data.quiz.map((q) => q.id).concat(result.data.exercises.map((e) => e.id));
      if (new Set(ids).size !== ids.length) fail(`evals ${id}.json: duplicate quiz/exercise ids`);
      try {
        evals = renderEvals(result.data);
      } catch (e) {
        fail(`evals ${id}.json: markdown/KaTeX rendering failed — ${(e as Error).message}`);
      }
    }
  }

  const module: ModuleData = {
    id,
    title: parsed.title,
    weeks: parsed.weeks,
    part: partLabel.get(side?.partIndex) ?? 'Unknown',
    partIndex: side?.partIndex ?? 1,
    addon: side?.addon ?? false,
    pitchHtml: parsed.pitchHtml,
    prev: parsed.prev,
    next: parsed.next,
    sectionCount: parsed.sections.length,
    quizCount: evals?.quiz.length ?? 0,
    exerciseCount: evals?.exercises.length ?? 0,
    sections: parsed.sections,
  };

  built.push({ module, links: parsed.links });

  // ---------- validation (mirrors build-content §5) ----------
  const kinds = new Set(module.sections.map((s) => s.kind));
  for (const k of REQUIRED_KINDS) if (!kinds.has(k as never)) fail(`module ${id}: missing section kind "${k}"`);
  const schemaResult = ModuleSchema.safeParse(module);
  if (!schemaResult.success) {
    fail(`module ${id}: schema — ${schemaResult.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  checkNoRawWikilinks(module, `module ${id}`);
  const knownTargets = new Set([...existingIds, ...stagedIds, '00']);
  for (const target of new Set(parsed.links)) {
    if (!knownTargets.has(target)) fail(`module ${id}: link to unknown module ${target}`);
  }

  // evals must render (only relevant if authored) — store for write step
  if (evals) evalsToWrite.set(id, evals);
}

done();

// ---------- 3. merge into index.json ----------

const newMetas: ModuleMeta[] = built.map(({ module }) => {
  const { sections: _sections, ...meta } = module;
  void _sections;
  return meta;
});

// neighbour back-fill: only fill a prev/next that is currently null, and only
// for an existing (non-staged) neighbour — never overwrite the authored chain
const metaById = new Map<string, ModuleMeta>();
for (const m of index.modules) metaById.set(m.id, m);
const patchedNeighbours = new Set<string>();
for (const meta of newMetas) {
  if (meta.prev && existingIds.has(meta.prev) && !stagedIds.has(meta.prev)) {
    const n = metaById.get(meta.prev)!;
    if (n.next === null) {
      n.next = meta.id;
      patchedNeighbours.add(meta.prev);
    }
  }
  if (meta.next && existingIds.has(meta.next) && !stagedIds.has(meta.next)) {
    const n = metaById.get(meta.next)!;
    if (n.prev === null) {
      n.prev = meta.id;
      patchedNeighbours.add(meta.next);
    }
  }
}

index.modules = [...index.modules.filter((m) => !stagedIds.has(m.id)), ...newMetas].sort((a, b) => a.id.localeCompare(b.id));

// ---------- 4. merge into graph.json ----------

// drop any edges/nodes touching a staged id (idempotent re-run), then re-add
const edgeWeights = new Map<string, number>();
for (const e of graph.edges) {
  if (stagedIds.has(e.source) || stagedIds.has(e.target)) continue;
  edgeWeights.set(`${e.source}->${e.target}`, e.weight);
}
for (const { module, links } of built) {
  for (const target of links) {
    if (target === '00' || target === module.id) continue;
    const [a, b] = [module.id, target].sort();
    const key = `${a}->${b}`;
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
  }
}
graph.edges = [...edgeWeights.entries()].map(([key, weight]) => {
  const [source, target] = key.split('->');
  return { source, target, weight };
});
graph.nodes = [
  ...graph.nodes.filter((n) => !stagedIds.has(n.id)),
  ...built.map(({ module: m }) => ({ id: m.id, title: m.title, partIndex: m.partIndex, addon: m.addon, weeks: m.weeks })),
].sort((a, b) => a.id.localeCompare(b.id));

// ---------- 5. final validation ----------

const indexResult = IndexDataSchema.safeParse(index);
if (!indexResult.success) fail(`index.json: ${indexResult.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
const graphResult = GraphSchema.safeParse(graph);
if (!graphResult.success) fail(`graph.json: ${graphResult.error.issues.slice(0, 3).map((i) => i.message).join('; ')}`);
done();

// ---------- 6. write ----------

for (const { module } of built) {
  writeJson(path.join(DATA_DIR, 'modules', `${module.id}.json`), module);
}
for (const [id, evals] of evalsToWrite) {
  writeJson(path.join(DATA_DIR, 'evals', `${id}.json`), evals);
}
// persist neighbour prev/next patches into their own module files
for (const id of patchedNeighbours) {
  const p = path.join(DATA_DIR, 'modules', `${id}.json`);
  const mod = readJson<ModuleData>(p);
  mod.prev = metaById.get(id)!.prev;
  mod.next = metaById.get(id)!.next;
  writeJson(p, mod);
}
writeJson(path.join(DATA_DIR, 'index.json'), index);
writeJson(path.join(DATA_DIR, 'graph.json'), graph);

const ids = built.map((b) => b.module.id).join(', ');
console.log(`✓ sync-local ok: merged modules ${ids} (${index.modules.length} total), ${graph.edges.length} graph edges`);
if (patchedNeighbours.size > 0) console.log(`  ↳ back-filled prev/next on: ${[...patchedNeighbours].join(', ')}`);
