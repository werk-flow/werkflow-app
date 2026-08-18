
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  dissolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_not_blank check (length(btrim(name)) between 1 and 120),
  constraint teams_description_length check (description is null or length(description) <= 1000)
);

create unique index teams_active_name_unique
  on public.teams (organization_id, lower(btrim(name)))
  where dissolved_at is null;
create index teams_organization_id_idx on public.teams (organization_id);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  valid_from date not null,
  valid_until date,
  created_by uuid references auth.users(id) on delete set null,
  ended_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_memberships_window_valid
    check (valid_until is null or valid_until >= valid_from),
  constraint team_memberships_no_overlap
    exclude using gist (
      team_id with =,
      employee_record_id with =,
      daterange(valid_from, coalesce(valid_until, 'infinity'::date), '[]') with &&
    )
);

create index team_memberships_organization_id_idx
  on public.team_memberships (organization_id);
create index team_memberships_employee_record_id_idx
  on public.team_memberships (employee_record_id);
create index team_memberships_team_id_idx
  on public.team_memberships (team_id);

create table public.team_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint team_events_type_not_blank check (length(btrim(event_type)) between 1 and 80)
);

create index team_events_team_created_idx
  on public.team_events (team_id, created_at desc);
create index team_events_organization_id_idx
  on public.team_events (organization_id);

create table public.organization_capabilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  name text not null,
  description text,
  default_expiry_warning_days integer not null default 30,
  retired_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_capabilities_kind_check
    check (kind in ('skill', 'certification')),
  constraint organization_capabilities_name_not_blank
    check (length(btrim(name)) between 1 and 160),
  constraint organization_capabilities_description_length
    check (description is null or length(description) <= 1000),
  constraint organization_capabilities_warning_days_check
    check (default_expiry_warning_days between 0 and 365),
  constraint organization_capabilities_skill_warning_disabled
    check (kind = 'certification' or default_expiry_warning_days = 0)
);

create unique index organization_capabilities_active_name_unique
  on public.organization_capabilities (organization_id, kind, lower(btrim(name)))
  where retired_at is null;
create index organization_capabilities_organization_id_idx
  on public.organization_capabilities (organization_id);

create table public.employee_capabilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  capability_id uuid not null references public.organization_capabilities(id) on delete restrict,
  capability_kind text not null,
  valid_from date not null,
  valid_until date,
  issuer text,
  renewal_due_date date,
  confirmation_status text not null default 'unconfirmed',
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  evidence_state text not null default 'not_required',
  operational_note text,
  supersedes_id uuid references public.employee_capabilities(id) on delete restrict,
  superseded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_capabilities_kind_check
    check (capability_kind in ('skill', 'certification')),
  constraint employee_capabilities_window_valid
    check (valid_until is null or valid_until >= valid_from),
  constraint employee_capabilities_renewal_date_valid
    check (renewal_due_date is null or renewal_due_date >= valid_from),
  constraint employee_capabilities_confirmation_check
    check (confirmation_status in ('unconfirmed', 'confirmed')),
  constraint employee_capabilities_confirmation_actor_check
    check (
      (confirmation_status = 'confirmed' and confirmed_by is not null and confirmed_at is not null)
      or
      (confirmation_status = 'unconfirmed' and confirmed_by is null and confirmed_at is null)
    ),
  constraint employee_capabilities_evidence_state_check
    check (evidence_state in ('not_required', 'pending', 'received')),
  constraint employee_capabilities_skill_fields_check
    check (
      capability_kind = 'certification'
      or (
        issuer is null
        and renewal_due_date is null
        and confirmation_status = 'unconfirmed'
        and confirmed_by is null
        and confirmed_at is null
        and evidence_state = 'not_required'
      )
    ),
  constraint employee_capabilities_issuer_length
    check (issuer is null or length(issuer) <= 200),
  constraint employee_capabilities_note_length
    check (operational_note is null or length(operational_note) <= 1000),
  constraint employee_capabilities_not_self_superseding
    check (supersedes_id is null or supersedes_id <> id),
  constraint employee_capabilities_skill_no_overlap
    exclude using gist (
      employee_record_id with =,
      capability_id with =,
      daterange(valid_from, coalesce(valid_until, 'infinity'::date), '[]') with &&
    )
    where (capability_kind = 'skill' and superseded_at is null)
);

create unique index employee_capabilities_supersedes_unique
  on public.employee_capabilities (supersedes_id)
  where supersedes_id is not null;
create index employee_capabilities_organization_id_idx
  on public.employee_capabilities (organization_id);
create index employee_capabilities_employee_record_id_idx
  on public.employee_capabilities (employee_record_id);
