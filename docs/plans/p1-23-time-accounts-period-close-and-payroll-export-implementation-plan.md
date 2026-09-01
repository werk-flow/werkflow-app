# P1-23 Time Accounts, Period Close And Payroll Export — Implementation Plan

Status: closed — implemented and accepted on 2026-09-01

## Boundary

P1-23 adds a versioned operational time-account and payroll-export boundary. It consumes effective P1-21 attendance plus accepted P1-22 corrections, P1-04 targets and holidays, P1-06 vacation, P1-08 sickness and P1-05 `time_approval` authority. It does not create a second attendance ledger, generic rules or approval engine, wage calculation, payroll tax, legal-compliance certification, DATEV/provider integration, commercial close, personnel-document workflow or automatic historical backfill.

## Delivery order

1. Add pure typed calculation, policy-resolution, finding, balance and deterministic export builders with focused unit tests.
2. Add one additive schema migration for policies, accounts, calculations, close versions, mappings and export roots; add one forward compatibility migration that makes P1-22 correction application refuse closed dates through its existing `period_closed` result.
3. Add SQL assertions for organization integrity, effective dating, immutable history, four-eyes authorization, idempotency, concurrency, RLS, grants, Realtime and organization teardown.
4. Build server queries/actions and transaction RPCs around the existing official time reader and responsibility resolver.
5. Add the `/zeiterfassung` account/period surfaces, period detail, on-demand statement, settings sections and `/aufgaben` finding projection using existing live-view, pending-action and design primitives.
6. Generate deterministic payroll ZIP bytes through a route handler, persist the exact ZIP through the existing private R2/document model and finalize the export row only after its hash and document metadata agree.
7. Add staged Golden `@P1-23`/`@GG-07`, exhaustive Wave 2 audit and the confirmed affected-regression selections.
8. Validate locally, roll identical migrations to DEV then PROD, converge CodeRabbit, freeze, certify and close documentation.

## Proposed schema

The migration adds only empty structures. No organization, employee, account, period, result, finding, mapping, export or document row is created on deployment.

### Policy configuration

- `time_account_policies`: organization-scoped policy identity, name, one partial-unique organization default and optional retirement metadata.
- `time_account_policy_versions`: immutable numbered versions with explicit Berlin `effective_from`, confirmation attribution, vacation/sickness treatment and fixed calculation-schema version.
- `time_account_policy_credit_rules`: one checked 0/50/100 credit rule for each required activity/context combination, using the existing P1-21 activity, travel and standby enums.
- `time_account_policy_supplement_rules`: fixed night/Sunday/organization-holiday classification kinds and eligible P1-21 activity categories. Night requires an explicit local start/end window.
- `time_account_policy_warning_rules`: fixed break, daily-duration, rest, night, Sunday and holiday warning kinds with enabled state, severity and kind-shaped threshold/window columns. This is a bounded vocabulary, not a rules DSL.
- `time_account_policy_assignments`: date-effective employee-to-policy ranges with an exclusion constraint preventing overlap.

Only confirmed versions resolve. The organization default covers unassigned employees. Current edits never mutate an earlier version.

### Account ledger

- `time_accounts`: one explicitly opened organization/employee account with optimistic version and opening attribution; no row exists before an administrator confirms an opening balance.
- `time_account_events`: append-only minute ledger for opening balance, manual adjustment, expiry, payout and period-close movements. Every non-opening event references its approved request or immutable close version.
- `time_account_adjustment_requests`: organization-scoped pending/approved/rejected/superseded root with operation identity, expected version, signed minutes, effective date, reason and proposer/decision attribution.
- `time_account_adjustment_events`: append-only request history and responsibility snapshots.

Only approved events affect the balance. Payout records minutes and a reference, never money. No automatic expiry, cap, payout or forfeiture exists.

### Period calculation and close

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

### Mapping and export

- `payroll_mapping_profiles`: one organization-scoped mutable root with optimistic version and current confirmed-version pointer.
- `payroll_mapping_versions`: immutable numbered confirmed versions with generator compatibility version and admin attribution.
- `payroll_employee_mappings`: immutable per-version employee-to-external-reference rows.
- `payroll_code_mappings`: immutable per-version mappings for the fixed activity, absence, overtime, supplement and account-event value kinds.
- `payroll_exports`: organization-scoped export root with operation identity, exact close/mapping/generator versions, full-organization scope, state, deterministic content fingerprint, ZIP hash/size, document reference, prior-export reference and supersession metadata.
- `payroll_export_events`: append-only requested, generated, failed, ready and superseded history.

The deterministic ZIP contains `lohnwerte.csv`, `zuordnungen.csv`, `korrekturen.csv`, `kontrollsummen.csv` and `manifest.json`. CSV files use semicolons, UTF-8 BOM, CRLF, English machine headers and integer minutes. Rows carry deterministic IDs. Exact source seconds are aggregated by employee, Berlin day and activity/context bucket, then rounded once to the nearest whole minute with 30 seconds rounding up; the result retains the exact seconds and rounding delta. Supplement buckets round separately and remain non-additive. ZIP entry names, order, timestamps and compression options are fixed so a retry over the same close, mapping and generator identity yields the same bytes and hash.

### Database boundaries

