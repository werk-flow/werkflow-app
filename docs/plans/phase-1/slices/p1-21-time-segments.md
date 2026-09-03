# P1-21 — Explicit time segments

Status: closed (2026-09-01) — accepted P1-21 acceptance record; canonical home for the slice's evidence

## Bounded Outcome

Employees can capture and atomically switch explicit work, travel, break, standby, call-out, and internal-activity segments. Work, travel, and call-out support a normal job or explicit unallocated state. Invalid, duplicate, stale, overnight, abandoned, and legacy-open sequences have an attributable recovery path.

## Primary User And Roles

- Employees capture and switch only their own current activity.
- Admin and Büro capture their own activity and can inspect organization time.
- P1-21 does not let a manager mutate another employee's live session.
- Outsiders and members of another organization cannot read or mutate the data.

## Verified Current Baseline

- `time_entries` is an append-only event ledger with `clock_in`, `clock_out`, `break_start`, and `break_end` rows. Sessions and work blocks are derived without stable persisted identities.
- Job switches and break endings currently use separate application writes and can leave half-completed transitions.
- Several readers pair events inside one Europe/Berlin day.
- DEV contained zero `time_entries` and zero `entry_change_requests` at the start.
- PROD contained 577 `time_entries` and two approved `entry_change_requests`; one latest sequence was open at the start inspection.
- Both time tables use RLS, Realtime publication, and exact `(id, organization_id)` index replica identity.

## Direct Prerequisites And Evidence

- `P1-04` is accepted and owns effective daily targets and break-policy context.
- `P1-12` is accepted and keeps assignment and dispatch distinct from recorded time.
- `P1-16` is accepted and composes the global clock into the assigned field-work pack.
- `P1-20` is accepted with a closed campaign audit. No predecessor blocker remains.

## Primary And Connected Feature Contracts

The primary specification is [time-tracking.md](../../../features/time-tracking.md). Connected owners are employee management, jobs/projects, calendar/resource planning, field work, work artifacts, work handover, and maintenance visit jobs. P1-21 reads their identities and does not create competing jobs, schedules, dispatches, maintenance records, documents, stock movements, messages, commercial records, or payroll facts.

## In Scope

- Add stable attendance sessions, stable activity segments, append-only transition events, and idempotent operation receipts.
- Add atomic organization-scoped transitions with locks and expected-version checks.
- Keep historical `time_entries` as compatibility input without a bulk backfill.
- Bridge a live legacy sequence on the employee's first later action.
- Add factual category totals and Europe/Berlin display splitting without midnight mutation.
- Update job/project, calendar, field-pack, work-artifact, handover, and maintenance-job consumers.
- Add employee capture UI and manager visibility with existing privacy rules.

## Explicit Non-Goals

- Correction, request, approval, withdrawal, delegation, split, reclassification, and reassignment workflows owned by P1-22.
- Credited or payroll time, supplements, time accounts, compliance conclusions, period close, and export owned by P1-23.
- Organization-managed activity taxonomies, GPS, distance, mileage, legal conclusions, billability, job costing, offline queues, and external providers.
- Direct project or customer allocation. A normal job supplies that context.

## Product Decisions Required Before Coding

The owner confirmed the ten-part pre-implementation report on 2026-08-31. No open decision blocks implementation.

## Data Ownership And Historical Semantics

`time_sessions` owns stable attendance identity. `time_segments` owns factual activity identity. `time_segment_events` preserves transition attribution. `time_operations` owns request replay. Existing `time_entries` remain unchanged compatibility facts; the migration does not fabricate historical sessions or segments.

## Permissions And Organization Isolation

All public tables use RLS. Authenticated users receive only the required read grants. Direct client writes remain unavailable. Narrow server actions authenticate and validate input before calling versioned database functions. Functions reauthorize the caller, pin `search_path`, lock the employee boundary, validate every tenant reference, and write one transaction.

## UI And Field-Worker Behavior

The global clock remains the primary control. One registered activity dialog shows current state, six activity kinds, job or explicit unallocated choice, travel qualifiers, standby context, fixed internal activities, end, and visible recovery. The field-work pack uses the same session and can start or switch work to its current job.

## Realtime, Caching, Offline, And Failure Recovery

The mutable `time_sessions` and `time_segments` roots are published with exact organization-scoped replica identity so a segment switch refreshes every live reader. Append-only events and operation receipts stay off publication. Every transition increments the session version. P1-21 has no offline queue. Network and stale failures never claim success and always reconcile from the server.

## Migration And Rollback

The additive migration is proved locally, applied to DEV, verified, then applied unchanged to PROD. Before and after aggregates protect the 577 legacy events and the open sequence. After canonical writes begin, recovery is forward-only and preserves captured rows; no destructive rollback or historical conversion is allowed.

## User Flows (Catalog IDs)

