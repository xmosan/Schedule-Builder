create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.imported_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null default 'ics',
  external_uid text null,
  title text not null,
  description text null,
  location text null,
  starts_at timestamptz not null,
  ends_at timestamptz null,
  all_day boolean not null default false,
  imported_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists imported_calendar_events_uid_unique
on public.imported_calendar_events (user_id, source, external_uid)
where external_uid is not null and external_uid <> '';

create unique index if not exists imported_calendar_events_fallback_with_end_unique
on public.imported_calendar_events (user_id, source, title, starts_at, ends_at)
where (external_uid is null or external_uid = '') and ends_at is not null;

create unique index if not exists imported_calendar_events_fallback_without_end_unique
on public.imported_calendar_events (user_id, source, title, starts_at)
where (external_uid is null or external_uid = '') and ends_at is null;

drop trigger if exists set_imported_calendar_events_updated_at on public.imported_calendar_events;
create trigger set_imported_calendar_events_updated_at
before update on public.imported_calendar_events
for each row
execute function public.handle_updated_at();

alter table public.imported_calendar_events enable row level security;

drop policy if exists "Users can view their own imported calendar events" on public.imported_calendar_events;
create policy "Users can view their own imported calendar events"
on public.imported_calendar_events
for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own imported calendar events" on public.imported_calendar_events;
create policy "Users can insert their own imported calendar events"
on public.imported_calendar_events
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own imported calendar events" on public.imported_calendar_events;
create policy "Users can update their own imported calendar events"
on public.imported_calendar_events
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own imported calendar events" on public.imported_calendar_events;
create policy "Users can delete their own imported calendar events"
on public.imported_calendar_events
for delete
using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
