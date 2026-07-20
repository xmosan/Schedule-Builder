-- Run after assistant-workflows.sql and assistant-automation.sql.
-- This migration adds a durable, idempotent ledger for Assistant apply attempts.

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
drop constraint if exists assistant_workflows_state_check;

alter table public.assistant_workflows
add constraint assistant_workflows_state_check check (state in (
  'idle', 'understanding_request', 'awaiting_clarification',
  'calculating_availability', 'proposal_ready', 'awaiting_approval',
  'applying', 'partially_applied', 'applied', 'applied_with_warning',
  'failed', 'canceled', 'undone'
));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.assistant_workflows'::regclass
      and conname = 'assistant_workflows_proposal_state_disjoint'
  ) then
    alter table public.assistant_workflows
    add constraint assistant_workflows_proposal_state_disjoint
    check (not (pending_proposal_ids && applied_proposal_ids)) not valid;
  end if;
end;
$$;

create unique index if not exists assistant_workflows_user_workflow_unique
on public.assistant_workflows (user_id, workflow_id);

create unique index if not exists assistant_proposal_batches_user_batch_unique
on public.assistant_proposal_batches (user_id, batch_id);

create unique index if not exists assistant_proposals_user_proposal_unique
on public.assistant_proposals (user_id, proposal_id);

create unique index if not exists assistant_automation_grants_user_grant_unique
on public.assistant_automation_grants (user_id, grant_id);

create unique index if not exists assistant_planning_decisions_user_decision_unique
on public.assistant_planning_decisions (user_id, decision_id);

alter table public.assistant_planning_decisions
add column if not exists proposal_batch_id text null,
add column if not exists apply_attempt_id text null,
add column if not exists idempotency_key text null,
add column if not exists failure_details jsonb not null default '[]'::jsonb,
add column if not exists warning_codes text[] not null default '{}',
add column if not exists finalized_at timestamptz null;

alter table public.assistant_planning_decisions
drop constraint if exists assistant_planning_decisions_automation_mode_check;

alter table public.assistant_planning_decisions
add constraint assistant_planning_decisions_automation_mode_check
check (automation_mode in (
  'manual_review', 'batch_approval', 'auto_applied',
  'manual_batch_apply', 'auto_apply'
));

create unique index if not exists assistant_planning_decisions_user_idempotency_unique
on public.assistant_planning_decisions (user_id, idempotency_key)
where idempotency_key is not null;

alter table public.assistant_action_receipts
add column if not exists apply_attempt_id text null,
add column if not exists warning_codes text[] not null default '{}';

create unique index if not exists assistant_action_receipts_user_receipt_unique
on public.assistant_action_receipts (user_id, receipt_id);

-- Earlier automation schema allowed more than one receipt for a decision.
-- Preserve every historical receipt, but detach all except the newest before
-- enforcing the one-canonical-receipt invariant used by apply and Undo.
with ranked_receipts as (
  select
    receipt_id,
    row_number() over (
      partition by decision_record_id
      order by updated_at desc, created_at desc, receipt_id desc
    ) as receipt_rank
  from public.assistant_action_receipts
  where decision_record_id is not null
)
update public.assistant_action_receipts receipt
set decision_record_id = null,
    updated_at = timezone('utc', now())
from ranked_receipts ranked
where receipt.receipt_id = ranked.receipt_id
  and ranked.receipt_rank > 1;

create unique index if not exists assistant_action_receipts_decision_unique
on public.assistant_action_receipts (decision_record_id)
where decision_record_id is not null;

create table if not exists public.assistant_apply_attempts (
  attempt_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  workflow_id text not null,
  proposal_batch_id text not null,
  idempotency_key text not null,
  timezone_name text not null default 'UTC',
  claim_status text not null default 'finalized' check (claim_status in (
    'in_progress', 'finalized'
  )),
  claim_token text null,
  claim_expires_at timestamptz null,
  automation_mode text not null check (automation_mode in (
    'manual_review', 'manual_batch_apply', 'auto_apply'
  )),
  outcome text not null check (outcome in (
    'not_attempted', 'review_required', 'applied', 'partially_applied',
    'failed_before_write', 'failed_after_write'
  )),
  requested_proposal_ids text[] not null default '{}',
  applied_proposal_ids text[] not null default '{}',
  failed_proposal_ids text[] not null default '{}',
  pending_proposal_ids text[] not null default '{}',
  failure_details jsonb not null default '[]'::jsonb,
  warning_code text null,
  automation_grant_id text null,
  planning_decision_id text null,
  action_receipt_id text null,
  undo_available boolean not null default false,
  undo_unavailable_reason text null,
  authoritative_status text not null check (authoritative_status in (
    'ready_for_review', 'applied', 'applied_with_warning',
    'partially_applied', 'failed'
  )),
  nothing_changed boolean not null default true,
  attempted_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  finalized_at timestamptz null,
  undone_at timestamptz null,
  undo_result jsonb null,
  constraint assistant_apply_attempts_idempotency_unique
    unique (user_id, idempotency_key),
  constraint assistant_apply_attempts_user_attempt_unique
    unique (user_id, attempt_id),
  constraint assistant_apply_attempts_requested_nonempty
    check (cardinality(requested_proposal_ids) > 0),
  constraint assistant_apply_attempts_applied_requested
    check (requested_proposal_ids @> applied_proposal_ids),
  constraint assistant_apply_attempts_failed_requested
    check (requested_proposal_ids @> failed_proposal_ids),
  constraint assistant_apply_attempts_pending_requested
    check (requested_proposal_ids @> pending_proposal_ids),
  constraint assistant_apply_attempts_result_sets_disjoint
    check (
      not (applied_proposal_ids && failed_proposal_ids)
      and not (applied_proposal_ids && pending_proposal_ids)
      and not (failed_proposal_ids && pending_proposal_ids)
    ),
  constraint assistant_apply_attempts_result_sets_complete
    check (
      cardinality(requested_proposal_ids) =
      cardinality(applied_proposal_ids) +
      cardinality(failed_proposal_ids) +
      cardinality(pending_proposal_ids)
    ),
  constraint assistant_apply_attempts_nothing_changed_consistent
    check (nothing_changed = (cardinality(applied_proposal_ids) = 0)),
  constraint assistant_apply_attempts_undo_consistent
    check (
      not undo_available
      or (
        automation_mode = 'auto_apply'
        and authoritative_status in (
          'applied', 'applied_with_warning', 'partially_applied'
        )
        and cardinality(applied_proposal_ids) > 0
        and planning_decision_id is not null
        and undo_unavailable_reason is null
      )
    ),
  constraint assistant_apply_attempts_undo_result_consistent
    check (
      (undone_at is null and undo_result is null)
      or (
        undone_at is not null
        and undo_result is not null
        and not undo_available
      )
    ),
  constraint assistant_apply_attempts_claim_lifecycle_consistent
    check (
      (
        claim_status = 'in_progress'
        and claim_token is not null
        and claim_expires_at is not null
        and finalized_at is null
        and outcome = 'not_attempted'
        and authoritative_status = 'ready_for_review'
        and cardinality(applied_proposal_ids) = 0
        and cardinality(failed_proposal_ids) = 0
        and cardinality(pending_proposal_ids) = cardinality(requested_proposal_ids)
        and nothing_changed
        and not undo_available
      )
      or (
        claim_status = 'finalized'
        and claim_token is null
        and claim_expires_at is null
        and finalized_at is not null
      )
    ),
  constraint assistant_apply_attempts_authoritative_status_consistent
    check (
      (
        authoritative_status = 'ready_for_review'
        and cardinality(applied_proposal_ids) = 0
        and cardinality(pending_proposal_ids) > 0
      )
      or (
        authoritative_status in ('applied', 'applied_with_warning')
        and cardinality(applied_proposal_ids) = cardinality(requested_proposal_ids)
        and cardinality(failed_proposal_ids) = 0
        and cardinality(pending_proposal_ids) = 0
      )
      or (
        authoritative_status = 'partially_applied'
        and cardinality(applied_proposal_ids) > 0
        and (
          cardinality(failed_proposal_ids) > 0
          or cardinality(pending_proposal_ids) > 0
        )
      )
      or (
        authoritative_status = 'failed'
        and cardinality(applied_proposal_ids) = 0
      )
    ),
  constraint assistant_apply_attempts_outcome_consistent
    check (
      (outcome = 'not_attempted' and cardinality(applied_proposal_ids) = 0)
      or (
        outcome = 'review_required'
        and authoritative_status = 'ready_for_review'
      )
      or (
        outcome = 'applied'
        and authoritative_status in ('applied', 'applied_with_warning')
      )
      or (
        outcome = 'partially_applied'
        and authoritative_status = 'partially_applied'
      )
      or (
        outcome = 'failed_before_write'
        and authoritative_status = 'failed'
        and cardinality(applied_proposal_ids) = 0
      )
      or (
        outcome = 'failed_after_write'
        and authoritative_status in ('applied_with_warning', 'partially_applied')
        and cardinality(applied_proposal_ids) > 0
      )
    )
);

-- Existing installations predate the pre-write claim lifecycle. Existing
-- attempts are already finalized; the defaults preserve that meaning.
alter table public.assistant_apply_attempts
add column if not exists claim_status text not null default 'finalized',
add column if not exists claim_token text null,
add column if not exists claim_expires_at timestamptz null,
add column if not exists timezone_name text not null default 'UTC';

alter table public.assistant_apply_attempts
drop constraint if exists assistant_apply_attempts_claim_status_check;
alter table public.assistant_apply_attempts
add constraint assistant_apply_attempts_claim_status_check
check (claim_status in ('in_progress', 'finalized'));

alter table public.assistant_apply_attempts
drop constraint if exists assistant_apply_attempts_claim_lifecycle_consistent;
alter table public.assistant_apply_attempts
add constraint assistant_apply_attempts_claim_lifecycle_consistent
check (
  (
    claim_status = 'in_progress'
    and claim_token is not null
    and claim_expires_at is not null
    and finalized_at is null
    and outcome = 'not_attempted'
    and authoritative_status = 'ready_for_review'
    and cardinality(applied_proposal_ids) = 0
    and cardinality(failed_proposal_ids) = 0
    and cardinality(pending_proposal_ids) = cardinality(requested_proposal_ids)
    and nothing_changed
    and not undo_available
  )
  or (
    claim_status = 'finalized'
    and claim_token is null
    and claim_expires_at is null
    and finalized_at is not null
  )
) not valid;

-- Reserve every proposal, not just an idempotency key. This prevents two
-- different subset requests from concurrently writing the same proposal. A
-- finalized applied proposal retains its owning attempt ID so only that exact
-- attempt may perform crash recovery.
alter table public.assistant_proposals
add column if not exists apply_attempt_id text null,
add column if not exists apply_claim_token text null,
add column if not exists apply_claim_expires_at timestamptz null;

alter table public.assistant_proposals
drop constraint if exists assistant_proposals_apply_claim_consistent;
alter table public.assistant_proposals
add constraint assistant_proposals_apply_claim_consistent check (
  (
    apply_attempt_id is null
    and apply_claim_token is null
    and apply_claim_expires_at is null
  )
  or (
    apply_attempt_id is not null
    and apply_claim_token is not null
    and apply_claim_expires_at is not null
  )
  or (
    apply_attempt_id is not null
    and apply_claim_token is null
    and apply_claim_expires_at is null
    and approval_status = 'applied'
  )
) not valid;

create index if not exists assistant_proposals_apply_claim_idx
on public.assistant_proposals (
  user_id, workflow_id, apply_attempt_id, apply_claim_expires_at
);

create or replace function public.protect_assistant_proposal_apply_claim()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and (
      new.apply_attempt_id is not null
      or new.apply_claim_token is not null
      or new.apply_claim_expires_at is not null
    ) then
      raise exception 'Proposal apply reservations are server-managed';
    end if;
    if tg_op in ('UPDATE', 'DELETE')
      and old.apply_claim_token is not null
      and old.apply_claim_expires_at > timezone('utc', now()) then
      raise exception 'This proposal is reserved by an active apply attempt';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists protect_assistant_proposal_apply_claim
on public.assistant_proposals;
create trigger protect_assistant_proposal_apply_claim
before insert or update or delete on public.assistant_proposals
for each row execute function public.protect_assistant_proposal_apply_claim();

create index if not exists assistant_apply_attempts_user_workflow_created_idx
on public.assistant_apply_attempts (user_id, workflow_id, inserted_at desc);

create index if not exists assistant_apply_attempts_user_batch_created_idx
on public.assistant_apply_attempts (user_id, proposal_batch_id, inserted_at desc);

create unique index if not exists assistant_apply_attempts_decision_unique
on public.assistant_apply_attempts (planning_decision_id)
where planning_decision_id is not null;

