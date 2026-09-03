# Product Capability Map

Status: living — last reviewed 2026-09-02

This document defines how WerkFlow should grow from its current operational foundation into a complete, coherent operating system for German SHK businesses and, later, an intelligent automation platform.

It answers four questions:

1. Which product capabilities belong in the complete WerkFlow product?
2. How do those capabilities form one operating loop instead of a collection of features?
3. What belongs in the core product phase, and what depends on a later intelligence phase?
4. Which detailed feature document owns each future build-out?

This is a **product capability and dependency map**, not a release schedule, sprint plan, schema design, or promise that every listed capability must be built natively.

> **Product direction confirmed:** 23 July 2026  
> **Primary market:** German SHK businesses, with later applicability to adjacent construction trades  
> **Research input:** [`competitive-landscape.md`](./competitive-landscape.md)

## Product Thesis

WerkFlow should first meet the real operational standard expected from serious trade-business software: customers, work, people, time, planning, documents, material, service, commercial processes, and business control must function as one dependable system.

“Core” does not mean a bare minimum. The first product phase includes the depth and practical conveniences necessary to replace paper, disconnected spreadsheets, unstructured messages, and fragmented legacy tools. Nice-to-have capabilities belong in this phase when they materially reduce paperwork, operational clutter, mistakes, coordination effort, or unbilled work.

After the operational system is trustworthy, WerkFlow should differentiate through AI assistance and configurable automation inside and outside the app. That second phase should use the structured operational context created by the first phase rather than placing a generic AI layer over incomplete workflows.

Across both phases, WerkFlow must avoid the two trade-offs repeatedly visible in the competitor research:

- modern and simple, but too shallow for real SHK operations;
- operationally deep, but fragmented, difficult to learn, and expensive to adopt.

The target is **progressive depth**: simple defaults for common work, powerful capabilities in context, and clear expert controls when the business needs them.

## Documentation Model

The product is documented at four levels:

| Level | Purpose | Source |
| --- | --- | --- |
| Product context | Why WerkFlow exists, who it serves, and broad principles | `AGENTS.md` |
| Product capability map | How all feature areas form one product, their phases, dependencies, and decision gates | This document |
| Feature specification | Current baseline plus what the feature must become, its cross-feature contracts, roles, AI opportunities, boundaries, and open decisions | [`docs/features/*.md`](../features/) |
| Phase 1 build roadmap | Ordered vertical slices, direct prerequisites, current progress, exit evidence, and golden-scenario gates | [`phase-1/roadmap.md`](../plans/phase-1/roadmap.md) |

Feature specs should describe **what outcome and product behavior are needed**. Concrete implementation plans, schema changes, endpoint designs, vendor selection, and rollout steps belong in [`docs/plans/`](../plans/), technical docs, or decision records after the product behavior is decided.

## Phase Model

The phase labels express dependency and product maturity, not dates.

### Phase 1 — Complete Operational Core

Build a complete trade-business operating foundation:

- replace the common paper, spreadsheet, folder, calendar, and messaging gaps;
- support both office and field workflows;
- cover the connected operational and commercial loop;
- provide enough depth for real SHK exceptions, not only demo paths;
- preserve auditability, correction, export, and organization boundaries;
- make onboarding and daily use understandable for non-technical businesses.

Phase 1 is complete only when the major workflow can cross feature boundaries without users retyping the same customer, job, time, document, material, or price information.

### Phase 2 — Intelligent Operations And Automation

Add intelligence after the underlying records, permissions, events, and review paths are dependable:

- extraction, summarization, drafting, classification, and recommendations;
- product-owned automation templates for common SHK workflows;
- configurable triggers, conditions, approvals, and actions;
- bounded agents that perform multi-step work inside WerkFlow;
- authorized connections to email, SMS, calendars, suppliers, accounting systems, and other external services;
- cross-domain analysis of finance, inventory, workforce, service, and project history.

Phase 2 should make the product more capable without making ordinary users configure an automation platform before they can do their daily work.

### Decision Gate

A decision gate is a capability that may be valuable but has a material strategic, regulatory, commercial, or complexity boundary. It must not silently become a commitment merely because competitors offer it.

Examples include native double-entry accounting, native payroll, tax filing, bidirectional calendar synchronization, IoT/building telemetry, a fully generic CRM pipeline, and unrestricted autonomous agents.

