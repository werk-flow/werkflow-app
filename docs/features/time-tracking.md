# Time Tracking

Time tracking (`Zeiterfassung`) is a core WerkFlow feature. It should help SHK businesses record working hours, breaks, job-linked time, and future absence workflows with minimal friction.

## Product Goal

Time tracking should reduce manual paperwork and give owners, office staff, and employees a reliable overview of work time. Field workers should be able to clock in, clock out, take breaks, and connect time to jobs without complex navigation.

## Current Implementation

Current implemented concepts include:

- Clock in and clock out.
- Break start and break end.
- Live clock state.
- Job-linked time tracking.
- Weekly time overview.
- Manual entries.
- Pending approvals and change requests.
- Time entries visible in calendar and job/project contexts.
- Organization-level break settings.

The data model is event-based: work sessions and break sessions are derived from time entries rather than stored as a single mutable session object.

## Intended Scope

The broader product scope includes:

- Working time per day, week, and month.
- Break time and work time.
- Vacation planning (`Urlaub`).
- Sick leave / absence tracking (`Krankheit`, `Krankmeldung`).
- Office/owner management of employee time.
- Overview of who worked on which job or project.

Vacation and sick leave are product scope but should not be assumed implemented unless the code confirms it.

## User Groups

- Field workers need simple, mobile-friendly clock and break flows.
- Office staff need review, correction, and overview tools.
- Business owners need reliable work-time information and reduced manual checking.
- Admins may configure organization-wide time-tracking rules.

## Design Principles

- Make the current state obvious: clocked out, working, or on break.
- Avoid ambiguous time states.
- Keep job switching and job-linked time easy.
- Preserve history and reviewability for manual changes.
- Prevent users from accidentally working in multiple organizations at once.
- Use German UI copy and clear labels.

## Permissions

Current role behavior should be verified in code before changing it. As a product principle:

- Employees should manage their own simple clock flows.
- Büro/office users should review and manage operational time records.
- Admins should control organization-level settings.

Do not broaden access to time records without checking privacy and organization-role expectations.

## Open Decisions

- Exact vacation and sick-leave workflows.
- Whether vacation/sick leave should be approved through the same approval area as time changes.
- Monthly/export/reporting requirements.
- Whether future mobile time tracking needs offline support.
- Whether location or photo evidence is ever required for certain businesses.
