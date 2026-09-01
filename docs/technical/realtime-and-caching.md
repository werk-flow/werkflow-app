# Realtime And Caching

Status: living — last reviewed 2026-09-01

WerkFlow should feel fast, modern, and operationally fresh. The app combines server-rendered data, cache tags, and Supabase Realtime to avoid slow legacy-software behavior while reducing stale data.

## Current Building Blocks

- Next.js App Router and Server Components.
- Cache Components enabled in `next.config.ts`.
- React request memoization through `react.cache()`.
- Cross-request caching through `unstable_cache()`.
- Cache tags and invalidation through `CACHE_TAGS` in `lib/data/cached.ts`.
- Supabase Realtime through `components/realtime/realtime-provider.tsx`; the published table list lives in `lib/realtime/tables.ts`.
- The live-view family: `hooks/use-live-view.ts` (client refetch views) and `hooks/use-realtime-router-refresh.ts` (route refresh).
- Pending state for server actions through `hooks/use-server-action.ts`.

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
- Requests (Anfragen).
- Personnel records, employment conditions, and work schedules (`personnel-<orgId>`, P1-03/P1-04).
- Vacation requests (`vacation-<orgId>`, P1-06).
- Scoped responsibility configurations, assignments, and substitutes (`responsibilities-<orgId>`, P1-05).
- Organization holiday/closure context (`organization-calendar-<orgId>` plus the settings tag, P1-04).
- Jobs.
- Projects.

Server actions that mutate these areas should call `updateTag()` for affected tags.

## Realtime Model

### Transport posture (Stage B research, 2026-08-28)

Recorded from current Supabase primary sources before the Stage B consolidation was implemented:

- The transport is `postgres_changes` on one channel per organization (`org-<orgId>`); all table bindings ride a single channel join, which is quota-efficient (one join, one of 100 channels per connection). Supabase applies per-subscriber RLS checks to INSERT and UPDATE events.
- **RLS is not applied to DELETE events** — only the client-supplied subscription filter gates them, and the old-row payload is whatever replica identity logs. Replica identity FULL therefore leaks complete deleted rows to any authenticated project user with a crafted subscription. Published organization-scoped tables use replica identity `USING INDEX` on a unique `(id, organization_id)` index instead: DELETE events stay org-filterable server-side while their payload carries only the two ids. Do not set replica identity FULL on published tables, and do not read row content from DELETE payloads — treat events as invalidation signals.
- **Broadcast-from-database is the documented end-state at scale.** Supabase recommends Broadcast over `postgres_changes` for most use cases; per-event-per-subscriber RLS checks are single-threaded and the documented ceiling is ~3,000 concurrent subscribers. At current scale `postgres_changes` is correct, and the consolidation confines transport knowledge to the provider, so a later migration to private `org:<orgId>` broadcast topics fed by `realtime.broadcast_changes` triggers changes the provider and one migration, not the surfaces. Raise the migration with the owner before broad multi-tenant launch.
- `supabase.realtime.setAuth(<user JWT>)` remains required (also on token refresh); Realtime ignores `sb_*` API keys as channel auth.

Supabase Realtime subscriptions are centralized in `components/realtime/realtime-provider.tsx`. The published table list has ONE home: `lib/realtime/tables.ts` exports `REALTIME_TABLES`, the `RealtimeTable` type derives from it, and the provider generates one org-filtered binding per entry (`profiles` is the recorded unfiltered exception — profile data is referenced across organization views). Adding a table to Realtime means: publication + replica-identity migration, one line in `REALTIME_TABLES`, done — a table cannot join without its organization filter. `bun run realtime:check` also runs in the local preflight. It checks publication membership in both directions, requires each `USING INDEX` identity to cover exactly `(id, organization_id)`, verifies the three recorded DEFAULT exceptions, rejects FULL identity, and requires INSERT, UPDATE, and DELETE publication operations.

**P1-23 acceptance checkpoint (2026-09-01):** local, DEV and PROD publish the same 87 tables. Eighty-four use replica identity `USING INDEX` on exactly `(id, organization_id)`. `profiles`, `organization_settings`, and `organization_qualification_settings` use the recorded DEFAULT identity. No published table uses FULL identity, and all three checked backends have INSERT, UPDATE, and DELETE enabled on `supabase_realtime`.

Events are debounced per table inside the provider (`REALTIME_DEBOUNCE_MS` in `lib/realtime/events.ts`) to avoid refresh storms when multiple related rows change quickly. The provider also owns the focus/visibility catch-up: returning to the tab dispatches one coalesced synthetic event per table to every subscriber, so consumers get gap recovery without their own listeners.

