# Commercial And Finance

Status: living — last reviewed 2026-10-05

Commercial and finance capabilities connect the operational record of customers, jobs, projects, time, documents, and material with calculation, offers, orders, billing, incoming costs, payments, and post-calculation. Native accounting, payroll, and tax filing are separate product decisions. This scope does not imply them.

## Product Goal

An SHK business moves from a customer request to agreed scope, completed work, a correct invoice, collected payment, and an understandable job result. It does not rebuild the same information in spreadsheets or disconnected accounting tools.

The module answers:

- What did we offer, at which calculation and margin?
- What did the customer approve, and what changed afterward?
- Which work, time, material, third-party cost, and evidence support billing?
- Which invoice is due, paid, disputed, credited, or still open?
- Which supplier costs and employee expenses belong to this job or project?
- Was the work profitable, and why did the result differ from the plan?
- Is the information complete enough for the tax adviser or accounting system?

The module reduces duplicate entry and missed revenue. Every legally or financially consequential action stays explicit, reviewable, and auditable.

## Current Product Baseline

WerkFlow has no commercial or finance module. Admin and Büro work with the operational records that the commercial loop will later consume.

- **Documents.** Operational records such as jobs, projects, customers, and service cases hold linked documents, and the central library stores business documents. An uploaded PDF is not a structured offer, contract, invoice, incoming bill, payment, or accounting record.
- **Inventory prices.** Articles carry purchase price, sale price, tax rate, and billable defaults. No workflow turns them into offers, invoices, revenue, or profit.
- **Time.** Time entries attach to operational work. There is no billable-time handoff, labor calculation, rate card, or post-calculation. The payroll-ready time export carries minutes only. It creates no wage calculation, posting, billable labor, or invoice.
- **Measurements and change work.** Aufmaß and Regie- or Änderungsnachweise carry internal decisions and customer-response evidence. They carry no prices, scope acceptance, billing release, or invoice effect.
- **Handover readiness.** An office-reviewed handover can be released as ready for commercial review, with or without exceptions. The release creates no calculation, price, tax decision, billable quantity, offer, invoice, payment, or message.

### Important Current Limitations

- There is no price catalog, calculation, offer, order confirmation, contract, change order, billable measurement, invoice, credit, incoming bill, payment, open item, dunning, bank matching, accounting export, or ledger.
- WerkFlow claims no XRechnung, ZUGFeRD, Peppol, DATEV, GAEB, REB/VOB, §13b, GoBD archive, double-entry accounting, payroll, or tax-filing capability.

Do not describe the sections below as implemented until the product and its acceptance evidence exist.

## Phase 1 — Complete Operational Core

Phase 1 builds one commercial flow with clear state boundaries. Drafts, approvals, issued records, corrections, payments, costs, and accounting handoffs are different events.

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

The UI uses these states consistently. A PDF filename or folder category is never the only source of a financially consequential state.

### Product, Material, And Service Catalog

The catalog holds labor types and rates, travel, vehicle and equipment charges, fixed-price services, materials, non-stocked products, subcontracted work, fees, surcharges, discounts, allowances, and text positions. Each position has a description, unit, tax treatment, internal cost, sale price, calculation method, account and tax mapping, and an optional inventory link.

- Price lists can vary by customer group, customer, project, contract, date range, or service context. A small business never has to configure all of them.
- Work packages, assemblies, sets, alternatives, optional positions, and reusable section text are supported.
- Unit conversions use explicit rounding.
- Supplier price, internal labor cost, overhead, risk allowance, markup, discount, and target margin are separate inputs.
- Prices are versioned and effective-dated, so a catalog change never alters a historic document or job result.
- Import from spreadsheets and structured catalogs has preview, validation, matching, and reconciliation.
- Archived or replaced positions keep historic documents intact.

The catalog keeps these apart: a pricing material and a physical inventory item; consumed inventory and the quantity approved for billing; a reusable tool and a chargeable equipment service; internal cost and customer price; a live catalog value and the snapshot inside a sent or accepted document.

### Price Calculation And Margin

Authorized office users calculate by position, section, job, project, and document. They combine quantity, unit cost, labor, overhead, markup, discount, tax, and risk.

