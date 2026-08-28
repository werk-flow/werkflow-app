# Time Tracking

Status: living — last reviewed 2026-08-28

Time tracking (`Zeiterfassung`) covers attendance, working time, travel, breaks, job/project allocation, on-call work, overtime, time accounts, corrections, approvals, absence effects, and payroll/accounting handoffs.

This is a future-facing product specification. It distinguishes the implemented baseline from the complete operational core WerkFlow should provide. It describes product outcomes and workflow contracts, not a database or legal-compliance design.

## Product Goal

WerkFlow should let a field employee record the right kind of time with almost no administrative effort while giving the employee, office, owner, project lead, and payroll process one understandable and auditable result.

The feature should answer:

- Am I currently clocked out, working, travelling, on call, or on break?
- Which Auftrag or Projekt receives this time?
- What counts as attendance, paid time, overtime, payroll time, and customer-billable time?
- Is anything missing, pending, corrected, rejected, or not yet synchronized?
- How was my daily, weekly, monthly, and time-account balance calculated?
- Which records are ready for job costing, invoicing, payroll, or export?

The product must reduce timesheets and repeated office reconciliation without hiding calculation rules or pretending to provide legal advice.

## Current Product Baseline

The implemented baseline (updated through `P1-17`) includes:

- A `/zeiterfassung` route available to all organization roles and a global live clock experience.
- Event-based time records using `clock_in`, `clock_out`, `break_start`, and `break_end`. Work and break sessions are derived from those events.
- Live clocked-out, working, and on-break states; clock-in/out; manual break start/end; and current-day work/break totals.
- An organization-level choice between manually stamped breaks and one automatic break threshold/duration. Admins can change the rule, Büro can view it, and policy history prevents later settings from silently rewriting closed history.
- Job-linked clock-in, job switching during an active session, assigned-job selection for employees, and job/project time views.
- Since `P1-16`, the assigned-worker job pack shows only the viewer's own job time history and exposes the existing start, stop and switch actions in context. It creates no job-local timer and does not build the P1-21 work/travel/break/standby segmentation early.
- Since `P1-17`, an office-handover release can include a bounded customer-safe time summary and its source fingerprint. An active clock is a non-overridable release blocker. Review and release never segment, approve, edit, copy or reclassify time, and the readiness result is not billability or payroll approval.
- Protection against an employee being actively clocked in in more than one organization.
- A current-week view with daily presence, work, break, and overtime display; since `P1-04` the overtime boundary and the weekly `Soll` come from each date's resolved schedule/holiday target instead of a fixed 480 minutes.
- Manual same-day work or break entries with sequence/overlap validation. Employees can add their own entries for approval; admins and Büro can add records within their management scope. Since `P1-05`, a Büro user's own new manual entries are pending rather than silently self-approved; admin-owned additions remain auto-approved as the owner recovery path.
- Approval of pending sessions by effective holders of the scoped `time_approval` responsibility (**Zeitfreigaben**), including paired session display and job context. With no explicit configuration, active Admin and Büro holders preserve the prior matrix (Admin can approve Büro/employee; Büro can approve employee). Selected holders replace that default, and direct holders can be ordinary employees without gaining any other manager capability.
- Manager history filters by date range, employee, and status.
- Correction, deletion, reassignment, pending-state, review, and calendar-visualization infrastructure for time records.
- Calendar visualization and correction flows, plus time visibility in job and project contexts.
- Realtime refreshes for time entries and attention counts. Since `P1-07` the badge pipeline is unified: the Zeiterfassung sidebar badge and the Anträge tab badge count time **and** vacation approvals for the viewer (matching what the tab shows and resolving the P1-06 undercount), and pending time sessions/change requests additionally appear as attention items on `/aufgaben` for exactly the effective holders, deep-linking back into the Anträge tab. Decisions run only through the existing review actions.
- Safeguards that close some stale prior-day open sessions and clock an active user out on sign-out or member removal.
- Since `P1-06`: the dashboard's vacation area is a real balance and entry point (owned by employee management) — entitlement arithmetic or the labeled „Kein Urlaubsanspruch hinterlegt" exception, own requests with status and withdrawal, and the request dialog. Approved vacation reaches daily targets as a discriminated absence input on `resolveDailyTarget` (full day → 0, half day → half base target), so the Tagesziel, ring, weekly `Soll`, member detail, and member list all react through the one target contract; pending requests are provisional and never change targets. Clocking in on an own approved full-day vacation day is denied at the server action („Heute ist Urlaub genehmigt"); the correction path is an authorized cancellation of the vacation. The Anträge tab additionally shows pending vacation requests to effective `leave_approval` holders.
- Since `P1-08`: the dashboard also carries the **Krankmeldung** section (owned by employee management) — self-report and own-report management. Active sickness reaches the same `resolveDailyTarget` absence input as a second discriminated type (`sickness`; open-ended reports clamped to the query window; on a day covered by both, vacation keeps the display attribution), so every target surface reacts through the one contract; the own dashboard says „Krankmeldung – heute keine Sollarbeitszeit." Clocking in on a sick day is deliberately NOT blocked: the action succeeds with a visible notice („Für heute liegt eine Krankmeldung vor …") because a recovered person clocking in early is reality — the end-date correction is the nudge, and the office sees the contradiction on the management surface.

