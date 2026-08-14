# Wave-Audit Battery

Exhaustive user-flow audit specs, separate from the golden-gate suite. The protocol, session plan, coverage ledger, and all conventions live in `docs/plans/wave-1-audit.md` — read that before touching anything here.

Quick facts:

- Run with `bun run test:audit:w1` (config: `playwright.audit.config.ts`). The default `bun run test:golden` never picks these specs up, and the audit battery never runs golden specs.
- The battery reuses the golden harness (`tests/golden/support/*`: world seeder, steps, db helpers, fixtures) via relative imports. One disposable world per battery run; specs run serially in filename order (`a1-…`, `a2-…`, …).
- **Never run the audit battery and the golden suite at the same time.** Both share `tests/golden/.artifacts` and each global setup destroys "leftover" worlds — a concurrent run clobbers the other.
- Fixture dates: audit sessions own run-day offsets **+20 through +69** (partitioned per session in the audit doc). Golden specs own the lower offsets documented in `docs/technical/testing.md`; never reuse their dates here, and never reuse another session's partition.
