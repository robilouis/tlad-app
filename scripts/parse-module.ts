import GithubSlugger from 'github-slugger';
import katex from 'katex';
import type { Blockquote, Heading, List, Paragraph, RootContent, Strong } from 'mdast';
import type { Block, CalloutKind, HomeData, Section, SectionKind, Subsection } from '../shared/schema';
import { mdToMdast, mdastToHtml, transformWikilinks } from './markdown';

// ---------- helpers ----------

function toText(node: unknown): string {
  const n = node as { value?: string; children?: unknown[] };
  if (typeof n.value === 'string') return n.value;
  if (Array.isArray(n.children)) return n.children.map(toText).join('');
  return '';
}

function clone<T>(x: T): T {
  return structuredClone(x);
}

const SECTION_KINDS: Array<[RegExp, SectionKind]> = [
  [/^Learning Objectives/i, 'objectives'],
  [/^Key Concepts/i, 'concepts'],
  [/^Client Mission Patterns/i, 'missions'],
  [/^Tools & Vendor Landscape/i, 'tools'],
  [/^When Is This Overkill/i, 'overkill'],
  [/^Resources/i, 'resources'],
  [/^Practical Artifacts/i, 'artifacts'],
  [/^Self-Assessment/i, 'self-assessment'],
];

function sectionKind(title: string): SectionKind {
  for (const [re, kind] of SECTION_KINDS) if (re.test(title)) return kind;
  return 'other';
}

const CALLOUT_LEAD_RE = /^(Intuition|Worked example|Note)\b/i;

function calloutKindOf(lead: string): CalloutKind {
  if (/^Intuition/i.test(lead)) return 'intuition';
  if (/^Worked example/i.test(lead)) return 'worked-example';
  return 'note';
}

interface CalloutLead {
  kind: CalloutKind;
  title: string | null;
}

/** "Intuition — the average hides the spread." -> kind + cleaned title */
function parseCalloutLead(strongText: string): CalloutLead {
  const text = strongText.trim();
  const dash = text.search(/\s*[—–]\s*/);
  if (dash >= 0 && CALLOUT_LEAD_RE.test(text)) {
    const title = text
      .slice(dash)
      .replace(/^\s*[—–]\s*/, '')
      .replace(/\.\s*$/, '');
    return { kind: calloutKindOf(text), title: title || null };
  }
  return { kind: calloutKindOf(text), title: text.replace(/\.\s*$/, '') || null };
}

function leadStrong(p: Paragraph): Strong | null {
  const first = p.children[0];
  return first && first.type === 'strong' ? first : null;
}

function isCalloutBlockquote(node: RootContent): node is Blockquote {
  if (node.type !== 'blockquote') return false;
  const first = node.children[0];
  if (!first || first.type !== 'paragraph') return false;
  const strong = leadStrong(first);
  return strong !== null;
}

function isBoldLeadCallout(node: RootContent): node is Paragraph {
  if (node.type !== 'paragraph') return false;
  const strong = leadStrong(node);
  return strong !== null && CALLOUT_LEAD_RE.test(toText(strong)) && /[—–]/.test(toText(strong));
}

/** Remove the leading strong from the first paragraph; returns cleaned nodes. */
function stripLead(nodes: RootContent[]): RootContent[] {
  const out = clone(nodes);
  const first = out[0];
  if (first && first.type === 'paragraph' && first.children[0]?.type === 'strong') {
    const [, ...rest] = first.children;
    first.children = rest;
    const next = rest[0];
    if (next && next.type === 'text') next.value = next.value.replace(/^\s+/, '');
    if (rest.length === 0) out.shift();
  }
  return out;
}

function isChecklist(node: RootContent): node is List {
  return node.type === 'list' && node.children.length > 0 && node.children.every((li) => typeof li.checked === 'boolean');
}

function inlineHtml(nodes: RootContent[]): string {
  const html = mdastToHtml(nodes);
  const m = html.match(/^<p>([\s\S]*)<\/p>$/);
  return m ? m[1] : html;
}

// ---------- block grouping ----------

