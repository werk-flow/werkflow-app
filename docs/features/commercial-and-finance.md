# Commercial And Finance

Commercial and finance capabilities connect WerkFlow's operational record of customers, jobs, projects, time, documents, and material with calculation, offers, orders, billing, incoming costs, payments, and post-calculation.

This document distinguishes the current baseline from the intended complete operational core. Phase 1 is not an MVP checklist, technical design, or promised release sequence. It describes the outcomes needed for a coherent SHK job-to-cash and purchase-to-cost workflow. Native accounting, payroll, and tax filing are separate product decisions, not implied by this scope.

## Product Goal

The module should help a German SHK business move from a customer request to an agreed scope, completed work, correct invoice, collected payment, and understandable job result without rebuilding the same information in spreadsheets or disconnected accounting tools.

It should answer:

- What exactly did we offer, at which calculation and margin?
- What did the customer approve, and what changed afterward?
- Which measurable work, time, material, third-party cost, and evidence support billing?
- Which invoice is due, paid, disputed, credited, or still open?
- Which supplier costs and employee expenses belong to this job or project?
- Was the work profitable, and why did the result differ from the plan?
- Is the information complete and reviewable enough for the tax adviser or accounting system?

The product should reduce duplicate entry and missed revenue while keeping legally and financially consequential actions explicit, reviewable, and auditable.

## Current Product Baseline

WerkFlow does not currently have structured commercial or finance modules.

- Customer, job, project, assignment, scheduling, time, and document capabilities provide operational context.
- Job, project, customer, and employee pages can hold linked documents and images. The central document library can store business documents, but an uploaded PDF is not a structured offer, contract, invoice, incoming bill, payment, or accounting record.
- Inventory V1 stores basic purchase price, sale price, tax-rate infrastructure, billable defaults, material planning, and actual take/return quantities. No current workflow converts these fields into offers, invoices, procurement accounting, revenue, or profit.
- Time entries can be associated with operational work, but there is no approved billable-time handoff, labor calculation, commercial rate card, or job post-calculation.
- There is no structured product/service price catalog, calculation engine, offer, order confirmation, contract/change-order, measurement, invoice, credit, incoming-bill, payment, open-item, dunning, bank-matching, accounting-export, or native ledger workflow.
- WerkFlow does not currently claim XRechnung, ZUGFeRD, Peppol, DATEV, GAEB, REB/VOB, §13b, GoBD archive, double-entry accounting, payroll, or tax-filing capability.

This baseline matters: future-facing sections below must not be described as implemented behavior until the product and its acceptance evidence exist.

## Phase 1 — Complete Operational Core

Phase 1 should create one coherent commercial operating flow while preserving clear state boundaries. Drafts, approvals, issued records, corrections, payments, costs, and accounting handoffs are different events.

### Commercial Semantics

| Concept | Meaning | Must not be confused with |
| --- | --- | --- |
| Catalog position | Reusable product, material, labor, service, equipment, surcharge, or text definition | A stocked inventory item or document-specific price |
| Calculation | Internal quantity, cost, rate, markup, discount, tax, and margin reasoning | The customer-facing offer alone |
| Offer | Time-bound proposal sent to a customer | Accepted contract or issued invoice |
| Order confirmation / contract baseline | Confirmed scope, commercial terms, and responsible parties | A mutable copy of the latest offer |
| Change order | Approved or rejected change to the agreed baseline | An informal note or overwritten contract |
| Measurement | Verified quantity of completed or measurable work | Planned quantity, time entry, or invoice quantity |
| Billable proposal | Reviewable suggestion from actual work, time, or material | An issued invoice line |
| Invoice | Issued receivable document with its own number, date, tax, due date, and correction rules | Payment or accounting posting |
| Credit / correction | Formal adjustment linked to an issued commercial record | Editing the original issued record |
| Incoming bill / expense | Supplier or employee cost claim awaiting review and allocation | Goods receipt, payment, or final accounting posting |
| Open item | Outstanding customer or supplier amount and due state | Bank transaction |
| Payment match | Allocation of money movement to one or more open items | Invoice issuance or revenue recognition |
| Post-calculation | Operational comparison of planned and actual revenue, labor, material, and third-party cost | Statutory profit-and-loss accounting |
| Accounting handoff | Validated export or interface package for a ledger/accounting workflow | A native general ledger |

