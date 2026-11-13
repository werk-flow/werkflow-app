# Verify application changes

[Decision 0007](../decisions/0007-independent-test-groups.md) owns the test model, and [its amendment on browser tests](../decisions/0007-independent-test-groups.md#amendment-2026-10-01-browser-tests-are-a-sanity-check) owns the browser rules. [Decision 0006](../decisions/0006-testing-architecture.md) keeps the local backend and the cloud providers apart.

## How to work

Write each test at its boundary while you build the behavior.

### Choose the boundary for a rule

1. A calculation or a pure rule: a unit test beside its module under `lib/`.
2. A permission, grant or history rule: a rolled-back SQL transaction in `supabase/tests/`, a failure message per invariant, NULL-safe comparisons, only its organizations' rows (`lib/conventions/sql-test-assertions.test.ts`).
3. A Server Action's authorization: a boundary fixture on `lib/testing/fixtures/action-boundary-world.ts`.
4. A shared control, pending feedback or a held write: a contract in `tests/ui-contracts/`.
5. A connected outcome across roles or sessions: a step in the slice's golden or audit spec.
6. Map the catalog clause in `lib/testing/selection/coverage-map.json` to the titles of its proving tests (for SQL, the `raise exception` message).
7. Probe a lint rule with `createProbeLinter()` from `eslint-rules/probe-linter.mjs`, never `new ESLint()`.

A useful test survives an equivalent implementation. Check a regression test against the broken case. Keep catalog-clause coverage when moving an assertion. A runner test that enforces an author rule opens with `// Rule test:`.

### Write a spec that stands alone

1. Seed each test's preconditions through the helpers in `tests/golden/support/db/`. Drive the claimed operation through the real UI.
2. Take dates from the `businessDate` fixture or `berlinDateAtOffset`. Give every record a test-specific name.
3. Keep a connected workflow inside one test, with named `test.step` stages.
4. Locate controls through the area module under `tests/golden/support/steps/`. It owns copy, structure hooks and key presses; the spec passes data. Act through `steps/interaction.ts` and wait for the exact changed fact.
5. Run `bun run test:unit lib/testing/spec-support` and `bun run lint <spec>`. Run it alone: `bun run test:audit:focused --grep "<title>"` (or `test:golden:focused`) beside `bun run test:server local`, or on Boat under [migration drift](boat-verification.md#focused-runs-on-boat).

### Run checks while you work

1. After each edit: `bun run test:unit <path>`, `bun run test:ui <spec>`, or `bun run test:verify --group <id>` for one SQL or browser group.
2. Before you push: `bun run check:changed`. It checks every file changed since the merge base, committed or not.
3. Before you finish: `bun run test:plan`, and read why each group is selected.
4. At the end: `bun run test:verify` for the whole plan ([on Boat](boat-verification.md) with a key).

### Wait for a long run

Only a child thread and a PR watch wake a thread when they end; a shell run never does. Start any run that can outlast one tool call notified:

```bash
bun scripts/run-notified.ts --began "[verify] starting " -- bun run test:verify --mode release
```

It survives your turn and the harness, keeps the whole log, and needs a reachable thread. After your turn, one wake reports every unreported exit code.

- `--began` is log text only real work prints. The script returns on it, or with an ended command's exit code. Exit 75: not proven running; never report it as running.
- A lead may end its turn after `began work`.
- A delegated child stays in its turn and polls with the printed command: its turn end is its hand-back.
- A failed wake leaves `UNHEARD RUN`, which the next notified run resends or prints.

### Grow a shrink-only list

CI refuses a new entry or a raised ceiling in a `SHRINK_ONLY_LISTS` list (`lib/testing/publication/shrink-only-lists.ts`). Fix the code. When an exception is right, open a PR naming the added entries and ask the owner for the label `approved: list growth`. Never add the label yourself: it waives growth for the whole PR. Changing it reruns Unit (`list-growth.yml`); if that fails, push a commit.

## When a proof is valid

A proof is a passing result whose fingerprint matches the current inputs; a later failure on the same inputs replaces it. Product code, migrations, generated types and `app/globals.css` are not browser-group inputs: selection covers them, and a selected group needs a pass on the current content of the files that selected it. Code compares by token stream without comments, so a comment edit keeps a proof.

## How selection works

`bun run test:plan` prints each group with its reason and first file. Change mode compares the tree with the baseline: the latest passing automatic plan, or `HEAD`.

Each browser group has a `changeTrigger` (`lib/testing/selection/change-triggers.ts`):

- **Critical journeys** (`CRITICAL_JOURNEYS`, one or more per role) run when a product file, migration, dependency or shared test support changed.
- **Lab groups** (`audit:lab:*`) run on the same changes, except shared test support.
- **Permission groups** keep selection by declared scope: each group that drives an `outsiderPage` session or has a `ROLE_DENIAL_GROUPS` row. The auth path and dependency files add `audit:security:account`.
- **Other groups** run nightly and in release mode.
- A spec or support file selects the groups that import it.
- Wall-clock groups, captures and sweeps (`audit:performance:*`, `audit:visual*`, `audit:layout*`) run in release mode, with `--group`, in CI's full runs and, except wall-clock groups, when their test code changed. `audit:layout:<area>` also runs when its pages or dialogs render a changed file at most five areas render (`surface-closure.ts`).
- Static gates run in every plan. Unit, SQL and component groups run when their inputs changed.
- Groups whose own spec or support changed run first.
- `test:verify` refuses to start while a group it would run has an unclassified latest failure.

### Repair mode

When a browser group last failed or was blocked, a change plan selects those groups, the groups whose test code changed, and the cheap gates. Their passing report becomes the baseline. A failed group may run again after any source change. Clean its retained world first. [Failures](#failures) owns a repeat on the identical tree.

### Release mode

`bun run test:verify --mode release` selects every group and rejects `--group`. A browser pass is reused only if no product file changed since it ran.

- `audit:lab:*` groups fail on budgets, ceilings and floors in every run, because counts repeat on a loaded machine.
- Other latency deadlines fail in release mode only. Missing or malformed evidence fails in every mode.

After a failed release run, pass every failed group with `--group` before the next release plan. After two consecutive failed release runs, write the diagnosis and a harness hypothesis into `.agent-logs/verification/<report-id>/diagnosis.md` of the latest one first (`lib/testing/publication/release-breaker.ts`).

## CI

`.github/workflows/ci.yml` runs on every PR to `main`, except a label change, and every push to `main`. Its job `Check` is the one required check ([decision 0009](../decisions/0009-pull-requests-and-ci.md)).

- **Selection.** `lib/testing/selection/ci-plan.ts` picks browser groups with the change-mode rules: a PR's diff against its merge base, a push's against the previous `main` commit. Every browser group runs on an unreadable diff, in a full run, and on a change to how every group installs, builds or runs (`TOOLING_INPUTS`, `runnerModules`).
- **Drafts.** A draft PR runs no browser shard, and its `Check` fails while browser groups wait. `gh pr ready` runs them on that commit ([babysit a pull request](coderabbit.md#babysit-a-pull-request)).
- **Full run and release gate.** A full run is `ci.yml` called with `full` from a job named `Full run`, nightly and in the release. `release.yml` ships a commit only after the newest `Full run / Check` of a nightly or release run on `main` at that commit passed, or runs one first.
- **Shards.** The visual groups share shards of their own. A full selection fills at most `MAX_SHARDS` shards, so other pull requests keep most runners.
- **Queue.** The weekly `CI queue` job of `health.yml` fails when the p90 runner wait exceeds its ceiling (`.github/scripts/ci-queue.sh`).
- **Date look-ahead.** `date-lookahead.yml` runs the suite nightly on a shifted clock and gates nothing ([Monitoring](recovery-and-incidents.md#monitoring)).
- **Not in CI.** Wall-clock timing ([only the steps run](performance.md#what-each-instrument-proves)) and the cloud canary stay local release checks.
- **Evidence.** A failed job uploads `.agent-logs/` as `evidence-<job>`: `gh run download <run-id> -n evidence-<job>`. A rerun (`gh run rerun --failed`) follows the retry rules of a local repeat.

## Commands

```bash
bun run test:verify --group <ids> --fresh      # run groups even with a proof
bun run test:runs list|classify|cleanup|prune|recover-interrupted
bun run test:verify --target cloud             # canary groups against DEV (after env:dev and test:server cloud)
bun run test:golden:focused --grep "<titles>"  # focused fresh-world run; test:audit:focused likewise
bun run test:diagnostic --grep "<title>" --reuse-run <run-key>   # replay on a retained world
bun run test:diagnostic:audit --fresh-for <run-key>              # the failed group on a fresh world
WERKFLOW_UPDATE_VISUAL_REFERENCES=1 bun run test:audit:focused --grep "@AUDIT-VISUAL rendered references"
bun run test:audit:focused --grep "@ACCEPT <set>"                # acceptance captures
```

| Work | Required evidence |
| --- | --- |
| Slice or application change | The change plan passes, plus the visual review the slice names and the canary when provider behavior changed. |
| Wave end, beta handoff, production release | The release plan and the cloud canary pass on the release tree. |
| Documentation-only change | `bun run docs:check` and any executable contract the change touched. |

## How a run executes

A failed static gate, an input edited during the run, an interruption, or a failed changed-spec tier blocks later groups.

Browser groups run against the recorded production build on the checkout's [port](environments.md#work-in-a-worktree). Groups that measure freshness, readiness or a scenario run alone, also against other worktrees. No browser group starts from 23:40 to 00:10 Berlin time, because a group fixes its business date at start. The runner waits locally. In CI, `Midnight wait` holds shards from 22:55, one Browser timeout ahead. A shard still reaching it is blocked (harness, `midnight start window`); rerun it after 00:10 Berlin.

## Specs

A browser group is one spec file with one disposable organization, a rough check that the [catalog](../product/user-flow-catalog.md) flows still work. Its tests share the world.

- World and layout fixture names come from `worldName` (`lib/testing/seed-world-plan.ts`).
- A helper goes into its area module under `tests/golden/support/steps/` or `db/`, or `shared` when two areas need it. Never re-export one module from another.
- To add a group, add `tests/golden/<slice>.spec.ts` or a row in `auditDefinitions` (SQL: `sqlDefinitions`). Declare its scopes, map its flows in `coverage-map.json`, and register its run-day offsets ([integrated-test-state.md](integrated-test-state.md)).

### Spec checklist

Lint (`eslint-rules/test-hygiene-rules.mjs`, unit tests too) and `spec-conventions.test.ts` enforce the locator, wait, timeout, retry, clock, skip and independence rules. Review owns these:

- **Independent.** Each test seeds its own preconditions and passes alone and in any order. A count or "latest row" check covers only the test's own records. A measured test prepares the typical profile through `ensureTypicalProfile`.
- **One proof per behavior.** The golden file holds the journey a user walks, including second-session and live checks. The audit file holds edge cases, denials and role variants. A second browser proof needs a distinct risk or role.
- **Denials below the browser.** Prove a new role or organization denial with an SQL assertion or a boundary fixture. `test-groups.test.ts` refuses a browser denial helper in a group without a permission trigger.
- **Critical journeys.** Changing the critical set, or adding a `ROLE_DENIAL_GROUPS` row, needs the owner ([shrink-only lists](#grow-a-shrink-only-list)).
- **Bounded group.** A group runs about four minutes, setup included. Split a growing file by catalog area.
- **Persisted outcome.** A step submits once, waits on the app's busy signals, and checks both the visible confirmation and the persisted row (`Persisted<Row>`, built only by a reader in `tests/golden/support/db/`).
- **Confirmed records.** An outcome assertion reads through `confirmed`, which skips `data-unconfirmed` content. An absence after a change goes through `expectGone`.
- **Stale premise.** A session whose premise is outdated state calls `freezeLiveUpdates` before it opens the page, or holds that state in an open dialog.
- **No swallowed failure.** A wait that may time out branches through `settledBeforeTimeout`. A real best effort says why in a `// best-effort: <reason>` comment.
- **Quarantine last.** Skip only a diagnosed defect whose fix is an open planning issue. A test needing a host capability (`flock`, an address family) registers only where it exists and names what it left out: no quarantine.

## Deadlines and measured scenarios

The [freshness contract](realtime-and-caching.md) owns the product targets. [Performance](performance.md) owns journeys, lab counts and payload budgets.

- `expectLiveWithin` measures from submission to the new fact in the receiving session, `expectReadyWithin` from opening to usable controls. A slow but correct observation completes its test; the runner judges the timing afterwards.
- Scenarios live in `lib/testing/measured-scenarios.ts`, reviewed references in `lib/testing/performance-baselines.json`. A new scenario takes its boundary's budget, a cross-session one the live target.
- Every required scenario has a reference at its measurement and workload digests. Editing measured support files moves every digest.
- To calibrate: pass the measured groups (a scenario without a reference passes only as `comparison: 'calibrating'`; restore `'required'` after the copy). Run `bun scripts/calibrate-performance.ts --runs <up to three run keys> --reason "<review basis>"`. Review the draft under `.agent-logs/performance-calibration/` before you copy it.
- A support-file edit that cannot change what a scenario measures re-keys the references in `lib/testing/performance-reference-carryover.json` with its reason. Any other edit recalibrates.

[Keep accepted screens as visual references](standards-audit.md#keep-accepted-screens-as-visual-references) owns `audit:visual`.

## Failures

1. Read the open `ci-alert` issues first: a failure in a group the pinned `CI alert: main` names is that alert's, not yours.
2. Open the failed browser group's `error-context.md`, screenshot and trace under `.agent-logs/playwright-runs/<run-key>/`. The verification log names the run key; `.agent-logs/test-server/` holds server output. Other groups log to `.agent-logs/verification/<report-id>/`.
3. Find and fix the cause. If the test seems wrong, compare it with the catalog clause and feature spec first. Add prevention at the highest reachable tier of the [enforcement ladder](../decisions/0005-enforcement-ladder.md).
4. Classify: `bun run test:runs classify <run-key> <class> "<cause>" "<prevention>"`. A group without a run key takes its id, or `<group-id>@<report-id>` for one failed attempt.
5. Clean the retained world: `bun run test:runs cleanup <run-key>`.
6. Run `bun run test:verify`: [repair mode](#repair-mode) reruns the failed groups.

Classes:

- **product**: the application breaks its contract.
- **harness**: setup, selection, timing or an assertion of a proven test misrepresents the behavior.
- **environment**: a provider, process, network or host problem prevents a valid observation. Prove the temporary event; a later pass alone is no evidence.
- **authoring**: test code that never passed on its current content fails. Refused for test inputs that passed.
- **accepted-change**: an accepted design made an `audit:visual` reference stale.

Only `environment` allows one retry on unchanged inputs: a browser group's after a passing diagnostic and the cleanup, any other group's at once. The diagnostic replays the failed test on its retained world (`--reuse-run`), or on a fresh one (`--fresh-for`) when the test wrote to it or ran on Boat. A second failure on those inputs needs a change.

A preflight failure that creates no run, or a heavy group held back [without Boat](boat-verification.md#fallback), is blocked verification, not a product failure. If the host kills a run, confirm the lock owner is gone, then run `bun run test:runs recover-interrupted <run-key> "<observed interruption>"`.

## Recurring traps

Check these before classifying.

- **Another worktree's migration.** The shared stack can hold other branches' migrations. `test:verify` names the drift and [sends a cheap plan to Boat](boat-verification.md#how-a-run-picks-boat). A local failure on an object the branch lacks is `environment`.
- **Stale fakes.** When a read changes its `select` shape, update every unit-test fake of that table. Embedded relations come back as arrays.
- **The agent's tool killed the run.** A background limit or session end (SIGTERM, exit 137) is `environment`; [start it notified](#wait-for-a-long-run) next time.
- **Host network.** `net::ERR_NETWORK_CHANGED`, or a Realtime socket that reconnects every few seconds, is `environment`. Run no heavy load beside a browser or measured group.
- **Time zone and run day.** CI runs in UTC; a window in process time misses the Berlin window. A fixture on a DST switch or a run-day-dependent week fails on some days. Check the run's business date and reproduce in UTC.
- **Press before hydration.** Server HTML keeps a button disabled; `pressKey` with `into` waits for it.
- **Menus.** A Radix menu opened by mouse can select the item under the pointer on release; open menus through the area module. The row actions menu closes on scroll, and a sideways-overflowing table scrolls on click.
- **Moved reads.** A hold on a Server Action POST never matches once the read moves to `GET /api/background-read`. Move the hold with the read.
- **Mid-animation captures.** Axe and screenshots read mid fade or slide. Wait for the settled state.
- **Unstable order.** A list ordered by random UUID reorders between runs.
- **Long tokens at 375 px.** An email address or generated token is one unbreakable word.
- **Fixture race.** Read-then-insert fixtures race under two workers.
- **Slow machine.** When every measured scenario slows at once, replay `HEAD` on that machine before blaming the change.

## Never

- Commit `.only`, or a skip without `// quarantine: werk-flow/werkflow-planning#<n> <why>` above it. Never quarantine a security, SQL or action-boundary test.
- Wait on the clock (a sleep, `waitForTimeout`, a deadline loop). Wait on the fact.
- Set a per-test timeout or a non-zero retry.
- Read the wall clock in a unit test. Pin it with `setSystemTime` or an injected clock.
- Mint a golden cleanup marker outside the seed module.
- Locate a control in a spec by its copy, a parent hop, a CSS class, an id or an attribute.
- Compare `count()` reads taken once. Poll them together with `expect.poll`.
- Weaken an assertion, or retry until green, a failed CI job included.
- Derive a reference from a failed run.
- Raise a timeout or a budget, or rewrite a visual reference, to make a run pass.
- Treat a review score or an old report as acceptance.
- Edit a proof input, reset or stop the local stack, or run a raw `next build` while a test operation holds the workspace lock.
- Add a package script that builds, tests or changes the local stack outside the workspace lock.
- Set a duration assertion in a unit test. Make a slow test cheaper.

## Verify your work

`bun run test:verify` passes when every selected group passed. Record the Tier 3 answers (clause proof, failure class, finding dispositions) in the PR.
