# Inventory Management

Status: living — last reviewed 2026-08-24

Inventory is WerkFlow's operational system for SHK materials, consumables, tools, assets, Lager locations, stock movements, and job material usage.

This document separates the current V1 baseline from the complete product direction. Phase 1 below is not an MVP checklist or an implementation sequence. It describes the complete operational core that the product should eventually provide before inventory is treated as mature. It deliberately defines outcomes and domain boundaries rather than tables, APIs, or a database design.

## Product Goal

Inventory should tell an SHK business, with as little manual work as possible:

- which articles, materials, tools, and individually tracked assets it works with;
- what is physically on hand, where it is, and whether that quantity can be trusted;
- what upcoming work needs, what has been reserved, and what is still missing;
- what must be purchased, what was ordered, and what was actually received;
- what employees took, installed, consumed, returned, transferred, lost, or corrected;
- which consumed quantities are billable and which costs belong in post-calculation;
- which stock, pricing, supplier, or equipment exceptions require action.

The module should reduce paper lists, duplicate entry, emergency wholesaler trips, lost tools, missed invoice positions, and owner dependence. It should remain understandable to a field worker while providing the office with an auditable end-to-end material flow.

## Current Product Baseline

The implemented V1 is a useful native WerkFlow foundation, not the complete operational core described later.

### Central Inventory

- `admin` and `buero` users have an organization-scoped `/inventar` route. `employee` users do not see or access the central inventory manager surface.
- The route provides `Alle Artikel`, `Lager`, `Geplant`, and `Bewegungen` views plus search and filters for type, stock status, and location.
- The overview shows total stock by item and by location, open planned quantity, and a current `Verfügbar` value calculated from total stock minus open planned demand. It does not represent a committed reservation.
- Managers can create and edit catalog items and record manual stock additions or removals at a location. Stock cannot be booked below zero.
- Managers create the actual Lager locations themselves; WerkFlow does not invent a default physical warehouse. Supported location labels include Lager, room, shelf, vehicle, and other.
- Default editable SHK categories are seeded per organization. Category names are not product logic.
- The recent movement view records quantity before and after, movement type, location, timestamp, reason, and a linked job or project where applicable.

### Catalog And Import

- V1 catalog types are material, consumable, tool, and asset.
- Current item metadata includes name, description, category, unit, internal SKU, barcode, manufacturer, supplier and supplier article number, purchase and sale price, tax rate infrastructure, billable default, global minimum and target stock, notes, and active/tracking flags.
- A catalog item may have multiple stored barcode identifiers. The current web product does not provide camera scanning or a scanner-first workflow.
- Managers can import CSV data through column mapping. The current import can map catalog, location, supplier, price, barcode, threshold, billability, and initial-quantity fields; it can create missing categories, suppliers, and locations.
- Import matching currently checks an internal SKU first and then a barcode. Imported initial quantities become stock movements.
- The current CSV flow does not yet offer the full planned onboarding experience: there is no robust row-by-row preview, duplicate-resolution workspace, reconciliation total, downloadable error report, or clear post-import created/updated/skipped summary in the UI. Excel import is not implemented.

### Job And Project Material

- Job and project detail pages contain `Material & Inventar`.
- Managers can plan existing catalog items for a job or project. Planning does not change physical stock.
- Managers and authorized users can explicitly take existing items from a location or return them. These actions create physical movements immediately.
- An assigned employee can see material for an assigned job, take planned material, take an unplanned existing item, and return material. The employee cannot create a catalog item, see the central inventory route, or use project-level inventory workflows.
- Direct project material and material inherited from jobs inside the project are kept visible separately, with an aggregate project total.
- Planned, taken, returned, unplanned, preferred-location, billable, and status information exists on material lines. There is not yet a reservation, picking, approval, procurement, invoice, or full post-calculation workflow.
- Since P1-12, the calendar's dispatch-readiness view consumes these facts read-only and honestly: open demand (geplant − entnommen) is compared against current on-hand stock and always labeled „nicht reserviert"; a shortfall warns, a failed lookup shows as unknown, and tool availability is always „nicht bewertet" until `P1-32`. No calendar action reserves, moves, or repairs stock.
- Since P1-13, organization work templates can prepare material demand with quantity, preferred location, billability and notes. Application creates ordinary `job_material_lines` on the Auftrag or Projekt with template provenance; every quantity begins planned with taken/returned at zero. It never creates a stock movement or reservation. Managers edit the resulting line through the existing `Material & Inventar` surface; P1-26 still owns reservation.
- P1-14 reads planned demand and shortfall through the shared readiness projection, labels planned material „nicht reserviert“ and records only that assessment in transition snapshots. Execution, blocker, dependency, parking, completion and handover mutations never create, reserve, consume, return or repair stock.
- A billable default and billable-quantity infrastructure exist, but no structured offer or invoice module consumes them yet.

