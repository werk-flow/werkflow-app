# Customers And CRM

Status: living — last reviewed 2026-10-05

Customer relationship management in WerkFlow is the operational customer context an SHK business needs to receive requests, plan visits, do the work, communicate reliably, and understand a relationship's history.

It is not a generic sales CRM. Users need to know who the customer and the right contact are, where the work happens, what was requested, which equipment is involved, what happened before, and what comes next. They do not maintain campaigns, deal stages, or sales fields that do not improve real work.

## Product Goal

WerkFlow keeps one trusted, organization-scoped customer record from first request through repeat work and service. Office staff can answer:

- Is this caller, email address, property, or company already known?
- Who is the contractual customer, who is the on-site contact, and who receives communication?
- Which address is for billing, which is the work site, and what access information matters?
- What did the customer request, how urgent is it, and who owns the next action?
- Which jobs, projects, documents, communications, installations, service events, approvals, and open issues belong to the relationship?
- Which contact channel may be used?
- What should the field worker know before arriving?

The goal is less duplicate entry, fewer duplicate customers, fewer missed follow-ups, a clear office-to-field handoff, and a useful history for repeat service.

## Current Product Baseline

Admin and Büro maintain the customer record with contacts, work sites, requests, a relationship chronology, follow-ups, and communication guidance. Field workers never open the customer area.

- **Customer list.** Search covers the whole organization, including active contacts and sites, before the list pages. A page of customers is never a complete selection catalog. A failed read of the list or of a customer's sections shows the failure with a retry. [Realtime and caching](../technical/realtime-and-caching.md#server-paginated-lists) owns the paging rules.
- **Customer master data.** A customer is private or commercial, with one email, one phone, one free-form main address, notes, and an optional manual customer number that is unique in the organization. Deleting a customer detaches it from its jobs and projects. The work stays.
- **Contacts and work sites.** A customer has several `Ansprechpartner` and several durable `Einsatzorte`. At most one contact and one site are primary. Saving a contact or site as primary takes the mark from the previous one in the same save. A site has a structured address, access notes, and an optional on-site contact. One click adopts the main address as the first site. Archived contacts and sites stay visible and restorable but leave the work pickers.
- **Work references.** A job references one site and one contact of its customer. A project's default site and contact prefill its jobs, and each job can override them. Selecting a site copies its address into the job as a snapshot, so later site edits never rewrite where work happened. Changing a job's or project's customer clears the old site and contact. The assigned field worker sees the site, its access notes, and a click-to-call contact.
- **Requests.** Capturing an `Anfrage` is fast enough for a live call, and only the summary is required. An unknown caller is captured as free text and later matched to a customer or promoted into a new one without retyping. Promotion creates the customer from the caller data, links it to the request, and records it in the request history in one step. If any part fails, nothing changes. Capturing, editing, closing and reopening a request each saves the request and its history entry in one step. The captured caller data stays on the request.
- **Request lifecycle.** A request is open, optionally in clarification, then converted or closed with a required reason. Managers can reopen a closed request. A converted request is final and read-only. Every change is in the request's history. Open requests appear in `Aufgaben` with owner and age.
- **Once-only conversion.** A request converts exactly once, deliberately, into a new job, a new project, or a reactive service case. Conversion needs a resolved customer. Attachments follow as a second link to the same file. Nothing is scheduled, assigned, or sent. Request and work link to each other. Conversion creates the work, marks the request converted, links its attachments, and records it in the request history in one step, or changes nothing. A second conversion of the same request is refused before it creates any work.
- **Relationship chronology.** The customer detail shows a chronology derived from the customer's records, requests, work, documents, follow-ups, and preference history. Nothing is copied into a separate timeline. Each entry shows who acted and links to its source.
- **Owned follow-ups.** A follow-up has one customer, a manager owner, an exact due time, and an open, completed, or cancelled state. Follow-ups due soon appear in `Aufgaben`, not in a second inbox. A follow-up whose owner left or lost the role surfaces to all managers.
- **Communication guidance.** Per customer, with contact overrides, each channel is allowed, disallowed, or unknown, separately for service, marketing, and required commercial purposes. Missing configuration shows as unknown. Calling or emailing the wrong person, over a disallowed channel, or against a do-not-contact instruction needs a recorded reason. This is guidance only. Nothing is sent and no legal conclusion is drawn.
- **Installed equipment.** Each site lists its recorded `Anlagen` and links to the service-owned detail. An empty list means only that nothing was recorded. CRM never edits the equipment lifecycle.
- **Access boundary.** Customer, contact, site, follow-up, and preference records are manager-only. An assignment gives a field worker the contact, site, and linked equipment of that job, never the customer record.
- **Work in customer context.** The customer detail lists the customer's jobs and projects, and managers create work there with the customer locked. A project has one customer, and its jobs inherit it. A marked placeholder stands where a financial summary will go.

