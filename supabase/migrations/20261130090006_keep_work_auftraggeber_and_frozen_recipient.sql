-- Work keeps its Auftraggeber and its frozen Rechnungsempfänger
-- (werk-flow/werkflow-planning#327).
--
-- Each request, job, project and Servicefall records who commissioned it
-- (the Auftraggeber) and who receives the invoice (the Rechnungsempfänger),
-- both customers of the organization. The recipient's name and main address
-- are copied when it is set, so a later customer edit never rewrites who was
-- to be billed. Offers (werk-flow/werkflow-planning#16) read this copy.
--
-- 1. work_billing_parties: one row per version, append-only. The newest
--    version of a work is its current one; the older ones are its history.
-- 2. Defaults: a trigger on each work table records the first version when
--    the work has a customer: the Auftraggeber is the work's customer; the
--    recipient is the Objekt's current Rechnungsempfänger, else the
--    Auftraggeber. A job of a project takes the project's chosen parties.
--    While the parties are defaults, a changed site derives them again. A
--    changed customer always derives them again.
-- 3. Carry: a conversion carries the request's chosen parties to the new
--    work, with their copy.
-- 4. set_work_billing_parties: the office chooses both per work.
-- 5. get_work_billing_parties: the office's read, with the Einsatzort and its
--    access contacts.
-- 6. The delete guard counts a customer that is Auftraggeber or recipient of
--    another customer's work as linked.
--
-- Division of work: the server actions in lib/billing-parties/ establish
-- identity, the manager role and the organization, and pass them. The write
-- function checks the actor's membership again.
--
-- Expand-only: a new table, new functions and triggers; the previous release
-- reads and writes none of them. Its deletion dialog shows the new link kind
-- without a label.
--
-- Prevention: Tier 1 (constraints, triggers, the ledger guard), Tier 2
-- supabase/tests/work_billing_parties.sql.

create table public.work_billing_parties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  request_id uuid references public.client_requests (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  service_case_id uuid,
  work_id uuid generated always as (coalesce(request_id, job_id, project_id, service_case_id)) stored,
  -- 1 for the first version of a work, one more for each change.
  version integer not null,
  -- The Auftraggeber.
  client_id uuid not null,
  -- The Rechnungsempfänger, and its name and main address when it was set.
  recipient_client_id uuid not null,
  recipient_name text not null,
  recipient_address text,
  -- objekt: the Objekt's Rechnungsempfänger; auftraggeber: the Auftraggeber;
  -- projekt and anfrage: carried from the project or the request; buero:
  -- chosen by the office. Only objekt and auftraggeber follow a changed site.
  source text not null,
  set_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint work_billing_parties_one_work check (
    num_nonnulls(request_id, job_id, project_id, service_case_id) = 1
  ),
  constraint work_billing_parties_source_check check (
    source in ('objekt', 'auftraggeber', 'projekt', 'anfrage', 'buero')
  ),
  constraint work_billing_parties_version_check check (version >= 1),
  constraint work_billing_parties_service_case_fk foreign key (service_case_id, organization_id)
    references public.service_cases (id, organization_id) on delete cascade,
  -- A customer named here is linked (app_private.client_links), so the delete
  -- guard refuses its deletion first.
  constraint work_billing_parties_client_fk foreign key (client_id, organization_id)
    references public.clients (id, organization_id),
  constraint work_billing_parties_recipient_fk foreign key (recipient_client_id, organization_id)
    references public.clients (id, organization_id),
  constraint work_billing_parties_one_version unique (work_id, version)
);

create index work_billing_parties_request_idx on public.work_billing_parties (request_id) where request_id is not null;
create index work_billing_parties_job_idx on public.work_billing_parties (job_id) where job_id is not null;
create index work_billing_parties_project_idx on public.work_billing_parties (project_id) where project_id is not null;
create index work_billing_parties_service_case_idx
  on public.work_billing_parties (service_case_id, organization_id) where service_case_id is not null;
create index work_billing_parties_client_idx on public.work_billing_parties (client_id, organization_id);
create index work_billing_parties_recipient_idx on public.work_billing_parties (recipient_client_id, organization_id);
create index work_billing_parties_org_idx on public.work_billing_parties (organization_id);
create index work_billing_parties_set_by_idx on public.work_billing_parties (set_by);

-- History is append-only, also for privileged roles; the cascade of a
-- deleted work or organization and a deleted account's actor still apply.
create trigger guard_event_ledger_history
  before update or delete on public.work_billing_parties
  for each row execute function app_private.guard_event_ledger_history();

-- RLS without a policy: client roles see no row even if a grant appeared
-- later. A field worker never reads the recipient.
alter table public.work_billing_parties enable row level security;
revoke all on table public.work_billing_parties from public, anon, authenticated, service_role;
grant select, insert on table public.work_billing_parties to service_role;

-- The current version of one work.
create function app_private.current_work_billing_parties(p_work_id uuid)
returns public.work_billing_parties
language sql
stable
security invoker
set search_path to ''
as $$
  select * from public.work_billing_parties party
  where party.work_id = p_work_id
  order by party.version desc
  limit 1;
$$;
revoke all on function app_private.current_work_billing_parties(uuid) from public, anon, authenticated;
grant execute on function app_private.current_work_billing_parties(uuid) to service_role;

-- Records a new version of one work's parties unless it names the same
-- Auftraggeber and recipient with the same copy as the current one. Without
-- p_recipient_name the copy is taken from the recipient customer now.
create function app_private.record_work_billing_parties(
  p_organization_id uuid,
  p_kind text,
  p_work_id uuid,
  p_client_id uuid,
  p_recipient_client_id uuid,
  p_source text,
  p_actor_id uuid,
  p_recipient_name text default null,
  p_recipient_address text default null
)
returns public.work_billing_parties
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_current public.work_billing_parties := app_private.current_work_billing_parties(p_work_id);
  v_name text := p_recipient_name;
  v_address text := p_recipient_address;
  v_party public.work_billing_parties;
begin
  if p_recipient_name is null then
    select recipient.name, recipient.address into v_name, v_address
    from public.clients recipient
    where recipient.id = p_recipient_client_id and recipient.organization_id = p_organization_id;
  end if;
  if v_current.id is not null
    and v_current.client_id = p_client_id
    and v_current.recipient_client_id = p_recipient_client_id
    and v_current.recipient_name is not distinct from v_name
    and v_current.recipient_address is not distinct from v_address
  then
    return v_current;
  end if;
  insert into public.work_billing_parties (
    organization_id, request_id, job_id, project_id, service_case_id, version,
    client_id, recipient_client_id, recipient_name, recipient_address, source, set_by
  ) values (
    p_organization_id,
    case when p_kind = 'request' then p_work_id end,
    case when p_kind = 'job' then p_work_id end,
    case when p_kind = 'project' then p_work_id end,
    case when p_kind = 'service_case' then p_work_id end,
    coalesce(v_current.version, 0) + 1,
    p_client_id, p_recipient_client_id, v_name, v_address, p_source, p_actor_id
  )
  returning * into v_party;
  return v_party;
end;
$$;
revoke all on function app_private.record_work_billing_parties(uuid, text, uuid, uuid, uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function app_private.record_work_billing_parties(uuid, text, uuid, uuid, uuid, text, uuid, text, text)
  to service_role;

-- 2. The default parties of a work with a customer: a job of a project takes
-- the project's chosen parties; otherwise the Auftraggeber is the customer
-- and the recipient the Objekt's current Rechnungsempfänger (an archived
-- holder is skipped), else the Auftraggeber. Derived versions name no actor;
-- a carried one names the work's creator. Definer rights, because the
-- trigger runs for whichever role writes the work.
create function app_private.keep_work_billing_parties()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_kind text := case tg_table_name
    when 'client_requests' then 'request'
    when 'jobs' then 'job'
    when 'projects' then 'project'
    else 'service_case' end;
  v_current public.work_billing_parties;
  v_carried public.work_billing_parties;
  v_recipient_id uuid;
  v_actor_id uuid;
begin
  if new.client_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    v_current := app_private.current_work_billing_parties(new.id);
    -- A changed site keeps parties the office chose or that were carried.
    if old.client_id is not distinct from new.client_id and v_current.id is not null
      and v_current.source not in ('objekt', 'auftraggeber')
    then
      return null;
    end if;
  else
    v_actor_id := new.created_by;
  end if;

  -- 3. A Servicefall from a request carries the request's chosen parties.
  -- NEW has these columns only on its own table, so each read sits in its
  -- table's branch.
  if v_kind = 'service_case' and tg_op = 'INSERT' then
    if new.source_request_id is not null then
      v_carried := app_private.current_work_billing_parties(new.source_request_id);
      if v_carried.id is not null and v_carried.source not in ('objekt', 'auftraggeber')
        and exists (select 1 from public.client_requests request
          where request.id = new.source_request_id and request.client_id = new.client_id)
      then
        perform app_private.record_work_billing_parties(new.organization_id, v_kind, new.id,
          v_carried.client_id, v_carried.recipient_client_id, 'anfrage', v_actor_id,
          v_carried.recipient_name, v_carried.recipient_address);
        return null;
      end if;
    end if;
  elsif v_kind = 'job' then
    if new.project_id is not null then
      v_carried := app_private.current_work_billing_parties(new.project_id);
      if v_carried.id is not null and v_carried.source not in ('objekt', 'auftraggeber')
        and exists (select 1 from public.projects project
          where project.id = new.project_id and project.client_id = new.client_id)
      then
        perform app_private.record_work_billing_parties(new.organization_id, v_kind, new.id,
          v_carried.client_id, v_carried.recipient_client_id, 'projekt', v_actor_id,
          v_carried.recipient_name, v_carried.recipient_address);
        return null;
      end if;
    end if;
  end if;

  if new.site_id is not null then
    select role.holder_client_id into v_recipient_id
    from public.client_site_roles role
    join public.clients holder
      on holder.id = role.holder_client_id and holder.organization_id = new.organization_id
    where role.organization_id = new.organization_id and role.site_id = new.site_id
      and role.role = 'rechnungsempfaenger' and holder.archived_at is null
      and (role.starts_on is null or role.starts_on <= (now() at time zone 'Europe/Berlin')::date)
      and (role.ends_on is null or role.ends_on >= (now() at time zone 'Europe/Berlin')::date);
  end if;
  perform app_private.record_work_billing_parties(new.organization_id, v_kind, new.id,
    new.client_id, coalesce(v_recipient_id, new.client_id),
    case when v_recipient_id is null then 'auftraggeber' else 'objekt' end, null);
  return null;
end;
$$;
revoke all on function app_private.keep_work_billing_parties() from public, anon, authenticated;

create trigger keep_work_billing_parties after insert on public.client_requests
  for each row execute function app_private.keep_work_billing_parties();
create trigger keep_work_billing_parties_on_change after update of client_id, site_id on public.client_requests
  for each row when (old.client_id is distinct from new.client_id or old.site_id is distinct from new.site_id)
  execute function app_private.keep_work_billing_parties();
create trigger keep_work_billing_parties after insert on public.jobs
  for each row execute function app_private.keep_work_billing_parties();
create trigger keep_work_billing_parties_on_change after update of client_id, site_id on public.jobs
  for each row when (old.client_id is distinct from new.client_id or old.site_id is distinct from new.site_id)
  execute function app_private.keep_work_billing_parties();
create trigger keep_work_billing_parties after insert on public.projects
  for each row execute function app_private.keep_work_billing_parties();
create trigger keep_work_billing_parties_on_change after update of client_id, site_id on public.projects
  for each row when (old.client_id is distinct from new.client_id or old.site_id is distinct from new.site_id)
  execute function app_private.keep_work_billing_parties();
create trigger keep_work_billing_parties after insert on public.service_cases
  for each row execute function app_private.keep_work_billing_parties();
create trigger keep_work_billing_parties_on_change after update of client_id, site_id on public.service_cases
  for each row when (old.client_id is distinct from new.client_id or old.site_id is distinct from new.site_id)
  execute function app_private.keep_work_billing_parties();

-- 3. A conversion into a job or project carries the request's chosen parties
-- to the new work, with their copy, when both have the same customer.
create function app_private.carry_request_billing_parties()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_kind text;
  v_work_id uuid;
  v_work_client_id uuid;
  v_request_parties public.work_billing_parties := app_private.current_work_billing_parties(new.id);
begin
  if v_request_parties.id is null or v_request_parties.source in ('objekt', 'auftraggeber') then
    return null;
  end if;
  if old.converted_job_id is null and new.converted_job_id is not null then
    v_kind := 'job';
    v_work_id := new.converted_job_id;
    select job.client_id into v_work_client_id from public.jobs job where job.id = v_work_id;
  elsif old.converted_project_id is null and new.converted_project_id is not null then
    v_kind := 'project';
    v_work_id := new.converted_project_id;
    select project.client_id into v_work_client_id from public.projects project where project.id = v_work_id;
  else
    return null;
  end if;
  if v_work_client_id is distinct from new.client_id then
    return null;
  end if;
  perform app_private.record_work_billing_parties(new.organization_id, v_kind, v_work_id,
    v_request_parties.client_id, v_request_parties.recipient_client_id, 'anfrage', new.converted_by,
    v_request_parties.recipient_name, v_request_parties.recipient_address);
  return null;
end;
$$;
revoke all on function app_private.carry_request_billing_parties() from public, anon, authenticated;

create trigger carry_request_billing_parties
  after update of converted_job_id, converted_project_id on public.client_requests
  for each row execute function app_private.carry_request_billing_parties();

-- The defaults for the work that exists already.
insert into public.work_billing_parties (
  organization_id, request_id, job_id, project_id, service_case_id, version,
  client_id, recipient_client_id, recipient_name, recipient_address, source
)
select work.organization_id, work.request_id, work.job_id, work.project_id, work.service_case_id, 1,
  work.client_id, recipient.id, recipient.name, recipient.address,
  case when payer.holder_client_id is null then 'auftraggeber' else 'objekt' end
from (
  select request.organization_id, request.id as request_id, null::uuid as job_id, null::uuid as project_id,
    null::uuid as service_case_id, request.client_id, request.site_id
  from public.client_requests request where request.client_id is not null
  union all
  select job.organization_id, null, job.id, null, null, job.client_id, job.site_id
  from public.jobs job where job.client_id is not null
  union all
  select project.organization_id, null, null, project.id, null, project.client_id, project.site_id
  from public.projects project where project.client_id is not null
  union all
  select service_case.organization_id, null, null, null, service_case.id, service_case.client_id,
    service_case.site_id
  from public.service_cases service_case
) work
left join lateral (
  select role.holder_client_id
  from public.client_site_roles role
  join public.clients holder on holder.id = role.holder_client_id and holder.organization_id = work.organization_id
  where work.site_id is not null and role.organization_id = work.organization_id and role.site_id = work.site_id
    and role.role = 'rechnungsempfaenger' and holder.archived_at is null
    and (role.starts_on is null or role.starts_on <= (now() at time zone 'Europe/Berlin')::date)
    and (role.ends_on is null or role.ends_on >= (now() at time zone 'Europe/Berlin')::date)
) payer on true
join public.clients recipient
  on recipient.id = coalesce(payer.holder_client_id, work.client_id) and recipient.organization_id = work.organization_id;

-- 4. The office chooses the Auftraggeber and the recipient of one work. A
-- request takes them only while it is open. Saving the same customers again
-- copies the recipient's current name and address when they changed, and
-- writes nothing when they did not. Returns the current version.
-- Refusals: invalid_input, not_authorized, work_not_found,
-- request_not_editable, client_required, client_not_found,
-- recipient_not_found, client_archived.
create function public.set_work_billing_parties(
  p_actor_id uuid,
  p_organization_id uuid,
  p_kind text,
  p_work_id uuid,
  p_client_id uuid,
  p_recipient_client_id uuid
)
returns public.work_billing_parties
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_work_client_id uuid;
  v_request_status public.request_status;
  v_current public.work_billing_parties;
  v_archived boolean;
begin
  if p_actor_id is null or p_organization_id is null or p_work_id is null
    or p_client_id is null or p_recipient_client_id is null
    or p_kind is null or p_kind not in ('request', 'job', 'project', 'service_case')
  then
    raise exception 'invalid_input';
  end if;
  -- The membership holds until commit: a removal waits for this call or makes it refuse.
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
    and member.role in ('admin', 'buero')
  for share;
  if not found then
    raise exception 'not_authorized';
  end if;

  -- The work row is locked, so concurrent choices take turns.
  if p_kind = 'request' then
    select request.client_id, request.status into v_work_client_id, v_request_status
    from public.client_requests request
    where request.organization_id = p_organization_id and request.id = p_work_id
    for update;
  elsif p_kind = 'job' then
    select job.client_id into v_work_client_id from public.jobs job
    where job.organization_id = p_organization_id and job.id = p_work_id
    for update;
  elsif p_kind = 'project' then
    select project.client_id into v_work_client_id from public.projects project
    where project.organization_id = p_organization_id and project.id = p_work_id
    for update;
  else
    select service_case.client_id into v_work_client_id from public.service_cases service_case
    where service_case.organization_id = p_organization_id and service_case.id = p_work_id
    for update;
  end if;
  if not found then
    raise exception 'work_not_found';
  end if;
  if p_kind = 'request' and v_request_status not in ('offen', 'in_klaerung') then
    raise exception 'request_not_editable';
  end if;
  if v_work_client_id is null then
    raise exception 'client_required';
  end if;

  v_current := app_private.current_work_billing_parties(p_work_id);
  select client.archived_at is not null into v_archived from public.clients client
  where client.id = p_client_id and client.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'client_not_found';
  end if;
  if v_archived and p_client_id is distinct from v_current.client_id then
    raise exception 'client_archived';
  end if;
  select client.archived_at is not null into v_archived from public.clients client
  where client.id = p_recipient_client_id and client.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'recipient_not_found';
  end if;
  if v_archived and p_recipient_client_id is distinct from v_current.recipient_client_id then
    raise exception 'client_archived';
  end if;

  v_current := app_private.record_work_billing_parties(p_organization_id, p_kind, p_work_id,
    p_client_id, p_recipient_client_id, 'buero', p_actor_id);

  -- The work changed: its published row signals its open views.
  if p_kind = 'request' then
    update public.client_requests request set updated_at = now()
    where request.organization_id = p_organization_id and request.id = p_work_id;
  elsif p_kind = 'job' then
    update public.jobs job set updated_at = now()
    where job.organization_id = p_organization_id and job.id = p_work_id;
  elsif p_kind = 'project' then
    update public.projects project set updated_at = now()
    where project.organization_id = p_organization_id and project.id = p_work_id;
  else
    perform set_config('app.service_case_write', 'true', true);
    update public.service_cases service_case set updated_at = now(), updated_by = p_actor_id
    where service_case.organization_id = p_organization_id and service_case.id = p_work_id;
    perform set_config('app.service_case_write', 'false', true);
  end if;
  return v_current;
end;
$$;
revoke all on function public.set_work_billing_parties(uuid, uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_work_billing_parties(uuid, uuid, text, uuid, uuid, uuid) to service_role;

-- 5. The parties of one work for the office: every version, newest first,
-- with the Auftraggeber's current name, the work's Einsatzort and
-- the Objekt's active access contacts. Null when the work is not in the
-- organization.
create function public.get_work_billing_parties(p_organization_id uuid, p_kind text, p_work_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  with work as (
    select request.client_id, request.site_id from public.client_requests request
    where p_kind = 'request' and request.organization_id = p_organization_id and request.id = p_work_id
    union all
    select job.client_id, job.site_id from public.jobs job
    where p_kind = 'job' and job.organization_id = p_organization_id and job.id = p_work_id
    union all
    select project.client_id, project.site_id from public.projects project
    where p_kind = 'project' and project.organization_id = p_organization_id and project.id = p_work_id
    union all
    select service_case.client_id, service_case.site_id from public.service_cases service_case
    where p_kind = 'service_case' and service_case.organization_id = p_organization_id
      and service_case.id = p_work_id
  )
  select jsonb_build_object(
    'hasClient', work.client_id is not null,
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', party.id, 'version', party.version, 'source', party.source,
        'clientId', party.client_id, 'clientName', auftraggeber.name,
        'recipientClientId', party.recipient_client_id,
        'recipientName', party.recipient_name, 'recipientAddress', party.recipient_address,
        'setAt', party.created_at
      ) order by party.version desc)
      from public.work_billing_parties party
      join public.clients auftraggeber
        on auftraggeber.id = party.client_id and auftraggeber.organization_id = p_organization_id
      where party.organization_id = p_organization_id and party.work_id = p_work_id
    ), '[]'),
    'site', (
      select jsonb_build_object(
        'id', site.id, 'name', site.name, 'street', site.street,
        'postalCode', site.postal_code, 'city', site.city
      )
      from public.client_sites site
      where site.id = work.site_id and site.organization_id = p_organization_id
    ),
    'accessContacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', contact.id, 'name', contact.name, 'phone', contact.phone)
        order by contact.name collate "de-DE-x-icu", contact.id)
      from public.client_contacts contact
      where work.site_id is not null and contact.organization_id = p_organization_id
        and contact.site_id = work.site_id and contact.site_role = 'zugangskontakt' and contact.is_active
    ), '[]')
  )
  from work;