Important current limitations:

- Travel time is shown as a disabled action and is not a distinct implemented time type.
- Resolved with `P1-06` (2026-08-06) and `P1-08` (2026-08-08): the former static „9 von 30" vacation widget is replaced by the real balance workflow, and sickness/privacy-sensitive absence landed as the second absence type. Absence remains owned by employee management; time tracking consumes its effect on targets exclusively through the extended `resolveDailyTarget` contract. Further absence vocabulary, hour-based absence, and paid/unpaid classification remain later scope (`P1-23`).
- Resolved with `P1-04` (2026-08-05): daily and weekly targets no longer assume a fixed eight-hour day. The target for (person, date) is resolved per date from the work-schedule version effective on that date, else derived from the employment condition's weekly hours (labeled), else the legacy 8h shown as a visible „Kein Arbeitszeitmodell hinterlegt" exception; holidays of the organization's selected regional calendar and closure days set the day's target to 0 (`lib/personnel/targets.ts`). The dashboard Tagesziel/ring, the weekly chart's overtime split and `Soll` sum, the member-detail Tagesfortschritt, and the member-list progress bars all consume this contract. Since `P1-06` approved vacation reduces targets through the same contract; sickness follows with `P1-08`.
- There is no complete monthly view, explainable long-term time account, carryover/expiry process, compensatory-time workflow, or period close.
- On-call/standby time, deployments during on-call periods, night/Sunday/holiday supplements, paid/unpaid classifications, and explicit overtime approval are not implemented as complete product concepts.
- Employees can submit new manual records but do not yet have a complete self-service correction/history experience for their existing entries.
- Four eyes is active for every pending time approval: a holder can never approve their own entry. Büro users' own new manual additions become pending and need another holder with sufficient scope. Existing Büro edit/delete behavior still does not create a change request, and the complete correction/request workflow remains `P1-22`.
- Date-effective substitutes inherit only their base holder's approval scope for an inclusive Berlin-date window. Every approval action resolves current responsibility server-side; an ended or expired substitute is denied even if a stale browser still shows the old approval card.
- There is no native mobile app or offline time queue. Web behavior must not be described as offline-capable.
- There is no payroll-ready period workflow, standard payroll/accounting export, or native finance handoff.
- There is no complete German working-time compliance configuration. Current break settings alone must not be presented as proof of compliance.

Current application code and live database state remain authoritative if this baseline drifts.

## Phase 1 — Complete Operational Core

Phase 1 is not an MVP stopwatch. It is the complete, dependable operational time system expected before intelligence and automation become the focus.

### Clear Time Concepts