The per-slice paragraphs below preserve the acceptance-era behavior while using the Stage B transport posture. Every published organization-scoped table uses replica identity `USING INDEX` on exactly `(id, organization_id)` (migration `20260828120100`), because FULL leaked deleted rows past RLS. The org-filtered DELETE delivery those slices wanted is preserved. Only `profiles`, `organization_settings`, and `organization_qualification_settings` use the recorded DEFAULT identity.

The three P1-05 responsibility tables, the P1-06 `vacation_requests` table, and the P1-08 `sickness_reports` table use the full Realtime integration contract: publication, the provider table union/`TABLES` subscription, `use-realtime-router-refresh.ts`, and replica identity `USING INDEX` on exactly `(id, organization_id)` so organization-filtered DELETE events retain their filter column without exposing the full deleted row. The append-only audit tables (`sickness_report_events` included) are not subscribed, matching other per-domain audit logs — with one deliberate P1-07 exception: `attention_events` is published so a future consumer can react to pattern-level facts, and `attention_read_states` is subscribed so read markers set on one device update badges everywhere. The vacation widget, approver queue, and calendar absence entries refetch on `vacation_requests` events with generation guards and keep last-known data on transient failures; the sickness sections (dashboard, member detail) and the neutral calendar absence entries do the same on `sickness_reports` events. Vacation decisions and sickness mutations are always re-authorized server-side at action time. Sickness reads follow the attention posture — live action queries, no `unstable_cache` consumer yet (the `sickness` cache tag exists for symmetry and is invalidated on every write).

P1-07's unified attention counts replace the former time-only pending-approval pipeline: `components/realtime/attention-count-provider.tsx` is the ONE counting pipeline behind the sidebar badges (Aufgaben = actionable + unread, Zeiterfassung = approvals), the Anträge tab badge, and the member quick stats. It refreshes on `time_entries`, `entry_change_requests`, `vacation_requests`, `sickness_reports` (P1-08), `client_requests`, `client_follow_ups` (P1-10), `attention_read_states`, and the responsibility tables, debounced with a generation guard and keep-last-known behavior. The `/aufgaben` surface itself refetches on the same events. Attention data is deliberately NOT `unstable_cache`d and has no cache tag: every read is a live action query derived from the owning domains, because a stale "nothing to do" claim is worse than the query cost, and the expensive loaders early-return when their pending sets are empty (the steady state).

P1-10 adds `client_follow_ups`, `client_communication_settings`, and `client_communication_preferences` to the operational publication/provider contract with replica identity `USING INDEX` on exactly `(id, organization_id)`. Their append-only event tables stay unpublished. Customer detail route refreshes also listen to the previously published `client_contacts`, `client_sites`, and `client_requests` callbacks; P1-10 fixed the pre-existing gap where those tables existed in the central provider but the generic router-refresh hook never registered them. Follow-up events refresh the unified attention-count provider and `/aufgaben`; preference/settings changes refresh the customer relationship view. The resolver remains a live bounded action query and invalidates the existing organization client tag after writes; no generic timeline cache or copied timeline table exists.

P1-11 publishes `planning_series`, `planning_occurrences`, and `planning_occurrence_assignments`, all with replica identity `USING INDEX` on exactly `(id, organization_id)`, because schedule and assignment coordination must update active calendars across users. The router-refresh hook batches those callbacks with the existing job/assignment refresh path. Append-only `planning_occurrence_assessments` and `planning_events` remain unpublished: their manager-only history is loaded deliberately rather than producing duplicate refreshes for every atomic planning mutation. A single mutation can touch a series, several occurrences, assignments, assessments, the legacy job projection, and its job assignments; provider debouncing is therefore part of the correctness/performance contract rather than optional polish.

P1-12 publishes `planning_dispatches`, `planning_dispatch_recipients`, `planning_dispatch_acknowledgements`, and `planning_customer_commitments`, all with replica identity `USING INDEX` on exactly `(id, organization_id)`: an employee's device must learn of a new or superseded work instruction, the manager Einsätze panel must see acknowledgements/challenges live, and commitment context must stay fresh across office users. P1-14 replaced the former parking tables with `work_blockers`; the old tables are no longer publication members. The append-only dispatch and commitment ledgers stay unpublished. The Einsätze panel and employee „Mein Einsatz" card refetch through one shared 150 ms debounce per surface; the unified attention-count provider and `/aufgaben` additionally refresh on dispatch and blocker changes. Dispatch reads follow the attention posture (live action queries, no `unstable_cache`); mutations revalidate `/kalender`, `/aufgaben`, and the jobs tag.

