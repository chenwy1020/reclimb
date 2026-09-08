import { z } from 'zod';
import { settingsInputSchema as textSettingsSchema } from './schemas';
export const visionSettingsSchema=z.object({
  enabled:z.boolean(),providerName:z.string().max(200),baseUrl:z.string().max(2000),model:z.string().max(150),
  inputPriceCnyPerMillion:z.number().finite().min(.01).max(100000),outputPriceCnyPerMillion:z.number().finite().min(.01).max(100000),priceUpdatedAt:z.string().max(2000),
}).strict().superRefine((s,ctx)=>{if(s.enabled&&(!s.baseUrl.trim()||!s.model.trim()))ctx.addIssue({code:'custom',message:'开启视觉识别前，请填写服务地址与模型名'});});
export const settingsInputSchema=textSettingsSchema.extend({vision:visionSettingsSchema.optional()}).strict();
