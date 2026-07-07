alter table public.assistant_workflows
drop constraint if exists assistant_workflows_state_check;

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

alter table public.assistant_workflows
add constraint assistant_workflows_state_check check (state in (
  'idle', 'understanding_request', 'awaiting_clarification',
  'calculating_availability', 'proposal_ready', 'awaiting_approval',
  'applying', 'applied', 'failed', 'canceled'
));

create table if not exists public.assistant_automation_grants (
  grant_id text primary key,
  workflow_id text not null references public.assistant_workflows (workflow_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  source_message_id text not null,
  scope text not null check (scope in (
    'current_request', 'current_week', 'current_series', 'routine_occurrences'
  )),
  allowed_actions text[] not null default '{}',
  activity_title text,
  related_project_id text,
  guardrails jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  status text not null check (status in ('active', 'consumed', 'revoked', 'expired')),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.assistant_planning_decisions (
  decision_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workflow_id text not null references public.assistant_workflows (workflow_id) on delete cascade,
  action_type text not null,
  automation_mode text not null check (automation_mode in (
    'manual_review', 'batch_approval', 'auto_applied'
  )),
  grant_id text references public.assistant_automation_grants (grant_id) on delete set null,
  proposal_ids text[] not null default '{}',
  target_record_ids text[] not null default '{}',
  reason_codes text[] not null default '{}',
  preferences_used text[] not null default '{}',
  constraints_used text[] not null default '{}',
  schedule_exception_ids text[] not null default '{}',
  before_state jsonb,
  after_state jsonb,
  status text not null check (status in (
    'pending', 'applied', 'partially_applied', 'failed', 'undone'
  )),
  reversible_until timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists assistant_planning_decisions_user_created_idx
on public.assistant_planning_decisions (user_id, created_at desc);

create table if not exists public.assistant_action_receipts (
  receipt_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  decision_record_id text references public.assistant_planning_decisions (decision_id) on delete cascade,
  title text not null,
  summary text not null,
  action_type text not null check (action_type in (
    'plan_applied', 'plan_adjusted', 'action_failed', 'action_undone'
  )),
  item_count integer not null check (item_count >= 0),
  primary_time timestamptz,
  next_occurrence_at timestamptz,
  available_actions text[] not null default '{}',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists set_assistant_automation_grants_updated_at
on public.assistant_automation_grants;
create trigger set_assistant_automation_grants_updated_at
before update on public.assistant_automation_grants
for each row execute function public.handle_updated_at();

drop trigger if exists set_assistant_planning_decisions_updated_at
on public.assistant_planning_decisions;
create trigger set_assistant_planning_decisions_updated_at
before update on public.assistant_planning_decisions
for each row execute function public.handle_updated_at();

drop trigger if exists set_assistant_action_receipts_updated_at
on public.assistant_action_receipts;
create trigger set_assistant_action_receipts_updated_at
before update on public.assistant_action_receipts
for each row execute function public.handle_updated_at();

alter table public.assistant_automation_grants enable row level security;
alter table public.assistant_planning_decisions enable row level security;
alter table public.assistant_action_receipts enable row level security;

drop policy if exists "Users manage their assistant automation grants"
on public.assistant_automation_grants;
create policy "Users manage their assistant automation grants"
on public.assistant_automation_grants for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their assistant planning decisions"
on public.assistant_planning_decisions;
create policy "Users manage their assistant planning decisions"
on public.assistant_planning_decisions for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage their assistant action receipts"
on public.assistant_action_receipts;
create policy "Users manage their assistant action receipts"
on public.assistant_action_receipts for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.undo_assistant_decision(p_decision_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  decision_row public.assistant_planning_decisions%rowtype;
  expected_count integer;
  matching_count integer;
  reversed_records jsonb;
begin
  select * into decision_row
  from public.assistant_planning_decisions
  where decision_id = p_decision_id
    and user_id = (select auth.uid())
  for update;

  if decision_row.decision_id is null then
    raise exception 'The automated action could not be found';
  end if;
  if decision_row.status not in ('applied', 'partially_applied') then
    raise exception 'This automated action is no longer reversible';
  end if;
  if decision_row.automation_mode <> 'auto_applied' then
    raise exception 'Only automatically applied actions can be undone here';
  end if;
  if decision_row.reversible_until is not null
    and decision_row.reversible_until < timezone('utc', now()) then
    raise exception 'The Undo window has expired';
  end if;

  select count(*) into expected_count
  from jsonb_array_elements(coalesce(decision_row.after_state->'records', '[]'::jsonb));
  if expected_count = 0 then
    raise exception 'No reversible Schedule Builder records were recorded';
  end if;

  select count(*) into matching_count
  from public.weekly_plan_blocks block
  where block.user_id = (select auth.uid())
    and exists (
      select 1
      from jsonb_array_elements(decision_row.after_state->'records') expected
      where expected->>'block_id' = block.block_id
        and block.updated_at = (expected->>'updated_at')::timestamptz
        and block.project_name = expected->>'project_name'
        and block.planned_task = expected->>'planned_task'
        and block.estimated_hours = (expected->>'estimated_hours')::double precision
        and coalesce(block.start_time::text, '') = coalesce(expected->>'start_time', '')
        and coalesce(block.scheduled_date::text, '') = coalesce(expected->>'scheduled_date', '')
    );

  if matching_count <> expected_count then
    raise exception 'One or more created records changed after application';
  end if;

  select jsonb_agg(to_jsonb(block)) into reversed_records
  from public.weekly_plan_blocks block
  where block.user_id = (select auth.uid())
    and block.block_id = any(decision_row.target_record_ids);

  delete from public.weekly_plan_blocks
  where user_id = (select auth.uid())
    and block_id = any(decision_row.target_record_ids);

  update public.assistant_proposals
  set approval_status = 'rejected',
      saved_record_id = null,
      updated_at = timezone('utc', now())
  where user_id = (select auth.uid())
    and workflow_id = decision_row.workflow_id
    and proposal_id = any(decision_row.proposal_ids);

  update public.assistant_workflows
  set state = 'canceled',
      pending_proposal_ids = '{}',
      applied_proposal_ids = '{}',
      completion_status = 'nothing_created',
      context = null,
      last_updated_at = timezone('utc', now())
  where user_id = (select auth.uid())
    and workflow_id = decision_row.workflow_id;

  update public.assistant_proposal_batches
  set status = 'rejected', updated_at = timezone('utc', now())
  where user_id = (select auth.uid())
    and workflow_id = decision_row.workflow_id;

  update public.assistant_planning_decisions
  set status = 'undone',
      reversed_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where decision_id = p_decision_id
    and user_id = (select auth.uid());

  update public.assistant_action_receipts
  set action_type = 'action_undone',
      summary = 'The automatically created Schedule Builder blocks were removed.',
      available_actions = array['view'],
      updated_at = timezone('utc', now())
  where decision_record_id = p_decision_id
    and user_id = (select auth.uid());

  return jsonb_build_object(
    'decision_id', p_decision_id,
    'reversed_records', coalesce(reversed_records, '[]'::jsonb),
    'status', 'undone',
    'workflow_id', decision_row.workflow_id
  );
end;
$$;

notify pgrst, 'reload schema';