## The Coherent Operating Loop

WerkFlow should organize the business around one connected loop:

```mermaid
flowchart LR
    A["Customer request"] --> B["Customer, site, and equipment context"]
    B --> C["Offer, scope, or service decision"]
    C --> D["Job or project"]
    D --> E["Schedule people and resources"]
    E --> F["Prepare documents and material"]
    F --> G["Execute in the field"]
    G --> H["Capture time, material, photos, measurements, and approval"]
    H --> I["Complete, report, and hand over"]
    I --> J["Invoice, payment, and accounting handoff"]
    J --> K["Post-calculation, reporting, and follow-up"]
    K --> A
```

Recurring service adds another loop:

`installed equipment → maintenance obligation → planned visit → field evidence → equipment history → next due work`.

An operation is coherent when every step enriches the same underlying business records and prepares the next step. A feature is not complete merely because its own screen works in isolation.

## Capability Ownership Map

### Core Feature Areas

| Feature area | Phase 1 complete-product responsibility | Phase 2 direction | Detailed specification |
| --- | --- | --- | --- |
| Customers and CRM | Customers, contacts, sites, requests, relationship timeline, communication preferences, duplicate prevention, installed-equipment links, and follow-up context | Intake assistance, relationship summaries, next-action and risk suggestions | [`customers-and-crm.md`](../features/customers-and-crm.md) |
| Jobs and projects | Request-to-completion work lifecycle, assignment, tasks/checklists, field evidence, progress, exceptions, changes, completion, and planned-versus-actual inputs | Scope structuring, summaries, risk detection, draft artifacts, and checkpoint agents | [`jobs-and-projects.md`](../features/jobs-and-projects.md) |
| Service and maintenance | Reactive service, customer installations, recurring maintenance, contracts' operational delivery, dispatch, service reports, warranty/return context, and history | Intake triage, history briefs, report drafting, anomaly and maintenance-demand analysis | [`service-and-maintenance.md`](../features/service-and-maintenance.md) |
| Calendar and resource planning | Day/week/month planning, recurrence, teams, capacity, absence, skills, tools, vehicles, routes, customer commitments, and backlog/parking | Explainable assignment, route, conflict, capacity, and rescheduling proposals | [`calendar-and-resource-planning.md`](../features/calendar-and-resource-planning.md) |
| Employee management | Membership, personnel master data, roles, permissions, employment context, skills, certifications, personnel documents, onboarding/offboarding, schedules, and absence workflows | Guided onboarding, document checks, workforce and qualification insights | [`employee-management.md`](../features/employee-management.md) |
| Time tracking | Work, travel, breaks, job allocation, supplements, time accounts, correction/approval, employee transparency, payroll/accounting handoff, and mobile/offline use | Anomaly detection, missing-entry assistance, forecast and compliance warnings with review | [`time-tracking.md`](../features/time-tracking.md) |
| Document management | Central and contextual files, capture, search, versioning, recovery, permissions, structured forms, signatures, retention, export, and commercial integration | OCR, extraction, classification, summaries, linking proposals, and document-triggered workflows | [`document-management.md`](../features/document-management.md) |
| Inventory and procurement | Catalog, locations, stock, movements, planning, reservations, transfers, consumption/return, tools/assets, suppliers, purchasing, receiving, counts, billability, and trade standards | Demand forecasts, reorder proposals, discrepancy analysis, invoice/receipt matching, and bounded ordering | [`inventory.md`](../features/inventory.md) |
| Commercial and finance | Catalog/pricing, offers, order confirmations, contracts, measurements, invoices/credits, incoming bills/expenses, open items, payments, dunning, accounting readiness, and controlling | Document extraction, drafting, anomaly/cash/material-margin analysis, and approved finance workflows | [`commercial-and-finance.md`](../features/commercial-and-finance.md) |
| AI automations | Phase 1 enabling foundations only: reliable events, permissions, audit, approvals, notifications, APIs, data quality, and safe action boundaries | Assistants, templates, custom workflows, bounded agents, and authorized cross-system actions | [`ai-automations.md`](../features/ai-automations.md) |

### Cross-Cutting Product Foundations

These capabilities affect every feature and should not be rebuilt differently in each module.

