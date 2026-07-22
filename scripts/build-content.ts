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
} from '../shared/schema';
import { DATA_DIR, EVALS_SRC_DIR, VAULT_DIR } from './config';
import { renderEvals } from './evals';
import { parseIndexFile, parseModuleFile, type ParsedModule } from './parse-module';

const errors: string[] = [];
const warnings: string[] = [];

function fail(msg: string) {
  errors.push(msg);
}

// ---------- 1. discover vault files ----------

const files = fs
  .readdirSync(VAULT_DIR)
  .filter((f) => /^\d{2} - .*\.md$/.test(f))
  .sort();

if (files.length !== 23) fail(`expected 23 vault files, found ${files.length}`);

const moduleByBasename = new Map<string, string>();
for (const f of files) moduleByBasename.set(f.replace(/\.md$/, ''), f.slice(0, 2));

// ---------- 2. parse index + modules ----------

const indexSrc = fs.readFileSync(path.join(VAULT_DIR, files.find((f) => f.startsWith('00'))!), 'utf8');
const { home, timeline, parts } = parseIndexFile(indexSrc, moduleByBasename);

const parsed: ParsedModule[] = [];
for (const f of files) {
  const id = f.slice(0, 2);
  if (id === '00') continue;
  parsed.push(parseModuleFile(fs.readFileSync(path.join(VAULT_DIR, f), 'utf8'), id, moduleByBasename));
}

// ---------- 3. evals: validate authored sources, render markdown -> HTML ----------

