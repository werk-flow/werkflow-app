---
name: werkflow-design
description: WerkFlow's design language and frontend conventions. Use for any UI work in this repo — React/Next.js components, styling, Tailwind, shadcn/ui, layouts, forms, dialogs, feedback, loading states, colors, dark mode, accessibility, or visual polish.
---

# WerkFlow Design Language

WerkFlow looks calm, professional, and a little "boring" on purpose. It replaces flashy legacy software and paper chaos for non-technical German SHK businesses, so clarity and trust beat visual excitement. The Aufträge and Dokumente tables are the north star: simple, elegant, quiet surfaces where content does the talking.

This file carries the complete UI/UX canon: visual language, the component registry, the interaction canon, the feedback vocabulary, and the loading canon. Behavior that can live in code lives in the registered components; this file tells you which component owns which behavior and what the rules are when you compose them.

## Source of truth

All theme values live in `app/globals.css` (`:root` tokens + `@theme inline` mapping). **To change how the app looks, edit the tokens there — never scatter raw hex values or one-off styles in components.** Interaction behavior lives in the registered components below — to change a behavior, change the component, not the call sites. If tokens/components and this file ever disagree, the code wins — then update this file.

## Color

- **Orange (`primary`, `--brand-orange`) is the only attention color.** Use it selectively and functionally: primary/submit buttons, focus rings, selection states, important links, step indicators, "current" markers. If orange stops being rare, it stops working.
- Bright `primary` is the fill, focus, and decorative-icon color. Filled controls pair it with `primary-foreground` (dark neutral in both themes). Readable orange labels, links, selected options, counts, and initials use `text-primary-text`; shared link variants own the opaque `primary-text-hover` and `primary-text-active` states. Do not use bright `text-primary` for ordinary text on light surfaces. The inverted filter count deliberately uses `bg-primary-foreground text-primary` as the reversed filled-control pair.
- Destructive filled controls use the shared destructive variant: opaque `destructive`, `destructive-hover`, and `destructive-active` backgrounds paired with `destructive-foreground`. Use `AlertDialogAction variant="destructive"` for irreversible confirmations; do not hand-build red class overrides or restore white labels/translucent dark fills. Inline errors use `text-destructive`.
- `lib/ui/contrast-contracts.test.ts` checks normal-text contrast from the actual theme tokens, shared control states, and current documented tint combinations (Tier 2). The browser layout audit checks rendered primary button states in both themes. Neither check certifies arbitrary opacity, caller-specific backgrounds, imagery, disabled controls, or non-text contrast; review those in their rendered context.
- **Purple is a soft, desaturated undertone, never a loud accent.** The `--brand-purple*` scale is deliberately muted (grayish purple) and the neutral tokens (`muted`, `accent`, `secondary`, `border`, `input`) carry only a faint purple cast. Do not reintroduce vivid violet (the old `#7b2cbf` family) in UI — only the logo SVGs keep their vivid purple.
- Purple is also the semantic hue for parked/planning entities (`geparkt` badges, calendar job blocks, Parkplatz). Keep that coding, always via `brand-purple` tokens.
- Status colors stay semantic (green success, red destructive, yellow warning, blue info) — never rebrand them orange or purple. They are tokens in `app/globals.css`: per family a fill with its text (`bg-success` + `text-success-foreground`), readable text on neutral surfaces (`text-success-text`; red uses `text-destructive`), and a tinted surface with its text (`bg-success-soft` + `text-success-soft-foreground`); opacity modifiers work on the fill (`bg-success/10`, `border-warning/40`). Numbered palette classes (`bg-green-100`, `text-slate-700`, `dark:text-yellow-300`) are a lint error in product JSX; the tokens flip for dark mode by themselves, so no `dark:` counterpart is needed. `lib/ui/contrast-contracts.test.ts` checks every family's pairs.
- Pairing rules: orange background → white/neutral text; purple background → white/neutral/purple text; neutral background → orange **or** purple text. Never orange text on purple or purple text on orange. Same rules in dark mode.
- Logos: light mode `/logo-*-light.svg`, dark mode `/logo-*-dark.svg`, swapped with `dark:hidden` / `hidden dark:block`.

