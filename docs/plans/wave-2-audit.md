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

### P1-13 — Versioned work templates

| Catalog flow IDs | Coverage | Status | Whole-bullet clause evidence |
| --- | --- | --- | --- |
| `P1-13-F01`, `F02`, `F03`, `F09`, `F26`, `F27` | `tests/audit/wave-2/p1-13.spec.ts` — empty state, role denial, validation, creation, filters, and safe Realtime catch-up | `fully evidenced` | Real Admin/Büro/employee/outsider sessions prove zero seeded templates, manager creation and validation, description/target/status filters, employee redirect and outsider isolation. A Büro dialog stays open across an Admin mutation and receives the queued refresh only after close. |
| `P1-13-F04`, `F05`, `F06`, `F07`, `F08`, `F10` | same spec — complete draft content and immutable publish | `fully evidenced` | UI-only creation, editing, ordering and deletion cover task/checklist kind, required/optional state, grouping/notes, evidence category, material plus inline item/location creation, organization capability creation, multiple structural prerequisites, cycle rejection and successful immutable publish. Persisted version rows and every child collection are asserted. |
| `P1-13-F11`, `F12`, `F13`, `F14`, `F19`, `F20`, `F21`, `F22` | same spec — version history, creation application, editability and snapshot meaning | `fully evidenced` | Direct job creation selects a published version, uses the established qualification override, materializes attributed existing primitives, keeps stock/time/documents untouched, and preserves the pre-existing planning occurrence and assignment. Employee checklist completion is persisted with actor/time. Manager edits checklist metadata/evidence and material through existing sections; provenance survives. V2, archive/reactivation and actor/timestamp/target history never rewrite V1 work. |
| `P1-13-F17`, `F18`, `F23`, `F24` | same spec — after-creation application and project-direct planning | `fully evidenced` | The preview shows exact counts; same-version retry is denied; another version requires explicit additive confirmation. A project application creates direct project instruction/material/capability rows, no child job, and no inherited row on a later child. Empty pickers exclude drafts, archives and foreign-organization versions. |
| `P1-13-F15`, `F16` | same spec — shared creation contexts and atomic request conversion | `fully evidenced` | Customer, employee, project-child and calendar creation dialogs expose the optional matching picker without changing their existing defaults. Job and project conversion materialize the selected version and persist the once-only request link; target state is read from the database. |
| `P1-13-F25`, `F26` | same spec — retired references and closed boundaries | `fully evidenced` | A retired capability makes template-backed creation fail atomically: the request/job count and application count stay unchanged, the named correction appears, and retry remains possible. Direct employee action and cross-organization reads/writes stay denied. |

**Invariant:** `27/27 mapped; 27/27 fully evidenced; 0 partial; 0 unmapped`.

### P1-14 — Arbeitsstand, Blocker, Voraussetzungen und Einsatzbereitschaft

| Catalog flow IDs | Coverage | Status | Whole-bullet clause evidence |
| --- | --- | --- | --- |
| `P1-14-F01`…`F12` | `tests/audit/wave-2/p1-14.spec.ts` — summary, filters, role transitions, stale recovery and dialog catch-up | `fully evidenced` | UI-only work creation proves separate canonical/planned/readiness facets, next action, canonical list badge/filter and employee denial. Parallel Admin/Büro dialogs produce one accepted transition, a persisted version/event pair, preserved input, catch-up signal and concrete stale rejection; interruption persists its required reason. |
| `P1-14-F13`…`F25` | same spec — blocker ownership, attention, resolution/reopen and parking | `fully evidenced` | An assigned employee creates a self-owned due-today safety blocker through the UI; persisted owner/reason/review/version and manager attention are asserted. Employee resolution, manager reopen, second resolution and event-compatible versions are followed by manager parking with bounded context. Database state proves one blocker model, resolved/open distinction and execution/parking separation. |
| `P1-14-F26`…`F36` | same spec — work prerequisites and predecessor state | `fully evidenced` | Manager UI links two jobs, start is atomically denied, the inverse link is rejected as a cycle, predecessor execution completion satisfies the link, and reopening makes it unsatisfied again. The persisted row proves the chosen start effect and retained identity; the companion template/gate journey exercises the existing instruction prerequisite primitive. |
| `P1-14-F37`…`F48` | same spec — live readiness, current-fact completion gates and handover | `fully evidenced` | A template-backed assigned/planned job renders the shared readiness dimensions, honest unknown/tool state and unreserved material wording. Required-instruction completion blocks execution completion until the employee persists it. Completion then succeeds, while handover needs the checked manager exception and reason; the final event asserts distinct state, current zero instruction gap, gate snapshot and 64-character fingerprint. |
| `P1-14-F49`…`F63` | same spec — project derivation/override, planning/time automation, audit, RLS and negative promises | `fully evidenced` | UI-only project/job creation proves automatic project derivation, a reasoned non-cascading override, reasoned clear and unchanged child. A scheduled job starts through actual clock-in and persists the atomic automatic event; clock-out restores test hygiene. Direct database assertions prove no template/application or inventory movement side effect, outsider UI denial and zero cross-organization lifecycle visibility. Golden compatibility stories additionally exercise legacy parking and the dedicated lifecycle journeys. |

**Invariant:** `63/63 mapped; 63/63 fully evidenced; 0 partial; 0 unmapped`.

## In-world left-behind state (shared battery)

One entry per slice spec, added at acceptance, same purpose as Wave 1's register: what the spec leaves in-world for later specs in a full battery run.

- **P1-13:** owns run-day +70 through +74 at 06:00 Europe/Berlin. It leaves two run-scoped templates with published/version history (one archived then reactivated), direct and converted jobs/projects, one later child job, material/capability catalog additions, template applications and attributed instruction/evidence/dependency/material/capability rows, plus the request conversion/history facts created by the six journeys. It creates no stock movements, reservations, dispatches, attention types, actual time or documents. Later specs must address these records by `world.runId` and cannot assume an empty template/application domain.
- **P1-14:** owns run-day +75 through +79 at 06:00 Europe/Berlin. It leaves run-scoped jobs/projects with canonical transitions and project overrides, execution/blocker/dependency/instruction event history, one resolved blocker plus one open parking blocker, one linked dependency, one template/application and checklist completion, planning occurrences and a closed time session. It creates no inventory movement, reservation, document, signature, message or customer package. Later specs must select lifecycle records by `world.runId` and cannot assume the work-lifecycle or P1-13 template domains are empty.

## Session log

Newest first: per-slice audit closure entries and the final certification gate.

| Date | Slice / gate | Summary | Evidence |
| --- | --- | --- | --- |
| 2026-08-23 | `P1-14` | Accepted with the owner-confirmed 63-flow contract. Focused `@AUDIT-W2-P1-14` passed 5/5 on the final frozen build; affected Wave-1 A1/A5/A6/A7 audits and full Golden 101/101 passed after lifecycle compatibility updates. | `tests/audit/wave-2/p1-14.spec.ts`; gate log 2026-08-23 |
| 2026-08-23 | `P1-13` | First Wave 2 slice accepted with its owner-confirmed 27-flow contract. Focused `@AUDIT-W2-P1-13` passed 6/6 after CodeRabbit hardening; affected Wave-1 `@AUDIT-W1-A1` passed 28/28. | `tests/audit/wave-2/p1-13.spec.ts`; gate log 2026-08-23 |
| 2026-08-21 | — | Per-slice audit model established (this document, roadmap protocol 5a and the audit-coverage acceptance items, testing rule 12 extension, `tests/audit/` config widened to all waves, `test:audit`/`test:audit:w2` scripts). No Wave 2 slice started. | This session |
