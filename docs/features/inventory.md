# Inventory Management

Inventory management is a major near-term planned module for WerkFlow. It is not currently implemented in the app.

This document captures the intended product direction and the important open decisions before implementation begins. It should be updated as soon as the first inventory architecture and schema decisions are made.

## Product Goal

Inventory should help SHK businesses digitize their physical stock and connect materials to operational work. The goal is to reduce manual tracking, paperwork, missed billing items, and uncertainty about which parts are available, needed, used, or should be reordered.

Inventory work should pass the same product filter as other major features:

- Does it reduce paperwork inside the business?
- Does it make work more organized?
- Does it save time for employees or the business owner?

## Current Status

- No inventory module currently exists in the app.
- No inventory database model should be assumed from existing code.
- Inventory should be designed as a new product area, not as an extension guessed from jobs/projects alone.
- Before schema work, inspect live Supabase and generated types to avoid conflicting with current database state.

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

Exact fields are not decided yet and should be designed before implementation.

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

The broader product/service offer may include helping customers establish their initial inventory baseline. The app should support importing or efficiently entering that baseline, but the exact import format and workflow are not decided yet.

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

Permissions are not finalized. A sensible starting point to confirm before implementation:

- Admins can configure and manage all inventory.
- Büro/office users can manage catalog, stock, and job/project materials.
- Employees/field workers can record simple add/remove/use actions where allowed.

Do not hard-code this permission model without confirming requirements for the specific implementation task.

## Data Model Considerations

The first schema design should likely consider separate concepts for:

- Inventory item/catalog data.
- Stock state/counts.
- Stock movements/history.
- Job/project material links.
- Barcode or supplier identifiers.

Do not document exact table or column names here until they are implemented and verified against live Supabase.

## Open Decisions

- Which inventory item fields are required for the first release?
- Should stock be tracked globally per organization first, or by physical storage location from day one?
- What item categories and units are needed for SHK businesses?
- How should job/project material usage affect current stock?
- Should material usage require approval or be immediately applied?
- Which roles can create items, change counts, and attach materials to jobs?
- What import format should support the initial inventory audit?
- Which German wholesalers matter for future ordering integrations?
- How should inventory connect to invoices, offers, and contracts once those modules exist?

## Implementation Guidance

Before implementing inventory:

1. Confirm first-release scope and permissions with the product owner.
2. Inspect live Supabase and generated types.
3. Design the minimal schema needed for catalog, stock, movement history, and job/project links.
4. Keep field-worker flows extremely simple and mobile-friendly.
5. Preserve enough history to diagnose stock changes.
6. Avoid coupling the first version too tightly to future supplier automation or invoicing.
