# Feedback and loading

This file holds the loading canon, the feedback vocabulary and the rules for live views beside dialogs, and [SKILL.md](../SKILL.md) routes to it.

## Loading states

Contextual documents share `ContextualDocumentsFrame` and `ContextualDocumentRowFrame` with `ContextualDocumentsSkeleton` in `components/dokumente/contextual-documents-layout.tsx`. Preserve the known title/description, responsive toolbar, and icon/name/metadata/menu geometry while data loads. The row container stays inert because opening a file and its menu are separate controls. Service detail loading states compose this skeleton at the document section's position. `lib/ui/contextual-documents-layout.test.ts` checks shared ownership and current consumers; unknown row counts and variable text still need rendered judgment.

- Every route segment ships a `loading.tsx` skeleton from `components/loading-states/` that mirrors the real layout — structure first, data fills in. New top-level routes also get an entry in the org-switch skeleton map (`components/sidebar/org-switch-overlay.tsx`). In an area with a `layout.tsx`, the subpage `loading.tsx` renders content only; the header and `AreaNav` stay on screen.
- **A skeleton mirrors the layout and interaction of what it loads.** Table headers and skeleton cells share the list's `X_COLUMNS: readonly SkeletonColumn[]`. A grid list shares its header and row layout with its exported skeleton, as the maintenance due list does. Route loading files render these exports. `TableRow`/`ListRow` own the hover token through `interactive`; live rows and skeleton rows must agree. Option rows inside pickers (the document link and attach dialogs, the job materials search) keep their own muted hover tokens: they are buttons, not list rows. `lib/ui/skeleton-pairing.test.ts` checks column reuse and loading-file composition. `lib/ui/row-contracts.test.ts` compares interaction flags, inventories every product table, and checks desktop-only containment. Tables need mobile cards that retain their information. Rendered layout, conditional states, and named scroll exceptions still require browser review.
- A skeleton never stands in for data that exists. After the user's own action the list keeps its rows and shows a `PendingRow` or an inline indicator; a full-list skeleton after a mutation is a defect.
- A windowed surface uses the range owner in `components/kalender/use-calendar-range-data.ts`. Show a skeleton only when a required dataset has never loaded. While a new window loads, retain the grid with `aria-busy` and `inert`; a failed uncovered read shows `SectionError` with retry. Disable retained stale grid actions too. Keep header navigation available. Readiness follows both data coverage and the actual renderer: the mounted board, day or month renderer must expose usable content for the requested window before its readiness marker is true. The scope, mutation queue, causal reconnect rules, and regression checks live in `docs/technical/realtime-and-caching.md`. The calendar header deliberately stays inside its data boundary because it is bound to container state (view, date, filters); every other list renders its header outside the boundary so it paints before the data.

Calendar save ownership is per operation: `beginMutation()` returns an idempotent release callback used in `finally`. A manual refresh or child success must never decrement another save. Check thrown transport failures as well as returned errors, and offer Undo only after confirmed persistence. Entries and correction metadata commit together through `completeCalendarEntryRead`; a missing badge read is a failed window, not ready data. The inner calendar scope includes organization, caller, and role, including auxiliary Parkplatz state.
- A placeholder is `Skeleton` and a running action is `Spinner` or `Button pending`. Their `data-slot` and `aria-busy` are the busy signals the browser settle step waits on (`lib/testing/spec-support/busy-signals.ts`). A live status that pulses (a running block, a working employee) uses `animate-live`, which is not a busy signal.
- Section-level async loads inside a page use a section skeleton, not a centered spinner with text.
- Inline spinners are only for small contained actions: inside the clicked button or beside the refreshed control.
- Determinate operations (uploads, imports) show progress, never a bare spinner.
- Expected latency under ~1 second gets no loader at all — a flashing skeleton reads as broken.
- Sections load and fail independently: one failed section shows its own error and retry through `SectionError`, the rest of the page stays usable.
- Background `router.refresh()` reconvergence over already-visible content gets no loader at all, neither a trailing spinner nor a skeleton.
- Named exception: `job-dispatch-section` renders nothing while loading, by design. The section exists only when dispatch cards exist, so a skeleton would flash and vanish on every job without a dispatch.

## Feedback

### The vocabulary

