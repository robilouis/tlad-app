import type { GraphData, IndexData, ModuleData, ModuleEvals } from '../../shared/schema';
import indexJson from '../data/index.json';
import graphJson from '../data/graph.json';

export const indexData = indexJson as unknown as IndexData;
export const graphData = graphJson as unknown as GraphData;

const moduleLoaders = import.meta.glob<{ default: ModuleData }>('../data/modules/*.json');
const evalLoaders = import.meta.glob<{ default: ModuleEvals }>('../data/evals/*.json');

export function getMeta(id: string) {
  return indexData.modules.find((m) => m.id === id);
}

export async function loadModule(id: string): Promise<ModuleData | null> {
  const loader = moduleLoaders[`../data/modules/${id}.json`];
  if (!loader) return null;
  return (await loader()).default;
}

export async function loadEvals(id: string): Promise<ModuleEvals | null> {
  const loader = evalLoaders[`../data/evals/${id}.json`];
  if (!loader) return null;
  return (await loader()).default;
}

export const PART_HUES: Record<number, string> = {
  1: 'var(--part-1)',
  2: 'var(--part-2)',
  3: 'var(--part-3)',
  4: 'var(--part-4)',
  5: 'var(--part-5)',
  6: 'var(--part-6)',
};

export const PART_HEX: Record<number, string> = {
  1: '#22d3ee',
  2: '#8b5cf6',
  3: '#e879f9',
  4: '#f59e0b',
  5: '#34d399',
  6: '#60a5fa',
};

export const SECTION_KIND_LABELS: Record<string, string> = {
  objectives: 'Objectives',
  concepts: 'Concepts',
  missions: 'Missions',
  tools: 'Tools',
  overkill: 'Overkill?',
  resources: 'Resources',
  artifacts: 'Artifacts',
  'self-assessment': 'Self-check',
  other: 'More',
};
