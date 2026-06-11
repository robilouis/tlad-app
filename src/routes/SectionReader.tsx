import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { ModuleData } from '../../shared/schema';
import BlockRenderer from '../components/BlockRenderer';
import { PART_HUES, SECTION_KIND_LABELS, loadModule } from '../lib/content';
import { useProgress } from '../lib/progress';

export default function SectionReader() {
  const { id = '', sectionId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [module, setModule] = useState<ModuleData | null>(null);
  const { markSectionRead, isSectionRead } = useProgress();

  useEffect(() => {
    let live = true;
    setModule(null);
    loadModule(id).then((m) => live && setModule(m));
    return () => {
      live = false;
    };
  }, [id]);

  // deep-link to a subsection: #/module/09/s/key-concepts#the-central-decision-tree...
  useEffect(() => {
    if (module && location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }, [module, location.hash]);

  if (!module) return <p className="empty-note">Loading section…</p>;

  const section = module.sections.find((s) => s.id === sectionId);
  if (!section) return <p className="empty-note">Section not found.</p>;

  const hue = PART_HUES[module.partIndex];
  const idx = module.sections.findIndex((s) => s.id === sectionId);
  const nextSection = module.sections[idx + 1] ?? null;
  const read = isSectionRead(id, sectionId);

  const finish = () => {
    markSectionRead(id, sectionId);
    if (nextSection) navigate(`/module/${id}/s/${nextSection.id}`);
    else navigate(`/module/${id}`);
  };

  return (
    <div className="fade-in" style={{ ['--part-hue' as never]: hue }}>
      <div className="reader-layout">
        <article>
          <header className="reader-header">
            <div className="crumb">
              <Link to={`/module/${id}`}>
                {module.id} · {module.title}
              </Link>{' '}
              / {SECTION_KIND_LABELS[section.kind]}
            </div>
            <h1>{section.title}</h1>
          </header>

          <BlockRenderer blocks={section.blocks} />

          {section.subsections.map((sub) => (
            <section key={sub.id} id={sub.id} className="subsection-block">
              <h2 className="subsection-title">
                {sub.number !== null && <span className="ss-num">{String(sub.number).padStart(2, '0')}</span>}
                {sub.title}
              </h2>
              <BlockRenderer blocks={sub.blocks} />
            </section>
          ))}

          <footer className="reader-footer">
            <Link to={`/module/${id}`} className="btn btn--ghost">
              ← Back to module
            </Link>
            <button type="button" className="btn btn--primary" onClick={finish}>
              {read ? '' : 'Mark as read · '}
              {nextSection ? `Next: ${nextSection.title} →` : 'Finish module overview →'}
            </button>
          </footer>
        </article>

        <nav className="reader-toc" aria-label="In this section">
          {section.subsections.length > 0 && (
            <>
              <div className="toc-title">In this section</div>
              {section.subsections.map((sub) => (
                <a key={sub.id} href={`#/module/${id}/s/${sectionId}#${sub.id}`}>
                  {sub.number !== null ? `${sub.number}. ` : ''}
                  {sub.title}
                </a>
              ))}
            </>
          )}
          <div className="toc-sections">
            <div className="toc-title">Sections</div>
            {module.sections.map((s) => (
              <a key={s.id} href={`#/module/${id}/s/${s.id}`} className={s.id === sectionId ? 'is-active' : ''}>
                {isSectionRead(id, s.id) ? '✓ ' : ''}
                {s.title}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
