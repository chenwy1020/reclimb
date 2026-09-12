import { z } from 'zod';
import { modelProfileSchema,settingsInputSchema as textSettingsSchema } from './schemas';
export const visionSettingsSchema=z.object({
  enabled:z.boolean(),providerName:z.string().max(200),baseUrl:z.string().max(2000),model:z.string().max(150),
  inputPriceCnyPerMillion:z.number().finite().min(.01).max(100000),outputPriceCnyPerMillion:z.number().finite().min(.01).max(100000),priceUpdatedAt:z.string().max(2000),
}).strict().superRefine((s,ctx)=>{if(s.enabled&&(!s.baseUrl.trim()||!s.model.trim()))ctx.addIssue({code:'custom',message:'开启视觉识别前，请填写服务地址与模型名'});});
export const settingsInputSchema=textSettingsSchema.extend({vision:visionSettingsSchema.optional()}).strict().superRefine((settings,ctx)=>{
 const profiles=settings.modelProfiles;if(!profiles)return;
 const ids=new Set<string>(),names=new Set<string>();for(const [index,profile] of profiles.entries()){const normalized=profile.name.trim().toLocaleLowerCase();if(ids.has(profile.id))ctx.addIssue({code:'custom',path:['modelProfiles',index,'id'],message:'模型配置编号不能重复'});if(names.has(normalized))ctx.addIssue({code:'custom',path:['modelProfiles',index,'name'],message:'模型配置名称不能重复'});ids.add(profile.id);names.add(normalized);}
 if(!profiles.some(profile=>profile.enabled))ctx.addIssue({code:'custom',path:['modelProfiles'],message:'至少保留一个启用的模型配置'});
 if(settings.activeModelProfileId&&!profiles.some(profile=>profile.id===settings.activeModelProfileId&&profile.enabled))ctx.addIssue({code:'custom',path:['activeModelProfileId'],message:'当前模型配置不存在或未启用'});
});
const profileId=z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
export const modelProfileInputSchema=modelProfileSchema.extend({id:profileId.optional()});
export const modelProfileSaveSchema=z.object({profile:modelProfileInputSchema,apiKey:z.string().max(4096).optional()}).strict();
export const modelProfileIdSchema=z.object({id:profileId}).strict();
export function assertNoLegacyTeachingCredentials(payload:unknown):void{
 if(payload&&typeof payload==='object'&&Object.prototype.hasOwnProperty.call(payload,'apiKey'))throw new Error('教学模型密钥已改为按模型配置保存。请在“模型配置”中新增或编辑配置，旧式的一次性密钥保存请求已停止，现有设置和密钥均未改变。');
}
export {modelProfileSchema};
