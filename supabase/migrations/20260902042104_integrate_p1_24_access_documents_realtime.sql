-- P1-24 integration: tenant validation, immutable history, effective access,
-- protected-document authorization, RLS, grants, and minimal Realtime keys.

alter table public.document_audit_events
  drop constraint document_audit_events_event_type_check;
alter table public.document_audit_events
  add constraint document_audit_events_event_type_check
  check (event_type in (
    'uploaded',
    'renamed',
    'moved',
    'copied',
    'category_changed',
    'linked',
    'unlinked',
    'deleted',
    'restored',
    'version_uploaded',
    'permanently_deleted',
    'storage_cleanup',
    'personnel_classified',
    'personnel_released',
    'personnel_release_revoked'
  ));

create or replace function app_private.validate_p1_24_requirement_reference()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  requirement_employee_id uuid;
  target_organization_id uuid;
  target_employee_id uuid;
begin
  select requirement.employee_record_id
    into requirement_employee_id
  from public.personnel_onboarding_requirements requirement
  where requirement.id = new.requirement_id
    and requirement.organization_id = new.organization_id;
  if requirement_employee_id is null then raise exception 'requirement_organization_mismatch'; end if;

  if new.personnel_document_id is not null then
    select document.organization_id, document.employee_record_id
      into target_organization_id, target_employee_id
    from public.personnel_documents document where document.id = new.personnel_document_id;
  elsif new.employee_capability_id is not null then
    select capability.organization_id, capability.employee_record_id
      into target_organization_id, target_employee_id
    from public.employee_capabilities capability where capability.id = new.employee_capability_id;
  elsif new.employment_condition_id is not null then
    select condition.organization_id, condition.employee_record_id
      into target_organization_id, target_employee_id
    from public.employment_conditions condition where condition.id = new.employment_condition_id;
  elsif new.work_schedule_id is not null then
    select schedule.organization_id, schedule.employee_record_id
      into target_organization_id, target_employee_id
    from public.work_schedules schedule where schedule.id = new.work_schedule_id;
  elsif new.team_membership_id is not null then
    select membership.organization_id, membership.employee_record_id
      into target_organization_id, target_employee_id
    from public.team_memberships membership where membership.id = new.team_membership_id;
  elsif new.access_lifecycle_id is not null then
    select lifecycle.organization_id, lifecycle.employee_record_id
      into target_organization_id, target_employee_id
    from public.personnel_access_lifecycles lifecycle where lifecycle.id = new.access_lifecycle_id;
  elsif new.acknowledgement_id is not null then
    select acknowledgement.organization_id, acknowledgement.employee_record_id
      into target_organization_id, target_employee_id
    from public.personnel_acknowledgements acknowledgement where acknowledgement.id = new.acknowledgement_id;
  end if;
  if target_organization_id is distinct from new.organization_id
     or target_employee_id is distinct from requirement_employee_id
  then raise exception 'requirement_reference_mismatch'; end if;
  return new;
end;
$$;
create trigger personnel_requirement_references_validate
  before insert or update on public.personnel_requirement_references
  for each row execute function app_private.validate_p1_24_requirement_reference();

create or replace function app_private.validate_p1_24_document_release()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.personnel_documents document
    join public.documents base on base.id = document.document_id
    where document.id = new.personnel_document_id
      and document.organization_id = new.organization_id
      and document.employee_record_id = new.employee_record_id
      and (
        base.current_version_number = new.document_version_number
        or exists (
          select 1 from public.document_versions version
          where version.document_id = base.id
            and version.version_number = new.document_version_number
        )
      )
  ) then raise exception 'personnel_document_release_mismatch'; end if;
  return new;
end;
$$;
create trigger personnel_document_releases_validate
  before insert or update on public.personnel_document_releases
  for each row execute function app_private.validate_p1_24_document_release();

create or replace function app_private.validate_p1_24_acknowledgement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.employee_records employee
    where employee.id = new.employee_record_id
      and employee.organization_id = new.organization_id
      and employee.user_id = new.acknowledged_by
  ) then raise exception 'acknowledgement_actor_mismatch'; end if;
  if new.personnel_document_id is not null and not exists (
    select 1 from public.personnel_documents document
    where document.id = new.personnel_document_id
      and document.organization_id = new.organization_id
      and document.employee_record_id = new.employee_record_id
  ) then raise exception 'acknowledgement_document_mismatch'; end if;
  if new.requirement_id is not null and not exists (
    select 1 from public.personnel_onboarding_requirements requirement
    where requirement.id = new.requirement_id
      and requirement.organization_id = new.organization_id
      and requirement.employee_record_id = new.employee_record_id
      and requirement.version = new.requirement_version
  ) then raise exception 'acknowledgement_requirement_mismatch'; end if;
  return new;
