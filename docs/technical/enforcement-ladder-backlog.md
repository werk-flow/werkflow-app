# Enforcement-ladder backlog

Open candidates for moving a rule up the ladder of [decision 0005](../decisions/0005-enforcement-ladder.md). Check a row against the code before you implement it. Delete it in the change that lands its mechanism, or when declined, with the reason in the commit body.

## UI and UX

| Candidate | Gap | Target |
| --- | --- | --- |
| Hand-built state chips | `components/mitarbeiter/invitations-table.tsx` and `components/zeiterfassung/pending-approvals-cards.tsx` render styled spans instead of `Badge`. | Tier 2: move them to `Badge` variants, then a selector for a rounded-full chip class outside the badge primitive. |

## Performance and immediate feedback

| Candidate | Gap | Target |
| --- | --- | --- |
| Server Actions passed as values | `lib/conventions/live-view-reads.test.ts` misses an action returned by a hook or passed through `memo(…)` or `forwardRef(…)`. | Tier 1: a branded type on Server Action references that an effect or a live-view `read` cannot call. |
| Calendar draft reset in an effect | `components/kalender/use-entry-details-draft.ts` sits on `derivedStateEffectExceptions` in `eslint.config.mjs`. | Tier 2: in the run that recalibrates the calendar references, adopt the open key during render and delete the exception. |
| Document library transition | `components/dokumente/document-library-content.tsx` keeps `useTransition` (`transitionExemptFiles`). | Tier 2: bind the pending flag to `pendingNavigation`, delete the exemption, prove it in the documents browser groups. |

## Security

| Candidate | Gap | Target |
| --- | --- | --- |
| R2 bucket CORS | Runtime R2 tokens get `AccessDenied` on `GetBucketCors`. | Tier 2: a script like `auth:check` with an Admin Read R2 token, once the owner provides one. |
| Vercel environment scopes | No workstation credential reads the project's variables. | Tier 2: a script that reads the scopes through the Vercel API, once the owner provides a token. |
| Bounded client collections | Every array and record in an action input schema has a bound, but only review keeps the next one bounded. | Tier 2: a unit test that walks each parsed action schema and fails on an array without a maximum or an open record. |

## Code quality and maintainability

| Candidate | Gap | Target |
| --- | --- | --- |
| Reviewed separate writes | `ALLOWED_SEPARATE_WRITES` in `lib/conventions/related-writes.test.ts` is not a shrink-only list, so a new entry passes. | Tier 2: register it in `lib/testing/publication/shrink-only-lists.ts`. |
| Calendar functions over the size limit | Their split changes recorded render behavior. | Tier 2: split them in the run that recalibrates the calendar references, and delete their entries. |
| Type-assertion ratchet | `eslint-rules/type-assertion-ratchet.json` only stops growth. | Tier 2: shrink it file by file with typed selects, parsers and guards, until the off-block goes. |
| Bare `toLocaleString` on a date | `timeOfDaySelectors` sees only calls with date options. | Tier 2: a typed lint rule that refuses `toLocaleString` on a `Date` outside `lib/utils.ts`. |
| Schema value lists | `lib/customer-relationships/schemas.ts` repeats the values `types.ts` derives its unions from. | Tier 1: build the zod enums from the value lists. |
| Date-time shims | `lib/planning/date-time.ts` and `shiftIsoDateByDays` in `lib/personnel/types.ts` stay because digest inputs import them. | Tier 2: import `lib/date-time/berlin.ts` in the next performance recalibration and delete both. |
| Rollback-tolerant reads | Older code must read values a newer release wrote ([migration rule](environments.md#the-migration-rule)). An unknown enum or CHECK value breaks whole reads: `membershipRowsSchema` in `lib/data/cached.ts` fails every page for that user, `constrainedValue` throws by design, several payload schemas reject the whole payload, and `Record<Enum, …>` label lookups without a fallback crash. `employmentTypeLabel` in `lib/personnel/types.ts` is the pattern. | Tier 1: a tolerant enum parser with an explicit `unknown` variant, and a label helper that requires a fallback. Tier 2: a convention test that row schemas parse enum columns only through it. |

## Testing and review

| Candidate | Gap | Target |
| --- | --- | --- |
| Locators of the performance specs | PERF-02, PERF-L2, PERF-F2 and the planning benchmark keep copy in their locators inside reasoned `eslint-disable` blocks, because their code is a digest input. | Tier 2: move the copy into the area module in the run that recalibrates each reference. |
| Debounce drains in golden support | `addConditionViaDialog`, `addWorkScheduleViaDialog` (`tests/golden/support/steps/personnel.ts`), `closeRequestViaDialog` (`requests.ts`) and `recordSicknessForMemberViaSection` (`sickness.ts`) sleep 300 ms and retry once, inside reasoned disables of `test-hygiene/no-wall-clock-wait` and `no-polling-loop`: no signal names a pending debounced refresh. | Tier 2: a busy signal for a scheduled router refresh, a wait on it in the four helpers, and no disable left. |
| Realtime canary polling | `observe` in `tests/canary/support/realtime-boundaries.ts` polls the captured events every 50 ms inside reasoned disables. | Tier 2: resolve a waiter from the subscription callback, bounded by a rejecting deadline, and delete the two disables. |
| Skips behind a condition | `test-hygiene/no-excluded-test` reads `test.skipIf(…)` as a registration, so a constant condition skips without a quarantine. The isolated-process pattern (`test.skipIf(ISOLATED)`) needs the condition. | Tier 2: refuse `skipIf`, `if` and `todoIf` with anything but an identifier named in the isolated-process pattern. |
| Review levels | Only the agent checks a PR's [review level](coderabbit.md#choose-the-review-level), its `sol-loop` line and a level 2 CodeRabbit review. `Check` cannot carry it: the app review comes after `Check` is green, and a body edit does not start `ci.yml`. | Tier 2: a small workflow on `pull_request` and `pull_request_review`, added by the owner as a second required check. It fails a non-docs PR without the `Reviewed with sol-loop:` line, and a level 2 PR without a finished CodeRabbit review. |
