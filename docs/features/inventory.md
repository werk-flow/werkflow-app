# Inventory

Inventory (`Lager`) is the operational record of SHK materials, consumables, tools, assets, locations, stock movements and job material. It tells the business what is on hand and where, what upcoming work needs, and what employees took and returned. A field worker must understand it, and the office gets an auditable material flow.

## Current Product Baseline

Admin and Büro get an organization-scoped catalog, their own locations, manual stock movements, CSV import and material planning on jobs and projects. Assigned field workers take and return material on their jobs.

- **Catalog.** Item types are material, consumable, tool and asset. An item carries several barcodes. The barcode entered on the item becomes its primary barcode, and the previous primary stays attached. A barcode that belongs to another item refuses the save. Saving an item, its barcode and its first stock count is all or nothing. Minimum and target stock are set once per item and apply across all locations. The web app has no camera scanning.
- **Central inventory.** Only Admin and Büro open `/inventar`, with views for all items, Lager, planned material and movements. Search, filters and summary counts cover the whole organization, not only the visible page. The movements view shows only the most recent movements, without paging or search.
- **Availability.** The overview shows stock by item and by location, open planned quantity and `Verfügbar`. `Verfügbar` is total stock minus open planned demand. It is not a reservation.
- **Stock movements.** Only managers record manual additions and removals at a location. No correction flow exists: a new addition or removal fixes a wrong booking. Stock cannot go below zero. Every movement records who, when, where, why, and the quantity before and after. A movement from job material also keeps its job or project. Users have no transfer flow.
- **Locations and categories.** Managers create their own locations, labeled Lager, room, shelf, vehicle or other. WerkFlow creates no default warehouse, so the inventory mirrors the real rooms, shelves and vehicles. Each organization starts with editable SHK categories. Category names carry no product logic.
- **Units.** Every unit accepts a decimal quantity.
- **CSV import.** The initial inventory at onboarding goes through CSV import with column mapping. Import creates missing categories, suppliers and locations. Matching checks the internal SKU first, then a barcode. Each row's quantity becomes a stock movement at the row's Lager. A matched row adds its quantity to the existing item as an `Eingang`. Each row imports completely or not at all: a row whose lookup or write fails, or whose barcode belongs to another item, counts as failed and leaves nothing behind. A row with a quantity but no Lager keeps its item, books no quantity, and the result counts it separately. The import books every row as soon as it starts. It has no confirmation step, row preview, already-imported warning, duplicate resolution, reconciliation total or error report. The result names only the counts of imported rows, rows without a Lager and failed rows.
- **Job and project material.** Managers plan catalog items on jobs and projects without changing stock. Managers and assigned employees take items from a location or return them. A take or return changes stock immediately, with no approval step. An employee may take an existing item that was never planned, and the line is marked unplanned. A refused take creates no unplanned line. Projects show direct material, material from child jobs and the total separately. Lines keep planned, taken, returned and billable quantities apart. Nothing commercial uses the billable quantity.
- **Field material actions.** An assigned employee works with the job's material inside the field work pack. The unplanned-item search hides supplier, price, valuation and billability. Employees cannot create items, open `/inventar` or use project-level material.
- **Read-only consumers.** Templates, dispatch readiness, the work lifecycle, handover, service cases and maintenance plans show material facts and never create, reserve, consume or return stock. Readiness labels planned material as not reserved and tools as not assessed.
- **Tools and assets.** Tools and assets are catalog items. No screen creates, tracks or assigns an individual instance.

### Current limits

- Not built: reservation, picking, approval, transfer, purchase order, goods receipt, supplier return, reorder worklist, formal stock count, valuation report, wholesale-standard integration, Excel import.
- No tool checkout, custody, maintenance, inspection, loss or retirement workflow exists.
