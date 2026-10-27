# Browser-test incident log

Status: living — last reviewed 2026-10-27; entries from 2026-09-25 on

Record here each failed acceptance group and each focused failure that changes shared testing behavior. [Testing](testing.md#failures) owns the procedure. Entries before 2026-09-25 were deleted; Git history keeps them. Read an entry only to investigate that failure. Rules live in their owner docs, not here.

## Required incident record

Record each failed acceptance group and any focused failure that changes shared testing behavior:

| Field          | Required content                                                                                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run | Verification report and group ID, run key where created, target, input fingerprint, and retained world ID where owned |
| Classification | One of `INCIDENT_CLASSES` in `lib/testing/runner/run-policy.ts`; [Failures](testing.md#failures) defines each. `authoring` and `accepted-change` leave no entry |
| Failure point  | Spec/stage and first failing assertion or runner error                                                                                                                                                                                                         |
| Evidence       | `error-context.md`, screenshot, trace, server/edge log or read-only database fact actually inspected                                                                                                                                                           |
| Root cause     | The smallest explanation supported by that evidence                                                                                                                                                                                                            |
| Correction     | Product, harness or environment change made                                                                                                                                                                                                                    |
| Focused proof | Affected fresh group result, exact passed identities, current input fingerprint, and target; for an environment-recovery retry, the passing diagnostic (retained replay, or fresh-world run of a test that wrote its world) |
| Prevention     | Enforced check, shared helper, spec boundary or documented rule that prevents recurrence — with its enforcement-ladder tier ([decision 0005](../decisions/0005-enforcement-ladder.md)); a Tier-3 prose-only prevention states why Tier 1 and 2 are unreachable |
| Cleanup        | Owned-world cleanup result, unresolved ownership, and whether the affected group qualifies for another attempt under current stopping rules                                                                                                                                                                             |

`bun run test:runs classify` stores the classification, cause and prevention in the run manifest and, for a failed run of the verification lane, writes the dated entry below with the run, the failure point, the cause and the prevention (`lib/testing/runs/incident-record.ts`). It refuses a prevention without its tier, and a Tier 1 or Tier 2 prevention that names no existing mechanism file, lint rule, selector set or group (`lib/testing/runs/incident-mechanisms.ts`; `docs:check` applies the same rule to every Prevention line). Add the evidence, the correction and the focused proof under that entry when the repair lands. Write a focused failure that changes shared testing behavior by hand. Do not call an unexplained retry a transient.

## 2026-10-27: golden:p1-22 harness failure

<!-- incident-run: 2026-10-27T035641092Z-79010d -->

- Run: run `2026-10-27T035641092Z-79010d`, group `golden:p1-22`, target local, fingerprint `3ddab484ef6d`, world `6197cd57dc494d8b88d5d1700ec3e661`.
- Failure point:  >  > p1-22.spec.ts > P1-22 consistent time corrections @P1-22 > calendar resize submits one audited correction and survives reload @P1-22-calendar-correction: TimeoutError: locator.click: Timeout 30000ms exceeded.
- Root cause: The calendar correction test booked time two days back for an employee whose entry date is the business date; when the loaded calendar window ends before that date (the fixture day is a Sunday, so on Tuesdays) the board has no row for the person and the correction dialog refuses to submit.
- Prevention: Tier 3: the test backdates the employee's entry date with ensureEmployedSince before it books time; review of fixtures that book time before the business date.
- Evidence: the failure's page snapshot shows the dialog for a block on 25.10.26 with "Person ist im geladenen Kalender nicht mehr verfügbar."; the trace's /api/calendar-board response for 2026-10-18 to 2026-10-26 holds no rows, and the world's employee records enter on 2026-10-27. The same failure on main's commit 1e32faaa and in main's CI run of 2026-10-26 (golden:p1-22 started 00:17 Berlin on a Tuesday) rules out the branch. Correction: the calendar correction test backdates the employee's entry date to the fixture day. Focused proof: report `2026-10-27T040212749Z-531e9eb2` passed golden:p1-22 on a Tuesday, with the fixture on the 25-hour day of 2026-10-25.

## 2026-10-26: unit:all harness failure

<!-- incident-run: unit:all@2026-10-26T195921969Z-e2d35826 -->

- Run: run `unit:all@2026-10-26T195921969Z-e2d35826`, group `unit:all`, target local, fingerprint `e0f495ff8c10`.
- Failure point: unit:all in report 2026-10-26T195921969Z-e2d35826: Command exited 1; inspect .agent-logs/verification/2026-10-26T195921969Z-e2d35826/unit-all.log
- Root cause: Three tests did not follow the responsibility read's new shape. module-caps.test.ts requires a listed function to sit at its ceiling, and both split functions shrank. The read-request-lifetime fake chained only eq/order/range, and in-memory-admin applied the embedded-resource filter personnel_onboarding_requirements.blocks_access to the parent employee rows, which dropped every member, so the work-handover boundary saw no holder.
- Prevention: Tier 2: lib/conventions/module-caps.test.ts keeps the ceilings at the new sizes; lib/testing/fixtures/in-memory-admin.ts skips a dotted filter for a row that carries that embedded array, as PostgREST does
- Evidence: unit-all.log of the report names the three tests; running the work-handover fixture alone returned work_handover_not_authorized where the boundary expects work_handover_target_not_found. Correction: ceilings lowered in eslint-rules/size-cap-exceptions.json, the lifetime fake chains eq/not/limit, the work-handover fixture seeds the embedded arrays. A first fake repair that ignored every dotted filter broke three other boundary fixtures (report `2026-10-26T200139939Z-015500b2`, classified authoring) and was narrowed. Focused proof: report `2026-10-26T200415014Z-429d5168` passed unit:all.

## 2026-10-26: unit:all harness failure

<!-- incident-run: unit:all@2026-10-26T195751085Z-4ead4049 -->

- Run: run `unit:all@2026-10-26T195751085Z-4ead4049`, group `unit:all`, target local, fingerprint `0cd2164f2153`.
- Failure point: unit:all in report 2026-10-26T195751085Z-4ead4049: Command exited 1; inspect .agent-logs/verification/2026-10-26T195751085Z-4ead4049/unit-all.log
- Root cause: lib/attention/count-volume.test.ts has the same stale fake as count-reads.test.ts: its employee_records rows lacked the embedded personnel_access_lifecycles and personnel_onboarding_requirements arrays that the responsibility read now selects, so the loader threw and the counts failed with unexpected_error.
- Prevention: no prevention claim: the fixture now returns the embedded arrays; nothing ties a fake row's shape to the select string it answers
- Evidence: unit-all.log of the report: "Unexpected error in getAttentionCounts" in every count-volume case. Correction: the fixture's employee rows carry both embedded arrays. Focused proof: report `2026-10-26T200415014Z-429d5168` passed unit:all.

## 2026-10-26: sql:p1-23 environment failure

<!-- incident-run: sql:p1-23@2026-10-26T194916050Z-ee3e770d -->

- Run: run `sql:p1-23@2026-10-26T194916050Z-ee3e770d`, group `sql:p1-23`, target local, fingerprint `119243b5b1cc`.
- Failure point: sql:p1-23 in report 2026-10-26T194916050Z-ee3e770d: Command exited 1; inspect .agent-logs/verification/2026-10-26T194916050Z-ee3e770d/sql-p1-23.log
- Root cause: The shared local stack carries migration 20261026120000 from another worktree (PR #15, not on main), which makes decide_time_account_adjustment refuse its own proposer with own_proposal; p1_23_time_accounts.sql on this branch still expects the pre-#15 behavior. This branch does not touch that function.
- Prevention: Tier 3: one local stack serves every worktree; CI's SQL job applies only this branch's migrations to a fresh stack
- Evidence: sql-p1-23.log raises own_proposal from decide_time_account_adjustment; the local migration history lists 20261026120000, which is not in this branch. No correction on this branch and no local retry, because the stack keeps that migration. Focused proof: after #15 merged and main was merged into the branch, report `2026-10-26T215309713Z-d9061392` passed sql:p1-23.

## 2026-10-26: unit:all harness failure

<!-- incident-run: unit:all@2026-10-26T194916050Z-ee3e770d -->

- Run: run `unit:all@2026-10-26T194916050Z-ee3e770d`, group `unit:all`, target local, fingerprint `f688ab81c5ae`.
- Failure point: unit:all in report 2026-10-26T194916050Z-ee3e770d: Command exited 1; inspect .agent-logs/verification/2026-10-26T194916050Z-ee3e770d/unit-all.log
- Root cause: lib/attention/count-reads.test.ts fakes the employee_records read with rows in the old select shape. The responsibility loader now embeds personnel_access_lifecycles and personnel_onboarding_requirements, which PostgREST always returns as arrays; the fixture rows lacked them, so reading the lifecycle threw and the counts reported unexpected_error instead of the asserted result.
- Prevention: no prevention claim: the fixture now returns the embedded arrays; nothing ties a fake row's shape to the select string it answers
- Evidence: unit-all.log of the report: the two count-reads cases received unexpected_error. Correction: the fixture's employee row carries both embedded arrays. Focused proof: report `2026-10-26T200415014Z-429d5168` passed unit:all.

## 2026-10-26: ui:contracts harness failure

<!-- incident-run: ui:contracts@2026-10-26T181459938Z-ff25d8db -->

- Run: run `ui:contracts@2026-10-26T181459938Z-ff25d8db`, group `ui:contracts`, target local, fingerprint `f1730c66e529`.
- Failure point: ui:contracts in report 2026-10-26T181459938Z-ff25d8db: Command exited 1; inspect .agent-logs/verification/2026-10-26T181459938Z-ff25d8db/ui-contracts.log
- Root cause: controls.spec.ts rendered the row actions menu without the app stylesheet. The menu portals to the end of body, so unstyled it sat at the page bottom, partly below the 900 px fold instead of fixed beside its trigger; the first-item focus scrolled the page, the trigger moved and the scroll handler closed the menu before the click on Bearbeiten landed (screenshot: unstyled page; Playwright: element detached after scrolling into view).
- Prevention: Tier 2: tests/ui-contracts/controls.spec.ts loads the app stylesheet in the row-action selection case, so ui:contracts observes the fixed menu the product renders
- Evidence: test-failed-1.png shows the page without styles and the trigger near the bottom of the 900 px viewport; the Playwright log reads "element was detached from the DOM" after scrolling into view. CI's component job passed on the same commit. Focused proof: report `2026-10-26T194916050Z-ee3e770d` passed ui:contracts with the stylesheet loaded.

## 2026-10-26: audit:layout:field environment failure

<!-- incident-run: 2026-10-26T094527601Z-794ea2 -->

- Run: run `2026-10-26T094527601Z-794ea2`, group `audit:layout:field`, target local, fingerprint `d1a276fc98c3`.
- Failure point: Test runner: The test session was cancelled.
- Root cause: The agent's tool stopped the local plan at its 40-minute background limit; SIGTERM cancelled the test session mid-group.
- Prevention: no prevention claim: the agent tool's time limit stopped the operator session, not a test.

## 2026-10-26: audit:layout:service environment failure

<!-- incident-run: 2026-10-26T094527601Z-909408 -->

- Run: run `2026-10-26T094527601Z-909408`, group `audit:layout:service`, target local, fingerprint `169f6a56bd12`, world `21db1bc7a2a046c88f43bcf369cc8ffa`.
- Failure point: Test runner: The test session was cancelled.
- Root cause: The agent's tool stopped the local plan at its 40-minute background limit; SIGTERM cancelled the test session mid-group.
- Prevention: no prevention claim: the agent tool's time limit stopped the operator session, not a test.

## 2026-10-26: audit:wave-1:a1-zeiten product failure

<!-- incident-run: 2026-10-26T081244178Z-1825b5 -->

- Run: run `2026-10-26T081244178Z-1825b5`, group `audit:wave-1:a1-zeiten`, target local, fingerprint `52f81bfed830`, world `5943e594dd2a47b1bb00a880dc2b96ee`.
- Failure point:  >  > wave-1/a1-zeiten.spec.ts > A1 Zeiterfassung @AUDIT-W1-A1 > A1-30: Manager korrigiert, hängt um und löscht bestehende Arbeitsblöcke: Error: expect(locator).toBeVisible() failed
- Root cause: The day view places a block by elapsed minutes since the day's first instant (lib/calendar/day-layout.ts), so on the DST day the test reads as yesterday the 10:00-11:00 entry showed at 11:00-12:00.
- Prevention: Tier 2: lib/calendar/day-layout.test.ts places and maps back 10:00 on both DST days of the Berlin zone.

## 2026-10-26: audit:wave-1:a1-zeiten product failure

<!-- incident-run: 2026-10-26T075756883Z-4e98d7 -->

- Run: run `2026-10-26T075756883Z-4e98d7`, group `audit:wave-1:a1-zeiten`, target local, fingerprint `52f81bfed830`, world `e85b6f70969a4eef88b54b3616af9b77`.
- Failure point:  >  > wave-1/a1-zeiten.spec.ts > A1 Zeiterfassung @AUDIT-W1-A1 > A1-30: Manager korrigiert, hängt um und löscht bestehende Arbeitsblöcke: Error: expect(locator).toBeVisible() failed
- Root cause: The day view positions a block by elapsed minutes since the day's first instant (lib/calendar/day-layout.ts), so on a DST day every block after the switch is drawn an hour off: the 10:00-11:00 entry of 2026-10-25, the fall-back day the test reads as yesterday, showed at 11:00-12:00. It fails on any day whose previous day is a DST change, in every time zone of the server.
- Correction: `wallMinutesFrom` and `instantAtMinutes` in `lib/calendar/day-layout.ts` map instants to the day's wall-clock minutes and back; the day view's layout, drop rules and resize use them.
- Prevention: Tier 2: `lib/calendar/day-layout.test.ts` places and maps back 10:00 on both DST days of the Berlin zone.
- Focused proof: `audit:wave-1:a1-zeiten` passed on the corrected build, the server in UTC (report `2026-10-26T081737173Z-b96fb3ce`).

## 2026-10-26: audit:wave-1:a1-zeiten product failure

<!-- incident-run: 2026-10-26T074806663Z-c94839 -->

- Run: run `2026-10-26T074806663Z-c94839`, group `audit:wave-1:a1-zeiten`, target local, fingerprint `52f81bfed830`, world `77ad29b567ed43cca9637ce17731fe25`.
- Failure point:  >  > wave-1/a1-zeiten.spec.ts > A1 Zeiterfassung @AUDIT-W1-A1 > A1-30: Manager korrigiert, hängt um und löscht bestehende Arbeitsblöcke: Error: expect(locator).toBeVisible() failed
- Root cause: first read as the server zone, corrected by the evidence of the 2026-10-26 entry for run `2026-10-26T075756883Z-4e98d7`: the stored instant was right (09:00Z), and the run failed the same way with the server zone pinned and in Berlin time. The day view draws by elapsed minutes and misplaces blocks on a DST day.
- Prevention: no prevention claim: see the entry of run `2026-10-26T075756883Z-4e98d7`.

## 2026-10-26: golden:p1-22 product failure

<!-- incident-run: 2026-10-26T073501330Z-c37883 -->

- Run: run `2026-10-26T073501330Z-c37883`, group `golden:p1-22`, target local, fingerprint `95a9f0feced6`, world `fe5e2a771a0340ea8a935b98be759f95`.
- Failure point:  >  > p1-22.spec.ts > P1-22 consistent time corrections @P1-22 > calendar resize submits one audited correction and survives reload @P1-22-calendar-correction: Error: expect(locator).toBeVisible() failed
- Root cause: With the server process in UTC (as on Vercel and CI), the calendar's server render computed its read window in UTC, which differs from the Berlin window the page prefetched; the server HTML marked the calendar scroll region aria-busy and inert, hydration never patches attributes, so every click on the calendar fell through to the page body.
- Evidence, correction and focused proof: the golden:p1-12 entry of the same day; one cause.
- Prevention: Tier 1: `instrumentation.ts` pins the server process zone. Tier 2: CI runs every browser group on a UTC runner (`.github/workflows/ci.yml`).

## 2026-10-26: golden:p1-12 product failure

<!-- incident-run: 2026-10-26T073501330Z-e9b4ba -->

- Run: run `2026-10-26T073501330Z-e9b4ba`, group `golden:p1-12`, target local, fingerprint `4d66b2095238`, world `9ca037cd8e98431ba6c4a7e249ac2c3c`.
- Failure point:  >  > p1-12.spec.ts > P1-12 dispatch, batch rescheduling, readiness, acknowledgement, and commitments @P1-12 @GG-03 > a dispatch is acknowledged, a move invalidates it, and a kept challenge is confirmed again: TimeoutError: locator.click: Timeout 30000ms exceeded.
- Root cause: With the server process in UTC (as on Vercel and CI), the calendar's server render computed its read window in UTC, which differs from the Berlin window the page prefetched; the server HTML marked the calendar scroll region aria-busy and inert, hydration never patches attributes, so every click on the calendar fell through to the page body.
- Evidence: CI run 40274526680 and 40284814449 on PR #4 failed every calendar group (golden:p1-12, golden:p1-22, audit:wave-1:a6, audit:wave-1:a7, audit:wave-1:a1-zeiten, audit:wave-3:p1-24a, audit:lab:office, audit:layout:field, audit:layout:planning-board, audit:visual) while all passed locally, also on two pinned cores. The trace showed the scroll region with `aria-busy="true"` and `inert` while a temporary log of the range hook reported `ready`. With `TZ=UTC` on the local server both groups failed the same way; Vercel sets no `TZ`, so the deployed staging and production servers render in UTC too.
- Correction: `instrumentation.ts` sets the server process zone to Europe/Berlin before the server handles a request, so the server render computes the window the page prefetched. A first repair in the calendar hook alone also passed, and gave way to the zone pin, which covers every server read of a wall time.
- Focused proof: with the server and the runner in UTC, `golden:p1-12`, `golden:p1-22` and `audit:wave-1:a7` passed on the build with the pin (report `2026-10-26T075754634Z-419df11c`).
- Prevention: Tier 1: `instrumentation.ts` pins the server process zone. Tier 2: CI runs every browser group on a UTC runner (`.github/workflows/ci.yml`).

## 2026-10-26: audit:wave-1:a7 environment failure

<!-- incident-run: 2026-10-26T063713853Z-13b89b -->

- Run: run `2026-10-26T063713853Z-13b89b`, group `audit:wave-1:a7`, target local, fingerprint `66a3dddeb91b`, world `6ebc54a2d6eb4eb099bc73bac1bb7041`.
- Failure point: Test runner: The test session was cancelled.
- Root cause: The agent session ended mid-run (exit 137) and killed the run with the test server, during a deliberately CPU-pinned diagnostic of CI-only calendar failures.
- Prevention: no prevention claim: an operator-session kill, not a test fault; the stack containers' CPU pinning was restored.

## 2026-10-25: unit:all harness failure

<!-- incident-run: unit:all@2026-10-25T211229915Z-12f68025 -->

- Run: run `unit:all@2026-10-25T211229915Z-12f68025`, group `unit:all`, target local, fingerprint `5f5f2782c9c4`.
- Failure point: unit:all in report 2026-10-25T211229915Z-12f68025: Command exited 1; inspect .agent-logs/verification/2026-10-25T211229915Z-12f68025/unit-all.log
- Root cause: terminateTree in lib/testing/local-stack/test-session.ts sent SIGKILL to the command's process group and returned at once; on Linux the descendants can still exist for a moment, so the cancellation test saw a live grandchild.
- Prevention: Tier 1: terminateTree waits, bounded, until no process of the group remains; Tier 2: test lib/testing/local-stack/test-session.test.ts checks the descendant after cancellation.

## 2026-10-25: audit:wave-3:p1-24a environment failure

<!-- incident-run: 2026-10-25T172335872Z-7e33cc -->

- Run: run `2026-10-25T172335872Z-7e33cc`, group `audit:wave-3:p1-24a`, target local, fingerprint `3d6cab4c4294`, world `f20355b95c204cc9a0fef08d668383ee`.
- Failure point:  >  > wave-3/p1-24a.spec.ts > P1-24a Plantafel, day and month audit @AUDIT-W3-P1-24A @AUDIT-W3 > AUDIT-05 the month view: closure label, absence bar, „+n mehr“, a date move and the popover @P1-24A-05: Error: expect(locator).toBeVisible() failed
- Root cause: The month move's Server Action took 412 ms against 169 ms for the same request earlier in the test, and the confirmed card arrived about 1.0 s after the drop, at the edge of the 1 s window; the card and the banner were correct at failure time.
- Prevention: Tier 3: the fresh-world diagnostic on the same build decides; a second miss is investigated as product latency.

## 2026-10-25: audit:layout:inventory product failure

<!-- incident-run: 2026-10-25T172335872Z-e402aa -->

- Run: run `2026-10-25T172335872Z-e402aa`, group `audit:layout:inventory`, target local, fingerprint `0cc709efb6dc`, world `d9cc1e3a941c430f8094883584b2806b`.
- Failure point:  >  > layout/surfaces-inventory.spec.ts > @AUDIT-LAYOUT-SURFACES inventory: tabs and dialogs fit, pass axe and keep their keyboard path > admin /inventar: Error: admin /inventar tab movements at 1280 px, light
- Root cause: The movements table grew 41 px wider than its region at 1280 px in Geist because item and location names with long tokens could not wrap, and the scrolling region has no focusable content (axe scrollable-region-focusable).
- Prevention: Tier 2: group audit:layout:inventory runs axe on the tab; the name cells in components/inventar/inventory-content.tsx break anywhere.

## 2026-10-25: audit:layout:documents product failure

<!-- incident-run: 2026-10-25T172335872Z-2810e8 -->

- Run: run `2026-10-25T172335872Z-2810e8`, group `audit:layout:documents`, target local, fingerprint `7dc52f17f5b6`, world `2894b6ea32ef4b158ecf483513a69338`.
- Failure point:  >  > layout/surfaces-documents.spec.ts > @AUDIT-LAYOUT-SURFACES documents: tabs and dialogs fit, pass axe and keep their keyboard path > admin /dokumente: Error: admin /dokumente dialog documents.details at 1280 px
- Root cause: The document details dialog showed the uploader name, whose test value ends in a 32-character token, in a grid column that could not shrink below it in Geist; the dialog scrolled sideways.
- Prevention: Tier 2: group audit:layout:documents finds sideways scrolling; long values in components/dokumente/document-details-dialog.tsx break anywhere.

## 2026-10-25: audit:layout:viewports product failure

<!-- incident-run: 2026-10-25T172335872Z-1264d9 -->

- Run: run `2026-10-25T172335872Z-1264d9`, group `audit:layout:viewports`, target local, fingerprint `c31e3243d2dd`, world `c3e2056e77ff471c989af3aaf9008c00`.
- Failure point:  >  > layout/viewport-details.spec.ts > @AUDIT-LAYOUT phone details and route aliases > admin /auftraege/[jobNumber] fits a 375 px viewport: Error: /auftraege/AUF-c3e2056e77ff471c989af3aaf9008c00-LAYOUT: content wider than the page body
- Root cause: At 375 px the job detail's Voraussetzungen and Blocker section headers hold a title and a 224 px Geist button in one non-wrapping row, 2 px wider than the page body.
- Prevention: Tier 2: group audit:layout:viewports measures the page body; the header rows in components/auftraege/lifecycle/ wrap.

## 2026-10-25: audit:wave-2:p1-20 product failure

<!-- incident-run: 2026-10-25T172335872Z-781946 -->

- Run: run `2026-10-25T172335872Z-781946`, group `audit:wave-2:p1-20`, target local, fingerprint `c0d23fd5c3ca`, world `ffffc1d9470b449dbf37faad98598ff0`.
- Failure point:  >  > wave-2/p1-20.spec.ts > P1-20 exhaustive maintenance audit @AUDIT-W2-P1-20 @AUDIT-W2 > attaches a coverage document and keeps its frame stable while loading: Error: 1280px document actionsX
- Root cause: The documents toolbar skeleton kept 112 px placeholders while the Geist buttons measure 125 and 119 px, so the toolbar moved 14 px when the documents loaded.
- Prevention: Tier 2: group audit:wave-2:p1-20 compares the loading and loaded frame; the placeholders in components/dokumente/contextual-documents-layout.tsx take the Geist widths.

## 2026-10-25: audit:wave-1:a6 product failure

<!-- incident-run: 2026-10-25T172335872Z-ed2751 -->

- Run: run `2026-10-25T172335872Z-ed2751`, group `audit:wave-1:a6`, target local, fingerprint `321e2d3f2f8e`, world `fc399b8956f347c2b41a58080440b199`.
- Failure point:  >  > wave-1/a6-planung.spec.ts > A6 Planung @AUDIT-W1-A6 > A6-T4: Vergangenes und Begonnenes bleibt unverändert; abgesagte und ausgelassene Termine bleiben sichtbar [P1-11-F03]: TimeoutError: locator.click: Timeout 30000ms exceeded.
- Root cause: With Geist, the four footer actions of the planning occurrence dialog no longer fit one non-wrapping row; Auslassen sat partly outside the dialog and the overlay took the click.
- Prevention: Tier 1: DialogFooter in components/ui/dialog.tsx wraps its actions from the sm breakpoint; Tier 2: group audit:wave-1:a6 drives the action.

## 2026-10-25: unit:all product failure

<!-- incident-run: unit:all@2026-10-25T094551038Z-6a244fd4 -->

- Run: run `unit:all@2026-10-25T094551038Z-6a244fd4`, group `unit:all`, target local, fingerprint `affd5a312fe6`.
- Failure point: unit:all in report 2026-10-25T094551038Z-6a244fd4: Command exited 1; inspect .agent-logs/verification/2026-10-25T094551038Z-6a244fd4/unit-all.log
- Root cause: The maintenance repair shortened createMaintenanceVisit from 154 to 152 counted lines, and the shrink-only size-cap ceiling in eslint-rules/size-cap-exceptions.json still said 154.
- Prevention: Tier 2: lib/conventions/module-caps.test.ts fails on a ceiling above the function's size, so the ratchet records every reduction.
- Evidence: the `unit:all` log shows `lib/conventions/module-caps.test.ts` asking to lower the ceiling of `createMaintenanceVisit` from 154 to 152.
- Correction: the ceiling in `eslint-rules/size-cap-exceptions.json` is 152.
- Focused proof: `unit:all` passed on target local in report `2026-10-25T101151980Z-b55f3d6a`, fingerprint `77dbccc93257`.
- Cleanup: a static or unit group owns no world; nothing to clean.

## 2026-10-25: unit:all product failure

<!-- incident-run: unit:all@2026-10-25T083235000Z-caf5ca36 -->

- Run: run `unit:all@2026-10-25T083235000Z-caf5ca36`, group `unit:all`, target local, fingerprint `efef5a6019f5`.
- Failure point: unit:all in report 2026-10-25T083235000Z-caf5ca36: Command exited 1; inspect .agent-logs/verification/2026-10-25T083235000Z-caf5ca36/unit-all.log
- Root cause: zod 4.6 refuses .omit() on an object schema with a refinement, so createMaintenanceVisit threw on its first line; zod 4.1.12 had silently dropped the superRefine there, so the pairing of due items and expected versions was enforced only by the database function.
- Prevention: Tier 2: lib/maintenance/action-boundaries.test.ts drives the real action and caught the throw; the action now parses one refined maintenanceVisitSchema, and a load of every module that derives a schema found no other refined base.
- Evidence: the `unit:all` log shows `.omit() cannot be used on object schemas containing refinements` thrown from `createMaintenanceVisit` in `lib/maintenance/action-boundaries.test.ts`; the `omit` of zod 4.1.12 sets `checks: []`.
- Correction: `maintenanceVisitSchema` replaces `maintenanceVisitLinkSchema`, whose `jobId` and `planningOccurrenceId` no action read, so the action parses the refined schema without deriving it.
- Focused proof: `unit:all` passed on target local in report `2026-10-25T101151980Z-b55f3d6a`, fingerprint `77dbccc93257`.
- Cleanup: a static or unit group owns no world; nothing to clean.

## 2026-10-25: static:dependencies product failure

<!-- incident-run: static:dependencies@2026-10-25T080711959Z-ff9fbe0b -->

- Run: run `static:dependencies@2026-10-25T080711959Z-ff9fbe0b`, group `static:dependencies`, target local, fingerprint `578258d0666b`.
- Failure point: static:dependencies in report 2026-10-25T080711959Z-ff9fbe0b: Command exited 1; inspect .agent-logs/verification/2026-10-25T080711959Z-ff9fbe0b/static-dependencies.log
- Root cause: GHSA-mrhx-c7xc-m3w5 (high, zod below 4.6.6 exhausts memory validating oversized constrained collections) joined the advisory database for the locked zod 4.1.12 and the nested knip copy 4.6.5; zod upgraded to 4.6.7 with one deduplicated copy. The braces exception counted 0 because GHSA-vfj7-8cjw-p6xm was withdrawn on 2026-10-23; the exception is removed.
- Prevention: Tier 2: static:dependencies caught the advisory before publication, and inspectDependencyAudit now fails on an exception that matches no current finding.
- Evidence: the audit report under `.agent-logs/security/dependencies/` named zod 4.1.12 at `zod` and 4.6.5 at `knip/zod`; the GitHub advisory API marks GHSA-vfj7-8cjw-p6xm withdrawn.
- Correction: zod `^4.6.7` with the stale nested lock entries dropped, so one zod 4.6.7 serves the app, knip and eslint-plugin-react-hooks; `nullableTrimmedText` takes the `ZodPreprocess` type of zod 4.6; the withdrawn braces exception leaves `lib/security/dependency-exceptions.json` at the new digest.
- Focused proof: `static:dependencies` passed on target local in report `2026-10-25T094551038Z-6a244fd4`, fingerprint `4a2753a0d20f`, and its proof carried into the passing report `2026-10-25T101151980Z-b55f3d6a`.
- Cleanup: a static or unit group owns no world; nothing to clean.

## 2026-10-23: audit:layout environment failure

<!-- incident-run: 2026-10-23T133525904Z-c4f984 -->

- Run: run `2026-10-23T133525904Z-c4f984`, group `audit:layout`, target local, fingerprint `9695fd82642a`, world `f64cc01a40d0401f9c52b630d908a3cc`.
- Failure point:  >  > layout\mobile-viewport.spec.ts > @AUDIT-LAYOUT phone viewport: no horizontal scroll, shell-owned scroll, no native controls > admin /anfragen fits a 375 px viewport: TimeoutError: locator.click: Timeout 30000ms exceeded.
- Root cause: The browser failed to load a JavaScript chunk with net::ERR_NETWORK_CHANGED (a host network change on this workstation), so /anfragen at 375 px never hydrated and the refresh and clock buttons stayed disabled
- Prevention: Tier 2: the playwright-spec/no-swallowed-failure rule keeps the audit failing loudly on an unhydrated page; a host network change has no repository mechanism
- Focused proof: the replay on the retained world passed (diagnostic run `2026-10-23T152704796Z-b34d22`), and `audit:layout` passed in the repair plan, report `2026-10-23T152746796Z-a6297c81`.

## 2026-10-23: audit:performance:calendar harness failure

<!-- incident-run: 2026-10-23T113225946Z-cb0cac -->

- Run: run `2026-10-23T113225946Z-cb0cac`, group `audit:performance:calendar`, target local, fingerprint `fd2ea4c7c1b5`, world `fb65159f5ff044589db7b6eb9bba94fc`.
- Failure point: Execution evidence: scenario-latencies.ndjson (calendar.board.cold-open median): comparison is unverified (no reviewed baseline for this scenario, version, profile, and backend); a required scenario cannot pass without a reviewed baseline and valid samples.
- Root cause: Package S changed the measured support files tests/golden/support/scenario-measurement.ts and tests/audit/support/performance-steps.ts, so every scenario's measurement digest moved and no reviewed reference matches; every scenario stayed within its budget
- Prevention: Tier 2: lib/testing/performance-references.test.ts names the orphaned references; recalibrated through scripts/calibrate-performance.ts
- Correction: the scenarios were recalibrated from passing runs `2026-10-23T114544582Z-dc8254`, `-7e4d71`, `-77e7ea` and `-7c83d8` through `scripts/calibrate-performance.ts` (comparison set to calibrating for those runs only), and the emptied carry-over drops its retired proof.
- Focused proof: all five `audit:performance:*` groups passed against the new references in report `2026-10-23T115718115Z-24f50736`.

## 2026-10-23: audit:performance:field harness failure

<!-- incident-run: 2026-10-23T113225946Z-9526bf -->

- Run: run `2026-10-23T113225946Z-9526bf`, group `audit:performance:field`, target local, fingerprint `4fb05b48c01b`, world `7ad3491748964a0cb4237498208aa4f5`.
- Failure point: Execution evidence: scenario-latencies.ndjson (time.clock-in.visible median): comparison is unverified (no reviewed baseline for this scenario, version, profile, and backend); a required scenario cannot pass without a reviewed baseline and valid samples.
- Root cause: Package S changed the measured support files tests/golden/support/scenario-measurement.ts and tests/audit/support/performance-steps.ts, so every scenario's measurement digest moved and no reviewed reference matches; every scenario stayed within its budget
- Prevention: Tier 2: lib/testing/performance-references.test.ts names the orphaned references; recalibrated through scripts/calibrate-performance.ts
- Correction: the scenarios were recalibrated from passing runs `2026-10-23T114544582Z-dc8254`, `-7e4d71`, `-77e7ea` and `-7c83d8` through `scripts/calibrate-performance.ts` (comparison set to calibrating for those runs only), and the emptied carry-over drops its retired proof.
- Focused proof: all five `audit:performance:*` groups passed against the new references in report `2026-10-23T115718115Z-24f50736`.

## 2026-10-23: audit:performance:planning harness failure

<!-- incident-run: 2026-10-23T113225946Z-c1789c -->

- Run: run `2026-10-23T113225946Z-c1789c`, group `audit:performance:planning`, target local, fingerprint `f02cba0f12d6`, world `c706e41056a4412891fd196860b4bb23`.
- Failure point: Execution evidence: scenario-latencies.ndjson (planning.occurrence.cross-session median): comparison is unverified (no reviewed baseline for this scenario, version, profile, and backend); a required scenario cannot pass without a reviewed baseline and valid s…
- Root cause: Package S changed the measured support files tests/golden/support/scenario-measurement.ts and tests/audit/support/performance-steps.ts, so every scenario's measurement digest moved and no reviewed reference matches; every scenario stayed within its budget
- Prevention: Tier 2: lib/testing/performance-references.test.ts names the orphaned references; recalibrated through scripts/calibrate-performance.ts
- Correction: the scenarios were recalibrated from passing runs `2026-10-23T114544582Z-dc8254`, `-7e4d71`, `-77e7ea` and `-7c83d8` through `scripts/calibrate-performance.ts` (comparison set to calibrating for those runs only), and the emptied carry-over drops its retired proof.
- Focused proof: all five `audit:performance:*` groups passed against the new references in report `2026-10-23T115718115Z-24f50736`.

## 2026-10-23: audit:performance:lists harness failure

<!-- incident-run: 2026-10-23T113225946Z-f74add -->

- Run: run `2026-10-23T113225946Z-f74add`, group `audit:performance:lists`, target local, fingerprint `f981f34ceceb`, world `8b55b804a0e943f5a0cde0d9ceed64f5`.
- Failure point: Execution evidence: scenario-latencies.ndjson (customers.list.open median): comparison is unverified (no reviewed baseline for this scenario, version, profile, and backend); a required scenario cannot pass without a reviewed baseline and valid samples.
- Root cause: Package S changed the measured support files tests/golden/support/scenario-measurement.ts and tests/audit/support/performance-steps.ts, so every scenario's measurement digest moved and no reviewed reference matches; every scenario stayed within its budget
- Prevention: Tier 2: lib/testing/performance-references.test.ts names the orphaned references; recalibrated through scripts/calibrate-performance.ts
- Correction: the scenarios were recalibrated from passing runs `2026-10-23T114544582Z-dc8254`, `-7e4d71`, `-77e7ea` and `-7c83d8` through `scripts/calibrate-performance.ts` (comparison set to calibrating for those runs only), and the emptied carry-over drops its retired proof.
- Focused proof: all five `audit:performance:*` groups passed against the new references in report `2026-10-23T115718115Z-24f50736`.

## 2026-10-23: audit:layout:planning harness failure

<!-- incident-run: 2026-10-23T101831902Z-794dc4 -->

- Run: run `2026-10-23T101831902Z-794dc4`, group `audit:layout:planning`, target local, fingerprint `c0df77463938`, world `6ee6c2eb7001494c9b4591936ae9f3ed`.
- Failure point:  >  > layout\surfaces-planning.spec.ts > @AUDIT-LAYOUT-SURFACES planning: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kalender part 1 of 2: Error: expect(locator).toBeVisible() failed
- Root cause: calendar.time-correction dragged the recorded block before the calendar's time_approval holder read had rendered (canManageBlock now waits for that background read), so the block offered no drag and no correction dialog opened (third opening, 155 ms after the read answered)
- Prevention: Tier 2: tests/audit/support/dialog-openers/calendar.ts waits until the block shows the grab cursor (canManage) before it drags
- Focused proof: `audit:layout:planning` passed in report `2026-10-23T102443704Z-27b8fb49`.

## 2026-10-23: audit:layout:field harness failure

<!-- incident-run: 2026-10-23T100936845Z-af14b9 -->

- Run: run `2026-10-23T100936845Z-af14b9`, group `audit:layout:field`, target local, fingerprint `4d1d74d34882`, world `88334292a65f4bcebfcb76cce5cef8e0`.
- Failure point:  >  > layout\surfaces-field.spec.ts > @AUDIT-LAYOUT-SURFACES field: tabs and dialogs fit, pass axe and keep their keyboard path > employee /aufgaben: Error: Enter on the trigger opens the dialog
- Root cause: field.evidence-upload reloads /aufgaben after its seed and the audit pressed Enter on the server-rendered Nachweis hochladen button at 768 px before hydration, so no dialog opened
- Prevention: Tier 2: the reloading openers in tests/audit/support/dialog-openers/time.ts wait for hydratedAndSettled before returning the trigger; proposed for the lead: openLayerAt waits for hydration before it focuses any trigger
- Focused proof: `audit:layout:field` passed in report `2026-10-23T111616575Z-3f1d49bb`.

## 2026-10-23: audit:lab:office product failure

<!-- incident-run: 2026-10-23T085001267Z-14feb3 -->

- Run: run `2026-10-23T085001267Z-14feb3`, group `audit:lab:office`, target local, fingerprint `15c6c328daa8`, world `bcfc82bdea444bb8bb07e72560e88c17`.
- Failure point: no failed test recorded; read the run log.
- Root cause: the next 16.4 byte floors (React Flight writes each chunk path once, fewer script files) and the cold-start Auth user shape that S7 removed on purpose; counts all at or below reference
- Prevention: Tier 2: the lab floors and shape check caught both; each target accepted through bun scripts/lab-counts.ts accept with its proof, counts lowered with ratchet

## 2026-10-23: audit:lab:field product failure

<!-- incident-run: 2026-10-23T084528911Z-c7526e -->

- Run: run `2026-10-23T084528911Z-c7526e`, group `audit:lab:field`, target local, fingerprint `8c9714003be6`, world `84d8fde64bab4a6fa7d0331a1d6131f1`.
- Failure point: no failed test recorded; read the run log.
- Root cause: the next 16.4 byte floors (React Flight writes each chunk path once) and the cold-start Auth user shape that S7 removed on purpose; counts all at or below reference
- Prevention: Tier 2: the lab floors and shape check caught both; each target accepted through bun scripts/lab-counts.ts accept with its proof, counts lowered with ratchet

## 2026-10-23: audit:lab:field product failure

<!-- incident-run: 2026-10-23T082231574Z-341de5 -->

- Run: run `2026-10-23T082231574Z-341de5`, group `audit:lab:field`, target local, fingerprint `8c9714003be6`, world `24693a5a746d402bab005058bc48d27c`.
- Failure point: no failed test recorded; read the run log.
- Root cause: the Realtime join catch-up reached only views subscribed at database readiness; with the faster join (no mount getUser holding the auth lock) the streamed job list hydrated after readiness and missed its catch-up route refresh
- Prevention: Tier 2: lib/realtime/listener-registry.test.ts; a view hydrated with server data that subscribes after readiness now gets one catch-up (lib/realtime/listener-registry.ts, hooks/use-realtime-tables.ts)

## 2026-10-23: audit:lab:field product failure

<!-- incident-run: 2026-10-23T075613413Z-20c142 -->

- Run: run `2026-10-23T075613413Z-20c142`, group `audit:lab:field`, target local, fingerprint `062caabcaecf`, world `9fb950339e904482ab449fbf53164d04`.
- Failure point: no failed test recorded; read the run log.
- Root cause: next 16.4 React Flight writes each chunk path once instead of in every client-reference row, so RSC payload bytes fell 14 to 45 % below the lab floors; server reads, request sequence and data rows are unchanged
- Prevention: Tier 2: the lab byte floors caught the framework change; each shrunken target is accepted through bun scripts/lab-counts.ts accept with a reason naming the proof

## 2026-10-23: audit:lab:field harness failure

<!-- incident-run: 2026-10-23T055721176Z-2e1bc5 -->

- Run: run `2026-10-23T055721176Z-2e1bc5`, group `audit:lab:field`, target local, fingerprint `923b4a4fafb1`, world `04232d3dccad40609a5ce778edadaf8f`.
- Failure point:  >  > lab\field.spec.ts > Lab counts of the field worker @AUDIT-LAB-FIELD > LAB-F4 the field worker clocks in, stays idle, and clocks out @AUDIT-LAB-F4: Error: lab.field.clock-in released a live read that a dialog held since before the step: settle the page (settleLiveShell) before you open the dialog.
- Root cause: Two causes. (1) The known clock-step defect from run 2026-10-23T042502537Z-2f9bd3 is still unrepaired: lab.field.clock-in starts with a live read held since before the step, the recorder refuses the sample, and clock-in, idle-clocked-in and clock-out record nothing. (2) Commit 30c67a90 upgraded next 16.3.8 to 16.4.1 (security advisories); the field lab's byte floors for the /auftraege document, route and script payloads and the job-open, checklist-tick and evidence-add payloads now fall 14 to 45 percent below their recorded floors. A shrink is expected from the framework upgrade but needs a reviewer to confirm nothing is missing before bun scripts/lab-counts.ts accept. No product latency regression is established.
- Prevention: Tier 2: tests/audit/support/lab-recorder.ts rejects held-read contamination and lib/testing/lab-evidence.ts refuses an unreviewed floor shrink. Follow-up: repair the clock setup precondition, then review and accept the 16.4.1 floors per step.
- Correction (2026-10-23): the held read is the join catch-up. Database readiness queues a debounced read in every live view, and `settleLiveShell` waited on the `networkidle` load state, which a document reaches once, before readiness; the clock sheet opened inside the debounce and held the read. `settleLiveShell` now waits until `<html data-live-read-pending>` and `data-route-refresh` clear (`hooks/use-live-view.ts`, probe in `tests/ui-contracts/controls.spec.ts`), and the gated `requests` count leaves out router prefetches, which `prefetches` reports beside it.
- Focused proof: `audit:lab:field` runs `2026-10-23T085545465Z-6fd13e`, `2026-10-23T090054965Z-ebd7df`, `2026-10-23T090553043Z-b2c041` and `audit:lab:office` runs `2026-10-23T085801675Z-2211c9`, `2026-10-23T090305882Z-7b2458`, `2026-10-23T090806549Z-359741` passed in a row.

## 2026-10-23: audit:lab:field harness failure

<!-- incident-run: 2026-10-23T042502537Z-2f9bd3 -->

- Run: run `2026-10-23T042502537Z-2f9bd3`, group `audit:lab:field`, target local, fingerprint `e8af94924b25`, world `04963324c38a4abcb03bef9b13275794`.
- Failure point:  >  > lab\field.spec.ts > Lab counts of the field worker @AUDIT-LAB-FIELD > LAB-F4 the field worker clocks in, stays idle, and clocks out @AUDIT-LAB-F4: Error: lab.field.clock-in released a live read that a dialog held since before the step: settle the page (settleLiveShell) before you open the dialog.
- Root cause: Evidence-add recorded one action and three prefetches, against a reference total of three with two prefetches. Timing-dependent prefetch traffic therefore trips the gated total although each prefetch shape is informational. The clock step began with a held live read despite settleLiveShell, which waits for readiness and networkidle; closing the sheet released it and the recorder refused the contaminated sample. No product latency regression is established.
- Prevention: Tier 2: tests/audit/support/lab-recorder.ts rejects held-read contamination. Keep that refusal. Follow-up must repair the clock setup precondition and distinguish timing-dependent prefetch traffic in the count gate. No repaired performance proof is claimed.
- Correction (2026-10-23): the held read is the join catch-up. Database readiness queues a debounced read in every live view, and `settleLiveShell` waited on the `networkidle` load state, which a document reaches once, before readiness; the clock sheet opened inside the debounce and held the read. `settleLiveShell` now waits until `<html data-live-read-pending>` and `data-route-refresh` clear (`hooks/use-live-view.ts`, probe in `tests/ui-contracts/controls.spec.ts`), and the gated `requests` count leaves out router prefetches, which `prefetches` reports beside it.
- Focused proof: `audit:lab:field` runs `2026-10-23T085545465Z-6fd13e`, `2026-10-23T090054965Z-ebd7df`, `2026-10-23T090553043Z-b2c041` and `audit:lab:office` runs `2026-10-23T085801675Z-2211c9`, `2026-10-23T090305882Z-7b2458`, `2026-10-23T090806549Z-359741` passed in a row.

## 2026-10-22: audit:layout:documents harness failure

<!-- incident-run: 2026-10-22T231034535Z-16fa3a -->

- Run: run `2026-10-22T231034535Z-16fa3a`, group `audit:layout:documents`, target local, fingerprint `9bb154049cb9`, world `a8343868feda48f38094031976d617ec`.
- Failure point:  >  > layout\surfaces-documents.spec.ts > @AUDIT-LAYOUT-SURFACES documents: tabs and dialogs fit, pass axe and keep their keyboard path > admin /dokumente: Error: the trigger is on screen at 375 px; a trigger this width does not render needs the opener of its own path there, or opensOn: 'desktop' with the phonePath that reaches the dialog
- Root cause: the documents.rename opener clicked the phone card's file actions button with the mouse; Radix opens the menu on press and an item rendered under the pointer is chosen on release, so the release chose Löschen and opened the delete confirmation instead of showing Umbenennen (trace: one click, then the alertdialog). Package R removed the desktop fallback, so the phone path ran for the first time
- Prevention: Tier 1: the documents openers open the row menu from the keyboard (libraryFileAction in tests/audit/support/dialog-openers/documents.ts)
- Focused proof: `audit:layout:documents` passed alone (report `2026-10-22T235636830Z-6ea90877`) and in change plan `2026-10-23T000439910Z-64b7698d`.

## 2026-10-22: audit:layout:field harness failure

<!-- incident-run: 2026-10-22T213250456Z-193668 -->

- Run: run `2026-10-22T213250456Z-193668`, group `audit:layout:field`, target local, fingerprint `eae0c4282485`, world `12a1adbf57cc4820b196b597ea9eb55a`.
- Failure point:  >  > layout\surfaces-field.spec.ts > @AUDIT-LAYOUT-SURFACES field: tabs and dialogs fit, pass axe and keep their keyboard path > employee /dashboard: Error: the trigger is on screen at 375 px; a trigger this width does not render needs the opener of its own path there, or opensOn: 'desktop' with the phonePath that reaches the dialog
- Root cause: settings.join-org opened the sidebar organization switcher on the desktop through the silent fallback package R removed; on a phone the switcher sits in the menu sheet, so the opener now declares opensOn desktop with that phonePath
- Prevention: Tier 2: tests/audit/support/open-layer-plan.ts fails an undeclared trigger off screen at its width by name; Tier 1: tests/audit/support/dialog-opener.ts requires a phonePath with opensOn desktop
- Focused proof: change plan `2026-10-23T000439910Z-64b7698d` passed the group with the declared opener.

## 2026-10-22: audit:layout:settings harness failure

<!-- incident-run: 2026-10-22T213250456Z-ec38d6 -->

- Run: run `2026-10-22T213250456Z-ec38d6`, group `audit:layout:settings`, target local, fingerprint `5be1ed6e12d1`, world `214a90220f2647878d83b71160a8bcff`.
- Failure point:  >  > layout\surfaces-settings.spec.ts > @AUDIT-LAYOUT-SURFACES settings: tabs and dialogs fit, pass axe and keep their keyboard path > admin /dashboard: Error: the trigger is on screen at 375 px; a trigger this width does not render needs the opener of its own path there, or opensOn: 'desktop' with the phonePath that reaches the dialog
- Root cause: settings.create-org opened the sidebar organization switcher on the desktop through the silent fallback package R removed; on a phone the switcher sits in the menu sheet, so the opener now declares opensOn desktop with that phonePath
- Prevention: Tier 2: tests/audit/support/open-layer-plan.ts fails an undeclared trigger off screen at its width by name; Tier 1: tests/audit/support/dialog-opener.ts requires a phonePath with opensOn desktop
- Focused proof: change plan `2026-10-23T000439910Z-64b7698d` passed the group with the declared opener.

## 2026-10-22: audit:layout:planning-board harness failure

<!-- incident-run: 2026-10-22T213250456Z-c773bc -->

- Run: run `2026-10-22T213250456Z-c773bc`, group `audit:layout:planning-board`, target local, fingerprint `a11befc5dd15`, world `f2b03a77f6344ea087c5322a05e99bc6`.
- Failure point:  >  > layout\surfaces-planning-board.spec.ts > @AUDIT-LAYOUT-SURFACES planning-board: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kalender part 2 of 2: Error: the trigger is on screen at 375 px; a trigger this width does not render needs the opener of its own path there, or opensOn: 'desktop' with the phonePath that reaches the dialog
- Root cause: calendar.shortcuts opened its Plantafel toolbar button on the desktop through the silent fallback package R removed; the phone lists render no toolbar, so the opener now declares opensOn desktop with its phonePath (none by design)
- Prevention: Tier 2: tests/audit/support/open-layer-plan.ts fails an undeclared trigger off screen at its width by name; Tier 1: tests/audit/support/dialog-opener.ts requires a phonePath with opensOn desktop
- Focused proof: change plan `2026-10-23T000439910Z-64b7698d` passed the group with the declared opener.

## 2026-10-22: unit:all harness failure (pre-push hook override test)

- Run: report `2026-10-22T060509450Z-da730821`, group `unit:all`, target local; no run key and no retained world (a unit group).
- Failure point: `lib/testing/publication/pre-push-hook.test.ts`, "the owner override passes a refused push only with a log line naming the commit and the reason": `git push` exited 1 instead of 0.
- Evidence: `unit-all.log` of that report only; the assertion printed no child output.
- Root cause: the hook script called `cat`, `tr`, `mkdir` and `date`, which a shell whose PATH lacks Git's `usr/bin` does not have (a Codex PowerShell session); with such a PATH the hook refuses the override and the test fails the same way, exit 1 without output. Found on 2026-10-23 after Codex hit it and took it for its environment; the failed run's PATH was not recorded. 30 sequential runs and 15 runs beside a full unit run, all with Git's `usr/bin` on the PATH, passed. Classified harness: the hook depended on its caller's PATH, and the test's assertion hid the failure.
- Correction: every exit-code assertion of the test carries the child's output.
- Correction (2026-10-23): `.githooks/pre-push` only execs `scripts/pre-push.ts`, which reads the refs, runs the gate and logs an override with Bun and git alone.
- Prevention: Tier 2: `lib/conventions/unit-test-timeouts.test.ts` refuses an exit-code assertion without the child's output. The hook's own Tier 1 and Tier 2 mechanisms retired with the local publication gate ([decision 0009](../decisions/0009-pull-requests-and-ci.md)).
- Focused proof: `bun test lib/testing/publication/pre-push-hook.test.ts` passed 45 of 45 runs on the corrected test; the PATH probe fails on the old hook and passes on the new one.

## 2026-10-22: audit:lab:office product failure

<!-- incident-run: 2026-10-22T152820321Z-4c45dc -->

- Run: run `2026-10-22T152820321Z-4c45dc`, group `audit:lab:office`, target local, fingerprint `c7a698c7884a`, world `a1cb908022fb446da2fa3063df30b0e3`.
- Failure point: no failed test recorded; read the run log.
- Root cause: The lab judge saw the package's intended changes before their references moved: lower counts (own-save echo skipped, memoized rows, settled dialogs), the 44 px class strings in the server document, and request shapes that stopped
- Prevention: Tier 2: scripts/lab-counts.ts ratchet and accept recorded each change with its reason in lib/testing/lab-count-references.json
- Focused proof: change plan `2026-10-22T160155402Z-c8dcc3cf` passed both lab groups on the repaired tree.

## 2026-10-22: audit:lab:field product failure

<!-- incident-run: 2026-10-22T152820321Z-ddebd8 -->

- Run: run `2026-10-22T152820321Z-ddebd8`, group `audit:lab:field`, target local, fingerprint `e8af94924b25`, world `da8cd52ef117493abe0f86715b8f4a09`.
- Failure point: no failed test recorded; read the run log.
- Root cause: The lab judge saw the package's intended changes before their references moved: lower counts (own-save echo skipped, memoized rows, settled dialogs), the 44 px class strings in the server document, and request shapes that stopped
- Prevention: Tier 2: scripts/lab-counts.ts ratchet and accept recorded each change with its reason in lib/testing/lab-count-references.json
- Focused proof: change plan `2026-10-22T160155402Z-c8dcc3cf` passed both lab groups on the repaired tree.

## 2026-10-22: audit:lab:field harness failure

<!-- incident-run: 2026-10-22T151900954Z-108cf1 -->

- Run: run `2026-10-22T151900954Z-108cf1`, group `audit:lab:field`, target local, fingerprint `11dab2802ebd`, world `5ac3bfee329048b0aa6db4dc31783093`.
- Failure point:  >  > lab\field.spec.ts > Lab counts of the field worker @AUDIT-LAB-FIELD > LAB-F3 the field worker saves a new Arbeitsnachweis @AUDIT-LAB-F3: Error: lab.field.evidence-add starts while a dialog holds a live read back: settle the page (settleLiveShell) before you open the dialog.
- Root cause: The new recorder precondition refused lab.field.evidence-add because its open artifact dialog held the echo of the draft it created; that held read never releases inside a step that keeps the dialog open
- Prevention: Tier 2: tests/audit/support/lab-recorder.ts now fails a step only when it released a live read held since before the step
- Focused proof: change plan `2026-10-22T160155402Z-c8dcc3cf` passed both lab groups on the repaired tree.

## 2026-10-22: audit:lab:office product failure

<!-- incident-run: 2026-10-22T151900954Z-0d390e -->

- Run: run `2026-10-22T151900954Z-0d390e`, group `audit:lab:office`, target local, fingerprint `c421331f5ea7`, world `34350d36db9a48fe8faafaeaca609ffa`.
- Failure point: no failed test recorded; read the run log.
- Root cause: lab.office.job-open lost its warm-up: rowIntentPrefetch skipped a pointermove without movementX/Y, and the first pointer move after a navigation reports zero movement, so hovering the row prefetched nothing and the open fetched the full route and scripts (requests 7 to 16, scripts 9 KB to 115 KB)
- Prevention: Tier 2: audit:lab:office budgets and ceilings on lab.office.job-open caught it; lib/ui/row-intent.ts now warms on the first pointermove of each arrival
- Focused proof: change plan `2026-10-22T160155402Z-c8dcc3cf` passed both lab groups on the repaired tree.

## 2026-10-22: audit:lab:field harness failure

<!-- incident-run: 2026-10-22T102242015Z-c57225 -->

- Run: run `2026-10-22T102242015Z-c57225`, group `audit:lab:field`, target local, fingerprint `3f326f900092`, world `d8709b6614b54750b197f4bdae2fbc20`.
- Failure point: no failed test recorded; read the run log.
- Root cause: lab.field.clock-in caught an /api/attention-counts refresh about 700 ms after the clock-in, which the reference lacks (shape-added). The race predates this change: three of the six calibration runs of 2026-10-21 carried the same request, so the calibration left the shape out as unstable (appeared in 3 of 6 runs) while the judge still fails on its presence. The product code of the clock-in, the attention counts and the lab files is unchanged by this diff.
- Prevention: Tier 2: tests/audit/support/lab-recorder.ts fails a step that released a live read a dialog held since before the step (`data-live-read-held`, set by lib/ui/route-refresh-signal.ts from useLiveView and useRealtimeRouterRefresh), and LAB-F4, LAB-F3 and LAB-O3 settle the live shell before they open their dialog.
- Correction: the request was the Realtime join's catch-up (`dispatchAll`), not an echo of the clock-in. LAB-F4 opened the clock dialog before the join reported database readiness; the dialog suspended every live view, and its close released their queued catch-up inside the measured step. The lab stays strict: no tolerance for an unstable shape. The product keeps the catch-up after a dialog closes: it re-reads views the closing action did not refresh (the attention counts, the memberships), so skipping it would show stale data.
- Evidence: two focused runs of LAB-F4 with the old order on one build. Run `2026-10-22T151609765Z-95e1e3` passed with no attention read in the clock-in step; run `2026-10-22T151708290Z-d31d4e` held a live read when the step started, and the new precondition refused it (its first form, checked at the step start). The race needs the join's readiness to land after the dialog opened, as the request sequences of the earlier failures showed.

## 2026-10-22: audit:wave-1:a1-zeiten environment failure

<!-- incident-run: 2026-10-22T102242015Z-4e7ff1 -->

- Run: run `2026-10-22T102242015Z-4e7ff1`, group `audit:wave-1:a1-zeiten`, target local, fingerprint `dfab5b91e27b`, world `4d8d950d39304578a43fec83b13af12b`.
- Failure point:  >  > wave-1\a1-zeiten.spec.ts > A1 Zeiterfassung @AUDIT-W1-A1 > A1-29: Manuelle Zeiten lehnen falsche Reihenfolge und Überlappung ab: Error: Preference reset failed: TypeError: fetch failed
- Root cause: The test process lost its connection to the local Supabase gateway in the WSL VM during setup: the admin client's preference reset threw TypeError fetch failed before the test acted; the other three tests of the group passed on the same world and the next groups ran normally.
- Prevention: Tier 2 existing: the bounded backend probe before every browser group (lib/testing/runner/backend-health.ts) and the environment retry rule; no product or test change.

## 2026-10-17: audit:lab:office harness failure

<!-- incident-run: 2026-10-17T163504743Z-eed03c -->

- Run: run `2026-10-17T163504743Z-eed03c`, group `audit:lab:office`, target local, fingerprint `acac368d556d`, world `e0bbb9403ab24eb38ba3a4c30e99eb94`.
- Failure point: no failed test recorded; all 7 tests passed and the runner's release-mode lab judgment failed the group: "lab.office.entry-open componentRenders fell to 1425 below its reference 2084".
- Root cause: The lab world's live week depends on the run day, not the product: tests/audit/support/performance-profile.ts seeds seven days from run day + 141 and LAB-O4 opens the Plantafel week of that date, whose read window (the Sunday before its Monday to the Monday after) holds three seeded days when the run day is a Friday and two on a Saturday. lab.office.entry-open rendered 2084-2086 components on all 19 Friday runs (2026-10-09 and 2026-10-16) and 1425 on all 6 Saturday runs of 2026-10-17 (six builds, one measurement digest 5f79d527), and lab.office.visit-move read 121 against 81 calendar-window rows (40 per seeded day plus the measured visit). The reference 2084 was calibrated on a Friday; the lower count is fewer cards on the board, not less work per card.
- Prevention: Tier 1: tests/golden/support/date-ownership.ts gets a week claim that returns the Monday of a whole owned week, and tests/audit/support/performance-profile.ts seeds the live week Monday to Sunday through it, so the board shows all seven seeded days on every run day; Tier 2: lib/testing/spec-support/spec-conventions.test.ts pins a Monday start and a whole board week for every run weekday. The lab and wall-clock references of the typical profile are recalibrated through scripts/lab-counts.ts and scripts/calibrate-performance.ts.
- Evidence: the lab records of every `audit:lab:office` run since 2026-10-09 and the product's week window (`getBerlinWeekFetchRange`). Seeded days in the window, old rule: 7, 6, 5, 4, 3, 2, 7 for run days Monday to Sunday; the measured 121 and 81 rows match 40 per day plus one. The visible board (Monday to Sunday) showed one seeded day on a Saturday and two on a Friday; with all seven on it, entry-open renders 5379 components: 1425 plus 659 for each of the six added days.
- Correction: `ownedBerlinWeekAtOffset` claims the first whole Monday-to-Sunday week on or after +152 (the `performance-calendar` window moved to +152…+164), and the live week is seeded through it. Six lab runs on build 5d6d65ee, four on business date 2026-10-21 (week of 2027-03-22) and two on 2026-10-22 (week of 2027-03-29), matched on every gated count: entry-open 5379, calendar-window 281 rows. `calibrate` recorded the new lab references from them, and `ungate` removed the counts that earlier runs showed taking two values (job-create componentRenders, visit-move requests and backendRequests, checklist-tick requests). The 23 typical-profile scenarios were recalibrated from three runs each; the board scenarios rose with the fuller week (reassign visible 59.8 to 160.2 ms, settled 215 to 360 ms).
- Focused proof: report `2026-10-21T224727206Z-fcf551a5`, target local, build 5d6d65ee, on the final inputs: `audit:lab:office` run `2026-10-21T224736027Z-af4ec6` (fingerprint `6b31c2b0e2e3`, all 7 tests), `audit:lab:field` run `2026-10-21T224736027Z-193de1` (`0b4d7013ecf4`), `audit:performance:calendar` run `2026-10-21T224736026Z-2d7783` (`929988a255f5`), `audit:performance:lists` run `2026-10-21T224736027Z-391638` (`9659646a640a`) and `audit:performance:field` run `2026-10-21T224736027Z-f7d3f8` (`ceab197913a8`), every lab step and all 23 scenarios within their references. Release report `2026-10-21T225913588Z-836c77ea` reused those passes and passed 135 of 135 groups.
- Cleanup: every world cleaned; no retained world. The group qualified for its repair run because its inputs changed (`directGroupRetryProblem`).

## 2026-10-17: audit:wave-2:p1-19 environment failure

<!-- incident-run: 2026-10-17T151606301Z-958acb -->

- Run: run `2026-10-17T151606301Z-958acb`, group `audit:wave-2:p1-19`, target local, fingerprint `fbb55a5652c8`, world `1e0735143d084383a17ffcd912bfc666`.
- Failure point:  >  > wave-2\p1-19.spec.ts > P1-19 exhaustive reactive-service audit @AUDIT-W2-P1-19 @AUDIT-W2 > rejects a stale edit from a second manager without overwriting the newer state: TimeoutError: locator.fill: Timeout 30000ms exceeded.
- Root cause: The admin page's service case render failed on the server (service_case_detail_load_failed, name Error: a Supabase result error turned into a thrown Error) about 1.3 s after load, so the page showed its region error and the edit dialog never got its fields. Kong logged only 2xx and 101 responses in the failure window and the database and PostgREST logged no error, so the failed requests never got an answer from the backend: the Node fetch to the local stack failed or was cut before Kong answered. The backend probe after the group was healthy, and the same test passed in report 2026-10-17T104007928Z-e32f575c on the same loader code.
- Prevention: Tier 3: a Node-to-local-stack fetch failure is outside the product and the harness; the region error and its retry did what the read-failure rule requires, and a repeat on the same inputs needs a change
- Evidence: the failure screenshot of the admin page shows „Der Servicefall konnte nicht geladen werden“; the trace shows the RSC refresh answered 200 and the live read then aborted with the unmounted content. The server log names only the error class, so which of the loader's reads failed stays unknown; if the loader fails again without a backend error, add the failing read's code to its log line first. Proof: the fresh-world diagnosis `2026-10-17T155646199Z-9a51bb` passed the whole group (5 of 5) on the same build; the world was cleaned before the one retry.

## 2026-10-17: audit:visual product failure

<!-- incident-run: 2026-10-17T115336672Z-742343 -->

- Run: run `2026-10-17T115336672Z-742343`, group `audit:visual`, target local, fingerprint `b437df81e392`, world `e9ad86b97b8b4f7e90400d821305010a`.
- Failure point:  >  > visual\references.spec.ts > @AUDIT-VISUAL rendered references of every page family > zeiterfassung-einstellungen matches its references: Error: expect(string).toMatchSnapshot(expected) failed
- Root cause: Zeiterfassung settings list the employees without a time account (and the policy assignment list) in employee_records id order (lib/time-accounts/queries.ts orders by a random UUID), so the order of Martin Krämer and Kevin Schmid changes from world to world; the new zeiterfassung-einstellungen text reference exposed it
- Prevention: Tier 2: lib/time-accounts/queries.ts sorts both lists by name with German collation, and the zeiterfassung-einstellungen text reference of tests/audit/visual/references.spec.ts fails on any other order
- Evidence: the text diff swapped the two rows of „Zeitkonten eröffnen“; `getTimeAccountSettings` read `employee_records` and `time_accounts` ordered by `id`. Correction: `byEmployeeName` in lib/time-accounts/queries.ts orders the employees, the open accounts and the missing accounts by name; the two desktop text references were updated through the official command (run `2026-10-17T121127167Z-8ff039`, 57 of 57). Proof: report `2026-10-17T132300450Z-75452088` passed audit:visual, 57 of 57.

## 2026-10-17: audit:lab:field product failure

<!-- incident-run: 2026-10-17T105700824Z-ac73fe -->

- Run: run `2026-10-17T105700824Z-ac73fe`, group `audit:lab:field`, target local, fingerprint `127dfe2a24ff`, world `58dc302796784f6fb8a9ba36d7d5c698`.
- Failure point: no failed test recorded; read the run log.
- Root cause: Intended UI changes of the round grew the field journey's payloads (job detail, dashboard actions, the stylesheet and the script bundle) and added one client chunk at cold start; the cold-start request count was already three above its reference before the round (75 in run 2026-10-16T191852374Z-1c1873).
- Prevention: Tier 2: lib/testing/lab-count-references.json through scripts/lab-counts.ts accept with the reason.
- Evidence and correction: every grown shape traces to an intended change of the round (compact empty states, Badge variants, column header names, DetailColumns, the new client modules); each was accepted with its reason on this run. Proof: report `2026-10-17T112502269Z-5b7b2da1` passed audit:lab:field.

## 2026-10-17: audit:layout:planning product failure

<!-- incident-run: 2026-10-17T095733582Z-50e35b -->

- Run: run `2026-10-17T095733582Z-50e35b`, group `audit:layout:planning`, target local, fingerprint `41490cba1443`, world `31f5f38568b9483184a288f5ceed76fc`.
- Failure point:  >  > layout\surfaces-planning.spec.ts > @AUDIT-LAYOUT-SURFACES planning: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kalender part 1 of 2: Error: admin /kalender tab day at 375 px, light
- Root cause: The phone day list of /kalender titled each person with an h3 directly under the page h1 (axe heading-order).
- Prevention: Tier 2: tests/audit/support/axe.ts runs heading-order on every whole page; the day list titles are h2.
- Correction and proof: components/kalender/day-view/day-view-list.tsx titles each person with an h2. The retained world blocked the group in two plans until `bun run test:runs cleanup` removed it; report `2026-10-17T114239033Z-89a72aef` passed audit:layout:planning (run `2026-10-17T114815761Z-e6d1c1`).

## 2026-10-17: audit:lab:office product failure

<!-- incident-run: 2026-10-17T073731141Z-0799c3 -->

- Run: run `2026-10-17T073731141Z-0799c3`, group `audit:lab:office`, target local, fingerprint `acac368d556d`, world `39b569aa3c404271a1d91bae7f6ce5a4`.
- Failure point: no failed test recorded; read the run log.
- Root cause: Intended UI changes grew the /auftraege payload and the stylesheet, added two script chunks at cold start and 48 component renders on job open; the visit-move calendar window row floor needs a check.
- Prevention: Tier 2: lib/testing/lab-count-references.json through scripts/lab-counts.ts accept with the reason.
- Evidence and correction: the payload and chunk growth traces to the round's intended markup and was accepted with reasons. The visit-move calendar-window rows (81 against 121) follow the run's weekday, because the profile seeds seven days from the run day + 141; accepted with that reason and the backlog row "Lab visit-move week depends on the run day". A later entry-open render count below its reference was not ratcheted for the same reason. Proof: report `2026-10-17T104007928Z-e32f575c` passed audit:lab:office.

## 2026-10-17: audit:layout:field-time product failure

<!-- incident-run: 2026-10-17T073731141Z-eef855 -->

- Run: run `2026-10-17T073731141Z-eef855`, group `audit:layout:field-time`, target local, fingerprint `a8e073bde695`, world `243d734ffde04f52b0abb4782bfa9ee5`.
- Failure point:  >  > layout\surfaces-field-time.spec.ts > @AUDIT-LAYOUT-SURFACES field-time: tabs and dialogs fit, pass axe and keep their keyboard path > employee /zeiterfassung: Error: employee /zeiterfassung at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:field-time pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:field product failure

<!-- incident-run: 2026-10-17T073731141Z-f9e9a6 -->

- Run: run `2026-10-17T073731141Z-f9e9a6`, group `audit:layout:field`, target local, fingerprint `a8d98b1ff8d3`, world `7ed6d613cd6e48ff82db570382c552f4`.
- Failure point:  >  > layout\surfaces-field.spec.ts > @AUDIT-LAYOUT-SURFACES field: tabs and dialogs fit, pass axe and keep their keyboard path > employee /kalender: Error: employee /kalender tab week at 375 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:field pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:service product failure

<!-- incident-run: 2026-10-17T073731141Z-c371c0 -->

- Run: run `2026-10-17T073731141Z-c371c0`, group `audit:layout:service`, target local, fingerprint `9d0cee351b88`, world `317f3b66c8aa40e6aeaecd632e19db39`.
- Failure point:  >  > layout\surfaces-service.spec.ts > @AUDIT-LAYOUT-SURFACES service: tabs and dialogs fit, pass axe and keep their keyboard path > admin /service/anlagen/[equipmentNumber]: Error: admin /service/anlagen/ANL-2026-002 at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:service pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:inventory product failure

<!-- incident-run: 2026-10-17T073731141Z-1c9848 -->

- Run: run `2026-10-17T073731141Z-1c9848`, group `audit:layout:inventory`, target local, fingerprint `84984bad1c29`, world `ca90b927c5ff4675baa956b90e939839`.
- Failure point:  >  > layout\surfaces-inventory.spec.ts > @AUDIT-LAYOUT-SURFACES inventory: tabs and dialogs fit, pass axe and keep their keyboard path > admin /inventar: Error: admin /inventar at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:inventory pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:documents product failure

<!-- incident-run: 2026-10-17T073731141Z-4ee140 -->

- Run: run `2026-10-17T073731141Z-4ee140`, group `audit:layout:documents`, target local, fingerprint `8b628c2a90e8`, world `b37883517d86428eb0fa9645e068d2e6`.
- Failure point:  >  > layout\surfaces-documents.spec.ts > @AUDIT-LAYOUT-SURFACES documents: tabs and dialogs fit, pass axe and keep their keyboard path > admin /dokumente: Error: admin /dokumente at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:documents pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:settings product failure

<!-- incident-run: 2026-10-17T073731141Z-de28b8 -->

- Run: run `2026-10-17T073731141Z-de28b8`, group `audit:layout:settings`, target local, fingerprint `8cf42d4fe8f1`, world `1efe36a1087c4dedbb7b4d0089fbf246`.
- Failure point:  >  > layout\surfaces-settings.spec.ts > @AUDIT-LAYOUT-SURFACES settings: tabs and dialogs fit, pass axe and keep their keyboard path > admin /einstellungen/profil: Error: admin /einstellungen/profil at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:settings pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:personnel product failure

<!-- incident-run: 2026-10-17T073731141Z-c56d58 -->

- Run: run `2026-10-17T073731141Z-c56d58`, group `audit:layout:personnel`, target local, fingerprint `6b6fe106f28b`, world `2ad303411b8e4ac3b38263f932d6d44a`.
- Failure point:  >  > layout\surfaces-personnel.spec.ts > @AUDIT-LAYOUT-SURFACES personnel: tabs and dialogs fit, pass axe and keep their keyboard path > admin /mitarbeiter/[userId] part 1 of 2: Error: admin /mitarbeiter/68ea63af-f8ad-4440-ab63-9dd778242f09 at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:personnel pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:people product failure

<!-- incident-run: 2026-10-17T073731141Z-ee31be -->

- Run: run `2026-10-17T073731141Z-ee31be`, group `audit:layout:people`, target local, fingerprint `4b501b4af2fe`, world `f246401648d0440895f439eafc1abc8e`.
- Failure point:  >  > layout\surfaces-people.spec.ts > @AUDIT-LAYOUT-SURFACES people: tabs and dialogs fit, pass axe and keep their keyboard path > admin /mitarbeiter: Error: admin /mitarbeiter at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:people pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:time product failure

<!-- incident-run: 2026-10-17T073731141Z-665fa0 -->

- Run: run `2026-10-17T073731141Z-665fa0`, group `audit:layout:time`, target local, fingerprint `93139fbc7db2`, world `74c14caadf72405e943b7f058f63054f`.
- Failure point:  >  > layout\surfaces-time.spec.ts > @AUDIT-LAYOUT-SURFACES time: tabs and dialogs fit, pass axe and keep their keyboard path > admin /zeiterfassung: Error: admin /zeiterfassung at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:time pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:planning product failure

<!-- incident-run: 2026-10-17T073731141Z-7b3cb1 -->

- Run: run `2026-10-17T073731141Z-7b3cb1`, group `audit:layout:planning`, target local, fingerprint `41490cba1443`, world `bf40feb3e301479cb6399b1c2d5b7fcf`.
- Failure point:  >  > layout\surfaces-planning.spec.ts > @AUDIT-LAYOUT-SURFACES planning: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kalender part 1 of 2: Error: admin /kalender at 375 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:planning pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-17: audit:layout:customers product failure

<!-- incident-run: 2026-10-17T073731141Z-1c74c6 -->

- Run: run `2026-10-17T073731141Z-1c74c6`, group `audit:layout:customers`, target local, fingerprint `e258e624be6f`, world `9671f0733cd1462ba741a70e8961727d`.
- Failure point:  >  > layout\surfaces-customers.spec.ts > @AUDIT-LAYOUT-SURFACES customers: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kunden/[clientId]: Error: admin /kunden/8b058900-27e3-4424-8899-0409ba321900 at 1280 px, light
- Root cause: The newly enabled axe landmark and heading rules found real markup defects on audit:layout:customers pages: empty table headers, skipped heading levels, unlabelled duplicate landmarks.
- Prevention: Tier 2: tests/audit/support/axe.ts runs the page-structure rules on every whole page.
- Correction and proof: the run's axe violations were empty-table-header, heading-order and landmark-unique. `hiddenHeader` (components/ui/skeleton-table.tsx) names the action and selection columns, section titles under the page h1 are h2, and repeated landmarks carry labels; lib/ui/table-headers.test.ts refuses an empty header. Report `2026-10-17T114239033Z-89a72aef` passed the group on the repaired tree.

## 2026-10-16: audit:layout:work product failure

<!-- incident-run: 2026-10-16T235232398Z-af50ea -->

- Run: run `2026-10-16T235232398Z-af50ea`, group `audit:layout:work`, target local, fingerprint `e5155c38ca1d`, world `0250864c52004c2d8548e7c8b30b5b30`.
- Failure point:  >  > layout\surfaces-work.spec.ts > @AUDIT-LAYOUT-SURFACES work: tabs and dialogs fit, pass axe and keep their keyboard path > admin /auftraege: Error: the row actions menu opened
- Root cause: The row actions menu (components/ui/row-actions-menu.tsx) closes on every scroll event in the capture phase. On /auftraege at 1280 px the job table overflows sideways, so the click first scrolls the table to bring the actions button into view; that scroll's event arrives a frame later, after the menu opened, and closes it (probe: aria-expanded true at 3336 ms, scroll on the overflow-x-auto table at 3338 ms, false at 3343 ms; Enter on the focused trigger opens it). A user whose sideways or momentum scroll ends as they click loses the menu the same way.
- Prevention: Tier 2: ui:contracts case 'a scroll that leaves the row menu trigger in place keeps the menu open' fails on the old close-on-any-scroll handler; the menu now closes only when its trigger moved

- Evidence: error-context.md of the four failed runs (the trigger shows `aria-expanded="false"` after the click), the trace (the click came 0.7 s after the search had settled), and a probe on the run's retained world that logged `aria-expanded` true, a scroll event on the table's `overflow-x-auto` wrapper 2 ms later, and false 5 ms after that. Two repairs on the wrong cause (a hydration wait, then a search-settled wait, runs `2026-10-16T212848904Z-4bb1c5` and `2026-10-16T225936300Z-488b4d`, classified authoring) did not change it. Correction: `triggerInPlace` in components/ui/row-actions-menu.tsx; the opener keeps the hydration and search-URL waits and asserts `aria-expanded`. Focused proof: the ui:contracts case failed against the old handler and passes; report `2026-10-17T004621356Z-0a4b38f9` passed audit:layout:work and 125 other groups. Cleanup: every world cleaned.

## 2026-10-16: audit:layout:work product failure

<!-- incident-run: 2026-10-16T191852374Z-65df4a -->

- Run: run `2026-10-16T191852374Z-65df4a`, group `audit:layout:work`, target local, fingerprint `82a531c5f5e5`, world `b45eeec2cba94423bdec6bc47f29b0ac`.
- Failure point:  >  > layout\surfaces-work.spec.ts > @AUDIT-LAYOUT-SURFACES work: tabs and dialogs fit, pass axe and keep their keyboard path > admin /auftraege: Error: the trigger is on screen
- Root cause: The row actions menu (components/ui/row-actions-menu.tsx) closes on every scroll event in the capture phase. On /auftraege at 1280 px the job table overflows sideways, so the click first scrolls the table to bring the actions button into view; that scroll's event arrives a frame later, after the menu opened, and closes it (probe: aria-expanded true at 3336 ms, scroll on the overflow-x-auto table at 3338 ms, false at 3343 ms; Enter on the focused trigger opens it). A user whose sideways or momentum scroll ends as they click loses the menu the same way. (Reclassified 2026-10-17 from harness: the hydration wait did not change it.)
- Prevention: Tier 2: ui:contracts case 'a scroll that leaves the row menu trigger in place keeps the menu open' fails on the old close-on-any-scroll handler; the menu now closes only when its trigger moved

## 2026-10-16: audit:wave-2:p1-14 environment failure

<!-- incident-run: 2026-10-16T154711103Z-9a0c70 -->

- Run: run `2026-10-16T154711103Z-9a0c70`, group `audit:wave-2:p1-14`, target local, fingerprint `8edece68e1a8`, world `443b27c94d934ee782d96c2a51c6b0bf`.
- Failure point:  >  > wave-2\p1-14.spec.ts > P1-14 exhaustive work lifecycle flows @AUDIT-W2-P1-14 @AUDIT-W2 > work prerequisites block start, follow predecessor state, reject cycles, and retain history: TimeoutError: locator.click: Timeout 30000ms exceeded.
- Root cause: The browser's work-lifecycle-snapshot read failed with net::ERR_NETWORK_CHANGED (trace 0-trace.network; the same error hit time-tracking-state and the browser's auth read at the same moment): the host network changed during the test, the live view correctly kept its data stale and inert, and the stale region intercepted the click
- Prevention: Tier 3: a host network change is outside the product and the harness; the stale region did what realtime-and-caching.md requires
- Evidence: the same test passed in plan `2026-10-16T103827263Z-5597749f` with the same read code. The diagnostic replay on the retained world (`2026-10-16T163246990Z-45296f`) could not observe anything: the source run's writes persisted (one open prerequisite), so the test met another state from its first step. A focused fresh-world run passed (`2026-10-16T163452340Z-0e14b7`), but the runner then accepted only a passing replay on the retained world, so the group stayed blocked on that tree. Correction (2026-10-16): for a test that wrote its world before it failed, the first fresh-world run of the whole group on the same build (`--fresh-for <run-key>`, recorded as `diagnosticWorld: fresh`) qualifies the one retry (`lib/testing/runner/group-recovery.ts`). This run's build was gone by then, because `bun run test:server` rebuilds; the runner change changed the candidate, and the group ran again in the next automatic plan.

## 2026-10-16: audit:wave-1:a2-anfragen harness failure

<!-- incident-run: 2026-10-16T105850330Z-ba97ac -->

- Run: run `2026-10-16T105850330Z-ba97ac`, group `audit:wave-1:a2-anfragen`, target local, fingerprint `607eb59f8a66`, world `e8953c0775464abbaa8f2902328400dd`.
- Failure point:  >  > wave-1\a2-anfragen.spec.ts > A2 Anfragen @AUDIT-W1-A2 > A2-10/A2-11: Eigene Anfragenummer überlebt späten Vorschlag; Klärung und Wiederöffnung bleiben bestehen: Error: The request-number suggestion server action was not intercepted within 15 seconds.
- Root cause: A2-10 holds the request-number suggestion by intercepting a Server Action POST on /anfragen; the suggestion is now the background read next-request-number (GET /api/background-read), so the hold never matched
- Prevention: Tier 2: the spec holds the background-read kind it waits for, and lib/data/background-read-http.test.ts lists the migrated reader, so a spec intercepting the old transport fails on its own first run
- Correction and proof: A2-10 and A3's personnel-number case hold the `next-request-number` and `next-personnel-number` reads; the same plan's `ui:contracts` failure (harness: the presentation fixture rendered `PageBody` without the app shell that now runs `usePageBodyKeyboardScroll`) was fixed by mounting the hook in the fixture. Repair report `2026-10-16T122357711Z-eb3499b9` passed 79 of 79 groups.

## 2026-10-16: audit:lab:field environment failure

<!-- incident-run: 2026-10-16T101241400Z-4e7882 -->

- Run: run `2026-10-16T101241400Z-4e7882`, group `audit:lab:field`, target local, fingerprint `da6f42206133`, world `ba4d217d24e743f0a24d3ff543e0a95c`.
- Failure point: no failed test recorded; read the run log.
- Root cause: LAB-F4 clock-in recorded three extra shapes (attention counts, browser auth user, browser membership read) at 841-957 ms: exactly the reads a Realtime synthetic catch-up dispatches, which only a channel rejoin sends; clock-in writes no membership row, and the same step on the same build recorded none of them in run 2026-10-16T100324580Z-a96dd9; every count stayed within its reference
- Prevention: Tier 3: a socket rejoin of the local stack is outside the product; the lab keeps gating shapes, and a repeat needs a passing diagnostic replay first
- Evidence and proof: the run cleaned its world at its end, so no diagnostic replay was possible; the tree had changed (lab reference acceptance, `lib/testing/lab-counts.ts`), and the rerun in report `2026-10-16T102856474Z-ddd4e324` passed with no extra clock-in shape.

## 2026-10-16: audit:lab:office product failure

<!-- incident-run: 2026-10-16T101241400Z-cfbbd7 -->

- Run: run `2026-10-16T101241400Z-cfbbd7`, group `audit:lab:office`, target local, fingerprint `5bc9c002e4b8`, world `1125236b83374f77b1ee0ef8897863e8`.
- Failure point: no failed test recorded; read the run log.
- Root cause: Same script-byte residue as 2026-10-16T100324580Z-0edce6: the accept commands named the table row script#encodedBytes instead of the shape script, so lab-counts recorded a no-op entry and the references stayed at 692,102 and 32,212 B
- Prevention: Tier 2: acceptLabChange now refuses a target that is neither a gated metric nor a request shape of the step (probe in lib/testing/lab-counts.test.ts); accepted again with the shape name
- Correction and proof: the two no-op `shape-accept` entries stay in the reference history (the file is written only by the script); the accepts on shape `script` and the rerun in report `2026-10-16T102856474Z-ddd4e324` passed.

## 2026-10-16: audit:lab:office product failure

<!-- incident-run: 2026-10-16T100324580Z-0edce6 -->

- Run: run `2026-10-16T100324580Z-0edce6`, group `audit:lab:office`, target local, fingerprint `5bc9c002e4b8`, world `31498d384c7644baa42c9533d782cc29`.
- Failure point: no failed test recorded; read the run log.
- Root cause: The route-bound reference of the cold-start and tasks-open script bytes predates the client code of 7d305e2, 9fb58cd, 0165de5 and this package (keyboard-scroll hook in the app shell, background-read kinds, the record-number hook, the wall-clock tick): +9,435 B and +1,427 B encoded; no duplicated module; every count and payload is within its reference after the PageBodyKeyboardScroll fix
- Prevention: Tier 2: a change plan now runs audit:lab:office, so script growth is judged in the change that adds it; this growth was accepted with its reason through scripts/lab-counts.ts
- Correction and proof: see the entry of `2026-10-16T101241400Z-cfbbd7`; report `2026-10-16T102856474Z-ddd4e324` passed.

## 2026-10-16: audit:lab:office product failure

<!-- incident-run: 2026-10-16T073820023Z-67ee65 -->

- Run: run `2026-10-16T073820023Z-67ee65`, group `audit:lab:office`, target local, fingerprint `e16a3039caa2`, world `a7b8a3df07804718b72baf15307f0986`.
- Failure point: no failed test recorded; read the run log.
- Root cause: PageBodyKeyboardScroll (7d305e2) inside the server PageBody added its client reference (1.2-1.3 KB) to every office route payload (/auftraege, /kunden, /aufgaben, job-create) and four renders to job-open; the remaining script growth and one ListRowActions render are intended client code of 7d305e2, 9fb58cd and 0165de5; the job-open componentRenders reference is bimodal (1523/1551 on its calibration build)
- Prevention: Tier 2: the keyboard-scroll behaviour runs once in the app shell; lib/conventions/server-primitive-client-refs.test.ts refuses a client module imported by a server page primitive; the script residue is accepted with lab-counts accept; the audit:lab:office ceilings now gate before publication
- Evidence and proof: payload captures from the HEAD build reproduced every byte value; after the fix every route and action payload is within its reference (run `2026-10-16T100324580Z-0edce6`), and report `2026-10-16T102856474Z-ddd4e324` passed.

## 2026-10-16: audit:lab:field product failure

<!-- incident-run: 2026-10-16T073820023Z-c85988 -->

- Run: run `2026-10-16T073820023Z-c85988`, group `audit:lab:field`, target local, fingerprint `05b272ede455`, world `01c1153219224385afa66987e55595cf`.
- Failure point: no failed test recorded; read the run log.
- Root cause: PageBodyKeyboardScroll (7d305e2), a client component inside the server PageBody, added its client reference with the route chunk list (1.2-1.5 KB) to every route and action payload and pushed the [jobNumber] loading segment past the 2 KB prefetch-inlining size of Next, so each job-link prefetch split into two requests (cold-start 72 -> 74)
- Prevention: Tier 2: the keyboard-scroll behaviour runs once in the app shell (usePageBodyKeyboardScroll); lib/conventions/server-primitive-client-refs.test.ts refuses a client module imported by a server page primitive; the audit:lab:field ceilings now gate before publication
- Evidence and proof: after the fix the field run `2026-10-16T100324580Z-a96dd9` passed with the cold-start requests and every payload within their references.

## 2026-10-16: audit:layout:planning environment failure

<!-- incident-run: 2026-10-16T033909166Z-262188 -->

- Run: run `2026-10-16T033909166Z-262188`, group `audit:layout:planning`, target local, fingerprint `c5e6cf87c59b`, world `80dbccfbf1eb4b539169883177d0a736`.
- Failure point:  >  > layout\surfaces-planning.spec.ts > @AUDIT-LAYOUT-SURFACES planning: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kalender part 1 of 2: Error: The scope settles: no aria-busy, pending dialog, skeleton, spinner, unconfirmed content or route refresh, and every calendar ready
- Root cause: The Realtime socket to the WSL stack reconnected every 5 to 7 s from 04:43Z (52 socket opens in 4 min, during the CodeRabbit retry stream); each reconnect queued a catch-up route refresh, so the settle check never cleared. audit:layout:planning-board and the planning goldens passed on the same build.
- Prevention: Tier 3: no runner mechanism sees a WSL process outside the verification run; the operator rule is to run CodeRabbit WSL passes before or after the browser plan, never during it.
- Evidence: after the world cleanup, the repair plan `2026-10-16T063133871Z-56605863` ran the group on a rebuilt server with no review pass running, and it passed; no file of the planning surface changed in between.

## 2026-10-16: audit:wave-3:p1-24a environment failure

<!-- incident-run: 2026-10-16T033909166Z-0db6fd -->

- Run: run `2026-10-16T033909166Z-0db6fd`, group `audit:wave-3:p1-24a`, target local, fingerprint `6595377b925e`, world `fdbb60ff3ab5489999cf2106d54a4f4c`.
- Failure point:  >  > wave-3\p1-24a.spec.ts > P1-24a Plantafel, day and month audit @AUDIT-W3-P1-24A @AUDIT-W3 > AUDIT-05 the month view: closure label, absence bar, „+n mehr“, a date move and the popover @P1-24A-05: Error: expect(locator).toBeVisible() failed
- Root cause: The month move's confirmation did not land within 1 s at 04:03Z during the concurrent CodeRabbit WSL streams; the card is present and confirmed in the failure snapshot, the write path is unchanged in behaviour, and golden:p1-24a and the other calendar groups passed on the same build.
- Prevention: Tier 3: no runner mechanism sees a WSL process outside the verification run; the operator rule is to run CodeRabbit WSL passes before or after the browser plan, never during it.
- Evidence: after the world cleanup, the repair plan `2026-10-16T063133871Z-56605863` ran the group on a rebuilt server with no review pass running, and it passed, including the 1 s month-move assertion; no calendar file changed in between.

## 2026-10-16: audit:wave-2:p1-22 environment failure

<!-- incident-run: 2026-10-16T033909166Z-791c74 -->

- Run: run `2026-10-16T033909166Z-791c74`, group `audit:wave-2:p1-22`, target local, fingerprint `0caa2a129096`, world `13090ca284b64e1fbb9b40514eabd6d1`.
- Failure point:  >  > wave-2\p1-22.spec.ts > P1-22 correction review audit @AUDIT-W2-P1-22 @AUDIT-W2 > applies a Büro correction for another person at once but keeps the own correction a request @READINESS: Error: page.goto: net::ERR_NETWORK_CHANGED at http://localhost:3000/zeiterfassung?tab=history
- Root cause: page.goto failed with net::ERR_NETWORK_CHANGED at 03:59Z while three concurrent CodeRabbit WSL review streams ran; the Windows network path to the WSL Supabase gateway changed under the browser.
- Prevention: Tier 3: no runner mechanism sees a WSL process outside the verification run; the operator rule is to run CodeRabbit WSL passes before or after the browser plan, never during it.
- Evidence: after the world cleanup, the repair plan `2026-10-16T063133871Z-56605863` ran the group on a rebuilt server with no review pass running, and it passed.

## 2026-10-15: audit:layout:work product failure

<!-- incident-run: 2026-10-15T190815412Z-f15eed -->

- Run: run `2026-10-15T190815412Z-f15eed`, group `audit:layout:work`, target local, fingerprint `c6cf8a0cb4c5`, world `0a5da77d3c97490b90c7f67f7c008573`.
- Failure point:  >  > layout\surfaces-work.spec.ts > @AUDIT-LAYOUT-SURFACES work: tabs and dialogs fit, pass axe and keep their keyboard path > admin /auftraege: Error: the trigger is on screen
- Root cause: The row actions menu (components/ui/row-actions-menu.tsx) closes on every scroll event in the capture phase. On /auftraege at 1280 px the job table overflows sideways, so the click first scrolls the table to bring the actions button into view; that scroll's event arrives a frame later, after the menu opened, and closes it (probe: aria-expanded true at 3336 ms, scroll on the overflow-x-auto table at 3338 ms, false at 3343 ms; Enter on the focused trigger opens it). A user whose sideways or momentum scroll ends as they click loses the menu the same way. (Reclassified 2026-10-17 from transient: the same closed menu recurred and was reproduced.)
- Prevention: Tier 2: ui:contracts case 'a scroll that leaves the row menu trigger in place keeps the menu open' fails on the old close-on-any-scroll handler; the menu now closes only when its trigger moved
- Evidence: first recorded as transient with no prevention claim (a closed menu with the row present); the same symptom recurred four times on 2026-10-16, and the reproduction and repair are recorded under `2026-10-16T235232398Z-af50ea`.

## 2026-10-15: audit:wave-2:p1-15 product failure

<!-- incident-run: 2026-10-15T131542126Z-7ac336 -->

- Run: run `2026-10-15T131542126Z-7ac336`, group `audit:wave-2:p1-15`, target local, fingerprint `17de3419bb17`, world `6ad3dd2795e84a3eb0b96b7aa2c5f661`.
- Failure point:  >  > wave-2\p1-15.spec.ts > P1-15 exhaustive structured site evidence flows @AUDIT-W2-P1-15 @AUDIT-W2 > customer outcomes, signature, document/source/evidence links, and deterministic export: Error: expect(received).toBe(expected) // Object.is equality
- Root cause: The work-artifact editor's load() became fire-and-forget when the detail read moved to useClientRead, so a customer action ended its busy state before the reload of the detail settled; the next decision was sent against the previous version and refused as work_artifact_stale_version (customer_reserved never recorded)
- Prevention: Tier 2: audit:wave-2:p1-15 sends the customer decisions back to back and fails on a stale-version refusal. The repair (load() settles with its read, and every mutation awaits it inside its busy task) is a code fix, not a Tier 1 mechanism: nothing makes a fire-and-forget reload unwritable (corrected 2026-10-16, audit finding A4).
- Evidence: error-context.md (the dialog shows „Der Arbeitsnachweis wurde zwischenzeitlich geändert“ after „Vorbehalt erfassen“) and the trace, where the reservation request left before the acknowledgement's request had ended. The spec passed in every change plan from 2026-10-08 to 2026-10-09, before the editor moved to useClientRead. Cleanup: the world was cleaned. Correction: `load` in components/auftraege/artifacts/use-work-artifact-editor.ts settles when its read settles, and the save, review, link, customer and conflict paths await it again; each waiter settles only with the read it started. Focused proof: report `2026-10-15T165451975Z-1c474064` passed audit:wave-2:p1-15 and golden:p1-15.

## 2026-10-15: audit:layout:job environment failure

<!-- incident-run: 2026-10-15T131542126Z-be81a7 -->

- Run: run `2026-10-15T131542126Z-be81a7`, group `audit:layout:job`, target local, fingerprint `551711194ebc`, world `c477ae3890aa4e6db40b06c525871c99`.
- Failure point:  >  > layout\surfaces-job.spec.ts > @AUDIT-LAYOUT-SURFACES job: tabs and dialogs fit, pass axe and keep their keyboard path > admin /auftraege/[jobNumber] part 1 of 3: Error: page.goto: net::ERR_NETWORK_CHANGED at http://localhost:3000/auftraege/AUF-c477ae3890aa4e6db40b06c525871c99-LAYOUT
- Root cause: page.goto failed with net::ERR_NETWORK_CHANGED: Windows changed its network configuration during the run, before any assertion of the surface audit
- Prevention: Tier 3: a host network change is outside the repository; the group reruns on the same build
- Evidence: error-context.md (the navigation itself failed; no surface was measured). Cleanup: the world was cleaned. Correction: none. Focused proof: report `2026-10-15T163755636Z-e7fdfaec` passed audit:layout:job.

## 2026-10-10: audit:layout:planning-board product failure

<!-- incident-run: 2026-10-10T100238917Z-34154b -->

- Run: run `2026-10-10T100238917Z-34154b`, group `audit:layout:planning-board`, target local, fingerprint `e24f7cdb0724`, world `f00cfd9f4a6242d58f552e28a48d6532`.
- Failure point:  >  > layout\surfaces-planning-board.spec.ts > @AUDIT-LAYOUT-SURFACES planning-board: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kalender part 2 of 2: Error: admin /kalender dialog calendar.planning-warning: Escape returns focus to the trigger
- Root cause: The card popover sits on a virtual anchor without aria-controls, so the planning warning opened from its move button had no path back to the card
- Prevention: Tier 1: the popover names its card's data-focus-key in data-focus-return, which useReturnFocus follows; Tier 2: audit:layout:planning-board keyboard path
- Evidence: error-context.md (card not focused after Escape). Cleanup: the world was cleaned. Correction: data-focus-return on the card popover. Focused proof: report `2026-10-10T110458586Z-a7acca2d` passed audit:layout:planning-board.

## 2026-10-10: audit:layout:job-lifecycle product failure

<!-- incident-run: 2026-10-10T100238917Z-8f5067 -->

- Run: run `2026-10-10T100238917Z-8f5067`, group `audit:layout:job-lifecycle`, target local, fingerprint `bb5985b89bca`, world `295c8c5d3f6d46b8b3e7ed906e54ec12`.
- Failure point:  >  > layout\surfaces-job-lifecycle.spec.ts > @AUDIT-LAYOUT-SURFACES job-lifecycle: tabs and dialogs fit, pass axe and keep their keyboard path > admin /auftraege/[jobNumber] part 3 of 3: Error: admin /auftraege/[jobNumber] dialog work.qualification-warning: Escape returns focus to the trigger
- Root cause: While Save was disabled for its request, Radix's focus trap moved focus to the assignment dialog's container, so the warning remembered the container as its opener and Escape returned focus there
- Prevention: Tier 1: useReturnFocus never takes a layer container as opener and falls back to the last focused control; Tier 2: ui:contracts case 'a warning that opens after a save returns focus to the save button on Escape' (failed on the old code, run 2026-10-10T10-55-27-302Z-37d9a4e3)
- Evidence: error-context.md, then the ui:contracts reproduction (focus on the assignment dialog container after Escape). Cleanup: the world was cleaned. Correction: useReturnFocus never takes a layer container as opener. Focused proof: report `2026-10-10T110458586Z-a7acca2d` passed audit:layout:job-lifecycle and ui:contracts with the new case.

## 2026-10-10: audit:layout:people product failure

<!-- incident-run: 2026-10-10T083642857Z-376a46 -->

- Run: run `2026-10-10T083642857Z-376a46`, group `audit:layout:people`, target local, fingerprint `4f0e99a452df`, world `0a4500be2f09432e873ac9bec1391275`.
- Failure point:  >  > layout\surfaces-people.spec.ts > @AUDIT-LAYOUT-SURFACES people: tabs and dialogs fit, pass axe and keep their keyboard path > admin /mitarbeiter: Error: admin /mitarbeiter dialog people.invite-cancel at 375 px
- Root cause: Invitation confirmations at 375 px overflowed sideways: the invited email address is one unbreakable word
- Prevention: Tier 1: dialog and confirmation titles and descriptions wrap anywhere (components/ui/dialog.tsx, components/ui/alert-dialog.tsx)
- Evidence: error-context.md (the alert dialog wider than 375 px). Cleanup: the world was cleaned. Correction: wrap-anywhere on dialog, confirmation and sheet titles and descriptions. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:people.

## 2026-10-10: audit:layout:time product failure

<!-- incident-run: 2026-10-10T083642857Z-46aca7 -->

- Run: run `2026-10-10T083642857Z-46aca7`, group `audit:layout:time`, target local, fingerprint `f53765af3742`, world `04d0c85e294541c091e0e48022356709`.
- Failure point:  >  > layout\surfaces-time.spec.ts > @AUDIT-LAYOUT-SURFACES time: tabs and dialogs fit, pass axe and keep their keyboard path > admin /zeiterfassung/perioden/[periodId]: Error: admin /zeiterfassung/perioden/32f33aa3-27ef-4d27-820e-9b9919a0c5a0 at 1280 px, light
- Root cause: A closed period's detail page scrolls but holds no focusable control, so a keyboard user cannot scroll it (axe scrollable-region-focusable)
- Prevention: Tier 1: PageBody makes itself a focusable named region while it scrolls without a focusable control (components/shared/page-body-keyboard-scroll.tsx)
- Evidence: error-context.md (scrollable-region-focusable on the page body). Cleanup: the world was cleaned. Correction: PageBodyKeyboardScroll. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:time.

## 2026-10-10: audit:layout:planning-board product failure

<!-- incident-run: 2026-10-10T083642857Z-7e9106 -->

- Run: run `2026-10-10T083642857Z-7e9106`, group `audit:layout:planning-board`, target local, fingerprint `3855e7a20678`, world `6b02811c93634f919c88bb5f43bd22b7`.
- Failure point:  >  > layout\surfaces-planning-board.spec.ts > @AUDIT-LAYOUT-SURFACES planning-board: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kalender part 2 of 2: Error: admin /kalender dialog calendar.planning-warning: Escape returns focus to the trigger
- Root cause: The card popover's move button unmounts with the popover before the planning warning opens, so the warning found no opener and the re-rendered card never got focus back
- Prevention: Tier 1: the focusin record keeps the popover trigger and its data-focus-key, so the closing warning finds the card again (components/ui/return-focus.ts)
- Evidence: error-context.md (card not focused after Escape). Cleanup: the world was cleaned. Correction: first round: the focusin record; the remaining cause is entry 2026-10-10T100238917Z-34154b.

## 2026-10-10: audit:layout:job-lifecycle product failure

<!-- incident-run: 2026-10-10T083642857Z-3b81cb -->

- Run: run `2026-10-10T083642857Z-3b81cb`, group `audit:layout:job-lifecycle`, target local, fingerprint `1bf873a96f9a`, world `aaa0bf36139d489fb3e547453017e354`.
- Failure point:  >  > layout\surfaces-job-lifecycle.spec.ts > @AUDIT-LAYOUT-SURFACES job-lifecycle: tabs and dialogs fit, pass axe and keep their keyboard path > admin /auftraege/[jobNumber] part 3 of 3: Error: admin /auftraege/[jobNumber] dialog work.qualification-warning: Escape returns focus to the trigger
- Root cause: The assignment Save button loses focus when it is disabled for the request, and Chrome fires no focusout for that, so the qualification warning opened with nothing to return to
- Prevention: Tier 1: useReturnFocus records the opening chain on every focusin and uses it when focus sits on the body at open (components/ui/return-focus.ts)
- Evidence: error-context.md (Save not focused after Escape). Cleanup: the world was cleaned. Correction: first round: the focusin record; the remaining cause is entry 2026-10-10T100238917Z-8f5067.

## 2026-10-10: audit:layout:field product failure

<!-- incident-run: 2026-10-10T080526635Z-e976e0 -->

- Run: run `2026-10-10T080526635Z-e976e0`, group `audit:layout:field`, target local, fingerprint `19ca366d762f`, world `eb1f1803268549a78e70168923b92562`.
- Failure point:  >  > layout\surfaces-field.spec.ts > @AUDIT-LAYOUT-SURFACES field: tabs and dialogs fit, pass axe and keep their keyboard path > employee /kalender: Error: employee /kalender tab month at 375 px, light
- Root cause: The time hero hint used text-muted-foreground/80 (4.05:1) and the month grid rows held non-cell children
- Prevention: Tier 2: textOpacitySelectors lint; Tier 1: month parts are grid cells
- Evidence: error-context.md (4.05:1 hint, month rows). Cleanup: the world was cleaned. Correction: the hint at full token contrast; month parts are grid cells. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:field and audit:layout:field-time.

## 2026-10-10: audit:layout:documents product failure

<!-- incident-run: 2026-10-10T075415648Z-a49f38 -->

- Run: run `2026-10-10T075415648Z-a49f38`, group `audit:layout:documents`, target local, fingerprint `c45123e22d02`, world `b32bb483b1fe403c970b5b2f3ae721f5`.
- Failure point:  >  > layout\surfaces-documents.spec.ts > @AUDIT-LAYOUT-SURFACES documents: tabs and dialogs fit, pass axe and keep their keyboard path > admin /dokumente: Error: admin /dokumente at 1280 px, dark
- Root cause: Moved documents were dimmed with opacity-60 (2.6:1), view links were read mid theme fade, and inline create dialogs lost the select trigger as return target
- Prevention: Tier 1: the select popup focuses its trigger before its action opens a dialog; Tier 2: textOpacitySelectors and animation-settled measures
- Evidence: error-context.md (opacity-60 rows, fade colors, focus not on the select). Cleanup: the world was cleaned. Correction: full-contrast moved rows, animation-settled measures, the select popup focuses its trigger before its action. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:documents and audit:layout:inventory.

## 2026-10-10: audit:layout:people product failure

<!-- incident-run: 2026-10-10T074311836Z-093cdf -->

- Run: run `2026-10-10T074311836Z-093cdf`, group `audit:layout:people`, target local, fingerprint `0f167542511e`, world `e36459757dce47daaad55f60be245c13`.
- Failure point:  >  > layout\surfaces-people.spec.ts > @AUDIT-LAYOUT-SURFACES people: tabs and dialogs fit, pass axe and keep their keyboard path > admin /mitarbeiter: Error: admin /mitarbeiter tab qualifications at 375 px: the active tab stays in its strip's view
- Root cause: The tab strip did not scroll its active tab back into view after the window narrowed
- Prevention: Tier 1: TabsTrigger observes its strip's size and reveals the active tab (components/ui/tabs.tsx)
- Evidence: error-context.md (qualifications tab outside the strip at 375 px). Cleanup: the world was cleaned. Correction: TabsTrigger reveals the active tab when its strip resizes. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:people.

## 2026-10-10: audit:layout:planning product failure

<!-- incident-run: 2026-10-10T073339917Z-5d54d0 -->

- Run: run `2026-10-10T073339917Z-5d54d0`, group `audit:layout:planning`, target local, fingerprint `42f5a5d5ef87`, world `9951c31695324d3d9ad7a6fb93c97c1a`.
- Failure point:  >  > layout\surfaces-planning.spec.ts > @AUDIT-LAYOUT-SURFACES planning: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kalender part 1 of 2: Error: admin /kalender tab month at 375 px, light
- Root cause: Month grid rows held day headers and items outside grid cells, focus did not return to a re-rendered calendar card or a re-enabled dispatch button, and the entry dialog's tab strip counted as a separate tab stop in the check
- Prevention: Tier 1: month parts are grid cells (components/kalender/month-view/month-day-cell.tsx), data-focus-key and dropped-focus memory in useReturnFocus (components/ui/return-focus.ts); Tier 2: the audit:layout:planning keyboard path skips roving-focus containers
- Evidence: error-context.md (aria-required-children on month rows, focus return, the tab strip counted as a tab stop). Cleanup: the world was cleaned. Correction: month parts are grid cells; useReturnFocus with data-focus-key; the keyboard path skips roving containers. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:planning; report `2026-10-10T110458586Z-a7acca2d` passed audit:layout:planning-board.

## 2026-10-10: audit:layout:customers product failure

<!-- incident-run: 2026-10-10T072950100Z-d12205 -->

- Run: run `2026-10-10T072950100Z-d12205`, group `audit:layout:customers`, target local, fingerprint `95b000b97aa5`, world `d66432d23da8437bad284846beff9428`.
- Failure point:  >  > layout\surfaces-customers.spec.ts > @AUDIT-LAYOUT-SURFACES customers: tabs and dialogs fit, pass axe and keep their keyboard path > admin /kunden: Error: admin /kunden dialog customers.edit at 375 px
- Root cause: Customer finance placeholder labels used text-muted-foreground/70 (3.27:1); the edit dialog's 375 px box was read mid slide animation
- Prevention: Tier 2: textOpacitySelectors lint bans faded token text; nextFrames waits for finite animations
- Evidence: error-context.md (3.27:1 on the finance placeholder, the dialog box mid slide). Cleanup: the world was cleaned. Correction: textOpacitySelectors and the token at full opacity; animation-settled measures. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:customers.

## 2026-10-10: audit:layout:job product failure

<!-- incident-run: 2026-10-10T071726290Z-afbe88 -->

- Run: run `2026-10-10T071726290Z-afbe88`, group `audit:layout:job`, target local, fingerprint `60789f22954b`, world `0224ad7126664c929f5549cee2ff6547`.
- Failure point:  >  > layout\surfaces-job.spec.ts > @AUDIT-LAYOUT-SURFACES job: tabs and dialogs fit, pass axe and keep their keyboard path > admin /auftraege/[jobNumber] part 2 of 3: Error: admin /auftraege/[jobNumber] dialog work.assign-employees at 1280 px, light
- Root cause: Assignment pickers had no accessible name (no Field), the approval dialog showed text instead of a skeleton while loading so focus landed on the reason, and the qualification warning lost its return target while Save was disabled
- Prevention: Tier 1: Field labels on the two pickers, skeleton placeholder, useReturnFocus remembers the control that dropped focus and waits for it to be enabled (components/ui/return-focus.ts); Tier 2: the audit:layout:job axe check and keyboard path
- Evidence: error-context.md (unnamed comboboxes, focus on the reason field). Cleanup: the world was cleaned. Correction: Field labels on the two pickers, a skeleton in the approval dialog, focus return through useReturnFocus. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:job and audit:layout:job-actions; report `2026-10-10T110458586Z-a7acca2d` passed audit:layout:job-lifecycle.

## 2026-10-10: audit:layout:work product failure

<!-- incident-run: 2026-10-10T071328652Z-581e59 -->

- Run: run `2026-10-10T071328652Z-581e59`, group `audit:layout:work`, target local, fingerprint `fa7dec72cd77`, world `e045e45183e94b6cb522b873b9832f79`.
- Failure point:  >  > layout\surfaces-work.spec.ts > @AUDIT-LAYOUT-SURFACES work: tabs and dialogs fit, pass axe and keep their keyboard path > admin /auftraege: Error: admin /auftraege dialog work.filter-sheet at 1280 px, dark
- Root cause: Edit project dialog disabled every field while its jobs loaded, so Radix focused the close button; the filter sheet's axe colors were read mid theme fade
- Prevention: Tier 1: DialogContent focuses itself when its first tab stop is the close button (components/ui/dialog.tsx), project fields stay editable while jobs load; Tier 2: the audit:layout:work nextFrames waits for finite animations before measuring
- Evidence: error-context.md (axe colors between the light and dark tokens; focus on „Schließen“). Cleanup: the world was cleaned. Correction: DialogContent focuses itself when its first tab stop is the close button; project fields stay editable while jobs load; nextFrames waits for finite animations. Focused proof: report `2026-10-10T095630216Z-61ae48c9` passed audit:layout:work.

## 2026-10-09: audit:performance:field environment failure

<!-- incident-run: 2026-10-09T143334025Z-ca8740 -->

- Run: run `2026-10-09T143334025Z-ca8740`, group `audit:performance:field`, target local, fingerprint `6f75fb3dbc35`, world `40c725465d694e6dac907f06351d9319`.
- Failure point: Execution evidence: scenario-latencies.ndjson (time.clock-in.settled median): regressed to 471.7001953125ms against the reviewed 209.800048828125ms baseline (limit 460ms).
- Root cause: A replay of HEAD (git archive of 885468e, same machine and stack, 14:51) regressed the same list scenarios (customers 1,092, jobs 905, equipment 772, tasks 1,178 ms against 822, 638, 496, 778) and time.approval.cross-session (903 against 633 ms); the clock-in settled samples overlap (HEAD 290-460, this tree 297-647 ms). The baselines were recorded on an idle machine at night.
- Prevention: Tier 3: wall-clock scenarios judge machine state as well as code; the lab counts of the same journeys passed on this build (2026-10-09T140944848Z-c3ca26d8).
- Evidence: scenario-latencies.ndjson of the run and a replay of HEAD (git archive of 885468e on the same machine and stack), which regressed the same scenarios. Cleanup: the world was cleaned. Correction: none in code; WSL was restarted between the first and the second attempt and the regression stayed. Focused proof: audit:performance:planning passed on this build (2026-10-09T143318522Z-fb67adee); the lab counts of the same journeys passed (2026-10-09T140944848Z-c3ca26d8). Open: lists and field wait for a quiet machine; no baseline was raised.

## 2026-10-09: audit:performance:lists environment failure

<!-- incident-run: 2026-10-09T143334025Z-b6676d -->

- Run: run `2026-10-09T143334025Z-b6676d`, group `audit:performance:lists`, target local, fingerprint `14fa2bfe9272`, world `98685fddb1454fc294d50a7242ccd681`.
- Failure point: Execution evidence: scenario-latencies.ndjson (customers.list.open median): regressed to 1134.500244140625ms against the reviewed 821.599853515625ms baseline (limit 1072ms).
- Root cause: A replay of HEAD (git archive of 885468e, same machine and stack, 14:51) regressed the same list scenarios (customers 1,092, jobs 905, equipment 772, tasks 1,178 ms against 822, 638, 496, 778) and time.approval.cross-session (903 against 633 ms); the clock-in settled samples overlap (HEAD 290-460, this tree 297-647 ms). The baselines were recorded on an idle machine at night.
- Prevention: Tier 3: wall-clock scenarios judge machine state as well as code; the lab counts of the same journeys passed on this build (2026-10-09T140944848Z-c3ca26d8).
- Evidence: scenario-latencies.ndjson of the run and a replay of HEAD (git archive of 885468e on the same machine and stack), which regressed the same scenarios. Cleanup: the world was cleaned. Correction: none in code; WSL was restarted between the first and the second attempt and the regression stayed. Focused proof: audit:performance:planning passed on this build (2026-10-09T143318522Z-fb67adee); the lab counts of the same journeys passed (2026-10-09T140944848Z-c3ca26d8). Open: lists and field wait for a quiet machine; no baseline was raised.

## 2026-10-09: audit:performance:field environment failure

<!-- incident-run: 2026-10-09T141616399Z-45fc3f -->

- Run: run `2026-10-09T141616399Z-45fc3f`, group `audit:performance:field`, target local, fingerprint `6f75fb3dbc35`, world `a15733d8ef684ea3a9441cbad64fb435`.
- Failure point: Execution evidence: scenario-latencies.ndjson (time.approval.cross-session median): regressed to 960.2001953125ms against the reviewed 633.10009765625ms baseline (limit 883ms).
- Root cause: Every list scenario slowed by 45-70 % at once, also on pages this change does not touch (tasks.list.open 778 to 1,120 ms, customers.list.open 822 to 1,349 ms), while the changed job detail stayed within its baseline; the machine had served 3 hours of browser verification in WSL.
- Prevention: Tier 3: wall-clock scenarios judge machine state as well as code; the lab counts of the same journeys passed on this build (2026-10-09T140944848Z-c3ca26d8).
- Evidence: scenario-latencies.ndjson of the run and a replay of HEAD (git archive of 885468e on the same machine and stack), which regressed the same scenarios. Cleanup: the world was cleaned. Correction: none in code; WSL was restarted between the first and the second attempt and the regression stayed. Focused proof: audit:performance:planning passed on this build (2026-10-09T143318522Z-fb67adee); the lab counts of the same journeys passed (2026-10-09T140944848Z-c3ca26d8). Open: lists and field wait for a quiet machine; no baseline was raised.

## 2026-10-09: audit:performance:planning environment failure

<!-- incident-run: 2026-10-09T141616399Z-49999f -->

- Run: run `2026-10-09T141616399Z-49999f`, group `audit:performance:planning`, target local, fingerprint `c861f7da39b7`, world `5b8bf632c8844d98b461fd471f84bf38`.
- Failure point: Execution evidence: scenario-latencies.ndjson:2 (planning.occurrence.cross-session sample 2): over budget, measured 2156.599853515625ms against 2000ms.
- Root cause: Every list scenario slowed by 45-70 % at once, also on pages this change does not touch (tasks.list.open 778 to 1,120 ms, customers.list.open 822 to 1,349 ms), while the changed job detail stayed within its baseline; the machine had served 3 hours of browser verification in WSL.
- Prevention: Tier 3: wall-clock scenarios judge machine state as well as code; the lab counts of the same journeys passed on this build (2026-10-09T140944848Z-c3ca26d8).
- Evidence: scenario-latencies.ndjson of the run and a replay of HEAD (git archive of 885468e on the same machine and stack), which regressed the same scenarios. Cleanup: the world was cleaned. Correction: none in code; WSL was restarted between the first and the second attempt and the regression stayed. Focused proof: audit:performance:planning passed on this build (2026-10-09T143318522Z-fb67adee); the lab counts of the same journeys passed (2026-10-09T140944848Z-c3ca26d8). Open: lists and field wait for a quiet machine; no baseline was raised.

## 2026-10-09: audit:performance:lists environment failure

<!-- incident-run: 2026-10-09T141616399Z-6a69bc -->

- Run: run `2026-10-09T141616399Z-6a69bc`, group `audit:performance:lists`, target local, fingerprint `14fa2bfe9272`, world `169569969a024ed7b26e831deba6ba65`.
- Failure point: Execution evidence: scenario-latencies.ndjson (customers.list.open median): regressed to 1349.39990234375ms against the reviewed 821.599853515625ms baseline (limit 1072ms).
- Root cause: Every list scenario slowed by 45-70 % at once, also on pages this change does not touch (tasks.list.open 778 to 1,120 ms, customers.list.open 822 to 1,349 ms), while the changed job detail stayed within its baseline; the machine had served 3 hours of browser verification in WSL.
- Prevention: Tier 3: wall-clock scenarios judge machine state as well as code; the lab counts of the same journeys passed on this build (2026-10-09T140944848Z-c3ca26d8).
- Evidence: scenario-latencies.ndjson of the run and a replay of HEAD (git archive of 885468e on the same machine and stack), which regressed the same scenarios. Cleanup: the world was cleaned. Correction: none in code; WSL was restarted between the first and the second attempt and the regression stayed. Focused proof: audit:performance:planning passed on this build (2026-10-09T143318522Z-fb67adee); the lab counts of the same journeys passed (2026-10-09T140944848Z-c3ca26d8). Open: lists and field wait for a quiet machine; no baseline was raised.

## 2026-10-09: audit:wave-2:p1-20 harness failure

<!-- incident-run: 2026-10-09T113505298Z-38bb89 -->

- Run: run `2026-10-09T113505298Z-38bb89`, group `audit:wave-2:p1-20`, target local, fingerprint `3c8021fd9e68`, world `a113db9416d540ef89176841e2c11a87`.
- Failure point:  >  > wave-2\p1-20.spec.ts > P1-20 exhaustive maintenance audit @AUDIT-W2-P1-20 @AUDIT-W2 > attaches a coverage document and keeps its frame stable while loading: Error: The coverage document read was held
- Root cause: The coverage documents dialog now reads over the background-read route (GET kind maintenance-coverage-documents) instead of a Server Action POST, so the spec's hold on the page's Server Action never saw the read.
- Prevention: Tier 2: lib/data/background-read-http.test.ts pins the dialog to the background-read client, and the spec now holds that GET kind.
- Evidence: error-context.md (the hold never saw a POST) and lib/data/background-read-http.test.ts (`maintenance-coverage-documents` kind). Cleanup: the world was cleaned. Correction: the spec holds the GET `/api/background-read` of that kind. Focused proof: report `2026-10-09T114142420Z-9665c35b` passed audit:wave-2:p1-20.

## 2026-10-09: audit:layout harness failure

<!-- incident-run: 2026-10-09T101325554Z-d7a6dc -->

- Run: run `2026-10-09T101325554Z-d7a6dc`, group `audit:layout`, target local, fingerprint `950f67cdc8e3`, world `c007a9fd6d9e48fd87062301afe56dd5`.
- Failure point:  >  > layout\mobile-viewport.spec.ts > @AUDIT-LAYOUT phone viewport: no horizontal scroll, shell-owned scroll, no native controls > admin /kalender fits a 375 px viewport: Error: /kalender: a control stays under the clock button
- Root cause: The /kalender phone check measured controls under the clock button before the page settled: it found two board cells of the removable employee from a board render still in flight, while the screenshot of the finished agenda shows none. A check that measures a render in flight misrepresents the behavior, so this is a harness failure (reclassified 2026-10-16 from transient, audit finding A3).
- Prevention: Tier 1: tests/audit/support/viewport-audit.ts measures the controls under the clock only after expectMainThreadSettles and two frames after its scroll, so no phone check of any layout group measures a render in flight
- Evidence: error-context.md and test-failed-1.png (agenda rows without the reported cells). Cleanup: the world was cleaned. Correction (2026-10-16): the settle order in `expectPhoneLayout`; the 2026-10-09 rerun passed without it on the same build (report `2026-10-09T114142420Z-9665c35b`), which shows a timing window, not a fixed outcome. Focused proof: the audit:layout pass of the testing fix package's final change plan.

## 2026-10-09: golden:p1-19 product failure

<!-- incident-run: 2026-10-09T101325554Z-1e0de5 -->

- Run: run `2026-10-09T101325554Z-1e0de5`, group `golden:p1-19`, target local, fingerprint `46ddf5e5ab71`, world `f19e146b6d364f3b9f4e9c7a5e71a512`.
- Failure point:  >  > p1-19.spec.ts > P1-19 reactive service vertical slice @P1-19 @GG-05 > takes a reported fault from intake to a dispatched visit with evidence @P1-19-journey: Error: Searchable option could not be selected: AUF-f19e146b6d364f3b9f4e9c7a5e71a512-P119-SERVICE
- Root cause: Same cause as golden:p1-18: the service case job picker's option label lost the job number.
- Prevention: Tier 2: lib/jobs/option-reader-boundaries.test.ts pins the job option label 'number · title'.
- Evidence: test-failed-1.png (the trigger shows the job title without its number) and a read-only database check (job and case share customer and site). Cleanup: the world was cleaned. Correction: `loadJobOptions` in lib/jobs/option-server.ts labels a job `number · title`. Focused proof: report `2026-10-09T114142420Z-9665c35b` passed golden:p1-19.

## 2026-10-09: golden:p1-18 product failure

<!-- incident-run: 2026-10-09T101325554Z-b34f81 -->

- Run: run `2026-10-09T101325554Z-b34f81`, group `golden:p1-18`, target local, fingerprint `2d067642836f`, world `893dfa9492944097a3e2da16b5d73266`.
- Failure point:  >  > p1-18.spec.ts > P1-18 installed equipment vertical slice @P1-18 > registers, links, corrects and replaces one site-owned asset @P1-18-journey: Error: Searchable option could not be selected: AUF-893dfa9492944097a3e2da16b5d73266-P118-GOLDEN
- Root cause: Job options of the equipment-work purpose were labelled with the title only, so the trigger no longer showed the job number.
- Prevention: Tier 2: lib/jobs/option-reader-boundaries.test.ts pins the job option label 'number · title'.
- Evidence: error-context.md and the same label check as golden:p1-19. Cleanup: the world was cleaned. Correction: as golden:p1-19. Focused proof: report `2026-10-09T114142420Z-9665c35b` passed golden:p1-18.

## 2026-10-09: audit:wave-2:p1-13 product failure

<!-- incident-run: 2026-10-09T101325554Z-b97afa -->

- Run: run `2026-10-09T101325554Z-b97afa`, group `audit:wave-2:p1-13`, target local, fingerprint `882de3850e11`, world `9e1cb91d05d9428c84b75cb125564f82`.
- Failure point:  >  > wave-2\p1-13.spec.ts > P1-13 exhaustive work-template flows @AUDIT-W2-P1-13 @AUDIT-W2 > draft content covers tasks, evidence, material, qualifications, dependencies, and publish: Error: The scope settles: no aria-busy, pending dialog, skeleton, spinner, unconfirmed content or route refresh, and every calendar ready
- Root cause: The work-template editor kept a quick-created article in an optimistic list whose server list no longer carries the catalog, so the unconfirmed marker never cleared.
- Prevention: Tier 2: the settle step of every spec fails on a held unconfirmed marker (lib/testing/spec-support/busy-signals.ts); created articles are now local state confirmed by the saved row.
- Evidence: error-context.md (`an optimistic list holds an unconfirmed entry` after a quick-created article). Cleanup: the world was cleaned. Correction: components/arbeitsvorlagen/use-work-template-editor-options.ts keeps created articles as local state replaced by the saved row. Focused proof: report `2026-10-09T114142420Z-9665c35b` passed audit:wave-2:p1-13.

## 2026-10-09: audit:wave-1:a1-organisation harness failure

<!-- incident-run: 2026-10-09T101325554Z-531044 -->

- Run: run `2026-10-09T101325554Z-531044`, group `audit:wave-1:a1-organisation`, target local, fingerprint `8d7520104c61`, world `69941b111efa46d3be74a5cda08e4120`.
- Failure point:  >  > wave-1\a1-organisation.spec.ts > A1 Organisation, Rollen und Stempeluhr @AUDIT-W1-A1 > A1-02/A1-03/A1-05/A1-26/A1-27/A1-28: Beitritt per Code, Organisationswechsel, Live-Status, Pause, Auftragwechsel und Org-Sperre: Error: expect(locator).toBeVisible() failed
- Root cause: createJob filled the job number before the suggested number arrived, so the late suggestion was prepended to the typed number.
- Prevention: Tier 3: the createJob area step waits until the number field holds the suggestion before it fills, as createProject does; no check finds a fill that races a suggestion.
- Evidence: error-context.md (the project's child row reads `AUF-2026-001A1-Z2-…`). Cleanup: the world was cleaned. Correction: `createJob` in tests/golden/support/steps/work.ts waits for the suggested number before it fills. Focused proof: report `2026-10-09T114142420Z-9665c35b` passed audit:wave-1:a1-organisation.

## 2026-10-09: golden:p1-23 harness failure

<!-- incident-run: 2026-10-09T054629455Z-e075b0 -->

- Run: run `2026-10-09T054629455Z-e075b0`, group `golden:p1-23`, target local, fingerprint `edd99a5b0d09`, world `54fa50ceffa547659bf62c10d1894165`.
- Failure point:  >  > p1-23.spec.ts > P1-23 time accounts and payroll handoff @P1-23 @GG-07 > configures, closes and exports a month, shows the employee account and reopens with history @P1-23-stage-configure @P1-23-stage-close @P1-23-stage-visibility @P1-23-stage-reopen: Error: P1-23 account fixture RPC failed: duplicate key value violates unique constraint "time_accounts_employee_unique"
- Root cause: The P1-23 account fixture read the existing time accounts and then opened every missing one; the admin's account, opened through the UI just before, committed between the lookup and the RPC under two parallel workers, so the fixture opened it a second time and hit time_accounts_employee_unique.
- Prevention: Tier 3: the helper treats an account that exists by the time it opens it as the precondition it establishes. Tier 1 and 2 cannot reach the cause: whether a seeding helper races a UI write depends on the order of a spec's steps at run time, which neither the types nor a static scan can see.
- Cleanup: the world was cleaned; no ownership is left. Correction: `openRemainingP123Accounts` in tests/golden/support/db/personnel.ts accepts an account that the UI opened meanwhile. Focused proof: the repair plan `2026-10-09T064616316Z-75bc091a` passed golden:p1-23.

## 2026-10-09: audit:visual environment failure

<!-- incident-run: 2026-10-09T031331756Z-748aac -->

- Run: run `2026-10-09T031331756Z-748aac`, group `audit:visual`, target local, fingerprint `34d8dd4ca5aa`, world `1a2d87055acc40e4bf675c1eafe0b163`.
- Failure point:  >  > visual\references.spec.ts > @AUDIT-VISUAL rendered references of every page family > dashboard matches its references: Error: expect(string).toMatchSnapshot(expected) failed
- Root cause: The office dashboard capture missed the sidebar task badge (3 offene Aufgaben): the badge comes from the attention count read, which the slow machine state delivered after the capture; a diagnostic replay of the same test on the same retained world passed (2026-10-09T035536486Z-de337a).
- Prevention: Tier 3: no mechanism; the rerun on the next build decides, and a second miss is a product finding on the badge's readiness.
- Cleanup: the world was cleaned after the diagnostic replay; no ownership is left. The group ran again on the next build and passed (report `2026-10-09T045039015Z-143d6008`, run `2026-10-09T045345382Z-736cc8`), with the badge in its capture.

## 2026-10-09: audit:performance:planning environment failure

<!-- incident-run: 2026-10-09T031331756Z-4990a3 -->

- Run: run `2026-10-09T031331756Z-4990a3`, group `audit:performance:planning`, target local, fingerprint `86c66885d490`, world `490e7742d55549a485e6b5f827112077`.
- Failure point: Execution evidence: scenario-latencies.ndjson (planning.occurrence.cross-session median): regressed to 961.5ms against the reviewed 683.800048828125ms baseline (limit 934ms).
- Root cause: The workstation ran slower than at calibration: the HEAD build, replayed on the same retained calendar world, regressed the same scenarios (calendar.board.cold-open 1622 ms, six-weeks 1360 ms against references 1088 and 795), and a fresh HEAD lists run regressed jobs.detail.open 730 and tasks.list.open 1080 ms; the deterministic lab counts of the same routes did not change.
- Prevention: Tier 3: machine load is outside the repository; the lab counts (audit:lab:*) now separate a product regression from a slow machine, and a wall-clock regression is judged against a HEAD replay before it is called product.
- Cleanup: the retained world and the diagnostic worlds were cleaned; no ownership is left. The source tree changed afterwards, so the group qualified for its next attempt, which passed against the unchanged references in report `2026-10-09T045039015Z-143d6008`.

## 2026-10-09: audit:performance:lists environment failure

<!-- incident-run: 2026-10-09T031331756Z-78f2cb -->

- Run: run `2026-10-09T031331756Z-78f2cb`, group `audit:performance:lists`, target local, fingerprint `92b104506838`, world `d05365cc75504172995459298fcccee4`.
- Failure point: Execution evidence: scenario-latencies.ndjson (customers.list.open median): regressed to 1423.800048828125ms against the reviewed 821.599853515625ms baseline (limit 1072ms).
- Root cause: The workstation ran slower than at calibration: the HEAD build, replayed on the same retained calendar world, regressed the same scenarios (calendar.board.cold-open 1622 ms, six-weeks 1360 ms against references 1088 and 795), and a fresh HEAD lists run regressed jobs.detail.open 730 and tasks.list.open 1080 ms; the deterministic lab counts of the same routes did not change.
- Prevention: Tier 3: machine load is outside the repository; the lab counts (audit:lab:*) now separate a product regression from a slow machine, and a wall-clock regression is judged against a HEAD replay before it is called product.
- Cleanup: the retained world and the diagnostic worlds were cleaned; no ownership is left. The source tree changed afterwards, so the group qualified for its next attempt, which passed against the unchanged references in report `2026-10-09T045039015Z-143d6008`.

## 2026-10-09: audit:performance:calendar environment failure

<!-- incident-run: 2026-10-09T031331756Z-e49332 -->

- Run: run `2026-10-09T031331756Z-e49332`, group `audit:performance:calendar`, target local, fingerprint `6db87a4e4f2c`, world `cfcc3881744d466f83c0f5433301943f`.
- Failure point: Execution evidence: scenario-latencies.ndjson (calendar.board.cold-open median): regressed to 1887.900146484375ms against the reviewed 1087.60009765625ms baseline (limit 1360ms).
- Root cause: The workstation ran slower than at calibration: the HEAD build, replayed on the same retained calendar world, regressed the same scenarios (calendar.board.cold-open 1622 ms, six-weeks 1360 ms against references 1088 and 795), and a fresh HEAD lists run regressed jobs.detail.open 730 and tasks.list.open 1080 ms; the deterministic lab counts of the same routes did not change.
- Prevention: Tier 3: machine load is outside the repository; the lab counts (audit:lab:*) now separate a product regression from a slow machine, and a wall-clock regression is judged against a HEAD replay before it is called product.
- Cleanup: the retained world and the diagnostic worlds were cleaned; no ownership is left. The source tree changed afterwards, so the group qualified for its next attempt, which passed against the unchanged references in report `2026-10-09T045039015Z-143d6008`.

## 2026-10-04: second failed release run

Release report `2026-10-04T040507844Z-1804df7b` (local target) passed 88 of 91 groups. It followed the failed report `2026-10-01T215342873Z-4181463d`, so the release breaker asked for this entry.

- `audit:wave-1:a1-dokumente` (run `2026-10-04T041300446Z-22ab52`, harness). The trace shows Escape pressed while the category save of „Dateidetails“ was still running. Dialogs refuse dismissal while their request runs, so the dialog stayed open and blocked the next click for 30 s. The application was right.
- `audit:wave-2:p1-16` (run `2026-10-04T041300446Z-405fd0`, product). After a transition the job page reloaded with its flash parameter, and the confirmation banner never appeared (0 of 6 replays on the retained world). `UrlFlashBanner` set its banner from an effect; on that page the effect's update starved, because the instruction list re-rendered without end: a mount effect copied props into state, and React rebased that starved update on every pass.
- `audit:wave-3:p1-24a` (run `2026-10-04T041300446Z-c3d1ce`, harness). The spec pressed a calendar shortcut while focus was still inside the Horizont select. Shortcuts ignore keys inside a select, so no navigation happened. The application was right.

Harness hypothesis: both harness failures are one cause. A spec acted on the page (a key press, a dismissal) without waiting for the surface to settle and without checking where focus was. Raw key presses were spread over 20 spec files, and no shared step waited on the application's busy signals.

Correction. Product: the banner is derived from the parameter during render, and the instruction list and the Aufträge list adopt new props during render. Harness: the two specs wait for the application's own signal before the key press.

Prevention. Tier 2 for the product defect: `lib/ui/url-flash-banner.test.tsx`, `tests/ui-contracts/hydration-settle.spec.ts`, the main-thread idle check of `audit:layout`, and lint `ui/no-derived-state-effect`. Tier 2 for the harness cause: `settled`, `pressKey` and `dismissDialog` in `tests/golden/support/steps/interaction.ts` are the only place that presses a key, enforced by lint `playwright-spec/no-raw-key-press`; dialogs expose `aria-busy` and `data-pending` for it.

Focused proof: report `2026-10-04T055927157Z-d5413b10` passed the three groups and `golden:p1-16` on the repaired build. All three runs are classified and their worlds cleaned.

## 2026-10-02: release run across Berlin midnight

Release report `2026-10-01T215342873Z-4181463d` (local target) passed 67 of 70 groups:

- `audit:wave-1:a1` (run `2026-10-01T215744535Z-9ea1b1`, environment) started at 23:57 Berlin time with business date 2026-10-01 and crossed midnight. The application showed the new day in „Abschlussdatum“; the later calendar cases looked for the old one.
- `audit:wave-1:a3` (run `2026-10-01T215744536Z-4d1b4c`, environment) started at 00:08. Case A3-R02 needs ten completed Berlin minutes after midnight and threw that precondition itself.
- `audit:performance:lists` (run `2026-10-01T215744536Z-5d345e`, harness) measured `customers.list.open` at a median of 1180 ms against a limit of 1178 ms. The scenario was recalibrated from nine samples without a budget or tolerance change and passed in reports `2026-10-01T231001162Z-7482cffc` to `2026-10-01T231443290Z-1ea32a58`.

Cause of the first two: the runner started a date-sensitive group at any wall time. Prevention: Tier 1, `waitOutsideMidnightWindow` in `lib/testing/runner/group-schedule.ts` holds every browser group from 23:40 to 00:10 Berlin time; Tier 2, `lib/testing/runner/group-schedule.test.ts` covers the window edges, both daylight-saving changes and cancellation.

Mistake: both retained worlds were cleaned before a diagnostic replay, so the runner refused the unchanged retry. The documented order is classify, replay on the retained world (`bun run test:diagnostic --reuse-run`), clean, retry. The runner rule changed the cause and unlocked the retry.

Open items, both in the [backlog](enforcement-ladder-backlog.md#testing-and-review): `planning.occurrence.cross-session` passes its slow mode with 8 ms to spare, and `customers.list.open` has run medians from 822 to 1180 ms against its recalibrated limit of 1100.5 ms. Diagnose the bimodal behavior; do not widen tolerances.


## 2026-09-30: identity availability failure redirected a valid session

Broad change report `2026-09-30T161326728Z-4066821a` (85.6 minutes, 51 selected groups, 36 fresh browser groups, candidate build `1c39289f-d1a5-433c-b593-2ca122ec2c74`, local backend) passed 50 groups and failed `golden:p1-08` (run `2026-09-30T162309083Z-ec3abe`, retained world `3b72b975a9d74710b221db9641d19d53`). Its first case opened `/zeiterfassung` for the employee; the streamed HTML carried a server-component redirect to `/login`, the login page found the session valid and sent the browser on to `/dashboard`, and the same cookies then served every API read. Five of the six cases failed because the later ones depended on the report the first case never created.

Diagnosis from the retained trace and bounded container logs: the page render answered in about 70 ms of server time (15 ms wait, 54 ms receive), shorter than any completed Auth round trip in that second (91 to 131 ms in the Auth container log), and the Auth and gateway logs show only 200 answers for `/user` between 17:31:31 and 17:31:34. The render's identity check therefore failed without a completed round trip, and `getAuthenticatedUser` converted the returned error into a null user, which the layout treats as signed out. The exact exception is not on record: the served build's output existed only in a terminal. Classification: product (an availability failure became a logout) exposed by an environment transient. The Docker DNS error at 17:31:52 belongs to teardown and does not explain the 17:31:32 redirect.

Repairs. Tier 1: `getAuthenticatedUser` returns null only for `AuthSessionMissingError` and the reviewed rejection codes and throws a sanitized `AuthUnavailableError` for every other returned error, for a code-less or unknown 401/403, for 429 and 5xx, for a thrown transport failure and for an error that arrives with a user; `app/error.tsx` shows that failure with a retry instead of Next's default page ([security rule 8](security.md#checklist)). Tier 2: `lib/testing/fixtures/background-read-http.ts` drives each class through the real route, `authenticateAndAuthorize` and the reader, and asserts no membership read, no reader call and no provider text in the logs. Tier 2, harness: `bun run test:server` now writes the served build's output to `.agent-logs/test-server/<timestamp>-<target>.log` (64 MB cap), so the next server-side exception behind a browser failure survives. `tests/golden/p1-08.spec.ts` keeps the six dependent stages in one test with named steps; a failed stage is one actionable failure, all assertions and the `@P1-08` tag are retained, and the obsolete cross-file inheritance comments are gone.

Planning capacity (the second open repair): the creation form, occurrence editing and unscheduled dispatch no longer preload the whole organization. `search_planning_options` (migration `20260930181015`, applied to local and DEV on 2026-09-30, pending on PROD) returns 50 bounded, tenant-filtered choices with a continuation flag and hydrates already selected records; `getPlanningOptions` authorizes the manager and the active organization and validates the request before the reader; `hooks/use-planning-options.ts` owns lazy reads, debounce, cancellation, retained selection and once-resolved defaults. Evidence before the browser run: `sql:planning-options` (1,051 jobs, 251 people, 151 teams; pagination without overlap, matches beyond the old caps, profile-owned labels, inactive selected records, eligible defaults only, tenant isolation, service-only grants) and `sql:security` passed on the local stack; `lib/planning/option-authorization.test.ts` passed; `ui:contracts` passed 124 checks in report `2026-09-30T183412597Z-0917a3c7` after one harness failure in the new planning-options cases (`getByLabel('Auswahl')` also matched the `Vorauswahl geladen` output; fixed with an exact label, Tier 3, since the unscoped-selector lint does not cover partial label matches); `unit:all` passed 1,406 tests in report `2026-09-30T183000367Z-c8773e6f`; typecheck, lint, coverage and unused-code gates passed.

The new large-company golden case found a second capacity defect one layer down: `loadDailyTargetsByRecord`, which the Plantafel, day and month views read for every employee row, sent all employee record ids in one `in()` query string. At 205 records the gateway answered 414 for the pending-vacation read, the board reader returned `load_failed` without saying which read failed, and the month view never became ready (run `2026-09-30T190131457Z-4ba205`, retained world `b9eabfd8d1c74281a1568c96a3217ac9`; the read-only replay against that world reproduced the 414 at 7.7 KB of query string). Classification: product. Tier 1: the loader's three id-list reads go through `readInBatches`. Tier 2: `lib/planning/daily-targets-batching.test.ts` asserts the batch sizes for 205 records; every board failure branch now logs which read failed with its code. The same bounded run recorded one harness failure of my own making: a CodeRabbit suggestion edited `tests/audit/support/performance-steps.ts`, a measurement-digest input, and orphaned all 17 reviewed references; `performance-references.test.ts` caught it, the edit was reverted and the finding declined (`.agent-logs/coderabbit-20260930-repair.md`).

Bounded follow-up ([the rule](testing.md)). Baseline: report `2026-09-30T161326728Z-4066821a`. The automatic plan for the repair selected all 68 groups because `lib/data/cached.ts` and the regenerated `lib/supabase/database.types.ts` are inputs of every group. The independent reviewer approved the explicit selection: `static:typecheck`, `static:lint`, `static:coverage`, `static:unused`, `unit:all`, `ui:contracts`, `sql:planning-options`, `sql:security`, `golden:planning-options`, `golden:p1-11`, `golden:p1-12`, `audit:wave-1:a6`, `audit:wave-1:a7`, `audit:performance:planning`, `golden:p1-08`, `golden:gg-00`, `audit:security:account` and the two runner pilots `golden:p1-24a` and `audit:wave-3:p1-24a` (`scripts/test-server.ts` changed). Why the omitted families cannot exercise the changed behavior differently: the identity reader's success path runs in every page render and action of every included group, across admin, Büro, employee and outsider sessions, and its failure path is reachable only through the HTTP fixture in `unit:all`; the regenerated types are additive; the other consumers of the changed step helpers (audits a1, a5, p1-16, p1-17, p1-19 and golden p1-17, p1-19) run the same helper lines with other ids and texts, and every branch of those lines runs in a6, a7, p1-11, p1-12, the pilots, the planning benchmark and planning-options; `audit:layout` never opens the planning or dispatch dialogs; the non-manager denial is proven at the action boundary (`lib/planning/option-authorization.test.ts`) and at the route, and the pickers render only on manager surfaces. `static:docs` runs separately after the documentation edits.

Report `2026-09-30T185604444Z-8390df97` (17.3 minutes, candidate `e2676811-63ad-4fa5-aff8-b9bb1424f37d`, all 19 groups fresh) passed 15: the unit and benchmark failures were the orphaned references above, P1-08 was blocked on its retained world (classified product, cleaned through the relocated-world path because the WSL address had changed), and planning-options exposed the board defect. After those two repairs, report `2026-09-30T193154156Z-4c49eee1` (12.5 minutes, candidate `9ca908d4-14ce-44b4-a21d-8c28738fcd9d`, 14 groups, all fresh) passed every group: the four static gates, 1407 unit tests, 124 component checks, both SQL groups, the planning benchmark against unchanged references, P1-08 as one transaction, P1-11, the large-company planning case through creation, editing and unscheduled dispatch, and both runner pilots. Not repeated on the final source: a6, a7, p1-12, gg-00 and security:account, whose proofs come from `8390df97` on the pre-batching target loader; for their worlds of a few dozen records `readInBatches` issues the identical single query, and the board failure logging only adds a log line on a path those groups never take. The 12.5-minute report is the acceptance evidence of the repaired source, with that stated limit.

Cost: the two bounded reports took 29.8 minutes against 85.6 minutes for the broad plan on the previous source, plus 4.1 minutes of separate unit and component runs. Since September 25 the campaign stands at 43 reports, 624 minutes, 457 groups run, 153 reused, 38 failures (14 harness, 16 product, 8 static) and 52 blocked; September 30 added two product failures (the identity redirect, the board 414), two harness failures (the planning contract label, the digest-input edit) and one static failure (the same orphaned references in `unit:all`). The budget of 240 minutes and 8 harness failures is exceeded. The harness changes that answer it are in this diff: the P1-08 transaction, the server log tee, the selection and startup changes recorded above, the board reader's failure logging and the batching test. Prevention tiers: identity, Tier 1 and 2; board, Tier 1 and 2; planning contract label, Tier 3; digest-input edit, the existing Tier 2 guard caught it and no new mechanism follows.
## 2026-09-30: independent groups and bounded setup

The change selector originally scheduled 53 browser groups for 32 changed inputs. A shared background-reader registry made an inventory action reachable from nearly every group. Selection now uses reviewed feature ownership plus direct test consumers for owned application paths; shared and unknown runtime changes remain conservative. Orchestration changes require two real integration pilots, whose fingerprints include the changed runner inputs. Evidence qualification and full release selection remain stricter. The same 32-input dry run selected 24 browser groups. This is a selection-count comparison, not a wall-time benchmark. Later review fixes changed the candidate again.

Removed the integrated Golden release group, cross-file producer expansion and audit world rotation. P1-04 prepares its own schedules; P1-21 keeps the clock lifecycle in one transaction. Tier 1 owns each registered group's world. Tier 2 rejects cross-file declarations and multi-file audit invocations. Legacy within-file preconditions remain explicit debt.

A normal plan recursively scanned old trace directories before starting. A bounded measurement stopped that scan after 20 seconds; the free-space query completed in less than a millisecond with 78.2 GB available. Ordinary execution now checks available workspace storage; explicit pruning keeps its ownership protections and detailed scan. Tier 1 removes recursive traversal from the execution path. Tier 2 checks free-space boundaries and retention. Campaign accounting also stops counting blocked groups as executions; older printed campaign totals used the former definition.

Report `2026-09-30T154604917Z-9f2bbc1a` stopped before creating a test world. WSL startup reported an update and the existing server lost its WSL lease. The following cold-start attempt reached Docker while Postgres and Auth were not healthy; `supabase start` returned an already-running-but-starting error. Holding WSL while observing service health resolved that startup condition. Server preparation now waits for database, Auth and gateway health, with cancellation and a bounded deadline. Tier 1 orders startup before preflight; Tier 2 covers starting, missing/stopped and cancelled services. The one interrupted warm-up account was removed after checking its exact ID and synthetic email. No DEV or PROD data was changed.

CodeRabbit completed separate library, test and script reviews because the combined diff exceeded its 150-file limit. Accepted findings narrowed canonical correction reads to affected users, exposed a failed integrity-verification read, forwarded discovery cancellation through the asynchronous process owner, and preserved the primary probe outcome when cleanup also failed. Focused checks passed. Independent source review found no remaining blocker in selection, qualification, cancellation, cleanup, storage gating or accounting. Review dispositions are under `.agent-logs/coderabbit-20260930-*.md`.

Static and unit report `2026-09-30T153315759Z-33cffcb9` passed six groups in 3.7 minutes, including 1,398 unit tests. Later fixes require updated acceptance. Browser acceptance and the final change plan remain pending; this entry does not release the Wave 3 hold.

## 2026-09-28: mains-powered acceptance and clean-history repairs

The owner reconnected mains power and authorized cleaning the three disposable worlds from the battery runs after retaining their evidence. Runs `2026-09-28T134659088Z-4a8a69`, `2026-09-28T134659088Z-21ae36` and `2026-09-28T131742064Z-d1dd4d` were cleaned by identity. Their logs, traces and measurements remain available. The earlier failed measurements are not erased or relabeled.

Report `2026-09-28T150236581Z-fc63660f` passed all four performance groups on build `8ce51555-981b-49fc-9c91-28191f95089f` in 4.9 minutes. All 17 scenario comparisons met their unchanged targets and references; calendar-live also passed. This establishes the measured candidate under mains power. It does not isolate power as the sole cause of earlier failures. No baseline, target or tolerance was raised. The campaign still totals 394 minutes and nine harness failures at this checkpoint, so this successful run does not establish long-term cost or reliability.

Independent review identified a closed-period gap at exact Berlin midnight. The correction trigger assigned closing entries to the new month while the timeline validator assigned them to the previous day. The new SQL assertion failed against the former function with "midnight closing deletion bypassed the closed month". Migration `20260928145403_guard_midnight_correction_period.sql` repairs both before/applied snapshots for `clock_out` and `break_end`. Report `2026-09-28T150032461Z-2ca0a6a3` passed `sql:p1-22`, `sql:p1-23` and `sql:security`. Prevention: Tier 1 shared period guard and Tier 2 closing/addition/deletion controls, including open-month counterexamples.

The separate clean-history replay and finite privilege repair are recorded in security. The replay's security assertion failed before repair and passed afterward. Existing DEV/local and repaired replay privileges match exactly. CodeRabbit raised zero issues; independent review found no widening. Prevention: Tier 1 explicit migration grants and Tier 2 security assertions. PROD was not changed.

The representative visual review found a reproducible hydration mismatch in the compact week label. Node formatted September 28 to October 4 with U+2009 thin spaces; Chromium used ordinary spaces. React reported error 418 and regenerated that tree. `formatCompactCalendarRange` now owns explicit punctuation, with fixed-label/month/year tests. Sparse desktop rows retain their 96 px lane minimum and grow to at most three lane heights unless overlapping content itself needs more. A real-component geometry test protects the bound. Prevention: Tier 1 deterministic label and bounded row construction, Tier 2 formatting/geometry checks, Tier 3 rendered review.

The first ad-hoc capture used Bun to launch Playwright directly and timed out before visiting a page. Subsequent capture-script errors involved a nonexistent fixture column, a hidden responsive duplicate and waiting for the background clock while a modal intentionally hid it. Those were capture defects, not product failures. The corrected script uses Playwright's Node runner, actual detail URLs and loaded-state checks; it cleans its owned fixture and retains artifacts. The final pass captured 40 states in 36.2 seconds on build `0d482ea8-4b4e-45e5-911f-e9960e72f37f`, with zero page errors or horizontal overflow. It includes light/dark desktop and phone forms, inventory, employee detail and employee day/jobs/time views. Bottom-scroll captures verify that the existing page padding clears the floating clock. These observations do not prove every page or lifecycle state. Capture evidence and script: `.agent-logs/ui-overhaul/final-render/` and `final-render-node.log`.

The final calendar CodeRabbit pass reported three issues. The major issue was valid: a failed move followed by a queued resize could send the resize against the old confirmed position. The queue now propagates failed results and discards dependent gestures, including after failed Undo. A new gesture after the queue drains remains available. The first controlled-response regression failed on the old implementation; four focused cases pass after repair. A Windows-encoded German selector caused one intermediate test-only failure and was corrected to UTF-8. Prevention: Tier 1 queue result propagation and Tier 2 failure, rollback, independent-entry and recovery checks. The two trivial suggestions were rejected: the correction dialog needs its subject's loaded board identity, and the resize handler's timeline ancestor is a construction invariant rather than an expected missing-data state. Emptying the rows or silently ignoring a broken DOM structure would not repair a demonstrated defect.

The focused queue follow-up review found no further queue defect. Its one trivial finding was accepted: correction drafts no longer carry unused success messages or refusal context. The three callers now pass only source entries and proposed updates. This is a Tier 1 type and deletion cleanup, with existing correction contracts covering the behavior.

The final application candidate, build `d9b9c22c-6d51-4652-93a7-9aef240f751a`, completed report `2026-09-28T160210948Z-198928c1` in 80.3 minutes: 61 groups passed, five failed, none blocked. All four performance groups and all 17 scenario comparisons passed unchanged references. Calendar medians included 1,198 ms opening, 97 ms immediate reassignment feedback, 292 ms confirmed reassignment, 24 ms immediate month-move feedback and 228 ms confirmed month move. Planning delivery to another session measured 838 ms. These are local production-build benchmarks, with a warmed server; they do not establish cloud capacity or a cold server-process start.

The five failed groups exposed four test defects. `ui:contracts` still expected a slow correct observation to throw immediately; it now checks that the measurement remains over target while execution continues. Existing archive-qualification unit tests reject that evidence at acceptance. A1-30 still expected direct raw-time reassignment and created historical work before its subjects' employment dates. Its valid dated fixture now checks the approved correction workflow, one audited application and unchanged raw entries; legacy deletion remains exercised on a separate uncorrected booking. The P1-21 activity audit assumed its second test inherited the first test's open browser page; its trace contains only `about:blank`. The continuous travel, call-out and standby transaction is now one test with local setup, retaining every persistence and cross-tenant assertion. Both P1-24a groups failed the same preference helper, which parsed the old action argument layout despite a successful save. That helper was removed. The tests check saved preferences and reloaded UI directly. Prevention: Tier 1 remove cross-test page and transport coupling and construct valid dated fixtures; Tier 2 keep actual timing classification, correction integrity and preference-persistence assertions. Independent review found no issue in the prepared repairs.

These are test-only follow-ups to the final application build. The failed worlds were classified as harness defects and their evidence preserved before owned local cleanup. The 80.3-minute run and four application-browser harness failures are counterevidence to a claim that verification cost is solved. The follow-up plan must reuse unrelated passing evidence; it must not rerun the entire application for these repairs.

The repaired local plan passed in report `2026-09-28T172716969Z-dd25b10b`: 66 groups passed, none failed or blocked, in 16.5 minutes. Eleven groups ran and 55 qualified results were reused. The run includes 1,392 passing unit tests and 121 passing component tests. A1's audited reassignment, the self-contained P1-21 activity transaction and both P1-24a preference groups passed. Application source was unchanged from the final measured build. DEV report `2026-09-28T174714117Z-85e379c4` passed both canary groups and all 12 tests in 1.6 minutes on cloud build `79ca285b-8d27-4bfd-9793-8087a5c5d9b7`. DEV migration history, generated types and local Realtime parity checks also passed. The owned server was stopped, normal DEV routing restored, and `test:runs list` reported zero open retained worlds.

The final campaign line is 34 reports, 492 verification minutes, 408 groups run, 151 reused, 33 failed historically, and 47 blocked historically. Failures classify as 13 harness, 14 product and six static. These totals span the work since the last commit, including old battery and interrupted runs; the two final acceptance reports are green. The same diff contains the fixture, observation, discovery, lifecycle and test repairs described above. That satisfies the requirement to repair the harness after exceeding its budget, but does not prove that its ongoing cost is acceptable. The follow-up's reuse avoided another 80-minute pass, while the 7.6-minute A1 owner still replays unrelated workflows for one test edit. Broader test decomposition, assertion allocation and cost comparison remain open. No reference was raised, evidence erased, commit made, preview published or PROD migration applied.

## 2026-09-28: current correctness proof and deferred timing acceptance

Report `2026-09-28T140912113Z-bc5860b8`, browser run `2026-09-28T140923406Z-f6d514`, passed both independent P1-22 workflows on build `3244f635-d305-4689-a662-1912ab7953ab` in 1.3 minutes including verification overhead. The cases cover correction submission and approval, and calendar resize with a mandatory reason, audited application, unchanged raw entries and reload. The resize case also opens the hydrated creation action and checks that the planning tab and employee selector are usable. This is bounded correctness evidence, not timing acceptance or a whole-calendar certificate.

Independent review found two further correction-boundary defects. The source snapshot now projects the full canonical session, so work resumed after a break retains its real `break_end` boundary. Revision sampling starts before source reads. The timeline query and validator now share day ownership, including midnight closing entries and the following midnight at the end of a selected day. Real-projector tests cover resumed work, orphaned midnight closes, valid midnight closes, reassignment and Berlin DST. These are Tier 1 shared source and window rules with Tier 2 boundary checks.

Supabase Auth requests no longer inherit a cancelled background GET's navigation signal. Identity validation and refresh remain bounded by their explicit signal and timeout; ordinary data GETs still cancel. The actual transport fixture passed, CodeRabbit reported zero findings, and independent review found no authorization weakening. The current browser log contained no Auth cancellation stack trace. It did expose one remaining responsibility-profile log on a discarded request; both responsibility-reader error sites now use `logReadFailure`. This logging-only follow-up has focused lint evidence and the existing request-lifetime contract, but follows the browser build above. Active-request and mutation failures remain visible. CSP report-only `eval` notices are separate evidence, not cancelled database requests.

Selected discovery now includes only the requested suite's execution files and their producer prerequisites, even when a producer's separate group has reusable evidence. This run discovered two golden tests instead of the whole suite. The prerequisite regression passed. The final source follow-up also found an omitted completion wrapper in the calendar live observer. Its raw two-second exception incorrectly stopped the remaining task after an observed 2000.5175 ms result. The shared wrapper now preserves the archived result and lets final qualification apply the unchanged tolerance. Missing results and mutation failures still stop the task. All 39 focused observation, archive, discovery and qualification checks passed. The repository import-graph check initially hit Bun's default five-second timeout after 6.4 seconds of parsing; it now has a bounded 30-second infrastructure deadline. No application deadline changed. Prevention: Tier 1 shared observation and prerequisite expansion, Tier 2 evidence and selection checks, Tier 3 independent source review.

The owner chose to continue on battery and leave timing acceptance open. Report `2026-09-28T134635943Z-3ad9cd85` is failed, not superseded by a passing correctness group. Calendar run `2026-09-28T134659088Z-4a8a69` completed all three tasks but exceeded unchanged timing limits. Examples include 282–378 ms immediate board feedback against 250 ms, a 2286 ms cold-board median against a 1565 ms reference, and a 2260 ms six-week opening against a 961 ms reference. Calendar-live run `2026-09-28T134659088Z-21ae36` stopped early because of the observer defect above; its 2523.7978 ms closure removal also exceeds the existing 2500 ms allowance and remains a timing finding. At that checkpoint both worlds and the earlier list run `2026-09-28T131742064Z-d1dd4d` were retained; the later mains-powered entry records their authorized cleanup. Battery operation is a confounder, not a demonstrated cause. No reference or tolerance was raised.

The interrupted planning run `2026-09-28T134659088Z-9552ec` was recovered only after its owner and children were confirmed stopped, then cleaned through the ownership wrapper. Its aggregate report preserves the two failures and marks unfinished groups blocked. The original report was retained before recovery. The last correctness campaign line recorded 29 reports, 388 verification minutes, 322 groups run, 96 reused, 28 failed and 47 blocked since the last commit. These historical totals are not a claim that the overhaul reduced test cost. A comparable timing check and the broader acceptance work remain open in the standards status.

## 2026-09-28: approved calendar correction workflow and integrity checks

The owner selected a prefilled correction form with a mandatory reason for recorded-time drag and resize. Planned occurrence moves keep their immediate optimistic behavior. Recorded time uses the existing correction and approval process, including another reviewer for the actor's own time. The dialog opens from the calendar's loaded facts without another options request. Direct calendar batch reassignment of raw time was removed.

Focused integration run `2026-09-28T123814254Z-b63a63` passed on build `46021508-202e-4213-99db-4f9cc771cc34`. It resized a recorded block, submitted a reason, checked one audited application and unchanged raw entries, and verified the result after reload. Its first fixture attempt omitted the historical entries' manual flag; that fixture was corrected rather than weakening date validation. This early run preceded the current-build verification recorded above.

Review then found missing timeline validation and unnecessary organization-wide correction-history reads. The server now checks the composed effective timeline for both employees before submission or approval. A service-only RPC selects history by both before and after ranges; effective facts are filtered for the caller after projection. A database revision captured before validation rejects stale approval after intervening time writes. One composed approval batch holds the revision lock. The new migrations were applied DEV-first and then local; PROD was unchanged. Subsequent corrections follow reassigned time's effective owner, with own-time approval still separate.

SQL report `2026-09-28T125839064Z-9ea1264a` passed revision rejection and batch checks. Report `2026-09-28T130748487Z-b8e36add` also passed recipient ownership and self-approval refusal. Security passed in `2026-09-28T130634240Z-b8bc7375`; closed-period checks passed in `2026-09-28T125611049Z-580eae30`. Two SQL fixture failures were missing prerequisites: the malformed-target assertion needed a valid revision, and the reassignment setup needed an add operation before an existing source could be corrected. Neither changed a product invariant.

Independent review found a real midnight case missed by a synthetic boundary test. Adjacent work/break segments crossing Berlin midnight now close and reopen their day projections consistently. The regression uses the actual canonical projector. Calendar source completeness, rich activity context, ordering, composed validation and recipient read checks pass at their focused boundaries. CodeRabbit's database review reported zero issues; this is source review, not runtime acceptance.

Banner cleanup now owns its displayed message by identity, so leaving the calendar clears pending feedback without dismissing a newer page's message. Calendar preferences carry the originating organization and reject a delayed write after switching organizations. Both have focused passing tests. Prevention: Tier 1 shared ownership and correction transactions, Tier 2 controlled-response, reader, SQL and projector checks. Current-build performance and broader acceptance remain separate evidence.

## 2026-09-28: independent sessions and calendar pilot

Browser role contexts now authenticate once with the normal SSR client and seeded credentials. Each owns its cookies and refresh token. Global setup seeds data without four UI logins, and role setup opens no unrelated job page. Authentication UI remains covered by its own journeys. Measurement contexts use the same fresh-session factory instead of copying another context's storage state. Three P1-21 cases that depended on setup navigation now open their actual dashboard explicitly. Independent review found and corrected those assumptions.

The five P1-24a golden cases now seed their own job and occurrence, with the tested changes still performed through the UI. The final employee case passed alone from a fresh world in run `2026-09-28T094901473Z-a2e8dd`. The pilot then exposed three distinct issues:

- Run `2026-09-28T095027729Z-f883fa`: four cases passed; a month-tab click before hydration had no effect or preference request in the trace. Shared tab triggers now remain disabled until hydrated. The SSR contract passed, and the next browser run reached dispatch. Tier 1 shared readiness, Tier 2 component contract. Its retained world was cleaned after exact ownership verification when WSL's address changed.
- Run `2026-09-28T102828824Z-0fd64a`: four cases passed; the moved fixture date was beyond the dispatch overview's 14-day window. The old cross-suite date partition was unnecessary for independent job identities. Dates now use next week's Tuesday and Wednesday through the dispatch-window helper. Classified harness and cleaned. Tier 1 fixture construction.
- Run `2026-09-28T103327043Z-2f7b74`: the receiver displayed the correct move after 2776.5 ms, beyond the unchanged 2500 ms tolerance. The trace records a 1256 ms mutation response and receiver window/board reads of 544/716 ms. Board source inspection found serialized independent reads; occurrence/dispatch/material data now load alongside person/capacity data after authorization. Independent source review preserved organization and employee filters.

The final pilot, run `2026-09-28T104938583Z-23982c` on build `207df8ce-280e-4c8e-a41e-8140da680131`, passed all five cases. The receiver showed the moved occurrence after 1521.6 ms; the runner qualified the evidence before cleaning its owned world. Group duration was 68.6 seconds, compared with 71.2 seconds for the previous day's group. This is not evidence of a substantial cost reduction or acceptance of the wider performance suite.

Timing collection now lets a slow correct result finish the remaining task before the runner rejects its timing. This prevents a slow move from hiding later dispatch assertions or truncating a benchmark's samples. The 23 focused observation, archive and finalization checks passed; the rejection test records 2800 ms and proves final qualification still fails. Deadlines and tolerances did not change.

The 17 references now retain their existing values after review of measurement compatibility. Performance preparation explicitly warms the jobs route in a separate context, preserving the old helper's server warmup while ordinary functional sessions start blank. This transfer does not certify the current build. Report `2026-09-28T131726411Z-353b2c28` measured customer and job openings at medians of 1343.1 and 1106.4 ms, above the unchanged reference allowances. Their TTFB was 9–64 ms, with most time after the first response byte; these samples do not establish a slow database query. No slower candidate was promoted to a reference. The ordinary freshness helper no longer imports reference data; 37 focused policy, identity, evidence and hydration checks passed. The focused unit wrapper now honors supplied paths instead of silently running all of `lib`.

The same report passed both P1-22 cases on build `82de60a6-9374-47cd-b804-84a396c93d0d`: submission and approval now form one self-contained workflow, and calendar resize has its own fixture. The planning check clicked a server-rendered creation control but never opened a dialog. Like tabs, client-owned calendar header and page dialog actions now remain disabled until their handlers hydrate. The current-build P1-22 run above subsequently verified the loaded creation form. Independent correction review also found that ordinary edits reconstructed resumed work as a new clock-in. The source reader now projects the complete session and retains each segment's actual boundaries; the regression checks a valid break-end correction and rejects the former reconstruction. Revision sampling starts before these source reads. Prevention: Tier 1 shared projection and readiness ownership, Tier 2 real-projector and server-rendered control assertions.

Review also caught malformed German test strings introduced by an incorrectly encoded edit. They were restored, and the new source-encoding check catches invalid UTF-8 and the observed corruption patterns before a browser run. The encoding and spec-convention checks passed, 171 tests as reported by the unit runner. CodeRabbit's test and library reviews completed with no findings. Independent runner review confirmed that slow observations still fail final qualification and retain their world. Its follow-up is a passing check of the actual freshness helper import graph, in addition to synthetic selection tests. Whitespace and property-order cases now exercise the serial-mode convention too.

Type checking, lint, unused-code, documentation and coverage-map checks passed in report `2026-09-28T105342535Z-1fc7ba0d`. Three remaining time-read logging calls now use `logReadFailure`; cancelled request logging stays distinct from active-read and save failures. The request-cancellation isolation test passed outside the sandbox after the sandbox refused its fixture subprocess. These logging edits followed the browser build above. Supabase Auth's cancellation log was still visible at that checkpoint; the later request-lifetime repair is recorded above. No global console suppression was introduced. These results cover the named changes, not the full test migration or Wave 3 acceptance.

Source review also confirmed that calendar recorded-time gestures could reach legacy write endpoints with synthetic canonical-segment IDs and bypass the established correction process on legacy rows. The owner selected the prefilled correction form; the correction entry above records implementation and evidence. Planned occurrence movement is a separate path and was exercised by the pilot above.

## 2026-09-28: stacked dialog action spacing

The owner reported touching buttons in stacked modal footers. `DialogFooter` applied horizontal margins only at the desktop breakpoint and had no mobile gap. It now owns `gap-2` for both orientations. `SheetFooter` had the same omission and received the same correction; no current product caller imports that footer. `AlertDialogFooter` already has the required gap. The caller search found no explicit zero-gap override of dialog or alert-dialog footers. This inspection does not certify every conditional or nested custom action group.

Tier 1 is the shared spacing default. Tier 2 measures actual dialog button separation at 375 px and 1280 px with compiled application CSS. Those two checks and the existing stable tabbed-form check passed, three tests in 5.7 seconds. Focused lint, documentation and whitespace checks passed. The mirrored design skills now require at least 8 px between actions, including separately nested groups. No application backend, dependency or publication changed. This presentational correction did not require a separate remote review under the review guide.

## 2026-09-28: calendar move ordering, read transport and layout repairs

The owner reported lagging feedback, slow creation options, calendar moves jumping back and repeated `ResponseAborted` errors. A controlled-response test reproduced one actual product defect: rejecting an earlier move reset a later successful move to its original position. The failing evidence is in `.agent-logs/ui-contracts/2026-09-28T08-28-48-381Z-c0cb4cf7`. This establishes one cause of snapback, not every reported occurrence.

The repair applies gestures immediately but serializes writes for the same job or occurrence. Its last confirmed state owns rollback and Undo. Independent review found that Undo also needed to join that queue; the repair and regression include a new move made while a failed Undo is pending. Another review finding concerned older failures hiding a newer Undo. Failures deliberately keep visible priority, but the error banner now preserves the latest successful entry's Undo. Both findings were closed by the fresh reviewer.

The calendar's planning options, member options, parked jobs and parking contexts now use the existing authenticated background GET registry. They previously shared the browser's Server Action queue with saves. The creation dialog starts on its correct tab and does not load duplicate member options for the planning form. `logReadFailure` distinguishes logging inside a cancelled GET from errors in active requests and mutations; it leaves returned failure results unchanged. These are structural repairs, not a measured claim about backend latency.

Desktop day rows have a readable minimum and share remaining height; the month grid fills its viewport. Narrow day cards no longer discard their details through the one-line compact layout. Rendered inspection also exposed an unavailable ancestor ref during the day view's initial layout effect: measuring after the parent commits now fits the timeline and scrolls to working hours. The component test helper's obsolete unlayered geometry CSS was removed because it overrode the production stylesheet, including sticky positioning. These fixtures use the application CSS but do not include the full application shell or Next's font loader. Their screenshots establish geometry, not final visual approval.

Prevention: Tier 1 puts same-entry moves and Undo under one queue, moves reads out of the write queue, and requires the actual stylesheet in calendar component tests. Tier 2 covers held responses, failure order, Undo during another gesture, independent entries, request cancellation isolation, registry authorization and tall-screen layout. The final board/day/month component run passed 23 tests in 43 seconds; the subsequent day-only run passed all eight tests after the measurement correction. Focused request and layout unit checks, typecheck, focused lint and documentation checks passed. No database-backed application campaign ran, no performance budget changed, and no previous failure was cleared.

CodeRabbit returned zero issues for `components/kalender` and `lib/data`; logs are `.agent-logs/ui-overhaul/calendar-regression-coderabbit.log` and `.agent-logs/ui-overhaul/calendar-read-coderabbit.log`. The first pass preceded the final card-detail and measurement adjustments; the fresh reviewer inspected those afterward. The deletion pass removed fallback CSS and redundant reads and added no dependency. Neither reviewer result establishes whole-app visual quality or live performance.

Remaining work: measure actual save, dialog and cross-session latency; assess the cost of refreshing six datasets and retaining a month-sized window during day work; assess overlapping recorded-time edits and parking, which use separate mutation paths; implement and compare the proposed test allocation and setup changes; verify account-specific TREX runtime access. The existing Wave 3 hold remains.

## 2026-09-28: testing cost baseline and evidence-before-cleanup repair

The owner requested a fundamental reassessment after repeated harness overhauls failed to reduce the cost of verification. The 2026-09-27 successful report `2026-09-27T154559288Z-23ba6e87` contains 30 freshly executed browser groups with 224 test outcomes. Their group durations total 3,336 seconds: 2,368 seconds inside recorded test execution and 968 seconds outside it. The latter includes process startup, setup, teardown and qualification; it is not a measurement of authentication alone. Per-test fixtures are inside the test durations. Reused results retain their original duration and must be excluded from this accounting. The complete report took 60.4 minutes, including non-browser checks and orchestration.

Source inspection found four forced UI logins in every global setup, role-session validation through an unrelated job-list navigation, mutable within-file prerequisites, and the reference-selection and cleanup defects recorded below. These findings explain avoidable dependencies; they do not quantify each one's contribution or establish a replacement's speed. Setup optimization alone cannot remove the 40 minutes spent inside tests. Review assertion allocation and duplicated journeys as well.

The first bounded repair moves final active-world cleanup out of Playwright teardown. Teardown now archives the owned world. The parent runner calls `finalizeQualifiedWorld` only after candidate, executed-selection, timing and exit-status qualification. A failed comparison therefore keeps that world available for diagnosis. Interruption before this boundary leaves ownership intact; hard process termination still requires interrupted-run recovery. Explicit cleanup commands and earlier world rotation in multi-file focused audits remain separate deletion paths. No application assertion, timing budget or existing failed result was changed.

Prevention: Tier 1 separates archiving from destructive cleanup; Tier 2 exercises the real teardown/finalization functions in an isolated process with controlled storage adapters. Cases include browser success followed by rejected evidence, an unfinished or interrupted result, diagnostic reuse, explicit retention, unreadable world state, cleanup failure and full success. These checks supply qualification outcomes; they do not exercise parent qualification throwing, cancellation between child completion and finalization, local-backend cleanup, or whole-suite reliability.

Validation: four focused tests passed, including the subprocess cases; full typecheck, focused lint, unused-code check, docs check and whitespace check passed. The first sandboxed subprocess attempt was denied by the host; the authorized unsandboxed test completed. No application browser campaign was started. An independent reviewer found no blocking defect and identified the orchestration coverage limit above. `bun run review --uncommitted --dir tests/golden` completed with zero issues; its output is `.agent-logs/ui-overhaul/finalization-coderabbit.log`. That CodeRabbit scope covered teardown and two earlier changes in the same directory, not the parent runner, unit fixture or docs; the independent reviewer inspected those manually. The deletion pass added no dependency, alternative cleanup engine or product code. This is a bounded repair, not acceptance of the testing-system overhaul or Wave 3.

The next comparison must measure a representative ordinary browser group with only its required roles and directly prepared prerequisites, alongside a true cross-session task. Keep UI authentication coverage in its owning tests. Compare execution time, setup calls, failure diagnosis and assertion coverage before expanding the change. Deliberately exercise stale authentication, setup failure, rejected evidence and interruption. A few green repetitions do not establish reliability, and moving every browser assertion into mocks does not preserve coverage. The existing Wave 3 hold remains.

## 2026-09-27: required comparisons after owner-approved reference activation

The owner accepted small slower references if bounded investigation found no meaningful application repair. The retained corrected-build trace showed next-month board responses taking 298.4 to 369.7 ms, with only 2.6 to 4.8 ms receiving the response. One sample superseded an initial request pair during post-mutation refresh activity. This establishes response waiting as a substantial cost, but does not isolate a database query or prove the invalidation source. No further application edit was justified. The already reviewed draft from `.agent-logs/performance-calibration/2026-09-27T153452526Z/` was activated unchanged, retaining the historical references. All 17 scenarios are required again; no deadline, tolerance, workload or measurement boundary changed.

The two reference/configuration inputs selected 21 groups, including ten non-performance application journeys. This selection breadth is now an explicit testing backlog finding. Report `2026-09-27T181100214Z-c6baedfa`, build `dbe50edd-fcd4-49d8-a15f-54f59714d295`, passed the five static groups, 1,425 units, 110 component contracts and the P1-22 audit. All four performance groups failed:

| Group and owned run | Observed failure |
| --- | --- |
| Calendar, `2026-09-27T181120423Z-ce12a1` | First optimistic reassignment appeared after 262.2 ms against the 250 ms hard limit. The scenario stopped after its first sample; remaining calendar comparisons are unverified. Cold entry in that same sample took 3,503.7 ms, below its hard limit but much slower than the earlier samples. |
| Lists, `2026-09-27T181120423Z-c6dd66` | Customer median 1,786.3 ms against reference 970.4 ms; job median 1,373 ms against 780.5 ms. Correctness and hard limits passed, relative comparisons failed. |
| Calendar live, `2026-09-27T181120423Z-4e2a1f` | Closure delivery took 2,500.0915 ms against the 2,000 ms target and 2,500 ms tolerance limit. |
| Planning, `2026-09-27T181120423Z-0c58e6` | Cross-session median 1,575.7 ms against reference 1,170.8 ms; employee opening 807.8 ms against 457.4 ms. Both failed relative comparison. Administrator opening remained within its reference tolerance. |

These are observed product-performance symptoms with unresolved cause. A later host snapshot showed active endpoint-security processes and 3.58 GiB available out of 31.43 GiB. It does not prove contention caused a particular sample. The application source was unchanged during this investigation. Do not relabel these failures as environment failures merely to unlock a retry, or recalibrate from this failed run.

After the four performance groups, the agent stopped the run to avoid spending more time on unrelated journeys. Windows process termination bypassed finalization. The verifier and browser workers were confirmed gone before its dead-owner lock was archived. The original report is retained under `.agent-logs/ui-overhaul/interrupted-reference-verification.original.json`. The existing finalization helper recovered a terminal failed report at 18:34:24 UTC, preserving eight passes and four failures and marking nine unfinished groups blocked. Its 23.4 minutes include recovery, not a new successful run. Interrupted `golden:gg-00` run `2026-09-27T181120423Z-9c6edb` retained three completed tests and no assertion failures; its world was cleaned. Calendar and calendar-live worlds remain available. List and planning worlds were already deleted by teardown after their browser assertions passed, before the runner rejected their comparisons. Their artifacts remain. This cleanup-order defect is a separate testing backlog finding, not a reason to relabel or erase the timing failures. Final campaign accounting is 16 reports and 365 minutes, with 19 failed and 43 blocked group results.

Prevention: Tier 2 existing hard-deadline and reference checks rejected these results. Tier 3 bounded investigation retains uncertainty and holds acceptance. No prevention for the unknown timing cause is claimed. The next testing-system review must address selection breadth, benchmark repeatability and collecting the complete declared sample set even when one sample fails, while keeping the failure visible. The earlier 66-group pass remains historical evidence, not a substitute for these failed required comparisons. No unchanged-input retry or additional application change followed this investigation.

## 2026-09-27: UI correction verification

Report `2026-09-27T090750229Z-24a5ff02` passed all static groups, 1,420 unit tests, six SQL groups, 102 component contracts and audits A1 through A5. A6 run `2026-09-27T090804369Z-ec3ec4` expected an edit action on a past card, which P1-24a correctly locks. Its repair asserts readable locked history and checks all three edit scopes on a future occurrence, retaining the unchanged-history comparison. A7 run `2026-09-27T090804369Z-3bcb1c` tried to drag today's 06:00 visit after it started. Its repair uses a future visit and asserts the unlocked precondition while keeping the parking review due today. Both are classified harness defects, with Tier 2 fixture and boundary assertions.

A separate rendered review found that last-lane cards covered capacity and actual hours. Person rows now reserve a footer track, Tier 1. A real-component geometry check verifies both labels below the last card and beside each other in both densities, Tier 2. This defect had escaped both the first visual review and visibility assertions. Verification was stopped before editing product or test code. P1-13 run `2026-09-27T090804369Z-88bed2` was explicitly recovered as interrupted after checking the parent and child processes had stopped. The three owned worlds were cleaned; interrupted work remains unproven. Windows process termination left the parent report unfinished, so its prior passes retain only their original input qualification and its elapsed cost ends at the last group start under the existing campaign rule.

The first presentation fixture placed its controls beneath the fixed banner. Adding a Tailwind class to a test-only file did not change its layout because production CSS scans application sources. The fixture now owns its test-only spacing through an inline style, keeping the actual shared banner unmodified. The short-resize fixture also placed its target beyond the viewport and expected a batch write where the application uses a single-entry write. The fixture now places the short visit in the visible timeline and checks the real write boundary and exact timestamp. A phone test used "Fahrtzeit" instead of the application's "Fahrt" label; the failure snapshot showed the actual accessible name. These were harness failures, not reasons to weaken click or timing checks.

The isolated contracts then passed the affected banner, frame, focus, drag, Undo and short-resize cases. The phone contract checks that short activities and visits open without writes or horizontal overflow. A test callback initially assumed a session `id` field; the production typecheck rejected that assumption, and the observation callback now records its invocation without inventing a field. A standalone capture under Bun timed out during browser launch; compiling the ignored capture script for Playwright's Node runtime produced the images. This was a capture-tool failure before navigation, not application evidence.

Prevention: Tier 1 explicit test-fixture layout independent of production class scanning; Tier 2 observable interaction, containment, exact-write and type checks. Representative visual review remains Tier 3 because these checks cannot decide whether a populated screen is well composed. Selected report `2026-09-27T084117323Z-69e30a73` passed all six static/unit groups, including 1,420 unit tests, but the complete component run passed 100 and failed two. The phone deletion assertion assumed a reachable block where `getEffectiveTimeEntries` excludes pending deletions; the fixture now tests actual pending approval. The month fixture inherited the September clock while its movable visits were in June, so the product correctly locked them as history. Each fixture now supplies the clock for its scenario. CodeRabbit also identified an overflow assertion on the outer section; the corrected assertion checks the calendar scroller itself. These Tier 1 fixture and Tier 2 observation corrections preserve product semantics. Full selected application verification is pending; focused passes alone do not close this change.

### Second verification and bounded repairs

Report `2026-09-27T095441080Z-5810f2e3` passed all static, unit, SQL and 103 component checks, A4 through A7, the Wave 2 audits and the security-account, pagination, list-performance and live-calendar groups. A2 and A3 reused qualified evidence. It exposed two product defects: inventory location run `2026-09-27T095453191Z-c344f8` briefly showed both the confirmed row and its pending draft; layout run `2026-09-27T095453192Z-e1566d` found employee-page phone overflow. Identity reconciliation and guarded async continuations fix the former; wrapping the shared heading and allowing the employee tabs to shrink fixes the latter. Both use Tier 1 construction and Tier 2 component/browser checks.

Plantafel run `2026-09-27T095453192Z-8271a5` still expected the note shortcut and readOnly preference removed by the owner's September 25 decision. Its audit and F17 coverage now follow that decision, including the resulting person and date. Performance run `2026-09-27T095453192Z-8c8125` scrolled a tall target into view and hid the drag source before measurement. Its helper now aligns reachable points inside the shared viewport before the measured release. These are Tier 2 harness repairs; measurement boundaries and budgets are unchanged. Neither failed run is acceptance evidence.

Verification stopped before repairs. Planning run `2026-09-27T095453192Z-3d8411` was recovered as interrupted after its processes stopped. All five owned worlds were cleaned explicitly. The unfinished parent report retains its original qualified passes, not a fabricated completed status. Focused header and both inventory delivery-order contracts passed after fixing a fixture-only Next Link boundary and removing a duplicate nested live status in the pending card. Two identity unit tests and coverage traceability passed. CodeRabbit completed component and test passes with zero findings. Its inventory pass identified an overly broad draft type; pending drafts now exclude `id` at the type boundary, with a compile-time rejection and a runtime guard test. The independent review preserved full-overview item reconciliation and tightened the note assertion to its selected date. The corrected drag helper participates in every measurement digest. Under the existing testing policy, all 17 comparisons are temporarily calibrating while fresh samples are gathered; hard budgets remain enforced and old references remain intact. Required comparisons must be restored before acceptance, and a slower reference requires owner approval. Final application verification remains pending.

Targeted report `2026-09-27T110725710Z-389304fe` passed A1 28/28, Plantafel 6/6, mobile layout 51/51, list performance, live calendar and planning measurements. Calendar run `2026-09-27T110733484Z-f72d95` failed before its first drag because scroll rounding put the source center 0.375 px above the helper's safe region. The setup now targets a two-pixel interior margin and retains its original guard, Tier 2. A direct retained-world diagnostic confirmed both reassign directions and server confirmation. Its loaded light/dark footer captures show capacity below the last card; artifacts are `.agent-logs/ui-overhaul/final-footer-*` on build `893cc86f-4885-4a9c-8dca-507a0717fc28`.

Retained replay `2026-09-27T112513110Z-3d61fe` failed its cold-open observer before reaching the drag. Its trace shows a usable month view while the observer required week; raw preference reset had not invalidated the previous cached view. This diagnostic is not performance evidence. Replay setup needs real UI state restoration; the wider reset/invalidation repair belongs to the deferred testing review, Tier 3 until then. Both manifests were cleaned after diagnosis. No timeout, budget, comparison tolerance or failed result was relaxed.

Campaign at the targeted run's end: `6 reports, 101 min of verification, 78 groups run, 7 reused, 9 failed (harness 4, product 2, static 2, unclassified 1), 4 blocked`. The remaining unclassified calendar attempt was subsequently classified as harness. Current comparisons remain calibrating pending fresh compatible samples and reviewed references.

### Calendar coverage retention

Report `2026-09-27T113119688Z-46975371` passed all static groups, 1,423 unit tests, six SQL groups, 106 component contracts, the selected Wave 1 and Wave 2 audits, and the list, live-calendar and planning measurements. Calendar run `2026-09-27T113130576Z-a09489` measured the covered day-to-board return at 735.8 ms against 500 ms. The trace showed that the day mutation refresh had replaced the already-loaded week with day coverage. Returning to Plantafel then fetched the week again. This is a product defect, not a reason to raise the budget.

The range owner now refreshes its one committed window when all six datasets share that coverage and it contains the requested dates. Otherwise it reads the requested range. Both reads and their committed coverage use that same range. It neither joins windows nor treats retained data as newly fresh. Scope, generation and post-invalidation guards remain unchanged. This is Tier 1 prevention. Real-hook contracts verify day mutation, fresh replacement data, a covered return without another read, an outside date and partial initial coverage, Tier 2. All 16 focused calendar contracts pass. Independent review accepted the repair and named its bandwidth tradeoff; affected application measurements remain required.

Verification stopped before source edits. Golden run `2026-09-27T113130576Z-8d9e14` was recovered as interrupted after its owner and children stopped. Both owned worlds were cleaned. The unfinished parent report keeps its qualified prior results and recorded campaign cost. CodeRabbit reviewed the calendar source and component contracts. It raised no test issue; its suggestion to hide the phone's primary entry label was rejected because the visible label fits the reviewed phone layout and makes the action recognizable. Final acceptance and required performance comparisons remain pending.

### Preference acknowledgment and obsolete calendar reads

Report `2026-09-27T123430917Z-38d689c2` completed in 73.6 minutes with 64 groups passed and two failed. It passed 1,423 unit tests, 108 component contracts and all 51 layout cases. The covered day-to-board median was 346.3 ms against the unchanged 500 ms limit. All measured hard limits passed, but comparisons remained calibrating and did not supply final performance acceptance.

Both failures reloaded after a preference upsert but before the streamed response ended. Audit run `2026-09-27T123448744Z-a966bd` started the compact-density POST at 13:08:36.157 UTC and reloaded at 13:08:36.595. Golden run `2026-09-27T123448744Z-c23d42` started the two-week-horizon POST at 13:47:42.747 and reloaded at 13:47:43.010. They were initially classified harness and cleaned. Independent review then found that the audit response already carried the cache-invalidation flag before reload. The original stale-reload cause therefore remains unresolved; incomplete response bodies alone do not establish a cache-invalidation race.

The first shared helper waited for stream completion and a decoded success result. Report `2026-09-27T140613495Z-b3e07d0d` exposed a separate harness defect: both exact request matchers resolved and HTTP success assertions passed, but `response.finished()` waited until the test deadline. Runs `2026-09-27T140627393Z-ab3c14` and `2026-09-27T140627394Z-6d2bdb` are classified harness and cleaned. Local Next.js source awaits the action and its invalidation before generating the Flight response; the stream also carries page rendering and can remain open. The corrected shared helper checks the matched response's invalidation flag. Exact database and reloaded-page assertions still own success. This Tier 2 correction removes the stream-EOF dependency; it does not by itself explain the original stale reload. CodeRabbit reviewed the corrected helper with zero findings.

Month-next navigation measured a 469.1 ms median against the old 182.3 ms reference. Two samples overlapped an obsolete old-month refresh, transferring 434,156 or 434,157 bytes in five requests instead of 88,998 bytes in two. The two-request sample still took 312.6 ms. Source and trace review showed that the retained-coverage repair does not change these month ranges; it does not explain the whole difference. The range owner now cancels superseded read pairs after advancing their generations, including mutation and scope cleanup. Both private fetches share the pair's signal. Later invalidations still trigger new reads; current failures remain visible. This is Tier 1 removal of obsolete browser transport, with Tier 2 actual-fetch forwarding and real-hook checks for cancellation, late responses, mutation ownership, scope changes and genuine failure. It does not establish backend cancellation or restored reference performance. Fresh measurements remain required, with no raised budget or silently replaced reference.

The focused 18 calendar contracts, transport unit and typecheck pass. CodeRabbit's calendar component, library and test passes reported zero issues. A proposed development StrictMode experiment used the production React contract bundle and therefore did not exercise effect replay; that invalid experiment was removed. The existing production-mode lifecycle assertions remain. No development replay proof is claimed. Independent review accepted the bounded production paths, with fresh application verification still pending.

Campaign after classifying both failures: `8 reports, 219 min of verification, 166 groups run, 25 reused, 12 failed (harness 7, product 3, static 2), 4 blocked`. Earlier attempts remain counted. The relevant fixture, pointer and completion-barrier repairs remain executable changes in the same diff.

Report `2026-09-27T143059387Z-4d349f48` passed all five selected groups, including audit run `2026-09-27T143114544Z-3ed9c2` with 6/6 cases and golden run `2026-09-27T143114544Z-44946c` with 5/5. Both stored preferences survived reload with the corrected action-header barrier. Their worlds were cleaned. This establishes current behavior, not a retrospective proof of the earlier failure's cause. Campaign: `10 reports, 246 min of verification, 183 groups run, 25 reused, 14 failed (harness 9, product 3, static 2), 4 blocked`. Both campaign limits are exceeded; the shared fixture and synchronization repairs remain in this change, and attempt history is preserved.

Fresh performance run `2026-09-27T140627394Z-6ca325` passed every hard limit after cancellation. Month-next samples were 456.4, 520.0 and 329.5 ms, median 456.4 ms. The old reference plus tolerance allows 432.3 ms, so the comparison remains open. The two slower samples transferred about 90 KB rather than the earlier 434 KB, but still overlapped other requests. Draft references remain unapproved and inactive under `.agent-logs/performance-calibration/2026-09-27T142907973Z/`; the owner decision and required-comparison checks remain pending.

Further trace review corrected both original stale-reload classifications to product. The golden save also returned invalidation headers before navigation, and its reload returned the same HTML as before the save, with horizon one instead of the persisted two. Both GETs carried `private, no-cache, no-store` and distinct response dates. No intervening preference write appears. The exact internal cache mechanism remains unresolved. These corrections retain the earlier classifications and campaign limits above as history; they do not waive the over-budget repair obligation.

`getCalendarPreferencesForPage` now reads the caller's preferences directly, shared only within a React render. The calendar page supplies the organization and user it already verified. A failed read throws instead of returning defaults. Other preference consumers retain their existing cache and invalidation. This Tier 1 change removes cross-request cache reuse from this landing decision without adding another cache. The isolated Tier 2 test calls the actual reader across stored changes and identities, and checks missing rows and failure propagation. The golden journey reloads after each of two successive horizon changes. The focused unit check and typecheck pass; fresh application acceptance remains pending.

Verification report `2026-09-27T144339999Z-fdbf98ba` was intentionally stopped before this source edit. The process tree was confirmed gone, the stale lock was preserved, and runs `2026-09-27T144351775Z-ea73b7` and `2026-09-27T144351775Z-fa456a` were recovered as interrupted and cleaned. Their completed assertions remain recorded, with no inferred business failure. The original report is preserved under `.agent-logs/ui-overhaul/`; its terminal record is failed, preserving completed group results and conservatively charging time through the first recovery. Missing groups remain unproven. Fresh verification must qualify the new reader before closure.

### Fresh reader verification

Report `2026-09-27T152342679Z-05b2ab20` passed all seven selected groups in 10.2 minutes. Unit tests passed 1,425/1,425, Plantafel audit 6/6 and the golden journey 5/5. Calendar, planning and live-calendar checks passed on build `3b38c3ab-17a9-4ee1-a222-cef22e737ddd`; list performance reused qualified unchanged-input evidence. All worlds were cleaned. The fresh reader also recovers after a failed read in the isolated test. Its page catch presents a German alert and a native GET retry with the selected date; source review covers that branch, not a rendered failure capture. Final CodeRabbit passes for the page, reader, fixture and golden journey/helper had no findings.

The current inactive draft is `.agent-logs/performance-calibration/2026-09-27T153452526Z/`. It retains every declared sample. Cold entry measured 1,564.6 ms against the old 1,248.1 ms reference, exceeding the old tolerance by 4.5 ms; month-next measured 403.5 ms and fits its old tolerance. All hard limits passed. Comparisons remain calibrating until the owner resolves slower references and required-comparison verification passes. Full change-plan verification remains pending.

Campaign after the classification correction and targeted run: `12 reports, 276 min of verification, 199 groups run, 34 reused, 14 failed (harness 7, product 5, static 2), 4 blocked`. The time budget remains exceeded. The fixture, response-synchronization and product-state repairs above satisfy the requirement for concrete prevention changes; they do not waive remaining acceptance checks or reset attempt history.

Complete-plan report `2026-09-27T153756303Z-861e6937` stopped at lint before browser execution. The new retry state used a raw alert instead of the registered `SectionError`. The page now composes that existing component, retaining its native GET retry. Prevention is Tier 1 shared feedback construction and the existing Tier 2 lint restriction, which caught the violation. The report preserves 35 qualified passes, one static failure and 30 blocked groups. Its failure does not invalidate prior results on their original inputs; the corrected page still needs fresh qualification.

Corrected-build report `2026-09-27T154559288Z-23ba6e87` passed the complete selected change plan, 66 groups with no failures or blocked groups, in 60.4 minutes. Build `89977e6e-1bc8-477a-ba0f-a8a236e87048` passed 1,425 unit tests, 110 component contracts and the affected browser journeys, with qualified reuse for unchanged groups. The final calendar audit and golden journey passed. All executed worlds were cleaned. This is local change evidence, not release or live-provider evidence.

The reference decision remains open. Corrected-build calendar run `2026-09-27T154608433Z-d9bc28` measured cold entry at 1,399.1 ms and month-next at 479.6 ms. Cold entry fits its old tolerance; month-next exceeds its old 432.3 ms tolerance. All hard limits passed. Neither these samples nor the earlier draft has been silently selected as a new active reference. Comparisons remain calibrating, so the green change report does not close performance acceptance. The standards review owns the remaining decision and retained visual references.

Final campaign accounting for this run is `14 reports, 339 min of verification, 269 groups run, 96 reused, 15 failed (harness 7, product 5, static 3), 34 blocked`. Historical failures and interruptions remain in the accounting. The concrete prevention changes above remain required; no campaign reset, timeout increase or budget relaxation was used.

## 2026-09-25: Runner ownership and campaign recovery repairs

The owner requested the two runner repairs and campaign-policy correction identified by the post-P1-24a review. `golden:p1-24a` called `expectLiveWithin` without exclusive freshness ownership. Shared verification setup ran after initial report publication but before finalization, so a thrown preflight/discovery error could strand a running report. The campaign gate accepted unrelated file edits while rejecting some real spec repairs and qualified environment recovery.

The timing registry now pins P1-24a and recognizes direct, aliased and namespace timing calls. A focused report owner encloses shared setup and execution, records unfinished groups as blocked on exceptions, restores signal/environment state and publishes terminal accounting. The campaign gate checks changed reachable test/runner inputs for each unresolved group, or the existing retained environment recovery. Diagnostics must finish before cleanup on the same build and target. Historical failures remain counted; group retry guards are unchanged. Imported timing wrappers still require explicit ownership metadata. Reporting cannot guarantee disk writes during a filesystem failure or finalization after a hard process kill.

Verification: 26 focused tests passed. Selected report `2026-09-25T190002415Z-5d8cf0af` passed `static:typecheck`, `static:lint`, `static:docs`, `static:coverage`, `static:unused` and `unit:all`, including 1,418 unit tests across 181 files. The report took 5.4 minutes. Campaign line: `Campaign since 2026-09-25T18:08:28.000Z: 1 reports, 5 min of verification, 6 groups run, 0 reused, 0 failed (none), 0 blocked.` The initial sandbox command stopped before planning because it could not spawn Git; authorized local execution completed. No browser, database, cloud or application acceptance was run or claimed, and no test world was created.

A fresh independent reviewer found no blocking issues in the nine runner/source-test files. `bun run review --agent -t uncommitted -c docs/technical/testing.md` completed with zero issues and included both new lifecycle files. The deletion pass retained one lifecycle owner because it provides the shared finalization and injection boundary; no dependency, product module or unrelated runner feature was added. Callback indentation was aligned after verification with an explicit check that the executable content digest stayed identical. No commit, push or release is part of this repair.

Prevention: Tier 1 complete lifecycle ownership; Tier 2 timing classification, failure-path regression tests, relevant campaign repair checks and recovery-order checks. Causal diagnosis and visual quality remain reviewed judgments. Smaller probe, convention and docs-checker findings remain open in the review backlog.

## 2026-09-25: The harness overhaul and its own campaign

The owner ruled after the P1-24a campaign that the execution model changes, not the guidance ([decision 0007 amendment](../decisions/0007-independent-test-groups.md#amendment-2026-09-25-the-execution-model)). Measured first: the runner's per-group overhead outside Playwright was about 40 s (two discoveries, the preflight's shell-outs, two archive scans over 1,730 run folders, a re-hash of every source file), and six golden groups took 8.2 min serially, 7.3 min on two workers (each overlapping group about 70 percent slower) and 5.2 min for five on three workers. The overhaul then landed the prepared plan, the worker option with the exclusive lane, the domain split of the two support monoliths, file-order execution without serial mode, the preference reset fixture, the immediate preference save, the Realtime probe and the campaign budget (Tier 1 and 2; the tiers are in the backlog).

Its own campaign found three harness faults, all repaired the same day:

- The two-worker trial's golden P1-12 freshness stage delivered in 2.7 s against 2 s right after a concurrent batch (environment, run `2026-09-24T231308629Z-f893c0`); the exclusive lane had run it alone, so the shared stack, not the scheduler, was the cause. The Realtime probe now precedes every timing-sensitive group.
- The first full plan on the new harness was voided group by group because comment-only edits to test files during the run changed the candidate fingerprint, which hashed raw bytes while the qualification hashed the comment-free token stream (run `2026-09-24T234845958Z-e0662e` recovered as interrupted). `lib/testing/evidence/candidate-identity.ts` now uses the same identity (Tier 1; `candidate-identity.test.ts` pins a trailing comment as no change).
- Removing the serial-mode line from the performance specs changed their measurement digests and orphaned every reference calibrated on 2026-09-24; the scenarios went back to `calibrating` and the closing run recalibrated them. The digest's breadth is an open conversion in the backlog.

The support split's importer rewrite overwrote itself once (the second rewrite read the original files) and was repaired from the generated domain files before any run; the mistake never reached a report.

The first complete plan on the new harness (report `2026-09-25T001058575Z-a4074395`, 61 groups in 83 minutes) passed 64 of 67 and left three, each a mechanism by the end of the day:

- `audit:wave-1:a1` was blocked as "failed on unchanged inputs" by the voided attempt of the aborted plan: the runner's own drift message reached the result as the reason and the parent's voided-attempt rule knew only its own message. `voidedByDrift` reads both (Tier 2, `group-evidence.test.ts`).
- `audit:wave-1:a5` read the task and unread row counts once and compared them with a badge that had already counted a notification row rendered a moment later (harness, run `2026-09-25T001109470Z-980055`); the equality is polled over the badge and both counts together.
- `audit:wave-3:p1-24a` could not unpark by drag right after the park: the new pointer refusal for a parked job without context read the contexts map before the just-saved context had been re-read (product, run `2026-09-25T001109470Z-1bb74e`). The context dialog now closes only after the map is current (`calendar-container.tsx`).

The second complete plan (report `2026-09-25T014536329Z-e5cfa145`, 39 groups in 58 minutes) passed 63 of 67 and left four:

- `audit:wave-3:p1-24a` still lost the unpark drop, this time with a different sentence in the trace's ghost: the card landed on the absence day. The inset Parkplatz panel narrows the board below seven columns' minimum width, the board scrolls sideways, and the pointer crossing the board's right edge from the panel auto-scrolled the columns under the target (product, run `2026-09-25T014545674Z-8157a4`). The engine now ignores a pointer outside the container and scrolls only after 150 ms in the edge zone (`drag-math.ts`, `drag-engine.tsx`; Tier 2 `drag-math.test.ts`).
- `audit:performance:calendar` failed the viewport guard the overhaul added: the profile's "next personnel record" by creation order is not the row beside the measured visit on a board sorted by team and name (harness, run `2026-09-25T014545674Z-fe3e7f`). The spec reads the neighbouring row from the board; the checkpoint field is gone.
- `audit:wave-2:p1-20` ("fetch failed" on a harness read) and `golden:gg-00` ("connect EACCES" on the storage cleanup after all 13 tests passed) hit a healthy stack at an unchanged address (environment, runs `2026-09-25T014545674Z-9eea00`, `2026-09-25T014545674Z-5c1dda`). The harness fetch now sends an idempotent read a second time after a connection-level failure and a write exactly once (`lib/testing/spec-support/transport-diagnostics.ts`, Tier 2).

The closing run on the recalibrated references (report `2026-09-25T043523340Z-a96de618`, 21 groups fresh in 22 minutes, 46 reused from the passed plan before it) compared all 17 scenarios against their baselines. Its campaign line still counted the voided a1 attempt as an unclassified failure and the aborted plan as running since 23:48, about 300 minutes that nobody spent; the summary now skips drift-voided attempts and ends an aborted report at its last group start (Tier 2, `campaign-summary.test.ts`). Corrected campaign line: Campaign since 2026-09-24T15:03:19.000Z: 9 reports, 284 min of verification, 223 groups run, 34 reused, 7 failed (environment 3, harness 2, product 2), 2 blocked. Over budget: 284 minutes of verification against a budget of 240.
The six failures above came from one change plan on the first Linux machine, right after the app started rendering in Geist as designed (owner decision of 2026-10-25). Geist sets wider glyphs than the Segoe UI fallback the app had shown on Windows, so five layouts that had fit by a few pixels overflowed. Correction: `DialogFooter` wraps its actions, the lifecycle section headers wrap, long names and file values break anywhere, and the documents toolbar placeholders take the measured Geist button widths. Focused proof: repair report `2026-10-25T183654468Z-6055c039` passed all six groups on the corrected build, `audit:wave-3:p1-24a` included, and `audit:visual` passed on references re-recorded after the repair (report `2026-10-25T190003792Z-ebd930a1`).
Correction: `terminateTree` now waits, bounded at 5 s, until no process of the cancelled group remains, and treats an already ended group as stopped. The Windows `taskkill /T` it replaced waited by itself. Focused proof: the cancellation tests passed five times in a row, then in `unit:all`.
