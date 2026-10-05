alter table app.workspace_llm drop constraint workspace_llm_provider_check;
alter table app.workspace_llm add constraint workspace_llm_provider_check
  check (provider in ('test', 'anthropic', 'openai-compatible'));
alter table app.workspace_llm add column base_url text;
alter table app.workspace_llm add column token_limit_parameter text not null default 'max_completion_tokens'
  check (token_limit_parameter in ('max_tokens', 'max_completion_tokens'));
alter table app.workspace_llm add constraint workspace_llm_base_url_check
  check (provider <> 'openai-compatible' or base_url is not null);
