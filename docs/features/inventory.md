# Inventory Management

Status: living — last reviewed 2026-10-04

Inventory is WerkFlow's operational system for SHK materials, consumables, tools, assets, Lager locations, stock movements, and job material usage. This spec separates the current baseline from the complete product direction. It defines outcomes and domain boundaries, not a database design.

## Product Goal

Inventory tells an SHK business, with as little manual work as possible:

- which articles, materials, tools, and individually tracked assets it works with;
- what is on hand, where, and whether that quantity can be trusted;
- what upcoming work needs, what is reserved, and what is missing;
- what must be bought, what was ordered, and what arrived;
- what employees took, installed, consumed, returned, transferred, lost, or corrected;
- which consumed quantities are billable and which costs belong in post-calculation;
- which stock, price, supplier, or equipment exceptions need action.

The module replaces paper lists, duplicate entry, emergency trips to the wholesaler, lost tools, missed invoice positions, and owner dependence. A field worker must understand it. The office gets an auditable material flow from demand to billing.

## Current Product Baseline

Admin and Büro get an organization-scoped catalog, their own Lager locations, manual stock movements, CSV import, and material planning on jobs and projects. Assigned field workers take and return material on their jobs. The baseline is a foundation, not the complete operational core described below.

- **Catalog.** Item types are material, consumable, tool, and asset. An item can carry several barcodes. The barcode entered on the item becomes its primary barcode, and the previous primary barcode stays attached. A barcode that belongs to another item refuses the save. Saving an item, its barcode, and its first stock count is all or nothing. Minimum and target stock are set once per item and apply across all locations. The web app has no camera scanning.
- **Central inventory.** Only Admin and Büro open `/inventar`, with views for all items, Lager, planned material, and movements. Search, filters, and summary counts cover the whole organization, not only the visible page.
- **Availability.** The overview shows stock by item and by location, open planned quantity, and `Verfügbar`. Today `Verfügbar` is total stock minus open planned demand. It is not a reservation.
- **Stock movements.** Managers record additions and removals at a location. Only managers correct stock. An employee cannot correct their own last movement. Stock cannot go below zero. Every movement keeps quantity before and after, type, location, time, reason, and the linked job or project. There is no transfer flow for users.
- **Locations and categories.** Managers create their own locations labeled Lager, room, shelf, vehicle, or other. WerkFlow creates no default warehouse, so the inventory mirrors the real rooms, shelves, and vehicles of the business. Each organization starts with editable SHK categories. Category names carry no product logic.
- **Units.** Every unit accepts a decimal quantity. The planned rule that only Meter, Liter, and Kilogramm accept decimals is not implemented.
- **CSV import.** The initial inventory audit at onboarding goes through CSV import with column mapping. Import creates missing categories, suppliers, and locations. Matching checks the internal SKU first, then a barcode. Each row's quantity becomes a stock movement at the row's Lager. A matched row adds its quantity to the existing item as an `Eingang`. Each row imports completely or not at all: a row whose lookup or write fails, or whose barcode belongs to another item, is counted as failed and leaves nothing behind. A row with a quantity but without a Lager keeps its item, books no quantity, and the result counts it separately.
- **Job and project material.** Managers plan catalog items on jobs and projects without changing stock. Managers and assigned employees take items from a location or return them. A take or return changes stock immediately, with no approval step. An employee may take an existing item that was never planned, and the line is marked unplanned. A refused take creates no unplanned line. Projects show direct material, material from child jobs, and the total separately. Lines keep planned, taken, returned, and billable quantities apart.
- **Field material actions.** An assigned employee works with the material of the job inside the field work pack. The unplanned-item search hides supplier, price, valuation, and billability. Employees cannot create items, open `/inventar`, or use project-level material.
- **Read-only consumers.** Templates, dispatch readiness, the work lifecycle, handover, service cases, and maintenance plans show material facts and never create, reserve, consume, or return stock. Readiness labels planned material as not reserved and tools as not assessed until `P1-32`.
- **Tools and assets.** Tools and assets are catalog items, and individual asset instances exist. Assigning an instance to a person or job is a plain field edit without a checkout event. There is no checkout, custody, maintenance, inspection, loss, or retirement workflow. `P1-32` adds it.

