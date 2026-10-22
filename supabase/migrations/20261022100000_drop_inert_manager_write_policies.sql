-- Client roles write none of these tables: migration 20261015100100 revoked
-- every client INSERT, UPDATE and DELETE grant, and server code writes through
-- the admin client and the service-only functions. The manager write policies
-- on documents, inventory and organization settings, and the own-row write
-- policies on organization_user_preferences, therefore never apply.
-- An inert policy reads like a permission a reviewer must check, and a later
-- grant would silently bring it back to life, so they go. Reads keep their
-- policies: the inventory policies FOR ALL also carried the managers' SELECT,
-- which a SELECT policy with the same expression replaces.

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can insert document audit events" on public.document_audit_events;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can delete document folders" on public.document_folders;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can insert document folders" on public.document_folders;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can update document folders" on public.document_folders;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can delete document links" on public.document_links;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can insert document links" on public.document_links;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can update document links" on public.document_links;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can delete document versions" on public.document_versions;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can insert document versions" on public.document_versions;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can delete documents" on public.documents;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can insert documents" on public.documents;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "Managers can update documents" on public.documents;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "organization_settings_update_for_admins" on public.organization_settings;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "organization_user_preferences_insert_own" on public.organization_user_preferences;

-- @destructive: inert policy, no client write grant reaches it (migration 20261015100100)
drop policy "organization_user_preferences_update_own" on public.organization_user_preferences;

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage asset instances" on public.inventory_asset_instances;
create policy "Inventory managers can view asset instances" on public.inventory_asset_instances
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage audit events" on public.inventory_audit_events;
create policy "Inventory managers can view audit events" on public.inventory_audit_events
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage categories" on public.inventory_categories;
create policy "Inventory managers can view categories" on public.inventory_categories
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage imports" on public.inventory_import_batches;
create policy "Inventory managers can view imports" on public.inventory_import_batches
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage barcodes" on public.inventory_item_barcodes;
create policy "Inventory managers can view barcodes" on public.inventory_item_barcodes
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage items" on public.inventory_items;
create policy "Inventory managers can view items" on public.inventory_items
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage locations" on public.inventory_locations;
create policy "Inventory managers can view locations" on public.inventory_locations
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage movements" on public.inventory_movements;
create policy "Inventory managers can view movements" on public.inventory_movements
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage stock levels" on public.inventory_stock_levels;
create policy "Inventory managers can view stock levels" on public.inventory_stock_levels
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage suppliers" on public.inventory_suppliers;
create policy "Inventory managers can view suppliers" on public.inventory_suppliers
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));

-- @destructive: the managers' read stays in the SELECT policy created below
drop policy "Inventory managers can manage material lines" on public.job_material_lines;
create policy "Inventory managers can view material lines" on public.job_material_lines
  for select to authenticated
  using (app_private.is_inventory_manager(organization_id, (select auth.uid())));
