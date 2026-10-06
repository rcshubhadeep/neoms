import { z } from 'zod';
export const NameInput = z.object({ name: z.string().trim().min(1).max(80) });
export const ChannelInput = NameInput.extend({ private: z.boolean().default(false) });
export const MessageInput = z.object({
  requestId: z.uuid(),
  body: z.string().trim().min(1).max(8000),
});
export const EditInput = z.object({
  body: z.string().trim().min(1).max(8000),
  revision: z.number().int().positive(),
});
export const RunLimits = z.object({
  maxContextTokens: z.number().int().min(2048).max(64000),
  maxOutputTokens: z.number().int().min(128).max(8000),
  maxMessages: z.number().int().min(1).max(500),
  maxHistoryDays: z.number().int().min(1).max(365),
  maxAttempts: z.number().int().min(1).max(3),
  maxConcurrentRuns: z.number().int().min(1).max(100),
  userDailyTokens: z.number().int().min(1).max(100000000),
  workspaceMonthlyTokens: z.number().int().min(1).max(1000000000),
  retentionDays: z.number().int().min(1).max(30),
  allowSharing: z.boolean(),
});
export const RunLimitOverrides = RunLimits.partial().strict();
export type RunPolicy = z.infer<typeof RunLimits>;
export const RunScope = z
  .object({
    mode: z.enum(['recent', 'unread', 'since']).default('recent'),
    since: z.iso.datetime().optional(),
    afterSequence: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
    upperSequence: z
      .string()
      .regex(/^\d{1,18}$/)
      .optional(),
  })
  .refine((scope) => scope.mode !== 'since' || !!scope.since, 'Choose a start date');
