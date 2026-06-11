import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP } from 'unist-util-visit';
import type { Root, RootContent, Text } from 'mdast';

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

const renderer = unified()
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeKatex, { strict: false })
  .use(rehypeStringify);

export function mdToMdast(src: string): Root {
  return parser.parse(src) as Root;
}

export function mdastToHtml(nodes: RootContent[]): string {
  const root: Root = { type: 'root', children: nodes };
  const hast = renderer.runSync(root as never);
  return String(renderer.stringify(hast as never)).trim();
}

export function mdStringToHtml(src: string): string {
  return mdastToHtml(mdToMdast(src).children);
}

export interface WikilinkContext {
  /** basename (without .md) -> module id, for TLAD files only */
  moduleByBasename: Map<string, string>;
  /** collector for internal link targets found outside code blocks */
  links: string[];
}

const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Replace [[wikilinks]] in text nodes with HTML anchors (TLAD-internal) or
 * inert vault-ref badges (links into the AIS / MLE paths). Code blocks are
 * never visited because their content lives in `value`, not text children —
 * so the ASCII diagrams keep their [[...]] verbatim.
 */
export function transformWikilinks(tree: Root, ctx: WikilinkContext): void {
  visit(tree, 'text', (node: Text, index, parent) => {
    if (!parent || index === undefined) return;
    const value = node.value;
    if (!value.includes('[[')) return;

    const parts: RootContent[] = [];
    let last = 0;
    for (const m of value.matchAll(WIKILINK_RE)) {
      const [full, target, alias] = m;
      const start = m.index!;
      if (start > last) parts.push({ type: 'text', value: value.slice(last, start) });

      const moduleId = ctx.moduleByBasename.get(target.trim());
      const label = (alias ?? target.replace(/^\d+\s*-\s*/, '')).trim();
      if (moduleId !== undefined) {
        ctx.links.push(moduleId);
        const href = moduleId === '00' ? '#/' : `#/module/${moduleId}`;
        parts.push({
          type: 'html',
          value: `<a class="wikilink" data-module="${moduleId}" href="${href}">${escapeHtml(label)}</a>`,
        });
      } else {
        parts.push({
          type: 'html',
          value: `<span class="vault-ref" title="In the Obsidian vault: ${escapeHtml(target.trim())}">${escapeHtml(label)}</span>`,
        });
      }
      last = start + full.length;
    }
    if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });

    (parent.children as RootContent[]).splice(index, 1, ...parts);
    return [SKIP, index + parts.length];
  });
}