The UI should use these states consistently. A PDF filename or folder category must never be the only source of truth for a financially consequential state.

### Product, Material, And Service Catalog

The commercial catalog should support:

- labor types, hourly rates, travel, vehicle and equipment charges, fixed-price services, materials, non-stocked products, subcontracted work, fees, surcharges, discounts, allowances, and text positions;
- reusable descriptions, units, tax treatment, internal cost, customer sale price, calculation method, preferred account/tax mapping, and optional links to inventory articles;
- price lists by customer group, individual customer, project, contract, date range, or service context without making every small business configure all dimensions;
- standard work packages, assemblies, sets, alternatives, optional positions, allowances, and reusable section text;
- quantity and unit conversions with explicit rounding;
- supplier price, internal labor cost, overhead, risk allowance, markup, discount, and target margin as distinct inputs;
- versioned and effective-dated prices so historic documents and job results do not change when a catalog value is updated;
- net and gross calculation with transparent tax and rounding;
- spreadsheet and structured catalog import with preview, validation, matching, and reconciliation;
- archive, replacement, and successor behavior that preserves historic commercial documents.

The catalog must distinguish:

- a material used only for pricing from a physical inventory item;
- an inventory item consumed on a job from the quantity approved for customer billing;
- a reusable tool or asset from a chargeable equipment service;
- internal cost from customer price;
- a live catalog value from the immutable snapshot used in a sent or accepted document.

### Price Calculation And Margin

Authorized office users should be able to:

- calculate by position, section, job, project, and whole document;
- combine quantity, unit cost, labor assumptions, overhead, markup, discount, tax, and risk;
- see contribution margin and warning thresholds before sending a document;
- apply discounts or surcharges at a controlled level without losing the original calculation;
- model alternatives, options, allowances, unknown quantities, and customer-supplied items;
- distinguish internal comments from customer-facing text;
- compare planned price with current catalog or supplier cost and show stale-price warnings;
- lock the calculation snapshot attached to a sent version;
- explain later why the accepted price differs from current catalog values;
- require approval when a margin, discount, or total exceeds an organization-defined threshold.

WerkFlow should support practical defaults for small SHK businesses. Advanced calculations should be progressively disclosed rather than forcing every user through a full ERP calculation screen.

### Offers

A complete offer workflow should provide:

- clear draft, internal-review, ready, sent, viewed where evidenced, accepted, partly accepted, rejected, expired, superseded, and cancelled states;
- customer, contact, site, job/project context, validity, planned dates, payment terms, scope, exclusions, attachments, and responsible employee;
- sections, subtotals, optional and alternative positions, text positions, quantities, discounts, taxes, and totals;
- internal cost and margin views that never appear in the customer document;
- reusable templates and text blocks with organization-specific branding;
- preview of the exact customer-facing PDF and any structured payload;
- delivery by download or email, plus a later customer portal or acceptance link if approved;
- acceptance of the whole offer or explicitly supported options, with identity, time, wording, and document version retained;
- revision and superseding behavior rather than silent replacement of a sent offer;
- a clear conversion to an order confirmation, project/job scope, material demand, commercial budget, or deposit request;
- export of all versions, acceptance evidence, and related communication.

Digital acceptance needs a separate legal and identity review before WerkFlow claims a particular signature level or evidentiary effect.

### Order Confirmations, Contracts, And Change Orders

After acceptance, WerkFlow should preserve an agreed commercial baseline:

