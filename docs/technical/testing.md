# Verify application changes

Status: living — last reviewed 2026-09-06

Start here when implementing a slice, investigating a failed test, or preparing a release. [Decision 0007](../decisions/0007-independent-test-groups.md) replaces the full-battery-per-slice acceptance policy. The local backend and cloud-provider separation from [decision 0006](../decisions/0006-testing-architecture.md) remains. The [restructure plan](../plans/testing-system-restructure-2026-09.md) owns migration progress and verification limits.

## Plan before running

Run the selector before starting expensive checks:

```bash
bun run test:plan
bun run test:plan --mode release
bun run test:plan --target cloud
```

The default mode is `change`, and the default target is `local`. The plan identifies selected groups and reusable results. Review why shared changes or unknown ownership select broad coverage. Do not narrow ownership merely to reduce a plan's size.

Change selection compares current inputs with the last passing complete change or release report for that target. Before such a baseline exists, it examines changes against local `HEAD`, including untracked and deleted files. A successful explicit subset does not advance the change baseline. A clean checkout without a baseline therefore proves only its selected static checks; release mode establishes complete application evidence. Unresolved group failures remain selected even when no source file changed.

For local browser groups, stop any existing server and start the recorded production build in a durable terminal:

```bash
bun run test:server local
```

After the server reports readiness, execute the planned verification from another terminal:

```bash
bun run test:verify
```

`test:verify` runs groups that lack a qualifying result for their current inputs. Independent groups continue after an unrelated failure. Dependent stages within one journey stop when their prerequisite fails. The overall result remains incomplete if any required group fails or is blocked.

Use an explicit group selection during implementation or diagnosis:

```bash
bun run test:plan --group audit:wave-2:p1-22,golden:p1-22
bun run test:verify --group audit:wave-2:p1-22,golden:p1-22
```

An explicit subset proves only that subset. Return to the normal change plan before accepting the change. The CLI rejects combining release mode with `--group`.

## Choose the acceptance scope

| Work | Required evidence |
| --- | --- |
| Slice or application change | The complete selected local change plan, catalog coverage, relevant visual review, and provider checks when provider behavior is affected |
| Wave end, beta handoff, or production release | The complete local release plan and the cloud canary on the intended release inputs |
| Failure investigation | The smallest relevant group or retained diagnostic. Diagnostic results cannot replace fresh acceptance evidence |
| Documentation-only change | Current documentation checks and any executable contract changed by the documentation. A historical wording correction does not require another business journey |

Change mode selects affected feature groups, their declared producers, and shared checks. It excludes `golden:integrated`. Release mode includes all audit groups, the integrated Golden journey, unit tests, component browser checks, SQL checks, and static checks. It does not add separate Golden groups that duplicate that integrated journey.

Cloud mode selects `canary:providers` by default. To run it, stop the local server, start `bun run test:server cloud`, then execute `bun run test:verify --target cloud`. A local-to-cloud switch requires a new recorded build. The canary verifies live DEV providers, not complete application behavior. Full cloud batteries are no longer a routine wave-end requirement. An owner can request additional cloud verification for a named provider risk.

Release acceptance needs valid results for every required group. Those results may come from separate runs when each group's inputs remain unchanged. A connected Golden journey must pass from beginning to end in one owned world. Neither a mixed-candidate list of test names nor an old full-suite pass proves the release candidate.

## Understand the test groups

| Kind | What it proves | What it does not prove |
| --- | --- | --- |
| Static | Types, lint rules, documentation consistency, and structural conventions | A usable business workflow |
| Unit | Calculations, validation, state rules, projections, and focused code contracts | Browser interaction or deployed permission behavior |
| SQL | Actual database permissions, transactions, immutable history, replay rejection, and data boundaries | Correct controls, labels, or page refresh |
| Component browser | Real controls and sections, keyboard behavior, forms, errors, and loading states with explicit simulated service boundaries | Real persistence, authorization, or application routing |
| Golden | A connected business outcome through the real app and saved data | Every exceptional path for each feature |
| Audit | Detailed catalog behavior, alternative paths, role boundaries, and responsive layouts through the app | Every imaginable user action sequence |
| Canary | Real DEV authentication, R2, Realtime, email, provider password checks, and migration parity | The complete operational core |

