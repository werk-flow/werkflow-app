# Component registry

This file holds the component registry, which names the component that owns each interaction, with the lint and test rules around it, and [SKILL.md](../SKILL.md) routes to it.

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
| Mobile card row of a list, or a row inside a divided card | `ListRow` (`interactive`, `asChild` for links, `skeleton`; `variant="plain"` drops the box for rows inside a `divide-y` container); its own menu or checkbox sits in `ListRowActions`, which keeps the click from opening the row | `components/ui/list-row` |
| Action menu on a row that can replace an optimistic draft or remount under Realtime | `RowActionsMenu` (native trigger/items, body portal, keyboard navigation and focus restoration without a composed Radix `asChild` ref) | `components/ui/row-actions-menu` |
| Loading placeholder for a table or card list | `SkeletonTable` / `SkeletonRows` / `SkeletonList` fed by the list's own column definition | `components/ui/skeleton-table` |
| Row for a record the user just created | `PendingRow` | `components/ui/pending-row` |
| Spinner at the point of change | `InlinePending` + `useBusyIds` for per-row pending | `components/ui/inline-pending`, `hooks/use-busy-id` |
| Instant local echo of a list mutation | `useOptimisticList` (insert/update/remove with rollback and self-expiry) | `hooks/use-optimistic-list` |
| Progress over N items | `useBatchProgress` | `hooks/use-batch-progress` |
| Manual refresh of a list or a section retry | `RefreshButton` / `useRouterRefresh` (the one home of a router transition; rows stay on screen) | `components/ui/refresh-button` |
| Settle read for a props-driven list (refreshed server props, no live view) | `useSettleOnChange(value)` → pass as `useServerAction`'s `settle` | `hooks/use-settle-on-change` |
| Single choice from an entity list | `SearchableSelect` fed by `useJobEntityOptions` (server search, load-more, `loadFailure` with its own „Erneut laden“) | `components/ui/searchable-select` |
| Multi choice from an entity list | `SearchableMultiSelect` (the same `loadFailure` slot) | `components/ui/searchable-select` |
| A read a client component starts (options, a section, a preview) | `useClientRead` (data, loading and a `failure` that carries its retry); the failure renders through `SectionError failure` or a select's `loadFailure`, never as a string | `hooks/use-client-read` |
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
| Link inside running text (a helper text, a sentence that names a record) | `TextLink` (always underlined); a standalone link is `Button variant="link"` | `components/ui/text-link` |
| Separate object on a page, person image | `Card`, `Avatar` | `components/ui/card`, `components/ui/avatar` |
| In-page state tabs | `Tabs` (filled pills, never in a header; `panels={false}` when the tabs filter a list or switch a view without `TabsContent`) | `components/ui/tabs` |
| Region that scrolls sideways | `ScrollRegion` with a canon name (`calendar`, `tab-strip`, `area-nav`, `table`); `focusable` with a German label when it holds no control | `components/ui/scroll-region` |
| Side or bottom sheet, destructive confirmation | `Sheet`, `AlertDialog` | `components/ui/sheet`, `components/ui/alert-dialog` |
| Menu on a trigger or a right click, anchored floating panel | `DropdownMenu`, `ContextMenu`, `Popover` | `components/ui/dropdown-menu`, `components/ui/context-menu`, `components/ui/popover` |
| Determinate progress, divider | `Progress` (its German `label` is required), `Separator` | `components/ui/progress`, `components/ui/separator` |
| An edit of recorded time in a month that may be closed | `useClosedTimePeriods` + `isEntryInClosedPeriod` (the pre-check of the action table) | `components/zeiterfassung/use-closed-time-periods`, `lib/time-tracking/closed-period-dates` |
| Auth and settings forms built on react-hook-form | `Form`, `FormField` and their parts; new forms use plain `<form onSubmit>` | `components/ui/form` |

