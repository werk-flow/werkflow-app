# Verify application changes

Status: living — last reviewed 2026-09-25

Start here when implementing a slice, investigating a failed test, or preparing a release. [Decision 0007](../decisions/0007-independent-test-groups.md) defines the model: independent test groups, each with its own inputs and its own proof, selected by what changed and executed by one command. [Decision 0006](../decisions/0006-testing-architecture.md) keeps the local backend and the cloud providers apart. The harness overhaul of 2026-09-25 rebuilt the execution model after the P1-24a campaign; [decision 0007](../decisions/0007-independent-test-groups.md#amendment-2026-09-25-the-execution-model) records why.

## The model on one page

- A **group** is one executable check with a registered set of files and an input set: `lib/testing/test-groups.ts` owns the registry. Kinds: static, unit, SQL, component browser (`ui:contracts`), golden (one business journey per file), audit (one catalog area per file), canary (live DEV providers).
- A group's **inputs** are the files that can change its outcome: its own files, the application folders its scopes name, everything they import (a static import graph over the repository), and the shared files no group owns. `bun run test:plan` prints every group with its input count and whether a proof exists.
- A **proof** is a passing result recorded in a verification report whose input fingerprint matches the current inputs. Content is identified by its token stream without comments, so a comment edit keeps a proof; any token change discards it. A later failure on the same inputs replaces an earlier pass.
- `bun run test:verify` runs every selected group without a proof, once, in one workspace-locked run, and writes `.agent-logs/verification/<id>/report.json`. Groups with a proof are reused and attributed. The run passes when every selected group passed.
- Browser groups run against a recorded production build on port 3000 (`bun run test:server local`) and a disposable organization per run in the local Supabase stack. A failed group keeps its world for diagnosis; a passed group deletes it.
- Every failure is classified from evidence and lands as a mechanism, not as prose (the [enforcement ladder](../decisions/0005-enforcement-ladder.md)). The [campaign budget](#the-campaign-budget) bounds how much verification a slice may cost before the harness itself has to change.

## Commands

```bash
bun run env:local                              # route .env.local at the local stack; the environment is an input of every local proof
bun run test:plan                              # what would run and why (change mode, local target); names the changed inputs when there are few
bun run test:plan --mode release               # the complete release selection
bun run test:server local                      # build and serve the recorded production build (durable terminal)
bun run test:verify                            # run the plan
bun run test:verify --group golden:p1-06,audit:wave-2:p1-16   # an explicit subset (proves only that subset)
bun run test:verify --group <ids> --fresh      # run even when a proof exists (measurement, calibration)
bun run test:verify --jobs 2                   # two workers for independent browser groups (see "Workers")
bun run test:campaign                          # the verification cost since the last commit
bun run test:runs list|classify|cleanup|prune|recover-interrupted|cleanup-local-relocated
bun run test:verify --target cloud             # the canary groups against DEV (after bun run env:dev and test:server cloud)
bun run test:golden:focused --grep "<titles>"  # a focused fresh-world run (diagnosis, iteration); test:audit:focused and test:canary:focused likewise
bun run test:diagnostic --grep "<title>" --reuse-run <run-key>   # replay on a retained world
```

The default mode is `change` and the default target is `local`. Change selection compares the current inputs with the last passing complete report for the target; before such a baseline exists it compares against `HEAD`, including untracked and deleted files. Unresolved group failures stay selected even when nothing changed. `.env.local` is an input: after `bun run env:dev` every local proof is void until `bun run env:local` restores the routing, and the preflight refuses a local-target run that routes at the cloud. Release mode selects every audit group, the integrated golden journey, the unit, component, SQL and static groups; it rejects `--group`. The cloud target selects the canary groups against DEV (`bun run test:server cloud`, then `bun run test:verify --target cloud`); the canary always runs afresh because unchanged source proves nothing about a live provider.

| Work | Required evidence |
| --- | --- |
| Slice or application change | The complete selected local change plan, catalog coverage, the visual review the slice names, and provider checks when provider behaviour changed |
| Wave end, beta handoff, production release | The complete local release plan and the cloud canary on the release inputs |
| Failure investigation | The smallest relevant group, or a retained diagnostic; neither replaces fresh acceptance evidence |
| Documentation-only change | The documentation checks and any executable contract the documentation changed |

## How a run executes

`scripts/verify.ts` plans, takes the workspace lock (`.agent-logs/workspace-test-operation.lock`), and then does the shared work of a browser run **once**: the server and backend preflight (build receipt, port-3000 ownership, backend routing, storage, edge runtime, Realtime parity), one Playwright discovery per suite, and a run key per group. It writes them to `prepared-plan.json` beside the report and names the file in `WERKFLOW_PREPARED_PLAN`; every group runner (`scripts/run-playwright.ts group …`) reads it and starts Playwright directly. Outside a verification run (focused and diagnostic lanes) the runner does that work itself. The per-group overhead outside Playwright is under 20 seconds; world seeding and the four role logins inside Playwright take about 18 seconds more. Two checks have no group of their own and run only in that preflight: Realtime publication parity (`bun run realtime:check`) and DEV migration history parity (`bun run migrations:check`). The lock covers verification runs, the focused and diagnostic lanes, `test:unit`, the SQL wrappers, recorded builds and environment switching; a raw `supabase db reset` or a directly invoked `bun test <file>` bypasses it (an open conversion in the [backlog](enforcement-ladder-backlog.md)).

Groups run in this order: static, unit, SQL, component, then browser groups. Only a failed shared prerequisite blocks the groups after it: a failed static gate, an input that changed during the run, or an interruption. A browser group's own failure never blocks its neighbours; a group whose Playwright never produced a manifest is blocked on its own.

**Workers.** `--jobs N` (1 to 8, or `WERKFLOW_VERIFY_JOBS`) runs independent golden and audit groups on N workers. Groups that measure freshness, readiness or a registered scenario, the integrated golden journey, SQL, the canary and every setup gate always run alone (`GroupTimingRequirements.exclusive`, derived from the spec source). The default is 1, measured on the workstation on 2026-09-25: two workers on six golden groups gained 11 percent and three workers on five groups about 20 percent, while each overlapping group ran about 70 percent slower on the one shared Next.js server and Chromium on the same CPU. Use 2 for a plan without timing-sensitive groups when the machine is otherwise idle; the workspace lock refuses a second verification command.

**Realtime health.** Before every timing-sensitive group on the local target, the runner probes the local Realtime tenant (`scripts/realtime-probe.ts`): a throwaway user subscribes to database changes and the tenant must confirm within five seconds. A slower or failed answer restarts the Realtime container once and probes again (`lib/testing/realtime-health.ts`); a second failure stops the run with the remedy. `bun run test:server local` additionally holds one warm subscription for its lifetime, so the tenant does not go cold between groups.

**Input drift.** Editing any input while the run is active voids the attempt: the report cannot certify, and a group whose result carries that reason (the run's own or the group runner's) has neither a proof nor a failed attempt. Documentation edits and comment-only edits are not inputs; both identities read the comment-free token stream. A recovered interruption without a failed business test is no attempt either.

## Groups and ownership

`TEST_SCOPE_PREFIXES` in `lib/testing/test-groups.ts` names the application folders each feature scope owns; a group declares the scopes it covers, and shared application code without an owner (`hooks/`, `components/ui/`, `lib/data/`) is an input of every group on purpose. Harness code under `tests/*/support/`, `lib/testing/` and `scripts/` qualifies only the groups whose specs import it (`IMPORT_QUALIFIED_PREFIXES`); the Playwright configs, `tests/ui-contracts/`, `eslint-rules/` and `bunfig.toml` belong to the kind that executes them. Runtime Markdown is an input; repository guidance is not.

The browser support lives in domain modules, one per product area, so that a helper edit reruns the groups of that area and nothing else:

| Directory | Modules |
| --- | --- |
| `tests/golden/support/steps/` | `shared` (locators, dialog plumbing, the typed-segment inputs), `customers`, `requests`, `work`, `service`, `documents`, `inventory`, `organization`, `personnel`, `qualifications`, `vacation`, `sickness`, `attention`, `time-tracking`, `calendar`, `dispatch` |
| `tests/golden/support/db/` | the same domains except `organization`, for database state reads, with `shared` holding the admin client and the role-client wrapper |
| `tests/audit/support/` | per-area audit steps (`a1-steps.ts` …), the performance profile and steps, fixtures |
| `tests/golden/support/` | worlds, sessions, fixtures, run state, date ownership, preconditions, checkpoints, the measurement helpers |

A new helper goes into the module of its product area; a helper two areas need goes into `shared`. Importing a whole-area module for one helper is fine; re-exporting one module from another is not, because it widens the importer's inputs (`lib/testing/spec-conventions.test.ts` rejects `export … from` in the domain modules).

**Adding a group.** A new `tests/golden/<slice>.spec.ts` becomes `golden:<slice>` by itself: its scopes are those of the slice's audit definition in any wave (`golden:p1-24a` shares `audit:wave-3:p1-24a`'s), its producers come from its `requires-file` annotations, and a golden file without an audit definition or an early-scope entry is global. An audit group is a row in `auditDefinitions` (`lib/testing/test-groups.ts`) with its file and scopes; `validateTestGroupInventory` rejects an audit file the registry does not name. Both need their flows mapped in `lib/testing/coverage-map.json` (`static:coverage`) and their run-day offsets registered in `tests/golden/support/date-ownership.ts` ([integrated-test-state.md](integrated-test-state.md)).

## Specs

Every golden and audit spec runs its tests in declaration order on one worker and continues after a failure, so one run shows every failure the file holds (`lib/testing/spec-conventions.test.ts` rejects `test.describe.configure(`; `lib/testing/browser-server-contract.test.ts` pins one worker, no retries and no failure cap in the three Playwright configs). Two mechanisms carry state between tests. Across files, a golden spec declares its producer files with `requires-file` annotations and exact earlier titles with `requires-test`; the runner pulls the producers into the same world and rejects missing, unknown, ambiguous, self-referencing or out-of-order producers before setup. Inside a file, a test that needs state an earlier test created guards it with `requireChainedValue`, `requireChainedPrecondition` or `requireVisiblePrecondition` (`tests/golden/support/preconditions.ts`): the guard fails in seconds with the exact `--grep` chain to run in the focused lane, never after minutes on a misleading locator timeout. App-assigned identities (job numbers, invite codes) travel through typed checkpoints (`lib/testing/checkpoints.ts`); derive everything else from the run.

Every test starts without persisted per-user UI preferences: the automatic `freshPreferences` fixture deletes the world's `organization_user_preferences` rows before each test. A test that proves persistence proves it inside its own run. The world's other state (customers, jobs, entries) is the file's own history and each test names what it relies on.

Audit groups own a disposable company each; golden groups run their declared producer files in one disposable company; canary checks share their cloud test company. Setup drives prerequisites through the admin client, then the behaviour under assertion through the real boundary; setup never pre-completes the operation a test claims to prove. Setup and teardown never sweep another group's records.

The harness admin client (`tests/golden/support/db/shared.ts`) sends a read a second time after one connection-level failure and a write exactly once (`lib/testing/transport-diagnostics.ts`).

Step conventions: prepare, submit once, verify completion at both boundaries (the visible confirmation and the persisted row). Wait for the required control to be usable, not for a dialog shell. Capture the baseline before an action and wait for the exact changed fact; an existing row, a count, a banner alone or an optimistic echo proves nothing. Scope positive locators to their semantic owner (PPR keeps hidden page copies); `visibleText()` for positive text, `textInDom()` for whole-DOM absence. Use accessible roles and names where the wording is part of the requirement; the `Banner` dismiss button is „Hinweis schließen". Close an open multi-select popover before clicking a pinned dialog footer. The typed-segment helpers (`typeIntoDatePicker`, `typeIntoDatePickerById`, `typeIntoTimeInput` in `steps/shared.ts`) are for `DatePicker` and `TimeInput`; `QuantityStepper` and `DurationHoursInput` take `.fill()`. ESLint and the convention tests reject raw page-root selectors, positional selection, fixed sleeps, skipped or focused tests and per-test timeout overrides.

## Coverage

The [user-flow catalog](../product/user-flow-catalog.md) owns supported behaviour. Every stable flow ID and every observable clause stays covered; `lib/testing/coverage-map.json` maps flows to evidence and `static:coverage` verifies identities, catalog hashes, referenced files and executable ownership. It cannot verify that prose matches assertions: review that correspondence when the catalog text or the assertion changes, and reopen the mapping on a material wording change. Choose the cheapest test that proves the boundary: domain functions for calculations, SQL for denial and history, the component fixture for shared controls, the browser for navigation, outcomes and cross-user freshness, the canary for live providers. A flow may map to several tests and a test to several flows; remove duplicate execution only after recording where each assertion remains. Revocation tests prove that both receivers observed the permitted initial event before access is removed.

## Evidence and reuse

The report records the selected scope, the input snapshot, every result with its run key and build id, and the measurements. A browser result qualifies only when its run passed, was cleaned, ran on the recorded build with the group's fingerprint, and every test passed. Reuse is conservative: a change to a group's own inputs or a shared dependency discards its proof; a changed repository elsewhere does not. Three identity rules keep proofs from dying for nothing: the proof environment replaces the local stack's private address with a token (`lib/testing/proof-environment.ts`), code is identified by its comment-free token stream (`lib/testing/source-content.ts`), and configuration files belong to the kind that executes them (`lib/testing/group-qualification.ts`).

Build identity is separate: `build:test` records source and environment digests, workspace, build id and time in `.next/werkflow-build-receipt.json`; the preflight compares the receipt with the current inputs, the disk and served build ids and the server's owner. Stop the server before rebuilding. Input digests contain no secrets and do not prove a schema reset or a provider's behaviour; record those as their own evidence.

## Deadlines and measured scenarios

The [freshness contract](realtime-and-caching.md) owns the product expectations. Cross-session checks (`expectLiveWithin`, `tests/golden/support/live.ts`) start the clock before submission in the acting session and end when the receiving session shows the exact new fact; the helper waits for both pages' database readiness and network idle first. The two-second target is judged with the combined tolerance of 25 percent or 250 ms (`lib/testing/responsiveness-tolerance.ts`): a sample inside the tolerance is recorded as over target and does not fail; beyond it fails. Readiness checks (`expectReadyWithin`) enforce five seconds from opening to usable controls. Measured failures do not retry; a vanished dialog is a preparation condition outside a measurement and a failure inside one.

Scenario measurements (`expectUsableWithin`, `expectScenarioLiveWithin`) use the ids, boundaries, budgets and sample counts in `lib/testing/measured-scenarios.ts` and the reviewed references in `lib/testing/performance-baselines.json`. Every sample must pass correctness and its hard budget; the median of the declared samples is compared with the reference under the same tolerance. A `required` scenario fails qualification when its reference is missing, incompatible or exceeded, and `lib/testing/performance-references.test.ts` fails the unit group when a required scenario has no reference at the current measurement digest. The digest covers the scenario spec, `tests/golden/support/scenario-measurement.ts`, `browser-observation.ts`, `lib/testing/live-observation.ts` and `tests/audit/support/performance-steps.ts`: an edit to any of them recalibrates or marks the scenario `calibrating` in the same change. A `calibrating` scenario still enforces correctness and its budget and records the comparison as unverified.

Calibration: after the measured groups pass on the current inputs, `bun scripts/calibrate-performance.ts --runs <up to three run keys> --reason "<review basis>"` drafts references under `.agent-logs/performance-calibration/`. Review the samples, the median, the environment and the tolerance, copy the entries into `performance-baselines.json`, set the scenarios to `required`, and rerun the measured groups to prove the required path. The validator refuses fewer than three samples, an over-budget sample, a reference that is not the median, missing build provenance or duplicate run keys. Never derive a reference from a failed or over-budget run, widen a budget to fit a slow candidate, or raise a Playwright timeout (180 s per golden test, 240 s per audit test, 300 s in the cloud, 30 s actions, 60 s navigations; `lib/testing/browser-server-contract.test.ts` pins them) to repair a regression. Compatibility spans scenario and measurement versions, workload identity, backend, role, browser, viewport and host.

The measured owners: `audit:performance:calendar` (the typical profile: 10 records, 40 visits a day in a 44-day window and a live week, 1,000 customers, 2,500 jobs; the calendar entry, drops and view switches), `audit:performance:lists` (the bounded first pages), `audit:performance:planning` (the planning benchmark and role openings) and `audit:performance:calendar-live` (closure and correction delivery to an open receiver). They seed their own organization, run alone, publish their last fixture row through an authenticated Realtime subscription before measuring (`insertFinalFixtureTimeEntry`, three-minute deadline), keep their traces, and record every sample. Run them without competing load on the host.

**Iterate on one scenario.** A focused run with `KEEP_WORLD=1` (read by `tests/golden/global-teardown.ts`, honoured in the focused lanes only) keeps its world after a pass; `bun run test:diagnostic:audit --grep "<title>" --reuse-run <run-key>` replays the scenario on that world as often as the design needs. Diagnostic and iteration results explain; acceptance comes from the group.

## Retention

Every browser run keeps its manifest, runner log, latency and workload archives and archived state under `.agent-logs/playwright-runs/<run-key>/`; traces, HTML reports and the active world copy are diagnosis material. `bun run test:runs prune` removes those from cleaned runs older than a day that no current proof, reviewed baseline or retained world cites; the runner refuses to start browser groups while they hold more than 10 GB and names the command. Run the prune before a campaign, not when the limit stops a plan.

## Failures

1. Open the failed group's `error-context.md`, screenshot and trace under its run directory; the verification log names the run key.
2. Check the exact saved result before repeating any mutation whose response was unclear.
3. Classify the cause from evidence and record it with `bun run test:runs classify <run-key> <product|harness|environment|transient> "<cause>" "<prevention>"`.
4. Reproduce the smallest relevant failure, fix its cause, and add prevention at the highest reachable tier.
5. Clean the retained world (`bun run test:runs cleanup <run-key>`) and rerun the affected group; then rerun the plan.

| Class | Basis |
| --- | --- |
| Product | The intended business, UI or response-time contract fails in the application |
| Harness | Setup, selection, timing, state hygiene or an assertion misrepresents the promised behaviour |
| Environment | A provider, process, network, server or WSL problem prevents a valid observation |
| Transient | A specifically evidenced temporary event explains the failure; a later pass alone is not evidence |

A failed group on unchanged inputs is blocked from another attempt until it is diagnosed; a repeat is not a repair. One bounded retry after an environment failure needs the classification, a passing diagnostic replay on the same build and target (`lib/testing/group-recovery.ts`), and then the cleanup, in that order: cleaning the world first forfeits the retry. Two failures on the same inputs stay blocked until the cause is resolved. A preflight failure that creates no run is blocked verification, not a product failure. Windows listener inspection repeats its read once after a timeout and otherwise fails. If the host kills a run, confirm the lock owner and its children are gone, then `bun run test:runs recover-interrupted <run-key> "<observed interruption>"`; no command steals a live lock. After a WSL address change, `bun run test:runs cleanup-local-relocated <run-key> "<observed change>"` cleans a retained world after verifying both organizations by id, name and owner.

After a failed release run the next action is a focused run of every failed group; after two consecutive failed release runs, the diagnosis and a harness hypothesis go into the [incident log](test-incident-log.md) before anything runs again (`lib/testing/release-breaker.ts`). Every incident entry ends in a Tier 1 or Tier 2 change, a Tier 3 with its reason, or the statement that no prevention follows (`docs:check` check 12).

## The campaign budget

`bun run test:campaign` sums the verification since the last commit (`--since <ISO time>` moves the boundary): reports, minutes, groups run and reused, failures by classification, blocked groups. Every verify run prints the same line at its end. Reading it: a group counts as reused when its result started before the report did; a browser failure carries the classification of its run and `unclassified` until `test:runs classify` names one; a static or unit failure counts as `static`; an attempt the runner voided for input drift is skipped; an aborted report costs until its last group start (`lib/testing/campaign-summary.ts`).

The budget per slice is 240 minutes of verification or 8 harness failures. Past either, the slice does not close until the harness changed in a way the next slice cannot undo: a fixture, a runner rule, a convention test, a split of ownership, never a sentence in a document. The stop rule is a mechanism, not a reminder: after the second browser failure classified harness or environment since the last commit, `bun run test:verify` refuses to start browser groups until a harness input (`lib/testing/`, `scripts/`, `tests/*/support/`, the Playwright configs, `eslint-rules/`) differs from the snapshot of the report that holds the latest such failure (`campaignGateProblem`; the plan prints the same sentence as a warning). A harness failure class seen twice in one slice needs the same treatment regardless of the budget. Over budget, the slice record quotes the campaign line, the incident log gets the entry with the classification of every failure and the tier of each prevention, and the harness change lands in the same diff as the closure; the rule and its evidence live in the [protocol](../plans/phase-1/protocol.md#campaign-budget).

## Tiers and collections

| Tier | Testing responsibility |
| --- | --- |
| 1, construction | Owned worlds and paths, typed checkpoints, the preference reset, shared controls, helpers that separate preparation from one submission |
| 2, automated checks | Coverage identities and hashes, producer selection, input-qualified results, the lock, selector and spec conventions, response deadlines, the Realtime probe, the budget line |
| 3, reviewed meaning | Whether assertions prove the promised clauses, a screenshot supports a visual claim, an environment explanation has evidence |

`bun run test:unit` runs `lib/` tests through the workspace lock; the convention tests read the repository, so the unit group's inputs are the complete executable snapshot. `bun run test:ui` mounts real components in Chromium with explicit service-boundary fixtures and the compiled stylesheet (`WERKFLOW_UI_CONTRACT_CSS`) for geometry assertions. A SQL group executes its registered files in `supabase/tests/` through `scripts/run-sql-assertions.ts`, each file a rolled-back transaction. The layout audit (`tests/audit/layout/mobile-viewport.spec.ts`) owns page overflow, shell scrolling and form geometry over `lib/testing/mobile-route-inventory.ts`; a new authenticated page joins that inventory. Local mail capture reads only recipients the world reserved (`lib/testing/local-mailpit.ts`). Backend ids, the local stack and machine onboarding live in [environments.md](environments.md); integrated golden producers and fixture dates in [integrated-test-state.md](integrated-test-state.md). Testing policy authorizes no commit, push, deployment or schema change.
