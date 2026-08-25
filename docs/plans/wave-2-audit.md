# Wave 2 Flow Audit (per-slice model)

Status: living — Wave 2 per-slice coverage ledger and certification-gate record

Wave 2 audits work differently from Wave 1: **every slice ships its own exhaustive flow coverage as part of slice acceptance.** There are no wave-end discovery sessions. This document is the wave's coverage ledger and the certification-gate record; the process rules live in [`phase-1/protocol.md`](phase-1/protocol.md) and testing rules 12–13.

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
| P1-15 | +80 … +84 |
| P1-16 | +85 … +89 |
| (assign the next block when a slice enters `in_progress`) | … |

## Per-slice validation ladder (what actually runs at each Wave 2 acceptance)

The full Wave 1 battery does NOT rerun at every slice — the full Golden suite is the every-slice regression net, the audit batteries are exhaustive flow evidence. Per slice, in this order (testing rules 8–10 govern reruns and the freeze):

1. **Statics:** `tsc --noEmit`, lint, `bun run test:unit`.
2. **Focused, iterating:** the slice's own audit spec (`--grep @AUDIT-W2-P1-XX`) and the slice's golden spec/gate tag until green.
3. **Affected Wave 1 audit tags:** if the slice materially changed a surface a Wave 1 session owns (e.g. anything under `/kalender` → `@AUDIT-W1-A6`/`A7`; job/checklist surfaces → `@AUDIT-W1-A1`), run those focused tags. Name the chosen tags and the reasoning in the acceptance evidence; "none affected" is a claim that needs a sentence, not silence.
4. **CodeRabbit review** with fixes, then re-freeze (statics + focused greens).
5. **Final confirmation on a fresh production build, nothing changes after:** the slice's focused audit spec, then **one full Golden run** (currently 102). Scoped reopening per the Wave 1 rules: app-code or `tests/golden/**` changes reopen the pair; `tests/audit/**`-only changes reopen only the focused audit run.

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

### P1-15 — Strukturierte Arbeitsnachweise, Freigaben und Unterschriften

| Catalog flow IDs | Coverage | Status | Whole-bullet clause evidence |
| --- | --- | --- | --- |
| `P1-15-F01`…`F31` | `tests/audit/wave-2/p1-15.spec.ts` — targets, roles, five structured kinds, validation and organization isolation | `fully evidenced` | Real Admin/Büro/employee/outsider sessions prove the section placement, empty/list/detail states, exact job/project target access, all five typed forms, assignment-derived field access, customer visibility controls, complete-versus-draft validation, positive measurement rows, defect/change details and zero cross-organization visibility. Persisted revisions and typed detail rows are asserted without creating parallel jobs, tasks, time or stock facts. |
| `P1-15-F32`…`F40` | same spec — immutable revisions, stale recovery, idempotency and Realtime catch-up | `fully evidenced` | Exact database assertions prove append-only versions/details, correction reasons, decision/evidence retention, optimistic version rejection with no partial write, same-request replay versus conflicting reuse, hard-delete protection and dialog-safe Realtime catch-up. The stale UI keeps its local input until the user reloads the current version. |
| `P1-15-F41`…`F49` | same spec — Four-Eyes responsibility, review outcomes, attention and void history | `fully evidenced` | Role default, selected responsibility and action-time delegation are exercised through the shared resolver. Self-approval is denied; a second authorized person approves, rejects and requests correction against exact revisions; withdrawal and void retain immutable history. Stable review/correction/defect attention identities surface only to current target-authorized viewers and clear or reappear from current facts without duplicates. |
| `P1-15-F50`…`F70` | same spec — customer outcomes, signature, document/source/evidence links and deterministic export | `fully evidenced` | UI and persisted rows distinguish internal approval from acknowledgement, refusal and reservation; exact-version customer context and the legal-sufficiency disclaimer remain visible. Pointer signature upload uses the existing direct R2/document path. Same-target documents, time sources and instruction-evidence fulfilment are validated, and deterministic HTML export proves category/linkage, renderer/hash identity, structured content and retry behavior. |
| `P1-15-F71`…`F78` | same spec plus `tests/golden/p1-15.spec.ts` — lifecycle projection, shared surfaces and closed boundaries | `fully evidenced` | Current measurement, defect, approval, customer/signature and evidence facts feed the P1-14 snapshot/fingerprint and gates without a second blocker model; an approved artifact action can satisfy the declared approval prerequisite. Detail, attention, document and lifecycle surfaces refresh through existing ownership. Read-only database assertions prove zero changes to planning, dispatch, actual time, inventory, price, invoice, customer package or messages and preserve every later-slice boundary. |

