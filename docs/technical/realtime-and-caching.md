# Realtime And Caching

Status: living — last reviewed 2026-09-06

WerkFlow should feel fast, modern, and operationally fresh. The app combines server-rendered data, cache tags, and Supabase Realtime to avoid slow legacy-software behavior while reducing stale data.

## Current Building Blocks

- Next.js App Router and Server Components.
- Cache Components enabled in `next.config.ts`.
- React request memoization through `react.cache()`.
- Cross-request caching through `unstable_cache()`.
- Function-level caching through the Next.js 16 `'use cache'` directive with `cacheTag()`; `lib/work-templates/server.ts` is the current user.
- Cache tag names from the `CACHE_TAGS` registry in `lib/data/cached.ts`, the single list.
- Supabase Realtime through `components/realtime/realtime-provider.tsx`; the published table list lives in `lib/realtime/tables.ts`.
- The live-view family: `hooks/use-live-view.ts` (client refetch views) and `hooks/use-realtime-router-refresh.ts` (route refresh).
- Pending state for server actions through `hooks/use-server-action.ts`.

## Caching Layers

### Request-Level Deduplication

Use `react.cache()` for repeated work within the same request/render pass. This is useful for authenticated user, membership, and organization reads that multiple server components need.

### Cross-Request Caching

Use `unstable_cache()` for data that can be reused across requests and invalidated by tags, or the `'use cache'` directive with `cacheTag()` where a whole function result is the cache unit.

The `CACHE_TAGS` registry in `lib/data/cached.ts` is the single list of tag names; this document does not repeat it. Server Actions that mutate a cached area call `updateTag()` for the affected tags. `updateTag()` is Server-Action-only and throws inside a route handler, so route handlers such as `app/api/redeem-invite/route.ts` call `revalidateTag(tag, 'max')` instead.

## Realtime Model

### Transport posture (Stage B research, 2026-08-28)

Recorded from current Supabase primary sources before the Stage B consolidation was implemented:

- The transport is `postgres_changes` on one channel per organization (`org-<orgId>`); all table bindings ride a single channel join, which is quota-efficient (one join, one of 100 channels per connection). Supabase applies per-subscriber RLS checks to INSERT and UPDATE events.
- Published organization-scoped tables use `REPLICA IDENTITY USING INDEX` on `(id, organization_id)`, reducing the old-row data available to logical replication. Keep this minimal identity and treat events as invalidation signals. A client-supplied organization filter is not an authorization boundary.
- Supabase recommends evaluating Broadcast for higher subscriber counts. The provider contains the transport implementation, so a future move to private topics should preserve the consumer hooks. The documented subscriber guidance is a sizing heuristic, not a measured WerkFlow capacity limit. Revisit transport with measured workload and permission requirements before broad multi-tenant launch.
- `supabase.realtime.setAuth(<user JWT>)` remains required (also on token refresh); Realtime ignores `sb_*` API keys as channel auth.