### Important Current Limitations

- There is no reservation, picking, approval, procurement, invoice, or post-calculation workflow. Billable quantities exist, but nothing commercial uses them yet.
- There is no paired transfer, purchase order, goods receipt, supplier return, reorder worklist, formal stock count, valuation report, or wholesale-standard integration.
- The CSV import books every row as soon as it starts. It has no confirmation step, no row preview, no warning for a file that was already imported, and no duplicate resolution, reconciliation total, or error report. The result names only the counts of imported rows, rows without a Lager, and failed rows. Excel import does not exist.

## Phase 1 — Complete Operational Core

Releases may deliver this core in steps. The concepts below stay distinct in product design, UI language, permissions, reporting, and integrations throughout.

### Domain Semantics

| Concept | Meaning | Must not be confused with |
| --- | --- | --- |
| Catalog article | Reusable identity and descriptive master data for something bought, stocked, used, or sold | A physical quantity, supplier offer, or invoice line |
| Job demand / plan | Expected quantity needed for future work | A reservation or stock movement |
| Reservation | A deliberate allocation of stock to work, making it unavailable to other demand | Physical removal from a location |
| Physical stock | Counted quantity currently on hand at a location | Planned, ordered, or invoiced quantity |
| Transfer | Controlled movement between two locations, including an optional in-transit state | Consumption or a correction |
| Procurement | Request, approval, supplier order, and commercial commitment to obtain goods | Stock receipt |
| Receipt | Confirmed quantity physically received and accepted at a location | Supplier invoice approval |
| Consumption | Quantity actually used or installed for work | Material merely taken from stock, planned demand, or a billable suggestion |
| Return | Unused quantity physically placed back into stock | Supplier return or credit |
| Billability | Decision about what may be charged to the customer and at which quantity/price | Physical stock or cost valuation |
| Valuation | Internal cost view of inventory and material use | Customer sale price or formal accounting ledger |
| Tool / asset custody | Responsibility and lifecycle of reusable or individually identified equipment | Consumable stock |

Every quantity a user sees says which of these meanings it represents. A generic `Material` total is not enough.

### Catalog And Supplier Master Data

- Each item type gets its own workflow. Non-stocked order articles are catalog items too.
- An item has several suppliers, each with article number, pack size, minimum order, delivery time, price validity, and rebate context, plus a preferred and an alternative source.
- Internal cost, list price, purchase price, sale price, tax treatment, and billable default stay separate.
- Unit and pack conversions are explicit and reviewable, such as ordering a carton and consuming pieces.
- A substitute never silently replaces an approved specification.
- Commercial values are versioned, so an old offer, purchase, consumption, or invoice stays explainable after prices change. Archived articles keep their history and can name a successor.

An article in an offer need not be stocked. A stocked material need not be billable. Assigning a tool or asset to a job never counts as consuming it.

### Locations And Physical Stock

- Locations include warehouses, rooms, shelves, bins, vehicles, and temporary site stores, with an optional hierarchy.
- On-hand, reserved, available, incoming, in-transit, and count-discrepancy quantities show separately.
- Minimum and target levels can be set per location where the item default is not enough.
- Every physical change is a distinct movement type with actor, time, source, destination, linked work, reason, and document. Stock and its movement record are updated atomically and cannot drift apart.
- Negative stock stays blocked. If that policy ever changes, negative stock shows as an exception and is never clamped to zero.

### Job Planning, Availability, And Reservation

- Office users plan material on a job or directly on a project without changing stock.
- Estimated, approved, reserved, picked, consumed, returned, and remaining quantities stay distinct.
- A preferred source location never hides organization-wide availability.
- Full or partial reservations, releases, and reallocations of shortages are audited.
- Demand shows as covered, partly covered, late, substituted, ordered, or blocked.
- Material plans can be copied and imported from an accepted offer or template, with revisions.
- Project demand keeps the job that owns each requirement.
- Two planners never count the same unreserved stock as available.
- Planning stays reversible until a physical or commercial follow-up makes a change consequential.