create index employee_capabilities_capability_id_idx
  on public.employee_capabilities (capability_id);
create index employee_capabilities_expiry_idx
  on public.employee_capabilities (organization_id, valid_until)
  where capability_kind = 'certification' and valid_until is not null and superseded_at is null;

create table public.organization_qualification_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  apprentice_warning_enabled boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.job_capability_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  capability_id uuid not null references public.organization_capabilities(id) on delete restrict,
  require_confirmation boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, capability_id)
);

create index job_capability_requirements_organization_id_idx
  on public.job_capability_requirements (organization_id);
create index job_capability_requirements_capability_id_idx
  on public.job_capability_requirements (capability_id);

create table public.qualification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  capability_id uuid references public.organization_capabilities(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint qualification_events_type_not_blank
    check (length(btrim(event_type)) between 1 and 80)
);

create index qualification_events_org_created_idx
  on public.qualification_events (organization_id, created_at desc);
create index qualification_events_capability_created_idx
  on public.qualification_events (capability_id, created_at desc);

create table public.job_qualification_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  assessed_for_date date not null,
  selected_user_ids uuid[] not null default '{}'::uuid[],
  selected_employee_record_ids uuid[] not null default '{}'::uuid[],
  requirements_snapshot jsonb not null default '[]'::jsonb,
  coverage_snapshot jsonb not null default '[]'::jsonb,
  coverage_fingerprint text not null,
  override_reason text,
  team_source_id uuid references public.teams(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint job_qualification_assessments_fingerprint_not_blank
    check (length(btrim(coverage_fingerprint)) between 1 and 256),
  constraint job_qualification_assessments_override_reason_length
    check (override_reason is null or length(btrim(override_reason)) between 3 and 500)
);

create index job_qualification_assessments_job_created_idx
  on public.job_qualification_assessments (job_id, created_at desc);
create index job_qualification_assessments_organization_id_idx
  on public.job_qualification_assessments (organization_id);

create or replace function app_private.validate_team_membership_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.teams t
    where t.id = new.team_id and t.organization_id = new.organization_id
  ) then
    raise exception 'team membership team organization mismatch';
  end if;
  if not exists (
    select 1 from public.employee_records er
    where er.id = new.employee_record_id and er.organization_id = new.organization_id
  ) then
    raise exception 'team membership employee organization mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_team_event_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.teams t
    where t.id = new.team_id and t.organization_id = new.organization_id
  ) then
    raise exception 'team event organization mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_employee_capability_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_kind text;
begin
  if not exists (
    select 1 from public.employee_records er
    where er.id = new.employee_record_id and er.organization_id = new.organization_id
  ) then
    raise exception 'employee capability employee organization mismatch';
  end if;

  select c.kind into stored_kind
  from public.organization_capabilities c
  where c.id = new.capability_id and c.organization_id = new.organization_id;

  if stored_kind is null then
    raise exception 'employee capability definition organization mismatch';
  end if;
  if stored_kind <> new.capability_kind then
    raise exception 'employee capability kind mismatch';
  end if;

  if new.supersedes_id is not null and not exists (
    select 1 from public.employee_capabilities previous
    where previous.id = new.supersedes_id
      and previous.organization_id = new.organization_id
      and previous.employee_record_id = new.employee_record_id
      and previous.capability_id = new.capability_id
      and previous.capability_kind = 'certification'
  ) then
    raise exception 'employee capability superseded record mismatch';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_job_capability_requirement_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  capability_kind text;
begin
  if not exists (
    select 1 from public.jobs j
    where j.id = new.job_id and j.organization_id = new.organization_id
  ) then
    raise exception 'job capability requirement job organization mismatch';
  end if;

  select c.kind into capability_kind
  from public.organization_capabilities c
  where c.id = new.capability_id and c.organization_id = new.organization_id
    and c.retired_at is null;

  if capability_kind is null then
    raise exception 'job capability requirement definition organization mismatch';
  end if;
  if new.require_confirmation and capability_kind <> 'certification' then
    raise exception 'skill requirements cannot require confirmation';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_qualification_event_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.capability_id is not null and not exists (
    select 1 from public.organization_capabilities c
    where c.id = new.capability_id and c.organization_id = new.organization_id
  ) then
    raise exception 'qualification event definition organization mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_job_qualification_assessment_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.jobs j
    where j.id = new.job_id and j.organization_id = new.organization_id
  ) then
    raise exception 'job qualification assessment job organization mismatch';
  end if;
  if new.team_source_id is not null and not exists (
    select 1 from public.teams t
    where t.id = new.team_source_id and t.organization_id = new.organization_id
  ) then
    raise exception 'job qualification assessment team organization mismatch';
  end if;
  if exists (
    select 1 from unnest(new.selected_user_ids) selected_user_id
    where not exists (
      select 1 from public.organization_members m
      where m.organization_id = new.organization_id and m.user_id = selected_user_id
    )
  ) then
    raise exception 'job qualification assessment user organization mismatch';
  end if;
  if exists (
    select 1 from unnest(new.selected_employee_record_ids) selected_record_id
    where not exists (
      select 1 from public.employee_records er
      where er.organization_id = new.organization_id and er.id = selected_record_id
    )
  ) then
    raise exception 'job qualification assessment employee organization mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.get_user_team_ids(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct tm.team_id
  from public.team_memberships tm
  join public.employee_records er
    on er.id = tm.employee_record_id
   and er.organization_id = tm.organization_id
  where er.user_id = p_user_id
    and tm.valid_from <= (now() at time zone 'Europe/Berlin')::date
    and (tm.valid_until is null or tm.valid_until >= (now() at time zone 'Europe/Berlin')::date);
