import {z} from 'zod';

const sessionInputSchema = z.object({sessionId: z.string().min(1).max(120)});

export const sessionHelpInputSchema = sessionInputSchema.extend({
  kind: z.enum(['hint', 'confused', 'example', 'answer', 'explore']),
  text: z.string().max(100000).default(''),
  confusionKind: z.enum(['term', 'reason', 'step', 'overload']).optional(),
}).strict().superRefine((input, context) => {
  if (input.kind === 'explore' && !input.text.trim()) {
    context.addIssue({code: 'custom', path: ['text'], message: '请输入要保留的想法。'});
  }
  if (input.kind !== 'explore' && input.text.length > 10000) {
    context.addIssue({code: 'custom', path: ['text'], message: '请把这次问题缩短到一万字以内。'});
  }
});

export const sessionNextStepInputSchema = sessionInputSchema.extend({
  intent: z.enum(['continue', 'smaller', 'independent', 'return', 'challenge', 'advance', 'synthesize', 'consolidate']),
}).strict();

export const sessionReviewSolutionInputSchema = sessionInputSchema.strict();
