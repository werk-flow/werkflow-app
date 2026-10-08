# Service And Maintenance

Status: living — last reviewed 2026-10-05

Service and maintenance covers recurring maintenance, reactive customer service, faults, inspections, emergency work, and the long-term history of installed customer equipment.

It is a distinct SHK operating model, not another job status. It connects customer sites and installations with contracts, recurring demand, dispatch, field execution, materials, reports, and billing.

## Product Goal

WerkFlow helps an SHK business:

- know which equipment exists at each customer site;
- understand its history, warranty, service interval, and open issues;
- generate and plan recurring maintenance work reliably;
- dispatch reactive and emergency service with enough context;
- give the technician a simple, complete mobile work package;
- capture legally and commercially useful evidence once;
- turn completed service into a report, follow-up task, quotation, and invoice without duplicate entry.

The goal is less forgotten maintenance, fewer paper service folders and repeated customer questions, complete field reports, no unbilled material, and no reliance on one employee's memory.

## Current Product Baseline

Admin and Büro manage installed equipment, reactive service cases, and maintenance plans. Service builds on the existing customer, job, planning, dispatch, template, evidence, time, document, and inventory owners and copies none of their facts. A later service slice must not create parallel customer, job, time, document, or inventory systems.

- **Installed equipment.** Managers register equipment on one customer site (`Einsatzort`) with a free position label, and one component level below a root system. Buildings, apartments, and technical rooms are not separate levels. Equipment has a stable number, identifiers such as serial numbers, warranty and commissioning facts, document and work links, a lifecycle state, and searchable history that nobody can edit. Unknown technical facts stay visibly unknown. Replacement creates a successor and keeps the predecessor, and removal or decommissioning keeps past service records. Equipment has no contact of its own; the site contact applies. Customer pages show a compact site view ([P1-18](../plans/phase-1/slices/p1-18-installed-equipment.md)).
- **Installed equipment is not inventory.** Inventory tracks what the trade business owns or stocks. Installed equipment describes what sits at a customer site and gets maintained.
- **Reactive service.** Managers create a case directly or qualify an existing `Anfrage` exactly once. The case keeps the customer's original statement and is triaged against one site and exact equipment, with urgency, access guidance, and a suspected warranty, contract, goodwill, rework, or charge context. That context is operational triage only. Duplicate, related, and continuation links keep both cases; WerkFlow never merges or deletes a duplicate. A case connects to one job, which then runs through the normal calendar, dispatch, field-work, evidence, and follow-up flows. Triage and commercial context stay office-only ([P1-19](../plans/phase-1/slices/p1-19-reactive-service.md)).
- **Maintenance plans.** A versioned plan binds one site, exact equipment, and one published work-template version. It creates due work for an 18-month horizon before any job exists. Creating or revising an active plan, or activating a plan, generates its due work in the same save, so an active plan never stands without its due work. Overlapping active coverage needs an explicit reason. Coverage dates and renewal signals are entered operational facts, not legal or commercial contract truth ([P1-20](../plans/phase-1/slices/p1-20-maintenance-plans.md)).
- **Maintenance visits.** A manager deliberately creates a visit job for a due item and schedules it in a separate step as a normal appointment. The visit job takes its number and the plan's template and attaches to the due work in one step, so a refused attachment leaves no job and no used number. Scheduling creates the appointment and attaches it to the due work together. A stale due item or an appointment for another job refuses both. Compatible due items may share one visit. Moving an appointment is a calendar fact and never rewrites the plan or other due work. Editing one appointment, one future appointment, or the maintenance definition has clearly different effects. Completion links the exact submitted evidence revision, records a separate complete, partial, or unresolved outcome, advances the next due date, and may link a service case or create a follow-up.
- **Dispatch.** Open requests and customer follow-ups appear in `Aufgaben`. Cases awaiting a visit and open due work appear in the Servicefälle list and the Wartung workspace, not in `Aufgaben`. Dispatch shows qualified available employees, site and access context, travel feasibility from entered facts, material demand marked as not reserved, and tools marked as not assessed. Reassignment replaces the dispatch revision, an employee can challenge an assignment that a manager may keep with a reason, and each recipient's acknowledgement is visible.
- **Lists.** The Anlagen and Servicefälle lists search, filter, count and page on the server. The Wartung workspace pages its open due work, plans and coverages on the server: one search covers all three, each list pages on its own, and each tab count covers every matching record in the organization, not only the visible page. A failed read on a service page shows the failure with a retry. The maintenance workspace keeps a plan on a deactivated site listed with its due work.
- **Field work pack.** The assigned technician gets one work pack on the job: customer, site, contact, call and navigation, access notes, ordered instructions with expected evidence, measurements, defects, photos, notes, customer signature on an exact evidence revision, time and travel through the shared clock, and planned material with take and return. The pack shows only the equipment linked to the job, the issue and access context of a linked case, and the plan, equipment, and instructions of a maintenance visit. Coverage dates, renewal risk, and internal notes are manager-only.

### Important Current Limitations

- No plan is inferred from existing equipment, jobs, requests, documents, or warranty dates.
- Service makes no legal or price decision, sends no message, changes no stock, splits no time, and encodes no manufacturer rules.
- Planning owns appointment time, series edits, capacity, and skipped or cancelled appointments. It does not own maintenance plans, coverage, or due-work identity. Site evidence supplies reusable artifacts, not a dedicated service report or service history.
- The work pack has no service history or equipment manuals yet. A document linked only to equipment does not give an employee access to it.
- The technician reports a blocker; the office owns follow-ups. Equipment history and the final report live with the office.
- On-call planning, customer messaging, telemetry, automated diagnosis, and offline or native mobile use are later scope or decision gates.

