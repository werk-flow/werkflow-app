# P1-16 — Field work pack

Status: closed (2026-08-25) — accepted P1-16 acceptance record; canonical home for the slice's evidence

## Outcome

Assigned field workers receive one focused job work pack that composes the existing job, dispatch, lifecycle, instruction, evidence, document, time, inventory and blocker owners. Admin and Büro keep the existing full job detail. The slice creates no work-pack storage, schema, external service, offline queue, customer package or parallel business state.

## Confirmed composition

Both standalone and project-child routes keep using the shared job detail entry. Employees receive a dedicated role-aware composition in this order:

1. Pre-arrival context with planned window, requested outcome, correct site, access notes, operational contact and immediate call/navigation actions.
2. One primary next action. A pending current dispatch takes presentation priority; otherwise P1-14's canonical next action remains authoritative.
3. Execution transitions and ordered P1-13 instructions.
4. P1-15 structured progress/evidence and contextual documents/photos.
5. The employee's own time context and operational material demand/take/return state.
6. Unresolved blockers, dependencies and questions.
7. Secondary job and minimal parent-project reference information.

The employee project-child route uses only the parent reference returned by the authorized job reader. It does not load or expose sibling jobs or project-wide details.

## Authorization and privacy

- Every read and mutation keeps organization and current assignment checks on the server.
- Unassigned employees and outsiders receive no pack data.
- Assignment removal while open revokes the rendered access on refresh and causes current mutations to fail authorization.
- Employee terminal work is read-only. Manager reopening and handover remain office-owned.
- The field projection excludes commercial price, margin, valuation and billability data; internal customer and request context; colleague email, personnel and time details; organization-wide picker data; full project detail; document governance; other-authored internal artifact drafts; responsibility snapshots; and manager lifecycle, dispatch, template, qualification and assignment controls.

## Ownership and persistence

- Customer/site/contact: P1-01 and `getJobByNumber`.
- Dispatch/schedule/readiness: P1-12 dispatch readers/actions and `composeReadiness`.
- Lifecycle, blockers and dependencies: P1-14 readers/actions.
- Instructions and evidence requirements: P1-13 materialized instruction owners.
- Structured evidence and exact-version customer context: P1-15 artifact owners.
- Documents/photos: the existing contextual document and direct R2 upload path.
- Time: ClockStateProvider, time actions and employee-owned job history.
- Material: inventory material-line and movement actions.

No new table, column, database function, policy, publication entry or migration is planned. Existing assigned jobs render immediately without backfill. Opening the employee pack must be read-only, including avoiding the existing inventory-default initializer until the user explicitly starts a material action.

## Failure and freshness contract

Initial source failures remain visible per section and cannot become false empty or ready states. Later refresh failures keep the last successful value with a stale warning. Version conflicts retain typed input and require a deliberate reload. Ambiguous material results reload movements before retry. Upload failures remain per file. Existing dialog primitives suspend router refreshes and issue one catch-up refresh after close. Assignment revocation removes stale sensitive content.

The pack reuses the existing organization Realtime channel and published roots. It adds no publication entry. Immutable dispatch and artifact child changes continue to signal through their published roots.

## Closed boundaries

P1-16 does not own office-reviewed handover, customer-visible output, commercial readiness, messages, equipment/service history, segmented time, reservation, consumption/billability, OCR/capture processing, native mobile/offline behavior, geocoding, route providers, GPS or connectors. `execution_complete` and `handed_over` remain distinct.

## Confirmed flow and test contract

The owner confirmed `P1-16-F01` through `P1-16-F94`. The acceptance ledger must close all 94 flows with no partial or unmapped item.

- Last-sorting dual-mode Golden: `tests/golden/p1-16.spec.ts`, tags `@P1-16`.
- Exhaustive Wave 2 audit: `tests/audit/wave-2/p1-16.spec.ts`, tags `@AUDIT-W2-P1-16` and `@AUDIT-W2`.
- Fixture dates: run-day `+85 … +89` at 06:00 Europe/Berlin.
- Affected Wave 1: `@AUDIT-W1-A1` and `@AUDIT-W1-A7`; A5 and A6 remain out unless implementation changes their owned behavior.
- UI-only business mutations in disposable worlds; read-only database assertions; persisted-state proof through reload/new session/navigation; assigned, unassigned, manager and outsider sessions; teardown plus independent zero-leftover proof.
- No named gate is due. P1-17 still owns GG-04.

## Acceptance evidence

### Delivered implementation

