---
name: werkflow-design
description: WerkFlow's design language and frontend conventions. Use for any UI work in this repo — React/Next.js components, styling, Tailwind, shadcn/ui, layouts, forms, dialogs, feedback, loading states, colors, dark mode, accessibility, or visual polish.
---

# WerkFlow Design Language

WerkFlow looks calm, professional, and a little "boring" on purpose. It replaces flashy legacy software and paper chaos for non-technical German SHK businesses, so clarity and trust beat visual excitement. The Aufträge and Dokumente tables are existing patterns, not a substitute for an accepted visual target when the owner requests a redesign.

This file carries the complete UI/UX canon: visual language, the component registry, the interaction canon, the feedback vocabulary, and the loading canon. Behavior that can live in code lives in the registered components; this file tells you which component owns which behavior and what the rules are when you compose them.

## Source of truth

All theme values live in `app/globals.css` (`:root` tokens + `@theme inline` mapping). **To change how the app looks, edit the tokens there — never scatter raw hex values or one-off styles in components.** Interaction behavior lives in the registered components below — to change a behavior, change the component, not the call sites. Code establishes the current rendering, not the intended design. When it conflicts with an accepted rule or owner decision, identify the discrepancy and repair the wrong side. Change the canon only for a deliberate design decision; do not turn implementation drift into a new rule.

## Color

- **Orange (`primary`, `--brand-orange`) is the only attention color.** Use it selectively and functionally: primary/submit buttons, focus rings, selection states, important links, step indicators, "current" markers. If orange stops being rare, it stops working.
- Bright `primary` is the fill, focus, and decorative-icon color. Filled controls pair it with `primary-foreground` (dark neutral in both themes). Readable orange labels, links, selected options, counts, and initials use `text-primary-text`; shared link variants own the opaque `primary-text-hover` and `primary-text-active` states. Do not use bright `text-primary` for ordinary text on light surfaces. The inverted filter count deliberately uses `bg-primary-foreground text-primary` as the reversed filled-control pair.
- Destructive filled controls use the shared destructive variant: opaque `destructive`, `destructive-hover`, and `destructive-active` backgrounds paired with `destructive-foreground`. Use `AlertDialogAction variant="destructive"` for irreversible confirmations; do not hand-build red class overrides or restore white labels/translucent dark fills. Inline errors use `text-destructive`.
- `lib/ui/contrast-contracts.test.ts` checks normal-text contrast from the actual theme tokens, shared control states, and current documented tint combinations (Tier 2). The browser layout audit checks rendered primary button states in both themes. Neither check certifies arbitrary opacity, caller-specific backgrounds, imagery, disabled controls, or non-text contrast; review those in their rendered context.
- **Purple is a soft, desaturated undertone, never a loud accent.** The `--brand-purple*` scale is deliberately muted (grayish purple) and the neutral tokens (`muted`, `accent`, `secondary`, `border`, `input`) carry only a faint purple cast. Do not reintroduce vivid violet (the old `#7b2cbf` family) in UI — only the logo SVGs keep their vivid purple.
- Purple is also the semantic hue for parked/planning entities (`geparkt` badges, calendar job blocks, Parkplatz). Keep that coding, always via `brand-purple` tokens.
- Status colors stay semantic (green success, red destructive, yellow warning, blue info, teal ongoing work) — never rebrand them orange or purple. They are tokens in `app/globals.css`: per family a fill with its text (`bg-success` + `text-success-foreground`), readable text on neutral surfaces (`text-success-text`; red uses `text-destructive`), and a tinted surface with its text (`bg-success-soft` + `text-success-soft-foreground`); opacity modifiers work on the fill (`bg-success/10`, `border-warning/40`). Numbered palette classes (`bg-green-100`, `text-slate-700`, `dark:text-yellow-300`) are a lint error in product JSX; the tokens flip for dark mode by themselves, so no `dark:` counterpart is needed. `lib/ui/contrast-contracts.test.ts` checks every family's pairs.
- Yellow `warning` is the one color for every "waiting for approval" state: a pending correction, a pending request, a pending session review. Orange stays with actions and purple with the calendar's planning meaning; neither marks a waiting state.
- Work that is being done („In Bearbeitung“, „In Ausführung“) has its own teal family, `bg-ongoing-soft` + `text-ongoing-soft-foreground`, so it never reads as waiting. `components/auftraege/status-classes.ts` owns the colors of every job, project and work state; a badge that shows such a state reads its classes there.
- Pairing rules: orange background → white/neutral text; purple background → white/neutral/purple text; neutral background → orange **or** purple text. Never orange text on purple or purple text on orange. Same rules in dark mode.
- Logos: light mode `/logo-*-light.svg`, dark mode `/logo-*-dark.svg`, swapped with `dark:hidden` / `hidden dark:block`.

## Shape, depth, and focus

- Radius scale is deliberately modest (`--radius: 8px`): containers and cards use `rounded-lg` (8px), controls `rounded-md` (6px). Never `rounded-2xl`/`rounded-3xl`; `rounded-full` only for avatars, dots, and count badges.
- Cards and panels: `border` + `shadow-xs`, flat and quiet. Elevation shadows (`shadow-lg`+) are reserved for genuinely floating elements: dialogs, popovers, dropdowns, banners, drag previews, the clock FAB.
- Focus: one 2px ring (`focus-visible:ring-2` with `ring-ring/50`), with a neutral field border. Do not add an orange border around the ring or a ring offset. Visible focus is required; orange is the brand choice, not an accessibility requirement. Registered inputs, selects and time fields own this treatment. The styled presentation contract checks visibility without changing field geometry.
- Icons: Lucide only. A global rule in `globals.css` sets all Lucide icons to a sleek 1.75 stroke — don't pass `strokeWidth` props (lint: `ui/no-lucide-stroke-width`); for a rare intentional exception use a utility class like `[stroke-width:3]`.
- Typography: Geist Sans + Geist Mono. Hierarchy via `font-medium`/`font-semibold` and `text-muted-foreground`, not size jumps. Tabular numbers for time/amount columns.

## Density and layout

