# P1-14 Work Lifecycle Implementation Plan

Status: closed (accepted complete 2026-08-23) — historical confirmed contract and verification record; owner confirmed report items 2–10 before implementation. The acceptance record is `phase-1/slices/p1-14-work-lifecycle.md`.

## Confirmed boundary

P1-14 adds a fixed execution lifecycle and composes it with existing planning, readiness, checklist, material, qualification, time and dispatch facts. It does not create a generic workflow engine or copy those domains.

The product contract remains:

> “The status model distinguishes operationally different situations instead of overloading one generic open state: not yet planned, planned, ready, in progress, interrupted, waiting for customer, waiting for material, blocked, parked, execution complete, handed over, cancelled, and archived where validated.”

> “The exact status vocabulary remains a product decision, but every visible status must imply a clear next action and responsible role.”

> “Users can record why work is blocked or interrupted, who must resolve it, and the next review date. A blocked record cannot disappear into a passive status.”

> “Dependencies can express that one job, task, approval, delivery, site condition, or external trade must finish before another step starts.”

> “Readiness makes missing prerequisites visible before dispatch: confirmed site/access, customer availability, required employee skill, material/tool readiness, approved scope, documents, and safety information.”

> “Completion gates identify required instructions, time/material capture, measurements, defect resolution, customer decision, and handover evidence. Managers can override a gate only with a reason and audit visibility.”

> “Cancellation, postponement, and parking remain distinct. Each preserves the history and explains what should happen next.”

> “`Execution complete` means field work has stopped; `handed over` means the required evidence, unresolved items, customer acknowledgement, and office review have reached the agreed state. These must not be collapsed accidentally.”

The fixed execution states are `not_started`, `in_progress`, `interrupted`, `execution_complete`, `handed_over`, and `cancelled`. Planned/unplanned, live readiness, open blocker, parking and completion gates remain separate authoritative facets. Existing production work receives no canonical backfill, fabricated owner, blocker, gate result or event.

## Transition and role contract

| From | Allowed next states |
| --- | --- |
| `not_started` | `in_progress`, `cancelled` |
| `in_progress` | `interrupted`, `execution_complete`, `cancelled` |
| `interrupted` | `in_progress`, `cancelled` |
| `execution_complete` | `handed_over`, `in_progress` |
| `handed_over` | `execution_complete` |
| `cancelled` | `not_started` |

Admin/Büro may use every valid edge and reasoned gate exception. An assigned employee may start, interrupt, resume and mark execution complete, but cannot cancel, hand over, reopen terminal work, park, manage dependencies or override a gate. The server re-resolves role and assignment at action time. Every mutation carries the expected version; stale writes fail without a partial event.

Job-linked clock-in and break-end atomically use the same transition path for `not_started`/`interrupted` → `in_progress`. Planning occurrence changes alter the planning facet only. Dispatch issue/cancel/acknowledgement and request conversion do not forge a lifecycle event. Project execution overrides never cascade; project parking is the sole atomic child-parking operation.

## Blockers, parking and attention

`work_blockers` is the single current model. A target can have several ordinary blockers and at most one open parking blocker. The bounded reason vocabulary is customer, material, approval, capacity, site access, dependency, external trade, safety, internal clarification and other. `other` requires details; every open row requires an employee-record owner and review date. Assigned employees may create an ordinary self-owned job blocker due today and resolve their own blockers; managers have the complete edit/resolve/reopen path.

P1-12 parking contexts/events are migrated into the blocker/event tables before the old tables, type, triggers and RPC are dropped. A context-free legacy parked row receives no fabricated context. Due open blockers project into the existing attention pipeline as `work_blocker_review:<blocker_id>`; read state uses blocker version, so edits/reopen re-surface the same identity without duplicates.

## Dependencies and gates

`work_dependencies` targets one job/project and references one predecessor job/project/instruction or one declared approval, delivery, site condition or external trade. Effects are `blocks_start`, `blocks_completion` and `warning`. Database constraints enforce exact target/reference cardinality, organization ownership, self-links and graph cycles. Work/instruction satisfaction is derived from the owning state; cancellation does not satisfy it. Only declared conditions have an explicitly mutable current state.

Existing `job_instruction_item_dependencies` remain structural checklist prerequisites. The versioned instruction completion RPC rejects completing a successor before its predecessor and makes reopening effective immediately.

Start gates use current open blockers and start dependencies. Completion gates use current required instructions, checklist predecessors, completion dependencies, active job clocks and non-terminal project children. Later sources for measurements, defects, material actuals, handover evidence, signatures and customer packages are stored in `notAssessable`, not converted to success. A manager exception is reasoned and event-snapshotted with a SHA-256 fingerprint; the live facts are evaluated again on the next transition.

Live readiness calls the existing `composeReadinessForTarget`/`composeReadiness` path. Missing data and load failures stay unknown; no-demand material is neutral, planned material remains „nicht reserviert“, and tools remain „nicht bewertet“.

## Schema and application surfaces

The migration batch is:

