# P1-23 — Time accounts, period close and payroll-ready export

Status: closed (2026-09-01) — accepted P1-23 acceptance record; canonical home for the slice's evidence

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

P1-23's Berlin run-day offsets are recorded in the [fixture-date ownership registry](../../wave-2-audit.md#fixture-date-ownership); the code registry is `tests/golden/support/date-ownership.ts`.

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

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)

## Implementation plan (merged 2026-09-03 from the former separate plan file)

### Boundary

P1-23 adds a versioned operational time-account and payroll-export boundary. It consumes effective P1-21 attendance plus accepted P1-22 corrections, P1-04 targets and holidays, P1-06 vacation, P1-08 sickness and P1-05 `time_approval` authority. It does not create a second attendance ledger, generic rules or approval engine, wage calculation, payroll tax, legal-compliance certification, DATEV/provider integration, commercial close, personnel-document workflow or automatic historical backfill.

### Delivery order

1. Add pure typed calculation, policy-resolution, finding, balance and deterministic export builders with focused unit tests.
2. Add one additive schema migration for policies, accounts, calculations, close versions, mappings and export roots; add one forward compatibility migration that makes P1-22 correction application refuse closed dates through its existing `period_closed` result.
3. Add SQL assertions for organization integrity, effective dating, immutable history, four-eyes authorization, idempotency, concurrency, RLS, grants, Realtime and organization teardown.
4. Build server queries/actions and transaction RPCs around the existing official time reader and responsibility resolver.
5. Add the `/zeiterfassung` account/period surfaces, period detail, on-demand statement, settings sections and `/aufgaben` finding projection using existing live-view, pending-action and design primitives.
6. Generate deterministic payroll ZIP bytes through a route handler, persist the exact ZIP through the existing private R2/document model and finalize the export row only after its hash and document metadata agree.
7. Add staged Golden `@P1-23`/`@GG-07`, exhaustive Wave 2 audit and the confirmed affected-regression selections.
8. Validate locally, roll identical migrations to DEV then PROD, converge CodeRabbit, freeze, certify and close documentation.

### Schema as built

The migration adds only empty structures. No organization, employee, account, period, result, finding, mapping, export or document row is created on deployment.

#### Policy configuration

- `time_account_policies`: organization-scoped policy identity, name, one partial-unique organization default and optional retirement metadata.
- `time_account_policy_versions`: immutable numbered versions with explicit Berlin `effective_from`, confirmation attribution, vacation/sickness treatment and fixed calculation-schema version.
- `time_account_policy_credit_rules`: one checked 0/50/100 credit rule for each required activity/context combination, using the existing P1-21 activity, travel and standby enums.
- `time_account_policy_supplement_rules`: fixed night/Sunday/organization-holiday classification kinds and eligible P1-21 activity categories. Night requires an explicit local start/end window.
- `time_account_policy_warning_rules`: fixed break, daily-duration, rest, night, Sunday and holiday warning kinds with enabled state, severity and kind-shaped threshold/window columns. This is a bounded vocabulary, not a rules DSL.
- `time_account_policy_assignments`: date-effective employee-to-policy ranges with an exclusion constraint preventing overlap.

Only confirmed versions resolve. The organization default covers unassigned employees. Current edits never mutate an earlier version.

#### Account ledger

- `time_accounts`: one explicitly opened organization/employee account with optimistic version and opening attribution; no row exists before an administrator confirms an opening balance.
- `time_account_events`: append-only minute ledger for opening balance, manual adjustment, expiry, payout and period-close movements. Every non-opening event references its approved request or immutable close version.
- `time_account_adjustment_requests`: organization-scoped pending/approved/rejected/superseded root with operation identity, expected version, signed minutes, effective date, reason and proposer/decision attribution.
- `time_account_adjustment_events`: append-only request history and responsibility snapshots.

Only approved events affect the balance. Payout records minutes and a reference, never money. No automatic expiry, cap, payout or forfeiture exists.

#### Period calculation and close