### Important Current Limitations

- Billing recipients, address purposes beyond main address and sites, households, and contacts shared across customers are not modeled. They wait for the commercial slices and a shared-contact decision.
- Customer numbers are manual. Controlled number ranges are a Wave 4 commercial decision.
- There is no customer-master audit trail beyond creator and timestamps on contacts and sites and the request history. A consolidated approach is expected with the shared audit foundations.
- Promised-response reporting and converting a request into an update of existing work are deferred.
- The chronology records no standalone calls, emails, messages, letters, or meetings and never claims a manual note was delivered. `P1-46` owns communication delivery, threading, provider state, templates, failures, and channel security.
- A customer commitment recorded against a planned visit is a calendar fact ([P1-12](../plans/phase-1/slices/p1-12-dispatch.md)). It proves no delivery or consent, sends nothing, and shows as a mismatch for the office when the internal plan moves.
- There is no duplicate detection, merge, alias history, or import-quality workflow.
- Service contracts and a complete warranty history are later scope.
- Preference guidance is deliberately conservative. Legal basis, evidence files, retention, and a reviewed consent regime are open.
- There is no customer portal, self-service, or automated follow-up.
- Deletion exists, but archive, retention, data-subject, and legally constrained deletion processes are not defined.

## Phase 1 — Complete Operational Core

Phase 1 is the complete customer and request foundation for dependable office-to-field work, not a minimal address book. It may ship in increments.

### 1. Customer Identity And Classification

- Private, commercial, and validated public or organizational customers are distinguished, with relationship roles kept apart from sales categories.
- Every customer has a stable identity that survives changes to display name, legal name, address, or contact.
- A commercial customer shows its legal and trading names without duplicate records for spelling variants.
- A private-customer record represents the household or responsible party and still identifies individual contacts.
- Customer numbers and external identifiers are searchable and stable across jobs, imports, exports, and commercial documents.
- Status (active, prospect, inactive, archived, blocked) exists only where it has an operational consequence.
- Organization tags support practical filters such as property manager, contract customer, emergency eligibility, or service region. They never become an open custom-field burden.
- Internal notes stay distinct from information shown to field workers or customers.

### 2. Contacts And Responsibilities

- A customer has several contacts with role and context: owner, tenant, site manager, caretaker, facility manager, purchasing, invoice recipient, architect, emergency contact.
- A contact has several channels, with the preferred and verified ones clear.
- The record shows who approves work, who gets appointment updates, who is on site, and who receives commercial documents, without copying people into job notes.
- A contact can be limited to one site, installation, project, request, or period.
- Former contacts stay in history but are not offered as recipients.
- Shared contacts across customers need an explicit product decision. The system never merges people on email or phone alone.
- Field workers see only the contacts their assigned work needs and can call or navigate from it.

### 3. Multiple Addresses And Work Sites

- A customer can have separate primary, correspondence, billing, delivery, and work-site addresses.
- A work site (`Einsatzort` or `Objekt`) is a durable location, not copied address text. It holds access, parking, keys, opening hours, hazards, contacts, notes, and installed equipment.
- Repeat jobs at a site reuse its current context.
- The model covers a property manager with many buildings, an owner with a tenant on site, and a commercial customer with branches.
- Work selects the right site while commercial workflows can bill a different recipient.
- An address change never rewrites where completed work happened.
- Search and duplicate checks find a customer by site address even when the name differs.

### 4. Leads And Customer Requests

- An `Anfrage` is an operational request for a response or work. A lead is only an unqualified party that may become a customer. Users are not forced through sales jargon for every call.
- Office staff capture a call, email, web request, walk-in, referral, or other message fast enough for live intake.
- A request records known customer, contact, and site, summary, category, source, urgency, received time, attachments, equipment, responsible person, promised response, and next action.
- Unknown callers are captured first, then matched or promoted without retyping.
- Intake distinguishes emergencies, faults, maintenance, quote requests, planned installations, warranty reports, questions, and other validated SHK cases.
- Triage decides between clarification, remote answer, site inspection, a job, a project, an update to existing work, a service case, or a quotation.
- A request can be declined, cancelled, lost, marked duplicate, or closed without work, with a reason and its history.
- Conversion carries source, customer, contact, site, equipment, summary, urgency, attachments, commitments, and communications into the new work.
- A direct repeat job needs no synthetic request when intake history adds nothing.

