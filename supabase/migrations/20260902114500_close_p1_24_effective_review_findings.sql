-- Close effective P1-24 review findings without changing deploy-day rows.

create or replace function app_private.p1_24_current_user_is_manager(
  p_organization_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_manager(p_organization_id, (select auth.uid()));
$$;

create or replace function app_private.p1_24_current_user_is_admin(
  p_organization_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_admin(p_organization_id, (select auth.uid()));
$$;

create or replace function app_private.p1_24_current_user_is_self(
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_allow_prestart boolean default false
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_self(
    p_organization_id,
    p_employee_record_id,
    (select auth.uid()),
    p_allow_prestart
  );
$$;

create or replace function app_private.current_user_can_access_personnel_document(
  p_personnel_document_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.can_access_personnel_document(
    p_personnel_document_id,
    (select auth.uid())
  );
$$;

create or replace function app_private.current_user_can_access_personnel_document_version(
  p_document_id uuid,
  p_version_number integer
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.can_access_personnel_document_version(
    p_document_id,
    p_version_number,
    (select auth.uid())
  );
$$;

create or replace function app_private.current_user_can_access_personnel_document_history(
  p_document_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.can_access_personnel_document_history(
    p_document_id,
    (select auth.uid())
  );
$$;

revoke all on function app_private.p1_24_is_manager(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.p1_24_is_admin(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.p1_24_is_self(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function app_private.can_access_personnel_document(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.can_access_personnel_document_version(uuid, integer, uuid)
  from public, anon, authenticated;
revoke all on function app_private.can_access_personnel_document_history(uuid, uuid)
  from public, anon, authenticated;

revoke all on function app_private.p1_24_current_user_is_manager(uuid)
  from public, anon, authenticated;
revoke all on function app_private.p1_24_current_user_is_admin(uuid)
  from public, anon, authenticated;
revoke all on function app_private.p1_24_current_user_is_self(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function app_private.current_user_can_access_personnel_document(uuid)
  from public, anon, authenticated;
revoke all on function app_private.current_user_can_access_personnel_document_version(uuid, integer)
  from public, anon, authenticated;
revoke all on function app_private.current_user_can_access_personnel_document_history(uuid)
  from public, anon, authenticated;

grant execute on function app_private.p1_24_current_user_is_manager(uuid)
  to authenticated, service_role;
grant execute on function app_private.p1_24_current_user_is_admin(uuid)
  to authenticated, service_role;
grant execute on function app_private.p1_24_current_user_is_self(uuid, uuid, boolean)
  to authenticated, service_role;
grant execute on function app_private.current_user_can_access_personnel_document(uuid)
  to authenticated, service_role;
grant execute on function app_private.current_user_can_access_personnel_document_version(uuid, integer)
  to authenticated, service_role;
grant execute on function app_private.current_user_can_access_personnel_document_history(uuid)
  to authenticated, service_role;

drop policy if exists "Managers can view onboarding templates"
  on public.personnel_onboarding_templates;
create policy "Managers can view onboarding templates"
  on public.personnel_onboarding_templates for select to authenticated
  using (app_private.p1_24_current_user_is_manager(organization_id));

drop policy if exists "Managers can view onboarding template versions"
  on public.personnel_onboarding_template_versions;
create policy "Managers can view onboarding template versions"
  on public.personnel_onboarding_template_versions for select to authenticated
  using (app_private.p1_24_current_user_is_manager(organization_id));

drop policy if exists "Managers can view onboarding template items"
  on public.personnel_onboarding_template_items;
create policy "Managers can view onboarding template items"
  on public.personnel_onboarding_template_items for select to authenticated
  using (app_private.p1_24_current_user_is_manager(organization_id));

drop policy if exists "Managers and affected person can view onboarding plans"
  on public.personnel_onboarding_plans;
create policy "Managers and affected person can view onboarding plans"
  on public.personnel_onboarding_plans for select to authenticated
  using (
    app_private.p1_24_current_user_is_manager(organization_id)
    or app_private.p1_24_current_user_is_self(
      organization_id, employee_record_id, true
    )
  );

drop policy if exists "Managers and affected person can view onboarding requirements"
  on public.personnel_onboarding_requirements;
create policy "Managers and affected person can view onboarding requirements"
  on public.personnel_onboarding_requirements for select to authenticated
  using (
    app_private.p1_24_current_user_is_manager(organization_id)
    or app_private.p1_24_current_user_is_self(
      organization_id, employee_record_id, true
    )
  );

drop policy if exists "Managers and affected person can view requirement references"
  on public.personnel_requirement_references;
create policy "Managers and affected person can view requirement references"
  on public.personnel_requirement_references for select to authenticated
  using (
    exists (
      select 1
      from public.personnel_onboarding_requirements requirement
      where requirement.id = personnel_requirement_references.requirement_id
        and (
          app_private.p1_24_current_user_is_manager(requirement.organization_id)
          or app_private.p1_24_current_user_is_self(
            requirement.organization_id,
            requirement.employee_record_id,
            true
          )
        )
    )
  );

drop policy if exists "Managers and affected person can view access lifecycle"
  on public.personnel_access_lifecycles;
create policy "Managers and affected person can view access lifecycle"
  on public.personnel_access_lifecycles for select to authenticated
  using (
    app_private.p1_24_current_user_is_manager(organization_id)
    or app_private.p1_24_current_user_is_self(
      organization_id, employee_record_id, true
    )
  );

drop policy if exists "Managers and affected person can view access transitions"
  on public.personnel_access_transitions;
create policy "Managers and affected person can view access transitions"
  on public.personnel_access_transitions for select to authenticated
  using (
    app_private.p1_24_current_user_is_manager(organization_id)
    or app_private.p1_24_current_user_is_self(
      organization_id, employee_record_id, true
    )
  );

drop policy if exists "Managers and affected person can view employment lifecycle"
  on public.personnel_employment_lifecycles;
create policy "Managers and affected person can view employment lifecycle"
  on public.personnel_employment_lifecycles for select to authenticated
  using (
    app_private.p1_24_current_user_is_manager(organization_id)
    or app_private.p1_24_current_user_is_self(
      organization_id, employee_record_id, false
    )
  );

drop policy if exists "Managers and affected person can view employment transitions"
  on public.personnel_employment_transitions;
create policy "Managers and affected person can view employment transitions"
  on public.personnel_employment_transitions for select to authenticated
  using (
    app_private.p1_24_current_user_is_manager(organization_id)
    or app_private.p1_24_current_user_is_self(
      organization_id, employee_record_id, false
    )
  );

drop policy if exists "Authorized people can view protected personnel documents"
  on public.personnel_documents;
create policy "Authorized people can view protected personnel documents"
  on public.personnel_documents for select to authenticated
  using (app_private.current_user_can_access_personnel_document(id));

drop policy if exists "Authorized people can view personnel document releases"
  on public.personnel_document_releases;
create policy "Authorized people can view personnel document releases"
  on public.personnel_document_releases for select to authenticated
  using (
    app_private.current_user_can_access_personnel_document(
      personnel_document_id
    )
  );

drop policy if exists "Managers and affected person can view acknowledgements"
  on public.personnel_acknowledgements;
create policy "Managers and affected person can view acknowledgements"
  on public.personnel_acknowledgements for select to authenticated
  using (
    app_private.p1_24_current_user_is_manager(organization_id)
    or app_private.p1_24_current_user_is_self(
      organization_id, employee_record_id, true
    )
  );

drop policy if exists "Users can view accessible document versions"
  on public.document_versions;
create policy "Users can view accessible document versions"
  on public.document_versions for select to authenticated
  using (
    case
      when exists (
        select 1 from public.personnel_documents protected
        where protected.document_id = document_versions.document_id
      ) then app_private.current_user_can_access_personnel_document_version(
        document_id, version_number
      )
      else app_private.can_access_document(
        document_id, (select auth.uid())
      )
    end
  );

drop policy if exists "Users can view relevant document audit events"
  on public.document_audit_events;
create policy "Users can view relevant document audit events"
  on public.document_audit_events for select to authenticated
  using (
    case
      when document_id is not null and exists (
        select 1 from public.personnel_documents protected
        where protected.document_id = document_audit_events.document_id
      ) then app_private.current_user_can_access_personnel_document_history(
        document_id
      )
      else app_private.is_document_manager(
        organization_id, (select auth.uid())
      ) or (
        document_id is not null
        and app_private.can_access_document(
          document_id, (select auth.uid())
        )
      )
    end
  );

create or replace function public.publish_personnel_onboarding_template(
  p_actor_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_expected_version bigint,
  p_name text,
  p_description text,
  p_items jsonb,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  replayed_id uuid;
begin
  replayed_id := app_private.p1_24_assert_replay(
    p_organization_id, p_operation_id, p_request_hash
  );
  if replayed_id is not null then return replayed_id; end if;
  if p_template_id is not null and exists (
    select 1 from public.personnel_onboarding_templates template
    where template.id = p_template_id
      and template.organization_id = p_organization_id
      and template.state = 'archived'
  ) then
    raise exception 'archived_template';
  end if;
  return public.publish_personnel_onboarding_template_base(
    p_actor_id, p_organization_id, p_template_id, p_expected_version,
    p_name, p_description, p_items, p_operation_id, p_request_hash
  );
end;
$$;

revoke all on function public.publish_personnel_onboarding_template(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, text
) from public, anon, authenticated;
grant execute on function public.publish_personnel_onboarding_template(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, text
) to service_role;

create or replace function public.set_personnel_access_transition_review_base(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_expected_version bigint,
  p_transition_kind public.personnel_access_transition_kind,
  p_effective_at timestamptz,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  replayed_id uuid;
begin
  replayed_id := app_private.p1_24_assert_replay(
    p_organization_id, p_operation_id, p_request_hash
  );
  if replayed_id is not null then return replayed_id; end if;
  if p_transition_kind in ('activate_now', 'reactivate') and exists (
    select 1
    from public.personnel_onboarding_requirements requirement
    where requirement.employee_record_id = p_employee_record_id
      and requirement.organization_id = p_organization_id
      and requirement.blocks_access
      and requirement.state not in ('fulfilled', 'waived', 'cancelled')
  ) then
    raise exception 'access_requirements_incomplete';
  end if;
  return public.set_personnel_access_transition_p1_24_base(
    p_actor_id,
    p_organization_id,
    p_employee_record_id,
    p_expected_version,
    p_transition_kind,
    p_effective_at,
    p_reason,
    p_operation_id,
    p_request_hash
  );
end;
$$;

revoke all on function public.set_personnel_access_transition_review_base(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) from public, anon, authenticated, service_role;

create or replace function public.set_personnel_document_release(
  p_actor_id uuid,
  p_organization_id uuid,
  p_personnel_document_id uuid,
  p_document_version_number integer,
  p_release boolean,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  protected_document public.personnel_documents;
  release_record public.personnel_document_releases;
  document_record public.documents;
  result_id uuid;
begin
  result_id := app_private.p1_24_assert_replay(
    p_organization_id, p_operation_id, p_request_hash
  );
  if result_id is not null then return result_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-24-release:' ||
    p_personnel_document_id::text,
    0
  ));
  select * into protected_document
  from public.personnel_documents
  where id = p_personnel_document_id
    and organization_id = p_organization_id
  for update;
  if protected_document.id is null then
    raise exception 'personnel_document_not_found';
  end if;
  if not app_private.p1_24_is_manager(p_organization_id, p_actor_id)
     or (
       protected_document.access_class <> 'personnel_standard'
       and not app_private.p1_24_is_admin(p_organization_id, p_actor_id)
     )
  then
    raise exception 'forbidden';
  end if;
  select * into document_record
  from public.documents
  where id = protected_document.document_id
    and organization_id = p_organization_id;
  if p_document_version_number <= 0 or not (
    document_record.current_version_number = p_document_version_number
    or exists (
      select 1 from public.document_versions version
      where version.document_id = document_record.id
        and version.organization_id = p_organization_id
        and version.version_number = p_document_version_number
    )
  ) then
    raise exception 'document_version_not_found';
  end if;
  select * into release_record
  from public.personnel_document_releases
  where personnel_document_id = p_personnel_document_id
    and document_version_number = p_document_version_number
  for update;
  if p_release then
    if release_record.id is null then
      insert into public.personnel_document_releases(
        organization_id,
        personnel_document_id,
        employee_record_id,
        document_version_number,
        released_by,
        operation_id,
        request_hash
      ) values (
        p_organization_id,
        p_personnel_document_id,
        protected_document.employee_record_id,
        p_document_version_number,
        p_actor_id,
        p_operation_id,
        p_request_hash
      ) returning * into release_record;
    elsif release_record.revoked_at is not null then
      update public.personnel_document_releases set
        released_by = p_actor_id,
        released_at = clock_timestamp(),
        revoked_by = null,
        revoked_at = null,
        revoke_reason = null,
        operation_id = p_operation_id,
        request_hash = p_request_hash
      where id = release_record.id
      returning * into release_record;
    end if;
  else
    if release_record.id is null or release_record.revoked_at is not null then
      raise exception 'release_not_active';
    end if;
    if nullif(btrim(p_reason), '') is null then
      raise exception 'reason_required';
    end if;
    update public.personnel_document_releases set
      revoked_by = p_actor_id,
      revoked_at = clock_timestamp(),
      revoke_reason = btrim(p_reason)
    where id = release_record.id
    returning * into release_record;
  end if;
  insert into public.document_audit_events(
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id,
    protected_document.document_id,
    p_actor_id,
    case
      when p_release then 'personnel_released'
      else 'personnel_release_revoked'
    end,
    jsonb_build_object(
      'personnelDocumentId', p_personnel_document_id,
      'documentVersionNumber', p_document_version_number,
      'reason', nullif(btrim(p_reason), '')
    )
  );
  perform app_private.p1_24_record_operation(
    p_organization_id,
    p_operation_id,
    p_request_hash,
    case
      when p_release then 'release_personnel_document'
      else 'revoke_personnel_document_release'
    end,
    release_record.id,
    p_actor_id
  );
  return release_record.id;
end;
$$;

revoke all on function public.set_personnel_document_release(
  uuid, uuid, uuid, integer, boolean, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_personnel_document_release(
  uuid, uuid, uuid, integer, boolean, text, uuid, text
) to service_role;

create or replace function public.set_personnel_access_transition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_expected_version bigint,
  p_transition_kind public.personnel_access_transition_kind,
  p_effective_at timestamptz,
  p_reason text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  lifecycle public.personnel_access_lifecycles;
  target_state public.personnel_access_state;
  result_id uuid;
  effective_at timestamptz;
  new_version bigint;
  blocked_due_activation boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-24-access:' ||
    p_employee_record_id::text,
    0
  ));
  if p_transition_kind = 'end_access'
     and p_effective_at > clock_timestamp()
  then
    raise exception 'immediate_effective_at_required';
  end if;
  if p_transition_kind <> 'cancel_scheduled' then
    return public.set_personnel_access_transition_review_base(
      p_actor_id,
      p_organization_id,
      p_employee_record_id,
      p_expected_version,
      p_transition_kind,
      p_effective_at,
      p_reason,
      p_operation_id,
      p_request_hash
    );
  end if;
  result_id := app_private.p1_24_assert_replay(
    p_organization_id, p_operation_id, p_request_hash
  );
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then
    raise exception 'forbidden';
  end if;
  if p_effective_at is null or nullif(btrim(p_reason), '') is null then
    raise exception 'invalid_transition';
  end if;
  select * into lifecycle
  from public.personnel_access_lifecycles
  where employee_record_id = p_employee_record_id
    and organization_id = p_organization_id
  for update;
  blocked_due_activation :=
    lifecycle.scheduled_state = 'active'
    and lifecycle.scheduled_for <= clock_timestamp()
    and exists (
      select 1
      from public.personnel_onboarding_requirements requirement
      where requirement.employee_record_id = p_employee_record_id
        and requirement.organization_id = p_organization_id
        and requirement.blocks_access
        and requirement.state not in ('fulfilled', 'waived', 'cancelled')
    );
  if lifecycle.id is null
     or lifecycle.scheduled_state is null
     or (
       lifecycle.scheduled_for <= clock_timestamp()
       and not blocked_due_activation
     )
  then
    raise exception 'no_scheduled_transition';
  end if;
  if p_expected_version is distinct from lifecycle.version then
    raise exception 'stale_version';
  end if;
  target_state := case
    when lifecycle.state = 'scheduled'
      then 'not_configured'::public.personnel_access_state
    else lifecycle.state
  end;
  effective_at := clock_timestamp();
  new_version := lifecycle.version + 1;
  update public.personnel_access_lifecycles set
    state = target_state,
    state_effective_at = case
      when target_state is distinct from lifecycle.state then effective_at
      else state_effective_at
    end,
    scheduled_state = null,
    scheduled_for = null,
    version = new_version,
    updated_by = p_actor_id
  where id = lifecycle.id;
  insert into public.personnel_access_transitions(
    organization_id,
    access_lifecycle_id,
    employee_record_id,
    transition_kind,
    from_state,
    to_state,
    effective_at,
    reason,
    lifecycle_version,
    operation_id,
    request_hash,
    actor_id
  ) values (
    p_organization_id,
    lifecycle.id,
    p_employee_record_id,
    p_transition_kind,
    lifecycle.state,
    target_state,
    effective_at,
    btrim(p_reason),
    new_version,
    p_operation_id,
    p_request_hash,
    p_actor_id
  );
  insert into public.employee_record_events(
    organization_id,
    employee_record_id,
    event_type,
    event_payload,
    created_by
  ) values (
    p_organization_id,
    p_employee_record_id,
    'access_transition',
    jsonb_build_object(
      'transitionKind', p_transition_kind,
      'fromState', lifecycle.state,
      'toState', target_state,
      'effectiveAt', effective_at,
      'lifecycleVersion', new_version,
      'reason', btrim(p_reason)
    ),
    p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id,
    p_operation_id,
    p_request_hash,
    'access_transition',
    lifecycle.id,
    p_actor_id
  );
  return lifecycle.id;
end;
$$;

revoke all on function public.set_personnel_access_transition(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_personnel_access_transition(
  uuid, uuid, uuid, bigint, public.personnel_access_transition_kind,
  timestamptz, text, uuid, text
) to service_role;
