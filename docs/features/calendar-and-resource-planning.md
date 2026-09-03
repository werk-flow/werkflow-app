# Calendar And Resource Planning

Status: living — last reviewed 2026-09-03

Calendar and resource planning (`Kalender` and `Einsatzplanung`) connects the work the business has promised with the people, time, tools, vehicles, locations, and materials needed to deliver it.

It should become the shared operational planning surface for office staff without turning into a generic personal calendar or a heavyweight project-management tool.

## Product Goal

WerkFlow should let an SHK business answer these questions quickly:

- What is scheduled, unscheduled, delayed, blocked, or due next?
- Which employee or team is responsible?
- Does the assigned team have the time, skills, tools, vehicle, and material needed?
- Where will the work happen, and how does it fit around other jobs?
- Which absences, working-time rules, or customer commitments affect the plan?
- What changed, who changed it, and who needs to be informed?

The calendar should reduce telephone coordination, paper schedules, duplicate entry, avoidable travel, and uncertainty between the office and field.

## Current Product Baseline

As of 2026-09-02, `/kalender` is the shared planning surface for Admin and Büro: they schedule one-off and recurring job visits and internal entries, see capacity and qualification warnings, dispatch work, keep parked work in the `Parkplatz`, and record customer commitments separately from the internal plan. Employees see only the occurrences assigned to them and confirm or challenge their dispatch. Actual working time appears in the same calendar but stays structurally separate from planned work.

