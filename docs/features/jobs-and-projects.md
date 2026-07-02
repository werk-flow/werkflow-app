# Jobs And Projects

Jobs (`Aufträge`) and projects (`Projekte`) are the central operational work objects in WerkFlow.

## Product Goal

This feature area should help SHK businesses plan work, assign employees, document progress, connect customers and materials, and reduce scattered paperwork around active jobs.

## Current Implementation

Current implemented concepts include:

- Customers linked to jobs and projects.
- Standalone jobs.
- Projects that contain jobs.
- Job and project numbers.
- Status and priority.
- Planned dates/times and estimated/planned working duration.
- Employee assignments.
- Job instruction items/checklists.
- Parking work (`geparkt`).
- Detail pages for jobs and projects.
- Calendar integration.
- Time entries linked to jobs.
- Role-scoped visibility for managers/admins versus employees.
- User-specific table column preferences for the orders/projects view.
- **Document integration (Stages 1–4):** contextual **Dokumente & Bilder** sections on job and project detail pages; documents linked via `document_links` metadata; field workers can upload/view on assigned jobs; managers can upload, attach existing files, unlink, and manage from job/project/customer/employee context. See `docs/features/document-management.md`.

Exact schema and permissions should be verified against live Supabase and app code before implementation changes.

## Intended Scope

The broader product scope includes:

- Creating and managing jobs and projects.
- Assigning employees.
- Tracking project/job state.
- Attaching photos and business documents to jobs and projects (implemented via document management; files can be contracts, invoices, offers, etc. as categories, not yet as structured entities).
- Adding dedicated offer, contract, and invoice records/workflows (not yet implemented).
- Connecting used or required inventory items.
- Supporting customer-facing documentation and billing workflows later.

## User Groups

- Office staff and project leads need fast creation, planning, assignment, filtering, and overview.
- Business owners need a reliable picture of current work.
- Field workers need a simple way to see assigned work and document what happened.
- Apprentices need clear instructions and minimal room for mistakes.

## Product Principles

- Every job should clearly answer what needs to be done, where, for whom, when, and by whom.
- Project state should be understandable without manual reconciliation.
- Field-worker detail pages should prioritize actionable information.
- Avoid adding complex project-management concepts unless they reduce paperwork, improve organization, or save time.
- Keep German UI copy practical and clear.

## Relationships

Conceptual relationships:

- A customer can have many projects and jobs.
- A project can have many jobs.
- A job can be standalone or part of a project.
- A job can have many assigned employees.
- A job can have instruction items.
- A job can have linked time entries.
- A job or project can have linked documents and photos (via document management; same underlying file can appear in the central library and on detail pages).
- A customer or employee can have linked documents from their detail page (manager-facing).
- Future jobs/projects may also link inventory items, structured offers, contracts, and invoices.

## Open Decisions

- How offers, contracts, and invoices should be modeled as structured entities (today they exist only as document categories and files).
- Whether project-only document links should eventually be visible to assigned employees on jobs within that project (today employee access is job-assignment-based).
- How inventory usage should affect job/project status or billing.
- Whether future workflows need customer approvals/signatures.
- Whether project templates are needed for common SHK work patterns.
- Whether auto-created logical or physical document folders per Auftrag/Projekt/Kunde/Mitarbeiter should be added (currently deferred; see `docs/features/document-management.md`).