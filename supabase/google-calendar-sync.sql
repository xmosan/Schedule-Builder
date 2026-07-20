-- Run after schema.sql (or google-calendar.sql) and before
-- assistant-apply-integrity.sql. Google Calendar sync remains manual and
-- one-way; Assistant apply routes never call it.

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

alter table public.google_calendar_connections
add column if not exists sync_enabled boolean not null default false,
add column if not exists sync_calendar_id text,
add column if not exists sync_calendar_name text,
add column if not exists write_scope text,
add column if not exists write_granted_at timestamptz;

create table if not exists public.google_calendar_synced_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weekly_plan_block_id text null,
  week_start_date date not null,
  google_calendar_id text not null,
  google_event_id text not null,
  google_event_etag text,
  google_event_html_link text,
  synced_title text not null,
  synced_starts_at timestamptz not null,
  synced_ends_at timestamptz not null,
  sync_status text not null default 'synced' check (
    sync_status in ('synced', 'needs_attention')
  ),
  block_snapshot jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (synced_ends_at > synced_starts_at),
  foreign key (user_id, weekly_plan_block_id)
    references public.weekly_plan_blocks(user_id, block_id)
    on update cascade
    on delete set null (weekly_plan_block_id)
);

create unique index if not exists google_calendar_synced_block_week_unique
on public.google_calendar_synced_events(
  user_id,
  weekly_plan_block_id,
  week_start_date
)
where weekly_plan_block_id is not null;

create unique index if not exists google_calendar_synced_google_event_unique
on public.google_calendar_synced_events(
  user_id,
  google_calendar_id,
  google_event_id
);

drop trigger if exists set_google_calendar_synced_events_updated_at
on public.google_calendar_synced_events;
create trigger set_google_calendar_synced_events_updated_at
before update on public.google_calendar_synced_events
for each row execute function public.handle_updated_at();

alter table public.google_calendar_synced_events enable row level security;

drop policy if exists "Users can select their synced Google events"
on public.google_calendar_synced_events;
drop policy if exists "Users can insert their synced Google events"
on public.google_calendar_synced_events;
drop policy if exists "Users can update their synced Google events"
on public.google_calendar_synced_events;
drop policy if exists "Users can delete their synced Google events"
on public.google_calendar_synced_events;

-- Sync routes use SUPABASE_SERVICE_ROLE_KEY after authenticating and scoping
-- the request to a user. Clients cannot alter this evidence and then bypass
-- the Assistant's server-side Undo guard.
revoke all privileges on table public.google_calendar_synced_events
from authenticated, anon;

create or replace function public.get_google_calendar_planning_context(
  p_week_start_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  safe_connection jsonb;
  safe_sync_rows jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication is required';
  end if;
  if p_week_start_date is null then
    raise exception 'A week start date is required';
  end if;

  select jsonb_build_object(
    'status', connection.status,
    'last_synced_at', connection.last_synced_at,
    'sync_enabled', connection.sync_enabled,
    'sync_calendar_name', connection.sync_calendar_name
  )
  into safe_connection
  from public.google_calendar_connections connection
  where connection.user_id = current_user_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'weekly_plan_block_id', synced.weekly_plan_block_id,
        'sync_status', synced.sync_status,
        'google_event_html_link', synced.google_event_html_link,
        'synced_title', synced.synced_title,
        'block_snapshot', synced.block_snapshot
      )
      order by synced.synced_starts_at, synced.id
    ),
    '[]'::jsonb
  )
  into safe_sync_rows
  from public.google_calendar_synced_events synced
  where synced.user_id = current_user_id
    and synced.week_start_date = p_week_start_date;

  return jsonb_build_object(
    'connection', safe_connection,
    'sync_rows', safe_sync_rows
  );
end;
$$;

revoke execute on function public.get_google_calendar_planning_context(date)
from public;
grant execute on function public.get_google_calendar_planning_context(date)
to authenticated;

notify pgrst, 'reload schema';
