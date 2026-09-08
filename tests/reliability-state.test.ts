import {describe,it,expect} from 'vitest';
import {evidenceStanding,reviewStanding,versionStanding} from '../src/shared/reliability-state';
import {publicSnapshot} from '../src/main/public-snapshot';
const snapshot=()=>({teachingVersions:[{id:'v',projectId:'p',taskId:'t',contentHash:'hash'}],taskReviews:[{id:'r',teachingVersionId:'v',contentHash:'hash',status:'ready',summary:'SECRET',privateSolution:'SECRET',branches:[{expectedBehavior:'SECRET'}],issues:[{message:'SECRET'}],exposureRelations:[{reason:'SECRET'}],localChecks:[{status:'pass',details:'SECRET'}]}],disputes:[],corrections:[],answerExposures:[{text:'SECRET'}],evidence:[{id:'e',projectId:'p',taskId:'t',sessionId:'s',capabilityId:'c',status:'independent'}]} as any);
describe('append-only correction projection',()=>{
 it('does not revive invalidated evidence when the question is restored',()=>{
  const s=snapshot();s.corrections=[{teachingVersionId:'v',action:'suspend',reason:'待核对'},{teachingVersionId:'v',evidenceId:'e',action:'invalidate',reason:'旧评分有错'},{teachingVersionId:'v',action:'restore'}];
  expect(versionStanding(s,'v').effective).toBe(true);expect(evidenceStanding(s,s.evidence[0])).toEqual({effective:false,reason:'旧评分有错'});
  expect(reviewStanding(s,{projectId:'p',fromTaskId:'t',fromSessionId:'s',capabilityId:'c'} as any).effective).toBe(false);
  s.corrections.push({teachingVersionId:'v',evidenceId:'e',action:'restore'});expect(evidenceStanding(s,s.evidence[0]).effective).toBe(true);
 });
 it('keeps unversioned history intact except explicitly matched tasks',()=>{
  const s=snapshot();s.corrections=[{teachingVersionId:'v',action:'suspend',reason:'精确复核'}];
  expect(evidenceStanding(s,s.evidence[0]).effective).toBe(false);
  expect(evidenceStanding(s,{...s.evidence[0],id:'other',taskId:'other'}).effective).toBe(true);
 });
 it('never exports hidden review answers through the ordinary renderer snapshot',()=>{
  const s=snapshot(),pub=publicSnapshot(s);expect(JSON.stringify(pub)).not.toContain('SECRET');expect(s.taskReviews[0].privateSolution).toBe('SECRET');
 });
});
