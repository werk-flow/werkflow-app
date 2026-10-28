# Customers and CRM

The CRM is the operational customer context of an SHK business: who the customer and the right contact are, where the work happens, what was requested and what happened before. It keeps one organization-scoped record from the first request through repeat work and service. It is not a sales CRM with campaigns or deal stages.

## Current Product Baseline

Admin and Büro maintain customers, contacts, work sites, requests, follow-ups and communication guidance. Field workers never open the customer area.

- **Customer list.** Search covers the whole organization, active contacts and sites included, before the list pages. A page of customers is never a complete selection catalog. A failed read of the list or of a customer section shows the failure with a retry. [Realtime and caching](../technical/realtime-and-caching.md#server-paginated-lists) owns the paging rules.
- **Master data.** A customer is private or commercial, with one email, one phone, one free-form main address, notes and an optional manual customer number, unique in the organization. Deleting a customer detaches it from its jobs and projects. The work stays.
- **Contacts and sites.** A customer has several `Ansprechpartner` and several `Einsatzorte`. At most one of each is primary, and saving one as primary takes the mark from the previous one in the same save. A site has a structured address, access notes and an optional on-site contact. One click adopts the main address as the first site. Archived contacts and sites stay visible and restorable but leave the work pickers.
- **Work references.** A job references one site and one contact of its customer. A project's default site and contact prefill its jobs, and each job can override them. Selecting a site copies its address into the job as a snapshot, so a later site edit never rewrites where work happened. Changing the customer of a job or project clears the old site and contact. The assigned field worker sees the site, its access notes and a click-to-call contact.
- **Requests.** An `Anfrage` is fast to capture during a call. Only the summary is required. An unknown caller is free text. It is later matched to a customer or promoted into a new one without retyping. Promotion creates the customer, links it and writes the request history in one step, or changes nothing. Capture, edit, close and reopen each save the request and its history entry in one step. The captured caller data stays on the request.
- **Request lifecycle.** A request is open, optionally in clarification, then converted or closed with a required reason. Managers can reopen a closed request. A converted request is final and read-only. Every change is in the request history. Open requests appear in `Aufgaben` with owner and age.
- **Once-only conversion.** A request converts exactly once, deliberately, into a new job, a new project or a reactive service case. Conversion needs a resolved customer. It creates the work, marks the request converted, links the attachments as a second link to the same file and writes the history in one step, or changes nothing. Request and work link to each other. Nothing is scheduled, assigned or sent. A second conversion is refused before it creates any work.
- **Chronology.** The customer detail derives a chronology from the customer's records, requests, work, documents, follow-ups and preference history. Nothing is copied into a separate timeline. Each entry shows who acted and links to its source.
- **Follow-ups.** A follow-up has one customer, a manager owner, an exact due time and a state: open, completed or cancelled. Follow-ups due soon appear in `Aufgaben`, not in a second inbox. A follow-up whose owner left or lost the role surfaces to all managers.
- **Communication guidance.** Per customer, with contact overrides, each channel is allowed, disallowed or unknown, separately for service, marketing and required commercial purposes. Missing configuration shows as unknown. Calling or emailing the wrong person, over a disallowed channel or against a do-not-contact instruction needs a recorded reason. The guidance sends nothing and draws no legal conclusion.
- **Installed equipment.** Each site lists its recorded `Anlagen` and links to the service-owned detail. An empty list means only that nothing was recorded. CRM never edits the equipment lifecycle.
- **Access boundary.** Customer, contact, site, follow-up and preference records are manager-only. An assignment gives a field worker the contact, site and linked equipment of that job, never the customer record.
- **Work in customer context.** The customer detail lists the customer's jobs and projects. Managers create work there with the customer locked. A project has one customer, and its jobs inherit it. A marked placeholder holds the place of a later financial summary.

### Current limits

- Not modeled: billing recipients, address purposes beyond main address and sites, households, contacts shared across customers.
- Customer numbers are manual.
- No customer-master audit trail exists beyond creator and timestamps on contacts and sites, and the request history.
- Not built: promised-response reporting, converting a request into an update of existing work, duplicate detection, merge, alias history, import-quality workflow, customer portal, automated follow-up.
- The chronology records no standalone call, email, message, letter or meeting, and never claims that a manual note was delivered.
- A customer commitment on a planned visit is a calendar fact. It proves no delivery or consent and sends nothing. When the internal plan moves, the office sees a mismatch.
- Preference guidance is conservative. It holds no legal basis, evidence file or retention rule.
- Deletion exists. Archive, retention, data-subject and legally constrained deletion processes do not.
