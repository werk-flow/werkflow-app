# P1-12 — Dispatch, Batch Rescheduling, Readiness, Acknowledgement, Customer Commitments

Owner-confirmed 2026-08-13 (pre-implementation report items 2–10). This plan records the confirmed contract, the migration/commit sequence, and the running execution ledger for the slice. The roadmap row and progress log in [`phase-1-build-roadmap.md`](./phase-1-build-roadmap.md) hold the authoritative status.

## Bounded Outcome

Office users can dispatch scheduled and unscheduled work, batch reschedule with an explicit preview, evaluate site/travel feasibility and available readiness signals honestly, track revision-bound acknowledgement, and distinguish internal plans from explicitly recorded customer commitments — without creating a second occurrence model, a material reservation, a tool custody system, a message-delivery engine, or `P1-14`'s mature status machine.

## Primary User And Roles

Admin/Büro dispatch, reschedule, park with context, and record commitments. Assigned employees see only their own dispatches and acknowledge or challenge the current revision through one simple mobile-friendly action. Outsiders and unassigned employees see nothing.

## Confirmed Design (summary — full detail in the roadmap progress-log entry, 2026-08-13)

1. **Dispatch identity:** `planning_dispatches` with exclusive target (one `job_visit` occurrence XOR one unscheduled job), partial-unique one active dispatch per target, `active`/`cancelled` status, `current_revision_id` pointer, creation idempotency key.
2. **Revisions:** append-only `planning_dispatch_revisions` snapshotting the material instruction (target schedule instants/dates, location source, dispatch note, recipient employee-record set) with a SQL-computed `material_fingerprint`, readiness snapshot + fingerprint, `change_kind` vocabulary (`issued`, `schedule_changed`, `reassigned`, `target_scheduled`, `instruction_changed`, `batch_reschedule`, `cancelled`).
3. **Recipients/acknowledgements:** `planning_dispatch_recipients` per revision; append-only `planning_dispatch_acknowledgements` keyed to (revision, employee record) with states `acknowledged`/`challenged`/`carried_forward`, actor user recorded separately, challenge resolution fields, latest-row-wins derivation. Non-login recipients derive the labeled `nicht möglich` state.
4. **Transactional supersession:** deferred constraint triggers on `planning_occurrences` (material columns, status) and `planning_occurrence_assignments` call an idempotent fingerprint-guarded sync so a materially moved/reassigned/cancelled dispatched occurrence can never keep a stale acknowledged current revision — regardless of which P1-11 mutation path ran. Recipient-set-only changes carry unchanged recipients forward as traceable `carried_forward` rows.
5. **Parkplatz context:** `jobs.status = 'geparkt'` stays authoritative; `job_parking_contexts` (one current row: bounded reason vocabulary + note, responsible employee record, next-review date) + append-only `job_parking_events`; unpark trigger clears context with an event; legacy parked jobs remain a labeled missing-context exception; overdue review derives a manager attention item.
6. **Batch reschedule:** explicit selection of future scheduled non-exception-ineligible occurrences → app-computed shifted instants + `assessPlanningOccurrences` preview incl. commitment/acknowledgement impact → one all-or-nothing version-checked idempotent RPC; per-occurrence events plus one batch event; dispatch supersession via the sync triggers.
7. **Customer commitments:** `planning_customer_commitments` occurrence-scoped manually recorded facts (date + optional window, source vocabulary, optional contact, actor) with one-active partial unique, supersede/withdraw chain and events; schedule moves never touch them — mismatch is a visible required action; no message is sent anywhere in this slice.
8. **Travel/site:** authoritative current site/access from `client_sites`, historical `jobs.location` snapshot; travel = same-site pass / zero-negative-gap warning / otherwise `nicht bewertet`; no provider, no geocoding, no GPS.
9. **Readiness:** pure compositional resolver per dimension (`ok`/`warning`/`unknown`) over owning-domain facts; material always labeled `nicht reserviert`; tools always `nicht bewertet` in this slice; snapshot at issue for audit; no stored aggregate boolean.
10. **Attention:** taxonomy grows by `dispatch_acknowledgement` (employee, state version = current revision), `dispatch_challenge_open` (manager), `job_parking_review` (manager); derived live, no new inbox.
11. **Conflicts:** everything remains a reasoned-override warning; only structural invalidity blocks.

## Explicit Non-Goals

Work templates/tasks/checklists (`P1-13`), mature job status/readiness/blocker machine (`P1-14`), stock reservation (`P1-26`), tool custody (`P1-32`), outbound delivery (`P1-46`), external providers/route optimization (`P1-50`), actual-time creation, copied jobs/customers/occurrences, second inbox.

## Migration Sequence (live workflow, additive)

1. `add_p1_12_dispatch_core` — enums, dispatch/revision/recipient/acknowledgement/event tables, CHECKs, FK indexes, org-validation triggers, RLS, grants, publication (operational tables only), sync triggers.
2. `add_p1_12_parking_context` — context + events, unpark trigger, RLS, publication.
3. `add_p1_12_customer_commitments` — commitments + events, one-active partial unique, RLS, publication.
4. `extend_attention_taxonomy_dispatch` — three source types in both pattern CHECKs + validation trigger.
5. `add_p1_12_atomic_dispatch_rpcs` — issue/supersede/acknowledge/challenge/resolve/parking/commitment RPCs, service-role-only grants.
6. `add_p1_12_atomic_batch_reschedule_rpc` — all-or-nothing version-checked batch move.
7. `index_p1_12_readiness_foreign_keys` — `job_material_lines.job_id` + any advisor-flagged new-table FK.

