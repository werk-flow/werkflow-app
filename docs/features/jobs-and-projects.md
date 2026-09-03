# Jobs And Projects

Status: living — last reviewed 2026-09-03

Jobs (`Aufträge`) and projects (`Projekte`) are WerkFlow's central operational work objects. A job represents work that a team can plan, perform, document, and complete. A project groups related work when the business needs a larger delivery context, but it must never be required for a simple service visit or small order.

## Product Goal

WerkFlow should give an SHK business one reliable operational path from a customer request to documented completion and handover. At every point, the people involved should be able to answer:

- What was requested and what outcome was agreed?
- Is this a standalone job or part of a larger project?
- What must happen next, what is blocked, and who is responsible?
- When and where will the work happen?
- Which employees, instructions, materials, tools, documents, and customer decisions are relevant?
- What actually happened on site?
- Is the work complete enough for handover, service follow-up, and commercial processing?

The goal is not generic project-management breadth. It is an operational record that reduces duplicate entry, missing documentation, forgotten materials, disputed change work, and the office effort required to reconstruct a job after the fact.

The [competitive landscape](../product/competitive-landscape.md) supplies the external market evidence behind this direction. This document defines WerkFlow's product choices and does not repeat vendor-by-vendor research.

## Current Product Baseline

As of 2026-09-02, Admin and Büro create and steer jobs and projects from request handoff through an explicit execution lifecycle, structured site evidence, and an office-reviewed handover. Assigned field workers work from one focused job view. The behavior below is the baseline future work must preserve unless a deliberate migration replaces it.

