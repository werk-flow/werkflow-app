# Phase 1 Execution Protocol

Status: living — last reviewed 2026-08-27

This file holds the durable process rules for Phase 1. It changes only when the process itself changes, and any such change needs an explicit progress-log entry naming the decision. The hot status and slice index live in [roadmap.md](roadmap.md); gate definitions in [gates.md](gates.md); routing matrices in [coverage.md](coverage.md); history in [log.md](log.md); per-slice acceptance evidence in `slices/`.

The accepted infrastructure stack (database, auth, file storage, deployment, workers, AI hosting) and its sequencing are recorded in [decision 0001 — infrastructure stack](../../decisions/0001-infrastructure-stack.md). Slices that touch file upload/download, retention, background processing, or auth must follow that record.


## Authority And Source Order

When sources disagree, use this order:

1. Current user instruction for the task.
2. `AGENTS.md` for durable product direction and repository-wide rules.
3. Current application behavior, generated Supabase types, and live Supabase inspection for implementation facts.
4. [`product-capability-map.md`](../../product/product-capability-map.md) for product phases, feature ownership, shared objects, and decision gates.
5. The relevant `docs/features/*.md` specifications for intended feature behavior and cross-feature contracts.
6. The roadmap entry ([roadmap.md](roadmap.md)) and the slice records under `slices/` for execution order, prerequisites, status, and verification gates.
7. Slice-specific implementation plans and decision records.
8. Older technical or implementation plans where they have not been superseded by code or live state.

This ordering does not let implementation drift redefine product intent silently. If current code and the intended feature behavior differ, document the gap and obtain the necessary product decision before changing a consequential workflow.

## Required Reading For Phase 1 Tasks

Every Phase 1 implementation agent must read, in order:

1. `AGENTS.md`.
2. The roadmap entry ([roadmap.md](roadmap.md)), especially **Current Checkpoint** and the target slice's index row; the target slice's record and its direct prerequisites' records under `slices/`; and its golden gate in [gates.md](gates.md).
3. [`product-capability-map.md`](../../product/product-capability-map.md), especially the coherent operating loop, shared objects, cross-feature handoff rules, Phase 1 completion criteria, and decision gates.
4. The target slice's primary feature specification.
5. Only the connected feature specifications named by the slice and required to understand its handoffs.
6. Relevant technical documentation, current code paths, generated database types, and live Supabase state.
7. Any slice-specific implementation plan or accepted decision record.

Agents should not load every feature document for every task. The roadmap defines the smallest relevant reading set. When discovery exposes another affected domain, add that document to the slice before implementation.

## Roadmap Vocabulary

| Term | Meaning |
| --- | --- |
| Phase | A major product maturity level. This roadmap covers only Phase 1. |
| Wave | A dependency-oriented group of related slices. A wave is not one implementation task. |
| Vertical slice | One independently useful business outcome delivered through all required layers: domain, permissions, backend, UI, audit, tests, and documentation. |
| Direct prerequisite | A slice whose accepted output is required before another slice may start. Transitive prerequisites also apply. |
| Golden scenario | A multi-slice end-to-end workflow that proves connected capabilities still form one product. |
| Golden gate | The checkpoint at which a named golden scenario must pass before dependent work proceeds. |
| Decision gate | A product, legal, accounting, privacy, integration, or complexity choice that must be resolved explicitly and must not be inferred from competitor behavior. |
| Exit evidence | The observable product behavior, tests, migrations, documentation, and review evidence required to mark a slice complete. |

## What Counts As A Vertical Slice

A valid slice can be stated as:

> `[Role]` can `[complete one business outcome]` from `[starting state]` to `[ending state]`, while preserving `[important boundaries]`.

A slice is not merely a database migration, backend action, UI screen, or collection of components. It must deliver a usable and testable outcome across every required layer.

A proposed slice should normally have:

- one primary business state transition or lifecycle;
- one primary feature owner and a small set of explicit connected owners;
- one or two primary user roles;
- acceptance criteria that can be demonstrated independently;
- a migration and rollback/recovery story when existing data changes;
- no unresolved strategic decision hidden inside implementation;
- an outcome small enough to review without combining unrelated domains.

