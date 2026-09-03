# P1-03 — Employee records and conditions

Status: closed (2026-08-05) — accepted P1-03 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Admin/Büro can maintain a stable employee/personnel identity with date-effective employment conditions without changing historical work/time meaning

## Direct dependencies

`P1-00`

## Primary and connected specs

Employee management; time; documents

## Acceptance evidence

Implemented 2026-08-05: migrations `add_employee_records_and_conditions` + `link_employee_record_on_invite_redemption` (org-scoped `employee_records` with nullable `user_id`, date-effective `employment_conditions` keyed by `valid_from`, append-only `employee_record_events`; manager-only SELECT RLS + service-role actions + org-validation triggers; membership-insert trigger + additive backfill from `joined_at`; `generate_personnel_number` `MA-NNN` suggestion; redemption RPC links a waiting record race-safely before the membership trigger). Owner-approved decisions executed: no compensation fields, inert weekly-hours/vacation-days storage for `P1-04`/`P1-06`, derived states `Aktiv`/`Geplant`/`Ausgeschieden` × `Mit Zugang`/`Eingeladen`/`Ohne Zugang`, destructive removal keeps the record as `Ausgeschieden`, no employee self-service. UI: Personalien/Beschäftigung/Verlauf sections on the member detail, personnel-only detail for non-members, `Weiteres Personal` section + `Personalakte anlegen`/`Zugang einladen` dialogs. Nothing recalculates or reinterprets existing time entries or jobs. Fixed in passing: `redeem-invite` Route Handler `updateTag` crash (`revalidateTag(tag,'max')`), string-state DatePicker `NaN` wedge (year padding in `toLocalDateString`). New golden spec `@P1-03` (8 checks) + full `GG-00`/`GG-01`/`@P1-01` rerun: 35/35 on a fresh production build ([golden-gate-log.md](../../golden-gate-log.md)). **Accepted `complete` 2026-08-05**: CodeRabbit review of the slice commit produced 13 findings — 12 fixed (one shared Europe/Berlin business-date helper replacing host-/UTC-local "today" in derived states, the conditions list filter, and the removal exit-date; org-scoped exit-date write; name-guard only rejects actual name changes on linked records; a replaced still-pending personnel invite is cancelled before connecting a new one so it cannot create a duplicate person on redemption; keyboard-accessible real links in the personnel list rows (both layouts); DatePicker gained `id`/`ariaLabel` so the Gültig-ab/Eintrittsdatum labels are properly associated; condition-actions trigger renamed to cover both actions; audit timestamps pinned to Europe/Berlin; spec asserts the migrated entry date equals the membership's Berlin join date; future-starter fixture uses a runtime next-year date), 1 skipped with reason (`revalidateTag(tag, 'max')` in the redeem-invite Route Handler: the installed Next 16 types accept profile strings, `'max'` is a built-in cache-life profile, and GG-00's invite test proves post-redemption freshness on a production build — `{ expire: 0 }` is an alternative form, not a correctness fix). Suite rerun after fixes: 35/35 on a fresh production build

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