- an order confirmation or contract record that identifies parties, site, scope, price basis, dates, terms, accepted options, and source offer version;
- a stable baseline against which operational and commercial changes can be compared;
- change requests with reason, scope delta, price delta, schedule effect, attachments, initiator, and approval state;
- customer approval or rejection evidence for each consequential change;
- revision history without overwriting the original agreement;
- separation of internal operational changes from customer-facing contractual changes;
- cumulative view of original scope plus approved changes;
- visibility of unapproved extra work before it becomes a billing dispute;
- handoff of approved changes to job planning, material demand, scheduling, and billing.

Whether WerkFlow provides contract templates, VOB/B-specific terms, maintenance agreements, electronic signatures, or legal clause libraries is a decision gate. Templates must not be presented as legal advice.

### Performance Evidence, Delivery Notes, And Measurements

Billing should be supported by structured evidence:

- work reports, service reports, delivery notes, photos, documents, signatures, time, material, and notes linked to the relevant job and commercial scope;
- customer-visible and internal-only evidence separated deliberately;
- delivery/performance confirmation with date, location, responsible people, exceptions, reservations, and signature where appropriate;
- measurement (`Aufmaß`) by position, section, room, area, system, or other trade-relevant structure;
- formulas, dimensions, units, rounding, deductions, additions, and comments that remain understandable after capture;
- partial and cumulative measurements with a clear previous/current/total view;
- measurement revisions, approval, rejection, correction, and source evidence;
- office review before a field measurement becomes billable;
- import/export standards only where exact version, direction, and acceptance are confirmed.

Time entries and material movements are evidence inputs. They do not become invoice quantities without the configured review and billing rule.

### Billable-Work Review

Before invoice creation, the office should have a worklist that combines:

- accepted offer or contract positions;
- approved change orders;
- measured quantities;
- approved time and travel;
- net consumed and approved billable material;
- fixed fees, equipment charges, subcontracted work, and approved expenses;
- previous partial or cumulative billing;
- included, warranty, goodwill, rework, waste, customer-supplied, or disputed items.

The reviewer should see source, quantity, unit, price basis, tax, previous billing, remaining amount, and exception. Accepting a proposal should create an invoice draft, not issue or send it.

### Customer Invoices And Credits

The operational core should support:

- standard invoices;
- advance or deposit requests where legally and commercially appropriate;
- partial and progress invoices;
- cumulative partial invoices with transparent previous/current/cumulative values;
- final invoices that reconcile the complete scope, previous billing, credits, retention, and remaining amount;
- recurring invoices only when a validated contract use case requires them;
- cancellation/correction invoices and credits linked to the original record;
- partial credits and write-offs with authorization;
- customer references, performance period, service date, job/project, purchase-order reference, tax information, payment terms, due date, Skonto where configured, bank details, and required legal fields;
- organization-specific number ranges with uniqueness, year/sequence policy, preview, and controlled issuance;
- immutable issued content, with later changes handled through a traceable correction process;
- net/gross totals, multiple supported tax rates, rounding, discounts, surcharges, and supported special tax treatments;
- draft, checked, approved, issued, sent, partly paid, paid, overdue, disputed, credited, cancelled, and written-off states with precise transitions;
- email/download delivery evidence and a safe resend flow;
- PDF plus any required structured e-invoice representation preserved together;
- export, audit history, and complete relation to customer, job/project, source work, payments, credits, and accounting handoff.

Invoice finalization is a high-consequence action. The UI must show number, recipient, performance period, tax treatment, total, attachments, and delivery choice before confirmation.

### E-Invoices And German Commercial Standards

E-invoice support should be a validated workflow, not only a file-export button:

- generate and validate the approved XRechnung versions and supported profile;
- generate and validate the approved ZUGFeRD versions and profile, preserving the relationship between visual PDF and embedded structured data;
- import supported structured supplier invoices without discarding the original;
- show validation errors in language an office user can act on;
- preview the human-readable interpretation of structured fields before issuance or approval;
- preserve exact original and generated files, validation result, version, and delivery evidence;
- support buyer references, routing IDs, payment terms, tax categories, allowances/charges, line details, and attachments required by the chosen profile;
- define Peppol transport separately from format support, including access point, participant onboarding, delivery status, failure handling, and commercial cost;
- keep email or manual fallback where legally and contractually acceptable.

GAEB, REB/VOB, §13b, Peppol, DATEV, and other German trade/accounting standards need separate scope statements for version, direction, object, entitlement, and validation. Their appearance in competitor suites makes them important compatibility gates, not automatic commitments.

### Incoming Bills And Employee Expenses

The purchase-to-cost flow should support:

- upload, email intake, structured e-invoice import, mobile receipt capture, and controlled manual entry;
- original file preservation and a readable preview;
- supplier, invoice number, order reference, invoice and performance dates, due date, currency, net/tax/gross, payment terms, bank details, and line items;
- duplicate detection across supplier, number, amount, date, and file identity;
- matching to purchase order, goods receipt, delivery note, contract, job/project, inventory item, cost category, and responsible office user;
- quantity, unit, price, tax, freight, discount, and total variance visibility;
- allocation of one bill or line across jobs, projects, cost categories, and non-job overhead;
- review of missing order, missing receipt, unexpected price, duplicate, tax anomaly, and unassigned cost;
- configurable approval by amount, role, project, or exception;
- partial approval, dispute, hold, rejection, correction, credit expected, credit received, and ready-for-accounting states;
- employee expense capture with receipt, purpose, date, project/job, payment method, reimbursement state, and duplicate controls;
- retention of both source values and corrected/approved values.

OCR or structured import may propose fields. It must never silently approve the bill, create a goods receipt, change stock, or authorize payment.

### Payments, Open Items, Dunning, And Bank Matching

WerkFlow should provide an operational receivables and payables view:

- customer and supplier open items with original amount, credits, allocations, remaining amount, due date, dispute, hold, and aging;
- partial, combined, over-, under-, refund, chargeback, fee, Skonto, and write-off handling;
- bank transaction import or approved bank connection with clear synchronization state and source;
- match proposals based on reference, amount, account, customer/supplier, date, and open items;
- one-to-one, one-to-many, many-to-one, split, and manual allocation;
- human approval of ambiguous matches and a reversible unmatch flow;
- separation of bank transaction, payment allocation, invoice status, and accounting export;
- dunning levels, grace periods, minimum amounts, fees/interest where validated, reminder history, dispute pause, promised-payment date, and responsible owner;
- review and preview of every reminder before sending unless a narrowly bounded rule has been explicitly enabled;
- customer-friendly reminder templates and visible related invoices/credits/payments;
- dashboard and worklists for due soon, overdue, disputed, unmatched, and failed delivery.

Bank matching is not a general ledger. Supplier payment initiation, direct debit, card processing, wallet/IBAN products, factoring, and embedded banking are separate decision gates with regulatory and commercial implications.

### Job Profitability, Post-Calculation, And Controlling

Operational controlling should compare the approved commercial plan with actual execution:

- offered, accepted, changed, measured, invoiced, credited, paid, and remaining revenue;
- planned and actual employee hours by meaningful labor category;
- planned, reserved, consumed, returned, wasted, billable, and invoiced material;
- purchase order, received, invoiced, and approved supplier/subcontract cost;
- employee expenses, equipment charges, travel, and other approved direct costs;
- stable cost snapshots and a visible basis for later corrections;
- contribution margin, budget use, and variance by position, job, project, customer, team, and period;
- explanation of quantity, rate, price, productivity, waste, scope, discount, and purchasing variances;
- completeness warnings for missing time, unresolved material, unallocated incoming bills, unbilled changes, missing measurement, or uninvoiced finished work;
- forecast-at-completion as a clearly labeled operational estimate;
- drill-down from a summary to source records.

