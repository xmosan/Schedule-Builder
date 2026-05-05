# Personal Project Scheduler

A lightweight personal scheduling dashboard built with Next.js App Router, TypeScript, Tailwind CSS, and Supabase. It lets each user sign in, keep projects synced across devices, surface a daily Top 3, and map specific work blocks across the week.

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
- Projects and weekly plan blocks are scoped to the signed-in user in Supabase through Row Level Security policies.
- Local storage is still kept as a per-user fallback cache in case Supabase is temporarily unavailable.

## What’s inside

- `app/` contains the App Router layout, homepage, and metadata routes.
- `components/auth/` contains the authentication entry UI.
- `components/projects/` contains the scheduler feature components, including the weekly planner.
- `components/ui/` contains lightweight reusable UI primitives used by the dashboard.
- `lib/projects.ts` holds project types, storage helpers, and ranking helpers for the Top 3 logic.
- `lib/weekly-plan.ts` holds weekly plan types, storage helpers, and planner utilities.
- `lib/supabase/` contains the Supabase browser client and scheduler sync helpers.
- `supabase/schema.sql` contains the database tables and RLS policies required for sync.

## Notes

- `NEXT_PUBLIC_SITE_URL` is used for metadata and should match your main app URL in production.
- The app syncs projects and weekly plan blocks through Supabase and keeps a local fallback cache for each signed-in user.