If discovery shows that a roadmap slice is too large, split it using stable suffixes such as `P1-15a` and `P1-15b`. Update dependencies and golden gates before either child begins. Do not renumber unrelated completed slices.

## Slice Status Model

Use only these status values in the master slice index in [roadmap.md](roadmap.md):

| Status | Meaning |
| --- | --- |
| `planned` | The slice belongs to Phase 1 but one or more prerequisites are not accepted. |
| `ready` | All prerequisites and required decisions are accepted; work may begin. |
| `in_progress` | An identified task/branch owns active implementation. |
| `verification` | Implementation is complete enough for acceptance testing, review, migration checks, and documentation reconciliation. |
| `complete` | Exit evidence is recorded, required golden gates pass, and affected docs reflect current behavior. |
| `decision_blocked` | A named unresolved product/technical/legal decision prevents safe progress. |
| `superseded` | The outcome moved to replacement slice IDs with an explanation; it was not silently dropped. |

Ordinary unsatisfied dependencies are `planned`, not `decision_blocked`. A slice may move to `ready` only after every direct prerequisite is `complete` and every required earlier golden gate passes.

## Practical Execution Cautions

These are deliberate warnings for future agents and the product owner, recorded 2026-08-04. They temper how the roadmap is applied; they do not change its ordering or acceptance rules.

1. **Process-to-progress ratio.** 56 slices with full exit evidence is realistically a multi-year effort for a small team. The discipline exists to prevent an incoherent product, not to become the product. For low-risk slices (no schema migration, no permission change, no money/time/stock semantics), lighter evidence is acceptable — say so explicitly in the slice record instead of silently skipping items. When a slice consistently costs more in ceremony than in implementation, propose splitting or trimming it rather than abandoning the protocol.
2. **Wave 4 is the risk concentration.** Invoices, controlled number ranges, XRechnung/ZUGFeRD profiles, GoBD-adjacent retention claims, and DATEV handoffs cannot be validated from documentation or competitor behavior. Budget for qualified German tax/legal/accounting review **before** accepting `P1-39`–`P1-43`, and treat its absence as a `decision_blocked` condition, not a footnote.
3. **Golden-gate rerun cost compounds.** By Wave 3 and later, "rerun all materially affected earlier gates" grows expensive. Sampled or partially automated reruns are acceptable when the gate log records what was rerun, what was skipped, and why. An unrecorded skip is the only wrong option.

## External Resources And Cost Gates

Recorded 2026-08-23 so external dependencies never surprise a wave mid-flight. Baseline running costs today: Supabase Pro org (~$35/month with both projects on Micro), Cloudflare R2 (within the free tier for years at current volumes), Resend (free tier; invite/auth mail volume is tiny), Vercel. Per wave:

