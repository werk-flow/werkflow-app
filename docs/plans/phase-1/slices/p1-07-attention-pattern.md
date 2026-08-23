# P1-07 — Attention pattern

Status: complete (accepted 2026-08-07)

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

WerkFlow provides one role-aware task, approval, notification, failure, and exception pattern first used by requests and leave instead of separate inboxes per feature

## Direct dependencies

`P1-02`, `P1-05`, `P1-06`

## Primary and connected specs

AI foundations; employee; CRM; time; jobs

## Acceptance evidence

Implemented and accepted 2026-08-07. Migration `add_attention_pattern_state`: attention ITEMS are derived live by one server-side resolver (`lib/attention/`) from the owning domains — pending time sessions/change requests and pending vacation requests through the owning loaders' action-time responsibility resolution (attention follows P1-05 delegation and ends with it), open client requests with `assigned_to` surfaced as the ownership signal plus derived age (no new due-date storage; follow-ups stay `P1-10` and enter the pattern as a new item type) — deduplicated per viewer on the `source_type`+`source_id` identity. The ONLY new storage: strictly self-scoped `attention_read_states` (opaque state versions; approve → cancel re-surfaces the SAME notification unread) and append-only self-or-manager `attention_events`, both org-validated, Realtime-published, replica identity full. New role-aware `/aufgaben` surface (Aufgaben/Benachrichtigungen/Meine Anträge) with deep links; decisions run exclusively through the owning actions. Unified badge pipeline replaces the time-only count; badges never count an item the viewer cannot act on; notifications are in-app, quiet by default, no reminders/escalation/preferences (deferred: preference matrix to real usage, external delivery `P1-46`). Deploy-day: zero new rows for real organizations, existing surfaces unchanged. Fixed in passing: the request dialogs' „Zuständig" selects had been silently empty since P1-02 (PostgREST embed without FK path in `getManagerAssigneeOptions`). Unit suite 78/78 (17 new pattern-rule tests); new `GG-02` gate spec (7 checks, sorts last, dual-mode focused/full, runtime-derived count expectations); pre-review full suite 63/63. **Accepted `complete` 2026-08-07**: CodeRabbit review of slice commit `8d44d91` produced 14 findings — 11 fixed (batched mark-all writes with ownership established once by derivation; notification query bounded to the 60-day window at the database with explicit columns; DST-safe UTC window boundary; org-switch zero-reset + pending-debounce cleanup in the count provider; shared 150ms debounce for the surface's eight Realtime triggers; plural bulk-action error copy; sidebar/tab badge screen-reader labels with aria-hidden numbers; min-width badge sizing for multi-digit counts; `data-testid` badge locator; explicit badge assertion timeouts), 3 skipped with reasons: (1) server-side initial overview for `/aufgaben` would run the full derivation twice per navigation (the layout already server-seeds the counts) for a skeleton that lasts one round trip, and the surface deliberately follows the approver-section client-fetch pattern — noted as polish follow-up; (2) threading `activeOrgId` into the layout's `getAttentionCounts` call is redundant because both reads resolve the same request's cookie deterministically, so a divergent organization is impossible within one request; (3) the weekly-Soll divisibility guard follows the established `@P1-06` spec convention — fractional target formatting is unit-tested, and mirroring the UI's display format in the spec would couple the acceptance test to display internals. Post-review confirmation: focused `@GG-02` 7/7 and full suite 63/63 on a fresh production build (gate log). Sickness items (`P1-08`), qualification warnings (`P1-09`), follow-up objects (`P1-10`), dispatch acknowledgements (`P1-12`), the complete correction workflow (`P1-22`), and external delivery (`P1-46`) extend the taxonomy in their owning slices.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
