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
   - This creates `projects`, `weekly_plan_blocks`, and `planner_profiles`.
   - `planner_profiles` stores onboarding answers and uses Row Level Security so each user only sees their own setup.
   - If your existing Supabase project already has the scheduler tables, you can run only `supabase/onboarding.sql` to add onboarding.
8. Keep the Email provider enabled in Supabase Auth.
   - Email/password is enabled by default.
   - Magic link sign-in also uses the Email provider.

## Google sign-in setup

Google login uses Supabase Auth as the OAuth broker. This is only for sign-in with basic profile and email access; the app does not request Google Calendar scopes yet.

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

## Auth behavior

- Users can sign in with email/password.
- Users can create an account with email/password.
- Users can also request a magic link.
- Users can continue with Google through Supabase Auth.
- First-time signed-in users complete a short onboarding questionnaire. Their answers are saved to `planner_profiles`.
- Projects and weekly plan blocks are scoped to the signed-in user in Supabase through Row Level Security policies.
- Local storage is still kept as a per-user fallback cache in case Supabase is temporarily unavailable.

## Calendar export

Weekly Plan blocks can be exported as an `.ics` file for Apple Calendar, Google Calendar, or Outlook.

1. Add one or more Weekly Plan blocks.
2. In the Weekly Plan section, choose the Monday for the week you want to export.
3. Click **Export to Calendar**.
4. Import `schedule-builder-weekly-plan.ics` into your calendar app.

Each block becomes a calendar event using the project name as the title, the planned task as the description, and the estimated hours as the event duration. Blocks start at 9:00 AM on each selected day and stack in the order shown.

## AI Plan Review

The `/assistant` page gives signed-in users a safe planning workspace. Users can ask for help planning the week, then review structured suggestions before anything is changed.

- V1 is review-only: approving and rejecting suggestions is local UI state, and the app does not save AI suggestions automatically.
- The assistant can suggest weekly blocks, next actions, workload warnings, and missing or unclear project details.
- The server route loads the signed-in user's projects, weekly plan blocks, and onboarding profile from Supabase. The client never sends or controls `user_id`.
- `OPENAI_API_KEY` is optional. If it is not configured, the assistant returns deterministic rule-based fallback suggestions.
- If you add `OPENAI_API_KEY`, keep it server-side only in `.env.local` or Vercel environment variables. Do not prefix it with `NEXT_PUBLIC_`.

## App sections

- `/` is the focused dashboard with Today's Top 3, weekly summary, focus rule, and quick links.
- `/projects` contains the project list and add-project form.
- `/plan` contains Weekly Plan blocks, the add-block form, and calendar export.
- `/assistant` contains AI Plan Review suggestions with safe approval/rejection controls.
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
- `app/api/assistant/plan/route.ts` contains the server-side AI Plan Review endpoint.
- `app/manifest.ts` defines the PWA install manifest.
- `components/assistant/` contains the AI Plan Review workspace UI.
- `components/auth/` contains the authentication entry UI.
- `components/onboarding/` contains the first-run setup questionnaire.
- `components/projects/` contains the scheduler feature components, including the weekly planner.
- `components/pwa/` contains the browser service worker registration.
- `components/ui/` contains lightweight reusable UI primitives used by the app.
- `lib/calendar-export.ts` generates downloadable calendar files for Weekly Plan exports.
- `lib/assistant.ts` contains assistant response types, context summaries, and fallback suggestion rules.
- `lib/projects.ts` holds project types, storage helpers, and ranking helpers for the Top 3 logic.
- `lib/onboarding.ts` holds onboarding types, answer options, and use-case starter projects.
- `lib/weekly-plan.ts` holds weekly plan types, storage helpers, and planner utilities.
- `lib/supabase/` contains the Supabase browser client and scheduler sync helpers.
- `public/` contains PWA icons and the lightweight service worker.
- `supabase/schema.sql` contains the database tables and RLS policies required for sync.

## Notes

- `NEXT_PUBLIC_SITE_URL` is used for metadata and should match your main app URL in production.
- The app syncs projects and weekly plan blocks through Supabase and keeps a local fallback cache for each signed-in user.
