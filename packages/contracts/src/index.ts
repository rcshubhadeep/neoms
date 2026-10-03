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
export const RunInput = z.object({ requestId: z.uuid() });
export const InviteInput = z.object({ token: z.string().min(32).max(128) });
export const SummaryOutput = z.object({
  body: z.string().trim().min(1).max(12000),
  citations: z.array(z.uuid()).min(1).max(50),
});
export type Participant = { id: string; name: string; kind: 'human' | 'agent' };
export type Workspace = { id: string; name: string; role: string };
export type Conversation = { id: string; workspace_id: string; name: string; private: boolean };
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
};
export type ConversationEvent = {
  sequence: string;
  type: 'message.upsert' | 'run.updated' | 'noop';
  data: Message | AgentRun;
};
export type Snapshot = { messages: Message[]; cursor: string; hasMore: boolean; runs: AgentRun[] };
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
  role: z.enum(['owner', 'member']),
});
export const ConversationOutput = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  name: z.string(),
  private: z.boolean(),
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
});
export const ChangesOutput = z.object({
  events: z.array(EventOutput),
  cursor: z.string(),
  hasMore: z.boolean(),
});