### Tools, Assets, And Missing Operational Depth

- Tools and assets can be catalog items, and individual asset-instance infrastructure exists.
- The current manager UI does not yet provide a complete instance register, checkout/return, custody, maintenance, inspection, loss, or retirement workflow.
- There is no dedicated paired transfer flow, purchase requisition, supplier order, goods receipt, supplier return, reorder worklist, formal stock count, valuation report, or wholesale-standard integration.
- `transfer_in` and `transfer_out` movement concepts exist in the inventory domain, but a user-facing transfer workflow is not implemented.
- Realtime refresh and organization-scoped authorization are already part of the V1 behavior. Exact schema details must still be verified through live Supabase and generated types before schema-aware changes.

The V1 implementation handoff remains documented in [Inventory V1 implementation plan](../plans/inventory-v1-implementation-plan.md). Current code and live database state override older plan wording where they differ.

## Phase 1 — Complete Operational Core

Phase 1 is the complete expected operational product, not a quick MVP. Individual releases may deliver it incrementally, but the concepts below must stay distinct throughout product design, UI language, permissions, reporting, and integrations.

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
| Consumption | Quantity actually taken or used for work | Planned demand or a billable suggestion |
| Return | Unused quantity physically placed back into stock | Supplier return or credit |
| Billability | Decision about what may be charged to the customer and at which quantity/price | Physical stock or cost valuation |
| Valuation | Internal cost view of inventory and material use | Customer sale price or formal accounting ledger |
| Tool / asset custody | Responsibility and lifecycle of reusable or individually identified equipment | Consumable stock |

Every user-facing quantity should say which of these meanings it represents. A generic `Material` total is not sufficient.

### Catalog And Supplier Master Data

The catalog should support:

- materials, consumables, non-stocked order articles, tools, and individually tracked assets without forcing identical workflows on all types;
- clear names, descriptions, categories, units, manufacturer identities, internal identifiers, GTIN/EAN and other barcodes, supplier article numbers, images, technical documents, and safety or handling notes;
- multiple suppliers and supplier article references per item, including preferred supplier, alternative source, pack size, minimum order quantity, delivery time, price validity, rebate or discount context, and discontinued/replacement status;
- separate internal cost, supplier list price, negotiated purchase price, customer sale-price logic, tax treatment, and billable default;
- unit and pack conversions that are explicit and reviewable, such as ordering a carton while consuming pieces;
- equivalent and substitute articles without silently replacing an approved specification;
- versioned commercial values so an old offer, purchase, receipt, consumption, or invoice remains explainable after catalog prices change;
- archive and successor flows that preserve historical references;
- customer-assisted CSV/Excel onboarding, safe updates, exports, duplicate detection, and reconciliation reports.

An article used in an offer need not be physically stocked. A stocked material need not be billable. A tool or asset must not be treated as consumed merely because it was assigned to a job.

### Locations And Physical Stock

The stock view should support:

- organization-defined warehouses, rooms, shelves, bins, vehicles, temporary site stores, and other practical SHK locations;
- an `Alle Artikel` view plus location-specific views and optional location hierarchy;
- on-hand, reserved, available, expected incoming, in-transit, and count-discrepancy quantities shown separately;
- location-specific minimum and target levels where the global item default is insufficient;
- an explainable movement history for every physical change, including actor, time, source, destination, linked work, reason, and related document;
- stock additions, removals, corrections, scrapping, loss, damage, supplier returns, customer returns, job consumption, job returns, transfer, and initial count with distinct meanings;
- atomic updates so the current stock and movement record cannot drift apart;
- a deliberate organization policy for negative stock. If allowed later, negative stock must be visible as an exception and never hidden by clamping a value to zero.

