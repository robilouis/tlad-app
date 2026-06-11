import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ModuleMeta } from '../../shared/schema';

const STORAGE_KEY = 'tlad-progress-v1';

export interface ProgressState {
  sectionsRead: Record<string, number>; // "09/key-concepts" -> timestamp
  checklists: Record<string, boolean>; // "09/practical-artifacts/1/3" -> checked
  quiz: Record<string, { best: number; total: number; attempts: number }>; // "09"
  exercises: Record<string, number>; // "09/ex1" -> timestamp
}

const EMPTY: ProgressState = { sectionsRead: {}, checklists: {}, quiz: {}, exercises: {} };

function load(): ProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as ProgressState) };
  } catch {
    return EMPTY;
  }
}

interface ProgressApi {
  state: ProgressState;
  markSectionRead: (moduleId: string, sectionId: string) => void;
  isSectionRead: (moduleId: string, sectionId: string) => boolean;
  toggleChecklistItem: (checklistId: string, itemId: string) => void;
  isChecklistItemChecked: (checklistId: string, itemId: string) => boolean;
  recordQuizResult: (moduleId: string, score: number, total: number) => void;
  markExerciseDone: (moduleId: string, exerciseId: string) => void;
  isExerciseDone: (moduleId: string, exerciseId: string) => boolean;
  exportJson: () => string;
  importJson: (json: string) => boolean;
}

const ProgressContext = createContext<ProgressApi | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ProgressState>(load);

  const update = useCallback((fn: (s: ProgressState) => ProgressState) => {
    setState((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage full/unavailable: keep in-memory progress
      }
      return next;
    });
  }, []);

  const api = useMemo<ProgressApi>(
    () => ({
      state,
      markSectionRead: (moduleId, sectionId) =>
        update((s) => ({ ...s, sectionsRead: { ...s.sectionsRead, [`${moduleId}/${sectionId}`]: Date.now() } })),
      isSectionRead: (moduleId, sectionId) => `${moduleId}/${sectionId}` in state.sectionsRead,
      toggleChecklistItem: (checklistId, itemId) =>
        update((s) => {
          const key = `${checklistId}/${itemId}`;
          return { ...s, checklists: { ...s.checklists, [key]: !s.checklists[key] } };
        }),
      isChecklistItemChecked: (checklistId, itemId) => !!state.checklists[`${checklistId}/${itemId}`],
      recordQuizResult: (moduleId, score, total) =>
        update((s) => {
          const prev = s.quiz[moduleId];
          return {
            ...s,
            quiz: {
              ...s.quiz,
              [moduleId]: { best: Math.max(prev?.best ?? 0, score), total, attempts: (prev?.attempts ?? 0) + 1 },
            },
          };
        }),
      markExerciseDone: (moduleId, exerciseId) =>
        update((s) => ({ ...s, exercises: { ...s.exercises, [`${moduleId}/${exerciseId}`]: Date.now() } })),
      isExerciseDone: (moduleId, exerciseId) => `${moduleId}/${exerciseId}` in state.exercises,
      exportJson: () => JSON.stringify(state, null, 2),
      importJson: (json) => {
        try {
          const parsed = JSON.parse(json) as ProgressState;
          if (typeof parsed !== 'object' || parsed === null) return false;
          update(() => ({ ...EMPTY, ...parsed }));
          return true;
        } catch {
          return false;
        }
      },
    }),
    [state, update],
  );

  return <ProgressContext.Provider value={api}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressApi {
  const ctx = useContext(ProgressContext);
  if (!ctx) throw new Error('useProgress outside ProgressProvider');
  return ctx;
}

/** Completion ratio for one module: sections read + exercises done + quiz attempted. */
export function moduleCompletion(meta: ModuleMeta, state: ProgressState): { done: number; total: number; pct: number } {
  const total = meta.sectionCount + meta.exerciseCount + (meta.quizCount > 0 ? 1 : 0);
  let done = 0;
  for (const key of Object.keys(state.sectionsRead)) if (key.startsWith(`${meta.id}/`)) done++;
  for (const key of Object.keys(state.exercises)) if (key.startsWith(`${meta.id}/`)) done++;
  if (meta.quizCount > 0 && state.quiz[meta.id]) done++;
  return { done, total, pct: total === 0 ? 0 : Math.min(1, done / total) };
}
