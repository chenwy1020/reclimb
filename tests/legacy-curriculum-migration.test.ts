import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LearningStore} from '../src/main/store';
import {LearningService} from '../src/main/learning-service';

const roots:string[]=[];afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));

it('adopts a stable legacy route and reconnects a determinable old session without model calls',async()=>{
 const root=mkdtempSync(join(tmpdir(),'reclimb-legacy-curriculum-'));roots.push(root);const store=await LearningStore.open(root),now='2026-09-08T12:00:00.000Z';
 store.put('projects',{id:'p',title:'旧项目',goal:'理解并使用方法',status:'active',nearSteps:[{id:'near',capabilityId:'c',title:'旧的近期建议',objective:'理解方法',reason:'旧版建议',sourceIds:[]}],createdAt:now,updatedAt:now});store.put('capabilities',{id:'c',projectId:'p',title:'方法',description:'解释方法',prerequisites:[],sourceIds:[],order:0});store.put('sessions',{id:'s',projectId:'p',capabilityId:'c',activity:{id:'task',title:'旧任务',instruction:'说明方法',kind:'reconstruction',rubric:['说明'],sourceIds:[],assessmentBasis:'ai'},mode:'practice',status:'active',createdAt:now,updatedAt:now,draft:'旧草稿',helpLevel:0,helpEvents:[],messages:[],checkpoint:'旧位置',nextStep:'继续'});
 let calls=0;new LearningService(store,()=>'test',()=>({complete:async()=>{calls++;throw new Error('must not call');}}));const project=store.get('projects','p')!,route=store.get('routeVersions',project.activeRouteVersionId!)!,unit=store.list('learningUnits','p')[0],position=store.get('learningPositions',project.learningPositionId!)!;
 expect(calls).toBe(0);expect(route).toMatchObject({origin:'legacy',status:'adopted'});expect(unit.title).toBe('旧的近期建议');expect(store.get('sessions','s')).toMatchObject({unitId:unit.id,routeVersionId:route.id,draft:'旧草稿'});expect(position).toMatchObject({unitId:unit.id,sessionId:'s',confidence:'inferred',updatedAt:now});expect(project).toMatchObject({updatedAt:now});expect(project.nearSteps).toBeUndefined();
 const counts=[store.list('routeVersions').length,store.list('learningUnits').length,store.list('learningPositions').length];new LearningService(store,()=>'',()=>({complete:async()=>{throw new Error('must not call');}}));expect([store.list('routeVersions').length,store.list('learningUnits').length,store.list('learningPositions').length]).toEqual(counts);store.close();
});