### Job Planning, Availability, And Reservation

Office users should be able to:

- plan material on a job or directly on a project without changing on-hand stock;
- distinguish estimated demand, approved demand, reserved quantity, picked quantity, consumed quantity, returned quantity, and remaining requirement;
- choose a preferred source location while still seeing organization-wide availability;
- reserve complete or partial quantities, release reservations, and reallocate shortages with an audit trail;
- see whether planned demand is covered, partly covered, late, substituted, ordered, or blocked;
- group and copy material plans, import them from an accepted offer or standard work package, and preserve revisions;
- aggregate project demand without losing the job that owns each requirement;
- prevent two planners from believing the same unreserved stock is available;
- keep planning reversible until physical or commercial follow-on actions make a change consequential.

A job status change must not silently reserve, consume, or return stock. Any optional automation around job state needs an explicit rule, visible effect, and recovery path.

### Picking, Consumption, Return, And Billability

The execution flow should make it easy to:

- pick reserved or planned material from a suggested location;
- record an unplanned existing article with a clear exception marker;
- take material to a job, consume or install it, return unused quantity, report scrap/damage, or correct a mistake;
- support partial actions and more than one source or return location;
- prevent returns greater than the quantity still outside stock unless a manager deliberately handles the exception;
- capture who performed the action and retain original and corrected values;
- separate net consumed quantity from billable quantity;
- let authorized office users review non-billable, included, warranty, goodwill, rework, waste, customer-supplied, or otherwise exceptional material;
- hand approved billable quantities to commercial workflows without creating or issuing an invoice automatically;
- hand cost quantities and cost-price snapshots to job post-calculation independently of the customer price.

The field flow should remain short: identify item, confirm action, choose or accept location, enter quantity, and save. Commercial exceptions should normally be reviewed in the office rather than forcing complex decisions on the technician.

### Transfers

A complete transfer should provide:

- a source and destination, responsible person, quantities, and status;
- paired, auditable source and destination effects rather than two unrelated manual corrections;
- immediate transfers for simple cases and an optional dispatched/in-transit/received flow for vehicles or remote stores;
- partial receipt, discrepancy, cancellation, loss, and correction handling;
- barcode-supported picking and receiving;
- visibility of stock in transit so it is neither shown as available at the source nor prematurely available at the destination;
- links to the responsible job, route, person, or transfer document where useful.

### Procurement, Ordering, And Receipt

The procurement flow should cover:

- demand from shortages, reorder levels, accepted offers, jobs, projects, manual requests, and replacement needs;
- a consolidated demand worklist that avoids duplicate buying;
- purchase requests and role-appropriate approval where required;
- supplier comparison based on current price, pack size, availability, delivery time, minimum order, preferred supplier, and service considerations;
- purchase orders with revisions, statuses, expected dates, supplier confirmations, backorders, partial deliveries, cancellations, and notes;
- direct delivery to a warehouse, vehicle, or job while preserving who owns the material and whether it ever became general stock;
- goods receipt with accepted, damaged, short, excess, substituted, and rejected quantities;
- receipt into physical stock only after the quantity and destination are confirmed;
- supplier returns and the expected commercial credit without pretending that the credit already exists;
- clear matching between demand, order, receipt, delivery note, incoming invoice, and stock movement;
- manual fallback when a wholesaler interface is unavailable.

Receipt and incoming-invoice approval are separate controls. A supplier invoice must not create stock merely because it contains an article line.

### Reorder And Shortage Management

The operational core should provide:

- global or location-specific minimum, target, and reorder quantities;
- low-stock and uncovered-demand worklists rather than only passive warning badges;
- proposed order quantity that considers on-hand, reserved, expected incoming, open demand, pack size, lead time, and target level;
- exceptions for discontinued items, missing suppliers, uncertain unit conversion, stale price, delayed orders, and conflicting duplicate orders;
- snooze, dismiss, substitute, transfer-from-another-location, or add-to-order actions with a reason;
- notification rules that avoid repeated noise and show who owns the next action.

Automatic submission to a supplier is not required for the core. A reviewed, dependable reorder worklist creates value before autonomous ordering is safe.

### Wholesaler Data And Transaction Standards

