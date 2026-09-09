import type {Session,TeachingObservation} from '../shared/types';
import type {ProgressionIntent,TaskDemand} from '../shared/curriculum';

const demandRank:Record<TaskDemand['kind'],number>={recognize:0,calculate:1,explain:2,compare:3,derive:4,integrate:5,transfer:6,synthesize:7};

export function taskFamilySignature(text:string,demand?:TaskDemand):string{
 if(demand)return 'demand:'+demand.kind+':'+[...new Set(demand.concepts.map(concept=>concept.normalize('NFKC').trim().toLocaleLowerCase()))].sort().join('|');
 return text.normalize('NFKC').toLocaleLowerCase()
  .replace(/\\[a-zA-Z]+/g,'\\cmd')
  .replace(/\b[a-z]\b/g,'v')
  .replace(/\d+(?:\.\d+)?/g,'#')
  .replace(/[\s，。！？；：,.!?;:'"“”‘’（）()\[\]{}]+/g,'')
  .slice(0,600);
}

export function activityDemandAdvanced(previous:TaskDemand,next:TaskDemand):boolean{
 return demandRank[next.kind]>demandRank[previous.kind]
  || next.complexity>previous.complexity
  || next.novelty>previous.novelty
  || next.concepts.some(concept=>!previous.concepts.includes(concept));
}

function sameDemand(left?:TaskDemand,right?:TaskDemand):boolean{
 return !!left&&!!right&&left.kind===right.kind&&left.complexity===right.complexity&&left.novelty===right.novelty&&left.scaffolding===right.scaffolding
  &&JSON.stringify([...left.concepts].sort())===JSON.stringify([...right.concepts].sort());
}

export function progressionDecision(input:{intent:ProgressionIntent;currentDemand?:TaskDemand;currentHelpLevel?:number;recentObservations:TeachingObservation[];currentTaskFamily?:string;currentPositionIntent?:ProgressionIntent;currentOutcome?:'met'|'partial'|'not_yet'|'uncertain';gapSummary?:string}):{action:ProgressionIntent;reason:string}{
 if(input.intent!=='continue')return {action:input.intent,reason:'学习者选择了当前前进方式。'};
 if(input.currentPositionIntent==='challenge'&&(input.currentOutcome==='partial'||input.currentOutcome==='not_yet'))return {action:'fill_gap',reason:'挑战暴露出的具体缺口：'+(input.gapSummary?.trim()||'先核对未完成的要求，再决定是否回到挑战。')};
 const comparable=input.recentObservations.filter(item=>item.status==='active'&&item.kind==='verified_performance'&&item.certainty==='verified'&&item.outcome==='met'&&item.progressionEligible===true&&item.taskFamily&&item.taskFamily===input.currentTaskFamily
  &&(!input.currentDemand||sameDemand(item.demand,input.currentDemand))
  &&(input.currentHelpLevel===undefined||item.helpLevel===input.currentHelpLevel));
 const distinctTasks=new Map<string,TeachingObservation>();for(const item of comparable.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){const key=item.taskId??item.attemptId??item.inputId??item.id,previous=distinctTasks.get(key);if(!previous||item.certainty==='verified')distinctTasks.set(key,item);}
 if([...distinctTasks.values()].slice(-2).length===2)return {action:'challenge',reason:'已经连续走过两次同类、同层要求，下一步应增加可区分的要求。'};
 return {action:'continue',reason:'保留当前主线，并根据最近表现继续深入。'};
}

export function chooseResumeSession(sessions:Session[],unitId:string):Session|undefined{
 return sessions.filter(session=>session.unitId===unitId&&session.status!=='completed').sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
}
