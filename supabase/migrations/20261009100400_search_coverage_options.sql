-- The plan editor of the maintenance workspace received every coverage of the
-- organization and filtered them by customer and site in the browser. This
-- reader searches coverages in the database: optionally one customer and one
-- site, matching number or reference. One page of 50 from p_offset in natural
-- coverage-number order (as search_equipment_options), and whether more
-- follow. Service-role only: the caller resolves the organization and the
-- manager role first.
create function public.search_coverage_options(
  p_organization_id uuid,
  p_search text default '',
  p_client_id uuid default null,
  p_site_id uuid default null,
  p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select coverage.id, coverage.coverage_number, coverage.reference, coverage.client_id, coverage.site_id,
      coverage.coverage_number !~ '^[A-Z]+-[0-9]{4}-[0-9]+$' as number_unmatched,
      substring(coverage.coverage_number from '^([A-Z]+)-[0-9]{4}-[0-9]+$') as number_prefix,
      substring(coverage.coverage_number from '^[A-Z]+-([0-9]{4})-[0-9]+$')::integer as number_year,
      substring(coverage.coverage_number from '^[A-Z]+-[0-9]{4}-([0-9]+)$')::numeric as number_sequence
    from public.maintenance_coverages coverage
    where coverage.organization_id = p_organization_id
      and (p_client_id is null or coverage.client_id = p_client_id)
      and (p_site_id is null or coverage.site_id = p_site_id)
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', coverage.coverage_number, coverage.reference)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching
    order by number_unmatched, number_prefix, number_year, number_sequence, coverage_number, id
    limit 51 offset greatest(coalesce(p_offset, 0), 0)
  ), choices as (
    select * from page
    order by number_unmatched, number_prefix, number_year, number_sequence, coverage_number, id
    limit 50
  ) select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      jsonb_build_object('id', id, 'coverageNumber', coverage_number, 'reference', reference,
        'clientId', client_id, 'siteId', site_id)
      order by number_unmatched, number_prefix, number_year, number_sequence, coverage_number, id) from choices), '[]'),
    'hasMore', (select count(*) > 50 from page)
  );
$$;
revoke all on function public.search_coverage_options(uuid, text, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.search_coverage_options(uuid, text, uuid, uuid, integer) to service_role;
