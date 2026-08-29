create type public.installed_equipment_category as enum (
  'heat_generation',
  'storage_and_hot_water',
  'ventilation',
  'solar_thermal',
  'water_and_sanitary_system',
  'system_component',
  'other'
);

create type public.installed_equipment_subtype as enum (
  'heat_pump',
  'gas_boiler',
  'oil_boiler',
  'biomass_boiler',
  'district_heat_interface',
  'combined_heat_power',
  'electric_heat_generator',
  'other_heat_generator',
  'domestic_hot_water_storage',
  'buffer_storage',
  'combined_storage',
  'fresh_water_station',
  'instantaneous_water_heater',
  'domestic_hot_water_heat_pump',
  'other_storage_or_hot_water',
  'central_ventilation_with_heat_recovery',
  'decentral_ventilation_with_heat_recovery',
  'exhaust_air_ventilation',
  'other_ventilation',
  'water_treatment',
  'pressure_boosting',
  'wastewater_lifting',
  'other_water_or_sanitary',
  'indoor_unit',
  'outdoor_unit',
  'burner',
  'pump',
  'controller_or_gateway',
  'collector',
  'other_component'
);

create type public.installed_equipment_state as enum (
  'unknown', 'active', 'inactive', 'removed', 'replaced', 'decommissioned'
);

create type public.installed_equipment_identifier_type as enum (
  'serial_number', 'manufacturer_product_number', 'operator_equipment_number', 'other'
);

create type public.installed_equipment_event_type as enum (
  'registered',
  'details_corrected',
  'installation_recorded',
  'commissioning_recorded',
  'warranty_recorded',
  'activated',
  'inactivated',
  'removed',
  'replaced',
  'decommissioned',
  'terminal_action_corrected',
  'archived',
  'archive_restored',
  'work_linked',
  'work_unlinked',
  'source_linked',
  'document_linked',
  'document_unlinked'
);

create unique index client_sites_id_client_org_unique
  on public.client_sites (id, client_id, organization_id);

create table public.installed_equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  site_id uuid not null,
  parent_equipment_id uuid,
  predecessor_equipment_id uuid,
  equipment_number text not null,
  name text not null,
  category public.installed_equipment_category not null,
  subtype public.installed_equipment_subtype,
  manufacturer text,
  model text,
  location_detail text,
  technical_notes text,
  state public.installed_equipment_state not null,
  installation_date date,
  commissioning_date date,
  warranty_provider text,
  warranty_basis text,
  warranty_start_date date,
  warranty_end_date date,
  version bigint not null default 1 check (version > 0),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  archive_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint installed_equipment_number_length check (
    length(btrim(equipment_number)) between 3 and 60
  ),
  constraint installed_equipment_name_length check (
    length(btrim(name)) between 2 and 160
  ),
  constraint installed_equipment_optional_text_lengths check (
    (manufacturer is null or length(btrim(manufacturer)) between 1 and 160)
    and (model is null or length(btrim(model)) between 1 and 160)
    and (location_detail is null or length(btrim(location_detail)) between 1 and 300)
    and (technical_notes is null or length(btrim(technical_notes)) between 1 and 4000)
    and (warranty_provider is null or length(btrim(warranty_provider)) between 1 and 200)
    and (warranty_basis is null or length(btrim(warranty_basis)) between 1 and 2000)
  ),
  constraint installed_equipment_component_shape check (
    (category = 'system_component' and parent_equipment_id is not null)
    or (category <> 'system_component' and parent_equipment_id is null)
  ),
  constraint installed_equipment_no_self_relations check (
    parent_equipment_id is distinct from id
    and predecessor_equipment_id is distinct from id
  ),
  constraint installed_equipment_warranty_dates check (
    warranty_start_date is null
    or warranty_end_date is null
    or warranty_end_date >= warranty_start_date
  ),
  constraint installed_equipment_archive_shape check (
    (
      archived_at is null
      and archived_by is null
      and archive_reason is null
    ) or (
      archived_at is not null
      and archived_by is not null
      and length(btrim(archive_reason)) between 3 and 1000
      and state in ('removed', 'replaced', 'decommissioned')
    )
  ),
  constraint installed_equipment_void_shape check (
    (
      voided_at is null
      and voided_by is null
      and void_reason is null
    ) or (
      voided_at is not null
      and voided_by is not null
      and length(btrim(void_reason)) between 3 and 1000
      and predecessor_equipment_id is not null
    )
  ),
  constraint installed_equipment_id_organization_key unique (id, organization_id),
  unique (id, organization_id, client_id, site_id),
  constraint installed_equipment_client_fk foreign key (client_id, organization_id)
    references public.clients(id, organization_id)
    on delete no action deferrable initially deferred,
  constraint installed_equipment_site_fk foreign key (site_id, client_id, organization_id)
    references public.client_sites(id, client_id, organization_id)
    on delete no action deferrable initially deferred
);

