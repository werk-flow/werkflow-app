create table public.work_handover_packages (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  state public.work_handover_package_state not null default 'draft',
  version bigint not null default 1 check (version > 0),
  current_release_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint work_handover_packages_one_target_check check (
    (job_id is not null)::integer + (project_id is not null)::integer = 1
  ),
  unique (id, organization_id)
);

create unique index work_handover_packages_job_identity_idx
  on public.work_handover_packages (organization_id, job_id)
  where job_id is not null;
create unique index work_handover_packages_project_identity_idx
  on public.work_handover_packages (organization_id, project_id)
  where project_id is not null;
create index work_handover_packages_org_updated_idx
  on public.work_handover_packages (organization_id, updated_at desc);
create index work_handover_packages_created_by_idx
  on public.work_handover_packages (created_by);
create index work_handover_packages_updated_by_idx
  on public.work_handover_packages (updated_by);

create table public.work_handover_releases (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  release_number integer not null check (release_number > 0),
  previous_release_id uuid,
  request_id uuid not null,
  target_snapshot jsonb not null,
  gate_snapshot jsonb not null,
  gate_fingerprint text not null check (gate_fingerprint ~ '^[0-9a-f]{64}$'),
  time_summary jsonb not null default '{}'::jsonb,
  material_summary jsonb not null default '{}'::jsonb,
  responsibility_snapshot jsonb not null,
  overridden_gates jsonb not null default '[]'::jsonb,
  override_reason text,
  commercial_readiness public.work_handover_commercial_readiness_state not null,
  unassessed_facts jsonb not null default '[]'::jsonb,
  renderer_version text not null check (length(btrim(renderer_version)) between 1 and 100),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  package_document_id uuid not null references public.documents(id) on delete restrict,
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint work_handover_releases_package_fkey
    foreign key (package_id, organization_id)
    references public.work_handover_packages(id, organization_id) on delete cascade,
  constraint work_handover_releases_previous_fkey
    foreign key (previous_release_id)
    references public.work_handover_releases(id) on delete restrict,
  constraint work_handover_releases_json_shapes_check check (
    jsonb_typeof(target_snapshot) = 'object'
    and jsonb_typeof(gate_snapshot) = 'object'
    and jsonb_typeof(time_summary) = 'object'
    and jsonb_typeof(material_summary) = 'object'
    and jsonb_typeof(responsibility_snapshot) = 'object'
    and jsonb_typeof(overridden_gates) = 'array'
    and jsonb_typeof(unassessed_facts) = 'array'
  ),
  constraint work_handover_releases_override_check check (
    (jsonb_array_length(overridden_gates) = 0 and override_reason is null
      and commercial_readiness <> 'ready_with_exceptions')
    or (jsonb_array_length(overridden_gates) > 0
      and length(btrim(override_reason)) between 3 and 1000
      and commercial_readiness = 'ready_with_exceptions')
  ),
  unique (id, organization_id),
  unique (package_id, release_number),
  unique (organization_id, request_id)
);

create index work_handover_releases_package_created_idx
  on public.work_handover_releases (package_id, created_at desc);
create index work_handover_releases_previous_idx
  on public.work_handover_releases (previous_release_id)
  where previous_release_id is not null;
create index work_handover_releases_document_idx
  on public.work_handover_releases (package_document_id);
create index work_handover_releases_reviewed_by_idx
  on public.work_handover_releases (reviewed_by);

alter table public.work_handover_packages
  add constraint work_handover_packages_current_release_fkey
  foreign key (current_release_id, organization_id)
  references public.work_handover_releases(id, organization_id) on delete restrict;

