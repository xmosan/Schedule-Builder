# Schedule Builder

A lightweight project scheduling app built with Next.js App Router, TypeScript, Tailwind CSS, and Supabase. It helps students, professionals, creators, and organization leaders keep projects synced across devices, surface a daily Top 3, and map work blocks across the week.

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

Use Node 20 or Node 22 LTS locally. This app is configured for supported Next.js LTS runtimes rather than Node 24.

## Supabase setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` (`http://localhost:3000` locally, your Vercel URL in production)
4. In Supabase, open Authentication > URL Configuration.
5. Set the Site URL to your deployed app URL, for example `https://schedule-builder-ruddy.vercel.app`.
6. Add redirect URLs for both local and production, for example:
   - `http://localhost:3000`
   - `https://schedule-builder-ruddy.vercel.app`
   - Any Vercel preview URLs you want to test
7. In Supabase SQL Editor, run the SQL in `supabase/schema.sql`.
   - This creates `projects`, `weekly_plan_blocks`, `planner_profiles`, `work_shifts`, `schedule_exceptions`, `imported_calendar_events`, and `google_calendar_connections`.
   - `planner_profiles` stores onboarding answers and uses Row Level Security so each user only sees their own setup.
   - `work_shifts` stores manual work availability and uses Row Level Security so each user only sees their own shifts.
   - `imported_calendar_events` stores reviewed ICS imports and synced external calendar events. Row Level Security keeps each user's events scoped to their account.
   - `google_calendar_connections` stores server-only Google Calendar OAuth tokens. RLS is enabled with no client policies; app API routes access it with `SUPABASE_SERVICE_ROLE_KEY`.
   - For every Supabase project, including a new one, run the remaining scheduler and Assistant migrations after `supabase/schema.sql` in this order: `supabase/scheduled-items.sql`, `supabase/assistant-conversations.sql`, `supabase/assistant-workflows.sql`, `supabase/schedule-exceptions.sql`, `supabase/weekly-plan-occurrences.sql`, `supabase/google-calendar-sync.sql`, `supabase/assistant-automation.sql`, then `supabase/assistant-apply-integrity.sql`.
   - `supabase/google-calendar-sync.sql` installs the backing table used by manual, one-way Google Calendar sync and the Assistant Undo guard. `supabase/assistant-automation.sql` must run after `supabase/assistant-workflows.sql`; `supabase/assistant-apply-integrity.sql` must run last. The final migration adds idempotent apply attempts, exact applied-record mappings, authoritative result reads, and read-only owner access to automation audit evidence. Automatic Assistant application also requires the server-only `SUPABASE_SERVICE_ROLE_KEY`; if it is unavailable, the Assistant safely falls back to review without writing schedule records.
8. Keep the Email provider enabled in Supabase Auth.
   - Email/password is enabled by default.
   - Magic link sign-in also uses the Email provider.

## Google sign-in setup

Google login uses Supabase Auth as the OAuth broker. This is only for sign-in with basic profile and email access. Google Calendar connection is a separate, intentional read-only flow described below.

1. In Supabase, open Authentication > Providers > Google.
2. Copy the Google callback URL shown there. It should look like `https://<your-project-ref>.supabase.co/auth/v1/callback`.
3. In Google Cloud Console, create or select a project.
4. Configure the OAuth consent screen.
   - Use External unless this is a Google Workspace-only app.
   - Add the app name and support email.
   - Keep scopes limited to basic sign-in scopes: `openid`, `email`, and `profile`.
5. Create an OAuth 2.0 Client ID.
   - Application type: Web application.
   - Authorized JavaScript origins:
     - `http://localhost:3000`
     - `https://schedule-builder-ruddy.vercel.app`
   - Authorized redirect URI:
     - The Supabase callback URL from step 2.
6. Copy the Google Client ID and Client Secret into Supabase Authentication > Providers > Google, then enable the provider.
7. In Supabase Authentication > URL Configuration, confirm these redirect URLs are allowed:
   - `http://localhost:3000`
   - `https://schedule-builder-ruddy.vercel.app`
   - Any Vercel preview URLs you use
8. In Vercel, make sure these environment variables exist:
   - `NEXT_PUBLIC_SITE_URL=https://schedule-builder-ruddy.vercel.app`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
9. Keep the Google Client Secret only in Supabase. It does not belong in `.env.local` or Vercel for this browser app.

## Google Calendar setup

