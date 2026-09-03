# Document Management

Status: living — last reviewed 2026-09-03

Document management gives SHK businesses a central digital place for job photos, contracts, invoices, offers, reports, and general business files. The goal is to reduce paper folders, scattered files, and disconnected customer/project documentation while staying practical for office staff and extremely simple for field workers.

This document describes the current product baseline, the Phase 1 and Phase 2 build-out, and the open decisions. The implementation reference, from storage paths and the signed upload flow to RLS, operations, audit vocabulary, and code locations, lives in [Document storage and access](../technical/document-storage-and-access.md). For exact schema details, prefer live Supabase inspection and `lib/supabase/database.types.ts` over this file.

## Product Goal

Document management should:

- Reduce paper dependency and scattered local files.
- Make job/project/customer/employee documents easy to find from operational context.
- Let office/manager users organize files like a lightweight Drive/SharePoint.
- Keep field-worker flows upload/view/download simple on mobile.
- Preserve recoverability and traceability for business-critical files.

Before adding more scope, ask WerkFlow's three product questions:

- Does this reduce paperwork?
- Does this make work more organized?
- Does this save time?

## Current Product Baseline

As of 2026-09-02, document management is substantially implemented. Admin and Büro organize all organization files in the central library under `/dokumente`; operational records carry a contextual `Dokumente & Bilder` section; field workers upload, view, and download files only on their assigned jobs. File bytes live in private Cloudflare R2 buckets in EU jurisdiction and all metadata in Postgres. The implementation reference lives in [Document storage and access](../technical/document-storage-and-access.md).

- **Central library.** Admin and Büro browse a manual folder tree with breadcrumbs, the `Verknüpfungen` overview grouped by linked target, and `Alle Dateien`, with search, category and link filters, sortable columns, and a separate `Papierkorb`. They create, rename, move, copy, and delete folders, and upload single files, batches, or whole folders, including mixed drag and drop. The table supports multi-select, rectangle select, drag-to-folder, batch move, copy, and delete, and one shared row menu.
- **One file, many links.** A document exists once and is linked by metadata to jobs, projects, customers, employees, requests, installed equipment, service cases, and maintenance coverage ([P1-02](../plans/phase-1/slices/p1-02-client-requests.md), [P1-18](../plans/phase-1/slices/p1-18-installed-equipment.md), [P1-19](../plans/phase-1/slices/p1-19-reactive-service.md), [P1-20](../plans/phase-1/slices/p1-20-maintenance-plans.md)). Links never copy bytes. Converting a request adds a second link from each attachment to the created work. WerkFlow creates no folder when an operational record is created; manual folders and link filters organize the library instead.
- **Contextual sections.** Job, project, customer, employee, request, equipment, service-case, and coverage pages show their linked documents. Managers attach existing library files, manage links in one dialog, and remove a link without deleting the file. Assigned employees upload, view, and download on their job only, from the focused field work pack; they never see the library, trash, versions, or audit history ([P1-16](../plans/phase-1/slices/p1-16-field-work-pack.md)).
- **Recoverability and history.** Delete moves a file to the `Papierkorb`, where managers restore or permanently delete it. Documents in the `contract`, `invoice`, `offer`, and `report` categories keep numbered versions. Every action lands in an audit history that managers see in the details dialog. Categories `photo`, `contract`, `invoice`, `offer`, `report`, and `other` are labels inferred at upload and editable by managers; a category is not a structured record.
- **Viewer.** PDFs and images open in a large in-app viewer with a download fallback. A link to `/dokumente?document=<id>` opens one exact document, which the customer chronology uses for its document entries ([P1-10](../plans/phase-1/slices/p1-10-customer-relationship-timeline.md)).
- **Evidence and handover artifacts.** A work-template item may declare an expected evidence category without creating a file ([P1-13](../plans/phase-1/slices/p1-13-work-templates.md)). A document can be related to one exact work-artifact revision as evidence, closure proof, signature mark, or export; ordinary uploads never become evidence automatically ([P1-15](../plans/phase-1/slices/p1-15-structured-site-evidence.md)). A handover release freezes exact document versions and registers one customer-safe HTML package as an ordinary document; the app does not deliver it and creates no public link ([P1-17](../plans/phase-1/slices/p1-17-office-handover.md)).
- **Protected personnel documents.** A personnel file is a separate access class outside the ordinary library, owned by the personnel record rather than by an employee link, with standard, Admin-only, and health-evidence classes. The affected employee reaches only expressly released versions, and no job assignment or ordinary document permission widens that access ([P1-24](../plans/phase-1/slices/p1-24-controlled-people-lifecycle.md)).
- **History guards.** Once an equipment-history event depends on a document link, ordinary unlink and permanent deletion are rejected ([P1-18](../plans/phase-1/slices/p1-18-installed-equipment.md)). Equipment, service-case, and coverage links grant an assigned employee no document access beyond the exact assigned job ([P1-19](../plans/phase-1/slices/p1-19-reactive-service.md), [P1-20](../plans/phase-1/slices/p1-20-maintenance-plans.md)).
- **Storage maintenance.** Server-side helpers report orphaned and missing storage objects and delete validated orphans. They are not exposed in the `/dokumente` UI.

