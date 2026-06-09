create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.scheduled_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_type text not null check (item_type in ('task', 'appointment')),
  title text not null check (trim(title) <> ''),
  description text null,
  item_date date not null,
  start_time time null,
  estimated_hours numeric not null check (estimated_hours > 0),
  location text null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (item_type <> 'appointment' or start_time is not null)
);

create index if not exists scheduled_items_user_date_idx
on public.scheduled_items (user_id, item_date);

create index if not exists scheduled_items_user_type_idx
on public.scheduled_items (user_id, item_type);

drop trigger if exists set_scheduled_items_updated_at on public.scheduled_items;
create trigger set_scheduled_items_updated_at
before update on public.scheduled_items
for each row
execute function public.handle_updated_at();

alter table public.scheduled_items enable row level security;

drop policy if exists "Users can view their own scheduled items" on public.scheduled_items;
create policy "Users can view their own scheduled items"
on public.scheduled_items
for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own scheduled items" on public.scheduled_items;
create policy "Users can insert their own scheduled items"
on public.scheduled_items
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own scheduled items" on public.scheduled_items;
create policy "Users can update their own scheduled items"
on public.scheduled_items
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own scheduled items" on public.scheduled_items;
create policy "Users can delete their own scheduled items"
on public.scheduled_items
for delete
using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
