# Customers And CRM

Customer relationship management in WerkFlow means maintaining the operational customer context an SHK business needs to receive requests, plan visits, perform work, communicate reliably, and understand the history of a relationship.

It does not mean copying a generic enterprise sales CRM. Most WerkFlow users need to know who the customer and relevant contact are, where the work happens, what was requested, what equipment is involved, what has happened before, and what must happen next. They should not have to maintain marketing campaigns, abstract deal stages, or sales-administration fields that do not improve real work.

## Product Goal

WerkFlow should provide one trusted, organization-scoped customer record from first request through repeat work and service. Office staff should be able to answer:

- Is this caller, email address, property, or company already known?
- Who is the contractual customer, who is the on-site contact, and who should receive communication?
- Which address is for billing, which is the work site, and what access information matters?
- What did the customer request, how urgent is it, and who owns the next action?
- Which jobs, projects, documents, communications, installations, service events, approvals, and open issues belong to the relationship?
- Which contact channel may and should be used?
- What customer context should the field worker see before arriving?

The goal is less duplicate entry, fewer duplicate customers, fewer missed follow-ups, clearer handoff from office to field, and a useful history for repeat service. The [competitive landscape](../product/competitive-landscape.md) provides the external research background; this feature spec defines WerkFlow's narrower SHK-focused product direction.

## Current Product Baseline

The current customer area is a useful master-data and work-context foundation, but it is not yet a complete operational CRM.

### Implemented Today

- Customers are organization-scoped records with a name, type (`privat` or `gewerblich`), an optional org-unique customer number (`Kundennummer`, manual entry, no automatic number ranges yet), one email address, one phone number, one free-form main/billing address, notes, and created/updated timestamps.
- **Contacts (`Ansprechpartner`), P1-01:** a customer can have multiple contact people (`client_contacts`) with name, free-text German role label (suggestions offered), email, phone, notes, a single primary marker, and archive state. Archived contacts stay visible in an "Archiviert" list and can be restored; they no longer appear in work pickers.
- **Work sites (`Einsatzorte`), P1-01:** a customer can have multiple durable sites (`client_sites`) with a name, structured address (street, postal code, city), access notes (keys, parking), general notes, an optional on-site contact, a single primary marker, and archive state. A one-click helper adopts the customer's free-form address as the first site.
- **Work references, P1-01:** jobs carry optional `site_id`/`contact_id`; projects carry an optional default site/contact that prefills new jobs inside the project, and every job may override it (no forced sync). Selecting a site auto-fills the job's free-text `Ort` with the site's current address; that text stays a snapshot, so later site-address edits never rewrite the recorded execution location of existing work, while the site link continues to show current master data. Changing a job's or project's customer clears the previous customer's site/contact references (server-enforced, with DB-level org/client consistency validation).
- The assigned field worker sees the job's site (name, address, access notes) and contact (name, role, click-to-call phone) on the job detail page.
- Customer search on `/kunden` matches name, customer number, email, phone, address, active contact names, and active site addresses.
- `client_contacts` and `client_sites` are Realtime-published; the customer list and customer detail refresh live.
- `admin` and `buero` users can access `/kunden`, create customers, edit customer details, and delete customers. The route is not exposed to the `employee` role.
- The customer list has responsive desktop and mobile presentations, shows customer count, type, email, and phone, and supports a manual refresh.
- A customer detail page provides inline-editable customer metadata.
- The detail page embeds the customer's associated standalone jobs and projects with the normal work-list capabilities.
- Managers can create a job or project in the locked customer context from the customer detail.
- Customer documents can be uploaded, linked, viewed, and managed through the contextual document feature and central document library.
- Job and project creation can select an existing customer or create one without leaving the workflow.
- A project has one customer, and jobs inside the project inherit that customer. Changing the project customer synchronizes its jobs.
- Deleting a customer removes the association from existing jobs and projects rather than deleting the work itself.
- Calendar and job context can use the current customer name and address.
- The customer detail contains a clearly marked financial-summary placeholder, but structured invoices, payments, contracts, revenue totals, and open balances are not implemented.

### Important Current Limitations

