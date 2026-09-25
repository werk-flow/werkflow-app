# 0007: Independent test groups and behavior coverage

- **Status:** accepted (2026-09-06)
- **Date:** 2026-09-06
- **Owner:** Product owner, approved in the testing-system redesign task
- **Affects:** Test allocation, slice acceptance, release verification, failure recovery, and the three enforcement tiers
- **Supersedes:** The execution and acceptance policy in [decision 0006](0006-testing-architecture.md). The local application backend and cloud-canary separation remain.

## Reason for the change

Requiring complete accumulated browser batteries after every slice made unrelated failures repeatedly block feature delivery. Shared working files and implicit fixture dependencies also prevented independent execution. A global candidate change invalidated useful evidence without determining whether its tested behavior could change.

The preceding hardening review fixed concrete defects but did not resolve those structural costs. Its [qualified closure](../plans/phase-1/hardening-2026-09/03-uiux-and-test-reliability.md) remains historical evidence, not a new acceptance standard.

## Decision

Preserve every supported flow and observable clause in the [user-flow catalog](../product/user-flow-catalog.md). Allocate each assertion to the least expensive layer that proves the real contract: domain code, database, component browser, application browser, or live-provider check. Keep multiple layers when they prove different boundaries. Remove duplicate browser execution only after identifying the retained evidence.

`lib/testing/coverage-map.json` owns the mapping from flows to evidence. Its validator checks catalog identities and hashes, reference validity, and executable group ownership. A reviewer checks that the assertions prove the complete behavior. A title, file reference, or copied catalog identifier is insufficient.

`lib/testing/test-groups.ts` owns executable groups, source scopes, producer prerequisites, and isolation requirements. Each application browser group owns its disposable data, role sessions, checkpoints, and output files. Separate groups do not inherit mutable state. A genuinely connected business journey retains ordered stages and verifies its producer preconditions.

Normal change acceptance uses the complete selected change plan. Selection combines explicit domain relationships, imported code dependencies, shared inputs, and test definitions. Unknown executable ownership selects broadly. Selection must not assume a directory name proves independence.

Release and wave acceptance use all local audit groups, the integrated Golden journey, domain and mechanism units, component browser checks, SQL checks, static checks, and the cloud canary. They do not repeat separate Golden groups already included in the integrated journey. Full cloud application batteries are no longer routine wave gates. Additional provider-specific cloud checks require a named risk and scope.

## Evidence qualification

Each result records the selected group, relevant input fingerprint, environment identity, execution times, result, and underlying run evidence. Input additions and deletions count. A group remains reusable only when its own and shared inputs match. A later failure for those inputs invalidates an earlier pass.

Independent passing groups may accumulate across separate executions on qualifying inputs. This does not waive a connected journey's ordering. The integrated Golden journey must pass from beginning to end in one owned world. Diagnostic reuse of a failed world's records cannot qualify as fresh acceptance proof.

The default change plan and the complete release plan define their scopes. Explicit `--group` selection proves only the named subset. It must not be presented as full change or release acceptance. The practical commands and evidence paths live in [testing.md](../technical/testing.md).

Application build identity remains independently verified. A test-input change need not force a new app build. An application or backend-environment change must not use a stale build. Digests identify inputs without storing secrets; they do not replace migration-replay evidence or provider checks.

Amendment 2026-09-14 (pre-Wave-3 step 1): the environment identity of a proof is the backend identity, with the local stack's private address replaced by a token, so a WSL restart is not an environment change; the build receipt keeps the raw digest. Code inputs are compared by their comment-free token stream. Tooling no test executes is not an input, and each suite's configuration is owned by the kind that loads it. A release plan after a failed release report requires a later passing result for every failed group on the current inputs, and a third consecutive release attempt requires a written diagnosis in the incident log. Mechanisms and evidence: [testing.md](../technical/testing.md).

Amendment 2026-09-18 (pre-Wave-3 step 5): the environment-recovery retry compares the retained diagnostic with the failed run by the served build id and the target, no longer by the repository-wide candidate hash. The build id already proves the application unchanged (the preflight refuses a server whose receipt no longer matches), and the retry check proves the group's own inputs unchanged; the candidate hash also changed on a harness edit outside the group, which made a correct diagnostic stop counting after such an edit. Mechanism: `lib/testing/group-recovery.ts`.

## Failure and responsiveness rules

A failed group retains its evidence and owned world. Unrelated groups continue where the environment is valid. A test that depends on a failed producer fails at once on its chained precondition; the rest of its file still runs, so one run shows every failure the file holds (amendment of 2026-09-25). Setup and teardown must never sweep unrelated groups' records.

