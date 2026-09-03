# P1-20 — Maintenance plans and operational coverage

Status: closed (2026-08-31) — accepted P1-20 acceptance record; canonical home for the slice's evidence

## Outcome

Admin and Büro can define service-owned maintenance plans and operational coverage for one customer site and a bounded set of exact installed-equipment records. Plans generate stable due work before a job exists. A manager deliberately creates and schedules each normal visit job, while existing planning, work-template, execution, evidence, equipment-history, document, follow-up and reactive-service owners retain their facts.

## Confirmed contract

- A plan belongs to one customer and site. Each immutable revision covers one or more exact P1-18 equipment records at that site and references exactly one published P1-13 work-template version.
- Components may have independent plans. Overlapping active coverage needs an explicit reason instead of a hard uniqueness ban.
- Operational coverage is a separate service record. It stores only entered operational dates, an internal review date, status, notes and an exact document link. Commercial and legal contract truth remains outside P1-20.
- Plan states are `draft`, `active`, `suspended` and `terminated`. Archiving changes visibility only after termination.
- Due work is service-owned and exists before a job. Its states are `open`, `visit_created`, `completed`, `skipped`, `cancelled` and `superseded`; completion outcome is separately `complete`, `partial` or `unresolved`.
- Activation generates an understandable 18-month horizon. Normal reads never generate data. Creation, revision, resumption, completion and explicit extension may advance the horizon idempotently.
- Every revision chooses `planned_due_date` or `actual_completion_date` as its next-due basis. Missing or contradictory next-due facts remain a visible exception.
- A maintenance visit is a normal job with the revision's exact template version. Its calendar entry is created only when a manager schedules it. Moving one appointment does not alter the maintenance sequence.
- Several compatible due-work identities may share one job and occurrence. Their identities and histories remain separate.
- P1-14 owns execution gates. P1-15 owns exact work-report, measurement and other artifact revisions. P1-18 owns equipment history. P1-19 owns any reactive follow-up case. P1-10 owns assigned follow-ups and attention projection.
- Employees receive only compact context for an exact assigned visit job. Coverage dates, renewal risk, internal notes and unrelated equipment history remain manager-only.
- Mutable coverage, plan and due-work roots are the only new Realtime sources. Immutable revisions, links and events remain unpublished.
- The rollout is additive, DEV first and PROD second. It performs no backfill and creates no inferred business rows.

## Test and rollout contract

- Golden: `tests/golden/p1-20.spec.ts`, tagged `@P1-20`, `@GG-06` and persisted stage tags.
- Wave 2 audit: `tests/audit/wave-2/p1-20.spec.ts`, tagged `@AUDIT-W2-P1-20` and `@AUDIT-W2`, covering confirmed flows `P1-20-F01` through `P1-20-F105`.
- Fixture dates: offsets `+105 ... +109` at 06:00 Europe/Berlin.
- Affected Wave 1 tags: A1, A2, A5, A6 and A7.
- No canary spec change is planned. The existing nine-test DEV canary remains required.
- CodeRabbit reviews cover the schema/domain, connected UI and tests/documentation before the final freeze.

## Acceptance evidence

- All 105 confirmed flows are mapped and fully evidenced by the five-stage exhaustive audit in `tests/audit/wave-2/p1-20.spec.ts`; final run `2026-08-31T064002382Z-3d7799` passed 5/5 on fingerprint `b800a297…ef4` and build `OJOT4v0PM4TU7q-tmi9Xn`.
- The six-stage Golden journey passed inside the complete 128/128 local Golden certification (`2026-08-31T061323613Z-83b7ba`, world `mtgue6u0`) on the same fingerprint and build. Focused compatibility proofs passed for P1-03/P1-04 (17/17), P1-11 (5/5), P1-16 (3/3), P1-20 (6/6), GG-00 (13/13), and affected Wave 1 A5 (4/4 after confirmed local CDC readiness).
- The DEV cloud canary passed 9/9 (`2026-08-31T064541368Z-d534fc`, world `mtgvjpyf`, build `Gm8W6eilFU3iGH5iw3i5R`) on the same source fingerprint. The final run inventory contained zero open retained worlds.
- Fourteen additive migrations reached DEV first and PROD second from the committed files. The guarded ledgers match the committed versions. Production retained 5 organizations, 13 customers, 1 site, 40 jobs, 14 projects, 43 documents and 23 document links; all ten new maintenance tables and both connected owner projections contained zero inferred rows.
- Local, DEV and PROD publish the same 78 Realtime tables: 75 use exact `(id, organization_id)` index identity, the three recorded exceptions use DEFAULT, none use FULL, and INSERT/UPDATE/DELETE are enabled. P1-20 adds only the three mutable maintenance roots.
- Production's security advisor introduced no P1-20 finding. The two remaining warnings concern the pre-existing `set_job_assignment_organization` function. A post-rollout performance pass found six root composite foreign keys whose query indexes had the wrong leading order; migration `20260831090000_cover_p1_20_root_foreign_keys.sql` removed all six notices DEV-first and PROD-second. Unused-index notices are expected while the additive tables contain no rows.
- Three CodeRabbit CLI passes reported 29, 26 and 20 findings. Every valid major/minor finding was fixed; rejected findings were checked against the confirmed boundary and existing repository conventions, with no unresolved review issue.
- Final static proof: TypeScript, lint, documentation checks, migration checks, generated-type checks and diff checks passed; the unit suite passed 418/418 across 40 files.

## Post-implementation campaign audit

The review inspected the runner manifests, retained-world diagnostics, focused recoveries, final certifications, CodeRabbit passes and both remote rollouts. Reusable failures were pushed into code or checks rather than left as advice:

- Tier 1: shared calendar date shifting now clamps month-end dates; the month read boundary covers the complete visible six-week grid; contextual upload targets and stable database operation identities make omitted ownership and conflicting retries unwritable; migration triggers, locks and compare-and-swap rules preserve plan, visit, evidence and completion invariants; the runner rejects a fresh P1-04 selection that omits its P1-03 producer chain.
- Tier 2: unit tests pin month shifting, visible-grid ranges, run-policy selection and validation boundaries. Shared browser helpers now scope contextual uploads, primary-month calendar cells, sign-out retries and semantic regions. Persisted audit stages inspect existing exact links before replay, and the focused/Golden/audit suites assert the resulting database facts. The production-advisor finding is closed by a committed FK-index migration and remote advisor verification.
- Tier 3: after a full local Supabase cold start, event-sensitive browser tests wait until the Realtime container log confirms its tenant replication stream is ready. The public health endpoint became green about 70 seconds before CDC was usable in the closing A5 proof; repository preflight cannot observe that container-internal transition without host-specific Docker access. The final A5 retry passed 4/4 (`2026-08-31T072318050Z-ed6f36`) once readiness was confirmed.

The detailed run-to-prevention mapping is recorded in [test-incident-log.md](../../../technical/test-incident-log.md).

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