The owner confirmed provisional flows `P1-21-F01` through `P1-21-F64`. They cover capture, every switch kind, allocation, travel qualifiers, manual and automatic breaks, standby/call-out, internal activity, explicit end, split and overnight days, totals, duplicate and stale requests, concurrent devices, Realtime, long and invalid recovery, legacy compatibility, roles, isolation, connected projections, historical identity, deferral to P1-22/P1-23, accessibility, and the absence of automatic downstream effects. The [catalog section for P1-21](../../../product/user-flow-catalog.md#p1-21--explizite-zeitsegmente-2026-09-01) received the complete German bullets before verification.

## Acceptance Criteria

- Every transition is atomic, idempotent, tenant-safe, and attributable.
- All 577 pre-rollout PROD events keep their source meaning and no historical segment is fabricated.
- The open legacy sequence can end or continue through the confirmed bridge.
- Split and overnight time keeps stable identity and clear Berlin-day presentation.
- Category, allocated, unallocated, target, and automatic-break values remain distinct.
- Connected readers consume the same compatibility projection.
- All 64 flows are fully mapped and evidenced with zero partial or unmapped flows.
- No accepted battery leaves an open session, open segment, or unrecovered sequence.

## Automated And Manual Verification

- Statics: diff check, typecheck, lint, unit, migrations, generated types, Realtime, and documentation.
- Staged serial `@P1-21` Golden proof and exhaustive `@AUDIT-W2-P1-21` proof.
- Compatibility proofs for affected prerequisite and owning slices plus affected Wave 1 audit tags.
- CodeRabbit review-fix-review before the confirmation freeze.
- Frozen local focused audit plus one full Golden run, then rebuilt DEV canary.
- DEV-first and PROD-second migration evidence, RLS/grant/publication checks, advisors, and preserved aggregates.

## Documentation Updates

Update the user-flow catalog, Wave 2 ledger, time/employee/job/calendar specifications, Realtime and testing references, conceptual data model, architecture/security ownership, roadmap, phase log, and Golden gate log where the implementation changes their facts.

## Completion Evidence

- All 64 confirmed flows are mapped and fully evidenced: `64/64 mapped; 64/64 fully evidenced; 0 partial; 0 unmapped`. The four-stage Golden journey covers stable capture, all six activity kinds, atomic switching, explicit end and the no-backfill legacy bridge; the exhaustive Wave 2 audit covers the remaining concurrency, recovery, authorization, Realtime, connected-owner and negative-side-effect clauses.
- The complete local audit passed 117/117 (`2026-08-31T235433509Z-2df998`, world `mthwauhj`) and the complete local Golden battery passed 132/132 (`2026-09-01T004616166Z-8dd36a`, world `mthy5cf9`) on build `n8q4IoBAKq-Pb1_jwGEso`. Focused compatibility proofs passed A1 28/28, A2 15/15, A3 5/5 and the inherited P1-15 boundary after its canonical-source repair. The final frozen fingerprint `9786a58d…e3fc` passed P1-16 3/3 (`2026-09-01T021057433Z-54d722`), focused DEV C6 1/1 (`2026-09-01T021725542Z-811007`) and the unchanged DEV canary 9/9 (`2026-09-01T021822466Z-bf7ad3`). Every retained world was cleaned; the final inventory reports `Open retained worlds: 0`.
- Affected Wave 1 audit decision: `@AUDIT-W1-A1`, `@AUDIT-W1-A2`, and `@AUDIT-W1-A3` ran because P1-21 changed shared job, customer-work, personnel, and time projections. No other Wave 1 audit tag owned a materially changed surface.
- Eighteen additive migrations reached local and DEV first, then PROD from identical committed SQL. P1-21 ledger keys match versions `20260831100920` through `20260901012500` in DEV and PROD. Production retained 577 legacy `time_entries`, 2 change requests, 23 memberships and 25 personnel records, including the one pre-existing open legacy sequence; all four new canonical tables contain zero rows.
- The four canonical tables have RLS and one bounded SELECT policy each. Authenticated clients have SELECT but no direct write grants. Only `time_sessions` and `time_segments` are published, both with exact index replica identity; `time_operations` and `time_segment_events` remain unpublished.
- DEV and PROD security advisors report no P1-21 finding. The two remaining security notices concern the pre-existing `set_job_assignment_organization` function. The performance advisors report zero P1-21 unindexed foreign keys; unused-index notices are expected for zero-row additive tables. The first advisor pass found one unpinned private trigger function, closed DEV-first/PROD-second by `20260901012500_fix_p1_21_clear_trigger_search_path.sql`.
- Eleven CodeRabbit CLI passes reported 21, 21, 16, 14, 20, 20, 25, 33, 1, 0 and 0 issues. Every valid correctness, security, data-integrity, accessibility and test-resilience issue was fixed; pass nine contained only stale suite-inventory wording corrected from the actual test runner, and the final two passes were clean.
- Final non-browser proof is green: database SQL test, migration parity, generated types, Realtime parity, TypeScript, ESLint, documentation, diff and production build. The unit suite passes 435/435 across 41 files with 789 expectations.

## Post-implementation campaign audit

The closing audit promoted each reusable failure as far up the enforcement ladder as practical:

- Tier 1: database transition functions, exact composite foreign keys, immutable event ordering, advisory replay serialization and scoped cascade markers make invalid or cross-organization transitions unwritable. A discriminated `time_entry`/`time_segment` source type prevents canonical artifact links from reaching the legacy RPC. The production cleanup-trigger correction pins an empty `search_path` in the deployed schema.
- Tier 2: the SQL, unit, browser, migration, generated-type, Realtime, advisor and eleven-pass review checks pin those boundaries. `bun run test:sql:p121` owns the non-pgTAP assertion runner and fails on the first SQL error. Shared test helpers now use visible semantic regions, dynamic completed Berlin intervals, the product's duration formatter, keyboard activation of the real calendar button and bounded route-handler signals. Migration parity also rejects a CLI link outside DEV before comparing history. Cloud canary C6 owns its unallocated fixture and proves canonical session/segment persistence instead of expecting new legacy rows or a job from another canary test. ESLint ignores the generated Golden, audit and canary report trees at configuration level, so a retained Playwright trace cannot be linted as application source.
- Tier 3: no new prose-only rule was needed. The two one-off freshness misses passed their exact producer/consumer proofs and complete unchanged batteries; without recurrence or a supported lower-level invariant, adding a speculative rule would weaken the incident discipline.

The run-to-prevention details live in [test-incident-log.md](../../../technical/test-incident-log.md).

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
