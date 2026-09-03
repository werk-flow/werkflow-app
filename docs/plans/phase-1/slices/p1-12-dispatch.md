# P1-12 — Dispatch

Status: closed (2026-08-14) — accepted P1-12 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Office users can dispatch scheduled/unscheduled work, batch reschedule, evaluate site/travel feasibility and available readiness signals, track acknowledgement, and distinguish internal plans from customer commitments

## Direct dependencies

`P1-02`, `P1-07`, `P1-11`

## Primary and connected specs

Calendar; jobs; CRM; employee; inventory

## Acceptance evidence

Implemented and accepted 2026-08-14. Live migrations add the exclusive-target dispatch identity with append-only fingerprinted revisions, employee-record recipients, revision-bound acknowledgements/challenges with carry-forward lineage, deferred transactional supersession triggers (single edits, series operations, batch moves, the legacy bridge, parking, and unscheduled→scheduled retargeting all covered), manager-owned Parkplatz context (bounded reasons, responsible person, next-review with overdue attention) over the unchanged `geparkt` signal, occurrence-scoped customer commitments with supersede/withdraw chains that schedule moves never rewrite, an all-or-nothing version-checked idempotent batch-reschedule RPC maintaining the P1-11 projection, and three new derived attention types. Readiness is a compositional honest projection (capacity/qualification via the P1-11 assessment, site/access, explicit-fact travel, material always „nicht reserviert", tools always „nicht bewertet"); every conflict stays a reasoned fingerprinted override. Deploy-day: fully additive, zero fabricated rows, the 12 live parked jobs surface as the labeled legacy missing-context exception, no auto-dispatch/auto-acknowledgement. The cycle fixed a real pre-existing P1-11 defect (planning-form employee labels showed „Unbenannt" because profile names were never resolved). Decision record `0002` captures the dispatch-revision/acknowledgement identity. Two CodeRabbit passes (34 + 45 findings) dispositioned with recorded skips. Evidence: statics clean, 187/187 unit, focused `@GG-03` 6/6 on the production build (world `mssdxi9n`), final full suite **93/93** (world `mssf5xs4`, 15.1m; two prior attempts lost only the documented `@GG-00` freshness intermittent at 86/93 with all else green), Security Advisor unchanged (only the documented Free-Plan exception). Material/tool readiness reruns after `P1-26`/`P1-32` as planned

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
- Decision record: [0002 — dispatch revision and acknowledgement identity](../../../decisions/0002-dispatch-revision-acknowledgement-identity.md)

## Implementation plan (merged 2026-09-03 from the former separate plan file)

Owner-confirmed 2026-08-13 (pre-implementation report items 2–10). This section records the confirmed contract and the migration/commit sequence for the slice.

### Bounded outcome

Office users can dispatch scheduled and unscheduled work, batch reschedule with an explicit preview, evaluate site/travel feasibility and available readiness signals honestly, track revision-bound acknowledgement, and distinguish internal plans from explicitly recorded customer commitments — without creating a second occurrence model, a material reservation, a tool custody system, a message-delivery engine, or `P1-14`'s mature status machine.

### Primary user and roles

Admin/Büro dispatch, reschedule, park with context, and record commitments. Assigned employees see only their own dispatches and acknowledge or challenge the current revision through one simple mobile-friendly action. Outsiders and unassigned employees see nothing.

### Confirmed design (summary — full detail in the [progress log](../log.md) entry of 2026-08-13)

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

### Explicit non-goals

Work templates/tasks/checklists (`P1-13`), mature job status/readiness/blocker machine (`P1-14`), stock reservation (`P1-26`), tool custody (`P1-32`), outbound delivery (`P1-46`), external providers/route optimization (`P1-50`), actual-time creation, copied jobs/customers/occurrences, second inbox.

### Migration sequence (live workflow, additive)

1. `add_p1_12_dispatch_core` — enums, dispatch/revision/recipient/acknowledgement/event tables, CHECKs, FK indexes, org-validation triggers, RLS, grants, publication (operational tables only), sync triggers.
2. `add_p1_12_parking_context` — context + events, unpark trigger, RLS, publication.
3. `add_p1_12_customer_commitments` — commitments + events, one-active partial unique, RLS, publication.
4. `extend_attention_taxonomy_dispatch` — three source types in both pattern CHECKs + validation trigger.
5. `add_p1_12_atomic_dispatch_rpcs` — issue/supersede/acknowledge/challenge/resolve/parking/commitment RPCs, service-role-only grants.
6. `add_p1_12_atomic_batch_reschedule_rpc` — all-or-nothing version-checked batch move.
7. `index_p1_12_readiness_foreign_keys` — `job_material_lines.job_id` + any advisor-flagged new-table FK.

Advisors are rechecked after each DDL phase; generated types regenerated and committed after schema changes.

### Test plan

- Unit: fingerprints, mutation matrix incl. carry-forward, unscheduled→scheduled transition, acknowledgement derivation incl. non-login, batch all-or-nothing determinism, parking transitions, commitment mismatch, travel known/unknown, readiness composition, attention identity versions.
- Golden: `tests/golden/p1-12.spec.ts` tagged `@GG-03`, last-sorting, dual-mode; fixture anchor = day 5 of the second calendar month after the run month, offsets 0..+14 (clear of every predecessor-owned date); read-only `db.ts` helpers only; all business mutations through UI; no actual-time creation.
