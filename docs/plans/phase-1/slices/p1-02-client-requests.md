# P1-02 — Client requests

Status: closed (2026-08-05) — accepted P1-02 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Admin/Büro can capture an operational request and deliberately convert it into a job/project without re-entering customer, contact, site, summary, urgency, attachments, or commitments

## Direct dependencies

`P1-00a`, `P1-01`

## Primary and connected specs

Customers/CRM; jobs; calendar; documents

## Acceptance evidence

Implemented 2026-08-05: migrations `add_client_requests` + `add_generate_request_number` (tables `client_requests`/`client_request_events` with manager-only SELECT RLS, org/client validation triggers, once-only conversion CHECKs + unique partial indexes, Realtime publication; `document_links` widened to a fifth exactly-one `request_id` target). Owner-approved decisions executed: 4-state lifecycle (`offen`→`in_klaerung`→`umgewandelt`|`geschlossen` + reason + manager reopen), SHK category/urgency/source vocabularies, attachments over the existing R2 ticket flow, sidebar `Anfragen` above `Aufträge`, conversion requires a resolved customer (match or inline-create). Conversion is race-safe (compare-and-set + DB backstop), attributable, and copies nothing — attachments gain a second link; work links back to its origin. Unknown callers captured with provisional identity, matched or promoted without retyping. Direct work creation unchanged. New `GG-01` spec + `GG-00`/`@P1-01` rerun: 27/27 on a fresh production build ([golden-gate-log.md](../../golden-gate-log.md)); the cycle surfaced and fixed a real defect (async number suggestion overwrote typed numbers). **Accepted `complete` 2026-08-05**: CodeRabbit review of the slice commit produced 28 findings — 15 fixed (Realtime refreshes no longer reset open dialog edits via `request.id`-keyed prefill effects, org scoping on all related service-role lookups, direct-`/anfragen/[requestId]` negative tests for employee/outsider, `receivedAt` boundary validation, specific `request_not_editable` close error, rollback-delete error logging, discriminated conversion result, shared `formatProfileName`/assignee helper, static German load-error copy instead of raw `error.message`, plain-text fallback when a converted project has no number, `role="alert"` on dialog errors, keyboard-accessible list links, harness guard + suggested-number wait), 13 skipped with recorded reasons (German test titles, `Record<string, unknown>` payloads, dialog autofocus prevention, per-call date formatters, disabled-submit validation, and empty-list fallbacks all match established repo patterns; duplicate-conversion assertions already target the authoritative request row backed by CAS + unique partial indexes; converted-id dedupe is dead code under those indexes; harness DB helpers follow the untyped-service-client pattern; per-action spinners cosmetic under the deliberate single-transition lock; client-side trimming redundant to server normalization; `ClientSelectWithCreate` lacks an id pass-through — component-level follow-up). Suite rerun after fixes: 27/27 on a fresh production build, incl. the new direct-URL checks

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
