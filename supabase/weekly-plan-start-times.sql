alter table public.weekly_plan_blocks
add column if not exists start_time time null;

notify pgrst, 'reload schema';