This is job and project controlling, not statutory revenue recognition, work-in-progress accounting, inventory accounting, or a formal profit-and-loss statement. Those require separate accounting-policy decisions.

### Tax-Accounting Readiness And Interfaces

The operational core should make an accountant-ready handoff possible:

- organization, customer, supplier, invoice, credit, payment allocation, tax, cost center, cost unit, project/job, and document references complete enough for the target accounting workflow;
- configurable but guided account, tax key, debtor, creditor, cost center, and cost-unit mappings;
- validation and a review queue for missing or conflicting mappings;
- period-based exports with control totals, document links/files, stable identifiers, and an export log;
- repeatable correction or cancellation handoff without silently duplicating an earlier export;
- status showing draft, ready, exported, accepted where feedback exists, failed, or corrected;
- usable export and API fallback rather than lock-in to one tax adviser tool;
- clear support for the exact DATEV format or service selected, its version, direction, required contract, and error return;
- optional interfaces to other accounting products only after their objects, authentication, limits, ownership, and support model are defined;
- complete data export and document access at contract end.

Accounting readiness means WerkFlow produces controlled operational records and handoff packages. It does not mean WerkFlow maintains a legally complete journal, chart of accounts, closing process, balance sheet, VAT return, payroll ledger, or tax filing.

### Controls, Audit, Retention, And Data Quality

Financially consequential workflows need:

- organization scope and explicit role/approval controls;
- separation of draft, approved, issued, paid, exported, and corrected states;
- immutable issued records plus linked correcting events;
- number-range and duplicate controls;
- actor, time, source, before/after, approval, send, export, and failure history;
- comments and evidence on exceptions without leaking internal notes to customers;
- review queues for missing master data, invalid tax, incomplete invoice fields, unallocated costs, duplicate bills, and unmatched payments;
- retention, deletion, legal-hold, export, and recovery behavior confirmed with current German legal/accounting advice;
- clear original-versus-extracted data for OCR and imported e-invoices;
- testable control totals across document, open-item, payment, and accounting-handoff views.

Infrastructure direction ([decision 0001](../../docs/decisions/0001-infrastructure-stack.md)): issued and received financial documents (invoices, credits, vouchers, e-invoice files) are the primary consumers of the planned independent retention archive — a separately administered S3 bucket with Object Lock in compliance mode, with per-category German retention periods (commonly 10 years for books/financial statements, 8 for vouchers, 6 for commercial correspondence). Active copies live on Cloudflare R2 via the document-management storage layer; structured records stay in Postgres, whose relational constraints (number ranges, uniqueness, immutable issued states, joins for post-calculation reporting) are a standing reason this domain remains on Postgres.

WerkFlow should not claim GoBD conformity, legally compliant archiving, qualified signatures, or tax correctness solely because an audit trail or PDF exists. Claims require current expert review, documented procedures, and acceptance evidence.

> **Heads-up for implementation agents:** this feature area is the highest-risk part of Phase 1 (see "Practical Execution Cautions" in the [Phase 1 roadmap](../plans/phase-1-build-roadmap.md)). Invoice semantics, number ranges, e-invoice profiles, retention, and accounting exports need paid, qualified German tax/legal expertise before acceptance — no agent or document research substitutes for it. Surface this as `decision_blocked` rather than implementing plausible-looking compliance behavior.

### Onboarding, Packaging, Integrations, And Support

Adoption quality is part of the feature:

- define which customer, supplier, article/service, open-offer, open-order, invoice, open-item, and document data can be imported;
- preview imports, explain matching, reconcile counts and money, expose failed rows, and document who validates the result;
- publish realistic onboarding inputs, responsibilities, and acceptance criteria by business size and migration depth;
- show which office, field, approver, or external-accountant users need which access;
- keep standard/interface entitlement, usage limits, transaction charges, setup, migration, training, storage, support, and data exit visible before commitment;
- provide support paths appropriate to a blocked invoice, failed e-invoice, wrong payment match, import reconciliation problem, or accounting-export rejection;
- maintain one source of truth for product packaging and limits.

