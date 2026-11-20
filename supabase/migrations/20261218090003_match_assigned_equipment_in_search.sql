-- A field worker's header search finds the Anlagen of their assigned jobs
-- (werk-flow/werkflow-planning#493).
--
-- 1. app_private.installed_equipment_search_matches owns which Anlagen of an
--    organization a search matches: number, „Nummer im Altsystem“
--    (source_number), name, manufacturer, model, customer name, site name and
--    identifier values such as the serial number, case-insensitive and
--    literal. An optional id list narrows the
--    rows it looks at.
-- 2. list_equipment_page uses it in place of its own search clause; the rest
--    of its body, its signature, owner, security and grants are unchanged,
--    and it keeps finding an Anlage by its source_number (20261218090000).
-- 3. public.match_installed_equipment(org, ids, search) returns, as one JSON
--    array, the Anlagen among the given ids that match the search, voided
--    ones never. The server passes the Anlagen a field worker reaches
--    through their assigned jobs (lib/installed-equipment/
--    assigned-equipment-reads.ts); the access rule stays there. Service role
--    only.
--
-- Proven by supabase/tests/service_list_pages.sql and
-- supabase/tests/work_source_numbers.sql (the office list keeps its matches)
-- and supabase/tests/assigned_equipment_search.sql.

create function app_private.installed_equipment_search_matches(
  p_organization_id uuid,
  p_search text,
  p_equipment_ids uuid[] default null
) returns setof uuid language sql stable security invoker set search_path = '' as $$
  select equipment.id
  from public.installed_equipment equipment
  where equipment.organization_id = p_organization_id
    and (p_equipment_ids is null or equipment.id = any(p_equipment_ids))
    and strpos(lower(concat_ws(' ',
      equipment.equipment_number, equipment.source_number, equipment.name, equipment.manufacturer, equipment.model,
      (select client.name from public.clients client
        where client.organization_id = p_organization_id and client.id = equipment.client_id),
      (select site.name from public.client_sites site
        where site.organization_id = p_organization_id and site.id = equipment.site_id),
      (select string_agg(identifier.value, ' ') from public.installed_equipment_identifiers identifier
        where identifier.organization_id = p_organization_id and identifier.equipment_id = equipment.id)
    )), lower(coalesce(p_search, ''))) > 0
$$;
revoke all on function app_private.installed_equipment_search_matches(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function app_private.installed_equipment_search_matches(uuid, text, uuid[]) to service_role;

create or replace function public.list_equipment_page(
  p_organization_id uuid,
  p_search text default '',
  p_category text default 'all',
  p_include_archived boolean default false,
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select equipment.id, equipment.equipment_number,
      equipment.equipment_number !~ '^[A-Z]+-[0-9]{4}-[0-9]+$' as number_unmatched,
      substring(equipment.equipment_number from '^([A-Z]+)-[0-9]{4}-[0-9]+$') as number_prefix,
      substring(equipment.equipment_number from '^[A-Z]+-([0-9]{4})-[0-9]+$')::integer as number_year,
      substring(equipment.equipment_number from '^[A-Z]+-[0-9]{4}-([0-9]+)$')::numeric as number_sequence
    from public.installed_equipment equipment
    where equipment.organization_id = p_organization_id
      and equipment.voided_at is null
      and (coalesce(p_include_archived, false) or equipment.archived_at is null)
      and (coalesce(p_category, 'all') = 'all' or equipment.category::text = p_category)
      and (
        coalesce(p_search, '') = ''
        or equipment.id in (
          select app_private.installed_equipment_search_matches(p_organization_id, p_search)
        )
      )
  ), page as (
    select * from matching
    order by number_unmatched, number_prefix, number_year, number_sequence, equipment_number, id
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'hasAny', exists (
      select 1 from public.installed_equipment equipment
      where equipment.organization_id = p_organization_id and equipment.voided_at is null
    ),
    'ids', coalesce((select jsonb_agg(page.id order by page.number_unmatched, page.number_prefix,
      page.number_year, page.number_sequence, page.equipment_number, page.id) from page), '[]')
  );
$$;
revoke all on function public.list_equipment_page(uuid, text, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.list_equipment_page(uuid, text, text, boolean, integer, integer) to service_role;

create function public.match_installed_equipment(
  p_organization_id uuid,
  p_equipment_ids uuid[],
  p_search text
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(equipment.id order by equipment.id), '[]'::jsonb)
  from public.installed_equipment equipment
  where equipment.organization_id = p_organization_id
    and equipment.voided_at is null
    and equipment.id = any(coalesce(p_equipment_ids, '{}'))
    and equipment.id in (
      select app_private.installed_equipment_search_matches(p_organization_id, p_search, p_equipment_ids)
    )
$$;
revoke all on function public.match_installed_equipment(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.match_installed_equipment(uuid, uuid[], text) to service_role;
