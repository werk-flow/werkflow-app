# Verify application changes

[Decision 0007](../decisions/0007-independent-test-groups.md) owns the test model, and [its amendment on browser tests](../decisions/0007-independent-test-groups.md#amendment-2026-10-01-browser-tests-are-a-sanity-check) owns the browser rules. [Decision 0006](../decisions/0006-testing-architecture.md) keeps the local backend and the cloud providers apart.

## How to work

Write each test at its boundary while you build the behavior. Run the narrowest check after each edit.

### Choose the boundary for a rule

1. A calculation or a pure rule: a unit test beside its module under `lib/`.
2. A permission, a grant or a history rule: an SQL assertion in `supabase/tests/`, one rolled-back transaction with a failure message per invariant.
3. A Server Action's authorization: a boundary fixture on `lib/testing/fixtures/action-boundary-world.ts`.
4. A shared control, pending feedback or a held write: a contract in `tests/ui-contracts/`.
5. A connected outcome across roles or sessions: a step in the slice's golden or audit spec.
6. Map the catalog clause in `lib/testing/selection/coverage-map.json` to the titles of the tests that prove it (for SQL, the `raise exception` message).
7. Probe a lint rule with `createProbeLinter()` from `eslint-rules/probe-linter.mjs`, never `new ESLint()`.

A useful test survives an equivalent implementation. Check a regression test against the broken case. Keep catalog-clause coverage when you move an assertion. A runner test that enforces an author rule opens with `// Rule test:`.

### Write a spec that stands alone

1. Seed each test's preconditions through the helpers in `tests/golden/support/db/`. Drive the claimed operation through the real UI.
2. Take dates from the `businessDate` fixture or `berlinDateAtOffset`. Give every record a test-specific name.
3. Keep a connected workflow inside one test, with named `test.step` stages.
4. Locate controls through the area module under `tests/golden/support/steps/`. It owns copy, structure hooks and key presses; the spec passes data. Act through `steps/interaction.ts` and wait for the exact changed fact.
5. Run `bun run test:unit lib/testing/spec-support` and `bun run lint <spec>`. Then run the test alone with `bun run test:audit:focused --grep "<title>"` (or `test:golden:focused`) while `bun run test:server local` serves the build.

### Run checks while you work

1. After each edit: `bun run test:unit <path>`, `bun run test:ui <spec>`, or `bun run test:verify --group <id>` for one SQL or browser group.
2. Before you push: `bun run check:changed`. It checks every file changed since the merge base, committed or not.
3. Before you finish: `bun run test:plan`, and read why each group is selected.
4. At the end: `bun run test:verify` for the whole plan.

### Handle a failure

Read the evidence before you run anything again, and follow [Failures](#failures). When the test seems wrong, compare it with the catalog clause and the feature spec before you touch the assertion.

### Open and babysit the pull request

Open the PR with `gh pr create` and the template, then babysit it as [reviews](coderabbit.md#babysit-a-pull-request) describes until it meets [the merge gate](coderabbit.md#the-merge-gate).

### Grow a shrink-only list

CI refuses a new entry or a raised ceiling in a list of `SHRINK_ONLY_LISTS` (`lib/testing/publication/shrink-only-lists.ts`). Fix the code instead. When an exception is right, ask the owner. Once approved, open a PR that names the added entries and ask the owner to add the label `approved: list growth`. Never add the label yourself: it waives growth for the whole PR. A change of the label reruns the head commit's Unit job and `Check` once its CI run finished (`list-growth.yml`).

A shrink counts too. When a function on `eslint-rules/size-cap-exceptions.json` gets shorter, lower its ceiling in the same change, or `module-caps.test.ts` fails.

## When a proof is valid

A proof is a passing result whose fingerprint matches the current inputs; a later failure on the same inputs replaces it. Product code, migrations, generated types and `app/globals.css` are not browser-group inputs: selection covers them, and a selected group needs a pass on the current content of the files that selected it. Code compares by token stream without comments, so a comment edit keeps a proof.

## How selection works

`bun run test:plan` prints each group with its reason and the first file that caused it. Change mode compares the tree with the baseline: the latest passing automatic plan, or `HEAD` without one.

Each browser group has a `changeTrigger` (`lib/testing/selection/change-triggers.ts`):

- **Critical journeys** (`CRITICAL_JOURNEYS`, one or more per role) run when a product file, migration, dependency or shared test support changed.
- **Permission groups** keep selection by declared scope: every group that drives an `outsiderPage` session or has a `ROLE_DENIAL_GROUPS` row. The auth path and dependency files add `audit:security:account`.
- **Other groups** run nightly and in release mode.
- A spec or support file selects the groups that import it. A documentation-only change selects no browser group.
- The speed measurements, captures and sweeps (`audit:lab:*`, `audit:performance:*`, `audit:visual*`, `audit:layout*`) run only in release mode, CI's full runs, with `--group`, or when their own test code changed (never a wall-clock group).
- Static gates run in every plan. Unit, SQL and component groups run when their inputs changed.
- Browser groups whose own spec or support changed run first. When one fails, later browser groups are blocked for that attempt.
- `test:verify` refuses to start while the latest failed attempt of a group it would run is unclassified.

### Repair mode

When a browser group's latest result is failed or blocked, a change plan selects those groups, the groups whose test code changed, and the cheap gates. Their passing report becomes the baseline. A failed browser group may run again as soon as any source file changed. Clean its retained world first. [Failures](#failures) owns a repeat on the identical tree.

### Release mode

`bun run test:verify --mode release` selects every group and rejects `--group`. A browser pass is reused only when every product file is unchanged since it ran.

- `audit:lab:*` groups fail on budgets, ceilings and floors in every run, because counts repeat on a loaded machine.
- Other latency deadlines fail in release mode only. Missing or malformed evidence fails in every mode.

After a failed release run, pass every failed group with `--group` before the next release plan. After two consecutive failed release runs, write the diagnosis and a harness hypothesis into `.agent-logs/verification/<report-id>/diagnosis.md` of the latest one first (`lib/testing/publication/release-breaker.ts`).

## CI

`.github/workflows/ci.yml` runs on every PR to `main` and every push to `main`. Its aggregate job `Check` is the one required check ([decision 0009](../decisions/0009-pull-requests-and-ci.md)). The SQL and browser jobs start a fresh Supabase CLI stack with every committed migration.

- **Selection.** `lib/testing/selection/ci-plan.ts` picks browser groups with the change-mode rules: a PR's diff against its merge base, a push's diff against the previous `main` commit. Every browser group runs when the diff is unreadable, when a tooling input changed, and in a full run.
- **Tooling input.** A file that changes how every group installs, builds or runs makes a full run: `TOOLING_INPUTS` and `runnerModules` in `ci-plan.ts`.
- **Full run.** `ci.yml` called with `full` from a job named `Full run` (check `Full run / Check`): nightly on `main` (`nightly.yml`, also started by hand), and the release gate.
- **Release gate.** `release.yml` ships a commit only when the newest `Full run / Check` of a nightly or release run on `main` at that commit is green. Without one it runs the full suite first.
- **One build.** `Build` builds the app once per run without a stack. Each browser shard serves it with `bun run test:server local --prebuilt`, which fails when the shard's source or `.env.local` differs from the build.
- **Not in CI.** The wall-clock `audit:performance:*` groups and the cloud canary stay local release checks.
- **Labels.** No label event starts a CI run. Unit reads `approved: list growth` when it runs. A cancelled run reports a failed `Check`, never a skipped one: GitHub counts a skipped required check as passed.
- **Branch freshness.** A branch need not be up to date with `main`: a push to `main` runs `Check` on its diff, and the full runs cover every group.
- **Evidence.** A failed job uploads `.agent-logs/` as `evidence-<job>`: `gh run download <run-id> -n evidence-<job>`. Then follow [Failures](#failures). A rerun (`gh run rerun --failed`) follows the same retry rules as a local repeat.

## Commands

```bash
bun run test:verify --group <ids> --fresh      # run groups even with a proof
bun run test:runs list|classify|cleanup|prune|recover-interrupted
bun run test:verify --target cloud             # canary groups against DEV (after env:dev and test:server cloud)
bun run test:golden:focused --grep "<titles>"  # focused fresh-world run; test:audit:focused likewise
bun run test:diagnostic --grep "<title>" --reuse-run <run-key>   # replay on a retained world
bun run test:diagnostic:audit --fresh-for <run-key>              # the failed group on a fresh world, same build
WERKFLOW_UPDATE_VISUAL_REFERENCES=1 bun run test:audit:focused --grep "@AUDIT-VISUAL rendered references"
bun run test:audit:focused --grep "@ACCEPT <set>"                # acceptance captures
```

| Work | Required evidence |
| --- | --- |
| Slice or application change | The change plan passes, plus the visual review the slice names and the canary when provider behavior changed. |
| Wave end, beta handoff, production release | The release plan and the cloud canary pass on the release tree. |
| Documentation-only change | `bun run docs:check` and any executable contract the change touched. |

## How a run executes

`scripts/verify.ts` plans, takes the workspace lock, and runs static, unit, SQL, component, then browser groups. A failed static gate, an input edited during the run, an interruption, or a failed changed-spec tier blocks later groups. While the lock is held, the edit guard refuses agent edits to proof inputs.

Browser groups run against the recorded production build on the checkout's [port](environments.md#work-in-a-worktree), each with a disposable organization in the local Supabase stack. Groups that measure freshness, readiness or a scenario run alone, also against other worktrees. No browser group starts from 23:40 to 00:10 Berlin time, because a group fixes its business date at start; the runner waits.

## Specs

A browser group is one spec file with one disposable organization, a rough check that the [catalog](../product/user-flow-catalog.md) flows still work. Its tests share the world.

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
- **Quarantine last.** Skip only a diagnosed defect whose fix is an open planning issue. The nightly summary lists every quarantine.

## Deadlines and measured scenarios

The [freshness contract](realtime-and-caching.md) owns the product targets. [Performance](performance.md) owns journeys, lab counts and payload budgets.

- `expectLiveWithin` measures from submission to the new fact in the receiving session, `expectReadyWithin` from opening to usable controls. A slow but correct observation completes its test; the runner judges the timing afterwards.
- Scenarios live in `lib/testing/measured-scenarios.ts`, reviewed references in `lib/testing/performance-baselines.json`. A new scenario takes its boundary's budget, a cross-session one the live target.
- Every required scenario has a reviewed reference at its measurement digest. Editing a measured support file moves every digest.
- To calibrate: pass the measured groups (a scenario without a reference passes only as `comparison: 'calibrating'`; restore `'required'` after the copy). Run `bun scripts/calibrate-performance.ts --runs <up to three run keys> --reason "<review basis>"`. Review the draft under `.agent-logs/performance-calibration/` before you copy it.
- A support-file edit that cannot change what a scenario measures re-keys the references in `lib/testing/performance-reference-carryover.json` with its reason. Any other edit recalibrates.

[Keep accepted screens as visual references](standards-audit.md#keep-accepted-screens-as-visual-references) owns `audit:visual`.

## Failures

1. Open the failed browser group's `error-context.md`, screenshot and trace under `.agent-logs/playwright-runs/<run-key>/`. The verification log names the run key; `.agent-logs/test-server/` holds the server output. Any other group's log is under `.agent-logs/verification/<report-id>/`.
2. Find the cause and fix it. Add prevention at the highest reachable tier of the [enforcement ladder](../decisions/0005-enforcement-ladder.md).
3. Classify: `bun run test:runs classify <run-key> <class> "<cause>" "<prevention>"`. A group without a run key takes its group id, or `<group-id>@<report-id>` for a failed attempt in that report. The command keeps the diagnosis beside its report: in the run manifest, or in the report's `diagnoses.json`. For a failed acceptance run it refuses a prevention without its tier, and a Tier 1 or 2 prevention that names no existing mechanism.
4. Clean the retained world: `bun run test:runs cleanup <run-key>`.
5. Run `bun run test:verify`. Repair mode selects the failed groups; their pass closes the repair.

Classes:

- **product**: the application breaks its contract.
- **harness**: setup, selection, timing or an assertion of a proven test misrepresents the behavior.
- **environment**: a provider, process, network or host problem prevents a valid observation. Prove the temporary event; a later pass alone is no evidence.
- **authoring**: test code that never passed on its current content fails. Refused for test inputs that passed.
- **accepted-change**: an accepted design made an `audit:visual` reference stale.

Only `environment` allows one retry on unchanged inputs: a browser group's after a passing diagnostic and the cleanup, any other group's at once. The diagnostic replays the failed test on the retained world (`--reuse-run`). When that test wrote to its world before it failed, run the whole group on a fresh world on the same build instead (`--fresh-for`). A second failure on those inputs needs a change. Product and harness repairs change the inputs anyway.

A preflight failure that creates no run is blocked verification, not a product failure. If the host kills a run, confirm the lock owner is gone, then run `bun run test:runs recover-interrupted <run-key> "<observed interruption>"`.

## Recurring traps

Causes that failed runs more than once. Check them before you classify.

- **Another worktree's migration.** The shared stack can hold a migration this branch lacks. An SQL failure on an object the branch does not define is `environment`; compare `supabase migration list --local` with `supabase/migrations/`.
- **Stale fakes.** When a read changes its `select` shape, update every unit-test fake of that table. Embedded relations come back as arrays.
- **The agent's tool killed the run.** A background limit or session end (SIGTERM, exit 137) is `environment`. Use `recover-interrupted`, and give long plans a timeout that outlasts them.
- **Host network.** `net::ERR_NETWORK_CHANGED`, or a Realtime socket that reconnects every few seconds, is a host network problem: `environment`. Run no heavy load beside a browser or measured group.
- **Time zone and run day.** CI runs in UTC; a window computed in process time misses the Berlin window. A fixture on a DST switch or a run-day-dependent week fails on some days only. Check the run's business date and reproduce in UTC.
- **Press before hydration.** A server-rendered button ignores a press before hydration. Wait for the hydrated control.
- **Menus.** A Radix menu opened by mouse can select the item under the pointer on release; open menus through the area module. The row actions menu closes on scroll, and a sideways-overflowing table scrolls on click.
- **Moved reads.** A hold on a Server Action POST never matches once the read moves to `GET /api/background-read`. Move the hold with the read.
- **Mid-animation captures.** Axe and screenshots read mid fade or slide. Wait for the settled state.
- **Unstable order.** A list ordered by a random UUID reorders between runs.
- **Long tokens at 375 px.** An email address or a generated token is one unbreakable word.
- **Fixture race.** Read-then-insert fixtures race under two workers.
- **Slow machine.** When every measured scenario slows at once, untouched pages included, replay `HEAD` on the same machine before you blame the change.

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
