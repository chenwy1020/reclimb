import { ChatProvider, ProviderError, type ModelProvider } from '../../src/main/provider';
import type { Settings } from '../../src/shared/types';

type Progress = Record<string, string | number | boolean | null>;
export function createEvaluationObserver(options: {
  onProgress: (event: Progress) => void;
  fetcher?: typeof fetch;
  emptyLimit?: number;
}) {
  const emptyLimit = options.emptyLimit ?? 2;
  if (!Number.isInteger(emptyLimit) || emptyLimit < 1)
    throw new Error('空正文停止阈值必须为正整数。');
  let requests = 0,
    consecutiveEmpty = 0;
  const events: Progress[] = [];
  const emit = (event: Progress) => {
    events.push(event);
    options.onProgress(event);
  };
  const numeric = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  return {
    get stopped() {
      return consecutiveEmpty >= emptyLimit;
    },
    get consecutiveEmpty() {
      return consecutiveEmpty;
    },
    get events() {
      return [...events];
    },
    factory(settings: Settings, key: string): ModelProvider {
      return {
        complete: async (request) => {
          if (consecutiveEmpty >= emptyLimit)
            throw new ProviderError('连续空正文已触发评测停止，本次未发送请求。', true);
          const sequence = ++requests,
            started = performance.now();
          emit({ phase: 'request-start', sequence, at: new Date().toISOString() });
          const provider = new ChatProvider({
            baseUrl: settings.baseUrl,
            model: settings.model,
            apiKey: key,
            fetcher: async (url, init) => {
              const response = await (options.fetcher ?? fetch)(url, init);
              let body: any;
              try {
                body = await response.clone().json();
              } catch {
                /* Observe metadata only. */
              }
              const message = body?.choices?.[0]?.message;
              const content = message?.content,
                reasoning = message?.reasoning_content;
              const empty =
                response.ok &&
                (content == null || (typeof content === 'string' && !content.trim()));
              if (response.ok) consecutiveEmpty = empty ? consecutiveEmpty + 1 : 0;
              emit({
                phase: 'response-metadata',
                sequence,
                httpStatus: response.status,
                contentType: content === null ? 'null' : typeof content,
                contentCharacters: typeof content === 'string' ? content.length : null,
                reasoningType: reasoning === null ? 'null' : typeof reasoning,
                reasoningCharacters: typeof reasoning === 'string' ? reasoning.length : null,
                finishReason:
                  typeof body?.choices?.[0]?.finish_reason === 'string'
                    ? body.choices[0].finish_reason.slice(0, 80)
                    : null,
                promptTokens: numeric(body?.usage?.prompt_tokens),
                completionTokens: numeric(body?.usage?.completion_tokens),
                reasoningTokens: numeric(body?.usage?.completion_tokens_details?.reasoning_tokens),
                consecutiveEmpty,
              });
              if (consecutiveEmpty >= emptyLimit)
                emit({ phase: 'circuit-open', sequence, consecutiveEmpty });
              return response;
            },
          });
          try {
            const result = await provider.complete(request);
            emit({
              phase: 'request-finished',
              sequence,
              durationMs: Math.round(performance.now() - started),
              parsedContentCharacters: result.text.length,
            });
            return result;
          } catch (error) {
            emit({
              phase: 'request-failed',
              sequence,
              durationMs: Math.round(performance.now() - started),
            });
            throw error;
          }
        },
      };
    },
  };
}
