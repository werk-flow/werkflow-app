# Pre-Wave-3 step 3: clock button (FAB) flows and the calendar toward a Plantafel

Status: living — last reviewed 2026-09-17; implemented, polished after owner testing, CodeRabbit-reviewed and verified with the minimal groups, `audit:performance:calendar-live` handed its fresh pass to step 5 (closed 2026-09-18)

## Read this first

This file is the step's record. The first 48 lines were the starting brief written at the close of Step 3 (2026-09-14). On 2026-09-15 the taking agent verified the brief, inventoried every clock-button flow, reproduced the cropped dialog, researched the market, and wrote the proposals and the decision list below. Nothing about the clock button's UX was changed in Steps 1 to 3, and nothing has been changed in this step yet: the owner wanted a full discovery first and the decisions second.

Before changing anything: load the `werkflow-design` skill, read the [time-tracking feature spec](../../../features/time-tracking.md) and the [calendar spec](../../../features/calendar-and-resource-planning.md) including its open decisions, the [competitive landscape](../../../product/competitive-landscape.md) finding on the `Plantafel`, the [freshness contract](../../../technical/realtime-and-caching.md), and the P1-21 and P1-22 slice records under `../slices/`.

Handoff prompt for the agent that takes this step (still valid for the implementation half):

> Read `AGENTS.md`, then `docs/plans/phase-1/pre-wave-3/03-clock-fab-and-calendar-ux.md` and everything it links. The brief is a starting point from a previous session; verify its facts. Do an exhaustive inventory of every flow reachable from the clock button on mobile and desktop (clock in, clock out, breaks, job switch, manual entry, corrections, recovery from an interrupted session), count clicks and dialogs per flow, and reproduce the cropped dialog header the owner reported (ask the owner for a screenshot and device if it does not reproduce). Then design the minimal-click versions, including whether hot keys above the button return, get the owner's decisions with the `grilling` skill, and implement. These flows are the most used in the app; they must be optimal on both mobile and desktop, and the work is not done until measured by the freshness and readiness groups.

## Why this step exists

The owner: the clock button "is going to be used A LOT", every regularly used flow must be efficient in clicks and dialogs, the modal that opens after tapping it shows a cropped header, and hot keys above the button (switch job, start or end a break) may return. The owner decided on 14 September that this pass happens before Wave 3. On 15 September the owner added: the pulsating, slightly transparent look of the button itself should return for an active state (green while working, yellow with a mug while on a break), the whole set of button interactions should be mapped and optimized, smaller floating buttons above the button are an option to evaluate, and the same thinking applies to the Plantafel, including how the upcoming inventory and material slices tie into the calendars.

## Known facts (from the brief, verified on 2026-09-15)

- The dialog primitive in `components/ui/dialog.tsx` bounds its body to the viewport (`max-h-[calc(100dvh-3rem)]`, scrollable body); reading it did not explain a cropped header. The reproduction below found the real cause; it is not a height problem.
- The clock state comes from a route handler (`app/api/time-tracking-state/route.ts`, `lib/time-tracking/state-client.ts`) precisely so it does not queue behind Server Actions; `components/clock-state-provider.tsx` filters `jobs` events to the running session's job.
- The time-activity dialog reports `time_transition_stale_version` with "Der Stand hat sich geändert. Bitte prüfe die aktuelle Erfassung und versuche es erneut." when the clock state moved under the user.
- The freshness and readiness groups that measure these flows: `audit:performance:calendar-live`, `audit:wave-2:p1-21`, `audit:wave-2:p1-22`, `golden:p1-22`; the P1-22 correction dialog has a five-second readiness contract (`TIME_CORRECTION_READY_MS`, `lib/testing/latency-evidence.ts:12`).

## Owner decisions already taken

