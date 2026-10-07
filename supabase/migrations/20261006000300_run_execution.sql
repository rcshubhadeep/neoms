alter table app.agent_runs drop constraint agent_runs_status_check;
alter table app.agent_runs add constraint agent_runs_status_check check(status in ('queued','running','retrying','cancelling','completed','failed','cancelled'));
alter table app.agent_runs add column active_attempt_id uuid;
alter table app.agent_runs add column execution_attempts integer not null default 0;
alter table app.agent_runs add column cancellation_requested_at timestamptz;
alter table app.agent_runs add column finished_at timestamptz;
alter table app.agent_runs add column queue_name text not null default 'summary';
create table app.run_attempts (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references app.agent_runs on delete cascade,
 number integer not null,
 status text not null check(status in ('running','completed','failed','interrupted','cancelled')),
 started_at timestamptz not null default now(), finished_at timestamptz,
 lease_expires_at timestamptz not null,
 error text,
 unique(run_id,number)
);
alter table app.agent_runs add foreign key(active_attempt_id) references app.run_attempts;
create table app.run_steps (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references app.agent_runs on delete cascade,
 attempt_id uuid references app.run_attempts on delete cascade,
 name text not null check(name in ('context','generation','validation','result','publication')),
 status text not null check(status in ('running','completed','failed','interrupted','cancelled')),
 started_at timestamptz not null default now(), finished_at timestamptz, error text,
 unique nulls not distinct(run_id,attempt_id,name)
);
alter table app.llm_usage add column attempt_id uuid unique references app.run_attempts on delete cascade;
alter table app.run_attempts enable row level security;
alter table app.run_steps enable row level security;
create index on app.run_attempts(lease_expires_at) where status='running';
-- Unfenced work from an older binary must not publish after this migration.
update app.agent_runs set status='cancelled',error='Runner upgraded; start a new run',finished_at=now()
 where status in ('queued','running','failed');
