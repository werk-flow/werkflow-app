# Browser-Test Incident Log

Status: living — last reviewed 2026-08-27

This is the durable record for browser failures that consume a full-run retry or expose a reusable product, harness or environment lesson. Raw artifacts stay gitignored under `.agent-logs/playwright-runs/<run-key>/`; this log keeps the small explanation future work needs.

## Required incident record

Record each failed certification and any focused failure that changes shared harness behavior:

| Field | Required content |
| --- | --- |
| Run | Run key, suite/tag, source fingerprint and retained world ID |
| Classification | `product`, `harness`, `environment`, or `transient` |
| Failure point | Spec/stage and first failing assertion or runner error |
| Evidence | `error-context.md`, screenshot, trace, server/edge log or read-only database fact actually inspected |
| Root cause | The smallest explanation supported by that evidence |
| Correction | Product, harness or environment change made |
| Focused proof | Later focused run key on the current source fingerprint |
| Prevention | Enforced check, shared helper, spec boundary or documented rule that prevents recurrence — with its enforcement-ladder tier ([decision 0005](../decisions/0005-enforcement-ladder.md)); a Tier-3 prose-only prevention states why Tier 1 and 2 are unreachable |
| Cleanup | Retained-world cleanup result and whether another full certification is authorized |

The run manifest receives the classification, cause and prevention through `bun run test:runs classify`. Add the concise durable entry here before closing the slice. Do not call an unexplained retry a transient.

## P1-16 retrospective

P1-16 predates automatic run archives. Some failed-run IDs and worlds were overwritten by later Playwright output; that missing provenance is itself the reason this hardening exists.

| Incident | Classification | What the evidence established | Durable prevention |
| --- | --- | --- | --- |
| Upload metadata flow in retained worlds `mt7lor74` and `mt7m00ap` | Product plus harness | Completed R2 uploads could be lost during the metadata step, while an unscoped close locator made the failure harder to read. | The product retains completed uploads through metadata recovery; the shared upload step scopes dialog actions; failed runs now preserve the exact trace and world. |
| Assignment mutation committed but the following employee surface remained stale | Harness | The database state was correct; the next role assertion used a page that had not reloaded the authoritative assignment state. | Persisted assignment checks use reload or a new session, and every role session is refreshed and protected-route checked during setup. |
| Full Golden reached 102/103, then the outsider session redirected to login | Harness | The product boundary was not the failing fact; the saved long-run role session had become unusable. The failed world was not preserved. | All four role sessions are refreshed in setup, bound to the expected organization, checked on `/auftraege`, and refreshed again when stored state is old or mismatched. P1-16 role boundaries are an independently greppable final stage. |
| Artifact mutation returned `not_authenticated` after typed input | Environment | The authenticated server action lost usable session context; the UI correctly retained input and no write was accepted. | Diagnose from archived session and trace evidence, refresh role state before a diagnostic retry, and keep mutation recovery separate from acceptance. |
| Repeated progress polling during long batteries | Process | Intermediate counters did not help diagnosis and consumed interaction budget. | The repository runner redirects verbose output to the run archive and emits only start, final status and the first failure. |

## Hardening validation incidents

