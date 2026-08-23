# P1-00 — Baseline lock

Status: complete (accepted 2026-08-04)

This record is the canonical home for the slice's acceptance facts, moved verbatim from the former roadmap index row on 2026-08-24. The current slice index lives in [../roadmap.md](../roadmap.md); process rules in [../protocol.md](../protocol.md).

## Bounded outcome

Lock the documentation baseline, verify every current feature baseline against code/generated types/live Supabase, establish regression coverage, and record the first accepted implementation checkpoint. Includes the infrastructure hygiene items from [decision 0001](../../../decisions/0001-infrastructure-stack.md): regenerate stale Supabase types, reconcile Realtime subscriptions with published tables, verify/pin the Vercel Frankfurt region

## Direct dependencies

None

## Primary and connected specs

All feature specs; technical architecture/data model

## Acceptance evidence

Findings and resolutions in [`p1-00-baseline-verification.md`](../../p1-00-baseline-verification.md): types verified in sync; 10 missing Realtime publication tables added; Vercel region pinned to `fra1` via `vercel.json`. Regression coverage exists: `GG-00` automated v3 passes 13/13 on a fresh production build (2026-08-04), covering the complete baseline scenario including invites/onboarding and inventory take/return. **Accepted `complete` 2026-08-04**: owner confirmed Frankfurt (`fra1`) on the latest deployment

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
- Baseline verification report: [p1-00-baseline-verification.md](../../p1-00-baseline-verification.md)
