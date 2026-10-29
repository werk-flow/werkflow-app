---
name: werkflow-design
description: WerkFlow's design language and UI conventions. Use for any UI work: components, Tailwind, layouts, forms, dialogs, feedback, loading states, color, dark mode, accessibility.
---

# WerkFlow design

WerkFlow looks calm, professional and a little boring on purpose. Its users are non-technical SHK staff. Clarity and trust beat visual excitement.

- **Tokens** live in `app/globals.css`. Change the look there.
- **Behavior** lives in the components of `components/ui/` and `components/shared/`. Change a behavior in its component, never at the call sites.
- **Rules** live here. Lint (`eslint.config.mjs`, `eslint-rules/ui-rules.mjs`) and the tests under `lib/ui/` and `lib/conventions/` enforce most of them, and their messages name the fix.

When code and a rule disagree, fix the wrong side. Change a rule only by a deliberate design decision.

| File | Read when |
| --- | --- |
| [registry.md](registry.md) | You need a control, field, row, dialog or feedback component. |
| [calendar.md](calendar.md) | You change `components/kalender` or `lib/calendar`. |
| [references/README.md](references/README.md) | The owner asks for a redesign, or you judge a rendered screen. |

## How to work

### Add a page

1. Copy `app/(app)/qualifikationen/page.tsx`: `PageShell`, `PageHeader` with the German title, `PageBody`, the data behind `Suspense`. A detail page with columns copies `components/auftraege/project-detail/project-detail-content.tsx`.
2. In an area with subpages, the area's `layout.tsx` owns `PageHeader` and `AreaNav`. The subpage renders `SubpageHeader` and its content.
3. Write the skeleton in `components/loading-states/` from the page's own column definitions. Render it from the route's `loading.tsx`. A new top-level route also gets an entry in `components/sidebar/org-switch-overlay.tsx`.
4. Return `RegionLoadError` when a server read fails. A client section uses `SectionError`.
5. Register the route in `lib/testing/selection/mobile-route-inventory.ts` and `surface-groups.ts`, its in-page tabs in `page-tab-inventory.ts`, its page family in `tests/audit/support/visual-families.ts`. A screen outside the app shell goes to `standalone-route-inventory.ts` and uses `StandaloneScreen` and `StandaloneTitle`.
6. Run `bun run lint <files>` and `bun run test:unit lib/conventions/route-loading.test.ts lib/ui/skeleton-pairing.test.ts lib/ui/detail-columns.test.ts lib/testing/selection/`.

Trap: a spinner or a generic skeleton as the loading state. The layout jumps when the data lands.

### Add a form or a dialog

1. Copy `components/auftraege/lifecycle/work-lifecycle-reason-dialog.tsx`: `DialogContent size`, a real `<form onSubmit>`, a `type="submit"` primary button.
2. Wrap every control in `Field`. Take each control from the [registry](registry.md).
3. On submit, pass the field errors to `Field` and call `focusFirstInvalidField`. The submit stays enabled.
4. Bind pending state through `useServerAction` or `usePendingTask`, and pass `pending` to the dialog root. A submit that leaves the page ends its task with `untilPageLeaves()`.
5. On failure, keep the dialog open with its values and show the `describeFailure` sentence in `ErrorText`. On success, close it and confirm with `Banner`.
6. Add the dialog to `lib/testing/selection/dialog-inventory.ts` and its opener to `tests/audit/support/dialog-openers/<area>.ts`.
7. Run `bun run lint <files>`, `bun run test:unit lib/ui/dialog-contracts.test.ts lib/ui/field-contracts.test.tsx lib/testing/selection/dialog-inventory.test.ts lib/conventions/german-copy.test.ts`, then `bun run test:verify --group audit:layout:<area>`.

Trap: `autoFocus` on a field, or an `onOpenAutoFocus` that only prevents the default. Focus stays on the page behind the dialog.

### Add a list or a table

