create table if not exists public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  exception_type text not null check (
    exception_type in ('modify_shift', 'cancel_shift', 'extra_shift', 'blocked_time', 'available_override')
  ),
  related_work_shift_id uuid references public.work_shifts (id) on delete set null,
  original_start_time time,
  original_end_time time,
  override_start_time time,
  override_end_time time,
  title text not null default '',
  notes text not null default '',
  created_by text not null default 'user' check (
    created_by in ('user', 'assistant_approved')
  ),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    exception_type not in ('modify_shift', 'cancel_shift')
    or related_work_shift_id is not null
  ),
  check (
    exception_type not in ('modify_shift', 'extra_shift', 'blocked_time')
    or (
      override_start_time is not null
      and override_end_time is not null
      and override_end_time > override_start_time
    )
  )
);

create index if not exists schedule_exceptions_user_date
on public.schedule_exceptions (user_id, date);

create index if not exists schedule_exceptions_related_shift
on public.schedule_exceptions (user_id, related_work_shift_id)
where related_work_shift_id is not null;

drop trigger if exists set_schedule_exceptions_updated_at on public.schedule_exceptions;
create trigger set_schedule_exceptions_updated_at
before update on public.schedule_exceptions
for each row
execute function public.handle_updated_at();

alter table public.schedule_exceptions enable row level security;

drop policy if exists "Users can view their own schedule exceptions" on public.schedule_exceptions;
create policy "Users can view their own schedule exceptions"
on public.schedule_exceptions for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own schedule exceptions" on public.schedule_exceptions;
create policy "Users can insert their own schedule exceptions"
on public.schedule_exceptions for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own schedule exceptions" on public.schedule_exceptions;
create policy "Users can update their own schedule exceptions"
on public.schedule_exceptions for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own schedule exceptions" on public.schedule_exceptions;
create policy "Users can delete their own schedule exceptions"
on public.schedule_exceptions for delete
using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
