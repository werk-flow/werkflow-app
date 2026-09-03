# Service And Maintenance

Status: living — last reviewed 2026-09-03

Service and maintenance covers recurring maintenance, reactive customer service, faults, inspections, emergency work, and the long-term history of installed customer equipment.

This is a distinct SHK operating model, not merely another job status. It connects customer sites and installations with contracts, recurring demand, dispatch, field execution, materials, reports, and billing.

## Product Goal

WerkFlow should help an SHK business:

- know which equipment exists at each customer site;
- understand its history, warranty, service interval, and open issues;
- generate and plan recurring maintenance work reliably;
- dispatch reactive and emergency service with enough context;
- give the technician a simple, complete mobile work package;
- capture legally and commercially useful evidence once;
- turn completed service into a report, follow-up task, quotation, and invoice without duplicate entry.

The feature should reduce forgotten maintenance, paper service folders, repeated customer questions, incomplete field reports, unbilled material, and reliance on one employee's memory.

## Current Product Baseline

As of 2026-09-02, Admin and Büro manage installed customer equipment under `/service/anlagen`, reactive service cases under `/service/faelle`, and maintenance plans with operational coverage under `/service/wartung`. All three build on the existing customer, job, planning, dispatch, template, evidence, and document owners and copy none of their facts. An assigned field worker receives only the compact equipment, issue, and maintenance context for that exact job.

- Installed equipment. Managers register site-bound roots and one component level with a stable equipment number, typed identifiers, warranty and commissioning facts, exact installation origins, document and work links, lifecycle state, and immutable searchable history. Unknown technical facts stay visibly unknown, replacement keeps the predecessor, and equipment remains distinct from inventory stock. Customer pages show a compact site projection ([P1-18](../plans/phase-1/slices/p1-18-installed-equipment.md)).
- Reactive service. Managers create a direct case or qualify an existing `Anfrage` exactly once, preserve the original customer statement, and triage the case against one customer site and exact equipment with urgency, access guidance, and a suspected charge context. Duplicate, related, and continuation links keep both identities. A case connects to one existing job, which then runs through the normal calendar, dispatch, field-work, evidence, and follow-up owners; internal triage and commercial context stay office-only ([P1-19](../plans/phase-1/slices/p1-19-reactive-service.md)).
- Maintenance plans. A versioned plan binds one customer site, exact equipment, and one published work-template version and materializes service-owned due work for an 18-month horizon before any job exists. Overlapping active coverage needs an explicit reason. Coverage dates and renewal signals are entered operational facts, not legal or commercial contract truth ([P1-20](../plans/phase-1/slices/p1-20-maintenance-plans.md)).
- Maintenance visits and completion. A manager deliberately creates one template-backed visit job per due item and schedules it as a normal occurrence; appointment changes are calendar facts and never rewrite the plan or unrelated due work. Completion links the exact submitted evidence revision, records a separate complete, partial, or unresolved outcome, advances the next due date from the revision's chosen basis, and may link a service case or create a follow-up ([P1-20](../plans/phase-1/slices/p1-20-maintenance-plans.md), [P1-15](../plans/phase-1/slices/p1-15-structured-site-evidence.md), [P1-10](../plans/phase-1/slices/p1-10-customer-relationship-timeline.md)).
- Field projection. The assigned employee sees only the equipment linked to the job, the compact issue and access context of a linked case, and the exact plan, equipment, and instruction context of a maintenance visit. Coverage dates, renewal risk, and internal notes are manager-only ([P1-16](../plans/phase-1/slices/p1-16-field-work-pack.md), [P1-18](../plans/phase-1/slices/p1-18-installed-equipment.md), [P1-19](../plans/phase-1/slices/p1-19-reactive-service.md), [P1-20](../plans/phase-1/slices/p1-20-maintenance-plans.md)).
- Reused foundations. Service owns no parallel copy of customers, sites, and requests ([P1-01](../plans/phase-1/slices/p1-01-customer-contacts-and-sites.md), [P1-02](../plans/phase-1/slices/p1-02-client-requests.md)), planning occurrences and dispatch ([P1-11](../plans/phase-1/slices/p1-11-planning-occurrences.md), [P1-12](../plans/phase-1/slices/p1-12-dispatch.md)), work templates ([P1-13](../plans/phase-1/slices/p1-13-work-templates.md)), job-linked time segments ([P1-21](../plans/phase-1/slices/p1-21-time-segments.md)), site evidence ([P1-15](../plans/phase-1/slices/p1-15-structured-site-evidence.md)), the field work pack ([P1-16](../plans/phase-1/slices/p1-16-field-work-pack.md)), documents, or inventory. A later service slice must not create parallel customer, job, time, document, or inventory systems.