- **Wave 2 (`P1-13`–`P1-24`): deliberately zero new external resources.** Every slice is internal product depth. Two look-alikes that are NOT external here: `P1-15` "signatures" means captured signature evidence (drawn/uploaded, versioned) — qualified electronic signature providers are an explicit later decision gate, never an implied dependency; `P1-23` "payroll-ready export" means versioned export FILES an accountant/payroll tool can consume — no DATEV or payroll API connection (that is `P1-43` file handoff and `P1-50` connectors).
- **Wave 3:** first real external touchpoints, still file-first and free of per-use fees: `P1-25` imports wholesaler catalog/price data (DATANORM files require the customer's own wholesaler accounts — an onboarding prerequisite, not a WerkFlow cost); `P1-34` scopes DATANORM/IDS/UGL/Open Masterdata/SHK Connect acceptance (open trade standards; live wholesaler API access again rides customer accounts). Budget acquisition effort for test fixtures/sample files, not money.
- **Wave 4:** `P1-40` XRechnung/ZUGFeRD validation (open validators, e.g. the KoSIT tooling — free, but plan validation fixtures); `P1-42` bank data via file import (CSV/camt) by default — live bank aggregation APIs (finAPI-class, real monthly cost) are a decision gate, not assumed; `P1-43` stays accountant-ready file export.
- **Wave 5:** the paid-service concentration. `P1-44` OCR/thumbnails is the first Railway worker (decision 0001; Railway ~$5+/month plus compute, OCR itself open-source first); `P1-46` outbound messaging means real Resend volume (likely a paid tier, ~$20/month class) and SMS only via a paid provider — SMS is a decision gate with per-message cost; `P1-49` mobile app means Apple/Google developer accounts ($99/year + $25 once); `P1-50` connectors (DATEV, calendars, wholesalers) each carry their own account/partner-access decision.
- **Wave 6:** nothing new.

Rule: a slice that would introduce an external account, API, or per-use cost not listed here is `decision_blocked` until the owner approves the resource explicitly.

## Mandatory Execution Protocol

### Before Starting A Slice

1. Verify the slice is `ready`; do not work around an incomplete prerequisite by creating duplicate domain concepts.
2. Set the slice to `in_progress` and update **Current Checkpoint** in [roadmap.md](roadmap.md) with the task/branch owner and date. Create the slice's record file under `slices/` from the index row; pinned notes travel with the row into the record.
3. Read the required sources listed above.
4. Inspect current code, generated types, migrations, RLS, Realtime/cache behavior, and live Supabase state where relevant.
5. Restate the bounded outcome, non-goals, affected roles, direct dependencies, and acceptance criteria.
5a. **Propose the slice's complete user-flow list** (since Wave 2, per the per-slice audit model): draft the slice's catalog bullets as German flows with provisional `P1-XX-FNN` IDs and include them in the pre-implementation report, so the owner confirms product behavior and the flow inventory in one gate. Flows discovered during implementation are added; the catalog is finalized at acceptance.
6. Identify unresolved decisions. Resolve them with the owner using the `grilling` skill's frontier method (numbered questions with recommended answers, in rounds). Move the slice to `decision_blocked` if a decision would materially change ownership, data migration, permissions, legal/commercial behavior, or downstream contracts.
7. Create a slice-specific implementation plan under `docs/plans/` when the work spans multiple sessions, schema migrations, or several coordinated rollout steps.

### During Implementation

- Preserve organization isolation and role-specific behavior.
- Extend the owning domain instead of creating a parallel copy in another feature.
- Keep planned, actual, approved, issued, paid, and exported states distinct.
- Make consequential actions explicit, previewable, attributable, and correctable.
- Use backward-compatible migrations and preserve historical meaning.
- Make failures and partial external states visible with a recovery path.
- Add focused tests at the domain boundary and end-to-end tests for the slice outcome. Concretely: extend the golden-gate harness (`docs/technical/testing.md`) — add the slice's business actions to `tests/golden/support/steps.ts` and cover the slice outcome in the gate spec named by its slice index row (or a dedicated spec if no gate is due yet). A slice without an automated end-to-end check of its own outcome is not done.
- Use the browser runner's iteration lane while implementation changes. Every new Golden slice spec ships stage-split: separate greppable stage tests at stable persisted boundaries per the testing conventions (`docs/technical/testing.md`), each later stage verifying its persisted precondition; one monolithic slice test is a review flag. Failed worlds are retained for focused diagnosis; diagnostic reuse is never substituted for the final clean-world certification.
- **Ship the slice's audit coverage with the slice** (since Wave 2): a spec in `tests/audit/wave-N/` that maps every one of the slice's catalog flow IDs with full clause evidence under testing rule 12, plus the ledger rows in the wave's audit doc (`docs/plans/wave-2-audit.md` for Wave 2). Golden gates stay lean cross-slice scenarios; the audit spec is where exhaustive flow coverage lives. The wave-end audit is a thin certification gate, not a discovery phase — discovery already happened here.
- Keep field-worker paths simpler than office paths and use natural German for user-facing language.
- Record a decision in `docs/decisions/` when future agents must understand why a durable choice was made.

### Before Marking A Slice Complete

The slice is not complete until all applicable items are satisfied:

- the user outcome works across frontend, backend, permissions, and persistence;
- existing flows remain compatible or have an explicit migration;
- live schema and generated types agree;
- RLS and organization-boundary tests cover the new records/actions;
- Realtime, caching, retry, idempotency, and failure recovery were tested where applicable;
- accessibility, responsive behavior, German UI language, and role visibility were reviewed;
- the slice's focused acceptance criteria pass;
- every golden scenario named in the slice row passes;
- the primary feature doc moves implemented behavior into **Current Product Baseline**;
- [`docs/product/user-flow-catalog.md`](../../product/user-flow-catalog.md) gains the slice's complete list of new user-visible flows in German with stable `P1-XX-FNN` IDs (every new action any role can take and what the app does in response — not just the golden-gate flows);
- (since Wave 2) the slice's audit spec in `tests/audit/wave-N/` maps **all** of those flow IDs with full clause evidence per testing rule 12, its ledger rows in the wave's audit doc are closed with the `X/X mapped; X/X fully evidenced; 0 partial; 0 unmapped` invariant, and the focused audit spec ran green in the acceptance ladder; every new bullet receives a stable flow ID, existing IDs are never reused, and a material wording change reopens that ID's audit mapping under testing rule 12;
- connected feature contracts and open decisions are updated;
- conceptual data-model and technical docs are updated if ownership or architecture changed;
- the slice's acceptance is recorded in its owning files: the slice record under `slices/` closes with the full acceptance evidence, completion date, follow-up work, and any split/superseding slices (the record is the canonical home for the slice's facts); [roadmap.md](roadmap.md) updates the index-row status, the checkpoint table, the accepted counter, and the recomputed `ready` set; [log.md](log.md) gains one short appended entry linking the record;
- appropriate lint, type, test, and build validation passes — including the slice's focused runner command against the fresh production build, followed by the required certification batteries **against the local stack** plus a green cloud canary run (decision [0006](../../decisions/0006-testing-architecture.md); the full battery runs against the cloud only at wave-end gates and owner-named partner milestones), with the runs recorded in `docs/plans/golden-gate-log.md`;
- every failed certification is classified in [`../../technical/test-incident-log.md`](../../technical/test-incident-log.md), proven with a focused run on the current source before retry, and cleaned after diagnosis; two consecutive full failures of the same class require investigation and an explicit rerun-budget reason;
- a separate review finds no unresolved correctness, security, data-loss, or documentation issue.

