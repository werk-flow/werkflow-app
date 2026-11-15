# Weekly numbers

The owner reads, once a week, whether work is slipping and whether the team works in WerkFlow. The numbers come from records WerkFlow already keeps; nobody enters anything for them. They describe the whole company and never a person. What each number means is decided in planning (werk-flow/werkflow-planning#263); this spec states what the app shows.

## Current Product Baseline

Only Admin opens „Wochenzahlen“ (`/kennzahlen`) from the sidebar. Büro and field workers see no entry; the server sends them to the dashboard before any read and refuses its reader for them as well. The reader takes the organization and the role from the caller's membership, never from the client.

- **Weeks.** The page shows the last 12 weeks side by side, Monday to Sunday on the Berlin calendar. The running week counts up to now and says so. The running week comes first: on a desktop the weeks are columns beside the labels, in a table that scrolls sideways inside its region; on a phone each week is a card with every number of the table.
- **Overdue at the end of the week.** For each week the counts as they stood at the end of its Sunday: request callbacks whose „Rückruf bis“ passed while the request was open; follow-ups past their due time and neither completed nor cancelled; requests open longer than 3 workdays after they were received; maintenance still owed after its window ended; jobs finished on site without a reviewed handover release for more than 2 workdays; blockers and parked work still open after their review date. A total adds them.
- **From finish to handover.** For the jobs whose handover was released that week: how many, the median workdays from their last finish on site to the first reviewed release after it, and the share released within 2 workdays.
- **Recorded digitally.** The share of jobs finished on site that week that have a submitted or approved Arbeitsbericht, and the share of that week's clock entries the person who worked recorded themselves, a rejected entry aside.
- **Finished on site** means the job's own transition to „Ausführung abgeschlossen“; a withdrawn handover returns the job to that state but is no new finish.
- **Workdays** are Monday to Friday; a day counts after the start day up to and including the end day.
- **States.** A week without finished jobs or entries shows a dash for each share and the median. A company without any number yet sees „Noch keine Wochenzahlen“. A failed read shows the failure with a retry, never zeros.
- **No person.** No number names, filters, ranks or opens a person, and the page has no export or drill-down.

### Current limits

- A past week is counted from what the rows hold today. A moved due date, „Rückruf bis“, maintenance window or review date counts with its current value; a reopened request counts as open since it was received; maintenance closed without a completion day counts as owed until the row's last change; a work report counts with its current state.
- A public holiday counts as a workday: no module knows the organization's holidays yet.
- Only jobs count for handovers and work reports; a project's own handover does not.
