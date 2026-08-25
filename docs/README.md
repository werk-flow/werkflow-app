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

| Doc | Read when |
| --- | --- |
| [architecture.md](technical/architecture.md) | You need the runtime shape: Next.js app structure, Supabase access model, auth/org context, caching, Realtime, deployment. |
| [data-model.md](technical/data-model.md) | You need the conceptual domain model (tenant boundary, roles, per-domain concepts). Exact schema: generated types + live inspection. |
| [environments.md](technical/environments.md) | Anything touches Supabase, env files, R2, or a new machine: the two-project model, project IDs, tool-access matrix, migration rule, onboarding. |
| [realtime-and-caching.md](technical/realtime-and-caching.md) | You change cache tags, Realtime subscriptions, or data freshness behavior. |
| [testing.md](technical/testing.md) | You run or extend the Playwright harness: the 13 operational rules, audit battery, failure classes, left-behind-state registry. |
| [test-incident-log.md](technical/test-incident-log.md) | A browser failure consumes a rerun or reveals a reusable lesson: required evidence, classification and the P1-16 retrospective. |
| [coderabbit.md](technical/coderabbit.md) | You run a CodeRabbit review: CLI invocation (WSL path!), config, per-slice review protocol. |

### Feature specifications (`docs/features/`)

Read the primary spec of the feature you are changing, plus only the connected specs its slice names. Each spec separates **Current Product Baseline** (implemented) from Phase 1/Phase 2 scope.

| Doc | Read when working on |
| --- | --- |
| [customers-and-crm.md](features/customers-and-crm.md) | Kunden, contacts, sites, requests (Anfragen), relationship timeline, communication preferences. |
| [jobs-and-projects.md](features/jobs-and-projects.md) | Aufträge, Projekte, checklists, work lifecycle states, templates, dispatch handoffs. |
| [calendar-and-resource-planning.md](features/calendar-and-resource-planning.md) | Kalender, planning occurrences, series, capacity, Parkplatz, dispatch. |
| [employee-management.md](features/employee-management.md) | Mitarbeiter, personnel records, schedules, responsibilities, vacation, sickness, teams/qualifications. |
| [time-tracking.md](features/time-tracking.md) | Zeiterfassung, clock events, breaks, targets, approvals, corrections. |
| [document-management.md](features/document-management.md) | Dokumente, folders, R2 storage, versioning, trash, audit. |
| [inventory.md](features/inventory.md) | Lager/Inventar, catalog, locations, stock movements, job material. |
| [service-and-maintenance.md](features/service-and-maintenance.md) | Future service module: installed equipment, reactive service, maintenance plans (nothing implemented yet). |
| [commercial-and-finance.md](features/commercial-and-finance.md) | Future commercial loop: offers, invoices, payments, accounting handoffs (nothing implemented yet). |
| [ai-automations.md](features/ai-automations.md) | Phase 2 AI direction and the Phase 1 enabling foundations. |

### Product (`docs/product/`)

| Doc | Read when |
| --- | --- |
| [product-capability-map.md](product/product-capability-map.md) | You need the product-wide capability/ownership map, shared objects, handoff rules, Phase 1 completion criteria, or decision gates. |
| [user-flow-catalog.md](product/user-flow-catalog.md) | You touch slice acceptance or audit coverage: the exhaustive per-slice German flow list with stable `P1-XX-FNN` IDs. |
| [competitive-landscape.md](product/competitive-landscape.md) | A decision needs competitor context (dated snapshot 2026-07-23; refresh volatile figures first). |
| [offer.md](product/offer.md) | Placeholder — offer/pricing tasks; do not invent details it lacks. |
| [acquisition.md](product/acquisition.md) | Placeholder — acquisition/funnel tasks; do not invent details it lacks. |
| [avatar.md](product/avatar.md) | Placeholder — deeper persona work; `AGENTS.md` holds the current avatar summary. |

### Plans (`docs/plans/`)

Phase 1 execution lives in `phase-1/`, split by change rate:

| Doc | Read when |
| --- | --- |
| [phase-1/roadmap.md](plans/phase-1/roadmap.md) | Any Phase 1 task — the hot entry: current checkpoint, slice index, dependency spine. Always read fully. |
| [phase-1/protocol.md](plans/phase-1/protocol.md) | You start, verify, or accept a slice: authority order, required reading, status model, checklists, invariants, templates, update protocol. |
| [phase-1/gates.md](plans/phase-1/gates.md) | You run or extend a golden gate: `GG-00`–`GG-16` definitions and run-record requirements. |
| [phase-1/coverage.md](plans/phase-1/coverage.md) | You need slice-to-feature routing or the starting-foundation snapshot. |
| [phase-1/log.md](plans/phase-1/log.md) | You need Phase 1 history — append-only progress log. |
| phase-1/slices/ | You need one slice's full acceptance evidence — one record per accepted slice (canonical home). |
| [phase-1-build-roadmap.md](plans/phase-1-build-roadmap.md) | Pointer stub for the pre-split path; do not add content. |
| [golden-gate-log.md](plans/golden-gate-log.md) | You record or check a gate run — append-only run log. |
| [wave-2-audit.md](plans/wave-2-audit.md) | Wave 2 slice acceptance: the per-slice coverage ledger and certification-gate record. |
| [wave-1-audit.md](plans/wave-1-audit.md) | Closed — Wave 1 coverage ledger (retired wave-end model); historical reference only. |
| [uiux-consolidation.md](plans/uiux-consolidation.md) | Closed — the 2026-08 UI/UX consolidation ledger; the durable output is the `werkflow-design` skill. |
| [inventory-v1-implementation-plan.md](plans/inventory-v1-implementation-plan.md) | Closed — Inventory V1 planning record; current behavior lives in the inventory feature spec. |
| [p1-00-baseline-verification.md](plans/p1-00-baseline-verification.md) | Closed — the `P1-00` baseline-verification report. |
| [p1-12-dispatch-implementation-plan.md](plans/p1-12-dispatch-implementation-plan.md) | Closed — `P1-12` confirmed contract and execution ledger (record: `phase-1/slices/p1-12-dispatch.md`). |
| [p1-13-work-templates-implementation-plan.md](plans/p1-13-work-templates-implementation-plan.md) | Closed — `P1-13` confirmed contract, flow list, and ledger (record: `phase-1/slices/p1-13-work-templates.md`). |
| [p1-14-work-lifecycle-implementation-plan.md](plans/p1-14-work-lifecycle-implementation-plan.md) | Closed — `P1-14` confirmed contract and verification record (record: `phase-1/slices/p1-14-work-lifecycle.md`). |
| [p1-15-structured-site-evidence-implementation-plan.md](plans/p1-15-structured-site-evidence-implementation-plan.md) | Closed — `P1-15` owner-confirmed artifact, revision, decision, export, lifecycle and rollout contract. |
| [p1-16-field-work-pack.md](plans/phase-1/slices/p1-16-field-work-pack.md) | Closed — canonical `P1-16` role, projection, field-action, privacy, failure-recovery and acceptance record. |

### Decision records (`docs/decisions/`)

Short ADR-style records: why a durable choice was made. Immutable once accepted; amendments are dated.

| Doc | Decision |
| --- | --- |
| [0001-infrastructure-stack.md](decisions/0001-infrastructure-stack.md) | The settled stack: Supabase, Vercel (fra1), Cloudflare R2 EU, Railway deferred, provider-API AI. |
| [0002-dispatch-revision-acknowledgement-identity.md](decisions/0002-dispatch-revision-acknowledgement-identity.md) | Dispatch revision/acknowledgement identity model (`P1-12`). |
| [0003-dev-prod-environment-split.md](decisions/0003-dev-prod-environment-split.md) | The dev/prod two-project split, migration-history materialization, repair migrations. |
| [0004-documentation-structure.md](decisions/0004-documentation-structure.md) | Why this docs tree looks the way it does: graph discipline over a knowledge graph, and what agent memory may hold. |

## Document Types And Conventions

### Where a new doc goes

- `docs/technical/`: system-level explanations (architecture, data model concepts, Realtime, testing). No column-by-column schema dumps — inspect Supabase and generated types instead.
- `docs/features/`: intended behavior of major feature areas, separating current baseline from Phase 1/Phase 2 scope. The standard spec sections are defined in [product-capability-map.md](product/product-capability-map.md).
- `docs/product/`: business context that should not load into every coding task.
- `docs/plans/`: implementation sequencing. Phase 1 uses the `phase-1/` split; a slice-specific plan file is created when work spans multiple sessions, migrations, or coordinated rollout steps, and is closed (status header) when the slice is accepted.
- `docs/decisions/`: numbered ADRs, concise and dated.

Add a document when it prevents repeated confusion, guides future implementation, or records a meaningful decision — not to mirror code.

### Maintenance rules

1. **Status header**: every doc carries `Status: living — last reviewed YYYY-MM-DD` or `Status: closed (YYYY-MM-DD) — <what it remains useful for>` directly under its H1. Closing a plan is a status change, not a deletion.
2. **One home per fact**: a changeable fact (project IDs, plan tiers, counters, acceptance evidence) lives in exactly one doc; everything else links to it. Skills carry procedure and link to the doc that owns the facts.
3. **Link syntax**: doc-to-doc references inside `docs/` are relative markdown links — target `technical/environments.md` from this index, or `../technical/environments.md` from a feature spec — so they are clickable and checkable. Backtick paths are for code/config files and for references from outside `docs/` (e.g. `AGENTS.md`). Bare IDs ("decision 0002") always appear with a link on first mention in a doc.
4. **This index is exhaustive**: every `docs/**/*.md` file appears in the index above.
5. **Check**: `bun run docs:check` validates index coverage, relative-link resolution, and status headers. Run it after any docs change; it is part of keeping a slice's documentation update honest.

## Removed Legacy Architecture File

The former `docs/SYSTEM_ARCHITECTURE.md` was removed after its durable content was split into smaller docs. Do not recreate a single catch-all architecture document. The former single-file `phase-1-build-roadmap.md` was likewise split into `plans/phase-1/` on 2026-08-24; its path remains as a pointer stub.
