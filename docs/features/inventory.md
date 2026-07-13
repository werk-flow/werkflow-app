# Inventory Management

Inventory management is a major WerkFlow module for tracking SHK materials, consumables, tools, assets, Lager locations, stock movements, and job material usage.

This document captures the intended product direction, current V1 behavior, and future reference points for later inventory iterations.

The current V1 planning source is `docs/plans/inventory-v1-implementation-plan.md`. It captures the first confirmed product decisions for native WerkFlow inventory, including locations, planned-vs-actual job material usage, tools/assets, barcode-ready item identifiers, CSV import with column mapping, and the recommendation not to build the module on top of Snipe-IT as the core system.

## Product Goal

Inventory should help SHK businesses digitize their physical stock and connect materials to operational work. The goal is to reduce manual tracking, paperwork, missed billing items, and uncertainty about which parts are available, needed, used, or should be reordered.

Inventory work should pass the same product filter as other major features:

- Does it reduce paperwork inside the business?
- Does it make work more organized?
- Does it save time for employees or the business owner?

## Current Status

- V1 is implemented as a native WerkFlow module at `/inventar` for `admin` and `buero` users.
- V1 has organization-scoped Supabase tables for categories, Lager locations, suppliers, items, barcodes, stock levels, import batches, job material lines, stock movements, asset instances, and audit events.
- Existing organizations are seeded with default SHK categories only. Lager locations are created by the user so the app reflects the real rooms, shelves, vehicles, or warehouses of the business.
- Job and project detail pages include `Material & Inventar`, where office users can plan material without changing stock and users can explicitly book taking or returning existing inventory items.
- CSV import exists in V1 with a column-mapping dialog; Excel import remains a later iteration.
- Tools and assets exist from day one as item types with initial asset-instance infrastructure, while deeper checkout, maintenance, and lifecycle workflows are future scope.
- Before future schema work, inspect live Supabase and generated types to avoid conflicting with current database state.

## Intended Scope

The intended module should eventually support:

- A digital inventory catalog for parts, materials, tools, and other stock items relevant to SHK businesses.
- Current stock counts per item.
- Adding and removing quantities.
- Connecting used or required materials to jobs/projects.
- Tracking which items should be included on customer invoices.
- Low-stock thresholds.
- Reordering workflows when counts drop below configured thresholds.
- Barcode scanning through the future mobile app.
- A baseline inventory import/audit as part of the surrounding customer onboarding service.

## Core User Groups

- Business owners need oversight of inventory value, availability, and operational reliability.
- Office staff and project managers need to attach materials to jobs/projects and understand what needs to be ordered.
- Field workers (`Handwerker/in`) need a very simple way to take or add items without complex navigation.
- Apprentices and less experienced employees need guided workflows that minimize mistakes.

## Key Workflows

### Inventory Catalog

Users should be able to maintain a list of items the business stores or uses. Item details should likely include a clear name, category, unit, stock count, and optional metadata such as barcode, supplier, article number, location, and notes.

V1 fields include item type, name, category, unit, SKU, barcode, manufacturer, supplier metadata, purchase/sale price infrastructure, billable flag, global low-stock thresholds, notes, and active status.

### Stock Changes

Users should be able to record inventory movements such as:

- Stock added.
- Stock removed.
- Stock used for a job/project.
- Corrections after a count mismatch.

The system should preserve enough history to understand why stock changed.

### Job/Project Materials

Jobs and projects should be able to reference required or used materials. This should support planning before work and documentation after work.

Materials connected to a job/project may later feed invoice creation or offer/contract workflows.

### Barcode Scanning

The future mobile app should support scanning barcodes so field workers can quickly identify an item, enter a quantity, and confirm whether they added or removed stock.

The web app should not assume camera/barcode flows are available until the mobile app exists, but the data model should be compatible with barcode identifiers.

### Reordering

Inventory should eventually support low-stock thresholds and reorder workflows. Automated ordering through German wholesaler APIs is a possible future direction, but supplier/API details are not yet confirmed.

### Initial Inventory Audit

The broader product/service offer may include helping customers establish their initial inventory baseline. V1 supports CSV upload with column mapping, preview/validation, duplicate matching, and initial quantities recorded as stock movements. Excel import and a more guided onboarding/audit service remain future iterations.

## Non-Goals For First Implementation

Unless explicitly requested, the first inventory implementation should not try to solve every adjacent business process at once.

Avoid starting with:

- Full accounting.
- Full invoice generation.
- Supplier API automation.
- Complex warehouse management.
- Multi-location stock transfer workflows.
- Advanced procurement approvals.

These may become relevant later, but the first implementation should establish a clean, reliable inventory foundation.

## Role And Permission Considerations

Current V1 permissions are:

- `admin` and `buero` can open the central `/inventar` route and manage the catalog, locations, suppliers, imports, prices, corrections, and job/project material planning.
- `employee` users do not receive the central inventory route and cannot manage catalog data, prices, imports, locations, or general stock corrections.
- Employees can view material for jobs assigned to them and take or return existing inventory items through those job pages. They cannot use project-level inventory workflows.
- Server actions derive the active organization and role from authenticated server context. Inventory identifiers must be checked inside that organization even when an admin Supabase client is used.

Future role expansion should be driven by user feedback and confirmed before implementation.

## Data Model Considerations

The first schema design should likely consider separate concepts for:

- Inventory item/catalog data.
- Stock state/counts.
- Stock movements/history.
- Job/project material links.
- Barcode or supplier identifiers.

Exact tables, columns, RLS policies, functions, constraints, and triggers must still be verified against live Supabase and generated types before schema-aware changes.

## Open Decisions After V1 Feedback

- Which catalog fields, categories, units, and table columns do real SHK users actually use or miss?
- How should vehicles, nested locations, and multi-location transfers work in daily operation?
- Should any employee stock action need approval, correction windows, or additional audit detail?
- How should tools/assets progress from basic item tracking into assignment, checkout, maintenance, and lifecycle workflows?
- Which improvements are needed for CSV onboarding, and when is direct Excel import valuable?
- Which German wholesalers matter for future ordering integrations?
- How should inventory connect to invoices, offers, and contracts once those modules exist?
- Which barcode-scanning workflows belong in the future mobile app?

## Guidance For Future Inventory Work

Before extending inventory:

1. Start with concrete feedback from users testing the current V1 flows.
2. Inspect live Supabase and generated types before making schema-aware changes.
3. Preserve organization boundaries, current role separation, and cross-table organization validation.
4. Keep field-worker flows extremely simple and mobile-friendly.
5. Preserve the append-only stock movement history and atomic stock updates needed to diagnose every count change.
6. Keep planning separate from physical stock changes unless product requirements explicitly change.
7. Avoid coupling the inventory foundation too tightly to future supplier automation or invoicing.
