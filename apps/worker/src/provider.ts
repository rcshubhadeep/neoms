import { APICallError, generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  SummaryOutput,
  type AgentVersion,
  type Message,
} from '../../../packages/contracts/src/index.js';
import { z } from 'zod';
import type { Tokens } from '../../../packages/domain/src/administration.js';
import { llmBaseUrl } from '../../../packages/domain/src/llm-connection.js';
import { agentPrompt, estimateInput } from '../../../packages/domain/src/agent-context.js';
export type ModelConfiguration = {
  provider: string;
  model: string;
  baseUrl?: string | null;
  tokenLimitParameter?: 'max_tokens' | 'max_completion_tokens';
  apiKey?: string;
  maxContextTokens?: number;
  maxOutputTokens?: number;
};

function providerFailure(error: unknown) {
  // Do not retain a cause: SDK errors can contain prompts, keys, and provider bodies.
  if (APICallError.isInstance(error)) {
    if (error.statusCode && error.statusCode >= 400)
      return new Error(`Model request failed (${error.statusCode})`);
    if (error.statusCode && error.statusCode < 400)
      return new Error('Model response was not valid JSON');
  }
  return new Error('Model request could not reach the configured endpoint');
}

// Keep this compatibility entry point for existing Catch me up callers/tests.
export async function summarize(
  messages: Message[],
  configuration: string | ModelConfiguration,
  onUsage?: (tokens: Tokens) => Promise<void>,
) {
  return executeAgent(
    messages,
    configuration,
    { operation: 'summarize', instructions: '' },
    onUsage,
  );
}

export async function executeAgent(
  messages: Message[],
  configuration: string | ModelConfiguration,
  agent: Pick<AgentVersion, 'operation' | 'instructions'>,
  onUsage?: (tokens: Tokens) => Promise<void>,
) {
  const limits: Partial<ModelConfiguration> =
    typeof configuration === 'string' ? {} : configuration;
  if (limits.maxContextTokens && estimateInput(agent, messages) > limits.maxContextTokens)
    throw new Error('Model input exceeds the resolved context policy');
  const {
    provider,
    model,
    apiKey,
    baseUrl,
    tokenLimitParameter = 'max_completion_tokens',
  } = typeof configuration === 'string'
    ? {
        provider: configuration,
        model: 'deterministic',
        apiKey: undefined,
        baseUrl: undefined,
        tokenLimitParameter: undefined,
      }
    : configuration;
  if (!messages.length) throw new Error('Send a message before asking for a summary');
  if (provider === 'test') {
    await onUsage?.({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    return {
      body: `[Test provider — not an AI ${agent.operation === 'summarize' ? 'summary' : 'action plan'}]\n${messages
        .slice(-5)
        .map((m) => `${m.author_name}: ${m.body}`)
        .join('\n')}`,
      citations: messages.slice(-5).map((m) => m.id),
    };
  }
  if (!['anthropic', 'openai-compatible'].includes(provider))
    throw new Error('Unsupported LLM provider');
  if (!apiKey || !model)
    throw new Error('Ask a workspace admin to configure the LLM key and model');
  const prompt = agentPrompt(agent, messages);
  const anthropic = provider === 'anthropic';
  const endpoint = llmBaseUrl(provider, baseUrl);
  // Preserve the installation's redirect policy when the SDK sends credentials.
  const restrictedFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, redirect: 'error' });
  const languageModel = anthropic
    ? createAnthropic({ apiKey, baseURL: endpoint, fetch: restrictedFetch })(model)
    : createOpenAICompatible({
        name: 'neoms',
        apiKey,
        baseURL: endpoint,
        fetch: restrictedFetch,
        transformRequestBody: (args) => {
          const { max_tokens, ...rest } = args;
          return { ...rest, [tokenLimitParameter ?? 'max_completion_tokens']: max_tokens };
        },
      })(model);
  let result;
  try {
    result = await generateText({
      model: languageModel,
      ...prompt,
      maxOutputTokens: limits.maxOutputTokens ?? 2000,
      maxRetries: 0, // Queue retries are recorded as separate usage attempts.
      abortSignal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw providerFailure(error);
  }
  // Use reported wire usage to preserve ledger semantics across providers. Missing
  // usage remains unknown; SDK-normalized totals must not fabricate zero usage.
  const wire = z.object({ usage: z.unknown().optional() }).safeParse(result.response.body);
  const reportedUsage = wire.success ? wire.data.usage : undefined;
  const tokens = anthropic
    ? z
        .object({
          input_tokens: z.number().int().nonnegative(),
          output_tokens: z.number().int().nonnegative(),
          cache_read_input_tokens: z.number().int().nonnegative().default(0),
          cache_creation_input_tokens: z.number().int().nonnegative().default(0),
        })
        .safeParse(reportedUsage)
    : z
        .object({
          prompt_tokens: z.number().int().nonnegative(),
          completion_tokens: z.number().int().nonnegative(),
          prompt_tokens_details: z
            .object({ cached_tokens: z.number().int().nonnegative().default(0) })
            .optional(),
        })
        .safeParse(reportedUsage);
  if (tokens.success)
    if ('input_tokens' in tokens.data)
      await onUsage?.({
        input_tokens: tokens.data.input_tokens,
        output_tokens: tokens.data.output_tokens,
        cache_read_tokens: tokens.data.cache_read_input_tokens,
        cache_write_tokens: tokens.data.cache_creation_input_tokens,
      });
    else
      await onUsage?.({
        input_tokens: tokens.data.prompt_tokens,
        output_tokens: tokens.data.completion_tokens,
        cache_read_tokens: tokens.data.prompt_tokens_details?.cached_tokens ?? 0,
        cache_write_tokens: 0,
      });
  try {
    const text = result.text.replace(/^```(?:json)?\s*|\s*```$/g, '');
    return SummaryOutput.parse(JSON.parse(text));
  } catch {
    throw new Error('Model response was not a valid cited summary');
  }
}
