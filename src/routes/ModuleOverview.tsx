import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ModuleData, ModuleEvals } from '../../shared/schema';
import { PART_HUES, SECTION_KIND_LABELS, getMeta, loadEvals, loadModule } from '../lib/content';
import { useProgress } from '../lib/progress';

export default function ModuleOverview() {
  const { id = '' } = useParams();
  const [module, setModule] = useState<ModuleData | null>(null);
  const [evals, setEvals] = useState<ModuleEvals | null>(null);
  const { state, isSectionRead, isExerciseDone } = useProgress();

  useEffect(() => {
    let live = true;
    setModule(null);
    setEvals(null);
    loadModule(id).then((m) => live && setModule(m));
    loadEvals(id).then((e) => live && setEvals(e));
    return () => {
      live = false;
    };
  }, [id]);

  if (!module) return <p className="empty-note">Loading module…</p>;

  const hue = PART_HUES[module.partIndex];
  const quizResult = state.quiz[id];
  const prevMeta = module.prev ? getMeta(module.prev) : null;
  const nextMeta = module.next ? getMeta(module.next) : null;

  return (
    <div className="fade-in" style={{ ['--part-hue' as never]: hue }}>
      <header className="module-hero">
        <div className="mh-top">
          <span className="part-badge">{module.part}</span>
          {module.weeks && (
            <span className="weeks-chip">
              WEEKS {module.weeks[0]}–{module.weeks[1]}
            </span>
          )}
          {module.addon && <span className="weeks-chip">ADD-ON MODULE</span>}
        </div>
        <h1>
          <span style={{ color: hue, fontFamily: 'var(--font-mono)', fontSize: '0.6em', verticalAlign: 'middle', marginRight: 14 }}>
            {module.id}
          </span>
          {module.title}
        </h1>
        <div className="prose" dangerouslySetInnerHTML={{ __html: module.pitchHtml }} />
      </header>

      <div className="overview-grid">
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Sections
          </div>
          <div className="section-list">
            {module.sections.map((s) => {
              const read = isSectionRead(id, s.id);
              return (
                <Link key={s.id} to={`/module/${id}/s/${s.id}`} className={`section-row glass${read ? ' is-read' : ''}`}>
                  <span className="sr-kind">{SECTION_KIND_LABELS[s.kind]}</span>
                  <span className="sr-title">
                    {s.title}
                    {s.subsections.length > 0 && (
                      <span style={{ color: 'var(--text-faint)', fontSize: 12, marginLeft: 8 }}>
                        {s.subsections.length} parts
                      </span>
                    )}
                  </span>
                  <span className="sr-state">{read ? '✓ read' : '○'}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Evaluation
          </div>
          <div className="eval-cards">
            {evals ? (
              <>
                <div className={`eval-card glass${quizResult ? ' is-done' : ''}`}>
                  <h3>Quiz</h3>
                  <div className="ec-meta">
                    {evals.quiz.length} QUESTIONS · OPTIONAL
                    {quizResult && (
                      <span className="ec-score">
                        {' '}
                        · BEST {quizResult.best}/{quizResult.total}
                      </span>
                    )}
                  </div>
                  <Link to={`/module/${id}/quiz`} className="btn btn--primary">
                    {quizResult ? 'Retake quiz' : 'Start quiz'}
                  </Link>
                </div>
                {evals.exercises.map((ex) => {
                  const done = isExerciseDone(id, ex.id);
                  return (
                    <div key={ex.id} className={`eval-card glass${done ? ' is-done' : ''}`}>
                      <h3>{ex.title}</h3>
                      <div className="ec-meta">
                        HANDS-ON · ~{ex.estimatedMinutes} MIN{done && <span className="ec-score"> · DONE ✓</span>}
                      </div>
                      <Link to={`/module/${id}/ex/${ex.id}`} className="btn">
                        {done ? 'Revisit' : 'Open exercise'}
                      </Link>
                    </div>
                  );
                })}
              </>
            ) : (
              <p className="empty-note">No quiz or exercises for this module yet.</p>
            )}
          </div>
        </div>
      </div>

      <nav className="module-nav-footer">
        {prevMeta ? (
          <Link to={`/module/${prevMeta.id}`} className="btn btn--ghost">
            ← {prevMeta.id} · {prevMeta.title}
          </Link>
        ) : (
          <span />
        )}
        {nextMeta ? (
          <Link to={`/module/${nextMeta.id}`} className="btn btn--ghost">
            {nextMeta.id} · {nextMeta.title} →
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