export const RunInput = z.object({
  requestId: z.uuid(),
  agentId: z.uuid().optional(),
  scope: RunScope.optional(),
  limits: RunLimitOverrides.optional(),
  allowPartial: z.boolean().default(false),
  selectionHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type RunRequest = z.infer<typeof RunInput>;
export const CoverageOutput = z.object({
  selectedMessages: z.number().int(),
  totalMessages: z.number().int(),
  omittedMessages: z.number().int(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  estimatedInputTokens: z.number().int(),
});
export type Coverage = z.infer<typeof CoverageOutput>;
export const RunPreviewOutput = z.object({
  agentId: z.uuid(),
  scope: RunScope,
  policy: RunLimits,
  coverage: CoverageOutput,
  selectionHash: z.string(),
});
export type RunPreview = z.infer<typeof RunPreviewOutput>;
export const PrivateResultOutput = z.object({
  body: z.string(),
  citations: z.array(z.uuid()),
  stale: z.boolean(),
  expires_at: z.string(),
  shared_message_id: z.uuid().nullable(),
  shared_by: z.uuid().nullable(),
});
export type PrivateResult = z.infer<typeof PrivateResultOutput>;
export const PolicySettingsOutput = z.object({
  limits: RunLimits,
  agents: z.array(z.object({ id: z.uuid(), name: z.string(), limits: RunLimitOverrides })),
  conversations: z.array(z.object({ id: z.uuid(), name: z.string(), limits: RunLimitOverrides })),
});
export type PolicySettings = z.infer<typeof PolicySettingsOutput>;
export const PolicyInput = z
  .object({
    layer: z.enum(['workspace', 'agent', 'conversation']),
    targetId: z.uuid().optional(),
    limits: RunLimitOverrides,
  })
  .refine((input) => input.layer === 'workspace' || !!input.targetId, 'Choose a policy target');
export const AgentOperation = z.enum(['summarize', 'suggest_actions']);
export const AgentVersionOutput = z.object({
  agent_id: z.uuid(),
  version: z.number().int().positive(),
  operation: AgentOperation,
  instructions: z.string().max(8000),
});
export type AgentVersion = z.infer<typeof AgentVersionOutput>;
export const AgentOutput = AgentVersionOutput.extend({
  name: z.string(),
  key: z.string(),
});
export type Agent = z.infer<typeof AgentOutput>;
export const ReadInput = z.object({ sequence: z.string().regex(/^\d{1,18}$/) });
export const InviteInput = z.object({ token: z.string().min(32).max(128) });
export const SummaryOutput = z.object({
  body: z.string().trim().min(1).max(12000),
  citations: z.array(z.uuid()).min(1).max(50),
});
export type Participant = { id: string; name: string; kind: 'human' | 'agent' };
export type Role = 'owner' | 'admin' | 'member';
export type Member = Participant & { role: Role; enabled: boolean };
export const MemberInput = z
  .object({ role: z.enum(['admin', 'member']).optional(), enabled: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.enabled !== undefined);
export const DmInput = z.object({ participantId: z.uuid() });
export const LlmProvider = z.enum(['test', 'anthropic', 'openai-compatible']);
export const LlmBaseUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      return (
        (url.protocol === 'https:' || (url.protocol === 'http:' && local)) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Use HTTPS, or HTTP on localhost, without credentials, a query, or a fragment')
  .transform((value) => new URL(value).toString().replace(/\/+$/, ''));
export const ModelListInput = z
  .object({
    provider: z.enum(['anthropic', 'openai-compatible']),
    baseUrl: LlmBaseUrl.optional(),
    apiKey: z.string().trim().min(1).max(4096).optional(),
  })
  .refine(
    (v) => v.provider !== 'openai-compatible' || !!v.baseUrl,
    'Set the API base URL for an OpenAI-compatible provider',
  );
export const ModelListOutput = z.object({ models: z.array(z.string()), truncated: z.boolean() });
export type ModelList = z.infer<typeof ModelListOutput>;
export const LlmInput = z
  .object({
    provider: LlmProvider,
    model: z.string().trim().min(1).max(160),
    baseUrl: LlmBaseUrl.optional(),
    tokenLimitParameter: z.enum(['max_tokens', 'max_completion_tokens']).optional(),
    apiKey: z.string().trim().min(1).max(4096).optional(),
    removeKey: z.boolean().default(false),
  })
  .refine((v) => !(v.apiKey && v.removeKey))
  .refine(
    (v) => v.provider !== 'openai-compatible' || !!v.baseUrl,
    'Set the API base URL for an OpenAI-compatible provider',
  );
export type LlmSettings = {
  provider: z.infer<typeof LlmProvider>;
  model: string;
  baseUrl: string | null;
  tokenLimitParameter: 'max_tokens' | 'max_completion_tokens';
  hasKey: boolean;
  revision: number;
  updated_at: string;
};
export type Invitation = {
  id: string;
  expires_at: string;
  accepted_by: string | null;
  revoked_at: string | null;
  created_at: string;
};
export type MemberUsage = {
  id: string;
  name: string;
  enabled: boolean;
  attempts: string;
  unknown_attempts: string;
  input_tokens: string;
  output_tokens: string;
  cache_read_tokens: string;
  cache_write_tokens: string;
};
export type UsageReport = {
  members: MemberUsage[];
  models: {
    provider: string;
    model: string;
    attempts: string;
    input_tokens: string;
    output_tokens: string;
  }[];
};
export type Workspace = { id: string; name: string; role: Role };
export type Conversation = {
  id: string;
  workspace_id: string;
  name: string;
  private: boolean;
  kind: 'channel' | 'dm';
  created_by: string | null;
  sequence?: string;
  unread?: boolean;
};
export type Message = {
  id: string;
  conversation_id: string;
  author_id: string;
  author_name: string;
  author_kind: 'human' | 'agent';
  request_id: string;
  body: string;
  citations: string[];
  agent_run_id: string | null;
  revision: number;
  stale: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
export type AgentRun = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  provider: string;
  error: string | null;
  agent_id?: string;
  agent_version?: number;
  coverage?: Coverage;
  result?: PrivateResult | null;
};
export type ConversationEvent = {
  sequence: string;
  type: 'message.upsert' | 'run.updated' | 'noop';
  data: Message | AgentRun;
};
export type Snapshot = {
  messages: Message[];
  cursor: string;
  hasMore: boolean;
  runs: AgentRun[];
  readSequence?: string;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createApi(base: string, token: () => Promise<string>) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}/v1${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await token()}`,
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok) throw new ApiError(response.status, result.error || 'Request failed');
    return result as T;
  };
}
export const schemas = { NameInput, ChannelInput, MessageInput, EditInput, RunInput, InviteInput };

export const ParticipantOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(['human', 'agent']),
});
export const WorkspaceOutput = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
});
export const ConversationOutput = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  name: z.string(),
  private: z.boolean(),
  kind: z.enum(['channel', 'dm']),
  created_by: z.uuid().nullable(),
  sequence: z.string().optional(),
  unread: z.boolean().optional(),
});
export const MessageOutput = z.object({
  id: z.uuid(),
  conversation_id: z.uuid(),
  author_id: z.uuid(),
  author_name: z.string(),
  author_kind: z.enum(['human', 'agent']),
  request_id: z.uuid(),
  body: z.string(),
  citations: z.array(z.uuid()),
  agent_run_id: z.uuid().nullable(),
  revision: z.number().int(),
  stale: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export const RunOutput = z.object({
  id: z.uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  provider: z.string(),
  error: z.string().nullable(),
  agent_id: z.uuid().optional(),
  agent_version: z.number().int().positive().optional(),
  coverage: CoverageOutput.optional(),
  result: PrivateResultOutput.nullable().optional(),
});
export const EventOutput = z.object({
  sequence: z.string(),
  type: z.enum(['message.upsert', 'run.updated', 'noop']),
  data: z.union([MessageOutput, RunOutput, z.object({})]),
});
export const SnapshotOutput = z.object({
  messages: z.array(MessageOutput),
  cursor: z.string(),
  hasMore: z.boolean(),
  runs: z.array(RunOutput),
  readSequence: z.string().optional(),
});
export const ChangesOutput = z.object({
  events: z.array(EventOutput),
  cursor: z.string(),
  hasMore: z.boolean(),
});

export const MemberOutput = ParticipantOutput.extend({
  role: z.enum(['owner', 'admin', 'member']),
  enabled: z.boolean(),
});
export const LlmOutput = z.object({
  provider: LlmProvider,
  model: z.string(),
  baseUrl: z.string().nullable(),
  tokenLimitParameter: z.enum(['max_tokens', 'max_completion_tokens']),
  hasKey: z.boolean(),
  revision: z.number().int(),
  updated_at: z.string(),
});
export const InvitationOutput = z.object({
  id: z.uuid(),
  expires_at: z.string(),
  accepted_by: z.uuid().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
export const UsageOutput = z.object({
  members: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      enabled: z.boolean(),
      attempts: z.string(),
      unknown_attempts: z.string(),
      input_tokens: z.string(),
      output_tokens: z.string(),
      cache_read_tokens: z.string(),
      cache_write_tokens: z.string(),
    }),
  ),
  models: z.array(
    z.object({
      provider: z.string(),
      model: z.string(),
      attempts: z.string(),
      input_tokens: z.string(),
      output_tokens: z.string(),
    }),
  ),
});
