import { createHash } from 'node:crypto';
import { RunScope, type RunRequest, type Agent, type Message } from '../../contracts/src/index.js';
import type { Tx } from '../../db/src/index.js';
import { DomainError } from './index.js';
import { estimateInput } from './agent-context.js';
import { resolvedPolicy } from './run-policy.js';

export async function selectRunScope(
  tx: Tx,
  user: string,
  channel: { id: string; workspace_id: string; sequence: string },
  agent: Agent,
  request: Pick<RunRequest, 'scope' | 'limits'>,
) {
  const policy = await resolvedPolicy(
    tx,
    channel.workspace_id,
    agent.agent_id,
    channel.id,
    request.limits,
  );
  const scope = RunScope.parse(request.scope ?? {});
  scope.upperSequence ??= channel.sequence;
  if (BigInt(scope.upperSequence) > BigInt(channel.sequence))
    throw new DomainError(400, 'Scope is beyond the conversation');
  if (scope.mode === 'unread') {
    scope.afterSequence ??=
      (
        await tx.query(
          'select sequence::text from conversation_reads where conversation_id=$1 and participant_id=$2',
          [channel.id, user],
        )
      ).rows[0]?.sequence ?? '0';
    if (BigInt(scope.afterSequence!) > BigInt(scope.upperSequence))
      throw new DomainError(400, 'Invalid unread scope');
  }
  const args = [
    channel.id,
    scope.upperSequence,
    scope.mode === 'unread' ? scope.afterSequence : '0',
    scope.mode === 'since' ? scope.since : null,
  ];
  const predicates = `e.conversation_id=$1 and e.type='message.upsert' and e.data->>'revision'='1'
    and e.sequence<=$2 and e.sequence>$3 and m.deleted_at is null and p.kind='human'
    and ($4::timestamptz is null or m.created_at>=$4::timestamptz)`;
  const total = Number(
    (
      await tx.query(
        `select count(*)::text count from events e join messages m on m.id::text=e.data->>'id'
     join participants p on p.id=m.author_id where ${predicates}`,
        args,
      )
    ).rows[0].count,
  );
  const candidates = (
    await tx.query<Message>(
      `select m.*,p.name author_name,p.kind author_kind from events e
     join messages m on m.id::text=e.data->>'id' join participants p on p.id=m.author_id
     where ${predicates} and m.created_at>=now()-($5 * interval '1 day')
     order by m.created_at desc,m.id desc limit $6`,
      [...args, policy.maxHistoryDays, policy.maxMessages],
    )
  ).rows;
  const messages: Message[] = [];
  for (const message of candidates) {
    if (estimateInput(agent, [message, ...messages]) <= policy.maxContextTokens)
      messages.unshift(message);
  }
  if (!messages.length)
    throw new DomainError(
      400,
      total
        ? 'No messages fit the allowed history and context limits. Choose a narrower range or ask an admin.'
        : 'No messages in this scope. Choose recent messages or a different start date.',
    );
  const refs = messages.map((message) => ({ id: message.id, revision: message.revision }));
  const coverage = {
    selectedMessages: messages.length,
    totalMessages: total,
    omittedMessages: total - messages.length,
    from: messages[0].created_at,
    to: messages.at(-1)!.created_at,
    estimatedInputTokens: estimateInput(agent, messages),
  };
  const selectionHash = createHash('sha256')
    .update(
      JSON.stringify({ agentId: agent.agent_id, version: agent.version, scope, policy, refs }),
    )
    .digest('hex');
  return { agentId: agent.agent_id, scope, policy, coverage, selectionHash, refs, messages };
}
