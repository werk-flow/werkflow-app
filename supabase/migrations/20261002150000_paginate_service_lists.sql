-- One bounded page of the equipment list and of the service-case list. Scope
-- filters, search and the count apply before the page boundary, and the order
-- ends with the id. Both functions are service-role only: the caller resolves
-- the current organization and the manager role first. Every joined row comes
-- from the same organization, so a foreign id in a service row matches nothing.

-- Equipment: voided successors never list; archived equipment lists on request.
-- The search covers number, name, manufacturer, model, customer, site and
-- every identifier value. Equipment numbers ascend.
create function public.list_equipment_page(
  p_organization_id uuid,
  p_search text default '',
  p_category text default 'all',
  p_include_archived boolean default false,
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select equipment.id, equipment.equipment_number
    from public.installed_equipment equipment
    where equipment.organization_id = p_organization_id
      and equipment.voided_at is null
      and (coalesce(p_include_archived, false) or equipment.archived_at is null)
      and (coalesce(p_category, 'all') = 'all' or equipment.category::text = p_category)
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ',
          equipment.equipment_number, equipment.name, equipment.manufacturer, equipment.model,
          (select client.name from public.clients client
            where client.organization_id = p_organization_id and client.id = equipment.client_id),
          (select site.name from public.client_sites site
            where site.organization_id = p_organization_id and site.id = equipment.site_id),
          (select string_agg(identifier.value, ' ') from public.installed_equipment_identifiers identifier
            where identifier.organization_id = p_organization_id and identifier.equipment_id = equipment.id)
        )), lower(p_search)) > 0
      )
  ), page as (
    select * from matching order by equipment_number, id
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'hasAny', exists (
      select 1 from public.installed_equipment equipment
      where equipment.organization_id = p_organization_id and equipment.voided_at is null
    ),
    'ids', coalesce((select jsonb_agg(page.id order by page.equipment_number, page.id) from page), '[]')
  );
$$;
revoke all on function public.list_equipment_page(uuid, text, text, boolean, integer, integer) from public, anon, authenticated;
grant execute on function public.list_equipment_page(uuid, text, text, boolean, integer, integer) to service_role;

-- Service cases: `open` excludes the three closing states, `all` lists every
-- case, any other value names one status. The search covers number, summary,
-- customer, site and the linked equipment. The newest change comes first.
create function public.list_service_case_page(
  p_organization_id uuid,
  p_status text default 'open',
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select service_case.id, service_case.updated_at
    from public.service_cases service_case
    where service_case.organization_id = p_organization_id
      and case coalesce(p_status, 'open')
        when 'all' then true
        when 'open' then service_case.status::text not in ('resolved', 'closed_without_visit', 'duplicate')
        else service_case.status::text = p_status
      end
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ',
          service_case.case_number, service_case.summary,
          (select client.name from public.clients client
            where client.organization_id = p_organization_id and client.id = service_case.client_id),
          (select site.name from public.client_sites site
            where site.organization_id = p_organization_id and site.id = service_case.site_id),
          (select string_agg(concat_ws(' ', equipment.equipment_number, equipment.name), ' ')
            from public.service_case_equipment_links link
            join public.installed_equipment equipment
              on equipment.id = link.equipment_id and equipment.organization_id = p_organization_id
            where link.organization_id = p_organization_id and link.service_case_id = service_case.id)
        )), lower(p_search)) > 0
      )
  ), page as (
    select * from matching order by updated_at desc, id
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'hasAny', exists (
      select 1 from public.service_cases service_case where service_case.organization_id = p_organization_id
    ),
    'ids', coalesce((select jsonb_agg(page.id order by page.updated_at desc, page.id) from page), '[]')
  );
$$;
revoke all on function public.list_service_case_page(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_service_case_page(uuid, text, text, integer, integer) to service_role;
