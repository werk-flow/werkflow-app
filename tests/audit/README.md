# Wave-Audit Battery

Exhaustive user-flow audit specs, separate from the golden-gate suite. The harness rules, run lanes and failure handling live in [docs/technical/testing.md](../../docs/technical/testing.md). The Wave 2 coverage ledger lives in [wave-2-audit.md](../../docs/plans/phase-1/audits/wave-2-audit.md), and `lib/testing/selection/coverage-map.json` maps every catalog flow to its evidence. Read those before touching anything here.

Audit-specific facts:

- `playwright.audit.config.ts` covers all of `tests/audit/`. Wave 1 specs live in `wave-1/`, Wave 2 specs are `wave-2/p1-NN.spec.ts` tagged `@AUDIT-W2-P1-NN` plus `@AUDIT-W2`. Each spec file owns its own disposable world, and every test inside it prepares its own state ([decision 0007](../../docs/decisions/0007-independent-test-groups.md)). `lib/testing/selection/test-groups.ts` registers each file as a group. Select one group: `bun run test:verify --group audit:wave-2:p1-23`. The `test:audit:focused --grep` lane still exists but is not the acceptance workflow.
- The battery reuses the golden harness (`tests/golden/support/*`) via relative imports. Shared business steps go into `tests/golden/support/steps/`; audit-only helpers live in `tests/audit/support/`.
- Fixture dates go through `ownedBerlinDateAtOffset()` in `tests/golden/support/date-ownership.ts`. Its registry owns each spec's window and throws on a claim outside it.
- Test count is unrelated to catalog flow count. A mapping counts only when the assertion bodies evidence every clause of the catalog bullet, and success assertions read persisted state ([testing.md](../../docs/technical/testing.md)).
- Since Wave 2, each slice ships its own spec here as part of slice acceptance.
