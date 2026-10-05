# 0007: Independent test groups and behavior coverage

- **Status:** accepted (2026-09-06) — the 2026-10-01 amendment supersedes the selection, qualification, retry, and campaign-gate rules for browser groups; the 2026-10-02 amendment removes the slice budget and the chained tests
- **Date:** 2026-09-06
- **Owner:** Product owner, approved in the testing-system redesign task
- **Affects:** Test allocation, slice acceptance, release verification, failure recovery, and the three enforcement tiers
- **Supersedes:** The execution and acceptance policy in [decision 0006](0006-testing-architecture.md). The local application backend and cloud-canary separation remain.

## Reason for the change

Requiring complete accumulated browser batteries after every slice made unrelated failures repeatedly block feature delivery. Shared working files and implicit fixture dependencies also prevented independent execution. A global candidate change invalidated useful evidence without determining whether its tested behavior could change.

The preceding hardening review fixed concrete defects but did not resolve those structural costs. Its qualified closure remains historical evidence, not a new acceptance standard.

## Decision

Preserve every supported flow and observable clause in the [user-flow catalog](../product/user-flow-catalog.md). Allocate each assertion to the least expensive layer that proves the real contract: domain code, database, component browser, application browser, or live-provider check. Keep multiple layers when they prove different boundaries. Remove duplicate browser execution only after identifying the retained evidence.

`lib/testing/selection/coverage-map.json` owns the mapping from flows to evidence. Its validator checks catalog identities and hashes, reference validity, and executable group ownership. A reviewer checks that the assertions prove the complete behavior. A title, file reference, or copied catalog identifier is insufficient.

`lib/testing/selection/test-groups.ts` owns executable groups, source scopes, producer prerequisites, and isolation requirements. Each application browser group owns its disposable data, role sessions, checkpoints, and output files. Separate groups do not inherit mutable state. New and rewritten scenarios prepare their own prerequisites. A connected business journey stays inside one test with steps. Legacy ordered stages and producer preconditions remain migration debt until their setup is replaced.

Normal change acceptance uses the complete selected change plan. Until 2026-10-01, selection combined domain relationships, imported code dependencies, shared inputs, and test definitions, and unknown ownership selected broadly. The 2026-10-01 amendment replaced that rule with declared scopes and a small core set.

Release and wave acceptance use all local audit and independent Golden groups, domain and mechanism units, component browser checks, SQL checks, static checks, and the cloud canary. The September 30 amendment below removed the former integrated Golden journey. Full cloud application batteries are no longer routine wave gates. Additional provider-specific cloud checks require a named risk and scope.

## Evidence qualification

Each result records the selected group, relevant input fingerprint, environment identity, execution times, result, and underlying run evidence. Input additions and deletions count. A group remains reusable only when its fingerprint inputs match. A later failure for those inputs invalidates an earlier pass. Since 2026-10-01 a browser group's fingerprint covers its test code, the dependency manifests, and the environment, not product code.

Independent passing groups may accumulate across separate executions on qualifying inputs. Keep a connected business transaction inside one test with named steps; do not depend on another file's mutations. Diagnostic reuse of a failed world's records cannot qualify as fresh acceptance proof.

The default change plan and the complete release plan define their scopes. Explicit `--group` selection proves only the named subset. It must not be presented as a complete automatic plan or release acceptance. The reviewed bounded follow-up of 2026-09-30 was removed on 2026-10-01. The practical commands and evidence paths live in [testing.md](../technical/testing.md).

Application build identity remains independently verified. A test-input change need not force a new app build. An application or backend-environment change must not use a stale build. Digests identify inputs without storing secrets; they do not replace migration-replay evidence or provider checks.

