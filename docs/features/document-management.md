# Document Management

Status: living — last reviewed 2026-10-04

Document management gives SHK businesses one digital place for job photos, contracts, invoices, offers, reports, and general business files. It replaces paper folders and scattered files. Office staff get a practical library, and field workers get a very simple flow. [Document storage and access](../technical/document-storage-and-access.md) owns storage, upload, access, and audit mechanics.

## Product Goal

Document management should:

- Reduce paper and scattered local files.
- Make job, project, customer, and employee documents easy to find from their operational context.
- Let office users organize files like a lightweight Drive or SharePoint.
- Keep upload, view, and download simple for field workers on mobile.
- Keep business-critical files recoverable and traceable.

## Current Product Baseline

Admin and Büro organize ordinary organization files in the central library. Operational records show their documents in a contextual section. Field workers upload, view, and download ordinary files on assigned jobs. Protected personnel files follow separate access rules.

- **Central library.** Admin and Büro browse a manual folder tree, an overview grouped by linked target, and a list of all files, with search, filters, sorting, and a separate `Papierkorb`. They create, rename, move, copy, and delete folders. They upload single files, batches, or whole folders by drag and drop. Batch move, copy, and delete work on a multi-selection. Deleting or copying a folder covers its whole tree or nothing.
- **Paged lists.** Search, sorting, and filters cover every authorized document before the library pages its results. Paging clears the selection, so a batch action acts only on the displayed page. [Realtime and caching](../technical/realtime-and-caching.md#server-paginated-lists) owns the paging rules.
- **One file, many links.** A document exists once. Links connect it to jobs, projects, customers, employees, requests, installed equipment, service cases, and maintenance coverage. A link never copies the file. Converting a request links each of its attachments to the created work as well. WerkFlow creates no folder when an operational record is created. Manual folders and link filters organize the library instead.
- **Contextual sections.** Every linked record shows its documents. Managers attach existing library files, manage links in one dialog, and remove a link without deleting the file. Assigned employees upload, view, and download only on their own job, from the field work pack. On the page of a project with at least one of their jobs, they also view and download the project's own documents, read-only. Job documents there stay limited to their own jobs. They never see the library, the trash, versions, or audit history.
- **Recovery and history.** Delete moves a file to the `Papierkorb`, where managers restore or permanently delete it. Contracts, invoices, offers, and reports keep numbered versions. Managers see the audit history of every document. Each upload, new version, link change, rename, category change, move, copy, delete, restore, and permanent deletion saves together with its audit entry, or not at all. An upload registers the file and its link together, and a refused upload keeps no stored file. WerkFlow infers a category at upload, and managers can change it. A category is a label, not a structured record.
- **Viewer.** PDFs and images open in a large in-app viewer with a download fallback. A link can open one exact document, and the customer chronology uses such links.
- **Evidence and handover.** A work-template item may name an expected evidence category without creating a file. A document can be tied to one exact work-artifact revision as evidence, closure proof, signature mark, or export. An ordinary upload never becomes evidence by itself. A handover release freezes exact document versions and stores one customer-safe package as an ordinary document. The app does not deliver the package and creates no public link.
- **Protected personnel documents.** A personnel file is a separate access class outside the ordinary library. It belongs to the personnel record, not to an employee link. The affected employee reaches only versions that were expressly released. No job assignment or ordinary document permission widens this access. [Employee management](employee-management.md) owns the access classes.
- **History guards.** Once an equipment-history event depends on a document link, WerkFlow rejects unlinking or permanently deleting that document. Equipment, service-case, and coverage links give an assigned employee no document access beyond the assigned job.

### Important Current Limitations

- No automatic folder per job, project, customer, or employee. This is deliberate.
- No OCR, invoice parsing, AI classification, or thumbnails.
- No dedicated offer, contract, or invoice records.
- No version rollback. Users can only download previous versions.
- No external delivery, public link, or customer portal for any document or handover package.
- Attaching an existing library file works for jobs, projects, customers, and employees. Request, equipment, service-case, and coverage links start from their own detail pages.

## Phase 1 — Complete Operational Core

The complete operational core extends the baseline in the following areas.

### Capture And Inbound Documents

Documents should enter WerkFlow the way the business receives or creates them: web upload, mobile camera scan and photo, files shared from the future mobile app, approved email or message intake, documents generated by other WerkFlow features, and supplier or accounting documents from supported integrations.

Every inbound path shows the source and uploader, the upload and processing state, and a duplicate or version warning where relevant. A file needs review before it becomes a trusted financial or legal record.

### Findability And Large-Library Use

The library should stay usable at real business volume:

- thumbnails where they help scanning;
- full-text search for digital documents and OCR text for scans and photos;
- search by metadata, linked context, date, category, participant, and business reference;
- saved filters for recurring office work;
- visible processing and index state;
- bulk actions and export that stay understandable, without the office user knowing the storage layout.

OCR makes a document searchable. It does not make extracted values financially correct.

### Structured Forms, Reports, And Signatures

WerkFlow should support structured artifacts without turning every form into a custom project: reusable report and form templates, job, service, measurement, inspection, handover, defect, and site-diary outputs, required and conditional fields, capture time and responsible person, photos and annotations, internal approval and customer signature where relevant, correction history, and stable PDF output.

The structured record and its rendered file stay linked, so there are never two unrelated sources of truth.

### Document Review And Approval

Selected documents should support a review owner and due state, comments or correction requests, approval, rejection, replacement, and superseded state. Multi-step approval appears only where the business process needs it. Internal review and customer signature stay distinct. The audit records who accepted financially or legally relevant extracted data.

Ordinary job photos and low-risk uploads get no approval step.

### Commercial And Accounting Integration

Documents should connect to structured records:

- an uploaded supplier invoice can become the source of a reviewed incoming-bill draft;
- an offer, order confirmation, contract, invoice, credit, or service report that WerkFlow generates stays linked to its record;
- delivery notes connect to purchase orders and receipts;
- customer and supplier files are findable from their business context and from the library;
- a commercial correction creates a new version or successor record and never changes a signed or final artifact without trace.

A file in the invoice category is not a structured invoice or an accounting transaction.

### Governance, Retention, And Portability

Complete document management needs:

- retention rules per document type, and legal hold or deletion blocks where required;
- role and context access that stays understandable, possibly with a finer `Dokumentenfreigabe` that decides which project documents field workers see;
- external sharing with recipient, expiry, revocation, and download history where justified;
- a complete organization export with files, metadata, versions, links, and audit context;
- import that keeps meaningful folder and reference information;
- the same recovery and deletion behavior for structured records and their files.

The retention archive follows [decision 0001](../decisions/0001-infrastructure-stack.md). `P1-45` owns its design and delivery, and it is not implemented. Retention rules must distinguish document categories and need qualified legal review before implementation or any compliance claim. Claims such as `GoBD-konform`, `revisionssicher`, or a legally sufficient electronic signature need qualified validation before they appear in marketing.

### Smart Views Without Folder Duplication

The product may add metadata-driven views per customer, site, project, job, service asset, employee, supplier, purchase, or commercial record, and views for missing documents, pending approvals, recently generated or shared artifacts, and retention or review exceptions.

These views use the existing link model. Physical folders stay optional and deliberate unless a validated need outweighs their rename, sync, and duplicate-file costs.

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

No feature stores a private duplicate only to show the same file in its context.

## Role And UX Principles

- `admin` and `buero` need the central library, governance, review, bulk organization, and export.
- `employee` users need documents, capture, and forms for assigned work, plus their released personnel documents and requested evidence uploads.
- Personnel, financial, contract, customer, and supplier documents need purpose-specific access, not one broad manager permission forever.
- Upload stays fast. Classification, linking, and extraction suggestions never block simple field evidence.
- Document status, record status, processing status, and approval status look visibly different.
- A failed upload, scan, OCR run, extraction, share, or signature stays visible with a recovery action.
- Mobile capture shows offline and sync state explicitly.
- Link removal, permanent deletion, and version replacement explain their effect on every linked context.

## Phase 2 — Intelligence And Automation

Once capture, search, structured records, and review are stable, intelligence can:

- suggest categories, link targets, and smart views;
- extract fields from invoices, delivery notes, offers, contracts, reports, and forms;
- compare versions and contract or offer changes;
- summarize large document sets with source references;
- find missing signatures, missing attachments, and inconsistent values;
- turn speech, notes, and photos into a report draft;
- route a reviewed document into the right job, service, procurement, or commercial workflow;
- run document-triggered automations with explicit permissions and approvals.

Financially, legally, technically, or employment-relevant extraction stays a proposal until an authorized person reviews it. The original file and the source region stay available.

## Boundaries And Decision Gates

- Document management does not replace structured job, stock, employee, service, or finance records.
- A document category creates no commercial or accounting meaning.
- Automatic physical folders stay deferred unless user research shows a stronger need than metadata-driven views.
- Broad employee library access is not added for convenience.
- External sharing and electronic signatures need security, identity, revocation, retention, and legal-validity decisions.
- Long-term archive and compliance claims need qualified German legal and accounting validation.
- AI may propose classification, extraction, links, summaries, and workflows. It never silently changes signed or financially final records.

## Open Product Decisions

- Which Phase 1 workflows need OCR and full-text search first?
- Which document types need structured templates instead of uploaded files?
- Which review and approval patterns deserve a shared product workflow?
- Which retention and deletion rules should be configurable per document category?
- Which external sharing and signature use cases are worth it for the first complete product?
- Which organization-wide export format keeps files, links, versions, and record relationships?
- Which personnel, financial, supplier, and customer documents need finer permission groups?
- When is a new upload a duplicate, a new version, or a different business record?
- Which extracted fields may be accepted in bulk, and which always need individual review?
