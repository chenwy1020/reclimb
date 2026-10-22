import { z } from 'zod';
import { assessmentSchemaFor, helpSchemaFor } from './schemas';
import { mathCheckRequestsSchema } from './math-checks';
import { VERIFICATION_BLOCKER_MESSAGES } from '../shared/reliability';
const text = z.string().max(16000),
  id = z.string().min(1).max(120);
export const verificationBlockerSchema = z
  .object({
    code: z.enum(
      Object.keys(VERIFICATION_BLOCKER_MESSAGES) as [
        keyof typeof VERIFICATION_BLOCKER_MESSAGES,
        ...(keyof typeof VERIFICATION_BLOCKER_MESSAGES)[],
      ],
    ),
    message: z.string().max(1000),
    sourceId: id.optional(),
    locator: z.string().max(4000).optional(),
    stepId: id.optional(),
  })
  .strict();
const consistency = z
  .enum(['consistent', 'conflicting', 'uncertain', 'not_used'])
  .describe(
    '逐项判断该来源与完整教学包是否一致：consistent=无已知冲突，conflicting=题设/讲解/示范/标准与来源相矛盾，uncertain=无法核清，not_used=该来源并未被用作教学依据。来源写≥而任务强行改成>属于conflicting；肯定性summary不能覆盖冲突。',
  )
  .default('uncertain');
const sourceCheckFields = {
  sourceId: id,
  consistency,
  usesCriticalSymbols: z.boolean().describe('当前教学包是否实际依赖该来源中的关键符号或条件'),
  independentlyEstablished: z
    .boolean()
    .describe(
      '若来源未确认，所依赖的关键内容是否已由清楚且独立的依据确立；不能仅因来源ID有效或行文通顺填true',
    ),
  reason: text.min(1),
};
export const verificationIssueSchema = z.object({
  kind: z.enum([
    'conditions',
    'calculation',
    'rubric',
    'missing_input',
    'source',
    'exposure',
    'other',
  ]),
  message: text.min(1),
  stepId: id.optional(),
});
export const conditionBranchSchema = z.object({
  id,
  condition: text,
  applicability: z.enum(['applies', 'does_not_apply', 'unknown']),
  criterionIndexes: z.array(z.number().int().min(0).max(11)).max(12),
  expectedBehavior: text,
});
export const exposureRelationSchema = z.object({
  exposureId: id,
  relation: z.enum(['same_task', 'different_task', 'uncertain']),
  reason: text,
});
export const taskReviewResponseSchema = z.object({
  status: z.enum(['ready', 'needs_correction', 'uncertain']),
  summary: text.min(1),
  issues: z.array(verificationIssueSchema).max(30),
  privateSolution: text,
  branches: z.array(conditionBranchSchema).max(20),
  exposureRelations: z.array(exposureRelationSchema).max(100),
  sourceChecks: z.array(z.object(sourceCheckFields)).max(60).default([]),
  assessmentFindings: z
    .array(
      z.object({
        evidenceId: id,
        verdict: z.enum(['uphold', 'invalidate', 'uncertain']),
        reason: text,
      }),
    )
    .max(100)
    .default([]),
  mathChecks: mathCheckRequestsSchema.default([]),
});
export const disputeSignalSchema = z.object({
  dispute: z.object({ issue: text.min(1), reason: text }),
});
export function reviewedAssessmentValueSchema(sourceIds: string[], criterionIds: string[]) {
  return assessmentSchemaFor(sourceIds).extend({
    criteria: z
      .array(
        z.object({
          criterion: z.string().max(2000),
          criterionId: criterionIds.length
            ? z.enum(criterionIds as [string, ...string[]])
            : id.optional(),
          result: z.enum(['met', 'partial', 'not_yet', 'uncertain', 'not_applicable']),
          reason: text,
        }),
      )
      .min(1)
      .max(12),
  });
}
function responseObject<T extends z.ZodRawShape>(primary: z.ZodObject<T>) {
  // Object-root grammar works across providers; runtime checks keep the alternatives exclusive.
  return primary
    .partial()
    .extend({ dispute: disputeSignalSchema.shape.dispute.optional() })
    .superRefine((value, context) => {
      if ((value as Record<string, unknown>).dispute) {
        if (
          Object.keys(primary.shape).some(
            (key) => (value as Record<string, unknown>)[key] !== undefined,
          )
        )
          context.addIssue({
            code: 'custom',
            message: '质疑必须单独返回，不能同时评价或给出帮助。',
          });
        return;
      }
      const parsed = primary.safeParse(value);
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    });
}
export function reviewedAssessmentSchema(sourceIds: string[], criterionIds: string[]) {
  return responseObject(reviewedAssessmentValueSchema(sourceIds, criterionIds));
}
export function reviewedHelpSchema(sourceIds: string[]) {
  const help = helpSchemaFor(sourceIds);
  return responseObject(help.extend({ sourceIds: help.shape.sourceIds.unwrap().optional() }));
}

/** Generation-only IDs; stored reviews keep the backward-compatible persistent shape. */
export function taskReviewSchemaFor(allowed: {
  stepIds: string[];
  sourceIds: string[];
  exposureIds: string[];
  evidenceIds: string[];
}) {
  const exact = (values: string[]) => z.enum([...new Set(values)] as [string, ...string[]]);
  const sourceCheck = z.object({
    ...sourceCheckFields,
    sourceId: allowed.sourceIds.length ? exact(allowed.sourceIds) : id,
  });
  const finding = z.object({
    evidenceId: allowed.evidenceIds.length ? exact(allowed.evidenceIds) : id,
    verdict: z.enum(['uphold', 'invalidate', 'uncertain']),
    reason: text,
  });
  return taskReviewResponseSchema.extend({
    issues: z
      .array(
        verificationIssueSchema.extend({
          stepId: allowed.stepIds.length ? exact(allowed.stepIds).optional() : z.never().optional(),
        }),
      )
      .max(30),
    sourceChecks: z
      .array(sourceCheck)
      .max(allowed.sourceIds.length ? 60 : 0)
      .default([]),
    exposureRelations: z
      .array(
        exposureRelationSchema.extend({
          exposureId: allowed.exposureIds.length ? exact(allowed.exposureIds) : id,
        }),
      )
      .max(allowed.exposureIds.length ? 100 : 0),
    assessmentFindings: z
      .array(finding)
      .max(allowed.evidenceIds.length ? 100 : 0)
      .default([]),
  });
}
