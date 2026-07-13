# Inventory V1 Implementation Plan

Status: Planning source for first implementation
Date: 2026-07-06

## Purpose

This plan turns the broad inventory product direction into an implementable V1 for WerkFlow. It should be used as the handoff anchor when implementation starts or when context is compacted.

The goal is a native WerkFlow inventory domain, not a Snipe-IT-backed system. Snipe-IT remains useful as reference for proven inventory concepts such as asset tags, barcode labels, imports, checkout history, and audit trails, but WerkFlow needs inventory to integrate deeply with organizations, roles, jobs/projects, Supabase RLS, Realtime, and future billing/ordering workflows.

## Product Decisions Confirmed

- V1 tracks both materials/consumables and tools/assets.
- The central manager route is `/inventar` with the sidebar label `Inventar`.
- Inventory locations are included from day one.
- Locations represent real physical buckets such as Lager rooms, halls, shelves, or later vehicles.
- The `/inventar` page needs location-specific views plus an `Alle Artikel` view that shows everything across locations.
- Büro users can plan material for jobs/projects without reducing stock.
- Stock is reduced only when an employee or manager records the actual removal, use, return, correction, or stock intake.
- Employee stock usage may reduce stock immediately.
- Employees can only choose existing inventory items. They cannot create unknown materials in the field.
- Barcode scanning is important future scope. V1 must store barcode identifiers, but does not need native camera scanning yet.
- Initial customer onboarding includes a full inventory audit. V1 needs CSV import with column mapping.
- Excel import, supplier APIs, automated ordering, invoice calculations, and advanced profitability reporting are later versions.
- Basic purchase price, sale price, and billable metadata should exist in V1, but no invoice/revenue/profit workflows should be built yet.
- Low-stock thresholds should start globally per item.

## V1 Goals

1. Add a central `/inventar` manager surface for `admin` and `buero`.
2. Model organization-scoped inventory items, locations, stock levels, stock movements, job/project material planning, and basic tool/asset tracking.
3. Let managers create and edit inventory items with basic supplier, barcode, price, billable, category, and unit fields.
4. Let managers create and manage physical `Lager` locations and see item counts per location.
5. Let managers plan materials for jobs without stock changing.
6. Let employees record actual material removal/return from assigned job pages with a simple mobile-friendly flow.
7. Preserve stock movement history so every count change has a reason, actor, timestamp, and optional job/project link.
8. Provide CSV import with column mapping for the initial inventory audit.
9. Add cache tags and Realtime subscriptions for fresh inventory data.
10. Keep future barcode, invoice, supplier ordering, and mobile app integrations possible without coupling V1 to them.

## Non-Goals For V1

- Native camera/barcode scanning in the web app.
- Excel import.
- Supplier API ordering or automated reorder submissions.
- Invoice, offer, contract, or accounting workflows.
- Profit margin dashboards.
- Full warehouse management.
- Approval queue for every employee stock movement.
- Offline mobile inventory.
- Complex multi-step transfer workflows between locations.
- Custom permission builder.
- Deep tool lifecycle workflows such as maintenance scheduling, calibration, or warranty tracking.

## Core Domain Model

### Inventory Item Types

Use one catalog table with an item type field. V1 should support:

- `material`: Job-related stock that is usually consumed or installed, such as pipes, fittings, valves, screws, insulation, seals, pumps, or fixtures.
- `consumable`: Small supplies that are consumed over time, such as tape, sealants, sprays, gloves, drill bits, or cleaning material.
- `tool`: Reusable equipment used by employees, such as hand tools, machines, measuring tools, or installation tools.
- `asset`: Higher-value reusable equipment that should eventually be individually tracked, such as machines, test devices, vehicles, or larger devices.

For V1, materials and consumables get the strongest quantity workflows. Tools/assets can start more minimal, but the schema should support individual asset instances from the beginning.

### Locations

Locations are physical inventory buckets inside an organization.

Examples:

- `Lager A`
- `Lager B`
- `Werkstatt`
- `Regal Sanitär`
- `Fahrzeug Max`

V1 should not create a default `Hauptlager`. If no physical Lager exists yet, the inventory should start without locations. Users create Lager locations so WerkFlow mirrors the actual rooms, shelves, storage halls, and vehicles in the business. The schema should allow optional parent locations so later we can model `Lager A > Regal 2`, even if the first UI stays mostly flat.

