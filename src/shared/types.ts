import type { KnowledgeRelation, KnowledgeUse } from './knowledge-graph';
import type {
  Operation,
  LearningProposal,
  RouteAssociation,
  ReaderState,
  ValidationSet,
  ValidationTask,
  ValidationRun,
  ValidationExposure,
  TrialRecord,
} from './remediation';
import type {
  StartingPoint,
  LearningScope,
  NearStep,
  TeachingState,
  TransferCheck,
  SupportScope,
  TeachingStep,
} from './teaching';
import type { SourceQuality, PdfMetadata, SourceTranscription, ReadingLayout } from './materials';
import type {
  TeachingVersion,
  TeachingSource,
  TaskReview,
  Dispute,
  CorrectionRecord,
  AnswerExposure,
} from './reliability';
import type {
  LearningPosition,
  LearningUnit,
  RouteVersion,
  TaskDemand,
  TeachingObservation,
  UnderstandingDraft,
} from './curriculum';
export type {
  LearningPosition,
  LearningUnit,
  RouteVersion,
  TaskDemand,
  TeachingObservation,
  UnderstandingDraft,
} from './curriculum';
export type ProjectStatus = 'active' | 'paused';
export type ActivityKind =
  'prediction' | 'application' | 'argument' | 'reconstruction' | 'diagnosis' | 'selection';