## Phase 1 — Complete Operational Core

### Customer Sites And Installed Equipment

Still open: QR or barcode identification for fast field access (`P1-34`).

### Service Requests And Reactive Work

Still open:

- customer-portal intake, which stays a decision gate;
- a preferred appointment window captured at intake, and safety or tenant constraints as structured fields.

### Maintenance Plans And Operational Coverage

Still open:

- responsible service areas, default visit duration, and tool or material readiness on a plan;
- how commercial maintenance agreements reference operational coverage once the finance domain owns contract truth.

### Dispatch And Emergency Service

Still open:

- on-call status and on-call planning with handover context. WerkFlow will not become a public emergency call center;
- contractual response commitments with timers or escalation;
- travel-time providers (`P1-50`);
- keeping the customer informed through approved communication flows (`P1-46`).

### Field Service Work Package

The technician does not switch between separate apps for job context, time, documents, material, and evidence. Still open:

- previous service history and equipment manuals in the pack;
- structured safety notes and follow-up recommendations from the field;
- the native mobile shell with offline access and visible sync status (`P1-49`).

### Checklists, Measurements, And Compliance Evidence

Different equipment and service types need reusable but adaptable documentation:

- template-based steps and measurements;
- required, optional, conditional, and not-applicable items;
- expected ranges and visible exceptions;
- photo or signature requirements where justified;
- original capture time and responsible person;
- correction history;
- the template version used for the visit;
- exportable service and maintenance evidence.

WerkFlow does not encode technical inspection law or manufacturer requirements without qualified domain validation. It provides a reliable evidence framework that approved business templates use.

### Completion, Follow-Up, And Commercial Handoff

Completing a visit produces one consistent result:

- work performed and outcome;
- time, travel, material, and other chargeable items;
- customer acknowledgement or signature;
- unresolved defect, recommendation, or next action;
- service report for the customer;
- equipment and site history update;
- follow-up job, quotation request, replacement opportunity, or warranty claim;
- invoice-ready commercial handoff.

Completion does not mean that every technical issue is resolved or every item is billable. Those are separate, explicit states.

### Warranty, Defect, And Return Visits

The business distinguishes:

- new chargeable work;
- contractual maintenance;
- internal correction;
- manufacturer or supplier warranty;
- customer-caused return visit;
- unresolved continuation of earlier work.

This context follows the job into scheduling, material, reporting, costing, and invoicing, so the same work is neither billed nor absorbed by mistake.

### Service History And Search

Office and authorized field users find:

- all work for a customer, site, or installed system;
- prior symptoms, diagnoses, parts, measurements, reports, and technicians;
- open recommendations and recurring failures;
- upcoming or missed maintenance;
- contract and warranty context;
- related documents and customer communication.

The history is a structured timeline of linked records, not a second document folder or an unsearchable notes field.

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
- Customer contacts receive clear, professional information without access to internal notes or prices they are not meant to see.
- Equipment history is available in context. The technician never has to search a general CRM for it.
- Required fields depend on the service type and completion state. A job does not start as a large mandatory form.
- Offline operation, sync state, failed uploads, and conflict recovery are explicit.
- Corrections to reports, measurements, signatures, material, and time keep an audit trail.

## Phase 2 — Intelligence And Automation

Once reliable service history and structured artifacts exist, intelligence can:

- turn customer messages or call notes into a draft service request;
- suggest likely customer, site, and equipment matches while keeping the original input;
- summarize relevant history before dispatch;
- turn technician notes or speech into a draft report;
- translate field notes into German while keeping the source;
- detect missing measurements, photos, signatures, or material before completion;
- suggest follow-up work or quotation items from reviewed findings;
- group recurring faults and flag systems that need attention;
- forecast maintenance workload and material demand;
- draft customer summaries and reminders;
- flag possible warranty or repeated-return cases for office review.

Predictive-maintenance claims need enough reliable history and domain validation. WerkFlow never presents a generic model guess as a technical diagnosis.

## Boundaries And Decision Gates

- Building automation, IoT monitoring, remote control, and telemetry ingestion are not Phase 1 scope.
- Installed customer equipment stays distinct from business-owned inventory.
- The finance domain owns maintenance contracts commercially; this feature owns operational delivery.
- Technical checklists and measurement ranges need trade-specific validation.
- Emergency dispatch does not imply a public 24/7 call center.
- Automatic diagnosis, warranty classification, quotation, invoicing, ordering, or customer messaging needs review and audit.
- Location and employee tracking needs a defined operational purpose and a privacy and retention policy.

## Open Product Decisions

- Which later slice adds responsible service areas, default duration, tools, and material readiness to a plan without duplicating their owners?
- How do commercial maintenance agreements reference operational coverage once the finance domain owns contract truth?
- Which checklist and measurement templates does WerkFlow provide, and which does the customer create?
- How do field workers record removed or replaced components and warranty returns?
- Which service response commitments need timers or escalation?
- What customer portal functionality belongs in the complete operational core?
- Which report and signature rules vary by service type or customer?
- What evidence is required before the product may suggest predictive maintenance?

The [product capability map](../product/product-capability-map.md) owns cross-feature handoffs, and the [Phase 1 roadmap](../plans/phase-1/roadmap.md) owns slice order and status.
