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
  features/
    ai-automations.md
    document-management.md
    employee-management.md
    inventory.md
    jobs-and-projects.md
    time-tracking.md
  product/
    offer.md
    acquisition.md
    avatar.md
  decisions/
    0001-example-decision.md
```

Not every file needs to exist immediately. Add a document when it prevents repeated confusion, guides future implementation, or records a meaningful product/architecture decision.

## Document Types

### Technical Docs

Use `docs/technical/` for system-level explanations: architecture, data model concepts, auth/session flows, organization scoping, Realtime, caching, deployment assumptions, and integration boundaries.

Technical docs should avoid column-by-column schema dumps. When exact schema matters, inspect Supabase and the generated database types.

### Feature Specs

Use `docs/features/` for intended behavior of major feature areas. These docs should distinguish between:

- Current implementation.
- Planned scope.
- Explicit non-goals.
- Open decisions.
- Permission and role expectations.

### Product Docs

Use `docs/product/` for business context that should not always be loaded into every coding task: offer, acquisition process, deeper avatar/persona notes, onboarding services, pricing assumptions, and positioning.

### Decision Records

Use `docs/decisions/` for short ADR-style records when a decision is important enough that future agents should know why it was made. Keep these concise and dated.

## Removed Legacy Architecture File

The former `docs/SYSTEM_ARCHITECTURE.md` file was removed after its durable current content was split into smaller docs. Do not recreate a single catch-all architecture document. Add focused docs instead.