alter table public.installed_equipment
  add constraint installed_equipment_parent_fk foreign key (
    parent_equipment_id, organization_id, client_id, site_id
  ) references public.installed_equipment(id, organization_id, client_id, site_id)
  on delete no action deferrable initially deferred,
  add constraint installed_equipment_predecessor_fk foreign key (
    predecessor_equipment_id, organization_id, client_id, site_id
  ) references public.installed_equipment(id, organization_id, client_id, site_id)
  on delete no action deferrable initially deferred;

create unique index installed_equipment_number_per_org
  on public.installed_equipment (organization_id, lower(equipment_number));
create unique index installed_equipment_successor_per_predecessor
  on public.installed_equipment (organization_id, predecessor_equipment_id)
  where predecessor_equipment_id is not null and voided_at is null;
create index installed_equipment_client_site_idx
  on public.installed_equipment (organization_id, client_id, site_id, archived_at, state);
create index installed_equipment_parent_idx
  on public.installed_equipment (organization_id, parent_equipment_id)
  where parent_equipment_id is not null;
create index installed_equipment_search_idx
  on public.installed_equipment (
    organization_id, lower(name), lower(coalesce(manufacturer, '')), lower(coalesce(model, ''))
  );
create index installed_equipment_organization_fk_idx
  on public.installed_equipment (organization_id);
create index installed_equipment_client_fk_idx
  on public.installed_equipment (client_id, organization_id);
create index installed_equipment_site_fk_idx
  on public.installed_equipment (site_id, client_id, organization_id);
create index installed_equipment_parent_fk_idx
  on public.installed_equipment (
    parent_equipment_id, organization_id, client_id, site_id
  ) where parent_equipment_id is not null;
create index installed_equipment_predecessor_fk_idx
  on public.installed_equipment (
    predecessor_equipment_id, organization_id, client_id, site_id
  ) where predecessor_equipment_id is not null;
create index installed_equipment_archived_by_fk_idx
  on public.installed_equipment (archived_by) where archived_by is not null;
create index installed_equipment_voided_by_fk_idx
  on public.installed_equipment (voided_by) where voided_by is not null;
create index installed_equipment_created_by_fk_idx
  on public.installed_equipment (created_by);
create index installed_equipment_updated_by_fk_idx
  on public.installed_equipment (updated_by);

create table public.installed_equipment_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  equipment_id uuid not null,
  identifier_type public.installed_equipment_identifier_type not null,
  value text not null,
  normalized_value text generated always as (
    lower(regexp_replace(btrim(value), '[^[:alnum:]]+', '', 'g'))
  ) stored,
  issuer text,
  normalized_issuer text generated always as (
    nullif(lower(regexp_replace(btrim(issuer), '[^[:alnum:]]+', '', 'g')), '')
  ) stored,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint installed_equipment_identifier_value_length check (
    length(btrim(value)) between 1 and 200
    and (issuer is null or length(btrim(issuer)) between 1 and 160)
  ),
  unique (id, organization_id),
  foreign key (equipment_id, organization_id)
    references public.installed_equipment(id, organization_id) on delete cascade
);

create unique index installed_equipment_operator_identifier_unique
  on public.installed_equipment_identifiers (organization_id, normalized_value)
  where identifier_type = 'operator_equipment_number';
create unique index installed_equipment_serial_identifier_unique
  on public.installed_equipment_identifiers (
    organization_id, normalized_issuer, normalized_value
  ) where identifier_type = 'serial_number';
create unique index installed_equipment_identifier_per_equipment
  on public.installed_equipment_identifiers (
    equipment_id, identifier_type, normalized_issuer, normalized_value
  ) nulls not distinct;
create index installed_equipment_identifier_search_idx
  on public.installed_equipment_identifiers (organization_id, normalized_value);
create index installed_equipment_identifiers_created_by_fk_idx
  on public.installed_equipment_identifiers (created_by);

