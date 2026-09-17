# Verify application changes

Status: living — last reviewed 2026-09-17

Start here when implementing a slice, investigating a failed test, or preparing a release. [Decision 0007](../decisions/0007-independent-test-groups.md) replaces the full-battery-per-slice acceptance policy. The local backend and cloud-provider separation from [decision 0006](../decisions/0006-testing-architecture.md) remains. The [restructure plan](../plans/phase-1/hardening-2026-09/04-testing-system-restructure.md) owns migration progress and verification limits.

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

`test:verify` runs groups that lack a qualifying result for their current inputs. A recorded pass qualifies when its fingerprint matches or when the report snapshot it was recorded under holds the same content for every current input of the group, so a qualification-rule change or an edit to a file the group never reaches does not discard the proof. Independent groups continue after an unrelated failure. Dependent stages within one journey stop when their prerequisite fails. The overall result remains incomplete if any required group fails or is blocked.

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
| Cross-cutting hardening pass (security, performance) before the beta handoff | Owner decision 2026-09-06: the cheap groups (static, unit, SQL, UI contracts) plus a hand-picked set of browser groups covering the boundaries the pass changed, recorded by name in the pass's plan with the reason for each. The complete battery runs once, in release mode, at the final beta acceptance after the last pass, because each pass changes shared inputs that would select and then invalidate every browser group. This does not make a pass "accepted"; its plan must say which groups ran and which did not. |
| Wave end, beta handoff, or production release | The complete local release plan and the cloud canary on the intended release inputs |
| Failure investigation | The smallest relevant group or retained diagnostic. Diagnostic results cannot replace fresh acceptance evidence |
| Documentation-only change | Current documentation checks and any executable contract changed by the documentation. A historical wording correction does not require another business journey |

Change mode selects affected feature groups, their declared producers, and shared checks. It excludes `golden:integrated`. Release mode includes all audit groups, the integrated Golden journey, unit tests, component browser checks, SQL checks, and static checks. It does not add separate Golden groups that duplicate that integrated journey.

Cloud mode selects the cloud groups in `lib/testing/test-groups.ts`. To run them, stop the local server, start `bun run test:server cloud`, then execute `bun run test:verify --target cloud`. A local-to-cloud switch requires a new recorded build. The canary verifies live DEV providers, not complete application behavior. Full cloud batteries are no longer a routine wave-end requirement. An owner can request additional cloud verification for a named provider risk.

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

A static group declares its package script in the registry. Beside types (`static:typecheck`, with `noUnusedLocals` and `noUnusedParameters`), lint (`static:lint`, which also caps product modules at 2,000 lines and requires a reason on every suppression), docs, and coverage, `static:unused` runs `bun run unused:check` (knip, configured in `knip.jsonc`) and fails on an unused file, export, or dependency; type-only exports are part of that gate since 2026-09-15. Static groups run on every plan; they never reuse a prior result. `realtime:check`, `migrations:check` and `types:check` run only through the Playwright preflight and the cloud canary, not through a static group, and `scripts/sync-dev-auth-from-prod.ts` is in no gate.

Security checks use the same group ownership and evidence rules:

- `static:dependencies` runs `bun run security:dependencies` for dependency or advisory-gate input changes, release mode, and an unresolved prior failure. It has a bounded network request and exact, expiring applicability exceptions. Network failure is not a clean advisory result. Ordinary offline unit tests use synthetic advisory fixtures.
- `sql:security` executes every file registered to the group, stops at the first unsuccessful file, and preserves its failure. The files cover restricted-role grants, atomic email challenges, event-history retention, and deletion notifications. Its local results do not establish cloud grant state.
- `audit:security:account` follows the actual two-mailbox email-change wizard in its own local organization. It reads only mail addressed to recipients reserved by that world and verifies the Auth change and consumed challenge. It is separate from the integrated Golden journey because it changes the account email.
- `canary:security` independently checks live DEV grants, captures Realtime delivery for ordinary, foreign, and revoked receivers, and verifies that the authenticated mail provider accepts a synthetic invitation. Provider acceptance is not inbox delivery. Select it with `bun run test:verify --target cloud --group canary:security` for this boundary scope; it does not replace the provider group or its freshness requirements.

