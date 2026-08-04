# Employee Management

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

The implemented baseline on 23 July 2026 includes:

- Organization-scoped membership and active-organization switching.
- The fixed roles `admin`, `buero`, and `employee`, shown as `Admin`, `Büro`, and `Handwerker/in`.
- Email invitations for `buero` or `employee`, including pending-invitation management, plus joining by organization code.
- A manager-facing `/mitarbeiter` route for `admin` and `buero`; `employee` users are redirected away.
- Member and invitation lists, current clock status, daily progress, and member-count/working-count summaries.
- Conservative role changes: users cannot change their own role, assign another admin, change the existing admin, or remove themselves. `buero` can manage employees but not peers or admins.
- A manager-facing employee detail page with name, email, role, join date, current work status, current-week time overview, assigned jobs, and linked **Dokumente & Bilder**.
- Contextual employee documents through the document-management system. These links are manager-facing and do not give field workers access to the central document library.
- Job assignments that connect employees to operational work and determine important field-worker access paths.

Important current limitations:

- The employee detail record is still primarily membership plus basic profile data. There is no complete personnel master record, employment history, team structure, skill/certification model, employment-condition model, work-schedule model, or emergency-contact workflow.
- There is no implemented vacation, leave, sick-notice, entitlement, approval, or absence-planning domain. The vacation card currently visible in the time dashboard is static presentation, not a real balance.
- Personnel-document privacy, document requirements, acknowledgements, and expiry workflows are not yet separate from general employee-linked documents.
- There is no structured onboarding/offboarding checklist, access-suspension state, equipment-return flow, payroll profile, payroll export, or accounting handoff.
- Current member removal is destructive: it attempts to close an active session, deletes that member's organization time entries, and then deletes the membership. This is not the intended future offboarding or retention behavior and must not be treated as an archive workflow.
- Custom roles, custom role names, and granular permission editing are not implemented.

Current application code and live database state remain authoritative if this baseline drifts.

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
- Custom roles and field-level permissions require a tested permission vocabulary and safe presets before a role builder is exposed.
- Personnel-document categories, retention periods, deletion rights, and employee access require legal/privacy review; do not invent one universal policy.
- Health and sick-leave data must remain minimal. Diagnosis capture, broad manager visibility, or medical-document sharing is outside the default product.
- Compensation storage, native payroll calculation, and specific payroll-provider integrations are separate decision gates.
- Location tracking, biometric attendance, employee scoring, productivity surveillance, and automated disciplinary conclusions are not Phase 1 defaults and require explicit product, privacy, and worker-representation review.
- Team leads, dispatchers, external workers, subcontractors, and people without user accounts need a deliberate identity/permission model before being treated like normal employees.
- Deactivation/archive must replace destructive membership removal before offboarding is considered complete.
- Employee data portability and customer exit behavior must be decided before assisted migration is promised.

## Open Product Decisions

- Which personnel fields are genuinely required for the first SHK customer profiles, and which remain optional?
- Should custom roles ship in Phase 1, or should default roles plus scoped responsibilities cover the initial need?
- Which project-lead and leave-approver responsibilities can be delegated without creating another global role?
- Which skills and certification templates should WerkFlow provide by default for SHK, and who verifies them?
- Which personnel documents require acknowledgement, signature, expiry, versioning, or special retention?
- How should employees propose corrections to private master data and employment conditions?
- Which work-schedule patterns, public-holiday calendars, entitlement rules, and carryover policies must be configurable first?
- What is the exact vacation, illness, proof, substitute-approval, and retroactive-correction flow?
- How should contractors, temporary workers, apprentices, mini-job workers, and non-login personnel differ from ordinary employees?
- Which tools, vehicles, devices, and inventory responsibilities belong in onboarding/offboarding?
- Which payroll/accounting products and export formats should be supported first?
- Which employee data remains visible after exit, for how long, and to which roles?
- How should ownership transfer and the last-admin case work?

## Related Docs

- [Product capability map](../product/product-capability-map.md) — shared phases, objects, and cross-feature rules.
- [Phase 1 build roadmap](../plans/phase-1-build-roadmap.md) — active slice order, prerequisites, evidence, and golden-scenario gates.
- [Competitive landscape](../product/competitive-landscape.md) — cross-competitor lessons on progressive disclosure, field adoption, fragmented employee apps, time transparency, and auditability.
- [Time tracking](./time-tracking.md) — actual time, time accounts, corrections, approvals, compliance configuration, and payroll handoff.
- [Calendar and resource planning](./calendar-and-resource-planning.md) — availability, skills, capacity, absence, and assignment planning.
- [Jobs and projects](./jobs-and-projects.md) — assignments, project roles, and operational work context.
- [Customers and CRM](./customers-and-crm.md) — customer/site context without exposing private employee data.
- [Document management](./document-management.md) — current employee links, contextual access, versions, audit, and future personnel-document requirements.
- [Inventory](./inventory.md) — employee material actions and future tool/asset responsibility.
- [Commercial and finance](./commercial-and-finance.md) — costing, payroll/accounting handoff, and permission boundaries.
- [AI automations](./ai-automations.md) — human-review and audit principles for future automation.
- [Product context](../../AGENTS.md) — WerkFlow's target users, product purpose, roles, language, and operational principles.