### Important current limitations

- No automatic folder per job, project, customer, or employee. This is deliberate; see the design decisions in the technical doc.
- No OCR, invoice parsing, or AI classification.
- No thumbnail generation.
- No dedicated offer, contract, or invoice entities.
- No version rollback; previous versions can only be downloaded.
- No external delivery, public link, or customer portal for any document or handover package.
- Attach-existing from the library targets jobs, projects, customers, and employees; request, equipment, service-case, and coverage links are made from their own detail pages.

## Phase 1 — Complete Operational Core

Stages 1–4 established the reliability foundation: private storage, contextual links, manager organization, audit, trash, restore, versioning, viewer, and cleanup safeguards.

The complete operational core should extend that foundation in the following product areas.

### Capture And Inbound Documents

Users should be able to bring documents into WerkFlow from the way the business actually receives or creates them:

- web file/folder upload;
- mobile camera scan and photo capture;
- files shared from the future mobile operating system;
- approved email-to-WerkFlow or message attachment intake;
- generated reports, offers, invoices, contracts, and forms from other WerkFlow features;
- supplier and accounting documents received through supported integrations.

Every inbound path should show:

- organization and uploader/source;
- upload and processing state;
- duplicate or version warning where relevant;
- required review before a file becomes a trusted financial or legal record;
- a recoverable error when upload, processing, or linking fails.

### Findability And Large-Library Use

The manager library should remain usable at real business volume:

- generated image/PDF thumbnails where they materially improve scanning;
- full-text search across supported digital documents;
- OCR text for scans and photos;
- search by document metadata, linked context, date, category, participant, and business reference;
- saved filters or smart collections for recurring office work;
- visible processing and index state;
- bulk actions and export that remain understandable;
- performance that does not require the office user to know the storage layout.

OCR makes a document searchable. It does not by itself make extracted values financially correct.

### Structured Forms, Reports, And Signatures

WerkFlow should support structured operational artifacts without turning every form into a custom software project:

- reusable report and form templates;
- job, service, measurement, inspection, handover, defect, and site-diary outputs;
- required and conditional fields;
- original capture time and responsible person;
- photos and annotations;
- internal approval and customer signature where relevant;
- correction and version history;
- stable PDF/export output for external use.

The structured record and rendered file should remain linked so future changes do not create two unrelated sources of truth.

### Document Review And Approval

Selected documents should support:

- review owner and due state;
- comments or correction requests;
- approval, rejection, replacement, and superseded state;
- multi-step approval only where the business process requires it;
- clear distinction between internal review and customer signature;
- audit of who accepted financially or legally relevant extracted data.

The product should avoid imposing document approval on ordinary job photos or low-risk uploads.

### Commercial And Accounting Integration

Documents should connect to dedicated structured records:

- an uploaded supplier invoice can become the source for a reviewed incoming-bill draft;
- an offer, order confirmation, contract, invoice, credit, or service report generated by WerkFlow remains linked to its structured entity;
- delivery notes can be connected to purchase orders and receipts;
- customer and supplier files can be found from both their business context and the central library;
- commercial corrections create appropriate versions or successor records instead of mutating signed/final artifacts without trace.

Document categories remain useful for organization, but a file categorized as `invoice` is not automatically a structured invoice or an accounting transaction.

### Governance, Retention, And Portability

Complete document management needs policy-level clarity:

- organization retention rules by document type;
- legal-hold or deletion-block behavior where required;
- role and context access that stays understandable;
- external sharing with recipient, expiry, revocation, and download history where justified;
- complete organization export with files, metadata, versions, links, and audit context;
- import/migration that preserves meaningful folder and reference information;
- recoverability and deletion behavior aligned across structured records and stored files.

Infrastructure direction for retention ([decision 0001](../decisions/0001-infrastructure-stack.md), designed in slice `P1-45`): retention-relevant document categories get copies in a separate, independently administered S3 bucket with Object Lock in compliance mode, so not even an administrator can delete them during the retention period. German retention is per category (books/financial statements commonly 10 years, vouchers commonly 8, commercial correspondence commonly 6 — AO §147 / HGB §257 / UStG §14b), so retention policy must be category-aware rather than a blanket lock on every photo.

