// Validate a single authored eval file without writing anything.
// Usage: npx tsx scripts/check-eval.ts 09
import fs from 'node:fs';
import path from 'node:path';
import { ModuleEvalsSchema } from '../shared/schema';
import { EVALS_SRC_DIR, VAULT_DIR } from './config';
import { mdStringToHtml } from './markdown';
import { parseModuleFile } from './parse-module';

const id = process.argv[2];
if (!/^\d{2}$/.test(id ?? '')) {
  console.error('usage: npx tsx scripts/check-eval.ts <NN>');
  process.exit(2);
}

const errors: string[] = [];

const vaultFile = fs.readdirSync(VAULT_DIR).find((f) => f.startsWith(`${id} - `));
if (!vaultFile) {
  console.error(`no vault module ${id}`);
  process.exit(2);
}
const moduleByBasename = new Map<string, string>();
for (const f of fs.readdirSync(VAULT_DIR)) {
  if (/^\d{2} - .*\.md$/.test(f)) moduleByBasename.set(f.replace(/\.md$/, ''), f.slice(0, 2));
}
const mod = parseModuleFile(fs.readFileSync(path.join(VAULT_DIR, vaultFile), 'utf8'), id, moduleByBasename);
const conceptIds = new Set(mod.sections.filter((s) => s.kind === 'concepts').flatMap((s) => s.subsections.map((x) => x.id)));

const evalPath = path.join(EVALS_SRC_DIR, `${id}.json`);
if (!fs.existsSync(evalPath)) {
  console.error(`missing ${evalPath}`);
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
} catch (e) {
  console.error(`invalid JSON: ${(e as Error).message}`);
  process.exit(1);
}

const result = ModuleEvalsSchema.safeParse(raw);
if (!result.success) {
  for (const i of result.error.issues) errors.push(`${i.path.join('.')}: ${i.message}`);
} else {
  const data = result.data;
  if (data.moduleId !== id) errors.push(`moduleId "${data.moduleId}" != ${id}`);
  for (const q of data.quiz) {
    if (q.conceptRef && !conceptIds.has(q.conceptRef)) {
      errors.push(`question "${q.id}": conceptRef "${q.conceptRef}" invalid.\n  valid ids: ${[...conceptIds].join(', ')}`);
    }
  }
  const ids = data.quiz.map((q) => q.id).concat(data.exercises.map((e) => e.id));
  if (new Set(ids).size !== ids.length) errors.push('duplicate quiz/exercise ids');
  // every markdown field must render (catches bad LaTeX)
  const tryRender = (s: string, where: string) => {
    try {
      mdStringToHtml(s);
    } catch (e) {
      errors.push(`${where}: render failed — ${(e as Error).message}`);
    }
  };
  for (const q of data.quiz) {
    tryRender(q.prompt, `quiz ${q.id} prompt`);
    tryRender(q.takeaway, `quiz ${q.id} takeaway`);
    q.choices.forEach((c) => {
      tryRender(c.text, `quiz ${q.id} choice ${c.id}`);
      tryRender(c.explanation, `quiz ${q.id} choice ${c.id} explanation`);
    });
  }
  for (const ex of data.exercises) {
    tryRender(ex.scenario, `exercise ${ex.id} scenario`);
    tryRender(ex.solution, `exercise ${ex.id} solution`);
    [...(ex.givens ?? []), ...ex.tasks, ...ex.rubric.keyPoints, ...ex.rubric.pitfalls, ...ex.rubric.takeaways, ex.rubric.transfer].forEach(
      (s, i) => tryRender(s, `exercise ${ex.id} field ${i}`),
    );
  }
}

if (errors.length > 0) {
  console.error(`✗ ${id}.json: ${errors.length} error(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✓ ${id}.json valid (${(raw as { quiz: unknown[] }).quiz.length} questions)`);
