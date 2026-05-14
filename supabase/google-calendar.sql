create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'needs_reconnect' check (
    status in ('connected', 'needs_reconnect', 'pending')
  ),
  google_calendar_id text not null default 'primary',
  google_account_email text null,
  scope text not null default 'https://www.googleapis.com/auth/calendar.readonly',
  token_type text null,
  access_token text null,
  refresh_token text null,
  expires_at timestamptz null,
  oauth_state text null,
  oauth_state_expires_at timestamptz null,
  last_synced_at timestamptz null,
  error_message text null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists google_calendar_connections_oauth_state_unique
on public.google_calendar_connections (oauth_state)
where oauth_state is not null;

drop trigger if exists set_google_calendar_connections_updated_at on public.google_calendar_connections;
create trigger set_google_calendar_connections_updated_at
before update on public.google_calendar_connections
for each row
execute function public.handle_updated_at();

alter table public.google_calendar_connections enable row level security;

-- No client policies are created intentionally.
-- Tokens are accessed only by server routes using SUPABASE_SERVICE_ROLE_KEY.

notify pgrst, 'reload schema';
