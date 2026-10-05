# Time Tracking

Status: living — last reviewed 2026-10-04

Time tracking (`Zeiterfassung`) covers attendance, working time, travel, breaks, job and project allocation, on-call work, overtime, time accounts, corrections, approvals, absence effects, and payroll and accounting handoffs.

This spec separates the implemented baseline from the complete operational core. It describes product outcomes and workflow contracts, not a database or a legal-compliance design.

## Product Goal

A field employee records the right kind of time with almost no administrative effort. The employee, office, owner, project lead, and payroll process get one understandable and auditable result.

The feature answers:

- Am I clocked out, working, travelling, on call, or on break?
- Which Auftrag or Projekt receives this time?
- What counts as attendance, paid time, overtime, payroll time, and customer-billable time?
- Is anything missing, pending, corrected, rejected, or not yet synchronized?
- How was my daily, weekly, monthly, and time-account balance calculated?
- Which records are ready for job costing, invoicing, payroll, or export?

The product removes timesheets and repeated office reconciliation without hiding calculation rules or pretending to give legal advice.

## Current Product Baseline

Every role clocks in and out, records work, travel, break, standby, call-out, and internal-activity segments, and can propose corrections that a second person approves. Admin, Büro, and effective holders of the time-approval responsibility review and approve time, close monthly periods, and produce a payroll-ready export. Employees see their own history, balance, and monthly statements.

