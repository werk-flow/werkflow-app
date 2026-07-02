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

## Work Domain

The core work domain is job/project management.

Concepts:

- Customer (`Kunde`): private or commercial client.
- Project (`Projekt`): a larger body of work that may contain multiple jobs.
- Job/order (`Auftrag`): a concrete unit of work, either standalone or under a project.
- Assignment: connection between a job and one or more employees.
- Instruction item: checklist/instruction content attached to a job.

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

## Future Inventory Domain

Inventory is a major near-term planned module and is not currently implemented.

Conceptual areas to design:

- Inventory catalog items.
- Stock state/counts.
- Stock movement history.
- Job/project material links.
- Barcode and supplier identifiers.
- Low-stock and reorder thresholds.

See `docs/features/inventory.md` before implementing.

## Document Domain

Document management is implemented (Stages 1–4). See `docs/features/document-management.md` for the full feature model, permissions, and open decisions.

At a high level:

- **Metadata in Postgres:** folders, documents, links to jobs/projects/customers/employees, categories, trash state, versions, audit events.
- **Bytes in Supabase Storage:** private `organization-documents` bucket with org-scoped paths.
- **No automatic folder creation** when jobs, projects, customers, or employee records are created; manual folders, metadata links, and library filters provide operational organization instead.
- **Role split:** managers use `/dokumente`; employees use assigned job contextual sections only.

Exact columns and RLS policies belong in Supabase and generated types, not in this conceptual doc.

## Modeling Rules

- Keep organization boundaries explicit.
- Do not rely on client-provided authorization claims for privileged decisions.
- Keep field-worker flows simple even if the underlying model is rich.
- Preserve auditability where operational records can affect time, stock, billing, or customer documentation.
- Prefer conceptual docs here; exact schema belongs to Supabase and generated types.
