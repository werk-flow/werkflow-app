---
name: werkflow-design
description: WerkFlow's design language and frontend conventions. Use for any UI work in this repo — React/Next.js components, styling, Tailwind, shadcn/ui, layouts, forms, dialogs, feedback, loading states, colors, dark mode, accessibility, or visual polish.
---

# WerkFlow Design Language

WerkFlow looks calm, professional, and a little "boring" on purpose. It replaces flashy legacy software and paper chaos for non-technical German SHK businesses, so clarity and trust beat visual excitement. The Aufträge and Dokumente tables are existing patterns, not a substitute for an accepted visual target when the owner requests a redesign.

This file holds the procedures, the checklist and the prohibitions. The canon files under `canon/` hold the rules. Behavior that can live in code lives in the registered components; the canon tells you which component owns which behavior and what the rules are when you compose them.

## Read when

| Canon file | Read when |
| --- | --- |
| [Visual language](canon/visual-language.md) | You pick a color, a radius, a shadow, type, a page layout or a Tailwind class. |
| [Component registry](canon/component-registry.md) | You need a control, a field, a row, a dialog or feedback, or add an interaction pattern. |
| [Interaction canon](canon/interaction.md) | You build a form, a dialog or a destructive confirmation. |
| [Feedback and loading](canon/feedback-and-loading.md) | You add a loading state, success or failure feedback, a write's pending state, or a live view. |
| [Calendar canon](canon/calendar.md) | You change `components/kalender` or `lib/calendar`. |
| [Visual target and review](canon/visual-review.md) | The owner asks for a redesign, or you judge a rendered screen. |

## How to work

Start each UI task from the procedure below. It names the file to copy and the check to run before you move on, so lint and the contracts confirm the first draft instead of rejecting it.

### Add a page

1. Copy `app/(app)/qualifikationen/page.tsx`: `PageShell`, `PageHeader` with the German title, `PageBody`, and the data behind `Suspense`. A detail page with columns copies `components/auftraege/project-detail/project-detail-content.tsx`: a `@container/detail` wrapper sets the columns by the content width, not the screen width.
2. In an area with subpages, render content under `SubpageHeader`. The area's `layout.tsx` owns `PageHeader` and `AreaNav`.
3. Write the skeleton in `components/loading-states/` from the page's own column definitions, and render it from the route's `loading.tsx`. A new top-level route also gets its entry in `components/sidebar/org-switch-overlay.tsx`.
4. Return `RegionLoadError` with natural German when a server read fails. A client section uses `SectionError`.
5. Add the route to `lib/testing/selection/mobile-route-inventory.ts`, its group to `lib/testing/selection/surface-groups.ts`, and its in-page tabs by value to `lib/testing/selection/page-tab-inventory.ts`.
6. Run `bun run test:unit lib/conventions/route-loading.test.ts lib/ui/skeleton-pairing.test.ts lib/testing/selection/mobile-route-inventory.test.ts lib/testing/selection/surface-groups.test.ts lib/testing/selection/page-tab-inventory.test.ts` and `bun run lint <files>`.

Wrong turn: a spinner or a generic skeleton as the loading state. It does not mirror the page, so the layout jumps when the data lands.

### Add a form or a dialog

1. Copy `components/auftraege/lifecycle/work-lifecycle-reason-dialog.tsx`: `DialogContent` with its `size`, a real `<form onSubmit>`, and a `type="submit"` primary button.
2. Wrap every control in `Field`, and take the control from the registry: an entity list is searchable, a date is a `DatePicker`, a fixed enum under ten options is a `Select`.
3. On submit, pass the field errors to `Field` and call `focusFirstInvalidField`. The submit stays enabled.
4. Bind pending state to the server call through `useServerAction` or `usePendingTask`, and disable the submit only while it is pending. A submit that leaves the page ends its task with `untilPageLeaves()`.
5. On failure, keep the dialog open with its values and show the sentence from `describeFailure` in `ErrorText`. On success, close the dialog and confirm through `Banner`. Options the dialog reads come from `useClientRead` or an option hook, so a failed read shows its retry.
6. Add the dialog to `lib/testing/selection/dialog-inventory.ts` with the page and role it opens from, and its opener to `tests/audit/support/dialog-openers/<area>.ts`: bring the trigger on screen, name the layer, never submit. The audit opens it with Enter, checks first focus, the Tab cycle and focus return, and measures it at 1280, 768 and 375 px with axe.
7. Run `bun run lint <files>` and `bun run test:unit lib/ui/dialog-contracts.test.ts lib/ui/field-contracts.test.tsx lib/testing/selection/dialog-inventory.test.ts lib/conventions/german-copy.test.ts`, then `bun run test:verify --group audit:layout:<area>`.

