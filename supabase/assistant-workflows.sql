create table if not exists public.assistant_workflows (
  workflow_id text primary key,
  thread_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  state text not null check (state in (
    'idle', 'understanding_request', 'awaiting_clarification',
    'calculating_availability', 'proposal_ready', 'awaiting_approval',
    'applying', 'applied', 'failed'
  )),
  intent text not null,
  extracted_items jsonb not null default '[]'::jsonb,
  missing_fields text[] not null default '{}',
  selected_candidate_ids text[] not null default '{}',
  proposal_ids text[] not null default '{}',
  pending_proposal_ids text[] not null default '{}',
  applied_proposal_ids text[] not null default '{}',
  completion_status text not null check (completion_status in (
    'nothing_created', 'proposal_created', 'records_applied'
  )),
  persistence_status text not null check (persistence_status in (
    'not_required', 'persisted', 'failed'
  )),
  context jsonb,
  last_updated_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now())
);

create index if not exists assistant_workflows_user_thread_updated_idx
on public.assistant_workflows (user_id, thread_id, last_updated_at desc);

create table if not exists public.assistant_proposal_batches (
  batch_id text primary key,
  workflow_id text not null references public.assistant_workflows (workflow_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  proposal_ids text[] not null default '{}',
  status text not null check (status in (
    'pending', 'partially_applied', 'applied', 'rejected'
  )),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workflow_id)
);

create table if not exists public.assistant_proposals (
  proposal_id text primary key,
  workflow_id text not null references public.assistant_workflows (workflow_id) on delete cascade,
  batch_id text references public.assistant_proposal_batches (batch_id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  action_type text not null check (action_type in (
    'create_time_block', 'create_scheduled_item', 'create_project',
    'update_project', 'update_next_action', 'update_schedule_exception'
  )),
  approval_status text not null check (approval_status in (
    'pending', 'approved', 'rejected', 'applied'
  )),
  conflict_status text not null check (conflict_status in (
    'clear', 'conflict', 'needs_revalidation'
  )),
  saved_record_id text,
  payload jsonb not null,
  time_block jsonb,
  inserted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists assistant_proposals_user_workflow_idx
on public.assistant_proposals (user_id, workflow_id, created_at);

alter table public.assistant_workflows enable row level security;
alter table public.assistant_proposal_batches enable row level security;
alter table public.assistant_proposals enable row level security;

drop policy if exists "Users manage their assistant workflows" on public.assistant_workflows;
create policy "Users manage their assistant workflows"
on public.assistant_workflows for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their assistant proposal batches" on public.assistant_proposal_batches;
create policy "Users manage their assistant proposal batches"
on public.assistant_proposal_batches for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their assistant proposals" on public.assistant_proposals;
create policy "Users manage their assistant proposals"
on public.assistant_proposals for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.persist_assistant_workflow(
  p_workflow jsonb,
  p_proposals jsonb,
  p_batch jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  workflow_user_id uuid := (p_workflow->>'user_id')::uuid;
  workflow_key text := p_workflow->>'workflow_id';
begin
  if workflow_user_id is null or workflow_user_id <> (select auth.uid()) then
    raise exception 'Assistant workflow ownership check failed';
  end if;

  insert into public.assistant_workflows (
    workflow_id, thread_id, user_id, state, intent, extracted_items,
    missing_fields, selected_candidate_ids, proposal_ids,
    pending_proposal_ids, applied_proposal_ids, completion_status,
    persistence_status, context, last_updated_at
  ) values (
    workflow_key,
    p_workflow->>'thread_id',
    workflow_user_id,
    p_workflow->>'state',
    p_workflow->>'intent',
    coalesce(p_workflow->'extracted_items', '[]'::jsonb),
    coalesce(array(select jsonb_array_elements_text(p_workflow->'missing_fields')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_workflow->'selected_candidate_ids')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_workflow->'proposal_ids')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_workflow->'pending_proposal_ids')), '{}'),
    coalesce(array(select jsonb_array_elements_text(p_workflow->'applied_proposal_ids')), '{}'),
    p_workflow->>'completion_status',
    'persisted',
    p_workflow->'context',
    coalesce((p_workflow->>'last_updated_at')::timestamptz, timezone('utc', now()))
  )
  on conflict (workflow_id) do update set
    state = excluded.state,
    intent = excluded.intent,
    extracted_items = excluded.extracted_items,
    missing_fields = excluded.missing_fields,
    selected_candidate_ids = excluded.selected_candidate_ids,
    proposal_ids = excluded.proposal_ids,
    pending_proposal_ids = excluded.pending_proposal_ids,
    applied_proposal_ids = excluded.applied_proposal_ids,
    completion_status = excluded.completion_status,
    persistence_status = 'persisted',
    context = excluded.context,
    last_updated_at = excluded.last_updated_at;

  if p_batch is not null and jsonb_typeof(p_batch) = 'object' then
    insert into public.assistant_proposal_batches (
      batch_id, workflow_id, user_id, title, proposal_ids, status, updated_at
    ) values (
      p_batch->>'batch_id',
      workflow_key,
      workflow_user_id,
      p_batch->>'title',
      coalesce(array(select jsonb_array_elements_text(p_batch->'proposal_ids')), '{}'),
      p_batch->>'status',
      timezone('utc', now())
    )
    on conflict (workflow_id) do update set
      batch_id = excluded.batch_id,
      title = excluded.title,
      proposal_ids = excluded.proposal_ids,
      status = excluded.status,
      updated_at = excluded.updated_at;
  end if;

  insert into public.assistant_proposals (
    proposal_id, workflow_id, batch_id, user_id, action_type,
    approval_status, conflict_status, saved_record_id, payload,
    time_block, created_at, updated_at
  )
  select
    item->>'proposal_id',
    workflow_key,
    nullif(item->>'batch_id', ''),
    workflow_user_id,
    item->>'action_type',
    item->>'approval_status',
    item->>'conflict_status',
    nullif(item->>'saved_record_id', ''),
    item->'payload',
    item->'time_block',
    coalesce((item->>'created_at')::timestamptz, timezone('utc', now())),
    coalesce((item->>'updated_at')::timestamptz, timezone('utc', now()))
  from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) item
  on conflict (proposal_id) do update set
    batch_id = excluded.batch_id,
    approval_status = excluded.approval_status,
    conflict_status = excluded.conflict_status,
    saved_record_id = excluded.saved_record_id,
    payload = excluded.payload,
    time_block = excluded.time_block,
    updated_at = excluded.updated_at;

  delete from public.assistant_proposals proposal
  where proposal.workflow_id = workflow_key
    and proposal.user_id = workflow_user_id
    and proposal.approval_status = 'pending'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) item
      where item->>'proposal_id' = proposal.proposal_id
    );

  return jsonb_build_object(
    'workflow_id', workflow_key,
    'proposal_count', jsonb_array_length(coalesce(p_proposals, '[]'::jsonb)),
    'persisted', true
  );
end;
$$;

notify pgrst, 'reload schema';