### Planned vs Actual Stock

Planning material for a job/project must not change stock.

Important quantities:

- `Bestand`: actual current stock on hand.
- `Geplant`: quantity planned for open jobs/projects but not yet taken.
- `Verfügbar`: actual stock minus open planned quantity.
- `Entnommen`: quantity actually removed for a job/project.
- `Zurückgelegt`: quantity returned to stock.

Example:

1. Büro plans 6 screws for Auftrag 123.
2. Inventory still has the same actual stock count.
3. The item shows 6 planned for Auftrag 123.
4. A field worker later records that 6 screws were taken.
5. A stock movement reduces actual stock by 6 and the job material line records 6 taken.
6. If 2 screws come back, a return movement adds 2 back to stock.

## Suggested Tables

Exact table/column names should be verified and applied through live Supabase. Do not create local migration files unless the workflow changes.

### `inventory_locations`

Purpose: Physical buckets/rooms/shelves/vehicles.

Suggested fields:

- `id`
- `organization_id`
- `parent_location_id`
- `name`
- `description`
- `location_type`: `storage`, `room`, `shelf`, `vehicle`, `other`
- `sort_order`
- `is_active`
- `created_by`
- `created_at`
- `updated_at`

### `inventory_categories`

Purpose: Editable org categories seeded with practical SHK defaults.

Suggested fields:

- `id`
- `organization_id`
- `name`
- `description`
- `sort_order`
- `is_system_default`
- `created_at`
- `updated_at`

Categories should be data, not hard business logic.

### `inventory_suppliers`

Purpose: Basic supplier metadata for ordering and import matching.

Suggested fields:

- `id`
- `organization_id`
- `name`
- `customer_number`
- `email`
- `phone`
- `website`
- `notes`
- `created_at`
- `updated_at`

### `inventory_items`

Purpose: Catalog row shared across locations.

Suggested fields:

- `id`
- `organization_id`
- `item_type`: `material`, `consumable`, `tool`, `asset`
- `name`
- `description`
- `category_id`
- `unit`
- `internal_sku`
- `manufacturer`
- `supplier_id`
- `supplier_article_number`
- `purchase_price_cents`
- `sale_price_cents`
- `currency_code`
- `tax_rate_basis_points`
- `is_billable`
- `global_minimum_stock`
- `global_target_stock`
- `track_quantity`
- `track_individual_assets`
- `notes`
- `is_active`
- `created_by`
- `created_at`
- `updated_at`

Notes:

- `track_quantity` should be true for materials/consumables by default.
- `track_individual_assets` should be true for assets and optional for tools.
- Price fields are infrastructure only in V1.

### `inventory_item_barcodes`

Purpose: Allow multiple identifiers per item.

Suggested fields:

- `id`
- `organization_id`
- `item_id`
- `barcode_value`
- `barcode_type`: `gtin`, `ean`, `qr`, `internal`, `supplier`, `unknown`
- `is_primary`
- `created_at`

Notes:

- Do not assume every barcode can be resolved through a universal public database.
- During onboarding audit, scanned barcodes can be attached to existing or newly imported items.

### `inventory_stock_levels`

Purpose: Current quantity per item and location.

Suggested fields:

- `id`
- `organization_id`
- `item_id`
- `location_id`
- `quantity_on_hand`
- `updated_at`

Constraints:

- Unique per `organization_id`, `item_id`, `location_id`.
- Quantity should not go below zero unless we explicitly decide to allow negative stock. For V1, block negative stock.

### `inventory_movements`

Purpose: Append-only stock history.

Suggested fields:

- `id`
- `organization_id`
- `item_id`
- `location_id`
- `movement_type`: `initial_count`, `stock_in`, `stock_out`, `job_take`, `job_return`, `correction`, `transfer_in`, `transfer_out`
- `quantity_delta`
- `quantity_before`
- `quantity_after`
- `job_id`
- `project_id`
- `job_material_line_id`
- `import_batch_id`
- `actor_id`
- `reason`
- `created_at`

Rules:

- Every stock count change creates one movement.
- Planning a job material line does not create a movement.
- Employee job take creates a negative movement.
- Employee job return creates a positive movement.
- Corrections require a reason.
- Transfers can be represented as one `transfer_out` and one `transfer_in`, but the first UI can defer transfer-specific UX.