- **Clock readiness.** Clock actions stay disabled until the organization's clock state has loaded. A missing or failed response never means the employee is clocked out. A failure offers retry, and a pending transition blocks duplicate actions. The [shared readiness contract](../technical/realtime-and-caching.md#shared-layout-and-clock-readiness) owns the mechanism.
- **The clock button.** A fixed button on every page opens a sheet of next actions, not a form. Each transition is one tap and carries the job along. Rare activities sit one level deeper. While clocked in, two hot keys offer the two most likely next transitions. After a break, resuming the interrupted job is one tap, and the job picker lists today's planned jobs first.
- **What the clock button deliberately lacks.** There is no clock-out hot key: a one-tap clock-out on a fixed button is an easy accidental tap, and an ended session has no undo. There is no global keyboard shortcut for the sheet (owner decision). The elapsed time shows only on the Zeiterfassung page, not as a second counter on the button.
- **Live capture.** Each membership has one attendance session with at most one open activity. Every switch is atomic, safe to repeat, and attributed. Nobody can be clocked in in two organizations at once. Work, travel, and call-out link to an assigned job or stay explicitly unallocated. Travel also records the route and whether the employee drove or rode along. Current-day totals and the split at midnight (Europe/Berlin) are display only ([P1-21](../plans/phase-1/slices/p1-21-time-segments.md)).
- **Recovery.** A session open longer than 24 hours shows a concrete recovery path. Sign-out closes the session and records who closed it. Time recorded before the segment model stays unchanged and is never backfilled.
- **Member removal.** Removing a member who has recorded time is refused, and membership, sessions, and history stay unchanged. The office ends employment through the personnel record instead. `P1-33` replaces this containment with retained historical identity.
- **Break rule.** Admin chooses between manually stamped breaks and one automatic break threshold and duration. Büro sees the rule. Saving a new rule also ends the open break of every member on a break today and resumes the job that break interrupted. The rule and the break ends save together. A closed period or a concurrent rule change refuses the whole save. A rule change never rewrites closed days.
- **Targets.** The dashboard shows presence, work, break, and overtime per day. The daily and weekly target come from each date's schedule, holidays, closures, vacation, and sickness, not from a fixed eight hours. A missing schedule shows a visibly labeled 8-hour fallback. Approved full-day vacation blocks clock-in; a sickness day only warns.
- **Manual entries.** Everyone can add same-day work or break entries, with sequence and overlap checks. Employee entries and a Büro user's own entries wait for approval. An Admin's own additions apply directly, as the owner's recovery path.
- **Approval authority.** Effective holders of the time-approval responsibility decide pending time. Without configuration, Admin decides Büro and employee time and Büro decides employee time. Named holders replace that default, and a substitute inherits the base holder's scope for a date window. Self-approval never exists ([P1-05](../plans/phase-1/slices/p1-05-scoped-responsibilities.md)). Pending entries are grouped per manual submission for one day. A single decision and approve-all both re-check every entry's pending state and the approver's authority. A review or deletion of several entries applies to all of them or to none.
- **Corrections.** A guided `Zeitkorrektur` covers add, edit, delete, split, activity reclassification, job reallocation, employee reassignment, and missed clocks. An employee's own change is always a proposal. An authorized Admin or Büro user may apply a correction for another person directly, but their own correction still needs a second approver ([P1-22](../plans/phase-1/slices/p1-22-time-corrections-and-approvals.md)).
- **Correction lifecycle.** A request can be in review, returned with a question, resubmitted, approved, rejected, withdrawn, or failed to apply. Nothing is erased. Selected approvals apply all or nothing. The approval queue reads only submitted requests. The history pages on the server, newest first, and counts only the requests the viewer may see. Pending proposals are labeled provisional everywhere, confirmed views show only accepted results, and the original capture history stays intact.
- **Attention.** Time and vacation approvals count toward the viewer's Zeiterfassung badge and appear in `Aufgaben` for exactly the effective approvers. Decisions run only through the review actions.
- **Time accounts.** Each organization has one versioned default credited-time policy, plus optional employee-specific policies. Credit rules weight the six activity categories at 0, 50, or 100 percent and never change recorded minutes. Every in-scope person, including people without a login, has an explicitly opened account with opening balance, date, and reason. Employees see their own account and statements under `Zeitkonto` ([P1-23](../plans/phase-1/slices/p1-23-time-accounts-period-close-and-payroll-export.md)).
- **Period close.** A period is one organization-wide calendar month in Europe/Berlin and covers the whole workforce. A missing balance, schedule, policy, or absence classification blocks close for that person instead of counting as zero. A period cannot close while a session that started before its end is still running, and the refusal names the employees. Close writes a version that cannot change. Any write of recorded time whose day or new day lies in a closed period fails until an Admin reopens the period with a reason: a manual entry, an entry review, an edit, a deletion or a correction. The database refuses the write too, so no path around the actions changes a closed month. Recalculation and re-close create a successor version.
- **Payroll export.** Admin and Büro generate one reproducible payroll-ready ZIP per closed period version, from a confirmed employee and code mapping. A re-export explicitly supersedes the earlier one. A failed export ends as failed, and the period can be exported again. An export that stopped part way counts as failed at the next export of its period, once it has not changed for 15 minutes. Effective time approvers resolve findings, approve overtime candidates and account adjustments, and close periods in `Perioden`. A finding decision reaches other open sessions of the period page live.
- **Failed reads.** A failed read on the Zeiterfassung and Perioden pages shows the failure with a retry, never an empty list or a hidden tab.
- **Access suspension.** Suspending a member removes all their access without deleting time records, sessions, statements, or closed periods.
- **Connected views.** Calendar time blocks, job and project time views, and the field work pack show the same accepted time. The work pack uses the global session and has no job-local timer. Moving a plan never creates or rewrites actual time. An office handover may include a customer-safe time summary, an active clock blocks the handover, and handover review never edits or approves time.

### Important Current Limitations

- Change requests from before the guided correction flow keep their old meaning and are not converted.
- Time accounts support manual adjustment, expiry, and payout events with four-eyes approval, and reasoned close or reopen. There are no automatic caps, expiry, payout, forfeiture, or compensatory-time requests.
- Standby, call-out, travel, and the other activities get 0, 50, or 100 percent credit. Night, Sunday, and holiday values are classifications only. Arbitrary percentages, organization-defined categories, premiums, and wage values are out of scope.
- Warnings for breaks, daily duration, rest, and night, Sunday, or holiday work are review aids, not proof of compliance with German law, a tariff, or an employment agreement.
- The payroll handoff is a generic ZIP with explicit employee and code mapping. It is not a provider integration, payroll calculation, accounting export, or PDF payslip.
- A payroll export always covers the whole workforce of one closed period version, and records that scope. Filtering by employee and differential exports are deferred.
- More absence types and hour-based absence are later scope.
- There is no native mobile app or offline time queue. Do not describe web behavior as offline-capable.

## Phase 1 — Complete Operational Core