| Foundation | Complete-product expectation |
| --- | --- |
| Organization and permissions | Every record and action has an organization boundary; roles are understandable; sensitive capabilities can be restricted without creating dozens of unusable permission toggles. |
| Shared customer/work context | Customer, site, project, job, service asset, employee, document, item, supplier, and commercial records retain stable links across features. |
| Activity and audit history | Important changes to time, stock, commercial documents, permissions, customer communication, and automation are attributable and reviewable. |
| Tasks, approvals, and exceptions | Users have one understandable place for work requiring attention, rather than a separate approval queue in every feature. |
| Notifications | Notifications are actionable, deduplicated, role-aware, and configurable; they link to the exact context and do not become a second inbox full of noise. |
| Search and navigation | Users can search the objects their role allows and move between related context without memorizing module boundaries. |
| Mobile and offline | The future mobile app is one role-aware shell. Offline capability is specified per workflow with visible sync, failure, conflict, and recovery states. |
| Import and migration | Customer, employee, item, supplier, document, open-work, and selected historical data can be brought in through clear, validated processes. |
| Export and exit | Organizations can export their operational records and files in usable forms. Leaving WerkFlow must not require screen-by-screen copying. |
| Interfaces and standards | Each integration names the standard, version, direction, ownership, failure handling, and commercial boundary. “Has an interface” is not sufficient documentation. |
| Templates and settings | Useful SHK defaults work out of the box; businesses can adapt templates, numbering, statuses, categories, and rules without turning setup into software development. |
| Security and privacy | Least privilege, data retention, deletion, consent, employee privacy, secrets, PII-safe logs, and external processor boundaries are explicit. |
| Help and enablement | Contextual help, guided setup, video courses, and in-person workshops explain the operating method as well as individual buttons. |

## Shared Product Objects

The exact database design remains a later technical decision, but feature work should preserve these conceptual distinctions:

| Concept | Meaning |
| --- | --- |
| Organization | The company/workspace and tenant boundary |
| Person and organization contact | A customer, contact person, supplier contact, or employee identity in its appropriate context |
| Customer | The private or commercial buyer/relationship |
| Site | The physical place where work or service happens; one customer may have several |
| Installed equipment | A customer-owned system or component with service history |
| Project | A larger body of related work |
| Job | A concrete work order, visit, or executable unit |
| Appointment | Planned time/resource allocation; not the same as the job itself |
| Task or checklist item | A discrete responsibility or required step |
| Employee assignment | Responsibility for work; distinct from recorded time |
| Time record | Actual work/travel/break/absence history; distinct from the plan |
| Document or artifact | A file or structured business output linked into operational context |
| Catalog item | A reusable material, product, service, or labor definition |
| Stock item and movement | Physical availability and its attributable changes |
| Planned/reserved/consumed material | Different states in the job and stock lifecycle |
| Tool or business asset | Reusable equipment owned or controlled by the business |
| Supplier and purchase | Source, demand, order, receipt, return, and incoming invoice context |
| Commercial document | Offer, confirmation, contract, invoice, credit, or related structured record |
| Payment or accounting event | Financial settlement or handoff, distinct from an uploaded invoice file |
| Communication | What was sent or received, through which channel, and in which business context |
| Automation run | A trigger, decision, proposed/performed action, approval, result, cost, and audit record |

Using one vague object for several of these meanings creates the same problems the competitor research exposed—for example, calling a quotation catalog “inventory” or treating a scheduled appointment as actual working time.

## Cross-Feature Handoff Rules

Every feature specification should follow these rules:

1. **One source of truth:** link to an existing customer, job, employee, document, item, or invoice instead of copying it into another module.
2. **Explicit state transitions:** planned, approved, ordered, received, consumed, completed, invoiced, and paid are different states with different owners.
3. **No silent downstream mutation:** changing a calendar event should not silently rewrite time, send a customer message, move stock, or generate an invoice.
4. **Review before obligation:** actions that create legal, financial, customer, scheduling, or supplier commitments need the correct preview and approval.
5. **Traceable correction:** users must be able to correct mistakes without destroying the historical record.
6. **Context follows the work:** field workers receive only the information and actions needed for assigned work; office users retain the connected overview.
7. **Failures are visible:** sync, integration, message, payment, document-processing, and automation failures must have an owner and recovery path.
8. **Structured output remains editable:** generated reports, extracted invoices, and proposed orders stay drafts until the responsible user accepts them.

