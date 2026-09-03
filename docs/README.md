# WerkFlow Docs

Status: living — the docs index; update it in the same change that adds, moves, or retires a doc (`bun run docs:check` fails otherwise)

This folder is the deeper reference library for WerkFlow: durable product and technical explanations that are too detailed for `AGENTS.md`, but important enough that future agents and developers should not rediscover them from scratch.

## Source Of Truth

- Product direction and user context: `AGENTS.md`.
- Always-applied agent guidance: the "Always-On Repository Rules" section of `AGENTS.md` and the skills in `.claude/skills/` (mirrored in `.agents/skills/`).
- Exact database state: live Supabase inspection through the MCP/plugin workflow.
- Generated database types: `lib/supabase/database.types.ts`.
- Current implementation behavior: the application code.

Do not treat docs as a manual copy of every table, route, component, or enum. Prefer conceptual explanations, decisions, invariants, and feature behavior that should remain useful for months.

## Index

Every doc carries a `Status:` header under its title (`living` with a last-reviewed date, or `closed` with the closure date) so agents can skip dead weight. Load a doc only when the "read when" condition applies — this index is the routing layer.

### Technical (`docs/technical/`)

| Doc                                                                      | Read when                                                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [architecture.md](technical/architecture.md)                             | You need the runtime shape: Next.js app structure, Supabase access model, auth/org context, caching, Realtime, deployment.                       |
| [data-model.md](technical/data-model.md)                                 | You need the conceptual domain model (tenant boundary, roles, per-domain concepts). Exact schema: generated types + live inspection.             |
| [environments.md](technical/environments.md)                             | Anything touches Supabase, env files, R2, or a new machine: the two-project model, project IDs, tool-access matrix, migration rule, onboarding.  |
| [realtime-and-caching.md](technical/realtime-and-caching.md)             | You change cache tags, Realtime subscriptions, or data freshness behavior.                                                                       |
| [document-storage-and-access.md](technical/document-storage-and-access.md) | You touch document bytes, signed URLs, storage paths, document RLS, categories, audit vocabulary, or the storage maintenance helpers: the implementation reference behind the document-management spec. |
| [testing.md](technical/testing.md)                                       | You run or extend the Playwright harness: lanes and targets, the operational rules, audit battery, failure classes, left-behind-state registry.                  |
| [test-incident-log.md](technical/test-incident-log.md)                   | A browser failure consumes a rerun or reveals a reusable lesson: required evidence, classification and the P1-16 retrospective.                  |
| [enforcement-ladder-backlog.md](technical/enforcement-ladder-backlog.md) | You fix a diagnosed defect, keep a review finding, or plan the consolidation phase: the open Tier 1/2 conversion candidates under decision 0005. |
| [coderabbit.md](technical/coderabbit.md)                                 | You run a CodeRabbit review: CLI invocation (WSL path!), config, per-slice review protocol.                                                      |

### Feature specifications (`docs/features/`)

Read the primary spec of the feature you are changing, plus only the connected specs its slice names. Each spec separates **Current Product Baseline** (implemented) from Phase 1/Phase 2 scope.

| Doc                                                                             | Read when working on                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [customers-and-crm.md](features/customers-and-crm.md)                           | Kunden, contacts, sites, requests (Anfragen), relationship timeline, communication preferences.            |
| [jobs-and-projects.md](features/jobs-and-projects.md)                           | Aufträge, Projekte, checklists, work lifecycle states, templates, dispatch handoffs.                       |
| [calendar-and-resource-planning.md](features/calendar-and-resource-planning.md) | Kalender, planning occurrences, series, capacity, Parkplatz, dispatch.                                     |
| [employee-management.md](features/employee-management.md)                       | Mitarbeiter, personnel records, schedules, responsibilities, vacation, sickness, teams/qualifications.     |
| [time-tracking.md](features/time-tracking.md)                                   | Zeiterfassung, clock events, breaks, targets, approvals, corrections.                                      |
| [document-management.md](features/document-management.md)                       | Dokumente, folders, R2 storage, versioning, trash, audit.                                                  |
| [inventory.md](features/inventory.md)                                           | Lager/Inventar, catalog, locations, stock movements, job material.                                         |
| [service-and-maintenance.md](features/service-and-maintenance.md)               | Anlagen, Servicefälle, Wartungspläne and operational coverage (delivered by P1-18 to P1-20), plus planned contract, on-call, and customer-messaging scope. |
| [commercial-and-finance.md](features/commercial-and-finance.md)                 | Future commercial loop: offers, invoices, payments, accounting handoffs (nothing implemented yet).         |
| [ai-automations.md](features/ai-automations.md)                                 | Phase 2 AI direction and the Phase 1 enabling foundations.                                                 |

### Product (`docs/product/`)

