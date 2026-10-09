-- The project picker of the job forms and of "Projekt zuordnen" read every
-- project of the organization, and the assignment dialog read every job again
-- to count each project's open and finished jobs. This reader searches the
-- whole organization in the database and returns one page of 50 with the
-- counts, the customer's name and the site and contact the job form copies.
-- Open means: a status override other than `abgeschlossen`, or without an
-- override, not every job finished. The filter applies before the page
-- boundary, so a page never holds fewer choices while more follow. Order:
-- natural project number, newest year and sequence first, then name and id;
-- a project without a number of the form `<PREFIX>-<YYYY>-<n>` comes last.
-- Service-role only: the caller resolves the organization and the manager
-- role first.
create function public.search_project_options(
  p_organization_id uuid,
  p_search text default '',
  p_client_id uuid default null,
  p_open_only boolean default false,
  p_offset integer default 0
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
revoke all on function public.search_project_options(uuid, text, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.search_project_options(uuid, text, uuid, boolean, integer) to service_role;
