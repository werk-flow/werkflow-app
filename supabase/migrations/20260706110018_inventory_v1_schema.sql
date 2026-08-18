create table if not exists public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  description text,
  sort_order integer not null default 0,
  is_system_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_location_id uuid references public.inventory_locations(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  description text,
  location_type text not null default 'storage' check (location_type in ('storage', 'room', 'shelf', 'vehicle', 'other')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  customer_number text,
  email text,
  phone text,
  website text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_type text not null default 'material' check (item_type in ('material', 'consumable', 'tool', 'asset')),
  name text not null check (btrim(name) <> ''),
  description text,
  category_id uuid references public.inventory_categories(id) on delete set null,
  unit text not null default 'piece' check (btrim(unit) <> ''),
  internal_sku text,
  manufacturer text,
  supplier_id uuid references public.inventory_suppliers(id) on delete set null,
  supplier_article_number text,
  purchase_price_cents integer check (purchase_price_cents is null or purchase_price_cents >= 0),
  sale_price_cents integer check (sale_price_cents is null or sale_price_cents >= 0),
  currency_code text not null default 'EUR' check (currency_code ~ '^[A-Z]{3}$'),
  tax_rate_basis_points integer not null default 1900 check (tax_rate_basis_points >= 0 and tax_rate_basis_points <= 10000),
  is_billable boolean not null default true,
  global_minimum_stock numeric(12,3) not null default 0 check (global_minimum_stock >= 0),
  global_target_stock numeric(12,3) check (global_target_stock is null or global_target_stock >= 0),
  track_quantity boolean not null default true,
  track_individual_assets boolean not null default false,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_item_barcodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  barcode_value text not null check (btrim(barcode_value) <> ''),
  barcode_type text not null default 'unknown' check (barcode_type in ('gtin', 'ean', 'qr', 'internal', 'supplier', 'unknown')),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_stock_levels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  location_id uuid not null references public.inventory_locations(id) on delete cascade,
  quantity_on_hand numeric(12,3) not null default 0 check (quantity_on_hand >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null check (btrim(file_name) <> ''),
  status text not null default 'draft' check (status in ('draft', 'imported', 'failed')),
  column_mapping jsonb not null default '{}'::jsonb check (jsonb_typeof(column_mapping) = 'object'),
  row_count integer not null default 0 check (row_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.job_material_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  preferred_location_id uuid references public.inventory_locations(id) on delete set null,
  planned_quantity numeric(12,3) not null default 0 check (planned_quantity >= 0),
  taken_quantity numeric(12,3) not null default 0 check (taken_quantity >= 0),
  returned_quantity numeric(12,3) not null default 0 check (returned_quantity >= 0),
  billable_quantity numeric(12,3) not null default 0 check (billable_quantity >= 0),
  is_billable boolean not null default true,
  is_unplanned boolean not null default false,
  status text not null default 'planned' check (status in ('planned', 'partially_taken', 'taken', 'returned', 'cancelled')),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_material_lines_exactly_one_target check (num_nonnulls(job_id, project_id) = 1)
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  location_id uuid not null references public.inventory_locations(id) on delete restrict,
  movement_type text not null check (movement_type in ('initial_count', 'stock_in', 'stock_out', 'job_take', 'job_return', 'correction', 'transfer_in', 'transfer_out')),
  quantity_delta numeric(12,3) not null check (quantity_delta <> 0),
  quantity_before numeric(12,3) not null check (quantity_before >= 0),
  quantity_after numeric(12,3) not null check (quantity_after >= 0),
  job_id uuid references public.jobs(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  job_material_line_id uuid references public.job_material_lines(id) on delete set null,
  import_batch_id uuid references public.inventory_import_batches(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_asset_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  asset_tag text,
  serial_number text,
  status text not null default 'available' check (status in ('available', 'in_use', 'maintenance', 'retired', 'lost')),
  current_location_id uuid references public.inventory_locations(id) on delete set null,
  assigned_to_user_id uuid references public.profiles(id) on delete set null,
  current_job_id uuid references public.jobs(id) on delete set null,
  purchased_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid references public.inventory_items(id) on delete set null,
  location_id uuid references public.inventory_locations(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (btrim(event_type) <> ''),
  event_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(event_payload) = 'object'),
  created_at timestamptz not null default now()
);

create unique index if not exists inventory_categories_org_name_key on public.inventory_categories (organization_id, lower(name));
create unique index if not exists inventory_locations_org_parent_name_key on public.inventory_locations (organization_id, coalesce(parent_location_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where is_active;
create unique index if not exists inventory_suppliers_org_name_key on public.inventory_suppliers (organization_id, lower(name));
create unique index if not exists inventory_items_org_internal_sku_key on public.inventory_items (organization_id, internal_sku) where internal_sku is not null;
create unique index if not exists inventory_items_org_supplier_article_key on public.inventory_items (organization_id, supplier_id, supplier_article_number) where supplier_id is not null and supplier_article_number is not null;
create unique index if not exists inventory_item_barcodes_org_value_key on public.inventory_item_barcodes (organization_id, barcode_value);
create unique index if not exists inventory_item_barcodes_one_primary_per_item on public.inventory_item_barcodes (item_id) where is_primary;
create unique index if not exists inventory_stock_levels_org_item_location_key on public.inventory_stock_levels (organization_id, item_id, location_id);
create unique index if not exists inventory_asset_instances_org_asset_tag_key on public.inventory_asset_instances (organization_id, asset_tag) where asset_tag is not null;
create unique index if not exists inventory_asset_instances_org_serial_key on public.inventory_asset_instances (organization_id, serial_number) where serial_number is not null;

create index if not exists inventory_categories_org_idx on public.inventory_categories (organization_id, sort_order);
create index if not exists inventory_locations_org_idx on public.inventory_locations (organization_id, sort_order);
create index if not exists inventory_locations_parent_idx on public.inventory_locations (parent_location_id) where parent_location_id is not null;
create index if not exists inventory_suppliers_org_idx on public.inventory_suppliers (organization_id, name);
create index if not exists inventory_items_org_active_idx on public.inventory_items (organization_id, is_active, name);
create index if not exists inventory_items_category_idx on public.inventory_items (category_id) where category_id is not null;
create index if not exists inventory_items_supplier_idx on public.inventory_items (supplier_id) where supplier_id is not null;
create index if not exists inventory_item_barcodes_item_idx on public.inventory_item_barcodes (item_id);
create index if not exists inventory_stock_levels_item_idx on public.inventory_stock_levels (item_id);
create index if not exists inventory_stock_levels_location_idx on public.inventory_stock_levels (location_id);
create index if not exists inventory_movements_org_created_idx on public.inventory_movements (organization_id, created_at desc);
create index if not exists inventory_movements_item_idx on public.inventory_movements (item_id, created_at desc);
create index if not exists inventory_movements_location_idx on public.inventory_movements (location_id, created_at desc);
create index if not exists inventory_movements_job_idx on public.inventory_movements (job_id, created_at desc) where job_id is not null;
create index if not exists inventory_movements_job_material_line_idx on public.inventory_movements (job_material_line_id) where job_material_line_id is not null;
create index if not exists inventory_movements_import_batch_idx on public.inventory_movements (import_batch_id) where import_batch_id is not null;
create index if not exists job_material_lines_org_job_idx on public.job_material_lines (organization_id, job_id, status) where job_id is not null;
create index if not exists job_material_lines_org_project_idx on public.job_material_lines (organization_id, project_id, status) where project_id is not null;
create index if not exists job_material_lines_item_idx on public.job_material_lines (item_id);
create index if not exists job_material_lines_location_idx on public.job_material_lines (preferred_location_id) where preferred_location_id is not null;
create index if not exists inventory_asset_instances_item_idx on public.inventory_asset_instances (item_id);
create index if not exists inventory_asset_instances_location_idx on public.inventory_asset_instances (current_location_id) where current_location_id is not null;
create index if not exists inventory_asset_instances_assigned_user_idx on public.inventory_asset_instances (assigned_to_user_id) where assigned_to_user_id is not null;
create index if not exists inventory_audit_events_org_created_idx on public.inventory_audit_events (organization_id, created_at desc);
create index if not exists inventory_audit_events_item_idx on public.inventory_audit_events (item_id, created_at desc) where item_id is not null;

create or replace function app_private.validate_inventory_location_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_location_id is not null and not exists (
    select 1 from public.inventory_locations parent
    where parent.id = new.parent_location_id
      and parent.organization_id = new.organization_id
  ) then
    raise exception 'inventory location parent must belong to same organization';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_inventory_item_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.inventory_categories category
    where category.id = new.category_id
      and category.organization_id = new.organization_id
  ) then
    raise exception 'inventory item category must belong to same organization';
  end if;

  if new.supplier_id is not null and not exists (
    select 1 from public.inventory_suppliers supplier
    where supplier.id = new.supplier_id
      and supplier.organization_id = new.organization_id
  ) then
    raise exception 'inventory item supplier must belong to same organization';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_inventory_barcode_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id
      and item.organization_id = new.organization_id
  ) then
    raise exception 'inventory barcode item must belong to same organization';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_inventory_stock_level_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id
      and item.organization_id = new.organization_id
  ) then
    raise exception 'inventory stock item must belong to same organization';
  end if;

  if not exists (
    select 1 from public.inventory_locations location
    where location.id = new.location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception 'inventory stock location must belong to same organization';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_job_material_line_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id
      and job.organization_id = new.organization_id
  ) then
    raise exception 'job material line job must belong to same organization';
  end if;

  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id
      and project.organization_id = new.organization_id
  ) then
    raise exception 'job material line project must belong to same organization';
  end if;

  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id
      and item.organization_id = new.organization_id
  ) then
    raise exception 'job material line item must belong to same organization';
  end if;

  if new.preferred_location_id is not null and not exists (
    select 1 from public.inventory_locations location
    where location.id = new.preferred_location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception 'job material line location must belong to same organization';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_inventory_movement_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id
      and item.organization_id = new.organization_id
  ) then
    raise exception 'inventory movement item must belong to same organization';
  end if;

  if not exists (
    select 1 from public.inventory_locations location
    where location.id = new.location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception 'inventory movement location must belong to same organization';
  end if;

  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id
      and job.organization_id = new.organization_id
  ) then
    raise exception 'inventory movement job must belong to same organization';
  end if;

  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id
      and project.organization_id = new.organization_id
  ) then
    raise exception 'inventory movement project must belong to same organization';
  end if;

  if new.job_material_line_id is not null and not exists (
    select 1 from public.job_material_lines line
    where line.id = new.job_material_line_id
      and line.organization_id = new.organization_id
  ) then
    raise exception 'inventory movement material line must belong to same organization';
  end if;

  if new.import_batch_id is not null and not exists (
    select 1 from public.inventory_import_batches batch
    where batch.id = new.import_batch_id
      and batch.organization_id = new.organization_id
  ) then
    raise exception 'inventory movement import batch must belong to same organization';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_inventory_asset_instance_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id
      and item.organization_id = new.organization_id
  ) then
    raise exception 'inventory asset item must belong to same organization';
  end if;

  if new.current_location_id is not null and not exists (
    select 1 from public.inventory_locations location
    where location.id = new.current_location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception 'inventory asset location must belong to same organization';
  end if;

  if new.current_job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.current_job_id
      and job.organization_id = new.organization_id
  ) then
    raise exception 'inventory asset job must belong to same organization';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_inventory_audit_event_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item_id is not null and not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id
      and item.organization_id = new.organization_id
  ) then
    raise exception 'inventory audit item must belong to same organization';
  end if;

  if new.location_id is not null and not exists (
    select 1 from public.inventory_locations location
    where location.id = new.location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception 'inventory audit location must belong to same organization';
  end if;

  return new;
end;
$$;

create trigger inventory_locations_validate_org
  before insert or update on public.inventory_locations
  for each row execute function app_private.validate_inventory_location_org();
create trigger inventory_items_validate_org
  before insert or update on public.inventory_items
  for each row execute function app_private.validate_inventory_item_org();
create trigger inventory_item_barcodes_validate_org
  before insert or update on public.inventory_item_barcodes
  for each row execute function app_private.validate_inventory_barcode_org();
create trigger inventory_stock_levels_validate_org
  before insert or update on public.inventory_stock_levels
  for each row execute function app_private.validate_inventory_stock_level_org();
create trigger job_material_lines_validate_org
  before insert or update on public.job_material_lines
  for each row execute function app_private.validate_job_material_line_org();
create trigger inventory_movements_validate_org
  before insert or update on public.inventory_movements
  for each row execute function app_private.validate_inventory_movement_org();
create trigger inventory_asset_instances_validate_org
  before insert or update on public.inventory_asset_instances
  for each row execute function app_private.validate_inventory_asset_instance_org();
create trigger inventory_audit_events_validate_org
  before insert or update on public.inventory_audit_events
  for each row execute function app_private.validate_inventory_audit_event_org();

create trigger inventory_categories_updated_at before update on public.inventory_categories for each row execute function public.set_updated_at();
create trigger inventory_locations_updated_at before update on public.inventory_locations for each row execute function public.set_updated_at();
create trigger inventory_suppliers_updated_at before update on public.inventory_suppliers for each row execute function public.set_updated_at();
create trigger inventory_items_updated_at before update on public.inventory_items for each row execute function public.set_updated_at();
create trigger inventory_stock_levels_updated_at before update on public.inventory_stock_levels for each row execute function public.set_updated_at();
create trigger job_material_lines_updated_at before update on public.job_material_lines for each row execute function public.set_updated_at();
create trigger inventory_asset_instances_updated_at before update on public.inventory_asset_instances for each row execute function public.set_updated_at();

create or replace function app_private.is_inventory_manager(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_org_id
      and om.user_id = p_user_id
      and om.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
  );
$$;

create or replace function app_private.can_access_job_inventory(p_job_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.jobs job
    where job.id = p_job_id
      and app_private.is_inventory_manager(job.organization_id, p_user_id)
  )
  or exists (
    select 1
    from public.job_assignments assignment
    where assignment.job_id = p_job_id
      and assignment.user_id = p_user_id
  );
$$;

create or replace function app_private.seed_inventory_defaults(p_org_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  category_names text[] := array[
    'Installation / Rohre & Fittings',
    'Sanitär',
    'Heizung',
    'Klima / Lüftung',
    'Pumpen, Armaturen & Ventile',
    'Befestigung & Verbrauchsmaterial',
    'Dichtstoffe, Chemie & Pflege',
    'Werkzeuge & Maschinen',
    'Mess- & Prüfgeräte',
    'Elektro & Regelung',
    'Sicherheit & Arbeitskleidung',
    'Sonstiges'
  ];
  category_name text;
  category_index integer := 0;
begin
  foreach category_name in array category_names loop
    insert into public.inventory_categories (organization_id, name, sort_order, is_system_default)
    values (p_org_id, category_name, category_index, true)
    on conflict (organization_id, lower(name)) do nothing;
    category_index := category_index + 10;
  end loop;

  insert into public.inventory_locations (organization_id, name, description, location_type, sort_order, is_active, created_by)
  values (p_org_id, 'Hauptlager', 'Standardlager für den Start mit WerkFlow Inventar.', 'storage', 0, true, p_actor_id)
  on conflict (organization_id, coalesce(parent_location_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where is_active do nothing;
end;
$$;

create or replace function app_private.seed_inventory_defaults_for_new_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.seed_inventory_defaults(new.id, new.admin_id);
  return new;
end;
$$;

create trigger organizations_seed_inventory_defaults
  after insert on public.organizations
  for each row execute function app_private.seed_inventory_defaults_for_new_org();

create or replace function public.ensure_inventory_defaults(p_org_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_org_id
      and om.user_id = p_actor_id
  ) then
    raise exception 'not a member of organization';
  end if;

  perform app_private.seed_inventory_defaults(p_org_id, p_actor_id);
end;
$$;

create or replace function public.record_inventory_movement(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_job_id uuid default null,
  p_project_id uuid default null,
  p_job_material_line_id uuid default null,
  p_import_batch_id uuid default null,
  p_reason text default null
)
returns table (movement_id uuid, quantity_before numeric, quantity_after numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_quantity numeric(12,3);
  after_quantity numeric(12,3);
  new_movement_id uuid;
  absolute_delta numeric(12,3);
begin
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'quantity delta must be non-zero';
  end if;

  if p_movement_type not in ('initial_count', 'stock_in', 'stock_out', 'job_take', 'job_return', 'correction', 'transfer_in', 'transfer_out') then
    raise exception 'invalid movement type';
  end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_actor_id
  ) then
    raise exception 'actor is not a member of organization';
  end if;

  if not exists (
    select 1 from public.inventory_items item
    where item.id = p_item_id
      and item.organization_id = p_organization_id
      and item.is_active = true
      and item.track_quantity = true
  ) then
    raise exception 'inventory item is not available for stock movement';
  end if;

  if not exists (
    select 1 from public.inventory_locations location
    where location.id = p_location_id
      and location.organization_id = p_organization_id
      and location.is_active = true
  ) then
    raise exception 'inventory location is not available for stock movement';
  end if;

  insert into public.inventory_stock_levels (organization_id, item_id, location_id, quantity_on_hand)
  values (p_organization_id, p_item_id, p_location_id, 0)
  on conflict (organization_id, item_id, location_id) do nothing;

  select stock.quantity_on_hand
    into before_quantity
  from public.inventory_stock_levels stock
  where stock.organization_id = p_organization_id
    and stock.item_id = p_item_id
    and stock.location_id = p_location_id
  for update;

  after_quantity := before_quantity + p_quantity_delta;

  if after_quantity < 0 then
    raise exception 'inventory stock cannot go below zero';
  end if;

  update public.inventory_stock_levels stock
  set quantity_on_hand = after_quantity,
      updated_at = now()
  where stock.organization_id = p_organization_id
    and stock.item_id = p_item_id
    and stock.location_id = p_location_id;

  insert into public.inventory_movements (
    organization_id,
    item_id,
    location_id,
    movement_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    job_id,
    project_id,
    job_material_line_id,
    import_batch_id,
    actor_id,
    reason
  ) values (
    p_organization_id,
    p_item_id,
    p_location_id,
    p_movement_type,
    p_quantity_delta,
    before_quantity,
    after_quantity,
    p_job_id,
    p_project_id,
    p_job_material_line_id,
    p_import_batch_id,
    p_actor_id,
    nullif(btrim(coalesce(p_reason, '')), '')
  )
  returning id into new_movement_id;

  if p_job_material_line_id is not null then
    absolute_delta := abs(p_quantity_delta);

    if p_movement_type = 'job_take' then
      update public.job_material_lines line
      set taken_quantity = line.taken_quantity + absolute_delta,
          billable_quantity = case
            when line.is_billable then greatest(line.billable_quantity, line.taken_quantity + absolute_delta - line.returned_quantity)
            else line.billable_quantity
          end,
          status = case
            when line.planned_quantity > 0 and line.taken_quantity + absolute_delta >= line.planned_quantity then 'taken'
            else 'partially_taken'
          end
      where line.id = p_job_material_line_id
        and line.organization_id = p_organization_id;
    elsif p_movement_type = 'job_return' then
      update public.job_material_lines line
      set returned_quantity = line.returned_quantity + absolute_delta,
          billable_quantity = case
            when line.is_billable then greatest(0, line.billable_quantity - absolute_delta)
            else line.billable_quantity
          end,
          status = case
            when line.taken_quantity <= line.returned_quantity + absolute_delta then 'returned'
            else 'partially_taken'
          end
      where line.id = p_job_material_line_id
        and line.organization_id = p_organization_id;
    end if;
  end if;

  movement_id := new_movement_id;
  quantity_before := before_quantity;
  quantity_after := after_quantity;
  return next;
end;
$$;

revoke execute on function public.ensure_inventory_defaults(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.record_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_inventory_defaults(uuid, uuid) to service_role;
grant execute on function public.record_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, uuid, uuid, uuid, uuid, text) to service_role;

insert into public.inventory_categories (organization_id, name, sort_order, is_system_default)
select org.id, category.name, category.sort_order, true
from public.organizations org
cross join (values
  ('Installation / Rohre & Fittings', 0),
  ('Sanitär', 10),
  ('Heizung', 20),
  ('Klima / Lüftung', 30),
  ('Pumpen, Armaturen & Ventile', 40),
  ('Befestigung & Verbrauchsmaterial', 50),
  ('Dichtstoffe, Chemie & Pflege', 60),
  ('Werkzeuge & Maschinen', 70),
  ('Mess- & Prüfgeräte', 80),
  ('Elektro & Regelung', 90),
  ('Sicherheit & Arbeitskleidung', 100),
  ('Sonstiges', 110)
) as category(name, sort_order)
on conflict (organization_id, lower(name)) do nothing;

insert into public.inventory_locations (organization_id, name, description, location_type, sort_order, is_active, created_by)
select org.id, 'Hauptlager', 'Standardlager für den Start mit WerkFlow Inventar.', 'storage', 0, true, org.admin_id
from public.organizations org
on conflict (organization_id, coalesce(parent_location_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where is_active do nothing;

alter table public.inventory_categories enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_suppliers enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_barcodes enable row level security;
alter table public.inventory_stock_levels enable row level security;
alter table public.inventory_import_batches enable row level security;
alter table public.job_material_lines enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_asset_instances enable row level security;
alter table public.inventory_audit_events enable row level security;

grant select, insert, update, delete on public.inventory_categories to authenticated, service_role;
grant select, insert, update, delete on public.inventory_locations to authenticated, service_role;
grant select, insert, update, delete on public.inventory_suppliers to authenticated, service_role;
grant select, insert, update, delete on public.inventory_items to authenticated, service_role;
grant select, insert, update, delete on public.inventory_item_barcodes to authenticated, service_role;
grant select, insert, update, delete on public.inventory_stock_levels to authenticated, service_role;
grant select, insert, update, delete on public.inventory_import_batches to authenticated, service_role;
grant select, insert, update, delete on public.job_material_lines to authenticated, service_role;
grant select, insert, update, delete on public.inventory_movements to authenticated, service_role;
grant select, insert, update, delete on public.inventory_asset_instances to authenticated, service_role;
grant select, insert, update, delete on public.inventory_audit_events to authenticated, service_role;

create policy "Inventory managers can manage categories" on public.inventory_categories for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Inventory managers can manage locations" on public.inventory_locations for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Inventory managers can manage suppliers" on public.inventory_suppliers for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Inventory managers can manage items" on public.inventory_items for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Inventory managers can manage barcodes" on public.inventory_item_barcodes for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Inventory managers can manage stock levels" on public.inventory_stock_levels for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Inventory managers can manage imports" on public.inventory_import_batches for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Inventory managers can manage material lines" on public.job_material_lines for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Employees can view assigned job material lines" on public.job_material_lines for select to authenticated using (job_id is not null and app_private.can_access_job_inventory(job_id, (select auth.uid())));
create policy "Inventory managers can manage movements" on public.inventory_movements for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Employees can view assigned job movements" on public.inventory_movements for select to authenticated using (job_id is not null and app_private.can_access_job_inventory(job_id, (select auth.uid())));
create policy "Inventory managers can manage asset instances" on public.inventory_asset_instances for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));
create policy "Inventory managers can manage audit events" on public.inventory_audit_events for all to authenticated using (app_private.is_inventory_manager(organization_id, (select auth.uid()))) with check (app_private.is_inventory_manager(organization_id, (select auth.uid())));

do $$
begin
  alter publication supabase_realtime add table public.inventory_items;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.inventory_locations;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.inventory_stock_levels;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.inventory_movements;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.job_material_lines;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.inventory_asset_instances;
exception when duplicate_object then null;
end $$;