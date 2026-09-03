# Conceptual Data Model

Status: living — last reviewed 2026-09-02

This document describes WerkFlow's domain model at a conceptual level. It is not a schema dump.

For exact tables, columns, enums, functions, and relationships, use live Supabase inspection and `lib/supabase/database.types.ts`.

## Source Of Truth

- Exact database state: live Supabase through MCP/plugin workflow.
- Generated TypeScript schema: `lib/supabase/database.types.ts`.
- App-level domain types and converters: `lib/jobs/types.ts`, `lib/time-tracking/types.ts`, and related feature modules.
- Product intent: `AGENTS.md`.

Do not maintain column-by-column database documentation here. Update this file only when the conceptual domain model changes.

## Tenant Boundary

WerkFlow is organization-scoped. Most operational data belongs to an `organization_id`.

The organization is the workspace/company boundary for:

- Members and roles.
- Personnel records, their access and employment lifecycles, and protected personnel documents.
- Jobs and projects.
- Customers.
- Planning and dispatch.
- Service: installed equipment, service cases, and maintenance.
- Time tracking, time accounts, and periods.
- Settings and preferences.
- Documents.
- Inventory.

Users can belong to multiple organizations. Features must be explicit about whether data is user-scoped, organization-scoped, or both.

## Identity And Roles

Core concepts:

- Profile: app-level user profile connected to Supabase Auth.
- Organization: tenant/workspace for a business.
- Organization member: relation between user and organization.
- Role: `admin`, `buero`, or `employee`.

Current user-facing role labels:

- `admin`: Admin
- `buero`: Büro
- `employee`: Handwerker/in

Role behavior should be designed around the product context:

- Business owners and admins need control and oversight.
- Büro/office users need operational coordination tools.
- Field workers need simple, mobile-friendly flows with minimal room for mistakes.

## Scoped Responsibilities And Delegation (P1-05)

Responsibilities restrict a small number of operational actions without turning the fixed role enum into a generic permission system:

- Responsibility vocabulary: `time_approval`, `leave_approval`, `work_artifact_approval` and `work_handover_review`. They are stored as stable English enum values and presented as **Zeitfreigaben**, **Urlaubsfreigaben**, **Arbeitsnachweise freigeben** and **Übergaben prüfen**.
- Responsibility configuration: append-only, organization-scoped effective versions. `role_default` snapshots active Admin/Büro memberships; `selected` snapshots a non-empty named holder set. The effective version is the newest `effective_from <= action time`, with deterministic tie-breaking. Organizations received default snapshots, so migration changed no existing authority. Since `P1-06` the server-side action time is clock-skew guarded: configurations are stamped with the database clock, so an app server whose clock trails the database floors its action time to the newest configuration timestamp — a just-applied configuration is always effective at the next action and a freshly revoked holder can never remain authorized for the skew window.
- Responsibility assignment: an immutable member of one configuration snapshot, keyed to `employee_record_id`. The personnel record supplies the organization-stable person identity; authorization is only effective while that record is linked to an active organization membership/login. An assignment source is `role_default` with its role snapshot or `direct`.
- Responsibility delegation/substitute: references a base holder record and substitute record in the same organization and responsibility. `valid_from` and `valid_until` are inclusive Europe/Berlin business dates; `revoked_from` is the first date on which an early-ended window no longer applies. Rows are retained, not deleted, so historical authority remains reconstructible.
- Responsibility event: append-only, actor-attributed audit for configuration snapshots and substitute creation/end with before/after details. It is a responsibility-domain log rather than an `employee_record_event`, because each fact concerns an organization action contract involving multiple people.
- The pure `resolveEffectiveResponsibility` result identifies holders via `role_default`, `direct_assignment`, or `delegation` (including the inherited base source). Approval scope and self-approval checks consume that result; the responsibility data is not a second independent permission matrix.
- Reads are self-or-manager through `app_private` SECURITY DEFINER helpers; ordinary employees can see only rows involving their own employee record. Writes use owner-authorized service-role RPCs plus organization-validation triggers. A unique partial constraint and ownership triggers keep exactly one owner/admin membership; selected sets cannot be empty and their sole base holder cannot be removed.

## Shared Attention Pattern (P1-07)

One role-aware task/approval/notification pattern serves every feature instead of per-feature inboxes. Its data-model rule is strict: **attention items are derived, never stored.**