Competitor reviews and public pricing repeatedly show risk around conflicting prices, opaque implementation, paid support, add-on integrations, role-based seat cost, long terms, and migration expectations. WerkFlow should use scenario pricing for a real office/field team and written scope rather than a misleading headline. The evidence and caveats remain in [Competitive landscape](../product/competitive-landscape.md).

## Connected Workflow Contracts

| Connected area | Commercial and finance contract |
| --- | --- |
| Customers | Commercial documents snapshot the legal recipient and delivery/billing details used at issuance. Later customer edits do not rewrite historic records. Customer history shows the related commercial chain without exposing internal-only calculation or notes. |
| Jobs and projects | Accepted scope and approved change orders may create or update operational work deliberately. Job completion can trigger a billing-readiness review, not automatic invoice issuance. Commercial status and operational status remain separate. |
| Inventory | Offer material may propose demand. Reservation and stock movement stay inventory events. Approved net consumption may create a billable proposal. Purchase order/receipt supports incoming-bill matching. Invoice price does not rewrite stock or cost history. |
| Time tracking | Approved job time may feed billable-work review and actual labor cost. Raw, disputed, or corrected time remains traceable. Invoice issuance never changes the time record. |
| Documents | Every sent/accepted offer, contract, change, measurement, delivery note, invoice, credit, incoming bill, reminder, validation result, and accounting export remains linked in operational context and discoverable through the document system. |
| Employee management | Labor cost and rate visibility are role-limited. Payroll output, wage calculation, and personnel tax are outside this operational contract unless separately approved. |
| Payments and banking | Issued documents create operational open items. Bank transactions may be matched to them. A match changes open-item allocation, not the original invoice. General-ledger posting remains an external handoff unless native accounting is approved. |
| AI automations | AI can extract, compare, flag, and draft. It cannot issue or send a consequential commercial document, approve a cost, initiate a payment, post accounting, or file tax without the approved control path. |

See [Inventory](./inventory.md) for the physical-stock, procurement, consumption, valuation, and billability side of these contracts.

## Role And UX Principles

### Admin

- Controls number ranges, tax and accounting mappings, approval thresholds, integrations, bank access, retention policy, exports, package-level settings, and exceptional corrections.
- Can investigate and repair workflow state through traceable corrections, not deletion of issued history.

### Büro / Commercial Manager

- Creates calculations, offers, order confirmations, changes, measurements, invoices, incoming bills, payment allocations, reminders, and post-calculation according to assigned permissions.
- Sees cost, margin, supplier, receivable, and accounting-readiness information needed for office work.
- Gets exception-focused queues rather than being forced through every advanced accounting field.

### Employee / Handwerker/in

- Captures understandable source evidence: work performed, measurement, time, material, photos, delivery confirmation, signature, expense receipt, and exception notes.
- Does not set customer price, margin, invoice tax, payment, supplier approval, accounting mapping, or write-off unless explicitly given a specialized role.
- Sees whether required evidence is incomplete without being exposed to unnecessary financial data.

### External Customer, Supplier, Or Accountant

- Customer acceptance, supplier exchange, and external-accountant access are separate product decisions.
- Any external surface must expose only the intended organization/customer records, preserve identity and action evidence, and provide revocation and export behavior.

### Shared UX Rules

