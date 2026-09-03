# P1-15 — Structured site evidence

Status: closed (2026-08-24) — accepted P1-15 acceptance record; canonical home for the slice's evidence

This record is the canonical home for P1-15 acceptance facts. The current slice index lives in [../roadmap.md](../roadmap.md); process rules live in [../protocol.md](../protocol.md).

## Bounded outcome

Field and office users can create structured site diaries, reports, measurements, defects, change-work evidence, approvals, and signatures linked to exact artifact versions.

## Direct dependencies

`P1-07`, `P1-13`, `P1-14` — all accepted complete before this slice started.

## Primary and connected specs

Jobs/projects; documents; commercial; service.

## Confirmed contract

The product owner confirmed report items 2–10 on 2026-08-24. P1-15 uses one stable artifact identity with immutable typed revisions. Every approval, rejection, customer response, signature and export binds to one exact revision. The slice adds five kinds: Bautagebuch, Arbeitsbericht, Aufmaß, Mangel and Regie-/Änderungsnachweis. It reuses the document store, attention pipeline, responsibility model, instruction evidence expectations and P1-14 lifecycle gates without creating parallel domain systems.

The complete design, permission matrix, gate behavior, migration order, non-goals and verification plan are in the [implementation plan section below](#implementation-plan-merged-2026-09-03-from-the-former-separate-plan-file), merged from the owner-confirmed plan file on 2026-09-03.

## Acceptance evidence

P1-15 is accepted complete with `78/78 mapped; 78/78 fully evidenced; 0 partial; 0 unmapped` in the Wave 2 ledger. The implementation adds the five structured artifact kinds, immutable typed revisions, exact-revision decisions/signatures/documents/sources/exports, scoped Four-Eyes review, instruction-evidence fulfilment, attention and lifecycle projection, while leaving schedule, dispatch, actual time, stock, commercial records, messages and customer packages unchanged.

Fifteen committed migrations were applied DEV-first and then identically to production. Both environments report zero Security Advisor and zero Performance Advisor findings. Production retained 40 jobs and 14 projects and received zero P1-15 business rows.

Four CodeRabbit CLI passes were dispositioned (47, 3, 32 and 27 findings). Valid findings hardened authorization, atomic signature/document linkage, immutable revision guards, submission validation, deterministic export cleanup/order, viewer-scoped attention, action visibility, UI failure recovery and audit helpers; rejected suggestions would have weakened fail-closed attention behavior, published immutable ledgers, or duplicated established ownership without a demonstrated defect.

Final frozen build `pa2j4ys53RN4VqROc1u6O`: focused `@AUDIT-W2-P1-15` passed 4/4 in world `mt73hwm5` (5.9m), then full Golden passed 102/102 in world `mt73pl6q` (35.2m). Both teardowns destroyed their worlds with zero leftover records. Focused `@P1-15` passed 1/1; inherited P1-13/P1-14 passed 8/8. The affected Wave-1 A5 battery passed 4/4; A1's first 26 cases passed in the combined run and its material journey passed focused after correcting a stale assertion to the product's persisted take/return arithmetic. No named Golden gate was due; the next is `GG-04` after `P1-17`.

## Links

- Audit ledger: [wave-2-audit.md](../../wave-2-audit.md)
- Gate runs: [golden-gate-log.md](../../golden-gate-log.md)
- Progress log: [../log.md](../log.md)

## Implementation plan (merged 2026-09-03 from the former separate plan file)

### Confirmed boundary

P1-15 adds one auditable artifact-revision path for structured field documentation. It consumes the existing job/project targets, instruction evidence requirements, document storage, scoped responsibilities, attention pipeline and P1-14 lifecycle. It does not create a second task, document, lifecycle, blocker, time, material, commercial or customer-package system.

The shipped artifact kinds are `site_diary` (Bautagebuch), `work_report` (Arbeitsbericht), `measurement` (Aufmaß), `defect` (Mangel) and `change_work` (Regie-/Änderungsnachweis). Each artifact has exactly one job or project target and one stable identity. Every explicit save appends an immutable revision and advances an optimistic version; unsaved input stays local. Correcting decided content requires a reasoned new revision. Earlier revisions and their evidence remain visible, and decided artifacts are voided rather than deleted.

### Structured content

Every revision stores the target, optional work site and instruction, capture time, author, internal or customer-facing visibility, title, summary, customer statement, documents and source references. Type-specific fields are constrained:

- Bautagebuch: work date, progress, people present, weather/site conditions, deliveries, impediments, decisions and notable events.
- Arbeitsbericht: visit interval, performed and outstanding work, time/material references, measurements, defects, customer statement and next visit.
- Aufmaß: date, location/area and positive quantity rows using `piece`, `meter`, `square_meter`, `cubic_meter`, `liter`, `kilogram`, `hour` or `flat_rate` (`Stk.`, `m`, `m²`, `m³`, `l`, `kg`, `Std.`, `Pauschale`). Quantities use positive `numeric(14,3)` values. P1-15 does not claim a VOB/DIN formula, room book or price calculation.
- Mangel: description, severity, location, responsibility, due date, state, proposed solution and evidence. Closure requires a resolution summary and proof.
- Regie-/Änderungsnachweis: changed work, reason, requester/context, expected and actual labor, material references, evidence, authorization state and schedule impact. Commercial contract or price acceptance remains outside this slice.

A draft requires a target, kind, title, capture time, visibility and meaningful type field. Submission validates the complete required shape. Customer actions and signature capture apply only to customer-facing revisions.

### Revision, decisions and signatures

All mutations carry the expected artifact version and a client-generated UUID. Duplicate requests return the committed result; stale requests write nothing and leave the local form intact. Submission, review, customer response, signature, export and void events are append-only and reference the exact revision.

The supported actions are `review_requested`, `review_withdrawn`, `internal_approved`, `internal_rejected`, `correction_requested`, `customer_acknowledged`, `customer_refused`, `customer_reserved`, `signature_captured`, `exported` and `voided`. Internal approval uses the new scoped responsibility `work_artifact_approval` (Arbeitsnachweise freigeben), including role defaults, selected assignments, action-time delegation and Four-Eyes. A revision author cannot approve their own revision.

Customer responses are captured in person by a logged-in actor. The immutable event records name, role or relationship, company/context, database time, method, exact wording, refusal or reservation, witness and an optional drawn or uploaded mark linked through the document domain. It creates no customer account and makes no identity or legal-sufficiency claim. The UI always states:

> Die erfasste Bestätigung oder Unterschrift dokumentiert den Vorgang zu genau dieser Version. WerkFlow bestätigt damit keine besondere Rechtswirksamkeit und keine qualifizierte elektronische Signatur.

### Documents and deterministic export

Documents remain Postgres metadata plus private Cloudflare R2 bytes. A normalized relation links an existing document to one exact artifact revision as supporting evidence, closure proof, signature mark or rendered export. Ordinary photos remain ordinary documents unless a user deliberately establishes the relation. Existing document byte versions do not replace business revisions.

Export generates deterministic, self-contained UTF-8 HTML with A4 print CSS and a `.html` filename. It carries artifact ID, revision ID and number, status, renderer version and content hash. The application renders the same safe structured content for preview, uploads the exact bytes to R2, creates an existing-category `report` document and links it as `rendered_export`. Revision, renderer and hash make retries idempotent. Partial metadata/storage failures expose recovery and clean up unregistered objects.

### Permissions and visibility

- Admin/Büro may create and revise any organization target, submit, capture customer responses, export and void. Effective `work_artifact_approval` holders may decide internal review when Four-Eyes passes.
- An assigned field worker may create, revise, submit, capture customer responses and export for an assigned job, or a project with at least one assigned child job. They cannot internally approve. They may void only their own unsubmitted draft.
- Unassigned and foreign-organization users have no access.
- Full technical audit, responsibility snapshots, idempotency context and sensitive signature context are manager-only. A capturing actor may see the signature evidence they recorded.

Database helpers re-resolve organization membership, assignment and responsibility at action time. Authenticated server actions call atomic service-role RPCs; database functions stamp server time. New helpers stay private, public execution is revoked, RLS and explicit grants enforce least privilege, and query/index boundaries retain organization predicates.

### Attention, instruction evidence and lifecycle gates

The shared attention projection gains `work_artifact_review`, `work_artifact_correction` and `work_defect_due`, keyed by stable artifact/revision/action state so current changes re-surface without duplicates. Work artifacts and active instruction-evidence fulfilments are operational Realtime tables with replica identity full. Immutable revisions, details, relations and actions remain unpublished ledgers. Existing jobs, projects, documents and responsibilities cache tags own revalidation; no parallel artifact cache is introduced. Dialog Realtime refresh is suspended and caught up after close.

P1-15 deliberately fulfils an instruction evidence expectation only through an exact document or artifact-revision relation. Unfulfilled required evidence blocks execution completion. Defects and formal approvals become assessable for current revisions. Measurements become assessable when explicitly present; otherwise they remain not assessable. Customer decision and signature become assessable only where the current revision requires them. A new revision, reopen, correction, refusal/reservation or changed fulfilment invalidates the P1-14 gate fingerprint.

Open defects, ordinary pending review, measurement gaps and optional customer outcomes warn at execution completion. Required customer/signature outcomes and unresolved linked approvals prevent ordinary handover; managers retain the P1-14 version-bound reasoned exception. Refusal or reservation is a recorded outcome rather than a fabricated acknowledgement. P1-14 declared approval dependencies may link one exact current approved action. Defects do not become a second blocker model.

Time-segment completeness (`P1-21`), material consumption (`P1-27`), handover package (`P1-17`) and tool custody (`P1-32`) remain not assessable. P1-15 reads time and material references but never copies, mutates, approves or bills them. It changes no schedule, dispatch, actual time, stock, invoice, message or customer package.

### Schema and rollout

The schema adds constrained enums; `work_artifacts`; immutable `work_artifact_revisions`; measurement, defect and change detail tables; exact revision document/source relations; append-only actions; and active instruction-evidence fulfilments. The existing responsibility enum gains `work_artifact_approval`, and declared approval dependencies can reference one approved artifact action. Foreign keys and checks enforce exactly one target/source, organization consistency, positive quantities, decision-to-revision identity, reason requirements and safe void/delete behavior.

Atomic RPCs create revisions, record actions, void artifacts, link documents/sources, fulfil instruction evidence, link an approval dependency and finalize an export. Private authorization, validation, projection and lifecycle helpers serve them. Deployment is additive with zero business-row backfill.

Committed migrations are applied to DEV `mbkkzuqjbdvzelqvuzcn` first. DEV verification covers constraints, RLS, grants, organization isolation, publication, replica identity, advisors, idempotency, stale versions, teardown and preservation. Public types are generated once from DEV after the final batch. Identical migration SQL is then applied to production `jbgaqpdjauzoocplgdsn` through the migration API. Production must retain every existing job, project, instruction, document, link, time entry, occurrence and inventory movement and receive zero fabricated P1-15 business rows.

### UI

Job and project detail pages gain an `Arbeitsnachweise` section between instructions and general documents; no route is added. The list and detail dialog show status, current structured content, evidence, sources, actions, history and export preview. Forms use the registered Select, SearchableSelect, DatePicker, TimeInput/DateTimeField, QuantityStepper, document dialogs, MetadataSection, Banner, ErrorText, Skeleton, FormDisclosure and DialogBody patterns. One small accessible pointer-based `SignaturePad` is added because the registry has no equivalent. Main mobile actions retain at least 44 px targets and real forms submit with Enter.

### Verification

- Golden: `tests/golden/p1-15.spec.ts`, tagged `@P1-15`.
- Exhaustive Wave 2 audit: `tests/audit/wave-2/p1-15.spec.ts`, describe tags `@AUDIT-W2-P1-15 @AUDIT-W2`, using run-day offsets `+80…+84` at 06:00 Europe/Berlin.
- Affected Wave 1: A1 for job/project/document/task/permission surfaces and A5 for attention/responsibility. A2, A6 and A7 are not affected because this slice adds no customer-detail timeline, schedule, calendar or dispatch behavior.
- Focused inherited coverage: P1-13 evidence expectations and P1-14 lifecycle gates.
- Unit coverage: artifact/revision validation, exact targets, correction history, action projection, Four-Eyes, role matrix, attention identity, gate invalidation, document relations, export identity, stale versions, idempotency and work with no artifacts.

The Golden left-behind state is one run-scoped project/job with all five kinds, immutable revision history, one fulfilled evidence requirement, a closed approved and reopened defect history, a customer reservation, a signature on an older revision and a registered deterministic HTML export. The Wave 2 state retains the same bounded current facts needed by later slices. Teardown leaves no active clock, in-flight upload, browser-owned transaction, outbound message, invoice, customer package or untracked storage object.

Testing rules 8–13 apply. After the last review-sensitive change, one fresh production build is frozen; the final focused `@AUDIT-W2-P1-15` run precedes one complete Golden run. No application or Golden change may occur between them.

### Non-goals

No complete field work pack (`P1-16`), office-reviewed handover/customer package (`P1-17`), installed equipment (`P1-18`), explicit time segments (`P1-21`), inventory reservation/consumption/procurement, commercial contract or price acceptance (`P1-37`/`P1-38`), broad document capture/OCR/retention/sharing (`P1-44`/`P1-45`), outbound communication, qualified electronic signature, generic form/workflow builder, external provider, worker or paid resource is included.
