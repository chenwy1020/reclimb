import {randomUUID} from 'node:crypto';
import {readerStateSchema} from '../shared/remediation';
import {LearningStore} from './store';
export function saveReaderState(store:LearningStore,value:unknown){
 const p=readerStateSchema.omit({id:true,updatedAt:true}).parse(value),project=store.get('projects',p.projectId),material=store.get('materials',p.materialId);
 if(!project||project.trashedAt||material?.projectId!==p.projectId)throw new Error('阅读材料不属于当前可用项目。');
 if(p.fragmentId){const f=store.get('fragments',p.fragmentId);if(!f||f.materialId!==p.materialId||f.projectId!==p.projectId||(p.pageNumber!==undefined&&p.pageNumber!==f.pageNumber))throw new Error('阅读页段与材料页码不一致。');}
 const old=store.list('readerStates',p.projectId).find(r=>r.materialId===p.materialId),state={...p,id:old?.id??randomUUID(),updatedAt:new Date().toISOString()};store.put('readerStates',state);return state;
}