- `time_periods`: one mutable organization-scoped root per explicit start/end boundary, optimistic version, current state and current calculation/close pointers. A constraint fixes P1-23 boundaries to one complete Berlin calendar month while retaining explicit dates for a future cut-off model.
- `time_period_calculations`: immutable numbered calculation attempts with calculation-schema version, source fingerprint, generation attribution and period-wide control totals.
- `time_period_employee_results`: immutable per-calculation employee summaries for target, raw, corrected, credited, absence, overtime candidate, account events, opening/previous/closing balances and the resolved policy version.
- `time_period_daily_results`: immutable per-employee Berlin-day facts and calculated buckets.
- `time_period_result_sources`: immutable typed references and fingerprints connecting daily results to legacy entries, canonical sessions/segments, correction applications, targets, schedules, conditions, absences, holidays and account events.
- `time_period_findings`: immutable calculation findings with fixed kind, severity, employee/date attribution, explanation payload and source fingerprint.
- `time_period_finding_decisions`: append-only acknowledgement/approval/rejection history with reason and effective `time_approval` responsibility snapshot; self-approval is denied.
- `time_period_close_versions`: immutable numbered closes referencing one exact calculation, prior close where applicable, close attribution, balance control totals and supersession state.
- `time_period_events`: append-only prepare, recalculate, close, reopen and supersede history with operation identity and actor/reason.

The server first reads a database-computed source fingerprint, obtains the official effective source projection, calculates typed results, then persists only if the fingerprint is unchanged. Close recomputes the fingerprint and checks the expected period/calculation versions inside the same advisory-locked transaction. It posts exactly one period-close account event per included employee. Reopen preserves the prior close and events; re-close creates successor rows and compensating/successor ledger movements rather than updating history.

#### Mapping and export

- `payroll_mapping_profiles`: one organization-scoped mutable root with optimistic version and current confirmed-version pointer.
- `payroll_mapping_versions`: immutable numbered confirmed versions with generator compatibility version and admin attribution.
- `payroll_employee_mappings`: immutable per-version employee-to-external-reference rows.
- `payroll_code_mappings`: immutable per-version mappings for the fixed activity, absence, overtime, supplement and account-event value kinds.
- `payroll_exports`: organization-scoped export root with operation identity, exact close/mapping/generator versions, full-organization scope, state, deterministic content fingerprint, ZIP hash/size, document reference, prior-export reference and supersession metadata.
- `payroll_export_events`: append-only requested, generated, failed, ready and superseded history.

The deterministic ZIP contains `lohnwerte.csv`, `zuordnungen.csv`, `korrekturen.csv`, `kontrollsummen.csv` and `manifest.json`. CSV files use semicolons, UTF-8 BOM, CRLF, English machine headers and integer minutes. Rows carry deterministic IDs. Exact source seconds are aggregated by employee, Berlin day and activity/context bucket, then rounded once to the nearest whole minute with 30 seconds rounding up; the result retains the exact seconds and rounding delta. Supplement buckets round separately and remain non-additive. ZIP entry names, order, timestamps and compression options are fixed so a retry over the same close, mapping and generator identity yields the same bytes and hash.

#### Database boundaries

- Composite organization foreign keys cover every cross-tenant relation; date/range, shape, one-default, one-opening, version and successor constraints prevent ambiguous history.
- Immutable versions, results, sources, events, decisions and ready exports reject updates through database guards. Application roles receive `SELECT` only where RLS permits; all mutations go through action-time-authorized service-role RPCs.
- Transaction RPCs: `open_time_account`, `submit_time_account_adjustment`, `decide_time_account_adjustment`, `create_time_account_policy_version`, `assign_time_account_policy`, `create_payroll_mapping_version`, `prepare_time_period`, `decide_time_period_finding`, `close_time_period`, `reopen_time_period`, `reserve_payroll_export`, `finalize_payroll_export` and `fail_payroll_export`.
- A forward replacement of `decide_time_correction` calls a private closed-period guard before application while preserving its public signature and P1-22 history.
- Organization/period advisory locks, client operation IDs, request hashes, expected versions and unique successor constraints make retries idempotent and races fail visibly.

### Access and Realtime

