# Assistant Scheduling QA Matrix

Use this matrix when checking Assistant scheduling accuracy with real or seeded account data.

The Assistant should answer direct availability and conflict questions with text only. It should not create review cards unless the user explicitly asks to add, create, move, update, or schedule something.

| Scenario | Prompt | Expected behavior |
| --- | --- | --- |
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
| Scheduling request | `Can you schedule this Friday after work?` | May draft reviewable cards. Does not save automatically. |
| Sync request | `Sync my plan to Google Calendar.` | Explains manual sync only. Does not sync. |
| Greeting | `Hello` | Short friendly reply, no report, no cards. |

