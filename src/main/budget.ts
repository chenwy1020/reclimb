import type {Usage} from '../shared/types';
export function reserveCost(inputCharacters:number,maxOutputTokens:number,inputPrice:number,outputPrice:number):number {
 if(![inputCharacters,maxOutputTokens,inputPrice,outputPrice].every(v=>Number.isFinite(v)&&v>=0))throw new Error('费用估算参数无效');
 return Math.ceil(((inputCharacters*2+256)*inputPrice+maxOutputTokens*outputPrice)/1_000_000*100000)/100000;
}
export function monthSpend(rows:Pick<Usage,'createdAt'|'status'|'estimatedCny'|'entryType'>[],month=new Date().toISOString().slice(0,7)):number {
 // An outstanding pipeline hold reserves future requests even across midnight/month boundaries.
 return rows.filter(r=>(r.createdAt.startsWith(month)||(r.entryType==='hold'&&r.status==='reserved'))&&r.status!=='failed').reduce((sum,r)=>sum+Math.max(0,r.estimatedCny),0);
}
export function assertAffordable(budget:number,used:number,reservation:number):void {
 if(!Number.isFinite(budget)||budget<=0)throw new Error('请先在设置中填写本机月度预算');
 if(used+reservation>=budget*.9)throw new Error('本机用量已接近月度预算，已暂停新的AI请求。请核对服务商账单后调整预算；离线阅读与作答仍可继续。');
}

