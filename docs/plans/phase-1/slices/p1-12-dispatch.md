# P1-12 — Dispatch

Status: complete (accepted 2026-08-14)

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
- Implementation plan (confirmed contract and execution ledger): [p1-12-dispatch-implementation-plan.md](../../p1-12-dispatch-implementation-plan.md)
- Decision record: [0002 — dispatch revision and acknowledgement identity](../../../decisions/0002-dispatch-revision-acknowledgement-identity.md)