## Phase 1 Definition Of Complete

The complete operational core should meet all of the following product-level criteria.

### Operational Continuity

- A customer request can become a job, project, or service case without retyping customer and site data.
- The job can be scheduled with people and relevant resources.
- The field worker can understand and execute the assignment in one focused experience.
- Time, photos, forms, measurements, material, notes, and signatures remain linked to the work.
- Completion can produce the correct report, follow-up, inventory, and commercial handoffs.
- The business can see what is open, blocked, late, completed, uninvoiced, unpaid, or awaiting approval.

### Commercial Continuity

- The business can create a structured offer and preserve its accepted scope.
- Changes and actual work can be reconciled against what was offered.
- Billable time, material, services, and measurements can flow into invoice preparation with review.
- Incoming costs and outgoing revenue can be attributed to the relevant work.
- Payments, open items, dunning, accounting export, and post-calculation have clear states.
- Native accounting boundaries are explicit rather than implied.

### Material Continuity

- Catalog, planned demand, reservation, physical stock, procurement, receipt, consumption, return, billing, and valuation are not conflated.
- Every stock-changing action is attributable.
- Field workflows are fast enough to be used in real work.
- Shortages and order needs are visible early enough to affect planning.

### People And Planning Continuity

- Employees understand their schedule, working-time state, time balance, leave state, assigned work, and necessary documents.
- Office users can plan around availability, skills, and operational demand.
- Corrections and approvals do not create hidden or contradictory states.
- Sensitive personnel and commercial information remains role-appropriate.

### Trust, Adoption, And Exit

- Important data is searchable, auditable, recoverable, and exportable.
- Offline and external-system states are honest and visible.
- Pricing, onboarding, migration, training, support, and data-exit assumptions can be explained plainly.
- Standard SHK workflows work with useful defaults before extensive customization.
- A business can learn the product through in-context guidance, video courses, and structured workshops.

## Capability Dependency Order

This is a dependency sequence, not a release commitment.

### Done As Of 2026-09-02