function groupBlocks(nodes: RootContent[], checklistIdBase: string, checklistCounter: { n: number }): Block[] {
  const blocks: Block[] = [];
  let htmlBuffer: RootContent[] = [];

  const flush = () => {
    if (htmlBuffer.length > 0) {
      const html = mdastToHtml(htmlBuffer);
      if (html) blocks.push({ type: 'html', html });
      htmlBuffer = [];
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    if (node.type === 'thematicBreak') {
      continue;
    }

    // display math: either a true flow math node (closing $$ on its own line)
    // or — the vault's style — a paragraph that is exactly one `$$...$$` span,
    // which micromark tokenizes as inline math
    const soloInline =
      node.type === 'paragraph' && node.children.length === 1 && node.children[0].type === 'inlineMath'
        ? (node.children[0] as { value: string })
        : null;
    if (node.type === 'math' || soloInline) {
      flush();
      const tex = soloInline ? soloInline.value : (node as { value: string }).value;
      blocks.push({
        type: 'formula',
        tex,
        html: katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: false }),
      });
      continue;
    }

    if (node.type === 'code' && !node.lang) {
      flush();
      blocks.push({ type: 'diagram', text: node.value });
      continue;
    }

    if (isChecklist(node)) {
      flush();
      checklistCounter.n += 1;
      const checklistId = `${checklistIdBase}/${checklistCounter.n}`;
      blocks.push({
        type: 'checklist',
        checklistId,
        items: node.children.map((li, j) => ({ id: String(j), html: inlineHtml(clone(li.children)) })),
      });
      continue;
    }

    if (node.type === 'table') {
      flush();
      blocks.push({ type: 'table', html: mdastToHtml([node]) });
      continue;
    }

    if (isCalloutBlockquote(node)) {
      flush();
      const firstPara = node.children[0] as Paragraph;
      const lead = parseCalloutLead(toText(leadStrong(firstPara)));
      const body = stripLead(node.children);
      const html = body.length > 0 ? mdastToHtml(body) : mdastToHtml(node.children);
      blocks.push({ type: 'callout', kind: lead.kind, title: lead.title, html });
      continue;
    }

    if (isBoldLeadCallout(node)) {
      flush();
      const lead = parseCalloutLead(toText(leadStrong(node)));
      const body: RootContent[] = stripLead([node]);
      // absorb the example's continuation: plain paragraphs and lists only —
      // any other node type (heading, blockquote, table, …) or a new bold lead
      // is a structural boundary
      while (i + 1 < nodes.length) {
        const next = nodes[i + 1];
        if (next.type !== 'paragraph' && next.type !== 'list') break;
        if (isBoldLeadCallout(next)) break;
        body.push(next);
        i++;
      }
      blocks.push({ type: 'callout', kind: lead.kind, title: lead.title, html: mdastToHtml(body) });
      continue;
    }

    htmlBuffer.push(node);
  }
  flush();
  return blocks;
}

// ---------- module parsing ----------

export interface ParsedModule {
  id: string;
  title: string;
  weeks: [number, number] | null;
  pitchHtml: string;
  prev: string | null;
  next: string | null;
  sections: Section[];
  links: string[];
}