Claims such as `GoBD-konform`, `revisionssicher`, or legally sufficient electronic signature require qualified validation before they appear in product marketing.

### Smart Views Without Folder Duplication

The product may add metadata-driven views for:

- every customer, site, project, job, service asset, employee, supplier, purchase, or commercial record;
- missing-document and awaiting-approval work;
- recently generated or externally shared artifacts;
- retention or review exceptions.

These views should use the existing link model. Physical folder creation should remain optional and deliberate unless a validated operational need outweighs its rename, synchronization, and duplicate-file costs.

## Connected Workflow Contracts

| Feature area             | Document management receives                                                               | Document management provides                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Customers and CRM        | Customer, contact, site, request, and communication context                                | Findable customer files, correspondence artifacts, consent, and relationship evidence  |
| Jobs and projects        | Work scope, project/job identity, field artifacts, completion and handover state           | Plans, photos, reports, forms, signatures, and document packs                          |
| Service and maintenance  | Installed-equipment context, checklist/report type, measurement and signature requirements | Manuals, certificates, service reports, history artifacts, and customer handover       |
| Employees and time       | Employee identity, role, personnel-document context, and approved time exports             | Restricted personnel files, certificates, contracts, and generated time evidence       |
| Inventory and purchasing | Item, supplier, order, receipt, return, and stock-count context                            | Catalog files, delivery notes, supplier invoices, warranties, and equipment documents  |
| Commercial and finance   | Structured offer, contract, invoice, credit, expense, payment, and accounting state        | Source files, rendered outputs, versions, signatures, and reviewed extraction evidence |
| AI automations           | Authorized source scope, processing request, and review policy                             | Searchable content, source references, drafts, and document-trigger events             |

No feature should store a private duplicate merely to display the same file in its context.

## Role And UX Principles

- `admin` and `buero` need the central library, governance, review, bulk organization, and export.
- `employee` users need only the documents, capture actions, and forms required for assigned work.
- Personnel, financial, contract, customer, and supplier documents need purpose-specific access rather than one broad `manager` assumption forever.
- Upload should remain fast; classification, linking, and extraction suggestions must not block simple field evidence.
- Document status, structured-record status, processing status, and approval status should be visually distinct.
- A failed upload, scan, OCR, extraction, share, or signature must remain visible with a recovery action.
- Mobile capture should make offline and synchronization state explicit.
- Destructive actions, link removal, permanent deletion, and version replacement must explain their cross-context impact.

## Phase 2 — Intelligence And Automation

Once the capture, search, structured-record, and review foundations are stable, intelligence can support:

- category, link-target, and smart-view suggestions;
- extraction of invoice, delivery-note, offer, contract, report, and form fields;
- comparison of versions or contract/offer changes;
- summaries of large document sets with source references;
- identification of missing signatures, required attachments, or inconsistent values;
- conversion of speech, notes, and photos into a report draft;
- routing a reviewed document into the correct job, service, procurement, or commercial workflow;
- document-triggered automations with explicit permissions and approvals.

Financially, legally, technically, or employment-relevant extraction remains a proposal until an authorized person reviews it. The original file and extracted source region should remain available.

## Boundaries And Decision Gates

- Document management is not a replacement for structured jobs, stock, employee, service, or finance records.
- A document category does not create commercial/accounting meaning on its own.
- Automatic physical folder creation remains deferred unless user research establishes a stronger need than metadata-driven views.
- Broad employee library access should not be introduced merely for convenience.
- External sharing and electronic signatures need security, identity, revocation, retention, and legal-validity decisions.
- Long-term archive and compliance claims require qualified German legal/accounting validation.
- AI may propose classification, extraction, links, summaries, and workflows; it must not silently alter signed or financially final records.

## Open Product Decisions

- Which Phase 1 workflows require OCR and full-text search first?
- Which document types need structured templates rather than uploaded files?
- Which review/approval patterns deserve a shared product workflow?
- What retention and deletion rules should be configurable by document category?
- Which external sharing and signature use cases provide enough value for the first complete product?
- What organization-wide export format preserves files, links, versions, and structured record relationships?
- Which personnel, financial, supplier, and customer documents require more granular permission groups?
- When should a newly uploaded file be treated as a duplicate, a new version, or a different business record?
- Which extracted fields may be accepted in bulk, and which always require individual review?

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, and links to per-slice acceptance records.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
- [Decision 0001 — infrastructure stack](../decisions/0001-infrastructure-stack.md) — the R2 storage decision this feature implements.
- [Technical architecture](../technical/architecture.md) — the signed-upload storage flow in the runtime picture.
- [Document storage and access](../technical/document-storage-and-access.md). Storage paths, signed upload flow, RLS matrix, operations reference, audit vocabulary, and code locations.
