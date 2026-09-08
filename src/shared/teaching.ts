import type { Activity } from './types';

export type Familiarity = 'new' | 'some' | 'experienced';
export interface StartingPoint { familiarity: Familiarity; background: string; updatedAt: string; }
export interface LearningScope { suggestedFocus: string; reason: string; status: 'proposed' | 'confirmed'; confirmedAt?: string; }
export interface NearStep { id: string; capabilityId: string; title: string; objective: string; reason: string; sourceIds: string[]; completion?: string; prerequisites?: string[]; }
export type TeachingAction = 'explain' | 'demonstrate' | 'attempt' | 'feedback' | 'check' | 'reflect';
export type TeachingIntent = 'continue' | 'smaller' | 'independent' | 'return';
export type ConfusionKind = 'term' | 'reason' | 'step' | 'overload';
export type SupportScope = 'concept' | 'other_example' | 'current_task' | 'navigation';
export interface TransferCheck { changedSituation: string; sharedPrinciple: string; requiredAdaptation: string; verdict: 'valid' | 'same_task' | 'uncertain'; reason: string; }
export interface TeachingStep { id: string; taskId: string; action: TeachingAction; title: string; content: string; sourceIds: string[]; activity?: Activity; createdAt: string; }
export interface TeachingState { version: 1; current: TeachingStep; upcoming: TeachingStep[]; history: TeachingStep[]; guidance: 'guided' | 'supported' | 'independent'; confusionCount: number; lastConfusion?: ConfusionKind; returnStep?: TeachingStep; returnUpcoming?: TeachingStep[]; }
