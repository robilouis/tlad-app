import { useState } from 'react';
import type { Block, CalloutKind } from '../../shared/schema';
import { useProgress } from '../lib/progress';

const CALLOUT_LABELS: Record<CalloutKind, string> = {
  intuition: 'Intuition',
  'worked-example': 'Worked example',
  note: 'Note',
};

function FormulaCard({ tex, html }: { tex: string; html: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="formula-card" style={{ margin: 0 }}>
      <button
        type="button"
        className="formula-copy"
        onClick={() => {
          navigator.clipboard.writeText(tex).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          });
        }}
      >
        {copied ? 'COPIED ✓' : 'COPY TEX'}
      </button>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </figure>
  );
}

function Checklist({ checklistId, items }: { checklistId: string; items: Array<{ id: string; html: string }> }) {
  const { toggleChecklistItem, isChecklistItemChecked } = useProgress();
  return (
    <div className="checklist">
      {items.map((item) => {
        const checked = isChecklistItemChecked(checklistId, item.id);
        return (
          <label key={item.id} className={`checklist-item${checked ? ' is-checked' : ''}`}>
            <input type="checkbox" checked={checked} onChange={() => toggleChecklistItem(checklistId, item.id)} />
            <span className="ci-text" dangerouslySetInnerHTML={{ __html: item.html }} />
          </label>
        );
      })}
    </div>
  );
}

export default function BlockRenderer({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'html':
            return <div key={i} className="prose" dangerouslySetInnerHTML={{ __html: block.html }} />;
          case 'callout':
            return (
              <aside key={i} className={`callout callout--${block.kind}`}>
                <div className="callout-eyebrow">{CALLOUT_LABELS[block.kind]}</div>
                {block.title && <div className="callout-title">{block.title}</div>}
                <div className="prose" dangerouslySetInnerHTML={{ __html: block.html }} />
              </aside>
            );
          case 'formula':
            return <FormulaCard key={i} tex={block.tex} html={block.html} />;
          case 'diagram':
            return (
              <pre key={i} className="diagram">
                {block.text}
              </pre>
            );
          case 'checklist':
            return <Checklist key={i} checklistId={block.checklistId} items={block.items} />;
          case 'table':
            return <div key={i} className="table-wrap" dangerouslySetInnerHTML={{ __html: block.html }} />;
        }
      })}
    </>
  );
}