Phase 1 is not an MVP stopwatch. It is the complete, dependable time system the business needs before intelligence and automation.

### Clear Time Concepts

- Distinguish attendance, productive work, travel, break, standby, active deployment during on-call, absence, and manual adjustments.
- Keep gross presence, credited time, payroll time, job-cost time, and customer-billable time separate. One number never silently stands in for all of them.
- Every segment shows its source, classification, date, employee, organization, and status.
- Support several segments a day, split days, interrupted and overnight work, and entries that cross a payroll or calendar boundary.
- Keep the original capture time separate from later correction, approval, rounding, or export results.

### Everyday Capture

- One clock for web and the future mobile app. Starting from an assigned job, the clock, or today's schedule creates the same kind of record.
- The clock shows which actions the current state allows and why another action is unavailable.
- Job selection stays optional, and missing allocation shows explicitly. A mandatory-allocation policy needs a separate decision and must keep captured time.
- A missed clock or wrong classification is fixed through a guided request, never through invented compensating entries.
- Detect impossible sequences, overlaps, duplicate taps, clocking in elsewhere, and abandoned sessions, and keep a recovery path.
- Automatic recovery is visible. A system-created close or correction never looks like the employee's own action.
- Authorized office users create or correct records for another employee without impersonating them.
- A shared terminal or kiosk is a possible later Phase 1 channel only after its identity, security, and fallback are approved. Personal web and mobile capture stays the default.

### Travel, Work, Break, And On-Call

- Record travel separately from work, so the organization applies its own payroll, costing, and billing treatment. Travel can belong to a job or be non-job travel such as warehouse, training, or errands.
- Distinguish a break from unpaid absence, travel, waiting, and a gap from missing data.
- Show the applied break rule on each day. Keep actual stamped breaks even when payroll or compliance review uses another calculation.
- Keep standby windows separate from active deployments, including which time is scheduled, worked, credited, or relevant for supplements.
- The organization defines its treatment of travel, on-call, and other categories. WerkFlow bakes in no single collective agreement or legal interpretation.
- Explain totals after classification: "8:30 Anwesenheit – 0:30 Pause = 8:00 Arbeitszeit", plus any separately credited travel or supplements.

### Job And Project Allocation

- Allocate work and travel to an Auftrag, Projekt, customer, internal activity, or an explicit "not yet allocated" queue.
- Field employees see their relevant assigned or open work by default. Authorized office users search the whole organization.
- Change allocation during a running day without ending attendance. Split or reassign an approved block with before and after history and a reason.
- Show planned versus actual labor by job, project, employee, trade activity, and period.
- Support non-billable but necessary categories such as warehouse work, training, meetings, cleaning, administration, or rework.
- Billability is explicit and reviewable. Job allocation alone never makes time customer-billable.
- Time links survive when a job is completed, archived, renumbered, moved into a project, or reassigned.
- Flag unallocated or unexpectedly allocated time before job costing, invoicing, or payroll close.

### Schedules, Target Time, And Holidays

- Target time follows the employee's employment conditions, schedule, approved absence, and organization holiday calendar on that date.
- Support full-time, part-time, flexible days, shift patterns, apprentices, changed weekly hours, and date-specific exceptions.
- Show daily, weekly, monthly, and payroll-period target versus credited time.
- Handle public holidays and closure days explicitly, including the regional calendar the business selects.
- Schedule changes are effective-dated and never silently change historical balances.
- A missing schedule is an exception, never zero target hours or an assumed eight-hour day.
- Explain whether an absence or holiday reduces target time, credits time, or is informational under the organization's policy.

### Time Accounts, Overtime, And Supplements

- A time account shows opening balance, target, credited time, approved adjustments, carryover, expiry or payout events, and current balance.
- The employee sees the same balance foundation as the office. Roles may hide sensitive rates, never the existence of time.
- Distinguish time beyond target from ordered or approved overtime and from its payroll treatment.
- Support organization-defined overtime handling: approval, time off in lieu, carryover, payout handoff, cap, or expiry.
- Record manual balance adjustments with reason, actor, effective date, and audit history.
- Support night, Sunday, holiday, travel, on-call, and other supplement classifications without assuming one legally correct percentage.
- Keep the raw record, credited time, supplement classification, and payroll export result traceable to one another.
- Show forecast and confirmed balances separately while records, leave, or corrections are pending.
- A retroactive policy change never rewrites closed balances without explicit recalculation and review.