- **One page container.** Every authenticated page is `PageShell` → `PageHeader` → `PageBody` (`components/shared/page-shell.tsx`, `page-header.tsx`). The shell's `<main>` has no padding and no scroll region; `PageBody` owns both plus the bottom clearance for the clock button. Hand-rolled columns are lint-banned. Titles use `text-lg font-semibold tracking-tight sm:text-xl`; the shared header owns padding.
- **Areas with subpages get a `layout.tsx`** that renders the shell and a persistent `PageHeader` with the area name as its `h1` title and `AreaNav` (`components/shared/area-nav.tsx`, underlined route tabs driven by the pathname) in its `nav` slot. Subpages render content only, under `SubpageHeader` (the `h2` with the subpage name, its description and the primary action on the right), so the header and nav survive navigation and loading states. Sections inside a subpage use `h3`. An area tab never leaves its area. In-page state tabs are shadcn `Tabs` (filled pills) and never sit in a header, so the two can't be confused.
- **No page-level horizontal scroll on any viewport.** Below the tablet breakpoint tables render as `ListRow` cards; nothing is cropped to fake compliance — a component that does not fit gets a mobile layout. Named exceptions, each inside its own scroll region with a visible edge: the desktop calendar timelines, the month grid and the signature pad. Tab strips and area navs scroll within themselves. The viewport audit measures loaded content on registered routes at 375 px, and on the manager routes and detail pages also at 768, 1024, 1280 and 1680 px. It also reads the rendered boxes, because a size container keeps its overflow out of the scroll width: nothing passes the right edge of the page body, and no button or link leaves its card. Add new authenticated pages to `lib/testing/selection/mobile-route-inventory.ts`; its unit check rejects missing pages. Cover detail fixtures and redirects explicitly. Route coverage does not prove every tab, dialog, data state, or role variant.
- Full-height layouts use dynamic viewport units (`h-dvh` / `min-h-dvh`), never `h-screen` / `min-h-screen`, so mobile browser chrome cannot crop or extend the page. ESLint owns this rule.
- A screen outside the app shell (sign-in, onboarding, upgrade, invitation error, root not-found, root error) is `StandaloneScreen`: one background, the logo in both themes, a centered column and vertical padding.
- The bottom right corner belongs to the clock button. Page actions live in `PageHeader` or `SubpageHeader`, never in a fixed button; fixed positioning is reserved for the named floating layers (clock button, navigation drawer, calendar panels, drag previews). A side panel the clock button floats over keeps bottom clearance like `PageBody`.
- Slim, not chunky: tabs are `h-9`, sidebar nav items `py-1.5`, active nav is a quiet neutral fill (`bg-accent` + `font-medium`), never a loud colored pill.
- Managers (admin/buero) get efficient, scannable density — tables, filters, inline actions. Field workers (employee) get simpler screens with one big, unmissable primary action; touch targets ≥ 44px on their primary flows.
- Don't wrap every block in a card. Prefer sections with headings, spacing, and dividers when hierarchy alone is enough; use cards for genuinely separate objects.
- Keep working patterns (data tables, filters, sidebar) — no marketing aesthetics (heroes, gradients, glass, parallax, scroll effects) on operational screens. Respect `prefers-reduced-motion`; transitions 150–250ms.

## Tailwind v4 + shadcn conventions

- Tailwind CSS v4 only. `app/globals.css` imports Tailwind with `source(none)` and explicitly registers only the class-bearing application directories. Do not restore repository-wide automatic detection: retained browser artifacts can contain hundreds of thousands of files and have already exhausted Turbopack's PostCSS worker timeout. No `@tailwind` directives, no `content` array, no v3 plugins. Use `bg-linear-*` (not `bg-gradient-*`), built-in container queries, v4 variants.
- **Build UI from the component registry below.** The shadcn primitives in `components/ui/` are the base layer, but for every interaction type the registry names the component that owns it — reach for that one, not for a raw primitive or a one-off styled div.
- Buttons/inputs/controls inherit their look from `components/ui/` — if a control looks wrong everywhere, fix the primitive, not the call sites.
- Controls and state tabs are flat. Use the shared neutral border or selected fill, without a raised shadow on each field, button or active tab. Keep floating menus and dialogs visually distinct from the page with their existing elevation.
- UI copy: natural German with umlauts/ß, sentence case, outcome-named buttons ("Speichern", "Auftrag anlegen"). Code, identifiers, comments: English.
- Accessibility: visible focus, German `aria-label`s on icon buttons, sufficient contrast for `muted-foreground`, keyboard-reachable interactions.

## Component registry

The first question for any control is: **does this list contain entities or a fixed enum?** Raw shadcn `Select` is legitimate only for fixed enums with fewer than ~10 options (status, priority, reason, type). Every entity list — people, customers, jobs, locations, catalogs, suppliers, sites, contacts — must assume 30+ entries and gets a searchable component with an empty state. Ten or more options of any kind: searchable.

