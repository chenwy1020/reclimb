import { redactDiagnostic } from './diagnostics';
import { validatedCacheCounters } from '../shared/cache-usage';
const FIREWORKS_HOST = 'api.fireworks.ai';
const DEEPSEEK_HOST = 'api.deepseek.com';
const LONG_OUTPUT_TOKENS = 4096;
const FIREWORKS_REASONING_BUDGET = 2048;
const FIREWORKS_DEEPSEEK_MODELS = new Set([
  'deepseek-v4-flash-0731',
  'deepseek-v4p1-flash',
  'deepseek-flash',
]);
const normalizedModel = (model: string) => model.trim().toLowerCase().split('/').at(-1) ?? '';
const isVerifiedFireworksDeepSeek = (host: string, model: string) =>
  host === FIREWORKS_HOST && FIREWORKS_DEEPSEEK_MODELS.has(normalizedModel(model));
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface ModelRequest {
  system: string;
  user: string;
  messages?: ModelMessage[];
  json?: boolean;
  maxOutputTokens?: number;
  schema?: Record<string, unknown>;
  images?: { dataUrl: string }[];
}
export interface ModelResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  usageKnown: boolean;
  finishReason?: string;
  providerRequestId?: string;
  reasoningTokens?: number;
  reportedModel?: string;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}
export interface ModelProvider {
  complete(request: ModelRequest): Promise<ModelResult>;
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public definitelyUnbilled = false,
    public diagnosticDetail?: string,
    public providerRequestId?: string,
  ) {
    super(message);
  }
}
export function buildChatUrl(base: string): string {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('AI服务地址不是有效网址');
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error('AI服务地址不能包含账号、密码或查询参数');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error('在线AI服务必须使用HTTPS，本地模型可使用localhost');
  return (
    url
      .toString()
      .replace(/\/$/, '')
      .replace(/\/chat\/completions$/, '') + '/chat/completions'
  );
}
export function parseModelJson(text: string): unknown {
  const clean = text
    .trim()
    .replace(/^\x60\x60\x60(?:json)?\s*/i, '')
    .replace(/\s*\x60\x60\x60$/, '');
  if (!clean) throw new Error('AI返回了空内容，请重试；你的作答已经保留');
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error('AI返回的内容格式无法验证，本次不会更新能力记录');
  }
}
export class ChatProvider implements ModelProvider {
  constructor(
    private options: { baseUrl: string; model: string; apiKey: string; fetcher?: typeof fetch },
  ) {}
  async complete(request: ModelRequest): Promise<ModelResult> {
    const url = buildChatUrl(this.options.baseUrl);
    const host = new URL(url).hostname.toLowerCase(),
      structured = request.json === true;
    const useSchema = host === FIREWORKS_HOST && structured && !!request.schema;
    const maxOutputTokens = request.maxOutputTokens ?? LONG_OUTPUT_TOKENS;
    const verifiedFireworksDeepSeek =
      structured && isVerifiedFireworksDeepSeek(host, this.options.model);
    const thinking =
      structured && host === DEEPSEEK_HOST
        ? { type: 'disabled' }
        : verifiedFireworksDeepSeek
          ? maxOutputTokens >= LONG_OUTPUT_TOKENS
            ? { type: 'enabled', budget_tokens: FIREWORKS_REASONING_BUDGET }
            : { type: 'disabled' }
          : undefined;
    const format = useSchema
      ? {
          type: 'json_schema',
          json_schema: { name: 'reclimb_response', schema: request.schema, strict: true },
        }
      : { type: 'json_object' };
    if (
      request.images?.some(
        (image) =>
          !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image.dataUrl) ||
          image.dataUrl.length > 16_000_000,
      )
    )
      throw new ProviderError('识别图像格式无效或过大', true);
    const sequence = request.messages ?? [
      { role: 'system' as const, content: request.system },
      { role: 'user' as const, content: request.user },
    ];
    const imageIndex = sequence.findIndex((message) => message.role === 'user');
    const messages = sequence.map((message, index) =>
      index === imageIndex && request.images?.length
        ? {
            ...message,
            content: [
              { type: 'text', text: message.content },
              ...request.images.map((image) => ({
                type: 'image_url',
                image_url: { url: image.dataUrl },
              })),
            ],
          }
        : message,
    );
    let response: Response;
    try {
      response = await (this.options.fetcher ?? fetch)(url, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.options.apiKey,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          stream: false,
          max_tokens: maxOutputTokens,
          ...(structured ? { response_format: format } : {}),
          ...(thinking ? { thinking } : {}),
        }),
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      throw new ProviderError('AI服务暂时未响应或连接失败。作答已保存；本次费用待服务商账单核对。');
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        400: '服务不支持当前请求格式，请检查模型和接口设置',
        401: 'AI服务认证失败，请检查密钥',
        403: 'AI服务拒绝访问，请检查账号权限',
        404: '未找到模型或接口，请检查服务地址与模型名',
        429: 'AI服务额度不足或请求过于频繁，请稍后再试',
      };
      let detail = 'HTTP ' + response.status;
      try {
        const raw = (await response.text()).slice(0, 8192),
          body = JSON.parse(raw),
          message = body?.error?.message ?? body?.message;
        if (typeof message === 'string') detail += '：' + message.slice(0, 2000);
      } catch {
        /* Keep the HTTP status when an error body is not structured JSON. */
      }
      throw new ProviderError(
        messages[response.status] ?? 'AI服务暂时不可用（' + response.status + '），作答已保存',
        [400, 401, 403, 404, 429].includes(response.status),
        redactDiagnostic(detail, [this.options.apiKey]),
        response.headers.get('x-request-id')?.slice(0, 200),
      );
    }
    const raw = await response.text();
    if (raw.length > 2_000_000) throw new ProviderError('AI回复超过本次可处理的长度，已停止处理');
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ProviderError('AI服务返回了无法识别的数据');
    }
    const text = body?.choices?.[0]?.message?.content ?? '';
    if (typeof text !== 'string') throw new ProviderError('AI没有返回可用内容，你的作答已保存');
    const input = body?.usage?.prompt_tokens,
      output = body?.usage?.completion_tokens;
    const usageKnown =
      Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0;
    const finish = body?.choices?.[0]?.finish_reason,
      requestId = response.headers.get('x-request-id') ?? body?.id,
      reportedModel = body?.model;
    const reasoning = body?.usage?.completion_tokens_details?.reasoning_tokens;
    const directCache =
      body?.usage?.prompt_cache_hit_tokens !== undefined ||
      body?.usage?.prompt_cache_miss_tokens !== undefined;
    const cache = usageKnown
      ? validatedCacheCounters(
          input,
          directCache
            ? body.usage.prompt_cache_hit_tokens
            : body?.usage?.prompt_tokens_details?.cached_tokens,
          directCache ? body.usage.prompt_cache_miss_tokens : undefined,
        )
      : {};
    return {
      text,
      inputTokens: usageKnown ? input : 0,
      outputTokens: usageKnown ? output : 0,
      usageKnown,
      ...cache,
      ...(typeof finish === 'string' ? { finishReason: finish.slice(0, 80) } : {}),
      ...(typeof requestId === 'string' ? { providerRequestId: requestId.slice(0, 200) } : {}),
      ...(Number.isFinite(reasoning) && reasoning >= 0 ? { reasoningTokens: reasoning } : {}),
      ...(typeof reportedModel === 'string' && reportedModel.trim()
        ? { reportedModel: reportedModel.trim().slice(0, 200) }
        : {}),
    };
  }
}
