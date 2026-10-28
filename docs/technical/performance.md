# Performance

This doc owns how WerkFlow measures speed: journeys, lab counts, payload budgets, layout stability, and the procedure to make a flow faster. [Realtime and caching](realtime-and-caching.md) owns feedback, freshness and latency targets. [Testing](testing.md#deadlines-and-measured-scenarios) owns wall-clock scenarios.

Most cost sits in data loading: which reads a route render runs, how many renders one save causes, how many bytes reach the browser. The lab counts those, because a count repeats exactly between runs and a millisecond does not. A count never decides alone. Freshness comes first, and a person judges what the user sees.

## How to work

### Add a journey

A journey is a step one role repeats many times a day, measured from the user's action to the usable result.

1. Take the step from a feature spec and its catalog flows. Add it to `JOURNEYS` in `lib/testing/journeys.ts` with its role, start action, usable result and catalog flow ids. Wrong turn: a journey that starts when a component mounts. The span starts at the click, the tap or the navigation.
2. Add a lab step: a row in `LAB_STEPS` in `lib/testing/lab-steps.ts` with its absolute budgets (such as one route render for a save), and one test in the role's spec under `tests/audit/lab/` that calls `recordLabStep` with that id. Locators and setup go to `tests/audit/support/lab-journeys.ts`.
3. Add a wall-clock scenario only when the usable result has a target kind in `tests/golden/support/browser-observation.ts` and the measured protocol knows the spec. Both are frozen digest inputs, so a new spec file gets lab steps only. Wrong turn: a journey with only a wall-clock scenario. Noise hides a regression of a few requests; a count does not.
4. Run the group five times on one build (`bun run test:verify --group audit:lab:<name> --fresh`), then `bun scripts/lab-counts.ts calibrate --runs <five run keys> --reason "<basis>"`. It keeps only metrics that stayed within tolerance. Switch the step to `comparison: 'required'`.

### Improve a flow

1. **Measure on the user's span.** Run the journey's lab group and read its table and the run's `lab-diagnosis.ndjson` (route renders, gateway paths).
2. **Name the cause from the data path.** Look for a read twice in one render, a route render the action response already carried, an effect read through the Server Action queue, a read that blocks first paint but is not needed to act, a list re-rendered for one row (`componentRenders`), and idle work. Wrong turn: removing a request because the count shows it. Ask first what it keeps current.
3. **Keep the freshness contract.** Every read that keeps shown data current stays. Reorder so what the user needs to act arrives first. Wrong turn: buying a lower count with staler data.
4. **Write the guard first.** A convention test, a contract or a lab budget fails on the slow version. Confirm it fails on the current tree.
5. **Change, rebuild, measure again.** State the result as absolute numbers before and after, for count and time. A percentage appears only beside the numbers (`bun scripts/lab-counts.ts report --runs <run keys>`).
6. **Refuse complexity for a tiny win.** When the gain is a few milliseconds or bytes and the code grows, drop the change and record the decision.
7. **Lower the reference.** Run `bun scripts/lab-counts.ts ratchet --run <run key>` and commit the file with the change. An unlowered win is room for the next regression.
8. **Have a person feel it.** A user-visible change counts as accepted only after the owner tried its preview on a phone and a laptop. Record device and verdict.

### Read a lab table

Each lab group prints one table per step with reference, value, ceiling, floor and status per metric.

- `regressed` or `budget-exceeded`: more work than the reference or budget allows. Find the cause; never raise the reference.
- `ratchet-pending`: less work. Lower the reference with the command the table names.
- `grew` or `shrank`: bytes above the ceiling or below the floor (a deliberate cut, or missing data). Open the response, then `bun scripts/lab-counts.ts accept --run <run key> --step <id> --target <shape> --reason "<what changed>"`. A framework upgrade can shrink every payload at once: compare `backendByPath` and rows with the last passing run, open one response, and accept each target naming that comparison.
- `measurement-missing`: a bounded value was not recorded. It fails like a regression.
- `shape-added` or `shape-removed`: a new or stopped request. Either is a behavior change that needs its reason.

### Change a lab reference

1. A lower count needs no reason: `ratchet` lowers it.
2. A higher count, a larger payload or a smaller one needs `accept` with a reason a reviewer can check.
3. A changed lab test or recorder module orphans its references. Recalibrate from five runs, or add a carry-over entry with its reason to `lib/testing/lab-count-reference-carryover.json` when the change cannot alter what is counted. A changed typical profile (`tests/audit/support/performance-profile.ts`) changes every workload: calibrate lab steps and wall-clock scenarios from runs on one build.
4. `gate` and `reject` move a metric in or out of the gate with its evidence. A count that takes two values on one step leaves that step with `ungate`; never widen its tolerance.

### Check layout stability

`audit:layout` records every layout shift on each audited page and names the region that moved. A page is usable when no skeleton is left and the main thread settled. A shift after that fails, unless an input came within 500 ms before it. A high streaming score points at a `loading.tsx` or Suspense fallback whose box differs from its content: fix the skeleton, not the measurement.

## What each instrument proves

- **Wall-clock scenarios** (`audit:performance:*`) judge medians against a budget and a reference on this machine. They run alone and never in CI.
- **Lab counts** (`audit:lab:*`) prove a step does the same work as its reference. A count does not show when a page became usable, and it counts background reads that cost the user nothing. Read it with the wall-clock time.
- **Payload budgets**: the ceiling catches growth, the floor lost data.

A metric earns its gate by two jobs: it repeats across five runs within tolerance, and moving it in a recorded experiment moved the time the user waits.

## Rules for references

- A count reference moves down without review. Only `ratchet` and `calibrate` write it. Never edit `lib/testing/lab-count-references.json` by hand: every reference replays from its history, and a hand edit fails.
- A count of ten or more keeps a tolerance of one or 2 %, whichever is larger.
- A payload is judged by decoded bytes and rows. Per-shape request counts, the encoded size of a streamed text response and prefetch shapes print only, because they follow timing.
- An improvement not lowered fails in release mode.
- A lab step fails when it released a live read that a dialog held since before the step (`<html data-live-read-held>`). Settle the page before you open the dialog: `settleLiveShell` waits until no live read is queued or running.
- A request shape is named by its route pattern or background-read kind, never by ids or query values.

## Prefetch

A prefetch loads a route's static shell, loading state and code before the click. It never carries data.

- A link inside a page keeps the framework's prefetch in view. Turning it off made navigations slower in the lab.
- A table row that navigates on click warms its destination through `rowIntentPrefetch` (`lib/ui/row-intent.ts`) on the first pointer movement inside the row and on focus. A pointer enter alone is no intent: rows that move under a resting pointer after a save would prefetch inside the save. Any `pointermove` counts, because the first move after a navigation reports zero movement.
- Sidebar links prefetch on intent only, because a prefetch in view re-reads every sidebar route after each invalidation.
- A prefetch with data is refused: the detail would show data from the moment of the hover without an unconfirmed marker.
- A calendar entry opens its overview from the window the board already holds.

## Accepted limits

- A cold start renders its route twice: the document and the join catch-up's refresh, which covers writes made before the database listener was ready.
- The clock button shows „—“ until it hydrates; a guess would flash a false state.
- The idle glow (`animate-live`) stays: its lab step records no request, commit or long task.
- There is no real-user telemetry. It needs the owner's consent for the analytics it implies.

## Taste defaults

Tier 3 defaults. Diverge after the owner tried the alternative.

- Reveal finished units: a whole row, list or card.
- A route shows its `loading.tsx` skeleton in the first frame. A delayed skeleton needs a measured load distribution that shows most loads finish before the delay.
- A skeleton has the box of its content.
- An idle animation uses only `transform` and `opacity` and stops under `prefers-reduced-motion`.
- Main-thread work over 50 ms leaves the interaction path: split it, defer it, or move it to a worker.
- A list row, board row or day cell re-renders only when something it shows changed: its memo compares every prop (`lib/ui/memo-equality.ts`).

## Never

- Lower a count by removing, delaying or throttling a read that keeps shown data current.
- Raise a reference, a ceiling, a budget or a tolerance to make a run pass.
- Gate on a metric that failed the stability or relevance job.
- Add a client cache of server data that outlives a navigation without an unconfirmed marker and a read on every load.
- Enable viewport prefetch for a sidebar link, or prefetch a route's dynamic data on intent.
- Report a speedup as a percentage alone.
- Render a client component inside a server primitive every page uses (`PageShell`, `PageBody`, the page headers). Its client reference and the route's chunk list ride in every route payload. Run page-wide client behavior once in the app shell.

## Verify your work

1. With `bun run test:server local` running, run each lab group `bun run test:plan` selects, and a wall-clock group it names with `--group audit:performance:<name>` on a quiet machine.
2. For a page, skeleton or shared control, run `bun run test:verify --group audit:layout`.
3. Commit the lowered or accepted references with the change. Record the journey decision, the numbers and the person's verdict in the slice record.