An unchanged failed group cannot be retried as acceptance until its cause is addressed. One environment-recovery retry is allowed after classification, a later matching retained diagnostic pass on the same candidate and target, and owned-world cleanup. Two same-input failures remain blocked. A preflight failure with no run or world is blocked verification and can be retried after environment repair without fabricating business evidence. Investigate the smallest relevant failure, classify it from evidence, add prevention, and rerun the affected group. Unexplained repetition stays blocked. Do not manufacture progress through complete-battery reruns, timeout increases, or repeated budget extensions. Preserve cumulative campaign cost and historical failures.

Correctness, responsiveness, and environment validity are separate conclusions. The cross-session two-second target is an enforced acceptance deadline. Eventual visibility inside a longer emergency wait is not sufficient. Amendment 2026-09-14: a single sample over the target but inside the approved combined tolerance (25% or 250 ms) is recorded, not failed; beyond it the group fails. Harness helpers qualify groups through real imports, and a recorded pass stays valid while every current input of the group is unchanged in content (see [testing.md](../technical/testing.md)). Readiness checks start when the user opens the relevant UI, before loading completes. A demonstrated invalid environment prevents acceptance rather than converting a slow result to green.

Retained diagnostics and cleanup validate exact backend and world ownership. Resolve retained worlds before release closure. A missing archive is unresolved ownership, not successful cleanup.

## Three-tier ownership

- Tier 1 prevents shared-state collisions and repeated writes through owned data and shared APIs.
- Tier 2 enforces coverage identity, selected prerequisites, input-qualified results, selector conventions, locks, and deadlines.
- Tier 3 reviews assertion meaning, impact ownership, visual evidence, and cause classification. Automate these judgments only when the mechanism can prove the claim.

The [enforcement ladder](0005-enforcement-ladder.md) remains the governing principle. Agent guidance routes to one current testing entry rather than repeating an entire acceptance ladder in every skill.

## Host and rollout limits

No new Linux machine or test infrastructure is part of this decision. The verification command holds the shared workspace lock for its whole run; two verification commands never overlap. Concurrency inside one run is governed by the amendment below.

The [implementation plan](../plans/phase-1/hardening-2026-09/04-testing-system-restructure.md) owned the 2026-09 rollout. Acceptance of this policy is not a claim of a fixed speedup, a zero-flake guarantee, a security certification or a production release.

## Amendment 2026-09-25: the execution model

The P1-24a campaign (2026-09-23 to 2026-09-24) cost fourteen hours of verification and thirty-five browser failures for six product defects, with the account in the [incident log](../technical/test-incident-log.md#2026-09-24-p1-24a-full-change-plan-three-attempts). The cost came from the execution model, which no earlier repair had touched: every group repeated the preflight, two Playwright discoveries and two archive scans (about a minute per group); two support monoliths of nine thousand lines made every helper edit rerun every browser group; every spec ran in serial mode and revealed one failure per run; per-user preferences persisted between the tests of a file; and a lagging local Realtime service was diagnosed after the fact, never before a measurement. The owner ruled that the model changes, not the guidance.

Decided, implemented the same day:

- The shared work of a browser run happens once per verification run and reaches every group through a prepared plan; a group runner starts Playwright directly. Blocking narrows to a failed static gate, an input drift or an interruption.
- Independent browser groups may run on N workers (`--jobs`, default 1); groups with freshness, readiness or measured scenarios always run alone. The default follows the workstation measurement of 2026-09-25 (two workers: 11 percent faster, each overlapping group about 70 percent slower on the one shared server; three workers: about 20 percent). The measurement, not the option, is what a future machine changes.
- Browser support is split into domain modules under `tests/golden/support/steps/` and `db/`; a helper edit reruns the groups of its area.
- Specs run their tests in file order and continue after a failure; a dependent test guards its producer with a chained precondition and fails fast. Serial mode and `maxFailures` are gone and a convention test refuses them.
- Every test starts without persisted per-user UI preferences (an automatic fixture), and the calendar saves a discrete preference at once.
- A Realtime readiness probe runs before every timing-sensitive group and restarts the service once when it lags.
- Every verification run and `bun run test:campaign` report the campaign's cost since the last commit against a budget of 240 minutes or eight harness failures; past the budget, the slice does not close until the harness changed as a mechanism ([protocol](../plans/phase-1/protocol.md#campaign-budget)).

Mechanisms and commands: [testing.md](../technical/testing.md).

## Alternatives considered

A complete rewrite would discard useful business assertions and incident knowledge without proving a better allocation. Preserve those assets while replacing their execution and acceptance rules.

Replacing routine scripted runs with an agent clicking every workflow would add variable interpretation and model cost. Keep scripts for repeated checks and use agent exploration for discovery or focused investigation.

Keeping all browser checks sequential in one world preserves accidental dependencies and makes one failure block unrelated evidence. Keep ordered execution only where the business journey requires it.