Two product behaviours are in scope of this step because the owner decided so on 14 September after the [testing-system review](01-testing-system-review.md#decisions); both make the measured flows above honest, and both are user-facing defects on their own.

- **D3, the serial Server Action queue.** One browser tab sends its Server Actions one after another. A save that follows a burst of background reads (attention counts, clock state, time entries, weekly targets, sickness reports, lifecycle) waits in that queue before its request leaves; the tenth release run measured 2.6 s of a 4.5 s delivery in that wait, and a user who clicks save right after a page load feels the same pause. Calendar, attention, clock and active-job reads already moved to private GET handlers outside the queue (Step 2, PF-23); the remaining background readers still queue. The work: use the recorded scenario attribution and the campaign traces (run 10, `2026-09-14T011808620Z-216c3c`) to list every Server Action read that can run in the background of a page, move the read-only ones to the same GET transport with the same authorization boundary, or coalesce them, so that a user mutation never waits behind a read the user did not ask for. Preserve authorization and freshness; keep the [freshness contract](../../../technical/realtime-and-caching.md) unchanged. Evidence: the freshness groups (`golden:integrated`, `audit:performance:calendar-live`, `audit:wave-2:p1-24`) and a component contract that holds a background read and proves the mutation is not delayed. The enforcement-backlog row "Other optional Server Action reads can still queue behind one another" is this item. The inventory of those readers is in the deep-dive section below.
- **D5, the focus catch-up delay.** `components/realtime/realtime-provider.tsx` re-reads every live view 50 ms after any window focus or visibility change. A user glancing at an email and coming back triggers five to eight serialized reads; Playwright's switches between the acting and receiving sessions trigger the same bursts (PERF-03 trace, 13 September; P1-24 trace, 14 September). Decision: a catch-up on focus happens only when the tab was hidden or unfocused for at least 30 seconds while the socket stayed subscribed; after a reconnect (`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`) the existing immediate catch-up stays. Evidence: a real-provider component contract with a fake clock covering a 5-second and a 40-second absence and a reconnect, plus the freshness groups above. Verified 2026-09-15: the 50 ms timer is still in the provider (`realtime-provider.tsx:205-222`); D5 is not implemented.

## Deep-dive findings (written 2026-09-15 before any implementation)

### Verified

- The clock button is mounted once for every authenticated page in `app/(app)/layout.tsx:69`, inside `ClockStateProvider`, as a fixed 56 px orange circle at the bottom right (`components/clock-fab.tsx`). `PageBody` reserves `pb-24` / `sm:pb-28` under every page for it (`components/shared/page-shell.tsx:52`). The calendar switches that clearance off because it owns its own scroller.
- The button has exactly one action in every state: open `TimeActivityDialog`. The running-state pill above it ("Arbeit · Auftragstitel") opens the same dialog. The button is disabled until the clock state has loaded (`isReady`) and while a transition is pending; a failed read shows `SectionError` beside it with "Erneut laden". This is the readiness contract of `tests/ui-contracts/clock-readiness.spec.ts` and it must survive any redesign.
- `TimeActivityDialog` (`components/time-activity-dialog.tsx`) is one dialog for start, switch, recovery and end. It preselects the current activity kind (`current?.kind ?? 'work'`) and the current job (`current?.jobId ?? preferredJobId`), shows six activity tiles (Pause hidden under the automatic break rule), a job button that opens `JobPickerModal`, the travel qualifiers (Strecke, Rolle), the standby context and the internal type as `Select`s, and two footer commands: "Erfassung beenden" (only while clocked in) and "Starten" / "Aktivität wechseln" / "Prüfen und fortsetzen". It is not a `<form>`; `lib/ui/dialog-contracts.test.ts:271` records it as a `multiple-actions` exception, so Enter does nothing on desktop.
- `JobPickerModal` (`components/job-picker-modal.tsx`) is the owner-confirmed flat list with a visible search field (restored 2026-08-23 after a regression). It reads through the Server Action `getJobsForPicker` (`lib/time-tracking/actions.ts:2752`): the caller's assigned jobs, status not `fertig`, ordered by title. Nothing about today's dispatch or the last-used job influences the order. In `resume` mode it preselects "Ohne Auftrag"; in `switch` mode the current job; the confirm button is disabled in `switch` mode while the selection equals the current job.
- The previous button generation (before `3e297d8`, "feat: add explicit time activity segments") had the hot keys the owner remembers: a 32 px "Auftrag wechseln" button and a 32 px Pause/Weiter button above the main button, a job pill with a popover ("Details anzeigen"), the main button as `animate-pulse bg-destructive` (red, square icon) while clocked in, and one-tap clock-out on the main button. The 32 px targets were below the 44 px field-worker minimum of the design canon; the red pulse conflicted with the semantic-color rule; the one-tap clock-out had no confirmation and no undo.
- The dashboard at `/zeiterfassung` (`components/zeiterfassung/zeiterfassung-dashboard.tsx`) has three "Schnellzugriff" tiles: "Auftrag auswählen" (disabled unless clocked in and not on a break), "Pause" / "Arbeit fortsetzen" (manual break rule only, disabled unless clocked in; resuming opens the job picker in `resume` mode) and "Fahrzeit" (opens the activity dialog with travel preselected; this is the only tile that can start a session). Clock-in and clock-out on the dashboard go through the global button. The ring and the status line already use `animate-green-glow` / `animate-yellow-glow` (`app/globals.css:302-326`) and the semantic `success` / `warning` tokens for working / on break.
- The field work pack (`components/auftraege/field-work-pack-time-section.tsx`) has the shortest flows in the app: "Arbeitszeit starten", "Zu diesem Auftrag wechseln" and "Arbeitszeit beenden" are one tap each on the job's page, plus "Aktivität wählen" for the dialog with the job preselected. This is the pattern to copy, not the dialog.
- The clock state loses the job during a break. `deriveClockStatus` in `lib/time-tracking/helpers.ts:305-345` sets `activeJobId = null` on `break_start`, and the canonical projection keeps that shape (`lib/time-tracking/actions.ts` around line 2700 builds `currentActivity` as `{ kind: 'break' }` with `activeJobId` from that derivation). Neither `LiveClockState` nor `time_sessions` (`supabase/migrations/20260831100920_add_p1_21_time_segments.sql:44`) carries "the job before the break". The previous work segment does (`time_segments.job_id`), so the value is derivable without schema.
- Sign-out clocks out automatically (A1-07, `BASE-TIME-F03`); a session open longer than 24 hours becomes `recovery_required` and the dialog shows the warning block with "Prüfen und fortsetzen" and the acknowledged end (`P1-21-F37`, `F38`); a live legacy sequence shows as "Laufende Erfassung" and is bridged by the next action (`F41`).
- The browser tests drive the button through `button[title="Zeiterfassung starten"]` / `button[title="Zeiterfassung öffnen"]`, the accessible names "Zeiterfassung starten" / "Laufende Zeiterfassung öffnen", the dialog headings "Zeiterfassung starten" / "Aktivität wechseln", the commands "Starten" / "Aktivität wechseln" / "Erfassung beenden", the tile "Pause", the job button `/^Auftrag auswählen:/` and the picker headings "Einstempeln" / "Auftrag wechseln" (`tests/golden/support/steps/:724-810`, `3155-3421`; `tests/audit/wave-2/p1-21.spec.ts:21-55`; `tests/golden/p1-21.spec.ts`; `tests/audit/wave-1/a1-grundstock.spec.ts`; `tests/audit/support/a1-steps.ts:153`; `tests/canary/canary.spec.ts`). Ten test files depend on these names; a redesign must update `steps.ts` helpers first and keep one helper per flow.
- The measured groups named in the brief exist in `lib/testing/test-groups.ts` (`wave-2:p1-21`, `wave-2:p1-22`, `performance:calendar-live`; `golden:p1-22` from `tests/golden/p1-22.spec.ts`), and `ui:contracts` runs `tests/ui-contracts/clock-readiness.spec.ts` with the real provider, button and dialog.
- The week view (`components/kalender/week-view/week-view.tsx`, 893 lines) is already a people-row board in shape: one row per member, seven day columns, a `min-w-[1150px]` grid with a sticky 140 px name column, up to three time blocks and three job badges per cell with "+n mehr", jobs without assignment in the day header, drag-and-drop of job badges between rows and days and from the Parkplatz, drag of closed time sessions, a click on a cell that opens the member-day dialog, and a click on a header that switches to the day view. Managers see the members selected in the filter; employees see only themselves (`calendar-container.tsx:743-747`). Only the month view uses FullCalendar (`calendar-container.tsx:1609`).
- The week view receives no absence, holiday, closure or capacity data: `WeekViewProps` has entries, members, settings and jobs only. Absences render in the month view alone. Capacity is evaluated per planning action (`CapacityEvaluation`, `lib/planning/types.ts:94`), never for a displayed window.
- The calendar window GET already returns planning occurrences, time entries, vacation, sickness and holiday context for a window (`components/kalender/use-calendar-range-data.ts`, `app/api/calendar-window/`), so the board's data path exists. `PlanningCalendarEntry` (`lib/planning/types.ts:104`) carries no dispatch state; the Einsätze panel reads that separately through `getDispatchOverview`.
- Slice IDs with a letter suffix have a precedent (`P1-00a`); `scripts/check-docs.ts` requires the record file under `slices/` to start with the lower-cased ID and the roadmap row to link it.

### Contradicted or outdated

- "Reading the dialog primitive did not explain a cropped header, so the report must be reproduced on the device where it happens." Reproduced without the device; the cause is in the dialog body and the tile styling, not in the primitive's height rule. See the reproduction section.
- The brief lists "manual entry, corrections" among the flows the button can start. They cannot be started from the button: manual same-day entries live behind "Manuelle Eintragung" on `/zeiterfassung` (`components/zeiterfassung/manual-entry-button.tsx`) and corrections behind the entry history and the calendar (`P1-22-F01`). The inventory records them as flows the button does not reach, with the click counts from where they start.
- "Hot keys above the button (switch job, start or end a break) may return" implies they were removed for UX reasons. They were removed with the P1-21 rewrite that replaced four direct actions with one dialog; the slice record does not record a decision against quick actions. The design canon does constrain them: 44 px targets, orange only for the attention action, semantic colors for states.

### Added

- **The break loses the job (product defect, Tier 1 candidate).** Resuming the same job after a break is the most frequent transition after clock-in and needs six taps and two dialogs from the button today, because the state offers no "job before the break" and the picker preselects "Ohne Auftrag". Prevention at Tier 1: the state read returns `resumeJobId` from the last work, travel or call-out segment of the open session, and the resume actions default to it; a unit test on the state builder and the `clock-readiness` contract pin it.
- **The dialog defaults to the current activity, which is never the wanted one.** Opening the dialog while working preselects "Arbeit"; while on a break it preselects "Pause". Every switch therefore costs the tile tap plus the confirm tap. A state-aware action list (next actions only) removes one tap from every flow and the dead-end of confirming the current activity.
- **Two more layout defects in the same dialog** (found by the reproduction): the job button is `shrink-0` + `whitespace-nowrap` (from the `Button` base) inside a flex row, so on phones it overflows the dialog and pushes "Lösen" off screen; and the description "Der Wechsel beendet die laufende Aktivität …" is shown even when nothing is running. Under the automatic break rule the grid shows five tiles in two columns with one orphan.
- **No elapsed time anywhere near the button.** The pill shows activity and job; the running duration is only on `/zeiterfassung`. Every competitor clock shows the timer on the control (research, below).
- **The job picker ignores today's plan.** `getJobsForPicker` sorts alphabetically. The dispatch data (P1-11 occurrences, P1-12 dispatch) knows which assigned jobs are planned today; the picker could list them first with a "Heute geplant" label without a schema change.
- **D3 reader inventory.** Background readers still on Server Actions, grouped by the page they load on (every `useLiveView` with server-prop `initialData` skips its mount read but re-reads on the first channel join and on every catch-up, which is the burst D3 and D5 describe): `/zeiterfassung`: `getTimeEntries` + `getWeeklyTargets` (`hooks/use-weekly-time-data.ts`), `getOwnVacationOverview`, `getOwnSicknessReports`, `getProvisionalTimeSummary`, `getTimeEntries` + `getProfilesByIds` (entry history), `getPendingSessions` + `getPendingChangeRequests` (approvals), `getTimeCorrectionRequests`, `getPendingVacationRequestsForApprover`; job detail: `getTimeEntriesForJob`, `getJobDispatchCards`, `getJobQualificationDetail`, `getWorkLifecycleSnapshot`, the work-artifacts reader, `getJobMaterialLines`; `/mitarbeiter`: the member-status reader and the personnel sections; `/aufgaben`: `getAttentionOverview`; service pages: their list and detail readers; `organization-realtime-bridge`: `refreshMemberships`. Already on GET: clock, active jobs, attention counts, calendar window, customer page. The Zeiterfassung page alone fires nine Server Actions on every catch-up; that is the page a field worker has open when they tap the button.
- **Harness gap (Tier 2 candidate).** The component-contract harness (`tests/ui-contracts/`) renders real components without the app's CSS, so it can prove semantics and focus but not clipping, overflow or touch-target size. Loading the compiled `globals.css` into the harness page (the reproduction did this with the build's CSS chunks) would let a contract assert "the selected tile's ring lies inside the scroll container" and "every primary control in the field flows is at least 44 px". Cost: one build step in `tests/ui-contracts/run.ts` (Tailwind compile of `app/globals.css`, about a second) and a `page.addStyleTag` in the mount helpers.

