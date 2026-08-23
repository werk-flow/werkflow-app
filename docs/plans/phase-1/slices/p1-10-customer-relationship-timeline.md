# P1-10 — Customer relationship timeline

Status: complete (accepted 2026-08-10)

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Office users get a customer relationship timeline with owned manual follow-ups and communication preferences that points to source records rather than duplicating them

## Direct dependencies

`P1-01`, `P1-02`, `P1-07`

## Primary and connected specs

Customers/CRM; jobs; documents; communications contract

## Acceptance evidence

Implemented and accepted 2026-08-10. Migrations `add_p1_10_customer_relationships`, `extend_attention_taxonomy_client_follow_up`, and `index_p1_10_relationship_foreign_keys` add manager-only communication settings/preferences with append-only events, authoritative follow-ups with transactional lifecycle history, organization/client validation, operational Realtime, and indexed foreign keys. The customer detail projects a bounded, deterministic typed timeline directly from authoritative requests, jobs, projects, documents, follow-ups, and preference events; every item retains an exact source deep link and no generic copied timeline/backfill exists. Follow-ups extend P1-07 attention with owner-aware overdue items. Communication guidance resolves customer defaults plus contact/purpose overrides, warns for disallowed/unknown or mismatched recipient/channel combinations, and audits an explicit exception without claiming consent, legal basis, or delivery. Admin/Büro have the relationship surface; employees retain only purpose-limited assigned-job facts; outside organizations are denied. The slice also fixed the verified pre-existing shared Realtime defect: the provider published customer contacts/sites/requests, but `useRealtimeRouterRefresh` did not subscribe to them; all three are now wired, and manager-only raw customer/contact/site policies remove the prior field-access mismatch. Four CodeRabbit passes reviewed the complete uncommitted slice context (19, 14, 13, and 19 findings): actionable authorization, validation, source-link, Realtime-filter/coalescing, pagination/cursor, time-zone/DST, accessibility, query-scope/capacity, dialog-safety, and test findings were fixed; deliberate skips were bounded visible-failure sets rather than silent truncation, a future union-RPC performance refactor, and generated RPC-argument casts required by the current live-generated types. Final evidence: lint, TypeScript, diff check, production build, 136/136 unit tests, focused `@P1-10` 6/6 (world `msn3lla6`, 1.2m), dependency-complete Realtime regressions 21/21 and 37/37, and full production suite 82/82 (world `msn3ndvp`, 13.0m), with every world destroyed.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