create table public.installed_equipment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  equipment_id uuid not null,
  event_type public.installed_equipment_event_type not null,
  from_state public.installed_equipment_state,
  to_state public.installed_equipment_state,
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  request_operation text not null,
  idempotency_key uuid not null,
  corrects_event_id uuid,
  site_snapshot jsonb not null,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  constraint installed_equipment_event_reason_length check (
    reason is null or length(btrim(reason)) between 3 and 1000
  ),
  constraint installed_equipment_event_operation_length check (
    length(btrim(request_operation)) between 3 and 80
  ),
  constraint installed_equipment_event_state_change check (
    (from_state is null and to_state is not null)
    or (from_state is not null and to_state is not null)
    or event_type in ('work_linked', 'work_unlinked', 'source_linked', 'document_linked', 'document_unlinked')
  ),
  unique (id, organization_id),
  unique (organization_id, equipment_id, request_operation, idempotency_key),
  foreign key (equipment_id, organization_id)
    references public.installed_equipment(id, organization_id) on delete cascade,
  foreign key (corrects_event_id, organization_id)
    references public.installed_equipment_events(id, organization_id)
    on delete no action deferrable initially deferred
);

create index installed_equipment_events_equipment_idx
  on public.installed_equipment_events (equipment_id, effective_at desc, recorded_at desc);
create index installed_equipment_events_organization_fk_idx
  on public.installed_equipment_events (organization_id);
create index installed_equipment_events_actor_fk_idx
  on public.installed_equipment_events (actor_id);
create index installed_equipment_events_correction_fk_idx
  on public.installed_equipment_events (corrects_event_id)
  where corrects_event_id is not null;

create table public.installed_equipment_event_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null,
  job_id uuid,
  project_id uuid,
  work_artifact_revision_id uuid,
  work_handover_release_id uuid,
  document_id uuid,
  document_version_number integer,
  document_storage_path text,
  created_at timestamptz not null default now(),
  constraint installed_equipment_event_link_one_target check (
    num_nonnulls(job_id, project_id, work_artifact_revision_id,
      work_handover_release_id, document_id) = 1
  ),
  constraint installed_equipment_event_link_document_shape check (
    (document_id is null and document_version_number is null and document_storage_path is null)
    or (document_id is not null and document_version_number > 0
      and length(btrim(document_storage_path)) between 1 and 1000)
  ),
  unique (id, organization_id),
  foreign key (event_id, organization_id)
    references public.installed_equipment_events(id, organization_id) on delete cascade,
  foreign key (job_id, organization_id)
    references public.jobs(id, organization_id) on delete no action deferrable initially deferred,
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete no action deferrable initially deferred,
  foreign key (work_artifact_revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id)
    on delete no action deferrable initially deferred,
  foreign key (work_handover_release_id, organization_id)
    references public.work_handover_releases(id, organization_id)
    on delete no action deferrable initially deferred,
  foreign key (document_id, organization_id)
    references public.documents(id, organization_id)
    on delete no action deferrable initially deferred
);

create index installed_equipment_event_links_event_idx
  on public.installed_equipment_event_links (event_id);
create index installed_equipment_event_links_job_idx
  on public.installed_equipment_event_links (job_id) where job_id is not null;
create index installed_equipment_event_links_project_idx
  on public.installed_equipment_event_links (project_id) where project_id is not null;
create index installed_equipment_event_links_artifact_idx
  on public.installed_equipment_event_links (work_artifact_revision_id)
  where work_artifact_revision_id is not null;
create index installed_equipment_event_links_handover_idx
  on public.installed_equipment_event_links (work_handover_release_id)
  where work_handover_release_id is not null;
create index installed_equipment_event_links_document_idx
  on public.installed_equipment_event_links (document_id)
  where document_id is not null;
create index installed_equipment_event_links_organization_fk_idx
  on public.installed_equipment_event_links (organization_id);

create table public.installed_equipment_work_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  equipment_id uuid not null,
  job_id uuid,
  project_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint installed_equipment_work_link_one_target check (
    num_nonnulls(job_id, project_id) = 1
  ),
  unique (id, organization_id),
  foreign key (equipment_id, organization_id)
    references public.installed_equipment(id, organization_id) on delete cascade,
  foreign key (job_id, organization_id)
    references public.jobs(id, organization_id) on delete no action deferrable initially deferred,
  foreign key (project_id, organization_id)
    references public.projects(id, organization_id) on delete no action deferrable initially deferred
);

create unique index installed_equipment_work_link_job_unique
  on public.installed_equipment_work_links (equipment_id, job_id)
  where job_id is not null;
create unique index installed_equipment_work_link_project_unique
  on public.installed_equipment_work_links (equipment_id, project_id)
  where project_id is not null;