- **Work structure.** Managers create, edit, and delete jobs and projects with title, description, number, customer or project context, priority, planned date and time, estimated duration, planned total working time, location, status, and actual completion date. A job is standalone or belongs to one project; a project can exist without jobs and receive existing or new jobs later. Jobs and projects have organization-scoped numbers and dedicated detail routes. A standalone job has its own customer; jobs inside a project use the project's customer, and changing the project customer synchronizes its jobs. Deleting a project removes only the project association from its jobs. Once a job has planning occurrences or event history, hard deletion is refused with a manager-facing explanation ([P1-11](../plans/phase-1/slices/p1-11-planning-occurrences.md)).
- **Request and service handoff.** A captured `Anfrage` converts exactly once into a new job or project with customer, contact, site, summary, details, urgency, and attachments carried over; the work shows „Entstanden aus Anfrage …“ to managers, and direct creation without a request stays first-class ([P1-02](../plans/phase-1/slices/p1-02-client-requests.md)). A reactive service case can link to exactly one existing job; the case stays the intake, triage, and outcome record while the job owns scheduling, dispatch, execution, evidence, material, and completion ([P1-19](../plans/phase-1/slices/p1-19-reactive-service.md)).
- **Site and contact references.** A job can reference one `Einsatzort` and one `Ansprechpartner` of its customer; a project default prefills new jobs and stays overridable per job ([P1-01](../plans/phase-1/slices/p1-01-customer-contacts-and-sites.md)). Selecting a site copies its current address into the job's location as a snapshot that later site edits never rewrite. Changing the customer clears the previous customer's references, including on child jobs. The assigned field worker sees site address, access notes, and a click-to-call contact.
- **Execution lifecycle.** Work uses the fixed states `not_started`, `in_progress`, `interrupted`, `execution_complete`, `handed_over`, and `cancelled` with audited, version-checked transitions ([P1-14](../plans/phase-1/slices/p1-14-work-lifecycle.md)). Planning, readiness, blockers, and parking are separate facets, so scheduled work can still be blocked and field-complete work can still await handover. Work that existed before P1-14 keeps its legacy status until the first explicit lifecycle action. Detail pages show execution state, planned or unplanned, start readiness, blockers, prerequisites, next action, completion gates, and recent history together; active list filters are „Nicht begonnen“, „In Ausführung“, and „Unterbrochen“. Completion records the actual date and reopening clears it. The first job-linked clock-in or break-end moves `not_started` or `interrupted` work to `in_progress` in the same transaction as the time event; a blocked or terminal target rejects the time event. Project execution derives from its children unless a manager sets a reasoned override. Overrides never cascade; parking a project parks its unfinished children.
- **Blockers, dependencies, and gates.** Work can carry several blockers at once, each with a bounded reason, details, a responsible person, a next-review date, and a resolution ([P1-14](../plans/phase-1/slices/p1-14-work-lifecycle.md)). Parking is a blocker kind, not an execution state; it cancels the schedule and dispatch context without rewriting execution, and context-free legacy parked work shows „Kontext fehlt (Altbestand)“. Dependencies declare job, project, instruction, approval, delivery, site, or external-trade prerequisites with a start, completion, or warning effect; instruction prerequisites are enforced when instructions and work complete ([P1-13](../plans/phase-1/slices/p1-13-work-templates.md)). Start and completion gates check current facts; a manager exception needs a reason and is recorded.
- **Readiness and dispatch.** Readiness is shown per dimension as `ok`, `warning`, or `unknown` with no stored ready flag; material stays „nicht reserviert“ and tools „nicht bewertet“ ([P1-12](../plans/phase-1/slices/p1-12-dispatch.md)). Handing work to the field is a distinct auditable fact: a versioned dispatch instruction targets one scheduled visit or one unscheduled job, and assigned employees confirm or challenge the current revision under „Mein Einsatz“. Parking cancels active dispatches visibly. Acknowledgement never stands in for attendance, recorded time, or a customer promise; the calendar spec and [decision 0002](../decisions/0002-dispatch-revision-acknowledgement-identity.md) hold the details.
- **Planning occurrences.** One job can have several planned visits, and recurring planning materializes occurrences rather than synthetic jobs ([P1-11](../plans/phase-1/slices/p1-11-planning-occurrences.md)). The job's planned date, time, duration, and assignments stay aligned with its current visit plan so lists, detail, and field access keep working. Planned occurrences and actual job-linked time stay separate. Parked jobs are excluded from scheduled calendar work.
- **Assignment and qualifications.** Managers assign one or more members to a job; employees see work through assignments, and project access is reached through assigned work. Managers can attach skill and certification requirements to a job; the detail explains whether the selected people cover each one, and an uncovered selection is possible only through a reasoned assessment ([P1-09](../plans/phase-1/slices/p1-09-teams-and-qualifications.md)). Requirements guide planning and claim no legal authorization. Before an employment transition, active assignments are inventoried and reassigned explicitly; access suspension removes operational access without deleting assignments ([P1-24](../plans/phase-1/slices/p1-24-controlled-people-lifecycle.md)).
- **Field work pack.** Assigned employees get one mobile-first composition on standalone and project-child job routes: pre-arrival customer, site, and contact context, one dispatch or lifecycle next action, instructions, structured evidence, contextual documents, own time, operational material, and unresolved issues ([P1-16](../plans/phase-1/slices/p1-16-field-work-pack.md)). It excludes sibling and project-wide detail, coworker drafts, document governance, and commercial facts. Employees get start, interrupt, resume, and execution-complete actions, their own blocker report, and the customer-safe handover summary of their job. Managers keep creation, editing, assignment, cancellation, handover, parking, dependencies, gate exceptions, and project overrides.
- **Instructions and work templates.** Jobs and projects have ordered instruction items with task or checklist kind, required or optional state, group, notes, expected evidence, prerequisites, and template origin; managers manage them, assigned employees complete or reopen them, and the last actor and time are kept ([P1-13](../plans/phase-1/slices/p1-13-work-templates.md)). Admin and Büro manage Auftrag and Projekt templates under `/arbeitsvorlagen`. A template has one editable draft; every published version is immutable, and archive hides a template from pickers without deleting applied work. Applying a published version at creation, request conversion, or later materializes editable instruction, material, and capability rows that record the exact version; later template edits never rewrite the work, and the same version cannot be applied twice to the same target. Application is planning only: no stock movement, occurrence, dispatch, assignment, time, document, approval, or message.
- **Structured work artifacts.** Job and project detail share one `Arbeitsnachweise` section for Bautagebuch, Arbeitsbericht, Aufmaß, Mangel, and Regie-/Änderungsnachweis ([P1-15](../plans/phase-1/slices/p1-15-structured-site-evidence.md)). One artifact owns immutable numbered revisions; review decisions, customer outcomes, signatures, document relations, and exports bind to an exact revision. A decided record is corrected by a new revision and voided, never deleted. Field workers capture on their assigned work; managers capture, review, export, record customer outcomes, and void with a reason. Required evidence, formal approvals, and required customer outcomes feed the completion gates.
- **Office handover.** Execution-complete jobs and projects get an office-reviewed handover: Büro and Admin select exact artifact revisions, exact document versions, and, for projects, exact child releases; gates classify hard blockers, reasoned exceptions, warnings, and explicitly unassessed areas ([P1-17](../plans/phase-1/slices/p1-17-office-handover.md)). One release freezes the customer-safe package, renders a deterministic HTML document, and moves the target to `handed_over`. Releases are immutable; withdrawal returns the work to `execution_complete`, keeps the old release, and opens a successor draft. The recorded `ready_for_commercial_review` or `ready_with_exceptions` result is not billing approval.
- **Installed equipment.** Service-owned equipment can record installation, commissioning, service, removal, or replacement links to a job, project, artifact revision, or handover release; work stays the operational owner ([P1-18](../plans/phase-1/slices/p1-18-installed-equipment.md)). Assigned field workers see only equipment linked to their exact job, and the link grants no project, customer, or library access.
- **Time, documents, and material.** Work, travel, and call-out segments reference one job or stay explicitly unallocated; starting work or call-out on a job can start or resume its lifecycle, travel never does ([P1-21](../plans/phase-1/slices/p1-21-time-segments.md)). Job and project detail show linked time, and projects aggregate their jobs. `Dokumente & Bilder` links work to the central document system; assigned employees upload and view on their jobs, managers have the full document actions. `Material & Inventar` lets managers plan material without changing stock and lets users take or return stock explicitly, including unplanned takes; project views show direct, inherited, and total material, and lines keep planned, taken, returned, billable, and unplanned quantities distinct.

