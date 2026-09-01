# P1-23 — Time accounts, period close and payroll-ready export

Status: closed — accepted `complete` on 2026-09-01

## Bounded outcome

Time accounts, overtime and supplement classifications, operational compliance warnings, exception review, period close, payroll-ready export, correction and re-export become understandable, reproducible and versioned. Employees can inspect the balances that affect them. Authorized office users can review the source facts, resolve blocking exceptions, close a period and reproduce each export version without turning WerkFlow into payroll, tax or legal-compliance software.

## Direct dependencies

- `P1-04` owns date-effective schedules, holiday and closure context, and the target-time resolver.
- `P1-06` owns approved vacation facts and their target-time effect.
- `P1-08` owns sickness facts and privacy boundaries.
- `P1-21` owns attendance sessions, factual activity segments and immutable capture events.
- `P1-22` owns the correction aggregate, approval, accepted application overlay and reserved `period_closed` refusal vocabulary.

## Discovery baseline

- The exact P1-22 acceptance checkpoint is verified on clean local `main` at `3ce91b013eea390266acdeb87ebcf09274de4848`, matching `origin/partner-preview`.
- The roadmap prerequisites are accepted and `P1-23` is the only executable slice.
- Unit, Golden, Wave 2 audit and DEV canary baselines match the accepted P1-22 evidence. No retained test world is open.
- The prompt names an obsolete P1-04 filename. The indexed canonical record is `p1-04-work-schedules-and-holidays.md`; there is no process conflict.
- Code, generated types and live DEV/PROD database state were inspected before implementation.
- The owner confirmed the complete report and authorized implementation, DEV-first/PROD-second rollout, CodeRabbit passes and the closing enforcement-ladder audit on 2026-09-01.

## Scope boundaries

- P1-23 owns reproducible credited-time projections, policy-derived classifications and warnings, period versions, close/reopen control, employee statements and payroll-ready file versions.
- P1-23 does not own payroll calculation, wage values, tax, statutory legal interpretation, payslips, native accounting, external payroll delivery or provider integration.
- `P1-24`, `P1-25`, `P1-33`, `P1-35`, `P1-38`, `P1-43`, `P1-49` and `P1-50` retain their roadmap outcomes. This slice must not absorb them.
- The `GG-07` journey must later prove mixed schedules and absences, work/travel/break/internal/overnight facts, corrections, warnings, close/export, late correction/re-export and employee-visible balances. Downstream P1-24 and P1-33 additions are excluded now.

## Decision gate

Closed on 2026-09-01. The owner confirmed all report items and the complete recommendation set before implementation began.

## Resolved discovery decisions

- A P1-23 period is one organization-wide calendar month in `Europe/Berlin`. P1-23 does not implement configurable cut-off days. Period rows will retain explicit boundaries and avoid assumptions that would prevent a later, separately approved cut-off model.
- Each organization has one versioned default time policy. It may add named policy configurations and assign them to particular employees with date-effective, non-overlapping assignments. P1-23 will not add a generic rules language or unrelated per-person settings framework.
- Every employee time account starts from an explicit opening balance, effective date and reason. An administrator may deliberately confirm zero, but deployment never assumes zero and never reconstructs an account from historical time.
- The live production baseline makes automatic reconstruction unsafe: 577 legacy entries cover eight calendar months and 18 people, while only one of 25 employee records has a work schedule and none has an employment-condition row.
- Policy credit rules use the six existing activity categories. Work, internal activity and call-out time start at 100%; breaks start at 0%; travel varies by route and driver/passenger role; standby varies by on-site/remote context. The allowed values are 0%, 50% and 100%. These are an administrator-confirmed starter proposal rather than an automatically active legal or payroll assumption. Raw recorded minutes remain unchanged.
- P1-23 does not add arbitrary percentages, organization-defined activity categories or a generic rules language. The versioned policy model must preserve room for a later, separately approved extension without changing historical calculations.
- Approved full-day vacation and sickness reduce the effective target and remain separately visible; they are not also credited as actual time. Each policy must classify vacation and sickness separately as paid, unpaid or informational before a period can close.
- Findings use informational, approval-required and close-blocked severities. Live capture remains available. Objective readiness defects block close; unresolved operational exceptions require an authorized acknowledgement with a reason; payroll mapping defects block export rather than close. Policy-configurable break, rest, night, Sunday and holiday findings begin as informational.
- P1-23 classifies night, Sunday and organization-holiday minutes with exact source references, without calculating premiums, money, tariffs or wages. Classification buckets may overlap and therefore remain explicitly non-additive. Night classification stays disabled until its window is configured.
- Policy versions and employee assignments take effect on an explicit Berlin date. The UI defaults to the first day of the next open month but permits a mid-month date. Employee assignment ranges cannot overlap, and no version may rewrite a closed period without the explicit reopen flow.
- A closed employee result uses `previous balance + credited time - target time + approved account events = closing balance`. A positive period difference is an overtime candidate that the effective `time_approval` holder must approve before close. Negative time remains visible and posts unless another configured finding blocks close. Rejection never silently discards recorded time.
- P1-23 carries balances forward without automatic caps, expiry, payout or forfeiture. An administrator confirms the initial opening balance directly. Admin and Büro users may propose later manual adjustment, expiry or payout events; a different effective `time_approval` holder must approve them. These events store minutes and references, not wages or money, and rejected or superseded requests remain visible.
- One organization period includes every personnel record whose entry and exit dates overlap its boundaries, including personnel without an app login. Missing opening balances, authoritative schedules, effective policies or required absence classifications remain per-person close blockers; managers cannot cherry-pick a close population.
- Administrators create and activate policies, confirm opening balances and reopen periods. Effective `time_approval` holders resolve approval-required findings, approve overtime and account events, and close ready periods. Admin and Büro users prepare periods and generate or download payroll exports. Employees see only their own account, relevant findings and closed statements. Existing delegation and self-approval denial remain authoritative.
- Only an ended calendar month may close. Close creates an immutable version rather than toggling a mutable flag. Ordinary affected edits are refused. A late P1-22 correction may be submitted and approved, but application retains the `period_closed` refusal until an administrator reopens with a reason. The prior close and export remain retained; correction, recalculation and re-close create a successor version, and re-export explicitly supersedes the earlier export. Idempotency keys, expected-version checks and transaction-level organization/period locking protect concurrent mutations.
- The first payroll artifact is one deterministic ZIP package. It contains separate semicolon-delimited UTF-8-with-BOM CSV files for payroll values, job/project allocations, correction history and control totals, plus a UTF-8 machine-readable manifest. CSV files use CRLF line endings, integer minutes, English machine column names and stable row identities. A professionally formatted PDF export remains a possible later format, not P1-23 scope.
- Each organization may activate one versioned payroll mapping profile. It explicitly maps employee references and output codes for activity, absence, overtime, supplements and account events. An administrator confirms each version; copying an existing employee number is only a convenience and never silent. Missing or ambiguous mappings block export but not close, and every artifact retains the mapping version it used.
- Issued payroll ZIP packages are immutable artifacts in the existing private R2/document system. Employee statements are rendered on demand from the immutable close snapshot as a responsive German view with print styling; P1-23 does not add stored PDFs or absorb P1-24 protected personnel documents.
- The feature stays inside the existing time-tracking area: `Zeitkonto` for everyone, `Perioden` for managers and effective time approvers, period detail below `/zeiterfassung/perioden/[periodId]`, own statements from `Zeitkonto`, and admin-only policy/mapping configuration in `/einstellungen/zeiterfassung`. Approval-required work extends `/aufgaben` instead of adding an inbox.
- Every P1-23 export covers the complete organization population frozen by one closed period version. Employee filtering and differential exports are deferred. The artifact records that full filter scope and cannot omit selected employees.
- Calculations retain exact source seconds. They aggregate by employee, Berlin day and activity/context bucket, then round once to the nearest whole minute with 30 seconds rounding up. Results store both source seconds and the rounding delta; period totals sum the daily credited buckets. Supplement buckets round separately and remain explicitly non-additive because classifications may overlap.