### Important current limitations

- No plan is inferred from existing equipment, jobs, requests, documents, or warranty dates.
- Service makes no legal or price decision, sends no message, mutates no stock, segments no time, and encodes no manufacturer rules.
- On-call planning, customer messaging, telemetry, automated diagnosis, and offline or mobile behavior are later scope or decision gates.
- Planning owns appointment time, series edits, capacity, and skipped or cancelled states; it does not own maintenance plans, coverage, or due-work identity. Site evidence supplies reusable artifacts, not a dedicated service order or service history.

## Phase 1 — Complete Operational Core

### Customer Sites And Installed Equipment

Customer service needs a more precise operational context than one customer address. Most of this area is delivered:

- one or more durable work sites (`Einsatzorte`) per customer, since `P1-01`. Buildings, apartments and technical rooms are not separate levels; `P1-18` places equipment on one Einsatzort plus a free position label;
- contacts and access instructions specific to a site, since `P1-01`;
- installed equipment with category, manufacturer, model, typed identifiers including serial numbers, installation and commissioning dates, position label and lifecycle state, since `P1-18`. Equipment carries no responsible customer contact of its own; the site contact from `P1-01` applies;
- warranty facts, commissioning data and links to existing documents such as photos, manuals and certificates, since `P1-18`; prior reports through exact `P1-15` artifact links;
- one bounded component level below a root system, since `P1-18`;
- replacement with a successor identity, removal and decommissioning that retain past service records, since `P1-18`.

Still open in this area:

- QR or barcode identification for fast field access (`P1-34`).

Installed customer equipment is not the same as WerkFlow inventory. Inventory tracks what the trade business owns or stocks; service equipment describes what is installed and maintained at a customer site.

### Service Requests And Reactive Work

Office staff turn a call, email or in-person report into structured service demand. Delivered:

- customer, site, exact installed equipment and contact on the case, since `P1-19`;
- the reported problem as a preserved original customer statement, since `P1-02` for requests and `P1-19` for direct cases;
- urgency, since `P1-02` and `P1-19`;
- suspected warranty, contract, goodwill, rework or charge context as operational triage only, since `P1-19`;
- request attachments since `P1-02`, case documents, evidence links and related prior cases since `P1-19`;
- access guidance on the case since `P1-19`, on top of the site access notes from `P1-01`;
- triage states, clarification, duplicate and continuation relationships that keep both case identities, a responsible office person on the request, and visit scheduling through the linked job, since `P1-19` with `P1-02`, `P1-11` and `P1-12`;
- a committed appointment window recorded against the planned visit, since `P1-12`.

Still open in this area:

- customer-portal intake, which stays a decision gate;
- a preferred appointment window captured at intake, and explicit safety or tenant constraints as structured fields;
- merging duplicate cases into one record. `P1-19` relates duplicates and never merges or deletes.

### Maintenance Plans And Operational Coverage

`P1-20` delivers this area as the baseline above describes: plan revisions, entered coverage with review and renewal signals, stable due work, deliberate visit-job creation with normal `P1-11` scheduling, and completion evidence through the exact submitted artifact revision. Exceptions are explicit facts. Due work moves through `open`, `visit_created`, `completed`, `skipped`, `cancelled` and `superseded`; several compatible due items can share one visit job and occurrence; moving one appointment stays a calendar fact. Editing one appointment, one future occurrence, or the maintenance definition has clearly different effects. Managers see open due items in the `Fälligkeiten` list under `/service/wartung`.

Still open in this area:

- responsible service areas, default visit duration, and tool or material readiness on a plan; the open decisions below name the question;
- how commercial maintenance agreements reference operational coverage once the finance domain owns contract truth.

### Dispatch And Emergency Service

Reactive service needs fast dispatch. Delivered:

