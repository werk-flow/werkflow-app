-- Anlagen and Aufträge carry the number the previous system gave them
-- (werk-flow/werkflow-planning#486).
--
-- 1. installed_equipment.source_number and jobs.source_number: trimmed, 1 to
--    100 characters, like clients.source_number and client_sites.source_number
--    (20261201090001). Not unique: how the previous system numbers Aufträge
--    and Anlagen is unknown until its sample export, and a unique index could
--    refuse that import. A per-organization index on lower(source_number)
--    serves an exact lookup.
-- 2. The job save takes source_number: app_private.create_job_record and
--    update_job_with_assignments add it to the columns they accept. The
--    Server Actions trim it and send null for an empty value.
-- 3. The equipment save takes sourceNumber: create_installed_equipment writes
--    it, update_installed_equipment_details writes it when the payload names
--    it and keeps it otherwise, so a build that never sends it keeps the
--    stored number. Both record their event with the before and after
--    snapshot as before; the snapshot carries the new column.
-- 4. list_job_entries_page and list_equipment_page find a record by its
--    source number, case-insensitive, like by its own number.
--
-- Signatures, results, owners, security and grants stay as before; the rest
-- of each body is unchanged. Proven by supabase/tests/work_source_numbers.sql.

alter table public.jobs add column source_number text;
alter table public.installed_equipment add column source_number text;
-- @destructive: after release 55088f06: that build never writes source_number, so the check holds for its writes
alter table public.jobs add constraint jobs_source_number_check
  check (source_number is null or (source_number = btrim(source_number) and length(source_number) between 1 and 100))
  not valid;
-- @destructive: after release 55088f06: that build never writes source_number, so the check holds for its writes
alter table public.installed_equipment add constraint installed_equipment_source_number_check
  check (source_number is null or (source_number = btrim(source_number) and length(source_number) between 1 and 100))
  not valid;
create index jobs_source_number_lookup
  on public.jobs (organization_id, lower(source_number)) where source_number is not null;
create index installed_equipment_source_number_lookup
  on public.installed_equipment (organization_id, lower(source_number)) where source_number is not null;

create or replace function app_private.create_job_record(p_organization_id uuid, p_actor_id uuid, p_job jsonb, p_selected_user_ids uuid[], p_assessed_for_date date, p_selected_employee_record_ids uuid[], p_requirements_snapshot jsonb, p_coverage_snapshot jsonb, p_coverage_fingerprint text, p_override_reason text, p_team_source_id uuid, p_record_assessment boolean, p_template_version_id uuid, p_template_assessment boolean)
 RETURNS jobs
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_fields public.jobs;
  v_project public.projects;
  v_job public.jobs;
begin
  perform app_private.work_edit_assignments(p_job, array[
    'title', 'description', 'project_id', 'client_id', 'site_id', 'contact_id', 'job_number',
    'priority', 'planned_date', 'planned_time', 'estimated_duration_minutes',
    'planned_working_minutes', 'location', 'source_number'
  ]);
  v_fields := jsonb_populate_record(null::public.jobs, p_job);

  if coalesce(btrim(v_fields.title), '') = '' and coalesce(btrim(v_fields.description), '') = '' then
    raise exception 'title_or_description_required';
  end if;
  if coalesce(btrim(v_fields.job_number), '') = '' then
    raise exception 'job_number_required';
  end if;

  -- Job numbers have no unique index: one creation per organization checks
  -- and takes a number at a time.
  perform pg_advisory_xact_lock(hashtextextended('job_number:' || p_organization_id::text, 0));
  if exists (
    select 1 from public.jobs job
    where job.organization_id = p_organization_id and job.job_number = v_fields.job_number
  ) then
    raise exception 'job_number_taken';
  end if;

  -- A project job belongs to the project's customer and inherits the
  -- project's site and contact unless p_job names its own (null clears). The
  -- lock holds the customer until commit against a concurrent project edit.
  if v_fields.project_id is not null then
    select * into v_project from public.projects project
    where project.organization_id = p_organization_id and project.id = v_fields.project_id
    for share;
    if not found then raise exception 'project_not_found'; end if;
    v_fields.client_id := v_project.client_id;
    if not p_job ? 'site_id' then v_fields.site_id := v_project.site_id; end if;
    if not p_job ? 'contact_id' then v_fields.contact_id := v_project.contact_id; end if;
  end if;
  perform app_private.assert_work_customer_references(
    p_organization_id, v_fields.client_id, v_fields.site_id, v_fields.contact_id
  );

  insert into public.jobs (
    organization_id, project_id, client_id, site_id, contact_id, job_number, title, description,
    status, priority, planned_date, planned_time, estimated_duration_minutes,
    planned_working_minutes, location, source_number, created_by
  ) values (
    p_organization_id, v_fields.project_id, v_fields.client_id, v_fields.site_id,
    v_fields.contact_id, v_fields.job_number, coalesce(v_fields.title, ''), v_fields.description,
    'nicht_bearbeitet', coalesce(v_fields.priority, 'mittel'), v_fields.planned_date,
    v_fields.planned_time, v_fields.estimated_duration_minutes, v_fields.planned_working_minutes,
    v_fields.location, v_fields.source_number, p_actor_id
  )
  returning * into v_job;

  if coalesce(cardinality(p_selected_user_ids), 0) > 0 then
    begin
      perform public.replace_job_assignments_with_assessment(
        p_organization_id, v_job.id, p_selected_user_ids, p_actor_id, p_assessed_for_date,
        p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
        p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment
      );
    exception when others then
      raise exception 'assign_failed' using detail = sqlerrm;
    end;
  end if;

  if p_template_version_id is not null then
    perform app_private.apply_template_to_new_work(
      p_organization_id, p_actor_id, p_template_version_id, v_job.id, null,
      p_template_assessment, p_assessed_for_date, p_selected_user_ids,
      p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
      p_coverage_fingerprint, p_override_reason, p_team_source_id
    );
  end if;

  return v_job;
end;
$function$;

create or replace function public.update_job_with_assignments(p_organization_id uuid, p_job_id uuid, p_actor_id uuid, p_changes jsonb, p_replace_assignments boolean, p_selected_user_ids uuid[], p_assessed_for_date date, p_selected_employee_record_ids uuid[], p_requirements_snapshot jsonb, p_coverage_snapshot jsonb, p_coverage_fingerprint text, p_override_reason text, p_team_source_id uuid, p_record_assessment boolean)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_assignments text := app_private.work_edit_assignments(p_changes, array[
    'title', 'description', 'project_id', 'client_id', 'site_id', 'contact_id', 'job_number',
    'priority', 'planned_date', 'planned_time', 'estimated_duration_minutes',
    'planned_working_minutes', 'location', 'source_number', 'status'
  ]);
  v_job public.jobs;
  v_previous_project_id uuid;
begin
  -- An edit only takes a parked job back into the plan; every other status
  -- change has its own workflow.
  if p_changes ? 'status' and p_changes ->> 'status' is distinct from 'nicht_bearbeitet' then
    raise exception 'invalid_input';
  end if;
  if v_assignments is null and not coalesce(p_replace_assignments, false) then
    raise exception 'invalid_input';
  end if;

  select * into v_job from public.jobs job
  where job.organization_id = p_organization_id and job.id = p_job_id
  for no key update;
  if not found then raise exception 'job_not_found'; end if;
  v_previous_project_id := v_job.project_id;

  -- A new number waits for the creations and edits that check and take one
  -- (app_private.create_job_record takes the same lock); the check below runs
  -- after it.
  if p_changes ? 'job_number' and p_changes ->> 'job_number' is distinct from v_job.job_number then
    perform pg_advisory_xact_lock(hashtextextended('job_number:' || p_organization_id::text, 0));
  end if;

  if v_assignments is not null then
    execute format(
      'update public.jobs job set %s
       from jsonb_populate_record(null::public.jobs, $1) changes
       where job.organization_id = $2 and job.id = $3
       returning job.*',
      v_assignments
    ) into v_job using p_changes, p_organization_id, p_job_id;

    if btrim(v_job.title) = '' and coalesce(btrim(v_job.description), '') = '' then
      raise exception 'title_or_description_required';
    end if;
    if v_job.project_id is not null and p_changes ? 'project_id' and not exists (
      select 1 from public.projects project
      where project.organization_id = p_organization_id and project.id = v_job.project_id
    ) then
      raise exception 'project_not_found';
    end if;
    if p_changes ? 'job_number' and v_job.job_number is not null and exists (
      select 1 from public.jobs other
      where other.organization_id = p_organization_id
        and other.job_number = v_job.job_number
        and other.id <> p_job_id
    ) then
      raise exception 'job_number_taken';
    end if;
    if p_changes ?| array['project_id', 'client_id', 'site_id', 'contact_id'] then
      perform app_private.assert_work_customer_references(
        p_organization_id, v_job.client_id, v_job.site_id, v_job.contact_id
      );
    end if;
    -- Every function that adds a line to a job locks the job row first, so
    -- this update reaches every line of the job.
    if v_job.project_id is distinct from v_previous_project_id then
      update public.job_material_lines line
      set project_id = v_job.project_id
      where line.organization_id = p_organization_id and line.job_id = p_job_id;
    end if;
  end if;

  if coalesce(p_replace_assignments, false) then
    perform public.replace_job_assignments_with_assessment(
      p_organization_id, p_job_id, p_selected_user_ids, p_actor_id, p_assessed_for_date,
      p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
      p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment
    );
  end if;

  return v_job;
end;
$function$;

create or replace function public.create_installed_equipment(p_organization_id uuid, p_equipment_id uuid, p_payload jsonb, p_actor_id uuid, p_idempotency_key uuid)
 RETURNS installed_equipment
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing_equipment_id uuid;
  v_equipment public.installed_equipment%rowtype;
  v_state public.installed_equipment_state;
  v_category public.installed_equipment_category;
  v_subtype public.installed_equipment_subtype;
  v_client_id uuid := (p_payload->>'clientId')::uuid;
  v_site_id uuid := (p_payload->>'siteId')::uuid;
  v_parent_id uuid := nullif(p_payload->>'parentEquipmentId', '')::uuid;
  v_effective_at timestamptz := coalesce(
    nullif(p_payload->>'effectiveAt', '')::timestamptz, now()
  );
  v_snapshot jsonb;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);

  select event.equipment_id into v_existing_equipment_id
  from public.installed_equipment_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'create'
    and event.idempotency_key = p_idempotency_key
  order by event.recorded_at
  limit 1;
  if found then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = v_existing_equipment_id
      and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;

  begin
    v_state := (p_payload->>'state')::public.installed_equipment_state;
    v_category := (p_payload->>'category')::public.installed_equipment_category;
    v_subtype := nullif(p_payload->>'subtype', '')::public.installed_equipment_subtype;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'installed_equipment_classification_invalid';
  end;
  if v_state not in ('unknown', 'active', 'inactive') then
    raise exception 'installed_equipment_initial_state_invalid';
  end if;

  if not exists (
    select 1 from public.client_sites site
    where site.id = v_site_id
      and site.client_id = v_client_id
      and site.organization_id = p_organization_id
      and site.is_active
  ) then raise exception 'installed_equipment_site_invalid'; end if;

  perform set_config('app.installed_equipment_write', 'true', true);
  insert into public.installed_equipment (
    id, organization_id, client_id, site_id, parent_equipment_id,
    equipment_number, name, category, subtype, manufacturer, model,
    location_detail, technical_notes, source_number, state, installation_date,
    commissioning_date, warranty_provider, warranty_basis,
    warranty_start_date, warranty_end_date, created_by, updated_by
  ) values (
    p_equipment_id, p_organization_id, v_client_id, v_site_id, v_parent_id,
    app_private.next_installed_equipment_number(p_organization_id),
    btrim(p_payload->>'name'), v_category, v_subtype,
    nullif(btrim(p_payload->>'manufacturer'), ''),
    nullif(btrim(p_payload->>'model'), ''),
    nullif(btrim(p_payload->>'locationDetail'), ''),
    nullif(btrim(p_payload->>'technicalNotes'), ''),
    nullif(btrim(p_payload->>'sourceNumber'), ''),
    v_state,
    nullif(p_payload->>'installationDate', '')::date,
    nullif(p_payload->>'commissioningDate', '')::date,
    nullif(btrim(p_payload->>'warrantyProvider'), ''),
    nullif(btrim(p_payload->>'warrantyBasis'), ''),
    nullif(p_payload->>'warrantyStartDate', '')::date,
    nullif(p_payload->>'warrantyEndDate', '')::date,
    p_actor_id, p_actor_id
  ) returning * into v_equipment;

  perform app_private.sync_installed_equipment_identifiers(
    p_equipment_id, p_organization_id, p_actor_id, p_payload->'identifiers'
  );
  perform set_config('app.installed_equipment_write', 'false', true);
  v_snapshot := app_private.installed_equipment_snapshot(
    p_equipment_id, p_organization_id
  );
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, 'registered', null, v_state,
    v_effective_at, p_actor_id, nullif(btrim(p_payload->>'reason'), ''),
    'create', p_idempotency_key, null, null, v_snapshot
  );
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$function$;

