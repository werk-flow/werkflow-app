# Realtime and caching

Status: living — last reviewed 2026-10-08

This doc owns virtue 2 in `AGENTS.md`: immediate feedback, complete reads, caching and freshness. The app renders on the server, caches a few identity-keyed reads behind tags, and treats Realtime events as signals to read again.

## How to work

Decide the feedback, the freshness and the read shape before you write the component.

### Add a mutation

1. Write the Server Action in its domain's `actions.ts` in this order: parse the input, then [establish the caller and the permission](security.md#add-a-server-action-or-route-handler), then write. Rows that change together change in one database function call ([write related rows](code-quality.md#write-related-rows)). Use the admin client only when RLS cannot express the write.
2. Call `updateTag()` only for a `CACHE_TAGS` entry that a cached reader of the changed data carries. Otherwise call no tag function.
3. Pick the first-frame feedback from the pending-feedback matrix in the `werkflow-design` skill: `useOptimisticList` for a list edit, `InlinePending` with `useBusyIds` for a row action, `usePendingTask` for a flow of several steps, the `isPending` of `useServerAction` otherwise. A flow that leaves the page ends with `untilPageLeaves()`.
4. Name every view that shows the changed rows. An action that revalidates (`revalidatePath`, `updateTag`, a cookie) renders the route into its own response: await the new props with `useSettleOnChange`, never a `router.refresh()`. Otherwise start `router.refresh()`. Finish with `view.refresh()`, or pass the view's read as the `settle` option of `useServerAction`. The own write never waits for Realtime.
5. Name the sessions that must see the change. The changed table is published, or the mutation touches a published owning root.
6. Write a contract that holds the write open with `holdWrite` and checks the screen before and after the answer, as `tests/ui-contracts/team-qualifications.spec.ts` does. Run `bun run test:ui tests/ui-contracts/<file>.spec.ts` and `bun run test:unit lib/conventions/cache-tags.test.ts`.

Wrong turn: a button that waits for the server, or pending state from `useTransition`. The user sees nothing for a round trip, and a transition stays pending through unrelated refreshes.

### Add Realtime data

1. Confirm that the UI needs live updates and that a route refresh does not serve better than a client view.
2. In the migration, add the table to the `supabase_realtime` publication, create the unique `(id, organization_id)` index `<table>_replident_idx` unless a unique constraint on those columns already provides one, set `REPLICA IDENTITY USING INDEX` on it, and add its `emit_realtime_deletion` trigger as `20260907010200_private_realtime_deletions.sql` does. Publish INSERT and UPDATE only.
3. Add the table to `REALTIME_TABLES` in `lib/realtime/tables.ts`, and run `bun run realtime:check`. It fails until the migration and the list agree.

Wrong turn: publishing a ledger or a link table. Publish the mutable owning root, so that one row signals one authoritative read.

### Add a list

1. A list a person pages through is server-paginated. Copy `lib/requests/list-page.ts` and `lib/requests/list-page-server.ts`: the URL state, then a service-only paging function (`list_request_page`) that applies search, filters, counts and order before the page boundary.
2. A reader that needs every row reads through `readAllRows` or `readCompleteRows` and shows the overflow as a failure.
3. Send every organization-sized id list through `readInBatches`.
4. Run `bun run test:unit lib/conventions/id-list-batches.test.ts lib/ui/list-pagination.test.ts`. For a paging function, run `bun run test:verify --group sql:list-pagination`.

Wrong turn: one `.select()` without pages. PostgREST cuts the response at its cap without an error, and rows vanish.

### Add a reader