Waves 0 to 2 of the Phase 1 roadmap are accepted: 26 of 56 slices, `P1-00` and `P1-00a` through `P1-24`. That closes the operational graph this section once listed as next: customer contacts, sites, requests and the relationship timeline; employee records, schedules, responsibilities, vacation, sickness, teams and qualifications; recurring planning and dispatch; work templates, the execution lifecycle, structured evidence, the field work pack and office handover; installed equipment, reactive service and maintenance plans; explicit time segments, corrections, time accounts with period close and payroll export; and the controlled people lifecycle. The shared attention pattern on `/aufgaben` carries approvals and notifications for all of them. Search, mobile and offline behavior are not done; they sit in Wave 5. The exact position, the per-slice records and the pending Wave 2 wave-end certification live in the [roadmap checkpoint](../plans/phase-1/roadmap.md#current-checkpoint).

### Remaining

Waves 3 to 6 have not started. In dependency order they cover material, procurement, inventory control and assets; the commercial and finance loop; evidence, communication, portability, mobile and interoperability; and Phase 1 closure with Phase 2 readiness. The next two subsections describe the first of those in product terms; the roadmap owns the slice list.

### Close The Commercial And Material Loop

Then connect:

- reusable product/service/labor catalog and price calculation;
- offers, scope acceptance, contracts, measurements, and change work;
- invoices, credits, incoming costs, payments, dunning, and accounting handoff;
- supplier demand, ordering, receipt, invoice matching, and returns;
- job/project/service post-calculation and business-control views.

Some work can proceed in parallel, but the shared states and handoffs must be decided together.

### Harden Adoption And Interoperability

Before calling the product complete:

- migration and import paths;
- organization-wide export and exit;
- trade standards and accounting/wholesaler integrations;
- a unified mobile/offline experience;
- customer communication and selected portal flows;
- onboarding, workshops, video learning, support, and permission setup;
- performance and recovery behavior at realistic data volume.

### Add Intelligence Progressively

Phase 2 should advance through controlled levels:

1. **Assist:** search, summarize, extract, classify, and draft.
2. **Recommend:** identify anomalies, risks, next actions, and options with evidence.
3. **Automate templates:** run product-owned triggers and actions with defined approvals.
4. **Compose workflows:** let authorized users combine safe triggers, conditions, approvals, and actions.
5. **Delegate to bounded agents:** allow goal-directed multi-step work within explicit data, tool, cost, and approval limits.

Skipping directly to a generic agent builder would increase complexity and risk before the product has stable actions or understandable failure handling.

## What WerkFlow Should Learn, Not Copy

The competitor research supports several product guardrails:

- Do not use breadth as an excuse for a fragmented suite of employee apps.
- Do not call catalogs, job material, stock, and procurement the same feature.
- Do not hide onboarding, migration, support, app, storage, or implementation cost behind one headline price.
- Do not market “offline” without defining which actions work, what is cached, and how conflicts recover.
- Do not let permissions become either three overly broad roles or hundreds of unexplained switches.
- Do not make every workflow configurable before the default SHK workflow is excellent.
- Do not confuse a high review average with evidence that implementation, contracts, mobile behavior, and support all work well.
- Do not label planned, beta, partner-provided, or partially available AI as a complete native product.
- Do not force field workers to understand office accounting, stock valuation, document governance, or automation configuration to finish assigned work.

## Major Decision Gates

### Native Accounting

WerkFlow should build operational finance and accounting-ready records. Building a complete native financial accounting system—including double-entry bookkeeping, tax logic, fixed assets, group accounting, and statutory reporting—is a separate strategic decision requiring qualified accounting expertise and a strong reason not to integrate with established systems.

### Native Payroll

Employee and time data should support payroll preparation and export. Native wage and construction-payroll calculation is a separate regulated product boundary.

### Generic CRM

WerkFlow needs strong customer, contact, site, request, communication, and service history. A generic marketing/sales CRM with campaigns, arbitrary pipelines, and broad lead scoring should only be added when it solves a confirmed SHK workflow.

### Customer Portal

A portal may reduce appointment, document, approval, invoice, and service-request friction. Its exact Phase 1 boundary depends on which external interactions produce enough operational value to justify identity, permission, support, and notification complexity.

### External Calendar Ownership

Calendar export is simpler than bidirectional synchronization. Two-way Google/Microsoft sync needs explicit source ownership, private-event handling, duplicates, conflict recovery, and offboarding rules.

### Open Automation Platform

Product-owned templates should precede a generic workflow builder. Bounded custom agents require clear organization permissions, available actions, audit, approval, cost limits, data retention, and failure recovery.

### IoT And Remote Equipment Monitoring

Installed-equipment history and maintenance do not automatically commit WerkFlow to ingesting telemetry or controlling building equipment.

## Documentation Rules For Future Work

Every feature spec should keep these sections current:

1. **Product Goal**
2. **Current Product Baseline**
3. **Phase 1 — Complete Operational Core**
4. **Connected Workflow Contracts**
5. **Role And UX Principles**
6. **Phase 2 — Intelligence And Automation**
7. **Boundaries And Decision Gates**
8. **Open Product Decisions**
9. **Related Docs**

One spec carries extra sections by design. `document-management.md` keeps the nine standard sections since 2026-09-03; its implementation reference lives in [document-storage-and-access.md](../technical/document-storage-and-access.md). `ai-automations.md` has foundations rather than features as its Phase 1 scope, so its Phase 1 section is titled "Phase 1 — Complete Operational Core Enabling Foundations" and it adds In-App And External Automation, Human-Control Levels, and Trust, Security, And Operational Requirements.

When behavior is implemented:

- move it from planned capability into the current baseline;
- preserve any still-relevant product rationale;
- link a concrete implementation plan only when one exists;
- update dependent feature handoffs;
- update the conceptual data model if the domain boundary changed;
- check this capability map if the change affects product phase, ownership, or a decision gate.

Do not copy exact competitor behavior into a feature spec without asking whether it reduces paperwork, organizes work, or saves time for WerkFlow's target business.

## Related Docs

- [Phase 1 build roadmap](../plans/phase-1/roadmap.md)
- [Competitive landscape](./competitive-landscape.md)
- [Product offer](./offer.md)
- [Customer avatar](./avatar.md)
- [Acquisition process](./acquisition.md)
- [Documentation index](../README.md)
- [Conceptual data model](../technical/data-model.md)
- [Technical architecture](../technical/architecture.md)
