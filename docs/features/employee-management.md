# Employee Management

Status: living — last reviewed 2026-09-03

Employee management covers the complete operational relationship between an organization and the people who work in it: membership, access, personnel information, employment conditions, availability, qualifications, assignments, leave, personnel documents, and controlled handoffs to time tracking and payroll.

This is a future-facing product specification. It distinguishes the implemented baseline from the capabilities WerkFlow should provide when the operational core is complete. Exact schema and permission details must still be verified against live Supabase, generated types, and current application code before implementation work.

## Product Goal

WerkFlow should give an SHK business one reliable place to answer:

- Who works in the organization, in which capacity, and with which access?
- Who is available, qualified, and permitted for a specific Auftrag?
- Which employment conditions and work schedule apply on a given date?
- Which onboarding, document, certification, leave, or offboarding actions are still open?
- Which information may the employee, office, management, payroll, or project lead see and change?

The product should replace personnel spreadsheets, paper folders, scattered certificates, informal availability knowledge, and repeated master-data entry without turning WerkFlow into a complex generic HR suite. Employee-facing tasks should remain part of the same simple WerkFlow experience used for jobs, time, documents, and inventory.

## Current Product Baseline

As of 2026-09-02, every person in an organization has one personnel record that carries employment conditions, a work schedule, responsibilities, vacation and sickness, teams and qualifications, a time account, protected personnel documents, and a controlled access and employment lifecycle. Admin and Büro manage people on `/mitarbeiter` and under **Einstellungen**. Employees act on their own data from `/zeiterfassung`, `/qualifikationen`, `/aufgaben`, and, before their start date, `/onboarding/meine-aufgaben`.

