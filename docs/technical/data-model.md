# Conceptual data model

Status: living — last reviewed 2026-10-03

This page states which domain owns which concept, the invariants between domains, and the rules that keep the meaning of history. `lib/supabase/database.types.ts` and live Supabase inspection show the schema. Update this page only when the conceptual model changes.

The [product capability map](../product/product-capability-map.md) owns the planned domain boundaries, [security](security.md) the rules for RLS and privileged functions, and [realtime-and-caching.md](realtime-and-caching.md) publication and freshness.

## Tenant boundary

The organization is the tenant. Every operational record belongs to exactly one organization. A user can belong to several organizations, so each feature states whether its data is scoped to the user, to the organization, or to the user inside one organization.

- A reference between two records must stay inside one organization. The database enforces this with composite foreign keys or validation triggers, not only in application code.
- A privileged decision never relies on a claim that the client supplies.
- Settings have three scopes: the user globally (profile, account security), the organization (business details, time rules), and the user inside an organization (personal preferences such as column visibility). Decide the scope before you add a setting.

## Identity and roles

A profile is the app-level user, connected to Supabase Auth. An organization member connects a user to an organization with one fixed role: `admin` (Admin), `buero` (Büro) or `employee` (Handwerker/in).

The personnel record (`Personalakte`) is the stable identity of a person inside one organization. It is separate from the global profile, the Auth user, the membership and the invitation. A personnel record can exist without a login, for a future starter or for personnel who never log in. Redeeming an invite links the login to the existing record and creates no duplicate. The record survives the removal of the member.

Domains that must work for people without a login reference the personnel record: planning assignments, dispatch recipients, responsibilities, vacation, sickness, time accounts and protected documents. Job assignment and field access reference the membership and need a login.

Each organization has exactly one owner, and the database enforces that.

## Rules that every domain follows

These rules repeat in each domain below. State a deviation in the domain that deviates.

- History is append-only. An event ledger, a revision, a release, a snapshot or a receipt is never updated or deleted. A database trigger refuses the rewrite, also for privileged roles. Organization teardown is the one guarded exception.
- A correction never rewrites the original fact. It adds a new version, a successor or an overlay, and the original stays readable. A later reader can then always reconstruct what was true and who decided it.
- A later configuration change never changes what was true for past work. Date-effective versions answer "what applied on this day". A decision that depends on configuration stores a snapshot at decision time.
- A domain references a fact of another domain by its exact identity or exact version. It never copies the fact. One fact has one owning domain.
- A value that can be derived is derived, not stored: attention items, capacity, daily targets, project state, readiness, the relationship timeline.
- A mutable root carries a version. A business write is an atomic database operation that checks the expected version, the organization and the authorization at action time. A client request key makes a retry return the first result instead of a duplicate.
- A generated record number is unique in the organization and never changes. Job, project, request, equipment, service case and maintenance numbers count per year, personnel numbers count once. The count keeps at least three digits and grows past 999. A generator reads every existing number of its pattern, whatever its length, before it counts on.
- Missing configuration is shown as missing. It never reads as complete, allowed or compliant.
- Field workers get a purpose-limited projection through their assigned work. A rich model must not complicate the field flow.

## Responsibilities and delegation

A responsibility restricts a small set of operational actions without turning the fixed roles into a generic permission system. The responsibilities are time approval, leave approval, work-artifact approval and handover review.

- A configuration is an effective-dated, append-only snapshot of holders. It is either the role default (the active Admin and Büro members) or a named selection, which cannot be empty.
- A substitute covers a base holder for inclusive Europe/Berlin dates. The row stays after the window ends, so past authority remains reconstructible.
- A holder is a personnel record. Authority is effective only while the record has an active membership.
- `resolveEffectiveResponsibility` is the one resolver. Approval scope and self-approval checks consume its result. The responsibility data is no second permission matrix.
- The action time uses the database clock. A configuration that was just applied is effective at the next action, and a holder who was just removed is never authorized because an app server clock trails.

## Attention

One role-aware pattern serves tasks, approvals and notifications for every feature (`/aufgaben`). Attention items are derived, never stored.