export type SessionMode = 'practice' | 'delayed' | 'transfer' | 'diagnosis' | 'selection';
export interface Project {
  id: string;
  title: string;
  goal: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
  statusBeforeTrash?: ProjectStatus;
  routeSummary?: string;
  startingPoint?: StartingPoint;
  learningScope?: LearningScope;
  nearSteps?: NearStep[];
  activeRouteVersionId?: string;
  bookRouteVersionId?: string;
  pendingRouteVersionId?: string;
  learningPositionId?: string;
}
export interface Capability {
  id: string;
  projectId: string;
  title: string;
  description: string;
  prerequisites: string[];
  sourceIds: string[];
  order: number;
  archived?: boolean;
  goalContext?: string;
}
export interface Material {
  id: string;
  projectId: string;
  title: string;
  kind: string;
  originalName: string;
  storedPath: string;
  importedAt: string;
  warnings: string[];
  fragmentCount: number;
  summary: string;
  sourceUrl?: string;
  pdfMetadata?: PdfMetadata;
}
export interface Fragment {
  id: string;
  materialId: string;
  projectId: string;
  locator: string;
  text: string;
  ordinal: number;
  pageNumber?: number;
  printedPageLabel?: string;
  quality?: SourceQuality;
  searchableText?: string;
}
export interface Activity {
  id?: string;
  teachingVersionId?: string;
  rubricIds?: string[];
  transferCheck?: TransferCheck;
  sourceVersions?: { fragmentId: string; transcriptionIds: string[] }[];
  title: string;
  instruction: string;
  kind: ActivityKind;
  rubric: string[];
  sourceIds: string[];
  referenceAnswer?: string;
  assessmentBasis: 'source' | 'rule' | 'ai';
  demand?: TaskDemand;
  workSize?: 'short' | 'extended';
  milestones?: string[];
}
export interface HelpEvent {
  id: string;
  kind: 'hint' | 'confused' | 'example' | 'answer' | 'explore';
  level: number;
  createdAt: string;
  taskId?: string;
  scope?: SupportScope;
}
export type LearningInputKind = 'attempt' | 'explore' | 'note';
export type InputResponseMode = 'assessment' | 'discussion';
export type InputResponseState = 'pending' | 'running' | 'completed' | 'failed';
export interface FollowupTarget {
  kind: 'step' | 'message' | 'source';
  id: string;
  intent: 'question' | 'example';
  teachingVersionId?: string;
  historyIndex?: number;
}
export interface ResolvedFollowup extends FollowupTarget {
  title: string;
  text: string;
  sourceIds: string[];
  sources: TeachingSource[];
  rootInputId: string;
  parentMessageId?: string;
  taskId?: string;
  stepId?: string;
  teachingVersionId?: string;
  contextWarning?: string;
}
export interface RecordInputRequest {
  requestId: string;
  text: string;
  kind: LearningInputKind;
  taskId?: string;
  stepId?: string;
  teachingVersionId?: string;
  followup?: FollowupTarget;
}
export interface RecordedInputReceipt {
  inputId: string;
  attemptId?: string;
  responseMode: InputResponseMode;
  responseState: InputResponseState;
  savedAt: string;
}
export interface SessionMessage {
  handwritingId?: string;
  handwritingTranscriptionId?: string;
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: string;
  kind?: string;
  sourceIds?: string[];
  taskId?: string;
  stepId?: string;
  scope?: SupportScope;
  inputId?: string;
  requestId?: string;
  attemptId?: string;
  teachingVersionId?: string;
  responseState?: InputResponseState;
  responseMode?: InputResponseMode;
  responseError?: string;
  responseUpdatedAt?: string;
  activitySnapshot?: Activity;
  stepSnapshot?: TeachingStep;
  helpLevel?: number;
  followup?: ResolvedFollowup;
}
export interface Session {
  handwritingDrafts?: Record<string, import('./handwriting').HandwritingTextDraft>;
  id: string;
  projectId: string;
  capabilityId: string;
  unitId?: string;
  routeVersionId?: string;
  activity: Activity;
  teachingVersionId?: string;
  mode: SessionMode;
  status: 'active' | 'paused' | 'completed';
  createdAt: string;
  updatedAt: string;
  draft: string;
  helpLevel: number;
  helpEvents: HelpEvent[];
  messages: SessionMessage[];
  checkpoint: string;
  nextStep: string;
  dueReviewId?: string;
  teaching?: TeachingState;
  taskDrafts?: Record<string, string>;
}
export interface Assessment {
  outcome: 'met' | 'partial' | 'not_yet' | 'uncertain';
  feedback: string;
  criteria: {
    criterionId?: string;
    criterion: string;
    result: 'met' | 'partial' | 'not_yet' | 'uncertain' | 'not_applicable';
    reason: string;
  }[];
  limitations: string[];
  sourceIds: string[];
}
export interface Attempt {
  handwritingId?: string;
  handwritingTranscriptionId?: string;
  id: string;
  projectId: string;
  sessionId: string;
  text: string;
  submittedAt: string;
  helpLevel: number;
  requestId: string;
  teachingVersionId?: string;
  assessment?: Assessment;
  activitySnapshot?: Activity;
  taskId?: string;
  stepId?: string;
  mode?: SessionMode;
  reviewId?: string;
}
export type EvidenceStatus = 'assisted' | 'independent' | 'delayed' | 'transfer' | 'needs_review';
export interface Evidence {
  id: string;
  projectId: string;
  capabilityId: string;
  sessionId: string;
  attemptId: string;
  status: EvidenceStatus;
  helpLevel: number;
  assessment: Assessment;
  createdAt: string;
  teachingVersionId?: string;
  activitySnapshot?: Activity;
  taskId?: string;
  stepId?: string;
  reviewId?: string;
}
export interface Review {
  id: string;
  projectId: string;
  capabilityId: string;
  fromSessionId: string;
  kind: 'delayed' | 'transfer';
  dueAt: string;
  status: 'pending' | 'done' | 'snoozed';
  completedSessionId?: string;
  fromTaskId?: string;
  fromActivity?: Activity;
  completedEvidenceId?: string;
  completedTaskId?: string;
}
export interface VisionSettings {
  enabled: boolean;
  providerName: string;
  baseUrl: string;
  model: string;
  inputPriceCnyPerMillion: number;
  outputPriceCnyPerMillion: number;
  priceUpdatedAt: string;
  hasApiKey?: boolean;
}
export const DEFAULT_MODEL_PROFILE_ID = 'default-model';
export interface ModelProfile {
  id: string;
  name: string;
  providerName: string;
  baseUrl: string;
  model: string;
  maxOutputTokens?: number;
  inputPriceCnyPerMillion: number;
  outputPriceCnyPerMillion: number;
  priceUpdatedAt: string;
  enabled: boolean;
  hasApiKey?: boolean;
}
export interface Settings {
  providerName: string;
  baseUrl: string;
  model: string;
  maxOutputTokens?: number;
  monthlyBudgetCny: number;
  inputPriceCnyPerMillion: number;
  outputPriceCnyPerMillion: number;
  priceUpdatedAt: string;
  hasApiKey: boolean;
  personalGoal: string;
  studyMinutes: number;
  confirmedPreferences: string;
  vision?: VisionSettings;
  modelProfiles?: ModelProfile[];
  activeModelProfileId?: string;
}
export interface Usage {
  id: string;
  createdAt: string;
  requestId: string;
  kind: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCny: number;
  status: 'reserved' | 'completed' | 'uncertain' | 'failed';
  entryType?: 'call' | 'hold';
  operationId?: string;
  reasoningTokens?: number;
  finishReason?: string;
  providerRequestId?: string;
  validationStatus?: 'pending' | 'valid' | 'invalid' | 'not_received';
  publicationStatus?: 'pending' | 'published' | 'discarded';
  modelProfileId?: string;
  profileName?: string;
  providerName?: string;
  requestedModel?: string;
  reportedModel?: string;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  durationMs?: number;
  requestPhase?: 'initial' | 'repair';
  threadId?: string;
  promptLayout?: string;
  promptPrefixHash?: string;
  promptPrefixCharacters?: number;
  requestCharacters?: number;
}
export interface EntityMap {
  knowledgeRelations: KnowledgeRelation;
  knowledgeUses: KnowledgeUse;
  operations: Operation;
  learningProposals: LearningProposal;
  routeAssociations: RouteAssociation;
  readerStates: ReaderState;
  validationSets: ValidationSet;
  validationTasks: ValidationTask;
  validationRuns: ValidationRun;
  validationExposures: ValidationExposure;
  trialRecords: TrialRecord;
  handwritingTranscriptions: import('./handwriting').HandwritingTranscription;
  handwritingTargets: import('./handwriting').HandwritingTarget;
  handwritings: import('./handwriting').HandwritingSubmission;
  projects: Project;
  capabilities: Capability;
  materials: Material;
  fragments: Fragment;
  sessions: Session;
  attempts: Attempt;
  evidence: Evidence;
  reviews: Review;
  usage: Usage;
  sourceTranscriptions: SourceTranscription;
  teachingVersions: TeachingVersion;
  taskReviews: TaskReview;
  disputes: Dispute;
  corrections: CorrectionRecord;
  answerExposures: AnswerExposure;
  routeVersions: RouteVersion;
  learningUnits: LearningUnit;
  learningPositions: LearningPosition;
  teachingObservations: TeachingObservation;
  understandingDrafts: UnderstandingDraft;
  readingLayouts: ReadingLayout;
}
export type Collection = keyof EntityMap;
export interface WorkspaceSnapshot {
  knowledgeRelations?: KnowledgeRelation[];
  knowledgeUses?: KnowledgeUse[];
  operations?: Operation[];
  learningProposals?: LearningProposal[];
  routeAssociations?: RouteAssociation[];
  readerStates?: ReaderState[];
  validationSets?: ValidationSet[];
  validationTasks?: ValidationTask[];
  validationRuns?: ValidationRun[];
  validationExposures?: ValidationExposure[];
  trialRecords?: TrialRecord[];
  handwritingTranscriptions?: import('./handwriting').HandwritingTranscription[];
  handwritingTargets?: import('./handwriting').HandwritingTarget[];
  handwritings?: import('./handwriting').HandwritingSubmission[];
  projects: Project[];
  capabilities: Capability[];
  materials: Material[];
  fragments: Fragment[];
  sessions: Session[];
  attempts: Attempt[];
  evidence: Evidence[];
  reviews: Review[];
  usage: Usage[];
  sourceTranscriptions: SourceTranscription[];
  teachingVersions: TeachingVersion[];
  taskReviews: TaskReview[];
  disputes: Dispute[];
  corrections: CorrectionRecord[];
  answerExposures: AnswerExposure[];
  routeVersions: RouteVersion[];
  learningUnits: LearningUnit[];
  learningPositions: LearningPosition[];
  teachingObservations: TeachingObservation[];
  understandingDrafts: UnderstandingDraft[];
  readingLayouts: ReadingLayout[];
  settings: Settings;
  dataDirectory: string;
}
export type DesktopAction =
  | 'knowledge.view'
  | 'knowledge.confirm'
  | 'knowledge.retract'
  | 'knowledge.check'
  | 'lesson.startFromSources'
  | 'operation.retry'
  | 'unit.saveGoal'
  | 'proposal.save'
  | 'proposal.analyze'
  | 'proposal.adopt'
  | 'proposal.dismiss'
  | 'association.propose'
  | 'association.accept'
  | 'association.dismiss'
  | 'reader.save'
  | 'validation.createSet'
  | 'validation.import'
  | 'validation.edit'
  | 'validation.readTask'
  | 'validation.start'
  | 'validation.answer'
  | 'validation.results'
  | 'validation.generate'
  | 'validation.trial'
  | 'validation.export'
  | 'operation.resume'
  | 'sync.saveCopy'
  | 'sync.configure'
  | 'sync.status'
  | 'sync.check'
  | 'sync.upload'
  | 'sync.preview'
  | 'sync.adopt'
  | 'sync.cancel'
  | 'handwriting.draft'
  | 'handwriting.saveDraft'
  | 'handwriting.recognize'
  | 'handwriting.confirm'
  | 'handwriting.transcriptions'
  | 'handwriting.respond'
  | 'handwriting.responses'
  | 'handwriting.addresses'
  | 'handwriting.start'
  | 'handwriting.status'
  | 'handwriting.stop'
  | 'handwriting.renew'
  | 'handwriting.approve'
  | 'handwriting.reject'
  | 'handwriting.target'
  | 'handwriting.list'
  | 'handwriting.read'
  | 'workspace.snapshot'
  | 'project.create'
  | 'project.update'
  | 'project.trash'
  | 'project.restore'
  | 'project.purge'
  | 'project.startingPoint'
  | 'project.confirmScope'
  | 'route.generate'
  | 'route.adopt'
  | 'route.dismiss'
  | 'material.importFiles'
  | 'material.importUrl'
  | 'material.importText'
  | 'material.openOriginal'
  | 'material.pdfBytes'
  | 'material.analyzePdf'
  | 'material.transcribe'
  | 'material.confirmTranscription'
  | 'material.manualTranscription'
  | 'session.dispute'
  | 'dispute.review'
  | 'session.verification'
  | 'session.reviewSolution'
  | 'session.verify'
  | 'lesson.start'
  | 'session.saveDraft'
  | 'session.submit'
  | 'session.recordInput'
  | 'session.respondInput'
  | 'session.adoptConfirmedSources'
  | 'session.help'
  | 'session.nextStep'
  | 'session.pause'
  | 'session.resume'
  | 'understanding.save'
  | 'understanding.suggest'
  | 'review.reschedule'
  | 'settings.save'
  | 'settings.test'
  | 'settings.modelProfile.save'
  | 'settings.modelProfile.activate'
  | 'settings.modelProfile.test'
  | 'settings.modelProfile.remove'
  | 'diagnostics.preview'
  | 'diagnostics.export'
  | 'backup.create'
  | 'backup.restore'
  | 'export.markdown'
  | 'sample.seed';
export interface DesktopAPI {
  onCloseRequested(handler: () => Promise<void>): () => void;
  request<T = unknown>(action: DesktopAction, payload?: unknown): Promise<T>;
}
declare global {
  interface Window {
    learning: DesktopAPI;
  }
}
