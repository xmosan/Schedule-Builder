create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.projects (
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id bigint not null,
  sort_index integer not null,
  name text not null,
  category text not null check (category in ('Must-do', 'Growth', 'Maintenance')),
  priority text not null check (priority in ('High', 'Medium', 'Low')),
  deadline text not null default '',
  next_action text not null,
  weekly_hours double precision not null check (weekly_hours >= 0),
  completed boolean not null default false,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, project_id)
);

create table if not exists public.weekly_plan_blocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  block_id text not null,
  sort_index integer not null,
  day text not null check (
    day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  ),
  project_name text not null,
  planned_task text not null,
  estimated_hours double precision not null check (estimated_hours > 0),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, block_id)
);

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row
execute function public.handle_updated_at();

drop trigger if exists set_weekly_plan_blocks_updated_at on public.weekly_plan_blocks;
create trigger set_weekly_plan_blocks_updated_at
before update on public.weekly_plan_blocks
for each row
execute function public.handle_updated_at();

alter table public.projects enable row level security;
alter table public.weekly_plan_blocks enable row level security;

drop policy if exists "Users can view their own projects" on public.projects;
create policy "Users can view their own projects"
on public.projects
for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own projects" on public.projects;
create policy "Users can insert their own projects"
on public.projects
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own projects" on public.projects;
create policy "Users can update their own projects"
on public.projects
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own projects" on public.projects;
create policy "Users can delete their own projects"
on public.projects
for delete
using ((select auth.uid()) = user_id);

drop policy if exists "Users can view their own weekly plan blocks" on public.weekly_plan_blocks;
create policy "Users can view their own weekly plan blocks"
on public.weekly_plan_blocks
for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own weekly plan blocks" on public.weekly_plan_blocks;
create policy "Users can insert their own weekly plan blocks"
on public.weekly_plan_blocks
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own weekly plan blocks" on public.weekly_plan_blocks;
create policy "Users can update their own weekly plan blocks"
on public.weekly_plan_blocks
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own weekly plan blocks" on public.weekly_plan_blocks;
create policy "Users can delete their own weekly plan blocks"
on public.weekly_plan_blocks
for delete
using ((select auth.uid()) = user_id);