create table public.work_handover_draft_items (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  source_kind public.work_handover_source_kind not null,
  work_artifact_revision_id uuid references public.work_artifact_revisions(id) on delete restrict,
  document_id uuid references public.documents(id) on delete restrict,
  document_version_number integer check (document_version_number > 0),
  document_storage_path text,
  child_handover_release_id uuid references public.work_handover_releases(id) on delete restrict,
  customer_label text not null check (length(btrim(customer_label)) between 1 and 200),
  sort_order integer not null check (sort_order >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_handover_draft_items_package_fkey
    foreign key (package_id, organization_id)
    references public.work_handover_packages(id, organization_id) on delete cascade,
  constraint work_handover_draft_items_source_check check (
    (source_kind = 'work_artifact_revision'
      and work_artifact_revision_id is not null
      and document_id is null and document_version_number is null
      and document_storage_path is null and child_handover_release_id is null)
    or (source_kind = 'document_version'
      and work_artifact_revision_id is null and document_id is not null
      and document_version_number is not null
      and length(btrim(document_storage_path)) > 0
      and child_handover_release_id is null)
    or (source_kind = 'child_handover_release'
      and work_artifact_revision_id is null and document_id is null
      and document_version_number is null and document_storage_path is null
      and child_handover_release_id is not null)
  ),
  unique (package_id, sort_order)
);

create unique index work_handover_draft_items_artifact_idx
  on public.work_handover_draft_items (package_id, work_artifact_revision_id)
  where work_artifact_revision_id is not null;
create unique index work_handover_draft_items_document_idx
  on public.work_handover_draft_items (
    package_id, document_id, document_version_number, document_storage_path
  ) where document_id is not null;
create unique index work_handover_draft_items_child_release_idx
  on public.work_handover_draft_items (package_id, child_handover_release_id)
  where child_handover_release_id is not null;
create index work_handover_draft_items_org_idx
  on public.work_handover_draft_items (organization_id);

create table public.work_handover_release_items (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  release_id uuid not null,
  source_kind public.work_handover_source_kind not null,
  work_artifact_revision_id uuid references public.work_artifact_revisions(id) on delete restrict,
  document_id uuid references public.documents(id) on delete restrict,
  document_version_number integer check (document_version_number > 0),
  document_storage_path text,
  child_handover_release_id uuid references public.work_handover_releases(id) on delete restrict,
  customer_label text not null check (length(btrim(customer_label)) between 1 and 200),
  customer_payload jsonb not null,
  sort_order integer not null check (sort_order >= 0),
  constraint work_handover_release_items_release_fkey
    foreign key (release_id, organization_id)
    references public.work_handover_releases(id, organization_id) on delete cascade,
  constraint work_handover_release_items_source_check check (
    (source_kind = 'work_artifact_revision'
      and work_artifact_revision_id is not null
      and document_id is null and document_version_number is null
      and document_storage_path is null and child_handover_release_id is null)
    or (source_kind = 'document_version'
      and work_artifact_revision_id is null and document_id is not null
      and document_version_number is not null
      and length(btrim(document_storage_path)) > 0
      and child_handover_release_id is null)
    or (source_kind = 'child_handover_release'
      and work_artifact_revision_id is null and document_id is null
      and document_version_number is null and document_storage_path is null
      and child_handover_release_id is not null)
  ),
  constraint work_handover_release_items_payload_check check (
    jsonb_typeof(customer_payload) = 'object'
  ),
  unique (release_id, sort_order)
);

create index work_handover_release_items_org_idx
  on public.work_handover_release_items (organization_id);
create index work_handover_release_items_artifact_idx
  on public.work_handover_release_items (work_artifact_revision_id)
  where work_artifact_revision_id is not null;
create index work_handover_release_items_document_idx
  on public.work_handover_release_items (document_id, document_version_number)
  where document_id is not null;
create index work_handover_release_items_child_release_idx
  on public.work_handover_release_items (child_handover_release_id)
  where child_handover_release_id is not null;

create table public.work_handover_events (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  event_type public.work_handover_event_type not null,
  request_id uuid,
  request_fingerprint text,
  from_state public.work_handover_package_state,
  to_state public.work_handover_package_state,
  release_id uuid references public.work_handover_releases(id) on delete restrict,
  previous_release_id uuid references public.work_handover_releases(id) on delete restrict,
  reason text,
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_handover_events_package_fkey
    foreign key (package_id, organization_id)
    references public.work_handover_packages(id, organization_id) on delete cascade,
  constraint work_handover_events_request_check check (
    (request_id is null and request_fingerprint is null)
    or (request_id is not null and request_fingerprint ~ '^[0-9a-f]{64}$')
  ),
  constraint work_handover_events_payload_check check (
    jsonb_typeof(event_payload) = 'object'
  )
);

create unique index work_handover_events_request_idx
  on public.work_handover_events (organization_id, request_id)
  where request_id is not null;
create index work_handover_events_package_created_idx
  on public.work_handover_events (package_id, created_at desc);
create index work_handover_events_release_idx
  on public.work_handover_events (release_id)
  where release_id is not null;
create index work_handover_events_created_by_idx
  on public.work_handover_events (created_by);

create or replace function app_private.work_handover_actor_can_review(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  with latest_configuration as (
    select configuration.id, configuration.mode
    from public.organization_responsibility_configurations configuration
    where configuration.organization_id = p_organization_id
      and configuration.responsibility = 'work_handover_review'
      and configuration.effective_from <= now()
    order by configuration.effective_from desc, configuration.created_at desc,
      configuration.id desc
    limit 1
  ), actor as (
    select member.role, employee.id as employee_record_id
    from public.organization_members member
    left join public.employee_records employee
      on employee.organization_id = member.organization_id
     and employee.user_id = member.user_id
     and employee.exit_date is null
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
  ), directly_authorized as (
    select actor.employee_record_id
    from actor left join latest_configuration configuration on true
    where (
      (configuration.id is null or configuration.mode = 'role_default')
        and actor.role in ('admin', 'buero')
    ) or (
      configuration.mode = 'selected'
      and actor.employee_record_id is not null
      and exists (
        select 1 from public.organization_responsibility_assignments assignment
        where assignment.configuration_id = configuration.id
          and assignment.employee_record_id = actor.employee_record_id
      )
    )
  ), delegated_authorized as (
    select delegation.substitute_employee_record_id
    from public.organization_responsibility_delegations delegation
    join actor on actor.employee_record_id = delegation.substitute_employee_record_id
    left join latest_configuration configuration on true
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'work_handover_review'
      and delegation.valid_from <= (now() at time zone 'Europe/Berlin')::date
      and delegation.valid_until >= (now() at time zone 'Europe/Berlin')::date
      and (delegation.revoked_from is null
        or delegation.revoked_from > (now() at time zone 'Europe/Berlin')::date)
      and (
        ((configuration.id is null or configuration.mode = 'role_default') and exists (
          select 1
          from public.employee_records delegator
          join public.organization_members member
            on member.organization_id = delegator.organization_id
           and member.user_id = delegator.user_id
          where delegator.id = delegation.delegator_employee_record_id
            and delegator.exit_date is null
            and member.role in ('admin', 'buero')
        ))
        or (configuration.mode = 'selected' and exists (
          select 1 from public.organization_responsibility_assignments assignment
          where assignment.configuration_id = configuration.id
            and assignment.employee_record_id = delegation.delegator_employee_record_id
        ))
      )
  )
  select exists (select 1 from directly_authorized)
    or exists (select 1 from delegated_authorized);
$$;

create or replace function app_private.can_read_work_handover_root(
  p_package_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.work_handover_packages package
    where package.id = p_package_id
      and (
        app_private.work_handover_actor_can_review(package.organization_id, p_actor_id)
        or (package.job_id is not null and exists (
          select 1 from public.job_assignments assignment
          where assignment.job_id = package.job_id
            and assignment.user_id = p_actor_id
        ))
      )
  );
$$;

create or replace function app_private.can_review_work_handover_package(
  p_package_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.work_handover_packages package
    where package.id = p_package_id
      and app_private.work_handover_actor_can_review(package.organization_id, p_actor_id)
  );
$$;

create or replace function app_private.guard_work_handover_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if coalesce(current_setting('app.work_handover_write', true), '') <> 'true'
  then raise exception 'work_handover_direct_write_forbidden'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app_private.prevent_work_handover_ledger_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'work_handover_history_is_immutable';
end;
$$;

create trigger work_handover_packages_write_guard
before insert or update or delete on public.work_handover_packages
for each row execute function app_private.guard_work_handover_write();
create trigger work_handover_draft_items_write_guard
before insert or update or delete on public.work_handover_draft_items
for each row execute function app_private.guard_work_handover_write();
create trigger work_handover_releases_immutable
before update or delete on public.work_handover_releases
for each row execute function app_private.prevent_work_handover_ledger_mutation();
create trigger work_handover_release_items_immutable
before update or delete on public.work_handover_release_items
for each row execute function app_private.prevent_work_handover_ledger_mutation();
create trigger work_handover_events_immutable
before update or delete on public.work_handover_events
for each row execute function app_private.prevent_work_handover_ledger_mutation();

alter table public.work_handover_packages enable row level security;
alter table public.work_handover_draft_items enable row level security;
alter table public.work_handover_releases enable row level security;
alter table public.work_handover_release_items enable row level security;
alter table public.work_handover_events enable row level security;

create policy "Authorized users can view work handover roots"
on public.work_handover_packages for select to authenticated
using (app_private.can_read_work_handover_root(id, (select auth.uid())));

create policy "Reviewers can view work handover drafts"
on public.work_handover_draft_items for select to authenticated
using (app_private.can_review_work_handover_package(package_id, (select auth.uid())));

create policy "Reviewers can view work handover releases"
on public.work_handover_releases for select to authenticated
using (app_private.can_review_work_handover_package(package_id, (select auth.uid())));

create policy "Reviewers can view work handover release items"
on public.work_handover_release_items for select to authenticated
using (exists (
  select 1 from public.work_handover_releases release
  where release.id = work_handover_release_items.release_id
    and app_private.can_review_work_handover_package(
      release.package_id, (select auth.uid())
    )
));

create policy "Reviewers can view work handover events"
on public.work_handover_events for select to authenticated
using (app_private.can_review_work_handover_package(package_id, (select auth.uid())));

alter table public.work_handover_packages replica identity full;
alter publication supabase_realtime add table public.work_handover_packages;

revoke all on function app_private.work_handover_actor_can_review(uuid, uuid)
from public, anon;
revoke all on function app_private.can_read_work_handover_root(uuid, uuid)
from public, anon;
revoke all on function app_private.can_review_work_handover_package(uuid, uuid)
from public, anon;
revoke all on function app_private.guard_work_handover_write()
from public, anon, authenticated;
revoke all on function app_private.prevent_work_handover_ledger_mutation()
from public, anon, authenticated;

grant execute on function app_private.work_handover_actor_can_review(uuid, uuid)
to authenticated, service_role;
grant execute on function app_private.can_read_work_handover_root(uuid, uuid)
to authenticated, service_role;
grant execute on function app_private.can_review_work_handover_package(uuid, uuid)
to authenticated, service_role;
grant execute on function app_private.guard_work_handover_write()
to service_role;
grant execute on function app_private.prevent_work_handover_ledger_mutation()
to service_role;
