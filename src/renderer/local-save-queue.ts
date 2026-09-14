// Local persistence only. Paid model requests must never enter the close barrier.
const flushers=new Set<()=>Promise<unknown>>(),pending=new Set<Promise<unknown>>();
export function registerLocalDraftFlush(flush:()=>Promise<unknown>){flushers.add(flush);return()=>{flushers.delete(flush)};}
export function trackLocalSave<T>(request:Promise<T>):Promise<T>{
 pending.add(request);void request.then(()=>pending.delete(request),()=>pending.delete(request));return request;
}
export async function flushAdditionalLocalDrafts():Promise<void>{
 await Promise.all([...flushers].map(flush=>flush()));
 while(pending.size)await Promise.all([...pending]);
}