P1-13 publishes the mutable template/version/content/application/origin tables with replica identity `USING INDEX` on exactly `(id, organization_id)` and organization filters. Manager template lists and work-detail consumers refetch through the central debounced provider; open registry dialogs suspend route refresh and receive one queued catch-up after close. Append-only `work_template_events` stays unpublished. Template reads use the `work-templates-<orgId>` tag; mutations invalidate it plus the existing jobs, inventory and qualification tags affected by materialization. Application does not subscribe or invalidate calendar/dispatch/time domains because it creates no schedule, dispatch or actual-time fact.

P1-14 publishes `work_blockers` and `work_dependencies` with replica identity `USING INDEX` on exactly `(id, organization_id)`. Their append-only event tables and `work_execution_events`/instruction-completion events stay unpublished. Job/project detail cards subscribe through the central provider and preserve open dialogs by surfacing a catch-up control instead of replacing input. Blocker changes also refresh the one attention-count and `/aufgaben` pipeline. Mutations reuse the existing organization-scoped jobs/projects tags and revalidate `/auftraege`, `/kalender`, `/aufgaben`, and `/mitarbeiter`; no lifecycle-specific cache duplicates the work sources.

P1-15 publishes only current `work_artifacts` and active `job_instruction_evidence_fulfillments`, both with replica identity `USING INDEX` on exactly `(id, organization_id)`. Immutable revisions, type details, document/source relations and action ledgers stay unpublished. Job/project detail uses the central dialog-safe catch-up behavior; artifact review, correction and due-defect changes also refresh the unified attention pipeline. Mutations reuse jobs/projects, documents and responsibilities tags and routes rather than adding an artifact cache.

P1-16 composes the assigned worker's field pack from these existing live sources without adding a cache, copied pack, or publication member. Server rendering loads the independent customer/site, dispatch, lifecycle, instruction, artifact, document, time, material, blocker, and bounded project projections in parallel. Route refresh covers assignment, planning, dispatch-root, instruction, document, artifact-root, time, blocker, and dependency changes. The employee material section performs a narrower debounced refetch for `job_material_lines`, `inventory_movements`, and `inventory_stock_levels`, keeps the last confirmed state during a transient failure, and ignores an older response after a newer generation starts. Open dialogs use the shared suspension and queued catch-up behavior so Realtime cannot discard typed input. Immutable `planning_dispatch_revisions`, `work_artifact_revisions`, and `work_artifact_actions` remain unpublished because their owning root-row mutations already signal the required refresh.

P1-21 publishes the mutable `time_sessions` and `time_segments` roots with exact `(id, organization_id)` replica-index identity. Existing clock, weekly, calendar, job/project and field-pack readers subscribe to both roots through the live-view family and reload the authoritative compatibility projection. Append-only `time_segment_events` and idempotency receipts in `time_operations` remain unpublished. Client providers reject a payload whose organization does not match the current scope, so an organization switch cannot briefly project the previous company's running state.

P1-22 publishes only the mutable `time_correction_requests` root with exact `(id, organization_id)` replica-index identity. Immutable revisions, exact sources, lifecycle events, accepted applications and the private applied-source claim ledger remain unpublished. Personal history, manager review, shared attention, provisional totals and calendar blocks refetch the authoritative bounded correction view through the live-view family; an open correction dialog uses shared suspension and one catch-up read. Accepted applications flow into the same time compatibility projection consumed by job/project readers, so no surface owns a second correction cache or subscription.

P1-23 publishes only six mutable roots: `time_accounts`, `time_account_adjustment_requests`, `time_periods`, `time_period_findings`, `payroll_mapping_profiles`, and `payroll_exports`, each with exact `(id, organization_id)` replica-index identity. Immutable policy versions/rules, ledger events, calculation snapshots, findings decisions, closes, mappings and export events remain unpublished. Account, period, settings and statement surfaces refetch the bounded server projection from root changes; no export bytes or immutable child rows pass through Realtime.

P1-17 publishes only the mutable `work_handover_packages` root with replica identity `USING INDEX` on exactly `(id, organization_id)`. Immutable releases, draft/release membership and append-only events remain unpublished; every accepted package mutation updates the root, which signals one authoritative refetch of the complete server-projected state. Handover detail and the unified attention pipeline consume that signal through the central 150 ms debounce, generation guards, focus/visibility catch-up, keep-last-known stale state and shared dialog suspension. Package mutations reuse jobs/projects, documents and responsibility invalidation; preview remains side-effect free and creates no parallel cache.

