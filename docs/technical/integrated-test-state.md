# Integrated test state

Read this page when you choose a fixture date, compute a date-dependent expectation, or keep a page stable during a browser step. [testing.md](testing.md) owns every other testing rule.

No test consumes another test's state. A large fixture that several tests of one world read is seed-or-reuse: each test calls the helper, and the first call seeds it (`ensureTypicalProfile` in `tests/audit/support/performance-profile.ts`).

## Seed the state a test needs

- Derive every identity from the run id. Read app-assigned values, such as a job number or an invite code, back from the database inside the same test.
- Derive count expectations from the database at run time. A hardcoded count holds in one execution mode only.
- Address records by their run-scoped identity, and scope each locator to the exact row or section. A spec with fixed names never reuses a name for a different meaning.

## Choose fixture dates

A fact under a uniqueness constraint collides when two tests of one world pick the same date, such as `employment_conditions` and `work_schedules` versions or closure days.

- Claim an audit date through `ownedBerlinDateAtOffset()` in `tests/golden/support/date-ownership.ts`. It throws outside the spec's window. `AUDIT_DATE_WINDOWS` owns the windows and throws at import when two overlap.
- Register a new group's window in `AUDIT_DATE_WINDOWS` when the slice starts. Take the next free offsets.
- A visit that must appear in the manager dispatch panel uses `dispatchOverviewBerlinDateAtOffset()`.
- Days a week view must show whole use `ownedBerlinWeekAtOffset()`. It returns the first Monday on or after the offset, so the week holds the same days on every run weekday, and it throws unless the spec owns all seven.
- A later test in a file never reuses an effective-date key an earlier test owns. Assess the dependent business action on the new date.
- An ordinary manual time entry uses a past date, with times clear of the file's other entries. An entry later today is still in the future during an early run.
- Avoid a fixture date on a DST switch unless the test is about DST.

## Compute date-dependent expectations

Never write date logic by hand in a spec; it drifts in holiday weeks and on weekends.

- Read schedules, conditions and holiday calendar through `getTargetContextForRecord` in `tests/golden/support/db/vacation.ts`. Compute vacation days and weekly targets with `lib/vacation/balance` and `lib/personnel/targets`.
- Resolve every daily-target assertion through `resolveDailyTarget`. On a weekend day without a schedule, the dashboard shows no working day instead of a target.

## Keep the page stable during a step

- Locate a row again after every mutation that renders it again. A Realtime refresh detaches the node a saved locator holds.
- Do not open or select a control whose value is already correct. A router refresh can detach an option between the open and the click.
- Before you test an action on a stale view, call `freezeLiveUpdates` (`tests/golden/support/live.ts`). Otherwise the test races the app's Realtime and `visibilitychange` repair.
