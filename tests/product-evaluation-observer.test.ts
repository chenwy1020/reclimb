import { describe, expect, it } from 'vitest';
import { createEvaluationObserver } from '../scripts/validation/product-evaluation-observer';
import type { Settings } from '../src/shared/types';

const settings = { baseUrl: 'https://offline.example.test/v1', model: 'offline-model' } as Settings;
const request = { system: '离线测试', user: '原创测试' };
const response = (content: string) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: { content, reasoning_content: 'private-reasoning-must-not-be-an-answer' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 17,
        completion_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { status: 200 },
  );
describe('评测原始响应观察器', () => {
  it('仅记录元数据，不把推理当答案，连续两次空正文后禁止第三次请求', async () => {
    let calls = 0;
    const observed: unknown[] = [];
    const observer = createEvaluationObserver({
      onProgress: (event) => observed.push(event),
      fetcher: async () => {
        calls++;
        return response('');
      },
    });
    const provider = observer.factory(settings, 'offline-secret-key');
    expect((await provider.complete(request)).text).toBe('');
    expect(observer.stopped).toBe(false);
    expect((await provider.complete(request)).text).toBe('');
    expect(observer.stopped).toBe(true);
    await expect(provider.complete(request)).rejects.toThrow('未发送请求');
    expect(calls).toBe(2);
    expect(observed).toContainEqual(
      expect.objectContaining({
        phase: 'response-metadata',
        contentCharacters: 0,
        reasoningCharacters: 39,
        completionTokens: 17,
        reasoningTokens: 0,
      }),
    );
    expect(JSON.stringify(observed)).not.toContain('private-reasoning');
    expect(JSON.stringify(observed)).not.toContain('offline-secret-key');
  });
  it('正常正文重置连续空计数，原始响应不被观察器改写', async () => {
    const contents = ['', '{"ok":true}', ''];
    const observer = createEvaluationObserver({
      onProgress: () => {},
      fetcher: async () => response(contents.shift()!),
    });
    const provider = observer.factory(settings, 'offline-secret-key');
    expect((await provider.complete(request)).text).toBe('');
    expect((await provider.complete(request)).text).toBe('{"ok":true}');
    expect(observer.consecutiveEmpty).toBe(0);
    await provider.complete(request);
    expect(observer.consecutiveEmpty).toBe(1);
    expect(observer.stopped).toBe(false);
  });
});