- Contacts and sites exist (P1-01), but dedicated billing recipients, address purposes beyond main-address-plus-sites, households, and shared contacts across customers are not modeled; those wait for the commercial slices and an explicit shared-contact decision.
- Customer numbers are manual and org-unique; controlled number ranges remain a Wave 4 commercial decision.
- There is no customer-master audit trail yet beyond `created_by`/timestamps on contacts and sites; a consolidated audit approach is expected with the shared audit foundations.
- There is no structured lead/request intake, ownership, urgency, next action, qualification, source, or conversion history.
- There is no customer communication timeline for calls, emails, messages, letters, meetings, delivery state, or promised follow-ups.
- There is no duplicate detection, merge flow, alias/history preservation, or import-quality workflow.
- There is no structured link to customer installations/equipment, service contracts, warranties, or maintenance history.
- Consent, channel preferences, language, accessibility needs, and do-not-contact rules are not modeled.
- There is no customer portal, customer self-service, or automated follow-up workflow.
- Employees receive customer context through assigned work, not through a general customer directory.
- Deletion is available, but a mature archive, retention, data-subject, and legally constrained deletion process is not yet defined.

Exact schema, RLS, and live permissions must still be checked against live Supabase and generated types before implementation work.

## Phase 1 — Complete Operational Core

Phase 1 is not a minimal address book. It is the complete operational customer and request foundation needed for dependable office-to-field work. The feature may be delivered incrementally, but the following depth is the expected Phase 1 outcome.

### 1. Customer Identity And Classification

- The organization can distinguish private customers, commercial customers, public/organizational customers where validated, and relevant relationship roles without forcing unrelated sales categories.
- Every customer has a stable identity that remains usable when the display name, legal name, address, or contact changes.
- Commercial customers can show their legal and practical operating names without creating duplicate records for spelling variants.
- Private-customer records can represent the household or responsible customer while still identifying individual contacts where needed.
- Customer numbers and external identifiers are searchable and remain stable across jobs, imports, exports, and later commercial documents.
- Customer status distinguishes active, prospect/unqualified, inactive, archived, and blocked relationships only where those states have a clear operational consequence.
- Organization-specific tags or attributes support practical filters such as property manager, contract customer, key account, emergency-service eligibility, or service region. They must not become an uncontrolled generic custom-field burden.
- Internal notes are clearly distinguished from information that may be shown to field workers or customers.

### 2. Contacts And Responsibilities

- One customer can have multiple contact people with role and context, such as owner, tenant, site manager, caretaker, facility manager, purchasing contact, invoice recipient, architect, or emergency contact.
- Contacts can have multiple relevant channels while making the preferred channel and verified/current details clear.
- The user can identify who may approve work, who receives appointment updates, who is available on site, and who receives commercial documents without copying the same person into job notes.
- A contact may be relevant only to one site, installation, project, request, or time period.
- Former contacts remain visible in history without appearing as current recipients.
- Shared contacts across related customer records require an explicit product decision; the system must not silently merge people based only on an email address or phone number.
- Field workers see only contacts necessary for assigned work and can immediately call or navigate through the relevant work context.

### 3. Multiple Addresses And Work Sites

- A customer can have separate primary, correspondence, billing, delivery, and work-site addresses.
- A work site (`Einsatzort` or `Objekt`) is a durable operational location, not just copied address text. It can hold access instructions, parking, keys, opening hours, hazards, responsible contacts, site notes, and the relevant equipment/installations.
- One customer can have many sites, and repeat jobs at the same site reuse the current site context.
- The system supports practical relationship cases such as a property manager responsible for many buildings, an owner with a tenant on site, or a commercial customer with several branches.
- Jobs and projects select the correct work site while commercial workflows can use a different billing recipient/address.
- Address changes do not rewrite the historic execution location of completed work. Current master data and the audit-safe historical work context remain understandable.
- Search and duplicate checks can find a customer through a site address even when the customer name differs.

### 4. Leads And Customer Requests