### 5. Duplicate Prevention, Matching, And Merge

- Before creating or importing a customer, WerkFlow checks normalized name, email, phone, address, customer number, and external identifier and shows likely matches with the reason.
- The user picks the existing customer, creates a distinct one, or requests a merge.
- Matching tolerates German address and company-name variation but never declares identity from weak evidence.
- A merge keeps jobs, projects, requests, documents, contacts, sites, equipment links, communications, consent evidence, identifiers, and history.
- The user resolves conflicting values. The product never silently picks a phone number, address, consent state, or billing recipient.
- Merged identifiers and aliases stay searchable.
- Import reports each row as created, matched, updated, skipped, invalid, or needs review.

### 6. Relationship Timeline

- The customer detail shows one chronology across requests, notes, messages, work, appointments, documents, approvals, installations, service events, defects, and status changes.
- Entries show what happened, when, who was involved, the next action, and the source record.
- Filters cover work, communication, documents, service, commercial summary, and internal activity.
- The timeline is never a second source of truth. It points to the owning record.
- Customer promises and open actions stay above routine automated events.
- Corrections keep attribution and never erase history needed to understand a dispute.

### 7. Communications And Manual Follow-Up

- Office users record inbound and outbound calls, emails, messages, letters, meetings, and customer statements in the right customer, request, or work context.
- A note that a call happened stays distinct from a message delivered through a connected channel.
- A communication records participants, purpose, responsible employee, related records, attachments, delivery state where known, and a next action.
- A user creates a follow-up with owner and due time from a request or communication.
- Overdue callbacks, unanswered requests, and missing customer decisions are highlighted.
- Templates help with appointment confirmations, missing-information requests, delay updates, visit summaries, and completion messages. The user reviews recipient and content.
- Preferences, consent, sensitive content, and delivery failures are checked before a message is sent.
- Bulk campaigns, lead nurturing, social media, and marketing attribution are outside the core.

### 8. Equipment, Installations, And Service Context

- The customer and site views show installed equipment with identity, location, service context, and linked history.
- Equipment links to the work that installed it and to later maintenance or fault work.
- The next technician sees installation history without scanning every document.
- Warranty, commissioning, maintenance interval, contract coverage, and service eligibility show where they affect intake and dispatch.
- Equipment that drives future service is never a free-form note.

### 9. Consent, Preferences, And Communication Safety

- Preferences cover channel, operational notifications, marketing choice, language, accessibility, contact times, and do-not-contact instructions.
- Consent or another relied-upon basis is attributed to person, channel, purpose, source, and time where evidence is required.
- A withdrawal affects future communication without rewriting what was valid before.
- Operational messages, required commercial communication, and marketing are different purposes. One checkbox never grants all channels and uses.
- The UI warns before contacting the wrong person or using a disallowed channel and supports documented exceptions where law and process allow.
- Consent features are not called legally compliant until purpose, retention, proof, controller and processor roles, and German and EU requirements are reviewed.

### 10. Customer Detail And Operational Overview

- The detail shows current contacts, sites, open requests, upcoming and active work, unresolved issues, equipment, recent communication, follow-ups, and important documents without deep navigation.
- Completed history stays searchable without crowding today's priorities.
- Users move from the customer to a request, work, site, equipment, document, or communication and back without losing their place.
- Summaries distinguish confirmed facts from internal notes, inferred matches, old information, and automation proposals.
- Once commercial exists, the detail may show high-level state such as open commercial action or payment status. Invoice editing and accounting stay outside CRM.
- The record works during a live call: fast search, clear contact and site choices, recent context, and a prominent next action.

### 11. Search, Lists, Segments, And Ownership

- Search covers names, company, phone, email, customer and external numbers, site address, equipment identifier, requests, and work history.
- Lists filter by type, active request, next action, responsible employee, region, service relationship, open work, archive state, and data-quality issues.
- Ownership names who is responsible for the relationship or next action. It never blocks other authorized office users from helping.
- Saved views support callbacks, unqualified requests, inactive customers, missing details, and service follow-ups.
- Reporting measures response and handoff quality, not sales pressure.

### 12. Data Lifecycle, Import, Export, And Audit

