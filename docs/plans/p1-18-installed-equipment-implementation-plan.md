# P1-18 Installed Equipment Implementation Plan

Status: complete — accepted 2026-08-29

## Scope

Implement the confirmed [P1-18 slice](phase-1/slices/p1-18-installed-equipment.md) across the additive Supabase model, TypeScript domain boundary, manager service routes, compact customer-site projection, explicit assigned-job field projection, existing document owner, Realtime invalidation and staged acceptance tests.

P1-18 does not own service intake, dispatch, maintenance recurrence or contracts, time segmentation, inventory consumption or returns, commercial warranty decisions, outbound communication, OCR, global search, offline mobile behavior, telemetry or a configurable asset platform.

## Execution order

- [x] Verify the repository, roadmap, tests, retained worlds, generated types and live DEV state.
- [x] Resolve the product frontier and receive owner authorization.
- [x] Set P1-18 to `in_progress`, create its canonical record and claim audit dates.
- [x] Add the equipment schema, RLS, guarded operations, immutable history and Realtime root.
- [x] Reset the local database and verify schema invariants.
- [x] Add generated domain types, validation, projections and server actions.
- [x] Extend document linking without changing byte storage or employee document authorization.
- [x] Add manager list/detail routes, loading states and customer-site projection.
- [x] Add the explicit assigned-job employee projection.
- [x] Add unit, staged Golden and exhaustive Wave 2 audit coverage.
- [x] Apply the committed migration sequence to DEV and regenerate types.
- [x] Verify DEV RLS, advisors, Realtime parity and zero fabricated rows.
- [x] Run self-review and the available CodeRabbit review-fix-review passes.
- [x] Apply the identical committed migration sequence to PROD after read-only preflight.
- [x] Freeze and run the focused audit, full local Golden and full cloud canary.
- [x] Reconcile documentation and close the slice.
- [x] Prepare the closure commit for publication to `partner-preview`.

## Recovery

Use forward corrective migrations. Never rewrite committed migration history or remove production data to repair the slice. A failed multi-row lifecycle action must roll back. A repeated idempotency key must return the committed result without another history event.
