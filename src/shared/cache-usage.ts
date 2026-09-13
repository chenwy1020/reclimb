import type {Usage} from './types';

const counter=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;

/** A missing report is unknown, not a measured cache miss. */
export function validatedCacheCounters(inputTokens:unknown,hit:unknown,miss?:unknown):{cacheHitTokens?:number;cacheMissTokens?:number}{
 if(!counter(inputTokens)||!counter(hit)||hit>inputTokens)return {};
 const remaining=miss===undefined?inputTokens-hit:miss;
 if(!counter(remaining)||remaining!==inputTokens-hit)return {};
 return {cacheHitTokens:hit,cacheMissTokens:remaining};
}

const localMonth=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
export function summarizeCacheUsage(rows:readonly Usage[],month=localMonth(new Date())){
 const calls=rows.filter(row=>row.entryType!=='hold'&&row.status!=='reserved'&&localMonth(new Date(row.createdAt))===month);
 let reportedCalls=0,hitTokens=0,missTokens=0,durationCalls=0,totalDurationMs=0;
 for(const row of calls){
  if(row.cacheHitTokens!==undefined&&row.cacheMissTokens!==undefined){
   const measured=validatedCacheCounters(row.inputTokens,row.cacheHitTokens,row.cacheMissTokens);
   if(measured.cacheHitTokens!==undefined){reportedCalls++;hitTokens+=measured.cacheHitTokens;missTokens+=measured.cacheMissTokens!;}
  }
  if(counter(row.durationMs)){durationCalls++;totalDurationMs+=row.durationMs;}
 }
 return {calls:calls.length,reportedCalls,unreportedCalls:calls.length-reportedCalls,hitTokens,missTokens,
  hitRate:hitTokens+missTokens>0?hitTokens/(hitTokens+missTokens):undefined,
  durationCalls,meanDurationMs:durationCalls>0?totalDurationMs/durationCalls:undefined};
}