| Run | Classification and failure | Evidence and correction | Focused proof and cleanup |
| --- | --- | --- | --- |
| `2026-08-25T132115667Z-1126a8`, full Golden, fingerprint `eba3b1f…fa63`, world `mt8p1are` | Harness; 104/105 passed before the outsider boundary reopened an invalidated refresh token and reached `/login`. | The protected-route verifier had allowed middleware to rotate the token without saving the resulting cookies. It now persists the verified state, checks the expected organization and auth cookie, and the terminal P1-16 stage can resume on the retained world. | Exact retained boundary `2026-08-25T140406147Z-581bcc` passed 1/1. The world was cleaned at 14:05 local time. |
| `2026-08-25T141800664Z-a73a6c`, full Golden, fingerprint `a5fdae16…0369`, world `mt8r2a7p` | Harness; 104/105 passed before the outsider state failed again and concurrent reporter/teardown manifest writes hit Windows `EPERM`. | Every role fixture now persists its final cookies. Manifest read-modify-write is serialized across processes, JSON replacement retries bounded Windows access denial, and a four-process unit stress test proves 200 lossless updates. | Exact retained boundary `2026-08-25T150446013Z-dbd992` passed 1/1. The world was cleaned at 15:05 local time. |
| `2026-08-25T150839172Z-0adfdf`, focused P1-16, fingerprint `38a79ac3…1722`, world `mt8sven4` | Harness; the setup stage saved the site, but a generic post-save reload landed on Dashboard and replaced the useful projection assertion with an unrelated locator failure. | The trace and a read-only DEV query proved the site row existed. The shared helper now stays on the original route and waits within the documented 30-second Realtime projection envelope. | Current-source focused run `2026-08-25T152101638Z-6c79a5` passed 3/3. The failed world was cleaned at 15:17 local time. |
| `2026-08-25T155752315Z-7d29aa`, full Golden, fingerprint `0de71a08…cfeb`, world `mt8umqs7` | Environment; 92/105 passed before the P1-12 dispatch panel remained loading. | The trace showed the expected calendar row while the archived server log recorded outbound HTTPS connect timeouts, resets and failed fetches to DEV Supabase/Cloudflare. The later login and app failures were dependent fallout. Every lane now checks DEV Supabase directly before browser launch, and both configs stop at the first failure. | After connectivity recovered, retained diagnostics reached the original row and exposed the replay gaps below. Final diagnostic `2026-08-25T170339000Z-8f8a1a` passed 1/1; world cleanup succeeded. |
| `2026-08-25T165459626Z-04ef63`, `2026-08-25T165839309Z-d679c0` and `2026-08-25T170106053Z-de6727`, retained P1-12 terminal diagnostics, world `mt8umqs7` | Harness; the late test depended on an earlier module-local time baseline, then reused a dispatch precondition mutated by the first replay; the first replacement fixture was an internal occurrence that the dispatch panel correctly excludes. | Read-only DEV queries separated persisted facts from UI assumptions. The terminal stage now creates a unique assigned job visit from the diagnostic run key and proves zero actual time directly for all four P1-12 jobs. It no longer depends on earlier process memory or a previous replay's mutations. | `2026-08-25T170339000Z-8f8a1a` passed the exact retained terminal test 1/1 without replaying tests 1–5. The shared world was cleaned and every linked manifest was marked cleaned. |
| `2026-08-25T172907571Z-b81f2d`, full Golden, world `mt8xw7yq` | Environment; 3/105 passed before the direct document upload remained at 0%. | The fresh server simultaneously logged repeated outbound `ECONNRESET` failures. The retained trace recorded the signed R2 `PUT` with status `-1`, no response and no completion. `maxFailures: 1` stopped the battery; 101 later tests did not run. | Exact diagnostic `2026-08-25T173538431Z-b01ed8` reproduced the unresolved R2 `PUT` without replaying 104 tests. The world and run-owned objects were cleaned. No further full retry is authorized because this is the second consecutive environment-class certification failure. |
| `2026-08-25T173538431Z-b01ed8`, retained GG-00 upload diagnostic, world `mt8xw7yq` | Environment; the exact signed R2 upload again received no response. | Supabase preflight passed, which exposed a missing R2 preflight boundary. The trace distinguished an external request stall from an application assertion, session failure or Realtime refresh. | Every lane now checks the configured DEV R2 endpoint as well as Supabase before browser launch. The later bounded preflight passed after endpoint recovery; the disposable world was already cleaned. |

## 105-test baseline campaign (2026-08-27)

Four certifications failed before the suite's first complete 105/105 pass (run `2026-08-27T092537174Z-defdcd`, build `wJvQO1H0KbcWHNseKQ9Ug`, world `mtbbhz20`, 44.3m, zero leftovers). Each was diagnosed from its retained world before any retry; every retry carried a scoped focused proof on the current source.

