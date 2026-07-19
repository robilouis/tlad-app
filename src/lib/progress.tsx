import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ModuleMeta } from '../../shared/schema';
import { EMPTY, mergeProgress, parseProgress, type ProgressState } from '../../shared/merge';

export type { ProgressState } from '../../shared/merge';

const STORAGE_KEY = 'tlad-progress-v1';
const API = '/api/progress';
const PUSH_DEBOUNCE_MS = 1500;

function load(): ProgressState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return parseProgress(JSON.parse(raw)) ?? EMPTY;
  } catch {
    return EMPTY;
  }
}

function persist(state: ProgressState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage full/unavailable: keep in-memory progress
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

  // Sync bookkeeping. `stateRef` lets the debounced pusher read the latest state
  // without re-creating callbacks; `syncOff` short-circuits when no API is mounted
  // (e.g. static hosting), so the app stays a pure localStorage app in that case.
  const stateRef = useRef(state);
  stateRef.current = state;
  const dirty = useRef(false);
  const syncOff = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Push local state up; the Worker merges server-side and returns the converged
  // state, which we adopt (without re-scheduling another push).
  const push = useCallback(async () => {
    if (syncOff.current) return;
    dirty.current = false;
    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(stateRef.current),
        credentials: 'include',
      });
      if (res.status === 404) {
        syncOff.current = true; // no sync backend here — go localStorage-only
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const merged = parseProgress(await res.json());
      if (merged) {
        const next = mergeProgress(stateRef.current, merged);
        stateRef.current = next;
        persist(next);
        setState(next);
      }
    } catch {
      dirty.current = true; // transient (offline/5xx): retry on next mutation or reconnect
    }
  }, []);

  const schedulePush = useCallback(() => {
    if (syncOff.current) return;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(push, PUSH_DEBOUNCE_MS);
  }, [push]);

  const update = useCallback(
    (fn: (s: ProgressState) => ProgressState) => {
      setState((prev) => {
        const next = fn(prev);
        stateRef.current = next;
        persist(next);
        return next;
      });
      schedulePush();
    },
    [schedulePush],
  );

  // On mount: pull server state, merge it into local, then push the union back so
  // the server converges (this also uploads any pre-sync localStorage progress).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(API, { credentials: 'include' });
        if (res.status === 404) {
          syncOff.current = true;
          return;
        }
        if (!res.ok) return; // transient this load — stay local, try again next time
        const remote = parseProgress(await res.json());
        if (cancelled || !remote) return;
        const next = mergeProgress(stateRef.current, remote);
        stateRef.current = next;
        persist(next);
        setState(next);
        schedulePush();
      } catch {
        // offline: keep localStorage; a later mutation/reconnect will sync
      }
    })();

    const onOnline = () => {
      if (dirty.current) void push();
    };
    window.addEventListener('online', onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [push, schedulePush]);

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
          const parsed = parseProgress(JSON.parse(json));
          if (!parsed) return false;
          update((s) => mergeProgress(s, parsed));
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