1. Read per request. Wrap repeated work of one render in `react.cache()`.
2. Cache across requests only when every condition under [cross-request caching](#cross-request-caching) holds. Tag the reader with a `CACHE_TAGS` entry, and throw through `failCachedRead` on a failed read.
3. A read that starts on mount, on channel join or beside a save is a kind in `lib/data/background-reads.ts`. Read [read-request authorization reuse](security.md#read-request-authorization-reuse) first.
4. Run `bun run test:unit lib/data lib/conventions/live-view-reads.test.ts`.

Wrong turn: a Server Action for a background read. One client's actions run one after another, so the read delays the next save.

### Add a live view

1. Use `useRealtimeRouterRefresh({ tables })` when server props stay the authority, and `useLiveView({ tables, read })` when a client view owns the data.
2. Seed the view with `initialData`, and key the component by entity id.
3. On a failed read, keep the rows and render dependent actions inert while `isStale` is true.
4. Build every dialog on the registry's `Dialog`, `AlertDialog` or `Sheet`, so that reads suspend while it is open.
5. Run `bun run lint <files>`.

Wrong turn: a channel, an interval or a focus listener of your own. It races the shared debounce and the provider's catch-up.

### Decide on a measured scenario

1. Add one for a step that people repeat many times a day, a view switch over a large window, or a change that another session waits for.
2. Register it in the `audit:performance:*` group whose scopes cover the area, with the budget of its boundary ([testing](testing.md#deadlines-and-measured-scenarios)).
3. Record the decision and its reason in the slice record.

### Check for a regression while you work

1. After each change to an action, a reader or a live view, run its pending-feedback contract with `bun run test:ui`.
2. Run `bun run test:plan`. It names each measured group whose scopes own a changed file, with the command to run it. Before the change is done, serve the build with `bun run test:server local` and run that group: `bun run test:verify --group audit:performance:<name>`.
3. Open the change in two signed-in sessions and watch the second one.

Wrong turn: leaving the measurement to the release run. By then other changes hide the cause.

## Checklist

A `[judgment]` item is a Tier 3 default: diverge only with the note that `AGENTS.md` describes under "How to read the virtues".

- An action shows pending feedback in its first frame through an owner hook: `useServerAction` for one action, `usePendingTask` for several steps, `useBusyIds` for a row, `untilPageLeaves()` when the page leaves. The field worker's clock tap is measured. [code `hooks/use-server-action.ts`, code `hooks/use-busy-id.ts`, test `lib/conventions/server-action-feedback.test.ts`, test `lib/ui/until-page-leaves.test.ts`, group `ui:contracts`, group `audit:performance:field`]
- One save is one route render: no client refresh follows a revalidating Server Action, and each counted save stays at its entry in `tests/golden/route-renders.json`. [test `lib/conventions/route-render-owner.test.ts`, test `lib/testing/route-render-count.test.ts`, group `golden:p1-01`, group `audit:wave-1:a1-inventar`]
- A list edit appears at once through `useOptimisticList` and leaves the list only after an authoritative read confirms it. Until then its row, card or surface carries `data-unconfirmed` and `aria-busy` from the registry primitive, and `<html data-unconfirmed-layer>` covers a removal. Content that is not confirmed never looks confirmed to a test or a screen reader. [code `hooks/use-optimistic-list.ts`, code `lib/ui/unconfirmed.ts`, test `lib/ui/optimistic-overlay.test.ts`, test `lib/ui/change-settlement.test.ts`, test `lib/conventions/unconfirmed-marker.test.ts`, group `ui:contracts`]
- Success shows only after the write is accepted. Failure keeps the user's input and offers retry. [group `ui:contracts`, judgment]
- A saved result reaches every view that shows it, and another signed-in session within the live target. The measured scenarios cover the calendar and the time approval; for any other flow the reviewer checks a second session in the browser. [group `audit:performance:calendar-live`, group `audit:performance:field`, judgment]
- A live surface consumes Realtime through `useLiveView` or `useRealtimeRouterRefresh`, never a channel, an auth listener or a focus listener of its own. [lint `realtimeSelectors`, lint `channelSelector`, lint `authListenerSelector`, lint `visibilitySelector`, lint `focusSelector`, lint `importRestrictions`]
- A new published table is registered in the migration and in `REALTIME_TABLES`, with its deletion trigger. [script `realtime:check`, group `sql:security`]
- A reader that needs a whole collection reads it in ordered pages through `readAllRows` or `readCompleteRows` and reports an overflow as a failure. [code `lib/supabase/query-batches.ts`, group `sql:list-pagination`]
- An organization-sized id list goes through `readInBatches`. [test `lib/conventions/id-list-batches.test.ts`]
- An id list written into a PostgREST filter string (`.not`, `.filter`, `.or`) is a literal or a reviewed bounded site. [test `lib/conventions/id-list-string-filters.test.ts`]
- A server-paginated list applies search, filters, counts and order before the page boundary. [group `sql:list-pagination`, test `lib/ui/list-pagination.test.ts`, group `audit:list-pagination`]
- A picker that offers records by number selects its window in natural number order in the database. [group `sql:list-pagination`]
- A reader cached across requests meets every condition under [cross-request caching](#cross-request-caching). A failed read, in any product module, goes through `failCachedRead` and throws `CachedReadError`, so it is never stored. [judgment, test `lib/data/membership-freshness.test.ts`, test `lib/data/cached-read-failures.test.ts`]
- An invalidation names a `CACHE_TAGS` entry that a cached reader carries. [test `lib/conventions/cache-tags.test.ts`]
- A read that starts on mount or beside a save goes through the background-read registry, not the Server Action queue. [test `lib/data/background-read-http.test.ts`, test `lib/conventions/live-view-reads.test.ts`]
- Client state adopts new server props during render, never in an effect. Inside a hydrated Suspense boundary a mount effect runs at idle priority; its update starves behind a pending route transition, React rebases every later functional update into a new value on each render, and an effect keyed on that value commits forever. After a page settles, its main thread goes idle. [lint `ui/no-derived-state-effect`, test `tests/ui-contracts/hydration-settle.spec.ts`, group `audit:layout`, judgment]
- The authenticated layout waits for identity, organization, profile and subscription only. Optional shell reads load in their own providers. [test `lib/ui/app-layout-runtime.test.ts`]
- A reader that runs on every event of every session pins its queries per role, and a page runs one derivation. [test `lib/attention/count-reads.test.ts`]
- Sidebar links prefetch on intent only. [test `lib/ui/sidebar-prefetch.test.ts`]
- A new flow whose speed matters gets a measured scenario: a step that people repeat many times a day, a view switch over a large window, or a change another session waits for. The reviewer names the flow and the decision in the slice record. [judgment]

## Never

- Wait for the network before you acknowledge an action, or write pending state by hand. The shared hooks show feedback at once, and a held-write contract proves it for each mutation that has one. A client write outside an owner hook or an optimistic change fails a convention test, and so does a hand-raised pending flag outside `HAND_PENDING_STATE`. [code `hooks/use-server-action.ts`, code `hooks/use-optimistic-list.ts`, test `lib/conventions/server-action-feedback.test.ts`, group `ui:contracts`]
- Bind pending state to a router transition: no `useTransition` and no async `startTransition` callback in product code. [lint `transitionSelectors`, lint `asyncTransitionSelectors`]
- Poll. `setInterval` is banned in product code. [lint `pollingSelectors`]
- Show a toast. Feedback goes through `Banner` and the inline states. [lint `sonnerImportPath`]
- Truncate a list silently, or turn an overflow or a failed related read into an empty list. [code `lib/supabase/query-batches.ts`, test `lib/conventions/read-error-visibility.test.ts`, judgment]
- Pass an organization-sized list to `.in()`. [test `lib/conventions/id-list-batches.test.ts`]
- Call `updateTag` or `revalidateTag` on a tag that no cached reader carries. [test `lib/conventions/cache-tags.test.ts`]
- Cache a permission fact across requests. [test `lib/data/membership-freshness.test.ts`]
- Shorten `REALTIME_DEBOUNCE_MS` or give a surface its own debounce. [lint `realtimeSelectors`, judgment]
- Raise a budget, a reference or a timeout to make a slow build pass. [group `audit:performance:<name>`, judgment]
- Reopen a rejected performance hypothesis without new measured evidence. The rejected ones are: widening `REALTIME_DEBOUNCE_MS` or the two-second target, pointing HTTP clients at pooler URLs, treating `async` as CPU offload, indexing every filter, caching every read, removing fallbacks, and adding Broadcast, polling or read replicas without a measured need. [judgment]

## Verify your work

These steps run once, on the final code. The in-work checks, including the measured group and the second session, belong to [check for a regression while you work](#check-for-a-regression-while-you-work).

1. Run `bun run test:unit` and `bun run test:ui`.
2. For a change to a list reader or a paging function, run `bun run test:verify --group sql:list-pagination`.
3. For a published table, run `bun run realtime:check`.
4. Look at the change in the browser: the first frame after the click, the confirmed state and a failed write.
5. Record in the slice record whether the flow needs a measured scenario and whether a new reader may be cached across requests, with the reason.

## Caching layers

### Request-level deduplication

Use `react.cache()` for repeated work within one Server Component render pass. GET handlers, where render caching does not apply, use the `withReadRequest` scope that [security](security.md#read-request-authorization-reuse) owns.

### Cross-request caching

Use `unstable_cache()` with tags, or the `'use cache'` directive with `cacheTag()` when a whole function result is the cache unit. A reader may be cached across requests only when all of these hold:

- Its key holds every identity the result depends on, such as the user id or the organization id.
- It runs without a cookie-bearing database client.
- Its result is not a permission fact. Membership, role, lifecycle, access blockers and responsibilities are read fresh on every request.
- Every write that changes the result invalidates the reader's tag.
- A failed read throws. It never caches an empty or default result.
- The surface does not need the live value. Calendar windows, list pages and attention derivations read per request after authorization.

The caller establishes identity and current permission before it uses the data. A cache hit is never an authorization proof. `CACHE_TAGS` in `lib/data/cached.ts` is the one list of tag names. A call on a tag without a reader invalidates nothing and re-renders the route inside the action response. `updateTag()` works only inside a Server Action. A route handler calls `revalidateTag(tag, 'max')`.

### Permission facts

`loadMembershipCandidates` shares membership facts only within one GET request or one React render. Every later request reloads membership, role, lifecycle and access blockers. Responsibility facts follow the same rule: every approval action reloads the stored configuration and uses the current server timestamp and the Berlin business date. A stale render around midnight can affect display freshness. It can never extend an expired substitute's authority.

### Sidebar prefetch

Sidebar and logo links prefetch only the destination under hover or keyboard focus. Viewport prefetch would re-read every visible sidebar route on each cache invalidation, competing with live updates.

### Backend request capacity

One scheduler per server process (`lib/supabase/request-scheduler.ts`) caps concurrent Supabase fetches and reserves part of that capacity for foreground work. Page rendering, Server Actions and calendar window reads run at foreground priority. A GET handler that serves optional shell or section data passes `{ priority: 'background' }` to `withReadRequest`. The fetch timeout includes time in the queue. The scheduler limits one process. It is not a connection pool, a rate limit or a provider capacity guarantee.

## Complete reads and id lists

PostgREST caps every response and truncates without an error. The gateway rejects a long `.in()` query string. A reader that needs a whole collection therefore reads ordered pages that end with an `id` tiebreaker, and above its declared cap it returns an overflow that the caller shows as a failure. An organization-sized id list goes through `readInBatches` and is never a reviewed bounded site.

## Server-paginated lists

A server-paginated list selects and counts the matching identities in the database before it fetches page rows. These rules apply:

- Search, filters, aggregate counts and deterministic ordering apply before the page boundary. Slicing a complete organization in the client is not server pagination.
- A generated record number such as `ANL-2026-1000` orders by prefix, year and numeric sequence, never as text. A reader that sorts in TypeScript uses `compareRecordNumbers` in `lib/format/record-number.ts`. A picker that offers a window of records by number selects that window in the database in the same order; a `.range` or `.limit` on a text-ordered number column picks the wrong records before any sort.
- The paging functions are service-only. They receive an already-authorized organization and, for jobs, the caller's role and identity. Every joined tenant table stays organization-scoped.
- Document link predicates use database existence checks. Never send a whole organization's link ids as a URL filter.

A list page is not the option catalog. Entity selectors search the whole permitted scope on the server and return one page of choices with an explicit continuation. Selected identities are loaded separately and stay selected across searches.

## Realtime model

### Transport posture

- The transport is `postgres_changes` on one channel per organization. The provider in `components/realtime/realtime-provider.tsx` owns the channel and binds every table in `REALTIME_TABLES`.
- Events are invalidation signals. They never authorize a record read. A client-supplied organization filter is not an authorization boundary.
- Published organization-scoped tables use `REPLICA IDENTITY USING INDEX` on `(id, organization_id)`. `bun run realtime:check` rejects FULL identity.

### Deletion transport

Supabase applies RLS to INSERT and UPDATE events but not to raw DELETE events. The publication therefore carries INSERT and UPDATE only. Database triggers insert minimal rows into `realtime_deletions`, whose SELECT policy checks current membership before delivery. The provider turns a permitted notification into a DELETE invalidation that holds only `id` and `organization_id`. A notification copies no business columns and grants no access. Notifications expire and are not a replay log. Application and publication changes roll out together.

### Domain invalidation ownership

Each feature chooses the mutable rows that signal a new authoritative read. Most immutable revisions, links and event ledgers stay unpublished, and their mutations touch an owning root. A published row must not become a second cache, task list or copied domain model. The [conceptual data model](data-model.md) explains root and history ownership. A provider mounted on every page filters events to the rows it shows.

## Refresh patterns

Every live surface consumes Realtime through one of two hooks. Neither takes a debounce option.

- `useRealtimeRouterRefresh({ tables })` refreshes the route when server-rendered data should reload. Server props stay the authority.
- `useLiveView({ tables, read })` owns a narrower client view. One reader is the authority.

The recorded exception to the raw-event ban is the project-detail delete-exit watcher, which needs the event itself. Both hooks schedule through one trailing scheduler: a burst produces one read, and `REALTIME_MAX_DEFER_MS` caps how long a stream can postpone it.

### Reads outside the Server Action queue

One browser client's Server Actions and router refreshes run one after another. A read that starts on mount, on channel join or beside a save must not occupy that queue. It goes through a GET handler:

- `lib/data/background-reads.ts` is the closed registry of readers a page may run in the background. Each kind pairs an input schema with a reader that keeps its own membership and subject checks. Adding a kind adds a public read endpoint. Follow [security](security.md#read-request-authorization-reuse) first.
- Every such GET authenticates the session, requires the requested organization to equal the active organization, and returns a private, non-cacheable response.
- Mutations keep their Server Actions and permission checks.

### Live list pages

A paginated live list reads through the same server reader for its first render and its GET refresh, so search, total and page selection stay database-owned. A same-scope event during a read queues one follow-up. A failed refresh keeps the rows, marks them stale and disables row actions while retry stays available. A confirmed creation leaves the overlay only after a successful read that started after the confirmation.

### Range-scoped data owner

A surface that reads a window of data owns that window through one typed range state. The calendar's owner builds on `useLiveView` and the pure state in `lib/calendar/range-data.ts`. These rules apply:

- Each dataset records its authoritative range, its newest request generation, its last outcome and whether it holds an unconfirmed local edit. The reducer rejects a response with a foreign scope or an obsolete generation. Only a committed read confirms an edit; the server's answer does not.
- A view that returns to a covered window before a read for another window lands cancels that read, so it cannot replace the covered data. A cancelled catch-up or settlement read is replaced by a read of the covered window, because that data predates the invalidation (`planRunningWindowRead` in `lib/calendar/window-read-plan.ts`).
- Readiness is derived per needed window and never stored. An uncovered window keeps the grid mounted and inert while data for another window exists, and shows the skeleton only when a required dataset has no data yet. A failed read shows `SectionError` with retry. Old data never counts as coverage of dates it was not read for.
- All datasets of one window commit together under one generation. One failed read fails the window.

The user's own calendar mutations show pending feedback before the write resolves, and Confirmation and Undo appear only after persistence. A mutation holds the shared mutation owner until it settles, including rollback, failed Undo and transport failure. Range navigation, manual refresh and Realtime queue behind it. Repeated moves of one entry persist in gesture order. When an earlier write fails, the owner discards the dependent queued gestures and restores the last confirmed position with visible feedback. This ordering covers job moves and their Undo. Resizing recorded time and parking have separate mutation paths that still need their own overlap assessment.

## Client freshness contract

The contract is the behavior of the two live-view hooks. A surface does not re-implement it. ESLint messages cite these rules by number.

1. **The provider owns subscriptions.** Components consume the hooks and open no channels. Each hook owns one shared debounce across its tables. Shorter waits raced server cache invalidation. The recorded `onAuthStateChange` exception is `app/**/reset-password-form.tsx`, which must react to `PASSWORD_RECOVERY`.
2. **Focus and visibility catch-up belong to the provider.** A return to the tab after a minimum absence dispatches one coalesced catch-up to every subscriber. A shorter absence dispatches nothing, because the open socket delivered every event. A reconnect always catches up.
3. **Server props are mount-time data for live components.** `initialData` seeds the first paint. After mount, the reader is authoritative. Key a live component by entity id, or pass `resetKey` where a remount is not an option.
4. **Mutations refresh route-first, then refetch.** Start `router.refresh()` and finish with `view.refresh()`. In the reverse order a stale server payload overwrites the fresh read.
5. **Refetches use generation guards and keep the last known data.** An older success never commits over a newer one. A failed read keeps the data and sets `isStale`. Render dependent actions non-interactive while the view is stale.
6. **Dialogs suspend, then catch up once.** Open dialogs, sheets and dropdown menus suspend reads and route refreshes through `components/ui/open-dialog-context.tsx`, and one catch-up fires after close. Render `RegisterOpenDialog` inside the presence-gated content, never in a wrapper body, or every closed dialog counts as open and suspends every refresh.

An `eventFilter` that inspects payload columns treats a missing column as relevant, because a deletion notification carries only `id` and `organization_id`. Synthetic catch-up events bypass every filter.

Connection catch-up runs after database readiness, not after channel join: the database listener can start after the `SUBSCRIBED` callback, and a read at join cannot cover a write in that gap. The provider dispatches synthetic invalidations when the `system` message reports `postgres_changes` ready. A read counts as recovery only when it has the same scope and window and started after that invalidation. `tests/ui-contracts/calendar.spec.ts` checks these orderings through the real provider.

## Latency targets

Correctness and responsiveness are separate results. A correct value that appears too late fails the responsiveness check.

- A change made in one session is visible in another signed-in session within two seconds (`LIVE_TARGET_MS` in `lib/testing/responsiveness-tolerance.ts`).
- The time-correction dialog reaches usable form options within five seconds of opening (`TIME_CORRECTION_READY_MS`). This target applies to that dialog only.

[Testing](testing.md#deadlines-and-measured-scenarios) owns how these targets are measured, their tolerances, the measured scenarios and their baselines.

### Shared layout and clock readiness

The authenticated layout waits for identity, organization, profile and subscription checks only. Optional shell reads, such as the clock, active jobs and attention counts, belong to their own providers and never block page content or a route refresh. An absent clock response is unknown state, not a clocked-out session. The clock provider is ready only after a successful read for the current organization, and its controls stay disabled with retry until then.

## Organization switch confirmation

The organization provider publishes a new active organization only after the cookie write completes, and keeps its switch lock until matching server props arrive. A rejected write keeps the current scope with visible failure. GET readers compare the requested organization with the authenticated cookie. `tests/ui-contracts/organization.spec.ts` covers held and rejected writes.

## Examples

- `lib/supabase/query-batches.ts`: complete paged reads with an explicit overflow and batched id lists, each limit explained once.
- `hooks/use-server-action.ts`: pending state bound to the awaited call, concurrent calls never dropped, and a separate settling phase for the read that confirms the result.
