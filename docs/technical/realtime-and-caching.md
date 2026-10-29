# Realtime and caching

This doc owns virtue 2 in `AGENTS.md`: immediate feedback, complete reads, caching and freshness. [Performance](performance.md) owns the measurement.

## How to work

Decide the feedback, the freshness and the read shape before you write the component.

### Add a mutation

1. Write the Server Action in its domain's `actions.ts`: parse the input, [establish the caller and the permission](security.md#add-a-server-action-or-route-handler), then write ([related rows in one call](code-quality.md#write-related-rows)). Use the admin client only when RLS cannot express the write.
2. Call `updateTag()` only for a `CACHE_TAGS` entry that a cached reader of the changed data carries. Otherwise call no tag function.
3. Pick the first-frame feedback from the pending-feedback matrix in the `werkflow-design` skill: `useOptimisticList` for a list edit, `InlinePending` with `useBusyIds` for a row action, `usePendingTask` for several steps, the `isPending` of `useServerAction` otherwise. A flow that leaves the page ends with `untilPageLeaves()`.
4. Name every view that shows the changed rows. An action that revalidates (`revalidatePath`, `updateTag`, a cookie) renders the route into its own response: await the new props with `useSettleOnChange`, never `router.refresh()`. Otherwise start `router.refresh()`. Finish with `view.refresh()`, or pass the view's read as the `settle` option of `useServerAction`. The own write never waits for Realtime.
5. Name the sessions that must see the change. The changed table is published, or the mutation touches a published owning root.
6. Write a contract that holds the write open with `holdWrite` and checks the screen before and after the answer, as `tests/ui-contracts/team-qualifications.spec.ts` does. Run `bun run test:ui tests/ui-contracts/<file>.spec.ts`.

Wrong turn: a button that waits for the server, or pending state from a router transition. The user sees nothing for a round trip, and a transition stays pending through unrelated refreshes.

### Add Realtime data

1. Confirm that the UI needs live updates and that a route refresh does not serve better.
2. In the migration: add the table to the `supabase_realtime` publication, publish INSERT and UPDATE only, create the unique `(id, organization_id)` index `<table>_replident_idx` (unless a unique constraint provides one), set `REPLICA IDENTITY USING INDEX` on it, and add the `emit_realtime_deletion` trigger as `20260907010200_private_realtime_deletions.sql` does.
3. Add the table to `REALTIME_TABLES` in `lib/realtime/tables.ts`. Run `bun run realtime:check`; it fails until the migration and the list agree.

Wrong turn: publishing a ledger or a link table. Publish the mutable owning root, so one row signals one authoritative read.

### Add a list

1. A list a person pages through is server-paginated. Copy `lib/requests/list-page.ts` and `lib/requests/list-page-server.ts`: the URL state, then a service-only paging function (`list_request_page`) that applies search, filters, counts and order before the page boundary.
2. A reader that needs every row reads through `readAllRows` or `readCompleteRows` and shows the overflow as a failure.
3. Send every organization-sized id list through `readInBatches`.
4. A picker of an organization-sized kind passes the whole `useJobEntityOptions` result to the registry select. A new need adds a kind or purpose in `lib/jobs/option-types.ts`, never a preloaded array.
5. For a paging or search function, run `bun run test:verify --group sql:list-pagination`.

Wrong turn: one `.select()` without pages. PostgREST cuts the response at its cap without an error, and the gateway rejects a long `.in()` query string.

### Add a reader

