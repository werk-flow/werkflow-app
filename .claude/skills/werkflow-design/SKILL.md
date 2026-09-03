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
- **Purple is a soft, desaturated undertone, never a loud accent.** The `--brand-purple*` scale is deliberately muted (grayish purple) and the neutral tokens (`muted`, `accent`, `secondary`, `border`, `input`) carry only a faint purple cast. Do not reintroduce vivid violet (the old `#7b2cbf` family) in UI — only the logo SVGs keep their vivid purple.
- Purple is also the semantic hue for parked/planning entities (`geparkt` badges, calendar job blocks, Parkplatz). Keep that coding, always via `brand-purple` tokens.
- Status colors stay semantic (green success, red destructive, yellow warning) — never rebrand them orange or purple.
- Pairing rules: orange background → white/neutral text; purple background → white/neutral/purple text; neutral background → orange **or** purple text. Never orange text on purple or purple text on orange. Same rules in dark mode.
- Logos: light mode `/logo-*-light.svg`, dark mode `/logo-*-dark.svg`, swapped with `dark:hidden` / `hidden dark:block`.

## Shape, depth, and focus

- Radius scale is deliberately modest (`--radius: 8px`): containers and cards use `rounded-lg` (8px), controls `rounded-md` (6px). Never `rounded-2xl`/`rounded-3xl`; `rounded-full` only for avatars, dots, and count badges.
- Cards and panels: `border` + `shadow-xs`, flat and quiet. Elevation shadows (`shadow-lg`+) are reserved for genuinely floating elements: dialogs, popovers, dropdowns, banners, drag previews, the clock FAB.
- Focus: 2px ring (`focus-visible:ring-2` with `ring-ring/50`), no ring offsets. Never 3px+ rings — they read as chunky. The orange ring is on-brand and required for keyboard a11y; don't remove it.
- Icons: Lucide only. A global rule in `globals.css` sets all Lucide icons to a sleek 1.75 stroke — don't pass `strokeWidth` props; for a rare intentional exception use a utility class like `[stroke-width:3]`.
- Typography: Geist Sans + Geist Mono. Hierarchy via `font-medium`/`font-semibold` and `text-muted-foreground`, not size jumps. Tabular numbers for time/amount columns.

## Density and layout

- **One page container.** Every authenticated page is `PageShell` → `PageHeader` → `PageBody` (`components/shared/page-shell.tsx`, `page-header.tsx`). The shell's `<main>` has no padding and no scroll region; `PageBody` owns both plus the bottom clearance for the clock button. Hand-rolled columns are lint-banned. One title style (`text-xl font-bold sm:text-2xl`), one header padding.
- **Areas with subpages get a `layout.tsx`** that renders the shell and a persistent `PageHeader` with the area name as its `h1` title and `AreaNav` (`components/shared/area-nav.tsx`, underlined route tabs driven by the pathname) in its `nav` slot. Subpages render content only, under an `h2` with the subpage name and a toolbar row for the primary action, so the header and nav survive navigation and loading states. An area tab never leaves its area. In-page state tabs are shadcn `Tabs` (filled pills) and never sit in a header, so the two can't be confused.
- **No page-level horizontal scroll on any viewport.** Below the tablet breakpoint tables render as `ListRow` cards; nothing is cropped to fake compliance — a component that does not fit gets a mobile layout. Named exceptions, each inside its own scroll region with a visible edge: the calendar day and week grids and the signature pad. Tab strips and area navs scroll within themselves. The 375 px viewport audit fails any route whose document or page body is wider than the viewport.
- Slim, not chunky: tabs are `h-9`, sidebar nav items `py-1.5`, active nav is a quiet neutral fill (`bg-accent` + `font-medium`), never a loud colored pill.
- Managers (admin/buero) get efficient, scannable density — tables, filters, inline actions. Field workers (employee) get simpler screens with one big, unmissable primary action; touch targets ≥ 44px on their primary flows.
- Don't wrap every block in a card. Prefer sections with headings, spacing, and dividers when hierarchy alone is enough; use cards for genuinely separate objects.
- Keep working patterns (data tables, filters, sidebar) — no marketing aesthetics (heroes, gradients, glass, parallax, scroll effects) on operational screens. Respect `prefers-reduced-motion`; transitions 150–250ms.

## Tailwind v4 + shadcn conventions

