# P1-24a — Plantafel

Status: living — last reviewed 2026-09-15; slice plan written before implementation, the slice has not started

## Bounded Outcome

The calendar's week view becomes the `Plantafel`: a people-row board over one to six weeks with multi-day bars, absences, holidays, closure days and capacity in the row, dispatch state on every card, drag-and-drop dispatch between rows and days with keyboard and form alternatives, the Parkplatz as a drag source, notes, a read-only mode and per-user persistence. It stores nothing new and calls only existing actions. Employees see the same component with their own single row.

The owner decided on 2026-09-15 that the board replaces the week view rather than sitting beside it; the discovery and the market evidence are in [pre-Wave-3 step 3](../pre-wave-3/03-clock-fab-and-calendar-ux.md#the-calendar-and-the-plantafel).

## Primary User And Roles

- `admin` and `buero` plan on the board: they see every active employee, drag, park, unpark, add notes and switch the read-only mode.
- `employee` sees the board as "Woche" with exactly their own row; no drag, no other people, no capacity of others.
- Outsiders and members of another organization see nothing of the board's data.

## Verified Current Baseline

Verified on 2026-09-15 in the code:

- `components/kalender/week-view/week-view.tsx` (893 lines) is a people-row day board: one row per member, seven day columns, a `min-w-[1150px]` grid with a sticky name column, up to three time blocks and three job badges per cell with "+n mehr", unassigned jobs in the day header, drag of job badges between rows and days and from the Parkplatz, drag of closed time sessions, a cell click that opens the member-day dialog. Managers see the members selected in the filter; employees see only themselves.
- The week view receives no absence, holiday, closure or capacity data. Absences render in the month view only. Capacity exists per planning action (`CapacityEvaluation` in `lib/planning/types.ts`), not per displayed window.
- `components/kalender/use-calendar-range-data.ts` and `GET /api/calendar-window` already return occurrences, time entries, vacation, sickness and holiday context for a window. `PlanningCalendarEntry` carries no dispatch state; the Einsätze panel reads it through `getDispatchOverview`.
- Only the month view uses FullCalendar (`calendar-container.tsx:1609`); the day and week views are hand-rolled and share the container's range owner, mutation ownership and drag state.

## Direct Prerequisites And Evidence

`P1-04`, `P1-06`, `P1-08`, `P1-09`, `P1-11`, `P1-12`, `P1-14`, all accepted. Pre-Wave-3 step 3 (the clock button and the base calendar interactions) precedes this slice.

## Primary And Connected Feature Contracts

Primary: [calendar and resource planning](../../../features/calendar-and-resource-planning.md). Connected: employee management (schedules, absences, teams, lifecycle), jobs and projects (lifecycle, Parkplatz), service and maintenance (visit jobs as ordinary cards), time tracking (the actual-time toggle reads the shared projection), inventory (readiness chips through the existing readiness function, values from Wave 3). The integration table in the [step 3 record](../pre-wave-3/03-clock-fab-and-calendar-ux.md#integration-with-accepted-slices) names what the board reads from each and what it never does.

## In Scope

- Replace the week view's rendering with the board inside the same `CalendarView` value and tab position.
- Horizon of 1, 2, 4 or 6 weeks; today marker; Monday start; shaded weekends, holidays, closure days and per-person non-working days.
- Rows: active employees grouped by team, an "Ohne Zuweisung" row; row kind as a union with `person` as the only member.
- Cards: timed visits, all-day and multi-day bars, series marks, skipped and cancelled states, dispatch state chip, readiness chips from the shared readiness function.
- Absences in the row; per-cell capacity from one window-level capacity read beside the window GET.
- Drops: reassign, move date, extend all-day bars by edge drag, park, unpark, multi-assign, with the existing qualification, capacity, supersession, commitment and series dialogs; optimistic under `beginMutation` with Undo and rollback.
- Keyboard and form alternatives; `t`, `j`, `k`, `z` shortcuts with a `?` overlay.
- Notes as all-day `internal` occurrences of kind `Sonstiges`; read-only mode; filters and search; per-user persistence; the actual-time toggle.
- Tablet landscape usability; the employee's own row as a list at phone width.
- A registered measured scenario for the six-week window.

## Explicit Non-Goals

- Vehicle, tool or material rows (`P1-28`, `P1-32`; the row-kind union is the seam).
- Material or tool readiness values (`P1-26`, `P1-27`, `P1-32`); the chips show "nicht reserviert" and "nicht bewertet".
- Route or map view, travel-time estimates (`P1-50`).
- Customer messages after a move (`P1-46`), automatic proposals (Phase 2).
- A free-form whiteboard canvas; project-level Gantt bars; a phone layout of the whole board (`P1-49` gives the phone its own row view).
- Any new table, enum, Realtime subscription, message, reservation or order.

## Product Decisions Required Before Coding

Decided by the owner on 2026-09-15 (recorded in the step 3 record): the board is the week view, labelled "Plantafel" for managers and "Woche" for employees; notes reuse the `Sonstiges` internal kind (a lighter note kind only if a customer asks); the read-only mode is in scope; the slice ID and placement are `P1-24a` before `P1-25`.

Open before coding: none. The visual design of cards and capacity colors follows the `werkflow-design` skill (purple for planning entities, semantic status colors, orange only for the selected card and the primary action).

## Data Ownership And Historical Semantics

The board owns no data. Occurrences, assignments, dispatches, absences, schedules, capacity assessments and time projections keep their owners; every board action calls the owning action and the owner's history rules apply unchanged. Per-user board preferences (horizon, filters, read-only, actual-time toggle) are stored with the existing organization-scoped user preferences.

## Permissions And Organization Isolation

Reads go through the existing window GET (organization-scoped, role-filtered) plus one capacity read with the same authorization. Employees receive only their own occurrences and never another person's capacity or absence. Every drop calls an existing manager-only action that re-authorizes. The capacity read is proven to deny outsiders and to exclude other members' data for employees.

## UI And Field-Worker Behavior

Employees keep `Mein Einsatz` and see the board only as their own row with no drag. Managers get the dense board. Every drag has a keyboard and form path. Colors supplement labels and icons and never carry status alone.

## Realtime, Caching, Offline, And Failure Recovery

The board consumes the range owner: retained grid, stale and error states, mutation ownership, Undo after persistence and rollback with the error at the point of action apply unchanged. Another session's change reaches the board within `LIVE_TARGET_MS`. No offline queue.

## Migration And Rollback

No schema change. Rollback is the previous week view rendering; preferences left behind are harmless.

## User Flows (Catalog IDs)

`P1-24a-F01` onward, proposed to the owner before implementation as the protocol requires, covering: opening at each horizon; today marker and navigation; team grouping and collapse; person rows and the "Ohne Zuweisung" row; timed cards, all-day, multi-day, series, skipped and cancelled cards; absences, holidays, closures and non-working days; capacity states and their explanation; every drop kind with its warnings and dialogs; keyboard and form alternatives; Undo and rollback; notes; read-only mode; filters and search; persistence; the actual-time toggle; freshness; employee visibility; organization isolation; the no-side-effect clauses. The A1 calendar clauses that drive the current week view (`A1-21`, `A1-25`, `BASE-CALENDAR-F01` to `F04`) are repointed in the same change.

## Acceptance Criteria

The 22 criteria in the [step 3 record](../pre-wave-3/03-clock-fab-and-calendar-ux.md#draft-acceptance-criteria) are this slice's acceptance criteria; they move here verbatim when the slice starts, and the market-failure table there stays the rationale.

## Clause Coverage And Executable Groups

`golden:p1-24a` (one journey across scheduling, dispatch and a cross-session move), an exhaustive audit spec registered like the Wave 2 ones, a `ui:contracts` board contract for drag, keyboard, rollback and read-only mode against the real range owner, a `@FRESHNESS` stage, and a registered measured scenario `navigation-to-usable-content` for the six-week window on the typical profile.

## Automated And Manual Verification

Per [decision 0007](../../../decisions/0007-independent-test-groups.md): the static groups, `unit:all`, the groups above, and the affected A1 calendar clauses. Rendered review in both themes at desktop, tablet landscape and 375 px.

## Documentation Updates

Calendar spec baseline and open decisions, user-flow catalog, design skill (board interaction rows), realtime-and-caching (the capacity read), roadmap, this record.

## Deletion Pass And Review

To be recorded at closure.

## Completion Evidence

To be recorded at closure.
