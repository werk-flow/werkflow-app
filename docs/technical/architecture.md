# Technical Architecture

This document describes the current high-level architecture of WerkFlow. It intentionally avoids duplicating exact database schema details; for exact schema, inspect the live Supabase project and `lib/supabase/database.types.ts`.

## Product Context

WerkFlow is a German-language operations platform for SHK businesses first, with possible future expansion to adjacent trades. The app is currently a TypeScript web app and may later be paired with a React Native mobile app.

The product goal is to become the digital operations backbone for a business: jobs/projects, employees, working time, documents, inventory, and future AI-assisted automations.

## Runtime And Framework

- Next.js `16.0.10`
- React `19.2.3`
- TypeScript
- Tailwind CSS v4
- shadcn/Radix-style UI primitives
- Supabase for auth, database, generated types, and Realtime

`next.config.ts` enables Cache Components:

```ts
const nextConfig = {
  cacheComponents: true,
};
```

Use `package.json` as the source of truth for dependency versions.

## Application Shape

The app uses the Next.js App Router. The main route groups are:

- `app/(auth)/`: login, signup, verification, password reset.
- `app/onboarding/`: create or join an organization.
- `app/(app)/`: authenticated product shell and operational pages.
- `app/api/`: server endpoints where route handlers are needed.

Authenticated product areas currently include dashboard, calendar, time tracking, jobs/projects, employees, customers, and settings. Inventory is a major near-term planned module and is not currently implemented.

## Supabase Access Model

The app uses multiple Supabase clients for different trust boundaries:

- `lib/supabase/client.ts`: browser client.
- `lib/supabase/server.ts`: SSR/server client using request cookies and the publishable key.
- `lib/supabase/admin.ts`: singleton service-role/admin client for server-only privileged operations.

Server code that uses the admin client must validate the authenticated user first. The current pattern is to validate users with Supabase Auth `getUser()` before privileged server actions.

Live Supabase state is the practical source of truth for database-aware tasks. The repo intentionally does not use local migration files as the default workflow.

## Authentication And Organization Context

Users authenticate through Supabase Auth. After authentication, users are routed either into the app or into onboarding depending on whether they belong to an organization.

WerkFlow is organization-scoped. Users may belong to multiple organizations, and the active organization is stored through app-level organization context/cookies. Most operational data should be scoped by `organization_id`.

Current role labels:

- `admin`: Admin
- `buero`: Büro
- `employee`: Handwerker/in

Role-specific behavior should be intentional. Employees should have simple, focused flows. Admins, office users, and managers need efficient overview and operational control.

## Data Model Boundaries

The core implemented domain currently includes:

- Organizations and memberships.
- Profiles and roles.
- Customers.
- Projects and jobs/orders.
- Job assignments.
- Job instruction items.
- Time entries and change requests.
- Organization settings and per-user organization preferences.

Do not maintain a manual column-by-column schema in docs. If schema details matter:

1. Inspect live Supabase through the MCP/plugin workflow.
2. Check generated types in `lib/supabase/database.types.ts`.
3. Then update app code and docs if the conceptual model changed.

## Caching And Freshness

The app uses a mix of React request memoization and Next.js cache primitives.

- `react.cache()` deduplicates work within a request.
- `unstable_cache()` is used for cross-request cached data.
- `CACHE_TAGS` in `lib/data/cached.ts` define tag names for memberships, subscription status, profile data, organization settings, user preferences, clients, jobs, projects, and member counts.
- Server actions that mutate cached data should invalidate the relevant cache tags.

The product principle is fast initial load with fresh operational data. Avoid adding client-side fetching or polling when existing server rendering, cache invalidation, and Realtime patterns can support the workflow.

## Realtime

Supabase Realtime is centralized through `components/realtime/realtime-provider.tsx`.

The provider subscribes to organization-scoped tables such as time entries, change requests, invites, members, settings, clients, jobs, projects, assignments, and instruction items. Events are debounced to avoid unnecessary refresh storms.

`hooks/use-realtime-router-refresh.ts` lets components refresh the current route when subscribed tables change.

When adding new operational data that must stay live:

- Decide whether it belongs in the centralized Realtime provider.
- Scope events by organization whenever possible.
- Debounce refreshes or local updates to avoid thundering herds.
- Keep employee views lightweight and manager views efficient.

## UI And Language

User-facing UI copy is German. Code, identifiers, comments, commits, and developer-facing artifacts are English. See `.cursor/rules/language-and-coding-guidelines.mdc`.

The app should feel fast, modern, clear, and hard to misuse, especially for field-worker (`Handwerker/in`) workflows.

## Related Docs

- `docs/technical/data-model.md`
- `docs/technical/realtime-and-caching.md`
- `docs/features/`