## Reserved acceptance dates

P1-23 owns Berlin run-day offsets `+120 … +124`. The next unassigned Wave 2 block is `+125 … +129`.

## Acceptance record

P1-23 is accepted complete. WerkFlow now has date-effective organization defaults and employee exceptions, explicit account openings, reproducible daily and period calculations, typed findings, immutable close/reopen history, employee statements and deterministic complete-workforce payroll ZIP versions. The implementation keeps calendar-month boundaries explicit so a later configurable payroll cut-off can be introduced without rewriting historical periods.

Fourteen forward migrations reached DEV first and PROD second. Both ledgers match the committed versions `20260901120000` through `20260901133000`. Production retained 577 legacy time entries, two approved legacy correction requests, 25 personnel records and 23 memberships; all 25 P1-23 business tables remained empty after rollout. Production advisors reported no P1-23 security or performance finding. The two security warnings for `set_job_assignment_organization` predate this slice.

Acceptance evidence:

- Unit tests: 485/485; P1-23 SQL assertions and full 204-migration local replay passed.
- Final focused Golden: 4/4 (`2026-09-01T195029203Z-7a1582`); final exhaustive Wave 2 audit: 2/2 (`2026-09-01T194925268Z-92828a`).
- Affected Golden dependencies: 35/35 (`2026-09-01T171606971Z-121743`).
- Complete local Golden / `GG-07`: 138/138 (`2026-09-01T205829500Z-0f71b8`), world `mtj5g9t8`, build `s0l507PnJpmXDo7860RfM`, source fingerprint `d0838ba7…dbfe`.
- Rebuilt DEV cloud canary: 9/9 (`2026-09-01T212743115Z-4e81a5`), world `mtj6hv5k`, build `3a65dFpw1idESbaU2-0Ir`, on the same source fingerprint.
- Eight CodeRabbit passes were dispositioned; the final complete staged pass reviewed all 61 changed files and reported zero findings. Accepted findings tightened dated policy resolution and assignment ranges, Büro adjustment access, export determinism and mapping completeness, wrapper-only RPC access, period chronology, closed-state integrity, source validation, accessibility and strict action parsing. Rejected findings were recorded where the proposed change contradicted the accepted fixed vocabulary, required unavailable temporal columns, duplicated an existing guard or expanded scope.

The campaign audit promoted only repeatable lessons: closed-period and wrapper-only RPC invariants plus null-safe child-process diagnostics to Tier 1 code/schema enforcement; mid-month policy, deterministic export, grant/RLS, source-fingerprint, complete-workforce behavior and spawn-failure regression coverage to Tier 2 tests/build gates; and serialized local reset/SQL/unit infrastructure to Tier 3 because repository code cannot prevent another agent or host process from competing for WSL/Supabase resources. The two certification failures were harness assumptions about inherited findings and effective responsibility state; both now derive their expectations from persisted state and are recorded in the incident log. No additional guideline was invented for one-off noise.