- A source type and a source id identify an item. The server resolves items live from the owning domains through their own loaders and authorization. A decision made anywhere therefore leaves no stale copy.
- A new feature extends the source vocabulary and never adds a parallel item store.
- The only stored state is the per-user read marker and an append-only audit of read actions. A change of the domain state makes the same item unread again.

## Personnel

- The personnel record holds practical master data. No compensation fields exist.
- An employment condition and a work schedule are date-effective versions. The version effective on a date is the newest one on or before that date. The schedule wins over the contractual weekly hours for time targets.
- The organization holiday context is the selected German-state holiday calendar with an effective-from history, plus dated closure days. Daily targets are computed, never stored: the schedule first, then the condition, then a visibly labeled eight-hour default. A holiday or a closure day forces zero.
- A vacation request is keyed to the personnel record and uses inclusive Berlin dates. Authority comes only from the leave-approval responsibility at action time. An approved request stores the consumed entitlement days per calendar year at decision time, so a later configuration change does not rewrite a decided balance. Own requests cannot overlap. Approved vacation enters the daily-target resolver as an absence input, not as a separate flag.
- A sickness report is a reported fact, not a request. It is either reported or cancelled. Every other change is an audited update of the same report. A report can be open-ended and can be entered retroactively. Active sickness of one person cannot overlap. An overlap with vacation is allowed and has no automatic balance effect. By design the report has no note or diagnosis field.

### Controlled people lifecycle

- Organization access and employment are two separate lifecycles per personnel record, each with an immutable transition history. A record without a controlled lifecycle keeps its date-derived labels and the plain membership behavior.
- A suspension is scoped to the organization and never disables the global Auth user. The owner or the last effective Admin cannot be suspended or ended without a successor.
- Before an employment transition completes, the domain lists the person's responsibilities, pending approvals, attention items and active assignments. The last effective holder of a responsibility blocks completion. Final closure, physical return and destructive removal belong to planned slice P1-33.
- A protected personnel document is ordinary document storage plus a protected classification that the personnel record owns. Access follows the class and an explicit release of an exact version. Access never follows a responsibility, an ordinary document permission, a job assignment or a planning role. An acknowledgement records that the person saw one version at one time. It makes no signature or legal claim. [The storage reference](document-storage-and-access.md) owns the access path.
- An onboarding requirement points at the exact row in its owning domain and copies nothing. Only an explicit access-blocker requirement prevents activation. No onboarding template is seeded.
- Retention and legal hold belong to planned slice P1-45.

## Customers and requests

- A customer (`Kunde`) owns its contacts (`Ansprechpartner`), work sites (`Einsatzort`), manual follow-ups and communication guidance. Work only references them. A contact or a site belongs to exactly one customer and is never shared or silently merged. Changing the customer of a job or project clears the references to the previous customer's sites and contacts.
- A request (`Anfrage`) references the customer, contact and site when they are known. Otherwise it carries provisional caller text until someone matches it. A request converts exactly once into a job or a project. A closed request can reopen. Requests are manager-only.
- A manual follow-up is the one next-action record. Its attention item is derived.
- Communication guidance states allowed, disallowed or unknown per purpose and channel. Absence means unconfigured and never implies consent. The records represent neither message delivery nor a legal conclusion.
- The relationship timeline has no table. A resolver merges bounded windows from the owning rows and ledgers. Mutable facts are never written twice into a generic history store.
- Customer master data and relationship reads are manager-only.

## Work

- A project (`Projekt`) can contain several jobs. A job (`Auftrag`) is standalone or belongs to a project. A project can carry a default site and contact that prefill new jobs. Each job can override them, and nothing forces a sync.
- The free-text location of a job is a snapshot taken when a site is selected. A later site edit never rewrites it. The snapshot keeps the historical execution location.
- An instruction item is the one task and checklist record, attached to exactly one job or project. Templates, evidence expectations and dependencies extend it. No parallel task runtime exists.

### Work templates

A template has numbered versions. A published version is immutable. An application binds one exact published version to one job or project and copies its content into the ordinary instruction, material and capability records. Later reads never reference mutable template content. Applying a template never weakens an existing capability requirement. Archive hides a template and deletes nothing.

