# Realtime And Caching

Status: living — last reviewed 2026-08-28

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
- Requests (Anfragen).
- Personnel records, employment conditions, and work schedules (`personnel-<orgId>`, P1-03/P1-04).
- Vacation requests (`vacation-<orgId>`, P1-06).
- Scoped responsibility configurations, assignments, and substitutes (`responsibilities-<orgId>`, P1-05).
- Organization holiday/closure context (`organization-calendar-<orgId>` plus the settings tag, P1-04).
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
- `employee_records`
- `employment_conditions`
- `work_schedules`
- `organization_closure_days`
- `vacation_requests`
- `sickness_reports`
- `attention_read_states`
- `attention_events`
- `organization_responsibility_configurations`
- `organization_responsibility_assignments`
- `organization_responsibility_delegations`
- `clients`
- `client_contacts`
- `client_sites`
- `client_requests`
- `client_follow_ups`
- `client_communication_settings`
- `client_communication_preferences`
- `jobs`
- `projects`
- `job_assignments`
- `job_instruction_items`
- `planning_series`
- `planning_occurrences`
- `planning_occurrence_assignments`
- `planning_dispatches`
- `planning_dispatch_recipients`
- `planning_dispatch_acknowledgements`
- `planning_customer_commitments`
- `work_blockers`
- `work_dependencies`
- `work_artifacts`
- `work_handover_packages`
- `job_instruction_evidence_fulfillments`
- `documents`
- `document_links`
- `inventory_stock_levels`
- `job_material_lines`
- `inventory_movements`

Most subscriptions are scoped by `organization_id`. Profile updates are broader because profile data may be referenced across organization/member views.

Events are debounced inside the provider to avoid refresh storms when multiple related rows change quickly.

The three P1-05 responsibility tables, the P1-06 `vacation_requests` table, and the P1-08 `sickness_reports` table use the full Realtime integration contract: publication, the provider table union/`TABLES` subscription, `use-realtime-router-refresh.ts`, and replica identity full so organization-filtered DELETE events retain their filter column. The append-only audit tables (`sickness_report_events` included) are not subscribed, matching other per-domain audit logs — with one deliberate P1-07 exception: `attention_events` is published so a future consumer can react to pattern-level facts, and `attention_read_states` is subscribed so read markers set on one device update badges everywhere. The vacation widget, approver queue, and calendar absence entries refetch on `vacation_requests` events with generation guards and keep last-known data on transient failures; the sickness sections (dashboard, member detail) and the neutral calendar absence entries do the same on `sickness_reports` events. Vacation decisions and sickness mutations are always re-authorized server-side at action time. Sickness reads follow the attention posture — live action queries, no `unstable_cache` consumer yet (the `sickness` cache tag exists for symmetry and is invalidated on every write).

P1-07's unified attention counts replace the former time-only pending-approval pipeline: `components/realtime/attention-count-provider.tsx` is the ONE counting pipeline behind the sidebar badges (Aufgaben = actionable + unread, Zeiterfassung = approvals), the Anträge tab badge, and the member quick stats. It refreshes on `time_entries`, `entry_change_requests`, `vacation_requests`, `sickness_reports` (P1-08), `client_requests`, `client_follow_ups` (P1-10), `attention_read_states`, and the responsibility tables, debounced with a generation guard and keep-last-known behavior. The `/aufgaben` surface itself refetches on the same events. Attention data is deliberately NOT `unstable_cache`d and has no cache tag: every read is a live action query derived from the owning domains, because a stale "nothing to do" claim is worse than the query cost, and the expensive loaders early-return when their pending sets are empty (the steady state).

P1-10 adds `client_follow_ups`, `client_communication_settings`, and `client_communication_preferences` to the operational publication/provider contract with replica identity full. Their append-only event tables stay unpublished. Customer detail route refreshes also listen to the previously published `client_contacts`, `client_sites`, and `client_requests` callbacks; P1-10 fixed the pre-existing gap where those tables existed in the central provider but the generic router-refresh hook never registered them. Follow-up events refresh the unified attention-count provider and `/aufgaben`; preference/settings changes refresh the customer relationship view. The resolver remains a live bounded action query and invalidates the existing organization client tag after writes; no generic timeline cache or copied timeline table exists.

