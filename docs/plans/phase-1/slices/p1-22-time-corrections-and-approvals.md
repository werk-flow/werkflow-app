# P1-22 — Consistent time corrections and approvals

Status: accepted complete — 2026-09-01

## Bounded outcome

Employees and managers can use one consistent time-correction request and approval flow with a complete before/after preview, four-eyes rules, withdrawal, delegated approval and visibly provisional totals. The slice covers add, edit, delete, split, reclassification, reallocation, reassignment, missed-clock, stale-action, batch and closed-state boundary behavior without implementing time accounts or period close.

## Direct dependencies

- `P1-07` is accepted and owns shared attention identity, the `/aufgaben` surface and effective responsibility routing.
- `P1-21` is accepted and owns stable attendance sessions, activity segments and immutable capture operations/events.
- `P1-23` remains downstream and owns time accounts, compliance classifications, period close, payroll export and correction/re-export.

## Verified current baseline

- Local `main` is clean and matches `origin/partner-preview` at `8f28d05237fcb653f2cdcc714dc14c81ac53e6ae`; `bun run docs:check` passes and the retained-world inventory is zero.
- DEV has zero rows in `time_entries`, `entry_change_requests`, `time_sessions`, `time_segments`, `time_operations` and `time_segment_events`. All six tables have RLS.
- The four canonical tables allow authenticated `SELECT` only. Mutable roots `time_sessions` and `time_segments` are published with exact index replica identity; append-only `time_operations` and `time_segment_events` are not published and use default identity.
- Legacy `time_entries` and `entry_change_requests` are published with exact index replica identity. The request table has only a manager-facing SELECT policy and broad historical grants constrained by RLS.
- PROD has 577 legacy entries, comprising 573 approved and four rejected rows, plus two approved legacy edit requests. All four canonical tables have zero rows.
- Legacy edits and deletes can mutate facts before approval, request data is incomplete, change-request review is Admin-only, paired session review is not atomic, and reassignment directly rewrites legacy rows. Canonical projected entries are blocked from those mutation paths.

## Resolved decisions

- An employee's own change is always a proposal; there is no recent direct-self-correction window.
- A scoped Admin/Büro correction for another person applies atomically through the same aggregate. The same user's own correction remains a request.
- `time_approval` is resolved for the subject and Berlin action date on every decision. A direct or delegated holder may decide only within inherited scope and never their own request or time. Admin has no bypass.
- Submission, clarification, resubmission, approval, rejection, withdrawal and application failure are retained states. A clarification preserves the old revision and resubmission appends a new one.
- A reason is required for every correction; rejection and clarification require a decision comment.
- Selected decisions are one transaction. A stale or invalid member prevents every application in the batch.
- A correction may source an earlier accepted application, while the private applied-source claim prevents two independent accepted applications from consuming the same source.
- Pending projections are visibly provisional and never impersonate confirmed facts. Confirmed readers overlay only accepted applications and suppress replaced source/application facts.
- `period_closed` is a reserved refusal vocabulary only. P1-22 creates no close state; P1-23 owns close/reopen, accounts and correction/re-export.

The owner confirmed the ten-part report and these decisions on 2026-09-01.

## Implemented ownership and schema

The additive model is one aggregate rather than a second timesheet:

- `time_correction_requests` is the mutable lifecycle root and the only new Realtime-published table. It uses a unique `(id, organization_id)` replica-identity index.
- `time_correction_request_revisions`, `time_correction_request_sources`, `time_correction_events` and `time_correction_applications` retain immutable proposal, source, transition and accepted-result facts. They are not published.
- `app_private.time_correction_applied_sources` makes a source claim unique after application and prevents double consumption without exposing the ledger to clients.
- Public create, revise, decide, withdraw and atomic-batch RPCs are executable by `service_role` only. Private implementations, locks and validators are not executable by `anon` or `authenticated`.
- Every public table has RLS. Employee self-read, manager history and effective-holder review are derived through the authorized loaders; all writes revalidate membership, organization, subject, current source versions, expected revision and responsibility.
- Legacy `time_entries`, canonical sessions/segments and previous correction applications remain distinct source kinds. Original legacy and append-only canonical records are never updated or deleted by P1-22. The compatibility projection adds only the latest accepted result.

