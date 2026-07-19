/**
 * Progress state + a pure merge. Shared by the client (`src/lib/progress.tsx`),
 * the sync Worker (`worker/index.ts`), and JSON import.
 *
 * The merge is the spine of multi-device sync: it is commutative, idempotent,
 * and monotonic, so two devices that each hold part of the truth converge to
 * the union instead of clobbering each other. It is also what makes `importJson`
 * safe (importing an older file can no longer wipe newer progress).
 */

export interface QuizResult {
  best: number;
  total: number;
  attempts: number;
}

export interface ProgressState {
  sectionsRead: Record<string, number>; // "09/key-concepts" -> timestamp
  checklists: Record<string, boolean>; // "09/practical-artifacts/1/3" -> checked
  quiz: Record<string, QuizResult>; // "09" -> best/total/attempts
  exercises: Record<string, number>; // "09/ex1" -> timestamp
}

export const EMPTY: ProgressState = { sectionsRead: {}, checklists: {}, quiz: {}, exercises: {} };

/** Union of two timestamp maps, keeping the earliest time an item was reached. */
function mergeEarliest(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? Math.min(out[k], v) : v;
  return out;
}

/** Per-key OR — an item checked on any device stays checked (bias to checked). */
function mergeChecklists(a: Record<string, boolean>, b: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = !!out[k] || !!v;
  return out;
}

/** Per-module: keep the best score, the highest attempt count, and a real total. */
function mergeQuiz(a: Record<string, QuizResult>, b: Record<string, QuizResult>): Record<string, QuizResult> {
  const out: Record<string, QuizResult> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const prev = out[k];
    out[k] = prev
      ? { best: Math.max(prev.best, v.best), total: v.total || prev.total, attempts: Math.max(prev.attempts, v.attempts) }
      : v;
  }
  return out;
}

/** Merge two progress states into their union. Commutative and idempotent. */
export function mergeProgress(a: ProgressState, b: ProgressState): ProgressState {
  return {
    sectionsRead: mergeEarliest(a.sectionsRead, b.sectionsRead),
    exercises: mergeEarliest(a.exercises, b.exercises),
    checklists: mergeChecklists(a.checklists, b.checklists),
    quiz: mergeQuiz(a.quiz, b.quiz),
  };
}

/**
 * Coerce untrusted input (localStorage, an imported file, an API response) into
 * a clean ProgressState, dropping any malformed entries. Returns null only when
 * the input is not an object at all — the caller treats that as "reject".
 */
export function parseProgress(raw: unknown): ProgressState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: ProgressState = { sectionsRead: {}, checklists: {}, quiz: {}, exercises: {} };

  const numMap = (src: unknown, dst: Record<string, number>) => {
    if (src && typeof src === 'object') {
      for (const [k, v] of Object.entries(src)) if (typeof v === 'number' && Number.isFinite(v)) dst[k] = v;
    }
  };
  numMap(r.sectionsRead, out.sectionsRead);
  numMap(r.exercises, out.exercises);

  if (r.checklists && typeof r.checklists === 'object') {
    for (const [k, v] of Object.entries(r.checklists)) if (typeof v === 'boolean') out.checklists[k] = v;
  }
  if (r.quiz && typeof r.quiz === 'object') {
    for (const [k, v] of Object.entries(r.quiz)) {
      if (v && typeof v === 'object') {
        const q = v as Record<string, unknown>;
        if (typeof q.best === 'number' && typeof q.total === 'number' && typeof q.attempts === 'number') {
          out.quiz[k] = { best: q.best, total: q.total, attempts: q.attempts };
        }
      }
    }
  }
  return out;
}