### `job_material_lines`

Purpose: Planned and actual materials connected to a job or project.

Suggested fields:

- `id`
- `organization_id`
- `job_id`
- `project_id`
- `item_id`
- `preferred_location_id`
- `planned_quantity`
- `taken_quantity`
- `returned_quantity`
- `billable_quantity`
- `is_billable`
- `is_unplanned`
- `status`: `planned`, `partially_taken`, `taken`, `returned`, `cancelled`
- `notes`
- `created_by`
- `created_at`
- `updated_at`

Rules:

- Exactly one of `job_id` or `project_id` should be set.
- Job-level planning should be implemented first in the UI.
- Project-level planning can use the same table but may be shown as aggregate/read-only in V1 if needed.
- Employees may record existing-item usage for assigned jobs. If it was not planned, create a line with `planned_quantity = 0` and `is_unplanned = true`.

### `inventory_asset_instances`

Purpose: Individual tracking for tools/assets.

Suggested fields:

- `id`
- `organization_id`
- `item_id`
- `asset_tag`
- `serial_number`
- `status`: `available`, `in_use`, `maintenance`, `retired`, `lost`
- `current_location_id`
- `assigned_to_user_id`
- `current_job_id`
- `purchased_at`
- `notes`
- `created_at`
- `updated_at`

V1 UI can be minimal: create/edit instance, show status, location, serial number, and history later.

### `inventory_import_batches`

Purpose: Preserve CSV import context from inventory audits.

Suggested fields:

- `id`
- `organization_id`
- `file_name`
- `status`: `draft`, `imported`, `failed`
- `column_mapping`
- `row_count`
- `imported_count`
- `failed_count`
- `created_by`
- `created_at`
- `completed_at`

The stock created by an import should still be represented through `inventory_movements` with `movement_type = initial_count`.

### `inventory_audit_events`

Purpose: Track non-stock changes such as catalog edits, location creation, category changes, barcode edits, and asset instance edits.

Suggested fields:

- `id`
- `organization_id`
- `item_id`
- `location_id`
- `actor_id`
- `event_type`
- `event_payload`
- `created_at`

Stock count history belongs in `inventory_movements`; catalog/entity history belongs here.

## Permissions And RLS Direction

Use server actions with explicit authorization checks, plus RLS as defense in depth.

Manager rules:

- `admin` and `buero` can view `/inventar`.
- `admin` and `buero` can create/edit/archive items, locations, suppliers, categories, stock levels, imports, and job material plans.
- `admin` and `buero` can perform corrections and see price fields.

Employee rules:

- `employee` does not get the central `/inventar` sidebar page in V1 unless product scope changes.
- `employee` can see assigned job material lines on assigned job pages.
- `employee` can record take/return movements for existing items on assigned jobs.
- `employee` cannot create new inventory items, edit catalog fields, import files, manage locations, see purchase/sale prices, or perform general stock corrections.

RLS notes:

- Inventory tables should be organization-scoped.
- Avoid direct browser reads of sensitive price fields for employees.
- Prefer server actions that return sanitized employee view models.
- Add helper functions similar to document management:
  - `app_private.is_inventory_manager(org_id, user_id)`
  - `app_private.can_access_job_inventory(job_id, user_id)`

## Default Categories

Research notes:

- GC-GRUPPE describes itself as an SHK/Haustechnik wholesaler with assortments across Sanitär, Heizung, Klima/Lüftung, Installation, Elektro, Dachtechnik, Werkzeug, Tiefbau, Industrietechnik, Wassertechnik, and Photovoltaik/Stromspeicher.
- Its installation assortment explicitly calls out pipes, connection elements, stainless steel, copper, plastic installation systems, connection technologies, fire protection, pumps, sound protection, and water treatment.
- Its tool assortment calls out hand/machine tools, pipe/cable processing, measuring/testing devices, workshop/site infrastructure, cleaning/care, PPE, and work clothing.

Seed these editable V1 categories:

