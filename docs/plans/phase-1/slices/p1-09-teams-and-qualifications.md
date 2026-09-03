# P1-09 — Teams and qualifications

Status: closed (2026-08-09) — accepted P1-09 acceptance record; canonical home for the slice's evidence

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Authorized users can maintain teams, skills, certifications, validity, evidence, and operational eligibility; planning can explain qualification coverage

## Direct dependencies

`P1-03`, `P1-05`

## Primary and connected specs

Employee management; calendar; jobs; documents

## Acceptance evidence

Implemented on 2026-08-08 across live schema, server actions, resolver, RLS/Realtime/cache, employee/manager/job/calendar UI, expiry attention, audit, generated types, unit tests, and six-test golden spec. Teams are date-effective assignment convenience only; the organization vocabulary distinguishes skills/certifications; employees see only self; admin/Büro maintain records; apprentice warning is admin-only/default-off; every assignment path re-evaluates and uses a fingerprinted reasoned override. Three CodeRabbit passes were dispositioned: actionable authorization, bounds, atomicity, stale-state, accessibility, query-scope, and harness findings were fixed; the claimed missing RPC membership validation was rejected with live SQL evidence because the service-role-only RPC validates every selected active organization member. Green evidence: diff check, TypeScript, full lint, build, 105/105 unit, `@GG-02` 8/8, `@P1-09` 6/6 (including post-race-fix and inherited-state runs). The one final full run passed 73/76 before the P1-09 apprentice test hit a duplicate `employment_conditions.valid_from` owned by earlier slices; 75–76 did not run. Harness fixed at `333ea33`; no second full run was performed under the one-run rule, so formal `complete` was pending one green 76/76 confirmation. **Accepted `complete` 2026-08-09**: the post-fix confirmation run passed 76/76 on the unchanged accepted build (world `msm2c4zr`, 15.2m). Two earlier same-day attempts each lost one *old* test (a `@P1-06` and a `@GG-02` dialog interaction) to 90s-test-budget timeouts under an environment running ~60% slower than every prior cycle (first-ever Sunday run; cause undetermined — OneDrive was later ruled out, it does not sync this workspace) — both classified environment/latency after focused runs passed at normal speed (`@P1-06` 6/6 in 2.6m); no code changed between the three attempts. Verified independently at acceptance: all nine new tables use `app_private` SECURITY DEFINER RLS with no embedded-subquery regression, operational tables published with replica identity full, audit tables unpublished, the responsibility enum unchanged, zero rows for all real organizations (deploy-day neutrality), and the assignment paths run the action-time qualification assessment through the atomic assignment+assessment RPC.

## Known consequences (recorded 2026-09-03)

- „Intern bestätigt" on a qualification is an operational fact recorded by a manager, not a legal or certifying claim; WerkFlow ships no default skill or certification catalog, every organization curates its own.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