1. Copy `components/kunden/kunden-content.tsx` and `components/kunden/clients-table.tsx`. The data side follows [realtime and caching](../../../docs/technical/realtime-and-caching.md).
2. Define the columns once. The table header and the skeleton both read them.
3. Render `SortableTableHead` and `TableRow interactive` on the desktop, and the same rows as `ListRow` cards below the tablet breakpoint.
4. Render `EmptyState`: „Noch keine …“ with the next step for an empty source, „Keine … gefunden“ for a search without a match.
5. Page with `ListPagination` and `parseListPage`.
6. Run `bun run test:unit lib/ui/row-contracts.test.ts lib/ui/skeleton-pairing.test.ts lib/ui/empty-state-copy.test.ts lib/ui/list-pagination-render.test.tsx`. Look at the list at 375 px.

Trap: a table that scrolls sideways on a phone, or hides columns there.

### Change an accepted design

1. Before you build, show the owner the rendered current screen and the proposal ([rendered design acceptance](../../../docs/technical/standards-audit.md#rendered-design-acceptance)).
2. Fix a shared problem in the token or the primitive. Fix a local problem at the call site.
3. After the owner accepts the result, update the references and run `bun run test:verify --group audit:visual`.

Trap: a reference rewritten because the comparison failed. A reference records what the owner accepted, not what the build produced.

## Color

- Orange (`primary`) is the only attention color: the primary button, focus, selection, current markers, important links. Keep it rare. A decorative icon is `text-muted-foreground`.
- Readable orange text is `text-primary-text`, never bright `text-primary` on a light surface. Filled orange pairs with `primary-foreground`.
- Purple is a muted undertone, never a loud accent. It marks planning and parked work (`geparkt`, calendar job blocks, the Parkplatz) through the `brand-purple` tokens. Only the logo SVGs keep the vivid purple.
- Status families: green success, red destructive, yellow every state that waits for approval, blue info, teal ongoing work („In Bearbeitung“). Each has a fill pair (`bg-success` + `text-success-foreground`), a text token (`text-success-text`, for red `text-destructive`) and a soft pair (`bg-success-soft` + `text-success-soft-foreground`).
- A state renders as `Badge`. A new color is a token in `app/globals.css` for both themes, with its pairs in `lib/ui/contrast-contracts.test.ts`. Tokens flip for dark mode, so add no `dark:` class.
- Job, project and work states read their classes from `components/auftraege/status-classes.ts`. No other file maps a state to a color.
- Never put orange text on purple or purple text on orange.
- Text takes a token color at full opacity. Opacity modifiers belong to fills and borders (`bg-success/10`).

## Shape and type

- Radius: `rounded-lg` for containers, `rounded-md` for controls, `rounded-full` only for avatars, dots and count badges.
- Cards are `border` + `shadow-xs`. `shadow-lg` and up belong to floating layers: dialogs, popovers, menus, banners, drag previews, the clock button.
- Controls and state tabs are flat.
- Focus is one 2px ring (`focus-visible:ring-2` with `ring-ring/50`), no offset, no border color.
- Icons: Lucide only. `app/globals.css` sets the 1.75 stroke, so pass no `strokeWidth`.
- Type is Geist Sans and Geist Mono. Build hierarchy with weight and `text-muted-foreground`, not size jumps. The smallest size is `text-xs`. Time and amount columns use tabular numbers.
- Transitions take 150 to 250 ms and respect `prefers-reduced-motion`. Operational screens get no heroes, gradients, glass or scroll effects.

## Density and layout

- The shell's `<main>` is the one main landmark. `PageBody` owns padding, scrolling and the clock button's bottom clearance.
- Headings: the page or area `h1` from `PageHeader`, the subpage `h2` from `SubpageHeader`, sections `h3`. In-page state tabs are `Tabs` pills, never in a header.
- No page scrolls sideways at any width. Below the tablet breakpoint a table renders `ListRow` cards that keep every column's information.
- Only a `ScrollRegion` scrolls sideways: calendar surfaces, tab strips, area navs, tables from the tablet breakpoint.
- Columns follow the content width, not the screen, because the sidebar takes 256 px. A detail page uses `DetailColumns`. Column tracks are `minmax(0, …)`. A toolbar wraps.
- Full height is `h-dvh` or `min-h-dvh`, never `h-screen` or a `vh` length.
- The bottom right corner belongs to the clock button. Page actions sit in `PageHeader` or `SubpageHeader`, never in a fixed button.
- Managers (admin, buero) get dense, scannable tables, filters and inline actions. Field workers (employee) get simple screens with one big primary action. Inside `data-field-worker`, the registry grows buttons, tabs and row links to 44 × 44 px on phones.
- Prefer sections with headings and dividers. Use a card only for a separate object.
- Rejected patterns: multi-step wizards for operational forms, celebration states, mobile bottom navigation.

## Forms and Enter

- Enter submits the primary action through the native form. Add no `onKeyDown` shims. A draft save is an explicit `type="button"`.
- A submit stays enabled. Disable it only while its request is pending. An action button that needs a choice or typed text works the same way.
- A nested dialog form calls `event.stopPropagation()` in its `onSubmit`. React submit events bubble through portals and would submit the outer form too.
- New forms use plain `<form onSubmit>`. The react-hook-form consumers of `components/ui/form.tsx` stay as they are.
- A long dialog puts its content in `DialogBody`: the header and footer stay, the body scrolls. Draw a selected row inside its box (`border-primary` + tint), because the scroll body clips an outer ring.
- A form with more than about eight fields groups them into titled sections. Optional blocks go behind `FormDisclosure`.
- A client-only button waits for hydration (`useHydrated`).

## Destructive confirmations

- `AlertDialog`, with only `AlertDialogCancel` and `AlertDialogAction` in the footer and no form. Cancel takes the first focus.
- The title names object and verb („Auftrag „X“ löschen?“). The body states the consequence in one sentence. The action names the outcome („Endgültig löschen“). „Abbrechen“ is always there.
- Destructive styling marks only an irreversible step.

## Dialog close and success

- Success closes the dialog and a `Banner` confirms. No inline success flash, no auto-close timer.
- The root's `pending` blocks Escape, outside clicks and the close controls until the answer lands. A form inside reports its request with `useReportPending`.
- An `AlertDialogAction` that awaits calls `event.preventDefault()` synchronously first. The primitive closes on activation before `pending` can guard it, so a failure would land in a closed dialog.
- A create dialog closes optimistically only when no correctable server error can follow.
- Escape returns focus to the control that opened the dialog.

## Loading states

- A route's skeleton mirrors its page and shares the list's columns and `interactive` flag. In an area, the subpage skeleton renders content only.
- A skeleton never replaces data that exists. After the user's action, the rows stay and a `PendingRow` or an inline indicator shows the change.
- A placeholder is `Skeleton`. A running action is `Spinner` or `Button pending`. A live pulse is `animate-live`.
- Expected latency under about one second gets no loader. A background `router.refresh()` gets none either.
- Sections load and fail on their own, each with its `SectionError` and retry.

## Feedback

`Banner` (through `useBanner()`) carries global feedback. `ErrorText` carries inline errors. There are no toasts. Sonner is banned.

| Intent | Surface |
| --- | --- |
| Save, create or edit succeeds | Success banner |
| Save, create or edit fails | `ErrorText` at the point of action, dialog stays open |
| Delete succeeds | Redirect with `UrlFlashBanner`, or a success banner with „Rückgängig“ |
| Reversible move (park, drag, status change) | Success banner with „Rückgängig“, after persistence |
| Micro-toggle | Quiet on success. On failure, revert and show the error |
| Long-running operation | Progress banner, then success or error |
| Background or page-level failure | Error banner |

Every write shows feedback in its first frame, while the server works:

| Interaction | Feedback |
| --- | --- |
| Create from a dialog | Optimistic row (`useOptimisticList`) or `PendingRow` |
| Inline toggle or reorder | Optimistic flip, rollback with the error |
| Row action | `InlinePending` through `useBusyIds` |
| Section edit | `InlinePending` from `useServerAction`'s `isPending` |
| Edit from a dialog | Button spinner, then the row shows `isSettling` |
| Operation over many items | `useBatchProgress` as `role="progressbar"` |
| Manual refresh | `RefreshButton`, the rows stay |

- Bind pending state to the awaited call through `useServerAction`, `usePendingTask` or `useBusyIds`, never through a router transition. `useServerAction` runs every call. The control disabled on `isPending` guards a double submit.
- Optimistic content carries the `unconfirmed` marker (`lib/ui/unconfirmed.ts`) until an authoritative read confirms it.

## No silent failures

- Every failed write is visible at the point of action. `console.error` alone, an empty `.catch` and `void mutation()` hide it. Reset a pending flag in `finally`.
- A failed read shows its retry (`SectionError failure`, a select's `loadFailure`), never an empty list or a bare string.
- Error copy says what happened, why if known, and what to do next, in German, without backend internals. One failure gets one surface.
- Offer an action only after its pre-check in `lib/ui/action-prechecks.ts`. Never let a user start a change the server will refuse.

## Copy

- Natural German with "du", real umlauts and `ß`, sentence case, the ellipsis `…`, quotes „…“.
- A button names its outcome („Speichern“, „Auftrag anlegen“). A lifecycle button names its step, never the state it ends in.
- A date reads `01.09.2026`, never `2026-09-01`.
- An icon-only button has a German `aria-label`.
- An id, code or ticket code never reaches the screen. A label map falls back to neutral German such as „Änderung dokumentiert“.

## Traps

- An effect that copies props or state into state can starve under hydration and never commit. Compute the value during render.
- `UrlFlashBanner` belongs in the first render. Set from an effect, it loses to the param strip.
- A block element inside `<p>` breaks hydration. That includes `Skeleton`, `Card`, `ErrorText`, `SectionError`, `EmptyState` and `Field`.
- Build every dialog on `components/ui/dialog.tsx`, `alert-dialog.tsx` or `sheet.tsx`. Live views pause while one is open and catch up on close. A hand-rolled portal loses typed input on refresh.
- `RegisterOpenDialog` sits inside the presence-gated content. In a wrapper body it counts closed dialogs as open and pauses Realtime for the whole app.
- An unlayered `*` rule in `app/globals.css` beats every layered utility and disables `border-primary` everywhere. The default border color lives in `@layer base`.
- `app/globals.css` imports Tailwind v4 with `source(none)` and lists the class folders. Keep it: automatic detection scans retained test artifacts and times out Turbopack. Use `bg-linear-*`, no `@tailwind`, no `content` array.
- The `Banner` dismiss button is „Hinweis schließen“. A plain „Schließen“ collides with page buttons in test locators.
- `job-dispatch-section` renders nothing while it loads, by design.
- A freshness test measures from the action to the usable control. A dialog shell is not a usable form.

## Never

- Hardcode a hex, `rgb()` or `hsl()` value, a radius above `rounded-lg`, an arbitrary font size or a numbered palette class.
- Write a raw `<button>`, a raw text `<input>`, a native date, time, number or select control, `<datalist>`, `<details>`, a raw `<h1>` or a raw `role="alert"`.
- Put a `max-w-*` class on `DialogContent`.
- Import a Radix primitive outside `components/ui/`.
- Disable a submit or an action button to express validation.
- Use orange as decoration, or purple as a loud accent.
- Switch off an axe rule in a spec.
- Assert a palette class in a test instead of a semantic token.
- Keep a design the owner rejected as a test baseline or a reference image.
- Update a visual reference to pass a failing run.

## Verify your work

1. Run `bun run lint`, `bun run test:unit` and `bun run test:ui`.
2. Run `bun run test:verify`, then the sweeps the plan leaves to the nightly run: `--group audit:layout` when a shared control or token changed, and `--group audit:layout:<area>` for each changed area. After an accepted redesign, add `--group audit:visual`.
3. Capture each changed screen before and after: add it to `tests/audit/support/acceptance-sets.ts`, run `bun run test:audit:focused --grep "@ACCEPT <set>"`. Cover both themes, 375 px and desktop, empty, `-loading` and `-error`. Walk the keyboard path yourself. A screenshot does not prove an interaction.