- `Installation / Rohre & Fittings`
- `Sanitär`
- `Heizung`
- `Klima / Lüftung`
- `Pumpen, Armaturen & Ventile`
- `Befestigung & Verbrauchsmaterial`
- `Dichtstoffe, Chemie & Pflege`
- `Werkzeuge & Maschinen`
- `Mess- & Prüfgeräte`
- `Elektro & Regelung`
- `Sicherheit & Arbeitskleidung`
- `Sonstiges`

These should be editable and organization-scoped. Do not build logic that depends on exact category names.

## Default Units

Use practical defaults with German labels. Store stable technical unit keys in code/database, but show German labels.

Suggested V1 units:

- `Stück`
- `Meter`
- `Rolle`
- `Packung`
- `Karton`
- `Set`
- `Paar`
- `Liter`
- `Kilogramm`
- `Sack`
- `Tube / Kartusche`
- `Bund`
- `Palette`

Quantity input rules:

- Allow decimals for `Meter`, `Liter`, and `Kilogramm`.
- Prefer whole numbers for `Stück`, `Rolle`, `Packung`, `Karton`, `Set`, `Paar`, `Sack`, `Tube / Kartusche`, `Bund`, and `Palette`.
- Keep this validation gentle in V1 because imported customer data may be messy.

## Central `/inventar` UI

Manager-only route.

### Layout

Follow the calm WerkFlow table style from Aufträge and Dokumente.

Main page structure:

- Header: `Inventar`
- Primary action: `Artikel anlegen`
- Secondary actions: `CSV importieren`, `Lager verwalten`
- View tabs:
  - `Alle Artikel`
  - `Lager`
  - `Geplant`
  - `Bewegungen`
- In `Lager`, show user-created location buckets such as `Lager A`, `Lager B`, `Werkstatt`, or `Fahrzeug Max`.
- `Alle Artikel` shows aggregated stock across all locations.

### KPI Strip

Keep compact and operational:

- Total active items
- Low-stock item count
- Planned material count
- Total stock value, if purchase prices exist

Avoid oversized dashboard cards.

### Inventory Table

Suggested columns:

- Name
- Typ
- Kategorie
- Lager / Bestand
- Geplant
- Verfügbar
- Mindestbestand
- Lieferant
- Artikelnummer
- Aktionen

For a single location view:

- `Bestand` means stock in that location.
- `Geplant` can show planned demand for that location when preferred location is set.
- `Verfügbar` means `quantity_on_hand - open_planned_quantity`.

For `Alle Artikel`:

- Aggregate stock across locations.
- Row detail shows stock by location.

### Row Actions

- Details öffnen
- Bestand ändern
- Bewegungshistorie
- Bearbeiten
- Archivieren

### Item Detail Drawer/Dialog

Show:

- Catalog metadata.
- Stock by location.
- Planned/open job material lines.
- Barcodes.
- Supplier/article info.
- Price/billable metadata for managers.
- Recent movements.

## Job Detail Integration

Add a `Material` or `Material & Inventar` section near existing job operational/detail sections.

Manager view:

- Add planned materials.
- Choose item, quantity, unit, preferred source location, billable flag, notes.
- See planned/taken/returned status.
- Remove or cancel planned lines before they are taken.
- See low availability warning if planned quantity exceeds available stock.

Employee view:

- Show simple assigned-job materials.
- Primary action: `Material entnehmen`.
- Secondary action: `Material zurücklegen`.
- No prices.
- No catalog editing.
- Existing items only.
- If item was not planned, allow `Ungeplantes Material erfassen` from existing items and mark it as unplanned.

Mobile flow:

1. Employee opens assigned Auftrag.
2. Taps `Material entnehmen`.
3. Chooses a planned item or searches an existing item.
4. Enters quantity.
5. Confirms.
6. Stock movement is created immediately.

Future barcode flow:

1. Employee scans barcode.
2. App finds item through `inventory_item_barcodes`.
3. Same quantity modal opens.
4. Confirmation creates the same movement as manual selection.

## CSV Import Flow

V1 needs a real import modal because onboarding audits and messy customer spreadsheets are central to the product.

Flow:

1. Manager clicks `CSV importieren`.
2. Upload CSV.
3. App parses headers and first rows.
4. Manager maps file columns to WerkFlow fields.
5. App previews normalized rows and errors.
6. Manager chooses default location and default item type/category for missing values.
7. Import creates/updates catalog items.
8. Import creates initial stock levels through `initial_count` movements.
9. Import summary shows created, updated, skipped, and failed rows.

