import { z } from 'zod';

// ---------- Content blocks ----------

export const CalloutKindSchema = z.enum(['intuition', 'worked-example', 'note']);

export const BlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('html'), html: z.string().min(1) }),
  z.object({
    type: z.literal('callout'),
    kind: CalloutKindSchema,
    title: z.string().nullable(),
    html: z.string().min(1),
  }),
  z.object({ type: z.literal('formula'), tex: z.string().min(1), html: z.string().min(1) }),
  z.object({ type: z.literal('diagram'), text: z.string().min(1) }),
  z.object({
    type: z.literal('checklist'),
    checklistId: z.string().min(1),
    items: z.array(z.object({ id: z.string(), html: z.string().min(1) })).min(1),
  }),
  z.object({ type: z.literal('table'), html: z.string().min(1) }),
]);

export const SectionKindSchema = z.enum([
  'objectives',
  'concepts',
  'missions',
  'tools',
  'overkill',
  'resources',
  'artifacts',
  'self-assessment',
  'other',
]);

export const SubsectionSchema = z.object({
  id: z.string().min(1),
  number: z.number().nullable(),
  title: z.string().min(1),
  blocks: z.array(BlockSchema),
});

export const SectionSchema = z.object({
  id: z.string().min(1),
  kind: SectionKindSchema,
  title: z.string().min(1),
  blocks: z.array(BlockSchema),
  subsections: z.array(SubsectionSchema),
});

export const ModuleMetaSchema = z.object({
  id: z.string().regex(/^\d{2}$/),
  title: z.string().min(1),
  weeks: z.tuple([z.number(), z.number()]).nullable(),
  part: z.string().min(1),
  partIndex: z.number().int().min(1).max(6),
  addon: z.boolean(),
  pitchHtml: z.string().min(1),
  prev: z.string().nullable(),
  next: z.string().nullable(),
  sectionCount: z.number().int(),
  quizCount: z.number().int(),
  exerciseCount: z.number().int(),
});

export const ModuleSchema = ModuleMetaSchema.extend({
  sections: z.array(SectionSchema).min(1),
});

export const HomeDataSchema = z.object({
  pitchHtml: z.string().min(1),
  fitHtml: z.string().min(1),
  howToHtml: z.string().min(1),
  principlesHtml: z.string().min(1),
  referencesHtml: z.string().min(1),
  quickWinsHtml: z.string().min(1),
});

export const IndexDataSchema = z.object({
  modules: z.array(ModuleMetaSchema).length(20),
  parts: z.array(z.object({ index: z.number(), label: z.string() })),
  home: HomeDataSchema,
});

export const GraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      partIndex: z.number(),
      addon: z.boolean(),
      weeks: z.tuple([z.number(), z.number()]).nullable(),
    }),
  ),
  edges: z.array(z.object({ source: z.string(), target: z.string(), weight: z.number() })),
});

// ---------- Evals (authored as markdown strings; built output is same shape, HTML-rendered) ----------

export const QuizChoiceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  correct: z.boolean(),
  explanation: z.string().min(1),
});

export const QuizQuestionSchema = z
  .object({
    id: z.string().min(1),
    conceptRef: z.string().optional(),
    prompt: z.string().min(1),
    choices: z.array(QuizChoiceSchema).min(3).max(5),
    takeaway: z.string().min(1),
    difficulty: z.enum(['core', 'stretch']),
  })
  .refine((q) => q.choices.filter((c) => c.correct).length === 1, {
    message: 'exactly one choice must be correct',
  });

export const ExerciseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  estimatedMinutes: z.number().int().positive(),
  scenario: z.string().min(1),
  givens: z.array(z.string().min(1)).optional(),
  tasks: z.array(z.string().min(1)).min(1),
  solution: z.string().min(1),
  rubric: z.object({
    keyPoints: z.array(z.string().min(1)).min(2),
    pitfalls: z.array(z.string().min(1)).min(1),
    takeaways: z.array(z.string().min(1)).min(1),
    transfer: z.string().min(1),
  }),
});

export const ModuleEvalsSchema = z.object({
  moduleId: z.string().regex(/^\d{2}$/),
  quiz: z.array(QuizQuestionSchema).min(6).max(10),
  exercises: z.array(ExerciseSchema).min(2).max(3),
});

// ---------- Inferred types ----------

export type Block = z.infer<typeof BlockSchema>;
export type CalloutKind = z.infer<typeof CalloutKindSchema>;
export type SectionKind = z.infer<typeof SectionKindSchema>;
export type Subsection = z.infer<typeof SubsectionSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type ModuleMeta = z.infer<typeof ModuleMetaSchema>;
export type ModuleData = z.infer<typeof ModuleSchema>;
export type HomeData = z.infer<typeof HomeDataSchema>;
export type IndexData = z.infer<typeof IndexDataSchema>;
export type GraphData = z.infer<typeof GraphSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type QuizChoice = z.infer<typeof QuizChoiceSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type ModuleEvals = z.infer<typeof ModuleEvalsSchema>;
