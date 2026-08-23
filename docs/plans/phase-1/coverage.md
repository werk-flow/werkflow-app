# Phase 1 Coverage Matrices

Status: living — last reviewed 2026-08-24

Routing aids: the starting-foundation snapshot and the feature-to-slice and cross-cutting coverage matrices. They change only when slice scope or feature routing changes. The slice index lives in [roadmap.md](roadmap.md).

## Starting Foundation Snapshot

This snapshot is a roadmap orientation aid. Feature baselines and current code remain authoritative.

| Area | Starting position | Roadmap consequence |
| --- | --- | --- |
| Organizations and roles | Organization membership and fixed `admin`, `buero`, `employee` roles exist | Preserve current access while adding scoped responsibilities deliberately |
| Customers | Basic organization-scoped customer master and customer-linked work exist | Extend identity into contacts, sites, requests, timeline, and lifecycle rather than replace it |
| Jobs and projects | Strong work structure, assignments, statuses, checklists, calendar, time, documents, and inventory context exist | Mature request handoff, readiness, evidence, completion, and service/commercial transitions |
| Calendar | Day/week/month planning, jobs, time blocks, assignment, drag/drop, and `Parkplatz` exist | Add recurring/multi-visit planning, capacity, resources, commitment state, and dispatch depth |
| Employees | Membership, invitations, roles, basic profiles, assignment, and manager surfaces exist | Add employment identity, conditions, schedules, absence, skills, documents, and lifecycle |
| Time | Event-based clocking, breaks, job allocation, manual entries, weekly view, approvals, and history exist | Add full categories, schedules/targets, accounts, correction consistency, close, export, and offline reliability |
| Documents | Central/contextual library, private storage, links, trash, versioning, audit, viewer, and maintenance helpers exist | Add structured artifacts, capture/search/OCR, review, governance, commercial integration, and portability |
| Inventory | Catalog, locations, stock, movements, planning, take/return, CSV import, and basic asset infrastructure exist | Add reservations, procurement, transfers, counts, custody, valuation, standards, and commercial handoff |
| Service | No dedicated service domain exists | Reuse customer, work, calendar, time, documents, and inventory; do not build parallel copies |
| Commercial/finance | No structured commercial domain exists | Build controlled catalog-to-offer-to-invoice-to-payment and purchase-cost/accounting handoffs |
| AI/automation | No confirmed module exists | Build only enabling events, validated actions, approvals, connector boundaries, sources, and audit in Phase 1 |



## Feature-To-Slice Coverage

Use this matrix to find every roadmap slice that may require a feature-doc update. It is a routing aid, not a replacement for the slice's connected-spec column.

| Feature area | Primary Phase 1 slices |
| --- | --- |
| Customers and CRM | `P1-01`, `P1-02`, `P1-10`, `P1-18`, `P1-19`, `P1-36`, `P1-46`, `P1-47`, `P1-48` |
| Jobs and projects | `P1-02`, `P1-12`–`P1-17`, `P1-19`, `P1-26`, `P1-27`, `P1-37`, `P1-38`, `P1-48`, `P1-49` |
| Service and maintenance | `P1-18`–`P1-20`, `P1-44`, `P1-46`, `P1-49` |
| Calendar and resource planning | `P1-04`, `P1-06`, `P1-08`, `P1-09`, `P1-11`, `P1-12`, `P1-19`, `P1-20`, `P1-46`, `P1-49`, `P1-50` |
| Employee management | `P1-03`–`P1-09`, `P1-21`–`P1-24`, `P1-32`, `P1-33`, `P1-47`, `P1-49` |
| Time tracking | `P1-04`, `P1-06`, `P1-08`, `P1-16`, `P1-21`–`P1-24`, `P1-33`, `P1-38`, `P1-43`, `P1-49` |
| Document management | `P1-01`, `P1-02`, `P1-08`, `P1-09`, `P1-13`, `P1-15`–`P1-20`, `P1-24`, `P1-30`, `P1-32`, `P1-36`–`P1-47`, `P1-49` |
| Inventory and procurement | `P1-13`, `P1-16`, `P1-17`, `P1-19`, `P1-25`–`P1-34`, `P1-35`, `P1-38`, `P1-41`, `P1-43`, `P1-49`, `P1-50` |
| Commercial and finance | `P1-15`, `P1-17`, `P1-20`, `P1-23`, `P1-25`, `P1-27`, `P1-30`, `P1-31`, `P1-35`–`P1-43`, `P1-46`, `P1-47`, `P1-50` |
| AI enabling foundations | `P1-07`, every slice that creates a domain event/action, `P1-45`, `P1-46`, `P1-50`, `P1-51`, `P1-53` |

## Cross-Cutting Foundation Coverage

| Foundation | Main roadmap coverage |
| --- | --- |
| Organization and permissions | `P1-00`, `P1-05`, every slice's RLS/role checks, `P1-51` |
| Shared customer/work context | `P1-01`, `P1-02`, `P1-13`–`P1-20`, `P1-35`–`P1-43` |
| Activity and audit history | Every slice; consolidated validation in `P1-51` and `P1-53` |
| Tasks, approvals, and exceptions | `P1-07`, then reused by `P1-08`, `P1-10`, `P1-14`, `P1-22`, `P1-29`, `P1-36`–`P1-46`, `P1-48` |
| Notifications | `P1-07`, schedule/dispatch in `P1-12`, external delivery in `P1-46` |
| Search and navigation | Contextual search throughout; consolidated in `P1-44` and `P1-48` |
| Mobile and offline | Workflow contracts throughout; unified delivery in `P1-49` |
| Import and migration | Domain imports as introduced; cross-domain reconciliation in `P1-47` |
| Export and exit | Domain exports throughout; documents in `P1-45`; complete exit in `P1-47` and `P1-52` |
| Interfaces and standards | Inventory `P1-34`; e-invoice `P1-40`; accounting `P1-43`; connector hardening `P1-50` |
| Templates and settings | `P1-13`, `P1-15`, `P1-20`, `P1-29`, `P1-35`, `P1-36`, `P1-46` |
| Security and privacy | Every slice; personnel/privacy in `P1-05`, `P1-08`, `P1-24`, `P1-45`; complete audit in `P1-51` |
| Infrastructure stack ([decision 0001](../../decisions/0001-infrastructure-stack.md)) | Hygiene in `P1-00`; R2 direct file storage in `P1-00a`; retention archive design in `P1-45`; first Railway workers expected with `P1-44`/`P1-47`; auth re-evaluation before `P1-49` (mobile) |
| Help and enablement | Contextual help as features land; complete customer enablement in `P1-52` |

