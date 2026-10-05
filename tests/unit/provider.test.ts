import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { summarize } from '../../apps/worker/src/provider.js';
import { LlmBaseUrl, type Message } from '../../packages/contracts/src/index.js';

const messages = [{ id: randomUUID(), author_name: 'Alice', body: 'Ship on Friday.' }] as Message[];
const configuration = {
  provider: 'openai-compatible',
  model: 'custom-chat-model',
  baseUrl: 'https://models.example.test/v1/',
  apiKey: 'controlled-secret',
};
const answer = { body: 'Ship on Friday.', citations: [messages[0].id] };
function response(
  content = JSON.stringify(answer),
  usage: unknown = {
    prompt_tokens: 42,
    completion_tokens: 12,
    prompt_tokens_details: { cached_tokens: 10 },
  },
) {
  return Response.json({ choices: [{ message: { content } }], usage });
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('OpenAI-compatible summary adapter', () => {
  it('sends a bounded Chat Completions request and records reported usage', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    const usage = vi.fn().mockResolvedValue(undefined);
    expect(await summarize(messages, configuration, usage)).toEqual(answer);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://models.example.test/v1/chat/completions');
    expect(options).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: 'Bearer controlled-secret' },
    });
    const body = JSON.parse(options.body);
    expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model']);
    expect(body.model).toBe('custom-chat-model');
    expect(body.max_completion_tokens).toBe(2000);
    expect(body.messages[0].role).toBe('system');
    expect(JSON.parse(body.messages[1].content)[0].id).toBe(messages[0].id);
    expect(usage).toHaveBeenCalledWith({
      input_tokens: 42,
      output_tokens: 12,
      cache_read_tokens: 10,
      cache_write_tokens: 0,
    });
  });
  it('supports the legacy token-limit parameter', async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetch);
    await summarize(messages, { ...configuration, tokenLimitParameter: 'max_tokens' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ max_tokens: 2000 });
    expect(JSON.parse(fetch.mock.calls[0][1].body).max_completion_tokens).toBeUndefined();
  });
  it('records usage even when the answer fails validation, and leaves missing usage unknown', async () => {
    const usage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('not JSON')));
    await expect(summarize(messages, configuration, usage)).rejects.toThrow('valid cited summary');
    expect(usage).toHaveBeenCalledOnce();
    usage.mockClear();
    // Omit usage entirely: no fabricated zero-token report.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
        ),
    );
    await summarize(messages, configuration, usage);
    expect(usage).not.toHaveBeenCalled();
  });
  it('does not expose provider error bodies or invalid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('controlled-secret', { status: 401 })),
    );
    await expect(summarize(messages, configuration)).rejects.toThrow('Model request failed (401)');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('controlled-secret')));
    await expect(summarize(messages, configuration)).rejects.toThrow(
      'Model response was not valid JSON',
    );
  });
  it('preserves Anthropic requests and cache usage', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        usage: {
          input_tokens: 8,
          output_tokens: 4,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 2,
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const usage = vi.fn().mockResolvedValue(undefined);
    await summarize(
      messages,
      { provider: 'anthropic', model: 'claude-controlled', apiKey: 'controlled-secret' },
      usage,
    );
    expect(fetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('controlled-secret');
    expect(usage).toHaveBeenCalledWith({
      input_tokens: 8,
      output_tokens: 4,
      cache_read_tokens: 3,
      cache_write_tokens: 2,
    });
  });
  it('keeps the test provider offline', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect((await summarize(messages, 'test')).body).toContain('Test provider');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('enforces the installation host policy before sending credentials', async () => {
    vi.stubEnv('LLM_ALLOWED_HOSTS', 'api.openai.com');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(summarize(messages, configuration)).rejects.toThrow('not allowed');
    expect(fetch).not.toHaveBeenCalled();
  });
});
it('validates and normalizes endpoint URLs without throwing from safeParse', () => {
  expect(LlmBaseUrl.parse('https://models.example.test/v1///')).toBe(
    'https://models.example.test/v1',
  );
  expect(LlmBaseUrl.parse('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1');
  for (const url of [
    'not-url',
    'http://remote.test/v1',
    'https://user:key@remote.test/v1',
    'https://remote.test/v1?key=secret',
    'https://remote.test/v1#secret',
  ])
    expect(LlmBaseUrl.safeParse(url).success).toBe(false);
});