Wrong turn: a submit disabled until the form is complete. The user hunts for the missing field, and a keyboard user cannot reach the button. A second wrong turn: `autoFocus` on a field, or an `onOpenAutoFocus` that only prevents the default. Focus then stays on the page behind the dialog.

### Add a list or a table

1. Copy `components/kunden/kunden-content.tsx` and `components/kunden/clients-table.tsx`. The reader follows "Add a list" in `docs/technical/realtime-and-caching.md`.
2. Define the columns once and feed both the table header and the skeleton from them.
3. Render the desktop table with `SortableTableHead` and `TableRow interactive`, and the same rows as `ListRow` cards below the tablet breakpoint.
4. Render `EmptyState`: „Noch keine …“ with the next step for an empty source, „Keine … gefunden“ for a search without a match.
5. Page with `ListPagination` and `parseListPage`.
6. Run `bun run test:unit lib/ui/row-contracts.test.ts lib/ui/skeleton-pairing.test.ts lib/ui/empty-state-copy.test.ts lib/ui/list-pagination-render.test.tsx`, then look at the list at 375 px.

Wrong turn: a table that scrolls sideways on the phone, or columns hidden there. `audit:layout` fails on the overflow, and a hidden column loses information. From the tablet breakpoint a wide table scrolls inside its own region, which `Table` marks itself; a hand-written `overflow-x-auto` around it fails lint.

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