- Distinguish attendance/presence, productive work, travel, break, standby/on-call, active deployment during on-call, absence, and manual adjustments.
- Keep gross presence, paid/credited time, payroll-relevant time, job-cost time, and customer-billable time separate. One number must not silently stand in for all of them.
- Give every segment a visible source, classification, date, employee, organization, and current status.
- Make the transition rules understandable: users should know which actions are available from the current state and why another action is unavailable.
- Support multiple work and travel segments in a day, job switches, split days, interrupted work, overnight work, and entries that cross a payroll or calendar boundary.
- Preserve original capture time separately from later correction, approval, rounding, or export results.
- Use practical German labels. The employee should not need to understand event models, wage types, or internal status codes.

### Everyday Capture

- Provide one consistent web and future mobile clock surface for working, travelling, breaking, switching jobs, and clocking out.
- Show the current state, active Auftrag, elapsed time, last successful synchronization, and pending local actions at all times.
- Let an employee start from an assigned job, from the clock surface, or from today's schedule without creating different kinds of records accidentally.
- Keep job selection optional or required according to an explicit organization rule; never lose time merely because job context is missing.
- Make switching between travel, work, break, and jobs a short explicit action that closes the previous segment and shows the new state.
- Support correcting a missed clock-in/out or wrong classification through a guided request rather than forcing employees to invent compensating entries.
- Detect impossible or suspicious sequences, overlaps, duplicate taps, clocking in elsewhere, and abandoned sessions while preserving a recoverable path.
- Make automatic recovery visible. A system-created close or correction must never look like an employee's original action.
- Allow authorized office users to create or correct records for another employee without impersonating that employee.
- Support an optional shared terminal/kiosk as a later Phase 1 channel only if its identity, security, and fallback behavior are deliberately approved; personal web/mobile capture remains the default.

### Travel, Work, Break, And On-Call

- Record travel separately from work so the organization can apply its selected payroll, costing, and billing treatment.
- Support travel linked to a job/customer as well as non-job travel such as warehouse, training, or company errands.
- Distinguish a break from unpaid absence, travel, waiting, and a gap caused by missing data.
- Support manually stamped breaks and configurable automatic break treatment, with the applied rule visible on each day.
- Preserve actual stamped breaks even if another calculation is used for payroll or compliance review.
- Represent standby/on-call windows separately from active deployments, including which time is scheduled, actually worked, credited, or supplement-relevant.
- Allow the organization to define its treatment of travel, on-call, and other categories without baking a single collective agreement or legal interpretation into WerkFlow.
- Explain totals after classification: “8:30 Anwesenheit – 0:30 Pause = 8:00 Arbeitszeit,” plus any separately credited travel or supplements.

### Job And Project Allocation

- Allocate work and travel segments to an Auftrag, Projekt, customer, internal activity, or explicit “not yet allocated” queue.
- Let field employees choose only relevant assigned/open work by default, while authorized office users can search the organization scope.
- Support switching allocation during a running day without ending attendance.
- Allow an approved time block to be split or reassigned with before/after history and a reason.
- Show planned versus actual labor by job/project, employee, trade activity, and period.
- Support non-billable but operationally necessary categories such as warehouse work, training, meetings, cleaning, administration, or rework.
- Keep billability explicit and reviewable. Job allocation alone must not automatically make time customer-billable.
- Preserve time links when a job is completed, archived, renumbered, moved into a project, or reassigned.
- Identify unallocated or unexpectedly allocated time before job costing, invoice preparation, or payroll close.

### Schedules, Target Time, And Holidays

- Derive target time from the employee's date-effective employment conditions, work schedule, approved absence, and applicable organization holiday calendar.
- Support full-time, part-time, flexible days, shift patterns, apprentices, changed weekly hours, and date-specific schedule exceptions.
- Show daily, weekly, monthly, and payroll-period target versus credited actual time.
- Handle public holidays and organization closure days explicitly, including regional calendars selected by the business.
- Keep schedule changes effective-dated so they do not silently alter historical balances.
- Treat missing schedule configuration as an exception, not as zero target hours or an assumed eight-hour day.
- Explain whether an absence or holiday reduces target time, credits time, or is informational according to the selected organization policy.