end;
$$;
create trigger personnel_acknowledgements_validate
  before insert on public.personnel_acknowledgements
  for each row execute function app_private.validate_p1_24_acknowledgement();

create or replace function app_private.guard_p1_24_immutable_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.organizations organization where organization.id = target_organization_id
  ) then return old; end if;
  raise exception 'p1_24_history_is_immutable';
end;
$$;
create trigger personnel_access_transitions_immutable
  before update or delete on public.personnel_access_transitions
  for each row execute function app_private.guard_p1_24_immutable_row();
create trigger personnel_employment_transitions_immutable
  before update or delete on public.personnel_employment_transitions
  for each row execute function app_private.guard_p1_24_immutable_row();
create trigger personnel_onboarding_template_versions_immutable
  before update or delete on public.personnel_onboarding_template_versions
  for each row execute function app_private.guard_p1_24_immutable_row();
create trigger personnel_onboarding_template_items_immutable
  before update or delete on public.personnel_onboarding_template_items
  for each row execute function app_private.guard_p1_24_immutable_row();
create trigger personnel_acknowledgements_immutable
  before update or delete on public.personnel_acknowledgements
  for each row execute function app_private.guard_p1_24_immutable_row();
create trigger personnel_lifecycle_operations_immutable
  before update or delete on public.personnel_lifecycle_operations
  for each row execute function app_private.guard_p1_24_immutable_row();

create or replace function app_private.guard_protected_personnel_document_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.personnel_documents protected where protected.document_id = old.id)
     and exists (select 1 from public.organizations organization where organization.id = old.organization_id)
  then raise exception 'protected_personnel_document_delete_blocked'; end if;
  return old;
end;
$$;
create trigger documents_protected_personnel_delete_guard
  before delete on public.documents
  for each row execute function app_private.guard_protected_personnel_document_delete();

