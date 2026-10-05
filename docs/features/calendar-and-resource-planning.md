# Calendar And Resource Planning

Status: living — last reviewed 2026-10-03

Calendar and resource planning (`Kalender` and `Einsatzplanung`) connects the work the business has promised with the people, time, tools, vehicles, locations and materials needed to deliver it.

It is the shared planning view for office staff. It does not become a generic personal calendar or a heavyweight project-management tool.

## Product Goal

WerkFlow lets an SHK business answer these questions fast:

- What is scheduled, unscheduled, delayed, blocked or due next?
- Which employee or team is responsible?
- Does the assigned team have the time, skills, tools, vehicle and material it needs?
- Where does the work happen, and how does it fit around other jobs?
- Which absences, working-time rules or customer commitments affect the plan?
- What changed, who changed it, and who needs to know?

The calendar reduces telephone coordination, paper schedules, duplicate entry, avoidable travel and uncertainty between the office and the field.

## Current Product Baseline

`/kalender` is the shared planning view for Admin and Büro. They schedule one-off and recurring job visits and internal entries, see capacity and qualification warnings, dispatch work, keep parked work in the `Parkplatz`, and record customer commitments separately from internal plans. Employees see only their assigned occurrences and confirm or challenge a dispatch. Actual working time appears in the calendar but stays separate from planned work.

### Views

- **Plantafel.** For Admin and Büro the week tab is the Plantafel: one row per active employee, grouped by team, and one column per Berlin date, over a horizon of one to six weeks. Timed visits are cards with a dispatch chip and a material chip. All-day and multi-day visits are bars. The row shows absences, closure days and the planned minutes against the target minutes of each person-day. Employees see the same tab as „Woche“ with only their own row.
- **Day.** On a desktop the day view shows people rows against the hour axis, with a tray for untimed entries, drag-to-create and 15-minute snapping.
- **Month.** The month grid grows with its content and opens overflow in a „+n mehr“ popover.
- **Phone.** Every role sees the week and the day as a list in time order, with the person's name on a card when more than one person is visible. The phone lists have no toolbar and no drag. A tap opens the details and editing flow.
- **Landing view and preferences.** The calendar stores view, horizon, density, weekends, filters and search per user and organization. The saved view is the landing view. Without one, managers land on the Plantafel and employees on the day. The „Arbeitszeiten“ toggle in the tab row is session state. A date can be bookmarked with `?date=YYYY-MM-DD`.
- **Loading.** Dates that the loaded window already covers appear at once. While an uncovered window loads, the grid stays visible but inert. A failed refresh marks the view as stale, and a failed first load offers a retry. [Realtime and caching](../technical/realtime-and-caching.md) owns the freshness model.
- **Design decisions.** The owner decided the calendar overhaul in the [P1-24a record](../plans/phase-1/slices/p1-24a-plantafel.md): the month view rebuilt without FullCalendar, a red-family now indicator, two densities, seven days without horizontal scroll at 1280 px, an in-house pointer-event drag engine, month drag, a weekend toggle, content-driven day rows, copy by `Alt`-drag.

### Planning gestures

- Managers create jobs and entries from the calendar. They move, resize and reassign them, park a visit by dropping it on the Parkplatz, and plan a parked job by dropping its card on the board. A manager can also create a manual time entry from the calendar.
- All views share one drag behavior. The card is at its target before the server answers. A refusal rolls the card back and shows the rule's sentence. After the server confirms the change, the calendar offers Undo.
- Every drag has a keyboard and form path. The card popover offers „Termin bearbeiten“, „Verschieben …“ and „Parken“. The Parkplatz card offers „Einplanen am …“. An empty person-day cell offers „Eintrag am … anlegen“. The key `c` opens the create dialog for the shown day, and the board grid is reachable with Tab and the arrow keys. Escape cancels a drag.
- The views apply the server rules at the pointer: absence, non-working day, employment, inactive occurrence, past midnight, and overlapping or future recorded time. A drop on an absence or a non-working day is refused at the pointer. With Shift the planner gets the confirmation dialog and can proceed. A drop outside the person's employment stays refused.
- On a desktop the Parkplatz panel sits beside the board, so every column stays a drop target. On a phone it covers the list.
- **Past and started visits.** A timed occurrence is history from its start instant, an all-day occurrence from its Berlin date. The database refuses any rewrite (`started_planning_occurrence_immutable`). The views show the same rule before anyone tries: the card carries a lock icon and cannot be dragged or resized, and the popover names the rule in place of the edit and move actions. There is no read-only switch. The owner removed „Nur ansehen“ because a per-user lock that changed nothing visible had no use.

### Planning rules