Resolved 2026-09-06 (hardening finding SI-009): per the [Supabase Postgres Changes documentation](https://supabase.com/docs/guides/realtime/postgres-changes#delete-events), DELETE delivery is not filtered by RLS and carries only the replica identity. With `USING INDEX (id, organization_id)` that payload is the deleted row's id and organization; no business column is included. The client filter is applied by the Realtime server to that identity, but a subscriber can choose a foreign filter, so the residual exposure is "a row with this UUID was deleted in organization X". INSERT and UPDATE delivery are RLS-filtered per subscriber, which is why the unfiltered `profiles` binding cannot leak co-member data. This is a provider limitation, not a repository defect; the assessment rests on the provider documentation and the catalog state pinned by `realtime:check`, not on a live cross-organization payload capture. Keep the minimal identity; do not switch to FULL.

Supabase Realtime subscriptions are centralized in `components/realtime/realtime-provider.tsx`. The published table list has ONE home: `lib/realtime/tables.ts` exports `REALTIME_TABLES`, the `RealtimeTable` type derives from it, and the provider generates one org-filtered binding per entry (`profiles` is the recorded unfiltered exception — profile data is referenced across organization views). Adding a table to Realtime means: publication + replica-identity migration, one line in `REALTIME_TABLES`, done — the provider adds a filter to every organization-scoped binding. `bun run realtime:check` also runs in the local preflight. It checks publication membership in both directions, requires each `USING INDEX` identity to cover exactly `(id, organization_id)`, verifies the three recorded DEFAULT exceptions, rejects FULL identity, and requires INSERT, UPDATE, and DELETE publication operations.

Events are debounced per table inside the provider (`REALTIME_DEBOUNCE_MS` in `lib/realtime/events.ts`) to avoid refresh storms when multiple related rows change quickly. The provider also owns the focus/visibility catch-up: returning to the tab dispatches one coalesced synthetic event per table to every subscriber, so consumers get gap recovery without their own listeners.

### Domain invalidation ownership

Each feature chooses the mutable rows that signal a new authoritative read. Most immutable revisions, links, and event ledgers stay unpublished; their mutations touch an owning root. Some earlier domains, including ordinary documents and attention, publish history tables too. The exact set belongs to `REALTIME_TABLES`, not a second list in this document.

`components/realtime/attention-count-provider.tsx` owns sidebar and approval counts. It and the Aufgaben page derive current items through `lib/attention`; they do not store or cross-request-cache a second inbox. Their subscribed tables live at the call sites and in the shared registry.

For a feature change, inspect its `useLiveView` or `useRealtimeRouterRefresh` call and the mutation's cache invalidation. The [conceptual data model](data-model.md) explains root and history ownership, and the [slice records](../plans/phase-1/roadmap.md) retain acceptance-era integration evidence. New rows must not become a second cache, task list, or copied domain model.

## Refresh Patterns

Every live surface consumes Realtime through one of the two live-view family members; neither takes a debounce knob (the shared boundary is the point):

- `useRealtimeRouterRefresh({ tables })` (`hooks/use-realtime-router-refresh.ts`) refreshes the route when server-rendered data should reload. Server props stay the authority; local state re-syncs from them.
- `useLiveView({ tables, read, ... })` (`hooks/use-live-view.ts`) owns a narrower client view: one reader (usually a server action) is the authority, events are invalidation signals. The hook carries the whole refetch discipline — shared debounce, generation guard, keep-last-known with visible staleness, dialog suspension with one queued catch-up, focus/visibility catch-up, `enabled`/`resetKey` scoping, plus `invalidate()`/`setData()` for surfaces with optimistic own-action echoes (the clock).

Direct `useRealtimeEvent()` consumption is lint-banned for surfaces; the recorded exception is the project-detail delete-exit watcher, which needs the event itself (navigation away from a deleted record), not a refetch.

## Client Freshness Contract

Standardized 2026-08-27 from the race classes P1-16 exposed; since Stage B of the platform hardening (2026-08-28) the contract is not a set of rules surfaces re-implement — it is the behavior of the live-view primitive, and every live surface runs on it.

1. **The provider owns subscriptions.** Components consume the live-view family; they do not open their own channels. Table events are debounced `REALTIME_DEBOUNCE_MS` in the provider, and the family shares that boundary with no per-surface override — a shorter debounce raced server cache invalidation in P1-16 and produced stale reads. _Enforced (Tier 2): `eslint.config.mjs` bans `.channel(` and `onAuthStateChange` outside the provider, and bans importing `useRealtimeEvent`/`useRealtimeSubscribe` outside the family. The recorded `onAuthStateChange` exception is the password-recovery form at `app/**/reset-password-form.tsx`, which must react to the `PASSWORD_RECOVERY` event. Tier 1 by construction: the hooks expose no debounce option._
2. **Focus and visibility catch-up are provider concerns.** Returning to a tab or window dispatches one coalesced synthetic catch-up to every subscriber; components must not register competing focus/visibility listeners. _Enforced (Tier 2): `eslint.config.mjs` bans `addEventListener('visibilitychange'|'focus')` in product code — the Stage B sweep ended the former legacy allowlist at zero. `setInterval` is banned the same way; the named exception is the wall-clock day-rollover tick (`hooks/use-business-day-refresh.ts`), and pure render clocks carry reasoned inline disables._
3. **Server props are mount-time data for live components.** `useLiveView`'s `initialData` is exactly this: it seeds the first paint and suppresses the mount read; after mount, the reader is authoritative. Key live components by entity id so navigation remounts them cleanly, or pass `resetKey` where remounting is not an option (app-shell providers).
4. **Mutations refresh route-first, then refetch.** Start `router.refresh()` and finish with the authoritative client refetch (`view.refresh()`); the reverse order let a stale server payload overwrite the fresh read (the P1-16 dispatch-challenge race).
5. **Refetches use generation guards and keep-last-known.** Built into the primitive: an older response never commits over a newer generation, and a failed read keeps the data while `isStale` marks the surface — render dependent actions non-interactive where they rely on it.
6. **Dialogs suspend, then catch up once.** Open dialogs suspend reads and route refreshes through the shared open-dialog context (`components/ui/open-dialog-context.tsx`); exactly one queued catch-up fires after close. Built into both family members; `suspend` covers non-dialog editors. Pending/double-submit state binds to the actual server call through `useServerAction` (`hooks/use-server-action.ts`), never to a router transition — a router-entangled `useTransition` kept controls disabled after unrelated refreshes (the P1-16 `MetadataSection` defect). _Enforced (Tier 2): `eslint.config.mjs` bans async `startTransition` callbacks and, since 2026-09-03, `useTransition` itself in product code; the one router-transition home is `components/ui/refresh-button.tsx`, with the organization switch and the document library's folder navigation as named exceptions._

Events signal a refetch rather than authorize a record read. An `eventFilter` that inspects payload columns must treat a missing column as relevant. Synthetic catch-up events bypass every filter by design.

## Latency contract (D4)

Correctness and responsiveness are separate acceptance results. A correct result that appears too late does not qualify as a passing responsiveness check.

- Give the initiating user immediate pending feedback. Show success only after the write is accepted. An optimistic value does not prove persistence or cross-session delivery.
- The selected cross-session checks require the receiving session to display the new value within `LIVE_TARGET_MS`, currently 2 seconds.
- `LIVE_HARD_BUDGET_MS` allows observation for at most 15 seconds on local and cloud backends. This bounds diagnosis. It does not extend the acceptance deadline.

`expectLiveWithin` in `tests/golden/support/live.ts` checks that the result is absent before submission, then starts observation before the producer submits. The clock includes the server response time. A navigation or reload in the receiving page invalidates the observation. Keep the receiver in a separate signed-in session so the producer's optimistic update cannot satisfy the check.

Stages tagged `@FRESHNESS` cover the customer list, follow-ups, dispatch, equipment, service cases, personnel document release and acknowledgement, and cloud canary C3. Group selection must include their setup dependencies. These checks do not measure every screen. Run measured groups without competing test suites or builds, using the workflow in [testing.md](testing.md).

Each observation is archived in `live-latencies.ndjson`. The record distinguishes confirmed correctness, a passed or exceeded responsiveness deadline, and an unconfirmed result. A slow confirmed result throws `ResponsivenessError`. `checkLatencyEvidence` in `lib/testing/latency-evidence.ts` also rejects an archived deadline violation if a caller catches it or a later attempt passes. Missing required evidence and malformed records cannot qualify as passes. Classify backend or connection failures from their original evidence. An invalid environment produces an unconfirmed result, not a performance pass.

Opening readiness has its own contract. The P1-22 time-correction helpers use `expectReadyWithin` and `TIME_CORRECTION_READY_MS`, currently 5 seconds, from opening the dialog through visible and enabled form options. Waiting for the shell does not reset that clock. The helper archives results in `readiness-latencies.ndjson`. This is an explicit P1-22 contract, not a universal two-second rule for dialogs. Both deadlines are defined in `lib/testing/latency-evidence.ts`.

Historical measurements from Stage B on 2026-08-28 were 883 ms for the customer list, 957 ms for follow-ups, and 973 ms for dispatch. Cloud canary C3 measured 4459 ms. That cloud result exceeded the target but passed the former warning-only policy. It does not satisfy the current deadline. [platform-hardening.md](../plans/platform-hardening.md) retains the original evidence.

### Measurement coverage and the performance pass

The shared Realtime primitives enforce refresh coordination and protect against stale reads. Their use alone does not prove that every surface subscribes to the correct changes, shows pending feedback, or meets a response deadline. Preserve these correctness protections when optimizing the reads, rendering, or delivery beneath them.

Current measurements cover the named freshness stages and P1-22 readiness above. They do not record every Server Component render, database query, or browser rendering step. Whole-test duration is not a user-visible response measurement. Fixed deadlines also do not detect every slowdown that remains below the deadline.

For the performance pass, distinguish action-to-feedback, action-to-authoritative-result, cross-session visibility, and navigation/opening-to-usable-content. These are measurement boundaries for planning, not newly established numeric targets. Keep the existing submission-to-receiver deadline intact when adding intermediate timestamps; splitting it must not hide the total wait. Define additional budgets against explicit user expectations and representative environment, data volume, and role conditions. Long operations need progress and their own completion expectations.

Use shared component checks for pending, disabled, success, and error behavior, and real-application measurements for important routes and update paths. Extend shared observation helpers and migrate affected scenarios rather than adding browser stopwatches to every unit or permission test. Record the covered workflows and remaining gaps; helper coverage alone does not establish application-wide speed. Existing-test repairs follow [the testing repair procedure](testing.md#repair-an-existing-test-under-the-current-workflow).

## Mutation Guidelines

When adding or changing server actions:

1. Validate the authenticated user with Supabase Auth `getUser()` before privileged operations.
2. Check authorization and organization membership/role.
3. Write through the server-only admin client when required.
4. Invalidate relevant cache tags with `updateTag()`.
5. Confirm whether Realtime already covers the affected table.
6. After a confirmed write, reconcile the view through its owning freshness pattern. Realtime supplies cross-session invalidation; an own-write completion must not depend solely on its delivery. Reuse the established reader or reconciliation path and avoid competing timers, subscriptions, or refresh loops.

Responsibility writes invalidate `responsibilities-<orgId>` and revalidate settings, personnel, time, and calendar consumers. Authorization does not read a cross-request responsibility cache: every approval action reloads stored configuration and uses the current server action timestamp plus the Europe/Berlin business date. Therefore a stale render around midnight or an overlapping Realtime refresh may affect display freshness, but can never extend an expired substitute's authority. Focused client refetches such as the pending-approval count retain last-known data on transient failure and use a generation guard so an older response cannot overwrite a newer one.

## Adding New Realtime Data

Before adding a new table to Realtime, confirm the UI really needs live updates and that route refresh would not serve better than a client view; keep field-worker views simple and avoid noisy UI changes.

Then the mechanics, in one migration plus one line:

1. Migration: add the table to the `supabase_realtime` publication, create the unique `(id, organization_id)` index named `<table>_replident_idx`, and set `REPLICA IDENTITY USING INDEX` on it. This preserves the existing minimal-payload policy; it does not establish DELETE authorization.
2. Add the table name to `REALTIME_TABLES` in `lib/realtime/tables.ts`. The provider binds and org-filters it automatically; `bun run realtime:check` fails until migration and list agree.
3. Consume it through `useLiveView` or `useRealtimeRouterRefresh`. Debounce, batching, suspension, and catch-up come with the primitive.

## Freshness Principles

- Prefer fast initial page loads with server-rendered data.
- Prefer explicit invalidation after writes over broad cache disabling.
- Prefer live updates for operational data that users coordinate around.
- Do not add polling unless Realtime is not appropriate.
- Treat exact database state as coming from live Supabase and generated types, not docs.
