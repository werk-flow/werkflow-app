-- The due-work dialog of the maintenance workspace received every service case
-- of the organization and filtered them by customer and site in the browser.
-- This reader searches cases in the database: optionally one customer and one
-- site, optionally open cases only (not resolved, closed without visit or
-- duplicate), matching number or summary. One page of 50 from p_offset in
-- natural case-number order (as search_equipment_options), and whether more
-- follow. Service-role only: the caller resolves the organization and the
-- manager role first.
create function public.search_service_case_options(
  p_organization_id uuid,
  p_search text default '',
  p_client_id uuid default null,
  p_site_id uuid default null,
  p_open_only boolean default false,
  p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select service_case.id, service_case.case_number, service_case.summary, service_case.client_id,
      service_case.site_id, service_case.status,
      service_case.case_number !~ '^[A-Z]+-[0-9]{4}-[0-9]+$' as number_unmatched,
      substring(service_case.case_number from '^([A-Z]+)-[0-9]{4}-[0-9]+$') as number_prefix,
      substring(service_case.case_number from '^[A-Z]+-([0-9]{4})-[0-9]+$')::integer as number_year,
      substring(service_case.case_number from '^[A-Z]+-[0-9]{4}-([0-9]+)$')::numeric as number_sequence
    from public.service_cases service_case
    where service_case.organization_id = p_organization_id
      and (p_client_id is null or service_case.client_id = p_client_id)
      and (p_site_id is null or service_case.site_id = p_site_id)
      and (
        not coalesce(p_open_only, false)
        or service_case.status not in ('resolved', 'closed_without_visit', 'duplicate')
      )
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', service_case.case_number, service_case.summary)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching
    order by number_unmatched, number_prefix, number_year, number_sequence, case_number, id
    limit 51 offset greatest(coalesce(p_offset, 0), 0)
  ), choices as (
    select * from page
    order by number_unmatched, number_prefix, number_year, number_sequence, case_number, id
    limit 50
  ) select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      jsonb_build_object('id', id, 'caseNumber', case_number, 'summary', summary, 'clientId', client_id,
        'siteId', site_id, 'status', status)
      order by number_unmatched, number_prefix, number_year, number_sequence, case_number, id) from choices), '[]'),
    'hasMore', (select count(*) > 50 from page)
  );
$$;
revoke all on function public.search_service_case_options(uuid, text, uuid, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.search_service_case_options(uuid, text, uuid, uuid, boolean, integer) to service_role;
