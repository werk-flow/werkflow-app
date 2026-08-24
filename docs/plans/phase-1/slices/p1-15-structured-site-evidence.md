# P1-15 — Structured site evidence

Status: closed — accepted complete 2026-08-24

This record is the canonical home for P1-15 acceptance facts. The current slice index lives in [../roadmap.md](../roadmap.md); process rules live in [../protocol.md](../protocol.md).

## Bounded outcome

Field and office users can create structured site diaries, reports, measurements, defects, change-work evidence, approvals, and signatures linked to exact artifact versions.

## Direct dependencies

`P1-07`, `P1-13`, `P1-14` — all accepted complete before this slice started.

## Primary and connected specs

Jobs/projects; documents; commercial; service.

## Confirmed contract

The product owner confirmed report items 2–10 on 2026-08-24. P1-15 uses one stable artifact identity with immutable typed revisions. Every approval, rejection, customer response, signature and export binds to one exact revision. The slice adds five kinds: Bautagebuch, Arbeitsbericht, Aufmaß, Mangel and Regie-/Änderungsnachweis. It reuses the document store, attention pipeline, responsibility model, instruction evidence expectations and P1-14 lifecycle gates without creating parallel domain systems.

The complete design, permission matrix, gate behavior, migration order, non-goals and verification plan are in the [owner-confirmed implementation plan](../../p1-15-structured-site-evidence-implementation-plan.md).

## Acceptance evidence

P1-15 is accepted complete with `78/78 mapped; 78/78 fully evidenced; 0 partial; 0 unmapped` in the Wave 2 ledger. The implementation adds the five structured artifact kinds, immutable typed revisions, exact-revision decisions/signatures/documents/sources/exports, scoped Four-Eyes review, instruction-evidence fulfilment, attention and lifecycle projection, while leaving schedule, dispatch, actual time, stock, commercial records, messages and customer packages unchanged.

Fifteen committed migrations were applied DEV-first and then identically to production. Both environments report zero Security Advisor and zero Performance Advisor findings. Production retained 40 jobs and 14 projects and received zero P1-15 business rows.

Four CodeRabbit CLI passes were dispositioned (47, 3, 32 and 27 findings). Valid findings hardened authorization, atomic signature/document linkage, immutable revision guards, submission validation, deterministic export cleanup/order, viewer-scoped attention, action visibility, UI failure recovery and audit helpers; rejected suggestions would have weakened fail-closed attention behavior, published immutable ledgers, or duplicated established ownership without a demonstrated defect.

Final frozen build `pa2j4ys53RN4VqROc1u6O`: focused `@AUDIT-W2-P1-15` passed 4/4 in world `mt73hwm5` (5.9m), then full Golden passed 102/102 in world `mt73pl6q` (35.2m). Both teardowns destroyed their worlds with zero leftover records. Focused `@P1-15` passed 1/1; inherited P1-13/P1-14 passed 8/8. The affected Wave-1 A5 battery passed 4/4; A1's first 26 cases passed in the combined run and its material journey passed focused after correcting a stale assertion to the product's persisted take/return arithmetic. No named Golden gate was due; the next is `GG-04` after `P1-17`.

## Links

- Implementation plan: [p1-15-structured-site-evidence-implementation-plan.md](../../p1-15-structured-site-evidence-implementation-plan.md)
- Audit ledger: [wave-2-audit.md](../../wave-2-audit.md)
- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