## Cross-Cutting Invariants

Every slice must preserve these rules even when they are not repeated in its row:

1. **One source of truth:** features reference shared customer, site, job, employee, document, item, supplier, or commercial identities rather than copying them.
2. **Organization scope:** all data and actions remain organization-bound.
3. **Role clarity:** `admin`, `buero`, and `employee` behavior differs intentionally; sensitive personnel, cost, customer, and financial data is purpose-limited.
4. **Historical meaning:** effective-dated rules, issued records, approvals, movements, and completed work are corrected through traceable changes rather than silent rewrites.
5. **No implied downstream action:** schedule changes do not create time, stock movements, messages, orders, or invoices unless an explicit reviewed workflow does so.
6. **Draft before obligation:** customer, supplier, payment, accounting, signature, and high-impact scheduling actions have preview and approval appropriate to their consequence.
7. **Offline honesty:** every offline claim names available data, queued actions, conflicts, last synchronization, failure, and recovery.
8. **Integration honesty:** every connector names system ownership, direction, supported version/object, credentials, retry, deduplication, revocation, and fallback.
9. **Employee privacy:** absence detail, personnel documents, compensation/costing, location, and performance data are minimized and separately authorized.
10. **No compliance invention:** German employment, tax, accounting, signature, archive, SHK-standard, or safety claims require current qualified validation.
11. **Progressive depth:** common workflows work with clear defaults; exceptional and expert controls remain discoverable without overwhelming field users.
12. **AI readiness without Phase 2 behavior:** Phase 1 creates reliable events, actions, sources, approvals, and auditability but does not authorize assistants, workflow builders, or agents.

## Decisions That Must Not Be Smuggled Into A Slice

The following choices require an explicit decision record, product-owner confirmation, qualified validation, or a separate scoped plan before implementation commits WerkFlow to them:

- customer/contact/site ownership, project/job site inheritance, and historical snapshot semantics (`P1-01`);
- request lifecycle and direct-work exceptions (`P1-02`);
- employee identity versus login/membership and effective-dated employment history (`P1-03`);
- custom roles versus fixed roles plus scoped responsibilities (`P1-05`);
- vacation entitlement, illness evidence, public holidays, compliance warnings, overtime, supplements, and payroll mappings (`P1-06`, `P1-08`, `P1-23`);
- customer consent/legal basis and automatic communication (`P1-10`, `P1-46`);
- project/job status vocabulary, completion gates, signature level, measurement standards, and customer evidence (`P1-14`, `P1-15`, `P1-17`);
- maintenance generation horizon, contract boundary, checklist requirements, and technical compliance (`P1-18`–`P1-20`);
- negative stock, reservation policy, valuation method, vehicle model, procurement approvals, tools versus assets, and supported wholesale partners/versions (`P1-25`–`P1-34`);
- commercial calculation defaults, offer acceptance evidence, invoice types, special German tax/construction cases, number ranges, XRechnung/ZUGFeRD profiles, Peppol, bank connectivity, and dunning policy (`P1-35`–`P1-43`);
- document retention, legal hold, sharing, signature, archive/GoBD claims, and sensitive access (`P1-44`, `P1-45`);
- external calendar ownership, connector vendors, sync direction, private events, credential ownership, and support boundaries (`P1-50`);
- native double-entry accounting, native payroll, tax filing, generic sales CRM, customer portal, IoT/telemetry, embedded payments, and unrestricted automation. These remain outside automatic Phase 1 scope unless separately approved.

## Parallel Work Rules

Parallel delivery is allowed only when it reduces risk rather than creating competing foundations.

- After `P1-00`, `P1-01`, `P1-03`, and the infrastructure slice `P1-00a` may proceed in parallel because customer identity, employment identity, and the storage layer are separate domains.
- A dependent slice cannot begin merely because its prerequisite is “mostly done”; the prerequisite must be accepted or the child must explicitly narrow its dependency.
- Two slices must not independently introduce shared task, approval, notification, communication, audit, identity, or permission primitives.
- Two branches modifying the same schema ownership boundary require an agreed migration sequence and integration owner.
- Golden gates touching both parallel branches run only after integration, not independently against incompatible branch states.
- If a parallel slice discovers a new prerequisite, update the slice index in [roadmap.md](roadmap.md) and return the slice to `planned` or `decision_blocked`; do not implement a local substitute.

## Slice Brief Template

Create or use a slice-specific plan with this minimum structure when more detail is needed:

```md
# P1-XX — Slice Name

## Bounded Outcome

## Primary User And Roles

## Verified Current Baseline

## Direct Prerequisites And Evidence

## Primary And Connected Feature Contracts

## In Scope

## Explicit Non-Goals

## Product Decisions Required Before Coding

## Data Ownership And Historical Semantics

## Permissions And Organization Isolation

## UI And Field-Worker Behavior

## Realtime, Caching, Offline, And Failure Recovery

## Migration And Rollback

## User Flows (Catalog IDs)

## Acceptance Criteria

## Automated And Manual Verification

## Documentation Updates

## Completion Evidence
```

## Standard New-Task Prompt

Use this as a starting point; replace the placeholders with the actual slice row. Draft and revise any task prompt for another agent with the `writing-for-agents` and `unslop` skills loaded.