### German Compliance Configuration

WerkFlow helps an organization apply and monitor its chosen rules. It never claims that configuration equals legal compliance, and it never says "legally compliant" based on settings alone.

- Authorized users configure day and week limits, break and rest expectations, Sunday and holiday treatment, rounding, overtime approval, and warnings. Every such policy has effective dates and history.
- Each rule states whether the organization chose an informational warning, an approval-required exception, or a hard block.
- Detect likely issues: insufficient break or rest, excessive day length, work on a restricted day, a missing record, conflicting sessions, or an unresolved overnight shift. Each warning names the captured facts and the rule behind it.
- Apprentice and youth protection, collective agreements, company agreements, and exceptional work stay configurable or separately reviewed cases, not universal defaults.
- An authorized exception is documented and keeps the warning and the original record.
- The business confirms its configuration, and WerkFlow recommends professional legal or payroll review where appropriate.

### Corrections, Requests, And Approvals

- Before submission, a correction shows its result: changed totals, job allocation, break impact, and time-account impact.
- A material correction needs a reason. Keep the original value, proposed value, actor, approver, timestamps, decision, and comment.
- Four-eyes rules apply whenever an approver changes their own records or records where they have a conflict of interest.
- Support delegated approvers, substitutes, reminders, escalation, and a clear fallback when no approver is available.
- Pending changes show in the calendar, day totals, employee history, approval queues, and export checks. There are no hidden intermediate states.
- Batch approval never hides materially different entries.
- An employee can withdraw their own pending request and sees why a request was rejected.

### Period Review And Close

- Daily and payroll-period queues show missing clocks, open sessions, overlaps, unallocated time, unresolved warnings, pending requests, missing schedules, and absence conflicts. Office users review by exception, not shift by shift.
- Before close, show a reproducible summary per employee: target, work, travel, break, absence, overtime, supplements, adjustments, and balance movement.
- Each unresolved exception is resolved, explicitly accepted, or carried forward with a documented reason.
- Show who prepared, reviewed, closed, reopened, exported, or re-exported a period.
- Employees keep seeing their results after close.

### Leave And Absence Effects

- Consume approved vacation, illness, training, compensatory time, and other absence from employee management.
- Show absence in the personal views without exposing private health details.
- Apply the selected absence treatment to target time and payroll handoff, and keep the absence distinct from a clocked work segment.
- Block a running clock during a full-day absence, but give an authorized correction path for partial work, a call-out, or a late absence change.
- Show pending absence requests as provisional in planning, never as approved payroll input.

### Offline And Mobile Reliability

- Jobs, time, absence, documents, and inventory live in one employee app, not in specialist apps.
- Offline support is defined per action: which data is available, what can be captured, what is queued, and what cannot proceed.
- Show offline, syncing, synchronized, failed, and conflict states, the last successful sync, and pending local actions in plain language.
- Record device capture time and sync time, and show both where a delay matters.
- Repeated taps or reconnects never create duplicate segments. Queued actions survive app restarts, and retry or cancel consequences are clear.
- Resolve conflicts automatically where safe, and ask the user where intent is unclear. Server-side reassignment, schedule changes, period close, or actions from another device never silently drop local records.
- Handle the organization time zone, daylight-saving changes, overnight shifts, and travel across time zones.
- Battery or network failure is recoverable without screenshots or paper as the normal backup.

### Employee Transparency

- Employees get a line-by-line explanation of their time-account balance and a personal statement or export per period.
- Show each pending request with its responsible approver, submission date, decision, and any next step.
- Explain automatic breaks, rounding, supplements, target changes, and balance adjustments on the affected record.
- Notify employees of material office changes to their time and show before and after values.
- Data that determines the employee's balance or payroll handoff is never hidden in an office-only app.

### Manager And Owner Oversight