- Tailwind CSS v4 only. Single `@import 'tailwindcss';` — no `@tailwind` directives, no `content` array, no v3 plugins. Use `bg-linear-*` (not `bg-gradient-*`), built-in container queries, v4 variants.
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
| Label + control stack (every form field) | `Field` (owns gap, required marker, helper text, `ErrorText`, ARIA wiring; `Input`/`Textarea` read its context) | `components/ui/field` |
| Table row that reacts to a click | `TableRow interactive` (`"select"` for click-selects, double-click-opens) | `components/ui/table` |
| Mobile card row of a list | `ListRow` (`interactive`, `asChild` for links, `skeleton`) | `components/ui/list-row` |
| Loading placeholder for a table or card list | `SkeletonTable` / `SkeletonRows` / `SkeletonList` fed by the list's own column definition | `components/ui/skeleton-table` |
| Row for a record the user just created | `PendingRow` | `components/ui/pending-row` |
| Spinner at the point of change | `InlinePending` + `useBusyIds` for per-row pending | `components/ui/inline-pending`, `hooks/use-busy-id` |
| Instant local echo of a list mutation | `useOptimisticList` (insert/update/remove with rollback and self-expiry) | `hooks/use-optimistic-list` |
| Progress over N items | `useBatchProgress` | `hooks/use-batch-progress` |
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
| Other numeric field | `Input` with `inputMode="decimal"` + the shared de-DE parser | `components/ui/input`, `lib/ui/search` |
| Job picking in clock flows | `JobPickerModal` | `components/job-picker-modal` |
| Time activity capture and switching | `TimeActivityDialog` | `components/time-activity-dialog` |
| Document linking | `DocumentLinkDialog` / `AttachDocumentDialog` | `components/dokumente/*` |
| Inline-editable detail fields | `MetadataSection` | `components/shared/metadata-section` |
| Success/error/info/progress feedback | `Banner` via `useBanner()` | `components/ui/banner` |
| Inline field/action errors | `ErrorText` | `components/ui/error-text` |
| Failure of one page region or section, with retry | `SectionError` | `components/ui/section-error` |
| Loading placeholders | `Skeleton` + the page skeletons | `components/ui/skeleton`, `components/loading-states/*` |
| Collapsible form section („Weitere Angaben") | `FormDisclosure` (rotating-chevron pattern) | `components/ui/form-disclosure` |

Hard rules the ESLint config enforces (outside `components/ui/`): no native `type="date"`, `type="time"`, `type="datetime-local"`, `type="month"`, `type="week"`, `type="number"`, `type="range"`, `type="checkbox"`, or `type="radio"` inputs, no raw `role="alert"` (errors render through `ErrorText`, `SectionError`, or `Banner`), no native `<select>`, no sonner imports, no hand-rolled page column, no `Label` outside a `Field` or a spaced container. In development, a raw `Select` with more than nine options throws at render.

Native controls stay out of the web app on every viewport, phones included: the mobile browser is not the native app. A future React Native app uses native pickers because that is its platform; the web app keeps its own components and makes them touch-friendly (44 px targets, `inputMode` for the right keyboard).

Rules the registry components already encode — don't re-implement them per call site: search with a clear button, de-DE case-insensitive filtering (`filterByQuery` in `lib/ui/search`), empty states, `allowNone`, an `action` slot for inline create, `readOnly` rendering, and dialog-aware portaling. Empty-state copy: "Kein/e X gefunden" when a search filters to nothing; when the source list itself is empty, say what the list is for and offer the next action (the `action` slot or an adjacent button).

**Extending the registry:** composites built from these primitives are welcome (`DocumentLinkDialog` is the model). A genuinely new interaction pattern is allowed, but design it deliberately and add its registry row here in the same change. Silent one-offs are the defect this canon exists to prevent.

## Interaction canon

### Forms and Enter

Every non-destructive create/edit dialog renders a real `<form onSubmit={...}>`; the primary button is `type="submit"`. Enter submits — that is the whole convention, no manual `onKeyDown` Enter shims. Textareas keep Enter for newlines natively. Validate at the point of action: field-level problems render `ErrorText` under the field (with `aria-invalid` on the input), submit-level failures render `ErrorText` next to the submit button.

Every field is a `Field`: it renders the label, the `*` for `required` (plus `aria-required`), helper text wired through `aria-describedby`, and the field error. Helper text is `text-xs text-muted-foreground`; `rows` on a textarea is not used (it sizes to content).

**The submit button is never disabled as a validation hint.** A disabled button makes the user hunt for what is missing and is skipped by keyboard and screen-reader navigation. It stays enabled; on click the form marks the missing fields with `ErrorText` and focuses the first one. Disable only while the action is pending (double-submit protection). The one exception: forms with at most two obvious required fields (login) may enable on completeness.

**Buttons have six states** (default, hover, focus-visible, pressed, loading, disabled). The `Button` primitive owns the first four (`active:` is the pressed darkening); loading is the spinner inside the button the caller renders while `isPending`; disabled means pending or an obviously unavailable action, nothing else.

A nested dialog form (e.g. a quick-create dialog opened from a select inside another dialog's form) must call `event.stopPropagation()` in its `onSubmit`: React synthetic submit events bubble through portals along the React tree and would otherwise submit the surrounding form too.

### Destructive confirmations

Always `AlertDialog` with `AlertDialogCancel` and `AlertDialogAction` — never a plain `Button` in the footer, never a `<form>` inside, so Enter can never confirm destruction. Wording template: the title names object and verb ("Auftrag „X" löschen?"), the body states the consequence in one sentence, the action button names the outcome ("Endgültig löschen"), destructive styling only when the action is irreversible, "Abbrechen" always present.

### Dialog close and success

One convention: on success the dialog closes immediately and the success banner confirms; on failure the dialog stays open with `ErrorText` at the point of action. No inline success flashes before closing, no delayed auto-close timers. Delete flows that redirect confirm via the URL-flash banner on the landing page.

### Long forms in dialogs

- `DialogContent` caps its height; long content goes in `DialogBody`, which makes the dialog a fixed-header/scroll-body/fixed-footer column. The title and the submit row never scroll out of view.
- Forms with more than ~8 fields group into titled sections with dividers. Genuinely optional blocks collapse behind `FormDisclosure` — the registry component with the app's rotating-chevron affordance. Never native `<details>`/`<summary>` (the browser marker triangle is off-brand).
- No multi-step wizards for operational forms — office users fill these daily; steps add clicks to routine work. Very large editors use a two-column grid (`sm:grid-cols-2`) plus section grouping instead.

### Loading states

- Every route segment ships a `loading.tsx` skeleton from `components/loading-states/` that mirrors the real layout — structure first, data fills in. New top-level routes also get an entry in the app-shell org-switch skeleton map (`components/sidebar/app-shell.tsx`). In an area with a `layout.tsx`, the subpage `loading.tsx` renders content only; the header and `AreaNav` stay on screen.
- **A skeleton mirrors the hover of what it loads, exactly.** Hovering a loading row highlights it like the real row will, and never suggests an interaction the loaded row lacks. This is structural, not reviewed: a list component exports its column definition once and renders rows and `SkeletonRows` from it, `TableRow`/`ListRow` carry `interactive` for loaded and skeleton rows alike, and hover exists only through that flag. One hover token everywhere: `hover:bg-accent/50`. Rows that do nothing on click have no hover, and so do their skeletons.
- A skeleton never stands in for data that exists. After the user's own action the list keeps its rows and shows a `PendingRow` or an inline indicator; a full-list skeleton after a mutation is a defect.
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
| Create from a dialog | The dialog closes at once; the list shows the new record as an optimistic row (`useOptimisticList`) or a `PendingRow` at its sorted position until the server confirms |
| Inline toggle or reorder (checklist item, drag) | Optimistic: the state flips immediately, rolls back with the error on failure |
| Row action (approve, withdraw, acknowledge) | `InlinePending` at that row via `useBusyIds`; the other rows stay usable |
| Section-level edit | `InlinePending` in the section header (`useServerAction`'s `isPending`) |
| Edit from a dialog | Button spinner while pending; on success the dialog closes and the changed row shows `isSettling` through an inline indicator until the authoritative read lands |
| N-item operation (import, batch review, bulk move, upload) | `useBatchProgress` rendered as `role="progressbar"`, never a bare spinner |
| Manual list refresh | Icon spins; rows stay on screen. Never a skeleton over existing data |
| Direct manipulation with undo (drag, park) | Optimistic move; the success banner fires after persistence, not before |

Pending state binds to the awaited server call (`useServerAction`), never to a router transition: `useTransition` is banned in product code. The optimistic echo is reconciled by id and expires by itself when the server list catches up; every optimistic path has a rollback and shows the failure at the point of action.

### No silent failures

Every mutation's failure is visible at the point of action — this is a defect class, not a style preference. `console.error` alone is never acceptable; neither is closing a dialog on failure or discarding a result (`void someMutation()`). Error copy answers what happened, why (when known), and what to do next, in natural German, without exposing backend internals. One failure, one surface — no double-reporting the same error through two channels.

## Realtime, live views, and dialogs

Live surfaces consume Realtime through the live-view family, never raw events: `useLiveView` (hooks/use-live-view.ts) for a client refetch view (shared debounce, generation guard, keep-last-known with an `isStale` flag, dialog suspension, catch-up), `useRealtimeRouterRefresh` for route refreshes. The one lint-named exception is a surface that needs the event itself rather than a refetch (the project-detail delete-exit watcher); payload inspection for relevance belongs in the primitive's `eventFilter`. Pending/double-submit state on a server action comes from `useServerAction` — or `usePendingTask` for one shared gate over several flows (both in hooks/use-server-action.ts); ESLint bans async `startTransition` callbacks.

A refresh landing mid-dialog can remount it and destroy typed input. The dialog primitives (`Dialog`, `AlertDialog`, `Sheet`) register themselves as open in a shared context, and the live-view family suspends while any dialog is open, then fires one catch-up on close. You get this for free by using the primitives — which is the rule: dialogs are built on `components/ui/dialog.tsx` / `alert-dialog.tsx` / `sheet.tsx`, not hand-rolled portals.

## Checklist before shipping UI

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