| Doc                                                            | Read when                                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [product-capability-map.md](product/product-capability-map.md) | You need the product-wide capability/ownership map, shared objects, handoff rules, Phase 1 completion criteria, or decision gates. |
| [user-flow-catalog.md](product/user-flow-catalog.md)           | You touch slice acceptance or audit coverage: the exhaustive per-slice German flow list with stable `P1-XX-FNN` IDs.               |
| [competitive-landscape.md](product/competitive-landscape.md)   | A decision needs competitor context (dated snapshot 2026-07-23; refresh volatile figures first).                                   |
| [offer.md](product/offer.md)                                   | Placeholder — offer/pricing tasks; do not invent details it lacks.                                                                 |
| [acquisition.md](product/acquisition.md)                       | Placeholder — acquisition/funnel tasks; do not invent details it lacks.                                                            |
| [avatar.md](product/avatar.md)                                 | Placeholder — deeper persona work; `AGENTS.md` holds the current avatar summary.                                                   |

### Plans (`docs/plans/`)

Phase 1 execution lives in `phase-1/`, split by change rate: the entry files plus `slices/`, which holds exactly one document per slice (its plan while in progress, its acceptance record once accepted; covered by the folder row below). Rows without a status prefix are living:

| Doc                                                                                                                  | Read when                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [phase-1/roadmap.md](plans/phase-1/roadmap.md)                                                                       | Any Phase 1 task — the hot entry: current checkpoint, slice index, dependency spine. Always read fully.                                                            |
| [phase-1/protocol.md](plans/phase-1/protocol.md)                                                                     | You start, verify, or accept a slice: authority order, required reading, status model, checklists, invariants, templates, update protocol.                         |
| [phase-1/gates.md](plans/phase-1/gates.md)                                                                           | You run or extend a golden gate: `GG-00`–`GG-16` definitions and run-record requirements.                                                                          |
| [phase-1/coverage.md](plans/phase-1/coverage.md)                                                                     | You need slice-to-feature routing or the starting-foundation snapshot.                                                                                             |
| [phase-1/log.md](plans/phase-1/log.md)                                                                               | You need Phase 1 history — append-only progress log.                                                                                                               |
| phase-1/slices/                                                                                                      | You start, implement, or need the evidence of one slice — exactly one document per slice: its plan while in progress, its acceptance record once accepted.                                                                    |
| [phase-1-build-roadmap.md](plans/phase-1-build-roadmap.md)                                                           | Pointer stub for the pre-split path; do not add content.                                                                                                           |
| [golden-gate-log.md](plans/golden-gate-log.md)                                                                       | You record or check a gate run — append-only run log.                                                                                                              |
| [platform-hardening.md](plans/platform-hardening.md)                                                                 | Closed — historical decisions, implementation ledger, and final evidence for the 2026-08-28 to 2026-08-29 local-stack, Realtime, and browser-test hardening phase. |
| [wave-2-audit.md](plans/wave-2-audit.md)                                                                             | Living — Wave 2 per-slice coverage ledger and certification-gate record; the wave-end certification gate is not yet recorded.                                                                              |
| [wave-1-audit.md](plans/wave-1-audit.md)                                                                             | Closed — Wave 1 coverage ledger (retired wave-end model); historical reference only.                                                                               |
| [uiux-consolidation.md](plans/uiux-consolidation.md)                                                                 | Closed — the 2026-08 UI/UX consolidation ledger; the durable output is the `werkflow-design` skill.                                                                |
| [inventory-v1-implementation-plan.md](plans/inventory-v1-implementation-plan.md)                                     | Closed — Inventory V1 planning record; current behavior lives in the inventory feature spec.                                                                       |

### Decision records (`docs/decisions/`)

Short ADR-style records: why a durable choice was made. Immutable once accepted; amendments are dated.

| Doc                                                                                                                | Decision                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [0001-infrastructure-stack.md](decisions/0001-infrastructure-stack.md)                                             | The settled stack: Supabase, Vercel (fra1), Cloudflare R2 EU, Railway deferred, provider-API AI.                                         |
| [0002-dispatch-revision-acknowledgement-identity.md](decisions/0002-dispatch-revision-acknowledgement-identity.md) | Dispatch revision/acknowledgement identity model (`P1-12`).                                                                              |
| [0003-dev-prod-environment-split.md](decisions/0003-dev-prod-environment-split.md)                                 | The dev/prod two-project split, migration-history materialization, repair migrations.                                                    |
| [0004-documentation-structure.md](decisions/0004-documentation-structure.md)                                       | Why this docs tree looks the way it does: graph discipline over a knowledge graph, and what agent memory may hold.                       |
| [0005-enforcement-ladder.md](decisions/0005-enforcement-ladder.md)                                                 | The enforcement ladder: every learned lesson climbs Tier 1 (unwritable) or Tier 2 (checked) before resting as prose.                     |
| [0006-testing-architecture.md](decisions/0006-testing-architecture.md)                                             | The deterministic/canary split: full batteries run against the local Supabase stack, a nine-test cloud canary proves the live providers. |

