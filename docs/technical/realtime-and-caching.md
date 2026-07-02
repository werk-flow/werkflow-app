# Realtime And Caching

WerkFlow should feel fast, modern, and operationally fresh. The app combines server-rendered data, cache tags, and Supabase Realtime to avoid slow legacy-software behavior while reducing stale data.

## Current Building Blocks

- Next.js App Router and Server Components.
- Cache Components enabled in `next.config.ts`.
- React request memoization through `react.cache()`.
- Cross-request caching through `unstable_cache()`.
- Cache tags and invalidation through `CACHE_TAGS` in `lib/data/cached.ts`.
- Supabase Realtime through `components/realtime/realtime-provider.tsx`.
- Route refresh helpers through `hooks/use-realtime-router-refresh.ts`.

## Caching Layers

### Request-Level Deduplication

Use `react.cache()` for repeated work within the same request/render pass. This is useful for authenticated user, membership, and organization reads that multiple server components need.

### Cross-Request Caching

Use `unstable_cache()` for data that can be reused across requests and invalidated by tags.

Current cache tag areas include:

- Memberships.
- Subscription status.
- Profiles.
- Member counts.
- Organization settings.
- User preferences within an organization.
- Clients.
- Jobs.
- Projects.

Server actions that mutate these areas should call `updateTag()` for affected tags.

## Realtime Model

Supabase Realtime subscriptions are centralized in `components/realtime/realtime-provider.tsx`.

The provider subscribes to tables that affect active operational views, including:

- `time_entries`
- `entry_change_requests`
- `organization_invites`
- `organization_members`
- `organization_settings`
- `profiles`
- `clients`
- `jobs`
- `projects`
- `job_assignments`
- `job_instruction_items`

Most subscriptions are scoped by `organization_id`. Profile updates are broader because profile data may be referenced across organization/member views.

Events are debounced inside the provider to avoid refresh storms when multiple related rows change quickly.

## Refresh Patterns

The app uses two main Realtime response patterns:

- Refresh the route with `router.refresh()` when server-rendered data should be reloaded.
- Fetch or update local client state for focused interactive views, such as live job lists, calendar details, approval counts, or clock state.

Use `hooks/use-realtime-router-refresh.ts` when a component should refresh the current route after one of several Realtime table changes.

Use `useRealtimeEvent()` directly when a component can update a narrower local state without refreshing the entire route.

## Mutation Guidelines

When adding or changing server actions:

1. Validate the authenticated user with Supabase Auth `getUser()` before privileged operations.
2. Check authorization and organization membership/role.
3. Write through the server-only admin client when required.
4. Invalidate relevant cache tags with `updateTag()`.
5. Confirm whether Realtime already covers the affected table.
6. Avoid redundant manual client refreshes if Realtime already updates the view.

## Adding New Realtime Data

Before adding a new table to Realtime:

- Confirm the UI really needs live updates.
- Scope events by organization whenever possible.
- Consider whether route refresh or local state update is better.
- Debounce or batch reactions if one user action changes multiple rows.
- Keep field-worker views simple and avoid noisy UI changes.

Inventory will likely need Realtime once implemented because stock counts and job materials may be edited by multiple users.

## Freshness Principles

- Prefer fast initial page loads with server-rendered data.
- Prefer explicit invalidation after writes over broad cache disabling.
- Prefer live updates for operational data that users coordinate around.
- Do not add polling unless Realtime is not appropriate.
- Treat exact database state as coming from live Supabase and generated types, not docs.
