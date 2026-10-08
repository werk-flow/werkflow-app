# Employee Management

Status: living — last reviewed 2026-10-05

Employee management covers the operational relationship between an organization and its people: membership, access, personnel data, employment conditions, availability, qualifications, assignments, leave, personnel documents, and handoffs to time tracking and payroll.

## Product Goal

WerkFlow should give an SHK business one reliable place to answer:

- Who works in the organization, in which capacity, and with which access?
- Who is available, qualified, and permitted for a specific Auftrag?
- Which employment conditions and work schedule apply on a given date?
- Which onboarding, document, certification, leave, or offboarding actions are still open?
- Which information may the employee, office, management, payroll, or project lead see and change?

The product replaces personnel spreadsheets, paper folders, scattered certificates, and informal availability knowledge. It is not a complex generic HR suite. Employee tasks stay inside the same simple app used for jobs, time, documents, and inventory.

## Current Product Baseline

Every person in an organization has one personnel record. It carries employment conditions, a work schedule, responsibilities, vacation and sickness, teams and qualifications, a time account, protected personnel documents, and an access and employment lifecycle. Admin and Büro manage people. Employees act on their own data, and a future starter sees their own onboarding tasks before the start date.

- **Roles.** Creating an organization makes the creator its Admin, with a personnel record and the default settings, in one step. If any part fails, no organization remains. The fixed roles appear as `Admin`, `Büro`, and `Handwerker/in`. Nobody can change their own role, appoint a second admin, or remove themselves. Büro manages employees but not peers or admins. Custom roles and per-field permissions are absent by decision.
- **Invitations and member list.** Admin and Büro invite Büro or employee members by email, manage pending invitations, and see each member's clock status and daily progress. Employees cannot open the member list. An invite link makes the person a member at once. Inviting a person without a login replaces their pending invite and connects the new one to their personnel record in one save, before any mail goes out. When the invite mail cannot be sent, no invite stays behind, and a personnel record keeps the invite it had before. A failed read of the list or of a personnel record's sections shows the failure with a retry.
- **Join requests.** A person who enters the organization code sends a join request and waits outside the app. Each person has one open request at most and can withdraw it. Admin and Büro see open requests in `Aufgaben` and decide them in the Mitarbeiter area. An approval adds the person as `Handwerker/in`, and the waiting person enters the app without reloading. After a decline, the person sees the decline and can enter another code. Wrong codes count against an hourly limit.
- **Personnel record.** Admin and Büro maintain the employee number, contact and emergency data, entry and exit dates, and notes, and see every change in a history. People without a login are personnel records too. Inviting such a person later connects the account to the existing record without a duplicate. For people with a login, the profile name is authoritative.
- **Employment conditions.** Employment type, weekly hours, and yearly vacation days are date-effective versions. The version that applies on a date is the newest one on or before it, so past work keeps its meaning. WerkFlow stores no compensation, by decision. A record without a controlled lifecycle shows employment and access labels derived from its dates and login state.
- **Work schedules and holidays.** Each person has date-effective weekly work patterns with minutes per weekday. For time targets, the schedule wins over the weekly hours. Admin selects the holiday region. Admin and Büro maintain company closure days, and only today and future days can change. The daily target comes from the schedule, else from the weekly hours, else from a visibly labeled 8-hour default. Holidays and closure days set it to 0.
- **Scoped responsibilities.** The organization owner decides who approves time and who approves vacation. Either the role default applies, where Admin and Büro decide, or a named group of holders replaces it. Naming a holder grants no other manager access. The server checks authority when the action runs. Nobody approves their own request. Every change shows its effect before it is saved.
- **Substitutes.** A holder can name a substitute for an inclusive date window. The substitute gets exactly that holder's scope and loses it when the window ends, even if a browser still shows the old view. Affected people see their responsibilities and substitutions in their settings.
- **Vacation.** Employees request and withdraw their own vacation. Vacation approvers decide requests and can cancel approved vacation with a reason. Entitlement comes from the employment condition. Only days with a positive target consume it. The balance is plain arithmetic, or a label that no entitlement exists. Approved vacation lowers the daily target and blocks clock-in on that day.
- **Sickness.** A sickness report is a fact, not a request. Employees report themselves, and Admin and Büro can record a report for someone. Corrections change the same report and need a reason. There is no diagnosis field, by design. Only the person and Admin or Büro see the sickness type and evidence status. The shared calendar shows a neutral absence. Active sickness sets the target to 0 but does not block clock-in.
- **Teams.** Teams are date-effective planning shortcuts and grant no rights. Picking a team in an assignment adds the members active on that date.
- **Qualifications.** Admin and Büro maintain a catalog of skills and certifications, assign entries with validity and evidence status, and set requirements on jobs. Every assignment checks coverage on the planned date. A gap can be overridden only with a recorded reason. „Intern bestätigt“ is an operational fact, not a legal claim. Employees see their own entries read-only, and expiring certificates appear in `Aufgaben`.
- **Attention.** `Aufgaben` shows the approvals a person can decide now, decision notifications, and the person's own requests. A badge never counts an item the viewer cannot act on.
- **Dispatch acknowledgement.** Employees confirm or challenge the current revision of a dispatched work instruction. An acknowledgement never stands in for attendance or recorded time.
- **Time facts.** Managers inspect time but never record live time on someone's behalf. A correction of one's own time always needs a second time approver. [Time tracking](time-tracking.md) owns the time rules.
- **Time accounts.** Every in-scope personnel record, with or without a login, has an explicitly opened time account. A missing opening balance, schedule, or policy blocks the period close for that person and never counts as zero. Employees see their own account and monthly statements.
- **Access and employment lifecycle.** Admin plans activation, suspends, reactivates, or ends organization access, and runs employment transitions. None of these deletes the record, its history, or the person's login. A record without a lifecycle is labeled as not controlled. The owner and the last effective Admin are protected. The last holder of a responsibility blocks an employment transition until someone else takes it over.
- **Onboarding.** Organization templates have published versions that never change. A plan created from a template holds editable requirements that reference existing documents, qualifications, conditions, schedules, teams, or acknowledgements. Only a requirement marked as blocking access delays activation. Missing configuration never shows as complete.
- **Protected personnel documents.** Personnel files have three classes: standard, Admin-only, and health evidence. They sit outside the ordinary library. No responsibility, job assignment, or ordinary document permission grants access to them. Admin sees every class, and Büro manages standard files. The person sees only expressly released versions and can upload requested health evidence. An acknowledgement proves that the person saw one exact version. It is not a signature.

