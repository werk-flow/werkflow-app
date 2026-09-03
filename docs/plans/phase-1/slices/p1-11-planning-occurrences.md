# P1-11 — Planning occurrences

Status: closed (2026-08-13) — accepted P1-11 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Planners can create recurring, multi-day, and multi-visit work/internal entries using employee schedules, absence, skills, teams, and capacity with understandable series exceptions

## Direct dependencies

`P1-04`, `P1-06`, `P1-08`, `P1-09`

## Primary and connected specs

Calendar; employee; jobs; service

## Acceptance evidence

Implemented and accepted 2026-08-13. Live migrations add stable materialized series/occurrence identity, occurrence assignments/assessments/events, atomic one/this-and-future/series/status/horizon/team operations, legacy-job projection/bridge, and organization-scoped retry-safe creation keys. Admin/Büro can plan bounded job visits or internal entries across one-off, recurring, cross-midnight, all-day, multi-day, and multi-visit shapes; employees see only assigned occurrences. Capacity combines schedules/fallbacks, holidays/closures, approved and provisional absence, overlap, teams, and qualifications into attributable fingerprinted warnings; explicit overrides require a reason. Planned work never creates actual time. Preflight migration `harden_number_generator_function_grants` removed anonymous/authenticated execution from two service-only generators. Three complete CodeRabbit passes (41, 28, 39 findings) were dispositioned; all critical findings and valid correctness/security/accessibility/harness findings were fixed, with deliberate skips limited to already-enforced live constraints, bounded visible-failure behavior, and out-of-slice scale/polish. Final evidence: diff check, TypeScript, lint, optimized production build, 156/156 unit, focused `@P1-11` 5/5 (world `msrfhl2p`, 6.4m), final production suite 87/87 (world `msrn5jkq`, 22.0m), all worlds destroyed; live Security Advisor shows only the documented Free Plan leaked-password exception.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
