create table if not exists public.assistant_threads (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'cleared')),
  title text not null default 'Planning conversation',
  snapshot jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists assistant_threads_one_active_per_user
on public.assistant_threads (user_id)
where status = 'active';

create index if not exists assistant_threads_user_updated_at
on public.assistant_threads (user_id, updated_at desc);

drop trigger if exists set_assistant_threads_updated_at on public.assistant_threads;
create trigger set_assistant_threads_updated_at
before update on public.assistant_threads
for each row
execute function public.handle_updated_at();

alter table public.assistant_threads enable row level security;

drop policy if exists "Users can view their own assistant threads" on public.assistant_threads;
create policy "Users can view their own assistant threads"
on public.assistant_threads for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own assistant threads" on public.assistant_threads;
create policy "Users can insert their own assistant threads"
on public.assistant_threads for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own assistant threads" on public.assistant_threads;
create policy "Users can update their own assistant threads"
on public.assistant_threads for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own assistant threads" on public.assistant_threads;
create policy "Users can delete their own assistant threads"
on public.assistant_threads for delete
using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