`lib/testing/test-groups.ts` owns executable groups, their files, declared prerequisites, and application scopes. `lib/testing/coverage-map.json` maps catalog flows to evidence. `lib/testing/coverage-map.ts` validates that mapping. Run results, rather than this guide, own current counts and durations.

## Preserve every promised behavior

The [user-flow catalog](../product/user-flow-catalog.md) owns supported user behavior. Keep every stable flow ID and every observable clause covered when changing test allocation. A clause includes relevant roles, defaults, denial, warnings, saved state, and promises that something must not happen.

Choose the least expensive test that proves the actual boundary:

- Test calculations and input combinations directly through their real domain functions.
- Test database denial with the restricted user's permissions, not an administrator bypass.
- Test shared control behavior in the real component fixture.
- Retain browser checks for navigation, visible controls, complete business outcomes, and cross-user freshness.
- Keep live-provider assertions in the canary.

A flow may map to several tests. A test may prove several flows. Remove duplicate execution only after recording where each assertion remains. A simulated save cannot replace a database assertion, and a database assertion cannot replace a visible permission or interaction check.

When adding or changing catalog text, reconcile its entire meaning with the assertions before updating the mapping's catalog hash. Record incomplete coverage as incomplete. The checker verifies identities, current catalog hashes, referenced files, and executable ownership. It cannot establish that prose accurately describes the assertions. Review that correspondence explicitly, including imported historical ledger evidence.

The longstanding phrase **testing rule 12** in accepted records refers to this exhaustive, many-to-many coverage obligation. It does not require every clause to run through a browser. Current acceptance requires complete catalog-to-mapping equality and no partial or unmapped behavior. Manual replacement needs a named owner-approved exception.

## Keep groups independent

Every new browser invocation owns its files beneath `.agent-logs/playwright-runs/<run-key>/`:

| Path | Contents |
| --- | --- |
| `active/` | Current world, role sessions, checkpoints, and generated upload fixture |
| `state/` | Archived world, sessions, and checkpoints |
| `playwright/results/` | Per-test traces, screenshots, and error context |
| `playwright/report/` | HTML report |
| `manifest.json`, `runner.log` | Selected tests, outcomes, input identity, ownership, and execution record |

State paths resolve through the configured run identity. Current runs never fall back to the old shared `tests/golden/.artifacts` directory. Historical recovery recognizes the older layout explicitly. Unknown layouts fail.

Audit groups own disposable companies. Golden groups run their declared producer files in one disposable company. Canary checks share their own cloud test company. Start fixtures from known valid prerequisites, but drive the behavior under assertion through the real boundary. Setup code must not pre-complete the operation the test claims to prove.

Use static `requires-test` annotations for an exact earlier test title and `requires-file` annotations for a preceding repository-relative spec. The runner rejects missing, unknown, ambiguous, self-referencing, or out-of-order producers before setup. Persist assigned identities through typed checkpoints and verify the actual precondition after restoring a checkpoint.

Setup and teardown do not sweep another group's records. A successful group deletes its owned company. A failed group retains its company and evidence. Another independent group can run while that world remains retained, but the failed group cannot silently reuse it as fresh proof. Resolve all retained ownership before release closure.

Seeding reserves UUIDs for the world and all cleanup identities, then archives them before the first external write. A retained world marked `seedStatus: seeding` owns any partial resources but cannot run diagnostics. Clean its exact recorded identities before starting fresh. Historical worlds without this marker keep their existing recovery behavior.

The verification command owns the shared workspace lock for its whole run. Other builds, cleanup commands, environment changes, and independent test commands cannot overlap it. Keep raw resets and unwrapped infrastructure commands separate.

The default `--jobs 1` executes groups serially. Opt-in `--jobs 2` permits at most two eligible independent application browser groups inside that one owned verification run. The integrated Golden journey, freshness and readiness groups, SQL, cloud canary, and setup or static gates remain exclusive. Every eligible group still owns its data and files. This option does not authorize two separately launched verification commands or a concurrent rebuild.

The [restructure plan](../plans/testing-system-restructure-2026-09.md) records host validation and limits of bounded concurrency. File isolation alone is not a measured speedup or proof that the workstation can sustain a higher load.

## Reuse evidence conservatively

`scripts/verify.ts` writes `.agent-logs/verification/<id>/report.json` with the selected scope, input snapshot hashes, outcomes, and attributed reused results. Local and cloud target histories remain separate. `lib/testing/group-evidence.ts` records group inputs and determines whether a result remains applicable. Declared source ownership, imported dependencies, test definitions, shared tooling, migrations, and environment identity contribute to the decision. New or unowned executable inputs are treated as shared until their ownership is reviewed. Additions and deletions count as changes.