**Invariant:** `78/78 mapped; 78/78 fully evidenced; 0 partial; 0 unmapped`.

### P1-16 — Fokussierter Arbeitspack für zugewiesene Handwerker

| Catalog flow IDs | Coverage | Status | Whole-bullet clause evidence |
| --- | --- | --- | --- |
| `P1-16-F01`…`F26`, `F83` | `tests/audit/wave-2/p1-16.spec.ts` — role-aware standalone/project-child projection, first viewport and privacy | `fully evidenced` | Real Admin/Büro/employee/outsider sessions create standalone and child work, then prove shared assigned access, minimal parent reference, no sibling/project-wide leakage, unchanged office composition, server denial for unassigned/foreign roles, side-effect-free opening, exact mobile order, requested outcome, site/access/contact/call/navigation actions, explicit missing facts, 44px targets and exclusion of internal notes, email, colleague, commercial and governance facts. Read-only before/after database state is equal. |
| `P1-16-F27`…`F42` | same spec — dispatch priority, readiness and execution lifecycle | `fully evidenced` | Two UI-created dispatch journeys prove one current CTA, fail-closed pending dispatch, acknowledgement and challenge through their owner, honest readiness dimensions and zero time/stock/status/message/customer-promise side effects. Employee lifecycle start, interrupt, resume and gated completion use the P1-14 transitions; terminal field state is read-only while completion remains distinct from handover/reopen. Persisted dispatch and lifecycle reads prove the committed revisions and events. |
| `P1-16-F43`…`F61` | same spec plus `tests/golden/p1-16.spec.ts` — instructions, evidence, artifacts and contextual files | `fully evidenced` | Ordered task metadata, dependency behavior, serialized completion/reopen, evidence requirements and exact fulfilment remain in P1-13/P1-15. UI-only artifact and direct-R2 document actions persist through independent reads; own internal drafts remain visible, coworker drafts/signers stay hidden, stale input survives and no copied task, file, field-artifact format or customer package appears. Upload failure/retention and terminal read-only controls are exercised through the shared components. |
| `P1-16-F62`…`F81` | same spec — own time, employee material and unresolved issues | `fully evidenced` | The employee sees only their own time, clocks in/out through the established surface and never gains P1-21 segmentation. Planned and unplanned material take plus return use a bounded picker and existing inventory RPCs; persisted movement count rises by two while on-hand quantity returns to baseline, and supplier/valuation/billability/catalog controls remain absent. Own blocker report/resolve and prerequisites use P1-14 without a second issue model. |
| `P1-16-F82`…`F94` | same spec plus unit projection/privacy/dispatch tests — recovery, Realtime, accessibility and closed boundaries | `fully evidenced` | Compact issues, progressive disclosure, parallel bounded loading, initial retry, keep-last-known inert stale state, duplicate/stale recovery, focus and assignment-revocation catch-up, root-based Realtime, dialog input preservation, keyboard/focus/screen-reader/touch behavior and explicit no-offline/no-provider/no-message/no-equipment/no-commercial/no-customer-package promises are asserted. Unit tests cover field projection/terminal privacy, signer redaction and fail-closed dispatch state. Every mutation remains with its domain owner. |

**Invariant:** `94/94 mapped; 94/94 fully evidenced; 0 partial; 0 unmapped`.

## In-world left-behind state (shared battery)

One entry per slice spec, added at acceptance, same purpose as Wave 1's register: what the spec leaves in-world for later specs in a full battery run.