- WerkFlow treats an `Anfrage` as an operational request for response or work. A `lead` is only an unqualified person or organization that may become a customer; users should not be forced through sales jargon for every phone call.
- Office staff can capture a phone call, email, web request, walk-in, referral, or manually received message quickly enough to use during real intake.
- A request records the customer/contact/site if known, summary, category, source, urgency, received time, attachments, relevant equipment, responsible office person, promised response, and next action at the level required for dependable handling.
- Unknown callers can be captured before a full customer record exists, then matched or promoted without retyping the request.
- Intake distinguishes emergencies, faults, maintenance requests, quote requests, planned installations, warranty/defect reports, general questions, and other validated SHK cases.
- Office users can triage whether the request needs clarification, remote response, site inspection, a standalone job, a project, an existing-work update, a service case, or a commercial quotation process.
- A request can be declined, cancelled, lost, duplicated, or closed without work, with a practical reason and retained history.
- Converting a request carries its source, customer, contact, site, equipment, summary, urgency, attachments, commitments, and relevant communications into the resulting workflow.
- A direct repeat job remains possible without manufacturing a synthetic lead/request when intake history adds no value.

### 5. Duplicate Prevention, Matching, And Merge

- Before creating or importing a customer, WerkFlow checks relevant combinations of normalized name, email, phone, address/site, customer number, and external identifier and presents likely matches.
- The user can inspect why records might match and choose the existing customer, create a distinct customer, or request a merge.
- Duplicate prevention tolerates German address and company-name variation without declaring two people or businesses identical from weak evidence.
- A controlled merge preserves jobs, projects, requests, documents, contacts, sites, equipment links, communications, consent evidence, identifiers, and audit history.
- Conflicting values are resolved explicitly. The product does not silently select a phone number, address, consent state, or billing recipient.
- Merged identifiers and aliases remain searchable so an old document, imported number, or caller detail still reaches the surviving customer.
- Import provides a reviewable quality outcome: created, matched, updated, skipped, invalid, or needs review.

### 6. Relationship Timeline

- The customer detail offers a chronological operational history across requests, calls/notes, messages, jobs, projects, appointments, documents, approvals, installations, service events, defects, and important status changes.
- Timeline entries show what happened, when, who was involved, the responsible next action, and the linked source record.
- Users can filter the timeline by work, communication, documents, service/equipment, commercial summary, and internal activity without losing the complete chronology.
- A timeline is not a second source of truth. It points to the owning work, document, communication, service, or commercial record.
- Important customer promises and unresolved actions remain visible above routine automated events.
- Corrections preserve attribution and do not erase the history used to understand a dispute or missed handoff.

### 7. Communications And Manual Follow-Up

- Authorized office users can record inbound and outbound calls, emails, messages, letters, meetings, and customer statements in the relevant customer/request/work context.
- Communication history distinguishes a note that a call happened from an actual message delivered through a connected channel.
- Each communication can identify participants, subject/purpose, responsible employee, related request/job/project/site/equipment, attachments, delivery state where available, and a required next action.
- A user can create a practical manual follow-up with owner and due time from a request or communication.
- The system highlights overdue promised callbacks, unanswered requests, missing customer decisions, and other relationship actions that need attention.
- Templates can support appointment confirmation, missing-information requests, delay updates, visit summaries, and completion messages, while the user reviews the actual recipient and content.
- Contact preferences, consent, sensitive content, and delivery failure are respected before a message is sent.
- Bulk campaigns, broad lead nurturing, social-media management, and marketing attribution are outside the operational CRM core.

### 8. Equipment, Installations, And Service Context

- The customer/site view can show installed equipment and systems relevant to SHK work, including the identity, location, current service context, and linked documents/history needed to find the right record.
- Equipment can link to the project/job that installed or commissioned it and to later maintenance or fault work.
- The next technician can see the relevant installation history without scanning every customer document.
- Warranty, commissioning, maintenance interval, contract coverage, and service eligibility can be surfaced where they affect intake and dispatch.
- The service/maintenance area remains the owner of technical equipment lifecycle, recurring maintenance, contracts, service plans, and detailed service history. CRM provides relationship and navigation context.
- Equipment is not stored as a free-form customer note when it must drive future service.

### 9. Consent, Preferences, And Communication Safety

- Customer/contact preferences can express preferred channel, allowed operational notifications, marketing choice where relevant, language, accessibility needs, contact times, and explicit do-not-contact instructions.
- Consent or other relied-upon communication basis is attributable to the correct person, channel, purpose, source, and time where the workflow requires evidence.
- Withdrawal or preference changes affect future communication without rewriting the history of what was valid previously.
- Operational messages, legally required commercial communication, and marketing are treated as different purposes; one checkbox must not imply permission for all channels and uses.
- The UI warns before a user contacts the wrong person or uses a disallowed channel, while supporting documented exceptions where law and business process permit them.
- Consent features are not described as legally compliant until the exact purpose, retention, proof, controller/processor roles, and German/EU requirements have been reviewed.