Convention unit tests inspect repository files directly, so the unit group qualifies the complete executable input snapshot. Shared helpers loaded by framework configuration remain conservative shared inputs. Narrow them only after recording their actual entry points and validating the change. Runtime Markdown and MDX remain executable inputs; only repository guidance is excluded from business-proof invalidation.

A changed repository fingerprint alone does not erase unrelated passing groups. A change to a group's own inputs or a shared dependency does. The latest result for matching inputs must pass. A later failure invalidates an earlier pass for those inputs. Never choose the older green attempt because it is convenient.

Build identity remains separate. `build:test` records application and environment digests, workspace identity, build ID, and completion time. Preflight compares the receipt with current inputs, disk and served build IDs, and server ownership. Stop the server before rebuilding. A normal `bun run build` does not create the private test receipt. All business browser groups use port 3000 and a recorded production server.

Input digests contain no secret values. They do not prove that a schema reset ran or that external provider behavior stayed unchanged. Record migration replay and provider verification as their own evidence.

The cloud canary always executes afresh. Unchanged source does not establish that a live provider still works.

## Prepare, submit once, and verify completion

Wait for the actual required controls to become usable. A visible dialog shell alone is insufficient. Measure opening-to-readiness when the contract has a responsiveness requirement. Starting the measurement after loading finished would conceal the delay.

Keep preparation separate from submission. Shared helpers can recover preparation after a proven remount. They must submit the business mutation once. If the response is unclear, inspect the exact saved identity, version, or state before deciding on recovery. Never retry a write merely because a response timed out.

Capture the baseline before the action and wait for the exact changed fact. An existing row, a nonzero count, a success banner alone, or an optimistic echo does not prove the new write committed. Assert visible confirmation and persisted results at their respective boundaries.

Positive interactions must identify the active route, dialog, or record. PPR can retain hidden copies of a page. Scope positive test-ID queries to their semantic owner. Keep privacy checks strict across hidden and visible content. `visibleText()` serves positive text checks. `textInDom()` serves whole-DOM absence checks.

Use semantic accessible roles and names where their wording is part of the requirement. A stable identifier can locate a durable business action while a separate assertion verifies its accessible name. Do not accept a list of vaguely similar button labels or use positional selection to make an ambiguous test pass.

ESLint and convention tests reject raw page-root CSS selectors, ambiguous positive IDs, positional selection, fixed sleeps, skipped or focused tests, per-test timeout overrides, and raw cleanup markers. Existing named helper exceptions have bounded ownership and rationale. Semantic assertion review remains necessary.

## Enforce visible response deadlines

The [freshness contract](realtime-and-caching.md) owns product expectations. Cross-session measurements begin before submission in the acting session and end when the receiving session displays the exact new fact. Do not reload the receiving page to manufacture convergence.

The two-second cross-session target is an acceptance deadline. A result that appears after the target fails even if it eventually appears inside the longer emergency wait. The emergency wait bounds observation and preserves useful evidence. It does not redefine acceptable speed. The P1-22 correction-dialog readiness check separately enforces five seconds from opening to usable controls.

Measured failures bypass preparation retries immediately. A vanished dialog does not permit restarting a failed measurement. `@FRESHNESS` and `@READINESS` identify the measured stages for focused diagnostics; the group registry separately pins required measurements and exclusive scheduling.

Check correctness, responsiveness, and environment validity separately. Correct but too slow is not fully green. A demonstrated invalid environment produces a blocked or failed verification result, not an automatic pass. Run dedicated timing checks without competing workload on this host. Keep the measured start boundary, elapsed time, deadline, and failure visible in the report.

Scenario safety timeouts remain separate: local Golden tests use 180 seconds, local audits 240 seconds, and cloud browser tests 300 seconds. Actions default to 30 seconds and navigation to 60 seconds. These limits stop stuck work. They are not product response targets. Do not increase them to repair a selector or loading regression.

## Diagnose without restarting the whole plan

1. Open the failed group's `error-context.md` and screenshot. Inspect the trace when timing, request, or remount evidence is needed.
2. Check the exact saved result before repeating any mutation whose response was unclear.
3. Classify the cause from evidence and record it in the [incident log](test-incident-log.md).
4. Reproduce the smallest relevant failure, fix its cause, and add prevention at the highest practical tier.
5. Clean the retained world after diagnosis and run the affected fresh group. Re-run the normal plan to resolve remaining selected groups.