- Archiving a customer never breaks its work, documents, equipment, commercial, or legal history.
- Deletion, anonymization, and retention account for linked records instead of cascading.
- The user sees why a customer cannot be deleted and which archive, correction, restriction, or data-subject workflow applies.
- Imports cover customers, contacts, sites, identifiers, notes, and relationship data with mapping, validation, duplicate review, and an outcome report.
- The organization can export customers, contacts, sites, requests, communication history, preference and consent evidence, identifiers, and links to work and equipment.
- Changes to identity, contact data, sites, merges, consent, status, ownership, and archive or deletion state are attributable.

## Connected Workflow Contracts

| Connected area            | CRM owns                                                                                              | The connected area owns                                                                                                          | Required contract                                                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobs and projects         | Customer/contact/site/request identity and relationship context                                       | Work scope, assignment, schedule requirements, execution, evidence, completion, and handover                                     | A request can hand off without re-entry; meaningful work events return to the customer timeline; historic work keeps an audit-safe execution context.    |
| Calendar                  | Contact availability, site access context, customer commitments, and communication preference         | Appointments, visit/time-slot planning, employee/resource schedule, and calendar interaction                                     | The calendar uses the correct site/contact and returns schedule changes that may require customer notification.                                          |
| Documents                 | The customer meaning and visibility of a document                                                     | File lifecycle, versioning, links, permissions, audit, retention, recovery, and export                                           | Customer context can find linked documents without copying them; only intentionally approved files become customer-visible.                              |
| Service and maintenance   | Customer/contact/site relationship and intake                                                         | Equipment/installations, contracts, warranties, recurring maintenance, service plans, service history, and technician workflow   | CRM surfaces service context and routes requests to the correct equipment/service record without duplicating the technical lifecycle.                    |
| Commercial and finance    | Customer master context, billing contacts/addresses, relationship timeline, communication preferences | Quotes, contracts/orders, price/tax rules, invoices, payments, accounting, credit/dunning controls, and legally required records | Commercial records use stable customer/contact/address identities and return high-level state/history; CRM does not calculate balances or edit invoices. |
| Inventory and procurement | Customer/site/work context for demand                                                                 | Items, suppliers, stock, reservations, movements, orders, receipts, and costs                                                    | CRM does not own customer material usage; users reach material history through the relevant work or service record.                                      |
| Employees and time        | Relationship/request owner and visibility need                                                        | Organization membership, roles, availability, skills where introduced, working time, absence, and payroll handoff                | Customer access follows role and assigned work; ownership is not a substitute for authorization.                                                         |
| Communications            | Recipients, relationship context, request/work association, preferences, and follow-up intent         | Channel connections, send/receive, templates, delivery state, failures, threading, and communication audit                       | Every delivered/received interaction links to the right customer/contact and owning context; CRM never claims delivery from a manual note.               |
| AI and automation         | Trusted customer context, review destinations, and consent/preference constraints                     | Model/workflow execution, confidence, policy, and automation audit                                                               | Proposals cite their source; merges, customer commitments, consent changes, and outbound communication remain reviewed high-impact actions.              |

## Role And UX Principles

### Admin And Office Users

- Optimize for a call: search first, spot likely duplicates, find the right site and contact, see recent context, create the next action.
- Put active requests and promised actions ahead of old history.
- Make the consequences of merge, archive, contact, consent, and customer-visible communication explicit.
- Keep a one-site private customer simple while a property manager or multi-site customer gets the depth it needs.

### Project Leads And Service Coordinators

- Show the customer, site, equipment, and decision-maker context needed to plan work, clear blockers, approve change work, or coordinate handover.
- Hide unrelated marketing and sensitive commercial data by default.
- Show open customer decisions and their follow-up from the work context.

### Field Workers

- Field workers get customer information through assigned work, never through an organization-wide CRM.
- They see only the contact, site, access, hazards, communication instruction, equipment, and history the visit needs.
- Calling, navigating, recording a customer statement, and reporting wrong data are simple mobile actions.
- Field workers can propose corrected contact or site data. The office reviews it before the master record changes.

### Customers And External Users

- Future customer access uses plain German, minimal navigation, accessible mobile design, and the organization's branding.
- External users see only explicitly shared appointments, requests, work status, documents, decisions, and service information.
- Internal notes, employee data, cost and margin, other contacts, duplicate signals, consent administration, and unapproved documents stay private.

### Cross-Cutting UX

- Use `Kunde`, `Ansprechpartner`, `Anfrage`, `Einsatzort` or `Objekt`, and other practical German labels instead of CRM jargon.
- Reuse known information and show uncertainty. Never force a full profile before recording an urgent request.
- Empty states and validation explain the next operational step.