P1-11 publishes `planning_series`, `planning_occurrences`, and `planning_occurrence_assignments`, all with replica identity full, because schedule and assignment coordination must update active calendars across users. The router-refresh hook batches those callbacks with the existing job/assignment refresh path. Append-only `planning_occurrence_assessments` and `planning_events` remain unpublished: their manager-only history is loaded deliberately rather than producing duplicate refreshes for every atomic planning mutation. A single mutation can touch a series, several occurrences, assignments, assessments, the legacy job projection, and its job assignments; provider debouncing is therefore part of the correctness/performance contract rather than optional polish.

P1-12 publishes `planning_dispatches`, `planning_dispatch_recipients`, `planning_dispatch_acknowledgements`, and `planning_customer_commitments`, all with replica identity full: an employee's device must learn of a new or superseded work instruction, the manager Einsätze panel must see acknowledgements/challenges live, and commitment context must stay fresh across office users. P1-14 replaced the former parking tables with `work_blockers`; the old tables are no longer publication members. The append-only dispatch and commitment ledgers stay unpublished. The Einsätze panel and employee „Mein Einsatz" card refetch through one shared 150 ms debounce per surface; the unified attention-count provider and `/aufgaben` additionally refresh on dispatch and blocker changes. Dispatch reads follow the attention posture (live action queries, no `unstable_cache`); mutations revalidate `/kalender`, `/aufgaben`, and the jobs tag.

P1-13 publishes the mutable template/version/content/application/origin tables with replica identity full and organization filters. Manager template lists and work-detail consumers refetch through the central debounced provider; open registry dialogs suspend route refresh and receive one queued catch-up after close. Append-only `work_template_events` stays unpublished. Template reads use the `work-templates-<orgId>` tag; mutations invalidate it plus the existing jobs, inventory and qualification tags affected by materialization. Application does not subscribe or invalidate calendar/dispatch/time domains because it creates no schedule, dispatch or actual-time fact.

P1-14 publishes `work_blockers` and `work_dependencies` with replica identity full. Their append-only event tables and `work_execution_events`/instruction-completion events stay unpublished. Job/project detail cards subscribe through the central provider and preserve open dialogs by surfacing a catch-up control instead of replacing input. Blocker changes also refresh the one attention-count and `/aufgaben` pipeline. Mutations reuse the existing organization-scoped jobs/projects tags and revalidate `/auftraege`, `/kalender`, `/aufgaben`, and `/mitarbeiter`; no lifecycle-specific cache duplicates the work sources.

P1-15 publishes only current `work_artifacts` and active `job_instruction_evidence_fulfillments`, both with replica identity full. Immutable revisions, type details, document/source relations and action ledgers stay unpublished. Job/project detail uses the central dialog-safe catch-up behavior; artifact review, correction and due-defect changes also refresh the unified attention pipeline. Mutations reuse jobs/projects, documents and responsibilities tags and routes rather than adding an artifact cache.

P1-16 composes the assigned worker's field pack from these existing live sources without adding a cache, copied pack, or publication member. Server rendering loads the independent customer/site, dispatch, lifecycle, instruction, artifact, document, time, material, blocker, and bounded project projections in parallel. Route refresh covers assignment, planning, dispatch-root, instruction, document, artifact-root, time, blocker, and dependency changes. The employee material section performs a narrower debounced refetch for `job_material_lines`, `inventory_movements`, and `inventory_stock_levels`, keeps the last confirmed state during a transient failure, and ignores an older response after a newer generation starts. Open dialogs use the shared suspension and queued catch-up behavior so Realtime cannot discard typed input. Immutable `planning_dispatch_revisions`, `work_artifact_revisions`, and `work_artifact_actions` remain unpublished because their owning root-row mutations already signal the required refresh.