Required mappable fields:

- Name
- Quantity

Strongly recommended fields:

- Location
- Unit
- Item type
- Category

Optional fields:

- Barcode
- Internal SKU
- Supplier
- Supplier article number
- Manufacturer
- Purchase price
- Sale price
- Billable
- Minimum stock
- Notes

Duplicate matching order:

1. Primary barcode match.
2. Internal SKU match inside organization.
3. Supplier + supplier article number match.
4. Exact normalized name + unit + category fallback, with preview confirmation.

## Realtime And Caching

Add inventory cache tags:

- `CACHE_TAGS.inventory(orgId)`
- Optional narrower tags later for stock/movements if needed.

Add Realtime subscriptions for:

- `inventory_items`
- `inventory_locations`
- `inventory_stock_levels`
- `inventory_movements`
- `job_material_lines`
- `inventory_asset_instances`

Keep events organization-scoped and debounce as the existing provider does.

## Implementation Phases

### Phase 1: Schema And Types

- Apply schema through Supabase MCP/direct SQL workflow.
- Add RLS helper functions and policies.
- Add triggers for `updated_at`.
- Add org validation constraints where cross-table organization consistency matters.
- Update `lib/supabase/database.types.ts` from live schema.

### Phase 2: Inventory Domain Layer

- Add `lib/inventory/types.ts`.
- Add `lib/inventory/actions.ts`.
- Add auth helpers for inventory manager and assigned-job employee flows.
- Add validation with Zod or local schema helpers.
- Add stock movement transaction helpers so stock level and movement history cannot drift.

### Phase 3: Central Inventory Page

- Add `app/(app)/inventar/page.tsx`.
- Add loading skeleton.
- Add sidebar item for managers.
- Add `components/inventar/*` for table, filters, item dialogs, stock movement dialog, location management, movement history.
- Add empty states for no locations/items/imports.

### Phase 4: Job Materials

- Add server reads for job material lines.
- Add manager planning UI to job detail pages.
- Add employee take/return UI to assigned job detail pages.
- Add availability warnings and optimistic-friendly refresh behavior.

### Phase 5: CSV Import

- Add import dialog and CSV parser.
- Add column mapping UI.
- Add preview/validation.
- Add import server action with import batch and movement creation.
- Add clear German error messages for invalid rows.

### Phase 6: Tool/Asset Minimal V1

- Add asset instance create/edit for items with `track_individual_assets`.
- Show asset tag, serial number, status, current location.
- Keep checkout/maintenance workflows for later.

### Phase 7: Verification And Docs

- Run `bun run lint`.
- Run `bun run build`.
- Verify manager and employee routes manually.
- Verify stock movement history for planned/taken/returned/correction flows.
- Update `docs/features/inventory.md` with final implemented model.
- Update `docs/technical/data-model.md` if conceptual model changes.

## Open Questions Before Or During Build

These should not block the first schema draft, but should be confirmed before polishing V1:

- Should vehicles be visible as location type in the first UI, or kept as hidden/future-capable type?
- Should unplanned existing-item usage by employees be allowed from day one? Current plan says yes, marked as `is_unplanned`.
- Should stock corrections be manager-only always, or can employees correct their own last movement within a short time window?
- Should `Verfügbar` subtract all open planned quantities globally, or only planned quantities for the selected location when a preferred location is set?
- Should tools/assets be assignable to employees/jobs in V1, or only tracked as available/in use/maintenance with a location?

## Source Notes

- Local source of truth before planning: `AGENTS.md`, `docs/features/inventory.md`, `docs/features/jobs-and-projects.md`, `docs/features/document-management.md`, `docs/technical/data-model.md`, live Supabase table inspection.
- GC-GRUPPE assortment reference: https://www.gc-gruppe.de/ueber-uns/sortiment
- GC-GRUPPE installation reference: https://www.gc-gruppe.de/ueber-uns/sortiment/installation
- GC-GRUPPE tool reference: https://www.gc-gruppe.de/ueber-uns/sortiment/werkzeug
- BIPM SI units reference for standard units such as metre and kilogram: https://www.bipm.org/en/measurement-units/si-base-units
- Snipe-IT docs and API were reviewed as reference material, but not selected as WerkFlow's core inventory foundation.