create table if not exists public.assistant_applied_records (
  mapping_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  attempt_id text not null,
  workflow_id text not null,
  proposal_batch_id text not null,
  proposal_id text not null,
  planning_decision_id text null,
  record_type text not null check (record_type in ('weekly_plan_block')),
  record_id text not null,
  title text not null,
  scheduled_date date not null,
  start_time time not null,
  end_time time not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  record_version timestamptz not null,
  record_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in (
    'active', 'undone', 'missing'
  )),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  undone_at timestamptz null,
  constraint assistant_applied_records_user_proposal_unique
    unique (user_id, proposal_id),
  constraint assistant_applied_records_user_record_unique
    unique (user_id, record_type, record_id),
  constraint assistant_applied_records_time_range_valid
    check (ends_at > starts_at and end_time > start_time),
  constraint assistant_applied_records_duration_consistent
    check (
      round(extract(epoch from (ends_at - starts_at)) / 60)::integer =
      duration_minutes
    ),
  constraint assistant_applied_records_undo_state_consistent
    check (
      (status = 'undone' and undone_at is not null)
      or (status <> 'undone' and undone_at is null)
    )
);

create index if not exists assistant_applied_records_user_attempt_idx
on public.assistant_applied_records (user_id, attempt_id, inserted_at);

create index if not exists assistant_applied_records_user_decision_idx
on public.assistant_applied_records (user_id, planning_decision_id, inserted_at)
where planning_decision_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_proposal_batches'::regclass
      and conname = 'assistant_proposal_batches_user_workflow_fk'
  ) then
    alter table public.assistant_proposal_batches
    add constraint assistant_proposal_batches_user_workflow_fk
    foreign key (user_id, workflow_id)
    references public.assistant_workflows (user_id, workflow_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_proposals'::regclass
      and conname = 'assistant_proposals_user_workflow_fk'
  ) then
    alter table public.assistant_proposals
    add constraint assistant_proposals_user_workflow_fk
    foreign key (user_id, workflow_id)
    references public.assistant_workflows (user_id, workflow_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_proposals'::regclass
      and conname = 'assistant_proposals_user_batch_fk'
  ) then
    alter table public.assistant_proposals
    add constraint assistant_proposals_user_batch_fk
    foreign key (user_id, batch_id)
    references public.assistant_proposal_batches (user_id, batch_id)
    not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_automation_grants'::regclass
      and conname = 'assistant_automation_grants_user_workflow_fk'
  ) then
    alter table public.assistant_automation_grants
    add constraint assistant_automation_grants_user_workflow_fk
    foreign key (user_id, workflow_id)
    references public.assistant_workflows (user_id, workflow_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_planning_decisions'::regclass
      and conname = 'assistant_planning_decisions_user_workflow_fk'
  ) then
    alter table public.assistant_planning_decisions
    add constraint assistant_planning_decisions_user_workflow_fk
    foreign key (user_id, workflow_id)
    references public.assistant_workflows (user_id, workflow_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_planning_decisions'::regclass
      and conname = 'assistant_planning_decisions_user_grant_fk'
  ) then
    alter table public.assistant_planning_decisions
    add constraint assistant_planning_decisions_user_grant_fk
    foreign key (user_id, grant_id)
    references public.assistant_automation_grants (user_id, grant_id)
    not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_planning_decisions'::regclass
      and conname = 'assistant_planning_decisions_user_batch_fk'
  ) then
    alter table public.assistant_planning_decisions
    add constraint assistant_planning_decisions_user_batch_fk
    foreign key (user_id, proposal_batch_id)
    references public.assistant_proposal_batches (user_id, batch_id)
    not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_action_receipts'::regclass
      and conname = 'assistant_action_receipts_user_decision_fk'
  ) then
    alter table public.assistant_action_receipts
    add constraint assistant_action_receipts_user_decision_fk
    foreign key (user_id, decision_record_id)
    references public.assistant_planning_decisions (user_id, decision_id)
    on delete cascade not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_apply_attempts'::regclass
      and conname = 'assistant_apply_attempts_user_workflow_fk'
  ) then
    alter table public.assistant_apply_attempts
    add constraint assistant_apply_attempts_user_workflow_fk
    foreign key (user_id, workflow_id)
    references public.assistant_workflows (user_id, workflow_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_apply_attempts'::regclass
      and conname = 'assistant_apply_attempts_user_batch_fk'
  ) then
    alter table public.assistant_apply_attempts
    add constraint assistant_apply_attempts_user_batch_fk
    foreign key (user_id, proposal_batch_id)
    references public.assistant_proposal_batches (user_id, batch_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_apply_attempts'::regclass
      and conname = 'assistant_apply_attempts_user_grant_fk'
  ) then
    alter table public.assistant_apply_attempts
    add constraint assistant_apply_attempts_user_grant_fk
    foreign key (user_id, automation_grant_id)
    references public.assistant_automation_grants (user_id, grant_id)
    not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_apply_attempts'::regclass
      and conname = 'assistant_apply_attempts_user_decision_fk'
  ) then
    alter table public.assistant_apply_attempts
    add constraint assistant_apply_attempts_user_decision_fk
    foreign key (user_id, planning_decision_id)
    references public.assistant_planning_decisions (user_id, decision_id)
    not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_apply_attempts'::regclass
      and conname = 'assistant_apply_attempts_user_receipt_fk'
  ) then
    alter table public.assistant_apply_attempts
    add constraint assistant_apply_attempts_user_receipt_fk
    foreign key (user_id, action_receipt_id)
    references public.assistant_action_receipts (user_id, receipt_id)
    not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_planning_decisions'::regclass
      and conname = 'assistant_planning_decisions_user_attempt_fk'
  ) then
    alter table public.assistant_planning_decisions
    add constraint assistant_planning_decisions_user_attempt_fk
    foreign key (user_id, apply_attempt_id)
    references public.assistant_apply_attempts (user_id, attempt_id)
    not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_action_receipts'::regclass
      and conname = 'assistant_action_receipts_user_attempt_fk'
  ) then
    alter table public.assistant_action_receipts
    add constraint assistant_action_receipts_user_attempt_fk
    foreign key (user_id, apply_attempt_id)
    references public.assistant_apply_attempts (user_id, attempt_id)
    not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_applied_records'::regclass
      and conname = 'assistant_applied_records_user_attempt_fk'
  ) then
    alter table public.assistant_applied_records
    add constraint assistant_applied_records_user_attempt_fk
    foreign key (user_id, attempt_id)
    references public.assistant_apply_attempts (user_id, attempt_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_applied_records'::regclass
      and conname = 'assistant_applied_records_user_workflow_fk'
  ) then
    alter table public.assistant_applied_records
    add constraint assistant_applied_records_user_workflow_fk
    foreign key (user_id, workflow_id)
    references public.assistant_workflows (user_id, workflow_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_applied_records'::regclass
      and conname = 'assistant_applied_records_user_batch_fk'
  ) then
    alter table public.assistant_applied_records
    add constraint assistant_applied_records_user_batch_fk
    foreign key (user_id, proposal_batch_id)
    references public.assistant_proposal_batches (user_id, batch_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_applied_records'::regclass
      and conname = 'assistant_applied_records_user_proposal_fk'
  ) then
    alter table public.assistant_applied_records
    add constraint assistant_applied_records_user_proposal_fk
    foreign key (user_id, proposal_id)
    references public.assistant_proposals (user_id, proposal_id)
    on delete cascade not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.assistant_applied_records'::regclass
      and conname = 'assistant_applied_records_user_decision_fk'
  ) then
    alter table public.assistant_applied_records
    add constraint assistant_applied_records_user_decision_fk
    foreign key (user_id, planning_decision_id)
    references public.assistant_planning_decisions (user_id, decision_id)
    not valid;
  end if;
end;
$$;

-- Do not let an authenticated owner erase the authoritative ledger indirectly
-- by deleting a workflow, batch, or proposal through the older FOR ALL parent
-- policies. Account deletion still cascades from auth.users to both sides of
-- these relationships, while ordinary parent deletion is restricted once an
-- apply attempt has been recorded.
alter table public.assistant_apply_attempts
drop constraint if exists assistant_apply_attempts_user_workflow_fk;
alter table public.assistant_apply_attempts
add constraint assistant_apply_attempts_user_workflow_fk
foreign key (user_id, workflow_id)
references public.assistant_workflows (user_id, workflow_id)
not valid;

alter table public.assistant_apply_attempts
drop constraint if exists assistant_apply_attempts_user_batch_fk;
alter table public.assistant_apply_attempts
add constraint assistant_apply_attempts_user_batch_fk
foreign key (user_id, proposal_batch_id)
references public.assistant_proposal_batches (user_id, batch_id)
not valid;

alter table public.assistant_applied_records
drop constraint if exists assistant_applied_records_user_workflow_fk;
alter table public.assistant_applied_records
add constraint assistant_applied_records_user_workflow_fk
foreign key (user_id, workflow_id)
references public.assistant_workflows (user_id, workflow_id)
not valid;

alter table public.assistant_applied_records
drop constraint if exists assistant_applied_records_user_batch_fk;
alter table public.assistant_applied_records
add constraint assistant_applied_records_user_batch_fk
foreign key (user_id, proposal_batch_id)
references public.assistant_proposal_batches (user_id, batch_id)
not valid;

alter table public.assistant_applied_records
drop constraint if exists assistant_applied_records_user_proposal_fk;
alter table public.assistant_applied_records
add constraint assistant_applied_records_user_proposal_fk
foreign key (user_id, proposal_id)
references public.assistant_proposals (user_id, proposal_id)
not valid;

-- Fail closed if an older installation contains cross-owner or dangling rows.
-- NOT VALID keeps each constraint addition low-lock; explicit validation makes
-- a successful migration mean that existing rows, not only future writes,
-- satisfy the authoritative ownership graph.
alter table public.assistant_workflows
validate constraint assistant_workflows_proposal_state_disjoint;
alter table public.assistant_apply_attempts
validate constraint assistant_apply_attempts_claim_lifecycle_consistent;
alter table public.assistant_proposal_batches
validate constraint assistant_proposal_batches_user_workflow_fk;
alter table public.assistant_proposals
validate constraint assistant_proposals_user_workflow_fk;
alter table public.assistant_proposals
validate constraint assistant_proposals_user_batch_fk;
alter table public.assistant_proposals
validate constraint assistant_proposals_apply_claim_consistent;
alter table public.assistant_automation_grants
validate constraint assistant_automation_grants_user_workflow_fk;
alter table public.assistant_planning_decisions
validate constraint assistant_planning_decisions_user_workflow_fk;
alter table public.assistant_planning_decisions
validate constraint assistant_planning_decisions_user_grant_fk;
alter table public.assistant_planning_decisions
validate constraint assistant_planning_decisions_user_batch_fk;
alter table public.assistant_action_receipts
validate constraint assistant_action_receipts_user_decision_fk;
alter table public.assistant_apply_attempts
validate constraint assistant_apply_attempts_user_workflow_fk;
alter table public.assistant_apply_attempts
validate constraint assistant_apply_attempts_user_batch_fk;
alter table public.assistant_apply_attempts
validate constraint assistant_apply_attempts_user_grant_fk;
alter table public.assistant_apply_attempts
validate constraint assistant_apply_attempts_user_decision_fk;
alter table public.assistant_apply_attempts
validate constraint assistant_apply_attempts_user_receipt_fk;
alter table public.assistant_planning_decisions
validate constraint assistant_planning_decisions_user_attempt_fk;
alter table public.assistant_action_receipts
validate constraint assistant_action_receipts_user_attempt_fk;
alter table public.assistant_applied_records
validate constraint assistant_applied_records_user_attempt_fk;
alter table public.assistant_applied_records
validate constraint assistant_applied_records_user_workflow_fk;
alter table public.assistant_applied_records
validate constraint assistant_applied_records_user_batch_fk;
alter table public.assistant_applied_records
validate constraint assistant_applied_records_user_proposal_fk;
alter table public.assistant_applied_records
validate constraint assistant_applied_records_user_decision_fk;

drop trigger if exists set_assistant_apply_attempts_updated_at
on public.assistant_apply_attempts;
create trigger set_assistant_apply_attempts_updated_at
before update on public.assistant_apply_attempts
for each row execute function public.handle_updated_at();

drop trigger if exists set_assistant_applied_records_updated_at
on public.assistant_applied_records;
create trigger set_assistant_applied_records_updated_at
before update on public.assistant_applied_records
for each row execute function public.handle_updated_at();

alter table public.assistant_apply_attempts enable row level security;
alter table public.assistant_applied_records enable row level security;

