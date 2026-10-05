# Integrated test state

Status: living — last reviewed 2026-10-02

Read this page when you choose a date for a test fixture, compute a date-dependent expectation, or keep a page stable during a browser step. [testing.md](testing.md) owns every other testing rule, including the rule that each test prepares its own state.

Each golden and audit group runs one spec file in its own disposable organization. No test consumes the state of another test. `lib/testing/spec-support/spec-independence.ts`, run by `lib/testing/spec-support/spec-conventions.test.ts`, rejects a declared producer, a chained value, a checkpoint handoff, module state that one test writes and another reads, and a wall-clock date read at module load. The two measured performance specs are the only exception: their files are measurement-digest inputs, so they keep their seeded-profile handoff until the next re-measurement.

## Seed the state a test needs

- Seed each precondition through the admin-client helpers in `tests/golden/support/db/` inside the test. Exercise only the claimed operation through its real boundary.
- Derive every identity from the run id. Read a value that the app assigns, such as a job number or an invite code, back from the database inside the same test.
- Derive count expectations from the database at run time, for example notifications or badge numbers. A hardcoded count holds in only one execution mode.
- Address records by their run-scoped identity, and scope each locator to the exact row or section. One world can hold several records with matching names. A spec that uses fixed names instead of run-scoped names must not reuse a name for a different meaning.

## Choose fixture dates

A business fact under a uniqueness constraint collides when two tests of one world pick the same date. Examples are the versions of `employment_conditions` and `work_schedules`, and closure days.

- Claim an audit date through `ownedBerlinDateAtOffset()` in `tests/golden/support/date-ownership.ts`. The function throws when a spec uses an offset outside its own window. The registry `AUDIT_DATE_WINDOWS` in that module owns the windows and throws at import when two windows overlap.
- Register the window of a new group in `AUDIT_DATE_WINDOWS` when the slice starts. Take the next free offsets.
- For a visit that must appear in the manager dispatch panel, use `dispatchOverviewBerlinDateAtOffset()`. It rejects an offset outside the dispatch overview window.
- Inside one file, a later test must not reuse an effective-date key that an earlier test owns. When a test needs a new effective state, choose a date that does not collide and assess the dependent business action on that same date.
- Use a past date for an ordinary manual time entry, with times clear of the other entries in the file. An entry later today is still in the future during an early run. Use a future date only when the scenario tests an allowed future-date path.

## Compute date-dependent expectations

Do not write date logic by hand in a spec. Hand-written logic drifts in holiday weeks and on weekends.

- Read the person's schedules, conditions and holiday calendar through `getTargetContextForRecord` in `tests/golden/support/db/vacation.ts`. Compute consumed vacation days and the weekly target with the product's own functions in `lib/vacation/balance` and `lib/personnel/targets`.
- Resolve every assertion about the target of a day through `resolveDailyTarget`. On a weekend day without a schedule, the dashboard shows that the day is no working day instead of a daily target.

## Keep the page stable during a step

- Locate a row again after every mutation that renders it again. A Realtime refresh can detach the node that a saved locator holds.
- Do not open or select a control whose value is already correct. A router refresh can detach an option between the open and the click.
- Freeze the page before you test an action on a stale view. The app repairs stale views through Realtime events and a refresh on `visibilitychange`, so an unfrozen test races that repair. Swallow the Realtime socket with `page.routeWebSocket` and suppress `visibilitychange` with an init script.
