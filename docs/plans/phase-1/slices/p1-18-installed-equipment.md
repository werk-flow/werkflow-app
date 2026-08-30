# P1-18 Installed Equipment

Status: complete — accepted 2026-08-29

## Outcome

Customer sites gain service-owned installed-equipment records with stable identity, one bounded component level, organization-scoped identifiers, current lifecycle state, exact installation and commissioning origins, warranty facts, existing-document links and immutable searchable history. Customer pages show a compact site projection. Detailed management lives under `/service/anlagen`.

Installed customer equipment remains distinct from WerkFlow inventory. The slice records no stock movement, installation quantity, valuation or supplier return. It also adds no service intake, dispatch, recurrence, maintenance contract, due-work calculation, time segmentation, commercial decision, public access, offline queue, telemetry or external provider.

## Confirmed identity and location

- One `installed_equipment` model owns roots and independently serviceable components.
- Components have one root parent, one nesting level and the same organization, customer and site as the root.
- Every record receives an immutable organization-unique `ANL-YYYY-NNN` number.
- Typed identifiers retain raw and normalized values. Serial uniqueness uses organization, manufacturer or issuer, and normalized serial. Product numbers are not instance-unique.
- Initial categories cover heat generation, storage and hot water, ventilation, solar thermal, water and sanitary systems, bounded components and an honest `other` case.
- Every record belongs to one existing `Einsatzort` and may carry one free position label. P1-18 adds no building, apartment, floor or room hierarchy.

## Confirmed lifecycle

Current states are `unknown`, `active`, `inactive`, `removed`, `replaced` and `decommissioned`. Registration, installation and commissioning are dated facts or events rather than substitute states. Replacement creates a successor identity and retains the predecessor. Reactivation is limited to inactive equipment or the same removed physical unit. Mistaken terminal actions require a linked correction event.

Every mutation records the actor, effective and recorded times, reason where required, optimistic version, idempotency key, site/address snapshot and exact source references. Mutable artifact roots and current handover pointers never stand in for exact artifact revisions or handover releases.

## Authorization

Admin and Büro own reads and mutations. An employee receives only a compact read projection when the exact equipment record is linked to an exactly assigned job. Customer, site, project, root, component or sibling access never widens that boundary. An equipment-only document link does not grant employee document access.

Database constraints, guarded transactions, RLS and action-time server checks enforce organization and target consistency. Customer deletion cannot cascade through retained equipment history.

## UI and freshness

- Manager list: `/service/anlagen`.
- Manager detail: `/service/anlagen/[equipmentNumber]`.
- Sidebar label: `Service`; page label: `Anlagen & Geräte`.
- Customer sites show compact equipment summaries that link to the service-owned detail.
- The mutable equipment root is the Realtime invalidation source. Immutable history stays unpublished.
- `useLiveView` retains last-known detail data and stale state. All mutations use `useServerAction`.

## Test and rollout contract

- Golden: `tests/golden/p1-18.spec.ts`, tagged `@P1-18`, with setup, registration, history and boundary stages. P1-18 has no named Golden gate.
- Wave 2 audit: `tests/audit/wave-2/p1-18.spec.ts`, tagged `@AUDIT-W2-P1-18` and `@AUDIT-W2`.
- Fixture dates: offsets `+95 ... +99` at 06:00 Europe/Berlin.
- Affected Wave 1 tags: A1 for jobs/documents and A2 for customers/sites.
- No canary spec changes. The existing full canary remains required after a DEV-targeted production build.
- Migrations apply to DEV first. Fresh types, advisors, RLS and Realtime checks must pass before the identical committed sequence reaches PROD.
- Rollout fabricates no equipment, identifiers, warranty, commissioning, origin, history or equipment-document rows.

## Acceptance evidence

### Delivered contract

The slice implements the 48 owner-confirmed flows recorded in the [user-flow catalog](../../../product/user-flow-catalog.md). Its service-owned root/component model, identifier normalization, lifecycle transition graph, exact source references, assigned-job field projection and document-history protection are enforced in database constraints/RPCs and typed application boundaries. The manager list/detail, customer-site projection, field work-pack projection, loading/error/stale states and central Realtime invalidation are present. No later-slice domain or external resource was added.