> Implement Phase 1 vertical slice `[P1-XX — name]`.
>
> Read `AGENTS.md`, `docs/plans/phase-1/roadmap.md`, `docs/plans/phase-1/protocol.md`, the target slice's record under `docs/plans/phase-1/slices/` (if it exists yet), the relevant sections of `docs/product/product-capability-map.md`, the primary feature specification, and the connected specifications named by the slice index row. Inspect current code, generated Supabase types, migrations, RLS, Realtime/cache behavior, and live Supabase state before making implementation claims.
>
> First verify that every direct prerequisite is marked complete with evidence and that the required earlier golden gates pass. If a dependency is absent, stop and explain it; do not create a parallel substitute.
>
> Bounded outcome: `[copy the outcome from the slice index row and refine only with confirmed decisions]`.
>
> Before coding, report the verified current behavior, affected ownership boundaries, proposed state transitions, permissions, migration/backward-compatibility behavior, failure recovery, acceptance criteria, non-goals, unresolved decisions, **and the slice's proposed user-flow list** (German catalog bullets with provisional `P1-XX-FNN` IDs). Ask for confirmation when a decision would materially change product behavior.
>
> After approval, implement the complete slice across data, authorization, backend, UI, audit, tests, and documentation. Preserve existing flows unless the accepted plan migrates them. Update the slice record and index-row status/evidence, primary feature baseline, connected contracts, conceptual data model, technical docs, and the user-flow catalog as applicable. Run the slice's focused tests, the required golden gate, the slice's rule-12 audit spec, and the repository's normal validation.

## Roadmap Update Protocol

Status changes touch the files that own them: the index row and checkpoint in [roadmap.md](roadmap.md), the slice record under `slices/`, and one appended entry in [log.md](log.md). [protocol.md](protocol.md) itself, [gates.md](gates.md), and [coverage.md](coverage.md) change only when their content actually changes — a slice acceptance that edits the protocol without a named process decision is a review flag.

### When A Slice Starts

- Change its status from `ready` to `in_progress` in the index.
- Create the slice's record file under `slices/` from the index row; pinned notes travel with the row.
- Update **Current Checkpoint** with slice ID, task/branch owner, start date, and expected golden gate.
- Append a progress-log entry in [log.md](log.md).
- Link a slice-specific implementation plan if one exists.

### When A Slice Is Blocked

- Use `decision_blocked` only for a named unresolved decision or external dependency that prevents safe work.
- Record the exact question, affected slice IDs, decision owner, and safe work that may continue.
- Do not leave partial competing domain models in place as a workaround.

### When A Slice Enters Verification

- Change status to `verification`.
- Record migration identifiers, test commands/results, manual acceptance evidence, and known limitations in the slice record.
- Update feature docs provisionally but do not describe unaccepted behavior as complete.
- Run the required golden gate and all earlier gates materially affected by the change.

### When A Slice Completes

- Close the slice record with the full acceptance evidence and completion date — the record is the canonical home; other docs link it instead of restating it.
- Change the index-row status to `complete`, and bump the accepted counter in the status blockquote.
- Append a short completion entry in [log.md](log.md) that links the slice record.
- Move delivered behavior into the primary and connected feature baselines.
- Remove or refine planned bullets and open decisions that were resolved.
- Update data-model, architecture, security, Realtime/cache, integration, and operational docs when affected.
- Recompute which planned slices are now `ready`.
- Update **Current Checkpoint** to the next eligible slice or decision.
- Never mark a slice complete solely because code was written or a build passed.

### When Scope Changes

- Keep the original outcome visible.
- Split using suffixes or mark `superseded` with replacement IDs and rationale.
- Update direct and transitive dependencies, feature coverage, golden gates, and prompts.
- Use a decision record for durable ownership or strategic changes.
- Do not renumber completed slices merely to make the list look tidy.

## Phase 1 Acceptance Rules

Phase 1 is complete only when all of the following are true:

1. Every non-superseded roadmap slice is `complete`, or an explicit accepted decision record removes it from Phase 1 without leaving its promised workflow broken.
2. `GG-00` through `GG-16` pass on the Phase 1 release candidate.
3. The capability map's operational, commercial, material, people/planning, and trust/adoption completion criteria are satisfied.
4. Current feature baselines match actual behavior and no planned capability is described as implemented prematurely.
5. Major data can be migrated in, searched, corrected, audited, exported, and recovered.
6. Role and organization boundaries are verified across web, mobile/offline, and integrations.
7. Customer, supplier, employee, financial, schedule, stock, and external actions have understandable failure and recovery paths.
8. The complete product works with practical SHK defaults and does not require extensive configuration to perform the golden workflows.
9. Training, onboarding, support, packaging, integration entitlement, and data-exit expectations are explainable.
10. Phase 2 work begins from an accepted inventory of reliable events/actions/sources rather than bypassing incomplete Phase 1 domains.
