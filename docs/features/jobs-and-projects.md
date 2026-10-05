# Jobs And Projects

Status: living — last reviewed 2026-10-04

Jobs (`Aufträge`) and projects (`Projekte`) are WerkFlow's central work objects. A job is work a team plans, performs, documents, and completes. A project groups related work when the business needs a larger delivery context. A simple service visit or small order never needs a project.

## Product Goal

WerkFlow gives an SHK business one path from a customer request to documented completion and handover. At every point the people involved can answer:

- What was requested and what outcome was agreed?
- Is this a standalone job or part of a project?
- What happens next, what is blocked, and who is responsible?
- When and where does the work happen, and with which people, instructions, material, documents, and customer decisions?
- What actually happened on site?
- Is the work ready for handover, service follow-up, and commercial processing?

The goal is not a generic project-management suite. It is an operational record that cuts duplicate entry, missing documentation, forgotten material, disputed change work, and the office effort of reconstructing a job afterwards. [Competitive landscape](../product/competitive-landscape.md) holds the market evidence.

## Current Product Baseline

Admin and Büro create and steer jobs and projects from request handoff through an explicit execution lifecycle, structured site evidence, and an office-reviewed handover. Assigned field workers work from one focused job view. Future work preserves this behavior unless a deliberate migration replaces it.

