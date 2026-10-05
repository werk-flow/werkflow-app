-- Pickers that offer records by number selected their window in text order
-- (`ANL-2026-1000` before `ANL-2026-101`, and the first 25 or 50 by text) and
-- sorted only that window. These readers select in the natural order of the
-- paged lists (20261004090000_sort_record_numbers_naturally.sql): a number of
-- the form `<PREFIX>-<YYYY>-<sequence>` by prefix, then year, then the
-- numeric sequence, then the text and the id; a number outside the form, or
-- none, after every matching number. Service-role only: the caller resolves
-- the organization and the manager role first.

-- The equipment picker of the job and project forms: active (not voided)
-- equipment, optionally of one customer, matching number or name. One page
-- of 50 from p_offset, and whether more follow.
create function public.search_equipment_options(
  p_organization_id uuid,
  p_search text default '',
  p_client_id uuid default null,
  p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select equipment.id, equipment.equipment_number, equipment.name, equipment.client_id,
      equipment.equipment_number !~ '^[A-Z]+-[0-9]{4}-[0-9]+$' as number_unmatched,
      substring(equipment.equipment_number from '^([A-Z]+)-[0-9]{4}-[0-9]+$') as number_prefix,
      substring(equipment.equipment_number from '^[A-Z]+-([0-9]{4})-[0-9]+$')::integer as number_year,
      substring(equipment.equipment_number from '^[A-Z]+-[0-9]{4}-([0-9]+)$')::numeric as number_sequence
    from public.installed_equipment equipment
    where equipment.organization_id = p_organization_id
      and equipment.voided_at is null
      and (p_client_id is null or equipment.client_id = p_client_id)
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', equipment.equipment_number, equipment.name)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching
    order by number_unmatched, number_prefix, number_year, number_sequence, equipment_number, id
    limit 51 offset greatest(coalesce(p_offset, 0), 0)
  ), choices as (
    select * from page
    order by number_unmatched, number_prefix, number_year, number_sequence, equipment_number, id
    limit 50
  ) select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      jsonb_build_object('id', id, 'equipmentNumber', equipment_number, 'name', name, 'clientId', client_id)
      order by number_unmatched, number_prefix, number_year, number_sequence, equipment_number, id) from choices), '[]'),
    'hasMore', (select count(*) > 50 from page)
  );
$$;
revoke all on function public.search_equipment_options(uuid, text, uuid, integer) from public, anon, authenticated;
grant execute on function public.search_equipment_options(uuid, text, uuid, integer) to service_role;

-- The predecessor choices of a work dependency: jobs (`job`) or projects
-- (`project`) matching number or title, at most p_limit (1 to 50). An empty
-- search returns the first records in number order.
create function public.search_work_predecessor_options(
  p_organization_id uuid,
  p_kind text,
  p_search text default '',
  p_limit integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with candidates as (
    select job.id, job.job_number as number, job.title
    from public.jobs job
    where p_kind = 'job' and job.organization_id = p_organization_id
    union all
    select project.id, project.project_number, project.name
    from public.projects project
    where p_kind = 'project' and project.organization_id = p_organization_id
  ), matching as materialized (
    select candidates.*,
      coalesce(number !~ '^[A-Z]+-[0-9]{4}-[0-9]+$', true) as number_unmatched,
      substring(number from '^([A-Z]+)-[0-9]{4}-[0-9]+$') as number_prefix,
      substring(number from '^[A-Z]+-([0-9]{4})-[0-9]+$')::integer as number_year,
      substring(number from '^[A-Z]+-[0-9]{4}-([0-9]+)$')::numeric as number_sequence
    from candidates
    where coalesce(p_search, '') = ''
      or strpos(lower(concat_ws(' ', number, title)), lower(p_search)) > 0
  ), choices as (
    select * from matching
    order by number_unmatched, number_prefix, number_year, number_sequence, number, id
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
  ) select coalesce(jsonb_agg(
    jsonb_build_object('id', id, 'number', number, 'title', title)
    order by number_unmatched, number_prefix, number_year, number_sequence, number, id), '[]')
  from choices;
$$;
revoke all on function public.search_work_predecessor_options(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.search_work_predecessor_options(uuid, text, text, integer) to service_role;