### 10. Customer Detail And Operational Overview

- The customer detail makes current contacts, sites, open requests, upcoming work, active jobs/projects, unresolved issues, relevant equipment, recent communication, required follow-ups, and important documents visible without a deep navigation chain.
- Completed history remains searchable without crowding today's operational priorities.
- Users can move directly from customer context to request, work, site, equipment, document, or communication and return without losing their place.
- Customer summaries distinguish confirmed facts from internal notes, inferred matches, old information, and automation proposals.
- Commercial/finance summaries may show approved high-level state such as open commercial action or payment status when that module exists, but invoice editing and accounting remain outside CRM.
- A customer record can be used during a live call: fast search, clear current contact/site choices, recent context, and a prominent next action.

### 11. Search, Lists, Segments, And Ownership

- Users can search customers through customer/contact name, company, phone, email, customer/external number, site address, equipment identifier, request, and relevant work history.
- Lists support practical filters such as customer type, active request, next action, responsible employee, site/region, service relationship, open work, inactive/archive state, and data-quality issues.
- Ownership means who is responsible for the relationship or next action; it must not prevent other authorized office users from helping the customer.
- Saved operational views help office staff manage callbacks, unqualified requests, inactive customers, missing contact details, or service follow-ups.
- Reporting measures response and handoff quality without creating sales-pressure dashboards disconnected from service outcomes.

### 12. Data Lifecycle, Import, Export, And Audit

- Customers can be archived without breaking their work, documents, equipment, commercial, or legal history.
- Deletion, anonymization, and retention behavior account for linked operational and future commercial records rather than treating customer removal as a simple cascade.
- A user can see why a customer cannot be deleted and which archive, correction, restriction, or data-subject workflow is appropriate.
- Imports support current customers, contacts, sites, identifiers, notes, and relevant relationship data with mapping, validation, duplicate review, and an outcome report.
- The organization can export customers, contacts, sites, requests, communication history, preferences/consent evidence, identifiers, and links to work/equipment in a usable form.
- Material changes to identity, contact data, sites, merge, consent/preferences, status, ownership, and deletion/archive state are attributable.

## Connected Workflow Contracts

| Connected area | CRM owns | The connected area owns | Required contract |
| --- | --- | --- | --- |
| Jobs and projects | Customer/contact/site/request identity and relationship context | Work scope, assignment, schedule requirements, execution, evidence, completion, and handover | A request can hand off without re-entry; meaningful work events return to the customer timeline; historic work keeps an audit-safe execution context. |
| Calendar | Contact availability, site access context, customer commitments, and communication preference | Appointments, visit/time-slot planning, employee/resource schedule, and calendar interaction | The calendar uses the correct site/contact and returns schedule changes that may require customer notification. |
| Documents | The customer meaning and visibility of a document | File lifecycle, versioning, links, permissions, audit, retention, recovery, and export | Customer context can find linked documents without copying them; only intentionally approved files become customer-visible. |
| Service and maintenance | Customer/contact/site relationship and intake | Equipment/installations, contracts, warranties, recurring maintenance, service plans, service history, and technician workflow | CRM surfaces service context and routes requests to the correct equipment/service record without duplicating the technical lifecycle. |
| Commercial and finance | Customer master context, billing contacts/addresses, relationship timeline, communication preferences | Quotes, contracts/orders, price/tax rules, invoices, payments, accounting, credit/dunning controls, and legally required records | Commercial records use stable customer/contact/address identities and return high-level state/history; CRM does not calculate balances or edit invoices. |
| Inventory and procurement | Customer/site/work context for demand | Items, suppliers, stock, reservations, movements, orders, receipts, and costs | CRM does not own customer material usage; users reach material history through the relevant work or service record. |
| Employees and time | Relationship/request owner and visibility need | Organization membership, roles, availability, skills where introduced, working time, absence, and payroll handoff | Customer access follows role and assigned work; ownership is not a substitute for authorization. |
| Communications | Recipients, relationship context, request/work association, preferences, and follow-up intent | Channel connections, send/receive, templates, delivery state, failures, threading, and communication audit | Every delivered/received interaction links to the right customer/contact and owning context; CRM never claims delivery from a manual note. |
| AI and automation | Trusted customer context, review destinations, and consent/preference constraints | Model/workflow execution, confidence, policy, and automation audit | Proposals cite their source; merges, customer commitments, consent changes, and outbound communication remain reviewed high-impact actions. |

