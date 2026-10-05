create table app.conversation_reads (
  conversation_id uuid not null,
  participant_id uuid not null,
  sequence bigint not null default 0 check (sequence >= 0),
  primary key (conversation_id, participant_id),
  foreign key (conversation_id, participant_id)
    references app.conversation_members (conversation_id, participant_id) on delete cascade
);
alter table app.conversation_reads enable row level security;
create index events_new_messages on app.events (conversation_id, sequence)
  where type = 'message.upsert' and data->>'revision' = '1';