| Class | Required basis |
| --- | --- |
| Product | The intended business, UI, or response-time contract fails in the application |
| Harness | Setup, selection, timing, or an assertion misrepresents the promised behavior |
| Environment | A provider, process, network, server, or WSL problem prevents a valid observation |
| Transient | A specifically evidenced temporary event explains the failure. A later pass alone is insufficient |

```bash
bun run test:runs list
bun run test:runs classify <run-key> <product|harness|environment|transient> "<cause>" "<prevention>"
bun run test:diagnostic --grep "<failed-stage-title>" --reuse-run <run-key>
bun run test:diagnostic:audit --grep "<failed-stage-title>" --reuse-run <run-key>
bun scripts/run-playwright.ts diagnostic canary --target cloud --grep "<failed-test-title>" --reuse-run <run-key>
bun run test:runs cleanup <run-key>
```

A retained audit diagnostic must select the recorded audit file. Replay verifies suite, target, backend origin, bucket, storage endpoint, and the original Berlin business date. Diagnostic results explain the failure but never qualify as fresh acceptance results.

An unchanged failed group is blocked from another acceptance attempt unless it qualifies for one bounded environment-recovery retry. The previous failure must be classified as environment-related. A later retained diagnostic must pass on the same candidate and target, then the owned world must be cleaned. The diagnostic explains recovery but does not replace the fresh retry. Two failures on the same inputs remain blocked until their underlying cause is resolved.

A preflight failure that creates no run or world is blocked verification, not a product failure. Repair the environment and rerun the command without manufacturing a mutation or claiming business evidence. Changing grep spelling does not repair a test or product defect. Independent groups may continue where the environment is valid. Repeated unexplained failures must remain blocked; do not create a cycle of complete-suite reruns, timeout increases, or budget extensions.

Campaign history retains execution cost and interruptions. Legacy `test:golden`, `test:audit`, and `test:canary` commands still provide complete-suite execution and their historical campaign controls. They are not the default slice acceptance workflow. Do not reset or close an old campaign to erase unresolved evidence, and do not run a full suite solely to make its old close guard green.

Legacy focused commands and retained diagnostics require the same recorded production server as `test:verify`. No business Playwright configuration starts a development server. Missing or stale server evidence stops preflight before fixture creation. Use `test:server` for the selected target before these commands as well.

If the host kills a run, verify that the lock owner and child processes have stopped before recovering ownership. Run `bun run test:runs recover-interrupted <run-key> "<observed interruption>"`. Recovery records interrupted ownership before archival work, validates identities, and preserves original outcomes and cost. Missing state remains an unresolved recovery failure. No command steals a live lock.

Transport diagnostics emit `[test-fetch-rejected]` with the HTTP method, origin, and allowlisted error codes. They exclude request contents and credentials and do not retry the fetch. Read captured test stderr and redact artifacts before sharing them. A rejected connection is evidence of a failed boundary, not proof of a specific operating-system cause.

## Repair an existing test under the current workflow

Apply decision 0007 to existing tests as well as new tests. An accepted historical plan records what was proved then; it does not authorize restoring shared artifacts, full-battery-per-change execution, or warning-only timing. Repair tests as affected work exposes defects. Do not run a complete campaign solely to certify the migration. This does not waive the selected change evidence or the later release requirements above.

First compare the failed assertion with the current feature specification and catalog clauses. Decide whether the application violates its promise or the test misrepresents it. A previous green run cannot settle that question. Do not change the expected result merely because the application currently behaves differently.