## Phase 2 — Intelligence And Automation

Phase 2 reduces intake, data-quality, and follow-up work once the customer core is trustworthy.

- Match an incoming call, email, message, form, document, or address to likely customers, contacts, sites, equipment, requests, and work, with the evidence shown.
- Turn a transcript, voicemail, email, or message into a proposed request and next action, keeping the source.
- Summarize relationship history for an office user or assigned technician without exposing unauthorized data.
- Suggest missing details, likely duplicates, stale data, and merge candidates for review.
- Classify urgency and type, propose the handoff, and name missing questions without promising service or changing priority.
- Draft replies, appointment updates, information requests, visit summaries, maintenance reminders, and review requests in the right context and language.
- Propose follow-up timing after an unanswered request, a quote decision, a visit, completed work, a handover, a maintenance date, or a resolved defect.
- Detect recurring faults, repeated rescheduling, open defects, communication failures, or service opportunities from explainable history.
- Prepare a customer-visible relationship or service summary from approved records.
- Automation never changes consent, merges customers, sends sensitive or high-impact communication, commits a schedule, or creates commercial obligations without the configured human approval.

## Boundaries And Decision Gates

- **Operational CRM, not sales CRM.** Campaigns, social selling, opportunity forecasting, quotas, and arbitrary pipelines are non-goals unless SHK customers prove an operational need.
- **Requests are not jobs or deals.** Intake can end in advice, qualification, a quote, service routing, cancellation, or work. Users maintain no fake pipeline stages.
- **Customer, contact, and site are distinct.** One free-form address is not the long-term model, but simple private-customer entry stays fast.
- **Commercial, service, and communications stay separate.** The connected workflow contracts above name what each area owns.
- **Manual and automated follow-up differ.** Phase 1 supports visible owned next actions. Automated messages need the communications and automation contract, channel preferences, consent review, failure handling, and an off switch.
- **A customer portal is a separate boundary.** Portal authentication, external authorization, sharing, uploads, messaging, approvals, payments, support, and revocation need their own spec and threat model.
- **No portal by accident.** Internal customer pages and document links never become externally reachable through superficial hiding.
- **Duplicate automation is conservative.** Uncertain matches are reviewed. Distinct customers can share a phone, email, family name, or address.
- **Consent is specific to purpose and person.** Marketing, service notifications, and required communication never collapse into one preference.
- **Privacy and retention need legal review.** Timeline content, call recording and transcription, AI processing, deletion, anonymization, export, consent evidence, and cross-module retention need a reviewed German and EU scope.
- **Migration quality is product work.** An import is complete only when mappings, duplicates, invalid rows, identifiers, contacts, sites, validation ownership, and export have defined outcomes.

## Open Product Decisions

- Which classifications are needed beyond private and commercial, and which relationship roles stay separate from customer type?
- Is a private-customer record a person, a household, or a contractual party, and how are spouses or co-owners represented?
- Can one contact belong to several customers or sites, and how is authority to approve or receive documents scoped?
- How do landlord, tenant, property manager, owner, bill payer, and on-site contact relate without duplicate customers?
- Can one site have several responsible customers over time, and how is that history kept?
- Which response-time measures matter to SHK businesses? Request sources are a short fixed list. Extend it only with evidence.
- Which duplicate confidence and evidence trigger a warning, a block, or merge review?
- Who may merge customers, and how is a merge reversed?
- Which identifiers must imports and integrations keep?
- Which communications are stored automatically, which are logged manually, and how are employees' private channels excluded?
- Which operational messages need consent versus another basis, and which proof and retention apply?
- Which contacts and notes can assigned field workers see, correct, or add?
- Does relationship ownership sit at customer, site, request, or next-action level?
- Which equipment or service summaries help office users beyond the per-site equipment list? Equipment lifecycle stays with service.
- Which high-level commercial state is useful in CRM without pulling invoice behavior in?
- What are the archive, deletion, anonymization, legal-hold, and data-subject workflows when linked operational and commercial records exist?
- What is the first useful portal scope: request submission, appointment confirmation, document exchange, approvals, service history, or a smaller set?
- How do portal users authenticate, represent companies or households, delegate access, and lose it safely?
- Which follow-ups stay manual, which may be rule-based, and which may use AI drafting?
- Which customer data must an assigned technician have offline, and how are changes reconciled?
- Which customer metrics improve service quality without turning WerkFlow into a sales-surveillance tool?
