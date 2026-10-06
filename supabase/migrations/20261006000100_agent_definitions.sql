-- Preserve participant identities and existing grants. Definitions confer no access.
create table app.agent_definitions (
 agent_id uuid primary key references app.participants,
 workspace_id uuid not null references app.workspaces on delete cascade,
 key text not null,
 origin text not null default 'built_in' check(origin in ('built_in','workspace','personal')),
 owner_id uuid references app.participants,
 enabled boolean not null default true,
 unique(workspace_id,key)
);
create table app.agent_versions (
 agent_id uuid not null references app.agent_definitions on delete cascade,
 version integer not null check(version>0),
 operation text not null check(operation in ('summarize','suggest_actions')),
 instructions text not null check(length(instructions)<=8000),
 created_at timestamptz not null default now(),
 primary key(agent_id,version)
);
alter table app.agent_definitions enable row level security;
alter table app.agent_versions enable row level security;

-- The previous implementation created one Assistant per workspace. Any additional
-- legacy identities get their own key rather than losing their historical authorship.
insert into app.agent_definitions(agent_id,workspace_id,key)
select p.id,wm.workspace_id,
 case when row_number() over(partition by wm.workspace_id order by p.id)=1
 then 'scribe' else 'legacy-' || p.id::text end
from app.participants p join app.workspace_members wm on wm.participant_id=p.id
where p.kind='agent';
insert into app.agent_versions(agent_id,version,operation,instructions)
select agent_id,1,'summarize','Summarize decisions, open questions, and next actions.'
from app.agent_definitions;

-- Planner is available in the workspace but is NOT granted any existing channel.
do $$
declare workspace record; planner uuid;
begin
 for workspace in select id from app.workspaces loop
  insert into app.participants(kind,name) values('agent','Planner') returning id into planner;
  insert into app.workspace_members(workspace_id,participant_id,role)
   values(workspace.id,planner,'member');
  insert into app.agent_definitions(agent_id,workspace_id,key)
   values(planner,workspace.id,'planner');
  insert into app.agent_versions(agent_id,version,operation,instructions)
   values(planner,1,'suggest_actions','Extract suggested next actions, stated owners, and explicit deadlines.');
 end loop;
end $$;

alter table app.agent_runs add column agent_version integer;
update app.agent_runs set agent_version=1;
alter table app.agent_runs alter column agent_version set not null;
alter table app.agent_runs add foreign key(agent_id,agent_version)
 references app.agent_versions(agent_id,version);

-- Published definitions are immutable; editing creates a new version.
create function app.reject_agent_version_update() returns trigger language plpgsql as $$
begin
 raise exception 'Agent versions are immutable; insert a new version';
end $$;
create trigger agent_version_immutable before update on app.agent_versions
 for each row execute function app.reject_agent_version_update();