- Contribution margin and warning thresholds are visible before sending.
- A discount or surcharge never loses the original calculation.
- Alternatives, options, allowances, unknown quantities, and customer-supplied items can be modeled.
- Internal comments stay separate from customer-facing text.
- Stale-price warnings compare planned prices with current catalog or supplier cost.
- A sent version locks its calculation snapshot, and the product can explain why an accepted price differs from today's catalog.
- A margin, discount, or total beyond an organization threshold requires approval.

Defaults fit a small SHK business. Advanced calculation is progressively disclosed, never a mandatory ERP screen.

### Offers

- States: draft, internal review, ready, sent, viewed where evidenced, accepted, partly accepted, rejected, expired, superseded, and cancelled.
- An offer carries customer, contact, site, job or project context, validity, planned dates, payment terms, scope, exclusions, attachments, and the responsible employee.
- Sections, subtotals, optional and alternative positions, and text positions are supported.
- Internal cost and margin never appear in the customer document.
- Templates and text blocks carry the organization's branding. The user previews the exact customer PDF and any structured payload.
- Delivery is by download or email. A customer portal or acceptance link needs its own approval.
- Acceptance covers the whole offer or explicitly supported options and keeps identity, time, wording, and document version.
- A sent offer is revised and superseded, never silently replaced.
- An accepted offer converts deliberately into an order confirmation, job or project scope, material demand, budget, or deposit request.

Digital acceptance needs a legal and identity review before WerkFlow claims a signature level or evidentiary effect.

### Order Confirmations, Contracts, And Change Orders

After acceptance, WerkFlow keeps an agreed baseline: parties, site, scope, price basis, dates, terms, accepted options, and the source offer version.

- A change request records reason, scope and price delta, schedule effect, attachments, initiator, approval state, and the customer's approval or rejection evidence.
- Revisions never overwrite the original agreement. A cumulative view shows the original scope plus approved changes.
- Internal operational changes stay separate from contractual changes.
- Unapproved extra work is visible before it becomes a billing dispute.
- Approved changes hand off to planning, material demand, scheduling, and billing.

Contract templates, VOB/B terms, maintenance agreements, electronic signatures, and clause libraries are a decision gate. Templates are never presented as legal advice.

Operational maintenance coverage (validity, notice, renewal and review dates, status, reference, documents) carries no price, commercial position, legal interpretation, renewal decision, invoice state, or accounting effect. A future commercial maintenance agreement may reference it. Commercial status and operational status stay separate.

### Performance Evidence, Delivery Notes, And Measurements

Billing rests on structured evidence linked to the job and commercial scope: work and service reports, delivery notes, photos, documents, signatures, time, material, and notes.

- Customer-visible and internal-only evidence stay separate.
- Delivery confirmation records date, location, people, exceptions, reservations, and a signature where needed.
- `Aufmaß` is structured by position, section, room, area, or system. Formulas, dimensions, rounding, deductions, and comments stay readable after capture.
- Partial and cumulative measurements show previous, current, and total.
- Measurements can be revised, approved, rejected, and corrected, with source evidence.
- The office reviews a field measurement before it becomes billable.
- Import and export standards are supported only once version, direction, and acceptance are confirmed.

Time entries and material movements are evidence. They become invoice quantities only through review and a billing rule.

### Billable-Work Review

Before an invoice, the office works one list that combines accepted positions, approved changes, measured quantities, approved time and travel, approved billable material, fixed fees, equipment, subcontracted work, approved expenses, and previous billing. Included, warranty, goodwill, rework, waste, customer-supplied, and disputed items are marked.

Each line shows source, quantity, unit, price basis, tax, previous billing, remaining amount, and exception. Accepting a proposal creates an invoice draft. It never issues or sends one.

### Customer Invoices And Credits

- Types: standard, advance or deposit where appropriate, partial and progress, cumulative partial with previous, current, and cumulative values, and final invoices that reconcile scope, previous billing, credits, retention, and remaining amount.
- Recurring invoices only when a validated contract use case requires them.
- Cancellation and correction invoices and credits link to the original. Partial credits and write-offs need authorization.
- An invoice carries references, performance period, service date, job or project, purchase-order reference, tax data, payment terms, due date, Skonto where configured, bank details, and required legal fields.
- Number ranges are per organization with uniqueness, a year and sequence policy, preview, and controlled issuance.
- Issued content is immutable. Changes go through a traceable correction.
- Totals handle net and gross, several tax rates, rounding, discounts, surcharges, and supported special tax treatments.
- States: draft, checked, approved, issued, sent, partly paid, paid, overdue, disputed, credited, cancelled, and written off, with precise transitions.
- Delivery evidence and a safe resend are kept. The PDF and any structured e-invoice stay together.

