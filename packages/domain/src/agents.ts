import type { Tx } from '../../db/src/index.js';
import { AgentOutput, AgentVersionOutput, type AgentVersion } from '../../contracts/src/index.js';

export const builtInAgents = [
  {
    key: 'scribe',
    name: 'Scribe',
    operation: 'summarize',
    instructions: 'Summarize decisions, open questions, and next actions.',
  },
  {
    key: 'planner',
    name: 'Planner',
    operation: 'suggest_actions',
    instructions: 'Extract suggested next actions, stated owners, and explicit deadlines.',
  },
] as const;

export async function createBuiltInAgents(tx: Tx, workspace: string) {
  const ids: string[] = [];
  for (const agent of builtInAgents) {
    const { rows } = await tx.query(
      "insert into participants(kind,name) values('agent',$1) returning id",
      [agent.name],
    );
    const id: string = rows[0].id;
    await tx.query(
      "insert into workspace_members(workspace_id,participant_id,role) values($1,$2,'member')",
      [workspace, id],
    );
    await tx.query('insert into agent_definitions(agent_id,workspace_id,key) values($1,$2,$3)', [
      id,
      workspace,
      agent.key,
    ]);
    await tx.query(
      'insert into agent_versions(agent_id,version,operation,instructions) values($1,1,$2,$3)',
      [id, agent.operation, agent.instructions],
    );
    ids.push(id);
  }
  return ids;
}

// Caller holds conversation/requester authorization. Workspace ownership is not
// a grant to a private channel. Preserve only the existing built-in Scribe DM path.
export async function availableAgents(
  tx: Tx,
  workspace: string,
  conversation: string,
  dm: boolean,
) {
  const { rows } = await tx.query(
    `select d.agent_id,d.key,p.name,v.version,v.operation,v.instructions
     from agent_definitions d join participants p on p.id=d.agent_id
     join workspace_members wm on wm.workspace_id=d.workspace_id and wm.participant_id=d.agent_id
     join lateral (select * from agent_versions where agent_id=d.agent_id order by version desc limit 1) v on true
     where d.workspace_id=$1 and d.enabled and wm.enabled and p.kind='agent'
       and d.origin='built_in' and d.owner_id is null
       and (case when $3 then d.origin='built_in' and d.key='scribe'
            else exists(select 1 from conversation_members where conversation_id=$2 and participant_id=d.agent_id) end)
     order by d.key`,
    [workspace, conversation, dm],
  );
  return rows.map((row) => AgentOutput.parse(row));
}

export async function pinnedAgentVersion(
  tx: Tx,
  agent: string,
  version: number,
): Promise<AgentVersion> {
  const { rows } = await tx.query('select * from agent_versions where agent_id=$1 and version=$2', [
    agent,
    version,
  ]);
  return AgentVersionOutput.parse(rows[0]);
}