### Time Accounts, Overtime, And Supplements

- Provide an understandable time account with opening balance, target, credited actual time, approved adjustments, carryover, expiry or payout events, and current balance.
- Show the employee the same balance foundation the office uses; role differences may limit sensitive rates, not the existence of time.
- Distinguish time worked beyond target from ordered/approved overtime and from payroll treatment.
- Support organization-defined handling of overtime: approval, time off in lieu, carryover, payout handoff, cap, or expiry.
- Record manual balance adjustments with a reason, actor, effective date, and audit history.
- Support relevant night, Sunday, holiday, travel, on-call, and other supplement classifications without assuming one legally correct percentage.
- Keep the raw record, credited-time calculation, supplement classification, and final payroll export result traceable to one another.
- Show forecast and confirmed balances separately when records, leave, or corrections are still pending.
- Prevent a retroactive policy change from rewriting closed balances without an explicit recalculation and review process.

### German Compliance Configuration

WerkFlow should help an organization apply and monitor its chosen rules, but it must not claim that configuration equals legal compliance.

- Let authorized users configure working-day/week limits, break expectations, rest-period expectations, Sunday/holiday treatment, rounding, overtime approval, and warnings relevant to their business.
- Support effective dates and history for every policy that changes calculations or warnings.
- Distinguish informational warning, approval-required exception, and hard block; each rule should state which behavior the organization selected.
- Detect likely issues such as insufficient break, excessive day length, insufficient rest, work on a restricted day, missing record, conflicting sessions, or an unresolved overnight shift.
- Explain which captured facts triggered a warning and which organization rule was applied.
- Keep apprentice/youth-protection, collective-agreement, company-agreement, and exceptional-work requirements as configurable or separately reviewed cases rather than universal defaults.
- Allow documented authorized exceptions without erasing the warning or original record.
- Require the business to confirm configuration and recommend professional legal/payroll review where appropriate.
- Avoid language such as “legally compliant” based only on software settings.

### Corrections, Requests, And Approvals

- Give employees a complete personal history and a guided way to request add, edit, delete, split, classification, allocation, and missed-clock corrections.
- Show the proposed result before submission, including changed totals, job allocation, break impact, and time-account impact.
- Require a reason for material corrections and retain original value, proposed value, actor, approver, timestamps, decision, and comment.
- Define which live or recent entries an employee may correct directly, which create a request, and which are locked after period close.
- Apply four-eyes rules consistently when an approver changes their own records or records where they have a conflict of interest.
- Support delegated approvers, substitutes, reminders, escalation, and clear fallback when no approver is available.
- Allow admins/Büro to approve, reject, return for clarification, or correct within explicit authority.
- Keep pending changes visible in calendar, day totals, employee history, manager queues, and export preflight. Never use hidden intermediate states.
- Explain whether totals are provisional or confirmed while a request is pending.
- Support safe batch approval and exception handling, but never allow a bulk action to conceal materially different entries.
- Let an employee withdraw their own pending request and see why a request was rejected.

### Period Review And Close

- Provide daily and payroll-period readiness queues for missing clocks, open sessions, overlaps, unallocated time, unresolved warnings, pending requests, missing schedules, and absence conflicts.
- Let office users review by exception rather than inspect every normal shift manually.
- Show a reproducible summary by employee before close: target, work, travel, break, absence, overtime, supplements, adjustments, and balance movement.
- Require unresolved exceptions to be resolved, explicitly accepted, or carried with a documented reason.
- Close a period deliberately so payroll/export uses a stable version.
- Prevent ordinary edits after close; authorized reopen and correction must create a new traceable version or correction handoff.
- Show who prepared, reviewed, closed, reopened, exported, or re-exported a period.
- Keep employee visibility after close so the result is not a black box.

### Leave And Absence Effects

