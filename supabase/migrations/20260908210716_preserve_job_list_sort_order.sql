-- Keep the existing newest-created-first tie order before selecting a page.
-- The final identity tiebreaker makes equal timestamps deterministic.
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
    select e.*,case when unified_status='parked' then 'parked' when unified_status in('execution_complete','handed_over','cancelled') then 'archived' else 'active' end section from entries e
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