### Important current limitations

- Converting a request into an update of existing work is deferred.
- Delivery or public access to a handover package, billing, material consumption, and offline or mobile behavior remain later scope.
- Work artifacts are operational evidence, not a handover package, commercial acceptance, invoice basis, or qualified electronic signature.
- Visit-level planning and actual time records exist, but there is no operational variance or profitability view.
- Structured offers, contracts, invoices, payments, and accounting are not implemented.
- There is no offline job pack and no React Native employee app yet.

## Phase 1 — Complete Operational Core

Phase 1 is not an MVP list. It describes the complete high-value operational capability expected before WerkFlow treats jobs and projects as a mature core for an SHK business. Delivery can be incremental, but partial implementation should not be confused with completion of the phase.

### 1. Request-To-Work Handoff

- A validated customer request can become a standalone job, a project, or an item attached to existing work without retyping the customer, site, source, request summary, urgency, attachments, or promised next action.
- Office users can also create work directly when there is no prior request. A CRM funnel must not become mandatory overhead for known repeat work.
- The work record shows the originating request and what changed during qualification so the field team receives the accepted operational scope rather than an unfiltered message transcript.
- Urgent faults, scheduled service, quoted installation work, planned construction work, warranty issues, and internal work can be distinguished in ways that improve planning and reporting.
- Commercial acceptance or order confirmation can release work for execution, but quote, contract, and order-document rules remain owned by the commercial feature area.

### 2. Standalone Jobs And Project Structure

