# Google Calendar One-Way Sync Plan

This document plans the next Google Calendar phase for Schedule Builder. It is a technical plan only. Do not request Google write scopes, change runtime code, or run the SQL until implementation begins.

## Recommended V1 Behavior

V1 should be manual, one-way sync from Schedule Builder to a dedicated Google Calendar.

- Users keep the existing Google Calendar read-only connection.
- Users explicitly enable a separate Google Calendar sync permission.
- Schedule Builder creates or uses a dedicated Google Calendar named `Schedule Builder`.
- Users choose which timed Weekly Plan blocks to sync.
- Flexible blocks are not synced until the user adds a start time.
- The app creates Google Calendar events for selected blocks only.
- The app stores returned Google Calendar event IDs for duplicate prevention and status display.
- The app does not automatically update or delete Google Calendar events in V1.
- The Assistant may suggest Weekly Plan blocks, but it cannot push anything to Google Calendar directly.

## OAuth Scope Choice

Recommended write scope:

```text
https://www.googleapis.com/auth/calendar.app.created
```

Why this scope:

- It is safer than full calendar access.
- It allows the app to manage secondary calendars that the app creates.
- It supports the dedicated `Schedule Builder` calendar approach.
- It avoids writing to the user's primary Google Calendar in V1.

Alternative if we later decide to write directly to the user's chosen calendar:

```text
https://www.googleapis.com/auth/calendar.events
```

Do not use the full calendar scope for V1:

```text
https://www.googleapis.com/auth/calendar
```

## Database Changes

Not to run yet.

```sql
-- NOT TO RUN YET

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

alter table public.google_calendar_connections
add column if not exists sync_enabled boolean not null default false,
add column if not exists sync_calendar_id text,
add column if not exists sync_calendar_name text,
add column if not exists write_scope text,
add column if not exists write_granted_at timestamptz;

create table if not exists public.google_calendar_synced_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weekly_plan_block_id text null,
  week_start_date date not null,
  google_calendar_id text not null,
  google_event_id text not null,
  google_event_etag text,
  google_event_html_link text,
  synced_title text not null,
  synced_starts_at timestamptz not null,
  synced_ends_at timestamptz not null,
  sync_status text not null default 'synced' check (
    sync_status in ('synced', 'needs_attention')
  ),
  block_snapshot jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (synced_ends_at > synced_starts_at),
  foreign key (user_id, weekly_plan_block_id)
    references public.weekly_plan_blocks(user_id, block_id)
    on update cascade
    on delete set null (weekly_plan_block_id)
);

create unique index if not exists google_calendar_synced_block_week_unique
on public.google_calendar_synced_events(user_id, weekly_plan_block_id, week_start_date)
where weekly_plan_block_id is not null;

create unique index if not exists google_calendar_synced_google_event_unique
on public.google_calendar_synced_events(user_id, google_calendar_id, google_event_id);

drop trigger if exists set_google_calendar_synced_events_updated_at
on public.google_calendar_synced_events;

create trigger set_google_calendar_synced_events_updated_at
before update on public.google_calendar_synced_events
for each row
execute function public.handle_updated_at();

alter table public.google_calendar_synced_events enable row level security;

drop policy if exists "Users can select their synced Google events"
on public.google_calendar_synced_events;
create policy "Users can select their synced Google events"
on public.google_calendar_synced_events for select
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their synced Google events"
on public.google_calendar_synced_events;
create policy "Users can insert their synced Google events"
on public.google_calendar_synced_events for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their synced Google events"
on public.google_calendar_synced_events;
create policy "Users can update their synced Google events"
on public.google_calendar_synced_events for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their synced Google events"
on public.google_calendar_synced_events;
create policy "Users can delete their synced Google events"
on public.google_calendar_synced_events for delete
using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
```

### Data Model Notes