- Use natural German stage labels such as `Entwurf`, `Intern prüfen`, `Freigegeben`, `Versendet`, `Angenommen`, `Fällig`, `Teilbezahlt`, `Überfällig`, `In Klärung`, and `Korrigiert`.
- Always distinguish a preview from an issued document.
- Keep an explicit cancel action in every active multi-step flow.
- Preview recipient, number, amount, tax, due date, performance period, attachments, and delivery before issuing or sending.
- Show where a value came from and whether it is live catalog data, a document snapshot, OCR extraction, manual correction, or imported accounting data.
- Make partial, cumulative, disputed, corrected, unmatched, rejected, and failed-interface states visible.
- Use progressive disclosure so a small business can complete a normal invoice without configuring a full ERP.
- Provide a compensating correction or reversal path. Do not use history deletion as undo.
- Make plan entitlement, transaction limits, integration prerequisites, and support route visible at the point of setup—not after a workflow fails.

## Phase 2 — Intelligence And Automation

Phase 2 should reduce preparation and review work while retaining human authority over money, customer communication, accounting, and tax.

Safe high-value capabilities include:

- extract structured fields and line items from offers, delivery notes, incoming bills, expenses, measurements, and customer documents;
- propose matches among offer, order, change, measurement, material use, time, delivery, invoice, receipt, and payment;
- detect duplicate incoming bills, unusual tax or bank changes, inconsistent totals, missing references, price/quantity variance, and likely fraud indicators;
- suggest billable work or material that appears complete but has not reached an invoice draft;
- draft offer sections, work descriptions, change-order text, invoice descriptions, or reminder messages from approved source records;
- recommend current catalog prices or margin review when supplier cost, age, or historic outcome makes a price stale;
- forecast cash-in, overdue risk, remaining job cost, and forecast-at-completion with assumptions shown;
- propose bank matches, accounting mappings, cost allocation, and DATEV validation fixes;
- summarize why a job moved away from plan and link each explanation to source evidence;
- translate or normalize field descriptions for office review while preserving the original.

Human review is mandatory before:

- sending or accepting an offer or change;
- issuing, sending, correcting, crediting, or writing off an invoice;
- approving an incoming bill or expense;
- sending a dunning notice unless an explicit bounded rule has been approved;
- matching an ambiguous bank transaction;
- initiating or approving payment;
- changing tax treatment or accounting mapping;
- exporting a corrected accounting period;
- filing any tax or payroll submission.

Every AI proposal must show source, affected record, amount/quantity, uncertainty, and proposed consequence. Acceptance, edits, and rejection must be logged. Low confidence or conflicting source data must route to a human rather than produce a plausible guess.

Narrow rule-based automation may later:

- create a draft invoice when configured completion criteria are met;
- remind an internal owner about missing evidence;
- create a draft dunning notice after a grace period;
- route an incoming bill by amount, project, or exception;
- auto-match only an exact, policy-approved bank/reference/amount case;
- prepare an accounting export once all validations pass.

These rules must be opt-in, bounded, pausable, observable, and reversible before an external consequence.

## Boundaries And Decision Gates

### Operational Finance Versus Native Accounting

Phase 1 commits only to operational finance and accounting readiness:

- commercial master data and calculation;
- customer and supplier documents;
- billable-work review;
- receivables/payables operational state;
- payment allocation;
- job/project cost and margin insight;
- validated export/interface handoff.

It does **not** automatically commit WerkFlow to:

- a native double-entry general ledger;
- journals, period close, balance sheet, profit-and-loss statement, cash-basis or accrual accounting;
- accounts receivable/payable subledgers with statutory ledger responsibility;
- asset accounting, depreciation, consolidated accounts, or group accounting;
- VAT advance returns, annual accounts, EÜR, tax declarations, ELSTER filing, or tax advice;
- wage calculation, payroll accounting, payslips, social-insurance reporting, wage-tax filing, or payment;
- automatic legal or tax classification.

Native double-entry accounting, payroll, and tax filing each require a separate market case, regulated/compliance analysis, expert ownership, migration model, audit/control design, support model, and build-versus-partner decision.

### Other Decision Gates