drop policy if exists "Users manage their assistant apply attempts"
on public.assistant_apply_attempts;
drop policy if exists "Users view their assistant apply attempts"
on public.assistant_apply_attempts;
drop policy if exists "Users insert their assistant apply attempts"
on public.assistant_apply_attempts;
drop policy if exists "Users update their assistant apply attempts"
on public.assistant_apply_attempts;
create policy "Users view their assistant apply attempts"
on public.assistant_apply_attempts for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users manage their assistant applied records"
on public.assistant_applied_records;
drop policy if exists "Users view their assistant applied records"
on public.assistant_applied_records;
drop policy if exists "Users insert their assistant applied records"
on public.assistant_applied_records;
drop policy if exists "Users update their assistant applied records"
on public.assistant_applied_records;
create policy "Users view their assistant applied records"
on public.assistant_applied_records for select
using ((select auth.uid()) = user_id);

-- The authoritative ledger is readable by its owner but may only be mutated by
-- the validating SECURITY DEFINER functions below. Revoking direct DML keeps a
-- browser client from bypassing identity, proposal, and saved-record checks.
revoke insert, update, delete, truncate, references, trigger
on table public.assistant_apply_attempts
from authenticated, anon;
revoke insert, update, delete, truncate, references, trigger
on table public.assistant_applied_records
from authenticated, anon;
grant select on table public.assistant_apply_attempts to authenticated;
grant select on table public.assistant_applied_records to authenticated;

-- Automation permission, decision, and receipt evidence is written only by
-- trusted server routes (service role) or the validated SECURITY DEFINER
-- finalizer/Undo functions. Owners may read their audit trail but a browser
-- cannot forge an active grant or an applied decision.
drop policy if exists "Users manage their assistant automation grants"
on public.assistant_automation_grants;
drop policy if exists "Users view their assistant automation grants"
on public.assistant_automation_grants;
create policy "Users view their assistant automation grants"
on public.assistant_automation_grants for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users manage their assistant planning decisions"
on public.assistant_planning_decisions;
drop policy if exists "Users view their assistant planning decisions"
on public.assistant_planning_decisions;
create policy "Users view their assistant planning decisions"
on public.assistant_planning_decisions for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users manage their assistant action receipts"
on public.assistant_action_receipts;
drop policy if exists "Users view their assistant action receipts"
on public.assistant_action_receipts;
create policy "Users view their assistant action receipts"
on public.assistant_action_receipts for select
using ((select auth.uid()) = user_id);

revoke insert, update, delete, truncate, references, trigger
on table public.assistant_automation_grants
from authenticated, anon;
revoke insert, update, delete, truncate, references, trigger
on table public.assistant_planning_decisions
from authenticated, anon;
revoke insert, update, delete, truncate, references, trigger
on table public.assistant_action_receipts
from authenticated, anon;
grant select on table public.assistant_automation_grants to authenticated;
grant select on table public.assistant_planning_decisions to authenticated;
grant select on table public.assistant_action_receipts to authenticated;

create or replace function public.get_assistant_apply_result(p_attempt_id text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  attempt_row public.assistant_apply_attempts%rowtype;
  decision_row public.assistant_planning_decisions%rowtype;
  applied_rows jsonb;
  reconciled_failures jsonb := '[]'::jsonb;
  generated_failures jsonb := '[]'::jsonb;
  mapped_record_ids text[] := '{}';
  reconciled_applied_ids text[] := '{}';
  generated_failed_ids text[] := '{}';
  reconciled_failed_ids text[] := '{}';
  mapped_count integer := 0;
  live_count integer := 0;
  version_match_count integer := 0;
  undone_count integer := 0;
  changed_count integer := 0;
  external_sync_count integer := 0;
  target_mapping_matches boolean := false;
  calculated_undo_available boolean := false;
  calculated_undo_reason text;
  reconciled_status text;
  reconciled_outcome text;
  reconciled_warning_code text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select * into attempt_row
  from public.assistant_apply_attempts
  where attempt_id = p_attempt_id
    and user_id = current_user_id;

  if attempt_row.attempt_id is null then
    return null;
  end if;
  if attempt_row.claim_status <> 'finalized' then
    return null;
  end if;

  if attempt_row.planning_decision_id is not null then
    select * into decision_row
    from public.assistant_planning_decisions
    where user_id = current_user_id
      and decision_id = attempt_row.planning_decision_id;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where block.block_id is not null
        and block.scheduled_date is not null
        and block.start_time is not null
        and mapping.status = 'active'
    )::integer,
    count(*) filter (
      where block.block_id is not null
        and block.scheduled_date is not null
        and block.start_time is not null
        and mapping.status = 'active'
        and block.updated_at = mapping.record_version
    )::integer,
    count(*) filter (where mapping.status = 'undone')::integer,
    coalesce(
      array_agg(mapping.record_id order by mapping.starts_at, mapping.proposal_id),
      '{}'::text[]
    ),
    coalesce(
      array_agg(mapping.proposal_id order by mapping.starts_at, mapping.proposal_id)
      filter (
        where block.block_id is not null
          and block.scheduled_date is not null
          and block.start_time is not null
          and mapping.status = 'active'
      ),
      '{}'::text[]
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'proposalId', mapping.proposal_id,
          'recordId', mapping.record_id,
          'recordType', mapping.record_type,
          'title', block.project_name,
          'date', block.scheduled_date::text,
          'startTime', left(block.start_time::text, 5),
          'endTime', left(
            (block.start_time + make_interval(
              mins => round(block.estimated_hours * 60)::integer
            ))::text,
            5
          ),
          'startsAt', (
            block.scheduled_date + block.start_time
          ) at time zone attempt_row.timezone_name,
          'endsAt', (
            block.scheduled_date + block.start_time + make_interval(
              mins => round(block.estimated_hours * 60)::integer
            )
          ) at time zone attempt_row.timezone_name,
          'durationMinutes', round(block.estimated_hours * 60)::integer,
          'version', block.updated_at,
          'recordExists', true,
          'recordMatchesVersion',
            block.updated_at = mapping.record_version,
          'status', mapping.status,
          'savedRecord', jsonb_build_object(
            'blockId', block.block_id,
            'projectName', block.project_name,
            'plannedTask', block.planned_task,
            'estimatedHours', block.estimated_hours,
            'startTime', block.start_time,
            'scheduledDate', block.scheduled_date,
            'seriesId', block.series_id,
            'updatedAt', block.updated_at
          )
        )
        order by mapping.starts_at, mapping.proposal_id
      ) filter (
        where block.block_id is not null
          and block.scheduled_date is not null
          and block.start_time is not null
          and mapping.status = 'active'
      ),
      '[]'::jsonb
    )
  into
    mapped_count,
    live_count,
    version_match_count,
    undone_count,
    mapped_record_ids,
    reconciled_applied_ids,
    applied_rows
  from public.assistant_applied_records mapping
  left join public.weekly_plan_blocks block
    on block.user_id = mapping.user_id
   and block.block_id = mapping.record_id
  where mapping.user_id = current_user_id
    and mapping.attempt_id = attempt_row.attempt_id;

  changed_count := live_count - version_match_count;

  select
    coalesce(array_agg(original_proposal_id), '{}'::text[]),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'proposalId', original_proposal_id,
          'code', case
            when mapping.proposal_id is null then 'saved_record_mapping_missing'
            when mapping.status = 'undone' then 'saved_record_undone'
            when block.block_id is null then 'saved_record_missing'
            when block.scheduled_date is null or block.start_time is null
              then 'saved_record_no_longer_timed'
            else 'saved_record_invalid'
          end,
          'safeMessage', case
            when mapping.proposal_id is null
              then 'The saved Weekly Plan record mapping is missing.'
            when mapping.status = 'undone'
              then 'The saved Weekly Plan record was undone.'
            when block.block_id is null
              then 'The saved Weekly Plan record no longer exists.'
            when block.scheduled_date is null or block.start_time is null
              then 'The saved Weekly Plan record is no longer a valid timed block.'
            else 'The saved Weekly Plan record could not be verified.'
          end
        )
        order by original_proposal_id
      ),
      '[]'::jsonb
    )
  into generated_failed_ids, generated_failures
  from unnest(attempt_row.applied_proposal_ids)
    as original_records(original_proposal_id)
  left join public.assistant_applied_records mapping
    on mapping.user_id = current_user_id
   and mapping.attempt_id = attempt_row.attempt_id
   and mapping.proposal_id = original_proposal_id
  left join public.weekly_plan_blocks block
    on block.user_id = mapping.user_id
   and block.block_id = mapping.record_id
  where mapping.proposal_id is null
    or mapping.status <> 'active'
    or block.block_id is null
    or block.scheduled_date is null
    or block.start_time is null;

  reconciled_failed_ids :=
    attempt_row.failed_proposal_ids || generated_failed_ids;
  reconciled_failures := attempt_row.failure_details || generated_failures;
  reconciled_warning_code := case
    when cardinality(generated_failed_ids) > 0 then 'saved_records_missing'
    when changed_count > 0 then 'saved_records_changed'
    else attempt_row.warning_code
  end;
  reconciled_status := case
    when live_count > 0 and (
      cardinality(reconciled_failed_ids) > 0
      or cardinality(attempt_row.pending_proposal_ids) > 0
    ) then 'partially_applied'
    when live_count > 0 and reconciled_warning_code is not null
      then 'applied_with_warning'
    when live_count > 0 then 'applied'
    when cardinality(reconciled_failed_ids) = 0
      and cardinality(attempt_row.pending_proposal_ids) > 0
      then 'ready_for_review'
    else 'failed'
  end;
  reconciled_outcome := case
    when reconciled_status = 'partially_applied' then 'partially_applied'
    when reconciled_status = 'ready_for_review' then 'review_required'
    when live_count > 0 then 'applied'
    when cardinality(attempt_row.applied_proposal_ids) > 0
      then 'failed_after_write'
    else 'failed_before_write'
  end;

  target_mapping_matches :=
    decision_row.decision_id is not null
    and cardinality(coalesce(decision_row.target_record_ids, '{}'::text[])) =
      cardinality(mapped_record_ids)
    and coalesce(decision_row.target_record_ids, '{}'::text[]) @> mapped_record_ids
    and mapped_record_ids @> coalesce(decision_row.target_record_ids, '{}'::text[]);

  if to_regclass('public.google_calendar_synced_events') is not null
    and cardinality(mapped_record_ids) > 0 then
    execute $query$
      select count(*)::integer
      from public.google_calendar_synced_events
      where user_id = $1
        and weekly_plan_block_id = any($2)
    $query$
    into external_sync_count
    using current_user_id, mapped_record_ids;
  end if;

  calculated_undo_available :=
    attempt_row.undo_available
    and attempt_row.automation_mode = 'auto_apply'
    and attempt_row.authoritative_status in (
      'applied', 'applied_with_warning', 'partially_applied'
    )
    and decision_row.decision_id is not null
    and decision_row.automation_mode in ('auto_apply', 'auto_applied')
    and decision_row.status in ('applied', 'partially_applied')
    and decision_row.reversed_at is null
    and decision_row.reversible_until is not null
    and decision_row.reversible_until >= timezone('utc', now())
    and mapped_count > 0
    and mapped_count = cardinality(attempt_row.applied_proposal_ids)
    and live_count = mapped_count
    and version_match_count = mapped_count
    and undone_count = 0
    and target_mapping_matches
    and external_sync_count = 0;

  calculated_undo_reason := case
    when calculated_undo_available then null
    when not attempt_row.undo_available then coalesce(
      attempt_row.undo_unavailable_reason,
      'Undo was not recorded as available for this apply attempt.'
    )
    when attempt_row.automation_mode <> 'auto_apply'
      then 'Only automatically applied Schedule Builder changes can be undone here.'
    when decision_row.decision_id is null
      then 'The planning decision could not be verified.'
    when decision_row.status = 'undone' or decision_row.reversed_at is not null
      then 'This action was already undone.'
    when decision_row.status not in ('applied', 'partially_applied')
      then 'The planning decision is no longer reversible.'
    when decision_row.reversible_until is null
      then 'No valid Undo window was recorded.'
    when decision_row.reversible_until < timezone('utc', now())
      then 'The Undo window has expired.'
    when mapped_count = 0
      then 'No reversible Weekly Plan records were mapped.'
    when mapped_count <> cardinality(attempt_row.applied_proposal_ids)
      then 'The saved-record mapping is incomplete.'
    when live_count <> mapped_count
      then 'One or more created Weekly Plan records no longer exist.'
    when version_match_count <> mapped_count
      then 'One or more created Weekly Plan records changed after application.'
    when undone_count > 0
      then 'One or more created Weekly Plan records were already undone.'
    when not target_mapping_matches
      then 'The planning decision does not exactly match the created records.'
    when external_sync_count > 0
      then 'Undo is unavailable after a record has been sent to Google Calendar.'
    else 'Undo could not be safely validated.'
  end;

  return jsonb_build_object(
    'userId', attempt_row.user_id,
    'workflowId', attempt_row.workflow_id,
    'proposalBatchId', attempt_row.proposal_batch_id,
    'attemptId', attempt_row.attempt_id,
    'idempotencyKey', attempt_row.idempotency_key,
    'timezone', attempt_row.timezone_name,
    'outcome', reconciled_outcome,
    'automationMode', attempt_row.automation_mode,
    'requestedProposalIds', attempt_row.requested_proposal_ids,
    'applied', applied_rows,
    'appliedProposalIds', reconciled_applied_ids,
    'originalAppliedProposalIds', attempt_row.applied_proposal_ids,
    'failedProposalIds', reconciled_failed_ids,
    'failed', reconciled_failures,
    'warningCode', reconciled_warning_code,
    'pendingProposalIds', attempt_row.pending_proposal_ids,
    'automationGrantId', attempt_row.automation_grant_id,
    'planningDecisionId', attempt_row.planning_decision_id,
    'actionReceiptId', attempt_row.action_receipt_id,
    'undoAvailable', calculated_undo_available,
    'undoUnavailableReason', calculated_undo_reason,
    'recordedUndoAvailable', attempt_row.undo_available,
    'authoritativeStatus', reconciled_status,
    'nothingChanged', live_count = 0,
    'integrityStatus', case
      when mapped_count <> cardinality(attempt_row.applied_proposal_ids)
        then 'needs_reconciliation'
      when mapped_count > 0 and undone_count = mapped_count and live_count = 0
        then 'undone'
      when live_count <> mapped_count
        then 'missing_saved_records'
      when version_match_count <> live_count
        then 'saved_records_changed'
      else 'consistent'
    end,
    'mappedRecordCount', mapped_count,
    'liveRecordCount', live_count,
    'versionMatchCount', version_match_count,
    'externallySyncedRecordCount', external_sync_count,
    'decisionStatus', decision_row.status,
    'decisionAutomationMode', decision_row.automation_mode,
    'decisionTargetRecordIds', coalesce(
      decision_row.target_record_ids,
      '{}'::text[]
    ),
    'decisionReversedAt', decision_row.reversed_at,
    'reversibleUntil', decision_row.reversible_until,
    'targetMappingMatches', target_mapping_matches,
    'attemptedAt', attempt_row.attempted_at,
    'finalizedAt', attempt_row.finalized_at,
    'undoneAt', attempt_row.undone_at,
    'undoResult', attempt_row.undo_result,
    'updatedAt', attempt_row.updated_at,
    'evaluatedAt', timezone('utc', now())
  );
