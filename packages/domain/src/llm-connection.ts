import { LlmBaseUrl } from '../../contracts/src/index.js';

export function llmBaseUrl(provider: string, baseUrl?: string | null) {
  const url = provider === 'anthropic' ? 'https://api.anthropic.com/v1' : LlmBaseUrl.parse(baseUrl);
  const allowed = process.env.LLM_ALLOWED_HOSTS?.split(',').map((host) =>
    host.trim().toLowerCase(),
  );
  if (allowed && !allowed.includes(new URL(url).hostname.toLowerCase()))
    throw new Error('This model endpoint is not allowed by the installation operator');
  return url;
}

export function llmHeaders(provider: string, apiKey: string): Record<string, string> {
  return provider === 'anthropic'
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }
    : { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}
