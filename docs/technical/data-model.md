# Conceptual data model

Which domain owns which concept, the invariants between domains, and the rules that keep history meaningful. `lib/supabase/database.types.ts` and live inspection show the schema. [Security](security.md) owns RLS, [realtime-and-caching.md](realtime-and-caching.md) publication.

## Tenant boundary

- The organization is the tenant. Every operational record belongs to exactly one organization. A user can belong to several.
- A reference between two records stays inside one organization. Composite foreign keys or validation triggers enforce it.
- Settings have three scopes: the user (profile, account security), the organization (business details, time rules), the user inside an organization (preferences). Decide the scope before you add a setting.

## Identity and roles

- A member connects a profile (the app user over Supabase Auth) to an organization with one role: `admin`, `buero` or `employee` (Handwerker/in). Each organization has exactly one owner.
- The personnel record (`Personalakte`) is a person's stable identity inside one organization. It can exist without a login, and it survives the member's removal. Redeeming an invite links the login to the existing record.
- Planning, dispatch recipients, responsibilities, vacation, sickness, time accounts and protected documents reference the personnel record. Job assignment and field access reference the membership and need a login.

## Rules that every domain follows

State a deviation in the domain that deviates.

- History is append-only. A trigger refuses rewriting a ledger, revision, release, snapshot or receipt, also for privileged roles. Organization teardown is the one guarded exception.
- A correction adds a version, a successor or an overlay. The original stays readable.
- A later configuration change never changes what was true for past work. Date-effective versions answer "what applied on this day"; a configuration-dependent decision stores a snapshot.
- A domain references another domain's fact by exact identity or version and never copies it.
- A derivable value is derived: attention items, capacity, daily targets, project state, readiness, the relationship timeline.
- A mutable root carries a version. A business write is one atomic database operation that checks version, organization and authorization. A client request key makes a retry return the first result.
- A record number is unique in the organization and immutable. Job, project, request, equipment, service case and maintenance numbers count per year; personnel numbers once. The count has at least three digits and grows past 999. A generator reads every existing number of its pattern, whatever its length.
- Missing configuration shows as missing, never as complete, allowed or compliant.
- Field workers get a purpose-limited projection through their assigned work.

## Responsibilities and attention

- A responsibility (time approval, leave approval, work-artifact approval, handover review) restricts a few actions without turning the roles into a permission system. A configuration is an effective-dated, append-only snapshot of holders: the role default (active Admin and Büro) or a non-empty named selection.
- A substitute covers a holder for inclusive Berlin dates; the row stays after the window. A holder is a personnel record with an active membership.
- `resolveEffectiveResponsibility` is the one resolver. Action time is the database clock.
- Attention items (`/aufgaben`) are derived live from the owning domains by source type and id. A new feature extends the source vocabulary, never a parallel store. Only the per-user read marker and its audit are stored; a domain change makes an item unread again.

## Personnel

- No compensation fields.
- Employment conditions and work schedules are date-effective versions; the newest on or before a date applies. The schedule wins over contractual hours.
- Daily targets are computed: schedule, then condition, then a labeled eight-hour default. A holiday of the selected state calendar or a closure day forces zero.
- A vacation request uses inclusive Berlin dates; authority comes from the leave-approval responsibility. Approval stores consumed entitlement days per year. Own requests cannot overlap. Approved vacation enters the target resolver as an absence.
- A sickness report is a reported fact, reported or cancelled; other changes are audited updates. It can be open-ended and retroactive. A person's active sickness cannot overlap; overlap with vacation is allowed. No note or diagnosis field, by design.
- Organization access and employment are two lifecycles per record, each with an immutable history. A suspension never disables the Auth user. The owner or the last effective Admin cannot be suspended or ended without a successor. The last effective holder of a responsibility blocks an employment transition.
- A protected personnel document's access follows its class and an explicit release of an exact version, never a responsibility, document permission, assignment or planning role ([storage](document-storage-and-access.md)). An acknowledgement is no signature.
- An onboarding requirement points at the exact row in its owning domain. Only an explicit access-blocker requirement prevents activation.

## Customers and requests

- A customer (`Kunde`) owns its contacts (`Ansprechpartner`), sites (`Einsatzort`), follow-ups and communication guidance. A contact or site belongs to one customer, never shared or merged. Changing a job's customer clears the old customer's site and contact references.
- A request (`Anfrage`) holds provisional caller text until matched, converts exactly once into a job or project, and can reopen. Requests and customer master data are manager-only.
- Communication guidance states allowed, disallowed or unknown per purpose and channel. Absence never implies consent.
- The relationship timeline has no table. A resolver merges bounded windows from owning rows and ledgers.

## Work