- Show who is working, travelling, on break, clocked out, on call, offline with queued actions, or in an unresolved state, within privacy limits.
- Put exceptions first: missing clock-out, very long session, insufficient break, unallocated time, pending request, schedule mismatch, or sync failure.
- Provide views by employee, team, job, project, customer, activity, day, week, month, and payroll period.
- Planners compare planned and actual labor without seeing wage details they do not need.
- Live status is not performance scoring. Presence alone is no productivity measure.
- Authorized corrections and approvals happen where the issue is found, with one audit path.

### Reporting, Export, Payroll, And Accounting Handoff

- Provide reproducible reports by day, week, month, payroll period, employee, team, job, project, customer, activity, and exception.
- Export approved source time, credited and payroll time, absence, overtime, supplements, cost allocation, job allocation, and correction history as separate fields.
- Support structured CSV or Excel-compatible exports and provider-specific handoffs in product priority order. A PDF statement may add to structured data, never replace it.
- Use stable employee, organization, job, project, and period references, and map wage types, cost centers, activities, and payroll identifiers with validation before export.
- Record export version, scope, mapping version, generator, timestamp, and which export it supersedes. A correction after export goes through an explicit re-export.
- Accept payroll or accounting feedback where useful. An external system never silently rewrites operational source records.
- Customer billing, job costing, payroll, and attendance outputs stay connected but distinct.

### Privacy, Retention, And Auditability

- Role and responsibility restrict organization-wide live status, history, corrections, exports, and payroll classifications.
- Employees see their own records and meaningful changes, never colleagues' time.
- Collect no precise location, photos, device telemetry, or behavioral data unless a separately approved use case requires it.
- Keep a complete, readable audit trail for captured, system-created, corrected, approved, rejected, reassigned, rounded, closed, and exported records.
- Keep historical employee identity and job links through offboarding.
- Support organization export, retention, and deletion policies without making business history inexplicable.
- Never log sensitive time or location data in developer logs without need.

## Connected Workflow Contracts

These are product contracts between feature areas, not a schema design.

| Connected area | Inputs time tracking consumes | Outputs time tracking provides | Contract rules |
| --- | --- | --- | --- |
| Employee management | Active employment state, effective work schedule, target hours, absence, approver, payroll identity, applicable policy group | Actual/credited totals, time-account movement, overtime, warnings, request status, period readiness | Historical calculations use the conditions effective on the recorded date. Offboarding never erases approved history. |
| Jobs and projects | Assignment, open/archived state, planned duration, customer/project link, permitted activities | Actual work/travel by employee and activity, unallocated time, planned-vs-actual labor, costing/billing eligibility | Assignment is not proof of attendance; job linkage is not automatically billable. Archived work retains time links. |
| Calendar | Planned jobs, shifts, appointments, holidays, training, absence | Actual time blocks, live state where permitted, pending corrections, schedule conflicts | Planned and actual time remain visually and semantically distinct. Sensitive absence detail is minimized. |
| Documents | Permitted evidence/document context and audit capabilities | Period statements, export artifacts, correction/approval references where retained | Time corrections do not require attaching sensitive evidence by default. Document access does not broaden time permissions. |
| Finance and payroll | Wage types, cost centers, export mapping, closed-period feedback, billing rules | Approved payroll time, supplements, absence, cost allocation, billable labor candidates, export versions | Payroll, costing, billing, and raw attendance values stay distinguishable and traceable. |
| Inventory | Job/material action context and responsible employee | Time context that may help explain material usage | Clock state never automatically changes stock, and a stock movement never silently creates time. |
| CRM and customers | Customer/job/site context, service window, address | Approved customer-facing service duration or report input where explicitly selected | Never expose employee balances, private schedule, absence, or payroll data to CRM/customer surfaces. |

## Role And UX Principles

### Handwerker/in And Apprentice

- One prominent current-state control that offers only the next valid actions.
- Assigned jobs first, with quick switching between travel, work, break, and jobs.
- Own totals, time account, requests, decisions, and sync status in plain German.
- Recovery from a missed action without learning an office process or asking someone to edit data invisibly.

### Büro / Office

- Works from exception, approval, correction, allocation, and period-readiness queues.
- Manages employees in scope, but never approves their own consequential changes without an explicit rule.
- Sees calculation explanations and audit history before changing a result.

### Admin / Owner

