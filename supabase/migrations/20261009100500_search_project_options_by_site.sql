-- The equipment page links work at the equipment's site, so the project
-- search gains an optional site filter. With a site, a project must sit at
-- that site; the customer filter keeps its rule (that customer's projects and
-- those without a customer). Everything else is unchanged from
-- 20261009100000_search_project_options.sql. Service-role only.
-- @destructive: the five-argument version from 20261009100000 was never part of a deployed build
drop function public.search_project_options(uuid, text, uuid, boolean, integer);
create function public.search_project_options(
  p_organization_id uuid,
  p_search text default '',
  p_client_id uuid default null,
  p_open_only boolean default false,
  p_offset integer default 0,
  p_site_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select project.id, project.project_number, project.name, project.client_id, client.name as client_name,
      project.site_id, project.contact_id, project.status_override,
      counts.job_count, counts.completed_job_count,
      coalesce(project.project_number !~ '^[A-Z]+-[0-9]{4}-[0-9]+$', true) as number_unmatched,
      substring(project.project_number from '^([A-Z]+)-[0-9]{4}-[0-9]+$') as number_prefix,
      substring(project.project_number from '^[A-Z]+-([0-9]{4})-[0-9]+$')::integer as number_year,
      substring(project.project_number from '^[A-Z]+-[0-9]{4}-([0-9]+)$')::numeric as number_sequence
    from public.projects project
    left join public.clients client
      on client.id = project.client_id and client.organization_id = p_organization_id
    cross join lateral (
      select count(*)::integer as job_count,
        count(*) filter (where job.status = 'fertig')::integer as completed_job_count
      from public.jobs job
      where job.organization_id = p_organization_id and job.project_id = project.id
    ) counts
    where project.organization_id = p_organization_id
      and (p_client_id is null or project.client_id is null or project.client_id = p_client_id)
      and (p_site_id is null or project.site_id = p_site_id)
      and (
        not coalesce(p_open_only, false)
        or case
          when project.status_override is not null then project.status_override <> 'abgeschlossen'
          else not (counts.job_count > 0 and counts.completed_job_count = counts.job_count)
        end
      )
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', project.project_number, project.name, client.name)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching
    order by number_unmatched, number_prefix, number_year desc, number_sequence desc, name, id
    limit 51 offset greatest(coalesce(p_offset, 0), 0)
  ), choices as (
    select * from page
    order by number_unmatched, number_prefix, number_year desc, number_sequence desc, name, id
    limit 50
  ) select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      jsonb_build_object(
        'id', id, 'projectNumber', project_number, 'name', name, 'clientId', client_id,
        'clientName', client_name, 'siteId', site_id, 'contactId', contact_id,
        'statusOverride', status_override, 'jobCount', job_count, 'completedJobCount', completed_job_count)
      order by number_unmatched, number_prefix, number_year desc, number_sequence desc, name, id) from choices), '[]'),
    'hasMore', (select count(*) > 50 from page)
  );
$$;
revoke all on function public.search_project_options(uuid, text, uuid, boolean, integer, uuid) from public, anon, authenticated;
grant execute on function public.search_project_options(uuid, text, uuid, boolean, integer, uuid) to service_role;
