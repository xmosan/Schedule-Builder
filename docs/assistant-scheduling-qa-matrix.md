# Assistant Scheduling QA Matrix

Use this matrix when checking Assistant scheduling accuracy with real or seeded account data.

The Assistant should answer direct availability and conflict questions with text only. It should not create review cards unless the user explicitly asks to add, create, move, update, or schedule something.

| Scenario | Prompt | Expected behavior |
| --- | --- | --- |
| Deadline boundary excludes target day | `I need to give 2 khutbas on Friday, find me an open time before Friday where I can write a speech` | Lists openings before Friday only. Friday is excluded unless the user gives an explicit Friday cutoff. Mentions that `before` was treated as exclusive. |
| Deadline boundary with cutoff | `Find open time before Friday at noon` | Searches Monday through Thursday plus Friday before noon only. Does not list Friday afternoon/evening. |
| Ambiguous by phrasing | `Find open time by Friday` | Asks whether Friday itself should count instead of silently guessing. |
| Follow-up confirmation | Assistant offers open windows, then user says `Yes` | Drafts one reviewable weekly time block using the earlier constraints. Does not restart the search or auto-save. |
| Exact selected window | User chooses `Thursday`, then `One hour` after Thursday 6:30-10:00 PM is offered | Review card remains Thursday at 6:30 PM for one hour. It never falls back to Monday or Anytime. |
| Missing duration | User selects a timed window without a duration | Asks one focused duration question and creates no apply-ready card yet. |
| Navigation persistence | Leave Assistant after selecting Thursday, then return | Messages, selected Thursday window, pending duration question, and any review card are restored. |
| Refresh persistence | Refresh Assistant with a pending review card | Restores the same card fields and action state. Uses the local fallback until `assistant_threads` is available. |
| Stale proposal | A commitment is added over the selected window before Apply | Apply rejects the stale opening and asks the user to review the conflict. It does not silently move the block. |
| Exact apply result | Apply Thursday 6:30 PM for one hour | Saved Supabase block contains `start_time = 18:30`; success copy names the exact date/time and provides week-aware Plan and Calendar links. |
| Clear conversation safety | Clear a conversation after applying a block | Removes messages and pending suggestions only. Applied projects, blocks, shifts, imports, and Google events remain. |
| Clear evenings | `Are there any conflicts Monday through Wednesday after 5?` | Starts with `No` when no loaded timed commitments overlap those evenings. Lists no fake blockers. |
| One blocked day | `Are there conflicts Monday through Wednesday after 5?` with only Tuesday blocked | Starts with `Partly`. Names Tuesday as blocked and Monday/Wednesday as clear. |
| Short gap before a block | Work ends 5:00 PM and a time block starts 5:30 PM | `Find open time after 5` lists `5:00-5:30 PM` and the later opening separately. It must not say `open from 5 PM onward`. |
| Exact point blocked | `Am I free Thursday at 5:45?` with a 5:30-6:30 PM time block | Starts with `No` and names the blocking time block. |
| Multiple windows | Two separate openings on one day | Count matches the listed windows. |
| Canvas event | Imported `canvas_ics` event overlaps a requested time | Treats it as an imported Canvas event and blocks that time. |
| D2L event | Imported `d2l_ics` event overlaps a requested time | Treats it as an imported D2L / Brightspace event and blocks that time. |
| Google event | Read-only Google Calendar event overlaps a requested time | Treats it as a read-only Google Calendar event and blocks that time. |
| Flexible block | Weekly Plan block has no start time | Does not block the entire day. |
| Overnight item | Event or block crosses midnight | Splits the blocked time across both dates. |
| All-day event | Imported all-day event exists | Identifies it as all-day and does not silently turn it into a precise timed blocker. |
| Schedule Builder duplicate | Imported/exported Schedule Builder copy matches a time block | Does not create a self-conflict or block availability twice. |
| Duration fit | `Where can I fit a two-hour study session?` | Only lists windows at least two hours long. |
| Missing context | Google/imported/schedule data fails to load | Adds an uncertainty note instead of treating missing data as free time. |
| Timezone-sensitive imported event | Imported/Google event crosses UTC date but is local evening | Blocks the local user date/time shown in the browser timezone, not the raw UTC date. |
| Scheduling request | `Can you schedule this Friday after work?` | May draft reviewable cards. Does not save automatically. |
| Sync request | `Sync my plan to Google Calendar.` | Explains manual sync only. Does not sync. |
| Greeting | `Hello` | Short friendly reply, no report, no cards. |
