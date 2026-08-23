# P1-06 — Vacation

Status: complete (accepted 2026-08-06)

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Employees can request/withdraw vacation; authorized approvers can decide it; approved absence updates entitlement, availability, calendar conflicts, target time, and history consistently

## Direct dependencies

`P1-04`, `P1-05`

## Primary and connected specs

Employee management; calendar; time

## Acceptance evidence

Implemented and accepted 2026-08-06. Migrations `add_vacation_requests` + `fix_vacation_request_events_self_read_policy`: org-scoped `vacation_requests` keyed to `employee_record_id` (5-state lifecycle `pending`→`approved`|`rejected`|`withdrawn`, approver-only `cancelled` from `approved` with required reason as the retroactive-correction path; gist exclusion constraint blocks overlapping own active requests race-safely; half days for single-day requests), append-only `vacation_request_events`, self-or-manager RLS via `app_private` helpers, service-role writes, Realtime publication + replica identity full. Entitlement = `vacation_days_per_year` of the newest condition of the calendar year (first consumer of the inert P1-03 storage); consumption derives from positive resolved base targets (weekends/holidays/closures/schedule-free days free; labeled `default` source counts Mo–Fr) and is snapshotted per year at approval so configuration changes never rewrite decided balances; carryover/adjustments/hour-based absence explicitly deferred. Missing entitlement stays the labeled „Kein Urlaubsanspruch hinterlegt" exception (the static „9 von 30" fiction is gone; deploy-day orgs see the honest empty state and nothing else changes); requests and visibly warned approvals remain possible. Approval consumes `leave_approval` exclusively via the P1-05 action-time helpers (four eyes: own requests never appear in one's queue); approved absence extends `resolveDailyTarget` with discriminated absence info feeding dashboard/Soll/member surfaces; calendar shows labeled purple entries with pending „(angefragt)" dashed-distinct; clock-in on an approved full-day is denied at the action. Unit suite 61/61; new golden spec `@P1-06` (6 checks incl. runtime-computed day arithmetic from the app's own stored state, stale-authority denial on a frozen page, real-credential RLS, org isolation); pre-review full suite 56/56 on a fresh production build. Two real defects found and fixed by the cycle: the approver surface unmounted its open decision dialog/error on background refreshes, and a clock-skew window let a freshly revoked responsibility holder stay authorized (action time now floored to the newest configuration's database timestamp). CodeRabbit review of slice commit `db1162f`: 23 findings — 20 fixed (runtime decision-value guard that could have taken the reject branch without a reason, request-range bound with German error, memoized/batched approver-queue loading, shared target-map helper, org-scope filters on service-role context reads, bounded calendar window, org-switch reset + error handling for calendar vacation entries, pending-entry dashed border surviving the daygrid border reset, dynamic import, visible failed-load state, per-item aria-labels, clock-banner `role="alert"`, parallelized clock-in vacation check, snapshot-sum helper reuse, typed cache tag, test additions/cleanups), 3 skipped with reasons: (1) a settle-wait before the four-eyes negative assertion is unnecessary because the server-side filter makes the asserted absence time-invariant and the spec pairs it with the admin-side positive check; (2) re-resolving entitlement/balance for approved cancellation cards would query for data the card deliberately does not render; (3) a range clamp inside the pure counting layer is unreachable because the insert boundary bounds every persisted row. Post-review confirmation: focused `@P1-06` 6/6 and full suite 56/56 on a fresh production build (`docs/plans/golden-gate-log.md`). Inbox/notifications (P1-07), sickness (P1-08), capacity/conflict engine (P1-11), time accounts (P1-23), and offboarding effects (P1-33) stay in their owning slices.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