Amendment 2026-09-14 (pre-Wave-3 step 1): the environment identity of a proof is the backend identity, with the local stack's private address replaced by a token, so a WSL restart is not an environment change; the build receipt keeps the raw digest. Code inputs are compared by their comment-free token stream. Tooling no test executes is not an input, and each suite's configuration is owned by the kind that loads it. A release plan after a failed release report requires a later passing result for every failed group on the current inputs, and a third consecutive release attempt requires a written diagnosis in the incident log. Mechanisms and evidence: [testing.md](../technical/testing.md).

Amendment 2026-09-18 (pre-Wave-3 step 5): the environment-recovery retry compares the retained diagnostic with the failed run by the served build id and the target, no longer by the repository-wide candidate hash. The build id already proves the application unchanged (the preflight refuses a server whose receipt no longer matches), and the retry check proves the group's own inputs unchanged; the candidate hash also changed on a harness edit outside the group, which made a correct diagnostic stop counting after such an edit. Mechanism: `lib/testing/runner/group-recovery.ts`.

## Failure and responsiveness rules

A failed group retains its evidence and owned world. Unrelated groups continue where the environment is valid. A test that depends on a failed producer fails at once on its chained precondition; the rest of its file still runs, so one run shows every failure the file holds (amendment of 2026-09-25). Setup and teardown must never sweep unrelated groups' records.

An unchanged failed group cannot be retried as acceptance until its cause is addressed. Since 2026-10-01, unchanged means that no source file changed since the failure. One environment-recovery retry is allowed after classification, a later matching retained diagnostic pass on the same served build and target (amendment 2026-09-18), and owned-world cleanup. Two same-input failures remain blocked. Amendment 2026-10-03: a static, unit, SQL or component group has no browser run, so its environment failure is recovered by a recorded diagnosis of the attempt under the same limits; a reference update run is no attempt and certifies nothing. A preflight failure with no run or world is blocked verification and can be retried after environment repair without fabricating business evidence. Investigate the smallest relevant failure, classify it from evidence, add prevention, and rerun the affected group. Unexplained repetition stays blocked. Do not manufacture progress through complete-battery reruns, timeout increases, or repeated budget extensions. Preserve cumulative campaign cost and historical failures.

Correctness, responsiveness, and environment validity are separate conclusions. The cross-session two-second target is an enforced acceptance deadline. Eventual visibility inside a longer emergency wait is not sufficient. Amendment 2026-09-14: a single sample over the target but inside the approved combined tolerance (25% or 250 ms) is recorded, not failed; beyond it the group fails. Harness helpers qualify groups through real imports, and a recorded pass stays valid while every current input of the group is unchanged in content (see [testing.md](../technical/testing.md)). Readiness checks start when the user opens the relevant UI, before loading completes. A demonstrated invalid environment prevents acceptance rather than converting a slow result to green.

Retained diagnostics and cleanup validate exact backend and world ownership. Resolve retained worlds before release closure. A missing archive is unresolved ownership, not successful cleanup.

## Three-tier ownership

- Tier 1 prevents shared-state collisions and repeated writes through owned data and shared APIs.
- Tier 2 enforces coverage identity, selected prerequisites, input-qualified results, selector conventions, locks, and deadlines.
- Tier 3 reviews assertion meaning, impact ownership, visual evidence, and cause classification. Automate these judgments only when the mechanism can prove the claim.

The [enforcement ladder](0005-enforcement-ladder.md) remains the governing principle. Agent guidance routes to one current testing entry rather than repeating an entire acceptance ladder in every skill.

## Host and rollout limits

No new Linux machine or test infrastructure is part of this decision. The verification command holds the shared workspace lock for its whole run; two verification commands never overlap. Concurrency inside one run is governed by the amendment below.

The implementation plan owned the 2026-09 rollout. Acceptance of this policy is not a claim of a fixed speedup, a zero-flake guarantee, a security certification or a production release.

## Amendment 2026-09-25: the execution model

