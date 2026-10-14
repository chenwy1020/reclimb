import type {WorkspaceSnapshot} from '../shared/types';

export function lessonSession(snapshot:Pick<WorkspaceSnapshot,'projects'|'sessions'|'learningPositions'>,projectId:string,request:{reviewId?:string;capabilityId?:string;unitId?:string}={}){
 const project=snapshot.projects.find(item=>item.id===projectId&&!item.trashedAt);
 if(!project)return;
 const candidates=snapshot.sessions.filter(item=>item.projectId===projectId&&(!request.capabilityId||item.capabilityId===request.capabilityId)&&(!request.unitId||item.unitId===request.unitId));
 const position=snapshot.learningPositions.find(item=>item.id===project.learningPositionId&&item.projectId===projectId);
 return candidates.find(item=>item.id===position?.sessionId&&(!request.reviewId||item.dueReviewId===request.reviewId))??candidates.filter(item=>item.status==='active'&&item.dueReviewId===request.reviewId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.updatedAt.localeCompare(a.updatedAt))[0];
}