WerkFlow should treat standards as explicit workflow contracts, not marketing checkboxes:

- **DATANORM:** import and update article and price master data, with version, supplier, effective date, rebate context, rejected rows, and customer-specific overrides visible.
- **IDS / IDS Connect:** open the correct supplier context, transfer a reviewed cart or article selection, and bring the result back into the intended WerkFlow demand or order workflow.
- **UGL:** exchange the supported commercial documents in the supported direction and version, with a clear fallback for rejected or partial data.
- **Open Masterdata:** enrich or synchronize product master data while preserving source, freshness, licensing, and customer overrides.
- **SHK Connect:** use only supported services and partners, with the exact service, direction, authentication, and failure behavior documented.

For every integration, the product must state supported partner, standard version, data direction, objects, plan entitlement, setup responsibility, synchronization timing, error recovery, and whether a supplier contract is also required. Supplier connectivity must never be the only way to complete an urgent operational action.

### Barcode, QR, And Identification

Barcode-supported workflows should:

- identify an item, supplier article, location, transfer, order, delivery, tool, or asset without assuming one code type means the same thing everywhere;
- allow multiple identifiers and preserve collisions or ambiguous matches for review;
- support external GTIN/EAN, supplier codes, internal labels, and QR codes;
- use the same validated actions as manual search rather than creating a second stock logic;
- make quantity, unit, location, and intended action visible before confirmation;
- support printable labels and replacement of damaged labels;
- expose offline and last-sync state once mobile offline support exists;
- avoid claiming that every barcode can be resolved through a universal public database.

### Counts, Reconciliation, And Audit

The stock-count capability should provide:

- full, cycle, location, category, and spot counts;
- printable or mobile count sheets and scanner-assisted counting;
- optional blind counts where the expected quantity would bias the result;
- pause, resume, assignment, progress, and second-count handling;
- explicit discrepancy review before stock correction;
- reason categories, notes, evidence, approver, and movement links for every accepted variance;
- freeze or controlled-movement policies for locations under count;
- reconciliation totals and a signed completion record;
- stock and catalog audit history that is readable by an office user, not only by a developer.

Edits and corrections should not erase the original event. The product should make mistakes repairable without making history mutable.

### Inventory Valuation And Operational Reporting

The module should provide operational valuation and cost insight:

- current quantity and selected cost basis by item and location;
- inventory-value trend and high-value concentration;
- slow-moving, obsolete, damaged, missing, and negative-stock exceptions;
- consumption, waste, return, and unplanned-use trends by item, job, project, location, and employee where appropriate;
- price-change and purchase-price variance views;
- expected versus actual job material cost and explainable post-calculation handoff;
- snapshots that keep historical job costs stable when today's supplier price changes.

The precise valuation policy—such as standard cost, moving average, FIFO, or another accepted method—is a product and accounting decision gate. Operational valuation must not be represented as a general-ledger inventory account unless a native accounting scope is explicitly approved.

### Tools And Individually Tracked Assets

Reusable equipment needs a lifecycle distinct from quantity stock:

- item models plus individual instances with asset tag, serial number, status, location, custodian, and condition;
- checkout, handover, return, reassignment, job allocation, and chain of custody;
- available, in use, reserved, maintenance, inspection due, damaged, lost, retired, and disposed states;
- QR/barcode identification and optional NFC where supported;
- purchase, warranty, documents, instructions, photos, repair, calibration, statutory inspection, and maintenance history;
- issue reporting and a safe rule for blocking unsafe equipment;
- reminders and an operational overview of overdue return, inspection, maintenance, or missing assets;
- optional vehicle-related equipment lists without treating a vehicle as ordinary quantity stock.

Whether vehicles themselves belong here or in a future fleet module is a decision gate.

### Onboarding, Migration, Export, And Support

Inventory adoption should include:

- a documented self-service import and an assisted initial inventory-audit option;
- clear accepted formats, required fields, matching order, unit normalization, validation ownership, and rollback/recovery behavior;
- preview, duplicate resolution, location mapping, initial-count reconciliation, and a downloadable result report;
- repeatable price/catalog updates that do not accidentally add physical stock;
- complete export of catalog, supplier references, locations, stock, movements, open demand, orders, and assets in usable formats;
- visible support channels, service entitlement, expected response path, and escalation for a blocked stock or import operation.