Committed migrations, in order:

1. `20260901090000_add_p1_22_time_corrections.sql`
2. `20260901091500_cover_p1_22_foreign_keys.sql`
3. `20260901093000_harden_p1_22_reassignment.sql`
4. `20260901094500_fix_p1_22_organization_cascade.sql`
5. `20260901100000_harden_p1_22_review_findings.sql`
6. `20260901101500_finalize_p1_22_rpc_boundaries.sql`
7. `20260901103000_guard_p1_22_applied_sources.sql`

## Product surfaces and role matrix

- `/zeiterfassung` history provides the shared `Zeitkorrektur` form, before/proposed preview, full own/manager history, clarification response and withdrawal.
- The approval tab and `/aufgaben` use the existing attention and `time_approval` owners. There is no parallel inbox, badge or authority model.
- Daily/weekly totals and calendar blocks label pending overlays as provisional; accepted corrections feed the same time readers used by job and project contexts.
- Employee: create and read own requests, answer clarification and withdraw eligible own requests; never directly apply or self-approve.
- Admin/Büro: read organization history and directly correct another person only inside explicit scope; their own corrections remain requests.
- Effective direct/delegated `time_approval` holder: review another person's current submitted revision, including approve, reject, clarify and atomic selected approval; no other manager permission is implied.
- Outsider or foreign-organization member: no correction rows, form targets or actions.

## Initial acceptance plan

- Add precise unit and SQL proofs for correction payloads, immutable history, stale versions, authorization, organization isolation, idempotency and atomic application.
- Add staged `tests/golden/p1-22.spec.ts` coverage at persisted boundaries and exhaustive `tests/audit/wave-2/p1-22.spec.ts` clause evidence.
- Claim the reserved `+115 … +119` Berlin-date window and remain compatible with all retained Golden and audit state through P1-21.
- Re-run affected Wave 1 audit surfaces selected from the concrete diff, the full Golden battery and the unchanged DEV canary only after the confirmation freeze.
- Apply any accepted additive migration to DEV first and PROD second from identical committed SQL, preserve every production legacy row, regenerate types from DEV and verify RLS, grants, Realtime and advisors.
- Converge CodeRabbit through the repository wrapper before freeze, then complete the campaign audit, documentation closure and `partner-preview`-only publication.

## Completion evidence

Accepted 2026-09-01 on local application/test fingerprint `56ff49ca7746f6f4f5daa79580116513ef51802ef39e0a5994c3a0e8ff613a50`.

- Static and database proof: TypeScript and lint clean; unit suite 462/462 with 824 assertions; P1-21 and P1-22 SQL assertion runners green; migration replay, generated DEV types, type parity and Realtime parity green. Every P1-22 foreign key has a covering index.
- Local build `n8qF-cser5Hddy5im2jYr`: P1-05 compatibility 6/6 (`2026-09-01T084325928Z-66d21c`), focused P1-22 Golden 2/2 (`2026-09-01T084505270Z-4a1808`), affected Wave 1 5/5 (`2026-09-01T084729044Z-9c76fc`) and complete Golden 134/134 (`2026-09-01T085210597Z-7698a4`). After the audit-only catalog mapping change, exhaustive P1-22 audit passed 3/3 on fresh local build `cY4Ka6dCjIGHKHK79OxIr` (`2026-09-01T094121627Z-fff0e5`). The full audit was correctly not run for ordinary Wave 2 slice acceptance.
- Affected Wave 1 selection: `A1-29|A1-24/A1-25|A1-30|A1-31|A5-01/A5-02/A5-03/A5-04`, covering time history/editability, pending approvals, calendar actual-time presentation and assignment/qualification surfaces touched by the shared readers and controls.
- DEV migration history matches the seven committed versions. The rebuilt DEV application `S3F2wCqQu74-Y7DqUXVAE` passed the unchanged cloud canary 9/9 (`2026-09-01T092341616Z-c342d0`).
- PROD received the exact committed SQL in the same order through the migration API, recorded as execution versions `20260901091726` through `20260901091801`. Before and after rollout it held exactly 577 legacy entries (573 approved, four rejected), two approved legacy change requests and zero canonical or correction rows. No backfill or browser traffic reached PROD.
- PROD verification found five RLS-enabled public tables, service-role-only public RPCs, private implementations, indexed request replica identity, Realtime root membership, 29 P1-22 indexes and zero uncovered P1-22 foreign keys. Security advisors reported only the two pre-existing `set_job_assignment_organization` warnings and no P1-22 finding.
- Repository-wrapper CodeRabbit review-fix-review passes converged. Valid findings around reassignment integrity, RPC reachability, source claims, organization cascade and organization-keyed dialog loading/error handling were fixed; the final complete uncommitted review reported zero findings.
- Catalog and Wave 2 audit closure: `50/50 mapped; 50/50 fully evidenced; 0 partial; 0 unmapped`. Final retained-world inventory: `Open retained worlds: 0`.

