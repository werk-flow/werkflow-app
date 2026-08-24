create type public.work_artifact_action_type as enum (
  'review_requested', 'review_withdrawn', 'internal_approved', 'internal_rejected',
  'correction_requested', 'customer_acknowledged', 'customer_refused',
  'customer_reserved', 'signature_captured', 'exported', 'voided'
);

create table public.work_artifact_actions (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  artifact_id uuid not null,
  revision_id uuid not null,
  action_type public.work_artifact_action_type not null,
  reason text,
  comment text,
  responsibility_snapshot jsonb,
  signer_name text,
  signer_role text,
  signer_relationship text,
  signer_company_context text,
  capture_method text,
  wording_snapshot text,
  witness_context text,
  signature_document_id uuid references public.documents(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_artifact_actions_artifact_fkey foreign key (artifact_id, organization_id)
    references public.work_artifacts(id, organization_id) on delete cascade,
  constraint work_artifact_actions_revision_fkey foreign key (revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete cascade,
  constraint work_artifact_actions_reason_check check (
    action_type not in ('internal_rejected', 'correction_requested', 'customer_refused', 'customer_reserved', 'voided')
    or length(btrim(reason)) between 3 and 2000
  ),
  constraint work_artifact_actions_customer_context_check check (
    action_type not in ('customer_acknowledged', 'customer_refused', 'customer_reserved', 'signature_captured')
    or (
      length(btrim(signer_name)) between 2 and 200
      and length(btrim(signer_relationship)) between 1 and 200
      and length(btrim(capture_method)) between 1 and 100
      and length(btrim(wording_snapshot)) between 3 and 5000
    )
  ),
  constraint work_artifact_actions_signature_document_check check (
    signature_document_id is null or action_type = 'signature_captured'
  )
);

create table public.job_instruction_item_evidence_fulfillments (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  evidence_requirement_id uuid not null references public.job_instruction_item_evidence_requirements(id) on delete cascade,
  document_id uuid references public.documents(id) on delete restrict,
  artifact_revision_id uuid,
  note text,
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null,
  removal_reason text,
  constraint job_instruction_evidence_fulfillments_revision_fkey
    foreign key (artifact_revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete restrict,
  constraint job_instruction_evidence_fulfillments_one_evidence_check check (
    (document_id is not null)::integer + (artifact_revision_id is not null)::integer = 1
  ),
  constraint job_instruction_evidence_fulfillments_removal_check check (
    (removed_at is null and removed_by is null and removal_reason is null)
    or (removed_at is not null and removed_by is not null
      and length(btrim(removal_reason)) between 3 and 1000)
  )
);

create unique index job_instruction_evidence_one_active_idx
  on public.job_instruction_item_evidence_fulfillments(evidence_requirement_id)
  where removed_at is null;
create index work_artifact_actions_artifact_idx
  on public.work_artifact_actions(artifact_id, created_at, id);
create index work_artifact_actions_revision_idx
  on public.work_artifact_actions(revision_id, created_at, id);
create index work_artifact_actions_org_type_idx
  on public.work_artifact_actions(organization_id, action_type, created_at desc);
create index work_artifact_actions_created_by_idx on public.work_artifact_actions(created_by);
create index work_artifact_actions_signature_document_idx
  on public.work_artifact_actions(signature_document_id) where signature_document_id is not null;
create index job_instruction_evidence_fulfillments_org_idx
  on public.job_instruction_item_evidence_fulfillments(organization_id);
create index job_instruction_evidence_fulfillments_document_idx
  on public.job_instruction_item_evidence_fulfillments(document_id) where document_id is not null;
create index job_instruction_evidence_fulfillments_revision_idx
  on public.job_instruction_item_evidence_fulfillments(artifact_revision_id) where artifact_revision_id is not null;
create index job_instruction_evidence_fulfillments_created_by_idx
  on public.job_instruction_item_evidence_fulfillments(created_by);
create index job_instruction_evidence_fulfillments_removed_by_idx
  on public.job_instruction_item_evidence_fulfillments(removed_by) where removed_by is not null;

create or replace function app_private.work_artifact_actor_can_approve(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  with latest_configuration as (
    select configuration.id, configuration.mode
    from public.organization_responsibility_configurations configuration
    where configuration.organization_id = p_organization_id
      and configuration.responsibility = 'work_artifact_approval'
      and configuration.effective_from <= now()
    order by configuration.effective_from desc, configuration.created_at desc, configuration.id desc
    limit 1
  ), actor as (
    select member.role, employee.id as employee_record_id
    from public.organization_members member
    left join public.employee_records employee
      on employee.organization_id = member.organization_id
     and employee.user_id = member.user_id
     and employee.exit_date is null
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
  ), base_holders as (
    select actor.employee_record_id
    from actor
    left join latest_configuration configuration on true
    where actor.employee_record_id is not null and (
      (configuration.id is null and actor.role in ('admin', 'buero'))
      or (configuration.mode = 'role_default' and actor.role in ('admin', 'buero'))
      or (configuration.mode = 'selected' and exists (
        select 1 from public.organization_responsibility_assignments assignment
        where assignment.configuration_id = configuration.id
          and assignment.employee_record_id = actor.employee_record_id
      ))
    )
  ), delegated_holders as (
    select delegation.substitute_employee_record_id as employee_record_id
    from public.organization_responsibility_delegations delegation
    join actor on actor.employee_record_id = delegation.substitute_employee_record_id
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'work_artifact_approval'
      and delegation.valid_from <= (now() at time zone 'Europe/Berlin')::date
      and delegation.valid_until >= (now() at time zone 'Europe/Berlin')::date
      and (delegation.revoked_from is null
        or delegation.revoked_from > (now() at time zone 'Europe/Berlin')::date)
      and (
        exists (select 1 from base_holders holder where holder.employee_record_id = delegation.delegator_employee_record_id)
        or exists (
          select 1
          from latest_configuration configuration
          join public.organization_responsibility_assignments assignment
            on assignment.configuration_id = configuration.id
          where assignment.employee_record_id = delegation.delegator_employee_record_id
        )
      )
  )
  select exists (select 1 from base_holders)
    or exists (select 1 from delegated_holders);
$$;

create or replace function app_private.validate_work_artifact_action()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = new.revision_id and revision.organization_id = new.organization_id;
  if not found or v_revision.artifact_id <> new.artifact_id then
    raise exception 'work_artifact_action_revision_mismatch';
  end if;
  if new.signature_document_id is not null and not exists (
    select 1 from public.work_artifact_revision_documents relation
    where relation.revision_id = new.revision_id
      and relation.document_id = new.signature_document_id
      and relation.relation = 'signature_mark'
  ) then raise exception 'work_artifact_signature_document_not_linked'; end if;
  return new;
end;
$$;

create trigger work_artifact_actions_validate
before insert on public.work_artifact_actions
for each row execute function app_private.validate_work_artifact_action();
create trigger work_artifact_actions_immutable
before update or delete on public.work_artifact_actions
for each row execute function app_private.prevent_work_artifact_ledger_mutation();

create or replace function app_private.guard_instruction_evidence_fulfillment_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    raise exception 'instruction_evidence_direct_delete_forbidden';
  end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('app.instruction_evidence_write', true), '') <> 'true'
  then raise exception 'instruction_evidence_direct_write_forbidden'; end if;
  if tg_op = 'UPDATE' then perform set_config('app.instruction_evidence_write', 'false', true); end if;
  return new;
end;
$$;

create trigger job_instruction_evidence_fulfillments_guard
before update or delete on public.job_instruction_item_evidence_fulfillments
for each row execute function app_private.guard_instruction_evidence_fulfillment_write();

create or replace function app_private.validate_submitted_work_artifact_revision(
  p_revision_id uuid
)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = p_revision_id;
  if not found then raise exception 'work_artifact_revision_not_found'; end if;

  if v_revision.kind = 'site_diary'
    and (v_revision.work_date is null or nullif(btrim(v_revision.progress), '') is null)
  then raise exception 'work_artifact_site_diary_incomplete'; end if;

  if v_revision.kind = 'work_report'
    and (v_revision.visit_started_at is null or v_revision.visit_ended_at is null
      or nullif(btrim(v_revision.performed_work), '') is null)
  then raise exception 'work_artifact_work_report_incomplete'; end if;

  if v_revision.kind = 'measurement' and (
    v_revision.measurement_date is null
    or nullif(btrim(v_revision.measurement_location), '') is null
    or not exists (
      select 1 from public.work_artifact_measurement_lines line
      where line.revision_id = v_revision.id
    )
  ) then raise exception 'work_artifact_measurement_incomplete'; end if;

  if v_revision.kind = 'defect' and not exists (
    select 1 from public.work_artifact_defect_details detail
    where detail.revision_id = v_revision.id
  ) then raise exception 'work_artifact_defect_incomplete'; end if;

  if v_revision.kind = 'defect' and exists (
    select 1 from public.work_artifact_defect_details detail
    where detail.revision_id = v_revision.id and detail.state = 'resolved'
      and not exists (
        select 1 from public.work_artifact_revision_documents relation
        where relation.revision_id = v_revision.id and relation.relation = 'closure_proof'
      )
  ) then raise exception 'work_artifact_defect_closure_proof_required'; end if;

  if v_revision.kind = 'change_work' and not exists (
    select 1 from public.work_artifact_change_details detail
    where detail.revision_id = v_revision.id
  ) then raise exception 'work_artifact_change_incomplete'; end if;
end;
$$;

create or replace function public.create_work_artifact_revision(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_expected_version bigint,
  p_job_id uuid,
  p_project_id uuid,
  p_kind public.work_artifact_kind,
  p_visibility public.work_artifact_visibility,
  p_captured_at timestamptz,
  p_title text,
  p_content jsonb,
  p_corrects_revision_id uuid,
  p_correction_reason text,
  p_submit boolean,
  p_submit_action_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing_revision public.work_artifact_revisions%rowtype;
  v_revision_number integer;
  v_resulting_version bigint;
  v_line jsonb;
  v_line_number integer := 0;
begin
  select * into v_existing_revision from public.work_artifact_revisions revision
  where revision.id = p_revision_id;
  if found then
    if v_existing_revision.artifact_id <> p_artifact_id
      or v_existing_revision.organization_id <> p_organization_id then
      raise exception 'work_artifact_revision_idempotency_conflict';
    end if;
    select * into v_artifact from public.work_artifacts artifact where artifact.id = p_artifact_id;
    return jsonb_build_object(
      'artifactId', p_artifact_id, 'revisionId', p_revision_id,
      'revisionNumber', v_existing_revision.revision_number,
      'version', v_artifact.version, 'status', v_artifact.status, 'duplicate', true
    );
  end if;

  if not app_private.can_access_work_artifact_target(
    p_organization_id, p_job_id, p_project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id for update;

  if not found then
    if p_expected_version is not null and p_expected_version <> 0 then
      raise exception 'work_artifact_stale_version';
    end if;
    insert into public.work_artifacts (
      id, organization_id, job_id, project_id, kind, status, version, created_by
    ) values (
      p_artifact_id, p_organization_id, p_job_id, p_project_id, p_kind,
      case when p_submit then 'submitted'::public.work_artifact_status
        else 'draft'::public.work_artifact_status end, 1, p_actor_id
    ) returning * into v_artifact;
    v_revision_number := 1;
    v_resulting_version := 1;
  else
    if v_artifact.organization_id <> p_organization_id
      or v_artifact.job_id is distinct from p_job_id
      or v_artifact.project_id is distinct from p_project_id
      or v_artifact.kind <> p_kind then
      raise exception 'work_artifact_identity_mismatch';
    end if;
    if v_artifact.status = 'voided' then raise exception 'work_artifact_is_voided'; end if;
    if v_artifact.version is distinct from p_expected_version then
      raise exception 'work_artifact_stale_version';
    end if;
    if v_artifact.current_revision_id is not null
      and (v_artifact.status <> 'draft' or exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = v_artifact.current_revision_id
      ))
      and (p_corrects_revision_id is distinct from v_artifact.current_revision_id
        or length(btrim(p_correction_reason)) < 3)
    then raise exception 'work_artifact_correction_reason_required'; end if;

    select coalesce(max(revision.revision_number), 0) + 1 into v_revision_number
    from public.work_artifact_revisions revision
    where revision.artifact_id = p_artifact_id;
    v_resulting_version := v_artifact.version + 1;
  end if;

  insert into public.work_artifact_revisions (
    id, organization_id, artifact_id, revision_number, kind, visibility,
    captured_at, site_id, instruction_item_id, title, summary, customer_statement,
    corrects_revision_id, correction_reason, requires_customer_response,
    requires_signature, work_date, progress, people_present, weather_conditions,
    site_conditions, deliveries, impediments, decisions, notable_events,
    visit_started_at, visit_ended_at, performed_work, outstanding_work,
    materials_summary, next_visit_at, measurement_date, measurement_location,
    measurement_notes, created_by
  ) values (
    p_revision_id, p_organization_id, p_artifact_id, v_revision_number, p_kind,
    p_visibility, p_captured_at,
    nullif(p_content->>'siteId', '')::uuid,
    nullif(p_content->>'instructionItemId', '')::uuid,
    btrim(p_title), nullif(btrim(p_content->>'summary'), ''),
    nullif(btrim(p_content->>'customerStatement'), ''), p_corrects_revision_id,
    nullif(btrim(p_correction_reason), ''),
    coalesce((p_content->>'requiresCustomerResponse')::boolean, false),
    coalesce((p_content->>'requiresSignature')::boolean, false),
    nullif(p_content->>'workDate', '')::date,
    nullif(btrim(p_content->>'progress'), ''),
    nullif(btrim(p_content->>'peoplePresent'), ''),
    nullif(btrim(p_content->>'weatherConditions'), ''),
    nullif(btrim(p_content->>'siteConditions'), ''),
    nullif(btrim(p_content->>'deliveries'), ''),
    nullif(btrim(p_content->>'impediments'), ''),
    nullif(btrim(p_content->>'decisions'), ''),
    nullif(btrim(p_content->>'notableEvents'), ''),
    nullif(p_content->>'visitStartedAt', '')::timestamptz,
    nullif(p_content->>'visitEndedAt', '')::timestamptz,
    nullif(btrim(p_content->>'performedWork'), ''),
    nullif(btrim(p_content->>'outstandingWork'), ''),
    nullif(btrim(p_content->>'materialsSummary'), ''),
    nullif(p_content->>'nextVisitAt', '')::timestamptz,
    nullif(p_content->>'measurementDate', '')::date,
    nullif(btrim(p_content->>'measurementLocation'), ''),
    nullif(btrim(p_content->>'measurementNotes'), ''), p_actor_id
  );

  if p_kind = 'measurement' then
    for v_line in select value from jsonb_array_elements(coalesce(p_content->'measurementLines', '[]'::jsonb))
    loop
      v_line_number := v_line_number + 1;
      insert into public.work_artifact_measurement_lines (
        id, organization_id, revision_id, line_number, description, location,
        quantity, unit, note
      ) values (
        coalesce(nullif(v_line->>'id', '')::uuid, gen_random_uuid()),
        p_organization_id, p_revision_id, v_line_number,
        btrim(v_line->>'description'), nullif(btrim(v_line->>'location'), ''),
        (v_line->>'quantity')::numeric(14,3),
        (v_line->>'unit')::public.work_artifact_measurement_unit,
        nullif(btrim(v_line->>'note'), '')
      );
    end loop;
  elsif p_kind = 'defect' then
    insert into public.work_artifact_defect_details (
      revision_id, organization_id, description, severity, location,
      responsible_employee_record_id, responsibility_context, due_date, state,
      proposed_resolution, resolution_summary
    ) values (
      p_revision_id, p_organization_id, btrim(p_content->>'defectDescription'),
      (p_content->>'defectSeverity')::public.work_artifact_defect_severity,
      btrim(p_content->>'defectLocation'),
      nullif(p_content->>'responsibleEmployeeRecordId', '')::uuid,
      nullif(btrim(p_content->>'responsibilityContext'), ''),
      nullif(p_content->>'dueDate', '')::date,
      coalesce(nullif(p_content->>'defectState', '')::public.work_artifact_defect_state, 'open'),
      nullif(btrim(p_content->>'proposedResolution'), ''),
      nullif(btrim(p_content->>'resolutionSummary'), '')
    );
  elsif p_kind = 'change_work' then
    insert into public.work_artifact_change_details (
      revision_id, organization_id, change_description, change_reason,
      requested_by_context, expected_labor_minutes, actual_labor_minutes,
      expected_material_summary, actual_material_summary, authorization_state,
      schedule_impact
    ) values (
      p_revision_id, p_organization_id, btrim(p_content->>'changeDescription'),
      btrim(p_content->>'changeReason'), btrim(p_content->>'requestedByContext'),
      nullif(p_content->>'expectedLaborMinutes', '')::integer,
      nullif(p_content->>'actualLaborMinutes', '')::integer,
      nullif(btrim(p_content->>'expectedMaterialSummary'), ''),
      nullif(btrim(p_content->>'actualMaterialSummary'), ''),
      coalesce(nullif(p_content->>'authorizationState', '')::public.work_artifact_change_authorization_state, 'not_requested'),
      nullif(btrim(p_content->>'scheduleImpact'), '')
    );
  end if;

  if p_submit then perform app_private.validate_submitted_work_artifact_revision(p_revision_id); end if;

  update public.work_artifacts set
    current_revision_id = p_revision_id,
    status = case when p_submit then 'submitted'::public.work_artifact_status
      else 'draft'::public.work_artifact_status end,
    version = v_resulting_version,
    updated_at = now()
  where id = p_artifact_id;

  if p_submit then
    if p_submit_action_id is null then raise exception 'work_artifact_submit_action_id_required'; end if;
    insert into public.work_artifact_actions (
      id, organization_id, artifact_id, revision_id, action_type, created_by
    ) values (
      p_submit_action_id, p_organization_id, p_artifact_id, p_revision_id,
      'review_requested', p_actor_id
    );
  end if;

  return jsonb_build_object(
    'artifactId', p_artifact_id, 'revisionId', p_revision_id,
    'revisionNumber', v_revision_number, 'version', v_resulting_version,
    'status', case when p_submit then 'submitted'::public.work_artifact_status
      else 'draft'::public.work_artifact_status end,
    'duplicate', false
  );
end;
$$;

create or replace function public.record_work_artifact_action(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_action_id uuid,
  p_expected_version bigint,
  p_action_type public.work_artifact_action_type,
  p_reason text,
  p_comment text,
  p_responsibility_snapshot jsonb,
  p_customer_context jsonb,
  p_signature_document_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_revision public.work_artifact_revisions%rowtype;
  v_existing public.work_artifact_actions%rowtype;
  v_status public.work_artifact_status;
  v_version bigint;
begin
  select * into v_existing from public.work_artifact_actions action where action.id = p_action_id;
  if found then
    if v_existing.artifact_id <> p_artifact_id or v_existing.revision_id <> p_revision_id
      or v_existing.action_type <> p_action_type then
      raise exception 'work_artifact_action_idempotency_conflict';
    end if;
    select * into v_artifact from public.work_artifacts artifact where artifact.id = p_artifact_id;
    return jsonb_build_object('actionId', p_action_id, 'version', v_artifact.version,
      'status', v_artifact.status, 'duplicate', true);
  end if;

  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided' then raise exception 'work_artifact_is_voided'; end if;
  if v_artifact.version is distinct from p_expected_version then
    raise exception 'work_artifact_stale_version';
  end if;
  if v_artifact.current_revision_id is distinct from p_revision_id then
    raise exception 'work_artifact_action_requires_current_revision';
  end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;

  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = p_revision_id and revision.artifact_id = p_artifact_id;

  if p_action_type in ('internal_approved', 'internal_rejected', 'correction_requested') then
    if v_revision.created_by = p_actor_id then raise exception 'work_artifact_self_approval_not_allowed'; end if;
    if not app_private.work_artifact_actor_can_approve(p_organization_id, p_actor_id) then
      raise exception 'work_artifact_not_responsible';
    end if;
  end if;

  if p_action_type in (
    'customer_acknowledged', 'customer_refused', 'customer_reserved', 'signature_captured'
  ) and v_revision.visibility <> 'customer_facing' then
    raise exception 'work_artifact_customer_action_requires_customer_visibility';
  end if;

  if p_action_type = 'review_requested' then
    if v_artifact.status not in ('draft', 'rejected', 'correction_requested')
    then raise exception 'work_artifact_review_state_invalid'; end if;
    perform app_private.validate_submitted_work_artifact_revision(p_revision_id);
    v_status := 'submitted';
  elsif p_action_type = 'review_withdrawn' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    if not app_private.is_work_artifact_manager(p_organization_id, p_actor_id)
      and not exists (
        select 1 from public.work_artifact_actions action
        where action.revision_id = p_revision_id and action.action_type = 'review_requested'
          and action.created_by = p_actor_id
      ) then raise exception 'work_artifact_review_withdraw_not_authorized'; end if;
    v_status := 'draft';
  elsif p_action_type = 'internal_approved' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    v_status := 'approved';
  elsif p_action_type = 'internal_rejected' then
    if v_artifact.status <> 'submitted' then raise exception 'work_artifact_review_not_pending'; end if;
    v_status := 'rejected';
  elsif p_action_type = 'correction_requested' then
    v_status := 'correction_requested';
  else
    v_status := v_artifact.status;
  end if;

  if p_action_type = 'signature_captured' then
    insert into public.work_artifact_revision_documents (
      id, organization_id, revision_id, document_id, relation, description, created_by
    ) values (
      p_action_id, p_organization_id, p_revision_id, p_signature_document_id,
      'signature_mark', 'Erfasste Unterschrift', p_actor_id
    ) on conflict (revision_id, document_id, relation) do nothing;
  end if;

  insert into public.work_artifact_actions (
    id, organization_id, artifact_id, revision_id, action_type, reason, comment,
    responsibility_snapshot, signer_name, signer_role, signer_relationship,
    signer_company_context, capture_method, wording_snapshot, witness_context,
    signature_document_id, created_by
  ) values (
    p_action_id, p_organization_id, p_artifact_id, p_revision_id, p_action_type,
    nullif(btrim(p_reason), ''), nullif(btrim(p_comment), ''), p_responsibility_snapshot,
    nullif(btrim(p_customer_context->>'signerName'), ''),
    nullif(btrim(p_customer_context->>'signerRole'), ''),
    nullif(btrim(p_customer_context->>'signerRelationship'), ''),
    nullif(btrim(p_customer_context->>'companyContext'), ''),
    nullif(btrim(p_customer_context->>'captureMethod'), ''),
    nullif(btrim(p_customer_context->>'wordingSnapshot'), ''),
    nullif(btrim(p_customer_context->>'witnessContext'), ''),
    p_signature_document_id, p_actor_id
  );

  v_version := v_artifact.version + 1;
  update public.work_artifacts set status = v_status, version = v_version, updated_at = now()
  where id = p_artifact_id;
  return jsonb_build_object('actionId', p_action_id, 'version', v_version,
    'status', v_status, 'duplicate', false);
end;
$$;

create or replace function public.void_work_artifact(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_action_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing public.work_artifact_actions%rowtype;
  v_version bigint;
begin
  select * into v_existing from public.work_artifact_actions action where action.id = p_action_id;
  if found then
    if v_existing.artifact_id <> p_artifact_id or v_existing.action_type <> 'voided'
    then raise exception 'work_artifact_action_idempotency_conflict'; end if;
    select * into v_artifact from public.work_artifacts artifact where artifact.id = p_artifact_id;
    return jsonb_build_object('actionId', p_action_id, 'version', v_artifact.version,
      'status', v_artifact.status, 'duplicate', true);
  end if;

  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.version is distinct from p_expected_version then raise exception 'work_artifact_stale_version'; end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;
  if not app_private.is_work_artifact_manager(p_organization_id, p_actor_id)
    and (v_artifact.status <> 'draft' or v_artifact.created_by <> p_actor_id
      or exists (select 1 from public.work_artifact_actions action where action.artifact_id = p_artifact_id))
  then raise exception 'work_artifact_void_not_authorized'; end if;

  v_version := v_artifact.version + 1;
  insert into public.work_artifact_actions (
    id, organization_id, artifact_id, revision_id, action_type, reason, created_by
  ) values (
    p_action_id, p_organization_id, p_artifact_id, v_artifact.current_revision_id,
    'voided', btrim(p_reason), p_actor_id
  );
  update public.work_artifacts set status = 'voided', voided_at = now(), voided_by = p_actor_id,
    void_reason = btrim(p_reason), version = v_version, updated_at = now()
  where id = p_artifact_id;
  return jsonb_build_object('actionId', p_action_id, 'version', v_version,
    'status', 'voided', 'duplicate', false);
end;
$$;

create or replace function public.link_work_artifact_document(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_link_id uuid,
  p_expected_version bigint,
  p_document_id uuid,
  p_relation public.work_artifact_document_relation,
  p_description text,
  p_renderer_version text,
  p_content_hash text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing public.work_artifact_revision_documents%rowtype;
  v_version bigint;
begin
  select * into v_existing from public.work_artifact_revision_documents relation
  where relation.id = p_link_id;
  if found then
    if v_existing.revision_id <> p_revision_id or v_existing.document_id <> p_document_id
      or v_existing.relation <> p_relation then
      raise exception 'work_artifact_document_idempotency_conflict';
    end if;
    select * into v_artifact from public.work_artifacts artifact where artifact.id = p_artifact_id;
    return jsonb_build_object('linkId', p_link_id, 'version', v_artifact.version, 'duplicate', true);
  end if;
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided' then raise exception 'work_artifact_is_voided'; end if;
  if v_artifact.version is distinct from p_expected_version then raise exception 'work_artifact_stale_version'; end if;
  if v_artifact.current_revision_id is distinct from p_revision_id then
    raise exception 'work_artifact_relation_requires_current_revision';
  end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;
  insert into public.work_artifact_revision_documents (
    id, organization_id, revision_id, document_id, relation, description,
    renderer_version, content_hash, created_by
  ) values (
    p_link_id, p_organization_id, p_revision_id, p_document_id, p_relation,
    nullif(btrim(p_description), ''), nullif(btrim(p_renderer_version), ''),
    nullif(btrim(p_content_hash), ''), p_actor_id
  );
  v_version := v_artifact.version + 1;
  update public.work_artifacts set version = v_version, updated_at = now() where id = p_artifact_id;
  return jsonb_build_object('linkId', p_link_id, 'version', v_version, 'duplicate', false);
end;
$$;

create or replace function public.link_work_artifact_source(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_link_id uuid,
  p_expected_version bigint,
  p_time_entry_id uuid,
  p_inventory_movement_id uuid,
  p_description text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_existing public.work_artifact_revision_sources%rowtype;
  v_version bigint;
begin
  select * into v_existing from public.work_artifact_revision_sources source where source.id = p_link_id;
  if found then
    if v_existing.revision_id <> p_revision_id
      or v_existing.time_entry_id is distinct from p_time_entry_id
      or v_existing.inventory_movement_id is distinct from p_inventory_movement_id then
      raise exception 'work_artifact_source_idempotency_conflict';
    end if;
    select * into v_artifact from public.work_artifacts artifact where artifact.id = p_artifact_id;
    return jsonb_build_object('linkId', p_link_id, 'version', v_artifact.version, 'duplicate', true);
  end if;
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = p_artifact_id and artifact.organization_id = p_organization_id for update;
  if not found then raise exception 'work_artifact_not_found'; end if;
  if v_artifact.status = 'voided' then raise exception 'work_artifact_is_voided'; end if;
  if v_artifact.version is distinct from p_expected_version then raise exception 'work_artifact_stale_version'; end if;
  if v_artifact.current_revision_id is distinct from p_revision_id then
    raise exception 'work_artifact_relation_requires_current_revision';
  end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_artifact.job_id, v_artifact.project_id, p_actor_id
  ) then raise exception 'work_artifact_not_authorized'; end if;
  insert into public.work_artifact_revision_sources (
    id, organization_id, revision_id, time_entry_id, inventory_movement_id,
    description, created_by
  ) values (
    p_link_id, p_organization_id, p_revision_id, p_time_entry_id,
    p_inventory_movement_id, nullif(btrim(p_description), ''), p_actor_id
  );
  v_version := v_artifact.version + 1;
  update public.work_artifacts set version = v_version, updated_at = now() where id = p_artifact_id;
  return jsonb_build_object('linkId', p_link_id, 'version', v_version, 'duplicate', false);
end;
$$;

create or replace function public.fulfill_instruction_evidence(
  p_organization_id uuid,
  p_actor_id uuid,
  p_fulfillment_id uuid,
  p_evidence_requirement_id uuid,
  p_document_id uuid,
  p_artifact_revision_id uuid,
  p_note text
)
returns public.job_instruction_item_evidence_fulfillments
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.job_instruction_item_evidence_fulfillments%rowtype;
  v_requirement public.job_instruction_item_evidence_requirements%rowtype;
  v_item public.job_instruction_items%rowtype;
  v_artifact public.work_artifacts%rowtype;
  v_result public.job_instruction_item_evidence_fulfillments%rowtype;
begin
  select * into v_existing from public.job_instruction_item_evidence_fulfillments fulfillment
  where fulfillment.id = p_fulfillment_id;
  if found then
    if v_existing.evidence_requirement_id <> p_evidence_requirement_id
      or v_existing.document_id is distinct from p_document_id
      or v_existing.artifact_revision_id is distinct from p_artifact_revision_id then
      raise exception 'instruction_evidence_idempotency_conflict';
    end if;
    return v_existing;
  end if;

  select * into v_requirement from public.job_instruction_item_evidence_requirements requirement
  where requirement.id = p_evidence_requirement_id
    and requirement.organization_id = p_organization_id;
  if not found then raise exception 'instruction_evidence_requirement_not_found'; end if;
  select * into v_item from public.job_instruction_items item
  where item.id = v_requirement.instruction_item_id and item.organization_id = p_organization_id;
  if not found then raise exception 'instruction_evidence_requirement_not_found'; end if;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_item.job_id, v_item.project_id, p_actor_id
  ) then raise exception 'instruction_evidence_not_authorized'; end if;
  if exists (
    select 1 from public.job_instruction_item_evidence_fulfillments fulfillment
    where fulfillment.evidence_requirement_id = p_evidence_requirement_id
      and fulfillment.removed_at is null
  ) then raise exception 'instruction_evidence_already_fulfilled'; end if;

  if p_document_id is not null and not exists (
    select 1
    from public.documents document
    join public.document_links link on link.document_id = document.id
    where document.id = p_document_id and document.organization_id = p_organization_id
      and document.deleted_at is null and document.category = v_requirement.document_category
      and ((v_item.job_id is not null and link.job_id = v_item.job_id)
        or (v_item.project_id is not null and link.project_id = v_item.project_id))
  ) then raise exception 'instruction_evidence_document_target_or_category_mismatch'; end if;

  if p_artifact_revision_id is not null then
    select artifact.* into v_artifact
    from public.work_artifact_revisions revision
    join public.work_artifacts artifact on artifact.id = revision.artifact_id
    where revision.id = p_artifact_revision_id and revision.organization_id = p_organization_id;
    if not found or v_artifact.status = 'voided'
      or (v_artifact.job_id is distinct from v_item.job_id
        or v_artifact.project_id is distinct from v_item.project_id) then
      raise exception 'instruction_evidence_artifact_target_mismatch';
    end if;
  end if;

  insert into public.job_instruction_item_evidence_fulfillments (
    id, organization_id, evidence_requirement_id, document_id,
    artifact_revision_id, note, created_by
  ) values (
    p_fulfillment_id, p_organization_id, p_evidence_requirement_id,
    p_document_id, p_artifact_revision_id, nullif(btrim(p_note), ''), p_actor_id
  ) returning * into v_result;
  return v_result;
end;
$$;

create or replace function public.remove_instruction_evidence_fulfillment(
  p_organization_id uuid,
  p_actor_id uuid,
  p_fulfillment_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns public.job_instruction_item_evidence_fulfillments
language plpgsql security definer set search_path = ''
as $$
declare
  v_current public.job_instruction_item_evidence_fulfillments%rowtype;
  v_item public.job_instruction_items%rowtype;
  v_result public.job_instruction_item_evidence_fulfillments%rowtype;
begin
  select fulfillment.* into v_current
  from public.job_instruction_item_evidence_fulfillments fulfillment
  where fulfillment.id = p_fulfillment_id and fulfillment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'instruction_evidence_fulfillment_not_found'; end if;
  if v_current.removed_at is not null then return v_current; end if;
  if v_current.version is distinct from p_expected_version then
    raise exception 'instruction_evidence_stale_version';
  end if;
  select item.* into v_item
  from public.job_instruction_item_evidence_requirements requirement
  join public.job_instruction_items item on item.id = requirement.instruction_item_id
  where requirement.id = v_current.evidence_requirement_id;
  if not app_private.can_access_work_artifact_target(
    p_organization_id, v_item.job_id, v_item.project_id, p_actor_id
  ) then raise exception 'instruction_evidence_not_authorized'; end if;
  perform set_config('app.instruction_evidence_write', 'true', true);
  update public.job_instruction_item_evidence_fulfillments set
    removed_at = now(), removed_by = p_actor_id, removal_reason = btrim(p_reason),
    version = version + 1
  where id = p_fulfillment_id returning * into v_result;
  return v_result;
end;
$$;

alter table public.work_artifact_actions enable row level security;
alter table public.job_instruction_item_evidence_fulfillments enable row level security;

create policy "Managers or capturing actors can view work artifact actions"
on public.work_artifact_actions for select to authenticated
using (
  app_private.is_work_artifact_manager(organization_id, (select auth.uid()))
  or created_by = (select auth.uid())
  or exists (
    select 1 from public.work_artifacts artifact
    where artifact.id = work_artifact_actions.artifact_id
      and app_private.can_access_work_artifact_target(
        artifact.organization_id, artifact.job_id, artifact.project_id, (select auth.uid())
      )
  )
);

create policy "Authorized users can view instruction evidence fulfillments"
on public.job_instruction_item_evidence_fulfillments for select to authenticated
using (exists (
  select 1
  from public.job_instruction_item_evidence_requirements requirement
  join public.job_instruction_items item on item.id = requirement.instruction_item_id
  where requirement.id = job_instruction_item_evidence_fulfillments.evidence_requirement_id
    and app_private.can_access_work_artifact_target(
      job_instruction_item_evidence_fulfillments.organization_id,
      item.job_id, item.project_id, (select auth.uid())
    )
));

revoke all on table public.work_artifact_actions,
  public.job_instruction_item_evidence_fulfillments from anon, authenticated;
grant select on table public.work_artifact_actions,
  public.job_instruction_item_evidence_fulfillments to authenticated;
grant all on table public.work_artifact_actions,
  public.job_instruction_item_evidence_fulfillments to service_role;

alter table public.job_instruction_item_evidence_fulfillments replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'job_instruction_item_evidence_fulfillments'
  ) then
    alter publication supabase_realtime add table public.job_instruction_item_evidence_fulfillments;
  end if;
end $$;

revoke all on function app_private.work_artifact_actor_can_approve(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.validate_work_artifact_action() from public, anon, authenticated;
revoke all on function app_private.guard_instruction_evidence_fulfillment_write() from public, anon, authenticated;
revoke all on function app_private.validate_submitted_work_artifact_revision(uuid) from public, anon, authenticated;
grant execute on function app_private.work_artifact_actor_can_approve(uuid, uuid) to service_role;
grant execute on function app_private.validate_work_artifact_action() to service_role;
grant execute on function app_private.guard_instruction_evidence_fulfillment_write() to service_role;
grant execute on function app_private.validate_submitted_work_artifact_revision(uuid) to service_role;

revoke all on function public.create_work_artifact_revision(
  uuid, uuid, uuid, uuid, bigint, uuid, uuid, public.work_artifact_kind,
  public.work_artifact_visibility, timestamptz, text, jsonb, uuid, text, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.create_work_artifact_revision(
  uuid, uuid, uuid, uuid, bigint, uuid, uuid, public.work_artifact_kind,
  public.work_artifact_visibility, timestamptz, text, jsonb, uuid, text, boolean, uuid
) to service_role;
revoke all on function public.record_work_artifact_action(
  uuid, uuid, uuid, uuid, uuid, bigint, public.work_artifact_action_type,
  text, text, jsonb, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.record_work_artifact_action(
  uuid, uuid, uuid, uuid, uuid, bigint, public.work_artifact_action_type,
  text, text, jsonb, jsonb, uuid
) to service_role;
revoke all on function public.void_work_artifact(uuid, uuid, uuid, uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.void_work_artifact(uuid, uuid, uuid, uuid, bigint, text)
  to service_role;
revoke all on function public.link_work_artifact_document(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid,
  public.work_artifact_document_relation, text, text, text
) from public, anon, authenticated;
grant execute on function public.link_work_artifact_document(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid,
  public.work_artifact_document_relation, text, text, text
) to service_role;
revoke all on function public.link_work_artifact_source(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.link_work_artifact_source(
  uuid, uuid, uuid, uuid, uuid, bigint, uuid, uuid, text
) to service_role;
revoke all on function public.fulfill_instruction_evidence(
  uuid, uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.fulfill_instruction_evidence(
  uuid, uuid, uuid, uuid, uuid, uuid, text
) to service_role;
revoke all on function public.remove_instruction_evidence_fulfillment(
  uuid, uuid, uuid, bigint, text
) from public, anon, authenticated;
grant execute on function public.remove_instruction_evidence_fulfillment(
  uuid, uuid, uuid, bigint, text
) to service_role;
