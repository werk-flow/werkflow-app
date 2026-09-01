# P1-22 Time Corrections and Approvals Implementation Plan

Status: complete — accepted 2026-09-01

## Scope

Implement the owner-confirmed [P1-22 slice](phase-1/slices/p1-22-time-corrections-and-approvals.md) across the additive correction model, four-eyes authorization, server actions, shared attention projection, time and calendar UI, Realtime invalidation, exhaustive evidence, DEV-first/PROD-second rollout and closure.

P1-22 does not own time accounts, overtime or supplement classifications, legal-policy warnings, actual period close or reopen, payroll export, a generic approval engine, new external delivery channels, a second task inbox, or automatic planning, dispatch, stock, document, commercial or message effects.

## Execution order

- [x] Verify local `main`, `partner-preview`, documentation and retained-world state.
- [x] Inspect the legacy and canonical time schema, data aggregates, functions, permissions and Realtime posture in DEV and PROD.
- [x] Inspect current action, responsibility, attention, calculation and UI owners.
- [x] Resolve the complete product frontier and receive owner authorization.
- [x] Finalize the correction aggregate, immutable lifecycle and application transaction design.
- [x] Add and locally prove additive schema, organization integrity, RLS, grants, idempotency, concurrency and Realtime invariants.
- [x] Apply committed SQL to DEV and regenerate Supabase types from DEV.
- [x] Implement typed domain validation, projections, server actions and compatibility readers.
- [x] Extend the shared attention taxonomy and owning time surfaces without a parallel inbox or refresh system.
- [x] Add employee correction entry, before/after preview, provisional totals, history, manager decision and batch UI.
- [x] Add unit, SQL, staged Golden and exhaustive Wave 2 audit evidence.
- [x] Run affected Wave 1 audit tags selected from the concrete changed surfaces.
- [x] Converge self-review and authorized CodeRabbit review-fix-review passes.
- [x] Verify DEV security, performance, Realtime, generated types, zero fabricated rows and preserved legacy meaning.
- [x] Apply the identical committed SQL to PROD after read-only preflight and verify preserved aggregates.
- [x] Freeze, run focused acceptance, full local Golden and the unchanged DEV canary.
- [x] Reconcile feature, technical, catalog, audit, roadmap, gate, incident and slice documentation.
- [x] Complete the campaign audit, commit with the required trailer and publish only to `partner-preview`.

## Recovery

All schema changes are additive and default-preserving. Application rollback leaves unused correction tables and functions in place, with legacy readers still able to render existing history. Once accepted corrections exist, database recovery is forward-only: use a corrective migration or a new attributable correction, never rewrite migrations or erase request, decision, applied-result, canonical operation or canonical event history.