- **Planning occurrences.** Managers create timed or all-day job visits and internal entries of the kinds `Interne Arbeit`, `Besprechung`, `Schulung` and `Sonstiges`. An entry is one-off, multi-day, cross-midnight, or a daily, weekly or monthly series. A series has an 18-month horizon that extends in six-month steps. Editing one occurrence creates an exception. `diese und zukünftige` splits the series. Skipped and cancelled occurrences stay visible as history.
- **Assignments and identity.** Occurrence assignments use stable employee records, including people without a login, and control who sees the occurrence. Durable job access and responsibility stay with the job assignment. A job visit references the job's title, customer and location and does not copy them.
- **Team shortcuts.** A team in an assignment control expands to its members who are active on that date. Team membership grants no authority.
- **Qualification checks.** Every move, resize, schedule, unpark or reassignment runs the job qualification check again. A confirmation dialog explains the gaps. A manager can override only with a recorded reason. The optional apprentice signal warns and never blocks.
- **Capacity.** Each planning action computes minutes per person and Berlin date from schedules and their labeled fallback, holidays, closure days, approved and pending absence, and overlapping occurrences. A warning names every affected person and date. A manager can override only with a reason tied to that exact assessment. Changed facts force a fresh decision. An unexplained error never stops a legitimate exception.
- **Bounded pickers.** Planning forms search employees, jobs and teams on the server in bounded pages and keep the current selection across searches. No form preloads the whole organization, so company size does not block planning.
- **Absence and holiday context.** The views show public holidays and **Betriebsruhe** as labeled context that cannot be edited. Approved vacation shows as „Urlaub – Name“, a pending request dashed with „(angefragt)“, and sickness as the neutral „Abwesend – Name“. Sickness type and evidence never reach the calendar. A person's non-working days are shaded, and the days before entry or after exit are hatched.

### Dispatch, commitments and parked work

- **Dispatch.** A dispatch is a versioned work instruction for exactly one scheduled visit or one unscheduled job ([decision 0002](../decisions/0002-dispatch-revision-acknowledgement-identity.md)). Any material change to schedule, location, note or recipients supersedes the current revision in the same transaction, so a moved visit never appears acknowledged from stale state. Parking cancels active dispatches. A person without a login shows „nicht möglich" and never a fabricated confirmation.
- **The Einsätze panel.** Managers see the recipient states per visit and resolve a challenge with a keep-with-reason decision. They issue a dispatch with a readiness picture: capacity and qualification, site and access, explicit travel gaps, material always „nicht reserviert", and tools always „nicht bewertet" until `P1-32`. Batch rescheduling previews conflicts, invalidated acknowledgements and affected commitments, then applies as one all-or-nothing move.
- **Acknowledgement.** Employees confirm or challenge on the job detail under **Mein Einsatz** and on `/aufgaben`. An acknowledgement never implies attendance, recorded time or a customer promise.
- **Customer commitments.** An office user can record an agreed day and arrival window per occurrence. A schedule move never rewrites a commitment. A mismatch requires an explicit re-commit or a withdrawal with a reason. No planning action sends a message. Outbound messages are `P1-46`.
- **Parked work.** The `Parkplatz` is the `parking` kind of the shared blocker model. Parking and unparking are one atomic manager action with reason, responsible person, review date and immutable history. Customer and priority come from the job. Planning changes touch the planned state only and never overwrite execution state.

### Connected work

- **Templates and readiness on jobs.** Work-creation dialogs offer a published work template. Applying one never creates or changes series, occurrences, assignments, dispatches, commitments or time. Job detail and the field work pack reuse the same readiness picture. The first job-linked clock-in starts execution. Schedule and dispatch changes never do.
- **Service visits.** A reactive service case links to one existing job and then uses the normal visit and dispatch path. A manager creates a maintenance visit job, then schedules its occurrence in a separate action. Compatible due items can share a visit. The plan owns cadence and next-due, and the calendar owns the appointment. Moving the appointment never rewrites the maintenance definition.
- **Actual time.** Working-time blocks show the same effective time as every other time reader, with open proposals shown as provisional. Planning moves and dispatches never create or rewrite actual time. A correction never reschedules planned work.
- **Recorded-time correction gestures (owner decision).** Dragging or resizing a completed recorded block opens a form with the proposed times and the employee prefilled. The gesture itself saves nothing. A reason is required. Submission uses the audited correction process of [time tracking](time-tracking.md), with its authority, second-person approval and closed-period rules. The calendar refuses active, partial, stale or mixed sources and leaves the form open. An approved correction preserves work, break, travel and standby details. A pending approval does not become confirmed time. Planning Undo is separate.

### Important Current Limitations