## Shape, depth, and focus

- Radius scale is deliberately modest (`--radius: 8px`): containers and cards use `rounded-lg` (8px), controls `rounded-md` (6px). Never `rounded-2xl`/`rounded-3xl`; `rounded-full` only for avatars, dots, and count badges.
- Cards and panels: `border` + `shadow-xs`, flat and quiet. Elevation shadows (`shadow-lg`+) are reserved for genuinely floating elements: dialogs, popovers, dropdowns, banners, drag previews, the clock FAB.
- Focus: 2px ring (`focus-visible:ring-2` with `ring-ring/50`), no ring offsets (a `ring-offset-*` class in product JSX is a lint error). Never 3px+ rings — they read as chunky. The orange ring is on-brand and required for keyboard a11y; don't remove it.
- Icons: Lucide only. A global rule in `globals.css` sets all Lucide icons to a sleek 1.75 stroke — don't pass `strokeWidth` props (lint: `ui/no-lucide-stroke-width`); for a rare intentional exception use a utility class like `[stroke-width:3]`.
- Typography: Geist Sans + Geist Mono. Hierarchy via `font-medium`/`font-semibold` and `text-muted-foreground`, not size jumps. Tabular numbers for time/amount columns.

## Density and layout

- **One page container.** Every authenticated page is `PageShell` → `PageHeader` → `PageBody` (`components/shared/page-shell.tsx`, `page-header.tsx`). The shell's `<main>` has no padding and no scroll region; `PageBody` owns both plus the bottom clearance for the clock button. Hand-rolled columns are lint-banned. One title style (`text-xl font-bold sm:text-2xl`), one header padding.
- **Areas with subpages get a `layout.tsx`** that renders the shell and a persistent `PageHeader` with the area name as its `h1` title and `AreaNav` (`components/shared/area-nav.tsx`, underlined route tabs driven by the pathname) in its `nav` slot. Subpages render content only, under an `h2` with the subpage name and a toolbar row for the primary action, so the header and nav survive navigation and loading states. An area tab never leaves its area. In-page state tabs are shadcn `Tabs` (filled pills) and never sit in a header, so the two can't be confused.
- **No page-level horizontal scroll on any viewport.** Below the tablet breakpoint tables render as `ListRow` cards; nothing is cropped to fake compliance — a component that does not fit gets a mobile layout. Named exceptions, each inside its own scroll region with a visible edge: the calendar day and week grids and the signature pad. Tab strips and area navs scroll within themselves. The 375 px viewport audit measures loaded content on registered routes. Add new authenticated pages to `lib/testing/mobile-route-inventory.ts`; its unit check rejects missing pages. Cover detail fixtures and redirects explicitly. Route coverage does not prove every tab, dialog, data state, or role variant.
- Full-height layouts use dynamic viewport units (`h-dvh` / `min-h-dvh`), never `h-screen` / `min-h-screen`, so mobile browser chrome cannot crop or extend the page. ESLint owns this rule.
- Slim, not chunky: tabs are `h-9`, sidebar nav items `py-1.5`, active nav is a quiet neutral fill (`bg-accent` + `font-medium`), never a loud colored pill.
- Managers (admin/buero) get efficient, scannable density — tables, filters, inline actions. Field workers (employee) get simpler screens with one big, unmissable primary action; touch targets ≥ 44px on their primary flows.
- Don't wrap every block in a card. Prefer sections with headings, spacing, and dividers when hierarchy alone is enough; use cards for genuinely separate objects.
- Keep working patterns (data tables, filters, sidebar) — no marketing aesthetics (heroes, gradients, glass, parallax, scroll effects) on operational screens. Respect `prefers-reduced-motion`; transitions 150–250ms.

## Tailwind v4 + shadcn conventions

