# WerkFlow Docs

This folder is the deeper reference library for WerkFlow. It is for durable product and technical explanations that are too detailed for `AGENTS.md` or `.cursor/rules/`, but important enough that future agents and developers should not rediscover them from scratch.

## Source Of Truth

- Product direction and user context: `AGENTS.md`.
- Always-applied agent guidance: `.cursor/rules/*.mdc`.
- Exact database state: live Supabase inspection through the MCP/plugin workflow.
- Generated database types: `lib/supabase/database.types.ts`.
- Current implementation behavior: the application code.

Do not treat docs as a manual copy of every table, route, component, or enum. Prefer conceptual explanations, decisions, invariants, and feature behavior that should remain useful for months.

## Folder Structure

```text
docs/
  README.md
  technical/
    architecture.md
    coderabbit.md
    data-model.md
    realtime-and-caching.md
    testing.md
  features/
    ai-automations.md
    calendar-and-resource-planning.md
    commercial-and-finance.md
    customers-and-crm.md
    document-management.md
    employee-management.md
    inventory.md
    jobs-and-projects.md
    service-and-maintenance.md
    time-tracking.md
  product/
    offer.md
    acquisition.md
    avatar.md
    competitive-landscape.md
    product-capability-map.md
  plans/
    phase-1-build-roadmap.md
    p1-00-baseline-verification.md
    golden-gate-log.md
    inventory-v1-implementation-plan.md
  decisions/
    0001-infrastructure-stack.md
```

Not every file needs to exist immediately. Add a document when it prevents repeated confusion, guides future implementation, or records a meaningful product/architecture decision.

## Document Types

### Technical Docs

Use `docs/technical/` for system-level explanations: architecture, data model concepts, auth/session flows, organization scoping, Realtime, caching, deployment assumptions, and integration boundaries.

Technical docs should avoid column-by-column schema dumps. When exact schema matters, inspect Supabase and the generated database types.

### Feature Specs

Use `docs/features/` for intended behavior of major feature areas. These docs should distinguish between:

- Current implementation.
- Phase 1 future build-out for the complete operational core.
- Phase 2 intelligence and automation opportunities.
- Cross-feature inputs, outputs, and ownership boundaries.
- Explicit non-goals and decision gates.
- Open decisions.
- Permission and role expectations.

The standard feature-spec sections are defined in `docs/product/product-capability-map.md`. Feature specs describe **what** the complete product should do and how it connects to the rest of WerkFlow; concrete implementation sequencing belongs in `docs/plans/`.

### Product Docs

Use `docs/product/` for business context that should not always be loaded into every coding task: offer, acquisition process, deeper avatar/persona notes, onboarding services, pricing assumptions, and positioning.

`docs/product/competitive-landscape.md` is the dated, source-linked research reference for major German Handwerkersoftware competitors. Treat vendor features, public pricing, review signals, and WerkFlow analysis as separate evidence types, and refresh volatile figures before using them in a current decision.

`docs/product/product-capability-map.md` is the product-wide map for the complete operational core and later intelligent-automation phase. Use it to keep feature specs coherent, resolve cross-feature ownership, and distinguish a product capability from a release or implementation plan.

### Implementation Plans

Use `docs/plans/` for detailed implementation plans that are too concrete for broad feature specs, especially when a large feature needs a handoff anchor across multiple sessions. Plans should link back to the relevant feature spec and be updated or archived after implementation decisions are finalized.

`docs/plans/phase-1-build-roadmap.md` is the living execution index for the complete operational core. Phase 1 agents should use it to identify the next eligible vertical slice, verify direct prerequisites, record current status and evidence, run the required golden scenarios, and update dependent documentation. It owns implementation order and progress; feature specs remain the source for intended product behavior.

### Decision Records

Use `docs/decisions/` for short ADR-style records when a decision is important enough that future agents should know why it was made. Keep these concise and dated.

## Removed Legacy Architecture File

The former `docs/SYSTEM_ARCHITECTURE.md` file was removed after its durable current content was split into smaller docs. Do not recreate a single catch-all architecture document. Add focused docs instead.
