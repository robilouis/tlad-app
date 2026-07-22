import { type ModuleEvals } from '../shared/schema';
import { mdStringToHtml } from './markdown';

/**
 * Render the authored eval markdown fields to HTML. The authored source
 * (`content/evals/NN.json`) carries markdown in every text field; the app
 * consumes the HTML-rendered shape. Shared by the full vault sync
 * (`build-content.ts`) and the in-repo staging sync (`sync-local.ts`).
 */
export function renderEvals(evals: ModuleEvals): ModuleEvals {
  const md = mdStringToHtml;
  const inline = (s: string) => md(s).replace(/^<p>([\s\S]*)<\/p>$/, '$1');
  return {
    moduleId: evals.moduleId,
    quiz: evals.quiz.map((q) => ({
      ...q,
      prompt: md(q.prompt),
      takeaway: inline(q.takeaway),
      choices: q.choices.map((c) => ({ ...c, text: inline(c.text), explanation: inline(c.explanation) })),
    })),
    exercises: evals.exercises.map((ex) => ({
      ...ex,
      scenario: md(ex.scenario),
      givens: ex.givens?.map(inline),
      tasks: ex.tasks.map(inline),
      solution: md(ex.solution),
      rubric: {
        keyPoints: ex.rubric.keyPoints.map(inline),
        pitfalls: ex.rubric.pitfalls.map(inline),
        takeaways: ex.rubric.takeaways.map(inline),
        transfer: inline(ex.rubric.transfer),
      },
    })),
  };
}
