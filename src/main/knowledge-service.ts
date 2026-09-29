import type {KnowledgeConfirmInput,KnowledgeRetractInput,KnowledgeMemory,KnowledgeRelation,KnowledgeUse} from '../shared/knowledge-graph';
import {buildKnowledgeView,capabilitySignature,knowledgeMemory,knowledgeConfirmSchema,knowledgeRetractSchema,latestKnowledgeRelations,knowledgeUseSchema,knowledgeRelationSchema} from '../shared/knowledge-graph';
import {LearningStore} from './store';
import {randomUUID} from 'node:crypto';

export class KnowledgeService {
 constructor(private readonly store:LearningStore){}
 confirm(input:KnowledgeConfirmInput):KnowledgeRelation {
  const parsed=knowledgeConfirmSchema.parse(input),snapshot=this.store.snapshot(),project=this.project(parsed.projectId),target=snapshot.capabilities.find(c=>c.id===parsed.targetCapabilityId&&c.projectId===project.id&&!c.archived),source=snapshot.capabilities.find(c=>c.id===parsed.sourceCapabilityId&&!c.archived);
  if(!target||!source)throw new Error('关联能力不存在或已经退出当前学习范围。');
  this.project(source.projectId);if(source.projectId===project.id)throw new Error('学习关联需要选择另一个项目的能力。');
  const previous=latestKnowledgeRelations(snapshot).find(r=>r.projectId===project.id&&r.targetCapabilityId===target.id&&r.sourceCapabilityId===source.id),id=randomUUID();
  const relation:KnowledgeRelation={id,projectId:project.id,sourceProjectId:source.projectId,sourceCapabilityId:source.id,targetCapabilityId:target.id,kind:parsed.kind,status:'confirmed',reason:parsed.reason,rootId:previous?.rootId??id,...(previous?{previousId:previous.id}:{}),sourceSignature:capabilitySignature(snapshot,source),targetSignature:capabilitySignature(snapshot,target),createdAt:new Date().toISOString()};
  knowledgeRelationSchema.parse(relation);this.store.put('knowledgeRelations',relation);return relation;
 }
 retract(input:KnowledgeRetractInput):KnowledgeRelation {
  const parsed=knowledgeRetractSchema.parse(input),original=this.store.get('knowledgeRelations',parsed.relationId);if(!original)throw new Error('学习关联不存在。');this.project(original.projectId);
  const latest=latestKnowledgeRelations(this.store.snapshot()).find(r=>r.rootId===original.rootId);if(latest?.id!==original.id||original.status!=='confirmed')throw new Error('关联已经更新或撤回，请刷新后再试。');
  const relation:KnowledgeRelation={...original,id:randomUUID(),previousId:original.id,status:'retracted',reason:parsed.reason,createdAt:new Date().toISOString()};this.store.put('knowledgeRelations',relation);return relation;
 }
 view(projectId:string,capabilityId?:string,search=''){return buildKnowledgeView(this.store.snapshot(),projectId,capabilityId,search);}
 rememberUse(teachingVersionId:string,memory:KnowledgeMemory):KnowledgeUse|undefined {
  const snapshot=this.store.snapshot(),version=this.store.get('teachingVersions',teachingVersionId);this.project(memory.projectId);
  if(!version||version.projectId!==memory.projectId||version.capabilityId!==memory.capabilityId)throw new Error('历史依据与教学版本不匹配。');
  const current=knowledgeMemory(snapshot,memory.projectId,memory.capabilityId);if(current.fingerprint!==memory.fingerprint||JSON.stringify(current.entries)!==JSON.stringify(memory.entries))throw new Error('历史关联或表现依据已经改变，请重新生成任务。');
  if(!current.entries.length)return;
  const previous=this.store.list('knowledgeUses',memory.projectId).find(u=>u.teachingVersionId===teachingVersionId);if(previous){if(previous.fingerprint!==current.fingerprint)throw new Error('此教学版本已绑定不同的历史依据。');return previous;}
  const use=knowledgeUseSchema.parse({id:randomUUID(),projectId:memory.projectId,teachingVersionId,targetCapabilityId:memory.capabilityId,entries:current.entries,fingerprint:current.fingerprint,createdAt:new Date().toISOString()});this.store.put('knowledgeUses',use);return use;
 }
 private project(id:string){const project=this.store.get('projects',id);if(!project)throw new Error('学习项目不存在。');if(project.trashedAt)throw new Error('项目在最近删除中，请先恢复。');return project;}
}
