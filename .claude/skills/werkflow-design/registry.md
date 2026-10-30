# Component registry

Each row names the component that owns an interaction. Components live in `components/ui/<name>` and hooks in `hooks/` unless the row names another home.

First ask of every choice: entities or a fixed enum? A raw `Select` holds a fixed enum with fewer than ten options. An entity list (people, customers, jobs, sites, catalogs) assumes 30 or more entries and is searchable. `Select` throws above nine options in development.

| Need | Component |
| --- | --- |
| Page frame | `PageShell`, `PageHeader`, `PageBody` (`components/shared/`) |
| Route tabs of an area | `AreaNav` in the area's `layout.tsx` (`components/shared/`) |
| Header action whose dialog lives in suspended content | `PageActionProvider`, `PageActionButton`, `usePageAction` (`components/shared/page-action`) |
| Header actions that suspended content renders | `PageHeaderSlotProvider`, `PageHeaderSlot`, `PageHeaderActions` (`components/shared/page-action`) |
| Subpage title, detail card title | `SubpageHeader`, `SectionTitle` (`components/shared/`) |
| Screen outside the app shell | `StandaloneScreen` with `StandaloneTitle` (`components/shared/`) |
| Columns of a detail page and its skeleton | `DetailColumns` (`components/shared/`) |
| Form field | `Field`; on an invalid submit, `focusFirstInvalidField` (`lib/ui/field-validation`) |
| Action or submit | `Button`: `default` for the one primary, `outline` for an action repeated per row, `destructive` only for an irreversible step |
| Clickable region with its own shape | `PlainButton` |
| Search field | `SearchInput`, named with `aria-label` |
| Link inside running text | `TextLink`; a standalone link is `Button variant="link"` |
| State label | `Badge` (`secondary`, `success`, `warning`, `destructive`, `outline`; no orange) |
| Dialog | `DialogContent size` (`sm` to `4xl`, `window`), `DialogBody`, root `pending`; `placement="anchored"` for a sheet above the clock button; `workspace` for tabbed create forms |
| Destructive confirmation | `AlertDialog`, root `pending`; `AlertDialogBody` scrolls a long confirmation between header and footer; without it the footer sticks to the bottom; a failed confirm shows in `AlertDialogFooter error` |
| Sheet, menu, popover | `Sheet`, `DropdownMenu`, `ContextMenu`, `Popover` |
| Row menu that survives an optimistic replace or a Realtime remount | `RowActionsMenu` |
| Table | `Table`, `SortableTableHead`, `TableRow interactive` (`"select"`: click selects, double click opens) |
| Card row on phones, row in a divided card | `ListRow` (`variant="plain"` inside `divide-y`); its menu or checkbox sits in `ListRowActions` |
| Form per person in a list | `Table` with a `ListRow` card on phones; the controls join the form through the `form` attribute (`components/zeiterfassung/time-account-person-table.tsx`) |
| List skeleton | `SkeletonTable`, `SkeletonRows`, `SkeletonList` fed by the list's columns; `hiddenHeader` for a column without a title |
| Page skeleton | `Skeleton` in `components/loading-states/` |
| Row the user just created | `PendingRow` |
| Pending at one row | `InlinePending` with `useBusyIds` |
| Optimistic list edit | `useOptimisticList` |
| Progress | `useBatchProgress` over many items; `Progress` with a German `label` |
| Manual refresh, section retry | `RefreshButton`, `useRouterRefresh` |
| Settle a list fed by server props | `useSettleOnChange`, passed as `useServerAction`'s `settle` |
| Read a client component starts | `useClientRead`; its `failure` renders through `SectionError failure` or a select's `loadFailure` |
| Entity choice | `SearchableSelect`, `SearchableMultiSelect` fed by `useJobEntityOptions` |
| Entity choice with create | `SelectWithCreate`, `ClientSelectWithCreate`, `LocationSelectWithCreate` |
| Employees, jobs | `EmployeeMultiSelect`, `JobMultiSelect` (`components/auftraege/shared/`) |
| Fixed enum under ten options | `Select` |
| Date, month, time, date with time | `DatePicker`, `MonthPicker`, `TimeInput`, `DateTimeField` |
| Hours, quantity, other number | `DurationHoursInput`, `QuantityStepper`, `Input inputMode="decimal"` with `lib/ui/decimal` |
| Yes or no, long text, password, one-time code | `Checkbox`, `Textarea`, `PasswordInput`, `InputOTP` |
| Optional form block („Weitere Angaben“) | `FormDisclosure` |
| Clock actions | `ClockActionList` over `deriveClockActions`, `TimeActivityDialog`, `JobPickerModal` |
| Document linking | `DocumentLinkDialog`, `AttachDocumentDialog` (`components/dokumente/`) |
| Inline-editable detail fields | `MetadataSection` (`components/shared/`) |
| Feedback | `Banner` through `useBanner()`, `UrlFlashBanner` after a redirect, `ErrorText` inline |
| Failed region | `SectionError`; a server-loaded region `RegionLoadError` (`components/shared/`); a whole page `app/(app)/error.tsx` |
| Empty list or region | `EmptyState`; `size="compact"` inside a card section |
| Sideways scroll | `ScrollRegion` (`calendar`, `tab-strip`, `area-nav`, `table`) |
| In-page tabs | `Tabs`; `panels={false}` without `TabsContent` |
| Edit of recorded time in a closed month | `useClosedTimePeriods` with `isEntryInClosedPeriod` |
| Separate object, person image | `Card`, `Avatar` |

Building blocks, not for direct use: `Label`, `Calendar`, `RegisterOpenDialog`, and the internals behind `SearchableSelect`.

## What the components already do

Use them instead of re-implementing: focus return to the opener (a control that renders anew carries a stable `data-focus-key`), search with a clear button, de-DE filtering (`filterByQuery` in `lib/ui/search`), empty states, a retry for a failed option read, `allowNone`, an `action` slot for inline create, `readOnly`, dialog-aware portals, listbox keyboard semantics.

## Extend the registry

- Compose from these components. `DocumentLinkDialog` is the model.
- A new interaction pattern is allowed. Design it deliberately and add its row here in the same change.
- Native controls stay out of the web app on phones too. The registry controls are touch-friendly (44 px targets, `inputMode`).
