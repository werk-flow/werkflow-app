-- The CSV import shows its effect before it books, and a confirm books once
-- (werk-flow/werkflow-planning#371).
--
-- Before this, importInventoryRows booked every row as soon as it started:
-- no preview, no repeat warning, and a confirm sent twice booked twice.
--
-- One rule decides what a row does: app_private.apply_inventory_import_row.
-- It matches by internal SKU, then by barcode, creates or matches the item,
-- attaches the barcode and books the quantity, and answers what it did. Three
-- callers share it, so no second copy of the rule exists:
--
-- - public.import_inventory_row keeps its signature and its behavior for the
--   previous release's code.
-- - public.preview_inventory_import stages the rows on a new draft batch, runs
--   every row through the rule inside a block it then rolls back, and answers
--   each row's effect. Nothing but the draft batch stays.
-- - public.book_inventory_import books the staged rows of a draft batch. The
--   batch row is the idempotency key: the call locks it, books only a draft,
--   and answers a booked batch with its stored result, so a confirm sent twice
--   books once. The stored result keeps no SQLSTATE of a failed row.
--
-- The booking holds to what the preview resolved. The preview notes on each
-- staged row the article it matched, „new“ for one it creates, or „file“ for
-- one an earlier row of the same file creates; a row whose resolution differs
-- at booking is refused (changed_since_preview) instead of booking stock to
-- another article. A row the preview rejected stays rejected with the
-- preview's reason.
--
-- A row whose unit differs from its matched item's unit is refused
-- (unit_mismatch, its detail the item's unit); the action refuses an empty or
-- unknown unit before it stages the row. A batch in mode master_data books no
-- stock and creates no Lager, whatever the row's quantity.
--
-- Division of work: the action establishes identity, the organization and the
-- manager role, and passes the server-resolved organization and actor. Each
-- function re-checks the actor's manager membership and finds the batch only
-- inside the organization.
--
-- Signals: the batch insert and update reach the Realtime publication as
-- before; a preview's rolled-back writes never commit, so they emit nothing.

alter table public.inventory_import_batches
  add column content_hash text check (content_hash ~ '^[0-9a-f]{64}$'),
  add column mode text not null default 'stock' check (mode in ('stock', 'master_data')),
  add column staged_rows jsonb check (staged_rows is null or jsonb_typeof(staged_rows) = 'array'),
  add column result_payload jsonb check (result_payload is null or jsonb_typeof(result_payload) = 'array');

comment on column public.inventory_import_batches.content_hash is
  'SHA-256 of the imported file''s bytes, computed in the browser; it finds a repeated file.';
comment on column public.inventory_import_batches.staged_rows is
  'The rows the preview showed, as book_inventory_import books them.';
comment on column public.inventory_import_batches.result_payload is
  'Each row''s outcome of the booking, answered again to a repeated confirm.';

create index inventory_import_batches_content_hash_idx
  on public.inventory_import_batches (organization_id, content_hash, completed_at desc)
  where content_hash is not null;

-- One row: create or match the item, attach the barcode, book the quantity.
-- Raises the refusal of the first failing step, so a caller's savepoint or
-- transaction leaves nothing behind.
--
-- p_reviewed is the previewed flow. It refuses a matched item whose unit
-- differs, and changes no matched item: a matched row only checks that its
-- barcode belongs to no other item, and creates no category or supplier.
-- It creates a Lager only for a quantity it books. Without it, the row
-- behaves as import_inventory_row always did.
create function app_private.apply_inventory_import_row(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_batch_id uuid,
  p_item jsonb,
  p_category_name text,
  p_supplier_name text,
  p_location_name text,
  p_barcode text,
  p_quantity numeric,
  p_reason text,
  p_mode text,
  p_reviewed boolean
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_fields public.inventory_items := jsonb_populate_record(null::public.inventory_items, coalesce(p_item, '{}'::jsonb));
  v_sku text := nullif(btrim(coalesce(v_fields.internal_sku, '')), '');
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_quantity numeric := coalesce(p_quantity, 0);
  v_category_id uuid;
  v_supplier_id uuid;
  v_location_id uuid;
  v_location public.inventory_locations;
  v_item public.inventory_items;
  v_matched_by text;
  v_movement record;
  v_outcome jsonb;
begin
  if v_quantity < 0 then
    raise exception 'invalid_input';
  end if;

  if not p_reviewed then
    v_category_id := app_private.ensure_inventory_category(p_organization_id, p_category_name);
    v_supplier_id := app_private.ensure_inventory_supplier(p_organization_id, p_supplier_name);
  end if;
  if p_mode = 'stock' and (not p_reviewed or v_quantity > 0) then
    v_location_id := app_private.ensure_inventory_location(p_organization_id, p_actor_id, p_location_name);
    select location.* into v_location from public.inventory_locations location where location.id = v_location_id;
  end if;

  if v_sku is not null then
    select item.* into v_item from public.inventory_items item
    where item.organization_id = p_organization_id and item.internal_sku = v_sku
    -- Blocks a change of the unit until the row is booked, but not the
    -- foreign-key check of a movement another session inserts while it holds
    -- the stock row: FOR UPDATE would deadlock with that booking.
    for no key update;
    if v_item.id is not null then
      v_matched_by := 'internal_sku';
    end if;
  end if;
  if v_item.id is null and v_barcode is not null then
    select item.* into v_item from public.inventory_item_barcodes barcode
    join public.inventory_items item on item.id = barcode.item_id
    where barcode.organization_id = p_organization_id and barcode.barcode_value = v_barcode
    for no key update of item;
    if v_item.id is not null then
      v_matched_by := 'barcode';
    end if;
  end if;

  if v_item.id is not null and p_reviewed and v_item.unit is distinct from v_fields.unit then
    raise exception 'unit_mismatch' using detail = v_item.unit;
  end if;

  if v_item.id is null then
    if p_reviewed then
      v_category_id := app_private.ensure_inventory_category(p_organization_id, p_category_name);
      v_supplier_id := app_private.ensure_inventory_supplier(p_organization_id, p_supplier_name);
    end if;
    insert into public.inventory_items (
      organization_id, item_type, name, category_id, unit, internal_sku, manufacturer, supplier_id,
      supplier_article_number, purchase_price_cents, sale_price_cents, is_billable,
      global_minimum_stock, global_target_stock, notes, created_by
    ) values (
      p_organization_id, v_fields.item_type, v_fields.name, v_category_id, v_fields.unit, v_sku,
      v_fields.manufacturer, v_supplier_id, v_fields.supplier_article_number,
      v_fields.purchase_price_cents, v_fields.sale_price_cents, v_fields.is_billable,
      v_fields.global_minimum_stock, v_fields.global_target_stock, v_fields.notes, p_actor_id
    )
    returning * into v_item;
  end if;

  if p_reviewed and v_matched_by is not null then
    if exists (
      select 1 from public.inventory_item_barcodes barcode
      where barcode.organization_id = p_organization_id and barcode.barcode_value = v_barcode
        and barcode.item_id <> v_item.id
    ) then
      raise exception 'barcode_taken';
    end if;
  else
    perform app_private.attach_primary_inventory_barcode(p_organization_id, v_item.id, v_barcode);
  end if;

  v_outcome := jsonb_build_object(
    'outcome', 'imported',
    'matched_by', v_matched_by,
    'item_id', v_item.id,
    'item_name', v_item.name,
    'unit', v_item.unit,
    -- A Lager this transaction created reads as new on every row that names it.
    'location_name', v_location.name,
    'location_created', coalesce(v_location.created_at = now(), false),
    'quantity', v_quantity,
    'quantity_before', null,
    'quantity_after', null
  );
  if p_mode <> 'stock' or v_quantity = 0 then
    return v_outcome;
  end if;
  if v_location.id is null then
    return v_outcome || jsonb_build_object('outcome', 'missing_location');
  end if;
  select * into v_movement from public.record_inventory_movement(
    p_organization_id, p_actor_id, v_item.id, v_location.id,
    case when v_matched_by is null then 'initial_count' else 'stock_in' end, v_quantity,
    null, null, null, p_import_batch_id, p_reason
  );
  return v_outcome || jsonb_build_object(
    'outcome', 'booked',
    'quantity_before', v_movement.quantity_before,
    'quantity_after', v_movement.quantity_after
  );
end;
$$;

-- The previous release's per-row import: signature, result and refusals as before.
create or replace function public.import_inventory_row(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_batch_id uuid,
  p_item jsonb,
  p_category_name text,
  p_supplier_name text,
  p_location_name text,
  p_barcode text,
  p_quantity numeric,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  perform 1 from public.inventory_import_batches batch
  where batch.id = p_import_batch_id and batch.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'batch_not_found';
  end if;
  if app_private.apply_inventory_import_row(
    p_organization_id, p_actor_id, p_import_batch_id, p_item, p_category_name, p_supplier_name,
    p_location_name, p_barcode, p_quantity, p_reason, 'stock', false
  )->>'outcome' = 'missing_location' then
    return 'missing_location';
  end if;
  return 'imported';
end;
$$;

-- Every staged row through the rule, each in its own savepoint: a refused row
-- leaves nothing behind and the next row still runs. A row the action already
-- refused carries its `rejection`, and a row the preview rejected its
-- `previewed_rejection`; both are answered without a write. A row with a
-- `previewed_item` must resolve to it again. Each answer carries the row's
-- position in the file (`index`) and what it resolved to (`item_ref`).
create function app_private.apply_inventory_import_rows(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_batch_id uuid,
  p_rows jsonb,
  p_mode text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_row jsonb;
  v_index bigint;
  v_outcome jsonb;
  v_detail text;
  v_state text;
  v_reason text;
  v_ref text;
  v_created uuid[] := '{}';
  v_results jsonb := '[]'::jsonb;
begin
  for v_row, v_index in
    select staged.value, staged.ordinality - 1 from jsonb_array_elements(p_rows) with ordinality staged
  loop
    if v_row ? 'rejection' then
      v_outcome := jsonb_build_object('outcome', 'rejected', 'reason', v_row->>'rejection');
    elsif v_row ? 'previewed_rejection' then
      v_outcome := v_row->'previewed_rejection';
    else
      begin
        v_outcome := app_private.apply_inventory_import_row(
          p_organization_id, p_actor_id, p_import_batch_id, v_row->'item',
          v_row->>'category_name', v_row->>'supplier_name', v_row->>'location_name', v_row->>'barcode',
          (v_row->>'quantity')::numeric, p_reason, p_mode, true
        );
        v_ref := case
          when v_outcome->>'matched_by' is null then 'new'
          when (v_outcome->>'item_id')::uuid = any (v_created) then 'file'
          else v_outcome->>'item_id'
        end;
        if v_row ? 'previewed_item' and v_row->>'previewed_item' is distinct from v_ref then
          raise exception 'changed_since_preview';
        end if;
        v_outcome := v_outcome || jsonb_build_object('item_ref', v_ref);
      -- One handler for every row failure: the savepoint must isolate any of
      -- them so the other rows still book. The named refusals all raise
      -- SQLSTATE P0001 and differ only by message, so condition names cannot
      -- tell them apart. Any other failure keeps only its SQLSTATE (`code`),
      -- never its message or detail, which can quote row values; the action
      -- logs it. query_canceled is no OTHERS condition and fails the call.
      -- A deadlock or serialization failure is not the row's fault: it fails
      -- the whole call, so the batch stays a draft and a repeated confirm
      -- books it again instead of answering a stored failure.
      exception
      when deadlock_detected or serialization_failure then
        raise;
      when others then
        get stacked diagnostics v_detail = pg_exception_detail, v_state = returned_sqlstate;
        v_reason := case
          when sqlerrm in ('unit_mismatch', 'barcode_taken', 'invalid_input', 'changed_since_preview') then sqlerrm
          when sqlerrm = 'inventory item is not available for stock movement' then 'stock_not_tracked'
          else 'failed'
        end;
        v_outcome := jsonb_build_object(
          'outcome', 'rejected',
          'reason', v_reason,
          'unit', v_row->'item'->>'unit',
          'item_unit', case when v_reason = 'unit_mismatch' then v_detail end
        ) || case when v_reason = 'failed' then jsonb_build_object('code', v_state) else '{}'::jsonb end;
      end;
      -- Kept only once the row's savepoint committed, so a later row of the
      -- file that matches this new article reads as „file“.
      if v_outcome->>'item_ref' = 'new' then
        v_created := v_created || (v_outcome->>'item_id')::uuid;
      end if;
    end if;
    v_results := v_results || jsonb_build_array(v_outcome - 'item_id' || jsonb_build_object('index', v_index));
  end loop;
  return v_results;
end;
$$;

-- Stages the rows on a new draft batch and answers each row's effect without
-- booking it: every write of the rule runs inside a block that is rolled back.
create function public.preview_inventory_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_file_name text,
  p_column_mapping jsonb,
  p_content_hash text,
  p_mode text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_batch_id uuid;
  v_results jsonb;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  if p_mode not in ('stock', 'master_data') or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) = 0
  then
    raise exception 'invalid_input';
  end if;

  insert into public.inventory_import_batches (
    organization_id, file_name, status, column_mapping, row_count, created_by, content_hash, mode, staged_rows
  ) values (
    p_organization_id, p_file_name, 'draft', coalesce(p_column_mapping, '{}'::jsonb),
    jsonb_array_length(p_rows), p_actor_id, p_content_hash, p_mode, p_rows
  )
  returning id into v_batch_id;

  begin
    v_results := app_private.apply_inventory_import_rows(
      p_organization_id, p_actor_id, v_batch_id, p_rows, p_mode, null
    );
    -- Local variables keep their values; every write of the block rolls back.
    raise exception 'inventory_import_preview_done';
  exception when others then
    if sqlerrm <> 'inventory_import_preview_done' then
      raise;
    end if;
  end;

  -- The booking holds to this: each row notes the article it resolved to, or
  -- the rejection it showed. Managers read the staged rows through the Data
  -- API, so a rejection keeps no SQLSTATE.
  update public.inventory_import_batches batch set staged_rows = (
    select jsonb_agg(
      case
        when staged.value ? 'rejection' then staged.value
        when result.value->>'outcome' = 'rejected'
          then staged.value || jsonb_build_object('previewed_rejection', result.value - 'index' - 'code')
        else staged.value || jsonb_build_object('previewed_item', result.value->>'item_ref')
      end
      order by staged.ordinality)
    from jsonb_array_elements(p_rows) with ordinality staged
    join jsonb_array_elements(v_results) with ordinality result on result.ordinality = staged.ordinality
  )
  where batch.id = v_batch_id;

  return jsonb_build_object('batch_id', v_batch_id, 'rows', v_results);
end;
$$;

-- Books a previewed batch once. A booked batch answers its stored result.
create function public.book_inventory_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_batch_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_batch public.inventory_import_batches;
  v_results jsonb;
  v_rejected integer;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  select batch.* into v_batch from public.inventory_import_batches batch
  where batch.id = p_import_batch_id and batch.organization_id = p_organization_id
  for update;
  -- A batch the previous release created has no staged rows to book.
  if v_batch.id is null or v_batch.staged_rows is null then
    raise exception 'batch_not_found';
  end if;
  if v_batch.status <> 'draft' then
    return jsonb_build_object('already_booked', true, 'rows', coalesce(v_batch.result_payload, '[]'::jsonb));
  end if;

  v_results := app_private.apply_inventory_import_rows(
    p_organization_id, p_actor_id, v_batch.id, v_batch.staged_rows, v_batch.mode,
    'CSV-Import: ' || v_batch.file_name
  );
  select count(*) into v_rejected from jsonb_array_elements(v_results) result
  where result.value->>'outcome' = 'rejected';

  update public.inventory_import_batches set
    status = case when v_rejected > 0 then 'failed' else 'imported' end,
    imported_count = jsonb_array_length(v_results) - v_rejected,
    failed_count = v_rejected,
    completed_at = now(),
    -- Managers read the batch through the Data API and Realtime: the stored
    -- rows keep no SQLSTATE. Only this first answer carries it, for the log.
    result_payload = (
      select coalesce(jsonb_agg(result.value - 'code' order by result.ordinality), '[]'::jsonb)
      from jsonb_array_elements(v_results) with ordinality result
    )
  where id = v_batch.id;

  return jsonb_build_object('already_booked', false, 'rows', v_results);
end;
$$;

revoke all on function app_private.apply_inventory_import_row(
  uuid, uuid, uuid, jsonb, text, text, text, text, numeric, text, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function app_private.apply_inventory_import_rows(uuid, uuid, uuid, jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.preview_inventory_import(uuid, uuid, text, jsonb, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.book_inventory_import(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.preview_inventory_import(uuid, uuid, text, jsonb, text, text, jsonb)
  to service_role;
grant execute on function public.book_inventory_import(uuid, uuid, uuid)
  to service_role;
