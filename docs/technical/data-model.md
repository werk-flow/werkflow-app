# Conceptual Data Model

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
- Jobs and projects.
- Customers.
- Time tracking.
- Settings and preferences.
- Documents.
- Future inventory.

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

- Responsibility vocabulary: `time_approval` and `leave_approval`. They are stored as stable English enum values and presented as **Zeitfreigaben** and **Urlaubsfreigaben**.
- Responsibility configuration: append-only, organization-scoped effective versions. `role_default` snapshots active Admin/Büro memberships; `selected` snapshots a non-empty named holder set. The effective version is the newest `effective_from <= action time`, with deterministic tie-breaking. Organizations received default snapshots, so migration changed no existing authority. Since `P1-06` the server-side action time is clock-skew guarded: configurations are stamped with the database clock, so an app server whose clock trails the database floors its action time to the newest configuration timestamp — a just-applied configuration is always effective at the next action and a freshly revoked holder can never remain authorized for the skew window.
- Responsibility assignment: an immutable member of one configuration snapshot, keyed to `employee_record_id`. The personnel record supplies the organization-stable person identity; authorization is only effective while that record is linked to an active organization membership/login. An assignment source is `role_default` with its role snapshot or `direct`.
- Responsibility delegation/substitute: references a base holder record and substitute record in the same organization and responsibility. `valid_from` and `valid_until` are inclusive Europe/Berlin business dates; `revoked_from` is the first date on which an early-ended window no longer applies. Rows are retained, not deleted, so historical authority remains reconstructible.
- Responsibility event: append-only, actor-attributed audit for configuration snapshots and substitute creation/end with before/after details. It is a responsibility-domain log rather than an `employee_record_event`, because each fact concerns an organization action contract involving multiple people.
- The pure `resolveEffectiveResponsibility` result identifies holders via `role_default`, `direct_assignment`, or `delegation` (including the inherited base source). Approval scope and self-approval checks consume that result; the responsibility data is not a second independent permission matrix.
- Reads are self-or-manager through `app_private` SECURITY DEFINER helpers; ordinary employees can see only rows involving their own employee record. Writes use owner-authorized service-role RPCs plus organization-validation triggers. A unique partial constraint and ownership triggers keep exactly one owner/admin membership; selected sets cannot be empty and their sole base holder cannot be removed.

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

## Work Domain

The core work domain is job/project management.

Concepts:

- Customer (`Kunde`): private or commercial client, with an optional manual org-unique customer number.
- Request (`Anfrage`): an operational customer request captured during intake. It references (never copies) the customer/contact/site when known, or carries provisional free-text caller identity until matched or promoted to a customer. Lifecycle: `offen` → optional `in_klaerung` → terminal `umgewandelt` (converted exactly once into a new standalone job or project, race-safe, attributable) or `geschlossen` (with reason, reopenable). Attachments are documents linked via `document_links`; conversion adds a second link to the created work. Every material change is recorded in an append-only per-request event log. Requests are a manager-only surface.
- Contact (`Ansprechpartner`): a person belonging to exactly one customer, with a free-text role, channels, a primary marker, and an archive state. Contacts are never shared across customers or silently merged.
- Work site (`Einsatzort`): a durable operational location belonging to exactly one customer, with a structured address, access notes, an optional on-site contact, a primary marker, and an archive state. A site is master data, not copied address text.
- Project (`Projekt`): a larger body of work that may contain multiple jobs. A project may carry a default site/contact that prefills new jobs; each job can override it (no forced sync).
- Job/order (`Auftrag`): a concrete unit of work, either standalone or under a project. A job may reference one of its customer's sites and contacts. The job's free-text location is a snapshot taken when a site is selected; site edits never rewrite it, preserving the historical execution location.
- Assignment: connection between a job and one or more employees.
- Instruction item: checklist/instruction content attached to a job.

Ownership rule: sites and contacts belong to the customer domain; work only references them. Changing the customer of a job or project clears references to the previous customer's sites/contacts (server actions enforce consistency; database triggers validate org/client integrity).

Projects can have derived state based on child jobs unless manually overridden. Jobs can be scheduled, assigned, parked, completed, and connected to customers and time entries.

## Time Domain

Time tracking is event-based.

Concepts:

- Time entry: clock-in, clock-out, break-start, or break-end event.
- Work session: derived from paired time entries.
- Break session: derived from paired break entries.
- Live clock state: current computed state for the user in an organization.
- Change request: pending edit/delete workflow for time entries.

Time entries can be linked to jobs. The app should preserve enough history for approvals, corrections, and operational accountability.

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

Future procurement, reservation, transfer, lifecycle, valuation, commercial, and automation capabilities are defined in `docs/features/inventory.md`. Inspect live Supabase and generated types before schema-aware work.

## Document Domain

Document management is implemented (Stages 1–4). See `docs/features/document-management.md` for the full feature model, permissions, and open decisions.

At a high level:

- **Metadata in Postgres:** folders, documents, links to jobs/projects/customers/employees, categories, trash state, versions, audit events.
- **Bytes in Cloudflare R2 (EU jurisdiction):** private `werkflow-documents-dev`/`-prod` buckets with org-scoped paths and direct signed uploads/downloads (`lib/storage/r2.ts`; see `docs/decisions/0001-infrastructure-stack.md`). `documents.storage_bucket` keeps the logical value `organization-documents`.
- **No automatic folder creation** when jobs, projects, customers, or employee records are created; manual folders, metadata links, and library filters provide operational organization instead.
- **Role split:** managers use `/dokumente`; employees use assigned job contextual sections only.

Exact columns and RLS policies belong in Supabase and generated types, not in this conceptual doc.

## Modeling Rules

- Keep organization boundaries explicit.
- Do not rely on client-provided authorization claims for privileged decisions.
- Keep field-worker flows simple even if the underlying model is rich.
- Preserve auditability where operational records can affect time, stock, billing, or customer documentation.
- Prefer conceptual docs here; exact schema belongs to Supabase and generated types.

The future product-domain boundaries and cross-feature handoffs are mapped in `docs/product/product-capability-map.md`. Update this document when those planned concepts become part of the implemented conceptual model.
