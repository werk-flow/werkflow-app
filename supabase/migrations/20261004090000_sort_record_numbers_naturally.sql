-- Record numbers grow past three digits (`ANL-2026-1000`), and the paged lists
-- that order by a record number compared it as text, so `ANL-2026-1000` sorted
-- between `-100` and `-101`. These readers now order a number of the form
-- `<PREFIX>-<YYYY>-<sequence>` by prefix, then year, then the numeric
-- sequence, then the text and the id. A number that does not match the form
-- (an imported or legacy number, or none) sorts after every matching number
-- in ascending order and before them in descending order, among itself by
-- text and id.
--
-- * list_equipment_page: the Anlagen list, always ascending by number.
-- * list_job_entries_page: the Aufträge list sorted by "Nr." in either
--   direction. Standalone jobs and projects keep their prefix grouping.
-- * search_planning_options: the planning job choices, ordered by their
--   label, which starts with the job number. Employees and teams keep their
--   label order.
--
-- Signatures, security invoker, the empty search_path, the service-only
-- grants and every filter, count and page bound stay unchanged.

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

create or replace function public.list_job_entries_page(
  p_organization_id uuid, p_user_id uuid, p_is_manager boolean, p_queries jsonb
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible_jobs as materialized (
    select j.* from public.jobs j where j.organization_id = p_organization_id
      and (p_is_manager or exists(select 1 from public.job_assignments a where a.organization_id = p_organization_id and a.job_id = j.id and a.user_id = p_user_id))
  ), project_counts as materialized (
    select j.project_id, count(*) total,
      count(*) filter(where j.status = 'fertig') completed,
      count(*) filter(where j.status = 'in_bearbeitung') in_progress,
      count(*) filter(where j.status = 'geparkt') parked
    from visible_jobs j where j.project_id is not null group by j.project_id
  ), project_rows as (
    select p.*, coalesce(c.total,0) total, coalesce(c.completed,0) completed,
      coalesce(c.in_progress,0) in_progress, coalesce(c.parked,0) parked,
      coalesce(p.status_override::text, case when coalesce(c.total,0)=0 then 'nicht_begonnen' when c.parked=c.total then 'geparkt' when c.completed=c.total then 'abgeschlossen' when c.completed>0 or c.in_progress>0 then 'in_bearbeitung' else 'nicht_begonnen' end) effective_status
    from public.projects p left join project_counts c on c.project_id=p.id
    where p.organization_id=p_organization_id and (p_is_manager or c.total>0)
  ), entries as materialized (
    select j.id, 'standalone-job'::text kind, j.client_id, j.planned_date entry_date, j.created_at entry_created_at,
      coalesce(j.job_number,'') number, coalesce(nullif(btrim(j.title),''), j.description,'') title,
      coalesce(client.name,'') client_name,
      lower(concat_ws(' ',j.title,j.job_number,j.description,j.location,client.name)) search_text,
      case when j.status='geparkt' then 'parked' else coalesce(j.execution_state::text,case j.status when 'nicht_bearbeitet' then 'not_started' when 'in_bearbeitung' then 'in_progress' else 'execution_complete' end) end unified_status,
      case j.status when 'nicht_bearbeitet' then 0 when 'in_bearbeitung' then 1 when 'fertig' then 2 else 3 end status_sort,
      case j.priority when 'niedrig' then 0 when 'mittel' then 1 else 2 end priority_sort,
      0::bigint total,0::bigint completed,0::bigint in_progress,0::bigint parked
    from visible_jobs j left join public.clients client on client.id=j.client_id and client.organization_id=p_organization_id
    where j.project_id is null
    union all
    select p.id,'project',p.client_id,p.planned_start_date,p.created_at,coalesce(p.project_number,''),coalesce(nullif(btrim(p.name),''),p.description,''),coalesce(client.name,''),
      lower(concat_ws(' ',p.name,p.project_number,p.description,client.name)),
      case when p.status_override='geparkt' then 'parked' else coalesce(p.execution_state_override::text,case p.effective_status when 'nicht_begonnen' then 'not_started' when 'in_bearbeitung' then 'in_progress' when 'geparkt' then 'parked' else 'execution_complete' end) end,
      case p.effective_status when 'nicht_begonnen' then 0 when 'in_bearbeitung' then 1 when 'abgeschlossen' then 2 else 3 end,-1,
      p.total,p.completed,p.in_progress,p.parked
    from project_rows p left join public.clients client on client.id=p.client_id and client.organization_id=p_organization_id
  ), categorized as materialized (
    select e.*,case when unified_status='parked' then 'parked' when unified_status in('execution_complete','handed_over','cancelled') then 'archived' else 'active' end section,
      e.number !~ '^[A-Z]+-[0-9]{4}-[0-9]+$' number_unmatched,
      substring(e.number from '^([A-Z]+)-[0-9]{4}-[0-9]+$') number_prefix,
      substring(e.number from '^[A-Z]+-([0-9]{4})-[0-9]+$')::integer number_year,
      substring(e.number from '^[A-Z]+-[0-9]{4}-([0-9]+)$')::numeric number_sequence
    from entries e
  ), sections as (select key section,value query from jsonb_each(p_queries)), results as (
    select sections.section, jsonb_build_object(
      'sectionTotal',(select count(*) from categorized e where e.section=sections.section),
      'statusCounts',(select jsonb_build_object('alle',count(*),'not_started',count(*) filter(where unified_status='not_started'),'in_progress',count(*) filter(where unified_status='in_progress'),'interrupted',count(*) filter(where unified_status='interrupted')) from categorized e where e.section=sections.section),
      'total',selected.matching_total,
      'entries',case when coalesce((query->>'enabled')::boolean,true) then selected.page_rows else '[]'::jsonb end
    ) result
    from sections cross join lateral (
      with matching as materialized (
        select e.* from categorized e where e.section=sections.section
          and (coalesce(query->>'status','alle')='alle' or e.unified_status=query->>'status')
          and (coalesce(query->>'entryType','alle')='alle' or (query->>'entryType'='jobs' and e.kind='standalone-job') or (query->>'entryType'='projekte' and e.kind='project'))
          and (coalesce(query->>'search','')='' or strpos(e.search_text,lower(query->>'search'))>0 or (e.kind='project' and exists(select 1 from visible_jobs j where j.project_id=e.id and strpos(lower(concat_ws(' ',j.title,j.job_number,j.description,j.location)),lower(query->>'search'))>0)))
          and (coalesce(jsonb_array_length(query->'clientIds'),0)=0 or e.client_id::text in(select jsonb_array_elements_text(query->'clientIds')) or (e.kind='project' and exists(select 1 from visible_jobs j where j.project_id=e.id and j.client_id::text in(select jsonb_array_elements_text(query->'clientIds')))))
          and (coalesce(jsonb_array_length(query->'employeeIds'),0)=0 or exists(select 1 from public.job_assignments a join visible_jobs j on j.id=a.job_id where a.organization_id=p_organization_id and a.user_id::text in(select jsonb_array_elements_text(query->'employeeIds')) and ((e.kind='standalone-job' and j.id=e.id) or (e.kind='project' and j.project_id=e.id))))
          and (e.entry_date is null or coalesce(query->>'dateFrom','')='' or e.entry_date >= (query->>'dateFrom')::date)
          and (e.entry_date is null or coalesce(query->>'dateTo','')='' or e.entry_date <= (query->>'dateTo')::date)
      ), page as (
        select * from matching order by
          case when query->>'sort'='datum' and query->>'direction'='asc' then entry_date end asc nulls last,
          case when query->>'sort'='datum' and query->>'direction'<>'asc' then entry_date end desc nulls last,
          case when query->>'sort'='nr' and query->>'direction'='asc' then number_unmatched end asc,
          case when query->>'sort'='nr' and query->>'direction'='asc' then number_prefix end asc,
          case when query->>'sort'='nr' and query->>'direction'='asc' then number_year end asc,
          case when query->>'sort'='nr' and query->>'direction'='asc' then number_sequence end asc,
          case when query->>'sort'='nr' and query->>'direction'<>'asc' then number_unmatched end desc,
          case when query->>'sort'='nr' and query->>'direction'<>'asc' then number_prefix end desc,
          case when query->>'sort'='nr' and query->>'direction'<>'asc' then number_year end desc,
          case when query->>'sort'='nr' and query->>'direction'<>'asc' then number_sequence end desc,
          case when query->>'sort' in('nr','bezeichnung','kunde') and query->>'direction'='asc' then case query->>'sort' when 'nr' then number when 'bezeichnung' then title else client_name end end collate "de-DE-x-icu" asc,
          case when query->>'sort' in('nr','bezeichnung','kunde') and query->>'direction'<>'asc' then case query->>'sort' when 'nr' then number when 'bezeichnung' then title else client_name end end collate "de-DE-x-icu" desc,
          case when query->>'sort' in('status','prioritaet') and query->>'direction'='asc' then case query->>'sort' when 'status' then status_sort else priority_sort end end asc,
          case when query->>'sort' in('status','prioritaet') and query->>'direction'<>'asc' then case query->>'sort' when 'status' then status_sort else priority_sort end end desc,
          entry_created_at desc, id
        limit least(greatest(coalesce((query->>'pageSize')::int,50),1),100)
        offset (greatest(coalesce((query->>'page')::bigint,1),1)-1)*least(greatest(coalesce((query->>'pageSize')::int,50),1),100)
      ) select (select count(*) from matching) matching_total, (select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',kind,'jobCount',total,'completedJobCount',completed,'inProgressJobCount',in_progress,'parkedJobCount',parked,'assignedUserIds',coalesce((select jsonb_agg(distinct a.user_id) from public.job_assignments a join visible_jobs j on j.id=a.job_id where a.organization_id=p_organization_id and ((page.kind='standalone-job' and j.id=page.id) or (page.kind='project' and j.project_id=page.id))), '[]'))), '[]') from page) page_rows
    ) selected
  ) select coalesce(jsonb_object_agg(section,result),'{}') from results;
$$;
revoke all on function public.list_job_entries_page(uuid,uuid,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.list_job_entries_page(uuid,uuid,boolean,jsonb) to service_role;

create or replace function public.search_planning_options(
  p_organization_id uuid,
  p_kind text,
  p_query text default '',
  p_offset integer default 0,
  p_selected_ids uuid[] default '{}',
  p_default_user_ids uuid[] default '{}'
) returns jsonb
language sql stable security invoker set search_path = ''
as $function$
  with candidates as not materialized (
    select employee.id as value,
      coalesce(nullif(btrim(concat_ws(' ',
        coalesce(nullif(btrim(profile.first_name), ''), employee.first_name),
        coalesce(nullif(btrim(profile.last_name), ''), employee.last_name))), ''),
        employee.employee_number, 'Unbenannt') as label,
      case when employee.user_id is null then 'Ohne App-Zugang' else employee.employee_number end as description,
      employee.user_id as "userId",
      (employee.exit_date is null or employee.exit_date >= (now() at time zone 'Europe/Berlin')::date) as eligible,
      null::text as record_number
    from public.employee_records employee
    left join public.profiles profile on profile.id = employee.user_id
    where p_kind = 'employees' and employee.organization_id = p_organization_id
    union all
    select job.id,
      concat_ws(' · ', nullif(job.job_number, ''),
        coalesce(nullif(btrim(job.title), ''), nullif(btrim(job.description), ''), 'Ohne Titel')),
      project.name, null::uuid, job.status <> 'fertig', job.job_number
    from public.jobs job
    left join public.projects project on project.id = job.project_id and project.organization_id = p_organization_id
    where p_kind = 'jobs' and job.organization_id = p_organization_id
    union all
    select team.id, team.name, null::text, null::uuid, team.dissolved_at is null, null::text
    from public.teams team
    where p_kind = 'teams' and team.organization_id = p_organization_id
  ), ordered as not materialized (
    select candidates.*,
      coalesce(record_number !~ '^[A-Z]+-[0-9]{4}-[0-9]+$', true) as number_unmatched,
      substring(record_number from '^([A-Z]+)-[0-9]{4}-[0-9]+$') as number_prefix,
      substring(record_number from '^[A-Z]+-([0-9]{4})-[0-9]+$')::integer as number_year,
      substring(record_number from '^[A-Z]+-[0-9]{4}-([0-9]+)$')::numeric as number_sequence
    from candidates
  ), page as materialized (
    select * from ordered
    where eligible and position(lower(btrim(p_query)) in lower(label || ' ' || coalesce(description, ''))) > 0
    order by number_unmatched, number_prefix, number_year, number_sequence, lower(label), value
    limit 51 offset greatest(p_offset, 0)
  ), choices as (
    select * from page
    order by number_unmatched, number_prefix, number_year, number_sequence, lower(label), value
    limit 50
  ), selected as (
    select * from ordered
    where value = any(p_selected_ids) or (eligible and "userId" = any(p_default_user_ids))
  )
  select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      to_jsonb(choices) - '{eligible,record_number,number_unmatched,number_prefix,number_year,number_sequence}'::text[]
      order by number_unmatched, number_prefix, number_year, number_sequence, lower(label), value) from choices), '[]'::jsonb),
    'selected', coalesce((select jsonb_agg(
      to_jsonb(selected) - '{eligible,record_number,number_unmatched,number_prefix,number_year,number_sequence}'::text[]
      order by number_unmatched, number_prefix, number_year, number_sequence, lower(label), value) from selected), '[]'::jsonb),
    'hasMore', (select count(*) > 50 from page)
  );
$function$;
revoke all on function public.search_planning_options(uuid, text, text, integer, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.search_planning_options(uuid, text, text, integer, uuid[], uuid[]) to service_role;