Building blocks of the rows above, not for direct use: `Label` (rendered by `Field`), `Calendar` (inside `DatePicker`), `OpenDialogProvider` and `RegisterOpenDialog` (the dialog primitives register themselves), `SearchableSelectPopup`, `components/ui/searchable-single-select` and `components/ui/searchable-multi-select` (re-exported by `components/ui/searchable-select`), `useSearchableSelectPopup` and `useDatePickerSegments`.

ESLint rejects native date/time/month/week/number/range/checkbox/radio inputs, native `<select>`, raw `role="alert"`, sonner imports and direct `@radix-ui/*` imports outside `components/ui/`. Registered controls and feedback components own those interactions. Static attribute checks cover quoted values and JSX expression literals. The config also rejects static viewport and page-column literals, `Label` + nested or conditional control stacks outside `Field`, and call-site hover/cursor classes on `TableRow`/`ListRow`. Standalone section labels and checkbox labels remain supported. `lib/ui/eslint-contracts.test.mjs` probes the effective flat config, including named exceptions, so an exception cannot silently drop unrelated restrictions.

These rules are lint errors in product JSX, too, outside `components/ui/`: a raw `<button>` or raw text `<input>` (`ui/no-raw-controls`), a block element inside a `<p>` (`ui/no-block-in-paragraph`), a submit button disabled by anything but a pending or availability flag (`ui/submit-disabled-only-while-pending`), an icon-only `Button` without a German `aria-label` (`ui/icon-button-needs-name`), a raw `<h1>` outside `PageHeader`, a `max-w-*` class on `DialogContent`, and a waiting dialog without `pending` (`ui/dialog-pending-while-waiting`). In `app/`, `components/` (registry included) and `hooks/`, lint also rejects a pending flag reset only on success (`ui/pending-reset-on-failure`), a page-wide keydown listener that ignores `event.defaultPrevented` (`ui/global-key-handler-respects-consumed`), and an effect that only copies props or state into state (`ui/no-derived-state-effect`). Two unit checks cover what lint cannot see: `lib/conventions/german-copy.test.ts` rejects transliterated umlauts, three dots in place of „…“ and the formal address, and `lib/conventions/route-loading.test.ts` requires a `loading.tsx` in the folder of every authenticated page.

A raw `Select` throws above nine options in development. `lib/ui/select-registry.test.ts` checks resolvable enum bounds independently of the build mode and names runtime choices that need separate bounds. These are Tier 2 checks. Whether a new choice represents entities remains a Tier 3 review decision; a short entity list still needs search.

Native controls stay out of the web app on every viewport, phones included: the mobile browser is not the native app. A future React Native app uses native pickers because that is its platform; the web app keeps its own components and makes them touch-friendly (44 px targets, `inputMode` for the right keyboard).

Rules the registry components already encode — don't re-implement them per call site: focus back on the control that opened a dialog, sheet or confirmation (a control that renders anew, such as a calendar card after a move is taken back, carries a stable `data-focus-key`, and a popover on a virtual anchor names that key in `data-focus-return`), search with a clear button, de-DE case-insensitive filtering (`filterByQuery` in `lib/ui/search`), empty states, a retry for a failed option read, `allowNone`, an `action` slot for inline create, `readOnly` rendering, and dialog-aware portaling. Empty-state copy: "Kein/e X gefunden" when a search filters to nothing; when the source list itself is empty, say what the list is for and offer the next action (the `action` slot or an adjacent button).

**Extending the registry:** composites built from these primitives are welcome (`DocumentLinkDialog` is the model). A genuinely new interaction pattern is allowed, but design it deliberately and add its registry row here in the same change. Silent one-offs are the defect this canon exists to prevent.

Searchable choices expose `option` roles and selected state inside a named `listbox`. Arrow keys move between options; Home and End reach the boundaries; Enter or Space selects. Search, clear, and inline-create controls remain reachable with Tab, and closing restores a usable focus position. Inline-create and clear-selection actions sit outside the listbox. A clickable record also needs a semantic link or button for its primary action. `RowActionsMenu` restores trigger focus before invoking an action, preserves focus when that action opens a dialog, and lets Tab leave the menu.
