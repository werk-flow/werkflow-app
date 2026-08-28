# P1-17 Office Handover

Status: closed — accepted complete on 2026-08-28

## Outcome

Execution-complete jobs and projects gain one responsibility-owned office review that can release an exact-version customer package, record operational readiness for later commercial review and transition the existing P1-14 lifecycle to `handed_over`. Missing operational evidence stays classified as blocking, reasoned-override, warning or explicitly unassessed. Reopening never rewrites a prior review, release, override or lifecycle event.

The slice satisfies `GG-04` across template application, dispatch, assigned field execution, tasks, time/material context, photos/documents, measurement, defect/change evidence, signature/refusal, privacy, handover and reopening. It does not add delivery, public access, billing, prices, material consumption, time segmentation, equipment/service history, offline behavior or an external provider.

## Confirmed targets and routes

Both jobs and projects own durable handover packages.

- Standalone job: `/auftraege/[jobNumber]/uebergabe`.
- Project child job: `/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe`.
- Project: `/auftraege/projekt/[projectNumber]/uebergabe`.
- Existing job/project detail shows a compact summary and one primary review action.
- The P1-16 field pack keeps its operational composition and gains only a customer-safe released-job summary.

A project release can include project-owned sources and immutable child-job releases. It never widens a child-job employee's authorization to the project, sibling jobs or project-wide documents.

## Responsibility and authorization

`work_handover_review` is separate from `work_artifact_approval`. Admin and Büro are its role default; selected and currently delegated holders use the target-scoped review route. Organization membership, target access, responsibility, delegation interval, package version, lifecycle version, gate fingerprint and source identities are checked again at mutation time.

Assigned employees can read only their current job's released customer-safe summary. Unassigned employees and outsiders receive no package data. Removed assignment or expired responsibility makes a loaded surface stale and inert and causes any queued mutation to fail.

## Exact release contract

A mutable package root and draft membership lead to immutable releases, release items and events. A release freezes:

- Customer, site and contact metadata needed to identify the handover target.
- The P1-14 gate snapshot and fingerprint.
- Approved customer-facing work-artifact revision IDs.
- Explicit document identities: document ID, version number and storage path.
- Included immutable child-job release IDs for project packages.
- Safe operational time/material summaries and their source fingerprints.
- Review attribution, effective-responsibility snapshot, override facts, commercial-readiness result, renderer version, content hash and package document identity.

Source rows and source bytes remain owned by their existing domains. The one generated deterministic HTML file is the customer-package artifact, not a private copy of its sources. Editing a draft changes no release. Regeneration after release always creates a successor.

## Gates and readiness

Hard gates are organization/target authorization, current responsibility, expected versions, eligible lifecycle state, exact permitted source identity, a non-empty package, no active clock and valid project/child integrity. They cannot be overridden.

Incomplete required instructions/evidence, reopened predecessors, unresolved completion blockers/dependencies, open defects, pending formal approval, required customer decisions/signatures and incomplete child handover can be accepted only with an attributed reason. Missing optional photos, dispatch, time or material context are warnings. Time segmentation, material consumption, tool custody, billability, invoice quantities, prices, tax and accounting remain explicitly unassessed.

The release records `ready_for_commercial_review` or `ready_with_exceptions`. It is not billing approval and creates no commercial document or downstream mutation.

## Atomicity, failure and history

The server renders and hashes the package, uploads it to the existing organization-scoped EU R2 path and then runs one transaction that revalidates every authority/version/source fact before registering document metadata, release/items/events, review/override/readiness, the package root and the P1-14 `handed_over` transition. Any database failure rolls back the complete business action. An uploaded object is removed only after proving that no committed document or release references it. Request IDs make response-loss retries idempotent and reject conflicting duplicates.

Withdrawing handover moves `handed_over` to `execution_complete`, retains the old release and opens a successor draft. Continuing field work then uses the existing reasoned `execution_complete -> in_progress` transition. Re-handover creates a new immutable release linked to its predecessor.

## Privacy and freshness

The customer renderer uses an explicit field allowlist. Internal notes/drafts, rejected/correction states, responsibility snapshots, review/override reasons, personnel/time detail, hidden signer/witness context, prices, margins, supplier terms, valuation, billability and unrelated target data never enter customer output.

Opening and previewing are side-effect free. The central Realtime provider remains the only subscription owner. A published safe mutable package root signals authoritative refetches of unpublished immutable release/item/event rows. The 150 ms debounce, focus/visibility catch-up, generation guards, keep-last-known stale state and dialog refresh suspension follow the Client Freshness Contract.

