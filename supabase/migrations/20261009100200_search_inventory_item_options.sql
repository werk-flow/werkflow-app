-- The material picker of the work-template editor received the organization's
-- whole active catalog with the page. This reader searches active items in
-- the database with the predicate of the inventory list: a literal text match
-- (`%` and `_` are characters, not wildcards) over name, internal SKU,
-- manufacturer and every barcode. One page of 50 from p_offset in name and id
-- order, and whether more follow. Service-role only: the caller resolves the
-- organization and the manager role first.
create function public.search_inventory_item_options(
  p_organization_id uuid,
  p_search text default '',
  p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select item.id, item.name, item.unit, item.internal_sku, item.is_billable
    from public.inventory_items item
    where item.organization_id = p_organization_id
      and item.is_active
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', item.name, item.internal_sku, item.manufacturer)), lower(p_search)) > 0
        or exists (
          select 1 from public.inventory_item_barcodes barcode
          where barcode.organization_id = p_organization_id
            and barcode.item_id = item.id
            and strpos(lower(barcode.barcode_value), lower(p_search)) > 0
        )
      )
  ), page as (
    select * from matching order by name, id
    limit 51 offset greatest(coalesce(p_offset, 0), 0)
  ), choices as (
    select * from page order by name, id limit 50
  ) select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      jsonb_build_object('id', id, 'name', name, 'unit', unit, 'internalSku', internal_sku, 'isBillable', is_billable)
      order by name, id) from choices), '[]'),
    'hasMore', (select count(*) > 50 from page)
  );
$$;
revoke all on function public.search_inventory_item_options(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_inventory_item_options(uuid, text, integer) to service_role;