end;
$$;

revoke execute on function public.get_assistant_apply_result(text) from public;
grant execute on function public.get_assistant_apply_result(text) to authenticated;

create or replace function public.get_latest_assistant_apply_result(
  p_workflow_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select public.get_assistant_apply_result(attempt.attempt_id)
  from public.assistant_apply_attempts attempt
  where attempt.workflow_id = p_workflow_id
    and attempt.user_id = (select auth.uid())
    and attempt.claim_status = 'finalized'
  order by attempt.inserted_at desc
  limit 1;
$$;

revoke execute on function public.get_latest_assistant_apply_result(text) from public;
grant execute on function public.get_latest_assistant_apply_result(text) to authenticated;

create or replace function public.get_assistant_workflow_apply_results(
  p_workflow_id text
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      public.get_assistant_apply_result(attempt.attempt_id)
      order by attempt.finalized_at, attempt.inserted_at, attempt.attempt_id
    ),
    '[]'::jsonb
  )
  from public.assistant_apply_attempts attempt
  where attempt.workflow_id = p_workflow_id
    and attempt.user_id = (select auth.uid())
    and attempt.claim_status = 'finalized';
$$;

revoke execute on function public.get_assistant_workflow_apply_results(text)
from public;
grant execute on function public.get_assistant_workflow_apply_results(text)
to authenticated;

create or replace function public.get_assistant_apply_result_by_idempotency_key(
  p_idempotency_key text
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select public.get_assistant_apply_result(attempt.attempt_id)
  from public.assistant_apply_attempts attempt
  where attempt.idempotency_key = p_idempotency_key
    and attempt.user_id = (select auth.uid())
    and attempt.claim_status = 'finalized'
  limit 1;
$$;

revoke execute on function public.get_assistant_apply_result_by_idempotency_key(text)
from public;
grant execute on function public.get_assistant_apply_result_by_idempotency_key(text)
to authenticated;

create or replace function public.claim_assistant_apply_attempt(p_claim jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  supplied_user_id uuid;
  attempt_key text := nullif(p_claim->>'attempt_id', '');
  workflow_key text := nullif(p_claim->>'workflow_id', '');
  batch_key text := nullif(p_claim->>'proposal_batch_id', '');
  idempotency_key_value text := nullif(p_claim->>'idempotency_key', '');
  claim_token_value text := nullif(p_claim->>'claim_token', '');
  automation_mode_value text := nullif(p_claim->>'automation_mode', '');
  automation_grant_key text := nullif(p_claim->>'automation_grant_id', '');
  timezone_value text := nullif(p_claim->>'timezone', '');
  requested_ids text[];
  existing_attempt public.assistant_apply_attempts%rowtype;
  attempt_exists boolean := false;
  proposal_count integer := 0;
  distinct_count integer := 0;
  grant_count integer := 0;
  timezone_count integer := 0;
  blocking_attempt_id text;
  blocking_claim_expires_at timestamptz;
  blocking_approval_status text;
  claim_deadline timestamptz := timezone('utc', now()) + interval '5 minutes';
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if jsonb_typeof(p_claim) <> 'object'
    or jsonb_typeof(p_claim->'requested_proposal_ids') <> 'array' then
    raise exception 'The apply claim payload is invalid';
  end if;
  begin
    supplied_user_id := (p_claim->>'user_id')::uuid;
  exception when others then
    raise exception 'The apply claim owner is invalid';
  end;
  if supplied_user_id is null or supplied_user_id <> current_user_id then
    raise exception 'Assistant apply ownership check failed';
  end if;
  if attempt_key is null
    or workflow_key is null
    or batch_key is null
    or idempotency_key_value is null
    or claim_token_value is null
    or timezone_value is null then
    raise exception 'The apply claim identity is incomplete';
  end if;
  if automation_mode_value not in (
    'manual_review', 'manual_batch_apply', 'auto_apply'
  ) then
    raise exception 'The apply claim mode is invalid';
  end if;
  select count(*)::integer into timezone_count
  from pg_timezone_names
  where name = timezone_value;
  if timezone_count <> 1 then
    raise exception 'The apply claim timezone is invalid';
  end if;

  requested_ids := array(
    select value
    from jsonb_array_elements_text(p_claim->'requested_proposal_ids') value
  );
  if cardinality(requested_ids) = 0 then
    raise exception 'At least one requested proposal is required';
  end if;
  select count(*) into distinct_count
  from (select distinct unnest(requested_ids)) unique_requested;
  if distinct_count <> cardinality(requested_ids) then
    raise exception 'Requested proposal IDs must be unique';
  end if;

  -- Serialize every apply/Undo mutation for this owner and workflow before
  -- taking row locks. Different subset requests have different idempotency
  -- keys but can still overlap on proposals, so the workflow lock prevents a
  -- workflow -> proposal / attempt -> workflow deadlock cycle.
  perform pg_advisory_xact_lock(
    hashtextextended(
      current_user_id::text || ':assistant-workflow:' || workflow_key,
      0
    )
  );

  -- Keep retries for the same logical request serialized as well.
  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || idempotency_key_value, 0)
  );

  perform 1
  from public.assistant_workflows workflow
  where workflow.user_id = current_user_id
    and workflow.workflow_id = workflow_key
  for update;
  if not found then
    raise exception 'The Assistant workflow could not be verified';
  end if;

  perform 1
  from public.assistant_proposal_batches batch
  where batch.user_id = current_user_id
    and batch.workflow_id = workflow_key
    and batch.batch_id = batch_key
  for update;
  if not found then
    raise exception 'The Assistant proposal batch could not be verified';
  end if;

  perform 1
  from public.assistant_proposals proposal
  where proposal.user_id = current_user_id
    and proposal.workflow_id = workflow_key
    and proposal.batch_id = batch_key
    and proposal.proposal_id = any(requested_ids)
  order by proposal.proposal_id
  for update;

  select count(*)::integer into proposal_count
  from public.assistant_proposals proposal
  where proposal.user_id = current_user_id
    and proposal.workflow_id = workflow_key
    and proposal.batch_id = batch_key
    and proposal.proposal_id = any(requested_ids);
  if proposal_count <> cardinality(requested_ids) then
    raise exception 'One or more requested proposals do not belong to this workflow batch';
  end if;

  select * into existing_attempt
  from public.assistant_apply_attempts attempt
  where attempt.user_id = current_user_id
    and attempt.idempotency_key = idempotency_key_value
  for update;
  attempt_exists := found;

  if attempt_exists then
    if existing_attempt.workflow_id <> workflow_key
      or existing_attempt.proposal_batch_id <> batch_key
      or existing_attempt.attempt_id <> attempt_key
      or existing_attempt.automation_mode <> automation_mode_value
      or existing_attempt.timezone_name <> timezone_value
      or existing_attempt.automation_grant_id is distinct from
        automation_grant_key
      or cardinality(existing_attempt.requested_proposal_ids) <>
        cardinality(requested_ids)
      or not (existing_attempt.requested_proposal_ids @> requested_ids)
      or not (requested_ids @> existing_attempt.requested_proposal_ids) then
      raise exception 'The idempotency key belongs to a different apply request';
    end if;
    if existing_attempt.claim_status = 'finalized' then
      return jsonb_build_object(
        'status', 'finalized',
        'attemptId', existing_attempt.attempt_id,
        'result', public.get_assistant_apply_result(existing_attempt.attempt_id)
      );
    end if;
  end if;

  if automation_mode_value = 'auto_apply' then
    if automation_grant_key is null then
      raise exception 'Automatic application requires a verified grant';
    end if;
    select count(*)::integer into grant_count
    from public.assistant_automation_grants grant_record
    where grant_record.user_id = current_user_id
      and grant_record.workflow_id = workflow_key
      and grant_record.grant_id = automation_grant_key
      and (
        (
          grant_record.status = 'active'
          and (
            grant_record.expires_at is null
            or grant_record.expires_at > timezone('utc', now())
          )
        )
        or (
          grant_record.status = 'consumed'
          and exists (
            select 1
            from public.assistant_apply_attempts recovery_attempt
            where recovery_attempt.user_id = current_user_id
              and recovery_attempt.idempotency_key = idempotency_key_value
              and recovery_attempt.claim_status = 'in_progress'
              and recovery_attempt.automation_grant_id = automation_grant_key
          )
        )
      );
    if grant_count <> 1 then
      raise exception 'The automation grant could not be verified';
    end if;
  elsif automation_grant_key is not null then
    raise exception 'A manual apply claim cannot use an automation grant';
  end if;

  select
    proposal.apply_attempt_id,
    proposal.apply_claim_expires_at,
    proposal.approval_status
  into
    blocking_attempt_id,
    blocking_claim_expires_at,
    blocking_approval_status
  from public.assistant_proposals proposal
  where proposal.user_id = current_user_id
    and proposal.workflow_id = workflow_key
    and proposal.batch_id = batch_key
    and proposal.proposal_id = any(requested_ids)
    and proposal.apply_attempt_id is not null
    and proposal.apply_attempt_id <> attempt_key
    and (
      proposal.approval_status = 'applied'
      or proposal.apply_claim_expires_at > timezone('utc', now())
    )
  order by proposal.proposal_id
  limit 1;

  if blocking_attempt_id is not null then
    if blocking_approval_status = 'applied' then
      raise exception 'An applied proposal belongs to a different apply attempt';
    end if;
    return jsonb_build_object(
      'status', 'in_progress',
      'attemptId', attempt_key,
      'blockingAttemptId', blocking_attempt_id,
      'claimExpiresAt', blocking_claim_expires_at
    );
  end if;

  select count(*)::integer into proposal_count
  from public.assistant_proposals proposal
  where proposal.user_id = current_user_id
    and proposal.workflow_id = workflow_key
    and proposal.batch_id = batch_key
    and proposal.proposal_id = any(requested_ids)
    and (
      (
        proposal.approval_status in ('pending', 'approved')
        and (
          proposal.apply_attempt_id is null
          or proposal.apply_attempt_id = attempt_key
          or proposal.apply_claim_expires_at <= timezone('utc', now())
        )
      )
      or (
        proposal.approval_status = 'applied'
        and proposal.apply_attempt_id = attempt_key
      )
    );
  if proposal_count <> cardinality(requested_ids) then
    raise exception 'One or more requested proposals cannot be reserved for this apply attempt';
  end if;

  if attempt_exists then
    if existing_attempt.claim_expires_at > timezone('utc', now()) then
      return jsonb_build_object(
        'status', 'in_progress',
        'attemptId', existing_attempt.attempt_id,
        'claimExpiresAt', existing_attempt.claim_expires_at
      );
    end if;

    -- A timed-out worker may have stopped at any point. A new owner can recover
    -- the same logical attempt; deterministic record IDs make existing writes
    -- observable instead of duplicated.
    update public.assistant_apply_attempts
    set claim_token = claim_token_value,
        claim_expires_at = claim_deadline,
        automation_mode = automation_mode_value,
        automation_grant_id = automation_grant_key,
        timezone_name = timezone_value,
        attempted_at = timezone('utc', now())
    where user_id = current_user_id
      and attempt_id = attempt_key
      and claim_status = 'in_progress';
  else
    insert into public.assistant_apply_attempts (
      attempt_id,
      user_id,
      workflow_id,
      proposal_batch_id,
      idempotency_key,
      timezone_name,
      claim_status,
      claim_token,
      claim_expires_at,
      automation_mode,
      outcome,
      requested_proposal_ids,
      applied_proposal_ids,
      failed_proposal_ids,
      pending_proposal_ids,
      failure_details,
      automation_grant_id,
      undo_available,
      authoritative_status,
      nothing_changed,
      attempted_at,
      inserted_at,
      finalized_at
    ) values (
      attempt_key,
      current_user_id,
      workflow_key,
      batch_key,
      idempotency_key_value,
      timezone_value,
      'in_progress',
      claim_token_value,
      claim_deadline,
      automation_mode_value,
      'not_attempted',
      requested_ids,
      '{}',
      '{}',
      requested_ids,
      '[]'::jsonb,
      automation_grant_key,
      false,
      'ready_for_review',
      true,
      timezone('utc', now()),
      timezone('utc', now()),
      null
    );
  end if;

  update public.assistant_proposals
  set apply_attempt_id = attempt_key,
      apply_claim_token = claim_token_value,
      apply_claim_expires_at = claim_deadline,
      updated_at = timezone('utc', now())
  where user_id = current_user_id
    and workflow_id = workflow_key
    and batch_id = batch_key
    and proposal_id = any(requested_ids);
  get diagnostics proposal_count = row_count;
  if proposal_count <> cardinality(requested_ids) then
    raise exception 'The proposal reservation changed during apply claim';
  end if;

  update public.assistant_workflows
  set state = 'applying',
      last_updated_at = timezone('utc', now())
  where user_id = current_user_id
    and workflow_id = workflow_key;

  return jsonb_build_object(
    'status', 'claimed',
    'attemptId', attempt_key,
    'claimExpiresAt', claim_deadline
  );
