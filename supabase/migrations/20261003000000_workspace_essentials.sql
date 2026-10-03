alter table app.workspace_members drop constraint workspace_members_role_check;
alter table app.workspace_members add constraint workspace_members_role_check check(role in ('owner','admin','member'));
alter table app.workspace_members add column enabled boolean not null default true;
alter table app.invitations add column revoked_at timestamptz;
alter table app.conversations add column kind text not null default 'channel' check(kind in ('channel','dm'));
alter table app.conversations add column created_by uuid references app.participants;
alter table app.conversations add column dm_pair text;
alter table app.conversations drop constraint conversations_workspace_id_name_key;
create unique index channel_names on app.conversations(workspace_id,name) where kind='channel';
create unique index dm_pairs on app.conversations(workspace_id,dm_pair) where kind='dm';
alter table app.conversations add constraint conversation_shape check((kind='channel' and dm_pair is null) or (kind='dm' and private and dm_pair is not null));
update app.conversations c set created_by=(select wm.participant_id from app.workspace_members wm where wm.workspace_id=c.workspace_id and wm.role='owner' limit 1);
create table app.workspace_llm (
 workspace_id uuid primary key references app.workspaces on delete cascade,
 provider text not null default 'test' check(provider in ('test','anthropic')),
 model text not null default 'deterministic', key_ciphertext text,
 revision integer not null default 1, updated_at timestamptz not null default now(), updated_by uuid references app.participants
);
insert into app.workspace_llm(workspace_id) select id from app.workspaces;
alter table app.agent_runs add column config_revision integer;
alter table app.agent_runs add column model text;
create table app.llm_usage (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references app.agent_runs on delete cascade,
 workspace_id uuid not null references app.workspaces on delete cascade,
 participant_id uuid not null references app.participants, provider text not null, model text not null,
 status text not null default 'started' check(status in ('started','reported','unknown')),
 input_tokens bigint check(input_tokens>=0), output_tokens bigint check(output_tokens>=0),
 cache_read_tokens bigint check(cache_read_tokens>=0), cache_write_tokens bigint check(cache_write_tokens>=0),
 created_at timestamptz not null default now()
);
create index on app.llm_usage(workspace_id,participant_id,created_at);
alter table app.workspace_llm enable row level security;
alter table app.llm_usage enable row level security;