- `Banner` (`components/ui/banner.tsx`, shown via the global provider's `useBanner()`): top-center, dismiss X, `role="alert"`. Variants: `success` (green), `error` (red), `info` (blue), `progress` (neutral, spinner or progress bar). Timings are encoded in the component: 3 s auto-dismiss standard, 5 s with an action button ("Rückgängig"), `error` and `progress` persist until resolved or dismissed. `UrlFlashBanner` wraps it for post-redirect confirmations via a URL param. An undo is a `success` banner with `actionLabel` „Rückgängig“ and `onAction`. The dismiss button's accessible name is „Hinweis schließen“, never plain „Schließen“, because a locator for „Schließen“ would collide in strict mode with the page's action buttons.
- `ErrorText` (`components/ui/error-text.tsx`): the one inline error component, `role="alert"`, destructive color.
- There are no toasts. Sonner is banned.

### Policy matrix

| Intent | Surface |
| --- | --- |
| Explicit save/create/edit succeeds | Success banner (uniform, even when the result is visible where the user lands) |
| Explicit save/create/edit fails | `ErrorText` at the point of action; dialog stays open |
| Delete succeeds | Redirect + `UrlFlashBanner`, or in-place success banner with „Rückgängig“ where undo exists |
| Reversible direct manipulation (park, drag, status change) | Success banner with „Rückgängig“ (green — blue is reserved for informational) |
| Micro-toggle with instantly visible result | Quiet on success; on failure revert the state and surface the error |
| Long-running operation | Progress banner that resolves into success or error |
| Background/list-level failure | Error banner |
| Full-page settings form fails | Error banner (a page-level save has no dialog point of action) |

### Pending feedback: something happens in the first frame

No interaction may leave the user wondering whether anything happened, even for a second. The matrix names the feedback during the request, chosen by interaction kind; the success and failure surfaces above then take over.

| Interaction | Feedback while the server works |
| --- | --- |
| Create from a dialog | After complete client validation, the list shows the new record as an optimistic row (`useOptimisticList`) or a `PendingRow` at its sorted position. Close immediately only when no correctable server validation can follow; otherwise keep the filled dialog mounted and pending on the same promise until acceptance. |
| Inline toggle or reorder (checklist item, drag) | Optimistic: the state flips immediately, rolls back with the error on failure |
| Row action (approve, withdraw, acknowledge) | `InlinePending` at that row via `useBusyIds`; the other rows stay usable |
| Section-level edit | `InlinePending` in the section header (`useServerAction`'s `isPending`) |
| Edit from a dialog | Button spinner while pending; on success the dialog closes and the changed row shows `isSettling` through an inline indicator until the authoritative read lands |
| N-item operation (import, batch review, bulk move, upload) | `useBatchProgress` rendered as `role="progressbar"`, never a bare spinner |
| Manual list refresh | `RefreshButton`: the icon spins; rows stay on screen. Never a skeleton over existing data (the list components carry no loading prop) |
| Direct manipulation with undo (drag, park) | Optimistic move; the success banner fires after persistence, not before |

Pending state binds to the awaited server call through an owner hook, `useServerAction` or `usePendingTask` (`hooks/use-server-action.ts`) or `useBusyIds` (`hooks/use-busy-id.ts`), and that hook gives the control its first-frame feedback. The ban on binding it to a router transition, with its recorded exceptions, lives in the Never list of [realtime and caching](../../../../docs/technical/realtime-and-caching.md#never). A task that leaves the page (`loadDocument`, a `router.push`) ends with `untilPageLeaves()`, so its control stays pending until the page unmounts. Props-driven lists get their settle read from `useSettleOnChange`. It resolves when the supplied value changes, reports a refresh failure on timeout, and cancels quietly on unmount. A timeout must not report that the already-accepted mutation failed. The optimistic echo is reconciled by id and expires by itself when the server list catches up; every optimistic path has a rollback and shows the failure at the point of action. `useServerAction` deliberately runs every call, because suppressing overlapping calls in the hook silently drops flows (an effect-driven fetch, a queued follow-up). Double-submit protection is the disabled control bound to `isPending`, never the hook; do not assume the hook rejects concurrent calls.

Content from an optimistic layer carries the unconfirmed marker (`lib/ui/unconfirmed.ts`: `data-unconfirmed` and `aria-busy`) until an authoritative read confirms it. Pass `unconfirmed` to `ListRow`, `TableRow` or `Card`; `PendingRow` and an active `InlinePending` carry it themselves. It changes no pixels; screen readers, `settled()` and the confirmed-outcome locators read it (`lib/conventions/unconfirmed-marker.test.ts`).

### No silent failures

Every user-blocking or authoritative mutation failure is visible at the point of action — this is a defect class, not a style preference. `console.error` alone is never acceptable for such a failure; neither is closing a dialog on failure or discarding a result (`void someMutation()`). A best-effort cleanup or post-success follow-on may log without interrupting the already-settled primary outcome only when the call site names that contract and the failure cannot invalidate what the user was told. Error copy answers what happened, why (when known), and what to do next, in natural German, without exposing backend internals. One failure, one surface — no double-reporting the same error through two channels.

## Realtime, live views, and dialogs

Live surfaces consume Realtime through the live-view family, never raw events: `useLiveView` (hooks/use-live-view.ts) for a client refetch view (shared debounce, generation guard, keep-last-known with an `isStale` flag, dialog suspension, catch-up), `useRealtimeRouterRefresh` for route refreshes. The one lint-named exception is a surface that needs the event itself rather than a refetch (the project-detail delete-exit watcher); payload inspection for relevance belongs in the primitive's `eventFilter`.

For calendar mutations, range navigation and manual reads also use the shared mutation owner. A refresh landing mid-dialog can remount it and destroy typed input. The dialog primitives (`Dialog`, `AlertDialog`, `Sheet`) register themselves as open in a shared context, and the live-view family suspends while any dialog is open, then fires one catch-up on close. You get this for free by using the primitives — which is the rule: dialogs are built on `components/ui/dialog.tsx` / `alert-dialog.tsx` / `sheet.tsx`, not hand-rolled portals. Inside a primitive, `RegisterOpenDialog` must sit in the presence-gated content, never in the wrapper body: a wrapper body counts always-rendered closed dialogs (the sidebar organization dialogs) as open and silently suspends Realtime refresh app-wide. `DropdownMenuContent` registers at the same place, so a readiness catch-up cannot close an open actions menu.

When testing loading or freshness, measure from the initiating action through the actual usable or updated control. A visible dialog shell is not a usable form, and an optimistic value is not saved-state evidence. Use the shared readiness and cross-session helpers. Their deadlines, required receiver isolation, and evidence rules live in `docs/technical/realtime-and-caching.md`. A correct but slow result fails responsiveness; an environment failure remains unconfirmed. Tier 2 timing checks cover the named scenarios, so Tier 3 review still identifies missing loading and freshness cases.