create or replace function public.update_installed_equipment_details(p_organization_id uuid, p_equipment_id uuid, p_expected_version bigint, p_payload jsonb, p_actor_id uuid, p_idempotency_key uuid)
 RETURNS installed_equipment
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_equipment public.installed_equipment%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_category public.installed_equipment_category;
  v_subtype public.installed_equipment_subtype;
  v_event_type public.installed_equipment_event_type :=
    'details_corrected'::public.installed_equipment_event_type;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_equipment_id
      and event.request_operation = 'update_details'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;

  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id
    and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_equipment.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_equipment.archived_at is not null then raise exception 'installed_equipment_archived'; end if;
  if v_equipment.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;
  if length(btrim(coalesce(p_payload->>'reason', ''))) not between 3 and 1000 then
    raise exception 'installed_equipment_reason_required';
  end if;

  begin
    v_category := (p_payload->>'category')::public.installed_equipment_category;
    v_subtype := nullif(p_payload->>'subtype', '')::public.installed_equipment_subtype;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'installed_equipment_classification_invalid';
  end;

  v_before := app_private.installed_equipment_snapshot(
    p_equipment_id, p_organization_id
  );
  if v_equipment.installation_date is distinct from nullif(p_payload->>'installationDate', '')::date then
    v_event_type := 'installation_recorded';
  elsif v_equipment.commissioning_date is distinct from nullif(p_payload->>'commissioningDate', '')::date then
    v_event_type := 'commissioning_recorded';
  elsif v_equipment.warranty_provider is distinct from nullif(btrim(p_payload->>'warrantyProvider'), '')
     or v_equipment.warranty_basis is distinct from nullif(btrim(p_payload->>'warrantyBasis'), '')
     or v_equipment.warranty_start_date is distinct from nullif(p_payload->>'warrantyStartDate', '')::date
     or v_equipment.warranty_end_date is distinct from nullif(p_payload->>'warrantyEndDate', '')::date then
    v_event_type := 'warranty_recorded';
  end if;

  perform set_config('app.installed_equipment_write', 'true', true);
  update public.installed_equipment equipment set
    name = btrim(p_payload->>'name'),
    category = v_category,
    subtype = v_subtype,
    manufacturer = nullif(btrim(p_payload->>'manufacturer'), ''),
    model = nullif(btrim(p_payload->>'model'), ''),
    location_detail = nullif(btrim(p_payload->>'locationDetail'), ''),
    technical_notes = nullif(btrim(p_payload->>'technicalNotes'), ''),
    source_number = case when p_payload ? 'sourceNumber'
      then nullif(btrim(p_payload->>'sourceNumber'), '') else equipment.source_number end,
    installation_date = nullif(p_payload->>'installationDate', '')::date,
    commissioning_date = nullif(p_payload->>'commissioningDate', '')::date,
    warranty_provider = nullif(btrim(p_payload->>'warrantyProvider'), ''),
    warranty_basis = nullif(btrim(p_payload->>'warrantyBasis'), ''),
    warranty_start_date = nullif(p_payload->>'warrantyStartDate', '')::date,
    warranty_end_date = nullif(p_payload->>'warrantyEndDate', '')::date,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where equipment.id = p_equipment_id
    and equipment.organization_id = p_organization_id;

  perform app_private.sync_installed_equipment_identifiers(
    p_equipment_id, p_organization_id, p_actor_id, p_payload->'identifiers'
  );
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(
    p_equipment_id, p_organization_id
  );
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, v_event_type,
    v_equipment.state, v_equipment.state,
    coalesce(nullif(p_payload->>'effectiveAt', '')::timestamptz, now()),
    p_actor_id, p_payload->>'reason', 'update_details', p_idempotency_key,
    null, v_before, v_after
  );
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$function$;

create or replace function public.list_equipment_page(p_organization_id uuid, p_search text DEFAULT ''::text, p_category text DEFAULT 'all'::text, p_include_archived boolean DEFAULT false, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
          equipment.equipment_number, equipment.source_number, equipment.name, equipment.manufacturer, equipment.model,
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
$function$;

create or replace function public.list_job_entries_page(p_organization_id uuid, p_user_id uuid, p_is_manager boolean, p_queries jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
      lower(concat_ws(' ',j.title,j.job_number,j.source_number,j.description,j.location,client.name)) search_text,
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
          and (coalesce(query->>'search','')='' or strpos(e.search_text,lower(query->>'search'))>0 or (e.kind='project' and exists(select 1 from visible_jobs j where j.project_id=e.id and strpos(lower(concat_ws(' ',j.title,j.job_number,j.source_number,j.description,j.location)),lower(query->>'search'))>0)))
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
$function$;
