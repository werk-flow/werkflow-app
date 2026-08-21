# Wave-Audit Battery

Exhaustive user-flow audit specs, separate from the golden-gate suite. Protocols, ledgers, and conventions live in the wave audit docs — `docs/plans/wave-1-audit.md` (closed) and `docs/plans/wave-2-audit.md` (per-slice model) — plus testing rules 12–13. Read those before touching anything here.

Quick facts:

- One config (`playwright.audit.config.ts`) covers all of `tests/audit/`. Run `bun run test:audit:w1` / `test:audit:w2` for one wave, `bun run test:audit` for everything, `--grep @AUDIT-W2-P1-13` for one slice. The default `bun run test:golden` never picks these specs up, and the audit battery never runs golden specs.
- The battery reuses the golden harness (`tests/golden/support/*`: world seeder, steps, db helpers, fixtures) via relative imports. One disposable world per invocation; specs run serially in path order (`wave-1/a1-…` … `wave-2/p1-13…`).
- **Never run the audit battery and the golden suite at the same time.** Both share `tests/golden/.artifacts` and each global setup destroys "leftover" worlds — a concurrent run clobbers the other.
- Fixture dates: Wave 1 owns run-day offsets **+20 … +69** (partitioned per session in its doc); Wave 2 slices own **+70 onward** (five days per slice, assigned in its doc). Golden specs own the lower offsets documented in `docs/technical/testing.md`. Never reuse another owner's dates — a no-grep run executes every wave in ONE shared world.
- Test cardinality is unrelated to catalog cardinality: one test may assert many flow IDs and one flow ID may span tests. The ledger must map every ID owned by the session/slice, and a mapping counts only when the actual bodies assert every observable clause of that catalog bullet (rule 12). Assert persisted state, never the optimistic echo (rule 13).
- Since Wave 2, each slice ships its own spec here (`wave-2/p1-XX.spec.ts`) as part of slice acceptance; there are no wave-end discovery sessions anymore.