| Run | Classification and failure | Evidence and correction | Focused proof and cleanup |
| --- | --- | --- | --- |
| `2026-08-27T061816272Z-ab3a69`, full Golden, world `mtb4t1fa` | Transient; 21/105 passed before a saved site ("Gebäude A") never appeared within the 30-second envelope. | A read-only query proved the row committed at 06:22:51Z while two sibling sites created seconds earlier projected normally — the documented Realtime-freshness intermittent, hitting a helper whose broken navigation-recovery the hardening pass had removed without replacement. `expectVisibleAfterSave` now performs the one sanctioned reload as an explicit goto to the captured route and asserts the server-rendered persisted row. | Focused `@P1-01` 6/6 (`2026-08-27T062718320Z-0e7bba`); world cleaned. |
| `2026-08-27T063109433Z-b425a7`, full Golden, world `mtb59m0x` | Harness; 104/105 passed before the outsider bounced to `/login` at the final boundary. | DEV auth logs showed 403 "Session not found" — the stored session was revoked server-side while the mtime-based freshness check saw a recently saved file. `createRolePage` now verifies every stored role session at use: it probes a protected route on context creation and forces a real re-login on a bounce. | Focused `@P1-16` 3/3 (`2026-08-27T071608346Z-67cb68`); world cleaned. |
| `2026-08-27T072309502Z-be00db`, full Golden, world `mtb74kpl` | Product; 104/105, same boundary. | `auth.sessions` held zero outsider rows while other roles kept 8–10 live sessions; the logs showed a `/logout` one second after a successful login. The `/auth/callback` `SIGNED_OUT` handler signed out with the default global scope, so a stale client emitting `SIGNED_OUT` revoked the user's sessions everywhere — a real cross-device logout bug for production users. The callback now uses `scope: 'local'`; the harness login retry additionally clears cookies after a timed-out attempt. CodeRabbit reviewed the authorization change immediately per review rule 6 (4 findings: 3 fixed, 1 rejected as gitignored local config). | Focused `@P1-16` 3/3 (`2026-08-27T082143780Z-841d2b`); world cleaned. |
| `2026-08-27T082650867Z-ef59d4`, full Golden, world `mtb9ee73` | Harness; 104/105, same boundary despite all prior fixes. | The outsider was again at zero sessions with the same one-second login→logout fingerprint. Root cause of the entire historical final-boundary class: `getVisibleWorkArtifactCountsAs` (`tests/golden/support/db.ts`) signs in with the outsider's real credentials for the P1-15 RLS matrix at test 102 and signed out with the DEFAULT GLOBAL scope, revoking the fixture's session two tests before it was needed — while db.ts already documented this exact hazard ("deliberately no signOut") on two other helpers. The helper now signs out `scope: 'local'`, and the P1-16 boundary establishes a freshly authenticated outsider via UI login at action time before asserting denial. | Focused `@P1-16` 3/3 plus `@P1-15` 1/1 (`2026-08-27T091847009Z-b53fc9`, `2026-08-27T092156245Z-ffbc30`); world cleaned. The next full run passed 105/105. |

The durable lesson: a written hazard note beside one helper did not stop the next helper from re-creating the hazard. Session-revoking calls are now scope-local by convention in both product sync code and harness helpers, and the final cross-organization assertion no longer depends on any earlier session history.

## Operating decision

The harness remains a serial shared-world integration suite because earlier slices intentionally feed later scenarios. It is no longer the iteration loop. Focused runs find defects; retained-world diagnostics inspect failures; a complete clean battery certifies one final ordering only when its live providers remain available. The 2026-08-25 incidents show that this is not deterministic application certification: preflight cannot guarantee a later network window, and retries must not turn availability luck into acceptance evidence.

## Hardening acceptance record

The 2026-08-25 pass implements the nine retrospective actions:

1. Each run receives an immutable key and manifest; failure output, traces, screenshots, role state and world identifiers are copied into its own archive instead of being overwritten.
2. A failed DEV world is excluded from ordinary leftover sweeps and can be reopened by an explicitly focused diagnostic run.
3. Admin, Büro, employee and outsider storage states are recreated, organization-checked and exercised against a protected route before tests start; old or mismatched fixture state is refreshed.
4. The former single P1-16 Golden test is split into persisted setup, execution and boundary stages so a late role failure has a narrow target.
5. The runner enforces a full-rerun budget: classification and current-source focused proof precede the first retry, and two same-class failures block another attempt without a recorded override reason.
6. Iteration, diagnostic and certification are distinct lanes. Certification requires frozen source, a fresh build/server and a clean world.
7. Verbose Playwright output is written to `runner.log`; the interactive stream receives only start, final status and the first failure.
8. Preflight and unit policy checks enforce DEV routing and reachability, server ownership/freshness, retained-world cleanup, lane arguments, role-session age and the rerun rules. Serial browser batteries stop at their first failure.
9. This ledger records reusable causes and prevention. Future slice closure must link every failed certification to its run archive and focused proof.

Four CodeRabbit passes completed before the final freeze. Across 56 findings, 46 were accepted. The first three passes contributed 47 findings and 43 fixes across argument parsing, cleanup continuation, logging, role/session consistency, preflight handling, retained-world bookkeeping, path containment, Windows locking and runner failure capture. The fourth pass added malformed-session refresh, context cleanup when page creation fails and protection against archiving a failed fixture's session. Ten findings were rejected with recorded reasons: small suite-specific config duplication is clearer than another abstraction; a global mobile fixture would change desktop coverage; unreadable run state must fail closed; cleanup already marks every manifest for the destroyed organization; inferred manifest typing is already precise; naming-only refactors add no safety; and a pre-existing local Claude permission file was outside this pass. No review issue remains unresolved.