Competitor research shows that migration effort, unclear support entitlement, integration add-ons, and surprise implementation cost can outweigh an attractive headline price. WerkFlow packaging should make required office seats, field access, imports, standards, onboarding, support, storage, and data exit understandable for a real team scenario. The research evidence stays in [Competitive landscape](../product/competitive-landscape.md); this feature spec does not duplicate vendor claims.

## Connected Workflow Contracts

| Connected area | Inventory contract |
| --- | --- |
| Jobs and projects | Planning creates demand only. Reservation allocates availability. Picking/consumption changes physical stock. Job completion can warn about unresolved demand, outstanding material, or unreturned tools but must not silently repair it. |
| Commercial and finance | Offer positions may create proposed demand after approval. Approved net consumption can create a billable suggestion. Purchase orders and receipts support incoming-invoice matching. Cost snapshots feed post-calculation. No inventory action issues an invoice, approves a supplier bill, or posts accounting automatically. |
| Documents | Product sheets, supplier offers, orders, confirmations, delivery notes, receipts, photos, count records, warranties, inspections, and invoices remain accessible from both operational context and the central document system. |
| Employees and roles | Employee actions use assignment and organization context. Price, valuation, supplier negotiation, correction, and approval data remain limited to authorized roles. |
| Time tracking | Job time and material cost meet in post-calculation, but correcting time must not rewrite material history and vice versa. |
| Mobile and offline | Manual search and scan call the same domain actions. Each offline-capable workflow must define available data, queued action, conflict behavior, visible sync state, and recovery. “Offline inventory” is not one binary promise. |
| AI automations | Suggestions may prepare mappings, matches, demand forecasts, or exceptions. The inventory ledger changes only through a validated domain action with the source and responsible actor recorded. |

See [Commercial and finance](./commercial-and-finance.md) for the invoice, incoming-bill, payment, and post-calculation side of these contracts.

## Role And UX Principles

### Admin

- Controls organization-wide inventory policy, sensitive valuation and pricing, imports, integrations, approvals, correction rights, count rules, and lifecycle settings.
- Can investigate and repair exceptional states without deleting history.

### Büro / Manager

- Maintains catalog and suppliers, plans and reserves material, buys shortages, receives goods, performs or approves corrections and counts, reviews billability, and sees operational cost.
- Gets exception-oriented worklists instead of a dense ERP screen.

### Employee / Handwerker/in

- Sees only relevant assigned-work material and permitted tool/vehicle stock.
- Uses short, mobile-friendly take, return, transfer, count, receipt, and issue-reporting flows.
- Does not see purchase prices, sale-price strategy, inventory value, supplier terms, or unrelated stock unless explicitly authorized.
- Cannot create uncontrolled free-text stock from the field. Unknown material becomes a reviewable request or is selected from a controlled existing source.

### Shared UX Rules

- Use natural German labels that name the action: `Planen`, `Reservieren`, `Aus Lager entnehmen`, `Verbraucht`, `Zurücklegen`, `Umlagern`, `Wareneingang prüfen`.
- Show source, destination, unit, quantity, and consequence before confirmation.
- Keep an explicit cancel action in every multi-step flow.
- Make sync, partial completion, shortage, substitution, and correction state visible.
- Use progressive disclosure: the field worker should not navigate accounting concepts, and the office user should not need a specialist app for every inventory task.
- Provide safe undo through compensating/correction actions, not history deletion.
- Keep price and support/plan entitlement clear. A customer should not discover during rollout that a required import, employee access, standard, or support channel is an unexpected add-on.

## Phase 2 — Intelligence And Automation

Phase 2 should automate preparation and detection before it automates consequential decisions.

Safe high-value capabilities include:

- forecast job and seasonal demand using approved historical signals;
- propose reorder quantities, supplier, transfer, or substitute based on availability, lead time, pack size, price, and delivery performance;
- detect unusual consumption, repeated unplanned use, count drift, duplicate orders, stale catalog prices, and likely missed billable material;
- extract and match delivery notes, supplier confirmations, product data, and incoming invoices to orders and receipts;
- suggest CSV/Excel column mappings and duplicate resolutions during onboarding;
- recommend tool maintenance or replacement from use, age, inspection, and failure history;
- summarize shortages, delayed supply, inventory exposure, and job-cost variance for an office review queue;
- draft supplier communication or an order change without sending it.