### Execution, blockers and dependencies

- The execution state of a job is explicit and versioned. Work that predates the model has no invented history. A resolver projects its state from the legacy status.
- The state of a project is derived from its child jobs unless a manager sets a reasoned override. Clearing the override returns to derivation and never cascades to the children.
- One immutable ledger records every transition and override with reason and gate snapshot. Starting a clock on a job moves the job through the same transition.
- One blocker model covers a job, a project or an instruction item, including parked work (`geparkt`).
- A dependency names one predecessor or one declared outside condition and its effect: it blocks the start, blocks the completion, or warns. The database rejects self-links and cycles. Satisfaction of a linked dependency is derived from the predecessor's state.

### Site evidence and handover

- A work artifact (`Arbeitsnachweis`) belongs to exactly one job or project. Its content lives in immutable numbered revisions. Reviews, customer outcomes, signatures and exports form an append-only ledger. Each decision and each signature references the exact revision. Internal approval uses the scoped responsibility and enforces four eyes.
- An evidence fulfilment links one expected-evidence row to one document or one artifact revision. Removal needs a reason. The expectation itself stays in the instruction domain.
- A handover package (`Übergabe`) belongs to exactly one job or project. A release is numbered and immutable. It freezes the exact artifact revisions, document versions, gate snapshot and effective responsibility. A correction is a withdrawal and a successor release.
- Release and withdrawal are coupled to the execution lifecycle in one transaction. A project owns its own handover. Handed-over children never hand over the project automatically.

## Service

- Installed equipment (`Anlage`) belongs to one customer site. A row is a root or one directly owned component, with no deeper nesting. The equipment number is immutable and unique in the organization. Equipment references the jobs, artifact revisions and handover releases it came from and copies none of their content. A replaced unit keeps its history.
- A service case (`Servicefall`) belongs to one customer and one site. It owns only the service thread: triage state, urgency, access guidance and the suspected charge context. The charge context is never a legal or final commercial decision. A case from a request references exactly one request. Duplicate, related and continuation links keep both cases. Nothing is merged or deleted.
- A case reuses follow-ups, planning, dispatch, the execution lifecycle and artifacts. It copies none of their facts.
- A maintenance plan (`Wartungsplan`) belongs to one customer site. Its revisions are immutable and reference exact equipment and exactly one published template version. Due work exists before any job and keeps its own identity and history. A read never generates due work. A maintenance visit is a normal job that a manager creates deliberately. Moving one appointment never alters the maintenance sequence.
- Maintenance coverage is an operational record of entered dates and review dates. Commercial and legal contract truth stays outside the domain. Overlapping active coverage needs a reason.
- Contradictory next-due facts stay a visible exception and are never repaired silently.
- Managers own the service model. An employee receives compact context for an exactly assigned job. Coverage terms and internal notes stay manager-only.

## Planning and dispatch

Planning coordinates work. It is no second job, employee, absence or time system.

- A recurrence is a bounded series with a durable lineage. A split for "this and future" closes the old segment and creates a successor. Past occurrences and started occurrences are never rewritten.
- A recurring occurrence is identified by organization, lineage and original Europe/Berlin local start. Extending the horizon is therefore idempotent, also across a DST change.
- A planning assignment references the personnel record and controls planning visibility. The job assignment remains the authority for job responsibility and field access.
- Capacity, qualification and team membership are resolved at action time for the occurrence date. Each assessment is stored as an attributable snapshot with any override reason. No capacity balance is stored.
- Planning never changes recorded time.

Dispatch (`Einsatz`) turns a plan into an issued work instruction that the recipient confirms. It is no second schedule, inbox or messaging system.

- A dispatch targets exactly one job visit or one unscheduled job. At most one dispatch is active per target.
- A revision is the append-only record of the instruction as issued. A schedule change supersedes the current revision in the same transaction. Parking a job cancels its dispatches.
- An acknowledgement belongs to one revision and one personnel record, and the latest row wins. A recipient without an active login shows the labeled state "nicht möglich".
- A customer commitment records an explicit agreement for an occurrence. A schedule move never rewrites a commitment. A mismatch is a derived, visible state. Nothing in this domain represents message delivery or consent.