The P1-24a campaign (2026-09-23 to 2026-09-24) cost fourteen hours of verification and thirty-five browser failures for six product defects, with the account in the incident log. The cost came from the execution model, which no earlier repair had touched: every group repeated the preflight, two Playwright discoveries and two archive scans (about a minute per group); two support monoliths of nine thousand lines made every helper edit rerun every browser group; every spec ran in serial mode and revealed one failure per run; per-user preferences persisted between the tests of a file; and a lagging local Realtime service was diagnosed after the fact, never before a measurement. The owner ruled that the model changes, not the guidance.

Decided, implemented the same day:

- The shared work of a browser run happens once per verification run and reaches every group through a prepared plan; a group runner starts Playwright directly. Blocking narrows to a failed static gate, an input drift or an interruption.
- Independent browser groups may run on N workers (`--jobs`, default 1); groups with freshness, readiness or measured scenarios always run alone. The default follows the workstation measurement of 2026-09-25 (two workers on six golden groups: 11 percent faster, each overlapping group about 70 percent slower on the one shared server; three workers on five groups: about 20 percent). The measurement, not the option, is what a future machine changes.
- Browser support is split into domain modules under `tests/golden/support/steps/` and `db/`; a helper edit reruns the groups of its area.
- Specs run their tests in file order and continue after a failure; a dependent test guards its producer with a chained precondition and fails fast. Serial mode and `maxFailures` are gone; a convention test refuses serial short-circuiting in a spec (the broader configure ban was removed on 2026-09-28) and the browser-server contract test pins one worker, no retries and no failure cap in the configs.
- Every test starts without persisted per-user UI preferences (an automatic fixture), and the calendar saves a discrete preference at once.
- A Realtime readiness probe runs before every timing-sensitive group and restarts the service once when it lags.
- Every verification run and `bun run test:campaign` report the campaign's cost since the last commit against a budget of 240 minutes or eight harness failures; past the budget, the slice does not close until the harness changed as a mechanism ([protocol](../plans/phase-1/protocol.md#campaign-budget)).

Mechanisms and commands: [testing.md](../technical/testing.md).

## Alternatives considered

A complete rewrite would discard useful business assertions and incident knowledge without proving a better allocation. Preserve those assets while replacing their execution and acceptance rules.

Replacing routine scripted runs with an agent clicking every workflow would add variable interpretation and model cost. Keep scripts for repeated checks and use agent exploration for discovery or focused investigation.

Keeping all browser checks sequential in one world preserves accidental dependencies and makes one failure block unrelated evidence. Keep ordered execution only where the business journey requires it.

## Amendment 2026-09-25: relevant campaign repairs and complete report ownership

The owner requested repair of the two runner defects and the campaign gate policy after the post-P1-24a review. A campaign still stops after two non-product browser attempts. The repair now belongs to each unresolved group: a changed reachable test/runner input or the existing qualified retained environment recovery, not an arbitrary edit anywhere in a broad directory. Spec repairs count. A later failure requires a new repair. Historical failures and elapsed cost remain recorded, and group retry guards remain independent.

Every post-publication setup and execution path now shares terminal report ownership, including failure before a browser manifest exists. Such missing observations remain blocked verification, not fabricated failed business tests. The timing registry explicitly owns Plantafel freshness, and AST inspection recognizes imported timing-call aliases and namespace calls. Exact behavior and limits live in [testing.md](../technical/testing.md); repair evidence lives in the [incident log](../technical/test-incident-log.md).


## Amendment 2026-09-30: risk selection and one world per group