### Important Current Limitations

- Capacity conflicts, minimum staffing, shift rotations, and date-specific schedule overrides belong to [calendar and resource planning](./calendar-and-resource-planning.md#current-product-baseline). Employee management shows only absence signals.
- Vacation and sickness are the only absence types. Training, special leave, compensatory time, and hour-based absence are later scope.
- Time-account adjustments, expiry, and payout are manual four-eyes events. WerkFlow applies no automatic cap, expiry, payout, or money calculation. Time-account balances carry forward. Vacation carryover does not exist.
- Attention is in-app only. Reminders, escalation, notification preferences, and external delivery belong to `P1-46`.
- A sole admin's own vacation request has no eligible approver until named vacation approvers exist.
- Employees cannot propose corrections to their own master data or conditions. Their self-service covers vacation, sickness, acknowledgements, released documents, and requested evidence.
- Ownership transfer and emergency owner recovery do not exist.
- A member who asks to join a further organization of the same owner sees it after the next reload or tab return, not live. A join request records who decided and when, but no reason.
- A member can be removed only before any time was recorded, so membership and time history survive. The office ends employment and access through the personnel record instead. A removal marks the personnel record as exited today in the same step, so a refused removal changes nothing. A member whose entry date lies in the future is removed only after that date is corrected. Complete offboarding with retained historical identity belongs to `P1-33`.
- No compensation, payroll profile, payslip, payroll-provider integration, electronic signature, legal retention, or complete organization export exists. The only payroll output is a generic payroll-ready export with employee and code mapping.

## Phase 1 — Complete Operational Core

Phase 1 is the complete people-operations foundation, not a thin employee directory. The areas below are product intent. The baseline above says which parts exist.

### Organization Membership And Employment Identity

- Keep login identity, organization membership, and employment relationship as distinct concepts that users can still understand.
- Support invited, active, temporarily inactive, future-start, notice-period, exited, and archived states without erasing history.
- Keep a stable employee number when name, email, account, role, or conditions change.
- Capture the master data the business needs, including preferred form of address, address, department or team, and responsible office contact.
- Make field ownership visible. An employee knows which data they maintain and which needs office review.
- Make the difference between a personnel record and an active login obvious.
- Never let employment data, permissions, schedules, balances, or documents leak between organizations when one user belongs to several.
- Provide import, duplicate review, and completeness status, so onboarding an existing workforce needs no blind retyping.

### Roles, Permissions, And Responsibilities

- Name permissions by business capability: people data, sensitive personnel data, access, job planning, time review, leave approval, documents, inventory, finance handoff, and settings.
- Show the effect of a permission change before it applies, including lost access and responsibility gaps.
- Separate operational responsibility from personnel access. A project lead may allocate work without seeing compensation, health, or contract data.
- Show every denied or hidden action clearly. A control that looks available never fails after submit.
- Give ownership transfer, the last-admin case, and emergency recovery dedicated flows, not ordinary role editing.

### Personnel Master Data And Employment Conditions

- Keep conditions date-effective, so a change never rewrites past time, leave, costing, or payroll periods.
- Cover working days, probation and notice, contract start and end, cost center or team, and the payroll classifications the business selects.
- Support part-time staff, apprentices, temporary staff, marginal employment, and changing hours, without an eight-hour weekday assumption.
- Keep hourly cost separate from compensation, and protect both more strictly than ordinary employee data.
- Show the current condition first, with previous and scheduled conditions available to authorized users.
- Warn about missing conditions before schedules, balances, time accounts, costing, or payroll exports depend on them.
- Draw no legal conclusions. WerkFlow records the organization's chosen conditions and highlights inconsistencies. The employer and its advisers stay responsible for correctness.

### Work Schedules, Availability, And Capacity

- Support flexible schedules, shift patterns, fixed days off, and seasonal arrangements.
- Allow date-specific overrides without destroying the underlying pattern.
- Combine target time, approved absence, holidays, training, assignments, and other unavailability into one availability result.
- Show capacity per employee, team, day, and week, with each conflict explained, never just colored.
- Distinguish "not working by schedule", "approved absent", "requested", "already assigned", and "not configured".
- Give office users a planning view and employees a simple personal schedule in the same app.

### Skills, Certifications, And Operational Eligibility

- Cover SHK-relevant capabilities such as trade specializations, languages, driving permissions, safety qualifications, and manufacturer training.
- Record issuing body, renewal date, and operational restrictions where needed.
- Show expiring, expired, missing, and verified states to the right people.
- Link evidence to the protected personnel documents, not to notes or filenames.
- Let planning filter and warn by required qualification, without claiming that software proves legal eligibility.
- Treat planned training and renewals as events that affect availability.
- Keep the vocabulary curated. Free tags may add to it but never replace it.

### Contracts And Personnel Documents

- Give each employee a protected area for contracts, amendments, certificates, policies, acknowledgements, and payroll forms.
- Support required documents per employment type or role, with missing, pending, valid, expiring, and superseded states.
- Record who uploaded or changed a document and when it became effective.
- Support acknowledgement or signature status where the business needs proof of receipt.
- Let planning see a fact such as "qualification valid until ..." without the full certificate.
- Decide retention and deletion per document category, never through one blanket "delete employee" action.

### Onboarding

- Provide a role-appropriate plan from accepted offer or future start to the first productive day.
- Cover data completion, invitation, access, conditions, schedule, documents, acknowledgements, qualifications, training, team, equipment, vehicle and tool handover, and first job readiness.
- Show owner, due date, status, blocker, and evidence for each requirement.
- Offer templates for common profiles such as `Handwerker/in`, apprentice, office staff, or project lead. The generated checklist stays editable.
- Start account access at the intended moment. A future starter never sees operational data early.
- Give the new employee one short guided list of their own actions, not the office checklist.
- Show incomplete onboarding in planning when it affects readiness or safety.

### Offboarding And Employment Changes

- Treat offboarding as a controlled transition, never as deletion.
- Support planned end dates, immediate suspension, notice changes, and reactivation.
- Before exit, list open responsibilities: jobs, pending time or leave requests, owned approvals, documents, tools, vehicles, inventory, and unfinished onboarding or training.
- Reassign work and approvals explicitly. Ownership is never dropped silently.
- End access at the intended time. Keep the historical name on jobs, time, stock movements, documents, and audit events.
- Track the return of tools, keys, vehicles, devices, clothing, and other issued assets.
- Finalize time, leave, and payroll handoffs for the last period, including later corrections.
- An exited employee leaves active planning but never becomes "unknown" in history.

### Leave, Vacation, And Sick Workflows

- Support organization-defined absence types such as child illness, training, special leave, unpaid leave, and compensatory time.
- Explain entitlement and balance from conditions, carryover, approved use, manual adjustments, and the organization's expiry rules.
- Let approvers also reject with a reason, ask for clarification, and delegate.
- Detect conflicts with assignments, minimum staffing, overlapping requests, and qualification coverage without blocking every exception.
- Support partial days and hour-based absence where the organization uses them.
- Make evidence requirements configurable and explicit, without presenting them as legal advice.
- Reflect approved absence the same way in availability, planning, targets, time accounts, and payroll handoff.
- Keep cancellation, correction, and retroactive-change history. Every balance change stays explainable.

### Assignments And Operational Context

- Show each employee's current and upcoming jobs, projects, team, planned effort, assignment role, and conflicts.
- Let planners assign people or teams by availability and required capabilities.
- Limit the field view to assigned work, related customer and site context, permitted documents, time capture, and inventory actions.
- Show affected employees and planners what changed in a reassignment, and when.
- Keep historical participation after the person leaves or the assignment changes.
- Keep planned assignment, acknowledgement, attendance, and recorded time distinct. None stands in for another.

### Employee Self-Service

- Give employees one personal area for profile, schedule, assignments, time, leave, documents that need action, certifications, and issued assets.
- Show which personal fields they can change directly, which become a review request, and which need office contact.
- Explain their condition summary, target schedule, leave balance, time account, and request status in plain German.
- Offer downloads of the documents and exports the employee is entitled to.
- Keep office-only and sensitive concepts out of the field flow through progressive disclosure, not separate specialist apps.
- Let apprentices and users with little technical confidence finish common actions with few, explicit choices.

### Privacy, Auditability, And Record Quality

- Apply least privilege separately to profile data, personnel documents, compensation and costing, health evidence, and access administration.
- Show authorized users who changed employment, schedule, entitlement, role, document, or status data, with before and after values and the effective date.
- Tell the employee about changes that affect their schedule, balance, access, or employment data.
- Support correction, export, retention, and deletion without breaking relevant history.
- Collect little data, and never show private contact data in job, calendar, inventory, or CRM views.
- Make data-quality problems actionable: duplicate people, missing schedules, invalid date ranges, unverified certificates, missing payroll identifiers, and inconsistent balances.

### Payroll And Accounting Handoffs

- Keep the identifiers and classifications that payroll needs for approved time, absence, supplements, and costing.
- Map WerkFlow concepts to the organization's wage types, cost centers, and export formats without making one payroll provider the product model.
- Provide a preflight of missing data, unapproved time, unresolved absence, invalid balances, and changes after period close.
- Support a period-ready status, a controlled close, export history, and traceable re-export after correction.
- Keep job cost, payroll value, and billable value distinct.
- WerkFlow exports structured data with stable employee references. It does not calculate payroll.

## Connected Workflow Contracts

These are product contracts, not a database design.

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

- Owns organization access, employment-policy settings, delegation of sensitive data, and final accountability.
- Needs exception-first oversight, not a screen of every personnel field.
- Cannot remove the last safe owner or admin path.

### Büro / Office / People Operations

- Needs fast onboarding, planning, document follow-up, leave coordination, time readiness, and payroll preflight.
- May get broad operational responsibility without compensation or health-document access.
- Works from queues, missing requirements, and upcoming changes, not by searching individual profiles.

### Project Lead

- Needs availability, assignments, skills, and business contact data.
- Gets no contracts, compensation, sick evidence, private contact data, or access administration just for leading work.
- May be a scoped responsibility instead of a new global role.

### Handwerker/in And Apprentice

- Uses one app for assigned jobs, schedule, time, leave, documents that need action, and inventory.
- Sees personal balances and status in plain language, with no hidden approval or sync state.
- Gets guided choices, strong defaults, and explicit confirmation for consequential changes.

### Shared UX Rules

- Show the current status and next action first. History and detail come on demand.
- Use natural German employment language, not HR or technical jargon.
- Make every balance, warning, permission, readiness, and pending, blocked, or scheduled state explainable.
- Never show missing configuration as zero, available, compliant, or complete.
- Keep web and future mobile behavior consistent.

## Phase 2 — Intelligence And Automation

Phase 2 reduces coordination work once Phase 1 data and audit history are trustworthy:

- Suggest suitable employees for a job from availability, qualifications, team continuity, location, and workload. The planner decides.
- Predict capacity gaps and qualification bottlenecks before schedules are published.
- Draft onboarding and offboarding plans from role and employment context, with every requirement shown for review.
- Extract master data, validity dates, and document type from personnel documents, with source references and human confirmation.
- Warn about expiring certificates, missing acknowledgements, unreturned assets, and payroll-readiness gaps.
- Summarize staffing, leave, and personnel-document exceptions without exposing sensitive details to unauthorized roles.
- Suggest leave coverage and schedule changes instead of reassigning jobs silently.
- Answer permission-aware questions such as "Which refrigeration-qualified employees are available next Tuesday?" from traceable data.
- Prepare employee or payroll changes as reviewable drafts. Never change access, conditions, compensation, leave decisions, or document retention on its own.

Every intelligent action shows its source, proposed result, uncertainty where relevant, approval point, audit record, organization boundary, and recovery path.

## Boundaries And Decision Gates

- WerkFlow is an operational people-management system first. It is not a payroll engine, recruiting suite, performance-management platform, or source of employment-law advice.
- The line between a practical personnel record and a full HR system needs validation with SHK businesses before generic enterprise HR features arrive.
- Phase 1 has fixed roles plus scoped responsibilities. A custom-role or field-permission builder is a separate future decision gate.
- Personnel-document categories, retention periods, deletion rights, and employee access need legal and privacy review. There is no single universal policy.
- Health and sickness data stays minimal. Planning needs only availability, and only a small authorized group sees evidence or sensitive notes. Diagnosis capture, broad manager visibility, and medical-document sharing are outside the default product.
- Compensation storage, payroll calculation, and specific payroll-provider integrations are separate decision gates.
- Location tracking, biometric attendance, employee scoring, productivity surveillance, and automated disciplinary conclusions are not Phase 1 defaults. They need product, privacy, and worker-representation review.
- Team leads, dispatchers, external workers, subcontractors, and people without accounts need a deliberate identity and permission model before they are treated like employees.
- Deactivation and archive must replace destructive member removal before offboarding counts as complete.
- Employee data portability and customer exit behavior need a decision before assisted migration is promised.

## Open Product Decisions

- Which personnel fields beyond the current set do the first SHK customers need, and which stay optional?
- Which further operational responsibility beyond time and vacation approval proves necessary in real use without becoming a generic permission switch, for example a scoped project-lead responsibility?
- Which personnel documents need special retention rules in `P1-45`?
- How should employees propose corrections to their private master data and employment conditions?
- Which vacation carryover and expiry policies must become configurable, and do customers need manual balance adjustments beyond dated condition changes?
- Are shift rotations, seasonal patterns, or municipal holidays such as the Augsburger Friedensfest needed beyond the planning model? Should an organization ever choose how holidays and closure days count (reduce the target or credit time) instead of the fixed target-0 rule?
- Should a scoped sickness-management responsibility ever narrow who sees sickness type and evidence, and do real organizations need Büro excluded from it?
- How should contractors, temporary workers, apprentices, mini-job workers, and people without a login differ from ordinary employees?
- Which tools, vehicles, devices, and inventory responsibilities belong in onboarding and offboarding?
- Which payroll and accounting products and export formats come first?
- Which employee data stays visible after exit, for how long, and to which roles?
- How should ownership transfer work as a dedicated flow?