A job status change never silently reserves, consumes, or returns stock. Any automation tied to job state needs an explicit rule, a visible effect, and a recovery path.

### Picking, Consumption, Return, And Billability

- Users pick reserved or planned material from a suggested location, and record unplanned existing articles with an exception marker.
- Users take, consume, return, report scrap or damage, and correct mistakes, also in partial quantities and across several locations.
- A return never exceeds the quantity still outside stock unless a manager handles the exception.
- Corrections keep the actor and the original value.
- Net consumed quantity and billable quantity stay separate. Authorized office users review warranty, goodwill, rework, waste, customer-supplied, and other exceptional material.
- Approved billable quantities go to commercial workflows without creating an invoice. Cost quantities and cost-price snapshots go to post-calculation independently of the customer price.

The field flow stays short: identify the item, confirm the action, accept the location, enter the quantity, save. The office reviews commercial exceptions. The technician does not.

### Transfers

- A transfer has a source, a destination, a responsible person, quantities, and a status, with paired effects instead of two unrelated corrections.
- Simple cases transfer immediately. Vehicles and remote stores can use a dispatched, in-transit, and received flow with partial receipt, discrepancy, cancellation, and loss handling.
- Stock in transit counts as available at neither the source nor the destination.

### Procurement, Ordering, And Receipt

- Demand from shortages, reorder levels, offers, jobs, and manual requests flows into one worklist that prevents duplicate buying.
- Purchase requests get role-based approval where required.
- Suppliers are compared by price, pack size, availability, delivery time, and minimum order.
- Purchase orders track revisions, confirmations, backorders, partial deliveries, and cancellations.
- Direct delivery to a vehicle or job records whether the material ever became general stock.
- Goods receipt records accepted, damaged, short, excess, substituted, and rejected quantities. Stock increases only after quantity and destination are confirmed.
- A supplier return records the expected credit without pretending the credit exists.
- Demand, order, receipt, delivery note, incoming invoice, and movement are matched.
- A manual fallback works when a wholesaler interface is down.

Receipt and incoming-invoice approval are separate controls. A supplier invoice never creates stock because it contains an article line.

### Reorder And Shortage Management

- Low-stock and uncovered demand appear as worklists, not only as badges.
- A proposed order quantity accounts for on-hand, reserved, incoming, open demand, pack size, lead time, and target level.
- Discontinued items, missing suppliers, uncertain conversions, stale prices, late orders, and duplicate orders are exceptions.
- Every snooze, dismissal, substitution, transfer, or order addition carries a reason.
- Notifications avoid repeated noise and name the owner of the next action.

The core does not submit orders to suppliers automatically. A reviewed reorder worklist creates value long before autonomous ordering is safe.

### Wholesaler Data And Transaction Standards

Each standard is a workflow contract, not a marketing checkbox:

- **DATANORM.** Import and update article and price data, with version, supplier, effective date, rebate context, rejected rows, and customer overrides visible.
- **IDS Connect.** Open the right supplier shop, transfer a reviewed cart, and bring the result back into the intended demand or order.
- **UGL.** Exchange the supported commercial documents in the supported direction and version, with a fallback for rejected or partial data.
- **Open Masterdata.** Refresh product data while keeping source, freshness, licensing, and customer overrides.
- **SHK Connect.** Use only supported services and partners, with direction, authentication, and failure behavior documented.

For every integration the product states partner, version, direction, objects, plan entitlement, setup responsibility, sync timing, error recovery, and whether a supplier contract is needed. Supplier connectivity is never the only way to complete an urgent action.

Research facts that `P1-25` and `P1-34` start from:

- **DATANORM** is not an open standard. The specification is sold as a book, and WerkFlow must not republish format documentation. Wholesalers still ship version 4. The real customer price is list price minus the rebate group in `DATANORM.RAB`. Files use CP850 encoding. No TypeScript parser exists, so WerkFlow writes its own reader. The customer's wholesaler files are an onboarding prerequisite, not a WerkFlow cost.
- **IDS Connect 2.5** is a form POST to the shop with customer credentials and a callback URL that receives the cart. It has public XSDs and no certification. ITEK's Open Connect directory lists shop endpoints for free.
- **UGL 5.0** has a public specification with fixed-width records for price requests, orders, confirmations, delivery notes, and invoices, moved by FTP or shop upload. It is the only path today to an automatic goods receipt from a delivery note. Its JSON successor ODX is not ready to build on.
- **Open Masterdata** serves data per article or GTIN with a key the wholesaler issues per customer. It fits single-article refresh, not bulk sync.
- **Scanning.** Safari and Firefox lack a usable native `BarcodeDetector`, so field phones need the `barcode-detector` polyfill. Pack conversion is a domain table, not a library.
- **Law.** §240 HGB requires an `Inventar` per fiscal year. §241 allows a `permanente Inventur` from a gapless ledger plus one physical count per article and year. §241a exempts small sole traders, never a GmbH. Count records are kept ten years (§257 HGB). The `Steuerberater` expects signed count lists, the valuation basis, a procedure description, and a difference analysis.

### Barcode, QR, And Identification

- One code type does not mean the same thing everywhere. A scan can identify an item, supplier article, location, transfer, order, delivery, tool, or asset.
- An item can carry several identifiers. Collisions and ambiguous matches go to review.
- A scan calls the same validated actions as manual search, never a second stock logic.
- Quantity, unit, location, and action show before confirmation.
- Labels can be printed and replaced.
- Offline and last-sync state show once mobile offline support exists.
- WerkFlow never claims that a public database resolves every barcode.

### Counts, Reconciliation, And Audit

- Counts can be full, cycle, location, category, or spot counts, on paper or mobile, with scanner help.
- Blind counts are optional where the expected quantity would bias the result.
- Counts can pause, resume, be assigned, show progress, and take a second count.
- Discrepancies are reviewed before any correction. Each accepted variance has a reason, evidence, approver, and movement link.
- Locations under count can be frozen or restricted.
- A count ends with reconciliation totals and a signed completion record.
- An office user can read stock and catalog history.

A correction never erases the original event. Mistakes stay repairable and history stays immutable.

### Inventory Valuation And Operational Reporting

- Reports show quantity and cost by item and location, value over time, and high-value concentration.
- Slow-moving, obsolete, damaged, missing, and negative-stock items are exceptions.
- Consumption, waste, return, and unplanned use show as trends by item, job, project, location, and employee where appropriate.
- Price changes and purchase-price variance are visible.
- Expected and actual job material cost feed post-calculation. Snapshots keep historical job costs stable when supplier prices change.

The valuation basis is a moving average per item and location. It is labeled operational and is never a general-ledger inventory account unless native accounting scope is approved.

### Tools And Individually Tracked Assets

Reusable equipment has a lifecycle separate from quantity stock:

- Instances carry asset tag, serial number, status, location, custodian, and condition.
- Checkout, handover, return, reassignment, and job allocation form a chain of custody.
- States cover available, in use, reserved, maintenance, inspection due, damaged, lost, retired, and disposed.
- Instances keep purchase, warranty, documents, repair, calibration, statutory inspection, and maintenance history.
- Issue reports can block unsafe equipment.
- Reminders cover overdue returns, inspections, maintenance, and missing assets.

A vehicle is a location, with an optional asset instance for inspection and custody in `P1-32`. A vehicle is never quantity stock. A separate fleet module is a decision gate.

### Onboarding, Migration, Export, And Support

