create schema if not exists app;
revoke all on schema app from public, anon, authenticated;
create table app.participants (
 id uuid primary key default gen_random_uuid(), auth_user_id uuid unique references auth.users(id) on delete cascade,
 kind text not null check(kind in ('human','agent')), name text not null,
 check((kind='human' and auth_user_id is not null) or (kind='agent' and auth_user_id is null))
);
create table app.workspaces (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table app.workspace_members (workspace_id uuid references app.workspaces on delete cascade, participant_id uuid references app.participants on delete cascade, role text not null check(role in ('owner','member')), primary key(workspace_id,participant_id));
create table app.invitations (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references app.workspaces on delete cascade, token_hash text unique not null, expires_at timestamptz not null, accepted_by uuid references app.participants, created_at timestamptz not null default now());
create table app.conversations (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references app.workspaces on delete cascade, name text not null, private boolean not null default false, sequence bigint not null default 0, created_at timestamptz not null default now(), unique(workspace_id,name));
create table app.conversation_members (conversation_id uuid references app.conversations on delete cascade, participant_id uuid references app.participants on delete cascade, primary key(conversation_id,participant_id));
create table app.agent_runs (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references app.conversations on delete cascade, requester_id uuid not null references app.participants, agent_id uuid not null references app.participants, request_id uuid not null, status text not null default 'queued' check(status in ('queued','running','completed','failed','cancelled')), provider text not null, error text, created_at timestamptz not null default now(), unique(conversation_id,requester_id,request_id));
create table app.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references app.conversations on delete cascade, author_id uuid not null references app.participants, request_id uuid not null, request_hash text not null, body text not null, citations uuid[] not null default '{}', agent_run_id uuid unique references app.agent_runs, revision integer not null default 1, stale boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz, unique(conversation_id,author_id,request_id));
create index on app.messages(conversation_id,created_at,id);
create table app.events (conversation_id uuid references app.conversations on delete cascade, sequence bigint not null, type text not null, data jsonb not null, created_at timestamptz not null default now(), primary key(conversation_id,sequence));
-- Product data is available only through the authenticated application server.
-- No client REST grants or RLS policies exist for this private schema.
alter table app.participants enable row level security;
alter table app.workspaces enable row level security;
alter table app.workspace_members enable row level security;
alter table app.invitations enable row level security;
alter table app.conversations enable row level security;
alter table app.conversation_members enable row level security;
alter table app.agent_runs enable row level security;
alter table app.messages enable row level security;
alter table app.events enable row level security;