## Role And UX Principles

### Admin And Office Users

- Optimize for handling a call or message quickly: search first, identify likely duplicates, find the correct site/contact, understand recent context, and create the next action.
- Present active requests and promised actions ahead of low-value history.
- Make merge, archive, contact, consent, and customer-visible communication consequences explicit.
- Progressive disclosure keeps a one-site private customer simple while allowing a property manager or multi-site commercial customer to have the required depth.

### Project Leads And Service Coordinators

- Show the customer/site/equipment and decision-maker context required to plan work, resolve blockers, approve change work, or coordinate handover.
- Do not expose unrelated marketing or sensitive commercial information by default.
- Make unresolved customer decisions and the responsible follow-up visible from the work context.

### Field Workers

- Field workers receive customer information through assigned work, not an unrestricted organization-wide CRM.
- Show only the correct contact, site, access, hazards, communication instruction, equipment context, and relevant history needed for the visit.
- Calling, navigation, documenting a customer statement, and escalating wrong/outdated data should be simple mobile actions.
- Field workers can propose corrected contact/site information, but office review protects the customer master record.

### Customers And External Users

- Future customer-facing access uses plain German, minimal navigation, accessible mobile design, and clear organization branding.
- External users see only explicitly shared appointments, requests, work status, documents, decisions, and service information.
- Internal notes, employee data, cost/margin, other contacts, duplicate signals, consent administration, and unapproved documents remain private.

### Cross-Cutting UX

- Use `Kunde`, `Ansprechpartner`, `Anfrage`, `Einsatzort`/`Objekt`, and other practical German labels instead of generic CRM jargon.
- Reuse known information and make uncertainty visible; do not force users to populate a large profile before recording an urgent request.
- Preserve organization boundaries, least-privilege access, accessible interaction, and mobile readability.
- Empty states and validation explain the operational next step rather than merely rejecting input.

## Phase 2 — Intelligence And Automation

Phase 2 should reduce intake, data-quality, and follow-up work after the operational customer core is trustworthy.

- Match an incoming call, email, message, form, document, or address to likely customers, contacts, sites, equipment, requests, and active work with explainable evidence.
- Turn a call transcript, voicemail, email, or message into a proposed structured request and next action while retaining the source.
- Summarize the relevant relationship history for an office user or assigned technician without exposing unauthorized or unrelated information.
- Suggest missing contact/site details, likely duplicates, stale data, and safe merge candidates for review.
- Classify urgency and request type, propose the right handoff, and identify missing questions without silently promising service or changing priority.
- Draft customer replies, appointment updates, missing-information requests, visit summaries, maintenance reminders, or review requests in the right context and language.
- Propose follow-up timing after an unanswered request, quotation decision, scheduled visit, completed work, handover, maintenance due date, or resolved defect.
- Detect customers or sites with recurring faults, repeated rescheduling, unresolved defects, communication failures, or service opportunities using explainable history.
- Prepare a customer-visible relationship or service summary from approved records.
- Automation never changes consent, merges customers, sends sensitive/high-impact communication, commits a schedule, or creates commercial obligations without the configured human approval.

## Boundaries And Decision Gates

