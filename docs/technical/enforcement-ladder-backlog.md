# Enforcement-ladder backlog

Status: living — last reviewed 2026-10-26

This list holds the open candidates for moving a prose rule or a known gap up the ladder in [decision 0005](../decisions/0005-enforcement-ladder.md), grouped by the virtue in `AGENTS.md` that owns the rule. Each row names the rule, the gap, and the mechanism with its tier: Tier 1 makes the mistake unwritable, Tier 2 makes a check catch it. A row leaves the list in the same change that lands its mechanism, and that change adds the mechanism to the virtue's checklist. Delete a declined candidate and record the reason in the commit message. Check a row against the code before you implement it.

## UI and UX

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| States drawn as hand-built chips | A state label is a `Badge` (`components/ui/badge.tsx`), but the invitation status and the approval kinds in `components/mitarbeiter/invitations-table.tsx` and `components/zeiterfassung/pending-approvals-cards.tsx` still render styled spans; the checklist item is judgment. | Tier 2: move the sites to `Badge` variants, then a selector for a rounded-full chip class literal outside the badge primitive. |

## Performance and immediate feedback

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Server Actions passed as values | `lib/conventions/live-view-reads.test.ts` follows a Server Action passed as a prop or parameter to the caller that passes it, but not one returned by a hook or passed to a component bound through `memo(…)` or `forwardRef(…)`. | Tier 1: a branded type on Server Action references that an effect callback or a live-view `read` cannot call. |
| Calendar draft reset in an effect | `components/kalender/use-entry-details-draft.ts` resets its draft when the dialog opens from an effect; the calendar has recorded render behaviour, so `derivedStateEffectExceptions` in `eslint.config.mjs` lists it. | Tier 2: in the run that recalibrates the calendar references, adopt the open key during render and delete the exception. |
| Document library navigation transition | `components/dokumente/document-library-content.tsx` keeps `useTransition` for its folder and search navigation (`transitionExemptFiles` in `eslint.config.mjs`). | Tier 2: bind the pending flag to its `pendingNavigation` state, delete the exemption, and prove it in the documents browser groups. |

## Security

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| R2 bucket CORS | The runtime R2 tokens get `AccessDenied` on `GetBucketCors`, so nothing checks that the buckets allow only the app's origins. | Tier 2: a script like `auth:check` that reads the rules with an R2 token with Admin Read on each bucket, once the owner provides one. |
| Vercel environment scopes | No credential on the workstation can read the project's environment variables, so nothing checks that each value is scoped to Production or to pre-production as [environments](environments.md) requires. | Tier 2: a script that reads the scopes through the Vercel API with a Vercel access token, once the owner provides one. |
| Bounded client collections | Every array and record in a Server Action or route input schema has a bound, but only review keeps the next one bounded. | Tier 2: a unit test that walks each schema an action parameter is parsed with (the parse sites `lib/conventions/server-action-input.test.ts` already finds) and fails on an array without a maximum or a record with an open key set. |

## Code quality and maintainability

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Reviewed separate writes | `ALLOWED_SEPARATE_WRITES` in `lib/conventions/related-writes.test.ts` holds the reviewed action paths that write more than once, but `lib/testing/publication/shrink-only-lists.ts` does not register it, so a new entry passes the gate. | Tier 2: register the list once its current entries are published. |
| Calendar functions over the function limit | The calendar functions in `eslint-rules/size-cap-exceptions.json` are mostly hook calls and JSX props, and the calendar has recorded render behaviour, so a split waits for a run that recalibrates the calendar references. | Tier 2: in that run, split them and delete their entries. |
| Type-assertion ratchet | `eslint-rules/type-assertion-ratchet.json` lists the files that still assert types; the rule and `lib/conventions/type-assertions.test.ts` only stop growth. | Tier 2: shrink the list file by file, by typed selects, parsers and guards, until it is empty and the off-block goes. |
| Bare `toLocaleString` on a date | `timeOfDaySelectors` catches `toLocaleString` with date options only; `date.toLocaleString()` or `toLocaleString('de-DE')` looks like number formatting without type information. | Tier 2: a typed lint rule that refuses `toLocaleString` on a `Date` receiver outside `lib/utils.ts`. |
| Schema value lists | `lib/customer-relationships/schemas.ts` repeats the channel, purpose and state values that `lib/customer-relationships/types.ts` derives its unions from. | Tier 1: build the zod enums from the value lists. |
| Date-time shims kept for digest inputs | `lib/planning/date-time.ts` re-exports `resolveBerlinWallTime`, and `shiftIsoDateByDays` in `lib/personnel/types.ts` delegates to `addLocalDays`, because measurement-digest inputs import them. | Tier 2: in the next run that recalibrates the performance references, import `lib/date-time/berlin.ts` there and delete both shims. |
| Rollback-tolerant reads | The [migration rule](environments.md#the-migration-rule) keeps a rollback of the code safe for the schema, but older code must also read values a newer release wrote. Today a new enum or CHECK value breaks whole reads: `membershipRowsSchema` in `lib/data/cached.ts` throws in the `(app)` layout, so every page fails for that user; `constrainedValue` (`lib/validation/constrained-value.ts`) throws by design in the vacation, sickness, customer-relationship, inventory and qualification mappers; `toTimeSegmentFact` in `lib/time-tracking/segments.ts` fails the clock state; one unknown value rejects the whole payload in `lib/calendar/window-response.ts`, the occurrence schemas of `lib/planning/server.ts`, `parseWorkLifecycleSnapshot` and `lib/clients/list-page.ts`; `Record<Enum, …>` label lookups without a fallback crash `components/zeiterfassung/entry-history.tsx` and `components/service/equipment-form-dialog.tsx` and blank many badges. `employmentTypeLabel` in `lib/personnel/types.ts` and the `?? fallback` labels are the pattern to copy. | Tier 1: a tolerant enum parser that maps an unknown value to an explicit `unknown` variant, and a label helper that requires a fallback. Tier 2: a convention test that a row schema parses an enum column only through it. |

## Testing and review

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Locators of the performance specs | The locator-ownership rules cover `tests/audit/performance/**`. The measured tests still keep copy in their locators: PERF-02 in `calendar.spec.ts`, PERF-L2 in `lists.spec.ts`, PERF-F2 in `field.spec.ts` and the test in `planning-benchmark.spec.ts`. Their code is a measurement-digest input, so each sits inside an `eslint-disable` block that names its scenarios and gives the reason. Each changes only in the run that recalibrates its references. | Tier 2: in that run, move the test's copy into its area module and remove its disable block. |

## Documentation

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Documents named in prose | A doc that names another doc in prose without a link ("the closed incident archive") escapes the link check, so a reference to a document that never existed passed. Maintenance rule 3 requires a link; only review sees the prose name. | Tier 2 if a reliable pattern for document names appears in `lib/docs/living-doc-rules.ts`; Tier 3 until then. |
| Provenance notes in four catalog flows | `P1-21-F01`, `F09`, `F10` and `F19` end with a dated change note. Each flow's text is hashed in `lib/testing/selection/coverage-map.json`, so removing the note is a coverage change. The catalog keeps a "Dated lines" exemption in decision 0004 for flow lines meanwhile. | Remove the notes and recompute the four hashes with the next change to `P1-21` coverage, then drop the exemption (Tier 2: the date check covers the whole catalog). |