P1-18 publishes only the mutable `installed_equipment` root with replica identity `USING INDEX` on exactly `(id, organization_id)`. Identifiers, work links, equipment document links and append-only events stay unpublished; accepted child and lifecycle mutations touch the root. The service list/detail and compact customer/assigned-job projections refetch authoritative bounded data through the existing live-view family, including dialog suspension, focus/visibility catch-up and keep-last-known stale behavior.

P1-19 publishes only the mutable `service_cases` root. Relations, exact equipment/job/evidence/document links and append-only events stay unpublished; successful child mutations touch the root so manager and assigned-field projections refetch authoritative state.

P1-20 publishes the three mutable roots `maintenance_coverages`, `maintenance_plans`, and `maintenance_due_work`, each with replica identity `USING INDEX` on exactly `(id, organization_id)`. Immutable plan revisions, exact equipment/job/occurrence/service/evidence links and event ledgers remain unpublished. A successful child mutation updates its owning root, and `/service/wartung` uses one `useLiveView` read over those three invalidation signals. The assigned field pack continues to refresh from the exact job root and receives only the bounded maintenance projection authorized for that assignment.

## Refresh Patterns

Every live surface consumes Realtime through one of the two live-view family members; neither takes a debounce knob (the shared boundary is the point):

- `useRealtimeRouterRefresh({ tables })` (`hooks/use-realtime-router-refresh.ts`) refreshes the route when server-rendered data should reload. Server props stay the authority; local state re-syncs from them.
- `useLiveView({ tables, read, ... })` (`hooks/use-live-view.ts`) owns a narrower client view: one reader (usually a server action) is the authority, events are invalidation signals. The hook carries the whole refetch discipline — shared debounce, generation guard, keep-last-known with visible staleness, dialog suspension with one queued catch-up, focus/visibility catch-up, `enabled`/`resetKey` scoping, plus `invalidate()`/`setData()` for surfaces with optimistic own-action echoes (the clock).

Direct `useRealtimeEvent()` consumption is lint-banned for surfaces; the recorded exception is the project-detail delete-exit watcher, which needs the event itself (navigation away from a deleted record), not a refetch.

## Client Freshness Contract

Standardized 2026-08-27 from the race classes P1-16 exposed; since Stage B of the platform hardening (2026-08-28) the contract is not a set of rules surfaces re-implement — it is the behavior of the live-view primitive, and every live surface runs on it.

1. **The provider owns subscriptions.** Components consume the live-view family; they do not open their own channels. Table events are debounced `REALTIME_DEBOUNCE_MS` in the provider, and the family shares that boundary with no per-surface override — a shorter debounce raced server cache invalidation in P1-16 and produced stale reads. _Enforced (Tier 2): `eslint.config.mjs` bans `.channel(` and `onAuthStateChange` outside the provider, and bans importing `useRealtimeEvent`/`useRealtimeSubscribe` outside the family. Tier 1 by construction: the hooks expose no debounce option._
2. **Focus and visibility catch-up are provider concerns.** Returning to a tab or window dispatches one coalesced synthetic catch-up to every subscriber; components must not register competing focus/visibility listeners. _Enforced (Tier 2): `eslint.config.mjs` bans `addEventListener('visibilitychange'|'focus')` in product code — the Stage B sweep ended the former legacy allowlist at zero. `setInterval` is banned the same way; the named exception is the wall-clock day-rollover tick (`hooks/use-business-day-refresh.ts`), and pure render clocks carry reasoned inline disables._
3. **Server props are mount-time data for live components.** `useLiveView`'s `initialData` is exactly this: it seeds the first paint and suppresses the mount read; after mount, the reader is authoritative. Key live components by entity id so navigation remounts them cleanly, or pass `resetKey` where remounting is not an option (app-shell providers).
4. **Mutations refresh route-first, then refetch.** Start `router.refresh()` and finish with the authoritative client refetch (`view.refresh()`); the reverse order let a stale server payload overwrite the fresh read (the P1-16 dispatch-challenge race).
5. **Refetches use generation guards and keep-last-known.** Built into the primitive: an older response never commits over a newer generation, and a failed read keeps the data while `isStale` marks the surface — render dependent actions non-interactive where they rely on it.
6. **Dialogs suspend, then catch up once.** Open dialogs suspend reads and route refreshes through the shared open-dialog context (`components/ui/open-dialog-context.tsx`); exactly one queued catch-up fires after close. Built into both family members; `suspend` covers non-dialog editors. Pending/double-submit state binds to the actual server call through `useServerAction` (`hooks/use-server-action.ts`), never to a router transition — a router-entangled `useTransition` kept controls disabled after unrelated refreshes (the P1-16 `MetadataSection` defect). _Enforced (Tier 2): `eslint.config.mjs` bans async `startTransition` callbacks in product code._