The normal Google Calendar connection is read-only: it imports upcoming events into Schedule Builder as external commitments, and imported events always remain read-only. Users may separately opt in to manual, one-way sync for timed Weekly Plan blocks. That second permission uses Google's `calendar.app.created` scope and limits writes to the dedicated `Schedule Builder` calendar created by the app. Nothing is pushed automatically by the Assistant; a user must explicitly choose a sync, update, or remove action in the Calendar UI.

1. In Supabase SQL Editor, run `supabase/google-calendar.sql` if you have not already run the full `supabase/schema.sql`.
2. In Google Cloud Console, use a Web application OAuth client.
3. Add authorized redirect URIs:
   - `http://localhost:3000/api/google-calendar/callback`
   - `https://schedule-builder-ruddy.vercel.app/api/google-calendar/callback`
   - Any Vercel preview callback URLs you want to test
4. On the OAuth consent screen, add the read-only calendar scope:
   - `https://www.googleapis.com/auth/calendar.readonly`
5. Add these server-side environment variables locally and in Vercel:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SITE_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
6. Open `/integrations`, choose **Connect Google Calendar**, approve read-only calendar access, then use **Sync calendar** when you want to refresh imported events.
7. Optional: choose **Enable Calendar Sync** to grant `https://www.googleapis.com/auth/calendar.app.created`. This enables explicit one-way actions for selected timed Weekly Plan blocks on the dedicated `Schedule Builder` calendar; it does not make imported events editable or enable automatic Assistant writes.

Tokens are stored in `google_calendar_connections` and are never returned to the browser. The client only receives connection status and sync results from server routes.

## Auth behavior

- Users can sign in with email/password.
- Users can create an account with email/password.
- Users can also request a magic link.
- Users can continue with Google through Supabase Auth.
- First-time signed-in users complete a short onboarding questionnaire. Their answers are saved to `planner_profiles`.
- Projects, weekly plan blocks, and work shifts are scoped to the signed-in user in Supabase through Row Level Security policies.
- Local storage is still kept as a per-user fallback cache in case Supabase is temporarily unavailable.

## Calendar export

Weekly Plan blocks can be exported as an `.ics` file for Apple Calendar, Google Calendar, or Outlook.

1. Add one or more Weekly Plan blocks.
2. In the Weekly Plan section, choose the Monday for the week you want to export.
3. Click **Export to Calendar**.
4. Import `schedule-builder-weekly-plan.ics` into your calendar app.

Each block becomes a calendar event using the project name as the title, the planned task as the description, and the estimated hours as the event duration. Blocks start at 9:00 AM on each selected day and stack in the order shown.

## Calendar import

Schedule Builder can import `.ics` calendar files from school portals, calendar apps, or exported work calendars.

1. Open `/integrations` or `/calendar`.
2. Choose **Import ICS file**.
3. Upload a `.ics` file.
4. Review the preview list and choose which events to import.
5. Click **Import selected**.

Imported events are saved to `imported_calendar_events` in Supabase and appear on the Calendar week and month views. Duplicate imports are skipped when an event has the same ICS UID, or when a UID is missing and the title/start/end match an existing imported event. Recurring rules are not expanded yet; if an ICS file already contains expanded event instances, those instances can be imported.

Google Calendar events are also cached in `imported_calendar_events` with `source = 'google_calendar'`, so Calendar views and the Planning Assistant can treat them as external commitments.

## Work Schedule

The `/work` page lets signed-in users add recurring or one-time work shifts manually. Add the day, start time, end time, optional location, optional notes, and whether the shift repeats weekly.

- Work shifts are saved in the `work_shifts` table in Supabase.
- RLS policies keep each user's shifts private.
- The Planning Assistant can read work shifts as unavailable-time context and will prefer lighter non-work days or warn users to place weekly blocks outside work hours.
- Existing Weekly Plan blocks are not moved automatically.

## Planning Assistant

The `/assistant` page gives signed-in users a chat-style planning workspace. Users can ask naturally for help planning the week, then review structured action cards before applying approved changes.

