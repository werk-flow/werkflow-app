# P1-08 — Sickness

Status: closed (2026-08-08) — accepted P1-08 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Employees can report sickness/privacy-sensitive absence; authorized users manage evidence and operational availability without exposing diagnosis or unnecessary detail

## Direct dependencies

`P1-04`, `P1-05`, `P1-07`

## Primary and connected specs

Employee management; time; calendar; documents

## Acceptance evidence

Implemented and accepted 2026-08-08. Migrations `add_sickness_reports` + `extend_attention_taxonomy_sickness`: org-scoped `sickness_reports` keyed to `employee_record_id` as a REPORTED FACT (`reported` → `cancelled` with reason when cancelling someone else's; corrections in between audited in append-only `sickness_report_events` with before/after), open-ended (`end_date` null, „bis auf Weiteres") and retroactive entry first-class, gist exclusion against overlapping own ACTIVE sickness only (sickness during approved vacation stays recordable with NO automatic balance effect — the explicit vacation-cancellation path remains the correction tool, surfaced as a neutral overlap hint requiring acknowledgment), neutral type vocabulary (`krankheit`/`kind_krank`/`sonstige`), **no diagnosis field anywhere**, self-or-manager RLS via `app_private` helpers, service-role writes, Realtime + replica identity full. Owner-approved decisions executed: privacy matrix as layered disclosure (availability facts flow to targets/calendar/planning; type + evidence state only on self and admin/Büro surfaces; shared calendar strictly „Abwesend – Name"; colleagues see nothing — enforced via RLS, derivation-time audience scoping, and type-free calendar payloads); evidence as tracked per-report STATE without file bytes (`evidence_required` as explicit office choice presented neutrally, `pending`/`received`; files deferred to `P1-24` because today's document RLS would invert the required visibility); authority = fixed manager role at action time (no `leave_approval` reuse, no vocabulary extension — deferred as an open decision); self-report AND office entry for the phone-call-in reality, with the person able to end/cancel their own report; clock-in on a sick day WARNS visibly instead of blocking; attention taxonomy grew by version-keyed two-audience `sickness_report` notices (corrections re-surface the same item unread, evidence bookkeeping never does); hour-based absence re-deferred. Deploy-day: zero new rows, all surfaces unchanged for organizations that never record sickness. Unit suite 92/92 (13+1 new); new golden spec `@P1-08` (6 checks, sorts last, dual-mode, runtime-computed expectations incl. the mode-dependent overlap hint); pre-review full suite **69/69** = the required `GG-02` rerun (gate log). The first full run surfaced a latent weekend-blind `@P1-04` harness assertion (first-ever Saturday run; fixed with resolver-computed expectations) and hit the documented `@P1-01` borderline-latency transient once. **Accepted `complete` 2026-08-08**: CodeRabbit review of slice commit `bd6c656` produced 14 findings — 11 fixed (incl. one real target-math defect: a half-day vacation overlapping a full-day sickness previously kept a half target — any full-day span now wins coverage, regression-unit-tested; plus acknowledged overlap hint replacing an auto-close timer race, record-scoped span loading, bounded/ordered manager notification query, manual-calendar-refresh absence refetch, visible disabled-button hint, centralized error copy, dialog field ordering, production-shape test fixture, spec date snapshotting), 3 skipped with reasons: (1) the clock FAB step locators follow the established harness convention shared with `clockInOnJob`/`clockOut`/`expectClockInBlockedByVacation` — harmonizing all clock steps is a separate cleanup; (2) the weekly-Soll divisibility guard is the established `@P1-06`/`@GG-02` spec convention, defended identically in the P1-07 disposition (fractional formatting is unit-tested; mirroring display internals would couple the acceptance test to them); (3) the purple „Aktiv" badge follows the slice contract itself — purple is the planning-context hue for absence, and semantic status colors would be alarm styling on a health surface. Post-review confirmation: focused `@P1-08` 6/6 and full suite **69/69** on a fresh production build (gate log). Capacity planning (`P1-11`), correction workflow (`P1-22`), paid/unpaid classification (`P1-23`), personnel-document privacy tiers (`P1-24`), offboarding (`P1-33`), and external delivery (`P1-46`) stay in their owning slices.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
