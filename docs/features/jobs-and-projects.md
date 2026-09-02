# Jobs And Projects

Status: living — last reviewed 2026-09-02

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

The following behavior exists today and is the baseline future work must preserve unless a deliberate migration replaces it.

### Work Structure And Identity

- Managers (`admin` and `buero`) can create, edit, and delete jobs and projects.
- **Request handoff (P1-02):** a captured customer request (`Anfrage`) can be deliberately converted exactly once into a new standalone job or project without re-entering the customer, contact, site, summary, details, urgency, or attachments. The conversion dialog prefills everything and stays fully editable; urgency maps onto job priority; the site address becomes the job's `Ort` snapshot (P1-01 rule); attachments gain a second document link to the work. Converted work shows its origin ("Entstanden aus Anfrage …", manager-only) and the request links to the work. Direct job/project creation without a request is unchanged and remains first-class — no synthetic request is ever required.
- A job can remain standalone or belong to one project. A project can exist without jobs and can later receive existing or newly created jobs.
- Jobs and projects have organization-scoped numbers and dedicated detail routes.
- A standalone job can have its own customer. Jobs inside a project use the project's customer; changing the project customer synchronizes its jobs.
- Deleting a project removes the project association from its jobs rather than presenting project deletion as deletion of all underlying work.

### Planning, Status, And Overview