P1-17 publishes only the mutable `work_handover_packages` root with replica identity full. Immutable releases, draft/release membership and append-only events remain unpublished; every accepted package mutation updates the root, which signals one authoritative refetch of the complete server-projected state. Handover detail and the unified attention pipeline consume that signal through the central 150 ms debounce, generation guards, focus/visibility catch-up, keep-last-known stale state and shared dialog suspension. Package mutations reuse jobs/projects, documents and responsibility invalidation; preview remains side-effect free and creates no parallel cache.

## Refresh Patterns

The app uses two main Realtime response patterns:

- Refresh the route with `router.refresh()` when server-rendered data should be reloaded.
- Fetch or update local client state for focused interactive views, such as live job lists, calendar details, approval counts, or clock state.

Use `hooks/use-realtime-router-refresh.ts` when a component should refresh the current route after one of several Realtime table changes.

Use `useRealtimeEvent()` directly when a component can update a narrower local state without refreshing the entire route.

## Client Freshness Contract

Standardized 2026-08-27 from the race classes P1-16 exposed and fixed one by one. New surfaces follow these rules instead of re-deriving refresh behavior; a surface that deviates recreates a documented defect class (see the refresh-race notes in [testing.md](testing.md)).

1. **The provider owns subscriptions.** Components consume `useRealtimeEvent()` or `hooks/use-realtime-router-refresh.ts`; they do not open their own channels. Table events are debounced 150 ms in the provider. A component with a narrower refetch uses the same 150 ms boundary, never a shorter one — a shorter debounce raced server cache invalidation in P1-16 and produced stale reads. *Enforced (Tier 2): `eslint.config.mjs` bans `.channel(` and `onAuthStateChange` outside the provider.*
2. **Focus and visibility catch-up are provider concerns.** Returning to a tab or window triggers one coalesced catch-up refresh; components must not register competing focus/visibility listeners. *Enforced (Tier 2): `eslint.config.mjs` bans `addEventListener('visibilitychange'|'focus')` outside a frozen legacy allowlist (`attention-count-provider`, `organization-context`, `use-active-jobs`, `use-business-day-refresh`, `use-member-status-polling`) that the Realtime consolidation may shrink and nothing may grow.*
3. **Server props are mount-time data for live components.** A component that maintains live client state from its own reader treats route-refresh payloads as initial data only; after mount, its subscriptions and explicit refetches are authoritative, and a later stale route payload must not overwrite a newer client read. Key such components by entity id so navigation remounts them cleanly.
4. **Mutations refresh route-first, then refetch.** Start `router.refresh()` and finish with the authoritative client refetch; the reverse order let a stale server payload overwrite the fresh read (the P1-16 dispatch-challenge race).
5. **Refetches use generation guards and keep-last-known.** An older response never overwrites a newer generation; a transient failure marks content visibly stale — and non-interactive where actions depend on it — instead of clearing it.
6. **Dialogs suspend, then catch up once.** Open dialogs suspend disruptive route refreshes through the shared open-dialog context (`components/ui/open-dialog-context.tsx`) and receive exactly one queued catch-up after close. Pending/double-submit state binds to the actual server call, never to a router transition — a router-entangled `useTransition` kept controls disabled after unrelated refreshes (the P1-16 `MetadataSection` fix).

Legacy surfaces that predate this contract are brought onto it opportunistically. During slice work, treat a deviation that produces one of these races as a candidate product defect, not test flakiness.

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

Before adding a new table to Realtime:

- Confirm the UI really needs live updates.
- Scope events by organization whenever possible.
- Consider whether route refresh or local state update is better.
- Debounce or batch reactions if one user action changes multiple rows.
- Keep field-worker views simple and avoid noisy UI changes.

Inventory stock levels, job material lines, and inventory movements already use Realtime because several users may change the same operational material state.

## Freshness Principles

- Prefer fast initial page loads with server-rendered data.
- Prefer explicit invalidation after writes over broad cache disabling.
- Prefer live updates for operational data that users coordinate around.
- Do not add polling unless Realtime is not appropriate.
- Treat exact database state as coming from live Supabase and generated types, not docs.
