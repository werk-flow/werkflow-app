# P1-04 — Work schedules and holiday context

Status: closed (2026-08-05) — accepted P1-04 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Authorized users can define date-effective work schedules and regional holiday/closure context; calendar capacity and time targets use them instead of a fixed eight-hour assumption

## Direct dependencies

`P1-03`

## Primary and connected specs

Employee management; calendar; time

## Acceptance evidence

Implemented 2026-08-05 (accepted `complete` the same day): migrations `add_work_schedules_and_holiday_context` + `fix_work_schedules_self_read_policy` (`work_schedules` weekly-pattern versions keyed by `valid_from` per employee record; `organization_closure_days` with today/future-only edits; `organization_settings.holiday_region` + effective-from history following `break_policy_history`; self-or-manager SELECT RLS via new `app_private.get_user_employee_record_ids`; Realtime publication + replica identity full for org-filtered DELETE events). Owner-approved decisions executed: in-code per-Bundesland holiday dataset (no external API; CI-tested against official lists), holiday/closure ⇒ day target 0 with region changes effective from selection, schedule wins over condition weekly hours with a non-blocking mismatch hint, **labeled display-time fallback cascade** for unconfigured members (schedule → derived → visibly labeled legacy 8h; nothing persisted, deploy-day numbers unchanged for all 25 existing members). One shared pure resolver (`resolveDailyTarget`, discriminated source) feeds every consumer: `/zeiterfassung` Tagesziel/ring/weekly chart with `Soll` sum, member-detail Tagesfortschritt + chart, member-list progress bars with unconfigured marker, and the calendar month view's labeled holiday/closure context (minimal deliberate consumption; capacity stays `P1-11`). Schedule changes audit into `employee_record_events`. Unit tests (`bun run test:unit`, 24) cover historical/holiday/fallback target math incl. official 2026/2027 holiday lists. New golden spec `@P1-04` (9 checks incl. real-credential RLS proof and org isolation) + full suite rerun: 44/44 on a fresh production build ([golden-gate-log.md](../../golden-gate-log.md)). The cycle surfaced and fixed a real RLS defect (self-read policy subquery on the manager-only `employee_records` ran under caller RLS). **Accepted `complete` 2026-08-05**: CodeRabbit review of the slice commit produced 17 findings — 9 fixed (stale-response generation guard in `use-weekly-time-data` so overlapping Realtime refetches cannot commit older results; failed target refetches keep the last-known targets instead of silently reverting to the fixed 8h split; `setHolidayRegion` appends onto the stored history from a direct DB read — a stale cross-request cache could have dropped history entries; explicit `load_failed` when the detail's conditions/schedules queries error instead of silently showing the labeled default; no-op rejection handler on the calendar prefetch's early-return path; holiday-aware weekly-Soll expectations in the golden spec via the same in-code dataset; shared `toDayMinuteColumns` mapping; defensive non-mutating ascending sort in `resolveHolidayRegionOnDate`; noon-UTC date construction replacing the fixed `+02:00` offset), 1 partially fixed (a fully distinct "targets unavailable" UI state for a failed *initial* target load was deliberately not built — the surface degrades to the pre-P1-04 legacy display without a percentage claim, because blanking the primary time surface on a rare authorized-action failure would be worse; the transient-failure path is covered by keep-last-known), 7 skipped with recorded reasons (harness error messages naming the synthetic `@werkflow-golden.test` fixture follow the existing `db.ts` helper pattern; three single-letter identifier renames match the sibling conditions section and established spec style; a Berlin-midnight refresh timer for server-rendered "today" targets is the same pre-existing class as P1-03's derived state badges — surfaces refresh via navigation/Realtime/visibility, noted as polish follow-up; the deprecated `z.string().datetime()` form mirrors the existing `break_policy_history` schema in the same domain; `getWeekdayIndex` input validation would add a throw path to display surfaces although all inputs are internally generated ISO dates). Suite rerun after fixes: 44/44 on a fresh production build

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
