---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken, throwing, failing, or slow.
---

# Diagnose a defect

Adapted for WerkFlow from mattpocock/skills (MIT).

For a failed test group, [testing](../../../docs/technical/testing.md) owns reruns, repair mode and cleanup. Read it first. Read the owning feature spec before you decide which behavior is wrong.

Application tests run on local Supabase. The canary uses cloud DEV. PROD is read-only. Use the repository wrappers. Never start a competing server, reset or test run.

## 1. Pin the symptom

1. State the expected and the observed behavior: which user, record, operation and boundary.
2. Read the evidence you already have: the error context, screenshot, trace, logs, persisted state. A captured failure is evidence. Read the code before you rerun it.
3. Redact credentials and personal data in anything you show.
4. Pick a tight loop that can tell the explanations apart:
   - a unit or SQL assertion for a domain or database rule
   - a real-component browser check for a control
   - a retained run (`--reuse-run <key>`) or one affected group, or `KEEP_WORLD=1` to replay on a kept world
   - a read-only query for a disputed saved result
   - a timing measurement for a slowdown
   - [hitl-loop.template.sh](scripts/hitl-loop.template.sh) when only the user can see the symptom

Done when the loop goes red on the symptom, or you can name exactly what blocks observation.

## 2. Shrink and explain

1. Use the smallest scenario that still crosses the suspect boundary. Keep the auth, the organization and the timing that matter.
2. For a flaky failure, read the ordering in the trace before you add load. Test an ordering with a seeded or delayed experiment and a fixed limit. No 100-run loops, no sleeps.
3. Rank the explanations the evidence supports. For each, name the observation that would rule it out.

## 3. Instrument

1. Change one variable at a time.
2. Prefix temporary logs with a unique marker. Remove them before you finish.
3. For performance, measure from the user's action to the usable control. Register a repeatable measurement in `lib/testing/measured-scenarios.ts` through `expectUsableWithin` or `expectScenarioLiveWithin`.
4. When a write's outcome is unclear, read its persisted row. A repeat write is not an observation.
5. For a reconnect defect, hold a read across the gap and write during it. The [client freshness contract](../../../docs/technical/realtime-and-caching.md) owns the recovery order.

## 4. Repair and prevent

1. Fix the smallest confirmed cause. Keep the promised behavior.
2. Make the regression check cross the real boundary and go red without the fix. Retained failure evidence counts as red.
3. Land prevention at the highest tier ([decision 0005](../../../docs/decisions/0005-enforcement-ladder.md)): a type or shared API, then a check, then a written rule. State the tier.
4. A harness failure class seen twice in one change gets a fixture, a convention test or a runner rule, not a second local fix.

## 5. Close

Run the affected checks through the current test plan. Before you report, confirm:

- The repair addresses the original symptom at its boundary.
- Temporary instrumentation is gone.
- No failed, blocked or slow group is reported green.

Never rerun passing groups, raise a timeout or reset attempt history for a clean report. Report what the evidence supports: a confirmed repair, a disproved hypothesis, or an open observation with its next step.
