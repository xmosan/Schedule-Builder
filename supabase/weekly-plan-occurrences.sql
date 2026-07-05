alter table public.weekly_plan_blocks
add column if not exists scheduled_date date null;

alter table public.weekly_plan_blocks
add column if not exists series_id text null;

create index if not exists weekly_plan_blocks_user_scheduled_date_idx
on public.weekly_plan_blocks (user_id, scheduled_date)
where scheduled_date is not null;

create index if not exists weekly_plan_blocks_user_series_idx
on public.weekly_plan_blocks (user_id, series_id)
where series_id is not null;

notify pgrst, 'reload schema';