$$;

create or replace function app_private.get_user_capability_ids(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ec.capability_id
  from public.employee_capabilities ec
  join public.employee_records er
    on er.id = ec.employee_record_id
   and er.organization_id = ec.organization_id
  where er.user_id = p_user_id;
$$;

revoke all on function app_private.get_user_team_ids(uuid) from public;
revoke all on function app_private.get_user_capability_ids(uuid) from public;
grant execute on function app_private.get_user_team_ids(uuid) to authenticated;
grant execute on function app_private.get_user_capability_ids(uuid) to authenticated;

create trigger validate_team_membership_org
before insert or update on public.team_memberships
for each row execute function app_private.validate_team_membership_org();

create trigger validate_team_event_org
before insert or update on public.team_events
for each row execute function app_private.validate_team_event_org();

create trigger validate_employee_capability_org
before insert or update on public.employee_capabilities
for each row execute function app_private.validate_employee_capability_org();

create trigger validate_job_capability_requirement_org
before insert or update on public.job_capability_requirements
for each row execute function app_private.validate_job_capability_requirement_org();

create trigger validate_qualification_event_org
before insert or update on public.qualification_events
for each row execute function app_private.validate_qualification_event_org();

create trigger validate_job_qualification_assessment_org
before insert or update on public.job_qualification_assessments
for each row execute function app_private.validate_job_qualification_assessment_org();

create trigger teams_set_updated_at
before update on public.teams
for each row execute function public.update_updated_at_column();
create trigger team_memberships_set_updated_at
before update on public.team_memberships
for each row execute function public.update_updated_at_column();
create trigger organization_capabilities_set_updated_at
before update on public.organization_capabilities
for each row execute function public.update_updated_at_column();
create trigger employee_capabilities_set_updated_at
before update on public.employee_capabilities
for each row execute function public.update_updated_at_column();
create trigger organization_qualification_settings_set_updated_at
before update on public.organization_qualification_settings
for each row execute function public.update_updated_at_column();
create trigger job_capability_requirements_set_updated_at
before update on public.job_capability_requirements
for each row execute function public.update_updated_at_column();

alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.team_events enable row level security;
alter table public.organization_capabilities enable row level security;
alter table public.employee_capabilities enable row level security;
alter table public.organization_qualification_settings enable row level security;
alter table public.job_capability_requirements enable row level security;
alter table public.qualification_events enable row level security;
alter table public.job_qualification_assessments enable row level security;

create policy "Managers and members can view permitted teams"
on public.teams for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or id in (
    select app_private.get_user_team_ids((select auth.uid()))
  )
);

create policy "Managers and users can view permitted team memberships"
on public.team_memberships for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or employee_record_id in (
    select app_private.get_user_employee_record_ids((select auth.uid()))
  )
);

create policy "Managers can view team events"
on public.team_events for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
);

create policy "Managers and users can view permitted capability definitions"
on public.organization_capabilities for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or id in (
    select app_private.get_user_capability_ids((select auth.uid()))
  )
);

create policy "Managers and users can view permitted employee capabilities"
on public.employee_capabilities for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or employee_record_id in (
    select app_private.get_user_employee_record_ids((select auth.uid()))
  )
);

create policy "Managers can view qualification settings"
on public.organization_qualification_settings for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
);

create policy "Managers can view job capability requirements"
on public.job_capability_requirements for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
);

create policy "Managers can view qualification events"
on public.qualification_events for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
);

create policy "Managers can view job qualification assessments"
on public.job_qualification_assessments for select to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
);

