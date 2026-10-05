-- One bounded page of the request list. Status scope, search and the count
-- apply before the page boundary; the newest request comes first. The function
-- is service-role only: the caller resolves the current organization and the
-- manager role first. The labels of related rows come from the same
-- organization, so a foreign id in a request row names nothing.
create function public.list_request_page(
  p_organization_id uuid,
  p_status text default 'aktiv',
  p_search text default '',
  p_categories text[] default '{}',
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select r.id, r.received_at, r.client_id, r.assigned_to, r.converted_job_id, r.converted_project_id
    from public.client_requests r
    where r.organization_id = p_organization_id
      and case coalesce(p_status, 'aktiv')
        when 'alle' then true
        when 'aktiv' then r.status::text in ('offen', 'in_klaerung')
        else r.status::text = p_status
      end
      and (
        coalesce(p_search, '') = ''
        or r.category::text = any(coalesce(p_categories, '{}'))
        or strpos(lower(concat_ws(' ', r.summary, r.details, r.request_number, r.caller_name, r.caller_phone, r.caller_email)), lower(p_search)) > 0
        or exists (
          select 1 from public.clients client
          where client.organization_id = p_organization_id and client.id = r.client_id
            and strpos(lower(client.name), lower(p_search)) > 0
        )
        or exists (
          select 1 from public.profiles assignee
          where assignee.id = r.assigned_to
            and strpos(lower(concat_ws(' ', assignee.first_name, assignee.last_name, assignee.email)), lower(p_search)) > 0
        )
      )
  ), page as (
    select * from matching order by received_at desc, id
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'hasAny', exists (select 1 from public.client_requests r where r.organization_id = p_organization_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'clientName', client.name,
        'assigneeFirstName', assignee.first_name,
        'assigneeLastName', assignee.last_name,
        'assigneeEmail', assignee.email,
        'hasAssignee', assignee.id is not null,
        'jobNumber', job.job_number,
        'jobTitle', job.title,
        'projectNumber', project.project_number,
        'projectName', project.name
      ) order by page.received_at desc, page.id)
      from page
      left join public.clients client
        on client.id = page.client_id and client.organization_id = p_organization_id
      left join public.profiles assignee on assignee.id = page.assigned_to
      left join public.jobs job
        on job.id = page.converted_job_id and job.organization_id = p_organization_id
      left join public.projects project
        on project.id = page.converted_project_id and project.organization_id = p_organization_id
    ), '[]')
  );
$$;
revoke all on function public.list_request_page(uuid, text, text, text[], integer, integer) from public, anon, authenticated;
grant execute on function public.list_request_page(uuid, text, text, text[], integer, integer) to service_role;