-- Make organization membership one central access input. A membership without
-- a P1-24 lifecycle keeps its legacy access. A scheduled starter does not.
create or replace function app_private.get_user_org_ids(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select member.organization_id
  from public.organization_members member
  where member.user_id = p_user_id
    and app_private.p1_24_has_effective_access(member.organization_id, p_user_id);
$$;

create or replace function app_private.get_user_admin_or_manager_org_ids(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select member.organization_id
  from public.organization_members member
  where member.user_id = p_user_id
    and member.role in ('admin', 'buero')
    and app_private.p1_24_has_effective_access(member.organization_id, p_user_id);
$$;

create or replace function app_private.get_user_employee_record_ids(p_user_id uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select employee.id
  from public.employee_records employee
  where employee.user_id = p_user_id
    and app_private.p1_24_has_effective_access(employee.organization_id, p_user_id);
$$;

create or replace function app_private.is_document_manager(p_org_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.p1_24_is_manager(p_org_id, p_user_id);
$$;

create or replace function app_private.can_access_personnel_document(
  p_personnel_document_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.personnel_documents protected
    join public.documents document on document.id = protected.document_id
    join public.employee_records employee on employee.id = protected.employee_record_id
    where protected.id = p_personnel_document_id
      and document.deleted_at is null
      and (
        app_private.p1_24_is_admin(protected.organization_id, p_user_id)
        or (
          protected.access_class = 'personnel_standard'
          and app_private.p1_24_is_manager(protected.organization_id, p_user_id)
        )
        or (
          employee.user_id = p_user_id
          and (
            app_private.p1_24_has_effective_access(protected.organization_id, p_user_id)
            or app_private.p1_24_has_prestart_access(protected.organization_id, p_user_id)
          )
          and exists (
            select 1 from public.personnel_document_releases release
            where release.personnel_document_id = protected.id
              and release.document_version_number = document.current_version_number
              and release.revoked_at is null
          )
        )
      )
  );
$$;

create or replace function app_private.can_access_personnel_document_version(
  p_document_id uuid,
  p_version_number integer,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.personnel_documents protected
    join public.employee_records employee on employee.id = protected.employee_record_id
    where protected.document_id = p_document_id
      and (
        app_private.p1_24_is_admin(protected.organization_id, p_user_id)
        or (
          protected.access_class = 'personnel_standard'
          and app_private.p1_24_is_manager(protected.organization_id, p_user_id)
        )
        or (
          employee.user_id = p_user_id
          and (
            app_private.p1_24_has_effective_access(protected.organization_id, p_user_id)
            or app_private.p1_24_has_prestart_access(protected.organization_id, p_user_id)
          )
          and exists (
            select 1 from public.personnel_document_releases release
            where release.personnel_document_id = protected.id
              and release.document_version_number = p_version_number
              and release.revoked_at is null
          )
        )
      )
  );
$$;

create or replace function app_private.can_access_personnel_document_history(
  p_document_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = p_document_id
      and (
        app_private.p1_24_is_admin(protected.organization_id, p_user_id)
        or (
          protected.access_class = 'personnel_standard'
          and app_private.p1_24_is_manager(protected.organization_id, p_user_id)
        )
      )
  );
$$;

create or replace function app_private.can_access_document(p_document_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.personnel_documents protected
    where protected.document_id = p_document_id
      and app_private.can_access_personnel_document(protected.id, p_user_id)
  ) or exists (
    select 1 from public.documents document
    where document.id = p_document_id and document.deleted_at is null
      and not exists (
        select 1 from public.personnel_documents protected where protected.document_id = document.id
      )
      and app_private.is_document_manager(document.organization_id, p_user_id)
  ) or exists (
    select 1
    from public.documents document
    join public.document_links link on link.document_id = document.id
    join public.job_assignments assignment on assignment.job_id = link.job_id
    where document.id = p_document_id and document.deleted_at is null
      and not exists (
        select 1 from public.personnel_documents protected where protected.document_id = document.id
      )
      and link.job_id is not null and assignment.user_id = p_user_id
      and app_private.p1_24_has_effective_access(document.organization_id, p_user_id)
  ) or exists (
    select 1
    from public.documents document
    join public.work_artifact_revision_documents relation on relation.document_id = document.id
    join public.work_artifact_revisions revision on revision.id = relation.revision_id
    join public.work_artifacts artifact on artifact.id = revision.artifact_id
    where document.id = p_document_id and document.deleted_at is null
      and not exists (
        select 1 from public.personnel_documents protected where protected.document_id = document.id
      )
      and app_private.p1_24_has_effective_access(document.organization_id, p_user_id)
      and app_private.can_access_work_artifact_target(
        artifact.organization_id, artifact.job_id, artifact.project_id, p_user_id
      )
  );
$$;

drop policy if exists "Users can view accessible document versions" on public.document_versions;
create policy "Users can view accessible document versions"
  on public.document_versions for select to authenticated
  using (
    case
      when exists (select 1 from public.personnel_documents protected where protected.document_id = document_id)
      then app_private.can_access_personnel_document_version(document_id, version_number, (select auth.uid()))
      else app_private.can_access_document(document_id, (select auth.uid()))
    end
  );

drop policy if exists "Users can view relevant document audit events" on public.document_audit_events;
create policy "Users can view relevant document audit events"
  on public.document_audit_events for select to authenticated
  using (
    case
      when document_id is not null and exists (
        select 1 from public.personnel_documents protected where protected.document_id = document_id
      ) then app_private.can_access_personnel_document_history(document_id, (select auth.uid()))
      else app_private.is_document_manager(organization_id, (select auth.uid()))
        or (document_id is not null and app_private.can_access_document(document_id, (select auth.uid())))
    end
  );

-- Protect every new exposed table with RLS. Authenticated writes stay behind
-- service-role functions; authenticated clients receive SELECT only.
alter table public.personnel_access_lifecycles enable row level security;
alter table public.personnel_access_transitions enable row level security;
alter table public.personnel_employment_lifecycles enable row level security;
alter table public.personnel_employment_transitions enable row level security;
alter table public.personnel_documents enable row level security;
alter table public.personnel_document_releases enable row level security;
alter table public.personnel_onboarding_templates enable row level security;
alter table public.personnel_onboarding_template_versions enable row level security;
alter table public.personnel_onboarding_template_items enable row level security;
alter table public.personnel_onboarding_plans enable row level security;
alter table public.personnel_onboarding_requirements enable row level security;
alter table public.personnel_requirement_references enable row level security;
alter table public.personnel_acknowledgements enable row level security;
alter table public.personnel_lifecycle_operations enable row level security;

create policy "Managers and affected person can view access lifecycle"
  on public.personnel_access_lifecycles for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
    or app_private.p1_24_is_self(organization_id, employee_record_id, (select auth.uid()), true)
  );
create policy "Managers and affected person can view access transitions"
  on public.personnel_access_transitions for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
    or app_private.p1_24_is_self(organization_id, employee_record_id, (select auth.uid()), true)
  );
create policy "Managers and affected person can view employment lifecycle"
  on public.personnel_employment_lifecycles for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
    or app_private.p1_24_is_self(organization_id, employee_record_id, (select auth.uid()), false)
  );
create policy "Managers and affected person can view employment transitions"
  on public.personnel_employment_transitions for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
    or app_private.p1_24_is_self(organization_id, employee_record_id, (select auth.uid()), false)
  );
