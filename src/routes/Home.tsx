import { Link } from 'react-router-dom';
import Constellation from '../components/Constellation';
import { PART_HUES, indexData } from '../lib/content';
import { moduleCompletion, useProgress } from '../lib/progress';
import { useMediaQuery } from '../lib/useMediaQuery';

const PANELS: Array<{ title: string; key: keyof typeof indexData.home; open?: boolean }> = [
  { title: 'How to use this curriculum', key: 'howToHtml', open: true },
  { title: 'Guiding principles', key: 'principlesHtml' },
  { title: 'Quick wins — do these first', key: 'quickWinsHtml' },
  { title: 'Where this path fits', key: 'fitHtml' },
  { title: 'Key references', key: 'referencesHtml' },
];

export default function Home() {
  const { state, exportJson, importJson } = useProgress();
  // constellation is desktop/tablet-first: labels are unreadable and the
  // tooltip is hover-only at phone width, so the module list leads instead
  const narrow = useMediaQuery('(max-width: 700px)');

  const handleExport = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'tlad-progress.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const ok = importJson(await file.text());
      if (!ok) alert('Could not read that progress file.');
    };
    input.click();
  };

  return (
    <div className="fade-in">
      <section className="hero">
        <div className="eyebrow">Interactive learning path · 43 weeks</div>
        <h1>Tech Lead — AI &amp; Data</h1>
        <div className="hero-pitch prose" dangerouslySetInnerHTML={{ __html: indexData.home.pitchHtml }} />
      </section>

      {!narrow && <Constellation />}

      <div className="part-legend">
        {indexData.parts.map((p) => (
          <span key={p.index} className="legend-item" style={{ ['--part-hue' as never]: PART_HUES[p.index] }}>
            <span className="legend-dot" />
            {p.label}
          </span>
        ))}
      </div>

      {indexData.parts.map((part) => {
        const modules = indexData.modules.filter((m) => m.partIndex === part.index);
        return (
          <section key={part.index}>
            <h2 className="part-section-title" style={{ ['--part-hue' as never]: PART_HUES[part.index] }}>
              {part.label}
            </h2>
            <div className="module-list">
              {modules.map((m) => {
                const c = moduleCompletion(m, state);
                return (
                  <Link
                    key={m.id}
                    to={`/module/${m.id}`}
                    className="module-card glass"
                    style={{ ['--part-hue' as never]: PART_HUES[m.partIndex] }}
                  >
                    <span className="mc-id">{m.id}</span>
                    <span className="mc-title">
                      {m.title}
                      {m.addon && (
                        <span style={{ color: 'var(--text-faint)', fontSize: 11, marginLeft: 8 }}>add-on</span>
                      )}
                    </span>
                    <span className="mc-weeks">
                      {c.pct > 0 ? `${Math.round(c.pct * 100)}%` : m.weeks ? `w${m.weeks[0]}–${m.weeks[1]}` : ''}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="home-panels">
        {PANELS.map((p) => (
          <details key={p.key} className="home-panel glass" open={p.open}>
            <summary>{p.title}</summary>
            <div className="prose" dangerouslySetInnerHTML={{ __html: indexData.home[p.key] }} />
          </details>
        ))}
      </section>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 36 }}>
        <button type="button" className="btn btn--ghost" onClick={handleExport}>
          Export progress
        </button>
        <button type="button" className="btn btn--ghost" onClick={handleImport}>
          Import progress
        </button>
      </div>
    </div>
  );
}