create index installed_equipment_work_links_job_idx
  on public.installed_equipment_work_links (job_id) where job_id is not null;
create index installed_equipment_work_links_project_idx
  on public.installed_equipment_work_links (project_id) where project_id is not null;
create index installed_equipment_work_links_organization_fk_idx
  on public.installed_equipment_work_links (organization_id);
create index installed_equipment_work_links_created_by_fk_idx
  on public.installed_equipment_work_links (created_by);

create or replace function app_private.installed_equipment_actor_is_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
      and member.role in ('admin', 'buero')
  );
$$;

create or replace function app_private.validate_installed_equipment()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_parent public.installed_equipment%rowtype;
  v_predecessor public.installed_equipment%rowtype;
begin
  if new.category = 'heat_generation' and new.subtype is not null and new.subtype not in (
    'heat_pump', 'gas_boiler', 'oil_boiler', 'biomass_boiler',
    'district_heat_interface', 'combined_heat_power', 'electric_heat_generator',
    'other_heat_generator'
  ) then raise exception 'installed_equipment_subtype_category_mismatch'; end if;

  if new.category = 'storage_and_hot_water' and new.subtype is not null and new.subtype not in (
    'domestic_hot_water_storage', 'buffer_storage', 'combined_storage',
    'fresh_water_station', 'instantaneous_water_heater',
    'domestic_hot_water_heat_pump', 'other_storage_or_hot_water'
  ) then raise exception 'installed_equipment_subtype_category_mismatch'; end if;

  if new.category = 'ventilation' and new.subtype is not null and new.subtype not in (
    'central_ventilation_with_heat_recovery',
    'decentral_ventilation_with_heat_recovery', 'exhaust_air_ventilation',
    'other_ventilation'
  ) then raise exception 'installed_equipment_subtype_category_mismatch'; end if;

  if new.category = 'water_and_sanitary_system' and new.subtype is not null and new.subtype not in (
    'water_treatment', 'pressure_boosting', 'wastewater_lifting',
    'other_water_or_sanitary'
  ) then raise exception 'installed_equipment_subtype_category_mismatch'; end if;

  if new.category = 'system_component' and new.subtype is not null and new.subtype not in (
    'indoor_unit', 'outdoor_unit', 'burner', 'pump', 'controller_or_gateway',
    'collector', 'other_component'
  ) then raise exception 'installed_equipment_subtype_category_mismatch'; end if;

  if new.category in ('solar_thermal', 'other') and new.subtype is not null then
    raise exception 'installed_equipment_subtype_category_mismatch';
  end if;

  if new.parent_equipment_id is not null then
    select * into v_parent from public.installed_equipment parent
    where parent.id = new.parent_equipment_id
      and parent.organization_id = new.organization_id
      and parent.client_id = new.client_id
      and parent.site_id = new.site_id;
    if not found or v_parent.parent_equipment_id is not null
       or v_parent.category = 'system_component' then
      raise exception 'installed_equipment_parent_invalid';
    end if;
  end if;

  if new.predecessor_equipment_id is not null then
    select * into v_predecessor from public.installed_equipment predecessor
    where predecessor.id = new.predecessor_equipment_id
      and predecessor.organization_id = new.organization_id
      and predecessor.client_id = new.client_id
      and predecessor.site_id = new.site_id;
    if not found or v_predecessor.state <> 'replaced' then
      raise exception 'installed_equipment_predecessor_invalid';
    end if;
    if exists (
      with recursive ancestors as (
        select v_predecessor.predecessor_equipment_id as id
        union all
        select equipment.predecessor_equipment_id
        from public.installed_equipment equipment
        join ancestors on equipment.id = ancestors.id
        where equipment.predecessor_equipment_id is not null
      ) select 1 from ancestors where id = new.id
    ) then raise exception 'installed_equipment_replacement_cycle'; end if;
  end if;

  return new;
end;
$$;

create trigger installed_equipment_validate
before insert or update on public.installed_equipment
for each row execute function app_private.validate_installed_equipment();

create or replace function app_private.guard_installed_equipment_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if coalesce(current_setting('app.installed_equipment_write', true), '') <> 'true' then
    raise exception 'installed_equipment_direct_write_forbidden';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app_private.prevent_installed_equipment_history_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'installed_equipment_history_is_immutable';
end;
$$;