| Interaction | Component | Import from |
| --- | --- | --- |
| Page column, header, scroll body | `PageShell`, `PageHeader`, `PageBody` | `components/shared/page-shell`, `components/shared/page-header` |
| Route tabs of an area with subpages | `AreaNav` (in the area `layout.tsx`) | `components/shared/area-nav` |
| Header primary action whose dialog lives in suspended content | `PageActionProvider` + `PageActionButton` + `usePageAction` (share the open flag across the Suspense boundary so the header paints first) | `components/shared/page-action` |
| Header actions whose handlers exist only in suspended content, or the primary action of one subpage in an area header | `PageHeaderSlotProvider` + `PageHeaderSlot` + `PageHeaderActions` (the content portals its actions into the static header, so the title paints first; Zeiterfassung's „Manuelle Eintragung“ sits beside the area title on its overview only) | `components/shared/page-action` |
| Label + control stack (every form field) | `Field` (owns gap, required marker, label/error/description IDs; registered controls consume its context) | `components/ui/field` |
| Submit with missing input | `focusFirstInvalidField` (the submit stays enabled; the handler marks the fields through `Field`'s `error` and focuses the first) | `lib/ui/field-validation` |
| Ordinary action or submit | `Button` (`default` for the one primary action, `outline` for a row action repeated per row, `destructive` only for an irreversible step; disabled only while its request runs) | `components/ui/button` |
| Clickable region that owns its shape (row, disclosure header, filter pill, chip remove) | `PlainButton` (sets `type="button"` and the focus ring; an ordinary action uses `Button`) | `components/ui/plain-button` |
| Search field of a list, picker or toolbar | `SearchInput` (magnifier, clear button that refocuses, pending spinner; name it with `aria-label`) | `components/ui/search-input` |
| Subpage title row inside an area | `SubpageHeader` (`h2`, description, actions; actions wrap below on phones) | `components/shared/subpage-header` |
| Title of a detail card or section („PROFIL“, „DOKUMENTE & BILDER“) | `SectionTitle` (small uppercase muted heading with optional icon; `as` sets the level) | `components/shared/section-title` |
| Screen outside the app shell | `StandaloneScreen` | `components/shared/standalone-screen` |
| State label | `Badge` (`secondary` default, `success`, `destructive`, `outline`; there is no orange badge). A state is a label and never a button: a badge is a small pill without hover or pressed state, an action is a `Button` that names the step („Stornieren“, not „Storniert“). Job, project and work states take their classes from `status-classes` | `components/ui/badge`, `components/auftraege/status-classes` |
| Dialog width | `DialogContent size` (`sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl`; default `lg`) | `components/ui/dialog` |
| Dialog or confirmation that waits for its server answer | `Dialog pending` / `AlertDialog pending` (refuses Escape, an outside click, the close button and `AlertDialogCancel` until the answer lands; the submit's own `disabled` stays the double-submit guard) | `components/ui/dialog`, `components/ui/alert-dialog` |
| Sortable column head of a table | `SortableTableHead` (direction icon and `aria-sort`) | `components/ui/sortable-table-head` |
| Table row that reacts to a click | `TableRow interactive` (`"select"` for click-selects, double-click-opens) | `components/ui/table` |
| Form per person in a list (one row per person, the same fields in each) | `Table` with one header row from the tablet breakpoint, a `ListRow` card with `Field` labels on phones; a table row cannot hold a form, so the row's controls join the form in its first cell through the `form` attribute (`components/zeiterfassung/time-account-person-table.tsx`) | `components/ui/table`, `components/ui/list-row` |
| Mobile card row of a list, or a row inside a divided card | `ListRow` (`interactive`, `asChild` for links, `skeleton`; `variant="plain"` drops the box for rows inside a `divide-y` container) | `components/ui/list-row` |
| Action menu on a row that can replace an optimistic draft or remount under Realtime | `RowActionsMenu` (native trigger/items, body portal, keyboard navigation and focus restoration without a composed Radix `asChild` ref) | `components/ui/row-actions-menu` |
| Loading placeholder for a table or card list | `SkeletonTable` / `SkeletonRows` / `SkeletonList` fed by the list's own column definition | `components/ui/skeleton-table` |
| Row for a record the user just created | `PendingRow` | `components/ui/pending-row` |
| Spinner at the point of change | `InlinePending` + `useBusyIds` for per-row pending | `components/ui/inline-pending`, `hooks/use-busy-id` |
| Instant local echo of a list mutation | `useOptimisticList` (insert/update/remove with rollback and self-expiry) | `hooks/use-optimistic-list` |
| Progress over N items | `useBatchProgress` | `hooks/use-batch-progress` |
| Manual refresh of a list or a section retry | `RefreshButton` / `useRouterRefresh` (the one home of a router transition; rows stay on screen) | `components/ui/refresh-button` |
| Settle read for a props-driven list (refreshed server props, no live view) | `useSettleOnChange(value)` → pass as `useServerAction`'s `settle` | `hooks/use-settle-on-change` |
| Single choice from an entity list | `SearchableSelect` (a failed option read passes `loadError` with `onRetryLoad`, which shows „Erneut laden“) | `components/ui/searchable-select` |
| Multi choice from an entity list | `SearchableMultiSelect` (the same retry slot) | `components/ui/searchable-select` |
| Entity choice with inline create | `SelectWithCreate` | `components/ui/select-with-create` |
| Customer choice (with create) | `ClientSelectWithCreate` | `components/auftraege/shared/client-select-with-create` |
| Lager choice (with create) | `LocationSelectWithCreate` | `components/inventar/location-select-with-create` |
| Employee assignment | `EmployeeMultiSelect` | `components/auftraege/shared/employee-multi-select` |
| Job multi-assignment | `JobMultiSelect` | `components/auftraege/shared/job-multi-select` |
| Fixed enum, under ~10 options | shadcn `Select` | `components/ui/select` |
| Date entry | `DatePicker` | `components/ui/date-picker` |
| Month entry (`YYYY-MM`, typed or picked; hidden input for forms) | `MonthPicker` | `components/ui/month-picker` |
| Time entry | `TimeInput` | `components/ui/time-input` |
| Date + time | `DateTimeField` (a `DatePicker` + `TimeInput` pair over one `YYYY-MM-DDTHH:mm` value) | `components/ui/date-time-field` |
| Duration in hours | `DurationHoursInput` | `components/ui/duration-hours-input` |
| Quantity / count | `QuantityStepper` | `components/ui/quantity-stepper` |
| Other numeric field | `Input` with `inputMode="decimal"` + the shared de-DE parser | `components/ui/input`, `lib/ui/decimal` |
| Job picking in clock flows | `JobPickerModal` | `components/job-picker-modal` |
| Next clock actions (the button's sheet, its hot keys, the Zeiterfassung dashboard) | `ClockActionList` over `deriveClockActions` (`lib/time-tracking/clock-actions`): one tap per transition, the job carried along, rare kinds behind „Weitere Aktivitäten …“ | `components/clock-action-list` |
| Full time activity capture (every kind and qualifier) | `TimeActivityDialog`, opened from the action list | `components/time-activity-dialog` |
| Sheet anchored above the clock button on desktop, bottom sheet on phones | `DialogContent placement="anchored"` | `components/ui/dialog` |
| Document linking | `DocumentLinkDialog` / `AttachDocumentDialog` | `components/dokumente/*` |
| Inline-editable detail fields | `MetadataSection` | `components/shared/metadata-section` |
| Success/error/info/progress feedback | `Banner` via `useBanner()` (its dismiss button is named „Hinweis schließen“) | `components/ui/banner` |
| Inline field/action errors | `ErrorText` | `components/ui/error-text` |
| Failure of one page region or section, with retry | `SectionError` | `components/ui/section-error` |
| Failure of a region that a server component loads | `RegionLoadError` (`SectionError` whose retry reads the route again while the rest of the page stays) | `components/shared/region-load-error` |
| Failure of a whole authenticated page | `app/(app)/error.tsx` (sidebar and clock button stay usable); `app/error.tsx` covers a failure of the layout itself | route files |
| Empty list or region, and a search or filter without a match | `EmptyState` (empty source: „Noch keine …“ plus the next step in `action`; no match: „Keine … gefunden“ plus how to widen the search) | `components/ui/empty-state` |
| Loading placeholders | `Skeleton` + the page skeletons | `components/ui/skeleton`, `components/loading-states/*` |
| Collapsible form section („Weitere Angaben“) | `FormDisclosure` (rotating-chevron pattern) | `components/ui/form-disclosure` |
| Yes/no choice, multi-line text, password with show toggle, one-time code | `Checkbox` with its own label; `Textarea`, `PasswordInput` and `InputOTP` inside a `Field` | `components/ui/checkbox`, `components/ui/textarea`, `components/ui/password-input`, `components/ui/input-otp` |
| Separate object on a page, person image | `Card`, `Avatar` | `components/ui/card`, `components/ui/avatar` |
| In-page state tabs | `Tabs` (filled pills, never in a header) | `components/ui/tabs` |
| Side or bottom sheet, destructive confirmation | `Sheet`, `AlertDialog` | `components/ui/sheet`, `components/ui/alert-dialog` |
| Menu on a trigger or a right click, anchored floating panel | `DropdownMenu`, `ContextMenu`, `Popover` | `components/ui/dropdown-menu`, `components/ui/context-menu`, `components/ui/popover` |
| Determinate progress, divider | `Progress`, `Separator` | `components/ui/progress`, `components/ui/separator` |
| Auth and settings forms built on react-hook-form | `Form`, `FormField` and their parts; new forms use plain `<form onSubmit>` | `components/ui/form` |

Building blocks of the rows above, not for direct use: `Label` (rendered by `Field`), `Calendar` (inside `DatePicker`), `OpenDialogProvider` and `RegisterOpenDialog` (the dialog primitives register themselves), `SearchableSelectPopup`, `components/ui/searchable-single-select` and `components/ui/searchable-multi-select` (re-exported by `components/ui/searchable-select`), `useSearchableSelectPopup` and `useDatePickerSegments`.

ESLint rejects native date/time/month/week/number/range/checkbox/radio inputs, native `<select>`, raw `role="alert"`, and sonner imports outside `components/ui/`. Registered controls and feedback components own those interactions. Static attribute checks cover quoted values and JSX expression literals. The config also rejects static viewport and page-column literals, `Label` + nested or conditional control stacks outside `Field`, and call-site hover/cursor classes on `TableRow`/`ListRow`. Standalone section labels and checkbox labels remain supported. `lib/ui/eslint-contracts.test.mjs` probes the effective flat config, including named exceptions, so an exception cannot silently drop unrelated restrictions.

These rules are lint errors in product JSX, too, outside `components/ui/`: a raw `<button>` or raw text `<input>` (`ui/no-raw-controls`), a block element inside a `<p>` (`ui/no-block-in-paragraph`), a submit button disabled by anything but a pending or availability flag (`ui/submit-disabled-only-while-pending`), an icon-only `Button` without a German `aria-label` (`ui/icon-button-needs-name`), a raw `<h1>` outside `PageHeader`, a `max-w-*` class on `DialogContent`, and a waiting dialog without `pending` (`ui/dialog-pending-while-waiting`). In `app/`, `components/` (registry included) and `hooks/`, lint also rejects a pending flag reset only on success (`ui/pending-reset-on-failure`), a page-wide keydown listener that ignores `event.defaultPrevented` (`ui/global-key-handler-respects-consumed`), and an effect that only copies props or state into state (`ui/no-derived-state-effect`). Two unit checks cover what lint cannot see: `lib/conventions/german-copy.test.ts` rejects transliterated umlauts, three dots in place of „…“ and the formal address, and `lib/conventions/route-loading.test.ts` requires a `loading.tsx` in the folder of every authenticated page.

A raw `Select` throws above nine options in development. `lib/ui/select-registry.test.ts` checks resolvable enum bounds independently of the build mode and names runtime choices that need separate bounds. These are Tier 2 checks. Whether a new choice represents entities remains a Tier 3 review decision; a short entity list still needs search.

Native controls stay out of the web app on every viewport, phones included: the mobile browser is not the native app. A future React Native app uses native pickers because that is its platform; the web app keeps its own components and makes them touch-friendly (44 px targets, `inputMode` for the right keyboard).

Rules the registry components already encode — don't re-implement them per call site: search with a clear button, de-DE case-insensitive filtering (`filterByQuery` in `lib/ui/search`), empty states, a retry for a failed option read, `allowNone`, an `action` slot for inline create, `readOnly` rendering, and dialog-aware portaling. Empty-state copy: "Kein/e X gefunden" when a search filters to nothing; when the source list itself is empty, say what the list is for and offer the next action (the `action` slot or an adjacent button).

**Extending the registry:** composites built from these primitives are welcome (`DocumentLinkDialog` is the model). A genuinely new interaction pattern is allowed, but design it deliberately and add its registry row here in the same change. Silent one-offs are the defect this canon exists to prevent.

Searchable choices expose `option` roles and selected state inside a named `listbox`. Arrow keys move between options; Home and End reach the boundaries; Enter or Space selects. Search, clear, and inline-create controls remain reachable with Tab, and closing restores a usable focus position. Inline-create and clear-selection actions sit outside the listbox. A clickable record also needs a semantic link or button for its primary action. `RowActionsMenu` restores trigger focus before invoking an action, preserves focus when that action opens a dialog, and lets Tab leave the menu.

## Interaction canon

### Forms and Enter

Every non-destructive create/edit dialog renders a real `<form onSubmit={...}>`; the primary button is `type="submit"`. Enter submits — that is the whole convention, no manual `onKeyDown` Enter shims. Textareas keep Enter for newlines natively. Validate at the point of action: field-level problems render `ErrorText` under the field (with `aria-invalid` on the input), submit-level failures render `ErrorText` next to the submit button. New forms use plain `<form onSubmit>` with manual state. The existing react-hook-form consumers of `components/ui/form.tsx` stay as they are and are not migrated. Enter always means the primary action and nothing quieter: the work-artifact form's submit sends the artifact for review, and "Entwurf speichern" stays an explicit secondary `type="button"`, so Enter can never silently save a draft.

Every field is a `Field`. It owns stable label, description, error, and required-description IDs. Registered inputs and comboboxes inherit their name and supported required/invalid semantics. Date and time controls use a named `group`; their error and hidden `Pflichtfeld` text are referenced by `aria-describedby`, with `data-invalid` for styling. Do not add unsupported `aria-required` or `aria-invalid` to those groups: the installed ARIA definitions carry no invalid state on `group`, so the linked error description is the accessible error channel. Keep required text out of the accessible name. Helper text is `text-xs text-muted-foreground`; `rows` on a textarea is not used (it sizes to content).

**The submit button is never disabled as a validation hint.** A disabled button makes the user hunt for what is missing and is skipped by keyboard and screen-reader navigation. It stays enabled; on click the form marks the missing fields with `ErrorText` and focuses the first one. Disable only while the action is pending (double-submit protection). The one exception: forms with at most two obvious required fields (login) may enable on completeness.

**Buttons have six states** (default, hover, focus-visible, pressed, loading, disabled). The `Button` primitive owns the first four (`active:` is the pressed darkening); loading is `Button pending`: the button turns busy and disabled, and a `Spinner` takes the place of its leading icon; disabled means pending or an obviously unavailable action, nothing else.

Client-only actions must remain unavailable until their event handlers are ready. Entry-history correction buttons use `useHydrated` for this boundary, so server-rendered HTML cannot accept an ineffective first click. Preserve native form behavior where it works before hydration. Do not hide a lost click with sleeps or repeated opening attempts in a test.

A nested dialog form (e.g. a quick-create dialog opened from a select inside another dialog's form) must call `event.stopPropagation()` in its `onSubmit`: React synthetic submit events bubble through portals along the React tree and would otherwise submit the surrounding form too.

Keep the submission boundary specific to the editable mode. A record-view dialog with separate review, delete, or export commands still needs a native form when it switches to a non-destructive editor. A footer submit button may reference its body's form by a stable `form` ID. Native text inputs use implicit Enter submission; textareas keep newlines, and date/time groups or choice widgets keep their own Enter-to-edit or select behavior. Do not add per-dialog key handlers to override those widget contracts.

`lib/ui/dialog-contracts.test.ts` discovers dialog declarations, follows delegated form components, rejects whole-content scrolling, and records explicit command, browser, and destructive-mode exceptions. The application browser checks own actual footer visibility, validation focus, and nested submission behavior.

### Destructive confirmations

Use `AlertDialog` with `AlertDialogCancel` and `AlertDialogAction`, without a plain footer `Button` or a nested `<form>`. Radix initially focuses Cancel. Enter must not implicitly submit a destructive form; users can deliberately focus and activate the confirmation action with the keyboard. Wording template: the title names object and verb ("Auftrag „X“ löschen?"), the body states the consequence in one sentence, the action button names the outcome ("Endgültig löschen"), destructive styling only when the action is irreversible, "Abbrechen" always present.

### Dialog close and success

One convention: on success the dialog closes and the success banner confirms; on failure the dialog stays open with its filled values and `ErrorText` at the point of action. While a dialog waits for its server answer, its root gets `pending` (`<Dialog pending={isSaving}>`, `<AlertDialog pending={isDeleting}>`): Escape, an outside click and the close controls cannot close it, so the failure cannot land in a dialog that is gone. The guard refuses only the user's dismissal: the owner closes through its own `open` state once the request answers, and a failure releases `pending` so the dialog is dismissible again (`ui:contracts` dialog pending contract). A form inside a dialog reports its request to the host with `useReportPending` (`hooks/use-report-pending.ts`). A Cancel `Button` that closes through the caller's own state also takes `disabled={isSaving}`, and an `AlertDialogAction` that awaits keeps the dialog open with `event.preventDefault()`. A create dialog may close optimistically only after client validation has ruled out every correctable input problem. If the server can still return a correctable domain error, such as a required overlap reason, keep the dialog mounted and pending until the server accepts it; an optimistic list row may render at the same time from the same promise. No inline success flashes before closing, no delayed auto-close timers. Delete flows that redirect confirm via the URL-flash banner on the landing page.

### Long forms in dialogs

Dialog and sheet action groups keep at least 8 px between buttons in both stacked and horizontal layouts. The shared footers own `gap-2`; use them without reducing that gap. A nested action group owns its own gap. Horizontal margin utilities alone leave stacked buttons touching. The styled presentation contract checks actual button separation on phone and desktop.

Tabbed creation and conversion forms use `DialogContent workspace` to keep a stable frame across loading and tab changes. Use a scrolling body within that frame; retain natural sizing for brief confirmations. `DialogFooter` gives its registered buttons at least 44 px height on phones, and `DialogContent` owns the 44 px phone close target. Desktop controls keep their compact sizes. The styled presentation contract checks frame, footer position, touch targets and keyboard access to the last field. Also inspect the real form, since a generic contract cannot prove each form's nesting.

- `DialogContent` caps its height; long content goes in `DialogBody`, which makes the dialog a fixed-header/scroll-body/fixed-footer column. The title and the submit row never scroll out of view. `DialogBody` keeps a 4 px vertical inset so a first or last row's ring is not clipped, but draw a selection state inside the box (`border-primary` plus a tint) rather than as an outer ring: the scroll container clips whatever hangs outside a row.
- Border colors are utilities like any other: the global default border color lives in `@layer base` in `app/globals.css`. Never add an unlayered `*` rule there; it beats every layered utility and silently disables `border-primary` and `border-destructive` app-wide. The styled clock contract pins the selected tile's border color.
- Forms with more than ~8 fields group into titled sections with dividers. Genuinely optional blocks collapse behind `FormDisclosure` — the registry component with the app's rotating-chevron affordance. Never native `<details>`/`<summary>` (the browser marker triangle is off-brand).
- No multi-step wizards for operational forms — office users fill these daily; steps add clicks to routine work. Very large editors use a two-column grid (`sm:grid-cols-2`) plus section grouping instead. Three more consumer-app patterns stay rejected: celebration or confetti empty and success states; optimistic UI as the default posture (domain risk determines where optimism is safe; the pending-feedback matrix names those interactions, and tests distinguish the immediate visual result from confirmed persistence); and mobile bottom navigation (the manager surface is desktop-first, and the 44 px and one-primary-action rules already cover field-worker phones).

### Loading states

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

Pending state binds to the awaited server call through an owner hook, `useServerAction` or `usePendingTask` (`hooks/use-server-action.ts`) or `useBusyIds` (`hooks/use-busy-id.ts`), never to a router transition: `useTransition` and async `startTransition` callbacks are lint-banned in product code. A task that leaves the page (`loadDocument`, a `router.push`) ends with `untilPageLeaves()`, so its control stays pending until the page unmounts. Its one home is `components/ui/refresh-button.tsx` (`RefreshButton`, `useRouterRefresh` for `SectionError` retries); the two named exceptions track a route change rather than a mutation (the organization switch, the document library's folder navigation). Props-driven lists get their settle read from `useSettleOnChange`. It resolves when the supplied value changes, reports a refresh failure on timeout, and cancels quietly on unmount. A timeout must not report that the already-accepted mutation failed. The optimistic echo is reconciled by id and expires by itself when the server list catches up; every optimistic path has a rollback and shows the failure at the point of action. `useServerAction` deliberately runs every call, because suppressing overlapping calls in the hook silently drops flows (an effect-driven fetch, a queued follow-up). Double-submit protection is the disabled control bound to `isPending`, never the hook; do not assume the hook rejects concurrent calls.

Content from an optimistic layer carries the unconfirmed marker (`lib/ui/unconfirmed.ts`: `data-unconfirmed` and `aria-busy`) until an authoritative read confirms it. Pass `unconfirmed` to `ListRow`, `TableRow` or `Card`; `PendingRow` and an active `InlinePending` carry it themselves. It changes no pixels; screen readers, `settled()` and the confirmed-outcome locators read it (`lib/conventions/unconfirmed-marker.test.ts`).

### No silent failures

Every user-blocking or authoritative mutation failure is visible at the point of action — this is a defect class, not a style preference. `console.error` alone is never acceptable for such a failure; neither is closing a dialog on failure or discarding a result (`void someMutation()`). A best-effort cleanup or post-success follow-on may log without interrupting the already-settled primary outcome only when the call site names that contract and the failure cannot invalidate what the user was told. Error copy answers what happened, why (when known), and what to do next, in natural German, without exposing backend internals. One failure, one surface — no double-reporting the same error through two channels.

## Realtime, live views, and dialogs

Live surfaces consume Realtime through the live-view family, never raw events: `useLiveView` (hooks/use-live-view.ts) for a client refetch view (shared debounce, generation guard, keep-last-known with an `isStale` flag, dialog suspension, catch-up), `useRealtimeRouterRefresh` for route refreshes. The one lint-named exception is a surface that needs the event itself rather than a refetch (the project-detail delete-exit watcher); payload inspection for relevance belongs in the primitive's `eventFilter`.

For calendar mutations, range navigation and manual reads also use the shared mutation owner. A refresh landing mid-dialog can remount it and destroy typed input. The dialog primitives (`Dialog`, `AlertDialog`, `Sheet`) register themselves as open in a shared context, and the live-view family suspends while any dialog is open, then fires one catch-up on close. You get this for free by using the primitives — which is the rule: dialogs are built on `components/ui/dialog.tsx` / `alert-dialog.tsx` / `sheet.tsx`, not hand-rolled portals. Inside a primitive, `RegisterOpenDialog` must sit in the presence-gated content, never in the wrapper body: a wrapper body counts always-rendered closed dialogs (the sidebar organization dialogs) as open and silently suspends Realtime refresh app-wide. `DropdownMenuContent` registers at the same place, so a readiness catch-up cannot close an open actions menu.

When testing loading or freshness, measure from the initiating action through the actual usable or updated control. A visible dialog shell is not a usable form, and an optimistic value is not saved-state evidence. Use the shared readiness and cross-session helpers. Their deadlines, required receiver isolation, and evidence rules live in `docs/technical/realtime-and-caching.md`. A correct but slow result fails responsiveness; an environment failure remains unconfirmed. Tier 2 timing checks cover the named scenarios, so Tier 3 review still identifies missing loading and freshness cases.

## Calendar canon (P1-24a)

The calendar (`components/kalender`, `lib/calendar`) is the office's main hub and has its own rules on top of everything above. Change a rule by changing its home, then this list.

- **Readable time geometry.** Short day items have a minimum visual width owned by `DAY_MIN_ITEM_WIDTH`. Lane packing reserves that width, while timestamps and drag payloads retain real duration. A short recorded block shows its activity and a bottom rule for the true time extent. Resize origins track the actual endpoint, including when the hit area is larger. `day-layout.test.ts` and the styled calendar-day contracts protect packing and resize writes.
- **Card hierarchy.** Board cards put the title first, followed by time, customer/site and operational status. Day cards fit their fixed-height lane with time inline; do not copy the taller board anatomy into them. Month cards remain compact. Selection, warning and dispatch meaning must remain visible.
- **Feedback geometry.** Drag refusal text grows within the ghost and stays inside the viewport. Both mouse movement and touch long-press initialize its current label. The styled day and board contracts cover these paths. Calendar skeletons follow the selected view, and a saved month view receives its full initial window instead of repeating the fetch in the browser.

- **Tokens.** Every calendar colour is a `--calendar-*` token in `app/globals.css`; the literal-colour lint rule rejects `rgb()`, `hsl()` and hex in calendar JSX and style strings. Purple marks planning (cards, bars, the Parkplatz); orange stays with actions and the now indicator keeps its one hue exception.
- **Layers.** Three views (Plantafel, Tag, Monat) render on one surface model: rows and columns of Berlin dates, cards for timed visits, bars for all-day and multi-day visits, absence and closure context in the row, hatched days outside employment. The Parkplatz and the Einsätze panels are inset side panels beside the view, never overlays; the Parkplatz closes with Escape when no dialog is open and folds to a fixed sheet on a phone.
- **Cards.** A card carries the time, the title, the customer, the dispatch chip and the material chip; chips truncate and never overflow the card. A tools chip does not exist until a tool assessment fact exists. Capacity shows as „geplant / Soll“ in the cell, with the sentence as title and read-aloud text.
- **The engine.** One drag engine (`drag-engine/drag-engine.tsx`, math in `lib/calendar/drag-math.ts`): a drag starts after a 250 ms press or a small movement, one ghost moves by `transform` without a React commit per pointer move, the container scrolls only after 150 ms in its 40 px edge zone and never while the pointer is outside it, Escape cancels, Shift fines the snap and bypasses the absence and off-day refusals. A parked card cannot target the Parkplatz.
- **The optimistic owner.** `mutations/use-calendar-mutations.ts` composes the visit, park, feedback and optimistic-run hooks beside it into one owner: the card is at its target before the first server call, a refusal rolls back with the rule's sentence, success offers Undo through the inverse write.
- **Messages.** Every refusal, client pre-check and undo failure reads its sentence from `lib/calendar/messages.ts` (`calendarRefusalMessage`); a code without a sentence fails `tsc`, and no component renders a code or an inline sentence. Sentences name the rule and the next step in German with typographic quotes.
- **Shortcuts.** The `?` list is the contract: every line holds in every view or names the one it holds in (`t`, `j`/`k`, `d`/`w`/`m`, `c`, `z`, `?`, Tab and Enter, Esc; `+`/`-` in the day, arrows and Alt-drag on the board). A shortcut that works in one view only is labelled, never implied.
- **Keyboard paths.** Every drag has a command path (the entry popover's „Verschieben …“ and „Parken“, the Parkplatz card's „Einplanen am …“ form) and focus returns to the card after a drop and after every dialog a drop opened; the live region announces the result.
- **History.** A started or past occurrence is locked before anyone tries: no drag source, a lock icon on the card, no edit or move in the popover, the rule named there (`isStartedOccurrence`, the same rule the database enforces). Never let a user start a change the server will refuse; there is no read-only mode.
- **Preferences.** View, horizon, density, weekend, filters, search and „Termine“ persist per user and organization under the `calendar` key; every change saves at once except the search text (600 ms after the last keystroke); „Arbeitszeiten“ is session state.
- **Phones.** The week is a day list for every role, with names when more than one row is visible. The day uses a chronological list per person, with full-width visits and recorded activities; employees do not get a redundant name column. Both lists open the existing detail and editing flows, without drag. Short activities keep their actual times and at least a 44 px target. The month keeps its grid inside its own scroll region. Phone navigation uses a compact date range and 44 px controls.

## Visual target and review

Existing pages establish current behavior and reusable patterns; they are not automatic visual approval. When the owner asks for a redesign, compare a representative populated screen with the chosen references before extending the composition. If the shared controls cause the problem, propose a coherent primitive/token change rather than forcing the old appearance onto the new surface. Preserve permissions, data behavior and accessibility through that change.

Follow `docs/technical/standards-audit.md` under "Rendered design acceptance". The reviewed reference images and what each one shows are in `references/README.md` beside this file. Record the actual rendered evidence, visual findings and dispositions. Checks for radius, colors, overflow or successful clicks do not establish visual quality. Failed captures remain missing evidence. Tests adapt to the intended interaction and prove its persistence separately; test convenience is not a reason to choose a worse user experience.

## How to work

Start each UI task from the procedure below. It names the file to copy and the check to run before you move on, so lint and the contracts confirm the first draft instead of rejecting it.

### Add a page

1. Copy `app/(app)/qualifikationen/page.tsx`: `PageShell`, `PageHeader` with the German title, `PageBody`, and the data behind `Suspense`. A detail page with columns copies `components/auftraege/project-detail/project-detail-content.tsx`: a `@container/detail` wrapper sets the columns by the content width, not the screen width.
2. In an area with subpages, render content under `SubpageHeader`. The area's `layout.tsx` owns `PageHeader` and `AreaNav`.
3. Write the skeleton in `components/loading-states/` from the page's own column definitions, and render it from the route's `loading.tsx`. A new top-level route also gets its entry in `components/sidebar/org-switch-overlay.tsx`.
4. Return `RegionLoadError` with natural German when a server read fails. A client section uses `SectionError`.
5. Add the route to `lib/testing/selection/mobile-route-inventory.ts`.
6. Run `bun run test:unit lib/conventions/route-loading.test.ts lib/ui/skeleton-pairing.test.ts lib/testing/selection/mobile-route-inventory.test.ts` and `bun run lint <files>`.

Wrong turn: a spinner or a generic skeleton as the loading state. It does not mirror the page, so the layout jumps when the data lands.

### Add a form or a dialog

1. Copy `components/auftraege/lifecycle/work-lifecycle-reason-dialog.tsx`: `DialogContent` with its `size`, a real `<form onSubmit>`, and a `type="submit"` primary button.
2. Wrap every control in `Field`, and take the control from the registry: an entity list is searchable, a date is a `DatePicker`, a fixed enum under ten options is a `Select`.
3. On submit, pass the field errors to `Field` and call `focusFirstInvalidField`. The submit stays enabled.
4. Bind pending state to the server call through `useServerAction` or `usePendingTask`, and disable the submit only while it is pending. A submit that leaves the page ends its task with `untilPageLeaves()`.
5. On failure, keep the dialog open with its values and show the sentence from `describeFailure` in `ErrorText`. On success, close the dialog and confirm through `Banner`.
6. Run `bun run lint <files>` and `bun run test:unit lib/ui/dialog-contracts.test.ts lib/ui/field-contracts.test.tsx lib/conventions/german-copy.test.ts`.

Wrong turn: a submit disabled until the form is complete. The user hunts for the missing field, and a keyboard user cannot reach the button.

### Add a list or a table

1. Copy `components/kunden/kunden-content.tsx` and `components/kunden/clients-table.tsx`. The reader follows "Add a list" in `docs/technical/realtime-and-caching.md`.
2. Define the columns once and feed both the table header and the skeleton from them.
3. Render the desktop table with `SortableTableHead` and `TableRow interactive`, and the same rows as `ListRow` cards below the tablet breakpoint.
4. Render `EmptyState`: „Noch keine …“ with the next step for an empty source, „Keine … gefunden“ for a search without a match.
5. Page with `ListPagination` and `parseListPage`.
6. Run `bun run test:unit lib/ui/row-contracts.test.ts lib/ui/skeleton-pairing.test.ts lib/ui/empty-state-copy.test.ts lib/ui/list-pagination-render.test.tsx`, then look at the list at 375 px.

Wrong turn: a table that scrolls sideways on the phone, or columns hidden there. `audit:layout` fails on the overflow, and a hidden column loses information.

### Add a status or a color

1. Pick the semantic family: green success, red destructive, yellow for every waiting-for-approval state, blue info, purple for planning and parked work.
2. Render a state as `Badge` with its variant. A custom surface uses the family's token pair, such as `bg-success-soft` with `text-success-soft-foreground`.
3. A new color is a token in `app/globals.css` for both themes, with its pairs checked in `lib/ui/contrast-contracts.test.ts`.
4. Run `bun run lint <files>` and `bun run test:unit lib/ui/contrast-contracts.test.ts`.

Wrong turn: orange for a status. Orange marks actions, and it stops drawing attention once it is common.

### Change an accepted design

1. Before you build, show the owner the rendered current screen and the proposal, as rendered design acceptance in `docs/technical/standards-audit.md` describes.
2. When the problem is shared, change the token or the primitive in `components/ui/`. Change a call site only for a local problem.
3. Run `bun run test:ui`, and look at both themes at 375 px and on the desktop.
4. After the owner accepts the rendered result, update the references as "Keep accepted screens as visual references" in that doc describes, and run `bun run test:verify --group audit:visual`.

Wrong turn: a reference rewritten because the comparison failed. A reference records what the owner accepted, not what the build produced.

## Checklist

This skill owns virtue 1 in `AGENTS.md`. Tier 1 components own shared behavior, Tier 2 checks catch the covered regressions, and review owns natural German, visual balance, domain meaning and fit for the role. Every item names its mechanism. A `[judgment]` item is a Tier 3 default: diverge only with the note that `AGENTS.md` describes under "How to read the virtues".

- Values come from the tokens in `app/globals.css`: no hex, `rgb()` or `hsl()` literal, no arbitrary hex class, no numbered palette class. [code `app/globals.css`, lint `colorLiteralSelectors`, lint `stylingSelectors`, lint `paletteSelectors`]
- Text and controls keep readable contrast in both themes. [test `lib/ui/contrast-contracts.test.ts`]
- Radius stops at `rounded-lg`, focus is one 2px ring without an offset, and Lucide icons keep the global stroke. [lint `stylingSelectors`, lint `focusRingSelectors`, lint `ui/no-lucide-stroke-width`]
- A page renders `PageShell`, `PageHeader` and `PageBody`, and its title comes from `PageHeader`. An area with subpages has a `layout.tsx` with `AreaNav`. [code `components/shared/page-shell.tsx`, lint `shellSelectors`, lint `headingSelectors`]
- A subpage title is `SubpageHeader`, a detail card title is `SectionTitle`, a screen outside the shell is `StandaloneScreen`. No `h2` copies the page title style. [lint `shellSelectors`, test `lib/ui/eslint-contracts.test.mjs`]
- No control stays under the clock button: page actions are never fixed, and the page body scrolled to its end leaves every control clear. [lint `floatingSelectors`, group `audit:layout`]
- A search field is `SearchInput`. [lint `registrySelectors`]
- A Card does not stack its padding on a self-padded child. [test `lib/ui/card-padding.test.ts`]
- A primitive styles its states once for both themes, so a caller's override works in dark mode too. [test `lib/ui/primitive-state-themes.test.ts`]
- An empty list shows only its `EmptyState`, and one page shows no page buttons. [test `lib/ui/list-pagination-render.test.tsx`]
- Full-height layouts use `h-dvh` or `min-h-dvh`. [lint `stylingSelectors`]
- Nothing scrolls the page horizontally at 375 px, nor on a manager route or detail page at 768, 1024, 1280 and 1680 px, and a table has a `ListRow` card layout below the tablet breakpoint. A toolbar row with fixed-width controls wraps or stacks until it fits beside the sidebar. A page sets its columns by the width of its content (a `@container` wrapper and `@…/detail:` variants, as in `components/auftraege/project-detail/project-detail-content.tsx`), not by the screen, because the app sidebar takes 256 px; column tracks are `minmax(0, …)` so a long name cannot widen them, and a card header with a title and a button wraps. A new authenticated page is listed in the mobile route inventory. [group `audit:layout`, test `lib/testing/selection/mobile-route-inventory.test.ts`, test `lib/ui/row-contracts.test.ts`]
- Every control comes from the component registry: `Button` or `PlainButton`, `Input` in a `Field`, `DatePicker`, `TimeInput`, `SearchableSelect`, `FormDisclosure`. [lint `ui/no-raw-controls`, lint `registrySelectors`, test `lib/ui/field-contracts.test.tsx`]
- A raw `Select` holds a fixed enum with fewer than ten options. An entity list is searchable. [test `lib/ui/select-registry.test.ts`]
- Every field is a `Field`, so its label, required marker and error are wired. [lint `ui/label-in-spaced-container`, test `lib/ui/field-contracts.test.tsx`]
- A submit stays enabled. An invalid submit marks the fields and focuses the first through `focusFirstInvalidField`. An action button that needs a choice or typed text works the same way. [lint `ui/submit-disabled-only-while-pending`, lint `ui/action-disabled-only-while-pending`, code `lib/ui/field-validation.ts`]
- An icon-only button has a German `aria-label`. [lint `ui/icon-button-needs-name`]
- A dialog that waits for its server answer passes `pending` to its root, so Escape, an outside click and the close controls cannot close it before the result lands. [lint `ui/dialog-pending-while-waiting`, code `components/ui/dialog.tsx`, code `components/ui/alert-dialog.tsx`, group `ui:contracts`, judgment]
- A page-wide keydown listener skips a key that a dialog, menu or drag already consumed (`event.defaultPrevented`). [lint `ui/global-key-handler-respects-consumed`]
- Every authenticated route highlights exactly one sidebar entry. [test `lib/ui/sidebar-nav-coverage.test.ts`]
- A number keeps its stored precision from prefill to save: a quantity keeps three fractional digits, and with a decimal comma a dot is a thousands separator. [test `lib/ui/decimal.test.ts`, code `components/ui/quantity-stepper.tsx`, judgment]
- No database id or code reaches the screen or an export: a missing label falls back to neutral German such as „Änderung dokumentiert“, never to `?? id` or `LABELS[code] ?? code`. [judgment]
- A non-destructive dialog is a form that submits on Enter. A destructive confirmation is an `AlertDialog`. A long dialog uses `DialogBody`, and its width comes from the `size` prop. [test `lib/ui/dialog-contracts.test.ts`, lint `dialogSizeSelectors`]
- Every route has its own `loading.tsx` that mirrors its page. [test `lib/conventions/route-loading.test.ts`]
- A placeholder is `Skeleton` and a running action is `Spinner` or `Button pending`, never a hand-built pulse or a `Loader2`; a live pulse is `animate-live`. [code `components/ui/spinner.tsx`, lint `busySignalSelectors`, test `lib/conventions/route-loading.test.ts`, test `lib/ui/eslint-contracts.test.mjs`]
- A skeleton row shares the list's columns and its `interactive` flag, and a row hovers only through that flag. [test `lib/ui/skeleton-pairing.test.ts`, lint `hoverSelectors`, test `lib/ui/contextual-documents-layout.test.ts`]
- An empty list renders `EmptyState` with a „Noch keine …“ or „Keine … gefunden“ title. A region that fails shows `RegionLoadError` or `SectionError` with retry. [code `components/ui/empty-state.tsx`, test `lib/ui/empty-state-copy.test.ts`, code `components/shared/region-load-error.tsx`, judgment]
- A failure is visible at the point of action. Inline errors render through `ErrorText`, global feedback through `Banner`. A rejection never ends in an empty `.catch`, and a pending flag set before an await is reset when the call rejects. The reviewer checks that a failed write keeps the dialog open with its values. [lint `registrySelectors`, lint `swallowedRejectionSelectors`, lint `ui/pending-reset-on-failure`, judgment]
- A failed read is a failure the screen shows, never an empty list or a missing row. [test `lib/conventions/read-error-visibility.test.ts`]
- Every Server Action write in client code shows feedback in its first frame: the pending state of an owner hook (`useServerAction`, `usePendingTask`, `useBusyIds`), a progress banner or an optimistic row. A pending flag written by hand around a write fails the same test unless `HAND_PENDING_STATE` names its reason. [test `lib/conventions/server-action-feedback.test.ts`]
- A control rendered on the server accepts no click before it hydrates. [test `lib/ui/hydration.test.tsx`, test `lib/ui/tabs-hydration.test.tsx`]
- A value derived from props or state is computed during render, never copied into state by an effect: such an effect can starve under hydration scheduling and commit forever. A hydrated list settles after a refresh during a pending route transition. [lint `ui/no-derived-state-effect`, test `tests/ui-contracts/hydration-settle.spec.ts`]
- A post-redirect confirmation (`UrlFlashBanner`) is in the first render, never set from an effect: an effect in a hydration commit can run at idle priority and lose to the param strip. [test `lib/ui/url-flash-banner.test.tsx`]
- A `<p>` holds inline content only. A block element or a block-rendering registry component (`Skeleton`, `Card`, `ErrorText`, `SectionError`, `EmptyState`, `Field`) inside it breaks hydration, because the HTML parser closes the paragraph. [lint `ui/no-block-in-paragraph`]
- The registered date and time controls keep their own picker and segment logic. [test `lib/ui/custom-time-input.test.ts`, test `lib/ui/date-segments.test.ts`]
- Tailwind scans only the class-bearing source folders, and the popover dependency stays on its repaired version. [test `lib/ui/tailwind-source.test.ts`, test `lib/ui/popper-dependency.test.ts`]
- The lint configuration itself rejects every banned spelling. [test `lib/ui/eslint-contracts.test.mjs`]
- German copy uses real umlauts and `ß`, says "du", uses the typographic ellipsis, closes „ with “, and names no slice or ticket code such as P1-14. A stored date reads 01.09.2026, never 2026-09-01. [test `lib/conventions/german-copy.test.ts`, test `lib/conventions/text-encoding.test.ts`, lint `dateTextSelectors`]
- Shared controls hold their semantics, focus and pending states in the component suite. [group `ui:contracts`]
- Orange marks only what deserves attention: no orange status badge, and a row action repeated per row is `outline`. Purple stays a quiet undertone for planning and parked work. [code `components/ui/badge.tsx`, judgment]
- A state is a label, an action is a button: a state renders as `Badge`, a lifecycle button names its step, never the state it ends in, and a reversible step is not a filled red button. [code `components/ui/badge.tsx`, test `lib/work-lifecycle/types.test.ts`, judgment]
- A job, project or work state reads its color from `components/auftraege/status-classes.ts`; no other file maps such a state to a color. [test `lib/conventions/status-colors.test.ts`]
- Hierarchy, density, shadows, natural German and fit for the role pass [rendered design acceptance](../../../docs/technical/standards-audit.md#rendered-design-acceptance) for a major UI change. [judgment]
- An accepted screen keeps its look: every page family has a visual reference, an intended change updates the reference, and the owner accepts each changed image. [group `audit:visual`, judgment]

## Never

- Hardcode a hex value, a radius above `rounded-lg` or a numbered palette class. [lint `colorLiteralSelectors`, lint `stylingSelectors`, lint `paletteSelectors`]
- Write a raw `<button>`, a raw text `<input>`, a native date, time, number or select control, or `<details>`. [lint `ui/no-raw-controls`, lint `registrySelectors`]
- Write a raw `<h1>`, or a `max-w-*` class on `DialogContent`. [lint `headingSelectors`, lint `dialogSizeSelectors`]
- Float a page action in a fixed button. [lint `floatingSelectors`]
- Render a stored `YYYY-MM-DD` date as text. [lint `dateTextSelectors`]
- Hand-roll a page column or a row hover. [lint `shellSelectors`, lint `hoverSelectors`]
- Disable a submit or an action button to express validation. [lint `ui/submit-disabled-only-while-pending`, lint `ui/action-disabled-only-while-pending`]
- Write a raw `role="alert"` outside `components/ui`. [lint `registrySelectors`]
- Use orange as decoration, or purple as a loud accent. [judgment]
- Assert a palette class in a test instead of a semantic token. [test `lib/conventions/palette-classes-in-tests.test.ts`]
- Keep a design the owner rejected as a test baseline or a reference image. [judgment]
- Update a visual reference to pass a failing run. Only a focused update run can rewrite one; whether the owner accepted the new image is review. [test `lib/testing/runner/visual-reference-updates.test.ts`, judgment]

## Verify your work

1. Run `bun run lint`. A pass prints no problem.
2. Run `bun run test:unit`. The tests under `lib/ui/` and `lib/conventions/` pass.
3. Run `bun run test:ui`. The component suite passes.
4. Run `bun run test:verify`. The change plan selects `audit:layout` when a shared control or a token changed. For a release, or after an accepted redesign, run `bun run test:verify --group audit:visual`. It compares each page family's image and its exact visible text, so a changed label fails. To accept a design change, follow the reference rules in `docs/technical/standards-audit.md`.
5. Look at the screen yourself: both themes, 375 px and desktop, the keyboard path, and the empty, loading and error states. A screenshot does not prove an interaction.
6. For a major UI change, follow rendered design acceptance in `docs/technical/standards-audit.md` and record each visual finding with its disposition in the slice record.

## Examples

- `app/(app)/qualifikationen/page.tsx`: `PageShell`, `PageHeader` and `PageBody`, the data behind `Suspense` with the page's own skeleton, and `RegionLoadError` with natural German when the read fails.
- `components/auftraege/lifecycle/work-lifecycle-reason-dialog.tsx`: a dialog that is a form, an enabled submit with `focusFirstInvalidField`, pending state from `usePendingTask`, and the error in `ErrorText`.
- `components/ui/empty-state.tsx`: the one empty state, with the two title patterns written down where every caller reads them.
- `components/auftraege/project-detail/project-detail-content.tsx`: a detail page whose `@container/detail` columns follow the content width, and a failed section read that shows `RegionLoadError` in its own region.

## Tweaking the design later

1. A visual change starts at the tokens in `app/globals.css`, which restyle the whole app.
2. A change to the feel or behavior of a control goes into its primitive in `components/ui/`.
3. A change of intent (a registry row, a canon rule) goes into this file, not into `AGENTS.md`.
