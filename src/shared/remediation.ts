import { z } from 'zod';

const id = z.string().min(1).max(120);
const text = z.string().max(100000);
const date = z.string().datetime();

// Operation describes durable work. Monetary reservations and charges remain in Usage.
export const operationSchema = z
  .object({
    id,
    projectId: id,
    requestId: id,
    kind: z.enum([
      'local_start',
      'input_response',
      'proposal_analysis',
      'validation_candidates',
      'handwriting_recognition',
      'route_generation',
    ]),
    phase: z.enum([
      'saved',
      'running',
      'awaiting_confirmation',
      'result_saved',
      'completed',
      'interrupted',
      'stale',
    ]),
    refs: z
      .object({
        sessionId: id.optional(),
        inputId: id.optional(),
        attemptId: id.optional(),
        unitId: id.optional(),
        routeVersionId: id.optional(),
        proposalId: id.optional(),
        handwritingId: id.optional(),
        validationSetId: id.optional(),
      })
      .strict(),
    binding: z.record(z.string(), z.unknown()),
    bindingDigest: z.string(),
    savedSummary: z.string().max(4000),
    failureStage: z.string().max(200).optional(),
    failureReason: z.string().max(4000).optional(),
    callIds: z.array(id),
    result: z.unknown().optional(),
    createdAt: date,
    updatedAt: date,
  })
  .strict();
export type Operation = z.infer<typeof operationSchema>;

export const unitGoalSchema = z
  .object({
    behavior: z.string().max(4000),
    materialScope: z.string().max(4000),
    allowedHelp: z.string().max(4000),
    verification: z.string().max(4000),
    version: z.number().int().positive(),
  })
  .strict();
export type UnitGoal = z.infer<typeof unitGoalSchema>;
export const knowledgeBasisSchema = z
  .object({ capabilityId: id, digest: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export type KnowledgeBasis = z.infer<typeof knowledgeBasisSchema>;
export const learningProposalSchema = z
  .object({
    knowledgeBasis: knowledgeBasisSchema.optional(),
    id,
    projectId: id,
    requestId: id,
    unitId: id.optional(),
    text: z.string().min(1).max(10000),
    reason: z.string().max(10000),
    status: z.enum(['saved', 'analyzing', 'proposed', 'adopted', 'dismissed', 'stale']),
    basisDigest: z.string(),
    basedOnEvidenceIds: z.array(id),
    basedOnTeachingVersionIds: z.array(id),
    analysis: z.string().max(20000).optional(),
    targetUnitId: id.optional(),
    intent: z
      .enum(['continue', 'challenge', 'advance', 'synthesize', 'consolidate', 'fill_gap'])
      .optional(),
    createdAt: date,
    updatedAt: date,
  })
  .strict();
export type LearningProposal = z.infer<typeof learningProposalSchema>;
export const routeAssociationSchema = z
  .object({
    id,
    projectId: id,
    localUnitId: id,
    bookUnitId: id,
    status: z.enum(['proposed', 'linked', 'dismissed']),
    reason: z.string().max(4000),
    createdAt: date,
    updatedAt: date,
  })
  .strict();
export type RouteAssociation = z.infer<typeof routeAssociationSchema>;
export const readerStateSchema = z
  .object({
    id,
    projectId: id,
    materialId: id,
    fragmentId: id.optional(),
    pageNumber: z.number().int().positive().optional(),
    scrollTop: z.number().min(0),
    expanded: z.array(z.string().max(120)).max(100),
    updatedAt: date,
  })
  .strict();
export type ReaderState = z.infer<typeof readerStateSchema>;

export const validationSetSchema = z
  .object({
    id,
    projectId: id,
    title: z.string().min(1).max(500),
    description: z.string().max(4000),
    createdAt: date,
    updatedAt: date,
  })
  .strict();
export type ValidationSet = z.infer<typeof validationSetSchema>;
export const validationTaskSchema = z
  .object({
    id,
    projectId: id,
    setId: id,
    familyId: id,
    version: z.number().int().positive(),
    title: z.string().min(1).max(500),
    prompt: text.min(1),
    referenceAnswer: text.min(1),
    rubric: z.array(z.string().min(1).max(4000)).min(1).max(30),
    source: z
      .object({
        kind: z.enum(['external', 'authored', 'ai']),
        citation: z.string().min(1).max(4000),
      })
      .strict(),
    review: z
      .object({
        status: z.enum(['unreviewed', 'reviewed']),
        reviewer: z.string().max(500),
        basis: z.string().max(10000),
        reviewedAt: date.optional(),
      })
      .strict(),
    capabilityId: id.optional(),
    comparableGroup: z.string().max(120),
    conditions: z.string().max(4000),
    transferFromTaskId: id.optional(),
    transferRationale: z.string().max(4000),
    transferCheck: z
      .object({
        changedSituation: z.string().max(4000),
        sharedPrinciple: z.string().max(4000),
        requiredAdaptation: z.string().max(4000),
        verdict: z.enum(['valid', 'same_task', 'uncertain']),
        reason: z.string().max(4000),
      })
      .strict()
      .optional(),
    supersedesId: id.optional(),
    createdAt: date,
  })
  .strict();
export type ValidationTask = z.infer<typeof validationTaskSchema>;
export const validationRunSchema = z
  .object({
    id,
    projectId: id,
    requestId: id,
    setId: id,
    taskId: id,
    sessionId: id,
    phase: z.enum(['before', 'after', 'delayed']),
    baselineRunId: id.optional(),
    baselineAttemptId: id.optional(),
    kind: z.enum(['standard', 'transfer']).optional(),
    status: z.enum(['active', 'completed']),
    startedAt: date,
    completedAt: date.optional(),
    selfReportedExposure: z.string().max(4000),
    exposures: z.array(
      z
        .object({
          kind: z.enum(['answer', 'hint', 'known', 'repeat']),
          detail: z.string().max(4000),
          createdAt: date,
        })
        .strict(),
    ),
    elapsedSeconds: z.number().min(0).optional(),
    attemptId: id.optional(),
    evidenceId: id.optional(),
  })
  .strict();
export type ValidationRun = z.infer<typeof validationRunSchema>;
export const validationExposureSchema = z
  .object({
    id,
    projectId: id,
    taskId: id,
    runId: id.optional(),
    kind: z.enum(['answer', 'hint', 'known', 'repeat']),
    detail: z.string().max(4000),
    createdAt: date,
  })
  .strict();
export type ValidationExposure = z.infer<typeof validationExposureSchema>;
export const trialRecordSchema = z
  .object({
    id,
    projectId: id,
    kind: z.enum(['device', 'cross_day']),
    status: z.enum(['passed', 'failed', 'unverified']),
    participant: z.string().max(500),
    environment: z.string().max(4000),
    protocol: z.string().max(10000),
    observations: text,
    runIds: z.array(id),
    createdAt: date,
  })
  .strict();
export type TrialRecord = z.infer<typeof trialRecordSchema>;

export const REMEDIATION_COLLECTIONS = [
  'operations',
  'learningProposals',
  'routeAssociations',
  'readerStates',
  'validationSets',
  'validationTasks',
  'validationRuns',
  'validationExposures',
  'trialRecords',
] as const;
export const remediationSchemas = {
  operations: operationSchema,
  learningProposals: learningProposalSchema,
  routeAssociations: routeAssociationSchema,
  readerStates: readerStateSchema,
  validationSets: validationSetSchema,
  validationTasks: validationTaskSchema,
  validationRuns: validationRunSchema,
  validationExposures: validationExposureSchema,
  trialRecords: trialRecordSchema,
};