- **Lists.** Search, filters, status counts, and sorting cover all authorized work, not only the visible page. Active, parked, and archived work have separate filters. No date window hides older jobs. Project summaries cover every child. A failed read shows the failure with a retry, never an empty list. [Server-paginated lists](../technical/realtime-and-caching.md#server-paginated-lists) owns the technical rules.
- **Numbers.** Jobs, projects and requests get a yearly number such as `AUF-2026-001`. The count keeps at least three digits and grows past 999 without a collision. Lists and the equipment and dependency pickers order numbers by value, so `AUF-2026-1000` follows `AUF-2026-999`. The [data model](../technical/data-model.md) owns the numbering rule for every record type.
- **Work structure.** A job is standalone or belongs to one project. A project can exist without jobs and receive jobs later. A standalone job has its own customer. Jobs in a project use the project's customer, and changing it changes their customer too. Creating a job saves it with its assignments and its work template, and creating a project saves it with its template, all or nothing. Editing a job saves its fields and its assignments together. Editing a project's customer moves its jobs in the same save. A refused step leaves the work unchanged. Deleting a project only unlinks its jobs. A job with planned visits or event history cannot be hard-deleted, and the manager sees why.
- **Request and service handoff.** An `Anfrage` converts exactly once into a new job or project and carries customer, contact, site, summary, urgency, and attachments over. Managers see the originating request. Creating work without a request stays a first-class path. A service case links to one existing job. The case owns intake, triage, and outcome. The job owns scheduling, dispatch, execution, evidence, material, and completion.
- **Site and contact.** A job references one `Einsatzort` and one `Ansprechpartner` of its customer. A project default prefills new jobs, and each job can override it. Selecting a site copies its address into the job as a snapshot that later site edits never change. Changing the customer clears the old customer's references, also on child jobs. The assigned field worker sees the address, access notes, and a contact to call with one tap.
- **Execution lifecycle.** Work is not started, in progress, interrupted, execution complete, handed over, or cancelled. Every transition is audited. Planning, readiness, blockers, and parking are separate facets, so scheduled work can be blocked and field-complete work can await handover. Work created before the lifecycle existed keeps its legacy status until its first explicit lifecycle action. Lists, headers and detail fields show one label per state: the work state, or the legacy status marked „Altbestand“ while no work state exists. Completion records the actual date, and reopening clears it.
- **Time drives the lifecycle.** The first job-linked clock-in, break end, or call-out start moves not-started or interrupted work to in progress, together with the time event. A blocked or finished job rejects the time event. Travel never starts the lifecycle.
- **Projects.** Project execution derives from its children unless a manager sets an override with a reason. Overrides never cascade. Parking a project parks its unfinished children. An employee with a job in the project sees the project's work state read-only.
- **Blockers, dependencies, and gates.** Work can carry several blockers, each with a reason, a responsible person, a review date, and a resolution. Parking is a blocker kind, not an execution state. It cancels the schedule and active dispatches and leaves execution alone. Unparking a job into the schedule lifts the parking and saves the new plan together, so a refused plan leaves the job parked. Dependencies on a job, project, instruction, approval, delivery, site, or other trade block the start, block completion, or warn. Start and completion gates check current facts. A manager exception needs a reason and is recorded.
- **Readiness and dispatch.** Readiness shows each dimension as ok, warning, or unknown. WerkFlow stores no ready flag. Material shows as not reserved and tools as not assessed. Dispatch is a separate, audited step: a versioned dispatch targets one scheduled visit or one unscheduled job, and assigned employees confirm or challenge the current revision in `Mein Einsatz`. Acknowledgement never stands in for attendance, recorded time, or a customer promise. [Calendar and resource planning](./calendar-and-resource-planning.md) and [decision 0002](../decisions/0002-dispatch-revision-acknowledgement-identity.md) own the details.
- **Planned visits.** A job can have several planned visits. Recurring planning creates visits, not extra jobs. The job's planned date, duration, and assignees follow its current visit plan ([the rules](../technical/data-model.md#job-team-and-visit-plan)). Planned visits and actual time stay separate. Parked jobs leave the scheduled calendar.
- **Assignment and qualifications.** Managers assign one or more members to a job. Employees see work through assignments and reach a project only through assigned work. When a job's skill or certification requirements are not covered by the assignees, the assignment needs a reasoned assessment. Requirements guide planning and claim no legal authorization. Before an employment change, managers reassign active work explicitly. Suspending access removes operational access and keeps assignments.
- **Field work pack.** Assigned employees get one mobile-first view of their job: customer, site, and contact, one next action, instructions, evidence, documents, own time, material, and open issues. It leaves out sibling and project-wide detail, coworker drafts, document governance, and commercial facts. Employees start, interrupt, resume, and complete execution, report their own blocker, and see the customer-safe handover summary. Creation, editing, assignment, cancellation, handover, parking, dependencies, gate exceptions, and project overrides stay with managers.
- **Instructions and templates.** Jobs and projects have ordered, required or optional instruction items. Managers maintain them. Adding, deleting, or reordering an item renumbers the list in the same save. Assigned employees complete or reopen them, and WerkFlow keeps the last actor and time. Admin and Büro manage templates in `Arbeitsvorlagen`. Every published template version is immutable. Applying a version creates editable instructions, material, and requirements that record the exact version. Later template edits never rewrite the work, and the same version cannot be applied twice to one target. Applying a template only plans: it moves no stock and creates no visit, dispatch, assignment, time, document, approval, or message.
- **Site evidence.** Jobs and projects share one `Arbeitsnachweise` section for Bautagebuch, Arbeitsbericht, Aufmaß, Mangel, and Regie- or Änderungsnachweis. Each record keeps numbered revisions that never change. Reviews, customer outcomes, signatures, document links, and exports bind to one exact revision. A decided record is corrected by a new revision or voided, never deleted. Field workers capture evidence on their assigned work and export the reports of their own jobs. Managers also review, record customer outcomes, void with a reason, and export project reports. An export stores the report as a document linked to the work and to the exact revision in one step. Exporting an unchanged revision again returns the existing document. Required evidence and outcomes feed the completion gates.
- **Office handover.** Büro and Admin hand over execution-complete work by picking exact evidence revisions, document versions, and, for projects, child handovers. Gates sort hard blockers, reasoned exceptions, warnings, and unassessed areas. One release freezes the customer-safe package and marks the work handed over. A release never changes. Withdrawing it returns the work to execution complete and opens a new draft. The commercial-readiness result is not billing approval.
- **Installed equipment.** Service equipment links installation, commissioning, service, removal, or replacement to a job, project, evidence revision, or handover. The work stays the operational owner. Field workers see only equipment linked to their own job, and the link grants no further access.
- **Time, documents, and material.** Time references one job or stays unallocated, and projects sum their jobs. `Dokumente & Bilder` links work to the central documents. Assigned employees upload and view on their jobs, and view the project's own documents on a project in which they have a job. `Material & Inventar` follows the [inventory baseline](./inventory.md#current-product-baseline).

### Important Current Limitations

- A request cannot yet update existing work.
- Customer delivery of a handover package, billing, material consumption, and offline or mobile behavior are later scope.
- Site evidence is not a handover package, commercial acceptance, invoice basis, or qualified electronic signature.
- There is no planned-versus-actual or profitability view.
- Offers, contracts, invoices, payments, and accounting do not exist.
- There is no offline job pack and no React Native employee app.

## Phase 1 — Complete Operational Core

This section describes what jobs and projects need before they count as a mature core. Delivery can come in steps. A partial delivery is not the completed phase.

### 1. Request-To-Work Handoff

- A request becomes a job, a project, or an addition to existing work without retyping anything.
- Office users create work directly when there is no request. A CRM funnel never becomes mandatory for repeat work.
- The work shows the original request and what changed during qualification, so the field team gets the accepted scope, not a raw message thread.
- Urgent faults, scheduled service, quoted installations, construction work, warranty issues, and internal work are distinguishable for planning and reporting.
- Commercial acceptance can release work for execution. The commercial feature owns quote, contract, and order rules.

### 2. Standalone Jobs And Project Structure

- A small repair is a complete job with the same documentation, time, material, completion, and handover as a job inside a project.
- Projects can group phases, areas, trades, or work packages without forcing a complex hierarchy on every business.
- Jobs move into, between, and out of projects with a preview of the effect on customer, site, schedule, documents, material, and reporting.
- Project-level information stays separate from job-specific instructions and evidence.
- Managers can copy a job or project. Copied assignments, dates, customer data, private notes, and evidence need deliberate confirmation.

### 3. Templates, Checklists, And Tasks

- Templates prepare scope, steps, required evidence, roles, material demand, safety checks, and completion conditions for recurring SHK work. They never commit stock or calendar capacity.
- Later template changes never rewrite active or completed work without a reviewed update.
- Tasks have an owner, due context, status, and a link to the job, phase, defect, measurement, approval, or change work.
- Field workers see the next practical actions. Office users see the full plan, responsibility, and exceptions.
- Template texts are natural German and organization-specific without heavy configuration.

### 4. Status, Readiness, Dependencies, And Exceptions

- Each status means one operational situation. Every visible state implies a next action and a responsible role. A new state needs a new product decision.
- A blocked record names why, who resolves it, and when it is reviewed next. Blocked work never vanishes into a passive status.
- Readiness shows missing prerequisites before dispatch: site access, customer availability, skills, material and tools, approved scope, documents, and safety information.
- Completion gates check instructions, time and material, measurements, defects, customer decisions, and handover evidence. A manager overrides a gate only with an audited reason.
- Cancellation, postponement, and parking stay distinct. Each keeps the history and says what happens next.

### 5. Scheduling, Capacity, And Assignment

[Calendar and resource planning](./calendar-and-resource-planning.md) owns scheduling. Jobs and projects add these rules:

- Assignment supports individuals and teams and keeps the responsible lead.
- Multi-day and split work shows as real planned visits, not one misleading date.
- Rescheduling keeps the former commitment, the reason, and whether the customer must be told.
- Calendar, work detail, employee view, and customer messages reference one current plan.

### 6. Field-Ready Work Pack

- Before arrival, the assigned employee sees everything the job needs, including equipment, hazards, tools, and open questions.
- Commercial and internal customer notes stay hidden unless the employee needs them for the work.
- The future employee app is one role-aware place for jobs, time, documents, photos, tasks, material, and communication.
- Offline support is defined per action. The field worker sees what is available offline, queued, failed, or in conflict, and when the job last synced.

### 7. Execution And Site Documentation

- Field workers start, pause, resume, and document work without duplicate time actions.
- Photos and files keep their work context, capture time, author, and link to a task, defect, measurement, change, or handover.
- An `Aufmaß` can feed commercial calculation later. Billing rules stay with the commercial feature.
- A `Mangel` carries severity, responsibility, due date, proposed fix, and proof of closure.
- Change work (`Nachtrag` or `Regiearbeit`) records what differs from the agreed scope, who asked for it, labor and material, authorization, and schedule impact.
- A responsible person reviews daily and visit reports. AI text is never accepted unreviewed.
- Corrections keep who changed an operational fact and why, especially after customer approval or completion.

### 8. Approvals And Signatures

- The right person approves or rejects an exact artifact revision. A signature records signer, context, time, and any reservation or refusal.
- A customer can refuse to sign or add a reservation. The team can still record what happened.
- Internal approval and customer acknowledgement are separate.
- High-risk work can require office or project-lead review before it becomes commercially usable or visible to the customer.
- WerkFlow never calls a signature legally sufficient until identity, evidence, retention, and German legal requirements are validated.

### 9. Planned-Versus-Actual Labor

- Planning shows expected effort at the depth capacity and costing need.
- Actual labor comes from [time tracking](./time-tracking.md), never from job-local timers, and corrections follow its approval rules.
- Managers compare planned and actual labor while work is active. A variance carries its cause, such as added scope, waiting, rework, or missing material.
- Jobs and projects supply approved labor quantities and cost inputs to profitability. Payroll and wage logic stay elsewhere.

### 10. Material, Tools, And External Work

- [Inventory](./inventory.md) is the authority for material quantities, stock, and procurement. Work records give the reason and destination.
- Employees record unplanned material quickly. The office reviews stock, cost, and billability.
- Shortages show early enough to affect readiness and scheduling.
- Project totals trace back to the job or project demand that produced them.
- Tools, vehicles, subcontractors, and external services link to work when they affect readiness, evidence, cost, or handover.

### 11. Completion, Handover, And Reopening

- Execution complete means field work has stopped. Handed over means required evidence, open items, customer acknowledgement, and office review have reached the agreed state. The two never merge.
- Completion shows everything still open: instructions, defects, measurements, running time, material still out, unsigned artifacts, and undecided change work.
- The office builds the customer package from approved artifacts, without internal notes or drafts.
- Reopening completed or handed-over work needs a reason and keeps the earlier history.
- Cancelled work keeps the request, decisions, effort, material, and commercial handoff needed to close it.

### 12. Service Handoff

- Installation work hands equipment, commissioning data, warranty dates, maintenance requirements, documents, and open commitments to service, so the next technician never rebuilds an installation from memory.
- A maintenance visit or fault job links back to the equipment and original project and stays its own work record.
- [Service and maintenance](./service-and-maintenance.md) owns plans, contracts, intervals, and asset lifecycle, not the project hierarchy.
- The office turns one due maintenance item into one ordinary job from the exact template version of the plan. Completing that job does not by itself settle the maintenance evidence or the next due date.

### 13. Commercial Readiness And Profitability Inputs

- Work is commercially ready only when scope evidence, approved time, material use, measurements, change work, customer acknowledgements, and completion state are present.
- The work view flags items for commercial review, such as unplanned labor or material, approved changes, warranty work, and goodwill.
- Every amount in post-calculation traces to its operational or commercial source. Nothing is copied into an unowned project total.
- [Commercial and finance](./commercial-and-finance.md) owns prices, tax, invoices, payments, and accounting.

### 14. Search, Oversight, Audit, And Export

- Office users find work by any linked fact: customer, site, equipment, number, status, employee, date, request, document, defect, material, or free text.
- Dashboards show work that needs action, such as overdue, blocked, missing evidence, or ready for dispatch, handover, or commercial review.
- Project summaries never hide the job-level exceptions behind them.
- Changes to status, schedule, assignment, scope, approvals, completion, and handover are attributed and in time order.
- The organization can export work records and evidence with the identifiers and links that migration or audit needs.

## Connected Workflow Contracts

| Connected area            | This feature owns                                                                                                     | The connected area owns                                                                                                    | Required contract                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customers and CRM         | Operational scope, work responsibility, execution history, and the link to the relevant customer/contact/site/request | Customer identity, contacts, sites, request intake, relationship history, communication preferences, and consent           | Work receives a stable customer/site/request context; completion and meaningful changes return to the customer timeline without duplicating customer master data. |
| Calendar                  | Work readiness, assignment needs, expected duration, status, and operational constraints                              | Schedule presentation, visit/time-slot coordination, conflict display, and calendar interactions                           | Schedule changes made from either surface resolve to one current plan and retain the reason and notification requirement.                                         |
| Documents                 | The business meaning of an artifact within work                                                                       | File storage, versions, links, permissions, audit, retention, recovery, and export                                         | Jobs/projects reference approved document versions; a file can remain discoverable centrally and in context without being copied.                                 |
| Service and maintenance   | Installation/project execution and the evidence needed for handover                                                   | Equipment lifecycle, installations, maintenance plans/contracts, recurring visits, warranties, and service history         | Handover creates a complete, reviewable service context; later service work links back without turning every project into a maintenance plan.                     |
| Commercial and finance    | Verified operational quantities, scope changes, approvals, completion state, and cost/profitability inputs            | Offers, contracts, orders, prices, taxes, invoices, payments, accounting, and legally required commercial corrections      | Commercial documents consume traceable approved work facts; commercial status can release or close work without embedding invoice logic here.                     |
| Inventory and procurement | Material demand and the job/project reason for usage                                                                  | Catalog, stock by location, reservations, movements, returns, supplier demand, orders, receipts, and cost source           | Planned, reserved, taken, returned, consumed, and billable states remain distinct and changes are traceable both from work and stock.                             |
| Employees and time        | Assignment, job/task responsibility, work context, and planned effort                                                 | Membership, roles, skills/availability where introduced, time events, corrections, approvals, absence, and payroll handoff | Assigned work is visible to the right people; actual labor is consumed from approved time rather than recreated in the job.                                       |
| Communications            | The work event that requires a message and its customer/job context                                                   | Channel delivery, templates, inbound/outbound capture, delivery state, and communication audit                             | Appointment, delay, approval, and completion messages link back to the work and customer timeline; failed delivery becomes an actionable state.                   |
| AI and automation         | Reviewable operational sources and explicit approval points                                                           | Model/workflow execution, confidence, policy, and automation audit                                                         | Automation proposes or prepares changes; accountable users approve high-impact schedule, scope, customer, stock, and commercial actions.                          |

## Role And UX Principles

- **Office and project leads.** Build for exceptions and overview, not for clicking through every child record. Simple jobs stay simple, and project, dependency, and change-work depth appears when needed. A project status, risk, or progress value reveals the jobs and blockers behind it.
- **Field workers.** The job detail leads with today's place, time, contact, outcome, next steps, hazards, and material. Field users never need the office's commercial process, project hierarchy, or configuration. The UI separates required completion items from optional detail and shows what is saved, queued, failed, or awaiting review.
- **Apprentices.** Templates and checklists guide the sequence and never replace supervision or trade skill. Risky completion, change-work, material, or approval actions need the responsible person.
- **Customers.** Customer views show only artifacts shared on purpose. Internal notes, labor cost, margin, employee evaluation, and unapproved evidence never leak through a shared report or a future portal.
- **Everyone.** Ask for information when it becomes useful and reuse facts already captured. Accessibility, mobile ergonomics, and explicit offline and sync behavior are acceptance criteria, not later polish.

## Phase 2 — Intelligence And Automation

Phase 2 uses the structured core to reduce coordination work. AI never papers over missing core states with guesses.

- Turn calls, emails, photos, or dictated notes into a proposed request, scope, checklist, report, measurement, defect, or change-work record with its source.
- Suggest customer, site, equipment, template, team, duration, and material, with confidence and alternatives.
- Detect missing prerequisites, schedule conflicts, likely shortages, stalled blockers, overdue customer decisions, and evidence gaps.
- Forecast labor and material variance, completion risk, and profitability from explainable data.
- Prepare site summaries, handover packages, service handoffs, and commercial-readiness packets from approved artifacts.
- Rewrite field notes for customer reports, keep the original, and require review.
- Propose follow-up tasks or customer updates. Messages follow preferences, consent, templates, and human control.
- Learn organization defaults from reviewed choices without silently changing templates, status rules, assignments, stock, or customer commitments.
- Every proposal follows the [source-visibility rules](./ai-automations.md#data-quality-and-source-visibility) of AI Automations. Low-confidence cases fall back to manual review.

## Boundaries And Decision Gates

- **No generic project-management suite.** Portfolio roadmaps, agile boards, custom workflows, and critical-path tooling need evidence that they solve common SHK work.
- **No invoice logic here.** This feature supplies approved operational facts.
- **No CRM duplication.** Customer, contact, site, and request data belong to CRM. Work may keep a snapshot of what was true at execution time.
- **No service shortcut.** Equipment, recurring maintenance, contracts, warranties, and emergency service need the dedicated service model.
- **No automatic high-impact actions by default.** Scope, customer promises, employee schedules, stock movements, signatures, completion, and commercial release need explicit authority and review.
- **Offline is per workflow.** Each field action defines its offline data, queued changes, conflicts, last-sync display, and recovery.
- **Signatures and regulated records need validation.** WerkFlow promises no VOB, REB, GoBD, legal-signature, retention, or evidentiary compliance without a legally reviewed scope.
- **Location and workforce privacy need validation.** GPS, route history, presence, and performance analytics need a clear necessity, role model, transparency, and retention decision.
- **Configurability has a cost.** Custom statuses, fields, templates, and gates come only with safe defaults, migration behavior, reporting meaning, and mobile usability.
- **Migration and export are part of readiness.** Customer acceptance covers imports, open work, identifiers, linked artifacts, correction history, and export.

## Open Product Decisions

- Do real service, installation, construction, warranty, or internal jobs need lifecycle cases beyond the fixed execution model?
- Which blocking reasons and readiness checks are defaults, and which can organizations configure?
- How deep does project structure go beyond project and job: phases, work packages, tasks, or only grouped jobs?
- Can a job belong to more than one site, equipment item, or service case, and how is the primary context shown?
- How do teams, lead responsibility, skills, tools, vehicles, and subcontractors fit without duplicating employee or inventory ownership?
- Should applying a newer template to existing work ever offer a reviewed update?
- What evidence is mandatory for common SHK work types, and who may override missing evidence?
- What is the minimum useful `Bautagebuch`, `Aufmaß`, defect, and change-work record?
- Which measurement standards and future GAEB, REB, or VOB directions are required, for which workflows and versions?
- What identity and evidence level do customer signatures and internal approvals need?
- How are customer refusal, partial acceptance, reservations, open defects, and later warranty claims represented?
- When does taken material become consumed, returned, lost, damaged, or billable, and who reviews unplanned use?
- Which labor and cost inputs can field workers see, and which stay office-only?
- Which facts release work to commercial processing, and can a commercial correction reopen an operational review without changing completed field evidence?
- What data and actions must work offline in the first React Native release?
- Which completion artifacts are visible to the customer, visible to service, or exportable by default?
- Which retention, archive, deletion, and export rules apply to cancelled and completed work?