This skill owns virtue 1 in `AGENTS.md`. The tag after each item names its mechanism. A `[judgment]` item is a Tier 3 default: [how to read the virtues](../../../AGENTS.md#how-to-read-the-virtues) says how to diverge.

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
- Text uses a token color at full opacity; opacity modifiers belong to fills and borders. [lint `textOpacitySelectors`, test `lib/ui/eslint-contracts.test.mjs`, group `audit:layout:*`]
- Only a named scroll region scrolls sideways: the calendar surfaces, tab strips, area navs and tables from the tablet breakpoint set the marker through `ScrollRegion` or `scrollRegion`, and a vertical list uses `overflow-y-auto`. [code `components/ui/scroll-region.tsx`, lint `scrollSelectors`, group `audit:layout`]
- Every in-page tab is in the tab inventory and every dialog in the dialog inventory with an opener, or with the reason it cannot open in the audit world. The surface audit opens each tab at every width and each dialog at 1280, 768 and 375 px: it fits the viewport, scrolls vertically inside itself, no control leaves its box and its footer actions are reachable. Each surface group stays within four minutes, and every page, tab and dialog runs in exactly one of them. [test `lib/testing/selection/page-tab-inventory.test.ts`, test `lib/testing/selection/dialog-inventory.test.ts`, test `lib/testing/selection/surface-groups.test.ts`, group `audit:layout:*`]
- Every inventoried page, tab and dialog passes axe's WCAG 2.1 A and AA rules in both themes; a rule is excluded only on a named third-party surface with its reason. The field worker's pages add WCAG 2.2 target sizes. [test `lib/testing/spec-support/axe-exceptions.test.ts`, group `audit:layout:*`, group `audit:layout:field`]
- Markup passes jsx-a11y's recommended rules, the registry included; `Checkbox` counts as the control of its label. [lint `jsx-a11y/recommended`, test `lib/ui/eslint-contracts.test.mjs`]
- A dialog, sheet or confirmation focuses its first control (a confirmation its cancel action), or itself while its fields load or with `initialFocus="dialog"`; Tab stays inside; Escape returns focus to the control that opened it, a row menu's button included. [lint `dialogFocusSelectors`, code `components/ui/return-focus.ts`, group `ui:contracts`, group `audit:layout:*`]
- A Radix primitive is imported only by its registry wrapper. [lint `importRestrictions`, test `lib/ui/eslint-contracts.test.mjs`]
- A confirmation's footer holds `AlertDialogCancel` and `AlertDialogAction` only, and the confirmation holds no form. [lint `ui/alert-dialog-footer-actions`]
- A row's own menu or checkbox sits in `ListRowActions`. A progress bar has a German `label`. Tabs without panels say `panels={false}`, and a tab strip scrolls its active tab into view. [code `components/ui/list-row.tsx`, code `components/ui/progress.tsx`, test `lib/ui/tabs-panels.test.ts`, test `lib/ui/tab-strip-scroll.test.ts`]
- A link inside running text is a `TextLink`, which stays underlined, so it is told apart from the text without color. [code `components/ui/text-link.tsx`, lint `textLinkSelectors`]
- A read a client component starts goes through `useClientRead` or an option hook, and its failure renders with its retry through `SectionError failure` or a select's `loadFailure`. [code `hooks/use-client-read.ts`, test `lib/conventions/client-read-retry.test.ts`, test `lib/conventions/entity-pickers.test.ts`]
- An action the server can refuse is offered only after its pre-check in `lib/ui/action-prechecks.ts`: a started visit, a work transition, a clock transition, an edit of recorded time in a closed month, an approval. [code `lib/ui/action-prechecks.ts`, test `lib/conventions/action-prechecks.test.ts`, test `lib/time-tracking/closed-period-dates.test.ts`]
- The day view keys its rows by employee record like the board; a login adds only time blocks and the role. [test `lib/calendar/day-rows.test.ts`]
- Every control comes from the component registry: `Button` or `PlainButton`, `Input` in a `Field`, `DatePicker`, `TimeInput`, `SearchableSelect`, `FormDisclosure`. [lint `ui/no-raw-controls`, lint `registrySelectors`, test `lib/ui/field-contracts.test.tsx`]
- A raw `Select` holds a fixed enum with fewer than ten options. An entity list is searchable. [test `lib/ui/select-registry.test.ts`]
- A picker of customers, jobs, projects, equipment, service cases, inventory items or coverages takes the whole `useJobEntityOptions` result: it searches on the server, pages with „Weitere Ergebnisse laden“, keeps the selection and retries a failed read with „Erneut laden“. Only a list under [complete lists](../../../docs/technical/realtime-and-caching.md#complete-lists) comes whole. [test `lib/conventions/entity-pickers.test.ts`, group `ui:contracts`]
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
- Import a Radix primitive outside `components/ui/`. [lint `importRestrictions`]
- Scroll sideways outside a `ScrollRegion`, or set its marker in a page. [lint `scrollSelectors`, group `audit:layout`]
- Show a failed read without its retry, or as a string in `ErrorText`. [test `lib/conventions/client-read-retry.test.ts`]
- Fade a text color with an opacity modifier. [lint `textOpacitySelectors`]
- Keep a dialog's first focus outside it: `autoFocus`, or an `onOpenAutoFocus` that only prevents the default. [lint `dialogFocusSelectors`, lint `jsx-a11y/recommended`]
- Offer an edit or a transition the server will refuse. [test `lib/conventions/action-prechecks.test.ts`]
- Switch off an axe rule in a spec. [test `lib/testing/spec-support/axe-exceptions.test.ts`]
- Use orange as decoration, or purple as a loud accent. [judgment]
- Assert a palette class in a test instead of a semantic token. [test `lib/conventions/palette-classes-in-tests.test.ts`]
- Keep a design the owner rejected as a test baseline or a reference image. [judgment]
- Update a visual reference to pass a failing run. Only a focused update run can rewrite one; whether the owner accepted the new image is review. [test `lib/testing/runner/visual-reference-updates.test.ts`, judgment]

## Verify your work

1. Run `bun run lint`. A pass prints no problem.
2. Run `bun run test:unit`. The tests under `lib/ui/` and `lib/conventions/` pass.
3. Run `bun run test:ui`. The component suite passes.
4. Run `bun run test:verify`. The change plan selects `audit:layout` when a shared control or a token changed, and the surface groups `audit:layout:<area>` of the areas you changed. For a release, or after an accepted redesign, run `bun run test:verify --group audit:visual`. It compares each page family's image and its exact visible text, so a changed label fails. To accept a design change, follow the reference rules in `docs/technical/standards-audit.md`.
5. Look at the screen yourself: both themes, 375 px and desktop, the keyboard path, and the empty, loading and error states. For each changed screen, add it to a set in `tests/audit/support/acceptance-sets.ts`, capture it before and after with `bun run test:audit:focused --grep "@ACCEPT <set>"`, and judge the pair. A screenshot does not prove an interaction.
6. For a major UI change, follow rendered design acceptance in `docs/technical/standards-audit.md` and record each visual finding with its disposition in the slice record.

## Examples

- `app/(app)/qualifikationen/page.tsx`: `PageShell`, `PageHeader` and `PageBody`, the data behind `Suspense` with the page's own skeleton, and `RegionLoadError` with natural German when the read fails.
- `components/auftraege/lifecycle/work-lifecycle-reason-dialog.tsx`: a dialog that is a form, an enabled submit with `focusFirstInvalidField`, pending state from `usePendingTask`, and the error in `ErrorText`.
- `components/ui/empty-state.tsx`: the one empty state, with the two title patterns written down where every caller reads them.
- `components/auftraege/project-detail/project-detail-content.tsx`: a detail page whose `@container/detail` columns follow the content width, and a failed section read that shows `RegionLoadError` in its own region.

## Tweaking the design later

1. A visual change starts at the tokens in `app/globals.css`, which restyle the whole app.
2. A change to the feel or behavior of a control goes into its primitive in `components/ui/`.
3. A change of intent (a registry row, a canon rule) goes into this skill's canon files, not into `AGENTS.md`.