- A small repair or inspection remains a complete first-class standalone job with the same documentation, time, material, completion, and handover capabilities as a job inside a project.
- A project can stand on its own as the overall delivery context before any detailed jobs exist.
- Projects can group phases, areas, systems, trades, or work packages without forcing every business into a complex hierarchy.
- Jobs can be added to, moved between, or removed from projects with an explicit preview of customer, site, schedule, document, material, and reporting consequences.
- The product preserves a clear distinction between project-level information shared by all work and job-specific instructions or evidence.
- Managers can copy an existing job or project when repetition is faster than starting empty, while copied assignments, dates, customer data, private notes, and completed evidence require deliberate confirmation.

### 3. Templates, Checklists, And Tasks

- Organizations can maintain practical templates for recurring SHK work such as heating maintenance, boiler replacement, bathroom installation, commissioning, fault diagnosis, site setup, and handover.
- A template can prepare the expected scope, work steps, required evidence, planned roles, material demand, safety checks, forms, and completion conditions without silently committing stock or calendar capacity.
- Applying a template creates an editable work plan; later template changes do not rewrite completed or active work without a reviewed update.
- Checklists support required and optional items, clear completion evidence, notes, attachments, and accountable completion.
- Tasks can have an owner, due context, status, and relation to the relevant job, project phase, defect, measurement, approval, or change-work item.
- Field workers see only the next practical actions and their dependencies. Office users can inspect the fuller plan, responsibility, and exceptions.
- Reusable text and checklist content uses natural German and can be organization-specific without requiring extensive configuration.

### 4. Status, Readiness, Dependencies, And Exceptions

- The status model distinguishes operationally different situations instead of overloading one generic open state: not yet planned, planned, ready, in progress, interrupted, waiting for customer, waiting for material, blocked, parked, execution complete, handed over, cancelled, and archived where validated.
- The exact status vocabulary remains a product decision, but every visible status must imply a clear next action and responsible role.
- Users can record why work is blocked or interrupted, who must resolve it, and the next review date. A blocked record cannot disappear into a passive status.
- Dependencies can express that one job, task, approval, delivery, site condition, or external trade must finish before another step starts.
- Readiness makes missing prerequisites visible before dispatch: confirmed site/access, customer availability, required employee skill, material/tool readiness, approved scope, documents, and safety information.
- Completion gates identify required instructions, time/material capture, measurements, defect resolution, customer decision, and handover evidence. Managers can override a gate only with a reason and audit visibility.
- Cancellation, postponement, and parking remain distinct. Each preserves the history and explains what should happen next.

### 5. Scheduling, Capacity, And Assignment

- Office users can plan jobs and project phases in the calendar with dates, time windows, expected duration, travel/site context, and the people needed.
- Assignment supports individuals and practical teams while retaining the responsible lead.
- Planning exposes conflicts with absence, overlapping work, required skills, and unavailable tools or vehicles without making the calendar a full workforce-optimization suite.
- Multi-day and split work is represented as actual planned visits or work periods rather than one misleading single date.
- Rescheduling preserves the former commitment, reason, and communication requirement so office and field teams do not work from different plans.
- Employees receive timely, understandable assignment changes and can see what changed.
- The calendar, work detail, employee view, and customer communication all reference the same current plan.

### 6. Field-Ready Work Pack

- Before arrival, the assigned employee can see the customer, contact, correct site, access notes, requested outcome, planned time, responsible people, relevant installation/equipment, instructions, hazards, documents, photos, materials, tools, and unresolved questions.
- Sensitive commercial or internal customer notes are excluded unless the employee needs them to perform the work.
- Navigation and calling the relevant contact are immediate actions, not buried in metadata.
- The future employee app provides one role-aware work surface for jobs, time, documents, photos, tasks, material, and communication.
- Offline support is defined per action. The field worker can see what data is available offline, what is queued, what failed, what conflicts, and when the job pack last synchronized.

### 7. Execution And Site Documentation

