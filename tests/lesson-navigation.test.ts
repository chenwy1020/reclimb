import {expect,it} from 'vitest';
import type {Project,Session,WorkspaceSnapshot} from '../src/shared/types';
import {lessonSession} from '../src/renderer/lesson-navigation';

const at='2026-10-15T00:00:00.000Z';
const project:Project={id:'p',title:'当前项目',goal:'学习',status:'active',createdAt:at,updatedAt:at};
const session=(id:string,extra:Partial<Session>={}):Session=>({id,projectId:'p',capabilityId:'c',activity:{title:'尝试',instruction:'比较',rubric:[],kind:'application',sourceIds:[],assessmentBasis:'ai'},mode:'practice',status:'active',createdAt:at,updatedAt:at,draft:'',helpLevel:0,helpEvents:[],messages:[],checkpoint:'',nextStep:'',...extra});
const snapshot=(sessions:Session[],position?:WorkspaceSnapshot['learningPositions'][number]):Pick<WorkspaceSnapshot,'projects'|'sessions'|'learningPositions'>=>({projects:[{...project,learningPositionId:position?.id}],sessions,learningPositions:position?[position]:[]});

it('selects the newest ordinary session from the requested project without matching an undefined review across projects',()=>{
 const state=snapshot([session('foreign',{projectId:'other'}),session('old'),session('new',{createdAt:'2026-10-15T01:00:00.000Z'})]);
 expect(lessonSession(state,'p')?.id).toBe('new');
});
it('returns no session when only another project has an active session',()=>{
 expect(lessonSession(snapshot([session('foreign',{projectId:'other'})]),'p')).toBeUndefined();
});
it('keeps the current project position even when another session was created later',()=>{
 const position={id:'pos',projectId:'p',routeVersionId:'r',unitId:'u',sessionId:'positioned',intent:'continue' as const,reason:'',nextRequirement:'',confidence:'confirmed' as const,updatedAt:at};
 expect(lessonSession(snapshot([session('newer',{createdAt:'2026-10-15T01:00:00.000Z'}),session('positioned')],position),'p')?.id).toBe('positioned');
});
it('rejects a foreign position and honors the requested review instead of the ordinary current position',()=>{
 const position={id:'pos',projectId:'p',routeVersionId:'r',unitId:'u',sessionId:'ordinary',intent:'continue' as const,reason:'',nextRequirement:'',confidence:'confirmed' as const,updatedAt:at};
 const state=snapshot([session('ordinary'),session('foreign-review',{projectId:'other',dueReviewId:'review'}),session('review',{dueReviewId:'review',mode:'delayed'})],position);
 expect(lessonSession(state,'p',{reviewId:'review'})?.id).toBe('review');
 expect(lessonSession({...state,learningPositions:[{...position,projectId:'other',sessionId:'foreign-review'}]},'p')?.id).toBe('ordinary');
});
it('matches the requested capability and unit and does not fall back to completed sessions',()=>{
 const state=snapshot([session('wrong-capability',{capabilityId:'other',unitId:'u'}),session('wrong-unit',{unitId:'other'}),session('completed',{unitId:'u',status:'completed'}),session('matching',{unitId:'u'})]);
 expect(lessonSession(state,'p',{capabilityId:'c',unitId:'u'})?.id).toBe('matching');
});
it('preserves a review session explicitly resumed into the project position by an ordinary continue action',()=>{
 const position={id:'pos',projectId:'p',routeVersionId:'r',unitId:'u',sessionId:'resumed-review',intent:'continue' as const,reason:'',nextRequirement:'',confidence:'confirmed' as const,updatedAt:at};
 expect(lessonSession(snapshot([session('resumed-review',{unitId:'u',dueReviewId:'review',mode:'delayed'})],position),'p',{unitId:'u'})?.id).toBe('resumed-review');
});