create or replace function app_private.validate_installed_equipment_event_link()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.installed_equipment_events%rowtype;
begin
  select * into v_event from public.installed_equipment_events event
  where event.id = new.event_id and event.organization_id = new.organization_id;
  if not found then raise exception 'installed_equipment_event_link_event_invalid'; end if;

  if new.document_id is not null and not (
    exists (
      select 1 from public.documents document
      where document.id = new.document_id
        and document.organization_id = new.organization_id
        and document.current_version_number = new.document_version_number
        and document.storage_path = new.document_storage_path
    ) or exists (
      select 1 from public.document_versions version
      where version.document_id = new.document_id
        and version.organization_id = new.organization_id
        and version.version_number = new.document_version_number
        and version.storage_path = new.document_storage_path
    )
  ) then raise exception 'installed_equipment_document_version_invalid'; end if;

  return new;
end;
$$;

create trigger installed_equipment_write_guard
before insert or update or delete on public.installed_equipment
for each row execute function app_private.guard_installed_equipment_write();
create trigger installed_equipment_identifiers_write_guard
before insert or update or delete on public.installed_equipment_identifiers
for each row execute function app_private.guard_installed_equipment_write();
create trigger installed_equipment_work_links_write_guard
before insert or update or delete on public.installed_equipment_work_links
for each row execute function app_private.guard_installed_equipment_write();
create trigger installed_equipment_events_immutable
before update or delete on public.installed_equipment_events
for each row execute function app_private.prevent_installed_equipment_history_mutation();
create trigger installed_equipment_event_links_validate
before insert on public.installed_equipment_event_links
for each row execute function app_private.validate_installed_equipment_event_link();
create trigger installed_equipment_event_links_immutable
before update or delete on public.installed_equipment_event_links
for each row execute function app_private.prevent_installed_equipment_history_mutation();

alter table public.installed_equipment enable row level security;
alter table public.installed_equipment_identifiers enable row level security;
alter table public.installed_equipment_events enable row level security;
alter table public.installed_equipment_event_links enable row level security;
alter table public.installed_equipment_work_links enable row level security;

create policy "Managers can view installed equipment"
on public.installed_equipment for select to authenticated
using (app_private.installed_equipment_actor_is_manager(
  organization_id, (select auth.uid())
));

create policy "Managers can view installed equipment identifiers"
on public.installed_equipment_identifiers for select to authenticated
using (app_private.installed_equipment_actor_is_manager(
  organization_id, (select auth.uid())
));

create policy "Managers can view installed equipment events"
on public.installed_equipment_events for select to authenticated
using (app_private.installed_equipment_actor_is_manager(
  organization_id, (select auth.uid())
));

create policy "Managers can view installed equipment event links"
on public.installed_equipment_event_links for select to authenticated
using (app_private.installed_equipment_actor_is_manager(
  organization_id, (select auth.uid())
));

create policy "Managers can view installed equipment work links"
on public.installed_equipment_work_links for select to authenticated
using (app_private.installed_equipment_actor_is_manager(
  organization_id, (select auth.uid())
));

grant select on table public.installed_equipment to authenticated;
grant select on table public.installed_equipment_identifiers to authenticated;
grant select on table public.installed_equipment_events to authenticated;
grant select on table public.installed_equipment_event_links to authenticated;
grant select on table public.installed_equipment_work_links to authenticated;

grant all on table public.installed_equipment to service_role;
grant all on table public.installed_equipment_identifiers to service_role;
grant all on table public.installed_equipment_events to service_role;
grant all on table public.installed_equipment_event_links to service_role;
grant all on table public.installed_equipment_work_links to service_role;

alter table public.installed_equipment
  replica identity using index installed_equipment_id_organization_key;
alter publication supabase_realtime add table public.installed_equipment;

revoke all on function app_private.installed_equipment_actor_is_manager(uuid, uuid)
from public, anon;
revoke all on function app_private.validate_installed_equipment()
from public, anon, authenticated;
revoke all on function app_private.guard_installed_equipment_write()
from public, anon, authenticated;
revoke all on function app_private.prevent_installed_equipment_history_mutation()
from public, anon, authenticated;
revoke all on function app_private.validate_installed_equipment_event_link()
from public, anon, authenticated;

grant execute on function app_private.installed_equipment_actor_is_manager(uuid, uuid)
to authenticated, service_role;
grant execute on function app_private.validate_installed_equipment()
to service_role;
grant execute on function app_private.guard_installed_equipment_write()
to service_role;
grant execute on function app_private.prevent_installed_equipment_history_mutation()
to service_role;
grant execute on function app_private.validate_installed_equipment_event_link()
to service_role;