- Field workers can start, pause, resume, and document work without duplicating time-tracking actions or manually reconciling an unrelated status.
- A site diary (`Bautagebuch`) can capture daily progress, people present, weather or site conditions when relevant, deliveries, impediments, decisions, notable events, and supporting media.
- Photos and files retain their job/project/site context, meaningful capture time, author, description, and relation to a task, defect, measurement, change, or handover.
- Structured measurements (`Aufmaß`) capture quantities, units, locations/areas, notes, evidence, revisions, and approval state. They can later feed commercial calculations without the job feature owning billing rules.
- Defects (`Mängel`) capture the problem, severity, location, responsibility, due date, evidence, status, proposed resolution, and proof of closure.
- Change work (`Nachtrag` or `Regiearbeit`) records what changed, why it was outside or different from the current scope, who requested it, expected/actual labor and material, evidence, authorization state, and any impact on schedule.
- Daily or visit reports summarize performed work, outstanding work, materials, time, measurements, defects, customer statements, and the next visit. They remain reviewable artifacts, not AI-generated text accepted without a responsible person.
- Corrections preserve who changed an operational fact and why, especially after customer approval or completion.

### 8. Approvals And Signatures

- The appropriate person can approve or reject clearly identified artifacts such as the work performed, a service report, measurement, change work, defect resolution, commissioning result, or final handover.
- A signature is attached to the exact artifact revision and records signer identity/context, time, and any reservation or refusal.
- A customer can refuse to sign or add a qualification without blocking the team from recording what occurred.
- Internal approval and customer acknowledgement are separate concepts.
- High-risk work can require office or project-lead review before it becomes commercially usable or customer-visible.
- The product never describes a signature as legally sufficient for a specific purpose until the applicable identity, evidence, retention, and German legal requirements have been validated.

### 9. Planned-Versus-Actual Labor

- Work planning shows expected effort by job, phase, task, visit, team, or role at the level needed for reliable capacity and costing.
- Actual job-linked work, travel, and relevant supplements come from the time feature rather than duplicate job-local timers.
- Managers can compare planned and actual labor while work is active, not only after completion.
- Variances explain enough context to be actionable: added scope, waiting, rework, travel, access problems, missing material, underestimated effort, or data corrections.
- Employee time corrections continue through the time feature's approval and audit rules.
- The job/project view can supply approved labor quantities and cost inputs to commercial profitability calculations without owning payroll or wage logic.

### 10. Planned-Versus-Actual Material, Tools, And External Work

- Planned demand, preferred source, reserved quantity, physical stock, ordered quantity, taken quantity, returned quantity, consumed quantity, and commercially billable quantity remain visibly distinct.
- Employees can record unplanned material use quickly while the office retains a review path for stock, cost, and billability.
- Material shortages and required procurement are visible early enough to influence readiness and scheduling.
- Project totals can be traced back to the specific job or project-level demand that produced them.
- Tools, assets, vehicles, subcontracted work, and external services can be associated with the work when they affect readiness, execution evidence, cost, or handover.
- Inventory remains the authority for catalog, location, reservation, movement, and procurement state. Work records provide the operational reason and destination.

### 11. Completion, Handover, And Reopening

- `Execution complete` means field work has stopped; `handed over` means the required evidence, unresolved items, customer acknowledgement, and office review have reached the agreed state. These must not be collapsed accidentally.
- Completion shows outstanding instructions, open defects, missing measurements, running time, material still out, unsigned required artifacts, and incomplete change-work decisions.
- A handover package can contain approved reports, measurements, photos, commissioning data, manuals, warranties, maintenance recommendations, and remaining-work/defect lists.
- The office can generate the customer-visible package from approved artifacts without exposing internal notes or drafts.
- Reopening completed or handed-over work requires a reason and preserves the previous completion/handover history.
- Cancelled work retains the request, decisions, incurred effort/material, and commercial handoff required to close it correctly.

### 12. Service Handoff

- Installation and project work can hand over installed equipment, commissioning information, warranty dates, maintenance requirements, responsible contacts, documents, and open service commitments to the service/maintenance area.
- The handoff prevents the next technician from reconstructing an installation from PDFs and memory.
- A resulting maintenance visit or fault job links back to the equipment and original project while remaining its own operational work record.
- Recurring maintenance plans, contracts, service intervals, and asset lifecycle rules belong to the service feature area, not to the generic project hierarchy.
- Since P1-20, the office deliberately turns one service-owned due item into one ordinary job with the plan revision's exact published work-template version. The due item stores the exact job link; job creation keeps its existing customer/site, qualification, checklist, evidence and lifecycle owners. Scheduling that job creates a separate P1-11 occurrence, and completing the job does not by itself claim that maintenance evidence or the next-due decision is complete.