## Inventory of every flow the button reaches today

Counts start at the already-visible button on an authenticated page and count taps or clicks up to the accepted server response, excluding typing in the search field and scrolling. "Dialogs" counts modal surfaces opened. Mobile and desktop counts are identical today because the dialog is the same; the desktop column notes the keyboard.

| # | Flow | From the button today (taps / dialogs) | Other entry points today | Desktop keyboard |
| --- | --- | --- | --- | --- |
| 1 | Clock in, no job | 2 / 1: button, "Starten" | Dashboard tile "Fahrzeit" starts a travel session (2 / 1) | Enter does nothing in the dialog; Tab to "Starten" |
| 2 | Clock in on a job | 5 / 2: button, "Zuordnung", job row, "Einstempeln", "Starten" | Field work pack "Arbeitszeit starten" 1 / 0 (after reaching the job page) | same |
| 3 | Start travel (Fahrt) | 3 / 1: button, "Fahrt", "Starten"; plus 2 taps per qualifier (Strecke, Rolle); plus 3 for a job | Dashboard tile "Fahrzeit" 2 / 1 | same |
| 4 | Travel to work on arrival, same job | 3 / 1: button, "Arbeit", "Aktivität wechseln" (the job is kept from the travel segment) | Field work pack "Zu diesem Auftrag wechseln" 1 / 0 | same |
| 5 | Start a break (manual rule) | 3 / 1: button, "Pause", "Aktivität wechseln" | Dashboard tile "Pause" 1 / 0 | same |
| 6 | End a break, same job as before | 6 / 2: button, "Arbeit", "Zuordnung", job row, "Wechseln", "Aktivität wechseln" | Dashboard tile "Arbeit fortsetzen" 3 / 1 (picker preselects "Ohne Auftrag") | same |
| 7 | End a break, no job | 3 / 1: button, "Arbeit", "Aktivität wechseln" | Dashboard 2 / 1 | same |
| 8 | Switch job while working | 5 / 2: button, "Zuordnung", job row, "Wechseln", "Aktivität wechseln" | Dashboard tile 3 / 1; field work pack 1 / 0 | same |
| 9 | Clock out | 2 / 1: button, "Erfassung beenden" | Field work pack "Arbeitszeit beenden" 1 / 0; sign-out clocks out | same |
| 10 | Standby, call-out, internal activity | 3 / 1 plus 2 per `Select` | none | same |
| 11 | Recovery after 24 h | 2 / 1: button, "Prüfen und fortsetzen" or "Erfassung beenden" (acknowledged end) | Field work pack opens the dialog after a refused change | same |
| 12 | Legacy open sequence | 2 to 3 / 1: any action bridges it | none | same |
| 13 | Stale version, network failure | error text in the dialog, retry by tapping the command again | banner on the dashboard and work pack | same |
| 14 | Clocked in elsewhere, approved vacation | dialog closes, error banner; the user must switch organization | same | same |
| 15 | State read failed | button disabled, `SectionError` with "Erneut laden" beside it | dialog shows the same with a retry | same |
| 16 | Manual same-day entry | not reachable from the button; `/zeiterfassung`, "Manuelle Eintragung", dialog, save (3 / 1 after navigation) | calendar day view | Enter submits (real form) |
| 17 | Time correction (P1-22) | not reachable from the button; `/zeiterfassung` history, entry, "Zeitkorrektur", form (4 or more / 1 after navigation) | calendar block | Enter submits |

Two facts stand out. The field work pack already reaches one tap for the three most common transitions because it knows the job; the button knows nothing and asks every time. And the dialog's confirm tap is pure overhead for the frequent flows: the user already said what they want by tapping the tile.

## The cropped header: reproduction and diagnosis

Reproduced on 2026-09-15 without a device. The component-contract harness rendered the real `ClockFAB`, `ClockStateProvider` and `TimeActivityDialog` with a stubbed clock read, with the CSS chunks of the owner's build (`.next/BUILD_ID` `8413d529-e457-4fe4-9440-345ce0fb0b82`, built 06:57 that morning) injected into the page, at 375×667, 390×844, 412×915 and 1280×800, light and dark. The owner's own screenshot did not reach the session (no attachment arrived), so the match between the two artefacts is for the owner to confirm; the reproduction shows a cropped selected tile directly under the header on every phone width.

Measured at 390×844 with the running state: dialog body top 446 px, first tile top 446 px, body `overflow-y: auto`, `padding-top: 0`, tile box-shadow `rgb(255,121,0) 0 0 0 2px`. The selected tile draws its 2 px orange ring outside its box; `DialogBody` is the scroll container and starts flush with the first tile row, so the ring's top edge and the tile's top corners are clipped, which reads as the header cutting into the card. The same clipping happens at the bottom edge when the body scrolls. On desktop the ring is clipped the same way but the wider dialog hides it better.

Fix, to land with the redesign (or alone if the owner wants it first):

- Tier 1 in the primitive: `DialogBody` keeps a small vertical inset (`py-0.5 -my-0.5`, matching its existing horizontal `-mx-4 px-4`), so outer rings and shadows of the first and last rows are not clipped at rest.
- Tier 1 in the tile: selection is drawn inside the box (`border-primary` plus a soft tint) rather than as an outer ring, which also keeps orange rare. Keep the ring for keyboard focus only.
- The job button gets `min-w-0` and loses `shrink-0` in that row, so "Lösen" stays on screen on phones.
- The description copy depends on the state ("Wähle, womit du startest." when clocked out).
- Tier 2: the harness gains the compiled CSS and a contract that asserts the selected tile's rect, including its ring, lies inside the body's client rect at 390 px, and that every clock-flow control is at least 44 px tall.

## Design proposal: minimal-click flows

The principle: the button opens a state-aware action list, not a form. The list shows the current state at the top (activity, job, running time, since when) and then only the next valid actions as large buttons that perform the transition on one tap, with the job carried along. Anything rarer (standby, call-out, internal activity, travel qualifiers, another job) sits behind one "Weitere Aktivitäten …" row that opens today's dialog content. Every action gives first-frame feedback and closes on success; failures stay at the point of action.

Proposed contents per state (German copy is provisional):

