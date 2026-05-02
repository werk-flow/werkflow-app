# Realtime Audit Checklists

## Slice 1: Clock State Everywhere

Source table:
- `time_entries`

Shared state audited:
- `components/clock-state-provider.tsx`
- `hooks/use-current-user-status.ts`
- `hooks/use-member-status-polling.ts`
- `hooks/use-active-jobs.ts`

Consumer surfaces checked:
- `zeiterfassung`
- `kalender`
- `auftraege` shell/app state
- `mitarbeiter/[userId]`
- `auftraege/projekt/[projectNumber]`

Mutation script and results:

1. `clockIn` with job `AUF-2026-015 / awd`
   - `kalender`: PASS
   - `zeiterfassung`: PASS
   - `auftraege` shell/app state: PASS
   - `mitarbeiter/[userId]`: PASS
   - `auftraege/projekt/PRJ-2026-006`: PASS

2. `switchJob` from `awd` to `AUF-2026-014 / Test auftrag zf`
   - `kalender`: PASS
   - `zeiterfassung`: PASS
   - `auftraege` shell/app state: PASS
   - `mitarbeiter/[userId]`: PASS
   - `auftraege/projekt/PRJ-2026-006`: PASS

3. `clockOut`
   - `kalender`: PASS
   - `zeiterfassung`: PASS
   - `auftraege` shell/app state: PASS
   - `mitarbeiter/[userId]`: PASS
   - `auftraege/projekt/PRJ-2026-006`: PASS

Slice 1 status:
- Completed
- Success criterion met for the audited surfaces: `clockIn`, `clockOut`, and `switchJob` propagated without manual refresh

## Slice 2: Auftraege Collection Sync

Source tables:
- `jobs`
- `projects`
- `job_assignments`

Required mutation script:
- create job
- delete job
- create project
- delete project
- assign employee
- unassign employee
- move job into project
- move job out of project

Mutation script and results:

1. `create project` with `RA-PRJ-001 / Realtime Audit Project`
   - `auftraege` overview count: PASS
   - `auftraege/projekt/RA-PRJ-001`: PASS

2. `create job` with `RA-JOB-001 / Realtime Audit Job`
   - `auftraege` overview search result: PASS
   - `auftraege/RA-JOB-001`: PASS
   - `kalender` job picker: PASS

3. `move job into project`
   - job detail route changed to `auftraege/projekt/RA-PRJ-001/RA-JOB-001`: PASS
   - project detail count changed from `0` to `1`: PASS
   - `auftraege` overview grouping/search state: PASS

4. `assign employee`
   - job detail assigned-member list: PASS

5. `delete job`
   - job detail redirected back to project detail: PASS
   - project detail count changed from `1` to `0`: PASS
   - `auftraege` overview search result disappeared: PASS
   - `kalender` job picker result disappeared: PASS

6. `delete project`
   - project detail redirected back to `auftraege` overview: PASS
   - `auftraege` overview search result disappeared: PASS

Remaining checks still open in this slice:
- explicit `unassign employee` mutation could not be completed because the floating clock action overlaps the tiny unassign button on the job detail page
- explicit `move job out of project` mutation was not run independently after the delete cleanup sequence

Status:
- Completed for the audited realtime contract
- Remaining two UI-specific checks were explicitly deferred to manual follow-up by the user

## Slice 3: Detail Pages And Derived Summaries

Required surfaces:
- job detail pages
- project detail pages
- embedded/shared auftraege sections
- calendar-derived counts and parked/live job groupings

Mutation script and results:

1. `create project` with `RA-PRJ-002 / Realtime Audit Project 2`
   - `auftraege/projekt/RA-PRJ-002` project-detail count changed from `0` to `1`: PASS

2. `assign employee` to `RA-JOB-002 / Realtime Audit Job 2`
   - `auftraege/projekt/RA-PRJ-002/RA-JOB-002` assigned-member section updated to show `Tamay Admin`: PASS
   - `mitarbeiter/[userId]` embedded auftraege section changed from empty state to `Alle 1 / Offen 1` without manual refresh: PASS

3. `update job status -> geparkt`
   - `kalender` parked-job indicator changed from `Parkplatz 3` to `Parkplatz 4`: PASS
   - `kalender` job picker continued to show the parked job with the correct customer/project labels: PASS

4. `delete job` (`RA-JOB-002`)
   - `mitarbeiter/[userId]` embedded auftraege section returned to `Keine Aufträge zugewiesen`: PASS
   - `kalender` job picker search result disappeared: PASS

5. `customer embedded section` focused probe with search term `Customer Probe Project`
   - inserting `RA-PRJ-003 / Customer Probe Project` under `Bäckerei Müller GmbH` collapsed the filtered customer detail view down to a single matching project row: PASS
   - deleting the same probe project returned the database to baseline; the customer page did not produce a second equally-clear visual delta under the pinned search filter, so cleanup correctness was confirmed via DB state rather than a stronger UI diff: OBSERVED / CLEANED

Status:
- Completed
- Success criterion met for the audited surfaces: project detail, member embedded section, and calendar-derived parked/live state all refreshed without manual reload
- Customer embedded section showed the insert-path realtime update under a focused filter probe; cleanup was verified against final DB state after the UI signal became ambiguous

## Slice 4: Remaining Realtime Domains

Required domains:
- `entry_change_requests`
- `organization_invites`
- auth/session-driven refresh edge cases

Mutation script and results:

1. `entry_change_requests` probe
   - inserted a synthetic pending edit request against `time_entries.id = d375d3b6-fcf5-4e92-bbeb-f8eaac9319dd`
   - `zeiterfassung` nav link changed from `Zeiterfassung` to `Zeiterfassung 1`: PASS
   - `zeiterfassung` approvals tab changed from `Anträge` to `Anträge 1`: PASS
   - `mitarbeiter` quick-stats link `1 ausstehender Antrag` appeared: PASS
   - deleting the synthetic request returned all visible badges to `0`: PASS

2. `organization_invites` probe
   - inserted a synthetic pending invite for `realtime-invite-probe@example.com`
   - `mitarbeiter` invitations tab changed from `Einladungen` to `Einladungen 1`: PASS
   - deleting the synthetic invite returned the tab badge to `0`: PASS

3. `auth/session-driven refresh` edge-case audit
   - initial session token is wired into realtime auth via `supabase.auth.getSession()`: PASS
   - auth changes reapply realtime auth via `onAuthStateChange`: PASS
   - background-tab recovery path dispatches synthetic refreshes on `visibilitychange`: PASS

Status:
- Completed
