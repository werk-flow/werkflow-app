# Calendar And Resource Planning

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

The current `/kalender` implementation already includes:

- day, week, and month views;
- job events and derived working-time blocks in the same planning context;
- manager views across organization members and employee-focused visibility;
- filters for employees, working hours, and jobs;
- creation of jobs and manual time entries from the calendar;
- moving and resizing scheduled work;
- employee assignment and reassignment;
- a `Parkplatz` for intentionally unscheduled or parked jobs;
- drag-and-drop scheduling between the `Parkplatz` and calendar;
- pending time-change visualization and entry detail flows;
- Realtime refresh behavior and undo feedback for selected planning actions;
- since `P1-04`: the organization's public holidays (selected regional calendar) and closure days („Betriebsruhe") shown as labeled, non-interactive all-day context in the month view — display-only planning context; capacity, conflicts, and per-employee availability remain `P1-11` scope;
- since `P1-06`: vacation absence as a differentiated, non-interactive all-day entry type in the month view („Urlaub – <Name>", calm purple planning state). Approved and requested absence stay visually distinct — pending requests render provisionally („angefragt", dashed) and never count as approved availability. Managers see all members' vacation; employees see their own. The display deliberately carries minimal detail so `P1-08` sickness can reuse it with even less. Capacity/conflict behavior remains `P1-11` scope.

This is an operational scheduling foundation. It is not yet the complete resource-planning, recurring-event, route, external-calendar, or maintenance scheduling product described below.

Before changing current behavior, verify role rules, current action validation, and live data structures in code and Supabase.

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

Office staff should be able to:

- see scheduled, unscheduled, overdue, and blocked work in one planning flow;
- drag work onto a date, time, employee, or team;
- schedule one job for multiple employees without duplicate job records;
- split work across visits or days when one appointment is not enough;
- batch reschedule work after absence, weather, supplier delay, or customer change;
- park work intentionally without losing why it was parked;
- preserve an audit trail for material scheduling changes;
- notify affected employees without requiring separate manual messages;
- see whether a field worker has acknowledged a newly assigned or materially changed appointment.

The `Parkplatz` should remain a deliberate operational state, not become a hiding place for incomplete data. Parked work should retain customer, priority, reason, responsible office user, and next-review context where applicable.

### People, Teams, Skills, And Capacity

Planning should use employee information without exposing private personnel data.

Managers should be able to plan around:

- contracted or configured working schedules;
- vacation, sickness, training, and other availability;
- skills, trade specializations, certifications, and required qualifications;
- team or crew membership;
- apprentice supervision requirements;
- on-call coverage;
- planned workload and remaining capacity.

Capacity warnings should explain the conflict and allow an authorized user to make a deliberate override. They should not prevent legitimate exceptions with an unexplained error.

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

- Which non-job entry types belong in the first complete calendar?
- Should recurring series create future jobs immediately or generate them closer to the due date?
- How should multi-day and multi-visit work appear in jobs and project progress?
- Which employee skills, qualifications, and supervision rules should affect scheduling?
- Should tools and vehicles be reserved from the calendar or only surfaced as readiness signals?
- Which map, travel-time, and navigation providers fit the German market and privacy requirements?
- Which customer reminder channels should be supported first?
- Is one-way calendar subscription sufficient before bidirectional Google/Microsoft synchronization?
- How should field workers acknowledge or challenge schedule changes?
- Which planning conflicts are warnings, and which must block confirmation?

## Related Docs

- [Product capability map](../product/product-capability-map.md)
- [Phase 1 build roadmap](../plans/phase-1-build-roadmap.md)
- [Competitive landscape](../product/competitive-landscape.md)
- [Jobs and projects](./jobs-and-projects.md)
- [Customers and CRM](./customers-and-crm.md)
- [Service and maintenance](./service-and-maintenance.md)
- [Employee management](./employee-management.md)
- [Time tracking](./time-tracking.md)
- [Inventory](./inventory.md)
- [Document management](./document-management.md)
- [Commercial and finance](./commercial-and-finance.md)
- [AI automations](./ai-automations.md)