### Schema and rollout

The identical additive sequence reached local, DEV (`mbkkzuqjbdvzelqvuzcn`) and then PROD (`jbgaqpdjauzoocplgdsn`):

1. `20260829120000_add_p1_18_installed_equipment_core.sql`
2. `20260829120100_add_p1_18_installed_equipment_rpcs.sql`
3. `20260829120200_integrate_p1_18_equipment_documents.sql`
4. `20260829120300_index_p1_18_foreign_keys.sql`

The fourth forward migration closed the DEV Performance Advisor's new unindexed-foreign-key findings; committed history was not rewritten. Fresh DEV type generation was inspected against `lib/supabase/database.types.ts`: the P1-18 tables, enums, relations and RPC contracts agree, while the checked-in file retains the repository generator's relation-aware formatting.

DEV preserved 1 organization and 1 document and had no customer/site/job/project rows. PROD preserved 5 organizations, 13 customers, 1 site, 40 jobs, 14 projects and 43 documents. Both environments received zero rows in `installed_equipment`, `installed_equipment_identifiers`, `installed_equipment_work_links`, equipment-target `document_links` and `installed_equipment_events`. No data was inferred or backfilled.

All five P1-18 public tables have RLS enabled. Manager operations and organization/target consistency are enforced at action time and in guarded RPCs; assigned employees receive only the exact job-linked projection. Only `installed_equipment` is published. Local, DEV and PROD publish 74 tables: 71 use replica identity `USING INDEX` on exactly `(id, organization_id)`, three recorded tables use DEFAULT and none uses FULL. P1-18 Security and Performance Advisor scopes are clean. The remaining advisor items are older unrelated findings: public execute on `set_job_assignment_organization` in DEV and established legacy performance notices.

### Review and development proof

- Local migration replay: all 189 committed migrations applied from zero; database lint returned only the two pre-existing warnings for the inventory seed actor parameter and project execution-state cast/variable.
- Realtime parity: `bun run realtime:check` passed across 74 tables.
- Focused Golden development run: 4/4, run `2026-08-29T170741563Z-4c0af9`.
- Focused exhaustive Wave 2 audit development run: 2/2, run `2026-08-29T171042840Z-611cb1`.
- Affected Wave 1 A1 sign-out proof: 1/1, run `2026-08-29T173601091Z-da8c51`. A1 is affected because P1-18 extends the assigned job and document surfaces; A2 is affected because it extends customer/site detail. The full Golden certification is the required compatibility net for both complete surface paths.
- Unit pre-freeze proof: 371/371. Final statics and browser certification are recorded below after freeze.

Three CodeRabbit CLI passes reviewed the full uncommitted slice with the required product and Realtime context. Passes reported 18, 14 and 6 findings. Valid findings were applied across composite tenant integrity, terminal-state guards, no-op/idempotent handling, exact identifier search, document deletion safety, fail-closed loading, date normalization, lifecycle successor filtering, stable browser selectors and the generalized replica-index checker. Two final findings were rejected: repository-local privileged settings were unrelated and untouched; bypassing the document-history trigger would erase immutable equipment history. The first fourth-pass attempt met the service's three-review rate limit; two later attempts closed their WebSockets before analysis. The third completed pass left no other accepted finding.

Development browser incidents were classified and cleaned. Shared searchable selection now waits for an exact visible label and clicks the verified HTML button; a bounded pre-mutation dialog opener retries Radix trigger races (Tier 2 harness prevention). The final A1 development attempt reached a hung long-running Next dev server on plain dashboard navigation after a successful clock-in; it was classified `environment`, cleaned, and moved to the required fresh production-server certification lane. No failed run is acceptance evidence and no diagnostic world remains.

### Final certification

Frozen source fingerprint `8989abed22cfb44d8514ac3382912af373529859b7294e4157ce5e979c3b6d84` passed the required sequence:

- `git diff --check`, TypeScript and lint: clean. `bun run test:unit`: 371/371 across 34 files with 679 expectations. `bun run docs:check`: 69 indexed docs. `bun run realtime:check`: 74/74 tables.
- Focused local `@AUDIT-W2-P1-18`: 2/2 in 55.243s, run `2026-08-29T190559730Z-f396ce`, world `mter42he`, production build `Z1MoKWKrSIu-jm0pklWp6`.
- Full local Golden: 114/114 in 20m31.179s, run `2026-08-29T190708156Z-fb9fe5`, world `mter5irk`, same build.
- Full DEV cloud canary: 9/9 in 2m11.233s, run `2026-08-29T193835219Z-5f74bc`, world `mtes9yvt`, DEV-targeted production build `yQk34F4G42bLtYnxHdbo3`.

Every accepted world tore down normally; the final retained-world audit found no manifest with an outstanding `cleanedAt`. The canary first reached 8/9 and caught a rollout-metadata defect: the remote apply tool had stored execution-time migration versions instead of the committed filename versions. That run was classified `environment`, world `mterznbs` was cleaned, and only the four DEV/PROD migration-ledger version keys were repaired. Focused C9 passed 1/1 and policy-covering `@CANARY` passed 9/9 before the final certification. Schema objects and business rows did not change.

The first full local attempt reached 103/114 before an inherited P1-16 helper matched a hidden responsive copy of „Material & Inventar“. The trace showed the intended section visible. The run was classified `harness`, world `mteqa45v` was cleaned, and the shared positive assertion moved to `visibleText` (Tier 2). The P1-16 setup/execution chain then passed 2/2 before the final pair. The final focused audit likewise followed a classified equipment-option helper failure whose trace showed `ANL-… · <name>` present; the semantic button-name boundary fix passed on the current source. A pre-world fingerprint failure from Node's 1 MiB default buffer is now bounded at 64 MiB in the shared runner (Tier 2).

The design review covered desktop table and mobile card composition, customer-site compactness, dedicated list/detail loading skeletons, restrained semantic status styling, dark-mode token use, German labels and feedback, keyboard/focus behavior, dialog preservation and 44-pixel primary targets. Golden and audit coverage prove manager/employee/outsider routes, initial/error/stale states and the assigned-job mobile projection. No separate accessibility exception remains.

The slice is accepted complete at `48/48 mapped; 48/48 fully evidenced; 0 partial; 0 unmapped`.

### Post-implementation campaign audit

The 2026-08-30 follow-up reviewed the P1-18 runner manifests, incident evidence and command sequence. It found seven avoidable fresh-world runs: three same-class A1 sign-out attempts after the investigation threshold, one A1-02/A1-03 iteration without its producer chain, one full Golden run before the affected P1-16 proof, one canary world that discovered migration-history drift only at C9, and one complete 9/9 canary mislabeled as focused iteration before the final certification. The [incident log](../../../technical/test-incident-log.md#p1-18-run-discipline-follow-up-2026-08-30) records the run keys and dispositions.

The follow-up made suite-wide focused selections and the learned incomplete A1 iteration chain impossible before world creation (Tier 1). It added classification and a two-same-class budget for fresh focused retries, a changed-file requirement for P1-16 proof before Golden certification, and DEV migration-history parity in cloud preflight with a standalone `bun run migrations:check` command (Tier 2). Long-command polling remains Tier 3 because repository code cannot control the Codex command-session scheduler; the local rule requires one long bounded wait and no unchanged-status narration.

Focused policy tests passed 18/18. The complete unit suite passed 380/380 across 35 files with 700 expectations. TypeScript, ESLint, `docs:check`, `git diff --check` and the live read-only DEV migration comparison passed. Direct runner checks rejected both `@CANARY` as a 9/9 iteration and the incomplete A1 selection before a run manifest or world existed. The audit changed no product behavior, schema or production data.

### Known limits

P1-19 still owns reactive service/warranty intake, triage and dispatch. P1-20 owns maintenance plans, contracts, recurrence and due work. P1-21 owns time segments; P1-27 owns consumption/installation quantities and returns; P1-44 owns OCR/full-text ingestion; P1-48 owns global search; P1-49 owns mobile/offline behavior. Commercial warranty decisions, external communication, public access, manufacturer compliance rules and telemetry remain absent.