### Job team and visit plan

A job's assignees (its job team) and the people on each of its visits are two records of one plan, and writes cross between them in both directions. A job scheduled through the job form has one legacy visit, the visit its schedule columns describe. These rules hold after every committed call:

- Every person with a login on a visit of the job that has not started is on the job team, because the job team grants the field access the visit needs. A personnel record without a login can be on a visit and is never on a job team.
- A planning write adds the people of the visits it writes to the job team and removes nobody. Only a job team edit takes a person off the job, and it takes them off every visit of the job that has not started, whatever the visit's status.
- A job team edit that adds a person reaches the legacy visit only, because the job form describes only that visit. A planning write for one visit never changes the people of another visit.
- A started visit is history. A job team edit does not change its people.
- The job's schedule columns are a projection of its first scheduled visit: date, time and, for a timed visit, duration. Without a scheduled visit they are empty. A schedule edit in the job form moves the legacy visit.
- Parking cancels the job's scheduled visits and empties its schedule. The cancelled visits keep their people and the job keeps its team. Unparking into the schedule revives the legacy visit at the new time for the whole selection.
- A series change sets the people of every occurrence it rewrites. The people it replaces stay on the job team.

`app_private.project_plan_onto_job` is the only writer of the plan onto the job. It sets the transaction-local marker `app.planning_projection_write` for its own writes and then restores the earlier value, so the two job-to-plan triggers stay quiet for exactly that write. A marker that outlives its write would disconnect every later job edit in the same transaction from its visit. `sql:job-plan-bridge` (`supabase/tests/job_plan_bridge.sql`) drives every write path and fails on a broken rule, a marker left set, or a second function that sets the marker.

## Time

- An attendance session is one presence interval. An activity segment is one interval of work, travel, break, standby, call-out or internal activity, with a job allocation where the kind permits one. Both have stable identities.
- Entries that predate this model stay unchanged and are read through a compatibility projection. A live legacy sequence is bridged on its first new action. No bulk backfill happens.
- Splitting an interval at the Europe/Berlin day boundary is presentation. It never changes the stored interval.
- A correction never rewrites a raw entry. A correction request holds immutable before and proposed revisions and the exact source versions. A pending proposal changes nothing. An accepted correction is an overlay: readers apply the newest accepted application and suppress the replaced source, and every original row stays. One source cannot be consumed by two accepted applications. Raw time is evidence, so a later reader must be able to see what was recorded and what was decided.

### Time accounts, period close and payroll export

- A period (`Perioden`) is one calendar month in Europe/Berlin for the whole organization. Its boundaries are stored explicitly, so a later cut-off model does not rewrite old periods. Only an ended month can close.
- A time-account policy has immutable versions and is assigned to employees by date without overlap. Credit rules never change raw recorded minutes.
- A time account (`Zeitkonto`) starts from an explicit opening balance with date and reason. Deployment never assumes zero and never reconstructs a balance from history. The account ledger is immutable and holds minutes, never money. A different effective holder of time approval approves an adjustment.
- A period calculation is an immutable snapshot that keeps the exact source seconds and rounds once per employee, day and bucket. Night, Sunday and holiday buckets can overlap and are not additive.
- A period covers every personnel record whose employment overlaps it, including people without a login. Objective defects block the close. Payroll-mapping defects block the export, not the close.
- A close is an immutable version, not a flag. Edits inside a closed period are refused until an administrator reopens it with a reason. A recalculation and a new close create a successor version.
- A payroll export covers the complete workforce of one closed version. A new export supersedes the earlier one explicitly.

## Inventory

Inventory separates the catalog, stock state per location, stock movement history, planned job and project material, and physical take and return. The stock movement history and the inventory audit events are append-only. A database trigger refuses update and delete on both. [inventory.md](../features/inventory.md) owns the planned procurement, reservation, transfer and valuation scope.

## Documents

Metadata lives in Postgres and bytes live in private object storage. A document exists once and reaches work, customers and service records through links. No folder is created automatically. [document-storage-and-access.md](document-storage-and-access.md) owns the storage, access, link, trash and version rules. [document-management.md](../features/document-management.md) owns the feature model.