Issuing is a high-consequence action. Before confirmation the UI shows number, recipient, performance period, tax treatment, total, attachments, and delivery choice.

### E-Invoices And German Commercial Standards

E-invoicing is a validated workflow, not an export button.

- Generate and validate the approved XRechnung and ZUGFeRD versions and profiles. ZUGFeRD keeps the visual PDF and embedded data together.
- Import supported structured supplier invoices and keep the original.
- Show validation errors in words an office user can act on, and preview the readable interpretation before issuing or approving.
- Keep original and generated files, validation result, version, and delivery evidence.
- Treat Peppol transport separately from format support: access point, participant onboarding, delivery status, failures, and cost.
- Keep an email or manual fallback where legally and contractually acceptable.

GAEB, REB/VOB, §13b, Peppol, DATEV, and other standards each need a scope statement for version, direction, object, entitlement, and validation. Competitors offering them makes them compatibility gates, not commitments.

### Incoming Bills And Employee Expenses

- Intake by upload, email, structured e-invoice, mobile receipt capture, or manual entry. The original file and a readable preview are kept.
- Header and line data: supplier, number, order reference, dates, due date, currency, net, tax, gross, terms, bank details.
- Duplicate detection across supplier, number, amount, date, and file.
- Matching to purchase order, goods receipt, delivery note, contract, job or project, inventory item, and cost category, with visible variances in quantity, price, tax, freight, discount, and total.
- One bill or line can be split across jobs, projects, cost categories, and overhead.
- Approval is configurable by amount, role, project, or exception. States include partial approval, dispute, hold, rejection, correction, credit expected, credit received, and ready for accounting.
- Employee expenses carry receipt, purpose, date, job, payment method, reimbursement state, and duplicate checks.
- Source values and corrected values are both kept.

OCR or structured import may propose fields. It never approves a bill, creates a goods receipt, changes stock, or authorizes payment.

### Payments, Open Items, Dunning, And Bank Matching

- Customer and supplier open items show original amount, credits, allocations, remaining amount, due date, dispute, hold, and aging.
- Partial, combined, over-, under-, refund, chargeback, fee, Skonto, and write-off cases are handled.
- Bank transactions arrive by import or an approved bank connection, with visible sync state.
- Match proposals use reference, amount, account, party, date, and open items. Allocation can be one-to-one, one-to-many, many-to-one, split, or manual.
- A human approves ambiguous matches, and every match can be reversed.
- Bank transaction, payment allocation, invoice status, and accounting export stay separate.
- Dunning has levels, grace periods, minimum amounts, validated fees and interest, history, dispute pause, promised-payment date, and an owner.
- Every reminder is reviewed and previewed before sending, unless the organization explicitly enabled a narrow rule.
- Worklists cover due soon, overdue, disputed, unmatched, and failed delivery.

Bank matching is not a general ledger. Supplier payment initiation, direct debit, card processing, wallet or IBAN products, factoring, and embedded banking are decision gates with regulatory consequences.

### Job Profitability, Post-Calculation, And Controlling

Controlling compares the approved plan with actual execution:

- revenue offered, accepted, changed, measured, invoiced, credited, paid, and remaining;
- planned and actual hours by labor category;
- material planned, reserved, consumed, returned, wasted, billable, and invoiced;
- supplier and subcontract cost ordered, received, invoiced, and approved;
- expenses, equipment, travel, and other direct costs.

It shows contribution margin, budget use, and variance by position, job, project, customer, team, and period, with the cause (quantity, rate, price, productivity, waste, scope, discount, purchasing). Cost snapshots stay stable. Completeness warnings flag missing time, unresolved material, unallocated bills, unbilled changes, missing measurements, and uninvoiced finished work. Forecast-at-completion is labeled as an estimate. Every summary drills down to its source records.

This is job and project controlling. Statutory revenue recognition, work in progress, inventory accounting, and a profit-and-loss statement need separate accounting-policy decisions.

### Tax-Accounting Readiness And Interfaces

