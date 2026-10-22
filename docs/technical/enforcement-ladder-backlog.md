# Enforcement-ladder backlog

Status: living — last reviewed 2026-10-22

This list holds the open candidates for moving a prose rule or a known gap up the ladder in [decision 0005](../decisions/0005-enforcement-ladder.md), grouped by the virtue in `AGENTS.md` that owns the rule. Each row names the rule, the gap, and the mechanism with its tier: Tier 1 makes the mistake unwritable, Tier 2 makes a check catch it. A row leaves the list in the same change that lands its mechanism, and that change adds the mechanism to the virtue's checklist. Delete a declined candidate and record the reason in the commit message. Check a row against the code before you implement it.

## UI and UX

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Calendar approvals by the responsibility holder | The calendar's entry details offer approval and block moves by role (`canManageBlock`, `canApproveEntries`), while the server asks the `time_approval` holder. `lib/ui/action-prechecks.ts` marks these rows reviewed, so a manager who is not the holder can start an approval the server refuses. | Tier 2: the calendar reads the holder through the approval read model and the pre-check table pairs the views with `canHolderApproveTarget`. |
| Field-worker touch targets | The canon asks for 44 px targets on the field worker's primary flows. Axe's WCAG 2.2 target-size rule on the employee routes measures 24 px, and the 44 px come from `min-h-11` per call site; no `Button` size owns them. | Tier 1 and Tier 2, an owner decision because it moves two accepted phone references: a 44 px `Button` size for primary field actions and a measure of the primary action's height on the employee routes in `audit:layout:field`. |
| States drawn as hand-built chips | A state label is a `Badge` (`components/ui/badge.tsx`), but the invitation status and the approval kinds in `components/mitarbeiter/invitations-table.tsx` and `components/zeiterfassung/pending-approvals-cards.tsx` still render styled spans; the checklist item is judgment. | Tier 2: move the sites to `Badge` variants, then a selector for a rounded-full chip class literal outside the badge primitive. |
| Phone paths of desktop-only dialog openers | Some dialogs of `lib/testing/selection/dialog-inventory.ts` open from a table row menu, the board or the day timeline (`opensOn: 'desktop'` in `tests/audit/support/dialog-openers/`). At 375 px the audit opens them on the desktop and narrows the window, so the phone's own path (a card menu, the day list) is not driven. | Tier 2: an opener per phone path in the area modules, audited at 375 px. |

## Performance and immediate feedback

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Set-returning function reads | `lib/conventions/unpaged-reads.test.ts` checks `.from()` reads; a `.rpc()` that returns an unbounded set is cut at the PostgREST row cap without an error. The two attention functions page through `readCompleteRows` (`lib/attention/pending-sets.ts`); the `list_*_page` functions bound their own page. | Tier 2: the test reads each called function's return shape from `lib/supabase/database.types.ts` and requires a page argument or `readCompleteRows` for a set. |
| Server Actions passed as values | `lib/conventions/live-view-reads.test.ts` follows names across files, not values: a Server Action passed as a prop or parameter, or returned by a hook, and called from an effect is not found. | Tier 1: a branded type on Server Action references that an effect callback or a live-view `read` cannot call. |
| Calendar draft reset in an effect | `components/kalender/use-entry-details-draft.ts` resets its draft when the dialog opens from an effect; the calendar has recorded render behaviour, so `derivedStateEffectExceptions` in `eslint.config.mjs` lists it. | Tier 2: in the run that recalibrates the calendar references, adopt the open key during render and delete the exception. |
| Document library navigation transition | `components/dokumente/document-library-content.tsx` keeps `useTransition` for its folder and search navigation (`transitionExemptFiles` in `eslint.config.mjs`). | Tier 2: bind the pending flag to its `pendingNavigation` state, delete the exemption, and prove it in the documents browser groups. |
| Delayed refresh after the invite dialog | `components/mitarbeiter/personnel-invite-dialog.tsx` shows success inside the dialog for 1.5 s, then closes and refreshes; `DELAYED_REFRESH_SITES` in `lib/realtime/debounce-ownership.test.ts` lists it. | Tier 2: close at once with a banner, refresh through the settle path, and delete the entry. |

## Security

No open candidate.

