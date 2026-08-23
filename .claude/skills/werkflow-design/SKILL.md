---
name: werkflow-design
description: WerkFlow's design language and frontend conventions. Use for any UI work in this repo — React/Next.js components, styling, Tailwind, shadcn/ui, layouts, forms, dialogs, feedback, loading states, colors, dark mode, accessibility, or visual polish.
---

# WerkFlow Design Language

WerkFlow looks calm, professional, and a little "boring" on purpose. It replaces flashy legacy software and paper chaos for non-technical German SHK businesses, so clarity and trust beat visual excitement. The Aufträge and Dokumente tables are the north star: simple, elegant, quiet surfaces where content does the talking.

This file carries the complete UI/UX canon: visual language, the component registry, the interaction canon, the feedback vocabulary, and the loading canon. Behavior that can live in code lives in the registered components; this file tells you which component owns which behavior and what the rules are when you compose them.

## Source of truth

All theme values live in `app/globals.css` (`:root` tokens + `@theme inline` mapping). **To change how the app looks, edit the tokens there — never scatter raw hex values or one-off styles in components.** Interaction behavior lives in the registered components below — to change a behavior, change the component, not the call sites. If tokens/components and this file ever disagree, the code wins — then update this file.

The generic `frontend-design` skill is useful for craft (typography discipline, states, UI copy). Where its "distinctive, bold, take a risk" direction conflicts with this calm operational language, this file wins.

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
| Single choice from an entity list | `SearchableSelect` | `components/ui/searchable-select` |
| Multi choice from an entity list | `SearchableMultiSelect` | `components/ui/searchable-select` |
| Entity choice with inline create | `SelectWithCreate` | `components/ui/select-with-create` |
| Customer choice (with create) | `ClientSelectWithCreate` | `components/auftraege/client-select-with-create` |
| Lager choice (with create) | `LocationSelectWithCreate` | `components/inventar/location-select-with-create` |
| Employee assignment | `EmployeeMultiSelect` | `components/auftraege/employee-multi-select` |
| Job multi-assignment | `JobMultiSelect` | `components/auftraege/job-multi-select` |
| Fixed enum, under ~10 options | shadcn `Select` | `components/ui/select` |
| Date entry | `DatePicker` | `components/ui/date-picker` |
| Time entry | `TimeInput` | `components/ui/time-input` |
| Date + time | `DateTimeField` (a `DatePicker` + `TimeInput` pair over one `YYYY-MM-DDTHH:mm` value) | `components/ui/date-time-field` |
| Duration in hours | `DurationHoursInput` | `components/ui/duration-hours-input` |
| Quantity / count | `QuantityStepper` | `components/ui/quantity-stepper` |
| Other numeric field | `Input` with `inputMode="decimal"` + the shared de-DE parser | `components/ui/input`, `lib/ui/search` |
| Job picking in clock flows | `JobPickerModal` | `components/job-picker-modal` |
| Document linking | `DocumentLinkDialog` / `AttachDocumentDialog` | `components/dokumente/*` |
| Inline-editable detail fields | `MetadataSection` | `components/shared/metadata-section` |
| Success/error/info/progress feedback | `Banner` via `useBanner()` | `components/ui/banner` |
| Inline field/action errors | `ErrorText` | `components/ui/error-text` |
| Loading placeholders | `Skeleton` + the page skeletons | `components/ui/skeleton`, `components/loading-states/*` |
| Collapsible form section („Weitere Angaben") | `FormDisclosure` (rotating-chevron pattern) | `components/ui/form-disclosure` |

Hard rules the ESLint config enforces (outside `components/ui/`): no native `type="date"`, `type="time"`, `type="datetime-local"`, or `type="number"` inputs, no native `<select>`, no sonner imports.

Rules the registry components already encode — don't re-implement them per call site: search with a clear button, de-DE case-insensitive filtering (`filterByQuery` in `lib/ui/search`), empty states, `allowNone`, an `action` slot for inline create, `readOnly` rendering, and dialog-aware portaling. Empty-state copy: "Kein/e X gefunden" when a search filters to nothing; when the source list itself is empty, say what the list is for and offer the next action (the `action` slot or an adjacent button).

**Extending the registry:** composites built from these primitives are welcome (`DocumentLinkDialog` is the model). A genuinely new interaction pattern is allowed, but design it deliberately and add its registry row here in the same change. Silent one-offs are the defect this canon exists to prevent.

## Interaction canon

### Forms and Enter

Every non-destructive create/edit dialog renders a real `<form onSubmit={...}>`; the primary button is `type="submit"`. Enter submits — that is the whole convention, no manual `onKeyDown` Enter shims. Textareas keep Enter for newlines natively. Validate at the point of action: field-level problems render `ErrorText` under the field (with `aria-invalid` on the input), submit-level failures render `ErrorText` next to the submit button.

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

- Every route segment ships a `loading.tsx` skeleton from `components/loading-states/` that mirrors the real layout — structure first, data fills in. New top-level routes also get an entry in the app-shell org-switch skeleton map (`components/sidebar/app-shell.tsx`).
- Section-level async loads inside a page use a section skeleton, not a centered spinner with text.
- Inline spinners are only for small contained actions: inside the clicked button or beside the refreshed control.
- Determinate operations (uploads, imports) show progress, never a bare spinner.
- Expected latency under ~1 second gets no loader at all — a flashing skeleton reads as broken.
- Sections load and fail independently: one failed section shows its own error and retry, the rest of the page stays usable.

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

### No silent failures

Every mutation's failure is visible at the point of action — this is a defect class, not a style preference. `console.error` alone is never acceptable; neither is closing a dialog on failure or discarding a result (`void someMutation()`). Error copy answers what happened, why (when known), and what to do next, in natural German, without exposing backend internals. One failure, one surface — no double-reporting the same error through two channels.

## Realtime and dialogs

The app's Realtime subscriptions call `router.refresh()`; a refresh landing mid-dialog can remount it and destroy typed input. The dialog primitives (`Dialog`, `AlertDialog`, `Sheet`) register themselves as open in a shared context, and `useRealtimeRouterRefresh` suspends while any dialog is open, then fires one catch-up refresh on close. You get this for free by using the primitives — which is the rule: dialogs are built on `components/ui/dialog.tsx` / `alert-dialog.tsx` / `sheet.tsx`, not hand-rolled portals.

## Checklist before shipping UI

- [ ] Values come from tokens/primitives, no ad-hoc hex or radius
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
3. Update this file only when the *intent* changes — a new registry row, a changed canon rule — and mirror any skill change between `.claude/skills/` and `.agents/skills/` (they must stay identical). Keep `AGENTS.md`'s styling section in sync.
