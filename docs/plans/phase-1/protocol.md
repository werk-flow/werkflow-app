# Phase 1 Execution Protocol

Status: living — last reviewed 2026-09-18

This file holds the durable process rules for Phase 1. It changes only when the process itself changes, and any such change needs an explicit progress-log entry naming the decision. The hot status and slice index live in [roadmap.md](roadmap.md); gate definitions in [gates.md](gates.md); routing matrices in [coverage.md](coverage.md); history in [log.md](log.md); per-slice acceptance evidence in `slices/`.

The accepted infrastructure stack (database, auth, file storage, deployment, workers, AI hosting) and its sequencing are recorded in [decision 0001 — infrastructure stack](../../decisions/0001-infrastructure-stack.md). Slices that touch file upload/download, retention, background processing, or auth must follow that record.


## Authority And Source Order

When sources disagree, use this order:

1. Current user instruction for the task.
2. `AGENTS.md` for durable product direction and repository-wide rules.
3. Current application behavior, generated Supabase types, and live Supabase inspection for implementation facts.
4. [`product-capability-map.md`](../../product/product-capability-map.md) for product phases, feature ownership, shared objects, and decision gates.
5. The relevant `docs/features/*.md` specifications for intended feature behavior and cross-feature contracts.
6. Accepted decision records for the durable choices they govern. Read their dated amendments before applying an older plan.
7. The roadmap entry ([roadmap.md](roadmap.md)) for execution order, prerequisites, current status, and verification gates; the slice records under `slices/` for confirmed scope and dated acceptance evidence.
8. Older technical or implementation plans where they have not been superseded by code or live state.

This ordering does not let implementation drift redefine product intent silently. If current code and the intended feature behavior differ, document the gap and obtain the necessary product decision before changing a consequential workflow.

Testing acceptance follows [decision 0007](../../decisions/0007-independent-test-groups.md) and [testing.md](../../technical/testing.md). They supersede the older full-battery-per-slice and routine full-cloud wave requirements.

Closed slice records preserve the discovery baseline, implementation plan, and evidence from their acceptance date. Their old commands, approval pauses, infrastructure counts, and downstream deferrals describe that work. Use the current checkpoint and living technical docs for a new task; historical publication instructions do not authorize a new commit or push.

## Required Reading For Phase 1 Tasks

Every Phase 1 implementation agent must read, in order:

1. `AGENTS.md`.
2. The roadmap entry ([roadmap.md](roadmap.md)), especially **Current Checkpoint** and the target slice's index row; the target slice's record and its direct prerequisites' records under `slices/`; and its golden gate in [gates.md](gates.md).
3. [`product-capability-map.md`](../../product/product-capability-map.md), especially the coherent operating loop, shared objects, cross-feature handoff rules, Phase 1 completion criteria, and decision gates.
4. The target slice's primary feature specification.
5. Only the connected feature specifications named by the slice and required to understand its handoffs.
6. [Testing.md](../../technical/testing.md), relevant technical documentation, current code paths, generated database types, and live Supabase state.
7. Any accepted decision record the slice names.

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

1. **Process-to-progress ratio.** The full slice set in [roadmap.md](roadmap.md) with full exit evidence is realistically a multi-year effort for a small team. The discipline exists to prevent an incoherent product, not to become the product. For low-risk slices (no schema migration, no permission change, no money/time/stock semantics), lighter evidence is acceptable — say so explicitly in the slice record instead of silently skipping items. When a slice consistently costs more in ceremony than in implementation, propose splitting or trimming it rather than abandoning the protocol.
2. **Wave 4 is the risk concentration.** Invoices, controlled number ranges, XRechnung/ZUGFeRD profiles, GoBD-adjacent retention claims, and DATEV handoffs cannot be validated from documentation or competitor behavior. Budget for qualified German tax/legal/accounting review **before** accepting `P1-39`–`P1-43`, and treat its absence as a `decision_blocked` condition, not a footnote.
3. **Select and qualify independent groups.** Run `bun run test:plan` before expensive verification. The complete change plan controls slice acceptance; release mode controls wave and release acceptance. Retain passing evidence for unchanged group inputs. Diagnose a failed group without restarting unrelated groups.

## External Resources And Cost Gates

Recorded 2026-08-23 to identify external dependencies before a wave starts. The amounts below are planning estimates from that date, not current prices or budget approvals. Current environment configuration lives in [environments.md](../../technical/environments.md). Verify provider terms and obtain the required resource approval when a slice reaches one of these boundaries.

