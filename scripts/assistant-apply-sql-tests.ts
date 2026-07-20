import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const sql = (file: string) =>
  readFileSync(path.join(process.cwd(), "supabase", file), "utf8");

async function main() {
  const db = new PGlite();
  await db.exec(`
  create schema auth;
  create role anon;
  create role authenticated;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`);

for (const migration of [
  "schema.sql",
  "scheduled-items.sql",
  "assistant-conversations.sql",
  "assistant-workflows.sql",
  "schedule-exceptions.sql",
  "weekly-plan-occurrences.sql",
  "google-calendar-sync.sql",
  "assistant-automation.sql",
]) {
  await db.exec(sql(migration));
}

// Supabase grants authenticated clients table access by default; RLS then
// narrows that access. Reproduce those grants so this test catches a policy or
// privilege regression that would let clients mutate the authoritative ledger.
await db.exec(`
  grant usage on schema public to authenticated;
  grant all privileges on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
`);
await db.exec(sql("google-calendar-sync.sql"));
const legacyUserId = "22222222-2222-4222-8222-222222222222";
await db.exec(`
  insert into auth.users (id) values ('${legacyUserId}');
  insert into public.assistant_workflows
    (workflow_id, thread_id, user_id, state, intent, completion_status,
     persistence_status)
  values (
    'legacy-wf', 'legacy-thread', '${legacyUserId}', 'applied',
    'create_time_block', 'records_applied', 'persisted'
  );
  insert into public.assistant_planning_decisions
    (decision_id, user_id, workflow_id, action_type, automation_mode,
     status, target_record_ids)
  values (
    'legacy-decision', '${legacyUserId}', 'legacy-wf', 'create_time_block',
    'auto_applied', 'applied', array['legacy-block']
  );
  insert into public.assistant_action_receipts
    (receipt_id, user_id, decision_record_id, title, summary, action_type,
     item_count, available_actions, created_at, updated_at)
  values
    ('legacy-receipt-old', '${legacyUserId}', 'legacy-decision', 'Old', 'Old',
     'plan_applied', 1, array['view'], now() - interval '1 hour',
     now() - interval '1 hour'),
    ('legacy-receipt-new', '${legacyUserId}', 'legacy-decision', 'New', 'New',
     'plan_applied', 1, array['view'], now(), now());
`);
await db.exec(sql("assistant-apply-integrity.sql"));
await db.exec(sql("assistant-apply-integrity.sql"));
const migratedReceipts = await db.query<{
  decision_record_id: string | null;
  receipt_id: string;
}>(`
  select receipt_id, decision_record_id
  from public.assistant_action_receipts
  where user_id='${legacyUserId}'
  order by receipt_id
`);
assert.deepEqual(migratedReceipts.rows, [
  { receipt_id: "legacy-receipt-new", decision_record_id: "legacy-decision" },
  { receipt_id: "legacy-receipt-old", decision_record_id: null },
]);
await db.exec(`delete from auth.users where id='${legacyUserId}'`);

const userId = "11111111-1111-4111-8111-111111111111";
await db.exec(`
  insert into auth.users (id) values ('${userId}');
  select set_config('request.jwt.claim.sub', '${userId}', false);

  insert into public.assistant_workflows
    (workflow_id, thread_id, user_id, state, intent, proposal_ids,
     pending_proposal_ids, applied_proposal_ids, completion_status,
     persistence_status, context)
  values (
    'wf-1', 'thread-1', '${userId}', 'partially_applied',
    'create_multiple_time_blocks', array['p1','p2','p3'], array['p2'],
    array['p1','p3'], 'records_applied', 'persisted',
    jsonb_build_object(
      'state', 'partially_applied',
      'appliedRecords', jsonb_build_array(
        jsonb_build_object('id','b1','proposalId','p1'),
        jsonb_build_object('id','b3','proposalId','p3')
      ),
      'applyResult', jsonb_build_object(
        'attemptId','attempt-1','planningDecisionId','decision-1'
      ),
      'seriesProposal', jsonb_build_object('status','partially_applied')
    )
  );
  insert into public.assistant_proposal_batches
    (batch_id, workflow_id, user_id, title, proposal_ids, status)
  values (
    'batch-1','wf-1','${userId}','Test batch',array['p1','p2','p3'],
    'partially_applied'
  );
  insert into public.assistant_proposals
    (proposal_id, workflow_id, batch_id, user_id, action_type,
     approval_status, conflict_status, saved_record_id, payload, time_block)
  values
    ('p1','wf-1','batch-1','${userId}','create_time_block','applied','clear',
     'b1','{}','{}'),
    ('p2','wf-1','batch-1','${userId}','create_time_block','approved','clear',
     null,'{}','{}'),
    ('p3','wf-1','batch-1','${userId}','create_time_block','applied','clear',
     'b3','{}','{}');
  insert into public.weekly_plan_blocks
    (user_id, block_id, sort_index, day, project_name, planned_task,
     estimated_hours, start_time, scheduled_date)
  values
    ('${userId}','b1',1,'Monday','Mapped','Mapped',1,'18:00','2026-07-20'),
    ('${userId}','b3',3,'Wednesday','Unrelated','Unrelated',1,'18:00','2026-07-22');
  insert into public.assistant_automation_grants
    (grant_id, workflow_id, user_id, source_message_id, scope,
     allowed_actions, status)
  values
    ('grant-1','wf-1','${userId}','message-1','current_request',
     array['create_time_block'],'consumed');
  insert into public.assistant_planning_decisions
    (decision_id, user_id, workflow_id, action_type, automation_mode,
     grant_id, proposal_ids, target_record_ids, status, reversible_until,
     proposal_batch_id, apply_attempt_id, idempotency_key, finalized_at)
  values
    ('decision-1','${userId}','wf-1','create_time_block','auto_applied',
     'grant-1',array['p1'],array['b1'],'applied',now()+interval '1 day',
     'batch-1',null,'key-1',now());
  insert into public.assistant_action_receipts
    (receipt_id, user_id, decision_record_id, title, summary, action_type,
     item_count, available_actions)
  values
    ('receipt-1','${userId}','decision-1','Mapped plan','Added','plan_applied',
     1,array['undo','view']);
  insert into public.assistant_apply_attempts
    (attempt_id,user_id,workflow_id,proposal_batch_id,idempotency_key,
     automation_mode,outcome,requested_proposal_ids,applied_proposal_ids,
     automation_grant_id,planning_decision_id,action_receipt_id,undo_available,
     authoritative_status,nothing_changed,finalized_at)
  values
    ('attempt-1','${userId}','wf-1','batch-1','key-1','auto_apply','applied',
     array['p1'],array['p1'],'grant-1','decision-1','receipt-1',true,'applied',false,now());
  update public.assistant_planning_decisions
  set apply_attempt_id='attempt-1' where decision_id='decision-1';
  update public.assistant_action_receipts
  set apply_attempt_id='attempt-1' where receipt_id='receipt-1';
  insert into public.assistant_applied_records
    (user_id,attempt_id,workflow_id,proposal_batch_id,proposal_id,
     planning_decision_id,record_type,record_id,title,scheduled_date,
     start_time,end_time,starts_at,ends_at,duration_minutes,record_version,
     record_snapshot)
  select '${userId}','attempt-1','wf-1','batch-1','p1','decision-1',
    'weekly_plan_block','b1',project_name,scheduled_date,start_time,'19:00',
    '2026-07-20 18:00:00+00','2026-07-20 19:00:00+00',60,updated_at,to_jsonb(b)
  from public.weekly_plan_blocks b where user_id='${userId}' and block_id='b1';

  -- Simulate the route having written an applied-looking decision while its
  -- canonical apply attempt is still unlinked/in flight. Undo must fail closed
  -- instead of treating a new decision as a legacy snapshot-only action.
  insert into public.assistant_planning_decisions
    (decision_id, user_id, workflow_id, action_type, automation_mode,
     proposal_ids, target_record_ids, status, reversible_until, after_state)
  values
    ('decision:attempt:unfinalized','${userId}','wf-1','create_time_block',
     'auto_applied',array['p2'],array['b3'],'applied',now()+interval '1 day',
     jsonb_build_object('records', jsonb_build_array()));
`);

await db.exec("set role authenticated");
await assert.rejects(
  db.exec(`
    update public.assistant_apply_attempts
    set warning_code='forged' where attempt_id='attempt-1'
  `),
  /permission denied/,
);
await assert.rejects(
  db.exec(`
    update public.assistant_applied_records
    set status='missing' where attempt_id='attempt-1'
  `),
  /permission denied/,
);
await assert.rejects(
  db.exec(`update public.assistant_automation_grants set status='active'
    where grant_id='grant-1'`),
  /permission denied/,
);
await assert.rejects(
  db.exec(`update public.assistant_planning_decisions set status='failed'
    where decision_id='decision-1'`),
  /permission denied/,
);
await assert.rejects(
  db.exec(`delete from public.assistant_action_receipts
    where receipt_id='receipt-1'`),
  /permission denied/,
);
await assert.rejects(
  db.exec(`
    insert into public.google_calendar_synced_events
      (user_id, weekly_plan_block_id, week_start_date, google_calendar_id,
       google_event_id, synced_title, synced_starts_at, synced_ends_at)
    values
      ('${userId}', 'b1', '2026-07-20', 'calendar', 'forged', 'Forged',
       '2026-07-20 18:00:00+00', '2026-07-20 19:00:00+00')
  `),
  /permission denied/,
);
await assert.rejects(
  db.exec("delete from public.assistant_workflows where workflow_id='wf-1'"),
  /foreign key constraint/,
);
await assert.rejects(
  db.exec("delete from public.assistant_proposals where proposal_id='p1'"),
  /foreign key constraint/,
);
await assert.rejects(
  db.query(
    "select public.undo_assistant_decision('decision:attempt:unfinalized')",
  ),
  /not finalized yet/,
);

const finalizedRetry = await db.query<{ claim: { status: string } }>(`
  select public.claim_assistant_apply_attempt(
    jsonb_build_object(
      'attempt_id','attempt-1',
      'workflow_id','wf-1',
      'proposal_batch_id','batch-1',
      'idempotency_key','key-1',
      'claim_token','retry-token',
      'automation_mode','auto_apply',
      'automation_grant_id','grant-1',
      'timezone','UTC',
      'requested_proposal_ids',jsonb_build_array('p1'),
      'user_id','${userId}'
    )
  ) as claim
`);
assert.equal(finalizedRetry.rows[0].claim.status, "finalized");

const undo = await db.query(
  "select public.undo_assistant_decision('decision-1') as result",
);
assert.equal(undo.rows.length, 1);

const blocks = await db.query(
  "select block_id from public.weekly_plan_blocks order by block_id",
);
assert.deepEqual(blocks.rows.map((row) => row.block_id), ["b3"]);

const proposals = await db.query<{
  approval_status: string;
  proposal_id: string;
  saved_record_id: string | null;
}>(
  "select proposal_id, approval_status, saved_record_id from public.assistant_proposals order by proposal_id",
);
assert.deepEqual(proposals.rows, [
  { proposal_id: "p1", approval_status: "rejected", saved_record_id: null },
  { proposal_id: "p2", approval_status: "approved", saved_record_id: null },
  { proposal_id: "p3", approval_status: "applied", saved_record_id: "b3" },
]);

const workflow = await db.query<{
  applied_proposal_ids: string[];
  completion_status: string;
  context: {
    appliedRecords: Array<{ id: string; proposalId: string }>;
    applyResult?: unknown;
    seriesProposal: { status: string };
  };
  pending_proposal_ids: string[];
  state: string;
}>(`
  select state, completion_status, pending_proposal_ids,
         applied_proposal_ids, context
  from public.assistant_workflows where workflow_id='wf-1'
`);
assert.equal(workflow.rows[0].state, "partially_applied");
assert.equal(workflow.rows[0].completion_status, "records_applied");
assert.deepEqual(workflow.rows[0].pending_proposal_ids, ["p2"]);
assert.deepEqual(workflow.rows[0].applied_proposal_ids, ["p3"]);
assert.deepEqual(workflow.rows[0].context.appliedRecords, [
  { id: "b3", proposalId: "p3" },
]);
assert.equal(workflow.rows[0].context.applyResult, undefined);
assert.equal(
  workflow.rows[0].context.seriesProposal.status,
  "partially_applied",
);

const batch = await db.query<{ status: string }>(
  "select status from public.assistant_proposal_batches where batch_id='batch-1'",
);
assert.equal(batch.rows[0].status, "partially_applied");

await db.exec("reset role");
await db.exec(`delete from auth.users where id='${userId}'`);
const accountCascade = await db.query<{ attempts: number; workflows: number }>(`
  select
    (select count(*)::integer from public.assistant_apply_attempts) as attempts,
    (select count(*)::integer from public.assistant_workflows) as workflows
`);
assert.deepEqual(accountCascade.rows[0], { attempts: 0, workflows: 0 });

// Exercise the production FE Civil path against real PostgreSQL semantics:
// claim all three proposals, reject an overlapping subset claimant, protect
// the reserved rows, finalize exact 90/90/60-minute mappings, and replay the
// immutable result without creating duplicate schedule records.
const feUserId = "33333333-3333-4333-8333-333333333333";
await db.exec(`
  insert into auth.users (id) values ('${feUserId}');
  select set_config('request.jwt.claim.sub', '${feUserId}', false);

  insert into public.assistant_workflows
    (workflow_id, thread_id, user_id, state, intent, proposal_ids,
     pending_proposal_ids, completion_status, persistence_status)
  values (
    'wf-fe', 'thread-fe', '${feUserId}', 'awaiting_approval',
    'create_multiple_time_blocks', array['fe-p1','fe-p2','fe-p3'],
    array['fe-p1','fe-p2','fe-p3'], 'proposal_created', 'persisted'
  );
  insert into public.assistant_proposal_batches
    (batch_id, workflow_id, user_id, title, proposal_ids, status)
  values (
    'batch-fe', 'wf-fe', '${feUserId}', 'FE Civil Study and Review Plan',
    array['fe-p1','fe-p2','fe-p3'], 'pending'
  );
  insert into public.assistant_proposals
    (proposal_id, workflow_id, batch_id, user_id, action_type,
     approval_status, conflict_status, payload, time_block)
  values
    ('fe-p1','wf-fe','batch-fe','${feUserId}','create_time_block','pending','clear',
     jsonb_build_object('title','FE Civil Study'),
     jsonb_build_object('title','FE Civil Study','details','FE Civil study session',
       'date','2026-07-20','startTime','18:00','endTime','19:30','durationMinutes',90)),
    ('fe-p2','wf-fe','batch-fe','${feUserId}','create_time_block','pending','clear',
     jsonb_build_object('title','FE Civil Study'),
     jsonb_build_object('title','FE Civil Study','details','FE Civil study session',
       'date','2026-07-22','startTime','18:00','endTime','19:30','durationMinutes',90)),
    ('fe-p3','wf-fe','batch-fe','${feUserId}','create_time_block','pending','clear',
     jsonb_build_object('title','FE Civil Review'),
     jsonb_build_object('title','FE Civil Review','details','FE Civil review session',
       'date','2026-07-25','startTime','14:00','endTime','15:00','durationMinutes',60));
  insert into public.assistant_automation_grants
    (grant_id, workflow_id, user_id, source_message_id, scope,
     allowed_actions, activity_title, guardrails, expires_at, status)
  values (
    'grant-fe','wf-fe','${feUserId}','message-fe','current_request',
    array['create_time_block_series'],'FE Civil',
    jsonb_build_object('maximumOccurrences',3,'maximumWeeklyMinutes',240,
      'requireDifferentDays',true,'requireNoConflicts',true,
      'requireReversibleAction',true),
    now() + interval '1 day','active'
  );
`);

await db.exec("set role authenticated");
const feClaim = await db.query<{ claim: { status: string } }>(`
  select public.claim_assistant_apply_attempt(
    jsonb_build_object(
      'attempt_id','attempt-fe',
      'workflow_id','wf-fe',
      'proposal_batch_id','batch-fe',
      'idempotency_key','apply:wf-fe:fe-p1,fe-p2,fe-p3',
      'claim_token','claim-token-fe',
      'automation_mode','auto_apply',
      'automation_grant_id','grant-fe',
      'timezone','America/Detroit',
      'requested_proposal_ids',jsonb_build_array('fe-p1','fe-p2','fe-p3'),
      'user_id','${feUserId}'
    )
  ) as claim
`);
assert.equal(feClaim.rows[0].claim.status, "claimed");

const feClaimedState = await db.query<{
  claimed: number;
  state: string;
}>(`
  select
    (select count(*)::integer from public.assistant_proposals
      where workflow_id='wf-fe' and apply_attempt_id='attempt-fe'
        and apply_claim_token='claim-token-fe') as claimed,
    (select state from public.assistant_workflows where workflow_id='wf-fe') as state
`);
assert.deepEqual(feClaimedState.rows[0], { claimed: 3, state: "applying" });

await assert.rejects(
  db.exec(`update public.assistant_proposals set approval_status='rejected'
    where proposal_id='fe-p1'`),
  /reserved by an active apply attempt/,
);
const overlappingClaim = await db.query<{
  claim: { blockingAttemptId: string; status: string };
}>(`
  select public.claim_assistant_apply_attempt(
    jsonb_build_object(
      'attempt_id','attempt-fe-overlap',
      'workflow_id','wf-fe',
      'proposal_batch_id','batch-fe',
      'idempotency_key','apply:wf-fe:fe-p1',
      'claim_token','overlap-token',
      'automation_mode','manual_review',
      'timezone','America/Detroit',
      'requested_proposal_ids',jsonb_build_array('fe-p1'),
      'user_id','${feUserId}'
    )
  ) as claim
`);
assert.equal(overlappingClaim.rows[0].claim.status, "in_progress");
assert.equal(overlappingClaim.rows[0].claim.blockingAttemptId, "attempt-fe");

await db.exec(`
  insert into public.weekly_plan_blocks
    (user_id, block_id, sort_index, day, project_name, planned_task,
     estimated_hours, start_time, scheduled_date)
  values
    ('${feUserId}','assistant:fe-p1',1,'Monday','FE Civil Study',
     'FE Civil study session',1.5,'18:00','2026-07-20'),
    ('${feUserId}','assistant:fe-p2',2,'Wednesday','FE Civil Study',
     'FE Civil study session',1.5,'18:00','2026-07-22'),
    ('${feUserId}','assistant:fe-p3',3,'Saturday','FE Civil Review',
     'FE Civil review session',1,'14:00','2026-07-25');

`);

// These audit rows are server-owned. The production route uses the service
// role after verifying the user JWT; reset the PGlite role to model that
// trusted write, then restore the authenticated caller for finalization.
await db.exec("reset role");
await db.exec(`

  insert into public.assistant_planning_decisions
    (decision_id, user_id, workflow_id, action_type, automation_mode,
     grant_id, proposal_ids, target_record_ids, status, reversible_until,
     proposal_batch_id, apply_attempt_id, idempotency_key, finalized_at)
  values (
    'decision:attempt-fe','${feUserId}','wf-fe','create_time_block_series',
    'auto_applied','grant-fe',array['fe-p1','fe-p2','fe-p3'],
    array['assistant:fe-p1','assistant:fe-p2','assistant:fe-p3'],
    'applied',now()+interval '1 day','batch-fe','attempt-fe',
    'apply:wf-fe:fe-p1,fe-p2,fe-p3',now()
  );
  insert into public.assistant_action_receipts
    (receipt_id, user_id, decision_record_id, title, summary, action_type,
     item_count, available_actions, apply_attempt_id)
  values (
    'receipt-decision:attempt-fe','${feUserId}','decision:attempt-fe',
    'FE Civil Study and Review Plan','3 Schedule Builder time blocks were added.',
    'plan_applied',3,array['undo','view'],'attempt-fe'
  );
`);
await db.exec("set role authenticated");

const feFinalized = await db.query<{
  result: {
    authoritativeStatus: string;
    applied: Array<{
      durationMinutes: number;
      proposalId: string;
      title: string;
    }>;
    nothingChanged: boolean;
    undoAvailable: boolean;
  };
}>(`
  select public.persist_assistant_apply_result(
    jsonb_build_object(
      'attempt_id','attempt-fe',
      'workflow_id','wf-fe',
      'proposal_batch_id','batch-fe',
      'idempotency_key','apply:wf-fe:fe-p1,fe-p2,fe-p3',
      'claim_token','claim-token-fe',
      'timezone','America/Detroit',
      'user_id','${feUserId}',
      'automation_mode','auto_apply',
      'outcome','applied',
      'requested_proposal_ids',jsonb_build_array('fe-p1','fe-p2','fe-p3'),
      'applied_proposal_ids',jsonb_build_array('fe-p1','fe-p2','fe-p3'),
      'failed_proposal_ids','[]'::jsonb,
      'pending_proposal_ids','[]'::jsonb,
      'failure_details','[]'::jsonb,
      'automation_grant_id','grant-fe',
      'planning_decision_id','decision:attempt-fe',
      'action_receipt_id','receipt-decision:attempt-fe',
      'undo_available',true,
      'authoritative_status','applied',
      'nothing_changed',false,
      'attempted_at',now()
    ),
    jsonb_build_array(
      jsonb_build_object('proposal_id','fe-p1','record_id','assistant:fe-p1',
        'record_type','weekly_plan_block','title','FE Civil Study',
        'date','2026-07-20','start_time','18:00','end_time','19:30',
        'duration_minutes',90,'starts_at','2026-07-20T18:00:00-04:00',
        'ends_at','2026-07-20T19:30:00-04:00'),
      jsonb_build_object('proposal_id','fe-p2','record_id','assistant:fe-p2',
        'record_type','weekly_plan_block','title','FE Civil Study',
        'date','2026-07-22','start_time','18:00','end_time','19:30',
        'duration_minutes',90,'starts_at','2026-07-22T18:00:00-04:00',
        'ends_at','2026-07-22T19:30:00-04:00'),
      jsonb_build_object('proposal_id','fe-p3','record_id','assistant:fe-p3',
        'record_type','weekly_plan_block','title','FE Civil Review',
        'date','2026-07-25','start_time','14:00','end_time','15:00',
        'duration_minutes',60,'starts_at','2026-07-25T14:00:00-04:00',
        'ends_at','2026-07-25T15:00:00-04:00')
    )
  ) as result
`);
assert.equal(feFinalized.rows[0].result.authoritativeStatus, "applied");
assert.equal(feFinalized.rows[0].result.nothingChanged, false);
assert.equal(feFinalized.rows[0].result.undoAvailable, true);
assert.deepEqual(
  feFinalized.rows[0].result.applied.map((record) => [
    record.proposalId,
    record.title,
    record.durationMinutes,
  ]),
  [
    ["fe-p1", "FE Civil Study", 90],
    ["fe-p2", "FE Civil Study", 90],
    ["fe-p3", "FE Civil Review", 60],
  ],
);

const fePersisted = await db.query<{
  applied_count: number;
  block_count: number;
  grant_status: string;
  mapping_count: number;
  pending_count: number;
  state: string;
}>(`
  select
    (select count(*)::integer from public.assistant_proposals
      where workflow_id='wf-fe' and approval_status='applied') as applied_count,
    (select count(*)::integer from public.weekly_plan_blocks
      where user_id='${feUserId}') as block_count,
    (select status from public.assistant_automation_grants
      where grant_id='grant-fe') as grant_status,
    (select count(*)::integer from public.assistant_applied_records
      where attempt_id='attempt-fe') as mapping_count,
    (select cardinality(pending_proposal_ids) from public.assistant_workflows
      where workflow_id='wf-fe') as pending_count,
    (select state from public.assistant_workflows where workflow_id='wf-fe') as state
`);
assert.deepEqual(fePersisted.rows[0], {
  applied_count: 3,
  block_count: 3,
  grant_status: "consumed",
  mapping_count: 3,
  pending_count: 0,
  state: "applied",
});

const feTimes = await db.query<{
  duration_minutes: number;
  proposal_id: string;
  starts_at: string;
}>(`
  select proposal_id, duration_minutes, starts_at
  from public.assistant_applied_records
  where attempt_id='attempt-fe'
  order by proposal_id
`);
assert.deepEqual(
  feTimes.rows.map((row) => [
    row.proposal_id,
    row.duration_minutes,
    new Date(row.starts_at).toISOString(),
  ]),
  [
    ["fe-p1", 90, "2026-07-20T22:00:00.000Z"],
    ["fe-p2", 90, "2026-07-22T22:00:00.000Z"],
    ["fe-p3", 60, "2026-07-25T18:00:00.000Z"],
  ],
);

const feReplay = await db.query<{ claim: { result: unknown; status: string } }>(`
  select public.claim_assistant_apply_attempt(
    jsonb_build_object(
      'attempt_id','attempt-fe',
      'workflow_id','wf-fe',
      'proposal_batch_id','batch-fe',
      'idempotency_key','apply:wf-fe:fe-p1,fe-p2,fe-p3',
      'claim_token','retry-token-fe',
      'automation_mode','auto_apply',
      'automation_grant_id','grant-fe',
      'timezone','America/Detroit',
      'requested_proposal_ids',jsonb_build_array('fe-p1','fe-p2','fe-p3'),
      'user_id','${feUserId}'
    )
  ) as claim
`);
assert.equal(feReplay.rows[0].claim.status, "finalized");
const feCountsAfterReplay = await db.query<{ blocks: number; mappings: number }>(`
  select
    (select count(*)::integer from public.weekly_plan_blocks
      where user_id='${feUserId}') as blocks,
    (select count(*)::integer from public.assistant_applied_records
      where attempt_id='attempt-fe') as mappings
`);
assert.deepEqual(feCountsAfterReplay.rows[0], { blocks: 3, mappings: 3 });

const feUndo = await db.query<{
  result: {
    reversed_records: Array<{
      block_id: string;
      project_name: string;
    }>;
  };
}>("select public.undo_assistant_decision('decision:attempt-fe') as result");
assert.deepEqual(
  feUndo.rows[0].result.reversed_records.map((record) => [
    record.block_id,
    record.project_name,
  ]),
  [
    ["assistant:fe-p1", "FE Civil Study"],
    ["assistant:fe-p2", "FE Civil Study"],
    ["assistant:fe-p3", "FE Civil Review"],
  ],
  "Undo returns and removes only the three exact FE Civil mappings",
);
const feUndoneState = await db.query<{
  active_mappings: number;
  blocks: number;
  receipt_action: string;
  workflow_state: string;
}>(`
  select
    (select count(*)::integer from public.weekly_plan_blocks
      where user_id='${feUserId}') as blocks,
    (select count(*)::integer from public.assistant_applied_records
      where attempt_id='attempt-fe' and status='active') as active_mappings,
    (select state from public.assistant_workflows
      where workflow_id='wf-fe') as workflow_state,
    (select action_type from public.assistant_action_receipts
      where decision_record_id='decision:attempt-fe') as receipt_action
`);
assert.deepEqual(feUndoneState.rows[0], {
  active_mappings: 0,
  blocks: 0,
  receipt_action: "action_undone",
  workflow_state: "undone",
});

await db.exec("reset role");
await db.exec(`delete from auth.users where id='${feUserId}'`);

  await db.close();
  console.log("Assistant apply SQL integrity tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