revoke all on public.teams from anon, authenticated;
revoke all on public.team_memberships from anon, authenticated;
revoke all on public.team_events from anon, authenticated;
revoke all on public.organization_capabilities from anon, authenticated;
revoke all on public.employee_capabilities from anon, authenticated;
revoke all on public.organization_qualification_settings from anon, authenticated;
revoke all on public.job_capability_requirements from anon, authenticated;
revoke all on public.qualification_events from anon, authenticated;
revoke all on public.job_qualification_assessments from anon, authenticated;

grant select on public.teams to authenticated;
grant select on public.team_memberships to authenticated;
grant select on public.team_events to authenticated;
grant select on public.organization_capabilities to authenticated;
grant select on public.employee_capabilities to authenticated;
grant select on public.organization_qualification_settings to authenticated;
grant select on public.job_capability_requirements to authenticated;
grant select on public.qualification_events to authenticated;
grant select on public.job_qualification_assessments to authenticated;

grant all on public.teams to service_role;
grant all on public.team_memberships to service_role;
grant all on public.team_events to service_role;
grant all on public.organization_capabilities to service_role;
grant all on public.employee_capabilities to service_role;
grant all on public.organization_qualification_settings to service_role;
grant all on public.job_capability_requirements to service_role;
grant all on public.qualification_events to service_role;
grant all on public.job_qualification_assessments to service_role;

alter table public.attention_read_states
  drop constraint attention_read_states_source_type_check;
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check
  check (source_type = any (array[
    'time_session_approval'::text,
    'time_change_request_approval'::text,
    'vacation_request_approval'::text,
    'client_request_open'::text,
    'vacation_decision'::text,
    'sickness_report'::text,
    'employee_certification_expiry'::text
  ]));

alter table public.attention_events
  drop constraint attention_events_source_type_check;
alter table public.attention_events
  add constraint attention_events_source_type_check
  check (source_type = any (array[
    'time_session_approval'::text,
    'time_change_request_approval'::text,
    'vacation_request_approval'::text,
    'client_request_open'::text,
    'vacation_decision'::text,
    'sickness_report'::text,
    'employee_certification_expiry'::text
  ]));

create or replace function app_private.validate_attention_source_org()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.user_id
  ) then
    raise exception 'attention state user is not a member of the organization';
  end if;

  if new.source_type in ('vacation_decision', 'vacation_request_approval') then
    if not exists (
      select 1 from public.vacation_requests vr
      where vr.id = new.source_id and vr.organization_id = new.organization_id
    ) then
      raise exception 'attention source vacation request organization mismatch';
    end if;
  elsif new.source_type = 'sickness_report' then
    if not exists (
      select 1 from public.sickness_reports sr
      where sr.id = new.source_id and sr.organization_id = new.organization_id
    ) then
      raise exception 'attention source sickness report organization mismatch';
    end if;
  elsif new.source_type = 'employee_certification_expiry' then
    if not exists (
      select 1 from public.employee_capabilities ec
      where ec.id = new.source_id
        and ec.organization_id = new.organization_id
        and ec.capability_kind = 'certification'
    ) then
      raise exception 'attention source employee certification organization mismatch';
    end if;
  elsif new.source_type = 'client_request_open' then
    if not exists (
      select 1 from public.client_requests cr
      where cr.id = new.source_id and cr.organization_id = new.organization_id
    ) then
      raise exception 'attention source client request organization mismatch';
    end if;
  elsif new.source_type = 'time_session_approval' then
    if not exists (
      select 1 from public.time_entries te
      where te.id = new.source_id and te.organization_id = new.organization_id
    ) then
      raise exception 'attention source time entry organization mismatch';
    end if;
  elsif new.source_type = 'time_change_request_approval' then
    if not exists (
      select 1 from public.entry_change_requests ecr
      where ecr.id = new.source_id and ecr.organization_id = new.organization_id
    ) then
      raise exception 'attention source change request organization mismatch';
    end if;
  end if;

  return new;
end;
$$;

alter table public.teams replica identity full;
alter table public.team_memberships replica identity full;
alter table public.organization_capabilities replica identity full;
alter table public.employee_capabilities replica identity full;
alter table public.organization_qualification_settings replica identity full;
alter table public.job_capability_requirements replica identity full;

alter publication supabase_realtime add table public.teams;
alter publication supabase_realtime add table public.team_memberships;
alter publication supabase_realtime add table public.organization_capabilities;
alter publication supabase_realtime add table public.employee_capabilities;
alter publication supabase_realtime add table public.organization_qualification_settings;
alter publication supabase_realtime add table public.job_capability_requirements;