Local mail capture uses the explicit transport in [environments](environments.md#the-local-test-stack). `lib/testing/local-mailpit.ts` confines mailbox reads and deletion to the local endpoint and owned recipients. Test cleanup must preserve other worlds' mail. Missing capture configuration or unavailable Mailpit is an environment failure to diagnose, not a reason to extract OTPs from logs or simulate successful delivery.

## Preserve every promised behavior

The [user-flow catalog](../product/user-flow-catalog.md) owns supported user behavior. Keep every stable flow ID and every observable clause covered when changing test allocation. A clause includes relevant roles, defaults, denial, warnings, saved state, and promises that something must not happen.

Choose the least expensive test that proves the actual boundary:

- Test calculations and input combinations directly through their real domain functions.
- Test database denial with the restricted user's permissions, not an administrator bypass.
- Test shared control behavior in the real component fixture.
- Retain browser checks for navigation, visible controls, complete business outcomes, and cross-user freshness.
- Keep live-provider assertions in the canary.

A flow may map to several tests. A test may prove several flows. Remove duplicate execution only after recording where each assertion remains. A simulated save cannot replace a database assertion, and a database assertion cannot replace a visible permission or interaction check.

For revocation tests, inspect the actual policy before choosing a receiver role. Prove that both the ordinary receiver and the receiver to be revoked can observe the permitted initial event before removing access. Then assert that the ordinary receiver still observes the changed fact while foreign and revoked receivers do not. A receiver that never had permission, or a subscription that never became ready, cannot prove revocation. Keep these positive controls in the executable test so setup mistakes cannot make absence appear safe.

When adding or changing catalog text, reconcile its entire meaning with the assertions before updating the mapping's catalog hash. Record incomplete coverage as incomplete. The checker verifies identities, current catalog hashes, referenced files, and executable ownership. It cannot establish that prose accurately describes the assertions. Review that correspondence explicitly, including imported historical ledger evidence.

The longstanding phrase **testing rule 12** in accepted records refers to this exhaustive, many-to-many coverage obligation. It does not require every clause to run through a browser. Current acceptance requires complete catalog-to-mapping equality and no partial or unmapped behavior. Manual replacement needs a named owner-approved exception.

## Keep groups independent

Standalone local cleanup owns its WSL lifetime connection, workspace lock and cancellable child process, with a three-minute operation bound. Keep the recorded server alive during cleanup when possible. After a WSL restart, use the existing local-relocation recovery procedure to verify exact test-organization ownership; an old private address must not be silently treated as the current backend. Timeout or cancellation leaves incomplete cleanup recorded for inspection and recovery.

Every new browser invocation owns its files beneath `.agent-logs/playwright-runs/<run-key>/`:

| Path | Contents |
| --- | --- |
| `active/` | Current world, role sessions, checkpoints, and generated upload fixture |
| `state/` | Archived world, sessions, and checkpoints |
| `playwright/results/` | Per-test traces, screenshots, and error context |
| `playwright/report/` | HTML report |
| `manifest.json`, `runner.log` | Selected tests, outcomes, input identity, ownership, and execution record |

Retained diagnostics also restore `performance-workload.json` and `planning-benchmark-workload.json` from the source run root when present. They never copy earlier outcomes or latency summaries. The source manifest still owns provenance and the diagnostic remains ineligible for acceptance.

State paths resolve through the configured run identity. Current runs never fall back to the old shared `tests/golden/.artifacts` directory. Historical recovery recognizes the older layout explicitly. Unknown layouts fail.

Audit groups own disposable companies. Golden groups run their declared producer files in one disposable company. Canary checks share their own cloud test company. Start fixtures from known valid prerequisites, but drive the behavior under assertion through the real boundary. Setup code must not pre-complete the operation the test claims to prove.

Use static `requires-test` annotations for an exact earlier test title and `requires-file` annotations for a preceding repository-relative spec. The runner rejects missing, unknown, ambiguous, self-referencing, or out-of-order producers before setup. Persist assigned identities through typed checkpoints and verify the actual precondition after restoring a checkpoint.

Setup and teardown do not sweep another group's records. A successful group deletes its owned company. A failed group retains its company and evidence. Another independent group can run while that world remains retained, but the failed group cannot silently reuse it as fresh proof. Resolve all retained ownership before release closure.

Seeding reserves UUIDs for the world and all cleanup identities, then archives them before the first external write. A retained world marked `seedStatus: seeding` owns any partial resources but cannot run diagnostics. Clean its exact recorded identities before starting fresh. Historical worlds without this marker keep their existing recovery behavior.

The verification command owns the shared workspace lock for its whole run. Other builds, cleanup commands, environment changes, and independent test commands cannot overlap it. Keep raw resets and unwrapped infrastructure commands separate.

The default `--jobs 1` executes groups serially. Opt-in `--jobs 2` permits at most two eligible independent application browser groups inside that one owned verification run. The integrated Golden journey, freshness and readiness groups, SQL, cloud canary, and setup or static gates remain exclusive. Every eligible group still owns its data and files. This option does not authorize two separately launched verification commands or a concurrent rebuild.

The [restructure plan](../plans/phase-1/hardening-2026-09/04-testing-system-restructure.md) records host validation and limits of bounded concurrency. File isolation alone is not a measured speedup or proof that the workstation can sustain a higher load.

## Reuse evidence conservatively

Large performance fixtures must finish publishing before measured navigation starts. Completed INSERT responses and network-idle checks do not establish this. The typical profile inserts its final owned time row through `insertFinalFixtureTimeEntry`, after the earlier batches, and waits for that exact transaction on an authenticated Realtime subscription. `fixture-readiness.ndjson` records setup-to-receipt time separately. Failed readiness fails setup; do not add sleeps, disable subscriptions, replay uncertain writes, or exclude delays from measured business mutations. Changing this preparation changes the workload identity and requires reviewed reference calibration.

`scripts/verify.ts` writes `.agent-logs/verification/<id>/report.json` with the selected scope, input snapshot hashes, outcomes, and attributed reused results. Local and cloud target histories remain separate. `lib/testing/group-evidence.ts` records group inputs and determines whether a result remains applicable. Declared source ownership, imported dependencies, test definitions, shared tooling, migrations, and environment identity contribute to the decision. New or unowned executable inputs are treated as shared until their ownership is reviewed. Additions and deletions count as changes.

Convention unit tests inspect repository files directly, so the unit group qualifies the complete executable input snapshot. Harness code under `tests/*/support/`, `lib/testing/` and `scripts/` qualifies only the groups whose specs or support modules import it (`IMPORT_QUALIFIED_PREFIXES` in `lib/testing/group-evidence.ts`); until 2026-09-14 those directories were unowned and therefore global, and a one-function helper repair reran all forty release groups. The reporter that a Playwright config loads by path (`FRAMEWORK_LOADED_HELPERS`) stays a shared input of every group. Shared application code without a feature owner (`hooks/`, `components/ui/`, `lib/data/`) stays global on purpose: every page uses it. Runtime Markdown and MDX remain executable inputs; only repository guidance is excluded from business-proof invalidation.

Three identity rules keep a proof from being discarded by something the group never reaches (pre-Wave-3 step 1, 2026-09-14, Tier 1 by construction with unit tests):

- The snapshot's environment is the proof identity from `lib/testing/proof-environment.ts`. It hashes every application variable with the local stack's private origin replaced by a stable token, so a WSL restart keeps local proofs, while a switch to DEV, another bucket, a rotated key or a new variable invalidates them. The build receipt still hashes the raw file because the client bundle embeds the address. Run manifests record the backend as `local:<project_id>` or the project ref, and cleanup compares that identity.
- Code files are identified by their token stream without comments (`lib/testing/source-content.ts`). A comment or whitespace edit keeps every proof; any token, regular-expression, template or JSX text edit and every line break that automatic semicolon insertion reads still counts. Lint and typecheck always run, so a pragma comment cannot hide.
- Each suite's Playwright config, `tests/ui-contracts/`, `eslint-rules/` and `bunfig.toml` are owned by the kind that executes them (`lib/testing/group-qualification.ts`); `.mcp.json`, `.coderabbit.yaml`, ignore files and Markdown under `tests/` are not inputs. Before this, an MCP configuration edit or the component runner's imports invalidated every browser proof.

A changed repository fingerprint alone does not erase unrelated passing groups. A change to a group's own inputs or a shared dependency does. The latest result for matching inputs must pass. A later failure invalidates an earlier pass for those inputs. Never choose the older green attempt because it is convenient.

Build identity remains separate. `build:test` records application and environment digests, workspace identity, build ID, and completion time. Preflight compares the receipt with current inputs, disk and served build IDs, and server ownership. Stop the server before rebuilding. A normal `bun run build` does not create the private test receipt. All business browser groups use port 3000 and a recorded production server.

Input digests contain no secret values. They do not prove that a schema reset ran or that external provider behavior stayed unchanged. Record migration replay and provider verification as their own evidence.

Canary groups own `tests/canary/support/`. A provider-fixture repair there invalidates canary evidence and any other group that actually imports it, but does not invalidate unrelated browser workflows. Convention units still inspect the full executable snapshot. Helpers outside declared ownership remain shared inputs until their consumers are reviewed; do not weaken unknown-input handling to avoid a rerun.

C3 verifies write-to-display delivery on an established database subscription between two settled sessions. Its setup requires, for both the receiver and the sender, the provider's `postgres_changes` ready marker within five seconds and then Playwright's network-idle state, so each page's readiness catch-up reads have finished before the measured write; socket `SUBSCRIBED` is insufficient. The sender then creates the customer through `createCustomer` with `navigate: false`, because a fresh navigation restarts that page's load burst inside the window. A write made before database readiness can be recovered by the startup read without receiving an INSERT event, which cannot prove established delivery. The before-submit-to-visible deadline remains two seconds. Actual-provider component contracts separately prove initial/reconnect gap recovery and rejection of stale reads; C3 does not claim a two-second cold connection budget or a budget for a save during another session's page load. The [Step 2 plan](../plans/phase-1/hardening-2026-09/06-step-2-whole-app-performance.md#handoff-diagnosis-and-closure-2026-09-13) records the measured reason.

The cloud canary always executes afresh. Unchanged source does not establish that a live provider still works.

## Prepare, submit once, and verify completion

Wait for the actual required controls to become usable. A visible dialog shell alone is insufficient. Measure opening-to-readiness when the contract has a responsiveness requirement. Starting the measurement after loading finished would conceal the delay.

Keep preparation separate from submission. Shared helpers can recover preparation after a proven remount. They must submit the business mutation once. If the response is unclear, inspect the exact saved identity, version, or state before deciding on recovery. Never retry a write merely because a response timed out.

Capture the baseline before the action and wait for the exact changed fact. An existing row, a nonzero count, a success banner alone, or an optimistic echo does not prove the new write committed. Assert visible confirmation and persisted results at their respective boundaries.

Positive interactions must identify the active route, dialog, or record. PPR can retain hidden copies of a page. Scope positive test-ID queries to their semantic owner. Keep privacy checks strict across hidden and visible content. `visibleText()` serves positive text checks. `textInDom()` serves whole-DOM absence checks.

Use semantic accessible roles and names where their wording is part of the requirement. A stable identifier can locate a durable business action while a separate assertion verifies its accessible name. Do not accept a list of vaguely similar button labels or use positional selection to make an ambiguous test pass.

ESLint and convention tests reject raw page-root CSS selectors, ambiguous positive IDs, positional selection, fixed sleeps, skipped or focused tests, per-test timeout overrides, and raw cleanup markers. Existing named helper exceptions have bounded ownership and rationale. Semantic assertion review remains necessary.

## Enforce visible response deadlines

Ordinary `expectLiveWithin` checks use browser timestamps with fixed-interval public-Locator evaluation. `Locator.waitFor` also has increasing retry delays and must not define an appearance measurement. The clock starts before submission; receiver navigation and failed writes remain invalid. Historical failures are not corrected by subtracting estimated polling overhead. The reference review procedure below distinguishes a changed measurement method from a proven unrelated source edit.

The [freshness contract](realtime-and-caching.md) owns product expectations. Cross-session measurements begin before submission in the acting session and end when the receiving session displays the exact new fact; the helper waits for the receiving page's database readiness and network idle and for the acting page's network idle first, because a read or a submit started while that client's Server Actions are queued waits behind them. Do not reload the receiving page to manufacture convergence.

The two-second cross-session target is the contract, judged with the approved combined tolerance (25% or 250 ms, whichever is larger, `lib/testing/responsiveness-tolerance.ts`, applied by the freshness and readiness helpers in `tests/golden/support` and by the evidence check): a sample over the target but inside the tolerance limit (2500 ms) is recorded as over target in the run's evidence and in the verification report and does not fail the group; a sample beyond the limit fails. The owner set this on 2026-09-14 after four release runs failed on single samples between 2030 ms and 2073 ms. The emergency wait bounds observation and preserves useful evidence. It does not redefine acceptable speed. The P1-22 correction-dialog readiness check separately enforces five seconds from opening to usable controls. Browser groups use a 30-second action budget and a 60-second navigation budget, set in the three Playwright configs.

Measured failures bypass preparation retries immediately. A vanished dialog does not permit restarting a failed measurement. `@FRESHNESS` and `@READINESS` identify the measured stages for focused diagnostics; the group registry separately pins required measurements and exclusive scheduling.

Scenario measurements (`expectUsableWithin`, `expectScenarioLiveWithin`) use the IDs in `lib/testing/measured-scenarios.ts` and the reviewed references in `lib/testing/performance-baselines.json`. Each owner must record exactly the registered sample count. Compare the median of the complete current sample set with the reviewed reference median. Every individual sample must still pass correctness and its hard deadline. Missing, duplicate, surplus, obsolete or mixed-build/environment samples invalidate the set. Reports retain every raw sample and identify the aggregate as a median; historical per-sample verdicts remain unchanged. The owner approved this comparison policy on September 12 after an unchanged-build sample varied within its hard deadline. Reference values, measurement boundaries and the combined 25%/250 ms tolerance remain unchanged. A required comparison fails qualification when its reference is missing, incompatible, or exceeded; `lib/testing/performance-references.test.ts` fails the unit group when a required scenario has no reference at the current measurement digest, so an edit to a digest input must recalibrate or mark the scenario `calibrating` in the same change. A `calibrating` scenario still enforces correctness and its hard deadline, but records the missing comparison as `unverified`. Such a run can supply calibration evidence; it does not prove protection against smaller regressions. The [freshness reference](realtime-and-caching.md#measured-scenarios-and-baselines) owns response targets.

The owned run's `latency-summary.json` and the verification report's `measurements` retain correctness, hard-deadline responsiveness, and baseline comparison separately, including failed observations and reused qualified results. Navigation measurements stop at committed usable content before diagnostic resource collection. RSC attribution counts confirmed `text/x-component` responses, not every fetch, and does not claim to measure each server render.

`audit:performance:calendar` and `audit:performance:lists` each seed their own typical organization and run exclusively. Each navigation scenario takes three declared samples in fresh authenticated browser contexts, following the same route sequence. The profile fixes its benchmark date at `2026-06-15` and includes 40 visits on every one of its 44 synthetic dates, including weekends, plus 1,000 customers and 2,500 jobs. Its historical time rows remain constant across execution dates. The cold calendar measurement starts before a fresh navigation to `/kalender?date=2026-06-15`; the real server and client resolve this validated date together. No fake clock or navigation after the measured entry prepares the target range. `performance-workload.json` records the actual dates and row counts. The list checks measure the bounded first page, then separately verify totals, page navigation, global search, and linked selections beyond the initial result window. They do not require thousands of rows to render at once. `sql:list-pagination` owns the transactional operational-list and inventory pagination assertions.

`audit:performance:calendar-live` measures closure creation and removal, and provisional correction submission and withdrawal, with an already-open receiver. Its owned dates are run-day +130 for a closure and run-day -7 for worked time. Future worked-time entries are excluded by the effective-entry projection; a future planning date is not a valid fixture for visible historical work. `expectCalendarChangeWithin` uses direct DOM visibility/detachment waiting and the existing shared observation engine. It proves the required before-state, then requires the exact result and a ready receiver within the unchanged two-second deadline. Removal must detach the matching record; merely hiding it cannot pass. This avoids coarse count-assertion polling near the deadline without moving the start, accepting a missing result or changing baseline scenarios. No receiver navigation or refresh substitutes for live delivery. The calendar profile checks that valid retained content is inert during a held or failed refresh. A failed uncovered-range read instead shows unavailable content with an interactive retry; it cannot claim a ready renderer. These failure-state checks are untimed and do not supply successful calibration samples.

`audit:performance:planning` owns the three planning and role-opening baseline scenarios. It uses a separate base world with fixed June 2026 dates, prepares three jobs with two assigned visits each, then submits one distinct overlapping visit per job through the real confirmation flow. The same open office calendar must show each new visit within two seconds. Three fresh employee contexts then open the assigned visits; three fresh administrator contexts open the legacy-date job, each within five seconds. `planning-benchmark-workload.json` records the fixed preparation counts and declared sequence. These samples come from one owned group, with no replayed mutation or inherited Golden state.

P1-11 retains its original cross-session assertion and both role-specific calendar-opening assertions in standalone and integrated Golden runs. They still enforce two and five seconds respectively and retain timing evidence. They do not emit baseline scenario IDs: the integrated journey inherits different data, and its moving operational dates cannot honestly share the independent benchmark's reference. This separation preserves the business clauses while keeping recurring comparisons stable.

`audit:list-pagination` separately verifies document and inventory pagination with 61 rows per feature in its own organization. Its two tests seed their own prerequisites, then check later pages, global filters, inventory creation and editing, and the document work view's correct linked-job targets. The document fixtures contain metadata only; this group makes no claim about uploads, downloads, or file bytes. It is untimed and does not load the large performance profile. Existing catalog coverage remains owned by its current tests; this boundary group supplements it.

### Review and activate performance references

The eleven registered scenarios use measurement method 3 in `tests/golden/support/browser-observation.ts`. Their measurement digest covers the scenario spec, `tests/golden/support/scenario-measurement.ts`, `browser-observation.ts`, `lib/testing/live-observation.ts` and `tests/audit/support/performance-steps.ts`; the ordinary freshness and readiness helpers in `live.ts` are outside it since 2026-09-14, after five context-only transfers in Step 3 that only ever proved those helpers unchanged. The helper samples the receiving browser's absolute performance clock before dispatching the real action and observes the declared visible/usable DOM predicate on animation frames. It records the first matching browser timestamp, then retains the ordinary Locator correctness assertion and full trace. Assertion polling, trace snapshots and resource diagnostics after detection cannot inflate that timestamp. Failed mutations, missing results, invalid clocks and prohibited receiving-page navigation still fail. Calendar markers, list markers and named calendar-event ordinals are explicit typed targets, not a general replacement for Playwright locators. Hidden content cannot satisfy visibility; ambiguous markers fail. Real isolated browser contracts exercise these boundaries. Ordinary Golden and provider-canary appearance checks use `expectLiveWithin` with `locator-observation.ts`. It samples the receiving browser clock before submission and evaluates the exact public Locator immediately, then at fixed 16 ms intervals. The first visible browser timestamp ends the interval; later assertion and trace work cannot inflate it. Transport can delay a sample, so this remains conservative. Selector strictness, failed saves, receiving-page navigation and every hard deadline remain enforced. Readiness and removal helpers still include their assertion completion time; they are separate measurements, not automatic timings for every server render.

Method 2 records remain historical evidence for their own experiment. Do not subtract estimated tracing overhead to turn an old failed run green, or use those records to calibrate method 3. A method change requires new owned samples and reviewed references, just like a changed workload. A source-only change outside a registered scenario's executed measurement path is different: an explicit equivalence review may transfer its existing samples to the new source checksum. Preserve the original entry, all numeric values and source run/build provenance, and record the old checksum and evidence that the executed path is unchanged. Do not use this procedure when the scenario, its measurement behavior or workload changed.

Use `bun scripts/calibrate-performance.ts --runs <comma-separated-run-keys> --reason "<review basis>"` after successful owned measurements on current inputs. Add `--scenarios <comma-separated-ids>` to select specific scenarios. The command accepts at most three runs and writes a draft under `.agent-logs/performance-calibration/`; it does not change the checked-in baseline or activate comparisons.

The draft requires at least three successful comparable observations per scenario, from cleaned, non-diagnostic runs with current group fingerprints. Each measured owner supplies its three declared samples within one group run. `planning.occurrence.cross-session` uses three distinct benchmark jobs and confirmations, not repeated submission of the same write. Do not change downstream Golden fixture counts to collect samples. Historical failures remain recorded; a repaired candidate supplies its own successful evidence.

Review the retained samples, median reference, environment, and tolerance before copying the candidate entries into `lib/testing/performance-baselines.json` and changing the covered scenarios to `comparison: "required"`. For several owners, create all drafts on the same unchanged inputs and merge the reviewed entries before activation; activating one draft first would invalidate the remaining runs' qualification. Schedule other selected browser acceptance after this measurement-contract change to avoid discarding fresh evidence. Never derive a reference from failed or over-budget results, silently replace an existing compatible reference, or raise a hard deadline to accommodate a slow candidate. Re-run the affected measured owners after activation to prove the required-comparison path on current inputs; do not restart unrelated groups or the release battery.

Compatibility covers scenario and measurement versions, measurement-source identity, actual workload identity, backend provider, role, browser, viewport, host characteristics, and the declared navigation or cache protocol. Application code changes invalidate group qualification but do not themselves invalidate a comparable performance reference. A changed fixture, method, provider, or workload requires explicit review. The typical profile's fixed date, window, and actual row counts are part of its identity: repeat execution preserves compatibility, while a changed benchmark date or size requires deliberate review and calibration.

Local provider identity uses `project_id` from `supabase/config.toml`, after checking the actual local origin. WSL's temporary private address can change without becoming a different database; the proof environment identity applies the same rule. The actual environment/build fingerprint still changes, so a recorded build must match the new routing. Cloud comparison identity keeps the hosted project's origin; switching cloud projects or local stack identities invalidates a reference. Focused tests reject public, spoofed and incorrectly routed local origins.

The checked-in reference validator also guards manual activation: at least three samples, no over-budget sample, reference equal to their median, nonempty build provenance, and unique source run keys including the primary run. The approved comparison tolerance is 25% combined with 250ms; changing the JSON alone cannot widen it. Every runtime baseline load validates these rules, so bypassing the draft command cannot bypass the policy.

Measured groups and retained diagnostics keep their Playwright traces even when browser assertions pass. Baseline validation runs after Playwright exits, so ordinary retain-on-failure would discard the evidence before a below-deadline comparison could fail. Other groups keep failure traces as before. These local archives contain synthetic session data; do not publish raw traces.

Check correctness, responsiveness, and environment validity separately. Correct but too slow is not fully green. A demonstrated invalid environment produces a blocked or failed verification result, not an automatic pass. Run dedicated timing checks without competing workload on this host. Keep the measured start boundary, elapsed time, deadline, and failure visible in the report.

Scenario safety timeouts remain separate: local Golden tests use 180 seconds, local audits 240 seconds, and cloud browser tests 300 seconds. Actions default to 30 seconds and navigation to 60 seconds. These limits stop stuck work. They are not product response targets. Do not increase them to repair a selector or loading regression.

## Retain run evidence

Every browser run keeps its manifest, runner log, latency and workload archives and archived `state/`; they qualify reuse, calibration, diagnostics and cleanup. Traces, HTML reports and the active world copy (`playwright/`, `active/`) are diagnosis material. `bun run test:runs prune` removes them from completed, cleaned runs older than a day that no current proof (the latest result of a group on a target), reviewed baseline or retained world cites; `bun run test:runs prune --plan` only counts. The runner refuses to start a browser run while those directories hold more than 10 GB and names the command (`lib/testing/run-retention.ts`, Tier 2). The archive had reached 25 GB on 2026-09-14 before the first manual prune.

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

If WSL changes its local IP address, ordinary replay and cleanup retain their provenance checks. After recording the observed address change, use `bun run test:runs cleanup-local-relocated <run-key> "<observed local address change>"` for cleanup only. This command requires both origins to be private local Supabase endpoints with the exact local storage bucket and endpoint. It verifies both recorded test organizations by ID, name and owner before deleting anything, and records the new cleanup provenance separately. A partial cleanup can resume only against that verified backend. Historical provenance stays unchanged; this exception cannot authorize replay, cloud cleanup or acceptance.

A retained audit diagnostic must select the recorded audit file. Replay verifies suite, target, backend origin, bucket, storage endpoint, and the original Berlin business date. Diagnostic results explain the failure but never qualify as fresh acceptance results.

An unchanged failed group is blocked from another acceptance attempt unless it qualifies for one bounded environment-recovery retry. The previous failure must be classified as environment-related. A later retained diagnostic must pass on the same candidate and target, then the owned world must be cleaned. The diagnostic explains recovery but does not replace the fresh retry. Two failures on the same inputs remain blocked until their underlying cause is resolved.

A preflight failure that creates no run or world is blocked verification, not a product failure. Repair the environment and rerun the command without manufacturing a mutation or claiming business evidence. Changing grep spelling does not repair a test or product defect. Independent groups may continue where the environment is valid. Repeated unexplained failures must remain blocked; do not create a cycle of complete-suite reruns, timeout increases, or budget extensions.

Windows listener inspection may repeat its read-only command once after `ETIMEDOUT`. Each attempt retains the 20-second host-command bound and kills the timed-out child. The next attempt must supply valid socket and process ownership; a second timeout or any other error fails. This does not retry a browser group or mutation, weaken a freshness deadline, or accept cached ownership. `windows-listener.test.ts` covers recovery and failure limits.

The certification lane (`test:golden`, `test:audit`, `test:canary`, `test:runs campaign-extend` and `campaign-close`, the rerun-grant budget) was retired on 2026-09-14 ([pre-Wave-3 step 2](../plans/phase-1/pre-wave-3/02-code-quality-regression-proofing.md), decision D4 of the testing-system review). Complete evidence comes from `test:verify`; the release breaker below owns the retry budget. Old run manifests keep their campaign and grant fields as history, and `.agent-logs/playwright-campaigns.json` stays untouched.

`bun run test:server local` also opens one Realtime subscription after the build and holds it until the server stops: the local Realtime service drops its tenant database connection after a few idle minutes and rebuilds it on the next subscription, and changes written in the seconds after that cold start reached subscribers 7 to 13 seconds late (incident of 2026-09-15). The warm-up signs in a throwaway confirmed user (channel authorization needs a user JWT), subscribes to a published table with a fresh channel every five seconds until the tenant confirms the database subscription, and deletes the user when the server stops. The tenant is then ready before the first group and cannot go cold between groups; a warm-up that fails within two minutes stops the server with the reason.

Focused iteration runs (`test:golden:focused`, `test:audit:focused`, `test:canary:focused`, each with `--grep`) and retained diagnostics require the same recorded production server as `test:verify`. No business Playwright configuration starts a development server. Missing or stale server evidence stops preflight before fixture creation. Use `test:server` for the selected target before these commands as well. Two focused failures in the same class stop the fresh-world loop; the next step is a retained-world diagnostic.

If the host kills a run, verify that the lock owner and child processes have stopped before recovering ownership. Run `bun run test:runs recover-interrupted <run-key> "<observed interruption>"`. Recovery records interrupted ownership before archival work, validates identities, and preserves original outcomes and cost. Missing state remains an unresolved recovery failure. No command steals a live lock.

Transport diagnostics emit `[test-fetch-rejected]` with the HTTP method, origin, and allowlisted error codes. They exclude request contents and credentials and do not retry the fetch. Read captured test stderr and redact artifacts before sharing them. A rejected connection is evidence of a failed boundary, not proof of a specific operating-system cause.

### After a failed run

The system evolves on its own use through three rules. The verifier enforces the first two (`lib/testing/release-breaker.ts`, Tier 2); `docs:check` enforces the third.

1. After a failed release run, the next action is a focused run of every failed group: `bun run test:verify --group <ids>`. `bun run test:plan --mode release` prints the refusal with the exact command, and `test:verify --mode release` stops before taking the lock until each failed group has a later passing result on the current inputs. With content-based reuse the release run then reruns only what changed, so the focused run costs minutes and a repeated full run saves nothing. A blocked group (never executed) is not owed a focused run.
2. After two consecutive failed release runs, write the diagnosis and a harness hypothesis into the [incident log](test-incident-log.md) naming the latest failed report id before running anything.
3. Every incident entry ends in a Tier 1 or Tier 2 change, a Tier 3 with its reason, or the statement that no prevention claim follows (`scripts/check-docs.ts`, check 12).

After every failed run, ask whether the way you test makes sense before you rerun. The Step 3 campaign needed eleven full runs because each repair was proven by the next full run; the [review](../plans/phase-1/pre-wave-3/01-testing-system-review.md) holds the account.

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
| Socket joined but another user's saved change never arrives | Inspect both channel join and database-listener readiness. The provider owns catch-up on the later `postgres_changes` system-ready signal; `SUBSCRIBED` alone cannot cover writes in the gap. Exercise the actual provider and consumer with that ordering. Keep the original submission clock. See [the freshness contract](realtime-and-caching.md#client-freshness-contract). |
| Long eventual-visibility wait (`toBeVisible({ timeout: 20_000 })`) around a navigation, view switch, or another session's change | Replace it with a registered scenario: `expectUsableWithin` ending on a client-committed marker (`data-calendar-state`, `data-usable-content`) or `expectScenarioLiveWithin` with the helper's `beforeSubmit` boundary. Register the id, boundary, budget, and file in `lib/testing/measured-scenarios.ts`; the assertion keeps its business meaning and gains a budget and a baseline comparison. |
| Scenario record refused (unknown id, obsolete version, widened budget, surplus sample) | Reconcile the spec with `lib/testing/measured-scenarios.ts`. Bump the scenario version when the measured boundary changes; never widen the registered budget to make a slow run qualify. |
| Missing or incompatible performance reference | Inspect the archived workload, method, role, provider, browser, host, and cache protocol. Restore the intended experiment or review a new bounded calibration. Keep the comparison unverified until a compatible reference exists; an eventual successful render cannot resolve this state. |
| First-page assertion expects every row after pagination | Assert the bounded rendered page and truthful total. Preserve global search, later-page access, selected-entity hydration, and permissions through the owning browser and SQL checks. Do not remove the underlying catalog clause or preload the entire organization to satisfy an obsolete assertion. |
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

`bun run test:ui` mounts real components in Chromium without Next.js, Supabase, or a test company. Use explicit service-boundary fixtures. Add an independent large component through its own fixture selection. The command records its inputs, arguments, result, and browser report under `.agent-logs/ui-contracts/`. The runner also compiles `app/globals.css` with the Tailwind engine and passes the stylesheet path as `WERKFLOW_UI_CONTRACT_CSS`; a spec that asserts rendered geometry (clipping, touch targets, selection colors) adds it with `page.addStyleTag` in its mount helper, as `clock-readiness.spec.ts` does. Specs that assert semantics only stay unstyled, so visibility checks keep their meaning.

A SQL group (`bun run test:verify --group sql:p1-21`) executes its registered files in `supabase/tests/` through `scripts/run-sql-assertions.ts`. The wrapper streams SQL into the local database with `ON_ERROR_STOP=1`. Each file owns a transaction and ends with rollback. These are SQL exception assertions, not pgTAP files. Add new SQL files to the group registry when introducing another protected domain; the registry is the only list of a group's files.

The performance audit in `tests/audit/performance/calendar.spec.ts` owns the measured navigation and view-switch scenarios against the typical data profile: 10 employee records, 40 occurrences on every day of the 44-day month-grid window, four time entries per member and past workday, 1,000 customers, and 2,500 jobs, inserted with the admin client into the group's own organization and deleted with it. It proves budgets and baseline comparisons, not business workflows; the seeded rows never pre-complete an operation a scenario claims to prove.

The layout audit in `tests/audit/layout/mobile-viewport.spec.ts` owns page overflow, shell scrolling, native-control bans, and form geometry. `lib/testing/mobile-route-inventory.ts` declares the static pages, dynamic detail patterns, and redirects; its unit check compares that inventory with every authenticated `page.tsx`. Add an executable case or tested redirect when a route ships. Detail fixtures belong to the audit's disposable organization and do not claim creation-workflow coverage. Measurements wait for loaded page content and attach screenshots. Route coverage does not establish every role, tab, dialog, or data-state combination. Maintenance and period audits also attach representative images. Inspect images before claiming visual fidelity; a passing business assertion does not establish it.

Backend IDs, local setup, storage routing, and machine onboarding live in [environments.md](environments.md). Production is excluded from test routing. Testing policy does not authorize a commit, push, production deployment, or a schema change.

When changing integrated Golden producers or fixture dates, read [integrated-test-state.md](integrated-test-state.md). Independent groups do not inherit unrelated fixture history.
