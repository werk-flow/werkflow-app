# Phase 1 Golden Scenario Gates

Status: living — last reviewed 2026-09-02

Gate definitions `GG-00` through `GG-16` and the run-record requirements. A gate definition changes only when a slice's acceptance extends it; runs are recorded in [`golden-gate-log.md`](../golden-gate-log.md). Process rules live in [protocol.md](protocol.md); the slice index in [roadmap.md](roadmap.md).


Golden scenarios test connected business outcomes. They do not replace focused unit, integration, RLS, migration, accessibility, or feature acceptance tests.

Every gate run must record:

- date and target environment;
- build/commit identifier;
- organization/role fixtures used;
- scenario data setup;
- pass/fail for each assertion;
- screenshots, logs, automated-test output, or other evidence where useful;
- defects and the slice responsible for resolution;
- whether previous gates were rerun because shared behavior changed.

### `GG-00` — Existing Foundation Regression

**Run after:** `P1-00` and after any later change to shared auth, organization, navigation, cache, or database infrastructure.

Spec: `tests/golden/gg-00.spec.ts` (`@GG-00`).

Verify that:

1. An organization can onboard/invite roles safely.
2. Admin/Büro can create a customer, job/project, schedule it, assign an employee, and see it update.
3. An employee sees only assigned work, records job-linked time, uploads/views contextual documents, and performs permitted inventory take/return.
4. Managers can use the central documents and inventory surfaces.
5. Organization isolation, sign-out behavior, Realtime freshness, and the major current mobile/responsive web paths remain intact.

### `GG-01` — Customer Request To Work

**Run after:** `P1-02`.

Spec: `tests/golden/gg-01.spec.ts` (`@GG-01`).

Create a commercial customer with multiple contacts/sites, capture a request while speaking to the caller, attach evidence, then convert it once into operational work. Confirm that the correct customer/contact/site and request context reach the work and calendar without copying or losing history. Also verify direct repeat-job creation without a synthetic request.

### `GG-02` — Schedule, Vacation, Approval, And Attention

**Run after:** `P1-07`; rerun after `P1-08` and `P1-09`.

Spec: `tests/golden/p1-07.spec.ts` (`@GG-02`).

Create full-time and part-time schedules, submit overlapping leave, delegate an approver, approve/reject/withdraw requests, and verify target hours, provisional/approved calendar availability, notification deduplication, audit, and employee transparency. Add sickness and qualification constraints when those slices land.

### `GG-03` — Qualified Planning And Dispatch

**Run after:** `P1-12`.

Spec: `tests/golden/p1-12.spec.ts` (`@GG-03`).

Take requested work from backlog through multi-visit planning and dispatch. Verify employee availability, skill/certification coverage, capacity conflict explanation, intentional override, assignment acknowledgement, parked reason/next review, rescheduling history, and the distinction between an internal plan and a customer commitment.

### `GG-04` — Field Execution And Handover

**Run after:** `P1-17`.

Spec: `tests/golden/p1-17.spec.ts` (`@GG-04`).

Apply a work template, dispatch it, execute as an assigned field worker, capture tasks, time/material context, photos, measurement, defect/change evidence, and signature/refusal. Verify that missing required evidence blocks or requires a reasoned override, internal notes stay private, handover creates the correct package, and reopening preserves history.

### `GG-05` — Reactive Service And Warranty

**Run after:** `P1-19`.

Spec: `tests/golden/p1-19.spec.ts` (`@GG-05`).

Report a fault for installed equipment, triage urgency and warranty/charge context, dispatch a qualified technician, use prior equipment history, capture the visit, distinguish unresolved/return/warranty work, and produce service, inventory, customer, and commercial follow-up states without duplicating the equipment or job.

### `GG-06` — Recurring Maintenance Lifecycle

**Run after:** `P1-20`.

Spec: `tests/golden/p1-20.spec.ts` (`@GG-06`).

Create operational contract coverage and a maintenance plan, generate due work, modify one occurrence without corrupting the series, complete the visit with the correct checklist/measurements/report, update equipment history, calculate the next due date, and handle skipped/cancelled/combined/overdue work.

### `GG-07` — Employee And Time Period Lifecycle

**Run after:** `P1-23`; rerun after `P1-24` and `P1-33`.

Spec: `tests/golden/p1-23.spec.ts` and `tests/golden/p1-24.spec.ts` (`@GG-07`; the gate is split across both slice specs).