- `google_calendar_connections.sync_enabled` shows whether the user granted write sync.
- `sync_calendar_id` stores the dedicated Google Calendar ID.
- `google_calendar_synced_events` maps Weekly Plan blocks to created Google events.
- `weekly_plan_block_id` is text because the current `weekly_plan_blocks` table uses `block_id text`.
- `week_start_date` prevents one recurring Weekly Plan block from syncing repeatedly for the same week.
- Unique indexes prevent duplicate Google Calendar events.
- Failed sync attempts are returned to the API/UI response and are not stored as sync rows in V1.

## API Routes

### `POST /api/google-calendar/enable-sync`

Starts a second OAuth flow requesting `calendar.app.created`.

Responsibilities:

- Verify the signed-in Supabase user.
- Generate a secure OAuth state.
- Redirect to Google with the write scope only when the user explicitly enables sync.
- Keep existing read-only connection working.

### `GET /api/google-calendar/sync-callback`

Handles the write-scope OAuth callback.

Responsibilities:

- Verify OAuth state.
- Store refreshed token/scope information server-side only.
- Create or find a dedicated `Schedule Builder` Google Calendar.
- Save `sync_calendar_id`, `sync_calendar_name`, `write_scope`, and `sync_enabled`.

### `POST /api/google-calendar/sync-blocks`

Creates Google Calendar events from selected Weekly Plan blocks.

Responsibilities:

- Verify the signed-in Supabase user.
- Never trust client-provided `user_id`.
- Validate selected Weekly Plan block IDs belong to the user.
- Require each selected block to have a start time and positive estimated hours.
- Convert selected block day plus chosen `week_start_date` into `starts_at` and `ends_at`.
- Check `google_calendar_synced_events` before creating events.
- Create Google Calendar events on the dedicated `Schedule Builder` calendar.
- Store returned Google event IDs and sync metadata.
- Return per-block success/error results.

### `GET /api/google-calendar/sync-status`

Returns synced status for the user's Weekly Plan blocks.

Responsibilities:

- Verify the signed-in Supabase user.
- Return sync rows for the requested week.
- Mark blocks as `synced`, `not_synced`, or `needs_attention`.

### Future V1.1 Routes

Do not implement in V1 unless intentionally scoped.

- `POST /api/google-calendar/update-synced-event`
- `POST /api/google-calendar/remove-synced-event`
- `POST /api/google-calendar/resync-week`

## UI Changes

### Plan Page

Add a compact sync section near Calendar Export.

Suggested UI:

- Title: `Sync selected blocks to Google Calendar`
- Helper: `Choose timed Weekly Plan blocks to add to your Schedule Builder Google Calendar. Nothing syncs unless you choose it.`
- Week start date selector.
- List of timed Weekly Plan blocks with checkboxes.
- Exclude or disable flexible blocks with helper copy: `Add a start time before syncing.`
- Button: `Sync selected to Google Calendar`
- Status badges:
  - `Not synced`
  - `Synced`
  - `Needs attention`
  - transient `Sync failed` result after an attempted sync, not a persisted row status

### Calendar Page

Show synced state without duplicating event meaning.

- Plan blocks that were synced should show a subtle `Synced to Google` badge.
- Google events created by Schedule Builder should be recognized as app-created events.
- Conflict detection should not warn that a Weekly Plan block conflicts with the Google event that was created from the same block.
- Keep Google Calendar events read-only from the Calendar page.

### Integrations Page

Split Google Calendar status into two clear states.

- Read-only status:
  - `Connected`
  - `Needs reconnect`
  - `Not connected`
- Sync status:
  - `Sync not enabled`
  - `Sync enabled`
  - `Needs reconnect`

Suggested actions:

- `Connect Google Calendar`
- `Sync calendar events`
- `Enable Calendar Sync`
- `Disconnect Google Calendar`

The sync enable action should clearly say it adds write permission for the dedicated Schedule Builder calendar.

## Safety Rules