| Failure or legacy pattern | Repair boundary |
| --- | --- |
| Shared artifact path or another run's session/world | Use the run-owned paths through `lib/testing/run-paths.ts` and `tests/golden/support/world.ts`. Preserve the failed run's ownership and evidence. |
| Missing earlier record, checkpoint, or date-dependent fixture | Inspect `lib/testing/test-groups.ts`, producer annotations, and typed checkpoints. Read [integrated-test-state.md](integrated-test-state.md). Declare the real prerequisite; do not make independent groups depend on another group's leftovers. |
| Dialog exists but the form is not usable | Prepare through the shared helpers in `tests/golden/support/steps.ts` or the owning audit helper. Wait for the required control and option. Preserve opening-to-readiness measurement where required; an application control accepting clicks before its handler is ready needs an application repair. |
| Save appears to time out or the database still shows the old value | Inspect the exact saved identity/version before recovery. Separate preparation, one submission, and authoritative completion. A toast or optimistic row alone cannot prove persistence. |
| Hidden page copies or an ambiguous label | Scope the positive locator to the active semantic owner. Preserve whole-DOM privacy assertions. Confirm required wording separately when using a stable action identifier. |
| Correct value arrives after its deadline | Keep the responsiveness failure. Use `tests/golden/support/live.ts` for the observation; diagnose the application or establish an invalid environment. Do not start the clock later, reload the receiver, or widen the deadline. |
| Assertion moves between test layers or files | Preserve each catalog clause and its real boundary. Update the coverage mapping and group ownership together. Hash agreement alone does not prove equivalent coverage. |

Repair a shared helper when it owns the cause; do not copy a workaround into every caller. Review its callers and let the change plan select their affected groups. Do not narrow dependency ownership to preserve old passes. A genuine business-contract change requires updating the owning specification, catalog, and assertions together; test repair alone does not authorize it.

Close a repair with evidence for the original failure boundary, its classification, cleanup status, preserved clause coverage, and the prevention tier. Use the smallest appropriate check during diagnosis, then obtain the affected fresh group evidence through the normal workflow. Retained diagnostics are explanatory evidence. Subset passes remain subset passes; report unresolved failures and unexecuted scope explicitly. The diagnosis section above owns retry and recovery rules.

This procedure is Tier 3 guidance for deciding what a test should mean. The shared helpers and automated checks enforce the mechanical parts. Neither a document nor a coverage hash can determine whether an assertion accurately expresses a business promise.

## Maintain the enforcement tiers

| Tier | Testing responsibility |
| --- | --- |
| 1, construction | Owned worlds and paths, typed checkpoints, shared controls, and helpers separating preparation from one submission |
| 2, automated checks | Coverage identities and hashes, producer selection, input-qualified results, locks, selector conventions, and response deadlines |
| 3, reviewed meaning | Whether assertions prove all promised clauses, declared impact is conservative, a screenshot supports the visual claim, and an environment explanation has evidence |

Push each diagnosed lesson through the [enforcement ladder](../decisions/0005-enforcement-ladder.md). Keep open conversions in the [backlog](enforcement-ladder-backlog.md). Do not duplicate a helper's enforceable contract across several skills.

## Extend the correct collection

`bun run test:unit` runs `lib/` tests through the workspace lock. Domain tests cover real calculations and state rules. Testing and UI contract tests cover the shared mechanisms. Expected holiday dates catch changes against reviewed expectations; they do not detect legal changes automatically.

`bun run test:ui` mounts real components in Chromium without Next.js, Supabase, or a test company. Use explicit service-boundary fixtures. Add an independent large component through its own fixture selection. The command records its inputs, arguments, result, and browser report under `.agent-logs/ui-contracts/`.

`bun run test:sql:p121` through `test:sql:p124` execute the matching files in `supabase/tests/` through `scripts/run-sql-assertions.ts`. The wrapper streams SQL into the local database with `ON_ERROR_STOP=1`. Each file owns a transaction and ends with rollback. These are SQL exception assertions, not pgTAP files. Add new SQL files to the group registry when introducing another protected domain.

The layout audit in `tests/audit/layout/mobile-viewport.spec.ts` owns page overflow, shell scrolling, native-control bans, and form geometry. `lib/testing/mobile-route-inventory.ts` declares the static pages, dynamic detail patterns, and redirects; its unit check compares that inventory with every authenticated `page.tsx`. Add an executable case or tested redirect when a route ships. Detail fixtures belong to the audit's disposable organization and do not claim creation-workflow coverage. Measurements wait for loaded page content and attach screenshots. Route coverage does not establish every role, tab, dialog, or data-state combination. Maintenance and period audits also attach representative images. Inspect images before claiming visual fidelity; a passing business assertion does not establish it.

Backend IDs, local setup, storage routing, and machine onboarding live in [environments.md](environments.md). Production is excluded from test routing. Testing policy does not authorize a commit, push, production deployment, or a schema change.

When changing integrated Golden producers or fixture dates, read [integrated-test-state.md](integrated-test-state.md). Independent groups do not inherit unrelated fixture history.