- Consume approved vacation, illness, training, compensatory time, and other absence from employee management.
- Show absence in the personal day/week/month view without exposing private health details.
- Apply the selected absence treatment to target time and payroll handoff while keeping the absence record distinct from a clocked work segment.
- Prevent contradictory active clock and full-day absence states, but provide an authorized correction path for partial work, call-out, or a late absence change.
- Reflect pending absence requests as provisional in planning without treating them as approved payroll input.
- Keep leave balances owned and explained by employee management while time tracking shows their effect on target and credited time.

### Offline And Mobile Reliability

- Put jobs, time, absence, documents, and inventory in one employee app shell rather than requiring specialist apps.
- Define offline support per action: what data is available, what can be captured, what stays queued, and what cannot proceed.
- Record actions with device-local capture time and synchronization time, and show both where a delay matters.
- Show offline, syncing, synchronized, failed, and conflict states in plain language.
- Prevent repeated taps or reconnects from creating duplicate time segments.
- Resolve conflicts deterministically where safe and ask the user where intent cannot be inferred.
- Preserve queued actions through app restarts and make retry/cancel consequences clear.
- Reconcile server-side job reassignment, schedule changes, period close, or another-device actions without silently discarding local records.
- Support correct local time, organization time zone, daylight-saving changes, overnight shifts, and travel across time zones.
- Make battery/network failure recoverable without encouraging screenshots or paper backup as the normal process.

### Employee Transparency

- Show today's state and totals first, then day/week/month/period history and calculation detail through progressive disclosure.
- Give employees a clear time-account balance and a line-by-line explanation of how it was calculated.
- Label raw, provisional, approved, exported, corrected, rejected, and closed values consistently.
- Show pending requests, responsible approver, submission date, decision, and any required next action.
- Explain automatic breaks, rounding, supplements, target-time changes, and balance adjustments on the affected record.
- Notify employees of material office changes to their time and let them inspect before/after values.
- Provide a personal export or statement for the relevant period.
- Do not hide synchronized data behind a separate office-only app when it determines the employee's balance or payroll handoff.

### Manager And Owner Oversight

- Show who is working, travelling, on break, clocked out, on call, offline with queued actions, or in an unresolved state, within privacy boundaries.
- Prioritize exceptions such as missing clock-out, very long session, insufficient break, unallocated time, pending request, schedule mismatch, or sync failure.
- Provide views by employee, team, job/project, customer, activity, day/week/month, and payroll period.
- Let planners compare planned effort and actual labor without exposing wage details unnecessarily.
- Keep operational live status distinct from performance scoring; presence alone is not a productivity measure.
- Allow authorized corrections and approvals from the context where the issue is found while preserving one audit path.

### Reporting, Export, Payroll, And Accounting Handoff

- Provide reproducible day, week, month, payroll-period, employee, team, job, project, customer, activity, and exception reports.
- Export approved source time, credited/payroll time, absence, overtime, supplements, cost allocation, job allocation, and correction history as clearly separated fields.
- Support structured CSV/Excel-compatible exports and provider-specific handoffs selected by product priority; a PDF statement may supplement but not replace structured data.
- Use stable employee, organization, job, project, and export-period references.
- Provide mapping for wage types, cost centers, activities, and payroll identifiers, with validation before export.
- Record export version, filter scope, mapping version, generator, timestamp, and whether it supersedes a previous export.
- Accept payroll/accounting feedback where useful without letting an external system silently rewrite operational source records.
- Make post-export corrections an explicit correction/re-export workflow.
- Keep customer billing, job costing, payroll, and attendance outputs connected but distinct.

### Privacy, Retention, And Auditability

- Restrict organization-wide live status, history, corrections, exports, and payroll classifications by role and responsibility.
- Let employees see their own records and meaningful changes without seeing colleagues' time.
- Avoid collecting precise location, photos, device telemetry, or behavioral data unless a separately approved use case requires it.
- Preserve a complete human-readable audit trail for captured, system-created, corrected, approved, rejected, reassigned, rounded, closed, and exported records.
- Retain historical employee identity and job links through offboarding.
- Support organization export, retention, and deletion policies without making business history inexplicable.
- Never log sensitive time or location data unnecessarily in developer logs.