- A failed preference save keeps the local value for the session only.
- A job parked before the Parkplatz context existed shows „Kontext fehlt (Altbestand)“. It can be planned only after a manager adds its context in the Parkplatz. Until then a drag onto the board is refused at the pointer, and „Einplanen am …“ is not offered.
- The day view lists the members with a login, and „Ohne Zuweisung“ for managers. A visit assigned to a personnel record without a login shows under „Ohne Zuweisung“ there, while the Plantafel shows it in that person's row. A day row per employee record is an open follow-up of `P1-24a`.
- Route and travel-time providers, tool and vehicle reservation, material reservation, external calendar sync and outbound customer messages are not implemented. Readiness signals say so and do not guess.
- On-call coverage, training absence and other absence types are not planned yet.
- There is no dedicated overdue-work view.
- A schedule edit in the job form changes the job's legacy visit only ([the rules](../technical/data-model.md#job-team-and-visit-plan)). On a job with several visits that visit need not be the first, so the form can show a date that differs from the first visit until the next planning action, and clearing the date cancels only that visit. The edit also moves a legacy visit that has already started. Owner decision open.
- The calendar's "today" is the Berlin business date on every device, and the calendar moves to a new day at the Berlin date change. Times still show in the browser's time zone, so on a browser outside Europe/Berlin the now line of the day view sits at the edge of the day while the two dates differ.
- The day view shades a person's whole non-working days and absences. It does not shade the hours outside a person's schedule (`P1-24a` decision).
- The board's readiness chip covers planned material only: „Material nicht reserviert“ when the job has planned material lines. A tools chip is not shown, because no tool assessment exists before Wave 3.

## Phase 1 — Complete Operational Core

Phase 1 is not a minimal calendar. It establishes the planning depth expected from a complete trade-business suite and keeps the default experience clear. The sections below state the full intent. The Current Product Baseline says what exists.

### Calendar Entries And Time Models

The product distinguishes these entry types:

- jobs and project work;
- service and maintenance appointments;
- internal appointments, training, meetings and non-customer work;
- employee availability, vacation, sickness and other absences;
- on-call or emergency-service coverage;
- deadlines, milestones and customer commitments;
- working-time records, shown as actual history and not as planned work.

Planned and actual information look different on every entry. Moving a job never rewrites recorded working time, and correcting working time never reschedules the job.

Expected depth:

- timed, all-day, multi-day and cross-midnight entries;
- recurring entries, editable series, and exceptions to one occurrence that keep the series;
- organization working hours, employee schedules, German public holidays and configurable business closures;
- time zones where relevant, with the normal German single-time-zone case kept simple;
- a clear status for tentative, confirmed, in progress, completed, canceled and parked work;
- preparation, travel, execution and follow-up time where the business needs the distinction;
- links to the responsible customer, site, project, job, service asset and documents.

### Dispatch And Backlog Planning

Office staff see scheduled, parked and blocked work in one planning flow. They schedule one job for several employees without duplicate job records, split work across visits or days, reschedule in batches after an absence, weather, a supplier delay or a customer change, and rely on an audit trail for material schedule changes. A dispatch reaches the affected employees as an acknowledgement task, so the office sends no separate manual messages.

The `Parkplatz` is a deliberate operational state, not a hiding place for incomplete data. Parked work keeps its reason, its responsible office user and its next review.

Still open: a dedicated overdue-work view, and external delivery of dispatch changes (`P1-46`).

### People, Teams, Skills, And Capacity

Planning uses employee information without exposing private personnel data. It plans around date-effective schedules, absences, qualifications, date-effective team membership and the planned workload per person and date.

Still open: training and other absence types, and on-call coverage.

### Tools, Vehicles, Locations, And Materials

Resource planning covers more than employee availability:

- tools and individually tracked equipment required for work;
- vehicles and their availability;
- warehouse or pickup location;
- planned material readiness and unresolved shortages;
- customer site and access constraints;
- required permits, keys, documents or safety equipment.

The calendar shows readiness and conflicts. Inventory, purchasing and asset state stay with their feature areas. Calendar records do not duplicate them.

### Route And Location Awareness

For mobile work, the plan supports:

- map context for scheduled and unscheduled jobs;
- travel-time and distance awareness;
- configurable travel or preparation buffers;
- recognition of appointments that cannot be reached in time;
- route ordering for a day or team;
- direct navigation from the field experience.

A route suggestion optimizes operational time. It never hides the customer commitments or business priorities it would change.

### Customer Commitments And Communication

The schedule distinguishes an internal plan from a promise communicated to a customer.

Phase 1 supports:

- appointment confirmation state;
- a customer-facing arrival window where the exact internal timing stays private;
- reminders and change notifications through configured communication channels;
- a record of what was sent and when;
- reusable German message templates;
- cancellation or rescheduling reasons;
- a clear handoff to customer communication, in place of untracked copy and paste.

No customer message is sent because a planner dragged an event, unless the business has explicitly enabled and reviewed that behavior.

### External Calendar Interoperability

Businesses may need WerkFlow alongside personal or corporate calendars. The product defines:

- calendar export or subscription for relevant WerkFlow appointments;
- optional Microsoft 365, Outlook, Google Calendar or standard calendar interoperability;
- which system owns an event;
- one-way or bidirectional synchronization;
- duplicate prevention and conflict behavior;
- visibility rules for private external appointments;
- organization offboarding and revocation behavior.

External-calendar work is a decision gate until the ownership and conflict model is clear. "Calendar integration" never means an ambiguous sync that creates duplicate or stale appointments.

### Search, Filters, Views, And Planning Signals

The calendar stays useful as data volume grows:

- fast search by customer, job number, employee, site or free text;
- saved filters and default views that fit the role;
- team, employee, project, job, region, status and resource filters;
- visible collisions, overdue work, missing assignment, missing duration and material-readiness warnings;
- workload and utilization summaries that do not turn the calendar into a reporting dashboard;
- print and export only where they support a real operational fallback.

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

Every handoff references the same underlying customer, site, job, person, resource and document. It creates no calendar-specific copy.

## Role And UX Principles

- `admin` and `buero` need dense but readable planning, conflict resolution and cross-team visibility.
- `employee` users need a focused personal schedule with the next action, navigation, job context, readiness and change acknowledgement.
- Apprentices see who they work with and what is expected, without unnecessary commercial or personnel information.
- Route, capacity, resource and recurrence controls stay out of the default path until they are relevant.
- Drag-and-drop has accessible keyboard and form-based alternatives.
- Every significant move makes its impact clear before customer messages, reservations or dependent visits change.
- Mobile scheduling shows offline and sync state. It never implies that a change reached the office when it has not.
- Colors supplement labels and icons. Color is never the only carrier of status.

## Phase 2 — Intelligence And Automation

Once calendar, job, employee, inventory and customer data are reliable, intelligence can assist with:

- suggesting employees or teams based on availability, skills, location and required equipment;
- proposing a route or daily sequence and explaining the expected benefit;
- detecting impossible travel, overbooking, missing qualifications or material-readiness risk;
- proposing rescheduling options when someone is absent or a delivery is late;
- turning a customer request into a draft appointment with a review step;
- generating a plain-language daily brief for office staff or field workers;
- forecasting capacity and identifying future bottlenecks;
- triggering approved reminders, preparation tasks or customer updates.

The system starts with proposals and previews. Automatic rescheduling, customer communication or resource commitments require explicit organization rules, permission checks, audit history and a clear recovery path. [AI automations](ai-automations.md) owns the shared rules.

## Boundaries And Decision Gates

- WerkFlow does not become a generic personal calendar or meeting product.
- Calendar does not own payroll calculations, stock counts, personnel documents or invoices.
- Native route optimization is not a commitment until address quality and scheduling constraints are reliable.
- External-calendar synchronization requires a clear ownership and conflict model before implementation.
- GPS and location use needs a defined operational purpose, a permission model, a retention policy and an employee-privacy review.
- Labor-law configuration must be validated with qualified German legal and payroll expertise. The product documentation is not legal advice.
- Automatic customer messages, reservations or orders caused by schedule changes are opt-in and auditable.
- A vehicle stays an inventory location with an optional asset instance (`P1-32`). A vehicle row on the Plantafel stays deferred until a customer asks. `P1-28` keeps the seam.

## Open Product Decisions

- Whether entry types beyond the bounded internal kinds are operationally necessary.
- Whether later service automation should propose visit jobs closer to the due date. Today a manager creates each maintenance visit job and schedules its occurrence deliberately.
- How job and project progress should summarize multi-visit completion. Visit planning keeps one underlying job.
- Which supervision rules are needed beyond qualification coverage and the optional apprentice warning.
- How `P1-26` and `P1-32` connect material and tool availability to calendar readiness while reservation and custody stay with inventory.
- Which map, travel-time and navigation providers fit the German market and its privacy requirements. Until `P1-50` selects a provider, travel feasibility is computed only from explicit same-site and zero-gap facts, and everything else is labeled „nicht bewertet".
- Which customer reminder channels come first. Today the product records manual commitments only, and every outbound channel is `P1-46`.
- Whether a one-way calendar subscription is sufficient before bidirectional Google or Microsoft synchronization.