- open requests and due follow-ups on `/aufgaben` since `P1-07` and `P1-10`; cases awaiting a visit carry the `visit_required` state since `P1-19`;
- available employees with the right skills through the capacity and qualification assessment, since `P1-11`;
- site and access context, explicit-fact travel feasibility, material demand labeled „nicht reserviert" and tools labeled „nicht bewertet" in the dispatch readiness picture, since `P1-12`;
- emergency, high, normal and low urgency on requests and cases, since `P1-02` and `P1-19`;
- reassignment that supersedes the dispatch revision, and an employee challenge with manager keep-with-reason resolution, since `P1-12`;
- visible acknowledgement of the current dispatch revision per recipient, since `P1-12`.

Still open in this area:

- on-call status and on-call planning with handover context. WerkFlow will not become a public emergency call center;
- contractual response commitments with timers or escalation; the open decisions below name the question;
- travel-time providers (`P1-50`);
- keeping the customer informed through approved communication flows (`P1-46`).

### Field Service Work Package

Since `P1-16`, the assigned technician gets one focused web work pack on the job route. Delivered inside it:

- customer, site, contact, call and navigation actions, and access notes, since `P1-16`;
- the reported issue, urgency and access guidance of the linked service case, since `P1-19`;
- the equipment explicitly linked to the assigned job as a compact projection, since `P1-18`;
- ordered instructions with required or optional items and expected evidence, since `P1-13`; measurements, defects, reports and site-diary entries as structured artifacts, since `P1-15`;
- time and travel capture through the shared global clock, since `P1-21`;
- planned material with take and return actions, since Inventory V1 and `P1-16`;
- photos and notes through contextual documents and artifacts, since `P1-15` and `P1-16`;
- customer signature on an exact artifact revision since `P1-15`, and execution completion state since `P1-14`.

Still open in this area:

- previous service history and equipment manuals inside the pack. An equipment-only document link does not grant employee document access;
- structured safety notes and follow-up recommendations from the field; today the technician reports a blocker and the office owns follow-ups (`P1-10`);
- the native mobile shell with offline access and visible synchronization status (`P1-49`).

The technician does not switch among separate apps for job context, time, documents, material and evidence. Equipment history and the final report still live with the office.

### Checklists, Measurements, And Compliance Evidence

Different equipment and service types need reusable but adaptable documentation:

- template-based steps and measurements;
- required, optional, conditional, and not-applicable items;
- expected ranges and visible exceptions;
- photo or signature requirements where justified;
- original capture time and responsible person;
- correction history;
- version of the template used for the visit;
- exportable service and maintenance evidence.

WerkFlow should not encode technical inspection law or manufacturer requirements without qualified domain validation. The product should provide a reliable evidence framework that approved business templates can use.

### Completion, Follow-Up, And Commercial Handoff

Completing a visit should produce one consistent result:

- work performed and outcome;
- time, travel, material, and other chargeable items;
- customer acknowledgement/signature;
- unresolved defect, recommendation, or next action;
- service report for the customer;
- equipment and site history update;
- follow-up job, quotation request, replacement opportunity, or warranty claim;
- invoice-ready commercial handoff.

Completion should not automatically mean that every technical issue is resolved or every item is billable. Those are separate, explicit states.

### Warranty, Defect, And Return Visits

The business should be able to distinguish:

- new chargeable work;
- contractual maintenance;
- internal correction;
- manufacturer or supplier warranty;
- customer-caused return visit;
- unresolved continuation of earlier work.

This context should follow the job into scheduling, material, reporting, costing, and invoicing so the same work is not billed or absorbed incorrectly.

### Service History And Search

Office and authorized field users should be able to find:

- all work for a customer, site, or installed system;
- prior symptoms, diagnoses, parts, measurements, reports, and technicians;
- open recommendations and recurring failures;
- upcoming or missed maintenance;
- contract and warranty context;
- related documents and customer communication.

The history should be a structured timeline of linked records, not a second document folder or an unsearchable notes field.

## Connected Workflow Contracts