- **Wave 2 (`P1-13`–`P1-24`): deliberately zero new external resources.** Every slice is internal product depth. Two look-alikes that are NOT external here: `P1-15` "signatures" means captured signature evidence (drawn/uploaded, versioned) — qualified electronic signature providers are an explicit later decision gate, never an implied dependency; `P1-23` "payroll-ready export" means versioned export FILES an accountant/payroll tool can consume — no DATEV or payroll API connection (that is `P1-43` file handoff and `P1-50` connectors).
- **Wave 3:** first real external touchpoints, still file-first and free of per-use fees: `P1-25` imports wholesaler catalog/price data (DATANORM files require the customer's own wholesaler accounts — an onboarding prerequisite, not a WerkFlow cost); `P1-34` scopes DATANORM/IDS/UGL/Open Masterdata/SHK Connect acceptance (open trade standards; live wholesaler API access again rides customer accounts). Budget acquisition effort for test fixtures/sample files, not money.
- **Wave 4:** the first Railway worker (owner decision 2026-09-17, [decision 0001 amendment](../../decisions/0001-infrastructure-stack.md)): a Gotenberg container renders offers, invoices and purchase orders to PDF/A-3 from `P1-36` on, and the KoSIT and Mustang validators sit beside it in `P1-40` (Chromium alone is not PDF/A; the reference validator is Java); e-invoice generation stays TypeScript (`@e-invoice-eu/core` under licence review, `@stackforge-eu/factur-x` as the alternative); `P1-42` bank data via file import (camt.053 v08, MT940, per-bank CSV) by default — a live bank connection (finAPI class, from about 100 € per month) is a decision gate, not assumed; `P1-43` stays the DATEV-Format `EXTF` file export, the DATEV Datenservice connector is `P1-50`. The qualified tax and legal review of caution 2 is a service cost: the [expert-review agenda](pre-wave-3/04-wave-3-4-and-phase-2-planning.md#expert-review-agenda-for-wave-4-answer-to-q4) names the items, which Willert Haustechnik's in-house experts and their `Steuerberater` answer before `P1-39` starts.
- **Wave 5:** the paid-service concentration. `P1-44` OCR/thumbnails is the first Railway worker (decision 0001; Railway ~$5+/month plus compute, OCR itself open-source first); `P1-46` outbound messaging means real Resend volume (likely a paid tier, ~$20/month class) and SMS only via a paid provider — SMS is a decision gate with per-message cost; `P1-49` mobile app means Apple/Google developer accounts ($99/year + $25 once); `P1-50` connectors (DATEV, calendars, wholesalers) each carry their own account/partner-access decision.
- **Wave 6:** nothing new.

Rule: a slice that would introduce an external account, API, or per-use cost not listed here is `decision_blocked` until the owner approves the resource explicitly.

## Mandatory Execution Protocol

### Standing Authorizations And The Stop Rule

Owner rule of 2026-09-18, after the beta release. The agent that takes a slice has the owner's go for the whole slice end to end: the research, the plan and report in the record, the implementation, every `bun run review` pass, the DEV migrations, the commit on local `main` and the publication to `partner-preview`. The pre-implementation report is written into the record and read by the owner there; it is not a gate the agent waits at.

The agent stops and asks, with the `grilling` skill's numbered questions and a recommendation each, only for a decision the owner must weigh: a change of ownership, permissions, data migration or money, time or stock semantics; a durable user-facing behaviour that the docs and the code do not settle and that a customer would notice; a new dependency or an external resource (the cost gates above); a raise of a performance budget or a slower measured reference; a catalog clause that would lose its behaviour; or a fork where the evidence does not pick a direction. Everything else is the agent's judgment call, decided, recorded in the slice record with its reasoning, and carried on. A failed gate or verification the agent cannot explain is also a stop. Production is never touched by a slice; releases follow [decision 0008](../../decisions/0008-development-workflow.md).

### Before Starting A Slice

1. Verify the slice is `ready`; do not work around an incomplete prerequisite by creating duplicate domain concepts.
2. Set the slice to `in_progress` and update **Current Checkpoint** in [roadmap.md](roadmap.md) with the task/branch owner and date. Create the slice's record file under `slices/` from the index row; pinned notes travel with the row into the record.
3. Read the required sources listed above.
4. Inspect current code, generated types, migrations, RLS, Realtime/cache behavior, and live Supabase state where relevant.
5. Restate the bounded outcome, non-goals, affected roles, direct dependencies, and acceptance criteria.
   - **Propose the slice's complete user-flow list** (the per-slice audit model): draft the slice's catalog bullets as German flows with provisional `P1-XX-FNN` IDs and include them in the pre-implementation report in the slice record, where the owner reads them. Flows discovered during implementation are added; the catalog is finalized at acceptance.
6. Identify unresolved decisions. Decide the ones that are the agent's under the stop rule above and record them; put the ones that are the owner's to the owner with the `grilling` skill's frontier method (numbered questions with recommended answers, in rounds). Move the slice to `decision_blocked` if a decision would materially change ownership, data migration, permissions, legal/commercial behavior, or downstream contracts.
7. The slice record under `slices/` is the slice's only document. It starts as the plan when the slice enters `in_progress` (bounded outcome, confirmed decisions, execution order, migration and rollout sequence) and closes as the acceptance record. A planning step may write the record earlier, while the slice is `ready`, when its status line says the slice has not started (as `P1-24a` was written in pre-Wave-3 step 3). Never create a separate implementation-plan file or any other per-slice file outside `slices/`; `docs:check` rejects them. Split by scope with suffixes such as `P1-15a` when a slice is too large, never by document.

### During Implementation

- Preserve organization isolation and role-specific behavior.
- Extend the owning domain instead of creating a parallel copy in another feature.
- Keep planned, actual, approved, issued, paid, and exported states distinct.
- Make consequential actions explicit, previewable, attributable, and correctable.
- Use backward-compatible migrations and preserve historical meaning.
- Make failures and partial external states visible with a recovery path.
- Cover every promised clause at the real boundary that can prove it. Use domain units for rules, SQL for database permissions and invariants, component browser checks for controls, and application browser groups for connected outcomes and visible role behavior. A slice still needs an automated browser proof of its own outcome. Reuse shared actions where they remove duplication; do not add every helper to one growing file.
- Use explicit groups during implementation and the complete selected change plan for acceptance. Separate connected journey stages at persisted boundaries. Declare producer prerequisites and verify their actual preconditions. Each independent group owns its world and output files. Retained diagnostics explain failures but do not qualify as fresh acceptance evidence.
- Ship complete catalog coverage with the slice. Update `lib/testing/coverage-map.json` and the owning executable groups in `lib/testing/test-groups.ts`. Record which assertions prove each observable clause and review their meaning. Audit browser specs cover the clauses that require the running app; other clauses can use domain, SQL, or component evidence. Remove duplicate execution only when its coverage remains explicit. The wave ledger records accepted evidence and links its owners.
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
- every Golden outcome named in the slice row has passing evidence in its selected group with all declared producers;
- the primary feature doc moves implemented behavior into **Current Product Baseline**;
- [user-flow-catalog.md](../../product/user-flow-catalog.md) gains the slice's complete list of new user-visible flows in German with stable `P1-XX-FNN` IDs (every new action any role can take and what the app does in response — not just the golden-gate flows);
- the coverage map accounts for every catalog flow and all observable clauses, with current reviewed catalog hashes and executable references; the wave ledger closes with `X/X mapped; X/X fully evidenced; 0 partial; 0 unmapped`; identifiers are never reused, and a material wording change reopens its mapping for assertion review;
- connected feature contracts and open decisions are updated;
- conceptual data-model and technical docs are updated if ownership or architecture changed;
- the slice's acceptance is recorded in its owning files: the slice record under `slices/` closes with the full acceptance evidence, completion date, follow-up work, and any split/superseding slices (the record is the canonical home for the slice's facts); [roadmap.md](roadmap.md) updates the index-row status, the checkpoint table, the accepted counter, and the recomputed `ready` set; [log.md](log.md) gains one short appended entry linking the record;
- the complete selected local change plan passes on qualified inputs, including affected browser groups on a recorded production build; provider changes also receive the applicable cloud canary evidence; the slice record and [gate log](audits/golden-gate-log.md) identify the verification report, selected scope, reused results, and fresh runs;
- failures have evidence and classification in [test-incident-log.md](../../technical/test-incident-log.md); unresolved selected groups block acceptance, unchanged failed inputs cannot be retried as a substitute for diagnosis, and retained ownership is resolved before release closure;
- the deletion pass and the independent review below are recorded in the slice record, and the review leaves no unresolved correctness, security, data-loss, or documentation issue.

### Deletion Pass And Independent Review

Recorded 2026-09-14 ([pre-Wave-3 step 2](pre-wave-3/02-code-quality-regression-proofing.md)). Both happen after the slice's selected groups pass and before the slice record closes. The judgment inside them is Tier 3 by nature; the record and the gates behind it are Tier 2.

1. **Deletion pass, by the session that implemented the slice.** Walk the diff once more, file by file (`git diff --stat HEAD` plus untracked files). For every added file, export, function, branch, state variable, effect, wrapper, and dependency, ask whether the outcome survives without it. Delete what does not earn its place; fold a helper with one caller back into that caller; replace a copy with an import of the one home. Then run `bun run test:plan`: `static:unused` (knip) fails on a dead file, export, or dependency, `static:typecheck` on an unused local or parameter, `static:lint` on a product module over its line cap or a suppression without a reason, and `unit:all` on a helper name declared in two files or a `key` built from a collection. Record the pass in the slice record under `## Deletion Pass And Review`: the `git diff --shortstat` line before and after the pass, and what the pass removed.
2. **Independent review, by a different session.** A fresh context that did not write the code reads the diff against the bounded outcome and the coding standards in `AGENTS.md`, then runs `bun run review` on the slice's diff (`--uncommitted` while the slice is unpublished, `--base-commit <sha>` after an intermediate commit). When the diff exceeds CodeRabbit's file limit, review it in directory passes (`--dir app`, `--dir components`, `--dir lib`) and name the directories the review did not cover. Every finding gets a disposition row in the same section: repaired, declined with the reason, or deferred with its owner. The six rows of the [Step 3 record](hardening-2026-09/07-step-3-final-beta-acceptance.md#closing-account) are the model. A kept finding names the tier its prevention landed on ([decision 0005](../../decisions/0005-enforcement-ladder.md)).

`docs:check` rejects a slice record closed on or after 2026-09-15 that lacks the section, the two shortstat lines, or the review command (check 13 in `scripts/check-docs.ts`).

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

The slice record uses this minimum structure. Sections fill in as the slice moves from plan to acceptance; empty sections stay as headings until they have content:

```md
# P1-XX — Slice Name

Status: living — last reviewed YYYY-MM-DD; in-progress slice plan

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

## Clause Coverage And Executable Groups

## Automated And Manual Verification

## Documentation Updates

## Durable Homes

## Deletion Pass And Review

## Completion Evidence
```

## Slice Handoff: The Meta Prompt

Owner decision of 2026-09-18, replacing the standard new-task prompt of 2026-08-04 and the Wave 2 meta prompt. The cycle: the session that closes a slice writes the implementation prompt for the next one, the owner hands that prompt to a fresh session, and that session researches, plans, implements, reviews, tests and closes the slice, then writes the next prompt. The owner pastes the text below into the closing session. Both prompts are written with the `writing-for-agents` and `unslop` skills loaded. The implementation prompt is the only thing the next agent receives besides the repository, so everything durable it needs lives in the docs, and the prompt points at them.

> Your slice is closed. Write the implementation prompt for the next slice, for a fresh agent with zero context, as one copy-pasteable block.
>
> Before drafting, load `writing-for-agents` and `unslop`. Confirm your own closure against "Before Marking A Slice Complete" and "When A Slice Completes" in `docs/plans/phase-1/protocol.md`: the deletion pass and the independent review recorded, the durable homes named, the catalog and coverage map closed, the commit on local `main`, the publication to `partner-preview` verified with `git ls-remote`, `bun run docs:check` green. Finish anything missing first. Never draft on an unclosed slice.
>
> Pick the target from the roadmap's checkpoint and its ready set, not from memory. If the choice is ambiguous, ask the owner before drafting.
>
> Verify every fact the prompt states in this session: the target's index row, its record if one exists, its prerequisites' records, the primary and connected specs, the code and the live DEV state it will touch, the cost gates and the smuggle list in the protocol. State nothing you did not look at today. Where the next agent can look a value up (a command, a count, a hash, a line number), point at the source instead of copying the value; a copied value goes stale and has to be re-verified anyway.
>
> The prompt has these parts, in this order, and nothing else:
>
> 1. Target. The slice ID, the bounded outcome quoted from the index row, where the record is and what it already holds, and why this slice is next.
> 2. Starting position. The checks the agent runs before touching anything (clean tree, local HEAD equal to `origin/partner-preview`, the checkpoint row, `bun run test:plan` free of unresolved failures, `bun run docs:check` green), written as checks, not as values to compare. The reading list, routed through `docs/README.md`, limited to what this slice needs. The parallel-work rule: every other ready slice and what it owns.
> 3. Standing authorizations and the stop rule. Quote the protocol's "Standing Authorizations And The Stop Rule" in the slice's terms: what the agent may do without asking (everything, including reviews, DEV migrations if the slice has a schema, commits and the push to `partner-preview`), the kinds of decision that stop it, and any slice-specific stop you know of.
> 4. Independent research first. The plan is a floor, not a ceiling: the agent verifies the record's baseline against the code at its HEAD, looks at the product in the browser itself, researches the domain and the market where the record's research is thin, and writes what the plan missed or got wrong into the record before it starts. A sound plan is confirmed as sound in one sentence with the evidence; nothing is added to prove the agent looked. Then the pre-implementation report goes into the record per "Before Starting A Slice" step 5, the owner questions, if any, are posted, and the agent proceeds.
> 5. The five standards as the definition of done. Point at `docs/technical/standards-audit.md` and state, per standard, the two or three things that matter for this slice: which registered primitives, which measured scenarios and freshness rules, which control-map rows, which groups and contracts, which caps and helpers. Name first-frame feedback for every mutation explicitly, and that fewer lines reaching the same outcome win.
> 6. Implementation and closure. Pointers only: `AGENTS.md`, the protocol's checklists and update protocol, `docs/technical/testing.md` for the plan and the acceptance scope, `docs/technical/coderabbit.md` for the review, the deletion pass and independent review, the durable-homes rule, the commit trailer, the publication command. A restatement drifts; do not restate.
> 7. Traps. What the naive version and the overcorrected version of this slice get wrong, only where a real tension exists; otherwise one sentence saying there is none.
> 8. Handoff. When the slice is closed and published, the agent runs this meta prompt for the next slice.
>
> Rules for the text: short imperative sentences, concrete paths, no unexplained shorthand, no process content copied from an older prompt, nothing the docs already say, nothing the next agent can look up. It must work for a less capable model. Under 200 lines; every line pays for itself or goes.
>
> Before the prompt, tell the owner in a few lines which slice you targeted and why, what you verified, and what you changed about the shape above and why.

## Roadmap Update Protocol

Status changes touch the files that own them: the index row and checkpoint in [roadmap.md](roadmap.md), the slice record under `slices/`, and one appended entry in [log.md](log.md). This file, [gates.md](gates.md), and [coverage.md](coverage.md) change only when their content actually changes — a slice acceptance that edits the protocol without a named process decision is a review flag.

### When A Slice Starts

- Change its status from `ready` to `in_progress` in the index.
- Create the slice's record file under `slices/` from the index row; pinned notes travel with the row.
- Update **Current Checkpoint** with slice ID, task/branch owner, start date, and expected golden gate.
- Append a progress-log entry in [log.md](log.md).

### When A Slice Is Blocked

- Use `decision_blocked` only for a named unresolved decision or external dependency that prevents safe work.
- Record the exact question, affected slice IDs, decision owner, and safe work that may continue.
- Do not leave partial competing domain models in place as a workaround.

### When A Slice Enters Verification

- Change status to `verification`.
- Record migration identifiers, test commands/results, manual acceptance evidence, and known limitations in the slice record.
- Update feature docs provisionally but do not describe unaccepted behavior as complete.
- Run the complete selected change plan, including required Golden outcomes and their producers. Use the release plan plus cloud canary at wave end, beta handoff, or production release.

### When A Slice Completes

- Close the slice record with the full acceptance evidence and completion date — the record is the canonical home of the evidence and the reasoning; other docs link it for those.
- Move every lasting fact out of the record before it closes (owner rule 2026-09-17, [README maintenance rule 6](../../README.md#maintenance-rules)): deferred items, open decisions, constraints, research findings and follow-ups go to the owning spec, the technical doc, the backlog or the roadmap, stated in full there, and the record's `## Durable homes` section lists the destinations. A closed record is never the only home of something a later slice needs; `docs:check` check 14 refuses to close one without the section.
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
2. The complete local release plan and cloud canary pass on qualified release inputs, including `GG-00` through `GG-16` in their integrated business journeys.
3. The capability map's operational, commercial, material, people/planning, and trust/adoption completion criteria are satisfied.
4. Current feature baselines match actual behavior and no planned capability is described as implemented prematurely.
5. Major data can be migrated in, searched, corrected, audited, exported, and recovered.
6. Role and organization boundaries are verified across web, mobile/offline, and integrations.
7. Customer, supplier, employee, financial, schedule, stock, and external actions have understandable failure and recovery paths.
8. The complete product works with practical SHK defaults and does not require extensive configuration to perform the golden workflows.
9. Training, onboarding, support, packaging, integration entitlement, and data-exit expectations are explainable.
10. Phase 2 work begins from an accepted inventory of reliable events/actions/sources rather than bypassing incomplete Phase 1 domains.
