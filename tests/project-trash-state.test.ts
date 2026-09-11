import {describe,expect,it} from 'vitest';
import {TRASH_RETENTION_DAYS,isTrashed,projectTrashPayload,trashDaysRemaining,trashedProjects,visibleProjects} from '../src/shared/projects';
import type {Project} from '../src/shared/types';

const now='2026-09-11T00:00:00.000Z';
const project=(id:string,status:Project['status']='active'):Project=>({id,title:id,goal:'学习',status,createdAt:now,updatedAt:now});

describe('project trash state',()=>{
 it('separates visible and trashed projects without changing their learning state',()=>{
  const active=project('active');
  const paused=project('paused','paused');
  const older={...project('older'),trashedAt:'2026-09-01T00:00:00.000Z',statusBeforeTrash:'active' as const};
  const newer={...project('newer','paused'),trashedAt:'2026-09-10T00:00:00.000Z',statusBeforeTrash:'paused' as const};

  expect(visibleProjects([older,active,newer,paused]).map(item=>item.id)).toEqual(['active','paused']);
  expect(trashedProjects([older,active,newer,paused]).map(item=>item.id)).toEqual(['newer','older']);
  expect(isTrashed(newer)).toBe(true);
  expect(newer.status).toBe('paused');
  expect(newer.statusBeforeTrash).toBe('paused');
 });

 it('reports a clamped 30-day recovery window',()=>{
  const tenDaysAgo={...project('ten'),trashedAt:'2026-09-01T00:00:00.000Z',statusBeforeTrash:'active' as const};
  const expired={...project('expired'),trashedAt:'2026-08-01T00:00:00.000Z',statusBeforeTrash:'active' as const};
  const future={...project('future'),trashedAt:'2026-09-12T00:00:00.000Z',statusBeforeTrash:'active' as const};

 expect(TRASH_RETENTION_DAYS).toBe(30);
  expect(projectTrashPayload('project-id')).toEqual({id:'project-id'});
  expect(trashDaysRemaining(tenDaysAgo,new Date(now))).toBe(20);
  expect(trashDaysRemaining(expired,new Date(now))).toBe(0);
  expect(trashDaysRemaining(future,new Date(now))).toBe(30);
 });
});
