# Personal Project Scheduler

A lightweight personal scheduling dashboard built with Next.js App Router, TypeScript, and Tailwind CSS. It focuses on the MVP workflow: track projects, define the next action, plan weekly hours, surface a daily Top 3, and map specific work blocks across the week.

## Run locally

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## What’s inside

- `app/` contains the App Router layout, homepage, and metadata routes.
- `components/projects/` contains the scheduler feature components, including the weekly planner.
- `components/ui/` contains lightweight reusable UI primitives used by the dashboard.
- `lib/projects.ts` holds starter data, types, and ranking helpers for the Top 3 logic.
- `lib/weekly-plan.ts` holds weekly plan types, storage parsing, and helper functions.

## Notes

- State is local only for now. Projects and weekly plan blocks persist through `localStorage`, with no database or authentication layer.
- `NEXT_PUBLIC_SITE_URL` is optional and only used for metadata and sitemap URLs.