## Skills

Skills live in `.claude/skills/` and are mirrored byte-identically in `.agents/skills/` for Codex (`docs:check` enforces the sync; `coderabbit-review` is the recorded `.claude`-only exception because Codex ships its own CodeRabbit skill). Load a skill at the start of the matching task, not after the work is drafted.

| Skill                                | Load when                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unslop`                             | Always, for every piece of prose you produce. The slop-pattern catalog.                                                                                                         |
| `writing-for-agents`                 | You write anything an agent will consume: a skill, a prompt or meta prompt for another agent, `AGENTS.md`/`CLAUDE.md`, or a routing doc. Pair with `unslop`.                    |
| `technical-writing`                  | You write, restructure, or review developer documentation, decision records, plans, PR descriptions, or commit messages. Structure and sentence craft; `unslop` owns the tells. |
| `werkflow-design`                    | Any UI work: components, styling, forms, dialogs, feedback, loading states, colors, dark mode, accessibility. The binding canon and component registry.                         |
| `typescript-best-practices`          | You design types, validation boundaries, or non-trivial logic in `.ts`/`.tsx`.                                                                                                  |
| `diagnosing-bugs`                    | A non-trivial defect or performance regression needs diagnosis. Harness failures classify first via [testing.md](technical/testing.md).                                         |
| `grilling`                           | You resolve open product or design decisions with the owner — including slice pre-implementation report rounds.                                                                 |
| `supabase-live-workflow`             | Any Supabase work: schema, SQL, RLS, storage, edge functions, migrations, generated types.                                                                                      |
| `coderabbit-review` (`.claude` only) | The user asks for a CodeRabbit review or a fix-review cycle.                                                                                                                    |

## Document Types And Conventions

### Where a new doc goes

- `docs/technical/`: system-level explanations (architecture, data model concepts, Realtime, testing). No column-by-column schema dumps — inspect Supabase and generated types instead.
- `docs/features/`: intended behavior of major feature areas, separating current baseline from Phase 1/Phase 2 scope. The standard spec sections are defined in [product-capability-map.md](product/product-capability-map.md).
- `docs/product/`: business context that should not load into every coding task.
- `docs/plans/`: implementation sequencing. Phase 1 uses the `phase-1/` split; every slice has exactly one document under `phase-1/slices/`, which is the plan while the slice is in progress and the acceptance record afterwards. Per-slice files anywhere else are rejected by `docs:check`. Cross-slice plans (wave audits, hardening phases) live at the top of `docs/plans/` and close with a status header.
- `docs/decisions/`: numbered ADRs, concise and dated.

Add a document when it prevents repeated confusion, guides future implementation, or records a meaningful decision — not to mirror code.

### Maintenance rules

1. **Status header**: line 3 of every doc (directly under the H1 and one blank line) is its status line. Living docs use `Status: living — last reviewed YYYY-MM-DD`, optionally followed by `; <clause>`. Closed docs use `Status: closed (YYYY-MM-DD) — <what it remains useful for>`; slice records and implementation plans are closed docs whose date is the acceptance date. Decision records use their metadata bullet block starting with `- **Status:** accepted (YYYY-MM-DD)`. The pre-split roadmap path uses `Status: pointer stub`. Closing a plan is a status change, not a deletion.
2. **One home per fact**: a changeable fact (project IDs, plan tiers, counters, acceptance evidence) lives in exactly one doc; everything else links to it. Skills carry procedure and link to the doc that owns the facts.
3. **Link syntax**: doc-to-doc references inside `docs/` are relative markdown links — target `technical/environments.md` from this index, or `../technical/environments.md` from a feature spec — so they are clickable and checkable. Backtick paths are for code/config files and for references from outside `docs/` (e.g. `AGENTS.md`). Bare IDs ("decision 0002") always appear with a link on first mention in a doc.
4. **This index is exhaustive**: every `docs/**/*.md` file appears in the index above.
5. **Check**: `bun run docs:check` validates index coverage, relative-link resolution, and status headers. Run it after any docs change; it is part of keeping a slice's documentation update honest.

## Removed Legacy Architecture File

The former `docs/SYSTEM_ARCHITECTURE.md` was removed after its durable content was split into smaller docs. Do not recreate a single catch-all architecture document. The former single-file `phase-1-build-roadmap.md` was likewise split into `plans/phase-1/` on 2026-08-24; its path remains as a pointer stub. On 2026-09-03 the eight per-slice implementation-plan files under `docs/plans/` were folded into their slice records and deleted; a slice has exactly one document.
