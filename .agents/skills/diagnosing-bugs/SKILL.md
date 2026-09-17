---
name: diagnosing-bugs
description: Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken, throwing, failing, or slow.
---

# Diagnose a defect

Adapted for WerkFlow from mattpocock/skills (MIT). For a test failure, first read `docs/technical/testing.md`. That guide owns group selection, deadlines, retained diagnosis, recovery, and stopping rules under decision 0007. Apply this skill to the suspected product, test, or environment defect. Read the owning feature contract before deciding what behavior is wrong.

Application tests use local Supabase. The canary and named provider checks use cloud DEV. Production is read-only during diagnosis. Use the repository wrappers and workspace ownership rules. Do not start a competing server, database reset, or test command.

When repairing an existing test, follow `docs/technical/testing.md#repair-an-existing-test-under-the-current-workflow`. It routes legacy fixture, selector, save, and timing failures to their current owners. Historical acceptance records do not override that procedure.

## 1. Establish the symptom and evidence

State the exact expected and observed behavior. Identify which user, record, operation, and execution boundary are involved. Distinguish a contract violation from an incorrect test assumption.

Inspect existing evidence first: the failed group's error context, screenshot, trace, relevant logs, and exact persisted state. A captured failure is evidence. You do not need to recreate it repeatedly before reading the code or forming a hypothesis.

Redact credentials and personal data before showing artifacts. Keep secrets in environment variables. Read selected trace fields rather than dumping requests, cookies, or storage state.

Choose a bounded feedback method that can distinguish the leading explanations:

- A focused unit or SQL assertion for a domain or database rule.
- A real-component browser check for control behavior.
- A retained diagnostic or fresh affected group for application behavior.
- A read-only request or state comparison for a disputed saved result.
- A focused timing measurement for a performance defect.

Completion means the symptom and relevant evidence are identified, with either a suitable bounded experiment or a precise reason that observation is currently blocked. Do not claim a reproduction merely because a nearby assertion failed.

## 2. Minimize the investigation

Choose the smallest scenario that still exercises the suspected boundary. Preserve authorization, tenant context, meaningful state, and the timing relationship that matters. Reuse known valid setup without pre-completing the operation under test.

For intermittent failures, use the retained trace to identify the ordering before adding load or repetition. A seeded domain experiment or controlled delayed response can test that ordering. Set an explicit experiment limit and stop when it answers the hypothesis. Do not use arbitrary 100-run loops, parallel stress, or sleeps in business tests to force a failure.

If the environment prevents valid observation, preserve the evidence and identify the missing capability or repair. Continue safe code and artifact inspection. Ask for user input only when a necessary fact or access is unavailable. No failed-command quota is required before reporting that limit.

## 3. Form falsifiable explanations

List the plausible explanations supported by the evidence and rank them. Do not invent extra hypotheses to meet a quota. For each explanation, state what observation would support it and what would rule it out.

Share consequential findings and uncertainty in the progress update. Proceed with already authorized, bounded inspection. Do not introduce another permission checkpoint for routine diagnosis.

Completion means the next experiment distinguishes explanations rather than merely repeating the failing operation.

## 4. Instrument the disputed boundary

Change one relevant variable at a time. Prefer existing logs, a debugger, or a focused read. Add temporary instrumentation only where it can distinguish the explanations. Prefix temporary logs with a unique marker and remove them before completion.

For performance, record the start event, completion event, elapsed time, and required deadline. Do not start the clock after a loading delay or reload a receiving page to manufacture freshness. An emergency timeout does not define acceptable response time. Measure a repeatable interaction as a registered scenario (`lib/testing/measured-scenarios.ts`, recorded through `expectUsableWithin` or `expectScenarioLiveWithin` in `tests/golden/support/scenario-measurement.ts`) so the value gets a budget, a baseline comparison, and browser attribution instead of a one-off stopwatch. End a navigation or view-switch measurement on the actual usable renderer or control. Calendar month readiness requires both range coverage and `FullCalendarView` completion; the parent marker alone cannot certify a dynamic fallback. A server response, a dialog shell, or hydration of a parent does not prove child readiness.

If a mutation response is unclear, inspect its exact persisted identity or version before any recovery. A repeat write is not an observation.

## 5. Repair and prevent recurrence

For reconnect defects, hold a read across the disconnected gap and introduce a later change before rejoining. Recovery must read after the database listener becomes ready. Supabase channel `SUBSCRIBED` can precede that boundary; the provider owns recovery on the `postgres_changes` system-ready message. A read during the gap proves no coverage of later writes. The same-scope, post-invalidation reuse rule lives in `docs/technical/realtime-and-caching.md`.

Repair the smallest confirmed cause without weakening the promised behavior. Exercise the real failing boundary in the regression check. A test that simulates away the cause does not establish prevention.

Where practical, demonstrate that the check rejects the defect and passes the repair. Existing retained failure evidence may establish the rejected behavior. Do not spend another full browser run solely to recreate it.

Use the enforcement ladder from decision 0005: first remove the invalid state through a type or shared API, then add an automated check, then document a remaining judgment. State the prevention tier. If no suitable automated boundary exists, record why and the focused follow-up needed.

## 6. Verify the affected scope and close the investigation

Run the affected checks through the current test plan. Preserve valid unrelated group evidence. An unchanged failed group cannot be retried as acceptance except for the bounded environment-recovery path in `docs/technical/testing.md`: classify the environment cause, obtain matching retained diagnostic evidence, clean its owned world, and use the single permitted fresh retry. Two failures on the same inputs remain blocked until the underlying cause is resolved.

Before closing the finding, confirm:

- The repair addresses the original symptom and its real boundary.
- Appropriate regression evidence exists, with any limitations stated.
- Temporary instrumentation and throwaway prototypes are removed or clearly archived.
- The incident record names the cause, correction, affected proof, cleanup, and prevention tier.
- No required selected group is falsely reported green while failed, blocked, or too slow.

Do not restart all passing groups, enlarge a timeout, or reset attempt history to obtain a clean-looking report. The result can be a confirmed repair, a disproved hypothesis, or an unresolved observation with a precise next step. Report which conclusion the evidence supports.

Calendar save ownership is per operation: `beginMutation()` returns an idempotent release callback used in `finally`. A manual refresh or child success must never decrement another save. Check thrown transport failures as well as returned errors, and offer Undo only after confirmed persistence. Entries and correction metadata commit together through `completeCalendarEntryRead`; a missing badge read is a failed window, not ready data. The inner calendar scope includes organization, caller, and role, including auxiliary Parkplatz state.