export function parseModuleFile(src: string, id: string, moduleByBasename: Map<string, string>): ParsedModule {
  // metadata from raw source (the first blockquote line)
  const metaLine = src.split('\n').find((l) => l.startsWith('> **Weeks')) ?? '';
  const weeksMatch = metaLine.match(/\*\*Weeks?\s+(\d+)(?:-(\d+))?\*\*/);
  const weeks: [number, number] | null = weeksMatch
    ? [Number(weeksMatch[1]), Number(weeksMatch[2] ?? weeksMatch[1])]
    : null;
  const prev = metaLine.match(/Previous:\s*\[\[(\d{2}) - /)?.[1] ?? null;
  const next = metaLine.match(/Next:\s*\[\[(\d{2}) - /)?.[1] ?? null;

  const links: string[] = [];
  const tree = mdToMdast(src);
  transformWikilinks(tree, { moduleByBasename, links });

  const children = tree.children;
  let title = id;
  const slugger = new GithubSlugger();

  // locate H1, metadata blockquote, pitch (nodes between blockquote and first ---)
  let cursor = 0;
  const pitchNodes: RootContent[] = [];
  let seenMeta = false;
  for (; cursor < children.length; cursor++) {
    const node = children[cursor];
    if (node.type === 'heading' && node.depth === 1) {
      title = toText(node).replace(/^\d+\s*-\s*/, '').trim();
      continue;
    }
    if (node.type === 'blockquote' && !seenMeta) {
      seenMeta = true; // the "Weeks X-Y | ..." navigation line — not content
      continue;
    }
    if (node.type === 'thematicBreak') {
      cursor++;
      break;
    }
    if (seenMeta) pitchNodes.push(node);
  }
  const pitchHtml = mdastToHtml(pitchNodes);

  // sections from H2 boundaries
  const sections: Section[] = [];
  let current: { title: string; preamble: RootContent[]; subs: Array<{ title: string; nodes: RootContent[] }> } | null = null;

  const commit = () => {
    if (!current) return;
    const sectionId = slugger.slug(current.title);
    const checklistCounter = { n: 0 };
    const base = `${id}/${sectionId}`;
    const subsections: Subsection[] = current.subs.map((sub) => {
      const numMatch = sub.title.match(/^(\d+)\.\s*(.*)$/);
      const cleanTitle = numMatch ? numMatch[2] : sub.title;
      return {
        id: slugger.slug(cleanTitle),
        number: numMatch ? Number(numMatch[1]) : null,
        title: cleanTitle,
        blocks: groupBlocks(sub.nodes, base, checklistCounter),
      };
    });
    sections.push({
      id: sectionId,
      kind: sectionKind(current.title),
      title: current.title,
      blocks: groupBlocks(current.preamble, base, checklistCounter),
      subsections,
    });
    current = null;
  };

  for (; cursor < children.length; cursor++) {
    const node = children[cursor];
    if (node.type === 'heading' && (node as Heading).depth === 2) {
      commit();
      current = { title: toText(node).trim(), preamble: [], subs: [] };
      continue;
    }
    if (!current) continue;
    if (node.type === 'heading' && (node as Heading).depth === 3) {
      current.subs.push({ title: toText(node).trim(), nodes: [] });
      continue;
    }
    if (node.type === 'thematicBreak' && current.subs.length === 0 && current.preamble.length === 0) continue;
    const bucket = current.subs.length > 0 ? current.subs[current.subs.length - 1].nodes : current.preamble;
    if (node.type === 'thematicBreak') continue;
    bucket.push(node);
  }
  commit();

  return { id, title, weeks, pitchHtml, prev, next, sections, links };
}

// ---------- index (module 00) parsing ----------

export interface TimelineEntry {
  part: string;
  partIndex: number;
  addon: boolean;
}

export interface ParsedIndex {
  home: HomeData;
  timeline: Map<string, TimelineEntry>;
  parts: Array<{ index: number; label: string }>;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };

export function parseIndexFile(src: string, moduleByBasename: Map<string, string>): ParsedIndex {
  // timeline from the raw table — | Part | Weeks | [[NN - ...]] |
  const timeline = new Map<string, TimelineEntry>();
  const canonical = new Map<number, string>();
  for (const line of src.split('\n')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+(?:-\d+)?)\s*\|\s*\[\[(\d{2}) - /);
    if (!m) continue;
    const [, label, , moduleId] = m;
    const roman = label.split(/\s/)[0];
    const partIndex = ROMAN[roman];
    if (!partIndex) continue;
    const addon = /add-on/i.test(label);
    if (!addon && !canonical.has(partIndex)) canonical.set(partIndex, label);
    timeline.set(moduleId, { part: label, partIndex, addon });
  }
  // add-on rows reuse their part's canonical label
  for (const [moduleId, entry] of timeline) {
    if (entry.addon && canonical.has(entry.partIndex)) {
      timeline.set(moduleId, { ...entry, part: canonical.get(entry.partIndex)! });
    }
  }

  const links: string[] = [];
  const tree = mdToMdast(src);
  transformWikilinks(tree, { moduleByBasename, links });

  // pitch = first blockquote; sections split on H2
  let pitchHtml = '';
  const sectionHtml = new Map<string, string>();
  let currentTitle: string | null = null;
  let buffer: RootContent[] = [];
  const commit = () => {
    if (currentTitle) sectionHtml.set(currentTitle, mdastToHtml(buffer));
    buffer = [];
  };
  for (const node of tree.children) {
    if (node.type === 'heading' && node.depth === 1) continue;
    if (node.type === 'blockquote' && !pitchHtml && !currentTitle) {
      pitchHtml = mdastToHtml(node.children);
      continue;
    }
    if (node.type === 'heading' && node.depth === 2) {
      commit();
      currentTitle = toText(node).trim();
      continue;
    }
    if (node.type === 'thematicBreak') continue;
    if (currentTitle) buffer.push(node);
  }
  commit();

  const get = (prefix: string): string => {
    for (const [title, html] of sectionHtml) if (title.startsWith(prefix)) return html;
    throw new Error(`index: section "${prefix}" not found`);
  };

  return {
    home: {
      pitchHtml,
      fitHtml: get('Where This Path Fits'),
      howToHtml: get('How to Use'),
      principlesHtml: get('Guiding Principles'),
      referencesHtml: get('Key References'),
      quickWinsHtml: get('Quick Wins'),
    },
    timeline,
    parts: [...canonical.entries()].map(([index, label]) => ({ index, label })).sort((a, b) => a.index - b.index),
  };
}