- Records carry the references the target accounting workflow needs: parties, invoices, credits, allocations, tax, cost center, cost unit, job, and documents.
- Account, tax key, debtor, creditor, cost center, and cost-unit mappings are guided, with a review queue for missing or conflicting mappings.
- Period exports have control totals, document files, stable identifiers, and an export log.
- A correction or cancellation is handed off again without silently duplicating the earlier export.
- Export states: draft, ready, exported, accepted where feedback exists, failed, corrected.
- A plain export and an API fallback avoid lock-in to one tax adviser tool.
- Each DATEV format or service is specified by version, direction, contract, and error return. Other accounting products follow only once objects, authentication, limits, ownership, and support are defined.
- All data and documents can be exported at contract end.

Accounting readiness means controlled operational records and handoff packages. WerkFlow does not keep a legally complete journal, chart of accounts, closing, balance sheet, VAT return, payroll ledger, or tax filing.

### Controls, Audit, Retention, And Data Quality

- Issued records are immutable. A correction is a linked event, and undo is a compensating correction, never history deletion.
- History records actor, time, source, before and after, approval, send, export, and failure.
- Comments on exceptions never leak internal notes to customers.
- Review queues cover missing master data, invalid tax, incomplete invoice fields, unallocated costs, duplicate bills, and unmatched payments.
- Original and extracted data stay distinguishable for OCR and imported e-invoices.
- Control totals reconcile across document, open-item, payment, and handoff views.
- Retention, deletion, legal hold, export, and recovery follow current German legal and accounting advice.

Issued and received financial documents are the main consumers of the retention archive in [decision 0001](../decisions/0001-infrastructure-stack.md). `P1-45` owns its design, including reviewed retention rules by category. Active files use document storage. Structured commercial records live in Postgres.

An audit trail or a PDF alone never justifies a claim of GoBD conformity, compliant archiving, qualified signatures, or tax correctness. Claims need expert review, documented procedures, and acceptance evidence.

