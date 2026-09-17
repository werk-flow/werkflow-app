# Wave-Audit Battery

Exhaustive user-flow audit specs, separate from the golden-gate suite. The harness rules, run lanes, budgets, and failure handling live in [docs/technical/testing.md](../../docs/technical/testing.md). The coverage ledgers live in [wave-1-audit.md](../../docs/plans/phase-1/audits/wave-1-audit.md) (closed) and [wave-2-audit.md](../../docs/plans/phase-1/audits/wave-2-audit.md). Read those before touching anything here.

Audit-specific facts:

- `playwright.audit.config.ts` covers all of `tests/audit/`. Wave 1 specs are `wave-1/a<N>-<topic>.spec.ts` tagged `@AUDIT-W1-A<N>`. Wave 2 specs are `wave-2/p1-NN.spec.ts` tagged `@AUDIT-W2-P1-NN` plus `@AUDIT-W2`. Each spec file owns its own disposable world; the stages inside one file stay serial ([decision 0007](../../docs/decisions/0007-independent-test-groups.md)). Select one file as a group: `bun run test:verify --group audit:wave-2:p1-23`. The legacy `test:audit:focused --grep` lane still exists but is not the acceptance workflow.
- The battery reuses the golden harness (`tests/golden/support/*`) via relative imports. Shared business steps go into `tests/golden/support/steps.ts`; audit-only helpers live in `tests/audit/support/`.
- Fixture dates go through `ownedBerlinDateAtOffset()` in `tests/golden/support/date-ownership.ts`. Wave 1 owns run-day offsets +20 through +69, Wave 2 slices own +70 onward in five-day blocks, and the registry throws on a claim outside the spec's window.
- Test count is unrelated to catalog flow count. A mapping counts only when the assertion bodies evidence every clause of the catalog bullet (testing rule 12), and success assertions read persisted state (rule 13).
- Since Wave 2, each slice ships its own spec here as part of slice acceptance and records its left-behind state in the wave audit doc.