## Schema and rollout

The confirmed additive model is `work_handover_packages`, `work_handover_draft_items`, `work_handover_releases`, `work_handover_release_items` and `work_handover_events`, with guarded RPCs, immutable-ledger triggers, strict organization/target/source constraints, RLS, service-bound mutations and Realtime publication only for the package root. Attention reuses the existing task owner with `work_handover_review` as its source type.

Migrations go to DEV first, followed by generated types and both advisor classes. The identical committed sequence reaches PROD only after DEV verification. No package, review, readiness or execution history is backfilled. Production must retain its existing 40 jobs and 14 projects and receive no fabricated P1-17 business rows.

## Confirmed flow and test contract

The owner confirmed `P1-17-F01` through `P1-17-F109`. They are final in the user-flow catalog and close at `109/109 mapped; 109/109 fully evidenced; 0 partial; 0 unmapped`.

- Last-sorting staged Golden: `tests/golden/p1-17.spec.ts`, tags `@P1-17`, `@GG-04`, and setup/handover/reopen/boundary stage tags.
- Exhaustive Wave 2 audit: `tests/audit/wave-2/p1-17.spec.ts`, tags `@AUDIT-W2-P1-17` and `@AUDIT-W2`.
- Fixtures: `+90 … +94` at 06:00 Europe/Berlin.
- Affected Wave 1: A1, A5 and A7; A6 is excluded because calendar/planning behavior is unchanged.
- UI-only business mutations, read-only database assertions, persisted-state evidence, every relevant role, cross-organization denial, teardown and independent zero-leftover proof are mandatory.

## Acceptance evidence

P1-17 is accepted complete. Jobs and projects now own durable office-handover packages with versioned drafts, immutable releases and exact source membership. The release transaction binds responsibility, gate snapshot, exception/readiness decision, deterministic customer-safe HTML document, append-only handover history and the P1-14 `handed_over` transition. Withdrawal and correction retain prior releases and create attributable successors. Assigned field workers receive only the released job summary; office review, internal reasons and project/sibling data remain server-protected.

Fifteen committed migrations were applied DEV-first and then identically to production. Migration 1514 was added after the Performance Advisor identified 15 uncovered P1-17 foreign keys; the database index tier now prevents that class. Both environments have zero Security Advisor findings and zero P1-17 unindexed-foreign-key findings. The remaining P1-17 performance notices are expected unused-index information on empty new tables. Production retained 40 jobs and 14 projects, and all five P1-17 business tables remained empty after rollout. The committed TypeScript database types exactly match a fresh DEV generation.

Five CodeRabbit CLI passes returned 80 findings (17, 14, 16, 17 and 16). Accepted findings hardened organization/target authorization, action-time responsibility, review integrity, exact-version relations, transaction boundaries, deterministic export, failure cleanup, attention capacity, UI recovery and customer-data minimization. Rejected findings either weakened fail-closed behavior, contradicted immutable history, duplicated established owners or were unsupported style changes. No correctness, security or data-loss finding remains open. Prevention landed primarily at Tier 1 through database constraints/RPC boundaries and precise types, with Tier 2 unit and browser coverage for deterministic export, package identity, lifecycle gates and project derivation.

Final static evidence: `git diff --check`, TypeScript, lint and `docs:check` clean; unit tests 259/259 in 31 files; production build `X4oL6dbQcckKrMaF8IuOX` passed. Affected Wave 1 passed A1 28/28 (world `mtc3njhg`), A5 4/4 (world `mtc5gepa`) and A7 9/9 (world `mtc5yuu3`); A6 was excluded because no calendar/planning behavior changed. Earlier focused P1-17 Golden passed 5/5 and exhaustive audit passed 4/4 while fixes were still iterating.

The final confirmation pair used one frozen source fingerprint `ad281b52…`: focused `@AUDIT-W2-P1-17` passed 4/4 in 8.6 minutes (world `mtc6tlit`), followed sequentially by full Golden 110/110 in 56.6 minutes (world `mtc767kd`). Both teardowns destroyed their disposable worlds. `GG-04` is accepted. P1-17 creates no delivery, public link, customer portal, billing record, price/tax decision, time segment, stock movement/reservation/consumption, service equipment history, offline queue or external provider.

Follow-up work remains with the roadmap owners already named in the contract: installed equipment/service history (`P1-18` onward), time segmentation (`P1-21`), reservation/consumption/procurement (`P1-26` onward), commercial documents and billing (`P1-35` onward), delivery/messaging (`P1-46`) and mobile/offline behavior (`P1-49`).