end;
$$;

revoke execute on function public.claim_assistant_apply_attempt(jsonb) from public;
grant execute on function public.claim_assistant_apply_attempt(jsonb) to authenticated;

create or replace function public.release_assistant_apply_claim(
  p_attempt_id text,
  p_claim_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  released_count integer := 0;
  workflow_key text;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if nullif(p_attempt_id, '') is null or nullif(p_claim_token, '') is null then
    return false;
  end if;

  select workflow_id into workflow_key
  from public.assistant_apply_attempts
  where user_id = current_user_id
    and attempt_id = p_attempt_id
    and claim_status = 'in_progress'
    and claim_token = p_claim_token;
  if workflow_key is null then
    return false;
  end if;

  update public.assistant_proposals
  set apply_attempt_id = null,
      apply_claim_token = null,
      apply_claim_expires_at = null,
      updated_at = timezone('utc', now())
  where user_id = current_user_id
    and apply_attempt_id = p_attempt_id
    and apply_claim_token = p_claim_token;

  delete from public.assistant_apply_attempts
  where user_id = current_user_id
    and attempt_id = p_attempt_id
    and claim_status = 'in_progress'
    and claim_token = p_claim_token;
  get diagnostics released_count = row_count;
  if released_count = 1 then
    update public.assistant_workflows
    set state = case
          when cardinality(applied_proposal_ids) > 0
            and cardinality(pending_proposal_ids) > 0
            then 'partially_applied'
          when cardinality(applied_proposal_ids) > 0 then 'applied'
          when cardinality(pending_proposal_ids) > 0 then 'awaiting_approval'
          else 'failed'
        end,
        completion_status = case
          when cardinality(applied_proposal_ids) > 0 then 'records_applied'
          when cardinality(pending_proposal_ids) > 0 then 'proposal_created'
          else 'nothing_created'
        end,
        last_updated_at = timezone('utc', now())
    where user_id = current_user_id
      and workflow_id = workflow_key
      and state = 'applying';
  end if;
  return released_count = 1;
end;
$$;

revoke execute on function public.release_assistant_apply_claim(text, text)
from public;
grant execute on function public.release_assistant_apply_claim(text, text)
to authenticated;

create or replace function public.persist_assistant_apply_result(
  p_attempt jsonb,
  p_records jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  supplied_user_id uuid;
  attempt_key text := nullif(p_attempt->>'attempt_id', '');
  workflow_key text := nullif(p_attempt->>'workflow_id', '');
  batch_key text := nullif(p_attempt->>'proposal_batch_id', '');
  idempotency_key_value text := nullif(p_attempt->>'idempotency_key', '');
  claim_token_value text := nullif(p_attempt->>'claim_token', '');
  timezone_value text := nullif(p_attempt->>'timezone', '');
  requested_ids text[];
  applied_ids text[];
  failed_ids text[];
  pending_ids text[];
  record_proposal_ids text[];
  record_ids text[];
  existing_attempt public.assistant_apply_attempts%rowtype;
  proposal_count integer := 0;
  verified_record_count integer := 0;
  inserted_mapping_count integer := 0;
  proposal_update_count integer := 0;
  distinct_count integer := 0;
  grant_count integer := 0;
  decision_count integer := 0;
  receipt_count integer := 0;
  workflow_applied_ids text[] := '{}';
  workflow_pending_ids text[] := '{}';
  batch_proposal_count integer := 0;
  batch_applied_count integer := 0;
  batch_pending_count integer := 0;
  warning_code_value text := nullif(p_attempt->>'warning_code', '');
  timezone_count integer := 0;
begin
  -- This function finalizes the result ledger in one transaction. The caller
  -- must create Weekly Plan rows through the canonical apply path first; each
  -- supplied mapping is re-read and matched exactly before anything is stored.
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if jsonb_typeof(p_attempt) <> 'object'
    or jsonb_typeof(p_records) <> 'array' then
    raise exception 'The authoritative apply payload is invalid';
  end if;

  begin
    supplied_user_id := (p_attempt->>'user_id')::uuid;
  exception when others then
    raise exception 'The authoritative apply owner is invalid';
  end;
  if supplied_user_id is null or supplied_user_id <> current_user_id then
    raise exception 'Assistant apply ownership check failed';
  end if;
  if attempt_key is null
    or workflow_key is null
    or batch_key is null
    or idempotency_key_value is null
    or claim_token_value is null
    or timezone_value is null then
    raise exception 'The authoritative apply identity is incomplete';
  end if;
  select count(*)::integer into timezone_count
  from pg_timezone_names
  where name = timezone_value;
  if timezone_count <> 1 then
    raise exception 'The authoritative apply timezone is invalid';
  end if;

  if jsonb_typeof(p_attempt->'requested_proposal_ids') <> 'array'
    or jsonb_typeof(p_attempt->'applied_proposal_ids') <> 'array'
    or jsonb_typeof(p_attempt->'failed_proposal_ids') <> 'array'
    or jsonb_typeof(p_attempt->'pending_proposal_ids') <> 'array'
    or jsonb_typeof(p_attempt->'failure_details') <> 'array' then
    raise exception 'The authoritative apply result buckets are invalid';
  end if;

  requested_ids := array(
    select value
    from jsonb_array_elements_text(p_attempt->'requested_proposal_ids') value
  );
  applied_ids := array(
    select value
    from jsonb_array_elements_text(p_attempt->'applied_proposal_ids') value
  );
  failed_ids := array(
    select value
    from jsonb_array_elements_text(p_attempt->'failed_proposal_ids') value
  );
  pending_ids := array(
    select value
    from jsonb_array_elements_text(p_attempt->'pending_proposal_ids') value
  );

  if cardinality(requested_ids) = 0 then
    raise exception 'At least one requested proposal is required';
  end if;
  select count(*) into distinct_count
  from (select distinct unnest(requested_ids)) unique_requested;
  if distinct_count <> cardinality(requested_ids) then
    raise exception 'Requested proposal IDs must be unique';
  end if;
  select count(*) into distinct_count
  from (
    select distinct proposal_id
    from unnest(applied_ids || failed_ids || pending_ids) proposal_id
  ) unique_results;
  if distinct_count <> cardinality(requested_ids)
    or cardinality(applied_ids) + cardinality(failed_ids) + cardinality(pending_ids)
      <> cardinality(requested_ids)
    or not (requested_ids @> applied_ids)
    or not (requested_ids @> failed_ids)
    or not (requested_ids @> pending_ids) then
    raise exception 'Every requested proposal must have exactly one final result';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      current_user_id::text || ':assistant-workflow:' || workflow_key,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended(current_user_id::text || ':' || idempotency_key_value, 0)
  );

  select * into existing_attempt
  from public.assistant_apply_attempts attempt
  where attempt.user_id = current_user_id
    and attempt.idempotency_key = idempotency_key_value
  for update;
  if not found then
    raise exception 'A pre-write apply claim is required';
  end if;
  if existing_attempt.workflow_id <> workflow_key
    or existing_attempt.proposal_batch_id <> batch_key
    or existing_attempt.attempt_id <> attempt_key
    or existing_attempt.automation_mode <> p_attempt->>'automation_mode'
    or existing_attempt.timezone_name <> timezone_value
    or existing_attempt.automation_grant_id is distinct from
      nullif(p_attempt->>'automation_grant_id', '')
    or cardinality(existing_attempt.requested_proposal_ids) <>
      cardinality(requested_ids)
    or not (existing_attempt.requested_proposal_ids @> requested_ids)
    or not (requested_ids @> existing_attempt.requested_proposal_ids) then
    raise exception 'The idempotency key belongs to a different apply request';
  end if;
  if existing_attempt.claim_status = 'finalized' then
    return public.get_assistant_apply_result(existing_attempt.attempt_id);
  end if;
  if existing_attempt.claim_token <> claim_token_value then
    raise exception 'The apply claim is owned by another request';
  end if;

  perform 1
  from public.assistant_workflows workflow
  where workflow.user_id = current_user_id
    and workflow.workflow_id = workflow_key
  for update;
  if not found then
    raise exception 'The Assistant workflow could not be verified';
  end if;

  perform 1
  from public.assistant_proposal_batches batch
  where batch.user_id = current_user_id
    and batch.workflow_id = workflow_key
    and batch.batch_id = batch_key
  for update;
  if not found then
    raise exception 'The Assistant proposal batch could not be verified';
  end if;

  perform 1
  from public.assistant_proposals proposal
  where proposal.user_id = current_user_id
    and proposal.workflow_id = workflow_key
    and proposal.batch_id = batch_key
    and proposal.proposal_id = any(requested_ids)
  order by proposal.proposal_id
  for update;

  select count(*)::integer into proposal_count
  from public.assistant_proposals proposal
  where proposal.user_id = current_user_id
    and proposal.workflow_id = workflow_key
    and proposal.batch_id = batch_key
    and proposal.proposal_id = any(requested_ids)
    and (
      (
        proposal.proposal_id = any(applied_ids)
        and proposal.approval_status in ('pending', 'approved', 'applied')
      )
      or (
        proposal.proposal_id = any(failed_ids || pending_ids)
        and proposal.approval_status in ('pending', 'approved')
      )
    )
    and proposal.apply_attempt_id = attempt_key
    and proposal.apply_claim_token = claim_token_value;
  if proposal_count <> cardinality(requested_ids) then
    raise exception 'One or more requested proposals changed before finalization';
  end if;

  record_proposal_ids := array(
    select item->>'proposal_id'
    from jsonb_array_elements(p_records) item
  );
  record_ids := array(
    select item->>'record_id'
    from jsonb_array_elements(p_records) item
  );
  if cardinality(record_proposal_ids) <> cardinality(applied_ids)
    or not (record_proposal_ids @> applied_ids)
    or not (applied_ids @> record_proposal_ids)
    or exists (
      select 1
      from jsonb_array_elements(p_records) item
      where jsonb_typeof(item) <> 'object'
        or nullif(item->>'proposal_id', '') is null
        or nullif(item->>'record_id', '') is null
        or item->>'record_type' <> 'weekly_plan_block'
        or nullif(item->>'title', '') is null
        or nullif(item->>'date', '') is null
        or nullif(item->>'start_time', '') is null
        or nullif(item->>'end_time', '') is null
        or nullif(item->>'starts_at', '') is null
        or nullif(item->>'ends_at', '') is null
        or coalesce((item->>'duration_minutes')::integer, 0) <= 0
    ) then
    raise exception 'The applied-record mapping is incomplete';
  end if;
  select count(*) into distinct_count
  from (select distinct unnest(record_proposal_ids)) unique_records;
  if distinct_count <> cardinality(record_proposal_ids) then
    raise exception 'Each applied proposal must map to exactly one saved record';
  end if;
  select count(*) into distinct_count
  from (select distinct unnest(record_ids)) unique_record_ids;
  if distinct_count <> cardinality(record_ids) then
    raise exception 'Each saved record may map to only one applied proposal';
  end if;

  -- Keep verification and mapping insertion on the same row versions. Without
  -- these locks, a concurrent edit/delete could land between the verification
  -- SELECT and INSERT ... SELECT and produce a stale or incomplete ledger.
  perform 1
  from public.weekly_plan_blocks block
  where block.user_id = current_user_id
    and block.block_id = any(record_ids)
  order by block.block_id
  for update;

  select count(*)::integer into verified_record_count
  from jsonb_array_elements(p_records) item
  join public.assistant_proposals proposal
    on proposal.user_id = current_user_id
   and proposal.workflow_id = workflow_key
   and proposal.batch_id = batch_key
   and proposal.proposal_id = item->>'proposal_id'
   and proposal.action_type = 'create_time_block'
   and proposal.time_block is not null
   and proposal.approval_status in ('pending', 'approved', 'applied')
   and (
     proposal.saved_record_id is null
     or proposal.saved_record_id = item->>'record_id'
   )
  join public.weekly_plan_blocks block
    on block.user_id = current_user_id
   and block.block_id = item->>'record_id'
  where item->>'record_type' = 'weekly_plan_block'
    and item->>'record_id' = 'assistant:' || proposal.proposal_id
    and proposal.time_block->>'title' = block.project_name
    and proposal.time_block->>'date' = block.scheduled_date::text
    and proposal.time_block->>'startTime' = left(block.start_time::text, 5)
    and round((proposal.time_block->>'durationMinutes')::numeric)::integer =
      round(block.estimated_hours * 60)::integer
    and block.project_name = item->>'title'
    and block.scheduled_date = (item->>'date')::date
    and block.start_time = (item->>'start_time')::time
    and round(block.estimated_hours * 60)::integer =
      (item->>'duration_minutes')::integer
    and (
      block.start_time + make_interval(
        mins => round(block.estimated_hours * 60)::integer
      )
    )::time > block.start_time;
  if verified_record_count <> cardinality(applied_ids) then
    raise exception 'The applied records do not exactly match the saved Weekly Plan rows';
  end if;

  if nullif(p_attempt->>'automation_grant_id', '') is not null then
    select count(*)::integer into grant_count
    from public.assistant_automation_grants grant_record
    where grant_record.user_id = current_user_id
      and grant_record.workflow_id = workflow_key
      and grant_record.grant_id = p_attempt->>'automation_grant_id';
    if grant_count <> 1 then
      raise exception 'The automation grant could not be verified';
    end if;
    update public.assistant_automation_grants
    set status = 'consumed',
        updated_at = timezone('utc', now())
    where user_id = current_user_id
      and workflow_id = workflow_key
      and grant_id = p_attempt->>'automation_grant_id'
      and status in ('active', 'consumed');
    if not found then
      raise exception 'The automation grant could not be finalized';
    end if;
  elsif p_attempt->>'automation_mode' = 'auto_apply' then
    raise exception 'Automatic application requires a verified grant';
  end if;

  if nullif(p_attempt->>'planning_decision_id', '') is not null then
    select count(*)::integer into decision_count
    from public.assistant_planning_decisions decision_record
    where decision_record.user_id = current_user_id
      and decision_record.workflow_id = workflow_key
      and decision_record.decision_id = p_attempt->>'planning_decision_id'
      and decision_record.decision_id = 'decision:' || attempt_key
      and decision_record.automation_mode in ('auto_apply', 'auto_applied')
      and decision_record.grant_id is not distinct from
        nullif(p_attempt->>'automation_grant_id', '')
      and cardinality(decision_record.proposal_ids) = cardinality(requested_ids)
      and decision_record.proposal_ids @> requested_ids
      and requested_ids @> decision_record.proposal_ids
      and cardinality(decision_record.target_record_ids) = cardinality(record_ids)
      and decision_record.target_record_ids @> record_ids
      and record_ids @> decision_record.target_record_ids
      and decision_record.status = case
        when p_attempt->>'authoritative_status' = 'partially_applied'
          then 'partially_applied'
        when p_attempt->>'authoritative_status' in (
          'applied', 'applied_with_warning'
        ) then 'applied'
        else 'failed'
      end
      and (
        not coalesce((p_attempt->>'undo_available')::boolean, false)
        or decision_record.reversible_until >= timezone('utc', now())
      );
    if decision_count <> 1 then
      raise exception 'The planning decision could not be verified';
    end if;
  end if;

  if nullif(p_attempt->>'action_receipt_id', '') is not null then
    select count(*)::integer into receipt_count
    from public.assistant_action_receipts receipt_record
    where receipt_record.user_id = current_user_id
      and receipt_record.receipt_id = p_attempt->>'action_receipt_id'
      and receipt_record.receipt_id =
        'receipt-' || (p_attempt->>'planning_decision_id')
      and receipt_record.decision_record_id = p_attempt->>'planning_decision_id'
      and receipt_record.item_count = cardinality(applied_ids)
      and receipt_record.action_type = case
        when cardinality(applied_ids) > 0 then 'plan_applied'
        else 'action_failed'
      end
      and 'view' = any(receipt_record.available_actions)
      and (
        not coalesce((p_attempt->>'undo_available')::boolean, false)
        or 'undo' = any(receipt_record.available_actions)
      );
    if receipt_count <> 1 then
      raise exception 'The action receipt could not be verified';
    end if;
  end if;

  update public.assistant_apply_attempts
  set claim_status = 'finalized',
      claim_token = null,
      claim_expires_at = null,
      automation_mode = p_attempt->>'automation_mode',
      outcome = p_attempt->>'outcome',
      requested_proposal_ids = requested_ids,
      applied_proposal_ids = applied_ids,
      failed_proposal_ids = failed_ids,
      pending_proposal_ids = pending_ids,
      failure_details = p_attempt->'failure_details',
      warning_code = warning_code_value,
      automation_grant_id = nullif(p_attempt->>'automation_grant_id', ''),
      planning_decision_id = nullif(p_attempt->>'planning_decision_id', ''),
      action_receipt_id = nullif(p_attempt->>'action_receipt_id', ''),
      undo_available = coalesce((p_attempt->>'undo_available')::boolean, false),
      undo_unavailable_reason = nullif(p_attempt->>'undo_unavailable_reason', ''),
      authoritative_status = p_attempt->>'authoritative_status',
      nothing_changed = coalesce((p_attempt->>'nothing_changed')::boolean, true),
      attempted_at = coalesce(
        nullif(p_attempt->>'attempted_at', '')::timestamptz,
        attempted_at
      ),
      finalized_at = timezone('utc', now())
  where user_id = current_user_id
    and attempt_id = attempt_key
    and claim_status = 'in_progress'
    and claim_token = claim_token_value;
  if not found then
    raise exception 'The authoritative apply claim changed before finalization';
  end if;

  insert into public.assistant_applied_records (
    user_id,
    attempt_id,
    workflow_id,
    proposal_batch_id,
    proposal_id,
    planning_decision_id,
    record_type,
    record_id,
    title,
    scheduled_date,
    start_time,
    end_time,
    starts_at,
    ends_at,
    duration_minutes,
    record_version,
    record_snapshot
  )
  select
    current_user_id,
    attempt_key,
    workflow_key,
    batch_key,
    item->>'proposal_id',
    nullif(p_attempt->>'planning_decision_id', ''),
    'weekly_plan_block',
    block.block_id,
    block.project_name,
    block.scheduled_date,
    block.start_time,
    (
      block.start_time + make_interval(
        mins => round(block.estimated_hours * 60)::integer
      )
    )::time,
    (block.scheduled_date + block.start_time) at time zone timezone_value,
    (
      block.scheduled_date + block.start_time + make_interval(
        mins => round(block.estimated_hours * 60)::integer
      )
    ) at time zone timezone_value,
    round(block.estimated_hours * 60)::integer,
    block.updated_at,
    to_jsonb(block)
  from jsonb_array_elements(p_records) item
  join public.weekly_plan_blocks block
    on block.user_id = current_user_id
   and block.block_id = item->>'record_id';
  get diagnostics inserted_mapping_count = row_count;
  if inserted_mapping_count <> cardinality(applied_ids) then
    raise exception 'The saved-record mapping changed during finalization';
  end if;

  -- Proposal, batch, and workflow truth are finalized in the same transaction
  -- as the immutable apply ledger. The route-level workflow update is useful
  -- for an early UI refresh, but it is not a prerequisite for canonical truth.
  update public.assistant_proposals proposal
  set approval_status = 'applied',
      saved_record_id = records.record_id,
      apply_attempt_id = attempt_key,
      apply_claim_token = null,
      apply_claim_expires_at = null,
      updated_at = timezone('utc', now())
  from (
    select item->>'proposal_id' as proposal_id,
           item->>'record_id' as record_id
    from jsonb_array_elements(p_records) item
  ) records
  where proposal.user_id = current_user_id
    and proposal.workflow_id = workflow_key
    and proposal.batch_id = batch_key
    and proposal.proposal_id = records.proposal_id;
  get diagnostics proposal_update_count = row_count;
  if proposal_update_count <> cardinality(applied_ids) then
    raise exception 'The applied proposals changed during finalization';
  end if;

  update public.assistant_proposals
  set approval_status = 'rejected',
      saved_record_id = null,
      apply_attempt_id = null,
      apply_claim_token = null,
      apply_claim_expires_at = null,
      updated_at = timezone('utc', now())
  where user_id = current_user_id
    and workflow_id = workflow_key
    and batch_id = batch_key
    and proposal_id = any(failed_ids);
  get diagnostics proposal_update_count = row_count;
  if proposal_update_count <> cardinality(failed_ids) then
    raise exception 'The failed proposals changed during finalization';
  end if;

  update public.assistant_proposals
  set approval_status = 'pending',
      saved_record_id = null,
      apply_attempt_id = null,
      apply_claim_token = null,
      apply_claim_expires_at = null,
      updated_at = timezone('utc', now())
  where user_id = current_user_id
    and workflow_id = workflow_key
    and batch_id = batch_key
    and proposal_id = any(pending_ids);
  get diagnostics proposal_update_count = row_count;
  if proposal_update_count <> cardinality(pending_ids) then
    raise exception 'The pending proposals changed during finalization';
  end if;

  select
    coalesce(
      array_agg(proposal_id order by created_at)
        filter (where approval_status = 'applied'),
      '{}'::text[]
    ),
    coalesce(
      array_agg(proposal_id order by created_at)
        filter (where approval_status in ('pending', 'approved')),
      '{}'::text[]
    )
  into workflow_applied_ids, workflow_pending_ids
  from public.assistant_proposals
  where user_id = current_user_id
    and workflow_id = workflow_key;

  update public.assistant_workflows
  set applied_proposal_ids = workflow_applied_ids,
      pending_proposal_ids = workflow_pending_ids,
      completion_status = case
        when cardinality(workflow_applied_ids) > 0 then 'records_applied'
        when cardinality(workflow_pending_ids) > 0 then 'proposal_created'
        else 'nothing_created'
      end,
      state = case
        when cardinality(workflow_applied_ids) > 0
          and cardinality(workflow_pending_ids) > 0
          then 'partially_applied'
        when p_attempt->>'authoritative_status' = 'partially_applied'
          then 'partially_applied'
        when p_attempt->>'authoritative_status' = 'applied_with_warning'
          then 'applied_with_warning'
        when p_attempt->>'authoritative_status' = 'applied'
          then 'applied'
        when cardinality(workflow_applied_ids) > 0
          then 'partially_applied'
        when cardinality(workflow_pending_ids) > 0
          then 'awaiting_approval'
        else 'failed'
      end,
      persistence_status = 'persisted',
      last_updated_at = timezone('utc', now())
  where user_id = current_user_id
    and workflow_id = workflow_key;

  select
    count(*)::integer,
    count(*) filter (where approval_status = 'applied')::integer,
    count(*) filter (
      where approval_status in ('pending', 'approved')
    )::integer
  into batch_proposal_count, batch_applied_count, batch_pending_count
  from public.assistant_proposals
  where user_id = current_user_id
    and workflow_id = workflow_key
    and batch_id = batch_key;

  update public.assistant_proposal_batches
  set status = case
        when batch_proposal_count > 0
          and batch_applied_count = batch_proposal_count then 'applied'
        when batch_applied_count > 0 then 'partially_applied'
        when batch_pending_count > 0 then 'pending'
        else 'rejected'
      end,
      updated_at = timezone('utc', now())
  where user_id = current_user_id
    and workflow_id = workflow_key
    and batch_id = batch_key;

  if nullif(p_attempt->>'planning_decision_id', '') is not null then
    update public.assistant_planning_decisions
    set proposal_batch_id = batch_key,
        apply_attempt_id = attempt_key,
        idempotency_key = idempotency_key_value,
        failure_details = p_attempt->'failure_details',
        warning_codes = case
          when warning_code_value is null then warning_codes
          when warning_code_value = any(warning_codes) then warning_codes
          else array_append(warning_codes, warning_code_value)
        end,
        finalized_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where user_id = current_user_id
      and decision_id = p_attempt->>'planning_decision_id';
  end if;

  if nullif(p_attempt->>'action_receipt_id', '') is not null then
    update public.assistant_action_receipts
    set apply_attempt_id = attempt_key,
        warning_codes = case
          when warning_code_value is null then warning_codes
          when warning_code_value = any(warning_codes) then warning_codes
          else array_append(warning_codes, warning_code_value)
        end,
        updated_at = timezone('utc', now())
    where user_id = current_user_id
      and receipt_id = p_attempt->>'action_receipt_id';
  end if;

  return public.get_assistant_apply_result(attempt_key);
end;
$$;

revoke execute on function public.persist_assistant_apply_result(jsonb, jsonb)
from public;
grant execute on function public.persist_assistant_apply_result(jsonb, jsonb)
to authenticated;

create or replace function public.undo_assistant_decision(p_decision_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  undo_time timestamptz := timezone('utc', now());
  decision_row public.assistant_planning_decisions%rowtype;
  attempt_row public.assistant_apply_attempts%rowtype;
  workflow_row public.assistant_workflows%rowtype;
  attempt_key text;
  batch_key text;
  receipt_key text;
  mapped_record_ids text[] := '{}';
  mapped_proposal_ids text[] := '{}';
  snapshot_record_ids text[] := '{}';
  remaining_applied_proposal_ids text[] := '{}';
  remaining_pending_proposal_ids text[] := '{}';
  expected_count integer := 0;
  mapping_count integer := 0;
  matching_count integer := 0;
  distinct_count integer := 0;
  batch_applied_count integer := 0;
  batch_pending_count integer := 0;
  batch_rejected_count integer := 0;
  batch_total_count integer := 0;
  workflow_rejected_count integer := 0;
  external_sync_count integer := 0;
  deleted_count integer := 0;
  updated_count integer := 0;
  reversed_records jsonb := '[]'::jsonb;
  remaining_context_records jsonb := '[]'::jsonb;
  next_context jsonb := '{}'::jsonb;
  next_batch_status text := 'rejected';
  next_workflow_state text := 'undone';
  next_completion_status text := 'nothing_created';
  legacy_snapshot_path boolean := false;
  receipt_created boolean := false;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;

  -- Resolve the attempt without taking the decision lock first. Apply
  -- finalization locks attempt -> decision, so Undo must use the same order to
  -- avoid a cycle where each transaction waits on the other.
  select * into decision_row
  from public.assistant_planning_decisions
  where decision_id = p_decision_id
    and user_id = current_user_id;

  if decision_row.decision_id is null then
    raise exception 'The automated action could not be found';
  end if;

  -- Apply claims and finalizers take this workflow-scoped lock first. Undo
  -- uses the same order so a different subset attempt cannot hold workflow
  -- rows while waiting for records that this decision owns.
  perform pg_advisory_xact_lock(
    hashtextextended(
      current_user_id::text || ':assistant-workflow:' || decision_row.workflow_id,
      0
    )
  );
  select * into decision_row
  from public.assistant_planning_decisions
  where decision_id = p_decision_id
    and user_id = current_user_id;
  if decision_row.decision_id is null then
    raise exception 'The automated action could not be found';
  end if;

  if decision_row.apply_attempt_id is not null then
    select * into attempt_row
    from public.assistant_apply_attempts attempt
    where attempt.user_id = current_user_id
      and attempt.attempt_id = decision_row.apply_attempt_id
      and attempt.planning_decision_id = p_decision_id;
  else
    select * into attempt_row
    from public.assistant_apply_attempts attempt
    where attempt.user_id = current_user_id
      and attempt.planning_decision_id = p_decision_id
    order by attempt.finalized_at desc nulls last, attempt.inserted_at desc
    limit 1;
  end if;

  -- New decisions are reversible only after the canonical apply transaction
  -- has linked and finalized its attempt. This also closes the small window in
  -- which the route has saved an "applied" decision but ledger finalization is
  -- still in flight.
  if attempt_row.attempt_id is null
    and p_decision_id like 'decision:attempt:%' then
    raise exception 'This automated action is not finalized yet';
  end if;

  if attempt_row.attempt_id is not null then
    -- Finalization takes this same transaction-level lock before any row lock.
    -- Taking it here first serializes every row-lock phase of Apply and Undo,
    -- including workflow/proposal/block updates, instead of merely avoiding a
    -- single attempt/decision lock inversion.
    perform pg_advisory_xact_lock(
      hashtextextended(
        current_user_id::text || ':' || attempt_row.idempotency_key,
        0
      )
    );
    select * into attempt_row
    from public.assistant_apply_attempts attempt
    where attempt.user_id = current_user_id
      and attempt.attempt_id = attempt_row.attempt_id
      and attempt.planning_decision_id = p_decision_id
    for update;
    if attempt_row.attempt_id is null then
      raise exception 'The authoritative apply state changed; retry Undo';
    end if;
  end if;

  select * into decision_row
  from public.assistant_planning_decisions
  where decision_id = p_decision_id
    and user_id = current_user_id
  for update;

  if decision_row.decision_id is null then
    raise exception 'The automated action could not be found';
  end if;
  if attempt_row.attempt_id is null and exists (
    select 1
    from public.assistant_apply_attempts attempt
    where attempt.user_id = current_user_id
      and attempt.planning_decision_id = p_decision_id
  ) then
    raise exception 'The authoritative apply state changed; retry Undo';
  end if;
  if attempt_row.attempt_id is not null and (
    attempt_row.claim_status <> 'finalized'
    or attempt_row.planning_decision_id <> p_decision_id
    or (
      decision_row.apply_attempt_id is not null
      and decision_row.apply_attempt_id <> attempt_row.attempt_id
    )
  ) then
    raise exception 'The automated action is not finalized yet';
  end if;
  if decision_row.status not in ('applied', 'partially_applied')
    or decision_row.reversed_at is not null then
    raise exception 'This automated action is no longer reversible';
  end if;
  if decision_row.automation_mode not in ('auto_apply', 'auto_applied') then
    raise exception 'Only automatically applied actions can be undone here';
  end if;
  if decision_row.reversible_until is null
    or decision_row.reversible_until < undo_time then
    raise exception 'The Undo window has expired or was not recorded';
  end if;

  if attempt_row.attempt_id is not null then
    attempt_key := attempt_row.attempt_id;
    batch_key := attempt_row.proposal_batch_id;
    receipt_key := attempt_row.action_receipt_id;
    expected_count := cardinality(attempt_row.applied_proposal_ids);

    if attempt_row.automation_mode <> 'auto_apply'
      or attempt_row.authoritative_status not in (
        'applied', 'applied_with_warning', 'partially_applied'
      )
      or not attempt_row.undo_available
      or attempt_row.undone_at is not null then
      raise exception 'This automated action is no longer reversible';
    end if;
    if expected_count = 0 then
      raise exception 'No reversible Schedule Builder records were mapped';
    end if;
    if cardinality(decision_row.proposal_ids) <>
        cardinality(attempt_row.requested_proposal_ids)
      or not (decision_row.proposal_ids @> attempt_row.requested_proposal_ids)
      or not (attempt_row.requested_proposal_ids @> decision_row.proposal_ids) then
      raise exception 'The decision no longer matches the authoritative apply request';
    end if;

    perform 1
    from public.assistant_applied_records mapping
    where mapping.user_id = current_user_id
      and mapping.attempt_id = attempt_key
    order by mapping.mapping_id
    for update;

    select
      count(*)::integer,
      coalesce(
        array_agg(mapping.record_id order by mapping.record_id),
        '{}'::text[]
      ),
      coalesce(
        array_agg(mapping.proposal_id order by mapping.proposal_id),
        '{}'::text[]
      )
    into mapping_count, mapped_record_ids, mapped_proposal_ids
    from public.assistant_applied_records mapping
    where mapping.user_id = current_user_id
      and mapping.attempt_id = attempt_key
      and mapping.planning_decision_id = p_decision_id
      and mapping.status = 'active';

    if mapping_count <> expected_count
      or cardinality(mapped_proposal_ids) <>
        cardinality(attempt_row.applied_proposal_ids)
      or not (mapped_proposal_ids @> attempt_row.applied_proposal_ids)
      or not (attempt_row.applied_proposal_ids @> mapped_proposal_ids)
      or cardinality(mapped_record_ids) <>
        cardinality(decision_row.target_record_ids)
      or not (mapped_record_ids @> decision_row.target_record_ids)
      or not (decision_row.target_record_ids @> mapped_record_ids) then
      raise exception 'The authoritative saved-record mapping changed after application';
    end if;

    perform 1
    from public.weekly_plan_blocks block
    where block.user_id = current_user_id
      and block.block_id = any(mapped_record_ids)
    order by block.block_id
    for update;

    select count(*)::integer into matching_count
    from public.assistant_applied_records mapping
    join public.weekly_plan_blocks block
      on block.user_id = mapping.user_id
     and block.block_id = mapping.record_id
    where mapping.user_id = current_user_id
      and mapping.attempt_id = attempt_key
      and mapping.planning_decision_id = p_decision_id
      and mapping.status = 'active'
      and mapping.record_type = 'weekly_plan_block'
      and block.updated_at = mapping.record_version
      and block.project_name = mapping.title
      and block.scheduled_date = mapping.scheduled_date
      and block.start_time = mapping.start_time
      and round(block.estimated_hours * 60)::integer = mapping.duration_minutes
      and block.planned_task = mapping.record_snapshot->>'planned_task'
      and coalesce(block.series_id, '') =
        coalesce(mapping.record_snapshot->>'series_id', '');

    if matching_count <> expected_count then
      raise exception 'One or more created records changed after application';
    end if;

    select coalesce(
      jsonb_agg(to_jsonb(block) order by block.scheduled_date, block.start_time, block.block_id),
      '[]'::jsonb
    ) into reversed_records
    from public.weekly_plan_blocks block
    where block.user_id = current_user_id
      and block.block_id = any(mapped_record_ids);
  else
    -- Compatibility is limited to pre-ledger decisions whose exact server
    -- snapshots and target IDs can still be proven to match current rows.
    legacy_snapshot_path := true;
    select
      count(*)::integer,
      coalesce(array_agg(snapshot->>'block_id'), '{}'::text[])
    into expected_count, snapshot_record_ids
    from jsonb_array_elements(
      coalesce(decision_row.after_state->'records', '[]'::jsonb)
    ) snapshot;

    if expected_count = 0
      or cardinality(snapshot_record_ids) <>
        cardinality(decision_row.target_record_ids)
      or not (snapshot_record_ids @> decision_row.target_record_ids)
      or not (decision_row.target_record_ids @> snapshot_record_ids) then
      raise exception 'No exact reversible Schedule Builder record set was recorded';
    end if;
    select count(*)::integer into distinct_count
    from (select distinct unnest(snapshot_record_ids)) unique_snapshot_ids;
    if distinct_count <> expected_count then
      raise exception 'The legacy decision contains duplicate record mappings';
    end if;

    mapped_record_ids := snapshot_record_ids;
    mapped_proposal_ids := decision_row.proposal_ids;
    select batch.batch_id into batch_key
    from public.assistant_proposal_batches batch
    where batch.user_id = current_user_id
      and batch.workflow_id = decision_row.workflow_id
    for update;
    select receipt.receipt_id into receipt_key
    from public.assistant_action_receipts receipt
    where receipt.user_id = current_user_id
      and receipt.decision_record_id = p_decision_id
    for update;

    perform 1
    from public.weekly_plan_blocks block
    where block.user_id = current_user_id
      and block.block_id = any(mapped_record_ids)
    order by block.block_id
    for update;

    select count(*)::integer into matching_count
    from public.weekly_plan_blocks block
    where block.user_id = current_user_id
      and exists (
        select 1
        from jsonb_array_elements(decision_row.after_state->'records') expected
        where expected->>'block_id' = block.block_id
          and block.updated_at = (expected->>'updated_at')::timestamptz
          and block.project_name = expected->>'project_name'
          and block.planned_task = expected->>'planned_task'
          and block.estimated_hours =
            (expected->>'estimated_hours')::double precision
          and coalesce(block.start_time::text, '') =
            coalesce(expected->>'start_time', '')
          and coalesce(block.scheduled_date::text, '') =
            coalesce(expected->>'scheduled_date', '')
          and coalesce(block.series_id, '') =
            coalesce(expected->>'series_id', '')
      );
    if matching_count <> expected_count then
      raise exception 'One or more created records changed after application';
    end if;

    select coalesce(
      jsonb_agg(to_jsonb(block) order by block.scheduled_date, block.start_time, block.block_id),
      '[]'::jsonb
    ) into reversed_records
    from public.weekly_plan_blocks block
    where block.user_id = current_user_id
      and block.block_id = any(mapped_record_ids);
  end if;

  if cardinality(mapped_proposal_ids) <> expected_count then
    raise exception 'The reversible proposal mapping is incomplete';
  end if;
  select count(*) into distinct_count
  from (select distinct unnest(mapped_proposal_ids)) unique_proposal_ids;
  if distinct_count <> expected_count then
    raise exception 'The reversible proposal mapping contains duplicates';
  end if;

  if jsonb_array_length(reversed_records) <> expected_count then
    raise exception 'One or more created records changed after application';
  end if;

  if to_regclass('public.google_calendar_synced_events') is not null then
    execute $query$
      select count(*)::integer
      from public.google_calendar_synced_events
      where user_id = $1
        and weekly_plan_block_id = any($2)
    $query$
    into external_sync_count
    using current_user_id, mapped_record_ids;
  end if;
  if external_sync_count > 0 then
    raise exception 'This automated action is no longer reversible after Google Calendar sync';
  end if;

  select * into workflow_row
  from public.assistant_workflows workflow
  where workflow.user_id = current_user_id
    and workflow.workflow_id = decision_row.workflow_id
  for update;
  if not found then
    raise exception 'The Assistant workflow could not be verified';
  end if;

  if batch_key is not null then
    perform 1
    from public.assistant_proposal_batches batch
    where batch.user_id = current_user_id
      and batch.workflow_id = decision_row.workflow_id
      and batch.batch_id = batch_key
    for update;
    if not found then
      raise exception 'The Assistant proposal batch could not be verified';
    end if;
  end if;

  select count(*)::integer into matching_count
  from public.assistant_proposals proposal
  where proposal.user_id = current_user_id
    and proposal.workflow_id = decision_row.workflow_id
    and proposal.proposal_id = any(mapped_proposal_ids)
    and proposal.approval_status = 'applied'
    and proposal.saved_record_id = any(mapped_record_ids);
  if matching_count <> expected_count then
    raise exception 'The Assistant proposal records could not be verified';
  end if;

  if receipt_key is not null then
    perform 1
    from public.assistant_action_receipts receipt
    where receipt.user_id = current_user_id
      and receipt.receipt_id = receipt_key
      and receipt.decision_record_id = p_decision_id
    for update;
    if not found then
      raise exception 'The authoritative action receipt changed after application';
    end if;
  else
    select receipt.receipt_id into receipt_key
    from public.assistant_action_receipts receipt
    where receipt.user_id = current_user_id
      and receipt.decision_record_id = p_decision_id
    for update;
  end if;

  if receipt_key is null then
    receipt_key := 'receipt-' || p_decision_id;
    insert into public.assistant_action_receipts (
      receipt_id,
      user_id,
      decision_record_id,
      apply_attempt_id,
      title,
      summary,
      action_type,
      item_count,
      available_actions,
      created_at,
      updated_at
    ) values (
      receipt_key,
      current_user_id,
      p_decision_id,
      attempt_key,
      coalesce(reversed_records->0->>'project_name', 'Automated') || ' plan',
      format(
        '%s automatically created Schedule Builder block%s removed.',
        expected_count,
        case when expected_count = 1 then ' was' else 's were' end
      ),
      'action_undone',
      expected_count,
      array['view'],
      undo_time,
      undo_time
    );
    receipt_created := true;
  end if;

  delete from public.weekly_plan_blocks
  where user_id = current_user_id
    and block_id = any(mapped_record_ids);
  get diagnostics deleted_count = row_count;
  if deleted_count <> expected_count then
    raise exception 'One or more created records changed during Undo';
  end if;

  update public.assistant_proposals
  set approval_status = 'rejected',
      saved_record_id = null,
      apply_attempt_id = null,
      apply_claim_token = null,
      apply_claim_expires_at = null,
      updated_at = undo_time
  where user_id = current_user_id
    and workflow_id = decision_row.workflow_id
    and proposal_id = any(mapped_proposal_ids)
    and approval_status = 'applied'
    and saved_record_id = any(mapped_record_ids);
  get diagnostics updated_count = row_count;
  if updated_count <> expected_count then
    raise exception 'The Assistant proposal records changed during Undo';
  end if;

  if not legacy_snapshot_path then
    update public.assistant_applied_records
    set status = 'undone',
        undone_at = undo_time,
        updated_at = undo_time
    where user_id = current_user_id
      and attempt_id = attempt_key
      and proposal_id = any(mapped_proposal_ids)
      and status = 'active';
    get diagnostics updated_count = row_count;
    if updated_count <> expected_count then
      raise exception 'The authoritative record mappings changed during Undo';
    end if;

    update public.assistant_apply_attempts
    set undo_available = false,
        undo_unavailable_reason = 'This action was undone.',
        action_receipt_id = receipt_key,
        undone_at = undo_time,
        undo_result = jsonb_build_object(
          'decisionId', p_decision_id,
          'recordIds', mapped_record_ids,
          'reversedRecords', reversed_records,
          'undoneAt', undo_time
        ),
        updated_at = undo_time
    where user_id = current_user_id
      and attempt_id = attempt_key
      and undone_at is null;
    get diagnostics updated_count = row_count;
    if updated_count <> 1 then
      raise exception 'The authoritative apply attempt changed during Undo';
    end if;
  end if;

  select
    coalesce(
      array_agg(proposal.proposal_id order by proposal.created_at, proposal.proposal_id)
        filter (where proposal.approval_status = 'applied'),
      '{}'::text[]
    ),
    coalesce(
      array_agg(proposal.proposal_id order by proposal.created_at, proposal.proposal_id)
        filter (where proposal.approval_status in ('pending', 'approved')),
      '{}'::text[]
    ),
    count(*) filter (where proposal.approval_status = 'rejected')::integer
  into remaining_applied_proposal_ids, remaining_pending_proposal_ids,
    workflow_rejected_count
  from public.assistant_proposals proposal
  where proposal.user_id = current_user_id
    and proposal.workflow_id = decision_row.workflow_id;

  next_workflow_state := case
    when cardinality(remaining_applied_proposal_ids) > 0
      and (
        cardinality(remaining_pending_proposal_ids) > 0
        or workflow_rejected_count > 0
      )
      then 'partially_applied'
    when cardinality(remaining_applied_proposal_ids) > 0
      then case
        when workflow_row.state = 'applied_with_warning'
          and coalesce(workflow_row.context->'applyResult'->>'attemptId', '') <>
            coalesce(attempt_key, '')
          then 'applied_with_warning'
        else 'applied'
      end
    when cardinality(remaining_pending_proposal_ids) > 0
      then 'awaiting_approval'
    else 'undone'
  end;
  next_completion_status := case
    when cardinality(remaining_applied_proposal_ids) > 0 then 'records_applied'
    when cardinality(remaining_pending_proposal_ids) > 0 then 'proposal_created'
    else 'nothing_created'
  end;

  if batch_key is not null then
    select
      count(*)::integer,
      count(*) filter (where proposal.approval_status = 'applied')::integer,
      count(*) filter (
        where proposal.approval_status in ('pending', 'approved')
      )::integer,
      count(*) filter (where proposal.approval_status = 'rejected')::integer
    into batch_total_count, batch_applied_count, batch_pending_count,
      batch_rejected_count
    from public.assistant_proposals proposal
    where proposal.user_id = current_user_id
      and proposal.workflow_id = decision_row.workflow_id
      and proposal.batch_id = batch_key;
    next_batch_status := case
      when batch_total_count > 0 and batch_applied_count = batch_total_count
        then 'applied'
      when batch_applied_count > 0 then 'partially_applied'
      when batch_pending_count > 0 then 'pending'
      else 'rejected'
    end;
  end if;

  next_context := case
    when jsonb_typeof(workflow_row.context) = 'object' then workflow_row.context
    else '{}'::jsonb
  end;
  if jsonb_typeof(next_context->'applyResult') = 'object'
    and (
      next_context->'applyResult'->>'attemptId' = attempt_key
      or next_context->'applyResult'->>'planningDecisionId' = p_decision_id
    ) then
    next_context := next_context - 'applyResult';
  end if;
  if jsonb_typeof(next_context->'appliedRecords') = 'array' then
    select coalesce(jsonb_agg(entry.item order by entry.ordinality), '[]'::jsonb)
    into remaining_context_records
    from jsonb_array_elements(next_context->'appliedRecords')
      with ordinality as entry(item, ordinality)
    where coalesce(entry.item->>'proposalId', '') <> all(mapped_proposal_ids)
      and coalesce(entry.item->>'id', '') <> all(mapped_record_ids);
    next_context := jsonb_set(
      next_context,
      '{appliedRecords}',
      remaining_context_records,
      true
    );
  end if;
  if jsonb_typeof(next_context->'seriesProposal') = 'object' then
    next_context := jsonb_set(
      next_context,
      '{seriesProposal,status}',
      to_jsonb(next_batch_status),
      true
    );
  end if;
  next_context := jsonb_set(
    next_context,
    '{state}',
    to_jsonb(case
      when next_workflow_state = 'partially_applied' then 'partially_applied'
      when next_workflow_state in ('applied', 'applied_with_warning')
        then next_workflow_state
      when next_workflow_state = 'awaiting_approval' then 'awaiting_apply'
      else 'undone'
    end),
    true
  ) || jsonb_build_object(
    'undoResult', jsonb_build_object(
      'decisionId', p_decision_id,
      'proposalIds', mapped_proposal_ids,
      'recordIds', mapped_record_ids,
      'undoneAt', undo_time
    )
  );

  update public.assistant_workflows
  set state = next_workflow_state,
      pending_proposal_ids = remaining_pending_proposal_ids,
      applied_proposal_ids = remaining_applied_proposal_ids,
      completion_status = next_completion_status,
      persistence_status = 'persisted',
      context = next_context,
      last_updated_at = undo_time
  where user_id = current_user_id
    and workflow_id = decision_row.workflow_id;
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'The Assistant workflow changed during Undo';
  end if;

  if batch_key is not null then
    update public.assistant_proposal_batches
    set status = next_batch_status, updated_at = undo_time
    where user_id = current_user_id
      and workflow_id = decision_row.workflow_id
      and batch_id = batch_key;
    get diagnostics updated_count = row_count;
    if updated_count <> 1 then
      raise exception 'The Assistant proposal batch changed during Undo';
    end if;
  end if;

  update public.assistant_planning_decisions
  set status = 'undone',
      reversed_at = undo_time,
      updated_at = undo_time
  where decision_id = p_decision_id
    and user_id = current_user_id
    and status in ('applied', 'partially_applied');
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'The planning decision changed during Undo';
  end if;

  if not receipt_created then
    update public.assistant_action_receipts
    set action_type = 'action_undone',
        apply_attempt_id = attempt_key,
        summary = format(
          '%s automatically created Schedule Builder block%s removed.',
          expected_count,
          case when expected_count = 1 then ' was' else 's were' end
        ),
        available_actions = array['view'],
        updated_at = undo_time
    where decision_record_id = p_decision_id
      and user_id = current_user_id
      and receipt_id = receipt_key;
    get diagnostics updated_count = row_count;
    if updated_count <> 1 then
      raise exception 'The action receipt changed during Undo';
    end if;
  end if;

  return jsonb_build_object(
    'attempt_id', attempt_key,
    'decision_id', p_decision_id,
    'legacy_compatible', legacy_snapshot_path,
    'reversed_records', reversed_records,
    'status', 'undone',
    'undone_at', undo_time,
    'workflow_id', decision_row.workflow_id
  );
end;
$$;

revoke execute on function public.undo_assistant_decision(text) from public;
grant execute on function public.undo_assistant_decision(text) to authenticated;

notify pgrst, 'reload schema';
