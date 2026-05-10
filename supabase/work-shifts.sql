create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.work_shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day text not null check (
    day in ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
  ),
  start_time time not null,
  end_time time not null,
  location text not null default '',
  notes text not null default '',
  recurring boolean not null default true,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (end_time > start_time)
);

drop trigger if exists set_work_shifts_updated_at on public.work_shifts;
create trigger set_work_shifts_updated_at
before update on public.work_shifts
for each row
execute function public.handle_updated_at();

alter table public.work_shifts enable row level security;

drop policy if exists "Users can view their own work shifts" on public.work_shifts;
create policy "Users can view their own work shifts"
on public.work_shifts
for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own work shifts" on public.work_shifts;
create policy "Users can insert their own work shifts"
on public.work_shifts
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own work shifts" on public.work_shifts;
create policy "Users can update their own work shifts"
on public.work_shifts
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own work shifts" on public.work_shifts;
create policy "Users can delete their own work shifts"
on public.work_shifts
for delete
using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
