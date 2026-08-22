# Wave 2 Flow Audit (per-slice model)

Wave 2 audits work differently from Wave 1: **every slice ships its own exhaustive flow coverage as part of slice acceptance.** There are no wave-end discovery sessions. This document is the wave's coverage ledger and the certification-gate record; the process rules live in the roadmap's execution protocol and testing rules 12–13.

## Why the model changed (decision, 2026-08-21)

Wave 1 enumerated and tested catalog flows after all twelve slices were done. That worked, but the retroactive R1 reconciliation (four extra sessions repairing A1–A4 coverage) was the direct cost of enumerating flows after the fact, and defects surfaced weeks after the context that produced them was gone. From Wave 2 on, the flow inventory is part of the slice itself:

1. **Pre-implementation:** the slice's numbered report proposes the complete user-flow list as German catalog bullets with provisional `P1-XX-FNN` IDs. The owner confirms product design and flow inventory in one gate. Flows discovered during implementation are added; the catalog is finalized at acceptance.
2. **Acceptance:** the slice ships a rule-12 audit spec in `tests/audit/wave-2/` mapping **all** of its flow IDs with full clause evidence, closes its ledger rows below with the `X/X mapped; X/X fully evidenced; 0 partial; 0 unmapped` invariant, and runs the focused audit spec green in the normal acceptance ladder (alongside statics, the focused golden spec, review, and the one full golden run).
3. **Wave end:** a thin certification gate only — see below.

Golden gates are unchanged: they stay the lean cross-slice scenario suite that reruns at every acceptance.

## Battery mechanics

- Specs live in `tests/audit/wave-2/`, one per slice, named `p1-13.spec.ts`, `p1-14.spec.ts`, … and tagged `@AUDIT-W2-P1-13` etc. plus the shared `@AUDIT-W2` wave tag in the describe title.
- Run with `bun run test:audit:w2` (full wave battery) or `--grep @AUDIT-W2-P1-13` (one slice). `bun run test:audit` runs every wave's battery in one world; `playwright.audit.config.ts` covers all of `tests/audit/`.
- All Wave 1 battery rules carry over unchanged: golden harness reuse via relative imports, one disposable world per invocation, serial execution in filename order, never concurrently with the golden suite, production build for acceptance runs, and testing rules 12–13.
- Later slices' specs run after earlier ones in the shared-world battery: every spec must tolerate its predecessors' in-world state and record its own left-behind state below.

### Fixture-date ownership

Wave 1 owns run-day offsets +20 … +69. Wave 2 slices own **+70 onward**, five days per slice at 06:00 Berlin unless a flow needs otherwise, assigned when the slice starts:

| Slice | Owned run-day offsets |
| --- | --- |
| P1-13 | +70 … +74 |
| P1-14 | +75 … +79 |
| (assign the next block when a slice enters `in_progress`) | … |

## Per-slice validation ladder (what actually runs at each Wave 2 acceptance)

The full Wave 1 battery does NOT rerun at every slice — the full Golden suite is the every-slice regression net, the audit batteries are exhaustive flow evidence. Per slice, in this order (testing rules 8–10 govern reruns and the freeze):

1. **Statics:** `tsc --noEmit`, lint, `bun run test:unit`.
2. **Focused, iterating:** the slice's own audit spec (`--grep @AUDIT-W2-P1-XX`) and the slice's golden spec/gate tag until green.
3. **Affected Wave 1 audit tags:** if the slice materially changed a surface a Wave 1 session owns (e.g. anything under `/kalender` → `@AUDIT-W1-A6`/`A7`; job/checklist surfaces → `@AUDIT-W1-A1`), run those focused tags. Name the chosen tags and the reasoning in the acceptance evidence; "none affected" is a claim that needs a sentence, not silence.
4. **CodeRabbit review** with fixes, then re-freeze (statics + focused greens).
5. **Final confirmation on a fresh production build, nothing changes after:** the slice's focused audit spec, then **one full Golden run** (currently 93). Scoped reopening per the Wave 1 rules: app-code or `tests/golden/**` changes reopen the pair; `tests/audit/**`-only changes reopen only the focused audit run.

The full multi-wave audit batteries run at the **wave-end certification gate only** (below) — that is where cross-wave flow regressions get their exhaustive sweep. Never run two Playwright batteries concurrently (shared world artifacts).

## Wave-end certification gate

After the wave's last slice is accepted: fresh production build, then sequentially (never concurrently) the **full golden suite** and the **full `@AUDIT-W2` battery**, both green in one recorded pair; plus the mechanical set-equality check that the wave's catalog IDs equal the union of the ledger rows below, `0 partial; 0 unmapped`. Record the gate in `docs/plans/golden-gate-log.md` as `AUDIT-W2`. Because every slice already certified its own coverage, this gate is confirmation, not discovery — budget a day, not weeks.

## Coverage ledger

One section per slice, added at slice acceptance. Same row format and status vocabulary as Wave 1 (`docs/plans/wave-1-audit.md`): catalog flow IDs, coverage mapping, status, whole-bullet clause evidence, closed with the invariant line.

*(No Wave 2 slice is accepted yet.)*

## In-world left-behind state (shared battery)

One entry per slice spec, added at acceptance, same purpose as Wave 1's register: what the spec leaves in-world for later specs in a full battery run.

*(Empty.)*

## Session log

Newest first: per-slice audit closure entries and the final certification gate.

| Date | Slice / gate | Summary | Evidence |
| --- | --- | --- | --- |
| 2026-08-21 | — | Per-slice audit model established (this document, roadmap protocol 5a and the audit-coverage acceptance items, testing rule 12 extension, `tests/audit/` config widened to all waves, `test:audit`/`test:audit:w2` scripts). No Wave 2 slice started. | This session |
