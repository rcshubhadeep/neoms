import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { pool, transaction } from '../../../packages/db/src/index.js';
import * as administration from '../../../packages/domain/src/administration.js';
import * as domain from '../../../packages/domain/src/index.js';
import {
  ParticipantOutput,
  MemberInput,
  MemberOutput,
  DmInput,
  LlmInput,
  LlmOutput,
  ModelListInput,
  ModelListOutput,
  InvitationOutput,
  UsageOutput,
  WorkspaceOutput,
  ConversationOutput,
  MessageOutput,
  RunOutput,
  SnapshotOutput,
  ChangesOutput,
  NameInput,
  ChannelInput,
  MessageInput,
  EditInput,
  RunInput,
  ReadInput,
  InviteInput,
} from '../../../packages/contracts/src/index.js';

type Env = {
  Variables: { participant: { id: string; name: string; kind: string }; token: string };
};
export const app = new Hono<Env>();
const auth = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
app.use(
  '*',
  cors({
    origin: (origin) => {
      const allowed = (
        process.env.CLIENT_ORIGINS ||
        'http://127.0.0.1:1420,http://localhost:1420,tauri://localhost,http://tauri.localhost'
      ).split(',');
      return allowed.includes(origin) ? origin : null;
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(
  '*',
  bodyLimit({ maxSize: 32768, onError: (c) => c.json({ error: 'Request body too large' }, 413) }),
);
app.onError((error, c) => {
  if (error instanceof SyntaxError) return c.json({ error: 'Malformed JSON' }, 400);
  if (error instanceof z.ZodError)
    return c.json({ error: 'Invalid request', details: error.issues }, 400);
  if (error instanceof domain.DomainError)
    return c.json({ error: error.message }, error.status as 400);
  if ('code' in error && error.code === '23505')
    return c.json({ error: 'That name is already in use' }, 409);
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});
app.notFound((c) => c.json({ error: 'Route not found' }, 404));
app.get('/health', async (c) => {
  await pool.query('select 1');
  return c.json({ status: 'ok', service: 'neoms-api' });
});
app.use('/v1/*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return c.json({ error: 'Sign in required' }, 401);
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return c.json({ error: 'Session is invalid or expired' }, 401);
  const participant = await domain.identify(
    data.user.id,
    data.user.user_metadata.name || data.user.email?.split('@')[0] || 'Teammate',
  );
  c.set('participant', participant);
  c.set('token', token);
  await next();
});
const id = (value: string) => z.uuid().parse(value);
const cursor = (value: string | undefined) =>
  z
    .string()
    .regex(/^\d{1,18}$/)
    .parse(value ?? '0');
app.get('/v1/me', (c) => c.json(c.get('participant')));
app.get('/v1/workspaces', async (c) =>
  c.json(
    (
      await pool.query(
        'select w.id,w.name,wm.role from workspaces w join workspace_members wm on wm.workspace_id=w.id where wm.participant_id=$1 and wm.enabled order by w.created_at',
        [c.get('participant').id],
      )
    ).rows,
  ),
);
app.post('/v1/workspaces', async (c) => {
  const input = NameInput.parse(await c.req.json());
  return c.json(await domain.createWorkspace(c.get('participant').id, input.name), 201);
});
app.post('/v1/workspaces/:workspace/invitations', async (c) =>
  c.json(await domain.invite(c.get('participant').id, id(c.req.param('workspace'))), 201),
);
app.post('/v1/invitations/accept', async (c) => {
  const input = InviteInput.parse(await c.req.json());
  return c.json(await domain.acceptInvite(c.get('participant').id, input.token));
});
app.get('/v1/workspaces/:workspace/members', async (c) =>
  c.json(
    await transaction(async (tx) => {
      const workspace = id(c.req.param('workspace'));
      const actor = await domain.workspaceAccess(tx, c.get('participant').id, workspace);
      return (
        await tx.query(
          'select p.id,p.name,p.kind,wm.role,wm.enabled from participants p join workspace_members wm on wm.participant_id=p.id where wm.workspace_id=$1 and (wm.enabled or $2) order by p.name',
          [workspace, actor.role !== 'member'],
        )
      ).rows;
    }),
  ),
);
app.get('/v1/workspaces/:workspace/conversations', async (c) =>
  c.json(
    await transaction(async (tx) => {
      const workspace = id(c.req.param('workspace'));
      await domain.workspaceAccess(tx, c.get('participant').id, workspace);
      return (
        await tx.query(
          `select c.id,case when c.kind='dm' then (select p.name from conversation_members peer join participants p on p.id=peer.participant_id where peer.conversation_id=c.id and peer.participant_id<>$2 limit 1) else c.name end name,c.private,c.workspace_id,c.kind,c.created_by,c.sequence::text,
           exists(select 1 from events e join messages m on m.id=(e.data->>'id')::uuid
             where e.conversation_id=c.id and e.sequence>coalesce(cr.sequence,0)
             and e.type='message.upsert' and e.data->>'revision'='1'
             and m.author_id<>$2 and m.deleted_at is null) unread
           from conversations c join conversation_members cm on cm.conversation_id=c.id
           left join conversation_reads cr on cr.conversation_id=c.id and cr.participant_id=$2
           where c.workspace_id=$1 and cm.participant_id=$2 order by c.created_at`,
          [workspace, c.get('participant').id],
        )
      ).rows;
    }),
  ),
);
app.post('/v1/workspaces/:workspace/conversations', async (c) => {
  const input = ChannelInput.parse(await c.req.json());
  return c.json(
    await domain.createChannel(
      c.get('participant').id,
      id(c.req.param('workspace')),
      input.name,
      input.private,
    ),
    201,
  );
});
app.post('/v1/conversations/:conversation/read', async (c) => {
  const input = ReadInput.parse(await c.req.json());
  return c.json(
    await domain.markRead(c.get('participant').id, id(c.req.param('conversation')), input.sequence),
  );
});
app.post('/v1/workspaces/:workspace/dms', async (c) => {
  const input = DmInput.parse(await c.req.json());
  return c.json(
    await administration.directMessage(
      c.get('participant').id,
      id(c.req.param('workspace')),
      input.participantId,
    ),
    201,
  );
});
app.patch('/v1/workspaces/:workspace/members/:participant', async (c) => {
  const input = MemberInput.parse(await c.req.json());
  return c.json(
    await administration.updateMember(
      c.get('participant').id,
      id(c.req.param('workspace')),
      id(c.req.param('participant')),
      input,
    ),
  );
});
app.get('/v1/workspaces/:workspace/invitations', async (c) =>
  c.json(await administration.invitations(c.get('participant').id, id(c.req.param('workspace')))),
);
app.delete('/v1/workspaces/:workspace/invitations/:invitation', async (c) =>
  c.json(
    await administration.revokeInvitation(
      c.get('participant').id,
      id(c.req.param('workspace')),
      id(c.req.param('invitation')),
    ),
  ),
);
app.get('/v1/workspaces/:workspace/llm', async (c) =>
  c.json(await administration.llmSettings(c.get('participant').id, id(c.req.param('workspace')))),
);
app.patch('/v1/workspaces/:workspace/llm', async (c) => {
  const input = LlmInput.parse(await c.req.json());
  return c.json(
    await administration.setLlmSettings(
      c.get('participant').id,
      id(c.req.param('workspace')),
      input,
    ),
  );
});
app.get('/v1/workspaces/:workspace/usage', async (c) =>
  c.json(await administration.usage(c.get('participant').id, id(c.req.param('workspace')))),
);
app.post('/v1/workspaces/:workspace/llm/models', async (c) => {
  const input = ModelListInput.parse(await c.req.json());
  return c.json(
    await administration.discoverModels(
      c.get('participant').id,
      id(c.req.param('workspace')),
      input,
    ),
  );
});
app.get('/v1/conversations/:conversation/members', async (c) =>
  c.json(
    await transaction(async (tx) => {
      const conversation = id(c.req.param('conversation'));
      await domain.channelAccess(tx, c.get('participant').id, conversation);
      return (
        await tx.query(
          'select p.id,p.name,p.kind from participants p join conversation_members cm on cm.participant_id=p.id join workspace_members wm on wm.participant_id=p.id and wm.workspace_id=(select workspace_id from conversations where id=$1) where cm.conversation_id=$1 and wm.enabled order by p.name',
          [conversation],
        )
      ).rows;
    }),
  ),
);
app.post('/v1/conversations/:conversation/members/:participant', async (c) =>
  c.json(
    await domain.changeMembership(
      c.get('participant').id,
      id(c.req.param('conversation')),
      id(c.req.param('participant')),
      true,
    ),
  ),
);
app.delete('/v1/conversations/:conversation/members/:participant', async (c) =>
  c.json(
    await domain.changeMembership(
      c.get('participant').id,
      id(c.req.param('conversation')),
      id(c.req.param('participant')),
      false,
    ),
  ),
);
app.get('/v1/conversations/:conversation/messages', async (c) =>
  c.json(
    await domain.snapshot(
      c.get('participant').id,
      id(c.req.param('conversation')),
      c.req.query('before') ? id(c.req.query('before')!) : undefined,
    ),
  ),
);
app.get('/v1/conversations/:conversation/messages/:message', async (c) =>
  c.json(
    await transaction(async (tx) => {
      const conversation = id(c.req.param('conversation'));
      await domain.channelAccess(tx, c.get('participant').id, conversation);
      const row = await domain.getMessage(tx, id(c.req.param('message')));
      if (!row || row.conversation_id !== conversation)
        throw new domain.DomainError(404, 'Message not found');
      return row;
    }),
  ),
);
app.post('/v1/conversations/:conversation/messages', async (c) => {
  const input = MessageInput.parse(await c.req.json());
  return c.json(
    await domain.sendMessage(
      c.get('participant').id,
      id(c.req.param('conversation')),
      input.requestId,
      input.body,
    ),
    201,
  );
});
app.patch('/v1/conversations/:conversation/messages/:message', async (c) => {
  const input = EditInput.parse(await c.req.json());
  return c.json(
    await domain.mutateMessage(
      c.get('participant').id,
      id(c.req.param('conversation')),
      id(c.req.param('message')),
      input.body,
      input.revision,
    ),
  );
});
app.delete('/v1/conversations/:conversation/messages/:message', async (c) => {
  const input = z.object({ revision: z.number().int().positive() }).parse(await c.req.json());
  return c.json(
    await domain.mutateMessage(
      c.get('participant').id,
      id(c.req.param('conversation')),
      id(c.req.param('message')),
      null,
      input.revision,
    ),
  );
});
app.get('/v1/conversations/:conversation/changes', async (c) =>
  c.json(
    await domain.changes(
      c.get('participant').id,
      id(c.req.param('conversation')),
      cursor(c.req.query('after')),
    ),
  ),
);
app.post('/v1/conversations/:conversation/runs', async (c) => {
  const input = RunInput.parse(await c.req.json());
  return c.json(
    await domain.startSummary(
      c.get('participant').id,
      id(c.req.param('conversation')),
      input.requestId,
    ),
    202,
  );
});
app.post('/v1/conversations/:conversation/runs/:run/cancel', async (c) =>
  c.json(
    await transaction(async (tx) => {
      const conversation = id(c.req.param('conversation'));
      await domain.channelAccess(tx, c.get('participant').id, conversation);
      const run = (
        await tx.query(
          'select * from agent_runs where id=$1 and conversation_id=$2 and requester_id=$3',
          [id(c.req.param('run')), conversation, c.get('participant').id],
        )
      ).rows[0];
      if (!run) throw new domain.DomainError(404, 'Run not found');
      if (!['completed', 'cancelled'].includes(run.status))
        await domain.updateRun(tx, run.id, 'cancelled');
      return { ok: true };
    }),
  ),
);
app.get('/v1/conversations/:conversation/events', async (c) => {
  const conversation = id(c.req.param('conversation'));
  const user = c.get('participant').id;
  let after = cursor(c.req.query('after'));
  await domain.changes(user, conversation, after);
  return streamSSE(c, async (stream) => {
    const claims = JSON.parse(Buffer.from(c.get('token').split('.')[1], 'base64url').toString());
    const end = Math.min(Date.now() + 55000, Number(claims.exp) * 1000); // Reconnect with a fresh token. No bearer secrets in URLs.
    while (!stream.aborted && Date.now() < end) {
      try {
        await domain.changes(user, conversation, after, async (result) => {
          for (const event of result.events) {
            await stream.writeSSE({
              event: 'change',
              id: event.sequence,
              data: JSON.stringify(event),
            });
            after = event.sequence;
          }
        });
        await stream.writeSSE({ event: 'heartbeat', data: '{}' });
      } catch (error) {
        await stream.writeSSE({
          event: error instanceof domain.DomainError && error.status === 403 ? 'revoked' : 'reset',
          data: '{}',
        });
        break;
      }
      await stream.sleep(750);
    }
  });
});

// Schemas are generated from the same validation used by handlers.
const routes: [string, string, z.ZodType?][] = [
  ['post', '/workspaces/{workspace}/dms', DmInput],
  ['patch', '/workspaces/{workspace}/members/{participant}', MemberInput],
  ['get', '/workspaces/{workspace}/invitations'],
  ['delete', '/workspaces/{workspace}/invitations/{invitation}'],
  ['get', '/workspaces/{workspace}/llm'],
  ['patch', '/workspaces/{workspace}/llm', LlmInput],
  ['post', '/workspaces/{workspace}/llm/models', ModelListInput],
  ['get', '/workspaces/{workspace}/usage'],
  ['get', '/me'],
  ['get', '/workspaces'],
  ['post', '/workspaces', NameInput],
  ['post', '/workspaces/{workspace}/invitations'],
  ['post', '/invitations/accept', InviteInput],
  ['get', '/workspaces/{workspace}/members'],
  ['get', '/workspaces/{workspace}/conversations'],
  ['post', '/workspaces/{workspace}/conversations', ChannelInput],
  ['get', '/conversations/{conversation}/members'],
  ['post', '/conversations/{conversation}/members/{participant}'],
  ['delete', '/conversations/{conversation}/members/{participant}'],
  ['get', '/conversations/{conversation}/messages/{message}'],
  ['get', '/conversations/{conversation}/messages'],
  ['post', '/conversations/{conversation}/read', ReadInput],
  ['post', '/conversations/{conversation}/messages', MessageInput],
  ['patch', '/conversations/{conversation}/messages/{message}', EditInput],
  [
    'delete',
    '/conversations/{conversation}/messages/{message}',
    z.object({ revision: z.number().int().positive() }),
  ],
  ['get', '/conversations/{conversation}/changes'],
  ['get', '/conversations/{conversation}/events'],
  ['post', '/conversations/{conversation}/runs', RunInput],
  ['post', '/conversations/{conversation}/runs/{run}/cancel'],
];
app.get('/openapi.json', (c) => {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [method, path, schema] of routes) {
    paths[`/v1${path}`] ??= {};
    const parameters: unknown[] = [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
      name: match[1],
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    }));
    if (path.endsWith('/changes') || path.endsWith('/events'))
      parameters.push({
        name: 'after',
        in: 'query',
        schema: { type: 'string', pattern: '^\\d{1,18}$' },
      });
    if (method === 'get' && path.endsWith('/messages'))
      parameters.push({ name: 'before', in: 'query', schema: { type: 'string', format: 'uuid' } });
    const output = path.endsWith('/llm/models')
      ? ModelListOutput
      : path.endsWith('/llm')
        ? LlmOutput
        : path.endsWith('/usage')
          ? UsageOutput
          : path.endsWith('/dms')
            ? ConversationOutput
            : method === 'patch' && path.endsWith('/members/{participant}')
              ? z.object({ ok: z.boolean() })
              : method === 'delete' && !path.endsWith('/messages/{message}')
                ? z.object({ ok: z.boolean() })
                : path.endsWith('/invitations') && method === 'get'
                  ? z.array(InvitationOutput)
                  : path === '/me'
                    ? ParticipantOutput
                    : path === '/workspaces'
                      ? method === 'get'
                        ? z.array(WorkspaceOutput)
                        : WorkspaceOutput
                      : path.endsWith('/invitations')
                        ? z.object({ token: z.string(), expiresInDays: z.number() })
                        : path === '/invitations/accept'
                          ? z.object({ workspaceId: z.uuid() })
                          : path.endsWith('/members')
                            ? path.startsWith('/workspaces/')
                              ? z.array(MemberOutput)
                              : z.array(ParticipantOutput)
                            : path.endsWith('/conversations')
                              ? method === 'get'
                                ? z.array(ConversationOutput)
                                : ConversationOutput
                              : path.endsWith('/messages')
                                ? method === 'get'
                                  ? SnapshotOutput
                                  : MessageOutput
                                : path.endsWith('/messages/{message}')
                                  ? MessageOutput
                                  : path.endsWith('/changes')
                                    ? ChangesOutput
                                    : path.endsWith('/runs')
                                      ? RunOutput
                                      : z.object({ ok: z.boolean() });
    const success =
      method === 'post' && path.endsWith('/runs')
        ? '202'
        : method === 'post' &&
            (path === '/workspaces' ||
              path.endsWith('/invitations') ||
              path.endsWith('/conversations') ||
              path.endsWith('/dms') ||
              path.endsWith('/messages'))
          ? '201'
          : '200';
    paths[`/v1${path}`][method] = {
      security: [{ bearerAuth: [] }],
      parameters,
      ...(schema
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: z.toJSONSchema(schema, { io: 'input' }) } },
            },
          }
        : {}),
      responses: {
        [success]: {
          description: 'Successful response',
          content: path.endsWith('/events')
            ? {
                'text/event-stream': {
                  schema: { type: 'string' },
                  examples: {
                    change: {
                      value:
                        'event: change\ndata: {"sequence":"1","type":"message.upsert","data":{...}}\n\n',
                    },
                  },
                },
              }
            : { 'application/json': { schema: z.toJSONSchema(output) } },
        },
        '400': { description: 'Invalid request' },
        '401': { description: 'Invalid session' },
        '403': { description: 'Access denied' },
        '409': { description: 'Conflicting change' },
      },
    };
  }
  return c.json({
    openapi: '3.1.0',
    info: { title: 'Neoms API', version: '0.1.0' },
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
    paths,
  });
});