Use employees with different schedules and absences to record work, travel, breaks, internal time, overnight work, and corrections. Resolve approvals and warnings, close/export a period, apply a late correction/re-export, and confirm employee-visible balances. Later reruns add onboarding, access start/suspension, asset return, and preserved offboarding history.

### `GG-08` — Job Material Lifecycle

**Run after:** `P1-27`.

Spec: not yet due (after `P1-27`).

Plan demand, reserve partial stock, expose a shortage, pick/take material, add unplanned use, consume/install, return unused quantity, record waste/warranty/goodwill, and verify physical, available, cost, and billable quantities remain distinct and traceable.

### `GG-09` — Procurement And Receipt

**Run after:** `P1-30`.

Spec: not yet due (after `P1-30`).

Consolidate demand from several jobs and reorder levels, compare suppliers/pack sizes, approve and issue an order, receive partial/damaged/substituted quantities into the correct locations, preserve backorders, return rejected goods, and verify no supplier bill or document silently changes stock.

### `GG-10` — Inventory Control, Assets, And Offboarding

**Run after:** `P1-34`.

Spec: not yet due (after `P1-34`).

Transfer stock to a vehicle, perform a barcode-supported count with discrepancies, inspect valuation/history, issue an individually tracked tool, flag an inspection problem, and offboard its custodian. Verify chain of custody, stock/asset distinction, reconciliation, retained history, and manual fallback when a standard/scan path fails.

### `GG-11` — Offer To Accepted Scope

**Run after:** `P1-37`.

Spec: not yet due (after `P1-37`).

Calculate and send a versioned offer containing labor/material/options, record partial acceptance, create the order baseline and operational work deliberately, then propose/approve/reject a change. Verify historic prices, internal margin privacy, exact accepted version, customer evidence, and no silent schedule/stock mutation.

### `GG-12` — Work To Customer Invoice

**Run after:** `P1-40`.

Spec: not yet due (after `P1-40`).

Complete work containing contract scope, approved changes, measured quantities, time, material, prior partial billing, and a warranty exception. Review billable work, create and issue the correct invoice/credit sequence, generate/validate supported e-invoice output, deliver it, and verify immutable issued content and source drill-down.

### `GG-13` — Purchase Cost, Payment, And Accounting Handoff

**Run after:** `P1-43`.

Spec: not yet due (after `P1-43`).

Capture an incoming bill, match it to order/receipt/job with a variance, approve/allocate it, import customer and supplier payment data, resolve ambiguous/partial matches, run a reviewed reminder, inspect post-calculation, and export an accountant-ready period. Reject and correct/re-export once without duplicating records.

### `GG-14` — Evidence And Customer Communication

**Run after:** `P1-46`.

Spec: not yet due (after `P1-46`).

Bring in a scanned or emailed document, process/search/review it, link it to its structured source, and send an appointment or completion artifact to the correct permitted recipient. Verify manual note versus actual delivery, failure/retry, duplicate/version handling, internal/customer visibility, retention, and revocation where supported.

### `GG-15` — Adoption, Migration, Mobile, And Interoperability

**Run after:** `P1-52`.

Spec: not yet due (after `P1-52`).

Onboard a representative SHK organization from supplied datasets, reconcile imports, configure roles and core workflows, execute a field day through offline/reconnect/conflict conditions, exercise selected connectors and their failure fallback, find/export linked records, use training/support paths, and perform a complete data-exit rehearsal.

### `GG-16` — Complete Phase 1 Business

**Run after:** `P1-54` on the release candidate.

Spec: not yet due (after `P1-54`).

Run all of these connected journeys with private and commercial customer variants where relevant:

1. Request → offer → accepted scope → job/project → schedule → field execution → handover → invoice → payment → accounting handoff → post-calculation.
2. Installed equipment → maintenance obligation → recurring visit → field evidence → equipment history → invoice → next due work.
3. Job demand → reservation → shortage → purchase order → receipt → consumption/return → supplier bill → customer billing → material margin.
4. Employee onboarding → schedule/qualification → assignment → vacation/sickness → time/correction → period close/export → offboarding and retained history.
5. Document/communication intake → reviewed source → operational/commercial use → external delivery → retention/export/recovery.

Phase 1 is not accepted while these journeys require users to retype shared records, conceal failures, bypass permissions, erase correction history, or switch to undocumented manual work for a capability declared complete.