1. `20260823095635_add_p1_14_work_lifecycle.sql` — enums, columns, operational/event tables, constraints, RLS helpers/policies, immutable guards, transition/blocker/parking/dependency/instruction RPCs, compatibility projections, migration/drop of the P1-12 parking primitive, Realtime membership and grants.
2. `20260823101418_add_p1_14_work_lifecycle_snapshot.sql` — bounded project resolver and service-role lifecycle read model.
3. `20260823103302_integrate_p1_14_time_start.sql` — corrected blocker gate count and atomic time-start integration.
4. `20260823112741_allow_p1_14_organization_cascade.sql` — preserve direct work-history deletion protection while retaining deliberate whole-organization cascade/Golden teardown behavior.
5. `20260823134700_record_p1_14_time_start_origin.sql` — record the automatic time-start origin on lifecycle events.
6. `20260823153022_index_p1_14_audit_foreign_keys.sql` — index lifecycle audit foreign keys used by history and teardown.
7. `20260823155142_harden_p1_14_delete_and_unpark.sql` — protect lifecycle-bearing work from direct deletion and tighten atomic unparking.
8. `20260823155732_accumulate_p1_14_cascade_targets.sql` — retain every work target encountered during organization-cascade cleanup.
9. `20260823162811_close_p1_14_review_gaps.sql` — enforce blocker target integrity and close review-identified transition, dependency and time-start gaps.
10. `20260823163843_split_p1_14_cancellation_triggers.sql` — separate job and project dispatch-cancellation trigger paths.
11. `20260823164131_normalize_p1_14_parking_events.sql` — normalize migrated and newly written parking-event meaning.
12. `20260823173000_harden_p1_14_review_integrity.sql` — migrate legacy attention read identities, add the missing foreign-key indexes and harden blocker, project-cascade and overnight-clock integrity.
13. `20260823181500_finalize_p1_14_atomic_guards.sql` — consume one-shot transition guard flags, preserve exact parent provenance during project parking, serialize project park/unpark, and index active-clock lookup.

DEV project `mbkkzuqjbdvzelqvuzcn` receives the files first through the linked CLI; generated public types come only from DEV. After DEV behavior, RLS, publication, constraints, advisors and teardown pass, the identical file contents are applied in order to production `jbgaqpdjauzoocplgdsn` through the migration API. Production verification must retain 40 jobs/14 projects and leave their canonical columns null.

The job/project detail pages own the new `WorkLifecycleCard`. Existing list, embedded list and calendar projections consume canonical state/version. The old unrestricted status controls and non-atomic project parking action are removed. Blocker review extends `/aufgaben` and its one count provider. `work_blockers` and `work_dependencies` join the central Realtime provider/router refresh; ledgers stay unpublished. Existing jobs/projects cache tags and `/auftraege`, `/kalender`, `/aufgaben`, `/mitarbeiter` revalidation are sufficient.

## Negative connected contracts

> “Template application never creates or changes `planning_series`, `planning_occurrences`, assignments, dispatches, customer commitments or actual time. Template material is demand labeled „nicht reserviert“; structural task prerequisites are not calendar gates until P1-14.”

> “A job status change must not silently reserve, consume, or return stock. Any optional automation around job state needs an explicit rule, visible effect, and recovery path.”

> “Since P1-13, a work-template item may declare an expected evidence description and one existing document category. Application copies that expectation onto the existing work instruction item; it does not create a file, folder, document link, approval, artifact revision or signature. Actual document capture and links remain owned by this document system, while structured artifact/approval/signature behavior remains P1-15.”

P1-15, P1-16, P1-17, P1-21, P1-26, P1-32, P1-46 and P1-48 retain their roadmap boundaries. No external provider or paid resource is used.

## Verification and review record

- Unit boundary: transition matrix, employee role limits, next-action precedence and compatibility mapping; full unit suite 206/206.
- Static/build boundary: TypeScript, lint and `git diff --check` passed; production build ID `Ke6lsX6REdpO2_ZC4V635` served the final browser gates unchanged.
- CodeRabbit: two full CLI passes returned 33 and 34 findings. Valid correctness, RLS, integrity, concurrency, loading/error-state, accessibility and harness findings were fixed; rejected findings were checked against explicit product/database contracts and recorded as deliberate dispositions.
- Focused Golden: `tests/golden/p1-14.spec.ts` (`@P1-14`), 4/4 cross-role journeys (world `mt63gyo0`).
- Exhaustive audit: `tests/audit/wave-2/p1-14.spec.ts` (`@AUDIT-W2-P1-14`, `@AUDIT-W2`), 5/5 journeys mapping `P1-14-F01…F63` on the final frozen build (world `mt67ioww`, 4.4m, zero leftovers), run days +75…+79 at 06:00 Europe/Berlin.
- Affected Wave 1: A1 28/28 (world `mt66pd0o`, 17.2m), A5 4/4, A6 7/7 and A7 9/9 (world `mt64v6ub`, 6.7m) passed after the lifecycle compatibility updates.
- Inherited P1-12 compatibility: focused 6/6 (world `mt690ul5`, 3.5m, zero leftovers) confirmed that planning and parking remain separate while assigned employees retain narrow blocker visibility.
- Final full Golden: 101/101 (world `mt695ga8`, 33.4m, zero leftovers) on the same frozen build.
- Database: all 13 migrations were applied DEV-first and then identically to production; both Security Advisors reported zero findings. Production retained 40 jobs and 14 projects, zero canonical job/project overrides, zero blockers and zero dependencies after deploy.