Known limits remain deliberately downstream: no time account, overtime/supplement or payroll classification, compliance policy, real period close/reopen, export/re-export, reminder/escalation engine, external delivery, mobile/offline queue or automatic downstream operational effect. The request list is bounded to the newest 300 deterministic rows; pagination is not yet a demonstrated need.

## Post-implementation campaign audit

The audit reconciled every P1-22 runner manifest, retained diagnostic, gate/incident entry, review pass, pre-world refusal and no-manifest command. The detailed failure evidence and cleanup record is in `docs/technical/test-incident-log.md`.

- **Tier 1 — schema ownership:** the first focused product failure (`2026-09-01T054534936Z-6a7594`) showed that organization teardown could leave a correction child blocked by foreign-key order. The final FK graph uses deferred cascades, and the P1-22 SQL runner deletes the organization and asserts no request/application survives. The unsafe graph is no longer deployable without failing replay.
- **Tier 1 — SQL runner identity:** `scripts/run-sql-assertions.ts` now derives its label from the requested assertion filename instead of hard-coding P1-21. New non-pgTAP assertion owners cannot be silently reported under the wrong slice.
- **Tier 1 — replayable browser stages:** the first complete Golden failure (`2026-09-01T072057466Z-f96881`) exposed a stale P1-05 assumption about which approval surface a non-holder sees. The shared assertion now checks capabilities, and the diagnostic replay reads an optional persisted manual entry instead of duplicating it. The second full failure (`2026-09-01T080342838Z-223fc0`) exposed that P1-22 inherited responsibility state from P1-05. The P1-22 producer now establishes Admin plus employee authority and the consumer recovers the exact run-owned request by requester and reason. Each stage owns or discovers its prerequisite rather than relying on incidental predecessor state.
- **Tier 2 — bounded shared UI helpers:** retained evidence from `2026-09-01T053344048Z-b50090` and `2026-09-01T055129277Z-108c79` moved DateTime entry and `SearchableSelect` interaction into bounded shared helpers with one transaction-level retry for a proven Realtime remount. All correction and audit callers inherit the checks.
- **Existing Tier 2 controls worked:** the runner refused certification before current-fingerprint P1-05 proof, refused a third full attempt without an investigated rerun-budget reason, rejected an old port-3000 process after the final build and kept every failed world until classification/diagnosis. Those are successful existing controls, so the audit adds no duplicate rule.
- **No durable prevention finding:** the WSL keepalive exit and sandbox proxy omission were host-local cleanup interruptions. The local-stack preflight and explicit retained-world inventory already surfaced them before acceptance, and no repository-level Tier 1/2 change would be more reliable than those existing checks. No Tier 3 rule or backlog entry was added.

All retained worlds were classified, diagnosed where required and cleaned. The final focused, full Golden and canary proofs ran on fresh worlds and passed without retry.
