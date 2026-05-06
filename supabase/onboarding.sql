create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.planner_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  planner_type text not null default 'General planning',
  planning_goals text[] not null default '{}'::text[],
  desired_integrations text[] not null default '{}'::text[],
  schedule_intensity text not null default 'Moderate',
  onboarding_completed boolean not null default false,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.planner_profiles
  add column if not exists planner_type text not null default 'General planning',
  add column if not exists planning_goals text[] not null default '{}'::text[],
  add column if not exists desired_integrations text[] not null default '{}'::text[],
  add column if not exists schedule_intensity text not null default 'Moderate',
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists inserted_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.planner_profiles
set desired_integrations = coalesce(
  (
    select array_agg(integration)
    from unnest(desired_integrations) as integration
    where integration = any(
      array[
        'Google Calendar',
        'Apple Calendar',
        'Outlook Calendar',
        'D2L / Brightspace',
        'ICS import/export'
      ]::text[]
    )
  ),
  '{}'::text[]
)
where not desired_integrations <@ array[
  'Google Calendar',
  'Apple Calendar',
  'Outlook Calendar',
  'D2L / Brightspace',
  'ICS import/export'
]::text[];

alter table public.planner_profiles
  drop constraint if exists planner_profiles_planner_type_check,
  add constraint planner_profiles_planner_type_check check (
    planner_type in (
      'Student',
      'Professional',
      'Organization leader',
      'Creator / entrepreneur',
      'General planning'
    )
  );

alter table public.planner_profiles
  drop constraint if exists planner_profiles_planning_goals_check,
  add constraint planner_profiles_planning_goals_check check (
    planning_goals <@ array[
      'Classes and assignments',
      'Projects and deadlines',
      'Meetings and events',
      'Organization tasks',
      'Content or business work',
      'Personal goals'
    ]::text[]
  );

alter table public.planner_profiles
  drop constraint if exists planner_profiles_desired_integrations_check,
  add constraint planner_profiles_desired_integrations_check check (
    desired_integrations <@ array[
      'Google Calendar',
      'Apple Calendar',
      'Outlook Calendar',
      'D2L / Brightspace',
      'ICS import/export'
    ]::text[]
  );

alter table public.planner_profiles
  drop constraint if exists planner_profiles_schedule_intensity_check,
  add constraint planner_profiles_schedule_intensity_check check (
    schedule_intensity in ('Light', 'Moderate', 'Heavy')
  );

drop trigger if exists set_planner_profiles_updated_at on public.planner_profiles;
create trigger set_planner_profiles_updated_at
before update on public.planner_profiles
for each row
execute function public.handle_updated_at();

alter table public.planner_profiles enable row level security;

drop policy if exists "Users can view their own planner profile" on public.planner_profiles;
create policy "Users can view their own planner profile"
on public.planner_profiles
for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own planner profile" on public.planner_profiles;
create policy "Users can insert their own planner profile"
on public.planner_profiles
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own planner profile" on public.planner_profiles;
create policy "Users can update their own planner profile"
on public.planner_profiles
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own planner profile" on public.planner_profiles;
create policy "Users can delete their own planner profile"
on public.planner_profiles
for delete
using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