- Tailwind CSS v4 only. `app/globals.css` imports Tailwind with `source(none)` and explicitly registers only the class-bearing application directories. Do not restore repository-wide automatic detection: retained browser artifacts can contain hundreds of thousands of files and have already exhausted Turbopack's PostCSS worker timeout. No `@tailwind` directives, no `content` array, no v3 plugins. Use `bg-linear-*` (not `bg-gradient-*`), built-in container queries, v4 variants.
- **Build UI from the component registry below.** The shadcn primitives in `components/ui/` are the base layer, but for every interaction type the registry names the component that owns it — reach for that one, not for a raw primitive or a one-off styled div.
- Buttons/inputs/controls inherit their look from `components/ui/` — if a control looks wrong everywhere, fix the primitive, not the call sites.
- UI copy: natural German with umlauts/ß, sentence case, outcome-named buttons ("Speichern", "Auftrag anlegen"). Code, identifiers, comments: English.
- Accessibility: visible focus, German `aria-label`s on icon buttons, sufficient contrast for `muted-foreground`, keyboard-reachable interactions.

## Component registry

The first question for any control is: **does this list contain entities or a fixed enum?** Raw shadcn `Select` is legitimate only for fixed enums with fewer than ~10 options (status, priority, reason, type). Every entity list — people, customers, jobs, locations, catalogs, suppliers, sites, contacts — must assume 30+ entries and gets a searchable component with an empty state. Ten or more options of any kind: searchable.