- Keep read-only Google Calendar mode working.
- Request write scope only through an explicit `Enable Calendar Sync` action.
- Use `calendar.app.created` for V1.
- Never expose Google access tokens or refresh tokens to the browser.
- Derive `user_id` from the Supabase session on the server.
- Never allow the Assistant to write directly to Google Calendar.
- Never sync rejected or draft Assistant suggestions.
- Sync only saved Weekly Plan blocks.
- Sync only user-selected blocks.
- Sync only blocks with start times.
- Do not automatically update Google events when a Weekly Plan block changes.
- Do not automatically delete Google events when a Weekly Plan block is removed.
- Prevent duplicates with database unique indexes and server-side checks.
- Return per-block errors instead of failing the whole batch when one block fails.
- Keep Google event creation idempotent where possible.

## Edge Cases

### User edits a synced Weekly Plan block

V1 behavior:

- Do not update Google Calendar automatically.
- Mark the block as `Needs attention`.
- Show helper copy: `This block changed after syncing. Update Google Calendar manually or resync later.`

### User removes a synced Weekly Plan block

V1 behavior:

- Do not delete the Google Calendar event automatically.
- Keep the sync record with `weekly_plan_block_id` set to null if Supabase cascades or nulls it.
- Show a future cleanup option in V1.1.

### User tries to sync the same block twice

V1 behavior:

- Prevent duplicate sync via `google_calendar_synced_block_week_unique`.
- Return a friendly message: `This block is already synced for this week.`

### Google token expires

V1 behavior:

- Refresh server-side when possible.
- If refresh fails, mark connection as `needs_reconnect`.
- Do not lose local Schedule Builder data.

### User disconnects Google Calendar

Recommended V1 behavior:

- Delete stored Google tokens and connection metadata.
- Keep local Weekly Plan blocks.
- Keep sync history only if useful for audit/status, or delete sync rows if they become confusing.
- Do not delete events from Google Calendar in V1.

### Conflicts before syncing

V1 behavior:

- Show warnings if a selected block overlaps work shifts, imported events, or Google events.
- Do not block sync unless the user chooses.
- Ask for confirmation when conflicts exist.

## Step-by-Step Implementation Plan

1. Add the Supabase schema changes.
2. Add server helpers for Google Calendar write scope and dedicated calendar creation.
3. Add the explicit `Enable Calendar Sync` OAuth flow.
4. Add sync status fetching for Weekly Plan blocks.
5. Add Plan page UI for selecting timed blocks.
6. Add `POST /api/google-calendar/sync-blocks`.
7. Add duplicate prevention and per-block results.
8. Add synced status badges on Plan and Calendar.
9. Update conflict detection to ignore app-created Google events that correspond to the same synced block.
10. Add README setup notes for the write scope.
11. Test locally and on Vercel with a real Google account.

## Testing Checklist

- Existing read-only Google Calendar connection still works.
- User can enable sync separately from read-only connection.
- OAuth requests `calendar.app.created`, not full calendar scope.
- Dedicated `Schedule Builder` Google Calendar is created or reused.
- User can select one timed Weekly Plan block.
- Sync creates one Google Calendar event.
- Sync stores the Google event ID.
- Syncing the same block again does not create a duplicate.
- Flexible blocks cannot be synced until they have start times.
- Edited synced blocks show `Needs attention`.
- Removed synced blocks do not delete Google Calendar events in V1.
- Assistant cannot write Google Calendar events.
- Google tokens are never exposed to client components.
- Disconnect removes server-side token access.
- `npm run build` passes.

## Recommendation Before Implementation

Do one preparation pass before building:

- Confirm the current Google Cloud OAuth consent screen can include `calendar.app.created`.
- Confirm whether we want to create a dedicated `Schedule Builder` calendar automatically during enablement.
- Confirm the exact V1 copy for the user-facing permission prompt.
- Confirm whether disconnect should keep or delete sync history rows.

After those decisions, implementation can proceed safely without disturbing the existing read-only integration.