- **Operational CRM, not generic sales CRM:** broad campaign management, social selling, complex opportunity forecasting, gamified quotas, and arbitrary sales pipelines are non-goals unless SHK customer evidence proves a concrete operational need.
- **Requests are not automatically jobs or deals:** intake can end in advice, qualification, quotation, service routing, cancellation, or work. The user should not maintain fake pipeline stages.
- **Customer, contact, and site are distinct:** one free-form address cannot remain the long-term model, but the product must keep simple private-customer entry fast.
- **Commercial ownership stays separate:** CRM supplies stable identities, billing contacts/addresses, preferences, and history. Offers, contracts, invoices, balances, payments, dunning, tax, and accounting belong to commercial/finance.
- **Service ownership stays separate:** CRM links the relationship; the service area owns equipment technical data, installations, maintenance contracts, recurring schedules, warranties, and service execution.
- **Communication history is not a messaging implementation:** the communications area owns delivery, threading, provider state, templates, failures, and channel security.
- **Manual and automated follow-up are different:** Phase 1 supports visible owned next actions. Automated messages or sequences require the communications/automation contract, channel preferences, consent/legal review, failure handling, and an off switch.
- **A customer portal is a planned separate boundary:** CRM provides identity, relationship context, and approved records, but portal authentication, external authorization, sharing, uploads, messaging, approvals, payments, support, and revocation require their own specification and threat model.
- **No portal-by-accident:** ordinary internal customer detail pages or document links must never become externally accessible through superficial hiding.
- **Duplicate automation must be conservative:** uncertain matches are reviewed. Phone, email, family name, or address alone may be shared by distinct customers or contacts.
- **Consent is purpose- and person-specific:** marketing, appointment/service notifications, and legally required communication cannot be collapsed into one preference.
- **Privacy and retention require legal validation:** timeline content, call recording/transcription, AI processing, deletion, anonymization, export, consent evidence, and cross-module retention need a reviewed German/EU scope.
- **Employee access is purpose-limited:** a field worker's assigned job does not imply unrestricted access to the customer's full history, contacts, commercial data, or other sites.
- **Migration quality is product work:** a customer import is not complete until mappings, duplicates, invalid rows, identifiers, contacts/sites, validation ownership, and usable export have defined outcomes.

## Open Product Decisions

- Which customer classifications are required beyond `privat` and `gewerblich`, and which relationship roles should be separate from customer type?
- Is the primary private-customer record a person, household, or contractual party, and how are spouses or multiple owners represented?
- Can one contact belong to multiple customers/sites, and how is authority to approve or receive documents scoped?
- ~~Which address/site vocabulary is clearest for SHK users?~~ Decided with P1-01: the UI uses `Einsatzort` (with `Ansprechpartner` for contacts); revisit only with real user feedback.
- How should landlord, tenant, property manager, owner, bill payer, and on-site contact relationships work without duplicate customer records?
- Can one site have multiple current responsible customers over time, and how is the historical relationship preserved?
- What is the minimum request lifecycle and which reasons close a request without work?
- Does WerkFlow need a distinct `lead` object, or is an unqualified request with provisional identity sufficient?
- Which request sources and response-time measures matter to real SHK businesses?
- What duplicate confidence and evidence require warning, block, or merge review?
- Who may merge customers, and how can a merge be reversed or corrected?
- Which identifiers must imports and integrations preserve?
- Which communications are stored automatically, which require manual logging, and how are personal/private employee channels excluded?
- Which operational messages require consent versus another valid basis, and what proof/retention is required?
- Which contacts and notes can assigned field workers see, correct, or add?
- Should relationship ownership exist at customer, site, request, or next-action level?
- Which equipment summary belongs in CRM, and where does the dedicated service/maintenance model begin?
- What high-level commercial state is useful in CRM without pulling invoice behavior into the customer feature?
- What are the archive, deletion, anonymization, legal-hold, and data-subject workflows when linked operational/commercial records exist?
- What is the first useful customer portal scope: request submission, appointment confirmation, document exchange, approvals, service history, or a smaller combination?
- How will portal users authenticate, represent companies/households, delegate access, and lose access safely?
- Which follow-ups should remain manual, which may be rules-based, and which may use AI drafting?
- What customer data must be available offline to an assigned technician, and how are changes reconciled?
- Which customer and relationship metrics improve service quality without turning WerkFlow into a sales-surveillance tool?

## Related Docs

- [Jobs and projects](./jobs-and-projects.md)
- [Product capability map](../product/product-capability-map.md)
- [Phase 1 build roadmap](../plans/phase-1-build-roadmap.md)
- [Competitive landscape](../product/competitive-landscape.md)
- [Calendar and resource planning](./calendar-and-resource-planning.md)
- [Service and maintenance](./service-and-maintenance.md)
- [Document management](./document-management.md)
- [Inventory management](./inventory.md)
- [Commercial and finance](./commercial-and-finance.md)
- [Time tracking](./time-tracking.md)
- [Employee management](./employee-management.md)
- [AI automations](./ai-automations.md)
