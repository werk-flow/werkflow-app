# Service And Maintenance

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

WerkFlow does not currently have a dedicated service-and-maintenance module.

Relevant foundations already exist:

- customers;
- standalone jobs and projects;
- employee assignments and calendar planning;
- job instruction/checklist items;
- job-linked time;
- contextual documents and photos;
- inventory planning and physical take/return flows;
- basic tool/asset infrastructure inside inventory.

These foundations should be reused. A future service feature should not create parallel customer, job, time, document, or inventory systems.

## Phase 1 — Complete Operational Core

### Customer Sites And Installed Equipment

Customer service needs a more precise operational context than one customer address.

The product should support:

- one or more sites, buildings, units, or service locations per customer;
- contacts and access instructions specific to a site;
- installed equipment or systems with type, manufacturer, model, serial number, installation date, location, status, and responsible customer contact;
- photos, manuals, certificates, warranty information, commissioning records, and prior reports;
- structured components where a system contains several relevant units;
- replacement, decommissioning, or ownership history without erasing past service records;
- QR or barcode identification for fast field access where useful.

Installed customer equipment is not the same as WerkFlow inventory. Inventory tracks what the trade business owns or stocks; service equipment describes what is installed and maintained at a customer site.

### Service Requests And Reactive Work

Office staff should be able to turn a call, email, message, or customer-portal request into structured service demand:

- customer, site, equipment, and contact;
- reported problem and symptoms;
- urgency and operational impact;
- preferred or committed appointment window;
- warranty, contract, or chargeable-work context;
- attachments, photos, and prior related work;
- access, safety, or tenant constraints.

The business should be able to triage, clarify, merge duplicates, assign responsibility, schedule a visit, and preserve the original customer statement.

### Maintenance Plans And Contracts

The product should support recurring maintenance without requiring the office to recreate every job manually:

- maintenance plan tied to a customer site or installed system;
- interval, due window, checklist/template, expected duration, skills, tools, and material;
- responsible team or service area;
- contract start/end, included scope, exclusions, pricing basis, and renewal context;
- automatic generation or proposal of upcoming service work;
- exception handling for skipped, combined, moved, or canceled visits;
- due, overdue, completed, and contract-at-risk views;
- evidence that the agreed work was completed.

Recurring generation must remain understandable. Editing one appointment, one future occurrence, or the maintenance definition should have clearly different effects.

### Dispatch And Emergency Service

Reactive service needs fast dispatch:

- see unplanned and overdue requests;
- identify available employees with the right skills and on-call status;
- consider location, travel time, equipment, and material readiness;
- distinguish emergency, urgent, normal, and contractual response commitments;
- reassign or escalate when a technician cannot complete the work;
- keep the customer informed through approved communication flows;
- show the office whether the field worker has received and acknowledged the assignment.

Emergency-service support should include on-call planning and handover context without turning WerkFlow into a public emergency call center.

### Field Service Work Package

The future mobile experience should give the technician one focused work package:

- customer, site, contact, navigation, and access information;
- reported issue and previous relevant history;
- installed equipment and manuals;
- scope, checklist, safety notes, and expected measurements;
- time and travel capture;
- planned and available material;
- photos, annotations, notes, measurements, defects, and follow-up recommendations;
- customer signature and completion state;
- offline access to the necessary data and visible synchronization status.

The technician should not have to switch among separate apps for job context, time, documents, material, equipment history, and the final report.

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

| Feature area | Service receives | Service provides |
| --- | --- | --- |
| Customers and CRM | Customer, contacts, sites, communication preferences, relationship history | Service requests, installed-equipment history, commitments, and follow-up context |
| Jobs and projects | Job lifecycle, assignments, tasks, field artifacts, completion rules | Service-specific scope, equipment, recurrence, and visit outcome |
| Calendar | Availability, dispatch, resource conflicts, appointment confirmation | Due work, urgency, duration, skills, and visit constraints |
| Employee management | Skills, certifications, on-call duty, team, and permissions | Service workload, assignment history, and qualification demand |
| Time tracking | Work, travel, breaks, supplements, and approved corrections | Service/job allocation and commercial context |
| Inventory | Planned/reserved material, stock, tools, returns, supplier and warranty data | Consumption, removed components, shortages, and replenishment demand |
| Documents | Manuals, photos, certificates, reports, forms, and signatures | Structured service context and retention relevance |
| Commercial and finance | Contract scope, prices, warranty and billing rules | Invoice-ready time/material, reports, follow-up offers, and service profitability inputs |
| AI automations | Approved analysis, drafting, extraction, and workflow rules | Bounded service events and reviewable artifacts |

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

- Which installed-system types need structured fields first for SHK?
- Should sites, buildings, apartments, and technical rooms be separate levels or one flexible location model?
- When should a maintenance plan generate a job, and how far into the future?
- How should recurring work interact with contract renewal or cancellation?
- Which checklist and measurement templates should WerkFlow provide versus the customer create?
- How should field workers record removed/replaced components and warranty returns?
- Which service response commitments need timers or escalation?
- What customer portal functionality belongs in the complete operational core?
- Which report/signature rules vary by service type or customer?
- What evidence is required before the product may suggest predictive maintenance?

## Related Docs

- [Product capability map](../product/product-capability-map.md)
- [Phase 1 build roadmap](../plans/phase-1-build-roadmap.md)
- [Competitive landscape](../product/competitive-landscape.md)
- [Customers and CRM](./customers-and-crm.md)
- [Jobs and projects](./jobs-and-projects.md)
- [Calendar and resource planning](./calendar-and-resource-planning.md)
- [Employee management](./employee-management.md)
- [Time tracking](./time-tracking.md)
- [Inventory](./inventory.md)
- [Document management](./document-management.md)
- [Commercial and finance](./commercial-and-finance.md)
- [AI automations](./ai-automations.md)