- exact XRechnung and ZUGFeRD versions/profiles and the maintenance process when standards change;
- Peppol access-point partnership and transaction model;
- DATEV file export versus online APIs and who supports rejected imports;
- GAEB, REB/VOB, §13b, retention, construction withholding, reverse charge, and trade-specific legal requirements;
- legally effective electronic acceptance and signature level;
- GoBD-oriented archive scope, procedural documentation, and product claims;
- customer portal, supplier portal, accountant role, and cross-organization sharing;
- embedded payments, direct debit, virtual IBAN/wallet, cards, factoring, financing, or supplier payment initiation;
- bank data provider, consent, refresh, strong customer authentication, transaction retention, and liability;
- cash-basis/accrual behavior, revenue recognition, work in progress, and formal inventory valuation;
- multi-currency, foreign tax, multi-company, intercompany, consolidation, and international expansion;
- public-sector, construction, service-contract, or insurance billing specializations;
- automatic dunning, credit scoring, debt collection, or legal escalation;
- replacing a tax adviser, accounting package, bank, payment provider, or legally mandated archive.

No legal, tax, accounting, security, or standards-compliance claim should ship without current expert review and test evidence.

## Open Product Decisions

- Which customer segment and job types should define the first complete commercial acceptance scenarios: service call, fixed-price installation, larger project, maintenance, or emergency work?
- Which catalog positions and calculation methods do real SHK offices use most often?
- How should labor cost, overhead, markup, margin, and customer price be configured without becoming difficult to onboard?
- Which discount, margin, invoice, credit, write-off, and incoming-bill thresholds require approval?
- What offer acceptance evidence is sufficient, and is a customer portal needed?
- When should an accepted offer create a project, job, material demand, budget, or deposit request?
- How should options, alternatives, allowances, and partially accepted offers convert into the contract baseline?
- Which change-order process is practical enough that technicians and customers actually use it before extra work begins?
- Which measurement structures, formulas, REB/VOB conventions, and mobile workflows are essential?
- Which invoice types are needed first, and how should partial, cumulative, and final billing interact with changes and measurements?
- Which special German tax and construction cases are in the first supported scope?
- Which XRechnung and ZUGFeRD versions/profiles must be generated and imported?
- Is Peppol required by the first customers, and who provides the access point?
- How are number ranges, branches, fiscal years, cancellations, and test organizations handled?
- Which source records may create billable proposals, and who approves warranty, goodwill, rework, waste, or included services?
- How should incoming-bill lines match purchase orders, receipts, inventory, and jobs when supplier units differ?
- Which expense and reimbursement flows belong in WerkFlow versus payroll/accounting?
- Which bank connectivity or import method is acceptable for Phase 1?
- Which exact-match cases may be auto-allocated, and how is an incorrect match reversed?
- What dunning policy is useful without harming customer relationships?
- Which operational cost and margin definitions should WerkFlow present before native accounting is considered?
- What is the authoritative handoff to DATEV or another accounting product, and how are rejection/correction cycles supported?
- What archive, retention, deletion, export, and procedural-documentation commitments can WerkFlow make?
- Which data imports, onboarding service, reconciliation checks, training, support channel, and response expectations are included?
- How should office, field, approver, external-accountant, and customer access affect product packaging without creating surprise seat or add-on cost?
- What evidence would justify native double-entry accounting, payroll, or tax filing rather than deeper partner integrations?

## Related Docs

- [Product capability map](../product/product-capability-map.md)
- [Phase 1 build roadmap](../plans/phase-1-build-roadmap.md)
- [Inventory](./inventory.md)
- [Competitive landscape](../product/competitive-landscape.md)
- [Customers and CRM](./customers-and-crm.md)
- [Jobs and projects](./jobs-and-projects.md)
- [Service and maintenance](./service-and-maintenance.md)
- [Calendar and resource planning](./calendar-and-resource-planning.md)
- [Document management](./document-management.md)
- [Time tracking](./time-tracking.md)
- [Employee management](./employee-management.md)
- [AI automations](./ai-automations.md)
- [Product offer](../product/offer.md)
- [Data model](../technical/data-model.md)