const evalsById = new Map<string, ModuleEvals>();
for (const mod of parsed) {
  const srcPath = path.join(EVALS_SRC_DIR, `${mod.id}.json`);
  if (!fs.existsSync(srcPath)) {
    warnings.push(`evals: missing ${mod.id}.json (module will ship without quiz/exercises)`);
    continue;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  } catch (e) {
    fail(`evals ${mod.id}.json: invalid JSON — ${(e as Error).message}`);
    continue;
  }
  const result = ModuleEvalsSchema.safeParse(raw);
  if (!result.success) {
    fail(`evals ${mod.id}.json: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    continue;
  }
  if (result.data.moduleId !== mod.id) fail(`evals ${mod.id}.json: moduleId is "${result.data.moduleId}"`);

  // conceptRefs must point at real Key Concepts subsections
  const conceptIds = new Set(mod.sections.filter((s) => s.kind === 'concepts').flatMap((s) => s.subsections.map((x) => x.id)));
  for (const q of result.data.quiz) {
    if (q.conceptRef && !conceptIds.has(q.conceptRef)) {
      fail(`evals ${mod.id}.json: question "${q.id}" conceptRef "${q.conceptRef}" matches no Key Concepts subsection (valid: ${[...conceptIds].join(', ')})`);
    }
  }
  const ids = result.data.quiz.map((q) => q.id).concat(result.data.exercises.map((e) => e.id));
  if (new Set(ids).size !== ids.length) fail(`evals ${mod.id}.json: duplicate quiz/exercise ids`);

  try {
    evalsById.set(mod.id, renderEvals(result.data));
  } catch (e) {
    fail(`evals ${mod.id}.json: markdown/KaTeX rendering failed — ${(e as Error).message}`);
  }
}

// ---------- 4. assemble modules ----------

const REQUIRED_KINDS = ['objectives', 'concepts', 'missions', 'tools', 'overkill', 'resources', 'artifacts', 'self-assessment'];

const modules: ModuleData[] = parsed.map((mod) => {
  const t = timeline.get(mod.id);
  if (!t) fail(`module ${mod.id}: missing from the index timeline table`);
  const evals = evalsById.get(mod.id);
  return {
    id: mod.id,
    title: mod.title,
    weeks: mod.weeks,
    part: t?.part ?? 'Unknown',
    partIndex: t?.partIndex ?? 1,
    addon: t?.addon ?? false,
    pitchHtml: mod.pitchHtml,
    prev: mod.prev,
    next: mod.next,
    sectionCount: mod.sections.length,
    quizCount: evals?.quiz.length ?? 0,
    exerciseCount: evals?.exercises.length ?? 0,
    sections: mod.sections,
  };
});

// ---------- 5. structural validation ----------

function checkNoRawWikilinks(value: unknown, where: string) {
  if (typeof value === 'string') {
    if (value.includes('[[')) fail(`${where}: unresolved wikilink in HTML output`);
    return;
  }
  if (Array.isArray(value)) value.forEach((v, i) => checkNoRawWikilinks(v, `${where}[${i}]`));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'text' || k === 'tex') continue; // diagrams keep [[...]] verbatim; tex is raw LaTeX
      checkNoRawWikilinks(v, `${where}.${k}`);
    }
  }
}

for (const mod of modules) {
  const kinds = new Set(mod.sections.map((s) => s.kind));
  for (const k of REQUIRED_KINDS) {
    if (!kinds.has(k as never)) fail(`module ${mod.id}: missing section kind "${k}"`);
  }
  const result = ModuleSchema.safeParse(mod);
  if (!result.success) {
    fail(`module ${mod.id}: schema — ${result.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  checkNoRawWikilinks(mod, `module ${mod.id}`);
  for (const target of new Set(parsed.find((p) => p.id === mod.id)!.links)) {
    if (target !== '00' && !parsed.some((p) => p.id === target)) fail(`module ${mod.id}: link to unknown module ${target}`);
  }
}

// ---------- 6. graph ----------

const edgeWeights = new Map<string, number>();
for (const mod of parsed) {
  for (const target of mod.links) {
    if (target === '00' || target === mod.id) continue;
    const [a, b] = [mod.id, target].sort();
    const key = `${a}->${b}`;
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
  }
}
const graph: GraphData = {
  nodes: modules.map((m) => ({ id: m.id, title: m.title, partIndex: m.partIndex, addon: m.addon, weeks: m.weeks })),
  edges: [...edgeWeights.entries()].map(([key, weight]) => {
    const [source, target] = key.split('->');
    return { source, target, weight };
  }),
};

const indexData: IndexData = {
  modules: modules.map(({ sections: _sections, ...meta }) => meta),
  parts,
  home,
};

// ---------- 7. final validation + write ----------

const indexResult = IndexDataSchema.safeParse(indexData);
if (!indexResult.success) fail(`index.json: ${indexResult.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
const graphResult = GraphSchema.safeParse(graph);
if (!graphResult.success) fail(`graph.json: ${graphResult.error.issues.slice(0, 3).map((i) => i.message).join('; ')}`);

if (errors.length > 0) {
  console.error(`\n✗ sync failed with ${errors.length} error(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

fs.mkdirSync(path.join(DATA_DIR, 'modules'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'evals'), { recursive: true });
fs.writeFileSync(path.join(DATA_DIR, 'index.json'), JSON.stringify(indexData, null, 1));
fs.writeFileSync(path.join(DATA_DIR, 'graph.json'), JSON.stringify(graph, null, 1));
for (const mod of modules) {
  fs.writeFileSync(path.join(DATA_DIR, 'modules', `${mod.id}.json`), JSON.stringify(mod, null, 1));
}
for (const [id, evals] of evalsById) {
  fs.writeFileSync(path.join(DATA_DIR, 'evals', `${id}.json`), JSON.stringify(evals, null, 1));
}

const blockCount = modules.reduce(
  (acc, m) => acc + m.sections.reduce((a, s) => a + s.blocks.length + s.subsections.reduce((b, x) => b + x.blocks.length, 0), 0),
  0,
);
console.log(`✓ sync ok: ${modules.length} modules, ${blockCount} blocks, ${graph.edges.length} graph edges, ${evalsById.size}/22 eval files`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
