import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY, mergeProgress, parseProgress, type ProgressState } from './merge';

const A: ProgressState = {
  sectionsRead: { '01/objectives': 100, '01/concepts': 200 },
  checklists: { '01/artifacts/1': true, '01/artifacts/2': false },
  quiz: { '01': { best: 4, total: 6, attempts: 2 } },
  exercises: { '01/ex1': 500 },
};

const B: ProgressState = {
  sectionsRead: { '01/objectives': 90, '02/objectives': 300 }, // earlier ts for shared key
  checklists: { '01/artifacts/2': true, '01/artifacts/3': true }, // flips 2 to checked
  quiz: { '01': { best: 5, total: 6, attempts: 1 }, '02': { best: 3, total: 6, attempts: 1 } },
  exercises: { '02/ex1': 600 },
};

test('union of sections + exercises, keeping the earliest timestamp', () => {
  const m = mergeProgress(A, B);
  assert.equal(m.sectionsRead['01/objectives'], 90); // min(100, 90)
  assert.equal(m.sectionsRead['01/concepts'], 200);
  assert.equal(m.sectionsRead['02/objectives'], 300);
  assert.deepEqual(m.exercises, { '01/ex1': 500, '02/ex1': 600 });
});

test('checklists OR — checked on any device wins', () => {
  const m = mergeProgress(A, B);
  assert.equal(m.checklists['01/artifacts/1'], true);
  assert.equal(m.checklists['01/artifacts/2'], true); // false OR true
  assert.equal(m.checklists['01/artifacts/3'], true);
});

test('quiz keeps best score and max attempts, merges new modules', () => {
  const m = mergeProgress(A, B);
  assert.deepEqual(m.quiz['01'], { best: 5, total: 6, attempts: 2 });
  assert.deepEqual(m.quiz['02'], { best: 3, total: 6, attempts: 1 });
});

test('commutative: merge(a,b) equals merge(b,a)', () => {
  assert.deepEqual(mergeProgress(A, B), mergeProgress(B, A));
});

test('idempotent: merge(a,a) equals a, merge(m,a) adds nothing new', () => {
  assert.deepEqual(mergeProgress(A, A), A);
  const m = mergeProgress(A, B);
  assert.deepEqual(mergeProgress(m, A), m);
  assert.deepEqual(mergeProgress(m, B), m);
});

test('identity: merging EMPTY changes nothing', () => {
  assert.deepEqual(mergeProgress(A, EMPTY), A);
  assert.deepEqual(mergeProgress(EMPTY, A), A);
});

test('parseProgress rejects non-objects, coerces partial/malformed input', () => {
  assert.equal(parseProgress(null), null);
  assert.equal(parseProgress('nope'), null);
  assert.equal(parseProgress(42), null);

  // malformed sub-fields are dropped, not fatal
  const cleaned = parseProgress({
    sectionsRead: { good: 5, bad: 'x' },
    checklists: { good: true, bad: 1 },
    quiz: { ok: { best: 1, total: 6, attempts: 1 }, bad: { best: 'x' } },
    exercises: { good: 7 },
    junk: 'ignored',
  });
  assert.deepEqual(cleaned, {
    sectionsRead: { good: 5 },
    checklists: { good: true },
    quiz: { ok: { best: 1, total: 6, attempts: 1 } },
    exercises: { good: 7 },
  });

  // empty object → empty state (not null)
  assert.deepEqual(parseProgress({}), EMPTY);
});
