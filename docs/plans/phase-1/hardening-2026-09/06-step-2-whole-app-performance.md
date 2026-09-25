# Step 2: Whole-app performance hardening

Status: living — last reviewed 2026-09-13; handoff diagnosis complete; Step 2 closure evidence recorded below, independent review pending

## Current repair checkpoint

The 2026-09-12 handoff (next section) is complete. The C3 blocker has a specific, measured cause, one application repair and one harness repair (see [Handoff diagnosis and closure](#handoff-diagnosis-and-closure-2026-09-13)). Fresh DEV report `2026-09-12T221143617Z-7d344e34` passes `canary:providers` (run `2026-09-12T221202829Z-b07619`, nine checks, C3 at 1,238 ms against the unchanged 2,000 ms deadline) and `canary:security` (run `2026-09-12T221405390Z-348672`, three checks) on the uninstrumented recorded cloud build `37eea70c-90e0-4897-b422-32bef67f465c`. After the owner's 2026-09-13 decisions, the current local selected verification is report `2026-09-13T012945543Z-e299eb62`: all 29 groups pass on build `45e96c03-9cc6-453e-9d4a-db4c5cd7a055`, all eleven median comparisons within and every hard deadline met, and DEV report `2026-09-13T021955406Z-63bbf0fc` passes both canaries on the same source with C3 at 1,058 ms. Three further defects found on the way are repaired: lost keystrokes in the typed customer search, a route refresh closing an open actions menu, and two harness races with the readiness catch-up. The closure section records the diagnosis, the decisions and the evidence.

Local `main` is at `d51988e`. Eight committed migrations are applied DEV/local and held from PROD. Application, test and documentation changes remain local and uncommitted. No push or production change occurred. Preview still uses PROD. The complete release battery and coordinated publication remain Step 3 work. The owner intends a brief independent review of this closure before deciding on Step 3.

## Handoff at the owner-requested stop (2026-09-12)

This section is the state the handoff started from. Its "Remaining blocker" and "Verification still required" subsections are historical; the closure section below records what was found and what ran.

### Task and authority

Finish the existing post-Step-2 review repairs and selected verification. Independently challenge the remaining hypotheses and inspect the recent changes; do not repeat the entire historical implementation or start a replacement architecture. The owner wants a useful, deterministic testing tool and an honest Step 2 closure. Preserve security over speed. Do not widen a deadline, reset references to slower values, remove flow coverage, or retry unchanged failed groups to obtain green output.

Read `AGENTS.md`, the [documentation index](../../../README.md), [testing](../../../technical/testing.md), [Realtime and caching](../../../technical/realtime-and-caching.md), [security](../../../technical/security.md), [environments](../../../technical/environments.md), decisions 0005/0007, and the applicable repository skills. This file remains the single Step 2 plan/review/acceptance home. Most implementation tables later in it are explicitly historical; their green counts are not current proof. Update the final acceptance record here, not in a second review-plan file.

Use one coordinator for runtime commands. A bounded independent reviewer can help a specific uncertainty; do not launch a fleet. Finish code/test changes and reviews before a verification run. Do not edit even an unrelated test while a browser run is active: the frozen-input guard rejected one such attempt in this continuation. CodeRabbit has standing authorization, through `bun run review` only. Three recent attempts failed due to the 150-file limit and then two WebSocket failures; do not repeat an unchanged broad review command. All twelve earlier Step 1 CodeRabbit carry-over findings were repaired and are recorded below; distinguish those from the unavailable final broad re-review.

### State to preserve

- Worktree: `C:/Users/z0052ceu/Tamay Can - Siemens AG/WerkFlow/Code/werkflow-app`, PowerShell, local `main`. The large dirty tree contains both prior passes and the review repairs. Preserve it, including the staged deletion of `components/kalender/month-view/month-view.tsx`; do not reset, stash, bulk-stage or restore it.
- Latest commit `d51988e` contains only `20260912210500_return_customer_page_rows.sql`. Earlier pagination commits are `0be451c` and `61ca347`; the four preceding security migrations are also applied DEV/local. The latest migration was tested in a rollback-only local transaction with 1,051 customers, committed, applied by linked DEV CLI, inspected on DEV, regenerated through `types:generate`, and applied locally through the CLI ledger. No migration remains pending from this continuation.
- DEV is `mbkkzuqjbdvzelqvuzcn`; PROD is `jbgaqpdjauzoocplgdsn`. `.env.local` is DEV. Preview uses PROD. Do not publish this app against an unprepared PROD schema. Existing routine DEV migration authorization persists; production rollout remains held for the coordinated release.
- Last recorded DEV build: `3d4f6682-5d0b-4075-9bec-cb8b846e0796`. The server is stopped. No test operation lock or unfinished/retained world remains. Ignored diagnostic scripts contain cleaned hard-coded worlds; never replay them unchanged. Local WSL addressing can change; use the wrappers and recorded-build checks.
- No further application edit followed the single-query customer reader. Subsequent source changes were measurement helpers and C3 subscription preparation. No final local browser campaign has run on this state.

### Remaining blocker and exact evidence

The only currently observed failing fresh boundary is DEV C3. Other selected groups still need current verification and may expose additional issues. Do not infer that every remaining problem is already known.

| Evidence | Meaning |
| --- | --- |
| Report `2026-09-12T212053236Z-1476922e`; provider run `2026-09-12T212115796Z-8f0f70` | Latest fresh run: C3 2,729.5 ms, provider 2/9 before stop, security 3/3. Classified product and cleaned. C3 now waits for database subscription readiness before the measured write, so cold connection setup does not explain this failure. |
| Report `2026-09-12T210400579Z-df0993a2`; provider run `2026-09-12T210420753Z-8317cb` | Earlier same app build: provider 9/9, C3 1,724 ms. The following security run was invalidated by a coordinator test edit. It is historical evidence, not current acceptance. |
| `.agent-logs/step2-repairs/20260912-final-retained-diagnostic.log` | Completed final diagnostic: submission 21:26:44.219, customer commit 45.056, receiver INSERT frame 45.586, browser visibility 46.085, measured 1,864 ms. The older Locator wait completed at 46.570. |
| `.agent-logs/step2-repairs/20260912-final-cloud-request-diagnostic.log` and `20260912-final-diagnostic-summary.json` | Same recorded build with metadata-only `cloud-request-diagnostic.cjs` preload. 174 backend requests across the entire two-browser diagnostic, maximum seven active, and repeated identity/membership/list requests. These counts are not all caused by the single write. The preload has no inbound-request correlation and excludes waiting before the outbound request is created. Do not claim it proves a specific bottleneck. Browser closure caused expected aborted background reads at the end. |
| Report `2026-09-12T211117460Z-1ccf3db1`; retained diagnostic `20260912-cold-subscription-diagnostic.log` | Historical cold-start confusion: C3 wrote before database-listener readiness; no INSERT arrived for that write, and startup catch-up showed it. This led to the explicit subscription setup precondition, not to a deadline increase. |

Read the retained trace metadata for the latest failure before changing code. It shows sender POST `/kunden` starting at 21:22:21.010 and taking 2,062 ms, sender follow-up reads from 22.276, and receiver `GET /api/customer-page` starting at 22.927 and taking 679 ms. POST duration includes framework/response work and is not itself the database commit time.

Next diagnostic should distinguish save preparation/execution, duplicated or queued background reads, actual network/provider latency, Realtime propagation, debounce, receiver read, and rendering. Correlate a few necessary spans if existing evidence cannot distinguish them. Keep payloads, credentials and personal fields out of logs. Review current coalescing/refresh behavior rather than stacking another cache or scheduler onto it. A successful retained diagnostic is investigative evidence only. Stop broad canary reruns until the cause or a defensible environment limitation is established. If a product target cannot be met on this environment without changing policy, explain that concrete limitation to the owner; do not change the policy silently.

### Recent repairs that need to remain coherent

- `hooks/use-realtime-router-refresh.ts` owns route refresh through `useRouterRefresh`, queues events while a transition/dialog is active, and preserves one follow-up through disable/re-enable. Real React/Suspense contracts hold the transition and cover both settle paths.
- `components/kunden/kunden-content.tsx`, `app/api/customer-page/route.ts`, `lib/clients/list-page.ts`, and `lib/clients/list-page-server.ts` replace full-route customer refreshes with a private bounded GET shared with initial SSR. Current identity/membership/manager/organization authorization remains mandatory. The new RPC returns IDs, total and fields from one snapshot, preserving German ordering and global contact/site search. It no longer needs separate hydration.
- Customer component identity includes organization/caller/role/page/search. Late route snapshots trigger an authoritative read rather than overwrite newer data. Failed reads retain rows with a stale notice and disabled dependent actions. Confirmed optimistic creations outside the current page settle only after an accepted post-save read; pending creations survive. Rollback resumes interrupted reconciliation, and foreign-organization late confirmations are rejected.
- `useLiveView` has opt-in `coalesceWhileReading`, enabled for customers. A same-scope event read can finish before one queued follow-up. Explicit refresh, mutation invalidation and scope/unmount changes retain cancellation. Other consumers retain their existing behavior. Actual held-response customer tests cover this; do not assume coalescing alone proves its timing benefit.
- The Realtime provider recovers at `postgres_changes` system-ready, not socket `SUBSCRIBED`, and rejects callbacks from removed channels. Actual initial/reconnect-gap tests preserve missed-write recovery. C3's named canary setup helper waits at most five seconds for that database-ready marker before its unchanged two-second write measurement; it makes no two-second cold-connect claim.
- Current authorization uses a fresh relational membership/lifecycle read; `authenticateAndAuthorize` resolves organization and role together. `withReadRequest` deduplicates only within one GET, forwards cancellation, and keeps current permissions. The per-process backend scheduler limits total/background concurrency, preserves caller async context and bounds starvation. Do not cache authorization across requests or replace verified identity with an unverified cookie.
- Earlier calendar range/generation/scope/cancellation, atomic correction metadata, mutation release/Undo, FullCalendar readiness, pagination/selector completeness, optional layout reads and intentional sidebar prefetch repairs remain in the tree and are recorded in this plan. Do not undo them because C3 remains unresolved.

### Measurement policy and reference provenance

The owner approved median-of-three candidate measurements versus median-of-three references. All eleven comparisons remain required. Every individual sample must meet its hard deadline. The combined 25% and 250 ms comparison rule is unchanged.

Registered scenarios use browser animation-frame timestamps through `browser-observation.ts`. Ordinary `expectLiveWithin` now delegates to `locator-observation.ts`, which samples the exact public Locator at fixed 16 ms intervals and retains the browser timestamp before later assertion/trace work. It preserves strictness, absent-before-write, mutation failure, navigation rejection and the deadline. Five focused real-browser tests pass, including the independently reviewed held-confirmation test and hidden `display:contents` guard. Readiness/removal helpers still include assertion completion time; timings are not automatic spans for every server render.

The live helper file is part of the registered reference checksum even though registered scenarios do not call the repaired ordinary helper. A TypeScript AST comparison excluding only `expectLiveWithin` and its new import proved every other statement unchanged. `performance-baselines.json` retains all 22 original entries and adds eleven explicitly reviewed context copies with identical numeric samples, medians, tolerances and original run/build provenance. `.agent-logs/step2-repairs/locator-reference-transfer.json`, `baselines-before-locator-clock.json`, and `live-before-locator-clock.ts` preserve the comparison. A separate read-only reviewer confirmed these transfers. This was not recalibration to slower results. Do not discard old entries, disable comparisons, or run new calibration merely because application code changed.

### Verification still required

Historical all-green local report `2026-09-12T162048922Z-0b492834` on build `ddd2356f-cdf0-4f2e-ab4a-323f623fb8d5` passed 29 groups, 1,193 units, 64 UI contracts, six SQL groups and all eleven median comparisons. It predates subsequent shared application changes and cannot close this handoff. Later focused proofs are useful but not a substitute for current selected acceptance. Latest focused checks include nine customer/reference units, five measurement browser contracts, earlier customer/route/provider contracts, rollback-only pagination SQL and lint. Docs check most recently passed at 81 indexed docs; transcript inventory passed at 230 sources/1,144 aspects with four URL inbox/history files excluded.

After a bounded diagnosis and any justified repairs, freeze source/test inputs, review, and run only the required owners. Finish fresh DEV `canary:providers` and `canary:security` on a recorded, uninstrumented cloud-target build. Both are required; a passing diagnostic cannot replace them. Use `bun run test:server cloud` and `bun run test:verify --target cloud`. Do not run repeated full canaries as a diagnostic loop.

Then stop the cloud server and use `bun run test:server local`. Run the 20-group timing/cheap selection first:

```powershell
bun run test:verify --jobs 2 --group static:dependencies,static:typecheck,static:lint,static:docs,static:coverage,unit:all,sql:p1-21,sql:p1-22,sql:p1-23,sql:p1-24,sql:security,sql:list-pagination,ui:contracts,audit:performance:calendar,audit:performance:lists,audit:performance:planning,audit:performance:calendar-live,golden:gg-00,golden:p1-11,golden:p1-12
```

After those pass, assemble the complete required 29-group report. It must reuse qualifying groups and execute the remaining nine, not rerun all twenty:

```powershell
bun run test:verify --jobs 2 --group static:dependencies,static:typecheck,static:lint,static:docs,static:coverage,unit:all,sql:p1-21,sql:p1-22,sql:p1-23,sql:p1-24,sql:security,sql:list-pagination,ui:contracts,audit:performance:calendar,audit:performance:lists,audit:performance:planning,audit:performance:calendar-live,audit:list-pagination,golden:gg-00,golden:p1-06,golden:p1-11,golden:p1-12,audit:wave-1:a1,audit:wave-1:a2,audit:wave-1:a4,audit:wave-1:a6,audit:wave-1:a7,audit:wave-2:p1-22,audit:security:account
```

Do not repeat a passing unchanged group just to make one chronological green battery. If final documentation changes invalidate cheap checks, rerun the affected cheap owners, not unrelated browser groups. Classify every failure, inspect its retained artifacts, and use the documented diagnostic/cleanup/recovery workflow. Do not create new run history to bypass an unchanged-failure guard.

### Final reconciliation and exit criteria

Inspect the final actual diff for stale behavior, tests, documentation, scope claims and unintended security changes. Reconcile the current checkpoint, acceptance record and rollout count in this plan; update the roadmap, canonical testing/Realtime/security references, gate log and incident log where affected. Preserve historical failures as historical. Keep skill mirrors identical if changed. Use `git -c core.safecrlf=false diff --check` on this Windows checkout.

The transcript aspect review has already been reconciled; do not blindly reread all 230 sources. Revisit performance-related aspects affected by a new finding, preserving individual dispositions and canonical rationale. `bun temporary-transcripts/check-inventory.mjs` checks source identity/coverage but cannot prove semantic completeness or recover visuals missing from transcripts.

Closure requires current selected local proof, fresh DEV proof, required comparisons and hard deadlines, classified/cleaned worlds, no operation lock, stopped test servers, restored DEV local routing, and coherent docs. Report exactly what passed, residual headroom and scope limits. No permanent regression immunity claim. Step 3 still owns the complete release-mode battery, deployed PPR/confidentiality and script-CSP coordination, agreed final acceptance scope and coordinated app/database publication. Do not begin Step 3 or push/deploy simply to finish this handoff.

## Handoff diagnosis and closure (2026-09-13)

### What the failing run actually spent its time on

The retained trace of the failed run `2026-09-12T212115796Z-8f0f70` and the retained diagnostic logs were read before any code change. Neither showed where the server spent its time, so one bounded instrumented observation was added: a Node-level preload (`.agent-logs/step2-repairs/handoff-server-preload.cjs`, ignored, not part of the build) that records every inbound request with its outbound Supabase requests by async context, undici queue and response times with IDs redacted, and event-loop stalls above 60 ms. A separate process probed the DEV gateway every 250 ms. One focused C3 iteration ran against that server: run `2026-09-12T220031336Z-0d7ab6`, build `609f282c-641e-4289-8aee-8057177c7a64`, measured 1,911.5 ms, world cleaned. Its server log is `.agent-logs/step2-repairs/20260912-handoff-instrumented-server.log`.

| Stage of the 1,911 ms window | Time | Source |
| --- | --- | --- |
| Submit click to POST arrival at the server | 73 ms | Playwright archive and inbound log |
| Action before commit: `auth/v1/user` 99 ms, `organization_members` 306 ms, insert 135 ms | 547 ms | outbound chain of the action request |
| Commit to the receiver's Realtime frame | about 310 ms | inferred from the receiver's read start minus the 150 ms debounce |
| Debounce | 150 ms | `REALTIME_DEBOUNCE_MS` |
| Receiver `GET /api/customer-page`: `auth/v1/user` 185 ms, `organization_members` 353 ms, RPC 208 ms | 763 ms | outbound chain of the receiver request |
| Response to visible row | 65 ms | browser observation |

Three hypotheses from the handoff are now excluded for this environment. The event loop never stalled during the window. No foreground request waited in the per-process scheduler (first outbound request 6 to 13 ms after arrival). The network probe never exceeded 129 ms in the window, and raw Node round trips to the DEV gateway are about 35 ms warm and 130 to 200 ms on a cold connection.

The cost is backend query time under concurrency on the DEV instance. Across the whole instrumented log, `organization_members` (the fresh membership and lifecycle read every request performs) takes a median 96 ms with at most two requests in flight, 166 ms at three or four, 190 ms at five or six, and 438 ms at seven or eight. `auth/v1/user` and `list_customer_page` follow the same curve. In the measured window the server reached the scheduler cap of eight. That load was almost entirely produced by the test itself and by the app's own reaction to one save:

- The sender's save rendered the customer list four times: the action's own route re-render (Next re-renders the route inside the action response because `createClient` calls `updateTag`), a second explicit `router.refresh()` in the create dialog 10 ms later, the post-save authoritative read, and the read triggered by the arriving route snapshot. Each render or read is three sequential backend requests.
- Both sessions were mid-burst. The shared `createCustomer` step navigates the sender to `/kunden` inside the measured mutation, so the sender's page render, its Realtime join and its readiness catch-up (attention counts, two clock reads, list read) overlapped the write. The receiver's readiness catch-up ran too, because C3 waited for `postgres_changes` readiness and measured immediately, and the attention-count read alone fans out into about twenty queries. Both sessions' bursts occupied the four background slots for the entire window.

With settled sessions the same chain needs about 73 + 350 + 310 + 150 + 430 + 65 ms, roughly 1.4 s. That matches the fresh acceptance result below.

### Repairs

1. Application. `components/kunden/create-client-dialog.tsx` no longer calls `router.refresh()` after a list-page creation. The action's tag update already re-renders the route in its response; the second refresh rendered the same page again and each render cost three backend requests on the shared database. The select-with-create path (job forms) keeps its refresh because it lives on a different route. The post-save read and the snapshot-triggered read are unchanged. Tier 3 only: no mechanism can forbid a second route refresh without banning `router.refresh()`, which the freshness contract still requires elsewhere; the open conversion is recorded in the [enforcement-ladder backlog](../../../technical/enforcement-ladder-backlog.md).
2. Harness. C3 now prepares both sessions before the measured write: each page opens `/kunden`, waits for the provider's database-ready marker (unchanged five-second bound), then waits for Playwright's network-idle state so its readiness catch-up has finished. The mutation runs with the new `navigate: false` option of `createCustomer`, so the sender does not reload the page inside the window. The deadline (2,000 ms), the clock start (`beforeSubmit`), the receiver condition (established database subscription, no reload) and the observation helper are unchanged. This is a measurement-condition change, not a contract change: the canary now measures a save between two settled sessions, which is the case the contract describes. It is recorded here so the owner's reviewer can challenge it.

At that point nothing else changed. `updateTag(CACHE_TAGS.clients(...))` had no cached consumer in the tree; its only effect was the action-response re-render. The owner later decided to remove it (see [Owner decisions](#owner-decisions-2026-09-13)), which cuts three more queries per save and shortens the sender's POST by about 800 ms.

### Fresh DEV proof

Report `2026-09-12T221143617Z-7d344e34`, cloud target, uninstrumented recorded build `37eea70c-90e0-4897-b422-32bef67f465c`, both groups required by the plan and both fresh:

| Group | Run | Result |
| --- | --- | --- |
| `canary:providers` | `2026-09-12T221202829Z-b07619` | 9/9, C3 at 1,238.3 ms against 2,000 ms, world cleaned |
| `canary:security` | `2026-09-12T221405390Z-348672` | 3/3, world cleaned |

C3 headroom is now about 760 ms on this environment with settled sessions. It was 88 ms in the instrumented run with the old preparation and negative in the failed run. The remaining structure is fixed by policy or provider: three sequential backend requests before the commit and three in the receiver's read (fresh identity and membership on every request, per the security contract), about 300 to 530 ms of Supabase Realtime propagation, and the 150 ms debounce. Under concurrent load on a small instance those query times triple, so this margin is real but not large; do not read it as capacity proof.

### Independent review of the shared repairs (2026-09-13)

One bounded read-only reviewer inspected the route-refresh hook, the live-view hook, the Realtime provider, the authorization and read-request helpers, the scheduler, the customer page route, reader, component and migration, and the two background routes against the security and freshness invariants. It found no weakened authorization, organization isolation or identity check anywhere in that set. Four findings, with their disposition:

1. Repaired. Typed customer search lost keystrokes and focus: the page keyed `KundenContent` by scope, page and search, so every committed URL change remounted the whole component, cleared the pending 250 ms navigation timer in `useListNavigation`, reset the input to the committed query and dropped focus. Anyone who typed, paused for a round trip and typed again lost characters. Search text, the navigation hook and a focus marker now live in an outer `KundenContent`; the keyed `KundenList` below it keeps the live, optimistic and creation-settlement identity unchanged and restores the caret before paint when the previous instance's input had focus. The page no longer keys the component itself. Tier 1 is the split ownership. Tier 2 is the A1 customer case, which now types `kein-a1-kunde` with a 300 ms pause per character so several commits happen mid-word, and asserts the final value, focus, URL and result. Focused run `2026-09-12T225456283Z-8cbee9` and the customer component contract pass; the selected owners below re-run on these inputs.
2. Resolved by owner decision 3. A same-page save started two customer reads, the explicit post-save read and the read the arriving route snapshot triggered, and `runBusy` resolved when its read was superseded, so an edited row lost its busy marker early. The owner could not see the flicker in a production build; removing the dead `clients` tag also removed the action-response snapshot that triggered the second read.
3. Corrected in the [security reference](../../../technical/security.md#read-request-authorization-reuse). The customer-page route compares against the resolved active membership, which falls back to the caller's first current membership when the cookie is absent or stale; the doc claimed a strict cookie comparison. Authorization is intact either way.
4. Left as is. `use-realtime-router-refresh.ts` has a redundant cancel effect for `enabled === false` that the suspension effect already covers. Removing it changes a shared hook for no behavior gain; it is noted here rather than edited during verification.

### Current local selected verification

Report `2026-09-12T221916286Z-e3092c46` (20 groups, local, build `c9b3ab10-5a82-44d5-856c-695459efb758`) passed 19 groups: all thirteen cheap groups, `ui:contracts`, `audit:performance:lists`, `audit:performance:calendar-live`, `audit:performance:planning`, `golden:gg-00`, `golden:p1-11` and `golden:p1-12`. `audit:performance:calendar` (run `2026-09-12T222614121Z-0c8ffd`) passed every browser assertion and all 18 hard deadlines but failed one of its six reference comparisons: `calendar.month-next.uncovered` median 1,227 ms (samples 1,161/1,339/1,227) against the reviewed 938.5 ms reference and its 1,189 ms limit. Two facts explain it. The read-only reviewer agent above was scanning the repository during that exact window (22:20 to 22:30), against the rule that measured groups run without competing work, and the group was the first browser group on a server started seven minutes earlier. The per-request membership read introduced after the reference is excluded as a cause: it costs about 7 ms against local Supabase (`.agent-logs/step2-repairs/membership-timing.ts`). The same candidate then passed all six comparisons in focused chain run `2026-09-12T225702954Z-1371a8` with month-next at 1,148/1,084/1,096 ms and no concurrent agent, on a server that additionally carried the diagnostic preload. The failed run was classified as environment with that evidence; the two later group-lane runs below show that the concurrent agent was not the whole explanation. The keystroke repair changed four inputs after that report, and the tool's ownership rule requires every one of the 29 groups to run again on each new candidate.

Report `2026-09-12T230337158Z-fce6c745` (29 groups, build `66761c73-6015-45fd-9125-e99c36e9f850`, keystroke repair included) passed 26 groups. Three failed, each diagnosed from its retained trace, classified and cleaned, and recorded in the [incident log](../../../technical/test-incident-log.md):

| Group | Run | Cause | Repair |
| --- | --- | --- | --- |
| `audit:wave-1:a1` | `2026-09-12T231030905Z-650e2b` | Harness. A real organization switch settled in about 450 ms (cookie action 377 ms, route refresh 60 ms), before the first poll of `toBeDisabled`; the disabled-while-switching contract is held by the organization component contract with a held switch. | A1 asserts the settled enabled state and data isolation; the four transient polls are removed. |
| `audit:wave-1:a2` | `2026-09-12T231030855Z-758da1` | Product. The job page's actions menu opened 0.9 s after load; the provider's database-readiness catch-up triggered the page's route refresh 0.7 s later and the open menu was gone. Dropdown menus did not register with the open-dialog context. | `DropdownMenuContent` renders `RegisterOpenDialog` inside its presence-gated content, so refreshes and live reads queue while a menu is open (Tier 1, same placement as dialogs). |
| `audit:performance:calendar` | `2026-09-12T232632360Z-0e0aa1` | Harness for PERF-03: the readiness catch-up's calendar read started 70 ms before the refresh click, the refresh coalesced into it and the held read never entered. PERF-02 month-next also measured 1,633/1,232/1,248 ms, median 1,248 ms against the 1,189 ms limit, with no concurrent agent. | PERF-03 waits for the database-ready marker and network idle before holding a read. The month-next comparison is an owner decision (below). |

Report `2026-09-12T235337481Z-9fae0576` (29 groups, build `b5c9d05d-0efd-43d1-b226-532051e9b9a1`, all repairs of this handoff included) passed 27 groups: all thirteen cheap groups with 1,193 units and 64 UI contracts, `audit:wave-1:a1`, `a2`, `a4`, `a6`, `a7`, `audit:wave-2:p1-22`, `audit:security:account`, `audit:list-pagination`, `audit:performance:calendar-live`, `audit:performance:planning`, `golden:gg-00`, `p1-06`, `p1-11` and `p1-12`. Every measured sample in the run met its hard deadline. Two groups failed on reference comparisons only:

- `audit:performance:calendar` (run `2026-09-13T002634377Z-8cf8d0`): PERF-01 to PERF-03 passed, but all six comparisons were reported as unverified, because the PERF-03 preparation edit changed `tests/audit/performance/calendar.spec.ts`, which is part of every calendar scenario's measurement identity. After the run, the six calendar references were transferred to the new context by the documented context-only procedure: the spec the referenced context executed was recovered byte for byte from run `0e0aa1`'s retained trace, hashes to exactly the referenced digest, and equals the current spec minus the four PERF-03 lines after line-ending normalization (the Edit normalized the untracked file's mixed endings). Numeric samples, medians, tolerances and run/build provenance are unchanged; the 33 earlier entries remain. Evidence: `.agent-logs/step2-repairs/transfer-calendar-references.ts`, `calendar-reference-transfer.json`, `calendar-spec-before-perf03-settle.ts`, `baselines-before-perf03-settle.json`. The transferred references have not been exercised by a group-lane run yet. The run's own month-next samples were 1,345/1,248/1,293 ms, median 1,293 ms, so it would have failed the 1,189 ms limit with matching references.
- `audit:performance:lists` (run `2026-09-13T002838869Z-fa665b`): `customers.list.open` median 1,056 ms (samples 1,159/1,012/1,056) against the reviewed 790.2 ms reference and its 1,040 ms limit; `jobs.list.open` within. Every sample met the 5,000 ms deadline.

The two comparisons drift the same way across the three group-lane runs of this night, all on the same laptop after hours of continuous verification:

| Scenario (reference, limit) | 22:26 report | 23:03 report | 23:53 report | Focused chain, tracing off |
| --- | --- | --- | --- | --- |
| `calendar.month-next.uncovered` (938.5 ms, 1,189 ms) | 1,161/1,339/1,227 | 1,633/1,232/1,248 | 1,345/1,248/1,293 | 1,148/1,084/1,096 |
| `customers.list.open` (790.2 ms, 1,040 ms) | 939/898/956 | 1,027/909/972 | 1,159/1,012/1,056 | not run |

Both references were reviewed on 2026-09-12 at 16:10, before the last continuation added the fresh per-request membership read (about 7 ms locally, excluded), the per-process request scheduler and the database-readiness catch-up. The catch-up reads the calendar, the clock state and the attention counts and refreshes the route about 1.5 s after every page load, inside the measured navigation sequence that starts right after load; the accepted 16:51 run measured month-next at 1,040 ms without it. The customer list's first sample of the night was already 150 ms above the reference before any change of this handoff. No further full selection was run after the transfer: the tool requires all 29 groups for any input change (about 70 minutes), and a fourth run cannot change either comparison's verdict.

After the reference transfer and these documentation edits, cheap report `2026-09-13T005114909Z-00e22f36` passed dependency security, typecheck, lint, docs (81 indexed), catalog coverage and all units on that tree.

### Final selection after the owner decisions

With the dead `clients` tag removed and the two references re-reviewed, calibration source report `2026-09-13T012320630Z-74d3b9ed` passed the calendar (run `2026-09-13T012346509Z-0d0423`) and lists (run `2026-09-13T012542712Z-35a01e`) groups on build `45e96c03-9cc6-453e-9d4a-db4c5cd7a055`. The complete selection then ran once more on the final inputs. Report `2026-09-13T012945543Z-e299eb62` passes all 29 groups on that build: the thirteen cheap groups, `ui:contracts`, `audit:wave-1:a1` (`2026-09-13T013643215Z-b32dbd`), `a2` (`013643220Z-ad21cc`), `a4` (`014602797Z-f6a7e1`), `a6` (`015301669Z-fc63dc`), `a7` (`015301733Z-44ceee`), `audit:wave-2:p1-22` (`015848587Z-a80fd8`), `audit:security:account` (`020021353Z-548695`), `audit:list-pagination` (`020023396Z-2dcbe1`), `audit:performance:calendar` (`020138555Z-4291c9`), `audit:performance:lists` (`020324317Z-d6b20e`), `audit:performance:calendar-live` (`020455037Z-d062a3`), `audit:performance:planning` (`020610468Z-ee3573`), `golden:gg-00` (`020833953Z-a3e5f3`), `golden:p1-06` (`021020863Z-2bb124`), `golden:p1-11` (`021245192Z-75d1c8`) and `golden:p1-12` (`021456035Z-cb7db5`). Every world is cleaned. All 33 measured samples meet their hard deadlines and all eleven medians are within their reviewed references:

| Scenario | Samples, ms | Median, ms | Reference, ms |
| --- | --- | --- | --- |
| `calendar.day.cold-open` | 1011 / 946 / 972 | 972 | 843.3 |
| `calendar.day-to-week.uncovered` | 479 / 491 / 306 | 479 | 442.7 |
| `calendar.week-to-day.covered` | 134 / 133 / 109 | 133 | 99.4 |
| `calendar.week-to-month.uncovered` | 1725 / 2262 / 1690 | 1725 | 1651.7 |
| `calendar.month-next.uncovered` | 1059 / 1043 / 882 | 1043 | 1099.2 (re-reviewed) |
| `calendar.month-to-week.covered` | 182 / 172 / 163 | 172 | 133.4 |
| `customers.list.open` | 896 / 933 / 1011 | 933 | 1013.1 (re-reviewed) |
| `jobs.list.open` | 970 / 913 / 1044 | 970 | 968.7 |
| `planning.occurrence.cross-session` | 1220 / 1322 / 1172 | 1220 | 1613.3 |
| `calendar.month.employee-open-to-event` | 1696 / 1402 / 1398 | 1402 | 1612 |
| `calendar.month.admin-open-to-legacy-event` | 1431 / 1584 / 1549 | 1549 | 1449.3 |

The reference column shows the entry the loader matched for each scenario's current context in `lib/testing/performance-baselines.json` (reviewed on 2026-09-12 at 16:10 and transferred to later contexts, except the two re-reviewed ones). A comparison fails only when a median exceeds its reference by both 25% and 250 ms, so cold-open at 972 against 843.3 and month-to-week at 172 against 133.4 are within. Freshness observations in the same report: GG-00 customer list 749 ms (1,866 ms in the September 12 checkpoint), P1-11 planning 1,542 ms, P1-12 dispatch 1,825 ms, closure appearance/removal 1,390/1,937 ms, correction submission/withdrawal 1,401/1,428 ms, all against 2,000 ms. Closure removal and dispatch keep limited margin; the customer path gained about 1.1 s from the removed duplicate refresh and the removed tag re-render.

Fresh DEV proof on the same source: report `2026-09-13T021955406Z-63bbf0fc`, cloud build `98d6ea47-28fe-454f-b7ec-daeafcadb090`, `canary:providers` run `2026-09-13T022017750Z-92af2c` 9/9 with C3 at 1,058 ms against 2,000 ms, `canary:security` run `2026-09-13T022210307Z-5b03b6` 3/3, both worlds cleaned. C3 headroom on this environment is now about 940 ms with settled sessions.

Rollout state is unchanged: eight migrations applied DEV and local, none on PROD; no commit, push, preview or production change; `.env.local` on DEV; test servers stopped; no retained world and no operation lock. Step 3 still owns the complete release battery, deployed confidentiality checks and the coordinated app and database publication.

### Owner decisions (2026-09-13)

The owner answered the four open questions on 2026-09-13. What was decided and what changed:

1. **Two reference comparisons.** `calendar.month-next.uncovered` measured 1,227 to 1,293 ms medians in three runs against a 1,189 ms limit, and `customers.list.open` 939 to 1,056 ms against 1,040 ms, every sample far inside its 3 s and 5 s hard deadlines. The cause is the database-readiness catch-up added on 2026-09-12 for missed-write recovery: about 1.5 s after each page load it re-reads calendar, clock and attention data and refreshes the route, inside these measured sequences. The owner chose to re-review the two references for the changed application rather than change the measurement protocol or narrow the catch-up. The two compatible entries in `lib/testing/performance-baselines.json` were replaced in place, because the validator rejects two entries with one context: month-next 1,099 ms (samples 1,099/1,061/1,161, run `2026-09-13T012346509Z-0d0423`) and customer list 1,013 ms (samples 876/1,185/1,013, run `2026-09-13T012542712Z-35a01e`), both from passing group runs on build `45e96c03-9cc6-453e-9d4a-db4c5cd7a055` with this handoff's repairs. The review reason is stored in each entry; the superseded values are in `.agent-logs/step2-repairs/superseded-references-2026-09-13.json` and the full previous file in `baselines-before-owner-review.json`. The 37 other entries are untouched. This is a reviewed replacement with a stated cause, not a silent recalibration; the next time these scenarios slow down, the comparison starts from these values.
2. **Database tier.** Both projects run Micro compute, and query latency on it triples between two and eight concurrent requests. The owner will raise the production tier once traffic grows beyond the one beta business; until then it is an accepted, documented bottleneck in the [environments reference](../../../technical/environments.md#the-two-cloud-backends).
3. **Dead `clients` cache tag.** No `use cache` or `unstable_cache` reader ever carried it, so its only effect was a route re-render inside every customer, contact, site, follow-up, communication, equipment and caller-promotion action response, while every caller already refreshes its route or reads live. All fifteen `updateTag(CACHE_TAGS.clients(...))` calls and the tag definition are removed; the customer list relies on its post-save read and Realtime, the other pages on their own `router.refresh()` and route-refresh hooks. The customer create action now also stops producing the route snapshot that triggered the second list read from review finding 2, which resolves that finding as a side effect.
4. **Busy-marker flicker after a customer edit.** The owner tested a production build and could not see it; left as is.

The readiness catch-up itself stays as designed. Narrowing it to views whose read started after the subscription attempt would remove most of the post-load burst, but it is a scheduling change the owner asked not to add speculatively, and the reference decision above removes the need.

## Outcome and authority

Make the implemented Wave 2 app fast to enter, navigate, update, and coordinate across users. Repair missing/stale calendar data and unstable loading behaviour before pursuing smaller timing gains. Preserve all supported workflows, authorization, tenant isolation, data integrity, accessibility, and truthful feedback. Security wins when an optimization cannot preserve those guarantees.

This is the single Step 2 plan, findings ledger, and eventual acceptance record. A fresh implementing agent must independently inspect the application and refine this plan before implementation. Add a finding only when it has a concrete symptom, source evidence or a falsifiable hypothesis, and a useful bounded remedy. Disprove or replace proposals when the evidence warrants it. Do not add generic best-practice lists, duplicate another finding, or treat every transcript suggestion as a requirement.

The owner's latest numbering governs: Step 1 is security/infrastructure; Step 2 is this whole-app performance pass; Step 3 remains the subsequent final hardening/acceptance checkpoint whose detailed scope will be agreed separately. Do not silently move performance work into Step 3. The owner explicitly deferred the complete release battery until final acceptance after Step 3. Step 2 requires cheap groups plus named browser groups covering its changed boundaries.

The [Step 1 record](05-step-1-security-infrastructure.md#final-repair-verification) owns security repair evidence and rollout state. Its nine review findings are resolved within the agreed scope. This is permission to plan the next pass, not a claim that every future vulnerability or regression is impossible. Permanent rules live in the existing technical references and skills, not in this plan.

## Starting state and handoff safety

Read this section before changing files or running a server.

1. Continue from the owner's current local `main` working tree. At discovery, `136f529` follows `1d4e994`; these commits contain the four approved security migrations only. The security application, tests, generated types, and documentation repairs are still uncommitted. A fresh checkout of those commits alone is not the accepted Step 1 candidate. Inspect `git status`, the diff, and the Step 1 record; preserve all existing changes, including transcript additions. Do not reset, stash away, or recreate them.
2. All four security migrations and both repaired mail functions reached DEV. The matching repairs have not reached PROD. The owner confirmed on September 8 that preview uses PROD Supabase, and explicitly chose to keep that routing. [Environments](../../../technical/environments.md#the-migration-rule) owns project IDs, migration rules, and the coordinated release. Do not point preview at DEV, deploy a migration to PROD, or push an incompatible app on this plan's authority.
3. Publication is blocked by app/database compatibility, not by an unconditional rule that Git pushes must wait until Step 3. Under the current routing, preserve the documented coordinated release unless the owner separately authorizes and reviews another safe deployment arrangement. A Git commit, preview deployment, DEV verification, and production release are different operations. Commit and push only when requested; never advance `origin/main` without a production release request.
4. Use local Supabase for application tests and live DEV for named provider checks. Inspect the target first. Production discovery is read-only metadata only; no load tests, synthetic business writes, or query experiments on real customer records. Schema changes follow committed migrations, local verification, DEV application and type generation, with production timing coordinated separately.
5. One coordinator owns the runtime, environment, builds, database resets, verification, and cleanup. Subagents may inspect or edit disjoint files but must not start competing servers or tests. Preserve the workspace lock and WSL lease. Use the repository wrappers, not `next dev` as performance acceptance. No new Linux machine, native computer use, or paid infrastructure is assumed.
6. CodeRabbit has standing authorization through `bun run review`; preserve its findings and dispositions. Use it at meaningful reviewed boundaries, not after every small edit. Do not install another CLI or repeat completed Step 1 reviews/recovery rehearsals because the agent context changed.

Recorded Step 1 reference evidence is local report `2026-09-08T084020005Z-adb2aea7`, with 1,050 unit tests, all five SQL groups, 28 UI contracts and 45 selected browser cases, plus DEV security report `2026-09-08T090910188Z-0e3e03c5`, 3/3. These are historical references for their inputs. Use the selector for current qualification; do not rerun the whole security pass to establish context. Ignored `.agent-logs` artifacts may be absent on another machine. Their absence is not a reason to invent timings or mark new evidence green.

## Reading route

Read the current checkpoint in [roadmap](../roadmap.md), [architecture](../../../technical/architecture.md), [security](../../../technical/security.md), [Realtime and caching](../../../technical/realtime-and-caching.md), [testing](../../../technical/testing.md), [decision 0005](../../../decisions/0005-enforcement-ladder.md), and [decision 0007](../../../decisions/0007-independent-test-groups.md). Read the [calendar feature contract](../../../features/calendar-and-resource-planning.md) and [time contract](../../../features/time-tracking.md) before changing their projections. Route other domains through [the documentation index](../../../README.md).

Apply `diagnosing-bugs`, `supabase-live-workflow`, `werkflow-design`, and the TypeScript skill when their code is involved. Use `technical-writing`, `writing-for-agents`, and `unslop` for documentation. Update both skill mirrors together when a procedure changes. The [platform hardening record](../consolidation-2026-08/platform-hardening.md), [UI/UX record](02-uiux-hardening.md), [testing restructure](04-testing-system-restructure.md), and [incident log](../../../technical/test-incident-log.md) explain prior decisions and failures. They do not override current execution rules.

The owner's thread requirements are captured here so the implementing agent does not need this conversation:

- Preserve loaded valid content during same-scope refresh, provide prompt meaningful feedback, reconcile actual saved results, and propagate authorized updates promptly to other users.
- Investigate PPR, Server Components, server rendering, cache keys/tags/lifetimes, database work, browser rendering, bundle size, Realtime and calendar components together. Realtime consolidation remains the foundation.
- Measure important interactions rather than add a stopwatch to every calculation or permission test. Some existing browser scenarios need retrofitting. Current timing does not cover every server render and does not detect every slowdown below its fixed deadline.
- Do not spend hours rerunning entire batteries until luck produces consecutive green results. Diagnose retained failures, preserve unrelated evidence, and make new tests deterministic within their actual dependencies.
- Keep every catalog clause covered. Reorganization must not remove business cases or weaken negative permission assertions.
- Maintain one current plan, invite the implementing agent's independent findings, and leave a reviewable result for a separate agent to verify before Step 3.

## Discovery evidence and limits

September 8 discovery inspected the current working tree, the authenticated route inventory, shared cache/layout/read paths, calendar implementations and their readers, timing/qualification code, relevant historical evidence, and live DEV metadata. Three independent reviewers covered calendar/Realtime, tests/enforcement, and transcript research. No application changes, new performance campaign, load test, or production mutation occurred during planning. Proposed causes below are not all reproduced browser defects.

The installed application uses Next.js `16.3.4`, React `19.2.3`, Cache Components enabled in `next.config.ts`, and Vercel `fra1` in `vercel.json`. Recheck the installed versions before relying on API behaviour. `lib/data/cached.ts` has seven `unstable_cache` readers behind request-level helpers; `lib/work-templates/server.ts:loadWorkTemplateSummaries` uses `'use cache'` and `cacheTag`. This is not an app-wide cross-request cache of every list. Adding tags to mutations does not itself make their readers cached.

DEV metadata confirmed existing organization/date indexes on planning occurrences, organization/timestamp and user/organization/timestamp indexes on time entries, and organization/status/date indexes on jobs. The customer table has an organization index. Tiny surviving DEV fixture counts cannot establish production-scale speed; high cumulative sequential-scan counts on tiny tables are not proof of missing indexes. The protected publication has INSERT/UPDATE enabled and DELETE/TRUNCATE disabled. No representative query plan or load capacity was measured in planning.

### Initial findings ledger

Keep these IDs stable. Add implementation, prevention and evidence columns as work proceeds. A hypothesis may close as disproved with its evidence; it does not need a code change.

| ID | Evidence and current conclusion | Required investigation or outcome |
| --- | --- | --- |
| PF-01 | `calendar-container.tsx:getDateRange` moves the week start across a month boundary but derives the end day using the original end month. Source arithmetic for September 1 produces August 30 through October 8 instead of September 7. | Prove with pure date-window tests, repair date arithmetic, and cover month/year/leap/DST boundaries with Berlin business dates. Keep interval inclusivity explicit. |
| PF-02 | `fetchedRangeRef` is advanced by `fetchEntries` success but skips both time and planning fetches. Each fetch replaces its array. Request generations advance on fetch, not on every view/range change. | Prove partial success/failure and out-of-order A→B→A races. Give each dataset truthful coverage or commit a coherent required-data snapshot. A range must not be marked complete because a different dataset loaded. |
| PF-03 | Calendar `useLiveView<null>` adapters invoke separate stateful readers and return success even after inner failures. Shared stale/generation state therefore does not own the actual arrays. | Integrate real data/results into one clear owner; expose initial loading, refreshing, stale, failure and empty states. Do not layer another cache over ambiguous ownership. |
| PF-04 | Calendar uses 8-second event suppression, up to 120 seconds around confirmations, plus a custom 300 ms refresh timer. Synthetic catch-up can bypass event filtering. | Replace event dropping with explicit mutation ownership, queued invalidation and one guaranteed authoritative catch-up. Preserve server validation, optimistic rollback and concurrent mutation safety. |
| PF-05 | Calendar time subscriptions omit `time_correction_requests`; the holiday route refresh omits `organization_closure_days`. Those roots are published. Route/tag invalidation alone does not notify another open browser. Absence readers use a fixed window from 365 days before to 730 days after the business date, independently of the selected view. | Verify and repair second-session correction and closure add/edit/delete refresh. Check navigation beyond absence coverage; fetch the requested range, constrain navigation intentionally, or show unavailable coverage rather than false absence-free dates. Preserve neutral sickness labels and role visibility. Inventory member, qualification, dispatch, parking and settings signals too. |
| PF-06 | `KalenderData` waits for entries, members, planning, settings and holidays; the client refetches mount data and receives subscription catch-up. Initial entries omit provisional corrections merged by the client. | Trace initial server payload, selected date range, mount reads and subscription reads; fix first-paint parity and duplicate work without removing gap recovery. |
| PF-07 | Custom day/week views and dynamically loaded FullCalendar month view have different lifetime and projection behaviour. Month unmounts on leaving; its event projection is recomputed before memoized composition. A separate custom `month-view` appears unused. | Profile date/filter/drag updates and warm return. Share/index expensive projections where measured. Confirm the import graph before removing unused code; do not replace the calendar library by default. |
| PF-08 | Planning reads have dependent stages, a 2,000-occurrence cap, 100-ID assignment batches and a 10,000-assignment cap. Time reads combine legacy, canonical, approved and provisional records through sequential stages; some employee filtering happens after organization reads. | Measure query count, rows, bytes and plans; push authorized scope/date filters down, batch bounded ID lists, and parallelize only independent reads. Preserve visible truncation/failure, overnight pairing and all corrections. |
| PF-09 | `AppProviders` blocks the shell on identity/org/profile/subscription and then runtime state. `getAttentionCounts` derives eleven sets of business items, including contextual lookups, to count them. `getCachedUser` and `getAuthenticatedUser` separately memoize Auth calls. The named auth-health reporter is currently a no-op. | Instrument the actual critical path. Deduplicate equivalent request-local work and decouple optional counts from useful authorized content where safe. Do not remove a required authorization read or optimize a no-op. |
| PF-10 | Customer list loads all customers plus contact/site search context. Manager work list loads jobs/projects/clients/members and assignments. Some other readers already have limits or pagination. | Inventory actual server bounds and payloads, including details, pickers, history and exports. Preserve complete search and navigation; UI pagination alone does not reduce server work. |
| PF-11 | `authenticateAndAuthorize`, organization resolution and time helpers consume tagged membership candidates with a 300-second fallback. Scheduled access is evaluated at current time from those candidates. Step 1's name reader separately uses a fresh caller-scoped read. | Test warm-cache role/removal/lifecycle/assignment changes before extending reuse. Distinguish app invalidation from direct administrative DB changes. A cache hit is never a new authorization proof. Fix any demonstrated security defect before accepting its optimization. |
| PF-12 | Provider and live-view/router consumers each debounce by 150 ms; some surfaces combine route refresh and independent client reads. Trailing debounce can defer work under sustained events. | Trace event→batch→read→render and cache invalidation ordering. Establish bounded catch-up under bursts without refresh storms. Do not reduce timers speculatively; earlier shorter timing exposed stale-cache races. |
| PF-13 | GG-00 last measured 1,999.48/2,000 ms locally. DEV C3 report `2026-09-06T224518941Z-7d753e` measured 5,609.16/2,000 ms. Earlier local observation was 1,437.31 ms. | Preserve the existing failure and nearly exhausted margin. Decompose server, transport, read and render costs; compare like-for-like before/after. Neither a local pass nor optimism closes the cloud delay. |
| PF-14 | `tests/golden/p1-11.spec.ts` calendar occurrence test uses eventual visibility with a 20,000 ms timeout. Current timing evidence requires categories, not every stable scenario ID; every readiness record is validated against the P1-22 constant. | Retrofit the calendar boundary and extend the existing timing/registry/result system as specified below. Preserve all existing business assertions. |
| PF-15 | Current timing has no comparable performance baseline or general SSR/query/render spans. Optional imports, long tasks, RSC payloads, images and route caching have not been measured as a complete system. | Add bounded diagnostic attribution and a representative performance cohort. Verify actual delivered assets and route behaviour; do not infer speed from build success or library names. |
| PF-16 | Step 1 deferred script CSP coordination with rendering. Personalized PPR, cached authorization and serialized props can conflict with apparent speed improvements. | Review CSP/PPR feasibility and all cache disclosure boundaries. Keep existing headers. A nonce/hashing decision needs verified installed-framework behaviour and security evidence; do not ship a permissive policy merely to keep PPR. |

### Independent planning pass (2026-09-08, implementing agent)

The implementing agent reread the current working tree before changing behaviour: the calendar container and its three renderers, the live-view family and provider, every `unstable_cache` reader, the calendar time/planning/absence readers, the attention derivation, the list pages, the timing/qualification code, the Golden and audit helpers, and the three `PERF` transcript sources. The local Supabase stack was running; no DEV or PROD query was issued. Every conclusion below names its source.

| ID | Validation result |
| --- | --- |
| PF-01 | Confirmed by executing the source arithmetic. The week range only ever over-fetches: the Sunday before the week is at least the 21st of the previous month, so `end.setDate(start.getDate() + 8)` lands on or after the 29th of the current month. September 1 fetches August 30 to October 8 (40 days for a 9-day need); January 1 fetches December 28 to February 5. No week is ever under-fetched, so this is payload and query cost plus a wrong coverage record, not missing data. |
| PF-02 | Confirmed. `fetchedRangeRef` advances only when `fetchEntries` succeeds; `fetchJobs` keeps its previous-range array on failure; `isLoading` follows the entries dataset alone. After a day-to-month switch the month grid renders the old day-range occurrences until the month read lands. |
| PF-03 | Confirmed. Both `useLiveView<null>` adapters return `{ ok: true }` unconditionally, so `isStale` can never become true and the hook's generation guard never sees the actual arrays. |
| PF-04 | Confirmed with its mechanism: `eventFilter` returning false makes `shouldScheduleRealtimeRefresh` skip the event entirely. Nothing queues it. The primitive already offers `suspend`, which queues and fires one catch-up read. The 120-second dialog extension duplicates the shared open-dialog suspension. |
| PF-05 | Confirmed for `time_correction_requests` (provisional entries come from that root) and `organization_closure_days` (the holiday calendar is a server prop, so only a route refresh can update it). Dispatch tables need no calendar signal: `CalendarJob` carries no dispatch state and the Einsätze panel owns its own live view. Parking uses `work_blockers` (present). Qualification and capacity are evaluated server-side per action, not rendered from a subscription. Absence readers use the fixed 365/730-day window. |
| PF-06 | Confirmed, plus PF-17 below. The server payload omits `provisionalEntries` and the change-request map. |
| PF-07 | Confirmed. `components/kalender/month-view/month-view.tsx` has no importer in `app`, `components`, or `lib`. |
| PF-08 | Bounds confirmed (2,001-row window read, 100-ID assignment batches, 10,001-row cap). PF-19 below records the unbounded correction read behind every time read. |
| PF-09 | Confirmed. `reportAuthUsersStringColumnHealth` is a no-op; `AppProviders` awaits `getAttentionCounts` before rendering the shell. Every page also repeats `getCachedUser`, `resolveActiveOrgId`, and `getCachedMemberships`, but React `cache()` deduplicates them within the Server Component render pass. |
| PF-10 | Confirmed, sharpened by PF-21. |
| PF-11 | Design confirmed: membership candidates are cached per user with tag invalidation and a 300-second fallback; `getMembershipAccessMode` evaluates scheduled states at read time. No reuse extension is planned in Step 2, so no new authorization proof is required beyond the existing lifecycle tests. |
| PF-12 | Confirmed: two trailing debounces (provider per table, hook per surface) with no maximum wait. A sustained event stream defers the read until it pauses. |
| PF-13 | Historical values retained. Not remeasured during planning. |
| PF-14 | Confirmed: three `toBeVisible({ timeout: 20_000 })` waits in `tests/golden/p1-11.spec.ts`. `createPlannedCalendarEntry` has no pre-submit boundary, unlike `createCustomer`. |
| PF-15 | Confirmed. No scenario registry, baseline, or attribution exists. |
| PF-16 | Corrected during independent review: cookie reads do not disable Cache Components PPR. The recorded build contains partially static authenticated routes. Preserve generic shells and authorized dynamic content; Step 3 script-CSP verification must cover both the shell and streamed scripts. |

New findings with evidence:

| ID | Evidence and current conclusion | Required investigation or outcome |
| --- | --- | --- |
| PF-17 | `KalenderData` computes the prefetched day range with `setHours(0, 0, 0, 0)` in the server process timezone. On Vercel that is UTC, so the "today" range is 02:00 to 01:59 Berlin time in summer. The client seeds its coverage from its own local range and then reads again unconditionally. | Compute the server range in Europe/Berlin with the existing wall-time helpers, send the covered range to the client, and skip the mount read when the needed range is covered. |
| PF-18 | Calendar entry performs three reads of the same range: the server render, the container's unconditional mount refetch, and the provider's first-join `dispatchAll()` catch-up. The join catch-up is legitimate gap recovery and applies to every live view in the app. | Keep exactly one convergence read after mount (the join catch-up). Remove the calendar's unconditional mount read once PF-17 makes coverage truthful. Do not remove the join catch-up. |
| PF-19 | `getTimeEntries` calls `getProvisionalTimeCorrectionProjection`, which calls `getTimeCorrectionRequests(orgId)`: the 300 newest correction requests of the organization with their revisions, profiles, and memberships, on every calendar and time read, regardless of the requested range or pending status. Filtering to pending requests happens in memory. | Add a pending-only projection read that pushes the status filter down and loads only the revisions it needs. Prove the bound with an injected-client unit test that counts queries and rows. Preserve the visibility rules and the provisional projection semantics. |
| PF-20 | `AttentionCountProvider` subscribes to 19 tables and re-runs the full eleven-derivation `getAttentionCounts` on every debounced event and every channel join, on every page. | Measure its cost with the typical profile. Do not weaken the derivation (a badge must never count an item its viewer cannot act on). Decoupling the layout from the initial count (PF-09) is the bounded Step 2 change; a lighter count path is a recorded candidate. |
| PF-21 | `app/(app)/auftraege/page.tsx` loads every job of the organization, then reads `job_assignments` with `.in('job_id', jobIds)`. At 2,500 jobs the GET query string carries roughly 95 KB of UUIDs, and the read's error is discarded, so the list would silently show no assignments. `job_assignments` has an `organization_id` column. | Read assignments by organization (and by user for employees) without an ID list. Verify at the typical profile that assignments render with 2,500 jobs. Inventory the other `.in(...)` list readers for the same shape. |
| PF-22 | `expectReadyWithin` and `expectLiveWithin` are the only measured boundaries. Calendar view switches and list navigation have no usable-content marker, so a browser test cannot distinguish server HTML from hydrated, data-complete content. | Add a client-committed readiness marker for the calendar and the two large lists, set from an effect after the data owner reports coverage, and measure navigation and view switches against it. |

Rejected or narrowed hypotheses:

- Compression, image delivery, and font delivery (PERF-001.01) were not inspected in code beyond `next.config.ts`; they stay a section 4 verification item on the recorded build, not a planning claim.
- A Broadcast transport, polling, or read replicas remain rejected without measured need.
- Replacing FullCalendar is rejected; the month projection is measured in place.
- Widening `REALTIME_DEBOUNCE_MS` or the two-second deadline is rejected.

Ordered implementation sequence for this pass:

1. Calendar range owner: `getCalendarFetchRange` (PF-01), a pure typed range-data state with per-dataset coverage and generations (PF-02, PF-03), mutation-scoped suspension with one authoritative catch-up (PF-04), the missing signals and range-aware absence reads (PF-05), Berlin server range plus provisional parity plus one convergence read (PF-06, PF-17, PF-18), truthful loading, stale, and unavailable states, and the readiness marker (PF-22).
2. Measurement: scenario registry, versioned baselines, the third evidence archive with its validator, `expectUsableWithin`, the P1-11 retrofit, and the `audit:performance` group with the typical data profile (PF-13 to PF-15).
3. Readers: pending-only correction projection (PF-19), organization-scoped assignment reads (PF-21), attention counts off the layout critical path (PF-09, PF-20), bounded maximum wait in the shared debounce (PF-12).
4. Records: cache-reader inventory, CSP decision, docs, skills, transcript aspects, review.

Initial measured cohort (scenario IDs are stable; budgets are provisional planning hypotheses until the first recorded baseline):

| Scenario | Boundary | Provisional budget | Profile |
| --- | --- | --- | --- |
| `calendar.day.cold-open` | navigation to usable content | 5,000 ms | typical |
| `calendar.day-to-week.uncovered` | view switch to usable content | 2,000 ms | typical |
| `calendar.week-to-day.covered` | view switch to usable content | 500 ms | typical |
| `calendar.week-to-month.uncovered` | view switch to usable content | 2,000 ms, calibrated to 3,000 ms (version 2, see the measurements) | typical |
| `calendar.month-next.uncovered` | navigation to usable content | 2,000 ms, calibrated to 3,000 ms (version 2, see the measurements) | typical |
| `calendar.month-to-week.covered` | view switch to usable content | 500 ms | typical |
| `customers.list.open` | navigation to usable content | 5,000 ms | typical |
| `jobs.list.open` | navigation to usable content | 5,000 ms | typical |
| `planning.occurrence.cross-session` | before submit to visible | 2,000 ms (existing deadline) | Golden world |
| `calendar.month.employee-open-to-event` / `calendar.month.admin-open-to-legacy-event` | navigation to usable content, separately scoped by role and workflow | 5,000 ms each | Golden world |

Current typical benchmark uses fixed date `2026-06-15` through the ordinary calendar URL-date input. Profile as generated: 10 employees, 40 occurrences on every day of its fixed 44-day window (1,760 occurrences, below the 2,000 cap), 4 time entries per employee and workday in the same window, 1,000 customers, 2,500 jobs. Rows are inserted with the admin client in batches inside the group's owned organization and deleted with the world. The larger profile is not generated in this pass; its overflow behaviour is recorded as an explicit limit in the completion record.

### Whole-app coverage map

Discovery counted 43 authenticated `page.tsx` files. Regenerate the inventory from `app/(app)` and `lib/testing/mobile-route-inventory.ts`; include dynamic routes and redirects, not just sidebar entries. Record every route/view family as inspected, measured, changed, unchanged with reason, or deferred with a concrete trigger. An inventory is not a requirement to time every page on every future commit.

| Area | Entry points and important paths |
| --- | --- |
| Authentication and app shell | `app/layout.tsx`, `app/(auth)`, `app/(app)/layout.tsx`, `proxy.ts`, `lib/data/cached.ts`, `lib/org/cookies.ts`, organization/profile/clock/attention providers, sidebar navigation and organization switching. |
| Calendar | `app/(app)/kalender`, `components/kalender/calendar-container.tsx`, `day-view`, `week-view`, `fullcalendar-view.tsx`, navigation/projection helpers in `lib/calendar`, planning/time/absence/settings readers. Cover each actual selectable view, date navigation, member/team filters and month return. |
| Customers and requests | `app/(app)/kunden`, `anfragen`, `components/kunden`, request components, `lib/clients`, `lib/requests`, CRM contacts/sites/timeline/search and follow-ups. Verify actual module locations through imports when a domain uses `lib/jobs`. |
| Jobs and projects | `app/(app)/auftraege`, project/job/detail/handover routes; `components/auftraege`, `lib/jobs`, `lib/planning`, `lib/dispatch`, `lib/work-*`, field work pack, assignments and evidence. |
| Personnel and time | `mitarbeiter`, `qualifikationen`, `zeiterfassung` including time accounts and period details; `lib/personnel`, `lib/time-tracking`, `lib/time-corrections`, `lib/vacation`, `lib/sickness`, `lib/responsibilities`, qualification readers. |
| Documents and inventory | `dokumente`, `inventar`, contextual document sections and pickers; `lib/documents`, `lib/inventory`, `lib/storage/r2.ts`. Include large lists, folders, filters, metadata and signed transfer setup. File bytes retain the direct-storage path. |
| Service | `service/anlagen`, `service/faelle`, `service/wartung`, their details and contextual documents, equipment/service/maintenance readers and due-work calculations. |
| Tasks, templates and settings | `aufgaben`, `arbeitsvorlagen`, dashboard, all settings tabs and their area layouts. Include badge/count recalculation, form hydration, account boundaries, and persisted preferences. |
| Other entry paths | Login/recovery, onboarding, invite/upgrade/error paths and browser back/forward. These share shell/session dependencies even when the authenticated route inventory excludes them. |

## Implementation sequence

### 0. Independent planning pass and baseline design

Reconcile this ledger against current code, live DEV metadata and installed APIs. Inventory cache/read owners, route families and relevant transcript aspects. Add omitted findings with stable `PF-` IDs, merge overlap by reference, and explain rejected hypotheses. Record a short ordered implementation sequence and the exact initial measured cohort here before changing behaviour.

A workload means the records and users a scenario exercises. It prevents an almost-empty database from becoming evidence that the app remains fast after months of use. These profiles are planning assumptions, not customer limits:

| Profile | Proposed synthetic data |
| --- | --- |
| Typical beta example | 10 employees, 40 calendar occurrences on a busy day, 1,000 customers, 2,500 historical jobs and 12 months of time/absence history. Use admin, office and employee sessions plus a foreign organization for denial checks. |
| Larger comparison | 50 employees, 200 daily occurrences, 10,000 customers, 20,000 historical jobs and three years of history. Generate only the subset needed for the measured domain; do not create every possible document byte or open 50 browsers. |

Ask the owner to adjust these when real business size is known. Until then retain the labels as assumptions. Seed deterministic distributions, including long text, empty states, overnight work, concurrent assignments, historical events and realistic active/archived ratios. Record exact row counts and date rules. Start with the typical profile; bound generation and cleanup before the larger comparison. Use local synthetic data, owned fixtures, batch limits, and a cleanup journal. No uncontrolled stress campaign on this laptop or DEV.

The larger calendar example can exceed today's 2,000-occurrence limit: 200 occurrences on every day of a 44-day fetched month window would produce 8,800 records. Before measuring it, define a bounded complete-read strategy or an explicit supported-capacity/error expectation. Do not classify an intentional overflow error as slow rendering, silently truncate the month, or remove the cap without controlling request and payload cost. Record whether daily density means workdays or every day.

Measure cold entry and warm revisit separately, with explicit cache priming, viewport, browser, role, network conditions and build identity. Use a declared small sample schedule for a few representative scenarios, not repeated full test campaigns. Report individual values and median/range for small samples; do not call three runs a meaningful p95. Preserve slow samples and failures.

Exit: route/cache inventories, falsifiable hypotheses, data profiles, provisional budgets and planned groups are recorded. Unknowns have a bounded experiment, not an invented conclusion.

### 1. Extend measurement and deterministic regression protection

Build on `lib/testing/live-observation.ts`, `tests/golden/support/live.ts`, `lib/testing/latency-evidence.ts`, `test-groups.ts`, group qualification and the existing component-browser fixtures. Do not introduce a second campaign runner or require agent-driven clicking through the full catalog.

Use stable scenario IDs and explicit start/end boundaries:

| Boundary | Required meaning |
| --- | --- |
| Action to feedback | Start at the real user action; end when meaningful pending/optimistic feedback is painted. A permanently present spinner is not evidence. Held-response component tests prove feedback does not wait for the server. |
| Action to authoritative result | Include saving and the initiating user's confirmed view, version or record identity. Optimism and HTTP success are intermediate states, not proof of reconciliation. |
| Cross-session visibility | Keep the existing pre-submit→receiving-user-visible total. Intermediate commit/event/read timings must not restart the clock. No receiver navigation, reload, manual refresh or test-only event injection to manufacture freshness. |
| Navigation/opening/switch to usable content | Include the click, route/view transition, necessary data and functioning controls. Visible server HTML can precede hydration; prove the control actually responds. Cover cold and already-visited views separately. |

Existing two-second freshness deadlines remain hard requirements; 15 seconds is a diagnostic ceiling, not acceptance. Preserve P1-22's current five-second readiness requirement. New numeric budgets require scenario definitions and calibration. Proposed planning targets are feedback within 200 ms, a visited same-scope calendar switch within 500 ms, and ordinary warm navigation/authoritative updates within two seconds. Treat these as hypotheses to validate against the declared profile, not silent global constants or permission to widen existing deadlines. Cold entry, heavy exports and uploads need separate measured expectations and honest progress. Resolve a feasibility conflict openly rather than accept today's slow implementation as its own target.

Extend the existing registry/evidence validator to require the expected scenario IDs and boundaries, scenario version, approved budget, environment/data profile, correctness, responsiveness and environment validity. Missing records, caught timing errors, unexpected duplicate records, widened budgets or obsolete scenario versions must fail qualification. Represent intentional repeated samples explicitly. Keep the old evidence schema readable as historical evidence; do not falsely qualify it for new performance contracts.

Add comparable baseline evidence for below-limit regressions. A scenario growing from 500 to 1,900 ms should not disappear behind a two-second pass. Use a reviewed baseline per profile and a calibrated relative **and** absolute tolerance to distinguish meaningful change from clock noise. Freeze the comparison rule before evaluating the candidate. Baseline replacement needs a recorded reason and review, never automatic acceptance of the newest slower run. A missing/incompatible baseline means unverified comparison, not zero regression. Hard deadline failures remain failures even if a later sample is faster.

Store a small versioned baseline summary and provenance beside the existing test configuration, for example a new `lib/testing/performance-baselines.json`. Raw traces and sample artifacts remain in ignored evidence storage. A fresh checkout must retain the reviewed reference values, scenario/profile identity, measurement version, source/build provenance and review reason without requiring a transcript or private log directory. Include scenario definitions, budget/tolerance rules, dataset profiles, baseline summary and validator code in the relevant groups' qualification inputs. Tests must prove that changing any of them invalidates an old pass. Distinguish expected app source changes being compared from a changed measurement/profile that makes comparison invalid. This is one extension of the existing result system, not a second baseline authority.

For deterministic structural protection, prefer query-count/row-bound/payload-size checks and held/reordered response tests when these directly express the defect. Actual wall time belongs in selected real-app checks. Pure calculations and permission assertions need no browser clock. A performance group runs exclusively under the existing lock and recorded production build, with no concurrent build, second verifier or load generator.

Capture diagnostic spans for the selected critical paths: Auth/context resolution, database request count and duration, projection/serialization, response/RSC bytes, event receipt, refresh start and React commit/usable content. Keep causal IDs and monotonic durations; do not subtract unsynchronized server/browser wall clocks. Do not log cookies, tokens, OTPs, names, document contents or SQL parameter values. Diagnostics must be bounded and disabled or sampled appropriately in production. Browser long tasks, LCP/INP/CLS and bundle size supplement workflow measurements; a synthetic audit is not real-user percentile evidence.

Exit: the real P1-11 eventual-visibility check is retrofitted; required measurement omissions fail; controlled response-order tests demonstrate the relevant failures; the initial cohort has baseline evidence and explicit limits. Do not rewrite all tests first.

### 2. Calendar state and data correctness

Start with PF-01 through PF-06. Use controlled promises to reproduce wider→narrower→wider and A→B→A transitions while requests resolve out of order. Include one dataset failing while another succeeds, successful empty results, delayed settings, failed refresh, retry, organization/account changes, suspension during editing and unmount.

Choose the smallest coherent data owner. A typed snapshot can track identity, range, required dataset completeness and generation, or independent datasets can track their own coverage with a composed ready state. Do not maintain both as competing sources of truth. Cache only bounded, correctly scoped ranges; define merge, overlap, invalidation and eviction explicitly. Invalidate warm ranges when relevant mutations occur. Returning to a previously visited view must not show a stale authorization scope or silently skip missing data.

Keep valid same-scope content while refreshing and mark staleness on failure. Newly requested uncovered dates need an honest loading state; old events must not masquerade as the new range. Clear previous organization/user-sensitive data immediately when scope changes or access is revoked. Disable operations that require unavailable fresh facts, while retaining allowed navigation and recovery. Initial snapshots and later reads must apply the same approved/provisional/legacy/canonical projections.

Replace calendar-specific event-drop timestamps with mutation-scoped suspension and a dirty/catch-up state. Ensure one mutation finishing does not release another mutation's ownership. Events arriving during a dialog or optimistic action must lead to a final authoritative read. Preserve filled dialogs when correctable validation can still fail. Cover time corrections, closure days, absence, occurrences, dispatch, member/lifecycle changes and deletion in second-session proofs.

Profile all actual calendar renderers, not only the month library. Preserve date position, scroll, filter and keyboard/focus behaviour where identity is unchanged. Test month/year boundaries, Berlin DST, overnight time, recurrence exceptions, overlapping assignments, parked work and employee-visible subsets. The apparently unused custom month view is a cleanup candidate only after a complete caller search.

Exit: user-reported switching class has a reproducible test and passing repair; no lost updates or mixed-scope retention; representative warm switches and calendar freshness meet the recorded contracts.

### 3. Shared Realtime, cache policy and rendering

For every cached reader, record its data owner, caller authorization, key dimensions, lifetime, invalidating mutations, cross-user signals, failure behaviour and proof. Include request memoization, server cache, PPR/static output, client router cache, retained component state, HTTP/CDN behaviour and signed file URLs as distinct layers.

Do not put cookie-bearing clients or authorization decisions inside a shared cache. Authenticate and establish current permission before returning sensitive cached data. A role string in the key alone does not handle reassignment or revocation. Test warmed reads after role downgrade, removal, scheduled lifecycle change, assignment change, account switch and organization switch. Test old in-flight responses after scope change. Preserve whole-DOM negative assertions because hidden retained content still matters for privacy.

Migrate `unstable_cache` to `'use cache'` only where it simplifies and clarifies the intended policy with installed-version support. A blanket syntax migration is not a performance outcome. Give chosen cache lifetimes and tags explicit owners. Distinguish same-user `updateTag` read-after-write semantics from route-handler revalidation and other users' event-triggered reads. `router.refresh()` does not invalidate server caches by itself. Verify DB commit→tag expiry→event→read ordering rather than rely on a lucky debounce delay.

Audit shared refresh fan-out, cross-table coalescing, sustained bursts, focus/visibility, reconnect, token rotation, dialog suspension, own-write reconciliation and protected deletion. Add real hook/component tests for generation rejection and catch-up; pure event-normalizer tests do not establish these compositions. If changing debounce, measure the total user deadline and introduce bounded maximum delay where necessary. Preserve current confidentiality and minimal payloads. Do not migrate to Broadcast, polling or another transport without measured need and equivalent private authorization/revocation proof.

For PPR/SSR, trace what blocks useful content before adding Suspense. Stream independently useful authorized sections; preserve persistent page headers and section geometry. Avoid making each section independently repeat identity, memberships or shared lookups. Optional attention counts should not unnecessarily delay usable primary content, but failed counts must not look like confirmed zero. Preserve the distinction between server props that seed a live reader and props-driven surfaces that remain authoritative. Resolve this in the shared owners and docs before optimizing consumers.

Review route prefetch, back/forward, hydration, skeleton flash, warm retention and optional dialog loading. Do not prerender user data into a public shell or enable public cache headers on authenticated HTML/RSC. Plan the script-CSP decision alongside PPR: verify nonce/hash/asset compatibility, error cases and the actual output. If a safe policy requires different rendering, security takes priority. Record a justified owner decision for any remaining deferral.

Exit: changed caches have a complete invalidation/permission proof; shared refresh has bounded behaviour; useful-content and receiving-session measurements improve on comparable profiles without weakening security.

### 4. Database reads, payloads and client work across all areas

Work through the coverage map, prioritizing measured cost. For each changed reader, compare query count, rows scanned/returned, payload bytes and total user-visible time. Use local representative fixtures and `EXPLAIN` or bounded `EXPLAIN ANALYZE` on safe SELECTs with the real role/filter shape. Avoid executing privileged mutation RPCs under ANALYZE. Record parameters as non-sensitive scenario definitions, not customer values.

Use existing indexes before adding new ones. Evaluate organization/date/user composite predicates, sort/cursor shapes, RLS helper cost, permission pushdown and dependent lookup batches. Preserve index/transaction write cost, locks, time/event immutability and idempotency. Do not remove validation or add another database/read replica to avoid understanding an expensive query. Supabase HTTP clients use PostgREST; changing a raw database pooler URL does not tune those calls.

Bound expensive list/detail/history reads and replace per-row request loops where found. If adding pagination, retain complete authorized search, stable sorting, selection, aggregate counts, exports and keyboard/mobile access. Do not silently cut off customers or jobs at a new limit. Large selectors may need a reviewed server search rather than transferring an entire organization. Keep long exports/storage bytes off the interactive request path according to the settled infrastructure decision; add workers only for a demonstrated long-running workload.

Profile browser projection, FullCalendar event updates, table rendering, large forms, scroll and retained subscriptions. Memoize or index demonstrated repeated work; `async` does not move CPU work off the main thread. Evaluate virtualization only with accessibility, focus, search and drag behaviour preserved. Inspect actual route chunks, optional modals, image sizes, font delivery and compression/cache headers. Do not presume gzip, memoization or a library replacement is missing just because a transcript recommends it.

Run a bounded navigation/view-switch cycle to check retained listeners, timers and memory growth. Investigate stable growth with allocation/resource evidence; browser memory noise alone is not a leak diagnosis. Keep cancellation and total timeout budgets for reads. Never automatically retry a write with an uncertain completion outcome.

Exit: every route family has a disposition, measured bottlenecks have before/after evidence, larger-profile limits are explicit, and no optimization silently removes functionality.

### 5. Enforcement, documentation and independent review

For each kept finding, record its strongest practical prevention:

| Tier | Required use in this pass |
| --- | --- |
| Tier 1 | Scoped read/range APIs, truthful typed state, request generations, bounded queries, current authorization before reuse, shared pending/settlement and centralized invalidation. Make the specific invalid state hard to express. |
| Tier 2 | Actual response-order and scope-reset tests, exact invalidation/permission cases, stable measured-scenario coverage, hard budgets and reviewed baseline comparison, input-qualified evidence, exclusive timing execution, relevant SQL and browser contracts. |
| Tier 3 | Representative data and budget rationale, visual judgment, dependency-impact review, uncertain environment classification, and any boundary that cannot be enforced safely by code. Explain why it remains judgment. |

Do not invent a universal framework to eliminate every conceivable bug. A static helper-name check does not prove authorization order or correct invalidation; pair it with behavioural evidence. No check can guarantee a new agent never writes a defect.

Update permanent guidance in [Realtime and caching](../../../technical/realtime-and-caching.md), [testing](../../../technical/testing.md), [architecture](../../../technical/architecture.md), [security](../../../technical/security.md), affected feature baselines, the roadmap, and both relevant skill mirrors. New rules become current only when implemented and checked. Use a new decision or dated amendment only for a real architectural change to existing decisions. Keep the existing-test repair manual aligned so a fresh agent fixes older tests using the new measurement and ownership contracts.

Reconcile [the enforcement backlog](../../../technical/enforcement-ladder-backlog.md) against implemented checks. Do not reimplement catalog hashes or coverage mapping already enforced by `coverage-map.ts`. Avoid stronger claims than the checks establish. During planning, stale architecture route prose and an omitted protected-deletion trigger in the final Realtime recipe were corrected. The `use-live-view.ts` comment attributing DELETE shape to replica identity remains a source-comment correction for the hook work; the shape actually comes from protected notification normalization.

Review the final diff with CodeRabbit and an independent agent after the principal changes stabilize. Classify findings as fix, disproved, accepted limitation or owner decision, with evidence. Keep the review and dispositions in this file, not another permanent review plan. Close this file with a dated acceptance record only after all selected requirements pass.

## Verification and cost control

Use `bun run test:plan` to understand impact before selecting the owner's hardening subset. Record why broad selector output is sampled at this checkpoint; do not weaken dependency ownership to shrink it. `test:verify --group ...` proves only its named scope. Full catalog coverage remains required even for groups not executed during Step 2.

Always include these existing cheap groups in final Step 2 verification:

```text
static:dependencies,static:typecheck,static:lint,static:docs,static:coverage,
unit:all,sql:p1-21,sql:p1-22,sql:p1-23,sql:p1-24,sql:security,ui:contracts
```

Initial browser acceptance selection, to refine against the actual changes:

| Existing group | Required reason |
| --- | --- |
| `golden:gg-00` | Real customer mutation and cross-session freshness, including the nearly exhausted deadline. |
| `golden:p1-11`, `audit:wave-1:a6` | Occurrence planning, recurrence, capacity, role visibility and the missing calendar timing retrofit. |
| `golden:p1-12`, `audit:wave-1:a7` | Dispatch, rescheduling, acknowledgement and customer commitments reflected in calendar. |
| `audit:wave-2:p1-22` | Correction readiness, authoritative time updates and calendar projection changes. |
| `audit:layout` | Changed streaming/skeleton/route geometry and phone layouts, including registered details. |

Add a small **new proposed** registered group, such as `audit:performance:calendar`, for rapid view/range switching and bounded representative navigation when no existing group owns those cases. Define independent fixture ownership, measured scenario IDs, application inputs and exclusive scheduling in the existing registry. This name is not executable until implemented. Prefer controlled component tests for permutations and a few real-app integration cases over multiplying long browser scenarios.

Add these existing groups when their actual boundary changes: `audit:wave-1:a1` for document/inventory/baseline work integration; `audit:wave-1:a3` for personnel; `audit:wave-1:a4` for absence/time; `golden:p1-10` for follow-up freshness; `golden:p1-18`/`p1-19` for equipment/service; `golden:p1-24` and the affected Wave 2 audits for protected personnel, field work pack, time projection or periods; `audit:security:account` for account/shared submission changes. If extracting calendar cases from A1, preserve every clause mapping and dependency and prove that nothing was dropped or duplicated. Do not restructure A1 merely to avoid one necessary run.

Run `canary:providers` on a recorded DEV build for the existing C3 freshness boundary. Run `canary:security` for the planned shared Realtime/auth changes. A failed provider freshness check remains open even if all local checks pass. Schema changes also require migration/type/Realtime parity and the specific SQL assertions. Local-to-cloud switching requires a new recorded build; do not compare timings from mismatched environments.

The full integrated Golden plus every release-required audit group and complete cloud canary run at final acceptance after Step 3. Do not perform that full battery repeatedly during Step 2. Reuse qualifying unrelated results; timing-sensitive groups remain exclusive. Classify and investigate a failure before retrying, preserve its artifacts and cleanup state, and obey [the repair manual](../../../technical/testing.md#repair-an-existing-test-under-the-current-workflow). Never widen a deadline, delete a slow sample, remove a scenario, or reset the failure history to obtain green.

## Transcript consideration and disposition

`temporary-transcripts/README.md` owns the aspect-level convention. Planning reviewed all nine aspect files: 230 sources, 1,144 recorded aspects; 50 relevant raw sources were reread including captions. The inventory passed with four URL-only inbox/history files excluded. This establishes indexed-aspect triage and focused source verification, not viewing every video or recovering absent visuals. New files must be reconciled before implementation acceptance.

Research families considered across all buckets:

| Work in this plan | Research trace, not implementation authority |
| --- | --- |
| Measurements and feedback | PERF-001.03/.04, PERF-002.04, TERM-024.01, TERM-028.01–.03, INFRA-009.01/.02/.04; UX-007 through UX-017 and UX-023/024 for relevant loading, pending and hydration aspects. |
| Cache identity and retained content | PERF-001.05, PERF-003.01/.02, TERM-012.01–.04, SEC-010.01–.03, UX-001.03, UX-005.01, UX-008/009/016. |
| Data bounds and query work | PERF-002.01, PERF-003.03–.05, INFRA-013.02, DB-007.01–.04, TERM-004/006/013/017, SEC-005.01, SEC-038.07, SEC-039.16. |
| Browser rendering and resources | PERF-001.01, PERF-002.03/.05, TERM-010/018/019/021/026, ENG-005/019, PRACTICE-004.02/.19/.20. |
| Volume, dependency failure and diagnostics | DB-001/006, TERM-016/025, INFRA-008/009/013/014, PRACTICE-008.02, SEC-014.03/.04, SEC-022.17, SEC-027.10, SEC-042.03/.04, PG-018/036. |
| Security/rendering and durable development | SEC-008.02, SEC-035, SEC-044; ENG-003/013/016/019/021, PRACTICE-003, PG-034, GRAPH-009/010 for relevant evidence and handoff aspects. |

Each source contains other ideas with independent dispositions. Update only the individual aspect after checking current code/database/docs. Candidate means investigate; Deferred needs a reason and revisit trigger; Adopted/Already covered needs dated, scoped canonical evidence. Planned work is not adoption evidence. Keep unsupported visual material as Verify, notably TERM-019.02's screen-only prompts and TERM-021.03's shown cache values.

Retain explicit deferrals or rejections: read replicas and lag handling require an actual replica topology; database/provider replacement, tenant-specific extension frameworks and workers require a demonstrated need; AI/voice/RAG performance remains Phase 2; PostHog/session replay needs privacy and cost decisions. Reject fake progress, generic last-write-wins for operational data, indexing every filter, caching every read, removing all fallbacks, treating `async` as CPU offload, and pointing HTTP Supabase clients at pooler URLs. Marketing/native-app/commercial suggestions retain their existing scope. Do not close an entire video because one idea is already implemented.

The plan's requirements come from observed app behaviour, product contracts, retained failures and verified technical sources. The transcripts provide prompts to investigate, never the canonical reason a control exists.

## Technical references checked during planning

Recheck behaviour against the installed versions before implementation. Official documentation can change after this plan.

- [Next.js caching and streaming](https://nextjs.org/docs/app/getting-started/caching): cached work and request-time streamed sections have distinct lifetimes; a Suspense boundary alone does not guarantee useful early content.
- [Next.js updateTag](https://nextjs.org/docs/app/api-reference/functions/updateTag) and [useRouter](https://nextjs.org/docs/app/api-reference/functions/use-router): immediate tag expiry in Server Actions differs from refreshing the client route and from background revalidation. Preserve that distinction in the invalidation tests.
- [Next.js lazy loading](https://nextjs.org/docs/app/guides/lazy-loading): optional client components can load separately; confirm actual chunks and hydration before claiming a benefit.
- [Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization) and [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): inspect plans and permission predicates with representative data. Index existence or privileged-query speed alone is insufficient.
- [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes): subscriber authorization and ordered processing affect throughput. Measure before changing transport; preserve Step 1's deletion fix.
- [Web Vitals](https://web.dev/articles/vitals): loading, interaction and layout stability complement app-specific workflow timing. Field percentiles require actual representative observations.

## Completion record

Step 2 is ready for independent review only when:

- Every initial and added finding has a disposition, source change or disproving evidence, prevention tier, and remaining limit.
- Every route family and relevant research aspect has a recorded consideration; no unreviewed new transcript source is hidden by an old inventory pass.
- Calendar switching, fresh remote updates, initial data parity and scope resets have direct passing proofs.
- The selected measurements meet their declared contracts and below-limit comparisons pass. A disclosed unresolved comparison may be handed to a reviewer for a decision, but it blocks green performance acceptance unless the owner explicitly changes that requirement with its risk recorded. No missing baseline is labelled a successful comparison.
- All required cheap/selected browser/provider groups have qualifying results for final inputs. Record exact reports, build/environment identity, dataset, metrics, failures, cleanup and deliberately unrun groups here.
- Security denial, integrity, private deletion, signed-file and account guarantees still hold. Remaining CSP/provider/customer decisions are explicit and have owners.
- Current docs, feature baselines, skills and the test repair manual agree with the implementation. `docs:check`, transcript inventory and diff checks pass. Historical records remain historical.
- CodeRabbit and independent review findings are dispositioned. No owned test world, lock, temporary logger or competing runtime is abandoned.
- Commit/publication state and coordinated rollout requirements are stated. The owner receives an honest before/after account, remaining limitations and the next Step 3 decision, without a claim of permanent regression immunity.

### Historical first-implementation record (2026-09-08)

Implemented in the same uncommitted working tree as the Step 1 repairs; nothing was reset, stashed, or published. All work ran against the local Supabase stack and the recorded local production build. No DEV or PROD mutation, no rerouting, no commit.

#### Historical findings ledger dispositions

| ID | Disposition | Change | Prevention tier | Remaining limit |
| --- | --- | --- | --- | --- |
| PF-01 | Fixed | `getCalendarFetchRange` in `lib/calendar/navigation.ts` builds every view's window through the Date constructor; the container no longer computes a range. | Tier 1 (one window function) and Tier 2 (`navigation.test.ts`: month, year, leap-day, both Berlin DST switches, Sunday weeks, coverage). | The browser's local timezone decides the window; a user outside Europe/Berlin sees a window of their own local days, as before. |
| PF-02 | Fixed | `lib/calendar/range-data.ts` tracks coverage, generation, and read outcome per dataset; readiness is derived per needed window for the datasets the view draws. | Tier 1 (typed state, derived readiness) and Tier 2 (`range-data.test.ts`: A→B→A, wider→narrower→wider, partial failure, empty result, mutation ownership, scope reset, generation monotonicity). | Coverage is one window per dataset; a previously visited window outside the current one is read again, not cached. |
| PF-03 | Fixed | `components/kalender/use-calendar-range-data.ts` is the one owner; the live-view adapters return the real read outcome. | Tier 1. | The adapters still return `null` data; the hook's own `isStale` is redundant with the owner's readiness and is not rendered. |
| PF-04 | Fixed | Mutation ownership through `beginMutation`, which returns an operation-owned idempotent release used in `finally`; transport failures and Undo follow the same ownership. Events queue through `suspend`; unrelated refresh callbacks cannot decrement another operation. The last release schedules an authoritative read. | Tier 1 (no event filter can drop a domain event any more). | A same-range read started by the queued Realtime catch-up and by the settlement coalesce through in-flight reuse; two reads can still occur when their ranges differ. |
| PF-05 | Fixed | `time_correction_requests` joins the time subscription; `organization_closure_days` joins the route refresh; absence readers take the rendered window (`parseIsoDateRange`, at most 400 days) and the month view gates on them. | Tier 1 (bounded range parameter) and Tier 2 (`date-range.test.ts`). | Second-session browser proofs for corrections and closure days come from the existing `audit:wave-2:p1-22` and `audit:wave-1:a4` groups, not from a new dedicated test. |
| PF-06 | Fixed | The server payload carries the provisional entries and the exact Berlin range; the client seeds coverage from it. | Tier 2 (`business-range.test.ts` proves the server window equals the browser window for Berlin users). | None for the first paint: the page also reads the pending change requests of the prefetched entries (CodeRabbit finding 4), so badges are present before the join catch-up. |
| PF-07 | Partly fixed | `components/kalender/month-view/month-view.tsx` deleted after a caller search. FullCalendar remains the month renderer; its lifetime is unchanged. | Tier 3 (removal). | Month event projection was not profiled beyond the measured switch times below. |
| PF-08 | Fixed and bounded | The first performance run at the typical profile failed every week and month read: `loadPlanningCalendarEntries` read job context with one `.in('id', jobIds)` for about 360 jobs and the local gateway answered "URI too long" (run `2026-09-08T113344072Z-57b638`). Batching the id lists fixed the failure but left the month window at about 25 dependent requests (assignments in 100-id batches, jobs, clients, projects) and 2,697 ms for the complete 1,760-occurrence window (run `2026-09-08T121653571Z-c3aa2d`). The loader now embeds assignments, job, client, and project through PostgREST relations, so a window is at most two paged requests; rows are parsed at the boundary with a zod schema because supabase-js cannot infer aliased embeds. Employees filter through an inner-joined alias of the assignment relation and still see every assignee. The 2,000-occurrence and 10,000-assignment caps are unchanged. See PF-19 for the time read. | Tier 1 (one embedded read, boundary schema) and Tier 2 (the performance group proves the week and month reads at 40 visits per day; `golden:p1-11` and `audit:wave-1:a6` prove role visibility). | No `EXPLAIN` was run; the measured navigation values are the only evidence. The dispatch overview keeps its 500-occurrence cap over 14 days, which the typical profile (560) exceeds; it is not a measured scenario and is recorded below as a limit. |
| PF-09 | Fixed | The app layout no longer awaits `getAttentionCounts`; the provider reads once after mount and stays event-driven. | Tier 1 (the layout cannot block on the derivation). | The badge is empty until the first client read completes; a failed first read shows no badge, as before. |
| PF-10 | Measured | Lists unchanged apart from PF-21. | Tier 3 (measured values below). | Both lists still transfer the whole organization. |
| PF-11 | Accepted limitation | No cache reuse was extended; the reader inventory in the freshness reference records every cross-request cache with its key and invalidation. | Tier 3 (inventory). | Direct dashboard changes reach the app through the 300-second fallback, as before. |
| PF-12 | Fixed | `createTrailingScheduler` with `REALTIME_MAX_DEFER_MS` (1,000 ms) in the provider and both hooks. | Tier 1 and Tier 2 (`scheduler.test.ts`). | The bound is a design value; no burst workload was measured. |
| PF-13 | Unchanged | GG-00 remains a required group of this pass; its local value is recorded below. | Tier 2 (existing deadline). | The cloud C3 value was not remeasured in this pass. |
| PF-14 | Fixed | The three 20-second waits in `tests/golden/p1-11.spec.ts` became `expectScenarioLiveWithin` (cross-session, keeps the two-second archive) and `expectUsableWithin` (month open to event). | Tier 2 (registry-validated records). | The first team creation keeps a plain visibility assertion because its warning is not guaranteed. |
| PF-15 | Fixed | Scenario registry, versioned baseline file, comparison rule, third evidence archive, validator, group requirement derivation, and browser attribution. | Tier 2. | Server spans are not recorded; attribution is browser-side only. |
| PF-16 | Corrected in review | Authenticated routes can have a generic prerendered shell with dynamically authorized personal data. The build manifest disproves the original blanket claim that cookie reads disable PPR. | Tier 3 security control map; inspect the actual release shell and streamed scripts when introducing script CSP. | A script policy remains absent, explicitly owned by Step 3. |
| PF-17 | Fixed | `lib/calendar/business-range.ts` computes the prefetch window in Berlin wall time. | Tier 2. | Non-Berlin browsers read again on mount, by design. |
| PF-18 | Fixed | The unconditional mount refetch is gone; the provider's first-join catch-up is the single convergence read. | Tier 1. | The join catch-up also reads the two absence datasets on entry to a day view. |
| PF-19 | Fixed | `lib/time-corrections/pending-projection.ts` reads pending requests, subject-filtered, with current revisions only, through a port the tests count. | Tier 1 and Tier 2 (`pending-projection.test.ts`). | The 300-row bound of the old reader is kept as an operational-anomaly limit. |
| PF-20 | Measured, partly fixed | Layout no longer waits for the derivation (PF-09), and the badge reads through a route handler so the derivation no longer occupies the client's action queue (PF-29). The derivation itself is unchanged. | Tier 1 (the queue cannot hold it) and Tier 3 (backlog row for a lighter path). | The derivation still costs about 800 ms per read on the local stack and runs on every debounced event and channel join. |
| PF-21 | Fixed, class inventoried | `app/(app)/auftraege/page.tsx` reads assignments by organization and surfaces a failed read; the planning loader's job, client, and project context and the attention and dispatch job lookups with the largest upstream bounds read in batches (see PF-08 for the reproduced failure). | Tier 1 (`readInBatches`) and Tier 2 (`audit:performance` asserts the assignee renders at 2,500 jobs). | Fifteen `.in(...)` id-list reads remain across attention, time tracking, vacation, dispatch, documents, work handover, corrections, and jobs; their upstream lists are small today (assigned jobs of one person, artifacts of one job) but only three carry an explicit limit. The backlog carries a scan candidate. |
| PF-22 | Fixed | `data-calendar-state` and `UsableContent` markers written from effects. | Tier 1 (effects cannot run before hydration). | A marker proves commit and coverage, not that every control inside the region works. |
| PF-23 (added during implementation) | Partly fixed, rest deferred | The trace of run `2026-09-08T114036656Z-01d5a1` shows that Next.js runs one client's Server Actions one after another: the day-to-week switch's two range reads (about 600 ms together) waited behind six unrelated reads that the Realtime join catch-up had just fanned out to every subscribed view (parked jobs, parking contexts, dialog options, active jobs, clock state, attention counts at 513 ms), giving 2,026 ms end to end. The calendar itself issued four range actions per refresh; `getCalendarWindow` (`lib/calendar/actions.ts`) now reads all four datasets in one action, and the data owner subscribes once for every calendar table. The catch-up is correct gap recovery and stays. | Tier 1 (one action per surface refresh) and Tier 3 (the attribution in each scenario record exposes the request count). | The fan-out cost per join is still the sum of every other subscribed view's read on the page; a lighter attention read (PF-20) and lazier optional reads (PF-24) are the remaining levers. No priority queue exists for user-initiated reads. |
| PF-25 (added during implementation) | Fixed for the calendar, both list pages, and the entry-dialog options; class recorded | PostgREST returns at most the project's `max_rows` (1,000 in `supabase/config.toml` and by default on hosted projects) and truncates silently. Against the retained performance world (`2026-09-08T120750825Z-76f8d0`) a plain read returned 1,000 of 2,500 jobs and 1,000 of 1,760 planning occurrences: the month grid and the job list were incomplete without any error, and the loader's 2,000-row overflow check could never trigger. `readAllRows` (`lib/supabase/query-batches.ts`) reads 1,000-row `range` pages up to a declared cap and reports an overflow; the planning window keeps its 2,000 cap and the list pages and pickers use `LIST_ROW_CAP` (10,000) with a visible error block above it. | Tier 1 (paged complete read with explicit overflow) and Tier 2 (`query-batches.test.ts`; the performance group asserts 2,500 rendered jobs and 1,000 customers). | Every other unpaged organization read (attention derivations with `.limit(1001)` or `.limit(5001)`, the customer detail, documents, inventory) still stops at 1,000 rows silently; their explicit limits above 1,000 are unreachable. The backlog carries a scan candidate; the hosted `max_rows` setting is an owner-visible provider setting that was not changed. |
| PF-26 (added during implementation) | Original repair superseded | Calendar read ownership now records causal invalidation and completed scope/generation coverage. An old read or failed read cannot suppress a later reconnect refresh. | Tier 1 scoped owner and Tier 2 actual provider/hook race checks. | Final candidate verification is recorded in the independent review section. |
| PF-24 (added during implementation) | Original deferral superseded | Removed whole-organization calendar picker prewarming and its session cache. Authorized server search returns at most 50 options, supports continuation, and hydrates selected identities within the current organization/user/role. | Tier 1 bounded search/selection contract; Tier 2 actual shared-control/hook tests and large-organization browser coverage. | Final candidate verification is recorded in the independent review section. |
| PF-27 (added during verification) | Fixed | The first browser battery (`2026-09-08T123622581Z-b022e48e`) failed `audit:wave-1:a6` and `golden:p1-11`: the range owner reported `loading` for every uncovered window and the container replaced the grid with the skeleton on each month step, so the shared `showPlanningMonth` step found no month cells. Before Step 2 the skeleton appeared only while no data existed. `presentDataset` now distinguishes `reloading` (data for another window) from `loading`; the grid stays mounted and `aria-busy` while the window loads, and the skeleton is reserved for the first open, the first month open, and an organization switch. | Tier 1 (the readiness type carries `hasData`) and Tier 2 (`range-data.test.ts` composition cases; the golden month steps exercise the navigation). | Old entries of an overlapping window stay visible while the new window loads; the busy state and the dimmed grid mark them as not yet authoritative. |
| PF-28 (added during verification) | Repaired in independent review | The first implementation restored a console line that GG-00 depended on. The repair moves GG-00 to the provider's persistent `html[data-realtime-state="subscribed"]` marker and removes the organization id from the diagnostic message. | Tier 1 stable state marker, Tier 2 GG-00 observes that state before its unchanged freshness assertion. | Fresh GG-00 execution remains required. Log wording no longer governs receiver readiness. |
| PF-29 (added during verification) | Partly fixed, rest disclosed | The second battery (`2026-09-08T164244939Z-82463c62`) passed the readiness repair but measured three cross-session freshness scenarios over the two-second contract (GG-00 customer list 2,553 ms, P1-11 planning 2,597 ms, P1-12 dispatch 2,096 ms; the same build measured P1-12 at 1,509 ms earlier that day). The trace of run `2026-09-08T170426578Z-85a08a` shows the cause: the observing page had just mounted, its channel join fanned out `getAttentionCounts` (848 ms), `getCurrentClockState` (261 ms), and `getActiveJobIdsForOrg` (115 ms), and the customer list's router refresh waited behind all three in the client's action queue (PF-23). The attention badge now reads through `app/api/attention-counts/route.ts`, a route handler that delegates authorization to `getAttentionCounts` and runs beside the queue; the provider parses the response at the boundary. | Tier 1 (a fetch cannot occupy the action queue) and Tier 2 (`route-inventory.test.ts` names the handler's authorization; the three golden freshness measurements). The third battery still measured P1-11's planning freshness at 2,587 ms: the trace of run `2026-09-08T174800432Z-603147` shows the observing page re-reading the clock state (609 ms) for the `jobs` update that every planning save performs, ahead of the 653 ms calendar read. The clock-state provider now filters `jobs` events to the running session's job (`lib/time-tracking/clock-state-events.ts`, unit-tested). | Tier 1 (a fetch cannot occupy the action queue; the filter is a pure function) and Tier 2 (`route-inventory.test.ts`, `clock-state-events.test.ts`, the three golden freshness measurements). | The active-job picker read still queues on `jobs` events (about 100 ms); `getCalendarWindow` costs about 650 ms on the local stack even for a Golden-world day because each of its four readers authenticates on its own, which is the next reduction. The freshness contract on this workstation stays within a few hundred milliseconds of its deadline. |

#### Historical first-implementation measurements

Recorded below from the `audit:performance` and Golden runs of this pass. Profile "typical" is the seeded organization of `tests/audit/support/performance-profile.ts`; profile "golden-world" is the ordinary Golden seed. Values are single samples on this workstation against the recorded local build; they are calibration evidence, not p95 claims.

Final values from the last verification (`2026-09-08T175856993Z-986a46b1`), build `16db84ca-06ae-42b4-9a7a-fb6abcbf4cb0`, local Supabase (`backend: local`), Chromium, one sample per scenario: runs `…-4cb9af` (calendar), `…-baa7a5` (lists), `…-dfd9a1` (GG-00), `…-23ec43` (P1-11), `…-54408c` (P1-12). Earlier runs of the same day are listed where they changed a decision.

| Scenario | Profile | Budget | Measured | Status |
| --- | --- | --- | --- | --- |
| `calendar.day.cold-open` | typical | 5,000 ms | 1,151 ms | within budget |
| `calendar.day-to-week.uncovered` | typical | 2,000 ms | 923 ms | within budget |
| `calendar.week-to-day.covered` | typical | 500 ms | 114 ms | within budget |
| `calendar.week-to-month.uncovered` | typical | 3,000 ms (version 2) | 1,780 ms | within budget |
| `calendar.month-next.uncovered` | typical | 3,000 ms (version 2) | 1,549 ms | within budget |
| `calendar.month-to-week.covered` | typical | 500 ms | 215 ms | within budget |
| `customers.list.open` | typical | 5,000 ms | 3,535 ms | within budget |
| `jobs.list.open` | typical | 5,000 ms | 5,402 ms (5,830 to 6,972 ms across the four batteries) | over budget, disclosed (see PF-25 and the limits below) |
| `planning.occurrence.cross-session` | golden-world | 2,000 ms | 2,605 ms (2,587 to 2,605 ms across three batteries) | over the freshness contract, disclosed (PF-29 and the limits below) |
| `calendar.month.open-to-event` | golden-world | 5,000 ms | not recorded | P1-11 stops at the failed freshness step before its month opens |

Before and after, same workstation and profile:

| Scenario | Before the loader and action changes | After | Run before, run after |
| --- | --- | --- | --- |
| `calendar.day-to-week.uncovered` | 2,026 ms (Server Action queue behind six catch-up reads, PF-23) and 3,643 ms under a second catch-up storm (PF-26) | 923 ms | `…-01d5a1`, `…-0ce98b` → `…-4cb9af` |
| `calendar.week-to-month.uncovered` | failed ("URI too long", PF-08) and then 2,697 ms with batched id lists | 1,780 ms (2,396 and 2,435 ms in two other batteries) | `…-57b638`, `…-c3aa2d` → `…-4cb9af` |
| `jobs.list.open` | 4,688 ms while PostgREST silently returned 1,000 of 2,500 jobs (PF-25) | 5,402 ms for the complete list | `…-76f8d0` → `…-baa7a5` |
| `customers.list.open` | 4,747 ms (1,000 of 1,000 customers; the cap was not reached) | 3,535 ms | `…-76f8d0` → `…-baa7a5` |
| `calendar.day.cold-open` | 1,808 ms with the attention derivation in the client action queue | 1,151 ms with the derivation on the route handler (PF-29) | `…-8c928d` → `…-4cb9af` |
| GG-00 customer list cross-session | 1,999 ms on the pre-Step-2 build (08:54 the same day) and 2,553 ms after the layout change (PF-09) put the derivation in the queue | 1,438 ms | `…-1fb233`, `…-85a08a` → `…-dfd9a1` |

Historical first-implementation result, superseded by the pagination repair: the jobs list got slower because it was then complete: the earlier value rendered a truncated list. Every calendar scenario is inside its provisional budget after the consolidated `getCalendarWindow` action, the embedded planning loader, the scoped join catch-up, and the once-per-session dialog prewarm.

GG-00 local value from this pass: 1,438 ms against the 2,000 ms contract (`…-dfd9a1`); P1-12 dispatch state cross-session 1,540 ms (`…-54408c`).

Historical first-implementation baseline decision, superseded by the required calibration and activation sequence below: `lib/testing/performance-baselines.json` stayed empty and every scenario stays `calibrating`. One sample per scenario on one workstation is not a reviewed baseline, and the comparison rule (25 percent relative and 250 ms absolute, whichever is larger) would turn the ordinary run-to-run spread of this day (day-to-week between 917 ms and 991 ms, week-to-month between 1,778 ms and 2,435 ms on one build) into false regressions. The first reviewed baseline should come from the release-mode run after Step 3 with the two samples the registry requests for the cold open, and it should be recorded together with the build and backend identity the archive already carries. Until then the validator reports the comparison as unverified, which does not count as a passing comparison.

#### Historical first-implementation verification

Selection agreed with the owner for this pass: the cheap groups, the two new performance groups, the golden and audit groups that own the touched calendar, planning, dispatch, time-correction, customer, and layout behaviour, and no cloud canary. The full browser battery runs after Step 3. The same 23 groups ran four times as the pass converged; every run used the recorded local production build and the local Supabase stack.

| Report | Build | Outcome | What changed before it |
| --- | --- | --- | --- |
| `2026-09-08T123532932Z-2b2474ed` | `9eaacc99…` | Interrupted by the operator in `static:typecheck` (Bash background ceiling); closed as failed, its stale lock archived as `.agent-logs/interrupted-verify-20260908T1235.lock.evidence`. | Nothing ran beyond `static:dependencies`. |
| `2026-09-08T123622581Z-b022e48e` | `9eaacc99…` | 18 passed, 5 failed: `audit:wave-1:a6` and `golden:p1-11` (PF-27), `golden:gg-00` (PF-28), `audit:performance:calendar` (2,435 ms month switch against the 2,000 ms hypothesis), `audit:performance:lists` (jobs list). | The Step 2 implementation. |
| `2026-09-08T164244939Z-82463c62` | `5bb2adf7…` | 19 passed, 4 failed: `audit:performance:lists`, and `golden:gg-00`, `golden:p1-11`, `golden:p1-12` over the two-second freshness contract (PF-29). | PF-27, PF-28, the month budgets, and the ten CodeRabbit fixes. |
| `2026-09-08T172132419Z-43dd645c` and `2026-09-08T174252587Z-f0189e5a` | `5bb2adf7…` (attention route) | 18 passed across both; `audit:performance:lists` failed on the jobs list; `golden:p1-11` failed at 2,587 ms. The first report blocked the golden groups because the lists group's retained world from the previous run had not been cleaned; the second ran the five remaining groups after cleanup. | The attention-count route handler (PF-29). |
| `2026-09-08T175856993Z-986a46b1` (final) | `16db84ca-06ae-42b4-9a7a-fb6abcbf4cb0` | 21 passed, 2 failed: `audit:performance:lists` (jobs list 5,402 ms, disclosed design limit) and `golden:p1-11` (planning freshness 2,605 ms, disclosed unresolved measurement). | The clock-state `jobs` event filter (PF-29). |

Groups with qualifying passes on the final build: `static:dependencies`, `static:typecheck`, `static:lint`, `static:docs`, `static:coverage`, `unit:all`, `sql:p1-21`, `sql:p1-22`, `sql:p1-23`, `sql:p1-24`, `sql:security`, `ui:contracts`, `audit:wave-1:a4`, `audit:wave-1:a6`, `audit:wave-1:a7`, `audit:wave-2:p1-22`, `audit:layout`, `audit:performance:calendar`, `golden:gg-00`, `golden:p1-06`, `golden:p1-12`.

Groups without a qualifying pass: `audit:performance:lists` and `golden:p1-11`, both for measured values over their contracts with the causes recorded under PF-25 and PF-29. `golden:p1-11` stops at the failed measurement, so its later `calendar.month.open-to-event` samples were not recorded in this pass.

Deliberately not run: `canary:providers` (no provider, migration, or edge-function change in Step 2; the group reaches the DEV project) and the remaining 37 groups of the 60-group change plan that the shared provider edits select; they belong to the full battery after Step 3.

Every retained world of the failed runs was classified with `bun run test:runs classify` (root cause and prevention in the run manifests) and cleaned with `bun run test:runs cleanup`; no open retained world, no workspace lock, and no leftover recorded server remain beyond the current build's server, which the next `bun run test:server local` replaces. The CodeRabbit review ran once, on the corrected tree before the third report, so the two later builds carry its fixes.

#### Historical first-implementation review dispositions

CodeRabbit reviewed the complete uncommitted tree on 2026-09-08 through `bun run review` (uncommitted scope, untracked files included, context `AGENTS.md` and `.coderabbit.yaml`) after the browser battery had exposed the readiness defect and its fix was in place. It raised 25 findings. Twelve concern Step 1 files (edge-function handlers, the dependency audit and its exceptions, the recovery rehearsal script, the account security spec, the mail-cleanup fixture, the publication-contract test, and the storage and server-action boundary tests). The first implementing agent left those twelve Step 1 findings unactioned. The owner subsequently authorized their repair in the independent review pass below; they are not outstanding owner decisions. The thirteen Step 2 findings were verified against the code. This table preserves the original review dispositions, with supersession noted where later repairs changed the implementation.

| # | Severity | File | Disposition | Evidence and change |
| --- | --- | --- | --- | --- |
| 1 | major | `lib/calendar/actions.ts` | Fixed | The instant range was validated for order only. `instantsInsideDateWindow` now requires it to lie inside the validated date window widened by one day on each side, so the paired time-entry read cannot leave the planning window. |
| 2 | major | `components/realtime/realtime-provider.tsx` | Fixed | `joinStateRef` survived the channel teardown, so the first join of the next organization could be skipped as covered by a read that predated it. The cleanup resets it. |
| 3 | trivial | `components/kalender/use-calendar-range-data.ts` | No change | The scope-reset block already resets the reducer and the change-request map together; the finding asks to keep it that way. |
| 4 | major | `app/(app)/kalender/page.tsx` | Fixed | The first paint carried no pending-correction badges until the join catch-up read. The page now reads the change requests for the prefetched entries and both sides build the map through `lib/time-tracking/change-request-map.ts`. One dependent query joins the server critical path. |
| 5 | major | `app/(app)/kunden/page.tsx` | Fixed | The original overflow repair was superseded by `list_customer_page`: global customer/contact/site search and counting happen in the database before paging. Selection or hydration errors fail the region; search no longer degrades to a partial client-side index. |
| 6 | minor | `tests/golden/support/steps/` (one file per domain since 2026-09-25) | Disproved | Requiring the warning whenever `overrideReason` is set would break callers that pass a reason for a warning the product does not guarantee (the first team creation in P1-11, recorded under PF-14). The strict check applies only to measured submissions. |
| 8 | minor | `lib/calendar/navigation.ts` | Comment corrected | The day view fetches only the previous day, exactly as before the rewrite; the comment claimed a day on each side. The window is unchanged. |
| 9 | minor | `lib/planning/server.ts` | Fixed | Both dates are interpolated into a PostgREST filter. `resolveBerlinWallTime` already rejected malformed input, but the loader now validates the range explicitly with `parseIsoDateRange` before building the filter. |
| 10 | major | `lib/calendar/range-data.ts` | Fixed | `reads-invalidated` reset only an in-flight read; a failed outcome survived a mutation and kept `datasetNeedsRead` false. It now resets to idle, with a unit test. |
| 14 | minor | `temporary-transcripts/README.md` | Disproved | `data-privacy` is an indexed topic (four aspects in `review-product-growth.md`, confirmed with `check-inventory.mjs --topic data-privacy`). |
| 15 | trivial | `tests/audit/support/performance-steps.ts` | Fixed | A missing count marker now throws a named error instead of returning `0`. |
| 16 | minor | `temporary-transcripts/review-foundations.md` | Fixed | The summary sentence now matches the table: three investigation candidates, one covered, one not applicable. |
| 17 | major | `lib/supabase/query-batches.ts` | Fixed | `readInBatches` fanned every batch out at once. It now runs at most `BATCH_CONCURRENCY` (8) batches in flight, keeps id order, and a unit test asserts the bound. |

Step 1 findings handed to the owner without action, by severity: #11 (major, duplicated authorization and HTML-escaping helpers across the two mail edge functions), #18 (major, the account spec persists the changed admin email after backend assertions that can fail), #19 (major, the mail-cleanup fixture replaces instead of accumulating recipients across calls), #21 (major, dependency exceptions for `brace-expansion` and `minimatch` claim upgrades are unsupported), #7, #12, #13, #20, #22, #23, #24, #25 (minor or trivial: a missing duplicate-publication test, the recovery rehearsal skipping planned resources during cleanup, a fixture hard-coding `error: null`, the dependency audit living under application source, test path resolution, the storage-boundary source filter, arrow-function helpers in the authorization scan, and a duplicated package set). The raw findings are in the review log of this session and reproducible with `bun run review -- findings`.

No independent agent review ran in this pass; the owner asked for subagents only where they contribute meaningfully, and the CodeRabbit pass plus the group battery were the review inputs.

### Independent review repair pass

The owner accepted the review and chose server-side pagination. No widened deadline or one-scenario exception was approved. The original results and dispositions above describe the first implementation only; they are superseded by this repair pass and do not qualify its candidate.

The table below records the repairs and the September 12 local checkpoint at `2026-09-12T162048922Z-0b492834`. Later shared authorization and refresh changes invalidate its application proof. Use the current repair checkpoint for outstanding verification; the counts below are historical.

| Review boundary | Repair and prevention | Verification state |
| --- | --- | --- |
| Background clock reads (PF-30, September 12) | Clock and active-job state use validated, private GET transport with current identity/active-organization guards and existing reader permissions. Their request-scoped identity reuse cannot cross requests. | The real route/auth fixture rejects anonymous, removed, foreign and malformed requests; client tests preserve complete state and prove both reads start independently. All named local app groups pass in the final repair report; fresh DEV canaries remain pending. |
| Reconnect and mutation ownership | Scope/generation-owned reads, causal invalidation timestamps, per-operation idempotent release, one shared mutation queue for navigation/manual/Realtime reads. | The final report passes all 64 component contracts and the named real-app owners, including live calendar changes. |
| Renderer readiness and stale interactions | FullCalendar owns its render-ready signal. Retained uncovered/failed grids block stale interactions. Correction badges and entries commit together; organization/user/role identity keys also isolate auxiliary state. | Final component and calendar browser groups pass held/failed reads, retention and retry. |
| Reference selectors | Authorized server search, 50 options per page, continuation and selected-ID hydration replace whole-organization calendar prefetch. | Shared-control/hook contracts and the final large-organization list/selector browser cases pass. |
| Main lists | Server pages select identities after global filtering/counting; project children are separately paged. Inventory movement hydration includes the actual displayed movement identities. | Final SQL cases beyond 1,000 records and selected browser paging, global search, selection and CRUD cases pass. |
| Performance comparison | Separate correctness/deadline/comparison reports; matching workload/method/role/provider/browser/host identity; three samples; fixed historical calendar workload with real URL-date navigation; reviewed calibration drafts and required-reference negative tests. | Eleven active reference contexts were reviewed on September 12. Final verification passes every hard sample deadline and all eleven required median comparisons. Never fabricate a reference or promote an over-budget run. |
| Calendar live changes | New owning group observes closure creation/removal and provisional correction submission/withdrawal in an already-open receiving month. | All four final create/remove/submit/withdraw observations pass two seconds. Closure removal is 1,914 ms, with limited margin. |
| Security review carry-over | Shared mail authorization/escaping, accumulated cleanup recipients, replay identity before backend assertions, planned-resource cleanup, corrected scan coverage, and tooling helper placement. | All 1,193 current unit cases and the local account-email browser group pass; fresh DEV behavior remains pending. |
| Dependencies | Compatible nested updates to brace-expansion 1.1.18/2.1.4, minimatch 3.1.5/9.0.9, js-yaml 4.3.2 and picomatch 2.3.2/4.0.7. Bun-generated resolutions preserve each consumer's compatible major. | Frozen installation and network advisory query passed with no findings. The exception policy is empty; future advisories still fail the gate. |
| PPR/security documentation | Corrected the claim that cookie reads disable static output. The actual build manifest lists authenticated routes as partially static. | The final local manifest preserves PARTIALLY_STATIC/experimentalPPR on the five inspected primary routes. Step 3 must verify deployed confidentiality and static-shell/streamed-script policy. |

The final follow-up also closes three diagnosed boundaries. Sidebar navigation uses the Tier 1 `SidebarLink` owner to prevent automatic invalidation-driven prefetch of every visible route; real hover/focus and structural contracts enforce it at Tier 2. Bulk test fixture setup waits for an authenticated exact final-transaction publication receipt; six ordering/failure tests enforce the Tier 2 readiness boundary, and workload identity includes both helpers. Standalone local cleanup owns the existing WSL lease and cancellable child with a three-minute bound; lifecycle and wiring tests cover recovery without bypassing recorded world ownership. The testing and Realtime references own the Tier 3 instructions.

Independent second review identified and repaired: thrown calendar mutations need guaranteed settlement; change-request metadata must participate in readiness and failure; auxiliary parked-work state must include user/role scope; document work view needs its pager; contextual document batches need global sorting; remaining folder-creator and equipment option hydration must be bounded and complete. The complete component group now also covers the actual day-view resize/save/Undo path with held and rejected responses, and four real shared-navigation lifecycles including external URL changes. These are engineering repairs, not unresolved product choices.

#### Acceptance sequence

One coordinator owns runtime commands. Finish all review repairs, freeze application/test inputs, and run cheap groups plus the selected boundaries. Reference calibration and activation are already complete, as recorded below. Preserve those references during product repairs. Run fresh required comparisons and the affected ordinary browser owners, reusing qualifying results. Do not run the full release battery here.

Selected scope must include `audit:performance:calendar`, `audit:performance:lists`, `audit:performance:planning`, `audit:performance:calendar-live` and `audit:list-pagination`, Golden planning and dispatch/customer freshness, time-correction owners, changed jobs/customer/document/inventory CRUD, account-email security, and DEV provider/security canaries. The exact group IDs and rationale belong in the final verification record. A failure gets classified and fixed before its relevant owner runs again. Preserve artifacts and clean owned worlds.

| Selected browser owner | Changed boundary to verify |
| --- | --- |
| `audit:performance:calendar`, `audit:performance:lists`, `audit:performance:planning` | Actual renderer readiness, bounded list payloads, repeated comparable navigation and cross-session planning measurements. Calibration and fresh required comparisons are separate steps. |
| `audit:performance:calendar-live` | Closure and correction insertion/removal in an open receiving month, with the existing freshness deadline. |
| `audit:list-pagination` | Inventory and document later pages, global search/filtering, create/edit settlement, linked work view, and the actual document exclusion query. |
| `golden:gg-00` | Customer CRUD and another user's fresh customer list through the changed paged reader. |
| `golden:p1-06` | Vacation approval/cancellation and the resulting calendar absence, daily target and time-tracking state. |
| `golden:p1-11`, `golden:p1-12` | Connected planning/dispatch outcomes, freshness, role-specific openings and new selector behaviour. |
| `audit:wave-1:a1` | Existing job/project table operations, documents and inventory workflows after their list readers and payloads changed. |
| `audit:wave-1:a2`, `audit:wave-1:a4`, `audit:wave-1:a6`, `audit:wave-1:a7` | Detailed changed customer/job, absence, calendar/planning and dispatch paths beyond the Golden outcome. |
| `audit:wave-2:p1-22` | Time corrections, badges and role permissions after metadata joins became part of calendar readiness. |
| `audit:security:account` | Actual local two-mailbox email-change flow and repaired failure cleanup. |
| `canary:providers`, `canary:security` on DEV | Provider freshness, committed migration parity, restricted RPC grants, private deletion notifications and deployed shared mail authorization. |

This is the required boundary selection, not a record that these groups passed. The cheap groups include all six SQL groups, dependency security, types, lint, units, UI contracts, docs and catalog coverage. The complete release battery remains reserved for final acceptance after Step 3.

The two pagination migrations in `0be451c`, the ordering follow-up in `61ca347`, and the single-query customer payload in `d51988e` are committed and applied DEV/local. Four earlier Step 1 migrations are also applied DEV/local; all eight remain unapplied to PROD. No application changes were committed or pushed, and PROD/preview routing remains unchanged. Both shared-source mail handlers were deployed to DEV after 25 focused handler/import-boundary tests passed; provider behavior still needs the selected cloud canary. The coordinated production rollout remains subject to the owner's separate release approval and Step 1's compatibility procedure.

### Final repair verification (2026-09-12)

This was the final local checkpoint before later DEV findings required shared application repairs. It is retained for provenance, not current acceptance. The current repair checkpoint above owns the remaining verification.

Local report `2026-09-12T162048922Z-0b492834` passes all 29 required groups on build `ddd2356f-cdf0-4f2e-ab4a-323f623fb8d5`. Its thirteen cheap groups are dependency security, typecheck, lint, docs, catalog coverage, units, UI contracts, `sql:p1-21`, `sql:p1-22`, `sql:p1-23`, `sql:p1-24`, `sql:security` and `sql:list-pagination`. There are 1,193 passing unit tests and 64 passing component contracts. Lint has zero errors and 43 warnings. Catalog traceability covers 970 flows, 186 mappings and 67 execution groups; the mapping check does not certify all runtime flows.

Every selected local browser owner below passed and cleaned its world. This is the agreed boundary selection, not the complete release battery.

| Browser group | Passing run |
| --- | --- |
| `audit:wave-1:a2` | `2026-09-12T162659128Z-eac5b8` |
| `audit:wave-1:a1` | `2026-09-12T162659128Z-79f9ed` |
| `audit:wave-1:a4` | `2026-09-12T163542382Z-a9cccb` |
| `audit:wave-1:a6` | `2026-09-12T164206670Z-15440d` |
| `audit:wave-1:a7` | `2026-09-12T164212688Z-929415` |
| `audit:wave-2:p1-22` | `2026-09-12T164849091Z-bb76f9` |
| `audit:security:account` | `2026-09-12T165019255Z-0d8574` |
| `audit:list-pagination` | `2026-09-12T165022916Z-ffff73` |
| `audit:performance:calendar` | `2026-09-12T165140707Z-e72eca` |
| `audit:performance:lists` | `2026-09-12T165330301Z-3e1ba2` |
| `audit:performance:calendar-live` | `2026-09-12T165501813Z-70298c` |
| `audit:performance:planning` | `2026-09-12T165621687Z-23be2d` |
| `golden:gg-00` | `2026-09-12T165857531Z-4c3e83` |
| `golden:p1-06` | `2026-09-12T170135265Z-5d8a99` |
| `golden:p1-11` | `2026-09-12T170447932Z-d7c5ec` |
| `golden:p1-12` | `2026-09-12T170709187Z-6680fc` |

All 33 individual measured samples meet their hard deadlines, and all eleven three-sample medians meet their required reference comparisons. Values below are rounded milliseconds from this final run. Raw samples, attribution, references and historical failed records remain available.

| Scenario | Samples in recorded order, ms | Median, ms | Hard deadline per sample, ms |
| --- | --- | --- | --- |
| `calendar.day.cold-open` | 1128 / 917 / 893 | 917 | 5000 |
| `calendar.day-to-week.uncovered` | 730 / 691 / 478 | 691 | 2000 |
| `calendar.week-to-day.covered` | 88 / 97 / 105 | 97 | 500 |
| `calendar.week-to-month.uncovered` | 2012 / 1812 / 1682 | 1812 | 3000 |
| `calendar.month-next.uncovered` | 1040 / 903 / 1117 | 1040 | 3000 |
| `calendar.month-to-week.covered` | 164 / 188 / 196 | 188 | 500 |
| `customers.list.open` | 879 / 812 / 1078 | 879 | 5000 |
| `jobs.list.open` | 990 / 993 / 988 | 990 | 5000 |
| `planning.occurrence.cross-session` | 1960 / 1896 / 1632 | 1896 | 2000 |
| `calendar.month.employee-open-to-event` | 1870 / 1509 / 1807 | 1807 | 5000 |
| `calendar.month.admin-open-to-legacy-event` | 1691 / 1671 / 1695 | 1691 | 5000 |

The separate Golden freshness results are customer 1,866 ms, P1-11 planning 1,890 ms and P1-12 dispatch 1,902 ms. Open-calendar closure creation/removal takes 1,404/1,914 ms; provisional correction submission/withdrawal takes 1,424/1,410 ms. All meet two seconds. Planning's slowest benchmark sample is 1,960 ms, so this is limited headroom, not broad capacity proof. Day-to-week median is about 691 ms against its roughly 693 ms comparison limit, although its two-second hard deadline has ample margin. Preserve these margins in future comparisons; do not silently rebase them.

Calibration was a separate reviewed step: report `2026-09-12T161032405Z-ff832288`, source runs `2026-09-12T161050157Z-9ba3e5`, `2026-09-12T161230509Z-f8c334`, `2026-09-12T161359957Z-92bbf9`, draft `2026-09-12T161701795Z`. Each source passed its hard deadlines and cleanup. The final-transaction fixture readiness changed workload identity; the shared direct-DOM-wait source change also changed measurement-source identity. All eleven older entries remain in the file. The new planning calibration median of 1,613 ms also met the previous reference tolerance. The final required-comparison run above happened after activation. Setup receipt times of 4.0/6.4 seconds in the calibration profiles are archived separately and are not subtracted from application observations.

DEV report `2026-09-12T171258702Z-683de5c1` subsequently passed `canary:security` (three checks, run `2026-09-12T171506593Z-57e259`) but failed provider C3 at 3,365 ms (run `2026-09-12T171316213Z-bda6e1`). Both owned worlds are cleaned. The current checkpoint describes the layout follow-up and required new evidence; these earlier local results cannot qualify changed inputs.

### Historical intermediate verification

#### Earlier September 12 repair checkpoint

Report `2026-09-12T131552291Z-6729e690` passes the live calendar owner on build `9c83dec9-f909-4dda-94de-72ac1c5402cc`. Closure creation/removal take 1,909.6/1,997.6 ms; provisional correction submission/withdrawal take 1,400.3/1,436.3 ms. All four meet the unchanged two-second deadline. Closure removal has only 2.4 ms of margin; this is passing evidence, not proof of broad performance headroom. The owned world was cleaned. Holiday/closure context now belongs to the existing five-dataset calendar range owner, which reads it directly and gates month readiness. The shared server-only reader pages closure rows and rejects read failures instead of returning false empty context. Four focused reader/HTTP checks, twelve actual calendar component checks, types, lint and units also pass.

The complete named Step 2 local selection stopped in report `2026-09-12T131807571Z-44c6d129`, after the cheap groups, A2 and A4 passed. A1 used a legacy-table assertion after canonical clock-in; A6 stopped before setup on a transient Windows inspection timeout. The assertion now compares complete canonical time history, and read-only listener inspection has one bounded timeout retry. Five focused inspection checks pass. The A1 world is classified and cleaned. Remaining selected browser groups, DEV verification and final documentation reconciliation remain pending. No application commit, push or production rollout occurred.

Report `2026-09-12T123041270Z-1be822bb` passes all six calendar navigation comparisons, all 18 sample deadlines and recovery checks. Stable holiday and presentation references reduced next-month median from 1,447.7 to 1,105.2 ms against the unchanged 1,082.2 ms reference. Live closure creation then failed at 2,478.8 ms before correction submission could run. The trace identifies background `getCurrentClockState` and `getActiveJobIdsForOrg` actions ahead of `addClosureDay` in the producer's serialized queue. Those two global reads now use an authenticated, private GET through the existing readers. A focused real-route/auth/transport check passes. Bounded independent review also found a missing current-membership check in the direct canonical clock action. The reader now checks before any service-role session/settings read, and a negative fixture exercises both public call paths. Eleven focused checks pass. Fresh cheap and application proof remain required.

The correction fixture separately now owns run-day minus seven, because future worked time is intentionally excluded, and matches the displayed first name. The prior fixture failure is classified and cleaned. The latest live world is classified and cleaned after queue diagnosis. No reference or deadline was widened. Step 2 acceptance and DEV checks remain pending.

Cheap report `2026-09-12T124627645Z-4e26edd6` passes all thirteen cheap groups after the background-read and direct clock authorization repairs: dependency security, types, lint, docs, coverage, all six SQL groups, 1,181 units and 60 component contracts. Bounded independent review found no other actionable defect in the new GET/schema/transport boundary. Fresh selected application and DEV verification remain required.


The records below describe earlier candidates and checkpoints. The current repair checkpoint and acceptance sequence govern remaining work.

Follow-up report `2026-09-12T105143993Z-03347e8e` passed calendar navigation/recovery and customer/job list comparisons. It exposed two test setup errors: inventory editing used an exact decorated-label lookup, and correction visibility was disabled on the receiving calendar. Both are repaired; the calendar filters now also use keyboard-accessible shared checkboxes. Planning met every hard deadline, but one below-deadline sample failed the current reference comparison. The owner approved comparing the three-sample median with the retained reference median, while every sample must pass its hard deadline. The validator now enforces complete, distinct samples with matching build and environment, retains all observations, and rejects invalid cohorts. Reference values, measurement boundaries and tolerance are unchanged. Fresh acceptance remains pending. Measured traces are now retained after successful browser assertions so later comparison failures retain diagnostic evidence. See the [new incident record](../../../technical/test-incident-log.md#2026-09-12-pagination-control-and-calendar-filter-setup).

The first required-comparison report `2026-09-12T102825292Z-1aec6905` passed static checks, all six SQL groups, 56 UI contracts and the 15-case customer audit. It found a stale calibration unit fixture and the A1 removal assertion that contradicted SI-006. The remaining groups were blocked when Windows listener discovery timed out before A4 setup. The repairs preserve required comparisons and protected working-time history; listener discovery now uses native socket ownership plus validated process metadata. Fresh selected proof is pending. See the [incident record](../../../technical/test-incident-log.md#2026-09-12-stale-removal-expectation-and-windows-listener-discovery).

September 12 repair verification reached successful measured owners. Report `2026-09-12T101820031Z-c621d254` passed calendar run `2026-09-12T101849298Z-f2e2ad` and planning run `2026-09-12T102034644Z-17e1c0`. Calendar passes all 18 navigation samples and both covered/uncovered failure-and-retry paths. Planning cross-session samples are 1,141.9/1,529.2/1,342.5 ms against 2,000 ms. Both role-opening scenarios pass. The earlier list run `2026-09-12T093603732Z-465c8c` passed all list assertions and supplied its reviewed draft before subsequent application changes. All these worlds are cleaned.

All eleven reviewed references are now activated in `lib/testing/performance-baselines.json`; all scenarios require comparison. The two list entries preserve the September 12 09:42 draft. The nine calendar/planning entries preserve the 10:25 draft. Each scenario retains its own source build and compatible measurement context. No samples were trimmed, budgets widened, or slower results automatically adopted. Administrator legacy opening has greater variation (2,514.3/1,515.7/1,612.5 ms), retained in full; fresh comparisons must still satisfy the existing rule. Required comparisons and the named ordinary application/DEV checks below remain pending. This is not Step 2 acceptance.

The repairs share repeated identity and membership wrapper reads inside one explicit GET scope. At this historical checkpoint they preserved cross-request membership caching; the later September 12 organization repair removes that cache, as described in the current checkpoint. Realtime now delivers every authorized event immediately; the shared feature hooks own the single 150 ms debounce and 1,000 ms maximum deferral. Legacy time reads and independent projections start together. The provisional correction action skips responsibility resolution for manager and own-subject visibility, while retaining it for the unfiltered employee review view. These changes preserve authorization and complete data reads.

Cheap report `2026-09-12T095051719Z-ddd05589` passed types, lint, docs, 1,171 units and 56 component checks before the last correction-read optimization. Seven focused checks then passed for that optimization, including its actual action and permission boundaries. The first subsequent build caught a missing Bun `fetch.preconnect` property in the new fixture; its corrected build succeeded. Fresh complete cheap evidence remains required for the current candidate.

Failed reports remain historical evidence. Planning measured 2,123 ms and then 2,697 ms before the irrelevant responsibility lookup was removed. The calendar failure test first confused an unavailable month with a failed covered refresh, then tried to click through its deliberately persistent error banner. It now checks both distinct states and dismisses the banner through the normal control before retry. Every associated run is classified and its world cleaned. The renderer marker preserves `unavailable`; it no longer overrides it with `loading`.

Retained diagnostics now restore only the two named workload input files, never outcomes. Explicit local-only cleanup handles a changed WSL address by verifying both exact test organizations and owners and recording separate cleanup provenance. Original provenance remains immutable; this exception never permits replay or cloud cleanup. All September 9 and September 12 retained worlds are cleaned as of this checkpoint. Temporary Chrome instrumentation is removed. Diagnostics and failed owners cannot supply acceptance or calibration evidence.

### Historical September 9 checkpoints

These paragraphs retain diagnosis and intermediate evidence. The September 12 checkpoint above supersedes their pending work and runtime instructions.

2026-09-09 continuation: commit `61ca347` contains the forward job-order migration. The identical file is applied to DEV and local Supabase. DEV migration-history and generated-type checks pass. The owner's authorization covers routine migration follow-ups needed to complete this pass; do not repeat file-by-file permission questions for those commits and DEV applications. The coordinated PROD/app rollout remains separate because preview shares PROD. Continue the acceptance sequence below on a fresh recorded local build. The earlier pending-approval checkpoint is historical.

The recorded local build `295111a6-81ff-4bff-80d3-252984acdd7a` completed on September 9 at 02:42 UTC. SQL report `2026-09-09T024353729Z-c97ebb14` passed `sql:list-pagination` against the applied follow-up. Calibration report `2026-09-09T024451543Z-009d240b` failed all three measured owners. Calendar run `2026-09-09T024513048Z-e42633` measured the month switch at 4,507 ms against 3,000 ms. Trace attribution places 1,693 ms between click and month-request dispatch, 1,122 ms in the request, and about 1,590 ms between response and usable renderer. Obsolete day and shell Server Actions precede that request. List run `2026-09-09T024609398Z-302fb2` passed both opening deadlines before its search assertion matched nested count/loading statuses. Planning run `2026-09-09T024657147Z-1f4bf2` recorded two saves within the unchanged two-second deadline, then found its third fixture hidden by month overflow. None qualifies a reference. All three failures are classified and their owned worlds cleaned; traces remain available.

The implemented repairs separate calendar reads from the browser Server Action queue and pagination count from loading announcements. Planning benchmark jobs use distinct fixed date pairs with real overlap confirmation and identify the new standalone occurrence by identity. Route authorization and component checks pass; the current checkpoint above owns browser acceptance. FullCalendar still mounts hidden overflow events; the installed library exposes no safe visibility flag or virtualization switch. Keep event completeness, overflow counts and existing interactions intact. Do not hide that remaining rendering cost with a later measurement start or a raised budget.

Independent follow-up review found unpaged legacy time entries, canonical segments, absence reads and correction history. The repaired readers use complete bounded pages and bounded identity filters, retain authorization and deterministic ordering, and propagate query/overflow failures into stale/error calendar state. Seven focused checks passed in `20260909-calendar-read-unit.log`, covering the real HTTP boundary, nonempty optional-field round-trip, complete readers beyond 1,000 rows and correction query failures. Pending projection now has complete reads with the shared 10,000-row failure guard; the original PF-19 row's retained 300-row truncation is superseded. Fresh full cheap-group and application proof remain pending. The previous local server was stopped before these changes; rebuild through `test:server local` after the batch freezes.

The completed batch passed all 13 cheap groups in report `2026-09-09T031225509Z-a82eb7ff`: dependency security, types, lint, docs, catalog coverage, 1,168 units, all six SQL groups and 55 UI contracts. The preceding report stopped at a new fixture's missing Bun `fetch.preconnect` type; the corrected fixture passed without changing its assertions. All subagent work is complete. The coordinator started the next recorded local build through `test:server local`, with output in `.agent-logs/step2-repairs/20260909-readers-server.log`. Next obtain fresh measured-owner evidence, review and activate compatible references, then run required comparisons and the named application/provider owners below. Do not repeat the original audits or call Step 2 accepted before these results exist.

The owner approved the independent review repairs and server-side pagination on 2026-09-08. The original implementation evidence below is historical and does not qualify the repaired candidate. Calendar scope/reconnect/mutation ownership, renderer readiness, async picker search, list pagination, baseline qualification and carried Step 1 review findings are being repaired together.

Commit `0be451c` contains only the two approved pagination migrations. Both reached DEV and local Supabase; DEV types were regenerated. Rollback-only SQL assertions passed with more than 1,000 customers/jobs/documents/inventory records, global filters, page boundaries, role isolation and service-only grants. Other application/test/docs changes remain local; PROD and preview have not changed. Compatible nested dependency patches resolved every advisory in the current registry audit; the empty exception policy retains the network gate. These checks are intermediate evidence, not Step 2 acceptance.

Step 2 is not accepted yet. Continue this repair pass from its current local tree, using the checkpoint and review table above. Preserve all existing Step 1/Step 2 changes and the three committed pagination/order migrations. Do not restart the original plan, inherit historical green evidence, widen deadlines, or defer a retained repair to Step 3. Permanent rules live in the routed technical docs and matching skills; this file owns current decisions and evidence. Full release acceptance remains after Step 3.

Intermediate repair verification `2026-09-08T200600488Z-126028b9` passed dependency security, typecheck, lint, all four time SQL groups, security SQL, and 37 UI contracts. Unit verification had one repository-scan timeout; the package-name prefilter cut that scan to 2,038 ms without weakening AST import checks, and all 25 focused security tests passed. The inventory SQL assertion delimiter typo was corrected and the focused test passed, including stock/type/location/planned filters. These intermediate results remain separate from final acceptance after the remaining calendar/document repairs. CodeRabbit could not review the combined 213-file diff under its 150-file limit; the narrowed library review then failed with `WebSocket closed`. Neither attempt produced new findings or review acceptance.

The independent planning benchmark now owns three declared overlap-confirmed saves and separate employee/admin openings on fixed June 2026 data. P1-11 retains hard freshness/readiness checks in both standalone and integrated journeys, but their different inherited worlds no longer share baseline references. The baseline loader rejects insufficient samples, over-budget samples, a reference other than the retained median, incomplete build/run provenance and changes to the approved 25%/250 ms combined tolerance.

Cheap verification checkpoint: report `2026-09-08T205026996Z-7505081b` passed dependency security, typecheck, lint and all six SQL groups. Two new spec-convention omissions and three component-selector ambiguities were repaired; report `2026-09-08T205502147Z-3a84ee7a` then passed all 1,155 units, all 44 UI contracts, docs and catalog coverage. No assertion deadline was widened. The isolated UI fixture startup failure was traced to Next Link in the optional Parkplatz panel; a narrowly scoped anchor boundary repaired it without replacing the actual drag components or adding a global process shim. The interrupted fixture run was recorded as failed, and its dead owner was verified before lock recovery.

The first repaired-build calibration report `2026-09-08T205923175Z-d418f134`, build `c6bc5237-a799-4389-99ce-4765e9f084ef`, failed all three measured owners. Calendar run `2026-09-08T205942142Z-41205a` measured week-to-month at 3,776 ms against 3,000 ms. Its window action took about 695 ms; the trace also shows a queued earlier refresh and redundant renderer initialization. It does not isolate all renderer CPU from assertion recording overhead. List run `2026-09-08T210040689Z-009985` met both opening budgets, then exposed the lost newest-created-first tie order for undated jobs. Review also found that hidden-column preferences could make the displayed sort differ from the server sort. Planning run `2026-09-08T210140405Z-b45530` measured the first cross-session save at 2,071 ms against 2,000 ms. None qualifies a baseline. All three failures were classified and their owned local worlds cleaned; traces remain available. Repairs and observation attribution are in progress, with deadlines unchanged.

The third narrowed CodeRabbit attempt, scoped to components, also ended with `WebSocket closed`. It produced no new review findings or acceptance. Independent source review continues against the retained findings and the actual changed boundaries.

#### Verification checkpoint before the follow-up migration

Report `2026-09-08T213337199Z-64176572` passed typecheck, lint with no errors, docs, catalog coverage, all 1,158 units and all 53 real component/browser contracts. The final component group includes the actual FullCalendar no-op/update cases and eight browser-observation cases. An earlier new test sampled its upper-bound timestamp inside the producer before the independent observer completed; moving that sample after observation completion repaired the incorrect causal assumption. The focused test and final group passed without loosening a deadline. Static lint also caught the direct Realtime selector in GG-00; the shared named helper now owns it and the performance helpers reuse it. `git diff --check` and the transcript inventory passed, with 230 sources and 1,144 aspects. The documented Claude-only CodeRabbit skill is the sole intentional mirror exception.

Measurement method 3 now records browser-clock start before the real action and the animation-frame first-visible end. Ordinary Locator assertions, strict/hidden/ordinal behavior, failure records, receiver-navigation rejection and traces remain. Method 2 failures stay red and cannot qualify method 3. Independent source review found no additional blocking defect in the repaired renderer, measurement helper or pagination boundaries. This is source/component evidence, not fresh application performance acceptance.

Historical September 8 checkpoint, superseded by commit `61ca347` and its verified DEV/local application on September 9: the forward migration `20260908210716_preserve_job_list_sort_order.sql` was prepared but not yet committed or applied. Its local rollback-only proof passed in `.agent-logs/step2-repairs/job-order-validation.sql`, including the original greater-than-1,000-row/access checks and new cross-page tie-order assertions. The owner was asked separately to authorize its commit and DEV application; that approval was subsequently received. The two originally approved migrations in `0be451c` remain committed/applied DEV and local. No other commit, push, PROD mutation or preview change occurred.

The migration and calibration actions described at this historical checkpoint have since completed. Follow the current checkpoint at the top of this file for remaining verification and rollout status; these September 8 records are evidence history, not execution instructions.
