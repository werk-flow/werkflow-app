-- One bounded page of each list of the maintenance workspace: open due work,
-- plans and coverages. All three grow with the organization's customer base,
-- so the search, the counts and the page boundary apply here, and the
-- workspace's tab counts are these totals, not the length of a loaded page.
-- Service-role only: the caller resolves the organization and the manager
-- role first. Every joined row comes from the same organization.
--
-- * Due work: open or visit created, due on or before p_due_through (the
--   18-month horizon the caller computes in Berlin time), of a plan with a
--   current revision. Earliest due date first.
-- * Plans: every plan with a current revision, archived ones included. The
--   newest change first.
-- * Coverages: every coverage. The newest change first.
--
-- The search matches a plan by number, customer, site, template name and its
-- active equipment; due work by its plan's number, customer, site and
-- equipment and by its visit job number; a coverage by number, reference,
-- customer and site. Each order ends with the id.
create function public.list_maintenance_workspace_page(
  p_organization_id uuid,
  p_due_through date,
  p_search text default '',
  p_due_page integer default 1,
  p_plan_page integer default 1,
  p_coverage_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with settings as (
    select least(greatest(coalesce(p_page_size, 50), 1), 100) as size, lower(coalesce(p_search, '')) as needle
  ), plans as materialized (
    select plan.id, plan.updated_at,
      lower(concat_ws(' ',
        plan.plan_number, client.name, site.name,
        (select string_agg(concat_ws(' ', equipment.equipment_number, equipment.name), ' ')
          from public.maintenance_plan_revision_equipment link
          join public.installed_equipment equipment
            on equipment.id = link.equipment_id and equipment.organization_id = p_organization_id
          where link.organization_id = p_organization_id
            and link.maintenance_plan_revision_id = revision.id
            and equipment.archived_at is null and equipment.voided_at is null)
      )) as base_text,
      lower(coalesce(version.name, '')) as template_text
    from public.maintenance_plans plan
    join public.maintenance_plan_revisions revision
      on revision.id = plan.current_revision_id and revision.organization_id = p_organization_id
    left join public.work_template_versions version
      on version.id = revision.template_version_id and version.organization_id = p_organization_id
    left join public.clients client on client.id = plan.client_id and client.organization_id = p_organization_id
    left join public.client_sites site on site.id = plan.site_id and site.organization_id = p_organization_id
    where plan.organization_id = p_organization_id
  ), due as materialized (
    select due.id, due.due_date, concat_ws(' ', plans.base_text, lower(job.job_number)) as search_text
    from public.maintenance_due_work due
    join plans on plans.id = due.maintenance_plan_id
    left join public.jobs job on job.id = due.job_id and job.organization_id = p_organization_id
    where due.organization_id = p_organization_id
      and due.status in ('open', 'visit_created')
      and due.due_date <= p_due_through
  ), coverages as materialized (
    select coverage.id, coverage.updated_at,
      lower(concat_ws(' ', coverage.coverage_number, coverage.reference, client.name, site.name)) as search_text
    from public.maintenance_coverages coverage
    left join public.clients client on client.id = coverage.client_id and client.organization_id = p_organization_id
    left join public.client_sites site on site.id = coverage.site_id and site.organization_id = p_organization_id
    where coverage.organization_id = p_organization_id
  ), matching_due as materialized (
    select due.* from due, settings
    where settings.needle = '' or strpos(due.search_text, settings.needle) > 0
  ), matching_plans as materialized (
    select plans.* from plans, settings
    where settings.needle = '' or strpos(concat_ws(' ', plans.base_text, plans.template_text), settings.needle) > 0
  ), matching_coverages as materialized (
    select coverages.* from coverages, settings
    where settings.needle = '' or strpos(coverages.search_text, settings.needle) > 0
  ), due_page as (
    select matching_due.* from matching_due, settings
    order by matching_due.due_date, matching_due.id
    limit (select size from settings)
    offset (greatest(coalesce(p_due_page, 1), 1)::bigint - 1) * (select size from settings)
  ), plan_page as (
    select matching_plans.* from matching_plans
    order by matching_plans.updated_at desc, matching_plans.id
    limit (select size from settings)
    offset (greatest(coalesce(p_plan_page, 1), 1)::bigint - 1) * (select size from settings)
  ), coverage_page as (
    select matching_coverages.* from matching_coverages
    order by matching_coverages.updated_at desc, matching_coverages.id
    limit (select size from settings)
    offset (greatest(coalesce(p_coverage_page, 1), 1)::bigint - 1) * (select size from settings)
  ) select jsonb_build_object(
    'due', jsonb_build_object(
      'total', (select count(*) from matching_due),
      'hasAny', exists (select 1 from due),
      'ids', coalesce((select jsonb_agg(due_page.id order by due_page.due_date, due_page.id) from due_page), '[]')
    ),
    'plans', jsonb_build_object(
      'total', (select count(*) from matching_plans),
      'hasAny', exists (select 1 from plans),
      'ids', coalesce((select jsonb_agg(plan_page.id order by plan_page.updated_at desc, plan_page.id) from plan_page), '[]')
    ),
    'coverages', jsonb_build_object(
      'total', (select count(*) from matching_coverages),
      'hasAny', exists (select 1 from coverages),
      'ids', coalesce((select jsonb_agg(coverage_page.id order by coverage_page.updated_at desc, coverage_page.id) from coverage_page), '[]')
    )
  );
$$;
revoke all on function public.list_maintenance_workspace_page(uuid, date, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.list_maintenance_workspace_page(uuid, date, text, integer, integer, integer, integer) to service_role;
