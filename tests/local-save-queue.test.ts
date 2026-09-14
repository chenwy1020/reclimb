import {expect,it} from 'vitest';
import {flushAdditionalLocalDrafts,registerLocalDraftFlush,trackLocalSave} from '../src/renderer/local-save-queue';
it('waits for an in-flight local confirmation before allowing close',async()=>{
 let resolve!:()=>void,closed=false;const request=trackLocalSave(new Promise<void>(done=>resolve=done));
 const closing=flushAdditionalLocalDrafts().then(()=>{closed=true});await Promise.resolve();expect(closed).toBe(false);
 resolve();await request;await closing;expect(closed).toBe(true);
});
it('flushes unscheduled draft text and refuses close on persistence failure',async()=>{
 const remove=registerLocalDraftFlush(async()=>{throw new Error('disk full')});
 try{await expect(flushAdditionalLocalDrafts()).rejects.toThrow('disk full');}finally{remove();}
 await expect(flushAdditionalLocalDrafts()).resolves.toBeUndefined();
});
it('includes a local write enqueued while another draft is flushing',async()=>{
 let complete!:()=>void;const remove=registerLocalDraftFlush(async()=>{trackLocalSave(new Promise<void>(done=>complete=done));});
 let closed=false;const closing=flushAdditionalLocalDrafts().then(()=>closed=true);await Promise.resolve();await Promise.resolve();expect(closed).toBe(false);
 complete();await closing;remove();expect(closed).toBe(true);
});