Advisors are rechecked after each DDL phase; generated types regenerated and committed after schema changes.

## Test Plan

- Unit: fingerprints, mutation matrix incl. carry-forward, unscheduled→scheduled transition, acknowledgement derivation incl. non-login, batch all-or-nothing determinism, parking transitions, commitment mismatch, travel known/unknown, readiness composition, attention identity versions.
- Golden: `tests/golden/p1-12.spec.ts` tagged `@GG-03`, last-sorting, dual-mode; fixture anchor = day 5 of the second calendar month after the run month, offsets 0..+14 (clear of every predecessor-owned date); read-only `db.ts` helpers only; all business mutations through UI; no actual-time creation.

## Execution Ledger

| When | Step | State |
| --- | --- | --- |
| 2026-08-13 | Starting position verified (git `0cbf814`, clean; remotes verified via ls-remote; live counts/advisors/migrations match baseline; unit 156/156; Playwright 87 in 12 files) | done |
| 2026-08-13 | Pre-implementation report confirmed by owner (items 2–10); testing + CodeRabbit authorized incl. diff upload | done |
| 2026-08-13 | Roadmap set `in_progress`, checkpoint + progress log updated; this plan + decision record 0002 created | done |
| 2026-08-13 | Migrations 1–7 applied (`add_p1_12_dispatch_core`, `add_p1_12_parking_context`, `add_p1_12_customer_commitments`, `extend_attention_taxonomy_dispatch`, `add_p1_12_atomic_dispatch_rpcs`, `add_p1_12_atomic_batch_reschedule_rpc`, `index_p1_12_readiness_foreign_keys`) plus `fix_p1_12_batch_legacy_projection`; Security Advisor unchanged (only the documented Free-Plan exception); Performance Advisor shows only expected new-empty-table "unused index" INFOs; types regenerated | done |
| 2026-08-13 | Domain modules (`lib/dispatch`, `lib/parking`, `lib/commitments`) — typecheck/lint clean | done |
| 2026-08-13 | Attention taxonomy (3 source types), Realtime provider/publication wiring, count pipeline, `/aufgaben` rendering | done |
| 2026-08-13 | Manager UI (Einsätze panel, issue/commitment/challenge/batch dialogs, Parkplatz context) + employee dispatch card on the job detail | done |
| 2026-08-13 | Unit tests 182/182 (26 new: derivation, readiness, batch math, commitment mismatch) | done |
| 2026-08-13 | Golden spec `p1-12.spec.ts` (`@GG-03`, 6 tests, last-sorting, dual-mode) + read-only db helpers + steps; suite lists 93 tests in 13 files | done |
| 2026-08-14 | Focused `@GG-03` iterations green after three real fixes surfaced by the harness: profile-name resolution in `loadPlanningOptions` (pre-existing P1-11 „Unbenannt" labels), RPC parameter defaults for omitted nullable arguments (PGRST202), and the plpgsql unassigned-record 55000 in the job-targeted issue path (migrations `fix_p1_12_rpc_optional_arguments`, `fix_p1_12_issue_dispatch_unassigned_record`) | done |
| 2026-08-14 | CodeRabbit pass 1 (34 findings: 30 fixed incl. travel-note record-id labels, null-job batch group, challenge task identity + migration `fix_p1_12_challenge_attention_identity`, viewer-scoped attention derivation; 2 skipped with reasons — provider-architecture refactor, message-based RPC error identifiers under constant P0001; 2 partial with reasons) and pass 2 (45 findings: 39 fixed incl. rejection/try-finally hardening, shared 150 ms debounces, challenges-first attention query, order+truncate caps, batch all-day/duration guards, instant-parsed acknowledgement ordering, a11y/labels/copy; 6 skipped with reasons — single-channel provider architecture, P0001 error codes, defaults-write-null clearing already correct, consumer-side name fallback, serial-spec baseline capture, 44px targets on the dense desktop panel kept at h-7) | done |
| 2026-08-14 | Statics frozen (tsc/lint clean, unit 187/187); focused `@GG-03` 6/6 post-review (world `mssdqibu`); optimized production build; focused `@GG-03` on the production server 6/6 (world `mssdxi9n`, 1.7m) | done |
| 2026-08-14 | Full production suite: attempts 1–2 lost only the long-green `@GG-00` clients-freshness test to one missed live delivery each (86/93, all else green incl. every P1-12 live assertion; investigated per the two-in-a-row rule: `realtime.subscription` empty, focused `@GG-00` 13/13 twice at normal speed, no P1-12 code path touches the clients flow); attempt 3 passed **93/93** unchanged (world `mssf5xs4`, 15.1m). Gate log recorded | done |
| 2026-08-14 | Docs reconciled (calendar/jobs/CRM/employee/inventory baselines, data-model, realtime-and-caching, testing incl. P1-12 date ownership and left-behind state, gate log, roadmap `complete`, decision record 0002); final Security Advisor check unchanged | done |
| 2026-08-14 | Slice committed on local `main` and published via `git push origin main:partner-preview` | done |