- **P1-13:** owns run-day +70 through +74 at 06:00 Europe/Berlin. It leaves two run-scoped templates with published/version history (one archived then reactivated), direct and converted jobs/projects, one later child job, material/capability catalog additions, template applications and attributed instruction/evidence/dependency/material/capability rows, plus the request conversion/history facts created by the six journeys. It creates no stock movements, reservations, dispatches, attention types, actual time or documents. Later specs must address these records by `world.runId` and cannot assume an empty template/application domain.
- **P1-14:** owns run-day +75 through +79 at 06:00 Europe/Berlin. It leaves run-scoped jobs/projects with canonical transitions and project overrides, execution/blocker/dependency/instruction event history, one resolved blocker plus one open parking blocker, one linked dependency, one template/application and checklist completion, planning occurrences and a closed time session. It creates no inventory movement, reservation, document, signature, message or customer package. Later specs must select lifecycle records by `world.runId` and cannot assume the work-lifecycle or P1-13 template domains are empty.
- **P1-15:** owns run-day +80 through +84 at 06:00 Europe/Berlin. It leaves run-scoped job/project artifacts covering all five kinds, immutable revision/action history, measurement lines, defect/change detail, exact document/source relations, one active instruction-evidence fulfilment, customer reservation/signature context, a deterministic HTML export and lifecycle projection facts. It creates no schedule/dispatch mutation, active time, inventory movement, commercial row, message or customer package. Later specs must select artifacts by `world.runId` and cannot assume an empty artifact or evidence-fulfilment domain.
- **P1-16:** owns run-day +85 through +89 at 06:00 Europe/Berlin. It leaves run-scoped assigned and unassigned jobs plus one project child; acknowledged/challenged dispatch history; lifecycle, instruction and evidence state; one employee-authored draft artifact; one contextual document link; one closed employee time entry; paired take/return inventory movements; and resolved blocker history. Physical stock returns to its baseline, no active clock remains, and it creates no reservation, consumption, price, invoice, message, customer package, copied work-pack row or external-provider record. Later specs must select these facts by `world.runId` and cannot assume empty dispatch, lifecycle, artifact, evidence, time, material or blocker domains.

## Session log

Newest first: per-slice audit closure entries and the final certification gate.

| Date | Slice / gate | Summary | Evidence |
| --- | --- | --- | --- |
| 2026-08-25 | `P1-16` | Accepted with the owner-confirmed 94-flow contract. Focused `@AUDIT-W2-P1-16` passed 5/5 on frozen build `S1k-LMhdA2gFr0i4BelNw`, followed by full Golden 103/103; both worlds and the independent sweep reported zero leftovers. | `tests/audit/wave-2/p1-16.spec.ts`; gate log 2026-08-25 |
| 2026-08-24 | `P1-15` | Accepted with the owner-confirmed 78-flow contract. Focused `@AUDIT-W2-P1-15` passed 4/4 on frozen build `pa2j4ys53RN4VqROc1u6O`, followed by full Golden 102/102; both worlds tore down with zero leftovers. | `tests/audit/wave-2/p1-15.spec.ts`; gate log 2026-08-24 |
| 2026-08-23 | `P1-14` | Accepted with the owner-confirmed 63-flow contract. Focused `@AUDIT-W2-P1-14` passed 5/5 on the final frozen build; affected Wave-1 A1/A5/A6/A7 audits and full Golden 101/101 passed after lifecycle compatibility updates. | `tests/audit/wave-2/p1-14.spec.ts`; gate log 2026-08-23 |
| 2026-08-23 | `P1-13` | First Wave 2 slice accepted with its owner-confirmed 27-flow contract. Focused `@AUDIT-W2-P1-13` passed 6/6 after CodeRabbit hardening; affected Wave-1 `@AUDIT-W1-A1` passed 28/28. | `tests/audit/wave-2/p1-13.spec.ts`; gate log 2026-08-23 |
| 2026-08-21 | — | Per-slice audit model established (this document, protocol step 5a — now in `phase-1/protocol.md` — and the audit-coverage acceptance items, testing rule 12 extension, `tests/audit/` config widened to all waves, `test:audit`/`test:audit:w2` scripts). No Wave 2 slice started. | This session |