## Code quality and maintainability

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Added size-cap entries | `lib/conventions/module-caps.test.ts` fails on a stale or loose entry of `eslint-rules/size-cap-exceptions.json`, but a new entry or a ceiling raised together with the code passes; only review sees it. | Tier 2: the pre-push gate compares the list with `origin/main` and refuses an added key or a raised ceiling. |
| Calendar functions over the function limit | The calendar functions in `eslint-rules/size-cap-exceptions.json` are mostly hook calls and JSX props, and the calendar has recorded render behaviour, so a split waits for a run that recalibrates the calendar references. | Tier 2: in that run, split them and delete their entries. |
| Type-assertion ratchet | `eslint-rules/type-assertion-ratchet.json` lists the files that still assert types; the rule and `lib/conventions/type-assertions.test.ts` only stop growth. | Tier 2: shrink the list file by file, by typed selects, parsers and guards, until it is empty and the off-block goes. |
| Bare `toLocaleString` on a date | `timeOfDaySelectors` catches `toLocaleString` with date options only; `date.toLocaleString()` or `toLocaleString('de-DE')` looks like number formatting without type information. | Tier 2: a typed lint rule that refuses `toLocaleString` on a `Date` receiver outside `lib/utils.ts`. |
| Lint probes on existing paths | `createProbeLinter()` lints a probe at an existing path without type information, so the typed rules are probed on virtual paths only. | Tier 2: give the probe linter a project that includes the existing paths, and probe the typed rules there. |
| Schema value lists | `lib/customer-relationships/schemas.ts` repeats the channel, purpose and state values that `lib/customer-relationships/types.ts` derives its unions from. | Tier 1: build the zod enums from the value lists. |
| Date-time shims kept for digest inputs | `lib/planning/date-time.ts` re-exports `resolveBerlinWallTime`, and `shiftIsoDateByDays` in `lib/personnel/types.ts` delegates to `addLocalDays`, because measurement-digest inputs import them. | Tier 2: in the next run that recalibrates the performance references, import `lib/date-time/berlin.ts` there and delete both shims. |

## Testing and review

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Locators of the performance specs | The locator-ownership rules cover `tests/audit/performance/**`. The measured tests still keep copy in their locators: PERF-02 in `calendar.spec.ts`, PERF-L2 in `lists.spec.ts`, PERF-F2 in `field.spec.ts` and the test in `planning-benchmark.spec.ts`. Their code is a measurement-digest input, so each sits inside an `eslint-disable` block that names its scenarios and gives the reason. Each changes only in the run that recalibrates its references. | Tier 2: in that run, move the test's copy into its area module and remove its disable block. |
| Swallowed failures in the digest inputs | `playwright-spec/no-swallowed-failure` covers every support module except the measurement and lab digest inputs (`MEASUREMENT_DIGEST_SUPPORT_FILES`, `LAB_DIGEST_SUPPORT_FILES`): `scenario-measurement.ts`, `lab-network.ts`, `lab-probe.ts` and `lab-recorder.ts` still turn failures into constants, because a byte change there invalidates the performance references. | Tier 2: in the run that recalibrates those references, fix each catch and drop the files from the rule's ignores. |
| Agent pushes past the gate | `git push --no-verify` and a `core.hooksPath` override for one command skip `.githooks/pre-push`. The refusal is prepared (`.claude/hooks/refuse-publication-bypass.ts`, `lib/testing/publication/push-bypass.ts`) but not wired: changing `.claude/settings.json` is the owner's act. | Tier 1: the owner adds the hook to the `PreToolUse` Bash and PowerShell matcher of `.claude/settings.json` and `.codex/hooks.json`, and `lib/testing/runner/guard-wiring.test.ts` pins it. |
| Classification of a repaired group | `bun run test:runs classify` refuses a group whose latest attempt passed, and a `ui:contracts` attempt inside a verification run has no run manifest, so a failure that was repaired before it was classified leaves no incident row and no classification. | Tier 2: `classify` accepts the report id and group of a past failed attempt, reads its log, and records the row. |

## Documentation

| Candidate | Gap today | Target tier and mechanism |
| --- | --- | --- |
| Documents named in prose | A doc that names another doc in prose without a link ("the closed incident archive") escapes the link check, so a reference to a document that never existed passed. Maintenance rule 3 requires a link; only review sees the prose name. | Tier 2 if a reliable pattern for document names appears in `lib/docs/living-doc-rules.ts`; Tier 3 until then. |
| Provenance notes in four catalog flows | `P1-21-F01`, `F09`, `F10` and `F19` end with a dated change note. Each flow's text is hashed in `lib/testing/selection/coverage-map.json`, so removing the note is a coverage change. The catalog keeps a "Dated lines" exemption in decision 0004 for flow lines meanwhile. | Remove the notes and recompute the four hashes with the next change to `P1-21` coverage, then drop the exemption (Tier 2: the date check covers the whole catalog). |
| Paraphrased second homes | `docs:check` fails on an identical sentence of twelve or more words in two living docs or skills; a reworded copy of a rule passes. | Tier 3 review under virtue 6; no mechanical similarity measure has earned its false positives. |
