import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ModuleEvals } from '../../shared/schema';
import { getMeta, loadEvals } from '../lib/content';
import { useProgress } from '../lib/progress';

type Answers = Record<string, string>; // questionId -> chosen choiceId

export default function QuizView() {
  const { id = '' } = useParams();
  const [evals, setEvals] = useState<ModuleEvals | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const { state, recordQuizResult } = useProgress();
  const meta = getMeta(id);

  useEffect(() => {
    let live = true;
    loadEvals(id).then((e) => live && setEvals(e));
    return () => {
      live = false;
    };
  }, [id]);

  const score = useMemo(() => {
    if (!evals) return 0;
    return evals.quiz.filter((q) => {
      const chosen = answers[q.id];
      return chosen && q.choices.find((c) => c.id === chosen)?.correct;
    }).length;
  }, [evals, answers]);

  if (!evals || !meta) return <p className="empty-note">Loading quiz…</p>;

  const restart = () => {
    setAnswers({});
    setCurrent(0);
    setRevealed(false);
    setFinished(false);
  };

  if (finished) {
    const best = state.quiz[id];
    return (
      <div className="quiz-shell fade-in">
        <div className="quiz-result glass">
          <div className="eyebrow">
            Quiz complete · {meta.id} {meta.title}
          </div>
          <div className="qr-score">
            {score}/{evals.quiz.length}
          </div>
          {best && (
            <div className="qr-best">
              BEST {best.best}/{best.total} · {best.attempts} ATTEMPT{best.attempts > 1 ? 'S' : ''}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 26 }}>
            <button type="button" className="btn" onClick={restart}>
              Retake
            </button>
            <Link to={`/module/${id}`} className="btn btn--primary">
              Back to module →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const question = evals.quiz[current];
  const chosen = answers[question.id];

  const choose = (choiceId: string) => {
    if (revealed) return;
    setAnswers((a) => ({ ...a, [question.id]: choiceId }));
    setRevealed(true);
  };

  const next = () => {
    if (current + 1 < evals.quiz.length) {
      setCurrent(current + 1);
      setRevealed(false);
    } else {
      recordQuizResult(id, score, evals.quiz.length);
      setFinished(true);
    }
  };

  return (
    <div className="quiz-shell fade-in">
      <div className="reader-header">
        <div className="crumb">
          <Link to={`/module/${id}`}>
            {meta.id} · {meta.title}
          </Link>{' '}
          / Quiz
        </div>
      </div>

      <div className="quiz-progress">
        {evals.quiz.map((q, i) => {
          const a = answers[q.id];
          const cls =
            i === current && !revealed
              ? 'is-current'
              : a
                ? q.choices.find((c) => c.id === a)?.correct
                  ? 'is-correct'
                  : 'is-wrong'
                : '';
          return <span key={q.id} className={`qp-seg ${cls}`} />;
        })}
      </div>

      <div className="quiz-question glass" key={question.id}>
        <div className="qq-meta">
          <span>
            Question {current + 1} / {evals.quiz.length}
          </span>
          <span>{question.difficulty === 'stretch' ? '◆ stretch' : '● core'}</span>
        </div>
        <div className="qq-prompt prose" dangerouslySetInnerHTML={{ __html: question.prompt }} />

        <div className="choice-list">
          {question.choices.map((choice) => {
            let cls = 'choice';
            if (revealed) {
              if (choice.correct) cls += ' is-correct';
              else if (choice.id === chosen) cls += ' is-wrong';
              else cls += ' is-dim';
            }
            const showExplanation = revealed && (choice.correct || choice.id === chosen);
            return (
              <button key={choice.id} type="button" className={cls} disabled={revealed} onClick={() => choose(choice.id)}>
                <span dangerouslySetInnerHTML={{ __html: choice.text }} />
                {showExplanation && (
                  <span className="choice-explanation" dangerouslySetInnerHTML={{ __html: choice.explanation }} />
                )}
              </button>
            );
          })}
        </div>

        {revealed && (
          <div className="takeaway-banner fade-in">
            <span className="tb-label">Takeaway</span>
            <span dangerouslySetInnerHTML={{ __html: question.takeaway }} />
          </div>
        )}

        <div className="quiz-actions">
          {revealed && question.conceptRef ? (
            <Link to={`/module/${id}/s/key-concepts#${question.conceptRef}`} className="btn btn--ghost">
              Review this concept
            </Link>
          ) : (
            <span />
          )}
          {revealed && (
            <button type="button" className="btn btn--primary" onClick={next}>
              {current + 1 < evals.quiz.length ? 'Next question →' : 'See result →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