- Action cards are rendered only from persisted canonical proposals and can be applied or rejected one at a time.
- Safe apply supports adding weekly plan blocks and updating approved next actions.
- Rejected suggestions are removed from the persisted review queue. Informational observations never enter the proposal schema.
- The assistant can suggest weekly blocks, next actions, workload warnings, and missing or unclear project details.
- The server routes load the signed-in user's projects, weekly plan blocks, work shifts, and onboarding profile from Supabase. The client never sends or controls `user_id`.
- `OPENAI_API_KEY` is optional. If it is configured, `/api/assistant/plan` uses the OpenAI Responses API through the official `openai` JavaScript SDK.
- Explicit scheduling requests use deterministic extraction, availability, and workflow transitions. A model or fallback failure cannot create a review card or success claim.
- `OPENAI_ASSISTANT_MODEL` is optional and defaults to `gpt-4o-mini`. `AI_MODEL` remains a legacy fallback.
- `OPENAI_ASSISTANT_EVAL_MODEL` is optional and is used only by the repeatable model-comparison harness.
- Keep `OPENAI_API_KEY` server-side only in `.env.local` or Vercel environment variables. Do not prefix it with `NEXT_PUBLIC_`.
- OpenAI suggestions are validated on the server and limited to non-destructive suggestion types: weekly blocks, next actions, workload warnings, missing deadlines, and unclear project warnings.

## App sections

- `/` is the focused dashboard with Today's Top 3, weekly summary, focus rule, and quick links.
- `/projects` contains the project list and add-project form.
- `/plan` contains Weekly Plan blocks, the add-block form, and calendar export.
- `/work` contains manual work shift entry and the weekly work schedule view.
- `/assistant` contains the Planning Assistant chat with safe action cards.
- `/integrations` contains personalized integration recommendations.
- `/settings` contains account and sync status.

## Install as an app

Schedule Builder includes PWA metadata, install icons, and a lightweight service worker so it can be added to a phone home screen.

### iPhone or iPad

1. Open Schedule Builder in Safari.
2. Tap the Share button.
3. Tap **Add to Home Screen**.
4. Confirm the name, then tap **Add**.

### Android

1. Open Schedule Builder in Chrome.
2. Tap the menu button.
3. Tap **Install app** or **Add to Home screen**.
4. Confirm the install.

For local testing, run `npm run dev` and open `http://localhost:3000`. For production testing, use the Vercel URL over HTTPS.

## What’s inside

- `app/` contains the App Router layout, homepage, and metadata routes.
- `app/api/assistant/plan/route.ts` contains the server-side Planning Assistant endpoint.
- `app/api/assistant/apply/route.ts` validates and applies approved assistant suggestions safely.
- `app/manifest.ts` defines the PWA install manifest.
- `components/assistant/` contains the Planning Assistant chat UI.
- `components/auth/` contains the authentication entry UI.
- `components/onboarding/` contains the first-run setup questionnaire.
- `components/projects/` contains the scheduler feature components, including the weekly planner.
- `components/pwa/` contains the browser service worker registration.
- `components/ui/` contains lightweight reusable UI primitives used by the app.
- `components/work/` contains the manual work schedule UI.
- `lib/calendar-export.ts` generates downloadable calendar files for Weekly Plan exports.
- `lib/ics-import.ts` parses uploaded ICS calendar files for review-first import.
- `lib/imported-calendar.ts` holds imported calendar event types and formatting helpers.
- `lib/assistant.ts` contains assistant response types, context summaries, and fallback suggestion rules.
- `lib/projects.ts` holds project types, storage helpers, and ranking helpers for the Top 3 logic.
- `lib/onboarding.ts` holds onboarding types, answer options, and use-case starter projects.
- `lib/weekly-plan.ts` holds weekly plan types, storage helpers, and planner utilities.
- `lib/work-schedule.ts` holds work shift types, validation, sorting, and time formatting helpers.
- `lib/supabase/` contains the Supabase browser client and scheduler sync helpers.
- `public/` contains PWA icons and the lightweight service worker.
- `supabase/schema.sql` contains the core scheduler tables and RLS policies.
- `supabase/google-calendar-sync.sql` contains the server-owned mapping table for manual, one-way Google Calendar sync.
- `supabase/imported-calendar-events.sql` contains the standalone migration for ICS imported calendar events.
- `supabase/assistant-workflows.sql` contains the canonical Assistant workflow, proposal-batch, proposal, RLS, and atomic persistence schema.
- `supabase/weekly-plan-occurrences.sql` adds exact occurrence dates and series IDs for multi-week Weekly Plan blocks.

## Notes

- `NEXT_PUBLIC_SITE_URL` is used for metadata and should match your main app URL in production.
- The app syncs projects and weekly plan blocks through Supabase and keeps a local fallback cache for each signed-in user.