### 13. Commercial Readiness And Profitability Inputs

- Work can be marked commercially ready only when the required scope evidence, approved time, material usage, measurements, change work, customer acknowledgements, and completion state are available.
- The operational view identifies items that may need commercial review: unplanned labor/material, approved changes, rejected work, external costs, warranty work, goodwill, and non-billable corrections.
- Profitability inputs include planned and actual labor quantities/cost basis, planned and actual material quantities/cost basis, external work, equipment/tool allocation where relevant, and operational variance reasons.
- Revenue, taxes, payment terms, invoice numbering, partial/final invoice construction, corrections, dunning, payment matching, and accounting remain owned by the commercial/finance feature area.
- Every amount or quantity shown in later post-calculation must be traceable to its operational or commercial source rather than copied into an unowned project total.

### 14. Search, Oversight, Audit, And Export

- Office users can find work by customer, contact, site, equipment, job/project number, status, responsible employee, date, request, document, defect, material, and relevant free text.
- Dashboards highlight work needing action: unplanned, overdue, blocked, waiting, at risk, missing evidence, ready for dispatch, ready for handover, and ready for commercial review.
- Project views summarize progress without hiding the job-level exceptions that determine whether the summary is trustworthy.
- Material changes to status, schedule, assignment, scope, approvals, completion, and handover are attributable and time-ordered.
- The organization can export usable work records and their linked evidence while preserving identifiers and relationships needed for migration or audit.

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

### Admin, Office, And Project Leads

- Optimize for exception handling and overview, not repeated navigation through every child record.
- Provide fast creation, copying, bulk assignment, filtering, scheduling, and status correction while making the consequences visible.
- Use progressive disclosure: simple jobs should stay simple; project, dependency, measurement, defect, and change-work depth appears when needed.
- Make derived summaries explainable. A project status, risk, or progress value must reveal the underlying jobs and blockers.

### Field Workers

- The job detail prioritizes today's place, time, contact, requested outcome, next steps, hazards, materials/tools, and the simplest route to document work.
- Field users should not need to understand the office's commercial process, project hierarchy, or configuration model.
- Capture should favor structured defaults, voice/photo assistance where useful, large touch targets, and recovery from interruption.
- The UI must clearly separate required completion items from optional detail and show what is saved, queued, failed, or awaiting review.

### Apprentices And Less Experienced Employees

- Templates and checklists guide the sequence without suggesting they replace supervision or trade competence.
- Instructions use practical German and make escalation paths obvious.
- Risky completion, change-work, material, or approval actions require the appropriate responsible person.

### Customers And External Participants

- Customer-visible views and approval moments expose only intentionally shared artifacts.
- Internal notes, labor cost, margin, employee evaluation, and unapproved evidence never leak through a shared report or future portal.

### Cross-Cutting UX

- Use natural German trade language and organization defaults rather than generic software terminology.
- Preserve organization boundaries and role-scoped access.
- Avoid a wall of fields. Ask for information at the point it becomes useful and reuse facts already captured.
- Accessibility, mobile ergonomics, and explicit offline/sync behavior are acceptance criteria, not later polish.

## Phase 2 — Intelligence And Automation

Phase 2 should use the structured operational core to reduce coordination work. It must not compensate for missing core states with opaque AI guesses.