Events are signals, not data: consumers never read row content from DELETE payloads (replica identity `USING INDEX` reduces them to `id` + `organization_id`), and an `eventFilter` that inspects payload columns must treat a missing column as relevant. Synthetic catch-up events bypass every filter by design.

## Latency Contract (D4)

The app must feel instant, and the harness holds it to numbers:

- **A user's own action reflects instantly** — the optimistic echo (`useServerAction` pending into a success banner; `view.setData()` where a surface keeps live client state, the clock being the model).
- **Another session's open surface shows a change within 2 seconds** (`LIVE_TARGET_MS`).
- **The test helper hard-fails above 15 seconds** (`LIVE_HARD_BUDGET_MS`, local and cloud) — the measured envelope of route-refresh delivery under full-battery load, recalibrated from the provisional 5 s after certification evidence (incident log, 2026-08-28). Every measurement is archived with an `overTarget` flag, so creep past the 2 s target stays visible without failing runs on machine load.

`expectLiveWithin` (`tests/golden/support/live.ts`) asserts the budget in the key cross-session checks (GG-00 customer list, P1-10 follow-ups, P1-12 dispatch state, canary C3) and appends every measured latency to the run archive (`live-latencies.ndjson`), so certification runs double as measurements. Dev servers additionally log per-event propagation (`[Realtime] event received … propagationMs`, database commit to client receipt).

Measured baselines (Stage B, 2026-08-28, final frozen-build Golden certification `2026-08-28T215821537Z-a1af14`): GG-00 customer list 883 ms, P1-10 follow-up 957 ms, P1-12 dispatch state 973 ms — all cross-session, all under the 2 s target; earlier certification and focused-run measurements sit in the same 0.9–1.5 s band, and cloud delivery measured 4459 ms (canary C3, over target, archived as such). The ledger in [platform-hardening.md](../plans/platform-hardening.md) keeps the full context.

## Mutation Guidelines

When adding or changing server actions:

1. Validate the authenticated user with Supabase Auth `getUser()` before privileged operations.
2. Check authorization and organization membership/role.
3. Write through the server-only admin client when required.
4. Invalidate relevant cache tags with `updateTag()`.
5. Confirm whether Realtime already covers the affected table.
6. Avoid redundant manual client refreshes if Realtime already updates the view.

Responsibility writes invalidate `responsibilities-<orgId>` and revalidate settings, personnel, time, and calendar consumers. Authorization does not read a cross-request responsibility cache: every approval action reloads stored configuration and uses the current server action timestamp plus the Europe/Berlin business date. Therefore a stale render around midnight or an overlapping Realtime refresh may affect display freshness, but can never extend an expired substitute's authority. Focused client refetches such as the pending-approval count retain last-known data on transient failure and use a generation guard so an older response cannot overwrite a newer one.

## Adding New Realtime Data

Before adding a new table to Realtime, confirm the UI really needs live updates and that route refresh would not serve better than a client view; keep field-worker views simple and avoid noisy UI changes.

Then the mechanics, in one migration plus one line:

1. Migration: add the table to the `supabase_realtime` publication, create the unique `(<pk>, organization_id)` index named `<table>_replident_idx`, and set `REPLICA IDENTITY USING INDEX` on it (never FULL — the transport-posture section explains the DELETE leak).
2. Add the table name to `REALTIME_TABLES` in `lib/realtime/tables.ts`. The provider binds and org-filters it automatically; `bun run realtime:check` fails until migration and list agree.
3. Consume it through `useLiveView` or `useRealtimeRouterRefresh`. Debounce, batching, suspension, and catch-up come with the primitive.

## Freshness Principles

- Prefer fast initial page loads with server-rendered data.
- Prefer explicit invalidation after writes over broad cache disabling.
- Prefer live updates for operational data that users coordinate around.
- Do not add polling unless Realtime is not appropriate.
- Treat exact database state as coming from live Supabase and generated types, not docs.