- A job (`Auftrag`) is standalone or in a project (`Projekt`). A project's default site and contact prefill new jobs without forcing a sync.
- A job's free-text location is a snapshot taken when a site is selected.
- An instruction item is the one task and checklist record, on one job or project.
- A template version, once published, is immutable. Applying it copies its content into ordinary records and never weakens an existing capability requirement.
- A job's execution state is explicit and versioned; older work gets its state projected, not an invented history. A project's state derives from its jobs unless a manager sets a reasoned override, which never cascades. One immutable ledger records every transition with reason and gate snapshot. Starting a clock on a job uses the same transition.
- One blocker model covers jobs, projects and instruction items, parked work (`geparkt`) included. A dependency blocks start, blocks completion, or warns; the database rejects self-links and cycles.
- A work artifact (`Arbeitsnachweis`) lives in immutable numbered revisions. Reviews, outcomes, signatures and exports reference an exact revision in an append-only ledger. Internal approval enforces four eyes.
- A handover release (`Übergabe`) is numbered and immutable and freezes exact artifact revisions, document versions, gate snapshot and responsibility. A correction is a withdrawal plus a successor. Release couples to the lifecycle in one transaction. Handed-over children never hand over their project.

## Service

- Equipment (`Anlage`) belongs to one site: a root or one directly owned component. A replaced unit keeps its history.
- A service case (`Servicefall`) owns only the service thread: triage, urgency, access guidance, suspected charge context (never a final commercial decision). Duplicate and continuation links keep both cases. A case reuses follow-ups, planning, dispatch and artifacts without copying them.
- A maintenance plan (`Wartungsplan`) has immutable revisions referencing exact equipment and one published template version. Due work exists before any job; a read never generates it. A visit is a normal job a manager creates. Moving one appointment never alters the sequence.
- Maintenance coverage records entered and review dates, not contract truth. Overlapping active coverage needs a reason. Contradictory next-due facts stay a visible exception.
- An employee gets compact service context for an assigned job. Coverage terms and internal notes stay manager-only.

## Planning and dispatch

Planning is no second job, employee, absence or time system, and never changes recorded time.

- A recurrence is a bounded series with a durable lineage. "This and future" closes the old segment and starts a successor. Past and started occurrences are never rewritten.
- An occurrence is identified by organization, lineage and original Berlin local start, so extending the horizon is idempotent across DST.
- A planning assignment controls planning visibility. The job assignment stays the authority for job responsibility and field access.
- Capacity, qualification and team membership resolve at action time. An action stores one assessment snapshot, which each written occurrence references with its own selection and override reason. No balance is stored.
- A dispatch (`Einsatz`) targets one visit or one unscheduled job, at most one active per target. A revision records the instruction as issued; a schedule change supersedes it in the same transaction. Parking cancels the dispatches.
- An acknowledgement belongs to one revision and one personnel record; the latest wins. A recipient without a login shows "nicht möglich".
- A customer commitment is an explicit agreement for an occurrence. A schedule move never rewrites it; a mismatch is a derived, visible state.

### Job team and visit plan

A job's team and the people on its visits are two records of one plan. A job scheduled through the job form has one legacy visit, the one its schedule columns describe. After every committed call:

- Every person with a login on an unstarted visit is on the job team. A personnel record without a login can be on a visit, never on a team.
- A planning write adds its visits' people to the team and removes nobody. Only a team edit takes a person off the job, and off every unstarted visit.
- A team edit that adds a person reaches the legacy visit only. A planning write for one visit never changes another visit's people.
- A started visit is history; a team edit leaves its people.
- The schedule columns project the first scheduled visit. A schedule edit in the job form moves the legacy visit.
- Parking cancels scheduled visits and empties the schedule; visits keep their people, the job its team. Unparking revives the legacy visit.
- A series change sets the people of every occurrence it rewrites; the replaced people stay on the team.

`app_private.project_plan_onto_job` is the only writer of the plan onto the job. It sets the transaction-local marker `app.planning_projection_write` for its own writes, then restores the earlier value. A marker that outlives its write disconnects every later job edit in the transaction from its visit. `sql:job-plan-bridge` drives every write path.

## Time

- An attendance session is one presence interval. An activity segment is one interval of work, travel, break, standby, call-out or internal activity.
- Older entries read through a compatibility projection; a live legacy sequence is bridged on its next action. No bulk backfill.
- Splitting at the Berlin day boundary is presentation only.
- A correction holds immutable before and proposed revisions and the exact source versions. An accepted correction is an overlay: readers apply the newest accepted application and suppress the replaced source. One source cannot feed two accepted applications.
- A period (`Perioden`) is one Berlin calendar month with stored boundaries. Only an ended month closes.
- A time-account policy has immutable versions assigned by date without overlap; credit rules never change raw minutes.
- A time account (`Zeitkonto`) starts from an explicit opening balance with date and reason. Its ledger is immutable minutes, never money. A different effective time-approval holder approves an adjustment.
- A period calculation is an immutable snapshot that rounds once per employee, day and bucket. Night, Sunday and holiday buckets overlap and do not add up.
- A period covers every personnel record whose employment overlaps it. Objective defects block the close; payroll-mapping defects block the export.
- A close is an immutable version. A closed period refuses edits until an administrator reopens it with a reason. A payroll export covers the whole workforce of one close version and supersedes an earlier one explicitly.

## Inventory and documents

- Stock movement history and inventory audit events are append-only. [inventory.md](../features/inventory.md) owns the planned scope.
- A document exists once and reaches other records through links. [document-storage-and-access.md](document-storage-and-access.md) owns the rules.