$$;
revoke all on function public.get_work_billing_parties(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_work_billing_parties(uuid, text, uuid) to service_role;

-- 6. A customer that is Auftraggeber or recipient of another customer's
-- work, now or in its history, is linked.
create or replace function app_private.client_links(p_organization_id uuid, p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'jobs', nullif((select count(*) from public.jobs link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'projects', nullif((select count(*) from public.projects link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'requests', nullif((select count(*) from public.client_requests link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'service_cases', nullif((select count(*) from public.service_cases link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'equipment', nullif((select count(*) from public.installed_equipment link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'maintenance', nullif((select count(*) from public.maintenance_coverages link
      where link.organization_id = p_organization_id and link.client_id = p_client_id)
      + (select count(*) from public.maintenance_plans link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'documents', nullif((select count(*) from public.document_links link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'follow_ups', nullif((select count(*) from public.client_follow_ups link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'site_roles', nullif((select count(*) from public.client_site_roles link
      where link.organization_id = p_organization_id and link.holder_client_id <> link.client_id
        and (link.client_id = p_client_id or link.holder_client_id = p_client_id)), 0),
    'billing_parties', nullif((select count(distinct link.work_id) from public.work_billing_parties link
      where link.organization_id = p_organization_id
        and (link.client_id = p_client_id or link.recipient_client_id = p_client_id)
        and p_client_id is distinct from coalesce(
          (select request.client_id from public.client_requests request where request.id = link.request_id),
          (select job.client_id from public.jobs job where job.id = link.job_id),
          (select project.client_id from public.projects project where project.id = link.project_id),
          (select service_case.client_id from public.service_cases service_case
            where service_case.id = link.service_case_id))), 0)
  ));
$$;