The owner authorized replacing costly testing assumptions before Wave 3. Selection now distinguishes application risk, spec execution dependencies, orchestration pilots and shared visual checks. Qualification remains content- and environment-based; selecting less does not relax the validity of reused evidence. The 2026-10-01 amendment replaced these categories. The current table lives in [testing.md](../technical/testing.md#how-selection-works).

Release uses the same independent Golden groups as change verification. The integrated Golden group is removed. An audit process owns one file and one world until the parent qualifies it; multi-file work goes through the verifier. The audit fixture no longer deletes and replaces worlds between files. Browser preparation starts only after earlier static gates pass. Fresh pilots are mandatory when the registered orchestration changes, even if their earlier product evidence is reusable.

Legacy within-file scenario dependencies are not approved patterns. Preserve their assertions while replacing setup with owned fixtures or a single connected business transaction. Removing annotations alone is not migration. Full catalog coverage remains required, but two historical browser journeys are not required when one cheaper boundary proves the same invariant.

## Amendment 2026-10-01: browser tests are a sanity check

The owner decided this on 2026-10-01 and authorized the change to the testing rules and to this record.

Measured before the change: 69 percent of product files were inputs of all 54 browser groups, because a group's fingerprint included the import closure of every shared file that no group owned. 261 of 677 single-file edits selected all 54 groups. About 74 percent of the browser results that did not pass were harness, environment, or timing failures, not product defects.

Decided:

- Browser tests are a rough check that the catalog's user flows and the golden journeys work. They are not a proof for every import edge.
- A browser group's fingerprint covers its spec, the test support the spec imports, the runner files for the two pilots, `package.json`, `bun.lock`, and the environment digest. Product code, migrations, generated types, and `app/globals.css` are no longer fingerprint inputs of browser groups. Unit, component, SQL, and static groups keep their input rules.
- In change mode a changed product file selects the browser groups whose declared scope owns its folder. A product file that no scope owns selects a small core set from one table: `golden:gg-00`, plus `audit:layout` for shared controls and tokens, plus `audit:security:account` for the authentication boundary. A selected group needs a pass that ran on the current content of the files that selected it.
- When a browser group failed or was blocked, the next change plan selects exactly those groups and the cheap gates. When they pass, the repair is verified. Other groups that share the changed code do not run again. A failed group may run again after any source change.
- Release mode still runs every group. It is the gate for a wave end and a production release. The `audit:performance:*` groups and all latency deadlines run and fail in release mode only. In change mode the runner records timing verdicts without failing the group. Deadlines measured on the development laptop do not block ordinary change verification.
- One gate precedes publication: the tracked `pre-push` hook requires a passing automatic verification report and a completed CodeRabbit review on the pushed tree. The owner can override with a logged reason.

Superseded: the rule that unknown or deleted inputs select every group, the import-graph qualification of browser groups from the 2026-09-14 and 2026-09-30 amendments, the reviewed bounded follow-up of 2026-09-30, the retry block on unchanged group fingerprints for browser groups, and the campaign gate of 2026-09-25 that refused execution until a relevant harness file changed. The campaign line stays as information. The slice budget in the [protocol](../plans/phase-1/protocol.md#campaign-budget) remains a closure rule and no longer blocks a run.

Known limit, accepted by the owner: a change can break a feature whose scope does not own the changed folder, and a repair can affect groups that are not rerun. Release mode is where those defects surface. Rules and commands: [testing.md](../technical/testing.md).

## Amendment 2026-10-02: no slice budget and no chained tests

This amendment corrects two statements above. It records changes that already landed.

- **The slice budget is gone.** The owner revoked the 240-minute and eight-failure bounds on 2026-10-01 ([protocol](../plans/phase-1/protocol.md#campaign-budget)). The last bullet of the 2026-09-25 execution model and the last sentence of the "Superseded" paragraph of the 2026-10-01 amendment still call the slice budget a closure rule. That rule no longer exists. The campaign line reports cost. It never blocks a run and never holds a slice open.
- **No test depends on another test.** The legacy within-file chains, their producer metadata and their chained preconditions are removed. `lib/testing/spec-support/spec-independence.ts`, run by `lib/testing/spec-support/spec-conventions.test.ts`, rejects a declared producer, a chained value, a checkpoint handoff, module state that one test writes and another reads, and a wall-clock date read at module load. The two measured performance specs keep their seeded-profile handoff, because their files are measurement-digest inputs. The [enforcement-ladder backlog](../technical/enforcement-ladder-backlog.md) tracks that exception.