- Views and direct manipulation. Day, week, and month views with filters for employees, working hours, and jobs. Managers create jobs from the calendar, move and resize them, reassign between employees, and drag between the `Parkplatz` and the schedule; manual time entries can be created from the calendar ([Grundstock](../product/user-flow-catalog.md#grundstock-vor-phase-1-stand-vor-p1-00-4-august-2026)).
- Absence and holiday context. The month view shows public holidays and **Betriebsruhe** as labeled, non-interactive entries, approved vacation as „Urlaub – Name" with pending requests dashed and marked „angefragt", and sickness as the neutral „Abwesend – Name". The calendar shows who is unavailable when and never why; managers see everyone, employees only themselves ([P1-04](../plans/phase-1/slices/p1-04-work-schedules-and-holidays.md), [P1-06](../plans/phase-1/slices/p1-06-vacation.md), [P1-08](../plans/phase-1/slices/p1-08-sickness.md)).
- Team shortcuts and qualification checks. A team in an assignment control expands to its members active on that date without granting authority. Every move, resize, schedule, unpark, or reassignment re-runs the job qualification check; gaps are explained in a confirmation dialog and can be overridden only with a recorded reason ([P1-09](../plans/phase-1/slices/p1-09-teams-and-qualifications.md)).
- Planning occurrences. Managers create timed or all-day job visits and internal entries of the kinds `Interne Arbeit`, `Besprechung`, `Schulung`, and `Sonstiges` as one-off, multi-day, cross-midnight, or daily, weekly, or monthly series with an 18-month horizon that extends in six-month steps. Editing one occurrence creates an exception, `diese und zukünftige` splits the series, and skipped or cancelled occurrences stay visible history ([P1-11](../plans/phase-1/slices/p1-11-planning-occurrences.md)).
- Capacity. Each planning action computes per-person minutes per Berlin date from schedules and their labeled fallback, holidays, closure days, approved and pending absence, and overlapping occurrences. Warnings name every affected person and date and are overridable only with a reason tied to the exact assessment; changed facts force a fresh decision ([P1-11](../plans/phase-1/slices/p1-11-planning-occurrences.md)).
- Assignments and identity. Occurrence assignments use stable employee records, including people without a login, and control occurrence visibility; durable job access and responsibility stay with the job assignment. A job visit references the job's title, customer, and location instead of copying them ([P1-11](../plans/phase-1/slices/p1-11-planning-occurrences.md)).
- Dispatch. A dispatch is a versioned work instruction for exactly one scheduled visit or one unscheduled job. Any material change to schedule, location, note, or recipients supersedes the current revision in the same transaction, so a moved visit can never appear acknowledged from stale state; parking cancels active dispatches, and people without a login show „nicht möglich" instead of a fabricated confirmation ([P1-12](../plans/phase-1/slices/p1-12-dispatch.md)).
- The **Einsätze** panel. Managers see per-visit recipient states, resolve challenges with a keep-with-reason decision, and issue dispatch with a readiness picture that combines capacity and qualification, site and access, explicit travel gaps, material always „nicht reserviert", and tools always „nicht bewertet" until `P1-32`. Batch rescheduling previews conflicts, invalidated acknowledgements, and affected commitments, then applies as one all-or-nothing move. Employees confirm or challenge on the job detail under **Mein Einsatz** and on `/aufgaben`; acknowledgement never implies attendance, recorded time, or a customer promise ([P1-12](../plans/phase-1/slices/p1-12-dispatch.md)).
- Customer commitments. An office user can record an agreed day and arrival window per occurrence. Schedule moves never rewrite a commitment; a mismatch requires an explicit re-commit or withdrawal with reason, and no planning action sends a message, which is `P1-46` ([P1-12](../plans/phase-1/slices/p1-12-dispatch.md)).
- Parked work. The `Parkplatz` is the `parking` kind of the shared blocker model: parking and unparking are one atomic manager action with reason, responsible person, review date, and immutable history. Planning changes touch the planned facet only and never overwrite execution state ([P1-14](../plans/phase-1/slices/p1-14-work-lifecycle.md)).
- Templates and readiness on jobs. Work-creation dialogs offer a published work template; applying one never creates or changes series, occurrences, assignments, dispatches, commitments, or time. Job detail and the field work pack reuse the same readiness picture, and the first job-linked clock-in starts execution while schedule and dispatch changes never do ([P1-13](../plans/phase-1/slices/p1-13-work-templates.md), [P1-14](../plans/phase-1/slices/p1-14-work-lifecycle.md), [P1-16](../plans/phase-1/slices/p1-16-field-work-pack.md)).
- Service visits. A reactive service case is linked to one existing job and then uses the normal visit and dispatch path. A maintenance due item deliberately creates one visit job and one normal occurrence; the plan owns cadence and next-due, the calendar owns the appointment, and moving it never rewrites the maintenance definition ([P1-19](../plans/phase-1/slices/p1-19-reactive-service.md), [P1-20](../plans/phase-1/slices/p1-20-maintenance-plans.md)).
- Actual time. Working-time blocks use the same projection of legacy entries, canonical segments, and approved corrections as every other time reader, with open proposals shown as provisional. Planning moves and dispatches never create or rewrite actual time, and a correction never reschedules planned work ([P1-21](../plans/phase-1/slices/p1-21-time-segments.md), [P1-22](../plans/phase-1/slices/p1-22-time-corrections-and-approvals.md)).

### Important current limitations

- Route and travel-time providers, tool and vehicle reservation, material reservation, external calendar sync, and outbound customer messages are not implemented; readiness signals say so instead of guessing.
- On-call coverage, training absence, and other absence types are not planned yet.
- There is no dedicated overdue-work view.

Before changing current behavior, verify role rules, action validation, and live data structures in code and Supabase.

## Phase 1 — Complete Operational Core

Phase 1 is not a minimal calendar. It should establish the planning depth expected from a complete trade-business operating suite while keeping the default experience clear.

### Calendar Entries And Time Models

The product should support clearly differentiated entry types:

- jobs and project work;
- service and maintenance appointments;
- internal appointments, training, meetings, and non-customer work;
- employee availability, vacation, sickness, and other absences;
- on-call or emergency-service coverage;
- deadlines, milestones, and customer commitments;
- working-time records shown as actual history rather than planned work.

Each entry should make planned and actual information visually distinct. Moving a job must not silently rewrite recorded working time, and correcting working time must not silently reschedule the job.

Expected depth includes:

- timed, all-day, multi-day, and cross-midnight entries;
- recurring entries and editable series;
- exceptions to one occurrence without losing the series;
- organization working hours, employee schedules, German public holidays, and configurable business closures;
- time zones where relevant, while keeping the normal German single-time-zone case simple;
- clear status for tentative, confirmed, in progress, completed, canceled, and parked work;
- preparation, travel, execution, and follow-up time where the business needs that distinction;
- links to the responsible customer, site, project, job, service asset, and documents.

### Dispatch And Backlog Planning

Office staff can:

- see scheduled, parked and blocked work in one planning flow, since `P1-12` and `P1-14`; a dedicated overdue-work view stays open;
- drag work onto a date, time or employee since the pre-roadmap baseline, and onto a team through the `P1-09` team shortcut;
- schedule one job for multiple employees without duplicate job records, since the baseline and `P1-11` occurrence assignments;
- split work across visits or days when one appointment is not enough, since `P1-11`;
- batch reschedule work after absence, weather, supplier delay, or customer change, since `P1-12`;
- park work intentionally without losing why it was parked, since `P1-14`;
- rely on an audit trail for material scheduling changes, since `P1-11` occurrence events and `P1-12` dispatch revisions;
- reach affected employees without separate manual messages: a dispatch appears as an acknowledgement task on `/aufgaben` since `P1-12`; external delivery stays `P1-46`;
- see whether a field worker has acknowledged a newly assigned or materially changed appointment, since `P1-12`.

The `Parkplatz` is a deliberate operational state, not a hiding place for incomplete data. Since `P1-14` parked work retains reason, responsible office user and next-review context; customer and priority come from the job.

### People, Teams, Skills, And Capacity

Planning should use employee information without exposing private personnel data.

Since `P1-11`, the capacity assessment plans around:

- date-effective working schedules and the labeled schedule fallback, since `P1-04` and `P1-11`;
- approved vacation, sickness and provisional pending vacation, since `P1-11`; training and other absence types stay open;
- skills, certifications and required job qualifications, since `P1-09` and `P1-11`;
- date-effective team membership, since `P1-09` and `P1-11`;
- the optional apprentice signal, since `P1-09`; it warns and never blocks;
- planned workload and remaining minutes per person and Berlin date, since `P1-11`.

On-call coverage is not planned yet.

Capacity warnings explain every affected person and date and allow a manager to override with a reason tied to the exact assessment fingerprint, since `P1-11`. Legitimate exceptions are never stopped by an unexplained error.

### Tools, Vehicles, Locations, And Materials

Resource planning should eventually include more than employee availability:

- tools and individually tracked equipment required for work;
- vehicles and their availability;
- warehouse or pickup location;
- planned material readiness and unresolved shortages;
- customer site and access constraints;
- required permits, keys, documents, or safety equipment.

The calendar should surface readiness and conflicts. Inventory, purchasing, and asset state remain owned by their respective feature areas rather than being duplicated inside calendar records.

### Route And Location Awareness

For mobile work, the plan should support:

- map context for scheduled and unscheduled jobs;
- travel-time and distance awareness;
- configurable travel or preparation buffers;
- recognition of appointments that cannot realistically be reached in time;
- route ordering for a day or team;
- direct navigation from the field experience.

Route suggestions should optimize operational time without hiding the customer commitments or business priorities they would change.

### Customer Commitments And Communication

The schedule should distinguish an internal plan from a promise communicated to a customer.

Phase 1 should support:

- appointment confirmation state;
- customer-facing arrival window where exact internal timing should remain private;
- reminders and change notifications through configured communication channels;
- a record of what was sent and when;
- reusable German message templates;
- cancellation or rescheduling reasons;
- a clear handoff to customer communication rather than untracked copy/paste.

No customer message should be sent merely because a planner dragged an event unless the business has explicitly enabled and reviewed that behavior.

### External Calendar Interoperability

Businesses may need WerkFlow alongside personal or corporate calendars. The product should define:

- calendar export/subscription for relevant WerkFlow appointments;
- optional Microsoft 365, Outlook, Google Calendar, or standard calendar interoperability;
- which system owns an event;
- one-way versus bidirectional synchronization;
- duplicate prevention and conflict behavior;
- visibility rules for private external appointments;
- organization offboarding and revocation behavior.

External-calendar work is a decision gate until the ownership and conflict model is clear. “Calendar integration” should never mean an ambiguous sync that creates duplicate or stale appointments.

### Search, Filters, Views, And Planning Signals

The calendar should remain useful as data volume grows:

- fast search by customer, job number, employee, site, or free text;
- saved filters and role-appropriate default views;
- team, employee, project, job, region, status, and resource filters;
- visible collisions, overdue work, missing assignment, missing duration, and material-readiness warnings;
- workload and utilization summaries without turning the calendar into a reporting dashboard;
- print/export only where it supports a real operational fallback.

## Connected Workflow Contracts

Calendar is a coordinating view, not the owner of every connected object.

| Feature area | Calendar receives | Calendar provides |
| --- | --- | --- |
| Customers and CRM | Customer, site, contact preference, access notes, and communicated availability | Planned/confirmed appointment history and change context |
| Jobs and projects | Work scope, status, priority, duration estimate, dependencies, and assignments | Planned dates, visits, resource allocation, and schedule changes |
| Service and maintenance | Recurring service demand, asset/site context, contract interval, and emergency priority | Dispatch, visit schedule, team assignment, and appointment status |
| Employee management | Role, working schedule, skills, certifications, team, and availability | Planned workload, assignments, and coordination context |
| Time tracking | Actual work, travel, breaks, absences, and approved corrections | Planned work context for comparison; never replacement of actual time |
| Inventory | Material readiness, reservations, tools, assets, and vehicle availability | Required-by dates and job/resource demand |
| Documents | Plans, access instructions, permits, reports, and appointment attachments | Calendar context without creating duplicate files |
| Commercial and finance | Customer commitments, contract milestones, and billable visit context | Completion and visit evidence for downstream commercial workflows |
| AI automations | Approved triggers, constraints, and calendar availability | Explainable planning proposals and events for authorized workflows |

Every handoff should reference the same underlying customer, site, job, person, resource, and document rather than creating calendar-specific copies.

## Role And UX Principles

- `admin` and `buero` need dense but readable planning, conflict resolution, and cross-team visibility.
- `employee` users need a focused personal schedule with the next action, navigation, job context, readiness, and change acknowledgement.
- Apprentices should see who they work with and what is expected without being exposed to unnecessary commercial or personnel information.
- Progressive disclosure should keep route, capacity, resource, and recurrence controls out of the default path until they are relevant.
- Drag-and-drop must have accessible keyboard and form-based alternatives.
- Every significant move should make its impact clear before customer messages, reservations, or dependent visits change.
- Mobile scheduling must show offline/sync state and never imply that a change reached the office when it has not.
- Colors should supplement labels and icons, not become the only carrier of status.

## Phase 2 — Intelligence And Automation

Once calendar, job, employee, inventory, and customer data are reliable, intelligence can assist with:

- suggesting employees or teams based on availability, skills, location, and required equipment;
- proposing a route or daily sequence and explaining the expected benefit;
- detecting impossible travel, overbooking, missing qualifications, or material-readiness risk;
- proposing rescheduling options when someone is absent or a delivery is late;
- turning a customer request into a draft appointment with a review step;
- generating a plain-language daily brief for office staff or field workers;
- forecasting capacity and identifying future bottlenecks;
- triggering approved reminders, preparation tasks, or customer updates.

The system should start with proposals and previews. Automatic rescheduling, customer communication, or resource commitments require explicit organization rules, permission checks, audit history, and a clear recovery path.

## Boundaries And Decision Gates

- WerkFlow should not become a generic personal calendar or meeting product.
- Calendar does not own payroll calculations, stock counts, personnel documents, or invoices.
- Native route optimization is not a commitment until address quality and scheduling constraints are reliable.
- External-calendar synchronization requires a clear ownership and conflict model before implementation.
- GPS/location use must have a defined operational purpose, permission model, retention policy, and employee-privacy review.
- Labor-law configuration must be validated with qualified German legal/payroll expertise; the product documentation is not legal advice.
- Automatic customer messages, reservations, or orders caused by schedule changes must be opt-in and auditable.

## Open Product Decisions

- Whether additional non-job entry types beyond the bounded `P1-11` internal vocabulary are operationally necessary.
- Whether later service automation should propose visit jobs closer to the due date; P1-20 requires a manager to create each normal visit job and schedule its P1-11 occurrence deliberately.
- How later job/project progress should summarize multi-visit completion; `P1-11` owns visit planning and preserves one underlying job.
- Which employee skills, qualifications, and supervision rules should affect scheduling?
- ~~Should tools and vehicles be reserved from the calendar or only surfaced as readiness signals?~~ Decided for this phase with P1-12: readiness signals only, honestly labeled „nicht bewertet" until `P1-32` owns tool availability/custody; reservation semantics remain `P1-26`/`P1-32` scope.
- Which map, travel-time, and navigation providers fit the German market and privacy requirements? (P1-12 deliberately computes travel feasibility only from explicit same-site/zero-gap facts and labels everything else „nicht bewertet"; provider selection stays `P1-50`.)
- Which customer reminder channels should be supported first? (P1-12 records manual commitments only; every actual outbound channel stays `P1-46`.)
- Is one-way calendar subscription sufficient before bidirectional Google/Microsoft synchronization?
- ~~How should field workers acknowledge or challenge schedule changes?~~ Decided with P1-12: revision-bound acknowledgement per (dispatch revision, employee record) with one primary confirm action, a reasoned challenge path, manager keep-with-reason resolution, and transactional invalidation on material changes (decision record 0002).
- ~~Which planning conflicts are warnings, and which must block confirmation?~~ Decided for this phase with P1-12: every planning conflict remains an explainable warning with a reasoned, fingerprinted override; only structural invalidity (stale version, cancelled target, cross-organization reference) blocks. Revisit only with real operational evidence.

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, and links to per-slice acceptance records.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
- [Realtime and caching](../technical/realtime-and-caching.md) — the freshness model the calendar relies on.
