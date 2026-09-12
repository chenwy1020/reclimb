export const MIN_MODEL_OUTPUT_TOKENS = 512;
// DeepSeek documents 384K as 393216 tokens; this is configurable capacity,
// not the amount that an individual learning task should request.
export const MAX_MODEL_OUTPUT_TOKENS = 393216;
export const DEFAULT_MODEL_OUTPUT_TOKENS = 12000;
export const MODEL_OUTPUT_LIMIT_MESSAGE = `单次回复上限请填写 ${MIN_MODEL_OUTPUT_TOKENS} 至 ${MAX_MODEL_OUTPUT_TOKENS} 之间的整数，并且不要超过服务商为该模型规定的上限。`;

export function isModelOutputLimit(value:unknown):value is number {
 return typeof value==='number'&&Number.isInteger(value)&&value>=MIN_MODEL_OUTPUT_TOKENS&&value<=MAX_MODEL_OUTPUT_TOKENS;
}