- Admin: configure/confirm policies and mappings, open accounts, prepare/export and reopen.
- Büro: read configuration, prepare/export and propose account events.
- Effective `time_approval` holders: resolve findings, approve account events and close; existing delegation and self-approval rules apply.
- Employee: read only the employee's own account, relevant explanation and closed statement.
- Outsider: no rows or actions.

RLS mirrors those scopes. Authenticated users get no direct writes. Publish only mutable roots needed for cross-session refresh: `time_accounts`, `time_account_adjustment_requests`, `time_account_policies`, `time_periods`, `payroll_mapping_profiles` and `payroll_exports`. Each receives an organization-bearing unique replica-identity index in the creation/publication migration and one registry entry. Immutable children stay unpublished with default replica identity. Root optimistic versions are bumped when a child decision changes the visible projection.

### UI integration

- Add `Zeitkonto` to `/zeiterfassung` for every role and `Perioden` for Admin/Büro/effective time approvers.
- Add `/zeiterfassung/perioden/[periodId]` for readiness, findings, calculation/close history, preflight and export.
- Link an employee's closed on-demand print statement from `Zeitkonto`; do not persist a PDF.
- Add admin-only `Zeitkonto-Regeln` and `Lohnexport-Zuordnung` sections to `/einstellungen/zeiterfassung`.
- Project approval-required findings into `/aufgaben`; do not add another inbox.
- Use `Tabs`, `SearchableSelect`, `DatePicker`, `TimeInput`, `DurationHoursInput`, `Dialog`/`DialogBody`, `AlertDialog`, `FormDisclosure`, `Banner`/`useBanner`, `ErrorText` and `Skeleton`. Keep all copy and accessibility text natural German.
- Use `useLiveView` or the established router-refresh boundary and `useServerAction`; preserve useful data during refresh failures and reject stale actions visibly.

### Verification shape

- Pure unit tests cover effective policy resolution, bounded credit rules, Berlin day/night/DST splits, absence target treatment, overlapping non-additive supplements, balance arithmetic, historical stability, finding severity, source hashing, CSV escaping/control totals and byte-stable ZIP generation.
- SQL tests cover all constraints, immutability, source-fingerprint refusal, full-population close, account posting, four eyes, close/reopen/successor rules, P1-22 `period_closed`, mapping preflight, export idempotency, organization isolation, RLS/grants, publication/replica identity and teardown.
- `tests/golden/p1-23.spec.ts` uses serial persisted configuration, close/export, employee-visibility and reopen stages, all tagged `@P1-23` and `@GG-07`. Every dependent stage verifies its persisted precondition before acting.
- `tests/audit/wave-2/p1-23.spec.ts` is tagged `@AUDIT-W2-P1-23` and `@AUDIT-W2` and maps every confirmed catalog flow clause.
- Dates come only from `ownedBerlinDateAtOffset("p1-23", ...)` within `+120 … +124`.
- Proposed affected Wave 1 selection: `A1-31|A1-32|A3-R02|A4-R03|A4-R04|A5-01`, plus earlier Golden `@P1-04|@P1-06|@P1-08|@P1-21|@P1-22`. The final diff decides whether this selection must expand.
- No canary test is added: the domain is locally provable. The existing complete DEV canary remains mandatory after a DEV rebuild.

### Rollout and closure

Run type, lint, unit, SQL, migration replay, generated-type, Realtime and documentation checks locally. Apply identical reviewed forward migrations to DEV, inspect them, regenerate types from DEV, then apply them to PROD. Verify production still has 577 legacy time entries, two approved legacy requests, zero automatically created P1-23 rows and unchanged P1-21/P1-22 facts. Never send browser traffic to PROD.

Converge review through `bun run review`, freeze the source and run the required focused local audit, complete local Golden including GG-07, and rebuilt DEV canary. Clean every retained world. Reconstruct the campaign from manifests, retained-world inventory, gate/incident records and command notes; apply decision 0005 only to credible repeatable findings. Commit on local `main` with the required Codex co-author trailer and publish only with `git push origin main:partner-preview`.
