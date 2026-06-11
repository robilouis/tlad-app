import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ModuleEvals } from '../../shared/schema';
import { getMeta, loadEvals } from '../lib/content';
import { useProgress } from '../lib/progress';

export default function ExerciseView() {
  const { id = '', exerciseId = '' } = useParams();
  const [evals, setEvals] = useState<ModuleEvals | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const { isExerciseDone, markExerciseDone } = useProgress();
  const meta = getMeta(id);

  useEffect(() => {
    let live = true;
    setRevealed(false);
    setChecked({});
    loadEvals(id).then((e) => live && setEvals(e));
    return () => {
      live = false;
    };
  }, [id, exerciseId]);

  if (!evals || !meta) return <p className="empty-note">Loading exercise…</p>;

  const exercise = evals.exercises.find((e) => e.id === exerciseId);
  if (!exercise) return <p className="empty-note">Exercise not found.</p>;

  const done = isExerciseDone(id, exerciseId);

  return (
    <div className="exercise-shell fade-in">
      <header className="exercise-head">
        <div className="crumb" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-faint)' }}>
          <Link to={`/module/${id}`}>
            {meta.id} · {meta.title}
          </Link>{' '}
          / Exercise
        </div>
        <h1 style={{ margin: '12px 0 0' }}>{exercise.title}</h1>
        <div className="ex-meta">
          <span>~{exercise.estimatedMinutes} min</span>
          <span>self-check</span>
          {done && <span style={{ color: 'var(--success)' }}>done ✓</span>}
        </div>
      </header>

      <section className="exercise-section glass">
        <h3>Scenario</h3>
        <div className="prose" dangerouslySetInnerHTML={{ __html: exercise.scenario }} />
      </section>

      {exercise.givens && exercise.givens.length > 0 && (
        <section className="exercise-section glass">
          <h3>Given</h3>
          <ul className="givens-list prose">
            {exercise.givens.map((g, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: g }} />
            ))}
          </ul>
        </section>
      )}

      <section className="exercise-section glass">
        <h3>Your tasks</h3>
        <ol className="tasks-list prose">
          {exercise.tasks.map((t, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: t }} />
          ))}
        </ol>
      </section>

      {!revealed ? (
        <div className="reveal-zone">
          <p style={{ color: 'var(--text-faint)', fontSize: 13.5 }}>
            Work it through first — on paper, whiteboard, or out loud. Then check yourself.
          </p>
          <button type="button" className="btn btn--primary" onClick={() => setRevealed(true)}>
            Reveal solution &amp; rubric
          </button>
        </div>
      ) : (
        <div className="fade-in">
          <section className="exercise-section glass">
            <h3>Worked solution</h3>
            <div className="prose" dangerouslySetInnerHTML={{ __html: exercise.solution }} />
          </section>

          <section className="exercise-section glass">
            <h3>Self-check — did your answer cover…</h3>
            {exercise.rubric.keyPoints.map((kp, i) => (
              <label key={i} className={`rubric-check${checked[i] ? ' is-checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={!!checked[i]}
                  onChange={() => setChecked((c) => ({ ...c, [i]: !c[i] }))}
                />
                <span dangerouslySetInnerHTML={{ __html: kp }} />
              </label>
            ))}
          </section>

          <section className="exercise-section glass">
            <h3>Common pitfalls</h3>
            {exercise.rubric.pitfalls.map((p, i) => (
              <div key={i} className="pitfall-item" dangerouslySetInnerHTML={{ __html: p }} />
            ))}
          </section>

          <section className="exercise-section glass">
            <h3>Takeaways</h3>
            <ul className="prose" style={{ margin: 0, paddingLeft: 22 }}>
              {exercise.rubric.takeaways.map((t, i) => (
                <li key={i} dangerouslySetInnerHTML={{ __html: t }} />
              ))}
            </ul>
          </section>

          <section className="exercise-section glass transfer-card">
            <h3>Transfer — where else this applies</h3>
            <div className="prose" dangerouslySetInnerHTML={{ __html: exercise.rubric.transfer }} />
          </section>

          <div className="reveal-zone">
            {!done ? (
              <button type="button" className="btn btn--primary" onClick={() => markExerciseDone(id, exerciseId)}>
                Mark exercise complete ✓
              </button>
            ) : (
              <Link to={`/module/${id}`} className="btn btn--primary">
                Back to module →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