create policy "Authorized people can view protected personnel documents"
  on public.personnel_documents for select to authenticated using (
    app_private.can_access_personnel_document(id, (select auth.uid()))
  );
create policy "Authorized people can view personnel document releases"
  on public.personnel_document_releases for select to authenticated using (
    app_private.can_access_personnel_document(personnel_document_id, (select auth.uid()))
  );
create policy "Managers can view onboarding templates"
  on public.personnel_onboarding_templates for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
  );
create policy "Managers can view onboarding template versions"
  on public.personnel_onboarding_template_versions for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
  );
create policy "Managers can view onboarding template items"
  on public.personnel_onboarding_template_items for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
  );
create policy "Managers and affected person can view onboarding plans"
  on public.personnel_onboarding_plans for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
    or app_private.p1_24_is_self(organization_id, employee_record_id, (select auth.uid()), true)
  );
create policy "Managers and affected person can view onboarding requirements"
  on public.personnel_onboarding_requirements for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
    or app_private.p1_24_is_self(organization_id, employee_record_id, (select auth.uid()), true)
  );
create policy "Managers and affected person can view requirement references"
  on public.personnel_requirement_references for select to authenticated using (
    exists (
      select 1 from public.personnel_onboarding_requirements requirement
      where requirement.id = requirement_id
        and (
          app_private.p1_24_is_manager(requirement.organization_id, (select auth.uid()))
          or app_private.p1_24_is_self(
            requirement.organization_id, requirement.employee_record_id, (select auth.uid()), true
          )
        )
    )
  );
create policy "Managers and affected person can view acknowledgements"
  on public.personnel_acknowledgements for select to authenticated using (
    app_private.p1_24_is_manager(organization_id, (select auth.uid()))
    or app_private.p1_24_is_self(organization_id, employee_record_id, (select auth.uid()), true)
  );

revoke all on table
  public.personnel_access_lifecycles,
  public.personnel_access_transitions,
  public.personnel_employment_lifecycles,
  public.personnel_employment_transitions,
  public.personnel_documents,
  public.personnel_document_releases,
  public.personnel_onboarding_templates,
  public.personnel_onboarding_template_versions,
  public.personnel_onboarding_template_items,
  public.personnel_onboarding_plans,
  public.personnel_onboarding_requirements,
  public.personnel_requirement_references,
  public.personnel_acknowledgements,
  public.personnel_lifecycle_operations
from anon, authenticated;
grant select on table
  public.personnel_access_lifecycles,
  public.personnel_access_transitions,
  public.personnel_employment_lifecycles,
  public.personnel_employment_transitions,
  public.personnel_documents,
  public.personnel_document_releases,
  public.personnel_onboarding_templates,
  public.personnel_onboarding_template_versions,
  public.personnel_onboarding_template_items,
  public.personnel_onboarding_plans,
  public.personnel_onboarding_requirements,
  public.personnel_requirement_references,
  public.personnel_acknowledgements
to authenticated;
grant all on table
  public.personnel_access_lifecycles,
  public.personnel_access_transitions,
  public.personnel_employment_lifecycles,
  public.personnel_employment_transitions,
  public.personnel_documents,
  public.personnel_document_releases,
  public.personnel_onboarding_templates,
  public.personnel_onboarding_template_versions,
  public.personnel_onboarding_template_items,
  public.personnel_onboarding_plans,
  public.personnel_onboarding_requirements,
  public.personnel_requirement_references,
  public.personnel_acknowledgements,
  public.personnel_lifecycle_operations
