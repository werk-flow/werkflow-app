# P1-24 controlled people lifecycle implementation plan

Status: closed — implementation completed and accepted on 2026-09-02

## Outcome

Implement the owner-confirmed P1-24 contract around `employee_records.id`. Preserve the current application by default. Add explicit access and employment transitions, protected document metadata, bounded onboarding requirements, employee acknowledgements, handoff readiness, and retained history.

## Execution order

1. Add fixed domain vocabularies, pure projections, validation schemas, and unit tests.
2. Add the schema roots and immutable history in small committed migrations. Add tenant constraints, foreign-key indexes, grants, RLS, RPC boundaries, and checked SQL assertions in the same pass.
3. Replace membership-only authorization helpers with one effective organization-access helper. Preserve the no-lifecycle compatibility rule and the narrow pre-start self-service exception.
4. Apply each migration to DEV. Generate types from DEV. Run type, migration, Realtime, SQL, and advisor checks before applying the identical SQL to PROD.
5. Extend the existing document ticket, finalize, authorization, version, trash, and download paths with a protected personnel target. Keep ordinary employee links unchanged.
6. Add thin server actions for templates, plans, requirements, releases, acknowledgements, access transitions, employment transitions, and handoff previews.
7. Add manager sections to both linked and personnel-only detail pages. Add template management to employee settings and guided own actions to `/aufgaben`.
8. Add access-status routing for pre-start and suspended sessions. Keep `proxy.ts` as the coarse session check; enforce organization access in the app layout, every action, and RLS.
9. Add staged `@P1-24` and `@GG-07` Golden coverage, exhaustive `@AUDIT-W2-P1-24` coverage, read-only database assertions, and the `+125 … +129` fixtures.
10. Run statics, checked SQL, DEV parity, CodeRabbit review-fix-review passes, focused browser tests, and affected Wave 1 tags. Classify failures before reruns and clean every retained world.
11. Freeze source. Run the final focused audit, required P1-24 and GG-07 proof, complete local Golden battery, and rebuilt DEV canary.
12. Reconstruct the full campaign. Apply decision 0005 to every credible repeatable mistake. Add Tier 1 or Tier 2 prevention where practical; use Tier 3 only with a stated reason. Zero findings is acceptable.
13. Reconcile feature and technical documents, close the 66-flow ledger, update the gate and incident records, close the slice, commit, and publish only to `origin/partner-preview`.

## Verification boundaries

- Run local Supabase reset, checked SQL assertions, and `bun run test:unit` serially.
- Run only one browser battery at a time.
- A diagnostic run is not acceptance evidence.
- An application or Golden-code change after evidence starts invalidates the affected frozen evidence.
- A test-only audit repair reopens only the permitted audit proof unless it changes authorization or data integrity.

## Completion criteria

- All 66 accepted flows map to full clause evidence.
- DEV and PROD share the committed schema. Production retains every old row and every new P1-24 business table is empty immediately after rollout.
- Static checks, SQL assertions, focused proof, affected audits, complete local Golden, and rebuilt DEV canary pass on the required frozen sources.
- CodeRabbit findings are dispositioned.
- No retained world remains open.
- The slice record reports the closing campaign audit and every Tier 1, Tier 2, or Tier 3 prevention decision.
