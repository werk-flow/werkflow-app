# Verify application changes

Status: living — last reviewed 2026-10-28

Start here when you implement a slice, investigate a failed test, or prepare a release. [Decision 0007](../decisions/0007-independent-test-groups.md) owns the model, and [its amendment on browser tests](../decisions/0007-independent-test-groups.md#amendment-2026-10-01-browser-tests-are-a-sanity-check) owns the rules on this page. [Decision 0006](../decisions/0006-testing-architecture.md) keeps the local backend and the cloud providers apart.

## How to work

Write each test at its boundary while you build the behavior, and run the narrowest check after each edit.

### Choose the boundary for a rule

1. A calculation or a pure rule gets a unit test beside its module under `lib/`.
2. A permission, a grant or a history rule gets an SQL assertion in `supabase/tests/`: one rolled-back transaction with a failure message per invariant.
3. A Server Action's authorization gets a boundary fixture on `lib/testing/fixtures/action-boundary-world.ts`.
4. A shared control, pending feedback or a held write gets a contract in `tests/ui-contracts/`.
5. A connected outcome across roles or sessions gets a step in the slice's golden or audit spec.
6. Map the catalog clause in `lib/testing/selection/coverage-map.json` to the titles of the tests that prove it (for SQL, the `raise exception` message).
7. Probe a lint rule with `createProbeLinter()` from `eslint-rules/probe-linter.mjs`, never `new ESLint()`.

### Write a spec that stands alone

1. Seed each test's preconditions through the helpers in `tests/golden/support/db/`, and drive the claimed operation through the real UI.
2. Take dates from the `businessDate` fixture or `berlinDateAtOffset`, and give every record a test-specific name.
3. Keep a connected workflow inside one test, with named `test.step` stages.
4. Locate controls through the area module under `tests/golden/support/steps/`: it owns copy (from a pure product label owner where one exists), structure hooks and key presses, and the spec passes data. Act through `steps/interaction.ts` and wait for the exact changed fact.
5. Run `bun run test:unit lib/testing/spec-support` and `bun run lint <spec>`. Then run the test alone with `bun run test:audit:focused --grep "<title>"` (or `test:golden:focused`) while `bun run test:server local` serves the build.

### Run checks while you work

1. After each edit, run the narrowest check: `bun run test:unit <path>` for a module, `bun run test:ui <spec>` for a contract, `bun run test:verify --group <id>` for one SQL or browser group.
2. Before you push, run `bun run check:changed`: in under a minute it checks every file changed since the merge base with the trunk, committed or not.
3. Before you finish, run `bun run test:plan` and read why each group is selected.
4. At the end, run `bun run test:verify` for the whole plan.

### Handle a failure

1. Read the evidence before you run anything again, then follow [Failures](#failures).
2. Repair the cause. When the test seems wrong, compare it with the catalog clause and the feature spec before you touch the assertion.

### Open and babysit the pull request

1. Push the branch and open the PR with `gh pr create`; fill in `.github/pull_request_template.md`.
2. Babysit it as [reviews](coderabbit.md#babysit-a-pull-request) describes until it meets [the merge gate](coderabbit.md#the-merge-gate), with the reviews of its [level](coderabbit.md#choose-the-review-level). Each finding gets one disposition in its thread: repaired, declined with the reason, or deferred with its owner.

### Grow a shrink-only list

CI refuses a new entry or a raised ceiling in a list of `SHRINK_ONLY_LISTS` (`lib/testing/publication/shrink-only-lists.ts`). Fix the code instead. When an exception is right, ask the owner. Once approved, open a PR that names the added entries and ask the owner to add the label `approved: list growth`; CI then waives the growth. Never add the label yourself; it covers the whole PR.

## What browser tests are for

Browser groups are a rough check that the user flows in the [catalog](../product/user-flow-catalog.md) and the golden journeys still work.

A group is one executable check in `lib/testing/selection/test-groups.ts`. Every golden and audit group owns one spec file and one disposable organization.

## Quality of tests and the runner

A useful test also survives an equivalent implementation. Check a regression test against the broken case. Preserve catalog-clause coverage when you move an assertion. A runner test enforcing an author rule opens with `// Rule test:`.

## When a proof is valid

A proof is a passing result in a verification report whose fingerprint matches the current inputs. A later failure on the same inputs replaces an earlier pass. `createGroupQualification` in `lib/testing/evidence/group-qualification.ts` computes the inputs of each kind.

Product code (`app/`, `components/`, `hooks/`, `lib/` outside `lib/testing/`), migrations, generated types, and `app/globals.css` are not inputs of a browser group; selection covers them. A selected browser group needs a pass since selection: a pass that ran on the current content of the files that selected it (`passedSinceSelection`). Code files are compared by their token stream without comments, so a comment edit keeps a proof.

## How selection works

`groupSelections` in `lib/testing/selection/group-selection.ts` chooses the groups. `bun run test:plan` prints each group with its reason, and one line per reason with the first file that caused it. Change mode compares the tree with the baseline: the latest passing automatic plan, or the explicit run that passed the last group an automatic plan left unresolved (`selectionBaseline`). Without a baseline it compares with `HEAD`.

In change mode a product file selects the browser groups that declare its scope; shared UI primitives, the auth path and dependency files add the shell, layout and account groups; a product file without an owner selects `golden:gg-00`; a spec or support file selects the groups that import it; a runner file selects the two runner pilots.

`test-scope-prefixes.test.ts` requires every file under `hooks/` to have one feature owner or to be listed as shared. The static gates run in every plan; the unit, SQL, and component groups run when their inputs changed.

In a change plan, the browser groups whose own spec or test support under `tests/` changed run first. When one of them fails, the later browser groups are blocked for that attempt and run in the repair plan (`changedTestsFirstBlock` in `lib/testing/runner/group-schedule.ts`). `test:verify` refuses to start while the latest failed attempt of a browser, unit, SQL or component group it would run is unclassified (`unclassifiedFailureProblem`, `undiagnosedAttemptProblem`); a static gate's own message names its cause.

### Repair mode

When the latest result of a browser group is failed or blocked, a change plan selects those browser groups, the groups whose own test code changed, and the cheap gates. Their passing report becomes the baseline.

A failed browser group may run again as soon as any source file changed (`directGroupRetryProblem`). Clean its retained world first. [Failures](#failures) owns a repeat on the identical tree.

### Release mode

`bun run test:verify --mode release` selects every group and rejects `--group`. A browser pass is reused only when every product file is unchanged since it ran. The `audit:performance:*` groups and `audit:visual` run in release mode only; an explicit `--group` runs them in change mode and enforces their deadlines. A change plan selects an `audit:lab:*` group like any browser group whose scopes own a changed file, and fails it on its budgets, ceilings and floors, because counts repeat on a loaded machine and wall-clock medians do not. Other latency deadlines fail in release mode only; in change mode the runner records them in `measurements` and `overTarget`. Missing, malformed, or incorrect evidence fails in every mode.

After a failed release run, pass every failed group with `--group` before the next release plan. After two consecutive failed release runs, write the diagnosis into the incident log first (`lib/testing/publication/release-breaker.ts`).

## CI

`.github/workflows/ci.yml` runs on every pull request to `main` and every push to `main`. Its aggregate job `Check` is the one required status check ([decision 0009](../decisions/0009-pull-requests-and-ci.md)): it fails unless every job passed, or the browser shards were skipped because the plan selected no browser group. Every job runs its groups through `scripts/verify.ts --group`; the SQL and browser jobs start a fresh Supabase CLI stack with every committed migration applied (`.github/actions/local-stack`).

- **Selection.** `ciPlan` in `lib/testing/selection/ci-plan.ts` picks the browser groups for the diff against the PR's merge base with the change-mode rules of [How selection works](#how-selection-works), and adds the visual references when rendered UI changed. It takes every browser group on a push to `main`, in the nightly run (`.github/workflows/nightly.yml`), when the diff cannot be read, and when a tooling input changed. The static, unit, SQL and component groups run on every change.
- **Not in CI.** The wall-clock `audit:performance:*` groups and the cloud canary. They stay local release checks ([performance.md](performance.md)).
- **Shards.** Each visual group takes a shard of its own, and the plan deals the other browser groups into shards of about four. Each shard builds and serves the app, then runs its groups with one worker, because a second browser beside the stack outruns a shared runner. The acceptance captures run in full runs only; a pull request's before-and-after pair needs the base build.
- **Evidence.** A failed job uploads `.agent-logs/` as the artifact `evidence-<job>`: `gh run download <run-id> -n evidence-<job>`. Then follow [Failures](#failures); a rerun (`gh run rerun --failed`) follows the same retry rules as a local repeat.

## Commands

```bash
bun run env:local                              # route .env.local at the local stack
bun run test:plan                              # what would run, in change mode
bun run test:plan --mode release               # the complete release selection
bun run test:server local                      # build and serve the recorded production build
bun run test:verify                            # run the plan
bun run test:verify --group <ids> --fresh      # run even when a proof exists; --jobs 2 adds a second browser worker
bun run test:runs list|classify|cleanup|prune|recover-interrupted
bun run test:verify --target cloud             # the canary groups against DEV (after bun run env:dev and test:server cloud)
bun run test:golden:focused --grep "<titles>"  # a focused fresh-world run; test:audit:focused and test:canary:focused likewise
bun run test:diagnostic --grep "<title>" --reuse-run <run-key>   # replay on a retained world
bun run test:diagnostic:audit --fresh-for <run-key>   # the failed group on a fresh world, same build
WERKFLOW_UPDATE_VISUAL_REFERENCES=1 bun run test:audit:focused --grep "@AUDIT-VISUAL rendered references"   # rewrite changed visual references
bun run test:audit:focused --grep "@ACCEPT <set>"   # acceptance captures
```

| Work | Required evidence |
| --- | --- |
| Slice or application change | The automatic change plan passes. Add the visual review the slice names and the canary when provider behavior changed. |
| Wave end, beta handoff, production release | The release plan and the cloud canary pass on the release tree. |
| Documentation-only change | `bun run docs:check` and any executable contract the documentation changed. |

## How a run executes

`scripts/verify.ts` plans, takes the workspace lock, and runs static, unit, SQL, component, then browser groups. A failed static gate, an input edited during the run (which voids the attempt), an interruption, or a failed changed-spec tier blocks later groups. While the lock is held, the edit guard refuses agent edits to proof inputs (`scripts/guard-edits-during-verification.ts`, `lib/testing/runner/edit-guard.test.ts`); both agent tools run it before every file and shell call (`lib/testing/runner/guard-wiring.test.ts`).

Browser groups run against the recorded production build on the checkout's [port](environments.md#work-in-a-worktree) and a disposable organization in the local Supabase stack. Groups that measure freshness, readiness, or a scenario run alone, after a Realtime probe, also against other worktrees. Visual specs render in Playwright's pinned image. No browser group starts from 23:40 to 00:10 Berlin time, because a group fixes its business date at start; the runner waits (`MIDNIGHT_START_WINDOW` in `lib/testing/runner/group-schedule.ts`).

## Specs

The tests of a spec file share its world.

A helper goes into the domain module of its product area under `tests/golden/support/steps/` or `db/`. A helper that two areas need goes into `shared`. Do not re-export one module from another. To add a group, add `tests/golden/<slice>.spec.ts` or a row in `auditDefinitions` (a new SQL file is a row in `sqlDefinitions`). Declare its scopes, map its flows in `lib/testing/selection/coverage-map.json`, and register its run-day offsets in `tests/golden/support/date-ownership.ts`. [integrated-test-state.md](integrated-test-state.md) owns fixture dates.

### Spec checklist

Items marked Tier 2 fail `bun run test:unit` (`spec-conventions.test.ts` with `lib/testing/spec-support/spec-independence.ts`) or ESLint; the others are review duties.

- [ ] **Independent.** Each test prepares its own preconditions: setup through the admin-client helpers in `tests/golden/support/db/`, the claimed operation through its real UI. It passes alone (`--grep` on its title) and in any order. A count or "latest row" check covers only the test's own records. Tier 2 refuses a test that depends on another. A measured test prepares the typical profile through `ensureTypicalProfile`, which seeds it once per world.
- [ ] **One proof per behavior.** For a slice with a golden and an audit file, the golden file holds the journey a user walks, including the second-session and live checks. The audit file holds the edge cases, denials, and role variants the journey does not reach. Delete a duplicate; a second browser proof needs a distinct risk or role.
- [ ] **No wall clock.** Seed "yesterday" or "a completed time today" relative to that date, never from the current minute. Tier 2: no `new Date()` or `Date.now()` at module scope.
- [ ] **Bounded group.** A group runs about four minutes, world setup included. Split a growing file by catalog area into its own group with its scopes and date window.

## Deadlines and measured scenarios

The [freshness contract](realtime-and-caching.md) owns the product targets. `expectLiveWithin` measures from submission to the exact new fact in the receiving session, with the tolerance in `lib/testing/responsiveness-tolerance.ts`; `expectReadyWithin` from opening to usable controls. A slow but correct observation completes its test, and the runner judges the archived timing afterwards (`checkLatencyEvidence`).

Scenario measurements use the ids, budgets, and sample counts in `lib/testing/measured-scenarios.ts` and the reviewed references in `lib/testing/performance-baselines.json`. [Performance](performance.md) owns journeys, lab counts and payload budgets.

- **Budget and basis.** A new scenario takes the budget of its boundary's scenarios, a cross-session one the live target. The median, without the provider's delivery time, meets the reference; the budget judges the whole interval (`comparableMs` in `lib/testing/latency-evidence.ts`).
- **References.** Every required scenario has a reviewed reference at its current measurement digest. Calibration refuses failed, diagnostic, stale or undersampled runs and never replaces a reviewed reference by itself. To calibrate, pass the measured groups (a scenario without a reference passes only as `comparison: 'calibrating'`; restore `'required'` after the copy), run `bun scripts/calibrate-performance.ts --runs <up to three run keys> --reason "<review basis>"`, and review the draft under `.agent-logs/performance-calibration/` before you copy it. A support-file edit that cannot change what a scenario measures re-keys the references in `lib/testing/performance-reference-carryover.json` with its reason; any other recalibrates.

### Visual references

`audit:visual` compares one screenshot per page family with the accepted reference; a difference waits for acceptance or a repair, and the update run certifies nothing. [Keep accepted screens as visual references](standards-audit.md#keep-accepted-screens-as-visual-references) owns the acceptance and update steps.

## Failures

1. Open the failed browser group's `error-context.md`, screenshot, and trace under `.agent-logs/playwright-runs/<run-key>/`; the verification log names the run key, and `.agent-logs/test-server/` holds the server output. Any other group's log is under `.agent-logs/verification/<report-id>/`.
2. Find the cause and fix it. Add prevention at the highest reachable tier of the [enforcement ladder](../decisions/0005-enforcement-ladder.md).
3. Record the cause with `bun run test:runs classify <run-key> <class> "<cause>" "<prevention>"`. For a verification run it writes the [incident log](test-incident-log.md) entry. A group without a run key takes its group id (`classify sql:security environment ...`), or `<group-id>@<report-id>` for a failed attempt in that report, also after a later pass; the diagnosis is stored beside its report.
4. Clean the retained world with `bun run test:runs cleanup <run-key>`.
5. Run `bun run test:verify`. Repair mode selects the failed groups. Their pass closes the repair.

An `environment` class allows one retry on unchanged inputs: a browser group's after a passing diagnostic and the cleanup, any other group's at once. The diagnostic replays the failed test on the retained world (`--reuse-run`). When that test wrote to its world before it failed, its replay meets another state, so the first fresh-world run of the whole group on the same build qualifies instead (`--fresh-for`, `freshDiagnosisProblem` in `lib/testing/runner/group-recovery.ts`). A second failure on those inputs needs a change. A product or harness class allows no retry, because its repair changes the inputs.

Classify as product when the application breaks its contract, as harness when setup, selection, timing, or an assertion of a proven test misrepresents the behavior, and as environment when a provider, process, network, or host problem prevents a valid observation. Transient needs evidence of the temporary event. A later pass alone is not evidence. Classify as authoring when test code that never passed on its current content fails; the command refuses it for test inputs that passed. Classify as accepted-change when an accepted design made an `audit:visual` reference stale.

A preflight failure that creates no run is blocked verification, not a product failure. If the host kills a run, confirm that the lock owner is gone, then run `bun run test:runs recover-interrupted <run-key> "<observed interruption>"`.

## Checklist

The [spec checklist](#spec-checklist) adds the detail for a single spec. A `[judgment]` item is a Tier 3 default: [how to read the virtues](../../AGENTS.md#how-to-read-the-virtues) says how to diverge.

- Each rule sits at the cheapest boundary that can expose its failure: a unit test for a calculation, SQL for a permission, `ui:contracts` for a shared control, a browser journey for a connected outcome. [judgment]
- A new or rewritten browser case prepares its own prerequisites and runs alone in a fresh world. [test `lib/testing/spec-support/spec-conventions.test.ts`]
- Locators are scoped to their semantic owner: no raw page-root selector, no positional selection, no zero-count check on visible text. [lint `playwright-spec/no-unscoped-page-selectors`, lint `playwright-spec/no-visible-text-zero-count`, lint `specSelectors`, test `lib/testing/spec-support/playwright-spec-rules.test.mjs`, test `lib/testing/spec-support/work-artifact-locators.test.ts`]
- A spec passes data; its area module owns copy, locator functions and structure hooks (ids, attribute selectors, test ids), and a helper takes copy as a key, never a plain string. No parent hop, xpath or CSS class locates a control, and no spec reads a Server Action payload. [lint `playwright-spec/no-copy-in-spec-locator`, lint `playwright-spec/no-locator-function-in-spec`, lint `playwright-spec/no-structural-locator`, lint `playwright-spec/no-transport-internals`, lint `playwright-spec/no-scoped-has-locator`, test `lib/testing/spec-support/playwright-spec-rules.test.mjs`]
- A support module never turns a failure into a constant. A wait that may time out branches through `settledBeforeTimeout` in `tests/golden/support/steps/interaction.ts`, and a genuine best effort says why in a `// best-effort: <reason>` comment. [lint `playwright-spec/no-swallowed-failure`, test `lib/testing/spec-support/no-swallowed-failure.test.mjs`]
- A wait over the 10 s expect timeout names its slow operation in `tests/golden/support/timeouts.ts`, and a step runs once after the fact that enables it, never repeated inside `toPass`. [lint `playwright-spec/bounded-timeout`, lint `playwright-spec/no-retried-action`, test `lib/testing/spec-support/timeout-registry.test.ts`]
- A key press settles its scope first and never types into a focused field. [lint `playwright-spec/no-raw-key-press`, group `ui:contracts`]
- A step submits once, waits on the app's busy signals and verifies both the visible confirmation and the persisted row: a mutation helper that returns a value returns `Persisted<Row>`, which only a reader in `tests/golden/support/db/` builds. [code `lib/testing/spec-support/busy-signals.ts`, test `lib/testing/spec-support/busy-signals.test.ts`, lint `testBusySelectors`, lint `specSelectors`, code `tests/golden/support/db/shared.ts`, test `lib/testing/spec-support/persisted-returns.test.ts`, lint `persistedCastSelectors`, lint `persistedImportSelectors`]
- An outcome assertion reads the confirmed record: every record locator of a support module returns through `confirmed`, which skips content marked `data-unconfirmed`, except a whole-page privacy absence in an `expectNo…` helper, and an absence after a change goes through `expectGone`. Only `PENDING_STATE_LOCATORS` find unconfirmed content by purpose. [code `tests/golden/support/steps/shared.ts`, test `lib/testing/spec-support/confirmed-locators.test.ts`]
- A session whose premise is outdated state is frozen with `freezeLiveUpdates` before it opens the page, or holds that state in an open dialog, which suspends live reads. Whether a spec has such a premise is the reviewer's reading. [code `tests/golden/support/live.ts`, lint `specSelectors`, test `lib/testing/spec-support/stale-premise.test.ts`, judgment]
- Describe and checkpoint ownership follow the spec convention. [test `lib/testing/spec-support/spec-checkpoint-conventions.test.ts`]
- Expectations name semantic tokens, never palette classes. [test `lib/conventions/palette-classes-in-tests.test.ts`]
- Every catalog flow maps to evidence that names its proving test titles; a renamed, deleted or ambiguous title fails, a reference without a proving test states its reason, and a changed catalog clause reopens its mapping. Whether a mapped assertion proves its clause is the reviewer's reading. [group `static:coverage`, test `lib/testing/selection/coverage-map.test.ts`, test `lib/testing/selection/test-titles.test.ts`, judgment]
- A new spec file is a registered group with its scopes, and every scope prefix exists. A measured or freshness group runs alone. [code `scripts/verify.ts`, test `lib/testing/selection/test-groups.test.ts`, test `lib/testing/selection/test-scope-prefixes.test.ts`, test `lib/testing/selection/group-selection.test.ts`]
- Every required measured scenario has a reviewed reference at the digest of its measured tests, and a baseline never exceeds its budget. [test `lib/testing/performance-references.test.ts`, test `lib/testing/performance-reference-carryover.test.ts`, test `lib/testing/performance-baselines.test.ts`]
- An accepted screen keeps its look and visible text, and only a focused update run rewrites a reference. [group `audit:visual`, test `lib/testing/runner/visual-reference-updates.test.ts`]
- A failure is diagnosed, classified and its world cleaned before the next run. Classifying a verification run writes its incident entry, whose Tier 1 or Tier 2 prevention names an existing mechanism. [script `test:runs`, test `lib/testing/runs/incident-record.test.ts`, test `lib/testing/runs/incident-mechanisms.test.ts`, test `lib/testing/evidence/group-diagnosis.test.ts`, judgment]
- A browser group starts only after a bounded backend probe, and a failed group records a second probe as a hint, never a class. A diagnostic replay prints the source run's completed stages and refuses a second replay of a test on the same world; a fresh-world diagnosis runs once. [test `lib/testing/runner/backend-health.test.ts`, test `lib/testing/runs/replay-checkpoint.test.ts`, test `lib/testing/runner/group-recovery.test.ts`]
- After two failed release runs, the diagnosis goes into the incident log first. [test `lib/testing/publication/release-breaker.test.ts`]
- Runner changes carry focused unit tests. [group `unit:all`, judgment]
- Unit tests assert no duration and set no timeout of their own; a slow test is made cheaper. The runner's watchdog stops a run in which no test starts for twice Bun's per-test bound, which fires only while a test yields, or that passes its deadline. An assertion on a child's exit code carries the child's output. A test file sits where a runner reads it (`lib/**/*.test.*`, `tests/**/*.spec.ts`). [code `scripts/unit-test-preload.ts`, code `scripts/run-unit-tests.ts`, code `lib/testing/runner/unit-run-watchdog.ts`, test `lib/testing/runner/unit-run-watchdog.test.ts`, test `lib/conventions/unit-test-timeouts.test.ts`, test `lib/testing/selection/test-file-locations.test.ts`]
- Every pull request passes `Check` on its latest commit: the required check runs every static gate, the unit suite (with the shrink-only ratchet against the merge base), the component contracts, every SQL group and the selected browser groups. A branch need not be up to date with `main`; `Check` runs again on every push to `main`, and the `release` workflow refuses a `main` commit without a green `Check`. [code `.github/workflows/ci.yml`, code `lib/testing/selection/ci-plan.ts`, test `lib/testing/selection/ci-plan.test.ts`, test `lib/testing/publication/shrink-only-lists.test.ts`]
- Every pull request states its review level and gets that level's reviews; each finding gets a disposition in its thread, and the PR records its deletion pass. [judgment]
- A local change plan reuses a dependency advisory pass for 24 hours; CI runs the advisory check in every run. [test `lib/testing/evidence/advisory-freshness.test.ts`, code `.github/workflows/ci.yml`]

## Never

- Commit `test.only`, `test.skip`, `test.fixme`, `test.slow` or a per-test timeout. [lint `specSelectors`]
- Add a fixed sleep, or mint a golden cleanup marker outside the seed module. [lint `specSelectors`]
- Locate a control in a spec by its copy, a parent hop, a CSS class, an id or an attribute. [lint `playwright-spec/no-copy-in-spec-locator`, lint `playwright-spec/no-structural-locator`]
- Compare `count()` reads taken once; poll them together with `expect.poll`. [lint `playwright-spec/no-one-shot-count-comparison`, test `lib/testing/spec-support/playwright-spec-rules.test.mjs`]
- Weaken an assertion, or retry until green, a failed CI job included. [lint `playwright-spec/no-retried-action`, judgment]
- Derive a reference from a failed run. [test `lib/testing/performance-calibration.test.ts`]
- Raise a timeout or a budget, or rewrite a visual reference, to make a run pass. [lint `playwright-spec/bounded-timeout`, judgment]
- Treat a review score or an old report as acceptance. [judgment]
- Edit a proof input, reset or stop the local stack, or run a raw `next build` while a test operation holds the workspace lock. [code `scripts/guard-edits-during-verification.ts`, test `lib/testing/runner/edit-guard.test.ts`]
- Add a package script that builds, tests or changes the local stack outside the workspace lock. [test `lib/testing/runner/workspace-lock-coverage.test.ts`, test `lib/testing/runner/app-port.test.ts`]

## Verify your work

1. Run `bun run test:plan` and read the reason for each selected group.
2. Run `bun run test:verify`. A pass is a report whose selected groups all passed.
3. On a failure, follow [Failures](#failures).
4. Push, open the PR and babysit it until it is ready ([reviews](coderabbit.md#babysit-a-pull-request)).
5. Record the Tier 3 answers (clause proof, failure class, finding dispositions) in the pull request.

## Examples

- `lib/supabase/query-batches.test.ts`: unit tests at the cheapest boundary, each title naming the invariant.
- `lib/security/proxy-session.test.ts`: drives the real proxy through the missing, rejected and unavailable session.
