# Verify application changes

Status: living — last reviewed 2026-10-04

Start here when you implement a slice, investigate a failed test, or prepare a release. [Decision 0007](../decisions/0007-independent-test-groups.md) owns the model, and [its amendment on browser tests](../decisions/0007-independent-test-groups.md#amendment-2026-10-01-browser-tests-are-a-sanity-check) owns the rules on this page. [Decision 0006](../decisions/0006-testing-architecture.md) keeps the local backend and the cloud providers apart.

## How to work

Write each test at its boundary while you build the behavior, and run the narrowest check after each edit.

### Choose the boundary for a rule

1. A calculation or a pure rule gets a unit test beside its module under `lib/`.
2. A permission, a grant or a history rule gets an SQL assertion in `supabase/tests/`: one rolled-back transaction with a failure message per invariant.
3. A Server Action's authorization gets a boundary fixture on `lib/testing/fixtures/action-boundary-world.ts`.
4. A shared control, pending feedback or a held write gets a contract in `tests/ui-contracts/`.
5. A connected outcome across roles or sessions gets a step in the slice's golden or audit spec.
6. Map the catalog clause in `lib/testing/selection/coverage-map.json` to the boundary that proves it.

Wrong turn: a browser test for a rule a unit test can expose. It costs minutes and fails for reasons the rule does not own.

### Write a spec that stands alone

1. Seed each test's preconditions through the helpers in `tests/golden/support/db/`, and drive the claimed operation through the real UI.
2. Take dates from the `businessDate` fixture or `berlinDateAtOffset`, and give every record a test-specific name.
3. Keep a connected workflow inside one test, with named `test.step` stages.
4. Locate controls through the area module under `tests/golden/support/steps/`: it owns copy (from a pure product label owner where one exists), structure hooks and key presses, and the spec passes data. Act through `steps/interaction.ts` and wait for the exact changed fact.
5. Run `bun run test:unit lib/testing/spec-support` and `bun run lint <spec>`. Then run the test alone with `bun run test:golden:focused --grep "<title>"` or `bun run test:audit:focused --grep "<title>"`, with `bun run test:server local` serving the build.

Wrong turn: a test that reads what an earlier test created. It passes in file order and fails alone or reordered.

### Run checks while you work

1. After each edit, run the narrowest check: `bun run test:unit <path>` for a module, `bun run test:ui <spec>` for a contract, `bun run test:verify --group <id>` for one SQL or browser group.
2. Before you finish, run `bun run test:plan` and read why each group is selected. A group you did not expect points at a file you did not mean to touch.
3. At the end, run `bun run test:verify` for the whole plan.

Wrong turn: the full plan after every edit hides which edit broke what.

### Handle a failure

1. Read the evidence before you run anything again, then follow [Failures](#failures).
2. Repair the cause. When the test seems wrong, compare it with the catalog clause and the feature spec before you touch the assertion.

Wrong turn: running again to see whether it passes. The runner refuses an unchanged repeat.

### Review the change

1. Run `bun run review`. Its default scope is the uncommitted diff, and [CodeRabbit](coderabbit.md) owns the other scopes.
2. Give each finding one disposition: repaired, declined with the reason, or deferred with its owner. A kept finding names the tier where its prevention landed.
3. Record the dispositions in the slice record, or outside a slice in the commit message body.

Wrong turn: a clean review score taken as acceptance. CodeRabbit adds to the independent reviewer's judgment and does not replace it.

## What browser tests are for

Browser groups are a rough check that the user flows in the [catalog](../product/user-flow-catalog.md) and the golden journeys still work. A rule belongs at the cheapest boundary that can expose its failure: domain units for calculations, SQL for permissions and history, component contracts (`ui:contracts`) for shared controls, a browser journey for connected outcomes and cross-user freshness, the cloud canary for live providers.

A group is one executable check in `lib/testing/selection/test-groups.ts`. The kinds are static, unit, SQL, component (`ui:contracts`), golden (one business journey per file), audit (one catalog area per file), and canary (live DEV providers). Every golden and audit group owns one spec file and one disposable organization.

## Quality of tests and the runner

A useful test fails when the intended behavior breaks, survives an equivalent implementation, and names the failed invariant. Check a regression test against the broken case. Preserve catalog-clause coverage when you move an assertion. A runner test enforcing an author rule opens with `// Rule test:`, and `docs:check` requires an owner doc to name it. A credible report separates product, environment, blocked and missing evidence.

## When a proof is valid

A proof is a passing result in a verification report whose fingerprint matches the current inputs. A later failure on the same inputs replaces an earlier pass. `createGroupQualification` in `lib/testing/evidence/group-qualification.ts` computes the inputs.

| Kind | Fingerprint inputs |
| --- | --- |
| Golden, audit, canary | The spec file, the test support it imports under `tests/` and `lib/testing/`, its Playwright config and global setup, `package.json`, `bun.lock`, and the environment digest. The two runner pilots (`golden:p1-24a`, `audit:wave-3:p1-24a`) add the runner files. |
| Unit | Every tracked non-documentation file. |
| SQL, component, static | Their own files, the folders their scopes name, everything those import, and files no group owns. SQL groups own the migrations. |

Product code (`app/`, `components/`, `hooks/`, `lib/` outside `lib/testing/`), migrations, generated types, and `app/globals.css` are not inputs of a browser group. Selection covers them instead. A selected browser group needs a pass since selection: a pass that ran on the current content of the files that selected it (`passedSinceSelection`). Code files are compared by their token stream without comments, so a comment edit keeps a proof.

## How selection works

`groupSelections` in `lib/testing/selection/group-selection.ts` chooses the groups. `bun run test:plan` prints each group with its reason, and one line per reason with the first file that caused it. Change mode compares the tree with the baseline: the latest passing automatic plan, or the explicit run that passed the last group an automatic plan left unresolved (`selectionBaseline`). Without a baseline it compares with `HEAD`.

| Changed file | Browser groups selected in change mode |
| --- | --- |
| Product file under a `TEST_SCOPE_PREFIXES` folder, or a file the registry names (a feature hook, skeleton, or API route) | The groups that declare that scope |
| `components/ui/`, `app/globals.css` | `golden:gg-00`, `audit:layout` |
| `proxy.ts`, `lib/auth/`, `app/auth/`, `app/(auth)/`, `components/auth/`, `lib/data/cached.ts`, `hooks/use-sign-out.ts` | `golden:gg-00`, `audit:security:account` |
| `package.json`, `bun.lock`, changed environment | `golden:gg-00`, `audit:layout`, `audit:security:account` |
| Any other product file without an owner, including new, deleted, and generated files | `golden:gg-00` |
| Spec or test support | The groups whose spec imports it |
| Runner file (`scripts/verify.ts`, `lib/testing/selection/group-selection.ts`, and the other registered orchestration files) | The two runner pilots |

`test-scope-prefixes.test.ts` requires every file under `hooks/` to have one feature owner or to be listed as shared. The static gates run in every plan. The unit, SQL, and component groups are in every plan and run when their inputs changed. `static:dependencies` runs when a dependency input changed. Scope ownership is a risk policy, and release mode catches what it misses.

In a change plan, the browser groups whose own spec or test support under `tests/` changed run first. When one of them fails, the later browser groups are blocked for that attempt and run in the repair plan (`changedTestsFirstBlock` in `lib/testing/runner/group-schedule.ts`). `test:verify` refuses to start while the latest failed run of a group it would run is unclassified.

### Repair mode

When the latest result of a browser group is failed or blocked, a change plan selects exactly those browser groups plus the cheap gates. When those groups pass, the repair is verified and the passing report becomes the baseline.

A failed browser group may run again as soon as any source file changed (`directGroupRetryProblem`). Clean its retained world first. A repeat on the identical tree needs a classified environment failure, a passing diagnostic replay, and then the cleanup ([Failures](#failures)).

### Release mode

`bun run test:verify --mode release` selects every group and rejects `--group`. A browser pass is reused only when every product file is unchanged since it ran. The `audit:performance:*` groups and `audit:visual` run in release mode only, and an explicit `--group` runs them in change mode. A change plan never selects a measured group, but it names each `audit:performance:*` group whose scopes own a changed product file, with the command that runs it. Latency deadlines, budgets, and reference comparisons fail a group in release mode only. In change mode the runner records them in the report's `measurements` and in `overTarget`, and the group passes. Missing, malformed, or incorrect evidence fails in every mode. An explicit `--group audit:performance:<name>` run enforces its deadlines, so you can prove a performance repair.

After a failed release run, pass every failed group with `--group` before the next release plan. After two consecutive failed release runs, write the diagnosis into the incident log first (`lib/testing/publication/release-breaker.ts`).

## Publication gate

`.githooks/pre-push` is the one gate before publication. Enable it once per clone with `git config core.hooksPath .githooks`. The hook runs `scripts/check-publication-gate.ts` and refuses the push unless both conditions hold:

1. The push publishes the checked-out commit. The newest local verification report is an automatic plan that passed, its snapshot matches the current tree, and no input file is uncommitted.
2. A CodeRabbit review completed on the tree being pushed. `bun run review` writes a record under `.agent-logs/review/` with the content digest of every changed file its scope covered. A file counts as reviewed while its content equals what a completed review saw, so a review of uncommitted work still counts after the commit, and an edit needs a new review of that file only.

The digests leave out documentation (`isDocumentationInput` in `lib/testing/evidence/group-evidence.ts`), so a documentation edit keeps the report and the reviews valid. The owner can override with `WERKFLOW_PUSH_OVERRIDE="<reason>" git push ...`.

## Commands

```bash
bun run env:local                              # route .env.local at the local stack
bun run test:plan                              # what would run and why (change mode, local target)
bun run test:plan --mode release               # the complete release selection
bun run test:server local                      # build and serve the recorded production build (own terminal)
bun run test:verify                            # run the plan
bun run test:verify --group golden:p1-06,audit:wave-2:p1-16   # an explicit subset
bun run test:verify --group <ids> --fresh      # run even when a proof exists; --jobs 2 adds a second browser worker
bun run test:campaign                          # verification cost since the last commit
bun run test:runs list|classify|cleanup|prune|recover-interrupted|cleanup-local-relocated
bun run test:verify --target cloud             # the canary groups against DEV (after bun run env:dev and test:server cloud)
bun run test:golden:focused --grep "<titles>"  # a focused fresh-world run; test:audit:focused and test:canary:focused likewise
bun run test:diagnostic --grep "<title>" --reuse-run <run-key>   # replay on a retained world
WERKFLOW_UPDATE_VISUAL_REFERENCES=1 bun run test:audit:focused --grep @AUDIT-VISUAL   # rewrite changed visual references
```

| Work | Required evidence |
| --- | --- |
| Slice or application change | The automatic change plan passes. Add the visual review the slice names and the canary when provider behavior changed. |
| Wave end, beta handoff, production release | The release plan and the cloud canary pass on the release tree. |
| Documentation-only change | `bun run docs:check` and any executable contract the documentation changed. |

## How a run executes

`scripts/verify.ts` plans, takes the workspace lock, and runs static, unit, SQL, component, then browser groups. A failed static gate, an input edited during the run (which voids the attempt), an interruption, or a failed changed-spec tier blocks later groups. While the lock is held, the edit guard refuses agent edits to proof inputs (`scripts/guard-edits-during-verification.ts`, `lib/testing/runner/edit-guard.test.ts`). The run writes `.agent-logs/verification/<id>/report.json`.

Browser groups run against the recorded production build on port 3000 and a disposable organization in the local Supabase stack. `--jobs N` runs independent groups on N workers. Groups that measure freshness, readiness, or a scenario always run alone, after a Realtime probe. No browser group starts from 23:40 to 00:10 Berlin time, because a group fixes its business date at start; the runner waits (`MIDNIGHT_START_WINDOW` in `lib/testing/runner/group-schedule.ts`). Every run ends with the informational [campaign line](../plans/phase-1/protocol.md#campaign-line).

## Specs

The tests of a spec file share its world.

A helper goes into the domain module of its product area under `tests/golden/support/steps/` or `db/`. A helper that two areas need goes into `shared`. Do not re-export one module from another. To add a group, add `tests/golden/<slice>.spec.ts` or a row in `auditDefinitions` (a new SQL file is a row in `sqlDefinitions`). Declare its scopes, map its flows in `lib/testing/selection/coverage-map.json`, and register its run-day offsets in `tests/golden/support/date-ownership.ts`. [integrated-test-state.md](integrated-test-state.md) owns fixture dates.

### Spec checklist

Items marked Tier 2 fail `bun run test:unit` (`spec-conventions.test.ts` with `lib/testing/spec-support/spec-independence.ts`) or ESLint; the others are review duties.

- [ ] **Independent.** Each test prepares its own preconditions: setup through the admin-client helpers in `tests/golden/support/db/`, the claimed operation through its real UI. It passes alone (`--grep` on its title) and in any order. A connected workflow is one test with named `test.step` stages. Records carry a test-specific name, and a count or "latest row" check covers only the test's own records. Tier 2: no `requires-test`, no chained value or checkpoint between tests, no module-level `let` or mutated module constant. A measured test prepares the typical profile through `ensureTypicalProfile`, which seeds it once per world.
- [ ] **One proof per behavior.** For a slice with a golden and an audit file, the golden file holds the journey a user walks, including the second-session and live checks. The audit file holds the edge cases, denials, and role variants the journey does not reach. Delete a duplicate; a second browser proof needs a distinct risk or role.
- [ ] **Right boundary.** A rule that only reads database state is an SQL assertion in `supabase/tests/`: one transaction, rolled back, an explicit failure message per invariant. A calculation is a unit test, a shared control a component contract. The browser keeps navigation, the visible confirmation, cross-session delivery, and one persisted-row check per mutation. Point the coverage map at the boundary that proves the rule.
- [ ] **No wall clock.** Dates come from the `businessDate` fixture or `berlinDateAtOffset` inside the test. Seed "yesterday" or "a completed time today" relative to that date, never from the current minute. Tier 2: no `new Date()` or `Date.now()` at module scope.
- [ ] **Bounded group.** A group's expected duration stays at about four minutes, including about one minute of world setup. Split a growing file by catalog area into its own group with its scopes and date window.
- [ ] **Steps.** A step prepares, submits once, and verifies at both boundaries: the visible confirmation and the persisted row. Capture the baseline before an action and wait for the exact changed fact.
- [ ] **Locators.** The area module locates by accessible role and name, the spec passes data. Tier 2: the [checklist](#checklist) and [Never](#never) rules; use `expectDefined` instead of `!`.

## Deadlines and measured scenarios

The [freshness contract](realtime-and-caching.md) owns the product targets. `expectLiveWithin` measures from submission in the acting session to the exact new fact in the receiving session against the live target and its tolerance in `lib/testing/responsiveness-tolerance.ts`. `expectReadyWithin` measures from opening to usable controls. A slow but correct observation completes its test, and the runner judges the archived timing afterwards (`checkLatencyEvidence`).

Scenario measurements use the ids, budgets, and sample counts in `lib/testing/measured-scenarios.ts` and the reviewed references in `lib/testing/performance-baselines.json`. Each `audit:performance:*` group seeds the typical profile into its own organization and runs alone.

- **Budget.** A new scenario takes the budget of the registered scenarios with its boundary, and a cross-session scenario takes the live target. A budget never follows what a build happens to do.
- **Comparison basis.** The sample median is compared with the reference, without the provider's delivery time; the budget judges the whole interval (`comparableMs` in `lib/testing/latency-evidence.ts`).
- **References.** Every required scenario has a reviewed reference at its current measurement digest. Calibration refuses failed, diagnostic, stale or undersampled runs and never replaces a reviewed reference by itself. To calibrate, pass the measured groups, then run `bun scripts/calibrate-performance.ts --runs <up to three run keys> --reason "<review basis>"`. Review the draft under `.agent-logs/performance-calibration/` before you copy it into the references.

### Visual references

`audit:visual` compares one screenshot per page family with the reference image the owner accepted. A failed comparison is a design change that waits for acceptance or a regression to repair. The update run certifies nothing (`lib/testing/runner/visual-reference-updates.test.ts`). [Keep accepted screens as visual references](standards-audit.md#keep-accepted-screens-as-visual-references) owns the acceptance and update steps.

## Failures

1. Open the failed browser group's `error-context.md`, screenshot, and trace under `.agent-logs/playwright-runs/<run-key>/`; the verification log names the run key, and `.agent-logs/test-server/` holds the server output. Any other group's log is under `.agent-logs/verification/<report-id>/`.
2. Find the cause and fix it. Add prevention at the highest reachable tier of the [enforcement ladder](../decisions/0005-enforcement-ladder.md).
3. Record the cause with `bun run test:runs classify <run-key> <class> "<cause>" "<prevention>"`. For a verification run it also writes the [incident log](test-incident-log.md) entry, so the prevention names its tier. A static, unit, SQL, or component group has no run key: give its group id instead, for example `classify sql:security environment ...`, and the diagnosis of its latest failed attempt is stored beside its report. The campaign line counts failures by this classification.
4. Clean the retained world with `bun run test:runs cleanup <run-key>`.
5. Run `bun run test:verify`. Repair mode selects the failed groups. Their pass closes the repair.

An `environment` class allows one retry on unchanged inputs: a browser group's after a passing diagnostic replay and the cleanup, any other group's at once. A second failure on those inputs needs a change. A product or harness class allows no retry, because its repair changes the inputs.

Classify as product when the application breaks its contract, as harness when setup, selection, timing, or an assertion of a proven test misrepresents the behavior, and as environment when a provider, process, network, or WSL problem prevents a valid observation. Transient needs evidence of the temporary event. A later pass alone is not evidence. Classify as authoring when test code that never passed on its current content fails; the command refuses it for test inputs that passed. Classify as accepted-change when an accepted design made an `audit:visual` reference stale. The campaign line counts both apart from harness, so harness measures failures of proven tests.

A preflight failure that creates no run is blocked verification. It is not a product failure. If the host kills a run, confirm that the lock owner is gone, then run `bun run test:runs recover-interrupted <run-key> "<observed interruption>"`. After a WSL address change, use `cleanup-local-relocated`. `bun run test:runs prune` removes diagnosis material of cleaned runs older than a day that no proof cites.

Testing authorizes no commit, push, deployment, or schema change.

## Checklist

The [spec checklist](#spec-checklist) adds the detail for a single spec. A `[judgment]` item is a Tier 3 default: diverge only with the note that `AGENTS.md` describes under "How to read the virtues".

- Each rule sits at the cheapest boundary that can expose its failure: a unit test for a calculation, SQL for a permission, `ui:contracts` for a shared control, a browser journey for a connected outcome. [judgment]
- A new or rewritten browser case prepares its own prerequisites and runs alone in a fresh world. [test `lib/testing/spec-support/spec-conventions.test.ts`]
- Locators are scoped to their semantic owner: no raw page-root selector, no positional selection, no zero-count check on visible text. [lint `playwright-spec/no-unscoped-page-selectors`, lint `playwright-spec/no-visible-text-zero-count`, lint `specSelectors`, test `lib/testing/spec-support/playwright-spec-rules.test.mjs`, test `lib/testing/spec-support/work-artifact-locators.test.ts`]
- A spec passes data; its area module owns copy, locator functions and structure hooks, and a helper takes copy as a key, never a plain string. No parent hop, xpath or CSS class locates a control, and no spec reads a Server Action payload. [lint `playwright-spec/no-copy-in-spec-locator`, lint `playwright-spec/no-locator-function-in-spec`, lint `playwright-spec/no-structural-locator`, lint `playwright-spec/no-transport-internals`, lint `playwright-spec/no-scoped-has-locator`, test `lib/testing/spec-support/playwright-spec-rules.test.mjs`]
- A key press settles its scope first and never types into a focused field. [lint `playwright-spec/no-raw-key-press`, group `ui:contracts`]
- A step waits on a real app signal and verifies both the visible confirmation and the persisted row. [lint `specSelectors`, judgment]
- Describe and checkpoint ownership follow the spec convention. [test `lib/testing/spec-support/spec-checkpoint-conventions.test.ts`]
- Expectations name semantic tokens, never palette classes. [test `lib/conventions/palette-classes-in-tests.test.ts`]
- Every catalog flow maps to evidence, and a changed catalog clause reopens its mapping. Whether a mapped assertion proves its clause is the reviewer's reading. [group `static:coverage`, test `lib/testing/selection/coverage-map.test.ts`, judgment]
- A new spec file is a registered group with its scopes, and every scope prefix exists. A measured or freshness group runs alone. [test `lib/testing/selection/test-groups.test.ts`, test `lib/testing/selection/test-scope-prefixes.test.ts`, test `lib/testing/selection/group-selection.test.ts`]
- A complete roadmap slice has a browser title with its tag or its gate's tag. [code `lib/docs/slice-browser-proof.ts`, test `lib/docs/slice-browser-proof.test.ts`]
- Every required measured scenario has a reviewed reference at the digest of its measured tests, and a baseline never exceeds its budget. [test `lib/testing/performance-references.test.ts`, test `lib/testing/performance-reference-carryover.test.ts`, test `lib/testing/performance-baselines.test.ts`]
- An accepted screen keeps its look and visible text, and only a focused update run rewrites a reference. [group `audit:visual`, test `lib/testing/runner/visual-reference-updates.test.ts`]
- A failure is diagnosed, classified and its world cleaned before the next run. Classifying a verification run writes its incident entry. [script `test:runs`, test `lib/testing/runs/incident-record.test.ts`, judgment]
- A browser group starts only after a bounded backend probe, and a failed group records a second probe as a hint, never a class. A diagnostic replay prints the source run's completed stages and refuses a second replay of a test on the same world. [test `lib/testing/runner/backend-health.test.ts`, test `lib/testing/runs/replay-checkpoint.test.ts`]
- After two failed release runs, the diagnosis goes into the incident log first. [test `lib/testing/publication/release-breaker.test.ts`]
- Runner changes carry focused unit tests. [group `unit:all`, judgment]
- Unit tests assert no duration; the preload sets one hang guard. [code `scripts/unit-test-preload.ts`]
- Every change gets `bun run review` and a disposition per finding. [script `review`, judgment]
- A push passes the publication gate: a passing report, and review records whose per-file digests cover every changed file of the pushed tree. [code `.githooks/pre-push`, test `lib/testing/publication/publication-gate.test.ts`]

## Never

- Commit `test.only`, `test.skip`, `test.fixme`, `test.slow` or a per-test timeout. [lint `specSelectors`]
- Add a fixed sleep, or mint a golden cleanup marker outside the seed module. [lint `specSelectors`]
- Use a `!` assertion in a spec. [lint `@typescript-eslint/no-non-null-assertion`]
- Locate a control in a spec by its copy, a parent hop or a CSS class. [lint `playwright-spec/no-copy-in-spec-locator`, lint `playwright-spec/no-structural-locator`]
- Compare `count()` reads taken once; poll them together with `expect.poll`. [lint `playwright-spec/no-one-shot-count-comparison`, test `lib/testing/spec-support/playwright-spec-rules.test.mjs`]
- Weaken an assertion, or retry until green. [judgment]
- Derive a reference from a failed run. [test `lib/testing/performance-calibration.test.ts`]
- Raise a timeout or a budget, or rewrite a visual reference, to make a run pass. [judgment]
- Treat a review score or an old report as acceptance. [judgment]
- Call the CodeRabbit CLI directly. [test `lib/testing/publication/coderabbit-review-command.test.ts`]
- Push past the gate without the owner's logged override. [code `.githooks/pre-push`]
- Edit a proof input, reset or stop the local stack, or run a raw `next build` while a test operation holds the workspace lock. [code `scripts/guard-edits-during-verification.ts`, test `lib/testing/runner/edit-guard.test.ts`]
- Add a package script that builds, tests or changes the local stack outside the workspace lock. [test `lib/testing/runner/workspace-lock-coverage.test.ts`, test `lib/testing/runner/app-port.test.ts`]

## Verify your work

1. Run `bun run test:plan` and read the reason for each selected group.
2. Run `bun run test:verify`. A pass is a report whose selected groups all passed.
3. On a failure, follow [Failures](#failures), then run `bun run test:verify` again.
4. Run `bun run review` and record a disposition for each finding.
5. For a wave end or a release, run `bun run test:verify --mode release` and the cloud canary.
6. Record the Tier 3 answers (clause proof, failure class, finding dispositions) in the slice record.

## Examples

- `lib/supabase/query-batches.test.ts`: unit tests at the cheapest boundary, each title naming the invariant.
- `lib/security/proxy-session.test.ts`: drives the real proxy through the missing, rejected and unavailable session.