- Membership and roles. The fixed roles `admin`, `buero`, and `employee` appear as `Admin`, `Büro`, and `Handwerker/in`. Nobody can change their own role, appoint a second admin, or remove themselves, and Büro manages employees but not peers or admins. Custom roles and per-field permissions are intentionally absent ([Grundstock](../product/user-flow-catalog.md#grundstock-vor-phase-1-stand-vor-p1-00-4-august-2026), [P1-05](../plans/phase-1/slices/p1-05-scoped-responsibilities.md)).
- Invitations and the member list. Admin and Büro invite Büro or employee members by email, manage pending invitations, and see the member list with clock status and daily progress on `/mitarbeiter`; employees are redirected away. New users can also join by organization code ([Grundstock](../product/user-flow-catalog.md#grundstock-vor-phase-1-stand-vor-p1-00-4-august-2026)).
- Personnel record. Admin and Büro maintain **Personalien** with the employee number `MA-NNN`, contact and emergency data, entry and exit dates, and notes, and see every change in **Verlauf**. People without a login live under **Weiteres Personal**; **Zugang einladen** connects an account to the existing record later without creating a duplicate. For people with a login the profile name stays authoritative ([P1-03](../plans/phase-1/slices/p1-03-employee-records.md)).
- Employment conditions. **Beschäftigung** holds date-effective versions of employment type, weekly hours, and vacation days per year; the version effective on a date is the newest one on or before it, so past work keeps its meaning. Compensation fields do not exist by decision. Employment and access states are derived from dates and login state, never stored ([P1-03](../plans/phase-1/slices/p1-03-employee-records.md)).
- Work schedules and holiday context. Each person carries date-effective **Arbeitszeitmodell** versions with minutes per weekday, and the schedule wins over the condition's weekly hours for time targets. Admin selects the holiday region and, with Büro, maintains **Betriebsruhe** days at `/einstellungen/zeiterfassung`; only today and future days can change. The daily target resolves per date from the schedule, else labeled weekly hours, else a visibly labeled 8h default, and holidays or closure days set it to 0 ([P1-04](../plans/phase-1/slices/p1-04-work-schedules-and-holidays.md)).
- Scoped responsibilities. The organization owner configures **Zeitfreigaben** and **Urlaubsfreigaben** under **Einstellungen → Mitarbeiter**: either the role default, where Admin and Büro decide, or a named holder set that replaces it without granting other manager access. Authority is resolved server-side at action time, self-approval is always denied, and every change goes through the **Auswirkung vor dem Speichern** preview ([P1-05](../plans/phase-1/slices/p1-05-scoped-responsibilities.md)).
- Substitutes. A holder can have a substitute for an inclusive date window who inherits exactly that holder's scope and loses it when the window ends, even if a browser still shows the old view. Affected people see **Meine Verantwortlichkeiten und Vertretungen** in their settings ([P1-05](../plans/phase-1/slices/p1-05-scoped-responsibilities.md)).
- Vacation. Employees request and withdraw their own vacation in **Urlaub & Abwesenheit**; `leave_approval` holders decide in the **Anträge** tab and can cancel approved vacation with a reason. Entitlement comes from the employment condition, only days with a positive target consume it, and the balance is plain arithmetic or the labeled „Kein Urlaubsanspruch hinterlegt". Approved vacation lowers the daily target and blocks clock-in on that day ([P1-06](../plans/phase-1/slices/p1-06-vacation.md)).
- Sickness. A sickness report is a fact, not a request: employees report themselves in **Krankmeldung**, Admin and Büro record on someone's behalf, and corrections happen on the same report with a reason. There is no diagnosis field by design, and the type and evidence status exist only for the person and Admin/Büro while the shared calendar shows a neutral „Abwesend – Name". Active sickness sets the target to 0 but does not block clock-in ([P1-08](../plans/phase-1/slices/p1-08-sickness.md)).
- Teams. Teams are date-effective planning shortcuts that grant no rights; picking a team in an assignment control expands the members active on that date ([P1-09](../plans/phase-1/slices/p1-09-teams-and-qualifications.md)).
- Qualifications. Admin and Büro maintain an organization catalog of skills and certifications, assign entries with validity and evidence status, and attach requirements to jobs; every assignment re-checks coverage on the planned date, and a gap can be overridden only with a recorded reason. „Intern bestätigt" is an operational fact, not a legal claim. Employees see their own entries read-only at `/qualifikationen`, and expiring certificates surface on `/aufgaben` ([P1-09](../plans/phase-1/slices/p1-09-teams-and-qualifications.md)).
- Attention. `/aufgaben` shows the approvals a person can decide right now, decision notifications, and **Meine Anträge**; badges never count an item the viewer cannot act on ([P1-07](../plans/phase-1/slices/p1-07-attention-pattern.md)).
- Dispatch acknowledgement. Employees confirm or challenge the current revision of a dispatched work instruction; acknowledgement never stands in for attendance or recorded time ([P1-12](../plans/phase-1/slices/p1-12-dispatch.md)).
- Time facts. Each membership owns one attendance session with explicit activity segments. Managers inspect time but never impersonate live capture, and a self-correction always needs a second `time_approval` holder ([P1-21](../plans/phase-1/slices/p1-21-time-segments.md), [P1-22](../plans/phase-1/slices/p1-22-time-corrections-and-approvals.md)).
- Time accounts. Every in-scope personnel record, including records without a login, has an explicitly opened time account; a missing opening balance, schedule, or policy blocks period close for that person instead of counting as zero. Employees see their own account and monthly statements under `/zeiterfassung/zeitkonto` ([P1-23](../plans/phase-1/slices/p1-23-time-accounts-period-close-and-payroll-export.md)).
- Access and employment lifecycle. Admin plans activation, suspends, reactivates, or ends organization access and runs employment transitions without deleting the record, its history, or the global login; a record without a lifecycle is labeled as not controlled. The owner and the last effective Admin are protected, and the last holder of a responsibility blocks an employment transition until reassigned ([P1-24](../plans/phase-1/slices/p1-24-controlled-people-lifecycle.md)).
- Onboarding. Organization templates have immutable published versions; an instantiated plan holds editable typed requirements that reference existing documents, qualifications, conditions, schedules, teams, or acknowledgements. Only an explicit `blocks_access` requirement delays activation, and missing configuration is never shown as complete ([P1-24](../plans/phase-1/slices/p1-24-controlled-people-lifecycle.md)).
- Protected personnel documents. The classes `personnel_standard`, `admin_restricted`, and `health_evidence` sit outside the ordinary library and never follow a responsibility, job assignment, or ordinary document permission. Admin sees every class, Büro manages standard files, and the person sees only explicitly released versions or uploads their own requested health evidence. An acknowledgement proves that one exact version was seen and makes no signature claim ([P1-24](../plans/phase-1/slices/p1-24-controlled-people-lifecycle.md)).

### Important current limitations

- Capacity conflicts, minimum staffing, shift rotations, and date-specific schedule overrides belong to planning ([P1-11](../plans/phase-1/slices/p1-11-planning-occurrences.md)); employee management shows only absence signals.
- Vacation and sickness are the only absence types. Training, special leave, compensatory time, and hour-based absence are later scope. Time-account adjustments, expiry, and payout are manual four-eyes events with no automatic carryover, expiry, or money calculation.
- Attention is in-app only: no reminders, escalation, notification preferences, or external delivery, which is `P1-46`.
- A sole admin's own vacation request has no eligible approver until named `leave_approval` holders are selected.
- Employees cannot propose corrections to their own master data or conditions. Their self-service is vacation, sickness, acknowledgements, released documents, and requested evidence.
- Ownership transfer and emergency owner recovery do not exist yet.
- Member removal is still the legacy destructive flow: it closes an open session, deletes that member's legacy time entries in the organization, and removes the membership, while canonical sessions and the personnel record survive as `Ausgeschieden`. It is not an archive or offboarding workflow; `P1-33` replaces it.
- No compensation, payroll profile, payslip, provider integration, electronic signature, legal retention, or complete organization export exists. `P1-23` supplies only a generic payroll-ready ZIP with employee and code mapping.

## Phase 1 — Complete Operational Core

Phase 1 is not an MVP or a thin employee directory. It is the complete people-operations foundation expected before intelligence and automation become the focus.

### Organization Membership And Employment Identity

- Represent a person once per organization while keeping authentication identity, organization membership, and employment relationship understandable as distinct concepts.
- Support invited, active, temporarily inactive, future-start, notice-period, exited, and archived states without erasing operational history.
- Keep a stable employee number and organization-specific identity even when name, email, account, role, or employment conditions change.
- Capture the practical personnel master data the business needs: names, preferred form of address, business and private contact channels where appropriate, address, emergency contact, employee number, start/end dates, employment type, department/team, manager or responsible office contact, and operational notes.
- Make field ownership and visibility explicit. An employee should know which information they can maintain themselves and which information requires office review.
- Support people without immediate app access, such as a future starter or short-term worker, while making the difference between “personnel record” and “active login” obvious.
- Preserve organization boundaries when one user belongs to more than one organization. Employment data, permissions, schedules, balances, and documents must never leak between organizations.
- Provide import, duplicate review, and data-completeness status so onboarding an existing workforce does not require retyping every record blindly.

### Roles, Permissions, And Responsibilities

- Keep understandable default role experiences for owner/admin, office/manager, and field employee.
- Define permissions by recognizable business capability: people data, sensitive personnel data, access management, job planning, time review, leave approval, documents, inventory, finance handoff, and organization settings.
- Show the effective result of a permission change before it is applied, including lost access and responsibility gaps.
- Separate operational responsibility from unrestricted personnel access. A project lead may allocate work without seeing compensation, health, or contract data.
- Allow approval responsibility and temporary delegation to be assigned explicitly, with start/end dates and a visible substitute.
- Make every denied or hidden action understandable. Users should not encounter controls that appear available but fail after submission.
- Preserve a safe organization-owner path. Ownership transfer, the last-admin case, and emergency access recovery require dedicated flows rather than ordinary role editing.
- Keep fixed role presets as the safe default. Whether Phase 1 also includes custom roles or only scoped responsibility presets is a decision gate; permission semantics must be stable before exposing a role builder.

### Personnel Master Data And Employment Conditions

- Record effective-dated employment conditions so a future change does not silently rewrite past time, leave, costing, or payroll periods.
- Cover employment type, weekly target hours, working days, probation and notice information, contractual start/end, vacation entitlement, cost center or team, and other payroll-relevant classifications selected by the business.
- Support part-time, apprentices, temporary staff, marginal employment, changing hours, and parallel conditions over time without forcing every person into an eight-hour weekday assumption.
- Separate operational hourly cost or costing information from compensation details, and protect both with stricter permissions than ordinary employee data.
- Show the current condition first while keeping previous and scheduled conditions available to authorized users.
- Warn when required conditions are missing before schedules, leave balances, time accounts, job costing, or payroll exports depend on them.
- Avoid making legal conclusions. WerkFlow records the organization's chosen conditions and highlights inconsistencies; the employer and its advisers remain responsible for correctness.

### Work Schedules, Availability, And Capacity

- Support recurring weekly work patterns, flexible schedules, shift patterns, fixed days off, seasonal arrangements, and effective-dated changes.
- Allow date-specific overrides without destroying the underlying pattern.
- Combine contractual target time, approved absence, holidays, training, planned assignments, and other unavailability into one understandable availability result.
- Show capacity in planning at employee, team, day, and week level, with conflicts explained rather than represented as an unexplained color.
- Distinguish “not working by schedule,” “approved absent,” “tentatively requested,” “already assigned,” and “unknown/unconfigured.”
- Support team membership and operational grouping without turning teams into a second permission system.
- Provide office users with a useful planning view while giving employees a simple personal schedule in the same app.

### Skills, Certifications, And Operational Eligibility

- Maintain practical skills, trade specializations, experience tags, languages, driving permissions, safety qualifications, manufacturer training, and other SHK-relevant capabilities.
- Record certification or qualification validity, issuing body, evidence, renewal date, and any operational restriction where needed.
- Make expiring, expired, missing, and verified states visible to the right people.
- Link supporting evidence to the protected personnel-document context rather than relying on notes or filenames.
- Let job planning filter or warn by required qualification without claiming that software alone proves legal eligibility.
- Allow a job to express required capabilities and show whether the assigned team covers them.
- Support planned training and renewal work as availability-impacting events.
- Keep skill data practical and curated. Free-form tags may supplement, but should not replace, a usable organization vocabulary.

### Contracts And Personnel Documents

- Give each employee a protected personnel-document area for employment contracts, amendments, certificates, policies, acknowledgements, payroll-related forms, and other employee records.
- Separate personnel-document access from the ordinary manager document library. Access to job documents must not imply access to contracts or health-related evidence.
- Support document requirements by employment type or role, with missing, pending, valid, expiring, and superseded states.
- Preserve versions, who uploaded or changed a document, and when a document became effective.
- Support employee acknowledgement or signature status where the business needs proof that a policy or document was received.
- Allow a document to be operationally referenced without exposing more of the file than necessary. For example, planning may need “qualification valid until …” without revealing the full certificate to every planner.
- Support controlled export and retention on offboarding. Retention and deletion rules must be decided by document category, not by one blanket “delete employee” action.

### Onboarding

- Provide a role-appropriate onboarding plan from accepted offer or future start through first productive day.
- Cover personnel-data completion, app invitation, role/access assignment, employment conditions, work schedule, required documents, policy acknowledgements, qualifications, training, team assignment, equipment/vehicle/tool handover, and first job readiness.
- Show owner, due date, status, blocker, and evidence for each onboarding requirement.
- Allow reusable organization templates for common profiles such as `Handwerker/in`, apprentice, office staff, or project lead while keeping the generated checklist editable.
- Coordinate the moment account access begins. A future starter should not accidentally see operational data before the intended date.
- Give the new employee one short, guided list of their own required actions rather than exposing an office checklist.
- Make incomplete onboarding visible in assignment planning when the missing item affects readiness or safety.

### Offboarding And Employment Changes

- Treat offboarding as a controlled transition, not deletion.
- Support planned end dates, immediate suspension where authorized, notice-period changes, and reactivation when a departure is reversed.
- Identify open responsibilities before exit: assigned jobs, pending time or leave requests, approvals owned by the person, documents, tools/assets, vehicle access, inventory responsibility, and unfinished onboarding/training tasks.
- Reassign work and approvals explicitly; do not silently drop ownership.
- End or revoke app access at the intended time while retaining the historical name and relationship on jobs, time entries, stock movements, documents, and audit events.
- Track return of tools, keys, vehicles, devices, clothing, and other issued assets.
- Finalize time, leave, and payroll handoffs for the last period, including later corrections.
- Provide authorized export and category-based retention/deletion workflows. An exited employee should disappear from normal active planning without becoming “unknown” in historical records.

### Leave, Vacation, And Sick Workflows

- Support organization-defined absence types such as vacation, illness, child illness, training, special leave, unpaid leave, compensatory time, and other operational unavailability.
- Derive understandable entitlement and balance views from employment conditions, carryover, approved use, manual adjustments, and expiry rules chosen by the organization.
- Let employees request, withdraw, and inspect their own leave in a simple calendar flow.
- Let authorized approvers approve, reject, request clarification, and delegate approval with an auditable reason and visible current state.
- Detect conflicts with assignments, minimum staffing, scheduled work, overlapping requests, and relevant qualification coverage without silently blocking all exceptions.
- Support partial days and hour-based absence where the organization uses them.
- Keep sick-notice capture minimal and privacy-preserving. Planning needs availability; only a tightly authorized group should see evidence or sensitive notes, and diagnoses should not be requested as a default.
- Make proof/evidence requirements configurable and explicit without presenting them as legal advice.
- Reflect approved absence consistently in employee availability, calendar planning, target hours, time accounts, and payroll handoff.
- Preserve cancellation, correction, and retroactive-change history. A changed balance must always be explainable.

### Assignments And Operational Context

- Show each employee's current and upcoming jobs, projects, team, planned effort, role on the assignment, and conflicts.
- Let authorized planners assign individuals or teams based on availability and required capabilities.
- Keep the employee's field view limited to actionable assigned work, related customer/site context, permitted documents, time capture, and inventory actions.
- Make reassignment visible to affected employees and planners, including what changed and when.
- Preserve historical assignment participation even after the person leaves or the current assignment changes.
- Distinguish planned assignment, accepted/acknowledged assignment where needed, actual attendance, and recorded time. None of these should silently stand in for another.

### Employee Self-Service

- Give employees one personal surface for profile completion, schedule, assignments, time, leave, documents requiring action, certifications, and issued assets.
- Show exactly which personal fields can be changed directly, which become a review request, and which require office contact.
- Let employees see their own employment-condition summary, target schedule, leave balance calculation, time account, and request status in plain German.
- Provide downloadable copies of documents and exports the employee is entitled to receive.
- Keep office-only and sensitive concepts out of the normal field flow through progressive disclosure, not a collection of separate specialist apps.
- Ensure apprentices and users with low technical confidence can complete common actions with a small number of explicit choices.

### Privacy, Auditability, And Record Quality

- Apply least-privilege access separately to ordinary profile data, personnel documents, compensation/costing, health-related absence evidence, and access administration.
- Show authorized users who changed important employment, schedule, entitlement, role, document, or status data; retain before/after values and effective date.
- Give the employee visibility into meaningful changes affecting their schedule, balance, access, or employment information.
- Avoid hidden states: pending, incomplete, blocked, inactive, archived, expired, and scheduled changes must have visible explanations.
- Support correction, export, retention, and deletion processes without breaking legally or operationally relevant history.
- Minimize collected data and avoid exposing private contact information in job, calendar, inventory, or CRM surfaces.
- Make data-quality problems actionable: duplicate people, missing schedules, invalid date ranges, unverified certificates, missing payroll identifiers, and inconsistent balances.

### Payroll And Accounting Handoffs

- Maintain the employee identifiers and classifications required to hand approved working time, absence, supplements, and costing information to the organization's payroll/accounting process.
- Map WerkFlow concepts to an organization's wage types, cost centers, and export expectations without hard-coding one payroll provider as the product model.
- Provide a preflight view of missing employee data, unapproved time, unresolved absence, invalid balances, and changes after period close.
- Support an explicit period-ready status, controlled close, export history, and traceable correction/re-export.
- Preserve the distinction between operational job cost, payroll-relevant value, and customer-billable value.
- Support structured exports and integration handoffs with stable employee references. Native payroll calculation is not implied.

## Connected Workflow Contracts

These contracts describe the information each feature area may provide or consume. They are product contracts, not a database design.

| Connected area | Inputs employee management consumes | Outputs employee management provides | Contract rules |
| --- | --- | --- | --- |
| Jobs and projects | Required capabilities, planned dates, assignment role, responsible lead, expected effort, site restrictions | Eligible/available people, team membership, qualifications, current assignments, contact details permitted for the job | Assignment does not prove attendance or time worked. Historical participants remain identifiable after offboarding. |
| Calendar | Jobs, appointments, training, holidays, and other planned events | Work pattern, approved/tentative absence, availability, capacity, assignment conflicts | Every conflict explains its sources. Sensitive absence details are reduced to the minimum planning status. |
| Time tracking | Actual entries, time-account effects, correction/approval state, payroll-period status | Effective work schedule, target hours, employment-condition version, absence, approver, employee identity | Historical time uses the conditions effective on that date. Offboarding never deletes approved time history. |
| Documents | Document versions, links, acknowledgements, retention/audit capabilities | Employee context, document requirements, access classification, certification validity, onboarding/offboarding requirement | Personnel files have stricter access than ordinary employee-linked or job documents. A link does not broaden access automatically. |
| Finance and payroll | Wage-type/cost-center vocabulary, export status, payroll feedback, closed periods | Stable employee identifiers, approved absence/time inputs, cost allocation, employment classifications | WerkFlow does not silently recalculate payroll. Post-close corrections are versioned and re-exported deliberately. |
| Inventory and assets | Tool/asset issue, transfer, return, loss/damage, vehicle stock responsibility | Active/inactive status, assignment context, responsible person, offboarding return requirements | Employment exit does not erase movement history. Personnel access does not automatically expose prices or stock administration. |
| CRM and customers | Customer/site restrictions and customer-facing staffing requirements | Assigned employee's permitted business contact and operational role | Private personnel data and internal employment information never flow into CRM or customer-visible artifacts. |

## Role And UX Principles

### Admin / Owner

- Owns organization access, employment-policy configuration, sensitive-data delegation, and final accountability.
- Needs exception-first oversight rather than a screen full of every personnel field.
- Must be protected from removing the last safe owner/admin path.

### Büro / Office / People Operations

- Needs fast employee onboarding, planning, document follow-up, leave coordination, time readiness, and payroll preflight.
- May receive broad operational responsibility without automatically receiving compensation or health-document access.
- Should manage by queues, missing requirements, and upcoming changes rather than hunting through individual profiles.

### Project Lead

- Needs availability, assignment, skills, and business contact information.
- Should not receive contracts, compensation, sick evidence, private contact details, or global access administration solely because they lead work.
- This responsibility may be represented through scoped permissions rather than a new global role.

### Handwerker/in And Apprentice

- Uses one WerkFlow app for assigned jobs, schedule, time, leave, documents requiring action, and inventory.
- Sees personal balances and status in understandable language with no hidden approval or synchronization state.
- Gets guided choices, strong defaults, and explicit confirmation for consequential changes.

### Shared UX Rules

- Use progressive disclosure: show the current status and next action first, with history and specialist detail available when needed.
- Prefer natural German employment language over HR or technical jargon.
- Make every balance, warning, permission, and readiness state explainable.
- Never represent missing configuration as zero, available, compliant, or complete.
- Keep web and future mobile behavior consistent; avoid splitting employee work across specialist apps.
- Preserve keyboard, screen-reader, focus, and mobile usability for all common flows.

## Phase 2 — Intelligence And Automation

Phase 2 should reduce coordination work after Phase 1 data and auditability are trustworthy:

- Suggest suitable employees for a job from availability, qualifications, team continuity, location context, and workload, with the planner making the decision.
- Predict capacity gaps and qualification bottlenecks before schedules are published.
- Produce onboarding/offboarding plans from role and employment context, while showing every generated requirement for review.
- Extract proposed master data, validity dates, and document type from personnel documents with source references and human confirmation.
- Warn about expiring certificates, missing acknowledgements, unresolved offboarding assets, and payroll-readiness gaps.
- Summarize staffing, leave, and personnel-document exceptions for authorized users without exposing sensitive details to unauthorized roles.
- Suggest leave coverage options and schedule changes rather than silently reassigning jobs.
- Answer permission-aware natural-language questions such as “Which refrigeration-qualified employees are available next Tuesday?” using traceable source data.
- Prepare employee or payroll changes as reviewable drafts; never autonomously change access, employment conditions, compensation, leave decisions, or personnel-document retention.

Every intelligent action must show its source, proposed result, confidence or uncertainty where relevant, approval point, audit record, organization boundary, and recovery path.

## Boundaries And Decision Gates

- WerkFlow is an operational people-management system first, not a full payroll engine, recruiting suite, performance-management platform, or source of employment-law advice.
- The boundary between a practical personnel record and a full HRIS must be validated with SHK businesses before adding generic enterprise HR features.
- Phase 1 is fixed roles plus the tested scoped-responsibility vocabulary. A custom-role or field-permission builder remains a separate future decision gate and must not be inferred from this model.
- Personnel-document categories, retention periods, deletion rights, and employee access require legal/privacy review; do not invent one universal policy.
- Health and sick-leave data must remain minimal. Diagnosis capture, broad manager visibility, or medical-document sharing is outside the default product.
- Compensation storage, native payroll calculation, and specific payroll-provider integrations are separate decision gates.
- Location tracking, biometric attendance, employee scoring, productivity surveillance, and automated disciplinary conclusions are not Phase 1 defaults and require explicit product, privacy, and worker-representation review.
- Team leads, dispatchers, external workers, subcontractors, and people without user accounts need a deliberate identity/permission model before being treated like normal employees.
- Deactivation/archive must replace destructive membership removal before offboarding is considered complete.
- Employee data portability and customer exit behavior must be decided before assisted migration is promised.

## Open Product Decisions

Resolved with `P1-03` (2026-08-05): the V1 master-data and condition field set (all optional except a last name for non-login records), manual org-unique `MA-NNN` employee numbers with auto-suggestion, the derived state vocabulary (`Aktiv`/`Geplant`/`Ausgeschieden` × `Mit Zugang`/`Eingeladen`/`Ohne Zugang`), no compensation storage in this slice, no employee self-service surface yet, and the personnel record surviving destructive member removal as `Ausgeschieden`.

Resolved with `P1-04` (2026-08-05): the first configurable work-schedule pattern is a date-effective weekly pattern (minutes per weekday) keyed to the employee record; the schedule wins over the condition's contractual weekly hours for targets, shown as a non-blocking mismatch hint. Public-holiday calendars ship as an in-code per-Bundesland dataset (no external API; 16 states, Bavaria with/without Mariä Himmelfahrt) selected org-wide by the admin with effective-from history; closure days („Betriebsruhe") are today/future-only entries maintained by admin/Büro. Holidays and closure days set the day's target to 0. Missing configuration resolves through a labeled display-time fallback (condition-derived, else the visibly labeled legacy 8h) — nothing is persisted that a human did not enter.

Resolved with `P1-05` (2026-08-06): Phase 1 keeps the fixed `admin`/`buero`/`employee` roles and adds exactly two named responsibilities, `time_approval` (**Zeitfreigaben**) and `leave_approval` (**Urlaubsfreigaben**), with named holders and date-effective substitutes. There is no generic role builder. Responsibility assignments key to the organization-specific employee record but authorize its linked active login; role-default snapshots preserve existing behavior when an organization configures nothing. Only the owner edits the model, every change has an effective-result preview and append-only audit, and affected people can inspect their own effective state. Ownership transfer remains a dedicated future flow.

Resolved with `P1-06` (2026-08-06): the vacation year is the calendar year; the entitlement for a year comes from the newest employment condition effective within it (mid-year changes take the latest entered value — no pro-rata law); vacation-day consumption derives from resolved daily targets (positive-target days only, half days count 0,5) and is snapshotted at approval; missing entitlement is a labeled exception that never blocks requesting, and approving without stored entitlement is a deliberate, visibly warned organizational choice; withdrawal (requester, pending only) and cancellation (approver, approved only, with reason) are distinct traceable transitions; an approved full-day vacation blocks clocking in with cancellation as the correction path; carryover, expiry, manual adjustments, and hour-based absence are explicitly deferred.

Resolved with `P1-08` (2026-08-08): the illness/proof/evidence flow. A sickness report is a reported fact in its own sibling table (`reported` → `cancelled`, corrections in between, open-ended and retroactive first-class, overlap with vacation allowed with no automatic balance effect — the explicit vacation-cancellation path stays the correction tool); self-report and office entry both exist; management authority is the fixed manager role (no `leave_approval` reuse, no new responsibility vocabulary); the privacy matrix is layered disclosure (availability facts flow, type/evidence stay on self/manager surfaces, the shared calendar is neutral, colleagues see nothing); no diagnosis field exists anywhere; evidence is per-report tracked state without file bytes (files deferred to `P1-24`); clock-in on a sick day warns instead of blocking; sickness notifications are version-keyed in-app notices for the affected person and managers.

Resolved with `P1-09` (2026-08-08): teams are date-effective planning convenience keyed to the employee record and grant no role, permission or responsibility. The qualification vocabulary is organization-curated and split into `skill` and `certification`; WerkFlow ships no default catalog, and „Intern bestätigt" is an operational fact rather than a legal claim. Employees see only their own records under `/qualifikationen`. Every assignment path re-assesses job requirements at write time; an uncovered selection needs a reasoned, fingerprinted override. The apprentice warning is admin-only and default-off. Certification expiry enters the shared `/aufgaben` taxonomy.

Resolved with `P1-23` (2026-09-01): every in-scope personnel record, including records without a login, needs an explicitly opened time account, an authoritative schedule and an effective policy before its period can close; missing configuration is a per-person close blocker and never a zero. Employee payroll references live in a versioned export mapping that an administrator confirms. Vacation and sickness are classified per policy as paid, unpaid or informational for close and export without rewriting the absence. Compensation, payslips and payroll calculation stay outside the product.

Resolved with `P1-24` (2026-09-02): `employee_records.id` is the stable organization-specific identity. Organization access (`not_configured`, `scheduled`, `active`, `suspended`, `ended`) and employment (`planned`, `active`, `notice`, `inactive`, `exited`) are separate versioned lifecycles that never delete membership, Auth identity or history. Protected personnel documents reuse the document system under three classes, `personnel_standard`, `admin_restricted` and `health_evidence`, with exact-version releases and acknowledgements and no signature or legal-sufficiency claim. Onboarding templates are organization-created with immutable published versions and no seeded default; only an explicit access blocker delays activation. The organization owner and the last effective Admin cannot be suspended or ended without a safe successor. Full offboarding closure, asset return and final settlement stay with `P1-33`; retention, legal hold and organization export stay with `P1-45`; ownership transfer stays open.

- Which additional personnel fields are genuinely required for the first SHK customer profiles beyond the `P1-03` set, and which remain optional?
- Which future operational responsibility beyond Zeitfreigaben and Urlaubsfreigaben proves necessary in real SHK use without becoming a generic permission switch (for example, a deliberately scoped project-lead contract in `P1-09`)?
- ~~Which skills and certification templates should WerkFlow provide by default for SHK, and who verifies them?~~ Resolved with `P1-09`: no default catalog; Admin and Büro curate the organization vocabulary, and internal confirmation is an operational fact.
- ~~Which personnel documents require acknowledgement, signature, expiry, versioning, or special retention?~~ Narrowed by `P1-24`: acknowledgement binds one exact document version at one time, files reuse document versioning, evidence reports `missing`, `pending`, `valid`, `expiring` or `superseded`, and WerkFlow makes no signature claim. Still open: which personnel documents need special retention (`P1-45`).
- How should employees propose corrections to private master data and employment conditions?
- Which carryover and expiry policies (deferred out of `P1-06`) must become configurable once period close exists (`P1-23`), and do real customers need manual balance adjustments beyond dated condition changes?
- Beyond the `P1-04` weekly pattern and state-level holiday calendars: are shift rotations, seasonal patterns, or municipal holiday nuance (e.g. Augsburger Friedensfest) needed before `P1-11`, and should holiday/closure treatment ever be configurable per organization (reduce vs. credit) instead of the fixed target-0 rule?
- How does a sole-admin organization approve the admin's own vacation before ownership transfer exists?
- Should a scoped `sickness_management` responsibility ever narrow the manager-role default for sickness type/evidence visibility (deferred out of `P1-08`; would be a `P1-05` vocabulary extension with role-default snapshots), and do real organizations need Büro excluded from it?
- How should contractors, temporary workers, apprentices, mini-job workers, and non-login personnel differ from ordinary employees?
- Which tools, vehicles, devices, and inventory responsibilities belong in onboarding/offboarding?
- Which payroll/accounting products and export formats should be supported first?
- Which employee data remains visible after exit, for how long, and to which roles?
- ~~How should ownership transfer and the last-admin case work?~~ Last-admin case resolved with `P1-24`: the organization owner and the last effective Admin cannot be suspended or ended without a safe successor.
- How should ownership transfer work as a dedicated flow?

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, and links to per-slice acceptance records.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
