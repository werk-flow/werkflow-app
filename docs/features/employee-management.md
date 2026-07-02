# Employee Management

Employee management covers organization membership, roles, invites, access, and employee-related operational context.

## Product Goal

WerkFlow should make it easy for SHK businesses to onboard team members and give each person the right operational tools without requiring technical knowledge.

The whole company becomes the user base: business owner, office staff, project leads, field workers (`Handwerker/in`), apprentices, and other employees.

## Current Implementation

Current implemented concepts include:

- Organization membership.
- Roles: `admin`, `buero`, `employee`.
- German role labels: Admin, Büro, Handwerker/in.
- Organization invites.
- Organization-code joining.
- Mitarbeiter page for admins and Büro users.
- Member list and invitation list.
- Role changes and member removal.
- Active organization switching.
- Manager-facing employee detail pages with linked **Dokumente & Bilder** via document management.

The exact permission matrix should be verified in current code before modifying role-sensitive behavior.

## Intended Scope

The broader product scope includes:

- Employee onboarding.
- Role and permission management.
- Possible future custom role names and custom permissions.
- Working-time management.
- Vacation and sick leave workflows.
- Seeing which employee works on which job/project.
- Keeping employee-related documents organized without giving field workers broad document-library access.

Custom role names and permission editing are future product ideas, not current assumptions.

## User Groups

- Business owners need oversight and control.
- Office staff need team coordination tools.
- Field workers need limited, focused access.
- Apprentices may need especially guided workflows.

## Role Principles

- `admin` is the organization owner/control role.
- `buero` is the office/manager coordination role.
- `employee` is the field-worker role, currently labeled `Handwerker/in`.

Role-specific experiences should differ intentionally. Do not expose complex admin concepts to field workers unless the task requires it.

## Product Principles

- Joining and inviting should be simple and reliable.
- Role labels shown to users should be German and understandable.
- Permission changes should be conservative.
- Employee workflows should avoid technical terminology.
- Admin/office workflows should optimize oversight and speed.

## Open Decisions

- Whether admins can rename role labels.
- Whether admins can create custom roles.
- How granular future permission management should be.
- How vacation and sick leave approvals should fit with employee management and time tracking.
- Whether employee profiles need SHK-specific fields such as trade specialization, vehicle, certifications, or apprentice status.