- Controls organization policies, authority, export mapping, close and reopen, and exceptional overrides.
- Gets concise operational and payroll-readiness oversight, not a surveillance dashboard.
- Gets a warning when configuration is missing, contradictory, or not professionally reviewed.

### Project Lead

- Sees planned versus actual labor and job allocation for the work they manage.
- Does not automatically get organization-wide employee history, time accounts, absence detail, or payroll classifications.
- Corrects allocation or approves job context only with an explicitly granted responsibility.

### Shared UX Rules

- Current state and next action come first; calculation, history, and audit detail sit one level deeper.
- Never hide pending, offline, failed, provisional, automatically created, rounded, or corrected state.
- Balances and policy effects are explained with arithmetic and source records.
- Prefer safe defaults and warnings over dense setup, but never silently assume an eight-hour weekday or one legal rule set.

## Phase 2 — Intelligence And Automation

Phase 2 reduces review work only after Phase 1 classifications, policy history, offline state, and audits are dependable:

- Detect likely missed clocks, duplicates, wrong job allocation, implausible travel, unusual duration, or schedule mismatch, and propose a correction.
- Suggest a likely Auftrag or activity from the employee's schedule, with employee confirmation.
- Forecast overtime, time-account pressure, staffing gaps, and payroll-readiness risk.
- Prepare an exception summary for office review instead of approving or changing time automatically.
- Recommend break or rest reminders from configured rules without claiming legal certainty.
- Draft timesheets from schedule, job activity, or other evidence only as unapproved proposals. Never infer payroll time silently.
- Explain balance changes and payroll check problems in natural German, with links to the records.
- Find recurring correction causes that point to a confusing workflow or bad configuration.
- Help with wage-type and export mapping, showing confidence and requiring payroll review.
- Answer permission-aware questions such as "Which Aufträge have unallocated labor this week?" with reproducible filters.

Every intelligent action shows its source, proposed change, uncertainty, human approval point, audit record, organization boundary, and undo or recovery path.

## Boundaries And Decision Gates

- WerkFlow supports recordkeeping and organization-selected rules. It is not a lawyer, tax adviser, or payroll adviser, and it guarantees no compliance with the ArbZG, MiLoG, collective agreements, works agreements, or sector rules.
- Native payroll calculation is outside the operational core unless separately approved. Payroll-ready handoff and auditability are required.
- Attendance, credited payroll time, job cost, and customer-billable time stay separate, even when a business configures them identically.
- Precise GPS, geofencing, continuous location history, photos, biometrics, facial recognition, and employee scoring are not default capture features. Any such proposal needs a separate decision on necessity, privacy, consent or worker representation, retention, and fallback.
- Automatic break deductions, rounding, overtime expiry, and historical recalculation need an explicit effective-dated policy and professional review.
- Shared terminals, hardware clocks, NFC, wearables, vehicle telematics, and third-party clock imports are separate capture-channel decisions.
- Overnight shifts, travel across time zones, emergency service, and on-call compensation need validation with real SHK cases before they count as complete.
- Employee management owns absence entitlement. Time tracking consumes its operational effect.
- Offline support is never marketed as a yes-or-no capability. Each action needs a documented availability, queue, conflict, and recovery contract.
- Approval authority, self-approval, delegation, and closed-period correction follow one model across time, leave, and payroll export.
- Data retention and employee access after exit need policy and legal review. Destructive deletion is never the normal correction or offboarding path.

## Open Product Decisions

The baseline above holds the accepted capture, approval, correction, account, and export decisions, and the linked slice records keep their reasons. Remaining questions:

- Is a shared terminal or kiosk part of Phase 1, and what fallback identifies employees safely?
- Which offline data must an employee have for the next assignments, and how are conflicting device actions resolved?
- How is a forgotten clock-out closed? Competitors either cut the session at a fixed time or after a set number of hours, or send schedule-based reminders; it is the top complaint in their forums. The 24-hour recovery state is the flag today. Reminders and a configurable cut are open.
- Is location evidence necessary for specific customers, and can less intrusive evidence achieve the same outcome?

The [product capability map](../product/product-capability-map.md) owns cross-feature handoffs, and the [Phase 1 roadmap](../plans/phase-1/roadmap.md) owns slice order and status.
