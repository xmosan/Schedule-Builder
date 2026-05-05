create table if not exists public.planner_profiles (
  user_id uuid not null primary key references auth.users (id) on delete cascade,
  role text not null,
  interests text[] not null,
  intensity text not null,
  onboarding_completed boolean not null default false,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.planner_profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.planner_profiles;
create policy "Users can view their own profile"
on public.planner_profiles
for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own profile" on public.planner_profiles;
create policy "Users can insert their own profile"
on public.planner_profiles
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own profile" on public.planner_profiles;
create policy "Users can update their own profile"
on public.planner_profiles
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop trigger if exists set_planner_profiles_updated_at on public.planner_profiles;
create trigger set_planner_profiles_updated_at
before update on public.planner_profiles
for each row
execute function public.handle_updated_at();