to service_role;

-- Cover every new foreign key with a leading-column index.
do $$
declare
  foreign_key record;
  column_list text;
  index_name text;
begin
  for foreign_key in
    select constraint_row.oid, constraint_row.conrelid, constraint_row.conname, table_row.relname
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class table_row on table_row.oid = constraint_row.conrelid
    where constraint_row.contype = 'f'
      and table_row.relnamespace = 'public'::regnamespace
      and table_row.relname ~ '^personnel_'
  loop
    select string_agg(pg_catalog.quote_ident(attribute_row.attname), ', ' order by key_column.ordinality)
      into column_list
    from unnest((select conkey from pg_catalog.pg_constraint where oid = foreign_key.oid))
      with ordinality as key_column(attnum, ordinality)
    join pg_catalog.pg_attribute attribute_row
      on attribute_row.attrelid = foreign_key.conrelid
     and attribute_row.attnum = key_column.attnum;
    index_name := left(foreign_key.relname, 42) || '_fk_' || substr(md5(foreign_key.conname), 1, 8);
    execute format('create index if not exists %I on public.%I (%s)', index_name, foreign_key.relname, column_list);
  end loop;
end;
$$;

alter table public.personnel_document_releases
  add constraint personnel_document_releases_id_org_unique unique (id, organization_id);

alter table public.personnel_access_lifecycles
  replica identity using index personnel_access_lifecycles_id_org_unique;
alter table public.personnel_employment_lifecycles
  replica identity using index personnel_employment_lifecycles_id_org_unique;
alter table public.personnel_documents
  replica identity using index personnel_documents_id_org_unique;
alter table public.personnel_document_releases
  replica identity using index personnel_document_releases_id_org_unique;
alter table public.personnel_onboarding_templates
  replica identity using index personnel_onboarding_templates_id_org_unique;
alter table public.personnel_onboarding_plans
  replica identity using index personnel_onboarding_plans_id_org_unique;
alter table public.personnel_onboarding_requirements
  replica identity using index personnel_onboarding_requirements_id_org_unique;

alter publication supabase_realtime add table public.personnel_access_lifecycles;
alter publication supabase_realtime add table public.personnel_employment_lifecycles;
alter publication supabase_realtime add table public.personnel_documents;
alter publication supabase_realtime add table public.personnel_document_releases;
alter publication supabase_realtime add table public.personnel_onboarding_templates;
alter publication supabase_realtime add table public.personnel_onboarding_plans;
alter publication supabase_realtime add table public.personnel_onboarding_requirements;

revoke all on function app_private.validate_p1_24_requirement_reference() from public, anon, authenticated;
revoke all on function app_private.validate_p1_24_document_release() from public, anon, authenticated;
revoke all on function app_private.validate_p1_24_acknowledgement() from public, anon, authenticated;
revoke all on function app_private.guard_p1_24_immutable_row() from public, anon, authenticated;
revoke all on function app_private.guard_protected_personnel_document_delete() from public, anon, authenticated;
revoke all on function app_private.can_access_personnel_document(uuid, uuid) from public, anon;
revoke all on function app_private.can_access_personnel_document_version(uuid, integer, uuid) from public, anon;
revoke all on function app_private.can_access_personnel_document_history(uuid, uuid) from public, anon;
grant execute on function app_private.validate_p1_24_requirement_reference() to service_role;
grant execute on function app_private.validate_p1_24_document_release() to service_role;
grant execute on function app_private.validate_p1_24_acknowledgement() to service_role;
grant execute on function app_private.guard_p1_24_immutable_row() to service_role;
grant execute on function app_private.guard_protected_personnel_document_delete() to service_role;
grant execute on function app_private.can_access_personnel_document(uuid, uuid) to authenticated, service_role;
grant execute on function app_private.can_access_personnel_document_version(uuid, integer, uuid) to authenticated, service_role;
grant execute on function app_private.can_access_personnel_document_history(uuid, uuid) to authenticated, service_role;
grant execute on function app_private.p1_24_is_manager(uuid, uuid) to authenticated;
grant execute on function app_private.p1_24_is_admin(uuid, uuid) to authenticated;
grant execute on function app_private.p1_24_is_self(uuid, uuid, uuid, boolean) to authenticated;