1. Read per request. Wrap repeated work of one render in `react.cache()`. A GET handler uses `withReadRequest` ([security](security.md#read-request-authorization-reuse)).
2. Cache across requests only when every condition under [cross-request caching](#cross-request-caching) holds. Tag the reader with a `CACHE_TAGS` entry and throw through `failCachedRead` on a failed read.
3. A read that starts on mount, on channel join or beside a save is a kind in `lib/data/background-reads.ts`. A kind that names no record, or signs a file address, carries `organizationId`. A read by id relies on the reader's organization filter. A prestart member's own-item read sits in `SELF_SERVICE_READS`.
4. Run `bun run test:unit lib/data lib/conventions/live-view-reads.test.ts`.

Wrong turn: a Server Action for a background read. One client's actions run one after another, so the read delays the next save.

### Add a live view

1. Use `useRealtimeRouterRefresh({ tables })` when server props stay the authority, `useLiveView({ tables, read })` when a client view owns the data.
2. Seed the view with `initialData` and key the component by entity id.
3. On a failed read, wrap the rows and their actions in `StaleRegion` while `isStale` is true.
4. Build every dialog on the registry's `Dialog`, `AlertDialog` or `Sheet`, so reads suspend while it is open.

Wrong turn: a channel, an interval or a focus listener of your own. It races the shared debounce.

## Checklist

- One save is one route render: no client refresh follows a revalidating Server Action (`tests/golden/route-renders.json`).
- A list edit appears at once through `useOptimisticList` and leaves the list only after an authoritative read confirms it. Until then its row carries `data-unconfirmed` and `aria-busy`; `<html data-unconfirmed-layer>` covers a removal.
- Success shows only after the write is accepted. Failure keeps the input and offers retry.
- A saved result reaches every view that shows it, and another session within the live target.
- Any read of an organization-sized table or set-returning function has a page boundary, a limit or a reviewed bound. An id list in a PostgREST filter string (`.not`, `.filter`, `.or`) is a literal or a reviewed bounded site.
- A picker of an organization-sized kind searches on the server one page at a time, keeps the selected records, offers „Erneut laden“ after a failed read, and orders numbers naturally in the database.
- Every background-read kind answers 401 without identity and 403 for a foreign organization.
- Client state adopts new server props during render, never in an effect: inside a hydrated Suspense boundary the effect can starve behind a route transition. Seed clock state in render and tick in an effect. A settled page's main thread goes idle.
- The authenticated layout waits for identity, organization and profile only.
- A reader that runs on every event of every session pins its queries per role and reads in proportion to the pending work, never the closed history.

## Never

- Wait for the network before you acknowledge an action, or raise a pending flag by hand outside `HAND_PENDING_STATE`.
- Bind pending state to a router transition: no `useTransition` and no async `startTransition` callback. Recorded exceptions: `RefreshButton`, and the document library's navigation.
- Poll. The one interval is the wall-clock tick in `hooks/use-wall-clock-tick.ts`.
- Show a toast. Feedback goes through `Banner` and the inline states.
- Truncate a list silently, or turn an overflow or a failed related read into an empty list.
- Pass an organization-sized list to `.in()`.
- Invalidate a tag that no cached reader carries.
- Cache a permission fact across requests.
- Shorten `REALTIME_DEBOUNCE_MS`, give a surface its own debounce, or close a dialog or refresh after a save behind a timer.
- Raise a budget, a reference, a ceiling or a timeout to make a slow build pass.
- Reopen a rejected performance hypothesis without new measured evidence: widening `REALTIME_DEBOUNCE_MS` or the two-second target, pointing HTTP clients at pooler URLs, treating `async` as CPU offload, indexing every filter, caching every read, removing fallbacks, and adding Broadcast, polling or read replicas without a measured need.

## Verify your work

1. Run `bun run test:unit`, `bun run test:ui`, and each lab or wall-clock group `bun run test:plan` names ([performance](performance.md#how-to-work)).
2. Look at the change in the browser: the first frame after the click, the confirmed state, a failed write, and a second signed-in session.
3. Record in the slice record whether a new reader may be cached across requests, with the reason.

## Caching layers

### Cross-request caching

Use `unstable_cache()` with tags, or `'use cache'` with `cacheTag()` when a whole function result is the cache unit. Cache a reader across requests only when all of these hold:

- Its key holds every identity the result depends on, such as the user id or the organization id.
- It runs without a cookie-bearing database client.
- Its result is not a permission fact. Membership, role, lifecycle, access blockers and responsibilities are read fresh on every request.
- Every write that changes the result invalidates the reader's tag.
- A failed read throws. It never caches an empty or default result.
- The surface does not need the live value. Calendar windows, list pages and attention derivations read per request after authorization.

A cache hit is never an authorization proof. `CACHE_TAGS` in `lib/data/cached.ts` is the one list of tag names. A route handler calls `revalidateTag(tag, 'max')`, because `updateTag()` works only inside a Server Action.

### Permission facts

`loadMembershipCandidates` shares membership facts only within one GET request or one React render. Every approval action reloads the responsibility configuration with the current server time and Berlin business date, so a stale render around midnight never extends an expired substitute's authority.

### Backend request capacity

One scheduler per server process (`lib/supabase/request-scheduler.ts`) caps concurrent Supabase fetches and reserves part of that capacity for foreground work. A GET handler that serves optional shell or section data passes `{ priority: 'background' }` to `withReadRequest`.

## Server-paginated lists

A server-paginated list selects and counts the matching identities in the database before it fetches page rows.

- Search, filters, aggregate counts and deterministic order apply before the page boundary. Slicing a complete organization in the client is not server pagination.
- A record number such as `ANL-2026-1000` orders by prefix, year and numeric sequence, never as text. A reader that sorts in TypeScript uses `compareRecordNumbers` in `lib/format/record-number.ts`. A `.range` or `.limit` on a text-ordered number column picks the wrong records before any sort.
- The paging functions are service-only and receive an already-authorized organization (for jobs, also role and identity). Joined tenant tables stay organization-scoped.
- Document link predicates use database existence checks, never an organization's link ids as a URL filter.

## Complete lists

A picker receives its whole list only when the list is bounded by nature: the members and employees of one company, teams, capability definitions, inventory categories and locations, document folders, published work templates, follow-up and responsibility owners, the sites, contacts and equipment of one customer, and the documents of one job. Inventory suppliers come whole up to 1,000 and fail visibly above. Every other picker searches through the `'entity-options'` background read when it opens.

## Realtime model

- The transport is `postgres_changes` on one channel per organization. `components/realtime/realtime-provider.tsx` owns the channel and binds every table in `REALTIME_TABLES`.
- Events are invalidation signals that never authorize a record read. A client-supplied organization filter is no authorization boundary.
- Published tables use `REPLICA IDENTITY USING INDEX` on `(id, organization_id)`. `realtime:check` rejects FULL identity.
- Supabase applies RLS to INSERT and UPDATE events but not to raw DELETE events, so the publication carries INSERT and UPDATE only. Triggers insert minimal rows into `realtime_deletions`, whose SELECT policy checks current membership. The provider turns a permitted notification into a DELETE invalidation with only `id` and `organization_id`. Notifications expire and are no replay log. Application and publication changes roll out together.
- Each feature publishes the mutable rows that signal a new authoritative read. Immutable revisions, links and ledgers stay unpublished and touch an owning root ([data model](data-model.md)). A published row never becomes a second cache. A provider mounted on every page filters events to the rows it shows.
- The one exception to the raw-event ban is the project-detail delete-exit watcher, which needs the event itself.

## Refresh patterns

### Reads outside the Server Action queue

A client runs its Server Actions and router refreshes one after another, so a read on mount, on join or beside a save uses a GET handler.

- `lib/data/background-reads.ts` is the closed registry of background readers. Each kind pairs an input schema with a reader that keeps its own membership and subject checks. A new kind is a new public read endpoint: follow [security](security.md#read-request-authorization-reuse) first.
- Every such GET authenticates the session, requires the requested organization to equal the active one, and returns a private, non-cacheable response.

### Live list pages

A paginated live list uses one server reader for its first render and its GET refresh. A same-scope event during a read queues one follow-up. A confirmed creation leaves the overlay only after a read that started after the confirmation.

### Range-scoped data owner

A surface that reads a window of data owns it through one typed range state. The calendar builds on `useLiveView` and `lib/calendar/range-data.ts`.

- The reducer rejects a response with a foreign scope or an obsolete generation. Only a committed read confirms a local edit; the server's answer does not.
- Returning to a covered window cancels a read for another window. A cancelled catch-up or settlement read is replaced by a read of the covered window (`lib/calendar/window-read-plan.ts`).
- Readiness is derived per window, never stored. An uncovered window keeps the grid mounted and inert while other data exists; the skeleton shows only when a required dataset has no data. Old data never covers dates it was not read for.
- All datasets of one window commit together. One failed read fails the window and shows `SectionError` with retry.
- A calendar mutation holds the shared mutation owner until it settles, rollback and failed Undo included; navigation, refresh and Realtime queue behind it. Confirmation and Undo appear only after persistence. Repeated moves of one entry persist in gesture order; when an earlier write fails, the owner drops the dependent gestures and restores the last confirmed position visibly.

## Client freshness contract

The contract is the behavior of the two live-view hooks. A surface does not re-implement it. ESLint messages cite these rules by number.

1. **The provider owns subscriptions.** Components consume the hooks and open no channels. Each hook owns one shared debounce across its tables. The recorded `onAuthStateChange` exception is `app/**/reset-password-form.tsx`, which must react to `PASSWORD_RECOVERY`.
2. **Focus and visibility catch-up belong to the provider.** A return to the tab after a minimum absence dispatches one coalesced catch-up. A shorter absence dispatches nothing, because the open socket delivered every event. A reconnect always catches up.
3. **Server props are mount-time data for live components.** `initialData` seeds the first paint; after mount the reader is authoritative. Key a live component by entity id, or pass `resetKey` where a remount is not an option.
4. **Mutations refresh route-first, then refetch.** Start `router.refresh()` and finish with `view.refresh()`. In the reverse order a stale server payload overwrites the fresh read.
5. **Refetches use generation guards and keep the last known data.** An older success never commits over a newer one. A failed read keeps the data and sets `isStale`. Dependent actions stay inert while the view is stale.
6. **Dialogs suspend, then catch up once.** Open dialogs, sheets and dropdown menus suspend reads and route refreshes through `components/ui/open-dialog-context.tsx`; one catch-up fires after close. Render `RegisterOpenDialog` inside the presence-gated content, never in a wrapper body, or every closed dialog counts as open. A held catch-up sets `<html data-live-read-held>`.
7. **The own save's echo renders nothing**, because its response rendered the route. A save runs through `ownWrites.track`. The route refresh skips an event of a row the save named whose `updated_at` it returned, and holds a stamped event for a running save, at most `OWN_SAVE_HOLD_MS`.

An `eventFilter` that inspects payload columns treats a missing column as relevant, because a deletion notification carries only `id` and `organization_id`. Synthetic catch-up events bypass every filter.

Connection catch-up runs after database readiness, not after channel join: the database listener can start after the `SUBSCRIBED` callback, and a read at join cannot cover a write in that gap. The provider dispatches synthetic invalidations when the `system` message reports `postgres_changes` ready. A read counts as recovery only when it has the same scope and window and started after that invalidation. A view that subscribes after readiness gets its catch-up then (`lib/realtime/listener-registry.ts`).

## Latency targets

- A change in one session is visible in another signed-in session within two seconds (`LIVE_TARGET_MS` in `lib/testing/responsiveness-tolerance.ts`).
- The time-correction dialog reaches usable form options within five seconds of opening (`TIME_CORRECTION_READY_MS`). This target applies to that dialog only.

[Testing](testing.md#deadlines-and-measured-scenarios) owns how these targets are measured.

### Shared layout and clock readiness

Optional shell reads, such as the clock, active jobs and attention counts, never block page content or a route refresh. An absent clock response is unknown state, not a clocked-out session. The clock provider is ready only after a successful read for the current organization; its controls stay disabled with retry until then.

## Organization switch confirmation

The organization provider publishes a new active organization only after the cookie write completes, and keeps its switch lock until matching server props arrive. A rejected write keeps the current scope with visible failure.
