# P1-19 — Reactive service and warranty demand

Status: closed (2026-08-30) — accepted P1-19 acceptance record; canonical home for the slice's evidence

## Outcome

Office users can capture or qualify reactive service demand, preserve the original customer statement, triage it against one customer site and exact installed equipment, and connect it to the existing job, planning, dispatch and field-work owners. A direct repeat case remains possible without a synthetic request.

The service case owns only the service-specific thread: triage state, urgency, access guidance, suspected warranty or charge context, duplicate and continuation relationships, exact evidence links and immutable history. It does not copy customers, equipment, jobs, dispatches, artifacts, follow-ups, documents or material facts.

## Confirmed contract

- A request-based case has exactly one source request; a direct case retains its own immutable customer statement. Request qualification remains once-only and atomic.
- One case belongs to one customer and site, may name one contact and one operational job, and can link multiple exact equipment records from that same customer and site.
- Duplicate, related and continuation links preserve both case identities. No record is silently merged or deleted.
- Current states are `new`, `clarification_needed`, `visit_required`, `follow_up_required`, `resolved`, `closed_without_visit` and `duplicate`.
- Suspected warranty, contract, goodwill, rework or charge context is operational triage only. P1-19 makes no legal or final commercial decision.
- Due next actions remain P1-10 follow-ups. Visits reuse calendar occurrences, P1-12 dispatch, P1-14 lifecycle, P1-15 artifacts and P1-16 field work packs.
- Admin and Büro own service-case management. Employees receive only compact service context for the exact assigned job.
- The mutable `service_cases` root is the only new Realtime source. Immutable child history remains unpublished.
- The rollout is additive and creates no inferred service cases or related business rows.

## Test and rollout contract

- Golden: `tests/golden/p1-19.spec.ts`, tagged `@P1-19` and `@GG-05`, with intake, triage, dispatch, visit, follow-up and boundary stages.
- Wave 2 audit: `tests/audit/wave-2/p1-19.spec.ts`, tagged `@AUDIT-W2-P1-19` and `@AUDIT-W2`.
- Fixture dates: offsets `+100 ... +104` at 06:00 Europe/Berlin.
- Affected Wave 1 tags: A1, A2, A6 and A7. A5 remains excluded unless attention derivation changes.
- No canary spec change is planned. The existing nine-test DEV canary remains required.
- The committed migrations reach DEV first and PROD second after local verification. No environment receives a backfill.

## Acceptance evidence

- The implementation adds manager service-case list, detail, direct intake and request-qualification flows under `/service/faelle`. It preserves the original statement, exact customer/site/contact context, selected equipment, one existing job, case relationships, evidence, documents, follow-ups and immutable service history without copying facts owned by another module.
- The assigned field-work pack receives only the case number, issue, urgency, access guidance and exact linked equipment for that job. Suspected warranty or charge context and internal triage remain office-only.
- Migrations `20260830120000` through `20260830120400` reached DEV first and then PROD with identical committed SQL. Both ledgers use the committed version keys. Production retained 5 organizations, 13 customers, 1 site, 40 jobs, 14 projects and 43 documents; every new P1-19 business table remained empty after rollout.
- DEV and PROD verification found one organization-scoped RLS policy per new table, no unsafe function grants, valid constraints and all expected foreign-key indexes. `service_cases` is the only new published Realtime table, uses `(id, organization_id)` replica identity, and brings the publication total to 75 tables on local, DEV and PROD.
- Three CodeRabbit CLI passes produced 23, 14 and 16 findings. Accepted findings hardened tenant-filtered hydration, upload rollback, differential equipment synchronization, action guards, relation integrity, idempotency locks, server-derived case numbers, validation, archive handling, stale-state recovery and accessibility. Rejected findings either targeted personal untracked settings, contradicted the dispatch date window, proposed silent list truncation or duplicated the one-event audit invariant.
- Initial acceptance unit verification passed 397/397 tests across 37 files with 726 expectations. The post-acceptance hardening pass increased that baseline to 399/399 tests across 38 files with 729 expectations. TypeScript, lint, documentation links, migration parity, Realtime parity, database reset/lint, production build and `git diff --check` passed. Database lint retained only the two established pre-P1-19 function warnings.
- Current-source focused evidence passed: `@P1-16` 3/3 (`2026-08-30T183045366Z-eadc1d`), `@P1-19` 8/8 (`2026-08-30T183209887Z-3262dc`), exhaustive `@AUDIT-W2-P1-19` 9/9 (`2026-08-30T183354807Z-c3302e`) and P1-10 Realtime recovery 6/6 (`2026-08-30T190609946Z-f28d2b`).
- The final local Golden Gate passed 122/122 in 23m53.276s (`2026-08-30T190745717Z-adeac4`, world `mtg6m6zj`, build `WHMIMlLrjahdjM9OcPcCu`). The final DEV cloud canary passed 9/9 in 2m18.939s (`2026-08-30T193622589Z-523cbd`, world `mtg7mzg0`, build `YH_C_DYr6Me1EdIeckhu7`). Both used source fingerprint `a0a3aa196707e34b37aaec61838d0efb4bfcae83e5eaaa8a21c1fb4e28f92a5f` and tore down normally.

## Post-implementation campaign audit

The campaign review covered every runner manifest, retained-world record, command session, review finding and correction. Product defects were the canonical contact-column mismatch and the missing service-case document target; both now fail in focused browser coverage (Tier 2). Repeatable harness findings were moved into shared semantic helpers, persisted stage boundaries, date ownership, stale recovery and exact database assertions (Tiers 1 and 2). Two final full-suite attempts stopped on local infrastructure after authoritative rows had persisted: one local REST fetch failed and one Realtime delivery missed its 15-second browser window. Both were classified `environment`, cleaned, and followed by focused P1-11/P1-10 recovery; the Realtime container restart and the recorded rerun-budget override preceded the successful 122/122 certification. The final inventory reports `Open retained worlds: 0`.

The post-acceptance enforcement pass made the document-owner omission unwritable with a shared discriminated union, bounded dispatch-visible fixture dates against the product's window constant, and added pinned DEV type generation and parity commands. Compile-time assertions, convention tests and `types:check` keep those Tier 1 and Tier 2 protections active.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
