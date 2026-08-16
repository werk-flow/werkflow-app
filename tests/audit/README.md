# Wave-Audit Battery

Exhaustive user-flow audit specs, separate from the golden-gate suite. The protocol, session plan, stable catalog-ID coverage ledger, and all conventions live in `docs/plans/wave-1-audit.md` — read that and testing rule 12 before touching anything here.

Quick facts:

- Run with `bun run test:audit:w1` (config: `playwright.audit.config.ts`). The default `bun run test:golden` never picks these specs up, and the audit battery never runs golden specs.
- The battery reuses the golden harness (`tests/golden/support/*`: world seeder, steps, db helpers, fixtures) via relative imports. One disposable world per battery run; specs run serially in filename order (`a1-…`, `a2-…`, …).
- **Never run the audit battery and the golden suite at the same time.** Both share `tests/golden/.artifacts` and each global setup destroys "leftover" worlds — a concurrent run clobbers the other.
- Fixture dates: audit sessions own run-day offsets **+20 through +69** (partitioned per session in the audit doc). Golden specs own the lower offsets documented in `docs/technical/testing.md`; never reuse their dates here, and never reuse another session's partition.
- Test cardinality is unrelated to catalog cardinality: one test may assert many flow IDs and one flow ID may span tests. The ledger must map every ID owned by the session, and a mapping counts only when the actual bodies assert every observable clause of that catalog bullet. Never round partial coverage up from a title/helper or replace Playwright with a convenient manual check.
- R1 repairs A1–A4 coverage in the original spec files/tags and uses +65 … +69 for any new uniqueness-constrained fixtures. Do not create a last-sorting reconciliation spec or move historical coverage into A5.
