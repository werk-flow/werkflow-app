# Performance

Status: living — last reviewed 2026-10-26

This doc owns how WerkFlow measures speed and feel: the journeys people repeat, the lab counts and payload budgets that guard them, layout stability, and the procedure for making a flow faster. [Realtime and caching](realtime-and-caching.md) owns feedback, freshness and the latency targets. [Testing](testing.md#deadlines-and-measured-scenarios) owns how wall-clock scenarios are recorded and calibrated.

The app renders on the server. Most of the cost sits in data loading: which reads a route render runs, how many route renders one save causes, and how many bytes reach the browser. The lab counts those things, because a count repeats exactly between runs and a millisecond does not. A count never decides alone whether a change is good. Freshness comes first, and a person judges what the user sees.

## How to work

### Add a journey

A journey is a step that one role repeats many times a day, measured from the user's action to the usable result.

1. Take the step from a feature spec and its catalog flows, never from imagination. Add it to `JOURNEYS` in `lib/testing/journeys.ts` with its role, start action, usable result and catalog flow ids. Fast check: `bun run test:unit lib/testing/journeys.test.ts`. Wrong turn: a journey that starts when a component mounts. The span starts at the click, the tap or the navigation.
2. Give it a lab step: a row in `LAB_STEPS` in `lib/testing/lab-steps.ts`, with the absolute budgets the step must keep, such as one route render for a save, and one test in the role's spec under `tests/audit/lab/` that calls `recordLabStep` with that id. The spec passes data; locators and setup go to `tests/audit/support/lab-journeys.ts`. Fast check: the journey test above, then `bun run test:verify --group audit:lab:<name>`.
3. Add a wall-clock scenario only when the usable result has a target kind in `tests/golden/support/browser-observation.ts` and the measured protocol knows the spec. Both files are frozen digest inputs, so a new spec file gets lab steps only. Wrong turn: a journey with only a wall-clock scenario. Noise hides a regression of a few requests, and a count does not.
4. Run the group five times on one build (`bun run test:verify --group audit:lab:<name> --fresh`), then `bun scripts/lab-counts.ts calibrate --runs <five run keys> --reason "<basis>"`. The command keeps only the metrics that stayed within their tolerance and names the others. Switch the step to `comparison: 'required'`. Fast check: `bun run test:unit lib/testing/lab-count-references.test.ts`.

### Improve a flow

1. **Measure on the user's span first.** Run the journey's lab group and read its table and `lab-diagnosis.ndjson` in the run directory, which lists the route renders and the gateway paths the server read. Fast check: the step starts at the user action. Wrong turn: timing from component mount to component done, which hides the seconds before the component existed.
2. **Name the cause by reading the data path.** Look for the same read twice in one render, a route render that the action response already carried, a read in an effect that goes through the Server Action queue, a read that blocks the first paint but is not needed to act, a whole list rendered again for one row (`componentRenders`), and work while the tab is idle. Fast check: the cause explains the count that moved. Wrong turn: removing a request because the count shows it. Ask first what it keeps current.
3. **Pair the change with the freshness contract.** Every read that keeps shown data current stays. Reorder work so that what the user needs to act arrives first and the freshness read follows. Fast check: the contracts under `tests/ui-contracts/` and the live scenarios still pass, and the saved result reaches every view without waiting for Realtime. Wrong turn: buying a lower count with staler data.
4. **Write the guard before the change.** A convention test, a contract or a lab budget fails on the slow version. Fast check: it fails on the current tree where it should. Wrong turn: a guard written after the fix, which never proved it can fail.
5. **Change the code, rebuild and measure again.** State the result as absolute numbers before and after, for the count and the time. A percentage appears only beside the numbers. Fast check: `bun scripts/lab-counts.ts report --runs <run keys>` prints both. Wrong turn: a relative claim without the times behind it.
6. **Refuse complexity for a tiny win.** When the gain is a few milliseconds or bytes and the code grows, drop the change and record the decision. Fast check: the diff is smaller than the problem. Wrong turn: a build plugin or a cache layer for a gain nobody can feel.
7. **Lower the reference.** Run `bun scripts/lab-counts.ts ratchet --run <run key>` so the improvement becomes the new reference, and commit the file with the change. Fast check: the next run shows the step `within`. Wrong turn: leaving the old reference, which turns the win into room for the next regression.
8. **Have a person feel it.** When the owner asks for the push, publish a user-visible change, such as a skeleton, a prefetch or a reveal order, to the preview (`git push origin main:partner-preview`), and let the owner try it on a phone and a laptop before it counts as accepted. Record the verdict in the slice record. Fast check: the record names the device and the verdict. Wrong turn: accepting a visible change on a lab number alone.

### Read a lab table

`bun run test:verify --group audit:lab:<name>` prints one table per step: reference, measured value, change, ceiling, floor and status for each metric and payload field, with the step's wall-clock time as information. The report keeps the same table under `labCounts`.

- `regressed` or `budget-exceeded`: the step does more work than its reference or its budget allows. Find the cause; do not raise the reference.
- `ratchet-pending`: the step does less work. Lower the reference with the command the table names.
- `grew`: a response carries more bytes than its ceiling. `shrank`: fewer than its floor, which is either a deliberate cut or missing data. Open the response, then accept with `bun scripts/lab-counts.ts accept --run <run key> --step <id> --target <shape> --reason "<what changed>"`. A framework upgrade can shrink every payload at once: compare the step's `backendByPath` and rows with the last passing run before it, open one response, and accept each target naming that comparison. `measurement-missing`: a bounded value was not recorded (a body that could not be read or parsed is named in `lab-diagnosis.ndjson`); it fails like a regression.
- `shape-added` or `shape-removed`: a request the reference does not know, or one that stopped. Either is a behavior change that needs its reason.
- `ungated`: a metric that is recorded but failed one of its two jobs.

### Change a lab reference

1. A lower count needs no reason: `ratchet` lowers it.
2. A higher count, a larger payload or a smaller one needs `accept` with a reason the reviewer can check. The command writes the reason and the run key into the reference's history.
3. A changed lab test or recorder module orphans its references. Record new ones from five runs with `calibrate`, or add a carry-over entry with its reason to `lib/testing/lab-count-reference-carryover.json` when the change cannot alter what is counted. `ratchet` and `accept` match a carried reference and write it under the new digest, which retires its entry. A changed typical profile (`tests/audit/support/performance-profile.ts`) changes the workload of every lab step and wall-clock scenario, which no carry-over re-keys: calibrate both from runs on one build.
4. A metric enters or leaves the gate with `gate` or `reject`, which record the stability and relevance evidence.
5. A count that later runs show taking two values on one step leaves that step's reference with `ungate`, which records the values and the runs. Never widen its tolerance instead.

### Check layout stability

`audit:layout` records every layout shift on each audited page and names the region that moved: the page header, a usable list, a card by its title, the page body, the sidebar or the app header. The page counts as usable when no skeleton is left and the main thread settled. A shift after that point fails, unless an input came within 500 ms before it. While content streams in, the audit attaches the shift score per region. A high score points at a `loading.tsx` or Suspense fallback whose box differs from the content it stands for: fix the skeleton, not the measurement. The audited world is quiet, without a second session, so a legitimate live update never counts.

## What each instrument proves

- **Wall-clock scenarios** (`audit:performance:*`) prove that a journey stays within its budget and near its reviewed reference on this machine. They are noisy, so they judge medians with a tolerance and run alone. CI never runs them: on a shared runner the median follows the neighbors' load, so they stay local release checks on a quiet machine (`ciPlan` in `lib/testing/selection/ci-plan.ts`). CI does run the lab groups, because counts repeat on any machine.
- **Lab counts** (`audit:lab:*`) prove that a step does the same amount of work as its reference: requests, route renders, round trips, backend requests, commits, rendered components, DOM mutations and layouts. A count does not show when a page became usable, and it counts background reads that cost the user nothing. Read it with the step's wall-clock time.
- **Payload budgets** prove that each request shape of a step carries about the reference's bytes on the wire and decoded, and its row count where the response is a list. The ceiling catches growth. The floor catches a payload that lost data.
- **Layout stability** proves that nothing moves after a page is usable. It does not judge whether a skeleton looks right.
- **Convention tests** prove the structural rules on every file, including flows no journey covers.

A metric earns its gate by two jobs: it repeats across five runs within its tolerance, and driving it up or down in a recorded experiment moved the time the user waits. `gatedMetrics` and `rejectedMetrics` in `lib/testing/lab-count-references.json` hold that evidence. A rejected metric is still recorded and printed.

## Rules for references

- A count reference moves down without review. Only `ratchet` and `calibrate` write it.
- Every reference replays from its history: the opening entry records every bound it set, and each later entry the whole bound it wrote. A stored value that the replay does not reach fails, so a hand edit fails.
- A count above its reference plus its tolerance fails. A count above the step's absolute budget fails even without a reference.
- A count of ten or more keeps a tolerance of one or 2 %, whichever is larger: an echo that lands one read later on a slower machine is not a regression.
- A payload is judged by its decoded bytes and its rows. The request count of one shape, the encoded size of a streamed text response and every prefetch shape print only, because they follow timing, not work.
- A payload above its ceiling or below its floor fails. Both directions need `accept` with a reason.
- A reference never exceeds its budget, and a ratchet entry never raises a value.
- Ceilings, budgets and floors fail a lab group in every run, and a change plan selects each lab group whose scopes own a changed product file, so a count regression cannot reach a push. An improvement that was not lowered fails in release mode.
- Missing, duplicated or malformed records fail in every mode.

## Prefetch

A prefetch loads a route's static shell, its loading state and its code before the click. It never carries data: the destination reads its data when the user opens it.

- A link inside a page keeps the framework's prefetch when it comes into view. Turning that off made navigations slower in the lab, and the extra prefetches after a save cost bytes, not waiting time.
- A table row that navigates on click has no link to prefetch, so it warms its destination through `rowIntentPrefetch` (`lib/ui/row-intent.ts`): on the first pointer movement inside the row and on focus. People point at a row before they click it, and the open then starts from a ready shell. A pointer enter alone is no intent: rows that move under a resting pointer after a save would prefetch inside the save and slow it.
- Sidebar links prefetch on intent only, because a prefetch in view would re-read every sidebar route after each invalidation.
- A prefetch with data is refused: it made a job open faster, but the detail would show data from the moment of the hover, as old as the framework's prefetch cache allows, without an unconfirmed marker.
- A calendar entry opens its overview from the window the board already holds, so there is nothing to prefetch.

## Accepted limits

- A cold start renders its route twice: the document and the route refresh of the join catch-up, which covers writes made before the database listener was ready.
- The clock button shows „—“ until it hydrates, because the server cannot know the browser's clock state; a guess would flash a false state.
- A change plan selects each lab group whose scopes own a changed file and fails it on budgets, ceilings and floors; an improvement that was not lowered fails in release mode only.
- The idle glow (`animate-live`) stays: the idle lab step records no request, commit or long task while it runs.
- There is no real-user telemetry. Field timings come back on the table when the beta runs daily, and they need the owner's consent for the analytics they imply.

## Taste defaults

These are Tier 3 defaults. Diverge with the note that `AGENTS.md` describes, after the owner tried the alternative.

- Reveal finished units: a whole row, a whole list or a whole card. Never fade text word by word or fill a table cell by cell.
- A route shows its `loading.tsx` skeleton in the first frame. A delayed skeleton needs a measured load distribution that shows most loads finish before the delay, or it flashes for two frames.
- A skeleton has the box of the content it stands for, so the content does not push the page when it arrives.
- An animation that runs while the user is idle uses only `transform` and `opacity` and stops under `prefers-reduced-motion`.
- Work longer than 50 ms on the main thread leaves the interaction path: split it, defer it after the usable result, or move it to a worker.

## Checklist

A `[judgment]` item is a Tier 3 default: [how to read the virtues](../../AGENTS.md#how-to-read-the-virtues) says how to diverge.

- Every journey names its role, start action, usable result and catalog flows, and has a lab step that a lab spec records. [test `lib/testing/journeys.test.ts`]
- A lab step records its counts and payloads from the user action until the page is quiet, after the live shell joined, and writes one record per run. A step fails when it released a live read that a dialog held since before the step (`<html data-live-read-held>`), because it would count that catch-up as its own work: settle the page before you open the dialog; `settleLiveShell` waits until no live read is queued or running (`<html data-live-read-pending>`). `requests` leaves out router prefetches, whose number follows timing; `prefetches` prints beside it. [code `tests/audit/support/lab-recorder.ts`, code `lib/ui/route-refresh-signal.ts`, group `audit:lab:field`, group `audit:lab:office`]
- Every required lab step has a reference at the digest of its measured test, within its budgets, with a reason for every raise and every accepted floor, and its history replays to its stored bounds. The recorder never reads the reference file, so lowering a reference keeps the lab groups' passes. [code `lib/testing/lab-count-context.ts`, test `lib/testing/lab-count-references.test.ts`, test `lib/testing/lab-count-reference-carryover.test.ts`]
- The runner judges lab evidence: missing or malformed records, a bound without its measurement, ceilings, budgets and floors fail in every mode, and an improvement that was not lowered in release mode. A change plan runs each lab group whose scopes own a changed product file. [test `lib/testing/lab-evidence.test.ts`, test `lib/testing/lab-counts.test.ts`, code `scripts/verify.ts`, test `lib/testing/selection/group-selection.test.ts`]
- References change only through the lab command, which refuses failed, uncleaned, diagnostic and stale runs. [code `scripts/lab-counts.ts`, test `lib/testing/lab-counts.test.ts`]
- A request shape is named by its route pattern or its background-read kind, never by ids or query values. [test `lib/testing/lab-shapes.test.ts`]
- Nothing on an audited page moves after it is usable. [code `tests/audit/support/layout-shifts.ts`, group `audit:layout`]
- A table row that navigates on click warms its destination on intent through `rowIntentPrefetch`. [code `lib/ui/row-intent.ts`, test `lib/ui/row-contracts.test.ts`]
- A list row or a board row and day cell renders again only when something it shows changed: its memo compares every prop, by identity unless a content check names it, and a test per check proves that each shown field re-renders. [code `lib/ui/memo-equality.ts`, test `lib/ui/memo-equality.test.ts`, test `lib/calendar/board-row-memo.test.ts`]
- A flow that people repeat many times a day is a journey, and the slice record names the decision. [judgment]
- A performance change states its result in absolute numbers before and after, keeps every freshness read, and was felt by a person on the preview when the user can see it. [judgment]

## Never

- Lower a count by removing, delaying or throttling a read that keeps shown data current. [group `ui:contracts`, group `audit:performance:calendar-live`, judgment]
- Raise a reference, a ceiling, a budget or a tolerance to make a run pass. [test `lib/testing/lab-count-references.test.ts`, judgment]
- Edit `lib/testing/lab-count-references.json` by hand. [code `scripts/lab-counts.ts`, test `lib/testing/lab-count-references.test.ts`]
- Gate on a metric that failed the stability or the relevance job. [test `lib/testing/lab-count-references.test.ts`]
- Add a client cache of server data that outlives a navigation without an unconfirmed marker and a read on every load. [judgment]
- Enable viewport prefetch for a sidebar link, or prefetch a route's dynamic data on intent. [test `lib/ui/sidebar-prefetch.test.ts`, judgment]
- Report a speedup as a percentage alone. [judgment]
- Render a client component inside a server primitive that every page uses (`PageShell`, `PageBody`, the page headers): its client reference, with the route's chunk list, rides in every route payload. Run page-wide client behaviour once in the app shell. [test `lib/conventions/server-primitive-client-refs.test.ts`]

## Verify your work

1. Run `bun run test:unit lib/testing lib/conventions`.
2. Serve the build with `bun run test:server local`. While you iterate, run each lab group whose scopes own a changed file with `bun run test:verify --group audit:lab:<name>`; the change plan runs it again on the final tree. For a wall-clock group that `bun run test:plan` names, pass `--group audit:performance:<name>` on a quiet machine: the publication gate requires it.
3. For a change to a page, a skeleton or a shared control, run `bun run test:verify --group audit:layout`.
4. Lower or accept the references and commit `lib/testing/lab-count-references.json` with the change.
5. Record the journey decision, the absolute numbers and the person's verdict in the slice record.

## Examples

- `lib/testing/journeys.ts`: one typed inventory that links each role's daily steps to the instruments that cover them.
- `tests/audit/lab/field.spec.ts`: a field worker's steps on the typical profile, each from the tap to the usable result.
- `components/organization/organization-realtime-bridge.tsx`: a live view that takes the server's props as its first data instead of reading them again on mount.