- Jobs support title, description, number, customer/project context, priority, planned date and time, estimated duration, planned total working time, location, status, and actual completion date.
- **Site and contact references (P1-01):** a job can reference one of its customer's durable work sites (`Einsatzort`) and one contact person (`Ansprechpartner`); a project can carry a default site/contact that prefills new jobs and remains overridable per job (no forced sync). Selecting a site copies its current address into the job's free-text location as a snapshot — later site edits never rewrite the recorded location of existing work. Changing the customer of a job or project clears the previous customer's site/contact references, including on child jobs when a project's customer changes. The assigned field worker sees site address, access notes, and a click-to-call contact on the job detail.
- **Execution lifecycle (P1-14):** new work uses the fixed canonical states `not_started`, `in_progress`, `interrupted`, `execution_complete`, `handed_over`, and `cancelled`, with a version-checked transition matrix and append-only events. Planning, live readiness, blockers and parking are separate facets, so scheduled work can still be blocked and field-complete work can still await handover. Existing production rows keep nullable canonical state and their conservative legacy projection until the first explicit lifecycle action; no migration event is fabricated.
- **Office-reviewed handover (P1-17):** execution-complete jobs and projects own separate durable package roots. Büro/Admin select exact approved artifact revisions, exact document versions and, for projects, exact current child-job releases; classified gates distinguish hard blockers, reasoned exceptions, warnings and explicitly unassessed areas. One guarded release transaction freezes the customer-safe package and responsibility/readiness snapshots, registers the deterministic HTML document and moves the target to `handed_over`. Withdrawal, correction and re-release retain every prior package, reason and lifecycle event.
- **Installed-equipment links (P1-18):** service-owned equipment can retain exact installation, commissioning, service, removal or replacement links to an existing job/project, exact work-artifact revision or exact immutable handover release. Work remains the operational owner and is not copied into a service note. Assigned field workers see only the compact equipment explicitly linked to their exact job; the link does not grant project, customer, sibling-equipment or document-library access.
- **Reactive service handoff (P1-19):** a service case can link to exactly one existing job when office staff turn the reported issue into executable work. The service case remains the intake, triage and outcome record; the job remains the owner of scheduling, dispatch, field execution, evidence, material and completion. The link grants no extra access by itself.
- **Visible work summary (P1-14):** job and project detail pages show execution state, planned/unplanned, start readiness, blockers/parking, prerequisites, the next action, completion gates and recent history together. Lists and embedded work sections use the canonical execution label where present and the legacy projection otherwise; active filters are „Nicht begonnen“, „In Ausführung“ and „Unterbrochen“.
- **Canonical blocker and parking model (P1-14):** `work_blockers` supports several simultaneous blockers with a bounded reason, details, responsible employee record, next-review date, resolution and version. Parking is a special blocker kind, not an execution state. Its atomic manager action cancels the schedule/dispatch context without rewriting execution. P1-12 parking contexts/events were migrated into this model and their old tables/RPC removed; context-free legacy parked work remains labeled „Kontext fehlt (Altbestand)“.
- **Dependencies and gates (P1-14):** `work_dependencies` adds bounded job/project/instruction or declared approval/delivery/site/external-trade prerequisites with start, completion or warning effect. Existing P1-13 instruction dependencies remain the checklist source of truth and are enforced during instruction completion and work completion. Start and completion are checked atomically from current facts; manager exceptions require a reason and record a gate snapshot/fingerprint.
- **Readiness (P1-14):** work detail reuses the P1-12 `composeReadiness` projection. Capacity, qualification, site, travel, material and tools remain per-dimension `ok`, `warning` or `unknown`; there is no stored ready boolean. Material stays „nicht reserviert“ and tools stay „nicht bewertet“.
- **Dispatch (P1-12):** handing work to the field is a distinct auditable fact. A versioned dispatch instruction targets one scheduled visit or one unscheduled job; assigned employees confirm or challenge the current revision on the job detail („Mein Einsatz"). Parking a job cancels its active dispatches visibly; acknowledgement never stands in for attendance, recorded time, or a customer promise. Details live in the calendar specification and decision record 0002.
- Execution completion records the actual completion date; reopening clears it. The first job-linked clock-in or break-end moves `not_started`/`interrupted` work to `in_progress` in the same database transaction as the time event. A blocked or terminal target rejects that time event without partial state.
- Project execution is derived from canonical/legacy child state unless a manager sets a reasoned versioned override. Clearing the override returns to derivation. Project parking atomically parks unfinished children, but ordinary project execution overrides never cascade.
- The `/auftraege` view combines standalone jobs and projects, nests project jobs, and separates active work, the `Parkplatz`, and completed/archive work.
- The work list supports search, status and type filters, customer, employee and date filters, sorting, user-specific column visibility, responsive presentation, and live updates.

### Assignment And Field Context

- Managers assign one or more organization members to a job. Employees see work through their assignments; project access is reached through assigned work.
- P1-24 inventories active job assignments before an employment transition and requires explicit reassignment through this existing owner. Organization access suspension immediately removes operational access without deleting assignments or historical participant identity; P1-33 owns final offboarding closure.
- **Focused field work pack (P1-16):** assigned employees now receive one mobile-first composition on both standalone and project-child job routes. It orders pre-arrival customer/site/contact context, one dispatch-or-lifecycle next action, instructions, structured evidence, contextual documents, own time, operational material and unresolved issues. The projection excludes sibling/project-wide detail, coworker/internal drafts, document governance and commercial/valuation facts; all actions remain with their existing domain owners. Admin and Büro retain the full established detail composition.
- Assigned employees can open the relevant job detail, see operational context, record job-linked time, complete instruction items, upload/view documents and photos, and book inventory take/return actions available to them.
- Managers retain control over work creation, editing, assignment, cancellation, office handover, parking, dependencies, gate exceptions and project overrides. Assigned employees receive only start/interruption/resume/execution-complete actions plus their own blocker report/resolution path and the compact customer-safe current handover summary for their assigned job.
- Since `P1-09`, managers can attach organization-curated skill/certification requirements to a job. The job detail explains whether the selected people cover each requirement (`covered`, internally unconfirmed, expired, not yet valid, or missing) and attributes the strongest matching person. Assignment changes across create, edit, detail, and calendar paths are assessed atomically on the planned date; uncovered selections remain possible only through a reasoned, fingerprinted assessment record. Requirements guide planning and do not claim legal authorization.
- Calendar views consume job dates, times, duration, customer/location context, project context, priority, status, and employee assignments. Parked jobs are excluded from scheduled calendar work.
- **Occurrence planning (P1-11):** one job can have several planned visits without duplicating the job. Job visits reference the job as the source of work identity and customer/location context; recurring planning materializes occurrences, not synthetic jobs. The compatibility projection keeps the job's legacy planned date/time/duration and `job_assignments` aligned with its current visit plan so existing list/detail/field-access flows continue to work. Planned occurrences and actual job-linked time remain separate.
- Once a job has durable planning occurrences or event history, hard deletion is refused with a clear manager-facing explanation. The append-only planning ledger is not silently erased through a cascade; archival/retention and any eventual deletion workflow require an explicit downstream product decision.

### Instructions, Time, Documents, And Materials

- Jobs have ordered instruction/checklist items. Managers create, edit, reorder, and remove them; assigned employees can mark them complete or reopen them. The last status actor and time are retained. Since P1-13 the same primitive also carries task/checklist kind, required/optional state, optional group and notes, expected evidence, structural prerequisites, and immutable template-origin attribution; project-level rows use the same table and remain manager planning.
- **Work templates (P1-13):** Admin/Büro manage organization-created Auftrag or Projekt templates under `/arbeitsvorlagen`. A stable template owns numbered versions; one draft is editable, while every published version and its normalized task/checklist, evidence, material, capability and dependency rows are immutable. Editing published content creates the next draft. Archive hides a template from application pickers without deleting versions or applied work.
- Applying a published version at direct creation, request conversion, or later on incomplete work materializes editable rows into `job_instruction_items`, their evidence/dependency children, `job_material_lines`, and `job_capability_requirements`. The application records the exact version and source rows. Later template edits never rewrite the Auftrag or Projekt. The same version cannot be applied twice; another template/version is additive only after explicit confirmation.
- Template application is planning only: it creates no stock movement or reservation, no planning occurrence, dispatch, assignment, actual time, document, approval, signature, message, attention item or execution gate. Inactive referenced catalog data blocks the whole transaction. Existing job assignments still use the P1-09 fingerprinted qualification assessment and reasoned override.
- **Structured work artifacts (P1-15):** job and project details share one `Arbeitsnachweise` surface for Bautagebuch, Arbeitsbericht, Aufmaß, Mangel and Regie-/Änderungsnachweis. One stable artifact owns immutable numbered revisions; exact-revision review decisions, customer outcomes, signatures, document/time sources, evidence fulfilment and deterministic HTML exports remain attributable. Assigned field workers get the job/project-bounded capture path; managers get organization-wide capture, review, export, customer recording and reasoned void actions. A decided record is corrected by a new revision and voided rather than deleted.
- P1-15 makes required instruction evidence, formal artifact approvals and required customer/signature outcomes assessable in the existing lifecycle snapshot. P1-17 consumes those exact-version facts without turning defects into blockers or measurements into prices; neither feature changes schedule, dispatch, time, stock, billing or messages.
- Job and project detail pages show linked time entries. Project views aggregate time from their jobs.
- **Explicit factual time (`P1-21`):** work, travel and call-out segments can reference one normal job or remain explicitly unallocated. The global clock and assigned-worker field pack use the same versioned attendance session; starting or switching to work/call-out on a job can atomically start or resume its execution lifecycle, while travel never does. Job, project, field-pack, artifact, handover and maintenance projections read the shared legacy-plus-canonical compatibility view. They do not own, copy or correct time, and canonical synthetic rows stay read-only until `P1-22`.
- Contextual `Dokumente & Bilder` sections link work to the central document system. Assigned employees can upload and view files on their jobs; managers have broader project and document-management actions.
- Job and project detail pages already include `Material & Inventar`.
- Managers can plan material without changing stock. Users can explicitly take stock or return previously taken quantities. Unplanned take actions are supported.
- Project views can show direct project material, material inherited from child jobs, and project totals. Material records distinguish planned, taken, returned, billable, and unplanned quantities even though commercial invoice workflows are not yet implemented.

### Important Current Limitations

- Request intake and once-only conversion exist (P1-02), and P1-19 can qualify a request into a reactive service case that later links one existing job. Converting a request directly into an update of existing work remains deferred.
- P1-14 distinguishes execution completion from handover; P1-15 supplies structured evidence and exact-version decisions; P1-16 supplies the web field work pack; P1-17 supplies office review, a customer-safe package, operational commercial-readiness classification and immutable reopening history; P1-21 supplies factual time segmentation. Delivery/public access, billing, service-equipment history, time correction/approval, material consumption and offline/mobile behavior remain later scope.
- P1-15 artifacts are operational evidence, not a handover package, service equipment history, commercial acceptance, invoice basis or qualified electronic signature.
- Planned-versus-actual comparison now has a reliable visit-level planning source (`P1-11`) and separate actual time records, but there is still no complete operational variance or profitability view.
- Structured offers, contracts, invoices, payments, and accounting remain outside the current implementation.
- The web app does not yet provide a defined offline job pack or the planned unified React Native employee experience.

Exact schema, RLS, and live permissions must still be checked against live Supabase and generated types before implementation work.

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