- Composite organization foreign keys cover every cross-tenant relation; date/range, shape, one-default, one-opening, version and successor constraints prevent ambiguous history.
- Immutable versions, results, sources, events, decisions and ready exports reject updates through database guards. Application roles receive `SELECT` only where RLS permits; all mutations go through action-time-authorized service-role RPCs.
- Transaction RPCs: `open_time_account`, `submit_time_account_adjustment`, `decide_time_account_adjustment`, `create_time_account_policy_version`, `assign_time_account_policy`, `create_payroll_mapping_version`, `prepare_time_period`, `decide_time_period_finding`, `close_time_period`, `reopen_time_period`, `reserve_payroll_export`, `finalize_payroll_export` and `fail_payroll_export`.
- A forward replacement of `decide_time_correction` calls a private closed-period guard before application while preserving its public signature and P1-22 history.
- Organization/period advisory locks, client operation IDs, request hashes, expected versions and unique successor constraints make retries idempotent and races fail visibly.

## Access and Realtime

- Admin: configure/confirm policies and mappings, open accounts, prepare/export and reopen.
- Büro: read configuration, prepare/export and propose account events.
- Effective `time_approval` holders: resolve findings, approve account events and close; existing delegation and self-approval rules apply.
- Employee: read only the employee's own account, relevant explanation and closed statement.
- Outsider: no rows or actions.

RLS mirrors those scopes. Authenticated users get no direct writes. Publish only mutable roots needed for cross-session refresh: `time_accounts`, `time_account_adjustment_requests`, `time_account_policies`, `time_periods`, `payroll_mapping_profiles` and `payroll_exports`. Each receives an organization-bearing unique replica-identity index in the creation/publication migration and one registry entry. Immutable children stay unpublished with default replica identity. Root optimistic versions are bumped when a child decision changes the visible projection.

## UI integration

- Add `Zeitkonto` to `/zeiterfassung` for every role and `Perioden` for Admin/Büro/effective time approvers.
- Add `/zeiterfassung/perioden/[periodId]` for readiness, findings, calculation/close history, preflight and export.
- Link an employee's closed on-demand print statement from `Zeitkonto`; do not persist a PDF.
- Add admin-only `Zeitkonto-Regeln` and `Lohnexport-Zuordnung` sections to `/einstellungen/zeiterfassung`.
- Project approval-required findings into `/aufgaben`; do not add another inbox.
- Use `Tabs`, `SearchableSelect`, `DatePicker`, `TimeInput`, `DurationHoursInput`, `Dialog`/`DialogBody`, `AlertDialog`, `FormDisclosure`, `Banner`/`useBanner`, `ErrorText` and `Skeleton`. Keep all copy and accessibility text natural German.
- Use `useLiveView` or the established router-refresh boundary and `useServerAction`; preserve useful data during refresh failures and reject stale actions visibly.

## Verification shape

- Pure unit tests cover effective policy resolution, bounded credit rules, Berlin day/night/DST splits, absence target treatment, overlapping non-additive supplements, balance arithmetic, historical stability, finding severity, source hashing, CSV escaping/control totals and byte-stable ZIP generation.
- SQL tests cover all constraints, immutability, source-fingerprint refusal, full-population close, account posting, four eyes, close/reopen/successor rules, P1-22 `period_closed`, mapping preflight, export idempotency, organization isolation, RLS/grants, publication/replica identity and teardown.
- `tests/golden/p1-23.spec.ts` uses serial persisted configuration, close/export, employee-visibility and reopen stages, all tagged `@P1-23` and `@GG-07`. Every dependent stage verifies its persisted precondition before acting.
- `tests/audit/wave-2/p1-23.spec.ts` is tagged `@AUDIT-W2-P1-23` and `@AUDIT-W2` and maps every confirmed catalog flow clause.
- Dates come only from `ownedBerlinDateAtOffset("p1-23", ...)` within `+120 … +124`.
- Proposed affected Wave 1 selection: `A1-31|A1-32|A3-R02|A4-R03|A4-R04|A5-01`, plus earlier Golden `@P1-04|@P1-06|@P1-08|@P1-21|@P1-22`. The final diff decides whether this selection must expand.
- No canary test is added: the domain is locally provable. The existing complete DEV canary remains mandatory after a DEV rebuild.

## Rollout and closure

Run type, lint, unit, SQL, migration replay, generated-type, Realtime and documentation checks locally. Apply identical reviewed forward migrations to DEV, inspect them, regenerate types from DEV, then apply them to PROD. Verify production still has 577 legacy time entries, two approved legacy requests, zero automatically created P1-23 rows and unchanged P1-21/P1-22 facts. Never send browser traffic to PROD.

Converge review through `bun run review`, freeze the source and run the required focused local audit, complete local Golden including GG-07, and rebuilt DEV canary. Clean every retained world. Reconstruct the campaign from manifests, retained-world inventory, gate/incident records and command notes; apply decision 0005 only to credible repeatable findings. Commit on local `main` with the required Codex co-author trailer and publish only with `git push origin main:partner-preview`.

## Completion

The delivery order completed on 2026-09-01. Fourteen additive migrations reached DEV and PROD with exact committed-history parity and no P1-23 backfill. Final acceptance evidence is recorded in the canonical slice record, Golden-gate log, Wave 2 ledger and browser-test incident log.