- Onboarding offers a documented self-service import and an assisted initial inventory audit.
- Import states formats, required fields, matching order, unit normalization, and recovery. It offers preview, duplicate resolution, location mapping, count reconciliation, and a result report.
- Before an import books anything, a confirmation step shows per row whether it creates a new item or matches an existing one, the quantity it adds per Lager, and the totals. A warning appears when a file with the same content was already imported.
- Price and catalog updates never add physical stock by accident.
- The organization can export catalog, supplier references, locations, stock, movements, open demand, orders, and assets.
- Support channels, entitlement, and escalation are visible for a blocked stock or import operation.

Migration effort, unclear support, integration add-ons, and surprise setup costs can outweigh a low headline price. WerkFlow packaging makes office seats, field access, imports, standards, onboarding, support, storage, and data exit clear for a real team. The evidence lives in [Competitive landscape](../product/competitive-landscape.md).

## Connected Workflow Contracts

| Connected area | Inventory contract |
| --- | --- |
| Jobs and projects | Planning creates demand only. Reservation allocates availability. Picking/consumption changes physical stock. Job completion can warn about unresolved demand, outstanding material, or unreturned tools but must not silently repair it. |
| Commercial and finance | Offer positions may create proposed demand after approval. Approved net consumption can create a billable suggestion. Purchase orders and receipts support incoming-invoice matching. Cost snapshots feed post-calculation. No inventory action issues an invoice, approves a supplier bill, or posts accounting automatically. |
| Documents | Product sheets, supplier offers, orders, confirmations, delivery notes, receipts, photos, count records, warranties, inspections, and invoices remain accessible from both operational context and the central document system. |
| Employees and roles | Employee actions use assignment and organization context. Price, valuation, supplier negotiation, correction, and approval data remain limited to authorized roles. |
| Time tracking | Job time and material cost meet in post-calculation, but correcting time must not rewrite material history and vice versa. |
| Mobile and offline | Manual search and scan call the same domain actions. Each offline-capable workflow must define available data, queued action, conflict behavior, visible sync state, and recovery. "Offline inventory" is not one binary promise. |
| AI automations | Suggestions may prepare mappings, matches, demand forecasts, or exceptions. The inventory ledger changes only through a validated domain action with the source and responsible actor recorded. |

[Commercial and finance](./commercial-and-finance.md) owns the invoice, incoming-bill, payment, and post-calculation side of these contracts.

## Role And UX Principles

- **Admin** controls inventory policy, valuation and pricing, imports, integrations, approvals, correction rights, count rules, and lifecycle settings. Admin repairs exceptional states without deleting history.
- **Büro** maintains catalog and suppliers, plans and reserves material, buys, receives, corrects, counts, reviews billability, and sees operational cost. Only `buero` and `admin` reserve stock. The office works from exception worklists, not a dense ERP screen.
- **Employees** see only the material of assigned work and permitted tool or vehicle stock. They use short mobile flows to take, return, transfer, count, receive, and report issues. They see no purchase prices, sale-price strategy, inventory value, supplier terms, or unrelated stock unless explicitly authorized. They never create free-text stock in the field. Unknown material becomes a reviewable request or comes from an existing controlled source.

Shared UX rules:

- Use German labels that name the action: `Planen`, `Reservieren`, `Aus Lager entnehmen`, `Verbraucht`, `Zurücklegen`, `Umlagern`, `Wareneingang prüfen`.
- Show source, destination, unit, quantity, and consequence before confirmation.
- Show sync, partial completion, shortage, substitution, and correction state.
- Keep accounting concepts away from field workers, and keep the office out of specialist apps.
- Undo through correction actions, never by deleting history.
- Make price and plan entitlement clear, so a customer never discovers during rollout that an import, employee access, standard, or support channel costs extra.

## Phase 2 — Intelligence And Automation

Phase 2 automates preparation and detection before it automates consequential decisions. Candidates:

- forecast job and seasonal demand from approved history;
- propose reorder quantity, supplier, transfer, or substitute;
- detect unusual consumption, repeated unplanned use, count drift, duplicate orders, stale prices, and likely missed billable material;
- extract delivery notes, confirmations, product data, and incoming invoices and match them to orders and receipts;
- suggest import column mappings and duplicate resolutions;
- recommend tool maintenance or replacement;
- summarize shortages, late supply, inventory exposure, and job-cost variance for office review;
- draft supplier messages or order changes without sending them.