Every AI-assisted action must:

- show the source records, proposed change, confidence or uncertainty, and affected quantities or money;
- require human review for purchase submission, supplier substitution, stock correction, billability, write-off, or lifecycle retirement;
- preserve who accepted, changed, or rejected the proposal;
- respect organization boundaries and price/role permissions;
- provide a deterministic manual fallback;
- never fabricate a barcode match, article equivalence, receipt, movement, or supplier confirmation.

Rule-based automation may later perform narrowly bounded actions—such as creating a draft reorder or escalating a delayed delivery—when an admin has explicitly enabled the rule, set thresholds, assigned an owner, and can inspect or pause it. Fully autonomous supplier ordering is a separate decision gate.

## Boundaries And Decision Gates

The following are not automatic commitments:

- native double-entry accounting, payroll, or tax filing;
- a full warehouse-management system with wave picking, dock scheduling, robotics, manufacturing, or broad logistics optimization;
- batch, lot, serial, expiry, hazardous-material, or regulated-medical traceability beyond confirmed SHK requirements;
- FIFO, moving-average, standard-cost, or other formal inventory accounting policy;
- multi-company stock ownership, consignment, customer-owned stock, drop shipment, or intercompany transfers;
- manufacturing bills of material, assemblies, prefabrication, or production planning;
- fully autonomous reordering, supplier payment, or supplier substitution;
- universal barcode lookup;
- building a wholesaler marketplace or replacing supplier-specific commercial relationships;
- treating tools, calibrated equipment, vehicles, rentals, and consumables as one identical domain;
- claiming legal, tax, GoBD, safety, or standards compliance without current expert verification and acceptance evidence.

Each supplier standard or API needs a partner, version, direction, support model, fallback, and commercial-access decision before commitment. Each offline flow needs a separate conflict and recovery design.

## Open Product Decisions

- Which inventory outcomes matter first in user testing: reliable counts, job availability, reduced buying trips, procurement speed, missed-billing prevention, or tool custody?
- Should `Verfügbar` exclude only committed reservations, all approved plans, or both with separate values?
- When may a job reserve stock, who can override a reservation, and when is it released?
- Should preferred source locations be strict allocations or suggestions?
- Is negative stock always blocked, or allowed for selected roles/locations with a visible exception queue?
- Which location hierarchy and vehicle-stock model matches real SHK businesses without excessive setup?
- Which unit and pack conversions are required, and who approves ambiguous supplier data?
- Which price basis should operational valuation and post-calculation use?
- Which article replacements or substitutes require customer or project-manager approval?
- What are the first procurement approval thresholds and roles?
- How should direct-to-job delivery, customer-owned material, consignment, and supplier returns behave?
- Which DATANORM versions and rebate structures are required by the first target wholesalers?
- Which IDS, UGL, Open Masterdata, and SHK Connect workflows and partners have enough customer demand to justify implementation?
- Which scanner hardware and mobile barcode formats must be supported?
- What must work offline for a technician, warehouse employee, or vehicle count?
- Which count cadence, blind-count policy, and correction approval are practical for small businesses?
- When do tools require individual tracking, checkout, inspection, calibration, or maintenance?
- Are vehicles assets, locations, or both in the first mature inventory release?
- Which material event creates a billable suggestion, and who reviews warranty, goodwill, rework, and waste?
- What migration service, reconciliation acceptance criteria, support entitlement, and data-exit promise are included in each product package?

## Related Docs

- [Product capability map](../product/product-capability-map.md) — feature ownership, shared objects, and cross-feature handoff rules.
- [Phase 1 roadmap](../plans/phase-1/roadmap.md) — slice order, current status, and links to per-slice acceptance records.
- [User-flow catalog](../product/user-flow-catalog.md) — this feature's accepted user-visible flows by stable ID.
- Connected feature specs: the **Connected Workflow Contracts** table above names every cross-feature contract; load only the specs the current slice names.
- [Inventory V1 implementation plan (closed)](../plans/inventory-v1-implementation-plan.md) — the historical V1 planning record.