- Clocked out: "Arbeit starten" (unallocated, one tap), "Arbeit an Auftrag …" (opens the picker; today's dispatched jobs first), "Fahrt starten" (unallocated; qualifiers stay `unspecified` unless the user opens "Weitere Angaben"), "Weitere Aktivitäten …".
- Working on job X: "Pause" (manual rule only), "Fahrt (Auftrag X)" for the drive to the next site, "Auftrag wechseln …" (picker), "Erfassung beenden", "Weitere Aktivitäten …".
- Working without a job: "Auftrag zuordnen …" first, then the same.
- Travelling (job X): "Arbeit an Auftrag X" first (arrival), then "Pause", "Auftrag wechseln …", "Erfassung beenden".
- On a break: "Weiter: Auftrag X" (resume the job before the break, one tap), "Weiter ohne Auftrag", "Anderer Auftrag …", "Erfassung beenden".
- Recovery required: the warning block stays, with "Prüfen und fortsetzen" and "Erfassung beenden" as today.

Expected counts after the redesign, from the button:

| Flow | Today | Sheet only | Sheet plus hot keys |
| --- | --- | --- | --- |
| Clock in, no job | 2 | 2 | 2 |
| Clock in on a job | 5 | 4 (button, "Arbeit an Auftrag …", job row, "Einstempeln") or 3 with a one-tap job row | 3 |
| Start travel | 3 (+4 qualifiers) | 2 | 2 |
| Travel to work, same job | 3 | 2 | 2 |
| Start a break | 3 | 2 | 1 |
| End a break, same job | 6 | 2 | 1 |
| Switch job | 5 | 4 or 3 | 3 or 2 |
| Clock out | 2 | 2 | 2 (deliberately not a hot key) |

Hot keys above the button, if the owner wants them back: at most two labelled 44 px buttons that appear only while clocked in and show the two most likely next transitions of the current state: while working "Pause" and "Auftrag wechseln"; while travelling "Arbeit" (on the travel's job) and "Pause"; on a break "Weiter" (resumes the job before the break) and "Anderer Auftrag". Clock-out stays behind the sheet: a one-tap clock-out on a fixed button next to the page's scroll edge is the accidental tap the canon warns about, and undo for an ended session does not exist. The hot keys perform their action immediately with the pending spinner in the tapped button and stay disabled until the state is ready; the sheet is never needed for the two most frequent transitions. Their labels make them a Material 3 FAB menu in all but the transform animation, which the canon's reduced-motion rule would remove anyway.

The button itself: orange stays the clocked-out call to action (the `Play` icon). While working the button turns `success` with a slow glow (the existing `animate-green-glow` family, reduced-motion already handled globally) and a clock icon; while on a break it turns `warning` with the `Coffee` icon and the yellow glow. The pill shows activity, job and the running time (`hh:mm`), updated by the existing wall-clock tick pattern (`no-restricted-syntax` exception, one interval). The pill and the hot keys share one container so the layout never jumps. Dark mode uses the same tokens.

Desktop: the sheet renders as a small popover anchored above the button instead of a centered modal, so an office user clocking in does not lose their page context; keyboard users reach it with Tab, Enter or Space activates an action, Escape closes. No global shortcut in this step (an owner decision below). The dashboard's "Schnellzugriff" tiles render the same action list component so the app has one vocabulary for these transitions; the field work pack keeps its one-tap buttons.

Job picker: keep the flat list and search; sort assigned jobs planned today (P1-11 occurrence on the Berlin date, or an active P1-12 dispatch) into a "Heute geplant" group at the top, then the rest alphabetically; show the last job of the session as "Zuletzt" when it is not today's plan. No schema change: the reader joins occurrences for the date.

Realtime and readiness stay as they are: the sheet consumes `useClockState`, every action calls the existing transition helpers with the optimistic echo, and the disabled-until-ready rule holds for the sheet, the hot keys and the tiles.

## Research (2026-09-15)

Two research passes ran in parallel on 2026-09-15 (vendor help centers, app-store listings, platform guidelines, reviews; every claim dated and linked in the full reports, which the owner received as files in the session). "Not publicly evidenced" in the reports means the vendor's public pages do not document it. This section keeps what changes WerkFlow's design.

### Mobile time-clock patterns

- Tap counts to "working" in the documented products: Toggl 1 (play button, project optional), ToolTime 2, Meisterwerk 2 ("Arbeitstag starten", no project), Connecteam 2 (job required by default), plancraft 2 by marketing claim, Craftboxx 3 to 4 (Termin, Aktivität, "Zeit erfassen"), Craftnote about 6 (Plus, Stoppuhr, Projekt, Arbeitsart). WerkFlow today: 2 without a job, 5 with one.
- Breaks are one tap to start and one to end in Craftnote, ToolTime, Craftboxx and Clockodo. Ending a break opens a three-way dialog in Connecteam ("Return to the same job", "Switch jobs", "End your shift") and Craftboxx ("weiter wie zuvor" or new activity). timr's May 2024 release notes name "Verbesserte Vorschläge zum Fortsetzen nach Pausen", and its 2026 redesign resumes the last task in one click. Nobody makes the worker re-pick the job after a break; WerkFlow does (six taps).
- Travel is a segment type everywhere (Fahrzeit, Reisezeit), never a second clock; the drive-to-work switch costs 2 to 3 taps in every documented product and none does it in one. The German legal frame makes the boundary pay-relevant (driving oneself counts as working time under the ArbZG per KomNet NRW; the BRTV treats Wegezeit differently), which supports keeping the segment and cutting the taps.
- Running state is shown by a ticking timer, a persistent notification or lock-screen activity (Toggl, Clockify, Connecteam) and status text; no vendor documents a pulsing or color-coded control, and no product uses a FAB menu for clock actions. The FAB, where it exists, is "new entry" (Craftnote's Plus, Toggl's Play).
- Platform guidance: Material 3 allows a FAB menu of 2 to 6 labelled items that the FAB transforms into, with a 48 dp target and a close button that takes initial focus; the older speed dial rule was "at most two taps" to any destination; Apple asks for 44 pt targets, one or two prominent buttons per view, no frequent-interaction motion, and fades under Reduce Motion. WCAG 2.3.3 requires interaction-triggered motion to be disableable, which `globals.css` already does globally.
- Forgotten clock-outs are the top complaint class (Clockify's forum: forgot to start, forgot to stop). Products answer with a hard cut (ToolTime at midnight, Aplano at 03:00, Connecteam after N hours with a flag) or scheduled push reminders from the schedule (plancraft, HERO). WerkFlow's 24-hour recovery state is the flag; reminders and a configurable cut stay a later decision, noted for step 4.
- Review anti-patterns to avoid: layout shifts that cause wrong taps (Connecteam, Play review 2026-03), controls at the bottom edge becoming unreachable (Craftnote fix note 2026-09-11), a break that is "frustratingly difficult" (Connecteam), a stopwatch whose play button was never pressed (Craftboxx's own knowledge base), and no live overtime balance on the clock screen (ToolTime).

What this changes in the proposal: the hot keys should be the two most likely next transitions of the current state rather than two fixed buttons (while travelling: "Arbeit" and "Pause"; while working: "Pause" and "Auftrag wechseln"; on a break: "Weiter"), which is how the drive-to-work switch reaches one tap that no competitor documents. The pill needs the running time. The break resume must default to the previous job.

### Plantafel and calendar expectations

- Across 15 German products and 8 field-service boards, drag to move or reassign (21), absences and holidays in the row (16), an unplanned tray (13: Craftboxx "Nicht terminiert", KWP "geparkt", ServiceTitan job tray, Jobber unscheduled, Dynamics requirement pane), rows for vehicles, tools or machines (11), a double-booking warning or block (10), a map or route (9), field workers seeing only their own assignments (8), multi-assign (7), resize by dragging (7) and a capacity or utilisation indicator (7) are the shipped capabilities. Material readiness on the card: none. Free per-day notes on the board: one (Craftboxx's yellow "Kalendernotizen"). A read-only lock against accidental drags: one (Craftboxx "Lesemodus"). A full board on the phone: two.
- Mechanics worth copying: Craftboxx's toolbar modes (move, copy, remove assignment, assign) and its strict or permissive collision setting; Dynamics' "Move to", "Move by" and "Reassign to" commands for precision and multi-select; Odoo's diagonal stripes for unpublished shifts and grey for time off; ServiceTitan's rule that working or dispatched jobs cannot be dragged; openHandwerk's `Heute` button and range zoom; orgaMAX's `Sonderzeiten` row above the resource rows.
- Traps reviewers name: the board being desktop-only while the app shows "my day" and customers asking for it in the app (HERO); collision checks that ignore absences (Craftboxx) or let leave be planned over (Odoo forum); the board jumping to the first row after a reschedule and filters resetting between versions (Dynamics); a week hard-wired to start on Sunday (Dynamics); a drop that resizes the booking to "remaining duration" instead of the intended end; a paid board add-on (plancraft, about 40 € a month) as the most cited con; and the analog board's one strength nobody has replaced, "Notizen anbringen ohne technische Vorkenntnisse" (Craftboxx blog).
- Whiteboard products (planmachen.de's magnet-board feel, plantafel.digital) carry no customer, job or time data; Microsoft retired Outlook's free-form Board view in 2023; openHandwerk calls its structured timeline a "virtuelles Whiteboard". The evidence supports the structured board with a note affordance, not a canvas.
- Google Calendar's documented expectations (shortcuts must be enabled once): `t` today, `j`/`k` next and previous, `d`/`w`/`m` views, `c` create, `z` undo, `e` details, `/` search, `g` go to date; click an empty slot to create and drag down for a longer event; all-day events in a top row; the chosen view persists; week start is a setting; light, dark and device theme. Outlook adds `Ctrl+Alt+1/2/4` for day, week, month and a go-to-date command. Edge-drag resize and the current-time line are expected from community threads rather than documented.

What this changes in the proposal: the board gets a note affordance from day one (criterion 16 below, an owner decision on its shape), a read-only mode is worth its small cost (criterion 17), the collision rule must include absences (already the case in P1-11's assessment), and the keyboard set adopts Google's letters.

## The calendar and the Plantafel

A `Plantafel` is the trade's planning board: one row per employee (later per vehicle), one column per day, jobs as cards moved between them, capacity and absences visible per row. Every serious competitor in the landscape ships one. WerkFlow's week view already has employee rows and day columns; the owner's direction is to build the board up from that view rather than beside it: drag-and-drop dispatch between rows and days, capacity and absence overlays, a tray for parked work, later vehicles and tools (Wave 3 and later scope per `AGENTS.md`). This becomes its own planning slice placed in the roadmap immediately after this UX pass and before Wave 3 starts; this step's job is to fix the base calendar interactions the board will build on and to write that slice's acceptance criteria with the owner.

### What the week view already is, and what it lacks

It is a people-row day board with drag-and-drop dispatch from the Parkplatz and between rows, with time blocks beside the plan. It lacks, in order of what the board needs first: absences, holidays and closure days in the row (the data is in the window read, not passed to the view); capacity per person and day (an assessment exists per action, not per window); multi-day occurrences as bars spanning columns (today one badge per planned date); a horizon beyond one week; dispatch state on the card (acknowledged, challenged, not sent, "nicht möglich"); team grouping of rows (P1-09 teams); a visible current-day marker and today button inside the grid; keyboard and form alternatives for the drags; and a phone layout (the grid is `min-w-[1150px]` and scrolls sideways by canon exception, which is fine for the office and useless for the field, which never sees the board).

### Structured board, not a whiteboard

The owner asked whether the Plantafel should be a whiteboard where everybody writes notes. Recommendation: no free-form canvas. The board's value is that every card is a real occurrence with a job, a customer, assignees, a dispatch state and a capacity effect; a sticky note that is not one of those breaks every downstream contract (dispatch, acknowledgement, capacity, time). The whiteboard need that is real ("Meier am Mittwoch nur bis 12", "Lieferung Kessel Do") is already expressible: an all-day `internal` occurrence of kind `Sonstiges`, assigned or unassigned, with a title (P1-11 vocabulary). The board renders unassigned internal entries in a top "Ohne Zuweisung" row and assigned ones in the person's row, so office staff get their notes on the board without a second model. Whether a lighter per-day organization note (no assignee, no time, no capacity effect) is still wanted is an owner decision; if yes it is a small addition to the `internal` kinds, not a whiteboard.

### Material, tools and vehicles on the board

Inventory readiness reaches the board through the card, not through new rows in this slice. The dispatch readiness picture already reserves the slots: material "nicht reserviert" until `P1-26`, tools "nicht bewertet" until `P1-32`. The board shows those chips on the card exactly as the Einsätze panel does, so `P1-26` (reservations: reserved, partial, missing), `P1-27` (consumed), `P1-28` (vehicles as rows and in-transit stock), `P1-32` (tools as rows, custody) light them up without touching the board's model. The slice defines the chip slot and the row-kind extension point (`person` now; `vehicle`, `tool` later) and ships nothing speculative.

### Long-term picture of the calendars

- Day view: the hour grid for precise dispatch of one day, drag-to-create, resize, travel gaps; office and field.
- Plantafel (grows out of the week view): who is where on which day for one to six weeks; the office's main planning surface; rows are people now, resources later.
- Month view: overview, absences, holidays, closures, counts per day; office.
- Mein Einsatz (field, existing): the employee's own next actions; never the board.
- Later: a route/map day view when the provider decision (`P1-50`) is taken; external calendar subscription when its ownership model is decided.

The Google-Calendar expectations the research lists (today button, current-time line, Monday week start, drag to move, edge-drag to resize, undo after a move, keyboard t/d/w/m/j/k) apply to the day and month views today and to the board's horizontal axis; the day view has most of them, the week view has none of the keyboard ones. The board slice adopts them as acceptance criteria.

### Proposed slice: `P1-24a — Plantafel`

Placement: after this step, before `P1-25`, as the owner decided on 14 September. Direct dependencies `P1-04`, `P1-06`, `P1-08`, `P1-09`, `P1-11`, `P1-12`, `P1-14`; stores nothing new.

#### One view, not a fourth tab (owner decision 2026-09-15)

The owner asked whether the board is structurally different from the week view. It is not: both are people rows against day columns. The week view is the board at depth one: a single week, one badge per planned date, no absences, no capacity, no dispatch state, no team grouping, and recorded time blocks in the same cells. The board adds horizon, multi-day bars, overlays and states to that shape. So the slice replaces the week view's rendering with the board inside the same `CalendarView` value, the same tab position and the same range owner; there is no fourth tab. Managers see the tab as "Plantafel" (the buyer's word), employees see it as "Woche" and get the same component with their own single row, so `BASE-CALENDAR-F01` ("Handwerker ihre eigene") holds without a second code path. The current week view's one layer that the board must keep is actual time, as a toggle "Ist-Zeiten anzeigen" defaulting on for one week and off for longer horizons, because the calendar spec keeps planned and actual visible and distinct (`BASE-CALENDAR-F03`, `P1-21-F59`).

#### Lessons from the market, mapped to criteria

| Market failure (source in the research report) | What the slice does about it |
| --- | --- |
| Board desktop-only while the app shows "my day"; customers ask for it in the app (HERO) | The field worker's answer stays `Mein Einsatz` plus the own-row week; the board must be usable on a tablet in landscape (criterion 19), and the phone shows the own row, never a cropped grid. |
| Collision check ignores absences (Craftboxx); leave can be planned over (Odoo) | Every drop runs the P1-11 assessment, which already counts approved and pending absence, holidays and closure days; the criterion pins that the board never bypasses it (criterion 7). |
| Accidental drags need a lock mode (Craftboxx); working or dispatched jobs blocked from reassignment (ServiceTitan) | Read-only mode (criterion 17); a drop on an acknowledged dispatch shows the supersession preview before it applies, as the day view does today (criterion 7). |
| Board jumps to the first row after a reschedule; filters reset between versions (Dynamics) | Scroll position, horizon, filters and the read-only switch survive a save, a Realtime update and a reload, remembered per user (criterion 20). |
| Week starts on Sunday (Dynamics) | Monday, from the existing `getWeekDays`; weekends shaded, never hidden by default (criterion 3). |
| A drop resizes the booking to "remaining duration" (Dynamics) | A drop keeps the occurrence's duration and time of day; only an explicit edge drag changes length (criterion 7). |
| Personnel-only boards marked down by testers (plancraft, ToolTime) | Row kinds are an extension point from day one (`person` now, `vehicle` and `tool` later), so `P1-28` and `P1-32` add rows without a redesign (criterion 13 and the extension section). |
| The analog board's unmatched strength: "Notizen anbringen ohne technische Vorkenntnisse" (Craftboxx blog), and only one vendor with per-day notes | Notes in two clicks from the board (criterion 16). |
| Drag or resize silently breaking (the most common calendar complaint in Google's forums) | Every drop is optimistic under `beginMutation`, confirmed by a banner with Undo after persistence, rolled back with the error at the point of action (criterion 7); the component contract proves the rollback. |
| The board as a paid add-on (plancraft, about 40 € a month) is the most cited con | Not applicable to the product; noted for [offer.md](../../../product/offer.md) so the board is never packaged as an add-on. |

#### Integration with accepted slices

Every accepted slice the board touches, and what it reads from it; the board writes nothing new and calls only existing actions.

| Slice | The board reads | The board never |
| --- | --- | --- |
| `P1-01` customers and sites | Customer name and site address on the card | Copies them; the card references the occurrence's job |
| `P1-04` schedules, holidays, closures | Non-working days per person shaded from the schedule; holidays and closure days shade the column | Changes a schedule |
| `P1-06`, `P1-08` vacation, sickness | "Urlaub", dashed "angefragt", neutral "Abwesend" spanning their dates | Shows sickness type or evidence |
| `P1-09` teams and qualifications | Row grouping by team; the qualification check on every drop with the reasoned override dialog | Grants authority through a team |
| `P1-11` occurrences, series, capacity | Cards, bars, series marks, exceptions, skipped and cancelled states; per-cell capacity from the assessment | Rewrites a series from a single-occurrence drag; the existing "diese und zukünftige" dialog owns that |
| `P1-12` dispatch and commitments | Dispatch state chip per card; a move on a committed occurrence shows the commitment mismatch and requires re-commit or withdrawal as today | Sends a message or fabricates an acknowledgement |
| `P1-14` lifecycle, blockers, Parkplatz | Parked work in the tray; blocked and in-progress execution state as a card marker; parking and unparking through the existing atomic actions | Touches execution state from a planning move |
| `P1-16` field work pack | Nothing; `Mein Einsatz` is unchanged | Shows the board to employees |
| `P1-19`, `P1-20` service and maintenance visits | Service and maintenance visit jobs are ordinary cards with their job context | Changes cadence or next-due from a move |
| `P1-21`, `P1-22` actual time and corrections | The actual-time toggle renders the same projection with provisional badges | Creates or edits time from the board |
| `P1-24` people lifecycle | A row exists for each employee record active on the date; after an employment end the cells are shaded "nicht beschäftigt" | Shows suspended or ended people as plannable |

#### Extension points for later slices

Two seams ship with the slice so the later slices change values, not the board:

- Row kind. A row is `{ kind: 'person', employeeRecordId }` now; the type is a union with the layout and the drop handler keyed on it. `P1-28` adds `vehicle` rows with in-transit stock, `P1-32` adds `tool` rows with custody; a job dragged onto a resource row creates the resource assignment that those slices define. Until then the union has one member and no dead code.
- Card chips from the readiness function. The card renders the same readiness picture the Einsätze panel already computes (capacity, qualification, site and access, travel, material "nicht reserviert", tools "nicht bewertet"). `P1-26` turns material into reserved, partial or missing, `P1-27` adds consumed, `P1-32` turns tools into reserved or missing, `P1-50` turns travel into a real estimate. The board never computes readiness itself.

Also prepared, not built: `P1-33` ends a row at the offboarding date through the same P1-24 lifecycle read; `P1-46` may later offer "Kunden informieren" after a move as an explicit, opt-in follow-up (never automatic); `P1-49` gives the phone its own row view, not the board; Phase 2 planning proposals render as ghost cards that a manager accepts or rejects, using the same drop path.

#### Flows and tests

The slice gets its own catalog section, `P1-24a-F01` onward, covering at least: open the board at each horizon; today marker and navigation; team grouping and collapse; person rows and the "Ohne Zuweisung" row; timed cards, all-day bars, multi-day bars, series marks, skipped and cancelled cards; absences, holidays, closures and non-working days; capacity states and their explanations; every drop kind (reassign, move date, extend, park, unpark, multi-assign) with its warnings, override, supersession and commitment dialogs; keyboard and form alternatives; undo and rollback; notes; read-only mode; filters and search; per-user persistence; the actual-time toggle; freshness from another session; employee visibility (own row only); organization isolation; and the no-side-effect clauses (no message, reservation, order, time or execution change). Groups under decision 0007: `golden:p1-24a` (one journey across scheduling, dispatch and a cross-session move), an exhaustive audit spec registered like the Wave 2 ones, a `ui:contracts` board contract for drag, keyboard, rollback and read-only mode against the real range owner, a `@FRESHNESS` stage, and a registered measured scenario `navigation-to-usable-content` for the six-week window on the typical profile. The A1 calendar clauses that drive the current week view (`A1-21`, `A1-25`, `BASE-CALENDAR-F01` to `F04`) are repointed to the board in the same change.

#### Draft acceptance criteria

1. The board is the week view: the "Woche" tab position renders it for every role, labelled "Plantafel" for `admin` and `buero` and "Woche" for `employee`, whose board has exactly their own row.
2. Rows are active employees, grouped by P1-09 team with a collapsible team header, ordered by team then name; people without a login appear (they can be planned). An "Ohne Zuweisung" row at the top holds occurrences without assignees.
3. Columns are Berlin dates; the horizon is 1, 2, 4 or 6 weeks, chosen in the header and remembered per user; navigation by week, "Heute" scrolls the current date into view and marks it; weekends are visible but shaded; holidays and closure days shade the whole column with their label.
4. A card is one P1-11 occurrence: timed visits show start time and duration, all-day and multi-day occurrences render as one bar across their dates; cards show title, customer, place, job number and the P1-12 dispatch state (nicht gesendet, gesendet, bestätigt, Rückfrage, nicht möglich) as a chip; skipped and cancelled occurrences render muted and read-only; series occurrences carry the series mark.
5. Absences render in the row: approved vacation as "Urlaub", pending as dashed "angefragt", sickness as "Abwesend", spanning their dates; a person's row shows their schedule's non-working days shaded from P1-04.
6. Each person-day cell shows its capacity state from the P1-11 assessment for the visible window: free, partially planned, full, overbooked, with the planned and available minutes on hover and in a keyboard-reachable tooltip; the read is one window-level capacity call beside the existing window GET, never per cell.
7. Drag-and-drop: a card dragged to another row reassigns (same rules and confirmation dialogs as the day view: qualification, capacity, dispatch supersession); dragged to another column moves the date; the horizontal edge of an all-day bar extends or shortens it; dragged onto the Parkplatz parks it; a Parkplatz card dropped on a cell unparks it to that person and date. Every drop is optimistic with the calendar's `beginMutation` ownership, confirmed by a success banner with Undo after persistence, and rolled back on failure with the error at the point of action.
8. Keyboard and form alternative for every drag: a card is focusable; Enter opens its edit dialog where date and assignees change; the existing planning dialogs are the form path.
9. Multi-assign: an occurrence with several assignees shows one card per assignee row, linked visually on hover; a drop on another row of a linked card adds or moves that assignment as the day view does today.
10. Filters: team, employee, job, customer, dispatch state and "nur Konflikte"; the member filter of the calendar applies; a free-text search matches title, customer and job number.
11. Freshness: the board reads through the range owner; another session's move, park, dispatch or absence change appears within `LIVE_TARGET_MS`; the retained-grid, stale and error states of the window contract apply unchanged.
12. Performance: opening the board for a six-week window of the typical profile is a registered measured scenario with a reviewed budget; the window read stays one GET plus one capacity GET.
13. Readiness chips: material "nicht reserviert" and tools "nicht bewertet" on every card, from the same readiness function the Einsätze panel uses, so the Wave 3 slices only change the values.
14. Employees never see the board; their occurrence visibility and acknowledgement flows are unchanged; organization isolation is proven for the capacity read.
15. No new table, enum or Realtime subscription; no message, reservation or order is caused by a board action.
16. Notes: an office user can add a note to a day or to a person-day from the board in two clicks; it renders as a distinct card (no capacity effect, no dispatch) and is an all-day `internal` occurrence of kind `Sonstiges` unless the owner chooses a lighter note kind (decision 14).
17. A read-only mode ("Nur ansehen") switch in the board header disables every drag until switched back; it is per user and remembered, so a second monitor in the office can show the board without accidental moves.
18. Keyboard: `t` today, `j` / `k` next and previous window, `z` undo of the last board move while its Undo banner is visible; the shortcuts are listed in a `?` overlay and never fire inside an input or dialog.
19. Layout: the grid scrolls sideways inside its own region with a visible edge (the existing canon exception), the name column stays sticky, and the board is usable on a tablet in landscape; on a phone width the employee's own row renders as a list, never a cropped grid.
20. Persistence: horizon, filters, search, the read-only switch and the actual-time toggle are remembered per user and organization; scroll position and the selected card survive a save, a Realtime update and a manual refresh.
21. Actual time: the "Ist-Zeiten anzeigen" toggle renders recorded time blocks and provisional correction badges in the row from the shared projection, defaulting on for the one-week horizon and off otherwise.
22. Drops on dispatched or committed occurrences show the existing supersession and commitment-mismatch dialogs before applying; a drop keeps the occurrence's duration and time of day; a series occurrence asks "nur dieser" or "diese und zukünftige" as the day view does.

Open owner decisions for the slice are listed in the decision section below.

## Owner decisions (asked 2026-09-15, answered the same day)

The owner accepted every recommendation below on 2026-09-15 except decision 13, where the owner chose the single view: the Plantafel replaces the week view rather than sitting beside it (recorded in the slice section above). Decision 12's slice ID and placement stand.

1. **Hot keys.** Return two labelled 44 px hot keys above the button that show the current state's two most likely next transitions, fixed "Pause" and "Auftrag wechseln" only, one, or none. Recommendation: two state-dependent ones, clocked-in only, no clock-out hot key.
2. **Action list instead of the form dialog.** Confirm the state-aware list with one-tap transitions and "Weitere Aktivitäten …" for the rare kinds. The alternative the research shows (Toggl, Clockodo): the main button itself starts unallocated work on one tap while clocked out, with the job chosen afterwards. Recommendation: the list; an accidental one-tap start creates a real segment that only a correction request can remove, and SHK work is usually on a job.
3. **Resume job after a break.** Confirm that the state carries the job before the break and that "Weiter" resumes it by default. Recommendation: yes; a small state-builder change, no schema.
4. **Button look.** Green glowing while working, yellow glowing with the mug while on a break, orange at rest; the pill shows the running time. Recommendation: yes, tokens only.
5. **Travel qualifiers.** Start a drive with `unspecified` route and role and offer the qualifiers behind a disclosure. Recommendation: yes; the P1-21 flows F06 to F08 require the fields to exist, not to be filled every time.
6. **Job picker order.** Today's dispatched jobs first, then last job of the session, then alphabetical. Recommendation: yes.
7. **Desktop surface.** Popover anchored to the button instead of the centered modal; no global keyboard shortcut in this step. Recommendation: popover, no shortcut yet.
8. **Dashboard tiles.** Replace the three "Schnellzugriff" tiles with the same action list. Recommendation: yes.
9. **Cropped-tile fix.** Land the primitive inset and the inside-the-box selection with the redesign, not separately. Recommendation: with the redesign.
10. **D3 scope in this step.** Move only the Zeiterfassung page readers (nine Server Actions) and the job-detail readers to GET now, the rest later, or all now. Recommendation: Zeiterfassung and job detail now, as one aggregated GET per page, the rest as follow-up rows in the backlog.
11. **D5.** Confirm the 30-second threshold as decided. Recommendation: unchanged.
12. **Plantafel slice ID and placement.** `P1-24a`, after this step, before `P1-25`. Recommendation: yes.
13. **Woche tab.** Keep the week view beside the board for one slice, or make the board the week view directly. Recommendation was to keep both; the owner decided on 2026-09-15 that the board is the week view (one component, one tab position, "Plantafel" for managers, "Woche" for employees).
14. **Notes on the board.** Existing `Sonstiges` internal entries only, or an additional light per-day note kind. Recommendation: existing entries only until a customer asks.
15. **Verification scope for this step.** Minimal browser proof here (`ui:contracts`, `golden:p1-21`, `audit:performance:calendar-live`), the full suite in step 5 with a heads-up entry there. Recommendation: as the owner proposed on 15 September.

## Implementation record (2026-09-15)

Everything below landed on the same day as the decisions, in the order of the section that follows.

### What changed

- State: `LiveClockState` carries `resumeActivity` and `resumeJobInfo` (`lib/time-tracking/types.ts`), computed by `findResumeActivity` for canonical sessions (`lib/time-tracking/segments.ts`, unit-tested) and from the legacy event walk (`deriveCurrentClockState` keeps `resumeJobId`). The client schema, the placeholder state, the fixtures and the optimistic echo carry both fields; the echo keeps the resume pair through a break and takes the job title from either known job.
- Actions: `lib/time-tracking/clock-actions.ts` is the one derivation of next actions per state (`deriveClockActions`), of the two hot keys (`selectClockHotKeys`), of the activity a picked job continues (`selectionForPickedJob`) and of the transition error copy; seven unit tests pin the lists per state.
- Surfaces: `components/clock-action-list.tsx` renders that list with one tap per transition, the job picker for job choices, the full `TimeActivityDialog` behind "Weitere Aktivitäten …", the recovery block, readiness and retry, and the error at the point of action. `components/clock-fab.tsx` opens it in an anchored sheet ("Zeiterfassung starten" / "Laufende Zeiterfassung"), shows the state-dependent hot keys, the pill with the running time, and the green or yellow glowing button. The Zeiterfassung dashboard renders the same list; its three tiles and their provider helpers (`startBreak`, `endBreak`) are deleted.
- Picker: `getJobsForPicker` moved to `lib/time-tracking/picker-actions.ts` (the action module was at its line cap) and marks `plannedToday` from the caller's scheduled P1-11 visits on the Berlin date; the modal groups those first under "Heute geplant".
- Primitives: `DialogBody` keeps a 4 px vertical inset; `DialogContent` accepts `placement="anchored"`; the activity dialog draws selection inside the box, keeps "Lösen" on screen, adapts its copy and heading ("Aktivität wählen" when clocked out) and spans an odd last tile.
- D5: the provider tracks the absence and dispatches a catch-up only after `REALTIME_FOCUS_CATCH_UP_MIN_ABSENCE_MS` (30 s); reconnects unchanged; `tests/ui-contracts/calendar.spec.ts` proves 5 s, 40 s and the reconnect with a fake clock.
- D3: `lib/data/background-reads.ts` (closed registry, 17 kinds), `app/api/background-read/route.ts`, `lib/data/background-read-client.ts`; fifteen surfaces migrated (the Zeiterfassung page, the job page, member status); `POST /api/time-entries` deleted; `lib/data/background-read-http.test.ts` exercises the real route with seams and pins every migrated surface to the client.
- Harness: `tests/ui-contracts/run.ts` compiles `app/globals.css` with the Tailwind engine and hands the stylesheet to specs (`WERKFLOW_UI_CONTRACT_CSS`); the clock contract gained the resume-from-break and the styled 44 px and no-clipping checks.
- Found through the styled contract and fixed at Tier 1: `app/globals.css` set the default border color with an unlayered `*` rule, which beat every layered utility; `border-primary`, `border-destructive`, `border-warning/40` and the other fifteen opaque border colors in the app never rendered. The rule now lives in `@layer base`; the styled clock contract pins the selected tile's border color.
- Tests repointed: the five clock helpers in `tests/golden/support/steps/` (one file per domain since 2026-09-25) plus `openActivityDialogFromSheet`, `clockInConfirmationButton`, the P1-21 golden and audit specs; the dialog-contract, route-inventory, read-request-scope and duplicate-helper inventories carry the new dialog, route and modules.
- Docs: time-tracking baseline, the freshness contract (rule 2, background page reads), security (the background-read route), the backlog row, testing (harness stylesheet), the catalog flows `P1-21-F01`, `F09`, `F10`, `F19`, the design skill (registry rows, the inset and border-color rules), the roadmap (`P1-24a`), the step 5 heads-up, the progress log and the [P1-24a record](../slices/p1-24a-plantafel.md).

### Owner polish of 2026-09-17

After trying the flows the owner asked for four adjustments, all landed with the static and unit gates only (browser proof stays with step 5): the running-time counter in the pill is gone (a second clock beside the Zeiterfassung page's read as clutter and the two could drift); the brief error flash after every transition is fixed at Tier 1 in `hooks/use-live-view.ts`, whose read path now discards the failure that a read cancelled by a newer read reports through an honoured abort signal, so no live view can flash "nicht sicher geladen" while its replacement read is in flight; the full activity dialog disables its confirm when the built selection equals the running activity (`isSameActivitySelection`, unit-tested), matching the job picker's existing rule and the database's `no_change` answer; and the light background lost its warm tint (`--background` `#fafafb`) while the muted text darkened in both themes (`#5f5967`, `#a7a1b3`), checked by the contrast contract. Flow counts are unchanged.

The edge-case walk the owner asked for, per surface, with what already guards each case: hot keys and every list action are disabled until the state is ready and while any transition runs, so a double tap or a tap on a stale view cannot send two transitions; recovery hides the hot keys, so nothing bypasses its review; the automatic break rule hides "Pause"; the job picker preselects the running job in switch mode and keeps "Wechseln" disabled while that selection stands (the unallocated case preselects "Ohne Auftrag" and behaves the same); the full activity dialog disables its confirm for an unchanged selection, and the three clock contracts that confirmed the preselected activity now pick another tile first; a stale session version, another organization's open session, or approved vacation each map to their own German message, and the latter two also close the sheet; a hot key whose transition answers `recovery_required` opens the sheet, where the recovery block explains the review. On a break, "Anderer Auftrag …" lets the worker pick the remembered job as well; that resumes the job like the hot key does and is a real transition, so it stays allowed.

### CodeRabbit review of 2026-09-17

The owner asked why CodeRabbit had not run on this step: an oversight on my side, not a decision. It ran on 2026-09-17 through `bun run review`. The free plan refuses a single review above 150 files and the uncommitted tree holds 761 (steps 1 to 3 together), so the review went directory by directory over every directory this step touched (`lib/time-tracking`, `hooks`, `lib/data`, `components/ui`, `components/zeiterfassung`, `components/realtime`, `components/auftraege`, `components/inventar`, `app`, `scripts`, `tests`, `lib/testing`), plus a scratch clone at `HEAD` carrying only the ten changed top-level component files (the clock button, action list, activity dialog, job picker and providers), because `--dir` cannot name a file. The docs directories were not sent. The `scripts` scope needed a second run after a dropped review-service connection. Seventeen findings came back; sixteen were applied, one was skipped:

- This step's code: the resume lookup reported a failed `time_segments` read as "nothing to resume" (now `fetch_failed`, so a break never offers the wrong resume); the away timestamp of the D5 catch-up is seeded from the document's visibility at mount, so a provider mounted in a hidden tab still catches up on return; the live-view hook's catch path also discards an aborted read (the same rule as its result path); the test server's Realtime warm-up deletes its throwaway user on a failed warm-up as well as on release. The clock button, action list, activity dialog, picker and providers had no findings.
- Earlier steps' uncommitted code, fixed in passing because it ships in the same tree: the edit-project dialog omitted cleared fields, so a description, customer, project number or planned date could never be cleared (fields are now sent when they differ from the project, empty included); a paged project row derived its assignees from one page; the project job page hook kept an old error visible during a retry; the canonical segment reader logged the row-cap case as a query error; the searchable select rendered status rows and the load-more button inside the listbox; two pending badges used purple and orange instead of the warning tokens; the location dialog's callback ref is synced in a layout effect; a manual-entry time with an empty part parsed as zero; an audit spec accepted `NaN` date parts; a scenario measurement recorded a zero clock origin as fresh attribution; a calendar-window fixture proved request isolation with two different keys; an app-layout fixture asserted provider props that pass when the provider is absent.
- Skipped: a zero-minute planned duration on the field work pack renders as absent; a zero estimate is no estimate.

Every applied finding passed `tsc`, `lint`, the unit group (1,279 tests), `knip`, `docs:check`, `test:coverage` and the affected component contracts (clock, calendar catch-up, controls, options). The Aufträge dialog and table changes have no component contract; their browser coverage is the golden groups of step 5's release run.

### Owner decisions of 2026-09-17

After the polish and the CodeRabbit pass the owner accepted every recommendation: the polish stands as implemented, pending its own hands-on check; the yellow warning tone is the one color for every "waiting for approval" state, keeping orange for actions and purple for the calendar's planning meaning; "Anderer Auftrag …" on a break keeps offering the remembered job, since that is a real resume; the three judgment-call fixes in step 01 and 02 code (the select's status rows below the listbox, the project page hook's keep-last-known rows and hidden error during retry, the paged row's empty assignee fallback) are for those steps' agents to confirm against their plans; and steps 01 to 03 are committed together and pushed to the partner preview only after the step 01 and 02 CodeRabbit reviews are done and the gates are green, before steps 04 and 05. Nothing is committed or pushed until the owner asks.

### Counts after the change

From the button on a phone or on desktop (the sheet has the same content on both):

| Flow | Before | After |
| --- | --- | --- |
| Clock in, no job | 2 / 1 | 2 / 1 |
| Clock in on a job | 5 / 2 | 4 / 2 (button, "Arbeit an Auftrag …", job row, "Einstempeln") |
| Start travel | 3 / 1 (+4 qualifiers) | 2 / 1 |
| Travel to work, same job | 3 / 1 | 1 / 0 (hot key "Arbeit an <Auftrag>") |
| Start a break | 3 / 1 | 1 / 0 (hot key) |
| End a break, same job | 6 / 2 | 1 / 0 (hot key "Weiter: …") |
| End a break, no job | 3 / 1 | 1 / 0 or 2 / 1 |
| Switch job | 5 / 2 | 3 / 1 (hot key opens the sheet's picker, job row, "Wechseln") |
| Clock out | 2 / 1 | 2 / 1 |
| Standby, call-out, internal | 3 / 1 | 4 / 2 (behind "Weitere Aktivitäten …", by design) |

### Deletion pass and independent review

Deleted in the pass: the dashboard's three tiles and its `MenuCard` component, the provider's `startBreak` and `endBreak` helpers, the activity dialog's `initialActivity` prop, the `POST /api/time-entries` handler, the contrast test's `MenuCard` exemption, a first `findResumeActivity` helper (replaced by one session-wide query so a break across midnight still resumes its job), and the transition error map the dashboard duplicated. `knip`, the unused-local check and the duplicate-helper test are green.

An independent reviewer read the step's diff against the protocol's checklist and reported eleven findings; all were applied on the same day: a job-choice hot key now opens the sheet with its picker already open (the counts above hold); the resume lookup reads the whole session; the button's dead recovery branch and the list's redundant resume special case are gone; the unused dialog prop and the stale test exemption are deleted; the history's read failure shows German copy; the anchored sheet uses the body's padding; the recovery block explains once instead of prefixing every label; the dialog shows the resume job's title. One reported non-null assertion in the provider predates this step and was left for its own change. The reviewer confirmed the resume derivation on both capture paths, the optimistic echo, the action lists per state, the recovery routing, the route's authorization order, every migrated read shape, the D5 bookkeeping, and the sheet's accessibility.

### Evidence

- Static: `bunx tsc --noEmit` clean with both strict flags; `bun run lint` clean; `bun run unused:check` clean; `bun run docs:check` on 87 documents; `bun run test:coverage` (970 flows, 186 mappings, the four reconciled P1-21 bullets rehashed). `bun run test:unit`: 1,279 tests in 158 files after the polish.
- Verification report `2026-09-15T070003284Z-a9f3bf93` on the recorded local build: `ui:contracts` passed (60 contracts, including the resume-from-break, the styled 44 px and no-clipping checks, and the D5 absence contract) and `golden:p1-21` passed (run `2026-09-15T070355224Z-1f96f6`: clock-in on a job through the sheet, every activity kind through "Weitere Aktivitäten …", end, and the legacy bridge).
- `audit:performance:calendar-live` failed in that report (run `2026-09-15T070236269Z-aa79d9`: the closure reached the open month after 7,047 ms) and again in a fresh-world focused run (`2026-09-15T072733405Z-a39f26`, 12,706 ms). Diagnosis in the [incident log](../../../technical/test-incident-log.md): the local Realtime service drops its tenant database connection after idle and rebuilt it on each run's first subscription; the writes landed seconds after the replication slot was created. Nothing in this step touches that path (a two-page Playwright probe showed the non-acting page receives no blur, focus or visibility events, so the retired focus catch-up was never what carried earlier passes). Prevention at Tier 2: `bun run test:server local` now holds a Realtime subscription for its lifetime. On that warm server the stage measured 1,433 ms and 1,984 ms (focused diagnostic run `2026-09-15T084330647Z-f1e6ed`, both within target). The group's acceptance on this tree stays blocked by the attempt gate (the bounded retry needs a diagnostic replay of the retained world, which was cleaned first; the warm-up script is not one of the group's inputs), so its fresh pass belongs to step 5's release run on the warmed server. Both failed worlds are classified and cleaned; open retained worlds: 0.

## Implementation order (after the decisions)

1. State: `resumeJobId` in the clock state read and the client schema; job picker grouping; unit tests.
2. Primitive fixes: `DialogBody` inset, tile selection style, the job button row, state-dependent copy.
3. The action list component (one home, used by the button sheet, the desktop popover and the dashboard); hot keys; button states and pill timer; the dialog content behind "Weitere Aktivitäten …".
4. Test helpers: one helper per flow in `tests/golden/support/steps/` (one file per domain since 2026-09-25), updated names in the P1-21, A1 and canary specs, the `clock-readiness` contract extended (readiness, resume job, hot keys disabled until ready).
5. Harness CSS and the two layout contracts.
6. D5, then D3 for the two pages, each with its component contract.
7. Docs: time-tracking spec baseline, user-flow catalog (new flow IDs for the hot keys and the resume default), design skill registry row for the action list, this file, the roadmap checkpoint, the step 5 heads-up.
8. The `P1-24a` slice record under `../slices/` from the acceptance criteria above, and its roadmap row.
9. Verification: static groups, `unit:all`, `ui:contracts`, `golden:p1-21`, `audit:performance:calendar-live`; record the reports here.

## Acceptance for this step

- An inventory table of every clock-button flow with clicks and dialogs before and after, on mobile and desktop, in this file. (Done: the inventory and the counts after the change.)
- The cropped header reproduced, diagnosed and fixed, or shown not to exist with the owner's confirmation. (Reproduced, diagnosed and fixed in the primitives; the styled contract pins it.)
- Owner decisions recorded: hot keys, which flows get shortcuts, what the dialog shows first. (Recorded 2026-09-15.)
- Implementation verified by the measured groups above, then the Plantafel slice written under `../slices/` and placed in the roadmap. (Verified with `ui:contracts` and `golden:p1-21`; `audit:performance:calendar-live` diagnosed and handed to step 5 as recorded in the evidence; the `P1-24a` record exists and the roadmap carries it.)