- Both assigned-employee job routes render `FieldWorkPackPage`; Admin and Büro retain the existing `JobDetailContent` composition.
- The pack projects only operational customer, site, contact and minimal parent-project facts, orders them around one current action, and keeps terminal work read-only.
- Dispatch loading fails closed; current pending dispatch revisions supersede lifecycle presentation without creating a second state machine. Instruction toggles serialize rapid actions and resynchronize rejected writes.
- Artifact actions use an explicit field allowlist, hide coworker internal drafts and signer context, and retain local dialog input through stale or failed writes.
- Employee time readers return only the viewer's job entries. Employee inventory search is server-bounded to 50 results, supports name/SKU/manufacturer/barcode, resolves planned items outside the cap by exact ID, and hides supplier, valuation and billability data.
- Contextual direct uploads retain completed files across the metadata step, synchronize renames and expire abandoned retained uploads after 60 seconds.
- Field material facts use a bounded local Realtime refresh with last-known/error handling. Existing root subscriptions remain authoritative for dispatch, lifecycle, instructions, artifacts, documents, time and assignment revocation.
- No table, column, RPC, policy, grant, generated type or publication entry changed. Existing jobs require no migration or backfill; production received no P1-16 mutation.

### Review and verification

- `werkflow-design` and the React multi-component checklist were applied to the mobile/desktop composition, touch targets, focus order, loading, stale, disabled and dialog states.
- CodeRabbit passes were dispositioned before the freeze. Accepted findings hardened fail-closed dispatch, stale-source interaction blocking, instruction recovery, terminal permissions, signer privacy, bounded inventory search, direct-upload retention, Realtime races and authorization assertions. Rejected findings either duplicated established ownership, weakened freshness, contradicted the proven terminal-navigation requirement, or were style-only. A final requested pass was unavailable because the CLI account had exhausted its included reviews; no unresolved prior finding remained.
- Affected Wave 1: `@AUDIT-W1-A1` passed 28/28 (world `mt8afbxk`, 22.6m) and `@AUDIT-W1-A7` passed 9/9 (world `mt8bcdio`, 9.1m), each with zero leftovers. A5 was not added because qualification ownership did not change; A6 was not added because no calendar route or planning behavior changed.
- Final statics: `git diff --check`, TypeScript and lint clean; unit 235/235 in 26 files (490 expectations); `docs:check` green across 60 indexed docs; production build green.
- Frozen build `S1k-LMhdA2gFr0i4BelNw`, fresh workspace server: focused `@AUDIT-W2-P1-16` passed 5/5 in 6.7m (world `mt8iebdd`), followed sequentially by full Golden 103/103 in 41.1m (world `mt8in5zd`). Both teardowns reported zero leftovers; the independent sweep returned `LEFTOVERS_REMOVED=0`.
- Earlier failed runs were diagnostic only. Artifacts classified concrete product refresh races, harness persistence/session races and one authenticated-action environment transient; each valid defect was fixed and re-proven before the final clean pair. No failed full run is acceptance evidence.

### Coverage and boundaries

`P1-16-F01` through `P1-16-F94` are finalized in the user-flow catalog and mapped in the Wave 2 ledger at `94/94 mapped; 94/94 fully evidenced; 0 partial; 0 unmapped`.

P1-16 has no named Golden gate and does not claim `GG-04`. P1-17 remains the owner of office review, commercial readiness, the customer-visible package, reasoned handover override and reopening depth.

## Post-acceptance harness hardening

The 2026-08-25 retrospective found that the product slice was broad, but its 14-hour cycle was not an acceptable baseline. Several real product defects justified focused reruns; repeated full replay, overwritten failure state, a stale outsider session and verbose progress polling did not. The repository now archives every failed run, retains its disposable DEV world, supports focused diagnostic reuse, validates all role sessions, splits this spec into setup, execution and boundary stages, enforces classification and rerun budgets, checks DEV Supabase and R2 before browser launch, stops serial batteries after the first failure and keeps full runner output outside the conversation. The P1-12 terminal scenario now constructs its own persisted precondition, proving that a late failure can be replayed without the preceding five tests. Focused P1-12 passed 6/6; two later full runs encountered evidenced live-provider network failures, and the policy correctly blocks another same-class retry. The reusable incident record is [test-incident-log.md](../../../technical/test-incident-log.md). This hardening changes no accepted P1-16 product behavior or evidence and does not pretend the long live-provider battery is deterministic.

## Links

- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)