| Feature area           | Service receives                                                             | Service provides                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Customers and CRM      | Customer, contacts, sites, communication preferences, relationship history   | Service requests, installed-equipment history, commitments, and follow-up context        |
| Jobs and projects      | Job lifecycle, assignments, tasks, field artifacts, completion rules         | Service-specific scope, equipment, recurrence, and visit outcome                         |
| Calendar               | Availability, dispatch, resource conflicts, appointment confirmation         | Due work, urgency, duration, skills, and visit constraints                               |
| Employee management    | Skills, certifications, on-call duty, team, and permissions                  | Service workload, assignment history, and qualification demand                           |
| Time tracking          | Work, travel, breaks, supplements, and approved corrections                  | Service/job allocation and commercial context                                            |
| Inventory              | Planned/reserved material, stock, tools, returns, supplier and warranty data | Consumption, removed components, shortages, and replenishment demand                     |
| Documents              | Manuals, photos, certificates, reports, forms, and signatures                | Structured service context and retention relevance                                       |
| Commercial and finance | Contract scope, prices, warranty and billing rules                           | Invoice-ready time/material, reports, follow-up offers, and service profitability inputs |
| AI automations         | Approved analysis, drafting, extraction, and workflow rules                  | Bounded service events and reviewable artifacts                                          |

## Role And UX Principles

- Office users need fast intake, triage, recurrence overview, dispatch, and exception handling.
- Technicians need one mobile work package centered on the current visit.
- Business owners need contract, backlog, response, recurrence, and profitability overview without reading every report.
- Customer contacts should receive clear, professional information without access to internal notes or prices they are not meant to see.
- Equipment history should be available in context, not force the technician to search through a general CRM.
- Required fields should depend on the service type and completion state; every job should not start as a large mandatory form.
- Offline operation, sync state, failed uploads, and conflict recovery must be explicit.
- Corrections to reports, measurements, signatures, material, and time need an audit trail.

## Phase 2 — Intelligence And Automation

After reliable service history and structured artifacts exist, intelligence can help with:

- converting customer messages or call notes into a draft service request;
- suggesting likely customer/site/equipment matches while preserving the original input;
- summarizing relevant history before dispatch;
- turning technician notes or speech into a professional draft report;
- translating field notes into German while preserving the source;
- detecting missing measurements, photos, signatures, or material before completion;
- suggesting follow-up work or quotation items from reviewed findings;
- grouping recurring faults and identifying systems that deserve attention;
- forecasting maintenance workload and material demand;
- drafting customer summaries and reminders;
- identifying possible warranty or repeated-return cases for office review.

Predictive-maintenance claims require enough reliable history and domain validation. WerkFlow should not present a generic model guess as a technical diagnosis.

## Boundaries And Decision Gates

- Building automation, IoT monitoring, remote control, and telemetry ingestion are not assumed Phase 1 scope.
- Installed customer equipment must remain distinct from business-owned inventory/assets.
- Maintenance contracts need commercial ownership in the finance domain; this feature owns operational delivery.
- Technical checklists and measurement ranges require trade-specific validation.
- Emergency dispatch does not imply public 24/7 call-center service.
- Automatic diagnosis, warranty classification, quotation, invoicing, ordering, or customer messaging requires review and audit.
- Location and employee tracking must have a defined operational purpose and privacy/retention policy.

## Open Product Decisions

- ~~Which installed-system types need structured fields first for SHK?~~ Resolved with `P1-18` (2026-08-29): the initial categories are heat generation, storage and hot water, ventilation, solar thermal, water and sanitary systems, bounded components, and an honest `other` case.
- ~~Should sites, buildings, apartments, and technical rooms be separate levels or one flexible location model?~~ Resolved with `P1-18` (2026-08-29): every record belongs to one existing `Einsatzort` and may carry one free position label. No building, apartment, floor or room hierarchy was added.
- Which later slice should add responsible service areas, default duration, tools and material readiness to a plan without duplicating their owners?
- How should commercial maintenance agreements reference operational coverage once the finance domain owns contract truth?
- Which checklist and measurement templates should WerkFlow provide versus the customer create?
- How should field workers record removed/replaced components and warranty returns?
- Which service response commitments need timers or escalation?
- What customer portal functionality belongs in the complete operational core?
- Which report/signature rules vary by service type or customer?
- What evidence is required before the product may suggest predictive maintenance?

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, and links to per-slice acceptance records.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
