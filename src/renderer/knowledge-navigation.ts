import type {WorkspaceSnapshot} from '../shared/types';
export function knowledgeCheckDestination(snapshot:WorkspaceSnapshot,projectId:string,capabilityId:string):{projectId:string;sessionId:string}|undefined{
 const project=snapshot.projects.find(item=>item.id===projectId&&!item.trashedAt);
 if(!project)return;
 const candidates=snapshot.sessions.filter(session=>session.projectId===projectId&&session.capabilityId===capabilityId);
 const position=snapshot.learningPositions.find(item=>item.id===project.learningPositionId&&item.projectId===projectId);
 const session=candidates.find(item=>item.id===position?.sessionId)??[...candidates].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 return session?{projectId,sessionId:session.id}:undefined;
}