> Invoice semantics, number ranges, e-invoice profiles, retention, and accounting exports require the qualified expert review defined in the [execution protocol's practical cautions](../plans/phase-1/protocol.md#practical-execution-cautions). Record `decision_blocked` while that review is missing.

### Onboarding, Packaging, Integrations, And Support

Adoption quality is part of the feature:

- Define which customers, suppliers, articles, open offers and orders, invoices, open items, and documents can be imported.
- Imports preview, explain matching, reconcile counts and money, show failed rows, and name who validates the result.
- Publish onboarding inputs, responsibilities, and acceptance criteria by business size and migration depth.
- Show which office, field, approver, or external-accountant users need which access.
- Make entitlements, limits, transaction charges, setup, migration, training, storage, support, and data exit visible before commitment.
- Give a support path for a blocked invoice, failed e-invoice, wrong payment match, import mismatch, or rejected accounting export.
- Keep one source of truth for packaging and limits.

Competitors show risk around conflicting prices, opaque implementation, paid support, add-on integrations, per-role seat cost, long terms, and migration. WerkFlow prices by a real office and field team scenario with written scope, not a headline number. Evidence is in [Competitive landscape](../product/competitive-landscape.md).

## Connected Workflow Contracts

| Connected area | Commercial and finance contract |
| --- | --- |
| Customers | Documents snapshot the recipient and billing details at issuance. Later customer edits never rewrite them. Customer history shows the commercial chain without internal calculation or notes. |
| Jobs and projects | Accepted scope and approved changes create or update work deliberately. Job completion can start a billing-readiness review, never an invoice. Commercial and operational status stay separate. |
| Inventory | Offer material may propose demand. Reservations and stock movements stay inventory events. Approved net consumption may create a billable proposal. Orders and receipts support incoming-bill matching. Invoice prices never rewrite stock or cost history. |
| Time tracking | Approved job time may feed billable-work review and labor cost. Invoicing never changes the time record. |
| Documents | Every sent or accepted commercial record, validation result, and accounting export stays linked in operational context and findable in the document system. |
| Employee management | Labor cost and rate visibility are role-limited. Payroll, wage calculation, and personnel tax are out of scope unless separately approved. |
| Payments and banking | Issued documents create open items. A bank match changes the open-item allocation, never the invoice. Ledger posting stays an external handoff. |
| AI automations | AI extracts, compares, flags, and drafts. It never issues, approves, pays, posts, or files without the approved control path. |

[Inventory](./inventory.md) owns the stock, procurement, consumption, and valuation side of these contracts.

## Role And UX Principles

### Admin

- Controls number ranges, tax and accounting mappings, approval thresholds, integrations, bank access, retention, exports, package settings, and exceptional corrections.
- Repairs workflow state through traceable corrections, never by deleting issued history.

### Büro / Commercial Manager

- Creates calculations, offers, order confirmations, changes, measurements, invoices, incoming bills, payment allocations, reminders, and post-calculation within assigned permissions.
- Sees the cost, margin, supplier, receivable, and accounting-readiness data that office work needs.
- Works exception-focused queues instead of every advanced accounting field.

### Employee / Handwerker/in

- Captures source evidence: work performed, measurement, time, material, photos, delivery confirmation, signature, expense receipt, and exceptions.
- Does not set customer price, margin, invoice tax, payment, supplier approval, accounting mapping, or write-off without a specialized role.
- Sees when evidence is incomplete without seeing unneeded financial data.

### External Customer, Supplier, Or Accountant

- Customer acceptance, supplier exchange, and accountant access are separate product decisions.
- Any external access exposes only the intended records, keeps identity and action evidence, and supports revocation and export.

### Shared UX Rules

- Use German stage labels such as `Entwurf`, `Intern prüfen`, `Freigegeben`, `Versendet`, `Angenommen`, `Fällig`, `Teilbezahlt`, `Überfällig`, `In Klärung`, and `Korrigiert`.
- Always distinguish a preview from an issued document.
- Show where a value came from: live catalog, document snapshot, OCR, manual correction, or imported accounting data.
- Make partial, cumulative, disputed, corrected, unmatched, rejected, and failed-interface states visible.
- A small business completes a normal invoice without configuring a full ERP.
- Show entitlements, limits, integration prerequisites, and the support route during setup, not after a failure.

## Phase 2 — Intelligence And Automation

Phase 2 reduces preparation and review work. Humans keep authority over money, customer communication, accounting, and tax.

AI may:

- extract fields and line items from offers, delivery notes, incoming bills, expenses, measurements, and customer documents;
- propose matches among offer, order, change, measurement, material, time, delivery, invoice, receipt, and payment;
- flag duplicate bills, unusual tax or bank-detail changes, inconsistent totals, missing references, variances, and likely fraud;
- point out finished billable work or material that has no invoice draft;
- draft offer sections, work descriptions, change text, invoice descriptions, and reminders from approved records;
- recommend a price or margin review when a price is stale;
- forecast cash-in, overdue risk, remaining job cost, and forecast-at-completion with visible assumptions;
- propose bank matches, accounting mappings, cost allocation, and DATEV validation fixes;
- explain why a job moved away from plan, linked to source evidence;
- translate or normalize field descriptions while keeping the original.

A human reviews before WerkFlow sends or accepts an offer or change; issues, sends, corrects, credits, or writes off an invoice; approves a bill or expense; sends a dunning notice outside an approved bounded rule; matches an ambiguous bank transaction; initiates or approves payment; changes tax treatment or mapping; exports a corrected period; or files any tax or payroll submission.

Every AI proposal shows source, affected record, amount or quantity, uncertainty, and consequence. Acceptance, edits, and rejection are logged. Low confidence or conflicting sources go to a human, never to a plausible guess.

Narrow rule-based automation may later create a draft invoice when completion criteria are met, remind an owner about missing evidence, create a draft dunning notice after a grace period, route an incoming bill, auto-match only an exact policy-approved bank case, and prepare an accounting export once all validations pass. These rules are opt-in, bounded, pausable, observable, and reversible before any external consequence.

## Boundaries And Decision Gates

### Operational Finance Versus Native Accounting

Phase 1 commits only to operational finance and accounting readiness: commercial master data and calculation, customer and supplier documents, billable-work review, operational receivables and payables, payment allocation, job cost and margin insight, and a validated export or interface handoff.

It does **not** commit WerkFlow to:

- a native double-entry general ledger;
- journals, period close, balance sheet, profit-and-loss statement, cash-basis or accrual accounting;
- receivable and payable subledgers with statutory ledger responsibility;
- asset accounting, depreciation, consolidated or group accounting;
- VAT advance returns, annual accounts, EÜR, tax declarations, ELSTER filing, or tax advice;
- wage calculation, payroll accounting, payslips, social-insurance reporting, wage-tax filing, or payment;
- automatic legal or tax classification.

Native accounting, payroll, and tax filing each need a market case, compliance analysis, expert ownership, migration model, control design, support model, and build-versus-partner decision.

### Other Decision Gates

- exact XRechnung and ZUGFeRD versions and profiles, and how WerkFlow follows standard changes;
- Peppol access-point partner and transaction model;
- DATEV file export versus online APIs, and who supports rejected imports;
- GAEB, REB/VOB, §13b, retention, construction withholding, reverse charge, and trade-specific legal requirements;
- legally effective electronic acceptance and signature level;
- GoBD-oriented archive scope, procedural documentation, and product claims;
- customer portal, supplier portal, accountant role, and cross-organization sharing;
- embedded payments, direct debit, virtual IBAN or wallet, cards, factoring, financing, or supplier payment initiation;
- bank data provider, consent, refresh, strong customer authentication, transaction retention, and liability;
- cash-basis or accrual behavior, revenue recognition, work in progress, and formal inventory valuation;
- multi-currency, foreign tax, multi-company, consolidation, and international expansion;
- public-sector, construction, service-contract, or insurance billing;
- automatic dunning, credit scoring, debt collection, or legal escalation;
- replacing a tax adviser, accounting package, bank, payment provider, or mandated archive.

No legal, tax, accounting, security, or standards claim ships without current expert review and test evidence.

## Open Product Decisions

The owner decided:

- Offers, invoices, and contracts are structured positions rendered to a PDF from a template with logo, automatic letterhead or uploaded Briefpapier, and text blocks. Phase 1 creates them manually in that editor. Phase 2 AI drafts into the same editor. There is no document editor and no PDF editing.
- From `P1-36`, the PDF/A-3 engine is a Gotenberg container on Railway. `P1-40` adds the KoSIT and Mustang validators beside it. No invoice reaches "Versendet" without a stored validator report.
- E-invoice generation is TypeScript (`@e-invoice-eu/core`, licence under review).
- `P1-39` keeps issued files on R2 under immutable keys with an "Archivierung ausstehend" state that `P1-45` clears.
- `P1-43` exports the DATEV-Format `EXTF` file first. The DATEV Datenservice is a `P1-50` connector.
- `P1-42` starts with camt.053, MT940, and CSV import. A live bank connection is a decision gate. WerkFlow never builds a wallet.

### Expert-review agenda before `P1-39`

Protocol caution 2 keeps `P1-39` to `P1-43` `decision_blocked` until these questions are answered. The owner works them through with Willert Haustechnik's in-house experts and their `Steuerberater`. An answered item moves to the list below the table. E5 to E10 and E14 to E16 are tax law for the `Steuerberater`. The other items are office practice that Willert's staff can answer, E18 with one email to their vendor. E19 and E20 set parser fixtures and the acceptance journeys' starting case, never scope.

| # | Slice | Question for the experts | What WerkFlow needs back |
| --- | --- | --- | --- |
| E1 | `P1-35` | Which calculation inputs a real SHK office uses: labor rates per role, travel and vehicle charges, material markup, overhead and risk allowances, discount practice; whether prices per customer group exist. | The default calculation scheme and the list of positions the catalog must ship with. |
| E2 | `P1-36` | What counts as offer acceptance in practice (signed PDF, email, verbal plus order confirmation) and what evidence the office keeps; whether alternative and optional positions are used; how long offers stay valid. | The acceptance evidence model and the offer states that matter. |
| E3 | `P1-37` | How change work (`Nachtrag`, `Regie`) is agreed and priced before it happens, and how often it is disputed; VOB/B versus BGB contracts in their business. | The change-order flow and whether VOB-specific terms are needed in Phase 1. |
| E4 | `P1-38` | How `Aufmaß` is structured for billing (by position, room, system), which rounding rules apply, and who checks it before billing. | The measurement-to-billing rule. |
| E5 | `P1-39` | Which invoice types they issue and how often: `Abschlagsrechnung`, cumulative partial invoices, `Schlussrechnung` that nets prior invoices; how the VAT on prior `Abschläge` is shown on the final invoice (§14 Abs. 5 UStG). | The invoice types in scope and the netting rule the final invoice must render. |
| E6 | `P1-39` | `Sicherheitseinbehalt`: whether their contracts have retention, net or gross, and when VAT on the retained amount is due. | Whether retention is Phase 1 scope and its tax point. |
| E7 | `P1-39` | §13b reverse charge: how often they invoice other `Bauleister`, how they check the recipient's status (USt 1 TG), and the exact wording they use. | The reverse-charge rule, wording and the recipient flag on the customer record. |
| E8 | `P1-39` | `Bauabzugsteuer`: whether business customers withhold 15 %, whether they hold a `Freistellungsbescheinigung` (§48b), and how the short payment is booked today. | The certificate reference on the invoice and the expected-short-payment rule in open items. |
| E9 | `P1-39` | Skonto: whether they grant it, the usual terms, and how a Skonto deduction is matched against the open item. | The Skonto terms model and the matching tolerance. |
| E10 | `P1-39` | Invoice numbering: one range or several (per year, per branch), whether gaps are acceptable to their `Steuerberater`, and how a cancelled invoice is handled (`Storno` versus corrected invoice). | The number-range policy and the correction chain. |
| E11 | `P1-40` | Which of their customers already demand XRechnung or ZUGFeRD, which profile they receive from suppliers, and whether any public-sector customer requires Peppol. | The first supported profiles and whether Peppol is a Phase 1 need. |
| E12 | `P1-41` | How incoming supplier invoices are checked today (against order and delivery note), who approves, at which amount thresholds, and how disputes and credits are recorded. | The approval thresholds and the matching rule. |
| E13 | `P1-42` | How payments are matched today (bank export, manual), which bank and export format, and their dunning practice: levels, grace days, fees, interest (§288 BGB), and when a customer relationship stops the dunning. | The dunning defaults and the bank import format to support first. |
| E14 | `P1-43` | Which accounting tool the `Steuerberater` uses (DATEV or other), which chart of accounts (SKR03 or SKR04), which account and tax-key mapping they expect, and how they want documents delivered with the export. | The first export target and the mapping defaults. |
| E15 | `P1-39`, `P1-45` | Retention: which documents they must keep for how long (8 years for invoices from 2025, 10 for books), and what their `Steuerberater` expects as procedure documentation for immutable invoices (GoBD). | The retention categories for the archive and the wording WerkFlow may use. |
| E16 | `P1-31` | Inventory: whether they are a `Kaufmann` with an `Inventur` duty (§240 HGB), how the year-end count is done today, and whether a `permanente Inventur` from the ledger would be accepted by their `Steuerberater`. | Whether the count slice must produce a signed count record on day one. |
| E17 | `P1-47` | Their current software is Sykasoft. Does it run on a computer or server in their own office, or do they log in to a version that Syka-Soft or OneQrew hosts for them? (If someone in the office can point at "the server" or an installation on a PC, it is the first; if they open it through a website or a remote desktop, it is the second.) | Whether WerkFlow can read the Sykasoft database directly for the migration or must rely on exports. |
| E18 | `P1-47` | A written request to Sykasoft or OneQrew support: which of their data they can export and in which file formats (customers, articles, open offers, open invoices, maintenance contracts, documents). Their manual documents only an address export to Excel. | The list of exports the migration can count on. |
| E19 | `P1-25`, `P1-34` | Which wholesalers Willert buys from, whether they receive DATANORM files from them, and which wholesaler shop accounts exist. | The parser fixtures for the DATANORM import and the first IDS Connect partner; this never changes the slices' scope. |
| E20 | `GG-10`, `GG-13` | Which invoicing tool they use today, and their legal form (GmbH or sole trader). | The starting case of the acceptance journeys: which invoice the first run reproduces and which legal-form rules (`Kaufmann` duties, signature lines) apply. |

Answered items: none yet.

### External facts for Wave 4

These facts were researched on 2026-09-17. Refresh prices and versions before signing a contract.

- E-invoice timeline (BMF FAQ, 2026-03-23): receiving is mandatory since 2025-01-01. Issuing is mandatory from 2027-01-01 above 800,000 € prior-year turnover and from 2028-01-01 for everyone. `Kleinbetragsrechnungen` up to 250 € and B2C are exempt. Accepted formats are XRechnung and ZUGFeRD from 2.0.1, except MINIMUM and BASIC WL.
- Versions: XRechnung 3.0.2 is in force until at least 2027-07-31, with 4.0 in prerelease on EN 16931-1:2026. ZUGFeRD 2.5.2 (Factur-X 1.09.2) uses the EN 16931 profile for the ordinary case. XRechnung 3.0 is Germany's Peppol ruleset. There is no B2B Peppol mandate. A managed access point costs about 0,10 to 0,25 € per invoice.
- Libraries: `@e-invoice-eu/core` covers UBL and CII with JSON-schema validation only. `@stackforge-eu/factur-x` embeds CII into PDF/A-3b. `node-zugferd` is a stale beta. Mustangproject and the KoSIT validator are Java services. Chromium output is not PDF/A. Gotenberg converts HTML to PDF/A-3b and embeds Factur-X.
- Invoice rules: §14 Abs. 4 UStG lists the required fields. Reverse charge uses the wording "Steuerschuldnerschaft des Leistungsempfängers" and tax category AE. Customers withhold 15 % `Bauabzugsteuer` above 5,000 € unless a `Freistellungsbescheinigung` (§48b) exists. Skonto goes into BT-20 as `#SKONTO#TAGE=14#PROZENT=2.00#`. Number ranges may have gaps and there may be several (UStAE 14.5 Abs. 10). Invoices from 2025 are kept eight years. The EN 16931 mapping of cumulative `Abschlagsrechnungen` and the netting `Schlussrechnung` (BG-3, BT-113) is unconfirmed and goes to E5.
- Accounting: the DATEV-Format `EXTF` Buchungsstapel needs no partner status. The DATEV Rechnungsdatenservice and Buchungsdatenservice need Marktplatz partner status (25 customers, three references, monthly and per-click fees). Lexware Office, sevDesk, and BuchhaltungsButler have public APIs. Agenda imports the DATEV file.
- Banking: finAPI is a BaFin-licensed AISP with a FinTS fallback. GoCardless Bank Account Data is closed to new sign-ups. Account consent renews every 180 days. camt.053 v08 replaces MT940 since 2025-11-23.
- Market bar: plancraft, openHandwerk, TAIFUN, and pds offer alternative and demand positions, position-linked Aufmaß, cumulative `Abschlagsrechnungen` with a netting `Schlussrechnung`, `Sicherheitseinbehalt`, §13b, `Bauabzugsteuer`, Skonto, multi-level dunning, and post-calculation. HERO and ToolTime rely on embedded payments. ToolTime sells DATEV Rechnungsdatenservice as a paid add-on.

### Open questions

The agenda above covers calculation inputs, acceptance evidence, change work, Aufmaß, invoice types, special tax cases, e-invoice profiles, Peppol, number ranges, incoming-bill approval, bank import, dunning, and the accounting target. These questions remain:

- Which job types define the first commercial acceptance scenarios: service call, fixed-price installation, larger project, maintenance, or emergency?
- How are labor cost, overhead, markup, margin, and price configured without making onboarding hard?
- Is a customer portal needed for offer acceptance?
- When does an accepted offer create a project, job, material demand, budget, or deposit request?
- How do options, alternatives, allowances, and partly accepted offers become the contract baseline?
- Which change-order process is light enough that technicians and customers use it before extra work begins?
- How do partial, cumulative, and final billing interact with changes and measurements?
- How are branches, fiscal years, and test organizations handled in number ranges?
- Which records may create billable proposals, and who approves warranty, goodwill, rework, waste, or included services?
- How do incoming-bill lines match orders, receipts, inventory, and jobs when supplier units differ?
- Which expense and reimbursement flows belong in WerkFlow and which in payroll or accounting?
- Which exact-match cases may be auto-allocated, and how is a wrong match reversed?
- Which dunning policy helps without harming customer relationships?
- Which cost and margin definitions does WerkFlow show before native accounting is considered?
- How are DATEV rejection and correction cycles supported?
- Which archive, retention, deletion, export, and procedural-documentation commitments can WerkFlow make?
- Which imports, onboarding service, reconciliation checks, training, and support response are included?
- How does access for office, field, approver, accountant, and customer affect packaging without surprise seat or add-on cost?
- What evidence would justify native accounting, payroll, or tax filing over deeper partner integrations?