AI-assisted actions follow the [source-visibility rules](./ai-automations.md#data-quality-and-source-visibility) and [human-control levels](./ai-automations.md#human-control-levels) of AI Automations, respect price permissions, and have a manual fallback. Purchase submission, supplier substitution, stock correction, billability, write-off, and retirement always need human review. AI never invents a barcode match, article equivalence, receipt, movement, or supplier confirmation.

Rule-based automation may later perform narrow actions, such as drafting a reorder or escalating a late delivery, once an admin has enabled the rule, set thresholds, assigned an owner, and can inspect or pause it. Fully autonomous supplier ordering is a separate decision gate.

## Boundaries And Decision Gates

These are not commitments:

- native double-entry accounting, payroll, or tax filing;
- a full warehouse-management system with wave picking, dock scheduling, robotics, or logistics optimization;
- batch, lot, serial, expiry, hazardous-material, or medical traceability beyond confirmed SHK needs;
- a formal inventory accounting policy such as FIFO or standard cost;
- multi-company stock, consignment, customer-owned stock, drop shipment, or intercompany transfers;
- bills of material, assemblies, prefabrication, or production planning;
- fully autonomous reordering, supplier payment, or supplier substitution;
- universal barcode lookup;
- a wholesaler marketplace or a replacement for supplier relationships;
- one identical domain for tools, calibrated equipment, vehicles, rentals, and consumables;
- legal, tax, GoBD, safety, or standards compliance claims without current expert verification.

Each supplier standard needs a partner, version, direction, support model, fallback, and commercial-access decision before WerkFlow commits to it. Each offline flow needs its own conflict and recovery design.

## Open Product Decisions

Decided by the owner:

- `Verfügbar` will be on hand minus reservations, with planned demand shown as a separate value.
- Only `buero` and `admin` reserve. Parking or cancelling a job releases its reservations with a visible event.
- Valuation is a moving average per item and location, labeled operational.
- Negative stock stays blocked.
- A vehicle is a location. A fleet module stays a decision gate.
- Wholesaler integrations come in this order: IDS Connect 2.5 first, UGL 5.0 where a beta wholesaler uses it, Open Masterdata after IDS for single-article refresh, and Open Connect only as the endpoint directory.
- `P1-25` imports DATANORM version 4 files with rebate groups as first-class data.
- Employee takes and returns change stock immediately. There is no approval queue for employee stock movements.
- An imported row that matches an existing item, by internal SKU and then barcode, adds its quantity and is never skipped. A business often exports its stock per Lager or vehicle and imports the files one after the other, so five screws in the first file and five in the second make ten. The import confirmation step protects against an accidental double import.

Still open:

- Which inventory outcomes matter first in user testing: reliable counts, job availability, fewer buying trips, procurement speed, missed-billing prevention, or tool custody?
- Are preferred source locations strict allocations or suggestions?
- Which location hierarchy and vehicle-stock model fits real SHK businesses without heavy setup?
- Which unit and pack conversions are required, and who approves ambiguous supplier data?
- Which substitutes need customer or project-lead approval?
- What are the first procurement approval thresholds and roles?
- How do direct-to-job delivery, customer-owned material, consignment, and supplier returns behave?
- Which wholesalers does the beta customer buy from, and which DATANORM rebate structures do they ship?
- Which scanner hardware and barcode formats must be supported?
- What must work offline for a technician, a warehouse employee, or a vehicle count?
- Which count cadence, blind-count policy, and correction approval suit small businesses?
- When do tools need individual tracking, checkout, inspection, calibration, or maintenance?
- Which material event creates a billable suggestion, and who reviews warranty, goodwill, rework, and waste?
- Which migration service, reconciliation criteria, support entitlement, and data-exit promise does each package include?