| Interaction | Component | Import from |
| --- | --- | --- |
| Page column, header, scroll body | `PageShell`, `PageHeader`, `PageBody` | `components/shared/page-shell`, `components/shared/page-header` |
| Route tabs of an area with subpages | `AreaNav` (in the area `layout.tsx`) | `components/shared/area-nav` |
| Header primary action whose dialog lives in suspended content | `PageActionProvider` + `PageActionButton` + `usePageAction` (share the open flag across the Suspense boundary so the header paints first) | `components/shared/page-action` |
| Label + control stack (every form field) | `Field` (owns gap, required marker, label/error/description IDs; registered controls consume its context) | `components/ui/field` |
| Table row that reacts to a click | `TableRow interactive` (`"select"` for click-selects, double-click-opens) | `components/ui/table` |
| Mobile card row of a list, or a row inside a divided card | `ListRow` (`interactive`, `asChild` for links, `skeleton`; `variant="plain"` drops the box for rows inside a `divide-y` container) | `components/ui/list-row` |
| Action menu on a row that can replace an optimistic draft or remount under Realtime | `RowActionsMenu` (native trigger/items, body portal, keyboard navigation and focus restoration without a composed Radix `asChild` ref) | `components/ui/row-actions-menu` |
| Loading placeholder for a table or card list | `SkeletonTable` / `SkeletonRows` / `SkeletonList` fed by the list's own column definition | `components/ui/skeleton-table` |
| Row for a record the user just created | `PendingRow` | `components/ui/pending-row` |
| Spinner at the point of change | `InlinePending` + `useBusyIds` for per-row pending | `components/ui/inline-pending`, `hooks/use-busy-id` |
| Submit control inside a `<form action={serverAction}>` | `PendingSubmitButton` (uses `useFormStatus`; clicked control spins, siblings disable until settlement) | `components/ui/pending-submit-button` |
| Instant local echo of a list mutation | `useOptimisticList` (insert/update/remove with rollback and self-expiry) | `hooks/use-optimistic-list` |
| Progress over N items | `useBatchProgress` | `hooks/use-batch-progress` |
| Manual refresh of a list or a section retry | `RefreshButton` / `useRouterRefresh` (the one home of a router transition; rows stay on screen) | `components/ui/refresh-button` |
| Settle read for a props-driven list (refreshed server props, no live view) | `useSettleOnChange(value)` → pass as `useServerAction`'s `settle` | `hooks/use-settle-on-change` |
| Single choice from an entity list | `SearchableSelect` | `components/ui/searchable-select` |
| Multi choice from an entity list | `SearchableMultiSelect` | `components/ui/searchable-select` |
| Entity choice with inline create | `SelectWithCreate` | `components/ui/select-with-create` |
| Customer choice (with create) | `ClientSelectWithCreate` | `components/auftraege/client-select-with-create` |
| Lager choice (with create) | `LocationSelectWithCreate` | `components/inventar/location-select-with-create` |
| Employee assignment | `EmployeeMultiSelect` | `components/auftraege/employee-multi-select` |
| Job multi-assignment | `JobMultiSelect` | `components/auftraege/job-multi-select` |
| Fixed enum, under ~10 options | shadcn `Select` | `components/ui/select` |
| Date entry | `DatePicker` | `components/ui/date-picker` |
| Month entry (`YYYY-MM`, typed or picked; hidden input for forms) | `MonthPicker` | `components/ui/month-picker` |
| Time entry | `TimeInput` | `components/ui/time-input` |
| Date + time | `DateTimeField` (a `DatePicker` + `TimeInput` pair over one `YYYY-MM-DDTHH:mm` value) | `components/ui/date-time-field` |
| Duration in hours | `DurationHoursInput` | `components/ui/duration-hours-input` |
| Quantity / count | `QuantityStepper` | `components/ui/quantity-stepper` |
| Other numeric field | `Input` with `inputMode="decimal"` + the shared de-DE parser | `components/ui/input`, `lib/ui/decimal` |
| Job picking in clock flows | `JobPickerModal` | `components/job-picker-modal` |
| Next clock actions (the button's sheet, its hot keys, the Zeiterfassung dashboard) | `ClockActionList` over `deriveClockActions` (`lib/time-tracking/clock-actions`): one tap per transition, the job carried along, rare kinds behind „Weitere Aktivitäten …" | `components/clock-action-list` |
| Full time activity capture (every kind and qualifier) | `TimeActivityDialog`, opened from the action list | `components/time-activity-dialog` |
| Sheet anchored above the clock button on desktop, bottom sheet on phones | `DialogContent placement="anchored"` | `components/ui/dialog` |
| Document linking | `DocumentLinkDialog` / `AttachDocumentDialog` | `components/dokumente/*` |
| Inline-editable detail fields | `MetadataSection` | `components/shared/metadata-section` |
| Success/error/info/progress feedback | `Banner` via `useBanner()` | `components/ui/banner` |
| Inline field/action errors | `ErrorText` | `components/ui/error-text` |
| Failure of one page region or section, with retry | `SectionError` | `components/ui/section-error` |
| Loading placeholders | `Skeleton` + the page skeletons | `components/ui/skeleton`, `components/loading-states/*` |
| Collapsible form section („Weitere Angaben") | `FormDisclosure` (rotating-chevron pattern) | `components/ui/form-disclosure` |

ESLint rejects native date/time/month/week/number/range/checkbox/radio inputs, native `<select>`, raw `role="alert"`, and sonner imports outside `components/ui/`. Registered controls and feedback components own those interactions. Static attribute checks cover quoted values and JSX expression literals. The config also rejects static viewport and page-column literals, `Label` + nested or conditional control stacks outside `Field`, and call-site hover/cursor classes on `TableRow`/`ListRow`. Standalone section labels and checkbox labels remain supported. `lib/ui/eslint-contracts.test.mjs` probes the effective flat config, including named exceptions, so an exception cannot silently drop unrelated restrictions.

A raw `Select` throws above nine options in development. `lib/ui/select-registry.test.ts` checks resolvable enum bounds independently of the build mode and names runtime choices that need separate bounds. These are Tier 2 checks. Whether a new choice represents entities remains a Tier 3 review decision; a short entity list still needs search.

Native controls stay out of the web app on every viewport, phones included: the mobile browser is not the native app. A future React Native app uses native pickers because that is its platform; the web app keeps its own components and makes them touch-friendly (44 px targets, `inputMode` for the right keyboard).

Rules the registry components already encode — don't re-implement them per call site: search with a clear button, de-DE case-insensitive filtering (`filterByQuery` in `lib/ui/search`), empty states, `allowNone`, an `action` slot for inline create, `readOnly` rendering, and dialog-aware portaling. Empty-state copy: "Kein/e X gefunden" when a search filters to nothing; when the source list itself is empty, say what the list is for and offer the next action (the `action` slot or an adjacent button).

**Extending the registry:** composites built from these primitives are welcome (`DocumentLinkDialog` is the model). A genuinely new interaction pattern is allowed, but design it deliberately and add its registry row here in the same change. Silent one-offs are the defect this canon exists to prevent.

Searchable choices expose `option` roles and selected state inside a named `listbox`. Arrow keys move between options; Home and End reach the boundaries; Enter or Space selects. Search, clear, and inline-create controls remain reachable with Tab, and closing restores a usable focus position. Inline-create and clear-selection actions sit outside the listbox. A clickable record also needs a semantic link or button for its primary action. `RowActionsMenu` restores trigger focus before invoking an action, preserves focus when that action opens a dialog, and lets Tab leave the menu.

## Interaction canon

### Forms and Enter

Every non-destructive create/edit dialog renders a real `<form onSubmit={...}>`; the primary button is `type="submit"`. Enter submits — that is the whole convention, no manual `onKeyDown` Enter shims. Textareas keep Enter for newlines natively. Validate at the point of action: field-level problems render `ErrorText` under the field (with `aria-invalid` on the input), submit-level failures render `ErrorText` next to the submit button.

Every field is a `Field`. It owns stable label, description, error, and required-description IDs. Registered inputs and comboboxes inherit their name and supported required/invalid semantics. Date and time controls use a named `group`; their error and hidden `Pflichtfeld` text are referenced by `aria-describedby`, with `data-invalid` for styling. Do not add unsupported `aria-required` or `aria-invalid` to those groups. Keep required text out of the accessible name. Helper text is `text-xs text-muted-foreground`; `rows` on a textarea is not used (it sizes to content).

**The submit button is never disabled as a validation hint.** A disabled button makes the user hunt for what is missing and is skipped by keyboard and screen-reader navigation. It stays enabled; on click the form marks the missing fields with `ErrorText` and focuses the first one. Disable only while the action is pending (double-submit protection). The one exception: forms with at most two obvious required fields (login) may enable on completeness.

**Buttons have six states** (default, hover, focus-visible, pressed, loading, disabled). The `Button` primitive owns the first four (`active:` is the pressed darkening); loading is the spinner inside the button the caller renders while `isPending`; disabled means pending or an obviously unavailable action, nothing else.

Client-only actions must remain unavailable until their event handlers are ready. Entry-history correction buttons use `useHydrated` for this boundary, so server-rendered HTML cannot accept an ineffective first click. Preserve native form behavior where it works before hydration. Do not hide a lost click with sleeps or repeated opening attempts in a test.

A nested dialog form (e.g. a quick-create dialog opened from a select inside another dialog's form) must call `event.stopPropagation()` in its `onSubmit`: React synthetic submit events bubble through portals along the React tree and would otherwise submit the surrounding form too.

Keep the submission boundary specific to the editable mode. A record-view dialog with separate review, delete, or export commands still needs a native form when it switches to a non-destructive editor. A footer submit button may reference its body's form by a stable `form` ID. Native text inputs use implicit Enter submission; textareas keep newlines, and date/time groups or choice widgets keep their own Enter-to-edit or select behavior. Do not add per-dialog key handlers to override those widget contracts.

`lib/ui/dialog-contracts.test.ts` discovers dialog declarations, follows delegated form components, rejects whole-content scrolling, and records explicit command, browser, and destructive-mode exceptions. The application browser checks own actual footer visibility, validation focus, and nested submission behavior.

### Destructive confirmations

Use `AlertDialog` with `AlertDialogCancel` and `AlertDialogAction`, without a plain footer `Button` or a nested `<form>`. Radix initially focuses Cancel. Enter must not implicitly submit a destructive form; users can deliberately focus and activate the confirmation action with the keyboard. Wording template: the title names object and verb ("Auftrag „X" löschen?"), the body states the consequence in one sentence, the action button names the outcome ("Endgültig löschen"), destructive styling only when the action is irreversible, "Abbrechen" always present.

### Dialog close and success

One convention: on success the dialog closes and the success banner confirms; on failure the dialog stays open with its filled values and `ErrorText` at the point of action. A create dialog may close optimistically only after client validation has ruled out every correctable input problem. If the server can still return a correctable domain error, such as a required overlap reason, keep the dialog mounted and pending until the server accepts it; an optimistic list row may render at the same time from the same promise. No inline success flashes before closing, no delayed auto-close timers. Delete flows that redirect confirm via the URL-flash banner on the landing page.

### Long forms in dialogs

- `DialogContent` caps its height; long content goes in `DialogBody`, which makes the dialog a fixed-header/scroll-body/fixed-footer column. The title and the submit row never scroll out of view. `DialogBody` keeps a 4 px vertical inset so a first or last row's ring is not clipped, but draw a selection state inside the box (`border-primary` plus a tint) rather than as an outer ring: the scroll container clips whatever hangs outside a row (the clock dialog's cropped tile, 2026-09-15).
- Border colors are utilities like any other: the global default border color lives in `@layer base` in `app/globals.css`. Never add an unlayered `*` rule there; it beats every layered utility and silently disabled `border-primary` and `border-destructive` app-wide until 2026-09-15. The styled clock contract pins the selected tile's border color.
- Forms with more than ~8 fields group into titled sections with dividers. Genuinely optional blocks collapse behind `FormDisclosure` — the registry component with the app's rotating-chevron affordance. Never native `<details>`/`<summary>` (the browser marker triangle is off-brand).
- No multi-step wizards for operational forms — office users fill these daily; steps add clicks to routine work. Very large editors use a two-column grid (`sm:grid-cols-2`) plus section grouping instead.

### Loading states

Contextual documents share `ContextualDocumentsFrame` and `ContextualDocumentRowFrame` with `ContextualDocumentsSkeleton` in `components/dokumente/contextual-documents-layout.tsx`. Preserve the known title/description, responsive toolbar, and icon/name/metadata/menu geometry while data loads. The row container stays inert because opening a file and its menu are separate controls. Service detail loading states compose this skeleton at the document section's position. `lib/ui/contextual-documents-layout.test.ts` checks shared ownership and current consumers; unknown row counts and variable text still need rendered judgment.

- Every route segment ships a `loading.tsx` skeleton from `components/loading-states/` that mirrors the real layout — structure first, data fills in. New top-level routes also get an entry in the app-shell org-switch skeleton map (`components/sidebar/app-shell.tsx`). In an area with a `layout.tsx`, the subpage `loading.tsx` renders content only; the header and `AreaNav` stay on screen.
- **A skeleton mirrors the layout and interaction of what it loads.** Table headers and skeleton cells share the list's `X_COLUMNS: readonly SkeletonColumn[]`. A grid list shares its header and row layout with its exported skeleton, as the maintenance due list does. Route loading files render these exports. `TableRow`/`ListRow` own the hover token through `interactive`; live rows and skeleton rows must agree. `lib/ui/skeleton-pairing.test.ts` checks column reuse and loading-file composition. `lib/ui/row-contracts.test.ts` compares interaction flags, inventories every product table, and checks desktop-only containment. Tables need mobile cards that retain their information. Rendered layout, conditional states, and named scroll exceptions still require browser review.
- A skeleton never stands in for data that exists. After the user's own action the list keeps its rows and shows a `PendingRow` or an inline indicator; a full-list skeleton after a mutation is a defect.
- A windowed surface uses the range owner in `components/kalender/use-calendar-range-data.ts`. Show a skeleton only when a required dataset has never loaded. While a new window loads, retain the grid with `aria-busy` and `inert`; a failed uncovered read shows `SectionError` with retry. Disable retained stale grid actions too. Keep header navigation available. Readiness follows both data coverage and the actual renderer: `FullCalendarView` must report its requested date after rendering before the month marker becomes ready. The scope, mutation queue, causal reconnect rules, and regression checks live in `docs/technical/realtime-and-caching.md`.

Calendar save ownership is per operation: `beginMutation()` returns an idempotent release callback used in `finally`. A manual refresh or child success must never decrement another save. Check thrown transport failures as well as returned errors, and offer Undo only after confirmed persistence. Entries and correction metadata commit together through `completeCalendarEntryRead`; a missing badge read is a failed window, not ready data. The inner calendar scope includes organization, caller, and role, including auxiliary Parkplatz state.
- Section-level async loads inside a page use a section skeleton, not a centered spinner with text.
- Inline spinners are only for small contained actions: inside the clicked button or beside the refreshed control.
- Determinate operations (uploads, imports) show progress, never a bare spinner.
- Expected latency under ~1 second gets no loader at all — a flashing skeleton reads as broken.
- Sections load and fail independently: one failed section shows its own error and retry through `SectionError`, the rest of the page stays usable.

## Feedback

### The vocabulary

- `Banner` (`components/ui/banner.tsx`, shown via the global provider's `useBanner()`): top-center, dismiss X, `role="alert"`. Variants: `success` (green), `error` (red), `info` (blue), `progress` (neutral, spinner or progress bar). Timings are encoded in the component: 3 s auto-dismiss standard, 5 s with an action button ("Rückgängig"), `error` and `progress` persist until resolved or dismissed. Wrappers: `UrlFlashBanner` (post-redirect confirmations via URL param) and `UndoBanner` (success + action).
- `ErrorText` (`components/ui/error-text.tsx`): the one inline error component, `role="alert"`, destructive color.
- There are no toasts. Sonner is banned.

### Policy matrix

| Intent | Surface |
| --- | --- |
| Explicit save/create/edit succeeds | Success banner (uniform, even when the result is visible where the user lands) |
| Explicit save/create/edit fails | `ErrorText` at the point of action; dialog stays open |
| Delete succeeds | Redirect + `UrlFlashBanner`, or in-place success banner with „Rückgängig" where undo exists |
| Reversible direct manipulation (park, drag, status change) | Success banner with „Rückgängig" (green — blue is reserved for informational) |
| Micro-toggle with instantly visible result | Quiet on success; on failure revert the state and surface the error |
| Long-running operation | Progress banner that resolves into success or error |
| Background/list-level failure | Error banner |

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

Pending state binds to the awaited server call (`useServerAction`), never to a router transition: `useTransition` is lint-banned in product code. Its one home is `components/ui/refresh-button.tsx` (`RefreshButton`, `useRouterRefresh` for `SectionError` retries); the two named exceptions track a route change rather than a mutation (the organization switch, the document library's folder navigation). Props-driven lists get their settle read from `useSettleOnChange`. It resolves when the supplied value changes, reports a refresh failure on timeout, and cancels quietly on unmount. A timeout must not report that the already-accepted mutation failed. The optimistic echo is reconciled by id and expires by itself when the server list catches up; every optimistic path has a rollback and shows the failure at the point of action.

### No silent failures

Every user-blocking or authoritative mutation failure is visible at the point of action — this is a defect class, not a style preference. `console.error` alone is never acceptable for such a failure; neither is closing a dialog on failure or discarding a result (`void someMutation()`). A best-effort cleanup or post-success follow-on may log without interrupting the already-settled primary outcome only when the call site names that contract and the failure cannot invalidate what the user was told. Error copy answers what happened, why (when known), and what to do next, in natural German, without exposing backend internals. One failure, one surface — no double-reporting the same error through two channels.

## Realtime, live views, and dialogs

Live surfaces consume Realtime through the live-view family, never raw events: `useLiveView` (hooks/use-live-view.ts) for a client refetch view (shared debounce, generation guard, keep-last-known with an `isStale` flag, dialog suspension, catch-up), `useRealtimeRouterRefresh` for route refreshes. The one lint-named exception is a surface that needs the event itself rather than a refetch (the project-detail delete-exit watcher); payload inspection for relevance belongs in the primitive's `eventFilter`. Pending/double-submit state on a server action comes from `useServerAction` — or `usePendingTask` for one shared gate over several flows (both in hooks/use-server-action.ts); ESLint bans async `startTransition` callbacks.

For calendar mutations, range navigation and manual reads also use the shared mutation owner. A refresh landing mid-dialog can remount it and destroy typed input. The dialog primitives (`Dialog`, `AlertDialog`, `Sheet`) register themselves as open in a shared context, and the live-view family suspends while any dialog is open, then fires one catch-up on close. You get this for free by using the primitives — which is the rule: dialogs are built on `components/ui/dialog.tsx` / `alert-dialog.tsx` / `sheet.tsx`, not hand-rolled portals.

When testing loading or freshness, measure from the initiating action through the actual usable or updated control. A visible dialog shell is not a usable form, and an optimistic value is not saved-state evidence. Use the shared readiness and cross-session helpers. Their deadlines, required receiver isolation, and evidence rules live in `docs/technical/realtime-and-caching.md`. A correct but slow result fails responsiveness; an environment failure remains unconfirmed. Tier 2 timing checks cover the named scenarios, so Tier 3 review still identifies missing loading and freshness cases.

## Checklist before shipping UI

Tier 1 components own shared behavior. Tier 2 checks detect the covered structural and interaction regressions. Tier 3 review still owns natural German, visual balance, domain meaning, and policy exceptions. The isolated component suite proves semantics and focus; the application browser suites prove rendered layouts and business flows. Use the verification procedure in `docs/technical/testing.md`; a static pass alone does not close this checklist.

- [ ] Values come from tokens/primitives, no ad-hoc hex or radius
- [ ] Page is `PageShell` → `PageHeader` → `PageBody`; an area with subpages has a `layout.tsx` with `AreaNav`
- [ ] Nothing scrolls the page horizontally at 375 px; tables have a `ListRow` card layout below the tablet breakpoint
- [ ] Every field is a `Field`; required fields carry the marker; the submit button is not pre-disabled
- [ ] Every mutation shows pending feedback in the first frame per the matrix; no skeleton over existing data
- [ ] Skeleton rows share the list's column definition and its `interactive` flag
- [ ] Controls come from the component registry; no raw entity `Select`, native date/time/number inputs, or native `<select>`
- [ ] Non-destructive dialogs are real forms (Enter submits); destructive confirms are `AlertDialog`
- [ ] Feedback follows the policy matrix; every failure is visible at the point of action
- [ ] Long dialogs use `DialogBody`; the submit row can't scroll away
- [ ] Route has a `loading.tsx` skeleton; section loads have skeletons, not text spinners
- [ ] Orange only on the things that deserve attention; purple stays quiet
- [ ] Hover/focus/disabled/loading/empty/error states covered
- [ ] Dark mode and mobile checked; German copy natural
- [ ] No new dependencies, fonts, or icon libraries; flows and role behavior unchanged

## Tweaking the design later

1. Adjust tokens in `app/globals.css` (colors, radius, dark mode) — this restyles ~80% of the app coherently.
2. For control sizing/feel or interaction behavior, adjust the primitives in `components/ui/`.
3. Update this file only when the *intent* changes — a new registry row, a changed canon rule — and mirror any skill change between `.claude/skills/` and `.agents/skills/` (they must stay identical). `AGENTS.md` carries only the short brand rules and points here for the canon, so a canon change lands in this file, not there.
