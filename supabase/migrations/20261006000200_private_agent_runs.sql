create table app.workspace_agent_policy (
 workspace_id uuid primary key references app.workspaces on delete cascade,
 limits jsonb not null default '{"maxContextTokens":8000,"maxOutputTokens":2000,"maxMessages":200,"maxHistoryDays":30,"maxAttempts":3,"maxConcurrentRuns":4,"userDailyTokens":1000000,"workspaceMonthlyTokens":10000000,"retentionDays":7,"allowSharing":true}'
);
insert into app.workspace_agent_policy(workspace_id) select id from app.workspaces;
alter table app.workspace_agent_policy enable row level security;
alter table app.agent_definitions add column limits jsonb not null default '{}';
alter table app.conversations add column agent_limits jsonb not null default '{}';
alter table app.agent_runs add column request_hash text;
alter table app.agent_runs add column scope jsonb;
alter table app.agent_runs add column resolved_policy jsonb;
alter table app.agent_runs add column source_refs jsonb not null default '[]';
alter table app.agent_runs add column coverage jsonb;
alter table app.agent_runs add column budget_tokens bigint not null default 0 check(budget_tokens>=0);
alter table app.agent_runs add column attempts_started integer not null default 0;
alter table app.agent_runs add column deadline_at timestamptz;
create table app.agent_results (
 run_id uuid primary key references app.agent_runs on delete cascade,
 body text not null, citations uuid[] not null,
 stale boolean not null default false,
 expires_at timestamptz not null,
 shared_message_id uuid references app.messages on delete set null,
 shared_by uuid references app.participants
);
alter table app.agent_results enable row level security;
create index on app.agent_results(expires_at);
create index on app.agent_runs(requester_id,created_at);
-- Existing messages were already public; do not pretend to privatize them.