- Turn calls, emails, messages, photos, or dictated notes into a proposed request, scope, checklist, site report, measurement, defect, or change-work artifact with source evidence.
- Suggest the appropriate existing customer, site, equipment, template, responsible team, duration, and required material while showing confidence and alternatives.
- Detect missing prerequisites, schedule conflicts, likely material shortages, stalled blockers, overdue customer decisions, and completion evidence gaps.
- Forecast labor/material variance, completion risk, and operational profitability using explainable current data.
- Prepare daily site summaries, handover packages, service handoffs, and commercial-readiness packets from approved artifacts.
- Translate or rewrite field notes for customer-facing reports while retaining the original and requiring review.
- Propose follow-up tasks or customer updates after delay, visit, completion, defect resolution, or handover; communication remains subject to preferences, consent, template, and human-control rules.
- Learn useful organization defaults from reviewed choices without silently changing templates, status rules, assignments, stock, or customer commitments.
- Every proposal shows its sources, proposed changes, confidence/limitations, approval point, actor, and audit outcome. Low-confidence cases fall back to manual review.

## Boundaries And Decision Gates

- **No generic project-management suite:** portfolio roadmaps, broad agile boards, arbitrary custom workflows, and advanced critical-path tooling require evidence that they solve common SHK operations.
- **No invoice logic here:** this feature supplies approved operational facts. Structured offers, contracts, invoices, payments, accounting, and tax compliance require their own product specification.
- **No CRM duplication:** customer/contact/site/request master data belongs in CRM. Work may retain an audit-safe snapshot of what was true at execution time.
- **No service-module shortcut:** equipment, recurring maintenance, contracts, warranties, and emergency-service logic require a dedicated service model even though work links to them.
- **No ambiguous “material” field:** catalog data, planned demand, reservation, physical stock, procurement, consumption, and billability remain distinct.
- **No automatic high-impact actions by default:** scope, customer promises, employee schedules, stock movements, signatures, completion, and commercial release need explicit authority and review.
- **Offline is workflow-specific:** implementation must decide available data, queued mutations, attachments, conflicts, last-sync visibility, and recovery for each supported field action.
- **Signatures and regulated records need validation:** the product must not promise VOB, REB, GoBD, legal-signature, retention, or evidentiary compliance without a versioned, legally reviewed scope.
- **Location and workforce privacy need validation:** GPS, route history, presence, and employee-performance analytics require a clear necessity, role model, transparency, and retention decision.
- **Configurability has a cost:** custom statuses, fields, templates, and gates should be added only with safe defaults, migration behavior, reporting semantics, and mobile usability.
- **Migration and export are part of readiness:** customer acceptance testing must include imports, open work, identifiers, linked artifacts, correction history, and usable organization export.

## Open Product Decisions

- Which job and project status vocabulary best covers service, installation, construction, warranty, and internal work without becoming confusing?
- Which blocking reasons and readiness checks are defaults, and which may organizations configure?
- How deep should project structure go beyond project and job: phases, work packages, tasks, or only tagged/grouped jobs?
- Can a job belong to more than one site, equipment item, or service case, and how should the primary context be shown?
- Which project information should an employee assigned to only one child job see?
- Should field workers be able to change job status directly, and which transitions require a lead or office approval?
- How do team assignments, lead responsibility, required skills, tools, vehicles, and subcontractors fit without duplicating employee or inventory ownership?
- Which template elements can be copied safely, and how are template versions and later updates presented?
- What evidence is mandatory for common SHK work types, and who may override missing evidence?
- What is the minimum useful structured `Bautagebuch`, `Aufmaß`, defect, and change-work artifact?
- Which measurement standards and future GAEB/REB/VOB directions are required, for which workflows and versions?
- What identity and evidence level is required for customer signatures and internal approvals?
- How are customer refusal, partial acceptance, reservations, open defects, and later warranty claims represented?
- When does taken material become consumed, returned, lost, damaged, or commercially billable, and who reviews unplanned use?
- Which labor and cost inputs can field workers see, and which remain office-only?
- What exact facts release work to commercial processing, and can commercial correction reopen an operational review without changing completed field evidence?
- What data and actions must work offline in the first React Native release?
- Which completion artifacts become customer-visible, service-visible, or exportable by default?
- What retention, archive, deletion, and export rules apply to cancelled and completed work?

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, and links to per-slice acceptance records.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