## Connected Workflow Contracts

These contracts describe the information each feature area may provide or consume. They are product contracts, not a schema design.

| Connected area | Inputs time tracking consumes | Outputs time tracking provides | Contract rules |
| --- | --- | --- | --- |
| Employee management | Active employment state, effective work schedule, target hours, absence, approver, payroll identity, applicable policy group | Actual/credited totals, time-account movement, overtime, warnings, request status, period readiness | Historical calculations use the conditions effective on the recorded date. Offboarding never erases approved history. |
| Jobs and projects | Assignment, open/archived state, planned duration, customer/project link, permitted activities | Actual work/travel by employee and activity, unallocated time, planned-vs-actual labor, costing/billing eligibility | Assignment is not proof of attendance; job linkage is not automatically billable. Archived work retains time links. |
| Calendar | Planned jobs, shifts, appointments, holidays, training, absence | Actual time blocks, live state where permitted, pending corrections, schedule conflicts | Planned and actual time remain visually and semantically distinct. Sensitive absence detail is minimized. |
| Documents | Permitted evidence/document context and audit capabilities | Period statements, export artifacts, correction/approval references where retained | Time corrections should not require attaching sensitive evidence by default. Document access does not broaden time permissions. |
| Finance and payroll | Wage types, cost centers, export mapping, closed-period feedback, billing rules | Approved payroll time, supplements, absence, cost allocation, billable labor candidates, export versions | Payroll, costing, billing, and raw attendance values stay distinguishable and traceable. |
| Inventory | Job/material action context and responsible employee | Time context that may help explain material usage | Clock state never automatically changes stock, and a stock movement never silently creates time. |
| CRM and customers | Customer/job/site context, service window, address | Approved customer-facing service duration or report input where explicitly selected | Never expose employee balances, private schedule, absence, or payroll data to CRM/customer surfaces. |

## Role And UX Principles

### Handwerker/in And Apprentice

- Gets one prominent current-state control and only the next valid actions.
- Sees assigned jobs first, with quick travel/work/break/job switching.
- Sees own day/week/month totals, time account, requests, decisions, and synchronization status in understandable German.
- Can recover from a missed action without learning an office process or asking someone to edit data invisibly.

### Büro / Office

- Works from exception, approval, correction, allocation, and period-readiness queues.
- Can manage employees in scope but should not approve their own consequential changes without an explicit rule.
- Sees calculation explanations and audit history before changing a result.

### Admin / Owner

- Controls organization policies, authority, export mapping, close/reopen, and exceptional overrides.
- Gets concise operational and payroll-readiness oversight rather than a surveillance dashboard.
- Must be warned when configuration is missing, contradictory, or not professionally reviewed.

### Project Lead

- Sees planned-versus-actual labor and job allocation for work they manage.
- Does not automatically receive organization-wide employee history, time accounts, absence detail, or payroll classifications.
- May correct allocation or approve job context only if that responsibility is explicitly granted.

### Shared UX Rules

- Use progressive disclosure: current state and next action first; calculation, history, and audit details one level deeper.
- Never hide pending, offline, failed, provisional, automatically created, rounded, or corrected state.
- Make balances and policy effects explainable with arithmetic and source records.
- Keep controls consistent across web and mobile and keep all employee workflows in one app shell.
- Use natural German labels, generous tap targets, visible focus, keyboard support, and accessible status communication.
- Prefer safe defaults and warnings over dense setup, but never silently assume an eight-hour weekday or one legal rule set.

## Phase 2 — Intelligence And Automation

Phase 2 should reduce review work only after Phase 1 classifications, policy history, offline state, and audits are dependable:

- Detect likely missed clocks, duplicates, wrong job allocation, implausible travel, unusual duration, or schedule mismatch and propose a correction.
- Suggest a likely Auftrag or activity from the employee's schedule and operational context, with employee confirmation.
- Forecast overtime, time-account pressure, staffing gaps, and payroll-readiness risk.
- Prepare an exception summary for office review instead of automatically approving or changing time.
- Recommend break or rest reminders from configured rules without claiming legal certainty.
- Draft timesheets from schedule, job activity, or other operational evidence only as unapproved proposals; never infer payroll time silently.
- Explain balance changes and payroll preflight problems in natural German with links to the underlying records.
- Identify recurring correction causes that indicate a confusing workflow or bad configuration.
- Assist with wage-type and export mapping, showing confidence and requiring payroll review.
- Provide permission-aware operational questions such as “Which Aufträge have unallocated labor this week?” with reproducible filters.

Every intelligent action must show its source, proposed change, uncertainty, human approval point, audit record, organization boundary, and undo/recovery behavior.

## Boundaries And Decision Gates

- WerkFlow supports recordkeeping and organization-selected rules; it is not a lawyer, tax adviser, payroll adviser, or guarantee of compliance with the ArbZG, MiLoG, collective agreements, works agreements, or sector-specific requirements.
- Native payroll calculation is outside the operational core unless separately approved. Payroll-ready handoff and auditability are required.
- Attendance, credited payroll time, job cost, and customer-billable time must remain separate even when a business often configures them identically.
- Precise GPS, geofencing, continuous location history, photos, biometrics, facial recognition, and employee scoring are not default time-capture features. Any such proposal requires a separate necessity, privacy, consent/worker-representation, retention, and fallback decision.
- Automatic break deductions, rounding, overtime expiry, and historical recalculation require explicit effective-dated policy and professional review.
- Shared terminals, hardware clocks, NFC, wearables, vehicle telematics, and third-party clock imports are separate capture-channel decisions.
- Overnight shifts, travel across time zones, emergency service, and on-call compensation must be validated with real SHK cases before being considered complete.
- Absence entitlement remains owned by employee management; time tracking consumes its operational effect.
- Offline support cannot be marketed as a binary capability. Each action needs a documented availability, queue, conflict, and recovery contract.
- Approval authority, self-approval, delegation, and closed-period correction require a single consistent model across time, leave, and payroll export.
- Data retention and employee access after exit require policy/legal review; destructive deletion must not be the normal correction or offboarding path.

## Open Product Decisions

Resolved with `P1-05` (2026-08-06): the fixed-role fallback remains Admin plus Büro. Admin can approve Büro and employee time; Büro can approve employee time. A selected direct holder can approve any other member but never themselves, while a substitute inherits the delegator's narrower or broader scope. Büro-owned new manual entries are pending; admin-owned additions remain auto-approved so an organization always has an owner recovery path. Holder removal cannot leave a selected responsibility without a base holder. Ownership transfer, the complete correction request model, batch decisions, and closed-period behavior remain later scope.

- Which time categories and internal activities should ship as defaults for SHK businesses?
- Is job selection required for all field work, required only for selected roles, or handled through an unallocated-time queue?
- Which travel models must be supported first: company start, home-to-site, site-to-site, passengers, or driver distinction?
- How should standby/on-call schedules and active call-outs affect credited time, supplements, and rest warnings?
- Which employee edits are direct, which require approval, and how long is the self-correction window?
- Which German state holiday calendars and exceptional-work configurations are needed first?
- Which warnings should be informational, approval-required, or blocking by default?
- How are overtime approval, time off in lieu, carryover, expiry, payout, and caps configured?
- Which night/Sunday/holiday/travel supplements must be classified in WerkFlow versus only in payroll?
- What does period close lock, and what exact correction/re-export process follows a late change?
- Which payroll/accounting providers and export formats should be prioritized?
- Should a shared terminal/kiosk be part of Phase 1, and what fallback identifies employees safely?
- What offline data must be available for an employee's next assignments, and how are conflicting device actions resolved?
- Is any location evidence necessary for specific customers, and can the same outcome be achieved with less intrusive evidence?
- Which personal time statements and exports should employees receive by default?

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, and links to per-slice acceptance records.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