- An attention item is identified by `source_type` + `source_id` (e.g. `vacation_request_approval` + the request id). The vocabulary includes time/vacation approvals, customer requests/follow-ups, sickness and qualification facts, work-artifact review/correction/defect facts and, since P1-17, `work_handover_review` for execution-complete work without a current release. Later slices extend this vocabulary and the database CHECK constraints on BOTH pattern tables plus the `app_private.validate_attention_source_org` trigger — they never add parallel item storage.
- Items are resolved live by the server boundary (`lib/attention/actions.ts` + the pure helpers in `lib/attention/resolution.ts`) from the owning domains through their own loaders and authorization paths (`time_approval`/`leave_approval` responsibility resolution at derivation time, manager role for requests). There is no materialized task table, so a decision made on any surface can never leave a stale copy behind. Deduplication (one item per source record per viewer, regardless of how many authorization paths apply) happens in the resolver.
- The only stored pattern state: `attention_read_states` (per-user read markers keyed by item identity plus an opaque `state_version`; a domain state change — e.g. approve → cancel — produces a new version and makes the same item unread again) and append-only `attention_events` (pattern-level audit: who marked what read, when). Neither table duplicates a domain column; every disappearance of an item is explainable from the owning domain's own history.
- Access: read markers are strictly self-scoped SELECT (`user_id = auth.uid()`), pattern events self-or-manager; all writes are service-role server actions. A validation trigger checks membership and that the referenced source row lives in the same organization. Both tables are Realtime-published with minimal `USING INDEX` replica identity (`(id, organization_id)` — the Stage B posture for every published organization table; the transport section of [realtime-and-caching.md](realtime-and-caching.md) explains why FULL is forbidden).
- Decision notifications are derived from the domain rows themselves (a decided/cancelled vacation request within a bounded window), not materialized at decision time — the P1-06 actions stay untouched and notification truth cannot drift.

## Personnel Domain (P1-03)

Employment identity is organization-scoped and deliberately separate from the global profile:

- Employee record (`Personalakte`): one per person per organization, holding practical master data (employee number, contact/address, emergency contact, entry/exit dates, notes). `user_id` is nullable — future starters and non-login personnel exist as records without an account; a pending invite can be remembered on the record and redeeming it links the login to the existing record instead of creating a duplicate. Every membership-creation path auto-creates a record via trigger; the personnel record survives destructive member removal and is marked exited.
- Employment condition: date-effective versions per employee record keyed by `valid_from`; the condition effective on a date is the newest version on or before that date. Later changes never silently rewrite what was true for past work and time (time tracking's `P1-04` is the first consumer). No compensation fields exist.
- Employee record event: append-only, actor-attributed audit of material personnel changes with before/after payloads (same pattern as request and document audit events).
- States are derived, never stored: employment `aktiv`/`geplant`/`ausgeschieden` from entry/exit dates, access `mit Zugang`/`eingeladen`/`ohne Zugang` from the linked user/invite.
- Access: manager-only SELECT RLS; all writes through service-role server actions with org-validation triggers. Operational pickers (assignment, time) read memberships, so non-login personnel can never appear in them.
- Work schedule (`P1-04`): date-effective weekly-pattern versions per employee record (minutes per weekday, `valid_from` semantics like conditions). The schedule wins over the condition's contractual weekly hours for time targets. SELECT RLS is self-or-manager — the first employee-self read path on personnel-adjacent data; writes stay service-role with the same audit trail.
- Organization holiday context (`P1-04`): the org's selected German-state holiday calendar (in-code dataset; selection with effective-from history on organization settings, `break_policy_history` pattern) and dated closure-day rows (today/future edits only). Daily targets are computed, never stored: schedule → condition-derived → visibly labeled 8h default, with holidays/closure days forcing 0. Later config changes never silently rewrite what was true for past days.
- Vacation request (`P1-06`): org-scoped, keyed to the employee record, with an inclusive Berlin date range, a day portion (`full`/`half_day`, half only for single days), and lifecycle `pending` → `approved`/`rejected`/`withdrawn`, plus `cancelled` from `approved` (approver-only retroactive correction with reason). A gist exclusion constraint forbids overlapping own requests in non-terminal states. Approved requests snapshot consumed entitlement days per calendar year at decision time so later configuration changes never rewrite a decided balance; entitlement itself is read from the newest employment condition of the vacation year. Approved vacation feeds the daily-target resolver as a discriminated absence input (never a parallel `istImUrlaub` flag). Authority comes exclusively from the `leave_approval` responsibility resolved at action time. Append-only vacation request events audit every transition. Reads are self-or-manager via `app_private` helpers; writes are service-role with organization-validation triggers.

- Sickness report (`P1-08`): org-scoped sibling of the vacation request, keyed to the employee record, but semantically a REPORTED FACT — status is only `reported` → `cancelled` (reason required when cancelling someone else's report); everything else (end date set, dates/portion/type corrected) is an update on the same row audited in append-only `sickness_report_events` with before/after. `end_date` is nullable (open-ended, „bis auf Weiteres"); retroactive entry is first-class; a gist exclusion constraint (`daterange` with `infinity` upper bound for open reports) forbids overlapping own ACTIVE sickness only — overlap with vacation is deliberately possible and has no automatic balance effect. The neutral type vocabulary (`krankheit`/`kind_krank`/`sonstige`) and the evidence state (`evidence_required` + `not_required`/`pending`/`received`, kept consistent by a CHECK) are the only sensitive-adjacent fields; there is NO note/diagnosis column by design. Active sickness feeds the same daily-target absence input as vacation (second union variant, open ends clamped by the loader). Reads are self-or-manager via the `app_private` helpers; writes are service-role (self-report, manager entry/corrections) with organization-validation triggers; Realtime-published with minimal `USING INDEX` replica identity.

### Controlled People Lifecycle (P1-24)

- `employee_records.id` stays the stable organization-specific person identity. Auth users, profiles, memberships and invitations remain distinct rows; P1-24 keys every new table to the personnel record.
- `personnel_access_lifecycles` is the versioned organization-access root with states `not_configured`, `scheduled`, `active`, `suspended` and `ended`; `personnel_access_transitions` is its immutable history. A record without a lifecycle row keeps the pre-P1-24 membership behavior. Effective authorization uses the database clock, suspension is organization-scoped and never disables the global Auth user, and the organization owner or last effective Admin cannot be suspended or ended without a safe successor.
- `personnel_employment_lifecycles` is the separate versioned employment root with `planned`, `active`, `notice`, `inactive` and `exited`; `personnel_employment_transitions` is immutable. Existing records keep their date-derived presentation until a controlled lifecycle starts. Before a transition completes, the domain inventories responsibilities, pending approvals, attention items and active assignments; the last effective responsibility holder blocks completion, other open work remains a visible reasoned exception. P1-33 owns final closure, physical return and destructive removal.
- `personnel_documents` is protected metadata over the ordinary `documents`, `document_versions`, `document_audit_events` and private direct-to-R2 path. Its owner is `employee_records.id`, not `document_links.employee_id`, and one document belongs to at most one protected row. Access classes are `personnel_standard`, `admin_restricted` and `health_evidence`; access never follows a responsibility, an ordinary document permission, a job assignment or a planning role. `personnel_document_releases` and `personnel_acknowledgements` bind an exact document version. An acknowledgement records that the person saw one version at one time and makes no signature or legal-sufficiency claim.
- `personnel_onboarding_templates` own immutable published `personnel_onboarding_template_versions` and items; no template is seeded. `personnel_onboarding_plans` are editable instances whose `personnel_onboarding_requirements` carry typed requirements of kind `document`, `qualification`, `employment_condition`, `work_schedule`, `team`, `access`, `acknowledgement` or `manual` and state `missing`, `pending`, `fulfilled`, `blocked`, `waived` or `cancelled`. `personnel_requirement_references` points at exact rows in the owning domains and copies nothing. Only an explicit access-blocker requirement prevents activation, and missing configuration never renders as complete or compliant.
- `personnel_lifecycle_operations` is the immutable idempotency receipt ledger. Writes are atomic service-role RPCs with organization-validation triggers and composite foreign keys; the protected-document classifier is a private caller-independent helper, and the public wrapper checks bind to `auth.uid()`. Export is a bounded per-person manifest plus the existing authorized downloads; P1-45 owns retention and legal hold.
- Seven mutable roots are Realtime-published: both lifecycle roots, `personnel_documents`, `personnel_document_releases`, templates, plans and requirements. Transitions, template versions and items, acknowledgements, requirement references and operation receipts stay unpublished immutable history.

## Work Domain

The core work domain is job/project management.

Concepts:

- Customer (`Kunde`): private or commercial client, with an optional manual org-unique customer number.
- Request (`Anfrage`): an operational customer request captured during intake. It references (never copies) the customer/contact/site when known, or carries provisional free-text caller identity until matched or promoted to a customer. Lifecycle: `offen` → optional `in_klaerung` → terminal `umgewandelt` (converted exactly once into a new standalone job or project, race-safe, attributable) or `geschlossen` (with reason, reopenable). Attachments are documents linked via `document_links`; conversion adds a second link to the created work. Every material change is recorded in an append-only per-request event log. Requests are a manager-only surface.
- Contact (`Ansprechpartner`): a person belonging to exactly one customer, with a free-text role, channels, a primary marker, and an archive state. Contacts are never shared across customers or silently merged.
- Work site (`Einsatzort`): a durable operational location belonging to exactly one customer, with a structured address, access notes, an optional on-site contact, a primary marker, and an archive state. A site is master data, not copied address text.
- Manual follow-up (`client_follow_ups`, P1-10): an authoritative, organization/customer-scoped next action with owner, exact due time, open/completed/cancelled state, and optional exactly-one source reference (`contact`, `site`, `request`, `job`, or `project`). Every create/update/reassignment/transition appends `client_follow_up_events`; the shared attention item is derived as `client_follow_up:<follow_up_id>` rather than stored separately.
- Communication guidance (`client_communication_settings` + `client_communication_preferences`, P1-10): one optional general settings row per customer plus purpose/channel rules at customer-default or contact-override scope. States are explicit `allowed`/`disallowed`/`unknown`; absence means unconfigured, never inferred consent. Append-only `client_communication_preference_events` preserves settings, preference, and documented-exception attribution. These records do not represent message delivery or a legal conclusion.
- Relationship timeline (P1-10): no table. A typed server resolver queries bounded windows from the owning current rows and event ledgers, merges them by `occurred_at` plus stable `<kind>:<source_id>` tie-breaker, and renders source links. Current-row fallback keeps requests visible even when their best-effort event append is absent; mutable source facts are never dual-written into a generic history store.
- Project (`Projekt`): a larger body of work that may contain multiple jobs. A project may carry a default site/contact that prefills new jobs; each job can override it (no forced sync).
- Job/order (`Auftrag`): a concrete unit of work, either standalone or under a project. A job may reference one of its customer's sites and contacts. The job's free-text location is a snapshot taken when a site is selected; site edits never rewrite it, preserving the historical execution location.
- Assignment: connection between a job and one or more employees.
- Instruction item: the shared task/checklist primitive attached to exactly one job or project. P1-13 adds required/optional state, grouping, notes, template application/source attribution, expected-evidence children and same-target structural dependency children. Existing completion actor/time remains authoritative; there is no parallel template-task runtime.

### Work Template Domain (P1-13)

- `work_templates` is the stable organization-scoped identity and target type (`job` or `project`); archive is visibility, not deletion.
- `work_template_versions` owns numbered snapshots. A template can point to one editable draft and one current published version. Published versions and their item/evidence/dependency/material/capability children are database-immutable.
- `work_template_applications` binds one exact published version to one job or project, records actor/time and a retry key, and is serialized per target. Application materializes into existing instruction, material and capability tables; origin columns preserve the source without making later reads reference mutable template content.
- Capability application merges the existing authoritative target requirement by capability and never weakens `require_confirmation`; origin rows preserve every contributing template application. Evidence expectations are metadata, not documents. Dependencies are structural declarations only.
- Mutable operational tables use organization-scoped RLS and service-role-only business RPCs. `work_template_events` is append-only manager history. No deploy-time template rows are seeded.

### Work Lifecycle Domain (P1-14)

- `jobs.execution_state` owns the fixed execution state for explicitly touched work and `jobs.execution_version` serializes changes. The state remains nullable on pre-P1-14 rows; a conservative resolver projects their existing `job_status` without inventing history. The old status remains a compatibility projection for current readers.
- `projects.execution_state_override` is an optional reasoned manager override with `execution_version`; without it, `app_private.resolve_project_execution_state` derives the visible state from child jobs and the legacy project projection. Clearing an override returns to derivation and never cascades to children.
- `work_execution_events` is the immutable, attributable transition/override ledger. Each row holds previous/new state, version pair, reason, gate snapshot and SHA-256 fingerprint. `transition_work_execution` and `clear_project_execution_override` are the only direct execution writers; a time-entry trigger invokes the same transition RPC for atomic start/resume.
- `work_blockers` is the one current blocker/parking model for exactly one job, project or instruction item. It carries bounded kind/reason, details, responsible employee record, next review, state and version. `work_blocker_events` preserves creation, edits, resolution, reopen and parking history. P1-12 parking rows/events were migrated and their tables/RPC dropped; no context was fabricated for legacy parked work.
- `work_dependencies` represents one target job/project and exactly one predecessor job/project/instruction or declared approval/delivery/site/external-trade condition, with `blocks_start`, `blocks_completion` or `warning` effect. Organization/target checks, self-links and graph cycles are database-enforced. Linked satisfaction is derived from authoritative state; only declared conditions have an explicit current state. `work_dependency_events` is immutable history.
- `job_instruction_items.completion_version` serializes checklist completion. `set_instruction_item_completion` enforces existing P1-13 same-target predecessors and writes `job_instruction_item_completion_events`; it does not create another task runtime.
- `get_work_lifecycle_snapshot` returns one bounded operational read model. Live readiness remains the application-level P1-12 `composeReadiness` projection; `app_private.build_work_gate_snapshot` captures only current authoritative start/completion facts and labels later-slice facts not assessable.
- Operational blockers/dependencies use narrow manager-or-assigned-work RLS, minimal `USING INDEX` replica identity and Realtime publication. Execution, blocker, dependency and instruction-completion event ledgers are unpublished and immutable. Business writes are service-role-only, action-time authorized, organization-scoped, version-checked RPCs.

### Structured Work Artifact Domain (P1-15)

- `work_artifacts` is the stable organization-scoped identity for exactly one job or project and one bounded kind. `current_revision_id`, status and version serialize current state without overwriting business history.
- `work_artifact_revisions` stores immutable numbered snapshots. Normalized measurement, defect and change-work detail tables enforce their typed fields; exact revision document/source relations preserve evidence provenance.
- `work_artifact_actions` is the append-only review, customer outcome, signature, export and void ledger. Decisions and signatures reference the exact revision; internal approval snapshots the existing scoped-responsibility resolution and enforces Four-Eyes.
- `job_instruction_item_evidence_fulfillments` is the current attributable link from one expected-evidence row to one document or artifact revision. Removal is versioned and reasoned; the expectation itself stays in the instruction domain.
- P1-14 declared approval dependencies can reference one current `internal_approved` artifact action. Lifecycle gate snapshots derive required evidence, customer decisions, signatures, defects and formal approval facts without storing a second lifecycle state.
- Mutable `work_artifacts` and active evidence fulfilments use organization-scoped RLS, minimal `USING INDEX` replica identity and Realtime publication. Revisions, detail rows, relations and actions are immutable unpublished ledgers. Business writes use action-time authorized, organization-scoped, version-checked and request-idempotent RPCs.

### Work Handover Domain (P1-17)

- `work_handover_packages` is one organization-scoped mutable root for exactly one job or one project. It carries the draft version, current state and current immutable release pointer; existing work receives no fabricated row.
- Draft membership selects exact approved work-artifact revisions, exact document versions/storage paths and, for a project, exact immutable releases of its own child jobs.
- `work_handover_releases` is numbered and immutable. It freezes target/customer context, exact membership, gate snapshot/fingerprint, effective responsibility, exception/readiness result, deterministic renderer/content hash and package document identity.
- Release items preserve source identities without taking ownership of source-domain facts. Append-only events preserve save/release/withdrawal/correction/successor history and request-id idempotency.
- Package release and withdrawal are transactionally coupled to the P1-14 lifecycle. A project owns its handover: handed-over children can derive project execution completion but never hand over the project automatically.
- `work_handover_review` extends scoped responsibility without changing fixed roles. Attention remains a live projection from package/lifecycle facts rather than a materialized task row. Only the mutable package root is Realtime-published; immutable releases/items/events refetch behind that signal.

### Installed Equipment Domain (P1-18)

- `installed_equipment` is the mutable organization-scoped identity for one customer site. A row is either a root or one directly owned component; composite foreign keys enforce the same organization, customer and site and exclude deeper nesting.
- Equipment numbers are immutable and organization-unique. `installed_equipment_identifiers` keeps raw and normalized typed identifiers; manufacturer/issuer-scoped serial uniqueness is distinct from non-unique product numbers.
- `installed_equipment_work_links` retains exact job/project, work-artifact revision and immutable handover-release origins with a site/address snapshot. Existing work remains the owner; no job or artifact content is copied.
- `document_links` gained an equipment target with composite tenant integrity. Existing private-R2 documents are reused, and equipment-history guards prevent ordinary unlink or permanent deletion from erasing an immutable event reference.
- `installed_equipment_events` is the append-only lifecycle and correction ledger. Version-checked, request-idempotent guarded RPCs own registration, link and lifecycle/replacement mutations; terminal history is retained rather than overwritten.
- Managers own the complete service read/write model. Employees receive only a compact projection for equipment linked to an exactly assigned job. Only `installed_equipment` is Realtime-published; successful child/history mutations touch the root to signal an authoritative refetch.

### Reactive Service Domain (P1-19)

- `service_cases` is the mutable organization-scoped root for one customer and one site. A request-based case references exactly one `client_requests` row, and qualification stays once-only and atomic; a direct case keeps its own immutable customer statement. A case may name one contact and one operational job. Case numbers are server-derived and organization-unique.
- The case owns only the service thread: triage state, urgency, access guidance and suspected warranty, contract, goodwill, rework or charge context. States are `new`, `clarification_needed`, `visit_required`, `follow_up_required`, `resolved`, `closed_without_visit` and `duplicate`. The charge context is operational triage and never a legal or final commercial decision.
- `service_case_equipment_links` binds a case to exact P1-18 equipment rows from the same customer and site; composite foreign keys and a validation trigger keep every link on the case's customer and site, and a write guard refuses any write that does not come through the domain RPCs. `service_case_relations` records duplicate, related and continuation links between two cases and preserves both identities. Nothing is merged or deleted.
- `service_case_evidence_links` references exact `work_artifact_revisions`. Documents attach through a `service_case` target on `document_links`, and a guard prevents an ordinary unlink from erasing an immutable history reference.
- Due next actions stay P1-10 follow-ups. Visits reuse planning occurrences, P1-12 dispatch, P1-14 lifecycle, P1-15 artifacts and P1-16 field packs; the case copies none of those facts.
- `service_case_events`, relations and evidence links are immutable by trigger. Only `service_cases` is Realtime-published, and a successful child mutation touches the root. Admin and Büro own the model; employees receive only case number, issue, urgency, access guidance and linked equipment for an exactly assigned job.

### Maintenance Domain (P1-20)

- `maintenance_plans` is the mutable root for one customer site with states `draft`, `active`, `suspended` and `terminated`; archiving changes visibility only after termination. `maintenance_plan_revisions` are numbered snapshots, each covering one or more exact P1-18 equipment rows at that site through `maintenance_plan_revision_equipment` and referencing exactly one published P1-13 template version. Revisions are immutable snapshots by contract, and write guards on plans, revisions and their equipment rows refuse any write outside the domain RPCs.
- `maintenance_coverages` is a separate service record for operational coverage: entered dates, an internal review date, status, notes and one exact document link. Commercial or legal contract truth stays outside the domain. Overlapping active coverage needs an explicit reason rather than a uniqueness ban.
- `maintenance_due_work` exists before any job. States are `open`, `visit_created`, `completed`, `skipped`, `cancelled` and `superseded`; the completion outcome is separately `complete`, `partial` or `unresolved`. Activation generates an 18-month horizon. Reads never generate rows; creation, revision, resumption, completion and explicit extension advance the horizon idempotently.
- Each revision chooses `planned_due_date` or `actual_completion_date` as its next-due basis. Missing or contradictory next-due facts stay a visible exception and are never repaired silently.
- A maintenance visit is a normal job that a manager creates deliberately with the revision's exact template version. Its calendar occurrence exists only once scheduled, and moving one appointment never alters the maintenance sequence. Several compatible due-work rows may share one job and occurrence while keeping separate identities and histories.
- `maintenance_due_evidence_links` and `maintenance_service_case_links` reference exact P1-15 artifact revisions and P1-19 cases. P1-14 keeps execution gates, P1-15 keeps artifact revisions, P1-18 keeps equipment history, P1-19 keeps reactive follow-up cases and P1-10 keeps assigned follow-ups.
- The coverage, plan and due-work event ledgers and both link tables are immutable by trigger. Only `maintenance_coverages`, `maintenance_plans` and `maintenance_due_work` are Realtime-published. Employees get compact context for an exact assigned visit job; coverage dates, renewal risk and internal notes stay manager-only.

Ownership rule: sites, contacts, manual follow-ups, and communication guidance belong to the customer domain; work only references them. Changing the customer of a job or project clears references to the previous customer's sites/contacts (server actions enforce consistency; database triggers validate org/client integrity). Customer master and P1-10 relationship reads are manager-only under RLS; field workers receive only purpose-limited context through assigned work.

Projects can have derived state based on child jobs unless manually overridden. Jobs can be scheduled, assigned, parked, completed, and connected to customers and time entries.

## Planning Domain (P1-11)

Planning coordinates work without becoming a second job, employee, absence, or time system.

- `planning_series` stores a bounded recurrence definition and durable segment lineage. Splitting `diese und zukünftige` closes the prior segment and creates a successor with the same lineage; past and already-started occurrences are never rewritten.
- `planning_occurrences` stores materialized one-off and recurring visits. Recurring identity is the organization, lineage, and original Europe/Berlin local start, so horizon extension is idempotent even across DST. The row carries planned instants/status; job visits reference one authoritative job, while internal entries alone own a bounded title/description/type.
- `creation_request_id` on `planning_series` and `planning_occurrences` binds a client-generated creation key to one organization-scoped result. The atomic create RPC takes an advisory lock on organization plus key and returns the existing series/occurrence ids on a retry, so a lost response cannot duplicate work.
- `planning_occurrence_assignments` links occurrences to stable `employee_records`, not only login-bearing memberships. This controls planning visibility. `job_assignments` remain the authority for ongoing job responsibility and field access.
- `planning_occurrence_assessments` records attributable, fingerprinted capacity/qualification snapshots and any explicit manager override reason. `planning_events` is the append-only lifecycle ledger for creation, edits, series splits/reschedules, materialization, skip, and cancellation.
- Capacity is derived at action time from date-effective schedules/fallbacks, holidays, closure days, approved and provisional absence, and interval overlap. It is not a stored employee-capacity balance. Qualification and team expansion likewise resolve for each occurrence date.
- The legacy job planning columns remain a compatibility projection during this phase. Planning RPCs update the occurrence source and projection atomically; a bridge keeps older job mutations additive. Actual `time_entries` are never changed by planning operations.

Operational planning tables are organization-scoped. Manager roles can read organization planning; employees can read only assigned occurrences and their own assignment rows. Assessment/event ledgers are manager-only. All writes use narrowly granted service-role RPCs with database-side organization, membership, source-ownership, and state validation.

## Dispatch Domain (P1-12)

Dispatch turns a plan into an issued, confirmable work instruction without becoming a second schedule, inbox, or messaging system.

- `planning_dispatches` is the stable dispatch identity with an enforced exclusive target: exactly one `job_visit` planning occurrence XOR one genuinely unscheduled job (partial unique indexes allow at most one ACTIVE dispatch per target). `creation_request_id` makes issuing idempotent per organization.
- `planning_dispatch_revisions` is the append-only record of the work instruction actually issued: target snapshot, planned instants/dates, location source, dispatch note, and a SQL-computed `material_fingerprint`; the dispatch's `current_revision_id` points at the newest. Readiness snapshots/fingerprints are stored at issue time for audit and stay null on system supersessions.
- `planning_dispatch_recipients` keys recipients to stable employee records per revision. `planning_dispatch_acknowledgements` is append-only per (revision, employee record): `acknowledged`, `challenged` (bounded reason, resolution fields), or `carried_forward` (traceable lineage when only the recipient set changed); the acting user is recorded separately, and derivation is latest-row-wins. A record without an active login derives the labeled „nicht möglich" state.
- Deferred, fingerprint-idempotent triggers on occurrence material columns/status and on occurrence assignments supersede the current revision in the same transaction as any schedule mutation (single edits, series operations, the batch RPC, the legacy bridge); parking a job cancels its dispatches; inserting the first scheduled occurrence for a job-targeted dispatch retargets it as a traceable `target_scheduled` transition. `planning_dispatch_events` is the append-only ledger.
- P1-14 supersedes the former `job_parking_contexts`/`job_parking_events` pair with `work_blockers(kind = 'parking')` and `work_blocker_events`; the historical migration is described in the lifecycle section above.
- `planning_customer_commitments` stores explicitly recorded customer agreements per occurrence (day, optional arrival window, source channel, actor; one active per occurrence with a supersede/withdraw chain and events). Schedule moves never rewrite a commitment — mismatch is a derived, visible state. Nothing in this domain represents message delivery or consent (`P1-46`).
- Batch rescheduling is one all-or-nothing, version-checked, idempotent RPC over explicitly selected future occurrences; it maintains the P1-11 legacy job projection and writes per-occurrence assessments/events plus one `batch_rescheduled` summary event.
- Access: manager-or-recipient SELECT on dispatch operational tables; manager-only on events, parking context, and commitments; all writes via service-role RPCs with organization validation. Attention extends the P1-07 taxonomy (`dispatch_acknowledgement` versioned by current revision, `dispatch_challenge_open` identified by the challenge row, `job_parking_review`) — derived, never stored.

## Time Domain

Time tracking has stable attendance-session and factual activity-segment identities. The former event ledger remains a compatibility source for history that predates `P1-21`.

Concepts:

- Attendance session: one stable start/end identity per presence interval, versioned on every transition.
- Activity segment: one stable work, travel, break, standby/on-call, call-out or internal-activity interval, with optional job allocation where the kind permits it.
- Segment event: append-only transition attribution; operation receipt: idempotent replay ownership for one client request.
- Legacy time entry: an unchanged clock-in, clock-out, break-start or break-end fact used by the compatibility projection; a live legacy sequence is bridged on its first canonical action rather than bulk-backfilled.
- Live clock state: the current session/segment projection for the user in an organization.
- Legacy change request: the retained historical edit/delete workflow for old entries; existing rows keep their meaning but new corrections use the P1-22 aggregate.
- Time correction request: one mutable organization-scoped lifecycle root for add, edit, delete, split, reclassification, reallocation, reassignment and missed-clock proposals across legacy entries, canonical sessions/segments and earlier accepted applications.
- Correction revision/source/event/application: immutable before/proposed revisions, exact source identities and versions, lifecycle attribution and the accepted overlay. A private unique applied-source ledger prevents two accepted applications from consuming the same source; a sequential correction references the prior application explicitly.

Permitted activity segments can be linked to jobs or remain explicitly unallocated. Atomic versioned RPCs validate organization ownership, serialize one employee boundary, preserve append-only attribution and make duplicate requests replay-safe. Europe/Berlin day splitting is a presentation projection and never changes the stable source interval.

P1-22 correction RPCs are service-role-only and revalidate membership, organization, current source versions, expected request revision and effective `time_approval` scope. Pending proposals never mutate the source. Confirmed readers overlay the newest accepted application and suppress its replaced source while preserving every original row and immutable canonical event. Only `time_correction_requests` is published as an invalidation root; immutable correction children remain unpublished.

### Time Accounts, Period Close And Payroll Export (P1-23)

- A period in `time_periods` is one organization-wide calendar month in Europe/Berlin. Its boundaries are stored explicitly so a later, separately approved cut-off model can arrive without rewriting historical periods. Only an ended month may close.
- `time_account_policies` is the mutable root: one versioned default per organization plus named exceptions. `time_account_policy_versions` and their credit, supplement and warning rules are immutable; `time_account_policy_assignments` binds employees to a policy on an explicit Berlin date without overlap. Credit rules use the six existing activity categories at 0, 50 or 100 percent and never change raw recorded minutes. Approved full-day vacation and sickness reduce the target and are classified per policy as paid, unpaid or informational.
- `time_accounts` starts from an explicit opening balance, effective date and reason; deployment never assumes zero and never reconstructs a balance from history. `time_account_events` is the immutable ledger of openings, period postings and approved adjustment, expiry or payout events, stored in minutes and never as money. `time_account_adjustment_requests` is the mutable proposal root; a different effective `time_approval` holder approves, and rejected or superseded requests stay visible.
- A calculation in `time_period_calculations` with its daily results, employee results and result sources is an immutable fingerprinted snapshot. It retains exact source seconds, rounds once per employee, Berlin day and bucket, and stores the rounding delta. Night, Sunday and holiday classifications carry exact sources and may overlap, so those buckets are explicitly non-additive.
- `time_period_findings` and `time_period_finding_decisions` are immutable rows with severities informational, approval-required and close-blocked. Objective readiness defects block close, operational exceptions need an authorized acknowledgement with a reason, and payroll mapping defects block export but not close. One period covers every personnel record whose employment overlaps its boundaries, including people without a login; the population cannot be filtered.
- Close writes an immutable `time_period_close_versions` row instead of toggling a flag. Ordinary edits inside a closed period are refused, and a late P1-22 correction keeps the `period_closed` refusal until an administrator reopens with a reason; recalculation and re-close create a successor version. A closed employee result is `previous balance + credited time - target time + approved account events = closing balance`.
- `payroll_mapping_profiles` is the mutable root over immutable `payroll_mapping_versions`, employee mappings and code mappings. `payroll_exports` versions one deterministic complete-workforce ZIP per closed period version, stored as an immutable document in private R2; a re-export supersedes the earlier export explicitly and `payroll_export_events` is immutable.
- Administrators create policies, confirm openings and reopen periods; effective `time_approval` holders resolve findings, approve overtime and account events and close; Admin and Büro prepare periods and generate exports; employees see only their own account, findings and statements. Writes are wrapper-only service-role RPCs with idempotency keys, expected versions and organization and period locks. Six mutable roots are Realtime-published: `time_account_policies`, `time_accounts`, `time_account_adjustment_requests`, `time_periods`, `payroll_mapping_profiles` and `payroll_exports`. Every ledger, snapshot, finding and mapping row stays unpublished.

## Settings And Preferences

Settings are split across scopes:

- User-scoped settings: profile and account/security.
- Organization-scoped settings: organization details, time tracking rules, and future business-wide defaults.
- User-in-organization preferences: personal preferences within an active organization, such as table column visibility.

When adding settings, decide whether the setting belongs to the user globally, the organization, or a user within a specific organization.

## Inventory Domain

Inventory V1 is implemented. At a conceptual level it separates:

- inventory catalog items and categories;
- storage locations and stock state;
- append-only stock movement history;
- suppliers and item identifiers/barcodes;
- planned job/project material from physical take/return actions;
- basic tool/asset instances;
- import batches and inventory audit events.

`inventory_movements` and `inventory_audit_events` are append-only by application convention only. The RLS policies in migration `20260706110018` grant inventory managers `FOR ALL`, and no immutability trigger exists on either table, unlike the ledgers of every slice since P1-14. The gap is flagged for the hardening pass.

Future procurement, reservation, transfer, lifecycle, valuation, commercial, and automation capabilities are defined in [inventory.md](../features/inventory.md). Inspect live Supabase and generated types before schema-aware work.

## Document Domain

Document management is implemented (Stages 1–4). See [document-management.md](../features/document-management.md) for the feature model and open decisions, and [document-storage-and-access.md](document-storage-and-access.md) for storage paths, the signed-URL flow, permissions and RLS, and the operations reference.

At a high level:

- **Metadata in Postgres:** folders, documents, links to jobs/projects/customers/employees, categories, trash state, versions, audit events.
- **Bytes in Cloudflare R2 (EU jurisdiction):** private `werkflow-documents-dev`/`-prod` buckets with org-scoped paths and direct signed uploads/downloads (`lib/storage/r2.ts`; see [decision 0001](../decisions/0001-infrastructure-stack.md)). `documents.storage_bucket` keeps the logical value `organization-documents`.
- **No automatic folder creation** when jobs, projects, customers, or employee records are created; manual folders, metadata links, and library filters provide operational organization instead.
- **Role split:** managers use `/dokumente`; employees use assigned job contextual sections only.

Exact columns and RLS policies belong in Supabase and generated types, not in this conceptual doc.

## Modeling Rules

- Keep organization boundaries explicit.
- Do not rely on client-provided authorization claims for privileged decisions.
- Keep field-worker flows simple even if the underlying model is rich.
- Preserve auditability where operational records can affect time, stock, billing, or customer documentation.
- Prefer conceptual docs here; exact schema belongs to Supabase and generated types.

The future product-domain boundaries and cross-feature handoffs are mapped in [product-capability-map.md](../product/product-capability-map.md). Update this document when those planned concepts become part of the implemented conceptual model.
